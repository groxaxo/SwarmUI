import assert from 'node:assert/strict';
import test from 'node:test';
import { applyJsonPointerPatches, materializeWorkflow } from '../src/customize.js';

const ltxEntry = {
  id: 'LTX 2.5/Core',
  family: 'ltx-2.5',
  prompt: {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old' }, _meta: { title: 'Positive prompt' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'bad' }, _meta: { title: 'Negative prompt' } },
    '3': { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
    '4': { class_type: 'RandomNoise', inputs: { noise_seed: 2 } },
    '5': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: 672, height: 384, length: 121 } },
    '6': { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: 121, frame_rate: 24 } },
    '7': { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['5', 0] } },
    '8': { class_type: 'LTXVConditioning', inputs: { frame_rate: 24 } },
    '9': { class_type: 'LoadImage', inputs: { image: 'input.png' } },
    '10': { class_type: 'CreateVideo', inputs: { fps: 24 } },
    '11': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/old' } },
  },
};

const h3Entry = {
  id: 'MiniMax H3/01',
  family: 'minimax-h3',
  prompt: {
    '1': { class_type: 'MiniMaxH3LoaderSafetensorsBlockMultiGPU', inputs: { compute_device: 'cuda:0' } },
    '2': { class_type: 'H3MultishotSampler', inputs: { model: ['1', 0], script: 'old', seed: 1, width: 1344, height: 768, frames_per_shot: 243 } },
    '3': { class_type: 'CreateVideo', inputs: { images: ['2', 0], fps: 24 } },
    '4': { class_type: 'SaveVideo', inputs: { video: ['3', 0], filename_prefix: 'video/old' } },
  },
};

test('materializes an LTX 2.5 two-stage prompt with aligned output dimensions', () => {
  const built = materializeWorkflow(ltxEntry, {
    prompt: 'new prompt',
    negativePrompt: 'new negative',
    seed: 100,
    width: 1280,
    height: 720,
    frames: 241,
    fps: 25,
    firstImage: 'first.png',
    filenamePrefix: 'video/new',
  });
  assert.equal(built.prompt['1'].inputs.text, 'new prompt');
  assert.equal(built.prompt['2'].inputs.text, 'new negative');
  assert.equal(built.prompt['3'].inputs.noise_seed, 100);
  assert.equal(built.prompt['4'].inputs.noise_seed, 101);
  assert.equal(built.prompt['5'].inputs.width, 640);
  assert.equal(built.prompt['5'].inputs.height, 352);
  assert.equal(built.prompt['5'].inputs.length, 241);
  assert.equal(built.prompt['6'].inputs.frames_number, 241);
  assert.equal(built.prompt['10'].inputs.fps, 25);
  assert.equal(built.prompt['9'].inputs.image, 'first.png');
  assert.equal(built.prompt['11'].inputs.filename_prefix, 'video/new');
  assert.equal(built.ready_to_queue, true);
  assert.ok(built.warnings.some(message => message.includes('height 720')));
});

test('rejects invalid LTX frame counts', () => {
  assert.throws(() => materializeWorkflow(ltxEntry, { frames: 120 }), /8n\+1/);
});

test('materializes MiniMax H3 without changing CUDA placement', () => {
  const built = materializeWorkflow(h3Entry, {
    script: 'three shots',
    seed: 55,
    width: 1000,
    height: 550,
    frames: 362,
    fps: 24,
    filenamePrefix: 'video/h3/new',
  });
  assert.equal(built.prompt['1'].inputs.compute_device, 'cuda:0');
  assert.equal(built.prompt['2'].inputs.script, 'three shots');
  assert.equal(built.prompt['2'].inputs.seed, 55);
  assert.equal(built.prompt['2'].inputs.width, 992);
  assert.equal(built.prompt['2'].inputs.height, 544);
  assert.equal(built.prompt['2'].inputs.frames_per_shot, 362);
  assert.equal(built.prompt['4'].inputs.filename_prefix, 'video/h3/new');
});

test('applies exact JSON Pointer patches and blocks prototype pollution', () => {
  const patched = applyJsonPointerPatches({ '1': { inputs: { value: 1 } } }, [
    { op: 'replace', path: '/1/inputs/value', value: 2 },
    { op: 'add', path: '/1/inputs/name', value: 'ok' },
  ]);
  assert.equal(patched.document['1'].inputs.value, 2);
  assert.equal(patched.document['1'].inputs.name, 'ok');
  assert.throws(
    () => applyJsonPointerPatches({}, [{ op: 'add', path: '/__proto__/polluted', value: true }]),
    /forbidden segment/,
  );
});
