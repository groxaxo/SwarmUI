#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { WorkflowCatalog, publicMetadata } from './catalog.js';
import { materializeWorkflow } from './customize.js';
import { ComfyClient, requireWriteConfirmation, writesEnabled } from './comfy-client.js';

const SERVER_NAME = 'swarmui-workflows';
const SERVER_VERSION = '0.1.0';

const patchSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']).describe('RFC 6902-style operation.'),
  path: z.string().startsWith('/').describe('JSON Pointer rooted at the API prompt object.'),
  value: z.unknown().optional().describe('Required for add and replace; ignored for remove.'),
});

const overrideShape = {
  prompt: z.string().min(1).optional().describe('Positive prompt or H3 script.'),
  negativePrompt: z.string().optional().describe('LTX 2.5 negative prompt.'),
  script: z.string().min(1).optional().describe('Explicit MiniMax H3 multishot script.'),
  seed: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional().describe('Requested final output width.'),
  height: z.number().int().positive().optional().describe('Requested final output height.'),
  frames: z.number().int().positive().optional().describe('LTX total frames or H3 frames per shot.'),
  fps: z.number().positive().max(240).optional(),
  firstImage: z.string().min(1).optional().describe('ComfyUI input filename for the first frame.'),
  finalImage: z.string().min(1).optional().describe('ComfyUI input filename for H3 FLFA final frame.'),
  filenamePrefix: z.string().min(1).optional().describe('SaveVideo filename prefix.'),
  patches: z.array(patchSchema).max(128).optional().describe('Exact JSON Pointer patches applied after high-level overrides.'),
};

function compactEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    family: entry.family,
    queueable: entry.queueable,
    ready_to_queue: entry.readyToQueue,
    placeholders: entry.placeholders,
    models: entry.models,
    devices: entry.devices,
    description: entry.description,
  };
}

function textResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function safe(handler) {
  return async args => {
    try {
      return await handler(args ?? {});
    }
    catch (error) {
      return errorResult(error);
    }
  };
}

async function catalog() {
  return WorkflowCatalog.load();
}

async function materialize(id, options) {
  const current = await catalog();
  return materializeWorkflow(current.get(id), options);
}

function remoteMissingClasses(objectInfo, classTypes) {
  const available = new Set(Object.keys(objectInfo ?? {}));
  return classTypes.filter(classType => !available.has(classType));
}

function comboOptions(specification) {
  if (!Array.isArray(specification)) {
    return null;
  }
  for (const item of specification) {
    if (Array.isArray(item) && item.every(value => typeof value === 'string')) {
      return item;
    }
    if (item && typeof item === 'object' && Array.isArray(item.options)) {
      return item.options.filter(value => typeof value === 'string');
    }
  }
  return null;
}

function remoteMissingModels(objectInfo, prompt) {
  const mismatches = [];
  const modelPattern = /\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i;
  for (const [nodeId, node] of Object.entries(prompt)) {
    const nodeInfo = objectInfo?.[node.class_type];
    if (!nodeInfo) {
      continue;
    }
    const schemas = {
      ...(nodeInfo.input?.required ?? {}),
      ...(nodeInfo.input?.optional ?? {}),
    };
    for (const [inputName, value] of Object.entries(node.inputs ?? {})) {
      if (typeof value !== 'string' || !modelPattern.test(value)) {
        continue;
      }
      const options = comboOptions(schemas[inputName]);
      if (!options?.length) {
        continue;
      }
      const normalized = value.replaceAll('\\', '/');
      const available = new Set(options.map(option => option.replaceAll('\\', '/')));
      if (!available.has(normalized)) {
        mismatches.push({
          node_id: nodeId,
          class_type: node.class_type,
          input: inputName,
          model: value,
        });
      }
    }
  }
  return mismatches;
}

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.registerResource(
  'workflow-catalog',
  'swarmui-workflows://catalog',
  {
    title: 'SwarmUI bundled workflow catalog',
    description: 'Metadata for the bundled LTX 2.5 and MiniMax H3 workflows.',
    mimeType: 'application/json',
  },
  async uri => {
    const current = await catalog();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(current.entries.map(compactEntry), null, 2),
      }],
    };
  },
);

server.registerResource(
  'workflow',
  new ResourceTemplate('swarmui-workflows://workflow/{workflowId}', {
    list: async () => {
      const current = await catalog();
      return {
        resources: current.entries.map(entry => ({
          uri: `swarmui-workflows://workflow/${encodeURIComponent(entry.id)}`,
          name: entry.name,
          title: `${entry.family}: ${entry.name}`,
          description: entry.description,
          mimeType: 'application/json',
        })),
      };
    },
  }),
  {
    title: 'SwarmUI workflow wrapper',
    description: 'One bundled workflow including its API prompt and metadata.',
    mimeType: 'application/json',
  },
  async (uri, { workflowId }) => {
    const current = await catalog();
    const id = decodeURIComponent(String(workflowId));
    const entry = current.get(id);
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(entry.wrapper ?? entry.prompt ?? entry.workflow, null, 2),
      }],
    };
  },
);

