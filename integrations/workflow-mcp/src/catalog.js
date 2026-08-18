import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, resolveWorkflowRoot, stripJsonExtension, toPosixPath } from './paths.js';

const MAX_WORKFLOW_BYTES = 32 * 1024 * 1024;
const MODEL_EXTENSIONS = /\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i;
const DEVICE_PATTERN = /^(?:cuda(?::\d+)?|cpu|mps|xpu(?::\d+)?)$/i;
const PLACEHOLDER_PATTERNS = [
  /PIPELINE_REPLACES_[A-Z0-9_]+/g,
  /PROMPT\s+(?:ONE|TWO|THREE)\s+HERE/gi,
  /\/ABSOLUTE\/PATH\/TO\//g,
  /<[^>]*(?:prompt|path|image|model|replace)[^>]*>/gi,
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isApiPrompt(value) {
  if (!isObject(value)) {
    return false;
  }
  const nodes = Object.values(value);
  return nodes.length > 0 && nodes.every(node => isObject(node) && typeof node.class_type === 'string');
}

function isUiWorkflow(value) {
  return isObject(value) && Array.isArray(value.nodes);
}

function deepStrings(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
  }
  else if (Array.isArray(value)) {
    for (const item of value) {
      deepStrings(item, output);
    }
  }
  else if (isObject(value)) {
    for (const item of Object.values(value)) {
      deepStrings(item, output);
    }
  }
  return output;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function collectPlaceholders(strings) {
  const found = [];
  for (const text of strings) {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        found.push(match[0]);
      }
    }
  }
  return uniqueSorted(found);
}

function collectModels(strings) {
  return uniqueSorted(
    strings
      .map(value => value.trim())
      .filter(value => MODEL_EXTENSIONS.test(value) && !value.includes('\n')),
  );
}

function collectDevices(strings) {
  return uniqueSorted(
    strings
      .flatMap(value => value.split(/[;,\s]+/))
      .map(value => value.trim())
      .filter(value => DEVICE_PATTERN.test(value)),
  );
}

function familyFromRelative(relativePath) {
  const first = toPosixPath(relativePath).split('/')[0].toLowerCase();
  if (first.includes('ltx')) {
    return 'ltx-2.5';
  }
  if (first.includes('minimax') || first.includes('h3')) {
    return 'minimax-h3';
  }
  return 'other';
}

function normalizeWrapper(raw) {
  if (isObject(raw) && ('workflow' in raw || 'prompt' in raw || 'description' in raw)) {
    return {
      wrapper: raw,
      prompt: isApiPrompt(raw.prompt) ? raw.prompt : null,
      workflow: isUiWorkflow(raw.workflow) ? raw.workflow : null,
      description: typeof raw.description === 'string' ? raw.description : '',
      image: typeof raw.image === 'string' ? raw.image : null,
      enableInSimple: raw.enable_in_simple === true,
      format: 'swarm-wrapper',
    };
  }
  if (isApiPrompt(raw)) {
    return {
      wrapper: null,
      prompt: raw,
      workflow: null,
      description: '',
      image: null,
      enableInSimple: false,
      format: 'comfy-api-prompt',
    };
  }
  if (isUiWorkflow(raw)) {
    return {
      wrapper: null,
      prompt: isApiPrompt(raw.extra?.prompt) ? raw.extra.prompt : null,
      workflow: raw,
      description: '',
      image: null,
      enableInSimple: false,
      format: 'comfy-ui-workflow',
    };
  }
  throw new Error('Unsupported workflow JSON shape');
}

function promptNodeClasses(prompt) {
  if (!prompt) {
    return [];
  }
  return uniqueSorted(Object.values(prompt).map(node => node.class_type));
}

function uiNodeClasses(workflow) {
  if (!workflow) {
    return [];
  }
  const nested = workflow.definitions?.subgraphs;
  const classes = workflow.nodes.map(node => String(node.type));
  if (Array.isArray(nested)) {
    for (const subgraph of nested) {
      if (Array.isArray(subgraph?.nodes)) {
        classes.push(...subgraph.nodes.map(node => String(node.type)));
      }
    }
  }
  return uniqueSorted(classes);
}

function displayName(relativePath) {
  return path.basename(relativePath, path.extname(relativePath));
}

async function listJsonFiles(root, current = root, output = []) {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      await listJsonFiles(root, fullPath, output);
    }
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      output.push(await resolveInside(root, fullPath));
    }
  }
  return output;
}

export function validatePromptReferences(prompt) {
  const errors = [];
  if (!isApiPrompt(prompt)) {
    return ['Prompt is missing or is not a ComfyUI API prompt object.'];
  }
  const nodeIds = new Set(Object.keys(prompt));
  for (const [targetId, node] of Object.entries(prompt)) {
    const inputs = isObject(node.inputs) ? node.inputs : {};
    for (const [inputName, value] of Object.entries(inputs)) {
      if (Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number')) {
        const sourceId = String(value[0]);
        if (!nodeIds.has(sourceId)) {
          errors.push(`${targetId}.${inputName} references missing node ${sourceId}.`);
        }
        if (!Number.isInteger(value[1]) || value[1] < 0) {
          errors.push(`${targetId}.${inputName} has invalid output slot ${String(value[1])}.`);
        }
      }
    }
  }
  return errors;
}

