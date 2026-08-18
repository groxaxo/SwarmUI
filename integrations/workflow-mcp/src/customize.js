import { validatePromptReferences } from './catalog.js';

const FORBIDDEN_POINTER_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_PATCHES = 128;
const MAX_POINTER_DEPTH = 16;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function title(node) {
  return String(node?._meta?.title ?? '').toLowerCase();
}

function classNodes(prompt, classType) {
  return Object.entries(prompt).filter(([, node]) => node.class_type === classType);
}

function setInput(node, key, value, applied) {
  if (!isObject(node.inputs)) {
    node.inputs = {};
  }
  node.inputs[key] = value;
  applied.push({ node: node._meta?.title ?? node.class_type, input: key, value });
}

function nearestMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function positiveNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  return value;
}

function decodePointerSegment(segment) {
  const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
  if (FORBIDDEN_POINTER_SEGMENTS.has(decoded)) {
    throw new Error(`JSON Pointer contains forbidden segment '${decoded}'.`);
  }
  return decoded;
}

function pointerSegments(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`JSON Pointer must start with '/': ${String(pointer)}`);
  }
  const segments = pointer.slice(1).split('/').map(decodePointerSegment);
  if (segments.length > MAX_POINTER_DEPTH) {
    throw new Error(`JSON Pointer exceeds maximum depth ${MAX_POINTER_DEPTH}.`);
  }
  return segments;
}