server.registerPrompt(
  'prepare-video-workflow',
  {
    title: 'Prepare a SwarmUI video workflow',
    description: 'Guide an LTX 2.5 or MiniMax H3 workflow selection and validation sequence.',
    argsSchema: z.object({
      family: z.enum(['ltx-2.5', 'minimax-h3']).describe('Required workflow family.'),
      goal: z.string().min(1).describe('The desired video and operational constraints.'),
    }),
  },
  ({ family, goal }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Prepare a ${family} SwarmUI workflow for this goal:`,
          goal,
          '',
          'Use the swarmui-workflows MCP server in this order:',
          '1. list_workflows filtered to the requested family.',
          '2. inspect_workflow for the best candidate and report required models, CUDA devices, and placeholders.',
          '3. materialize_workflow with only the requested overrides.',
          '4. validate_workflow locally and remotely when a Comfy endpoint is configured.',
          '5. Do not queue unless I explicitly requested execution and the materialized prompt is placeholder-free.',
          '6. For LTX, use only LTX 2.5 assets. For MiniMax H3, preserve cuda:0/1/2 placement unless I explicitly request remapping.',
        ].join('\n'),
      },
    }],
  }),
);

server.registerTool(
  'list_workflows',
  {
    title: 'List bundled workflows',
    description: 'List LTX 2.5 and MiniMax H3 workflows with readiness, models, devices, and placeholders.',
    inputSchema: z.object({
      family: z.enum(['all', 'ltx-2.5', 'minimax-h3', 'other']).optional(),
      search: z.string().optional(),
      queueable: z.boolean().optional(),
      ready: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  safe(async ({ family = 'all', search, queueable, ready }) => {
    const current = await catalog();
    const entries = current.list({
      family,
      search,
      queueable: queueable ?? null,
      ready: ready ?? null,
    });
    return textResult({ count: entries.length, workflows: entries.map(compactEntry) });
  }),
);

server.registerTool(
  'inspect_workflow',
  {
    title: 'Inspect a workflow',
    description: 'Inspect one workflow without returning the full graph.',
    inputSchema: z.object({ workflowId: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  safe(async ({ workflowId }) => {
    const current = await catalog();
    return textResult(publicMetadata(current.get(workflowId)));
  }),
);

server.registerTool(
  'get_workflow',
  {
    title: 'Read a workflow',
    description: 'Return the full stored wrapper, API prompt, UI workflow, or metadata for one bundled workflow.',
    inputSchema: z.object({
      workflowId: z.string().min(1),
      part: z.enum(['metadata', 'wrapper', 'prompt', 'workflow']).default('metadata'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  safe(async ({ workflowId, part }) => {
    const current = await catalog();
    const entry = current.get(workflowId);
    if (part === 'metadata') {
      return textResult(publicMetadata(entry));
    }
    const value = part === 'wrapper' ? entry.wrapper : part === 'prompt' ? entry.prompt : entry.workflow;
    if (value === null) {
      throw new Error(`Workflow '${workflowId}' has no ${part} representation.`);
    }
    return textResult({ workflow_id: workflowId, part, value });
  }),
);

server.registerTool(
  'materialize_workflow',
  {
    title: 'Customize a workflow',
    description: 'Clone a bundled API prompt and apply safe LTX 2.5 or MiniMax H3 overrides without modifying repository files.',
    inputSchema: z.object({ workflowId: z.string().min(1), ...overrideShape }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  safe(async ({ workflowId, ...options }) => textResult(await materialize(workflowId, options))),
);

server.registerTool(
  'validate_workflow',
  {
    title: 'Validate a workflow',
    description: 'Validate local prompt references and placeholders; optionally compare node classes and models with a configured ComfyUI endpoint.',
    inputSchema: z.object({
      workflowId: z.string().min(1),
      remote: z.boolean().default(false),
      ...overrideShape,
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  safe(async ({ workflowId, remote, ...options }) => {
    const current = await catalog();
    const entry = current.get(workflowId);
    const built = materializeWorkflow(entry, options);
    const result = {
      workflow_id: workflowId,
      local: {
        valid: built.validation_errors.length === 0,
        errors: built.validation_errors,
        unresolved_placeholders: built.unresolved_placeholders,
        ready_to_queue: built.ready_to_queue,
      },
      remote: null,
    };
    if (remote) {
      const client = new ComfyClient();
      const [objectInfo, systemStats] = await Promise.all([client.objectInfo(), client.systemStats()]);
      const classes = [...new Set(Object.values(built.prompt).map(node => node.class_type))].sort();
      const missingNodes = remoteMissingClasses(objectInfo, classes);
      const missingModels = remoteMissingModels(objectInfo, built.prompt);
      result.remote = {
        valid: missingNodes.length === 0 && missingModels.length === 0,
        missing_node_classes: missingNodes,
        missing_model_inputs: missingModels,
        comfyui_version: systemStats?.system?.comfyui_version ?? null,
        endpoint: process.env.SWARMUI_MCP_COMFY_URL,
      };
    }
    return textResult(result);
  }),
);

server.registerTool(
  'get_backend_status',
  {
    title: 'Get ComfyUI backend status',
    description: 'Read system statistics from the configured ComfyUI or SwarmUI direct backend endpoint.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  safe(async () => {
    const client = new ComfyClient();
    return textResult({ endpoint: process.env.SWARMUI_MCP_COMFY_URL, system_stats: await client.systemStats() });
  }),
);

server.registerTool(
  'get_queue',
  {
    title: 'Read the ComfyUI queue',
    description: 'Return running and pending prompts from the configured ComfyUI endpoint.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  safe(async () => textResult(await new ComfyClient().queue())),
);

server.registerTool(
  'get_history',
  {
    title: 'Read ComfyUI history',
    description: 'Return all ComfyUI history or one prompt record.',
    inputSchema: z.object({ promptId: z.string().min(1).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  safe(async ({ promptId }) => textResult(await new ComfyClient().history(promptId ?? null))),
);

server.registerTool(
  'queue_workflow',
  {
    title: 'Queue a workflow',
    description: 'Materialize, validate, and submit one bundled workflow. Disabled unless SWARMUI_MCP_ALLOW_WRITES=true and confirm=true.',
    inputSchema: z.object({
      workflowId: z.string().min(1),
      confirm: z.literal(true).describe('Explicit acknowledgement that the materialized workflow was reviewed.'),
      clientId: z.string().min(1).optional(),
      ...overrideShape,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  safe(async ({ workflowId, confirm, clientId, ...options }) => {
    requireWriteConfirmation(confirm);
    const built = await materialize(workflowId, options);
    if (!built.ready_to_queue) {
      throw new Error(
        `Workflow is not ready to queue. Validation errors: ${built.validation_errors.join('; ') || 'none'}. Unresolved placeholders: ${built.unresolved_placeholders.join(', ') || 'none'}.`,
      );
    }
    const client = new ComfyClient();
    const objectInfo = await client.objectInfo();
    const classes = [...new Set(Object.values(built.prompt).map(node => node.class_type))].sort();
    const missingNodes = remoteMissingClasses(objectInfo, classes);
    const missingModels = remoteMissingModels(objectInfo, built.prompt);
    if (missingNodes.length || missingModels.length) {
      throw new Error(
        `Remote validation failed. Missing node classes: ${missingNodes.join(', ') || 'none'}. Missing model inputs: ${JSON.stringify(missingModels)}.`,
      );
    }
    const queued = await client.queuePrompt(built.prompt, { clientId });
    return textResult({
      workflow_id: workflowId,
      family: built.family,
      applied: built.applied,
      warnings: built.warnings,
      ...queued,
    });
  }),
);

server.registerTool(
  'cancel_workflow',
  {
    title: 'Cancel a queued workflow',
    description: 'Delete a pending prompt or interrupt a running prompt; optionally remove its history. Requires the write gate and confirm=true.',
    inputSchema: z.object({
      promptId: z.string().min(1),
      deleteHistory: z.boolean().default(true),
      confirm: z.literal(true),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  safe(async ({ promptId, deleteHistory, confirm }) => {
    requireWriteConfirmation(confirm);
    return textResult(await new ComfyClient().cancelPrompt(promptId, { deleteHistory }));
  }),
);

server.registerTool(
  'server_capabilities',
  {
    title: 'Describe workflow MCP capabilities',
    description: 'Return local paths, endpoint configuration, and whether queue/cancel writes are enabled.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  safe(async () => {
    const current = await catalog();
    return textResult({
      server: SERVER_NAME,
      version: SERVER_VERSION,
      workflow_root: current.root,
      workflow_count: current.entries.length,
      families: [...new Set(current.entries.map(entry => entry.family))].sort(),
      comfy_endpoint_configured: Boolean(process.env.SWARMUI_MCP_COMFY_URL?.trim()),
      writes_enabled: writesEnabled(),
      write_policy: 'queue_workflow and cancel_workflow additionally require confirm=true',
    });
  }),
);

async function main() {
  const preflight = await catalog();
  if (!preflight.entries.length) {
    throw new Error(`No bundled workflows found under ${preflight.root}`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  console.error(`[${SERVER_NAME}] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
