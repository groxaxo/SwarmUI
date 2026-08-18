import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkflowCatalog, validatePromptReferences } from '../src/catalog.js';

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'swarmui-workflow-catalog-'));
  const ltxDir = path.join(root, 'LTX 2.5');
  const h3Dir = path.join(root, 'MiniMax H3', 'Story');
  await mkdir(ltxDir, { recursive: true });
  await mkdir(h3Dir, { recursive: true });
  await writeFile(path.join(ltxDir, 'Core.json'), JSON.stringify({
    workflow: null,
    prompt: {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: 'ltx-2.5-model.safetensors' } },
      '2': { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
      '3': { class_type: 'SaveVideo', inputs: { video: ['2', 0], filename_prefix: 'video/ltx' } },
    },
    description: 'LTX 2.5 test',
  }));
  await writeFile(path.join(h3Dir, 'Template.json'), JSON.stringify({
    workflow: null,
    prompt: {
      '1': { class_type: 'MiniMaxH3LoaderSafetensorsBlockMultiGPU', inputs: { compute_device: 'cuda:1' } },
      '2': { class_type: 'H3MultishotSampler', inputs: { model: ['1', 0], script: 'PIPELINE_REPLACES_THIS_PROMPT' } },
    },
  }));
  await writeFile(path.join(ltxDir, 'Descriptor.json.example'), JSON.stringify({ segments: [] }));
  return root;
}

test('catalog discovers .json workflows and ignores .json.example descriptors', async t => {
  const root = await fixtureRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalog = await WorkflowCatalog.load(root);
  assert.equal(catalog.entries.length, 2);
  assert.equal(catalog.get('LTX 2.5/Core').family, 'ltx-2.5');
  assert.equal(catalog.get('LTX 2.5/Core').readyToQueue, true);
  assert.equal(catalog.get('MiniMax H3/Story/Template').family, 'minimax-h3');
  assert.equal(catalog.get('MiniMax H3/Story/Template').readyToQueue, false);
  assert.deepEqual(catalog.get('MiniMax H3/Story/Template').devices, ['cuda:1']);
  assert.deepEqual(catalog.get('MiniMax H3/Story/Template').placeholders, ['PIPELINE_REPLACES_THIS_PROMPT']);
});

test('prompt validator reports missing node references', () => {
  const errors = validatePromptReferences({
    '1': { class_type: 'SaveVideo', inputs: { video: ['99', 0] } },
  });
  assert.deepEqual(errors, ['1.video references missing node 99.']);
});
