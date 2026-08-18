import assert from 'node:assert/strict';
import test from 'node:test';
import { ComfyClient, requireWriteConfirmation, writesEnabled } from '../src/comfy-client.js';

function withEnvironment(values, callback) {
  const prior = {};
  for (const [key, value] of Object.entries(values)) {
    prior[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    }
    else {
      process.env[key] = value;
    }
  }
  try {
    return callback();
  }
  finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) {
        delete process.env[key];
      }
      else {
        process.env[key] = value;
      }
    }
  }
}

test('writes require both the environment gate and explicit confirmation', () => {
  withEnvironment({ SWARMUI_MCP_ALLOW_WRITES: undefined }, () => {
    assert.equal(writesEnabled(), false);
    assert.throws(() => requireWriteConfirmation(true), /writes are disabled/i);
  });
  withEnvironment({ SWARMUI_MCP_ALLOW_WRITES: 'true' }, () => {
    assert.equal(writesEnabled(), true);
    assert.throws(() => requireWriteConfirmation(false), /confirm=true/);
    assert.doesNotThrow(() => requireWriteConfirmation(true));
  });
});

test('Comfy client accepts only configured HTTP endpoints without embedded credentials', () => {
  withEnvironment({
    SWARMUI_MCP_COMFY_URL: 'http://127.0.0.1:8188',
    SWARMUI_MCP_HEADERS_JSON: '{"X-Test":"ok"}',
    SWARMUI_MCP_BACKEND_ID: '2',
  }, () => {
    const client = new ComfyClient();
    assert.equal(client.baseUrl.href, 'http://127.0.0.1:8188/');
    assert.equal(client.headers['X-Test'], 'ok');
    assert.equal(client.headers['X-Swarm-Backend-ID'], '2');
  });
  withEnvironment({ SWARMUI_MCP_COMFY_URL: 'file:///tmp/comfy' }, () => {
    assert.throws(() => new ComfyClient(), /http or https/);
  });
  withEnvironment({ SWARMUI_MCP_COMFY_URL: 'http://user:pass@127.0.0.1:8188' }, () => {
    assert.throws(() => new ComfyClient(), /must not be embedded/);
  });
});