function locateParent(document, segments, createMissing = false) {
  let current = document;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid array index '${segment}' in JSON Pointer.`);
      }
      current = current[index];
    }
    else if (isObject(current)) {
      if (!(segment in current)) {
        if (!createMissing) {
          throw new Error(`JSON Pointer segment '${segment}' does not exist.`);
        }
        current[segment] = {};
      }
      current = current[segment];
    }
    else {
      throw new Error(`JSON Pointer traverses a non-container at '${segment}'.`);
    }
  }
  return { parent: current, key: segments.at(-1) };
}

export function applyJsonPointerPatches(document, patches = []) {
  if (!Array.isArray(patches)) {
    throw new Error('patches must be an array.');
  }
  if (patches.length > MAX_PATCHES) {
    throw new Error(`At most ${MAX_PATCHES} patches may be applied in one call.`);
  }
  const output = clone(document);
  const applied = [];
  for (const patch of patches) {
    if (!isObject(patch)) {
      throw new Error('Each patch must be an object.');
    }
    const operation = patch.op;
    if (!['add', 'replace', 'remove'].includes(operation)) {
      throw new Error(`Unsupported patch operation '${String(operation)}'.`);
    }
    const segments = pointerSegments(patch.path);
    const { parent, key } = locateParent(output, segments, operation === 'add');
    if (Array.isArray(parent)) {
      if (operation === 'add' && key === '-') {
        parent.push(clone(patch.value));
      }
      else {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index > parent.length) {
          throw new Error(`Invalid array index '${key}'.`);
        }
        if (operation === 'remove') {
          if (index >= parent.length) {
            throw new Error(`Array index '${key}' does not exist.`);
          }
          parent.splice(index, 1);
        }
        else if (operation === 'replace') {
          if (index >= parent.length) {
            throw new Error(`Array index '${key}' does not exist.`);
          }
          parent[index] = clone(patch.value);
        }
        else {
          parent.splice(index, 0, clone(patch.value));
        }
      }
    }
    else if (isObject(parent)) {
      if (operation === 'remove') {
        if (!(key in parent)) {
          throw new Error(`JSON Pointer target '${patch.path}' does not exist.`);
        }
        delete parent[key];
      }
      else if (operation === 'replace') {
        if (!(key in parent)) {
          throw new Error(`JSON Pointer target '${patch.path}' does not exist.`);
        }
        parent[key] = clone(patch.value);
      }
      else {
        parent[key] = clone(patch.value);
      }
    }
    else {
      throw new Error(`JSON Pointer target '${patch.path}' is not a container.`);
    }
    applied.push({ op: operation, path: patch.path });
  }
  return { document: output, applied };
}

function customizeLtx25(prompt, options, applied, warnings) {
  const positiveNodes = classNodes(prompt, 'CLIPTextEncode');
  if (options.prompt !== undefined) {
    const positive = positiveNodes.find(([, node]) => title(node).includes('positive')) ?? positiveNodes[0];
    if (!positive) {
      throw new Error('LTX 2.5 workflow has no positive CLIPTextEncode node.');
    }
    setInput(positive[1], 'text', options.prompt, applied);
  }
  if (options.negativePrompt !== undefined) {
    const negative = positiveNodes.find(([, node]) => title(node).includes('negative')) ?? positiveNodes[1];
    if (!negative) {
      throw new Error('LTX 2.5 workflow has no negative CLIPTextEncode node.');
    }
    setInput(negative[1], 'text', options.negativePrompt, applied);
  }

  if (options.seed !== undefined) {
    const seed = nonNegativeInteger(options.seed, 'seed');
    const noiseNodes = classNodes(prompt, 'RandomNoise');
    noiseNodes.forEach(([, node], index) => setInput(node, 'noise_seed', seed + index, applied));
  }

  const hasX2Upscaler = classNodes(prompt, 'LTXVLatentUpsampler').length > 0;
  if (options.width !== undefined || options.height !== undefined) {
    const requestedWidth = options.width === undefined ? null : positiveInteger(options.width, 'width');
    const requestedHeight = options.height === undefined ? null : positiveInteger(options.height, 'height');
    for (const [, node] of classNodes(prompt, 'EmptyLTXVLatentVideo')) {
      if (requestedWidth !== null) {
        const lowWidth = hasX2Upscaler
          ? nearestMultiple(requestedWidth / 2, 32)
          : nearestMultiple(requestedWidth, 32);
        setInput(node, 'width', lowWidth, applied);
        const actual = hasX2Upscaler ? lowWidth * 2 : lowWidth;
        if (actual !== requestedWidth) {
          warnings.push(`Requested width ${requestedWidth} was aligned to ${actual}.`);
        }
      }
      if (requestedHeight !== null) {
        const lowHeight = hasX2Upscaler
          ? nearestMultiple(requestedHeight / 2, 32)
          : nearestMultiple(requestedHeight, 32);
        setInput(node, 'height', lowHeight, applied);
        const actual = hasX2Upscaler ? lowHeight * 2 : lowHeight;
        if (actual !== requestedHeight) {
          warnings.push(`Requested height ${requestedHeight} was aligned to ${actual}.`);
        }
      }
    }
  }

  if (options.frames !== undefined) {
    const frames = positiveInteger(options.frames, 'frames');
    if ((frames - 1) % 8 !== 0) {
      throw new Error('LTX 2.5 frame count must be 8n+1 (for example 121, 241, or 361).');
    }
    for (const [, node] of classNodes(prompt, 'EmptyLTXVLatentVideo')) {
      setInput(node, 'length', frames, applied);
    }
    for (const [, node] of classNodes(prompt, 'LTXVEmptyLatentAudio')) {
      setInput(node, 'frames_number', frames, applied);
    }
  }

  if (options.fps !== undefined) {
    const fps = positiveNumber(options.fps, 'fps');
    for (const classType of ['LTXVConditioning', 'LTXVEmptyLatentAudio']) {
      for (const [, node] of classNodes(prompt, classType)) {
        setInput(node, 'frame_rate', fps, applied);
      }
    }
    for (const [, node] of classNodes(prompt, 'CreateVideo')) {
      setInput(node, 'fps', fps, applied);
    }
  }

  if (options.firstImage !== undefined) {
    const loadImage = classNodes(prompt, 'LoadImage')[0];
    if (!loadImage) {
      throw new Error('LTX 2.5 workflow has no LoadImage node.');
    }
    setInput(loadImage[1], 'image', options.firstImage, applied);
  }

  if (options.filenamePrefix !== undefined) {
    for (const [, node] of classNodes(prompt, 'SaveVideo')) {
      setInput(node, 'filename_prefix', options.filenamePrefix, applied);
    }
  }
}

function customizeH3(prompt, options, applied, warnings) {
  const samplers = [
    ...classNodes(prompt, 'H3MultishotSampler'),
    ...classNodes(prompt, 'H3MultishotMemorySampler'),
  ];
  if (!samplers.length) {
    throw new Error('MiniMax H3 workflow has no H3 sampler node.');
  }
  const script = options.script ?? options.prompt;
  if (script !== undefined) {
    for (const [, node] of samplers) {
      setInput(node, 'script', script, applied);
    }
  }
  if (options.seed !== undefined) {
    const seed = nonNegativeInteger(options.seed, 'seed');
    for (const [, node] of samplers) {
      setInput(node, 'seed', seed, applied);
    }
  }
  if (options.width !== undefined) {
    const requested = positiveInteger(options.width, 'width');
    const aligned = nearestMultiple(requested, 32);
    for (const [, node] of samplers) {
      setInput(node, 'width', aligned, applied);
    }
    if (aligned !== requested) {
      warnings.push(`Requested width ${requested} was aligned to ${aligned}.`);
    }
  }
  if (options.height !== undefined) {
    const requested = positiveInteger(options.height, 'height');
    const aligned = nearestMultiple(requested, 32);
    for (const [, node] of samplers) {
      setInput(node, 'height', aligned, applied);
    }
    if (aligned !== requested) {
      warnings.push(`Requested height ${requested} was aligned to ${aligned}.`);
    }
  }
  if (options.frames !== undefined) {
    const frames = positiveInteger(options.frames, 'frames');
    for (const [, node] of samplers) {
      setInput(node, 'frames_per_shot', frames, applied);
    }
  }
  if (options.fps !== undefined) {
    const fps = positiveNumber(options.fps, 'fps');
    for (const [, node] of classNodes(prompt, 'CreateVideo')) {
      setInput(node, 'fps', fps, applied);
    }
  }
  if (options.filenamePrefix !== undefined) {
    for (const [, node] of classNodes(prompt, 'SaveVideo')) {
      setInput(node, 'filename_prefix', options.filenamePrefix, applied);
    }
  }
  if (options.firstImage !== undefined) {
    const loadImages = classNodes(prompt, 'LoadImage');
    if (!loadImages.length) {
      throw new Error('This MiniMax H3 workflow does not accept a first-frame image.');
    }
    setInput(loadImages[0][1], 'image', options.firstImage, applied);
  }
  if (options.finalImage !== undefined) {
    const loadImages = classNodes(prompt, 'LoadImage');
    if (loadImages.length < 2) {
      throw new Error('This MiniMax H3 workflow does not accept a final-frame image.');
    }
    setInput(loadImages[1][1], 'image', options.finalImage, applied);
  }
}

function unresolvedPlaceholders(prompt) {
  const serialized = JSON.stringify(prompt);
  const patterns = [
    /PIPELINE_REPLACES_[A-Z0-9_]+/g,
    /PROMPT\s+(?:ONE|TWO|THREE)\s+HERE/gi,
    /\/ABSOLUTE\/PATH\/TO\//g,
  ];
  return [...new Set(patterns.flatMap(pattern => serialized.match(pattern) ?? []))].sort();
}

export function materializeWorkflow(entry, options = {}) {
  if (!entry.prompt) {
    throw new Error(`Workflow '${entry.id}' has no queueable API prompt.`);
  }
  let prompt = clone(entry.prompt);
  const applied = [];
  const warnings = [];

  if (entry.family === 'ltx-2.5') {
    customizeLtx25(prompt, options, applied, warnings);
  }
  else if (entry.family === 'minimax-h3') {
    customizeH3(prompt, options, applied, warnings);
  }
  else {
    if (options.prompt !== undefined) {
      throw new Error('High-level prompt customization is supported only for LTX 2.5 and MiniMax H3.');
    }
  }

  if (options.patches?.length) {
    const patched = applyJsonPointerPatches(prompt, options.patches);
    prompt = patched.document;
    applied.push(...patched.applied.map(item => ({ patch: item })));
  }

  const validationErrors = validatePromptReferences(prompt);
  const placeholders = unresolvedPlaceholders(prompt);
  return {
    workflow_id: entry.id,
    family: entry.family,
    prompt,
    applied,
    warnings,
    validation_errors: validationErrors,
    unresolved_placeholders: placeholders,
    ready_to_queue: validationErrors.length === 0 && placeholders.length === 0,
  };
}