export function validateUiWorkflow(workflow) {
  const errors = [];
  if (!isUiWorkflow(workflow)) {
    return errors;
  }
  const nodeIds = new Set(workflow.nodes.map(node => String(node.id)));
  for (const link of workflow.links ?? []) {
    if (!Array.isArray(link) || link.length < 5) {
      errors.push('UI workflow contains a malformed link entry.');
      continue;
    }
    const source = String(link[1]);
    const target = String(link[3]);
    if (!nodeIds.has(source)) {
      errors.push(`UI link ${String(link[0])} references missing source node ${source}.`);
    }
    if (!nodeIds.has(target)) {
      errors.push(`UI link ${String(link[0])} references missing target node ${target}.`);
    }
  }
  return errors;
}

export class WorkflowCatalog {
  constructor(root, entries) {
    this.root = root;
    this.entries = entries;
    this.byId = new Map(entries.map(entry => [entry.id, entry]));
  }

  static async load(root = null) {
    const workflowRoot = root ? await resolveInside(root, root) : await resolveWorkflowRoot();
    const files = await listJsonFiles(workflowRoot);
    const entries = [];
    for (const filePath of files) {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_WORKFLOW_BYTES) {
        throw new Error(`Workflow exceeds ${MAX_WORKFLOW_BYTES} bytes: ${filePath}`);
      }
      const text = await readFile(filePath, 'utf8');
      let raw;
      try {
        raw = JSON.parse(text);
      }
      catch (error) {
        throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
      }
      let normalized;
      try {
        normalized = normalizeWrapper(raw);
      }
      catch (error) {
        throw new Error(`Unsupported workflow ${filePath}: ${error.message}`);
      }
      const relativePath = toPosixPath(path.relative(workflowRoot, filePath));
      const id = stripJsonExtension(relativePath);
      const strings = deepStrings(raw);
      const placeholders = collectPlaceholders(strings);
      const referenceErrors = normalized.prompt
        ? validatePromptReferences(normalized.prompt)
        : [];
      const uiErrors = validateUiWorkflow(normalized.workflow);
      const classTypes = uniqueSorted([
        ...promptNodeClasses(normalized.prompt),
        ...uiNodeClasses(normalized.workflow),
      ]);
      entries.push({
        id,
        name: displayName(relativePath),
        family: familyFromRelative(relativePath),
        relativePath,
        filePath,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        sha256: createHash('sha256').update(text).digest('hex'),
        format: normalized.format,
        description: normalized.description,
        image: normalized.image,
        enableInSimple: normalized.enableInSimple,
        wrapper: normalized.wrapper,
        prompt: normalized.prompt,
        workflow: normalized.workflow,
        classTypes,
        models: collectModels(strings),
        devices: collectDevices(strings),
        placeholders,
        validationErrors: [...referenceErrors, ...uiErrors],
        queueable: normalized.prompt !== null,
        readyToQueue:
          normalized.prompt !== null
          && placeholders.length === 0
          && referenceErrors.length === 0,
      });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return new WorkflowCatalog(workflowRoot, entries);
  }

  list({ family = null, search = null, queueable = null, ready = null } = {}) {
    const needle = search?.trim().toLowerCase();
    return this.entries.filter(entry => {
      if (family && family !== 'all' && entry.family !== family) {
        return false;
      }
      if (queueable !== null && entry.queueable !== queueable) {
        return false;
      }
      if (ready !== null && entry.readyToQueue !== ready) {
        return false;
      }
      if (needle) {
        const haystack = [entry.id, entry.name, entry.description, ...entry.classTypes, ...entry.models]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }

  get(id) {
    const entry = this.byId.get(id);
    if (!entry) {
      const available = this.entries.map(item => item.id).join(', ');
      throw new Error(`Unknown workflow '${id}'. Available workflows: ${available}`);
    }
    return entry;
  }
}

export function publicMetadata(entry, { includeDescription = true } = {}) {
  return {
    id: entry.id,
    name: entry.name,
    family: entry.family,
    relative_path: entry.relativePath,
    format: entry.format,
    queueable: entry.queueable,
    ready_to_queue: entry.readyToQueue,
    placeholders: entry.placeholders,
    validation_errors: entry.validationErrors,
    node_classes: entry.classTypes,
    models: entry.models,
    devices: entry.devices,
    sha256: entry.sha256,
    size_bytes: entry.sizeBytes,
    ...(includeDescription ? { description: entry.description } : {}),
  };
}
