import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ComfyClient,
  normalizeQueueResponse,
  requireWriteConfirmation,
  writesEnabled,
} from '../src/comfy-client.js';

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

const cleanClientEnvironment = {
  SWARMUI_MCP_HEADERS_JSON: undefined,
  SWARMUI_MCP_BACKEND_ID: undefined,
  SWARMUI_MCP_TIMEOUT_MS: undefined,
};

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
    ...cleanClientEnvironment,
    SWARMUI_MCP_COMFY_URL: 'http://127.0.0.1:8188',
    SWARMUI_MCP_HEADERS_JSON: '{"X-Test":"ok"}',
    SWARMUI_MCP_BACKEND_ID: '2',
  }, () => {
    const client = new ComfyClient();
    assert.equal(client.baseUrl.href, 'http://127.0.0.1:8188/');
    assert.equal(client.headers['X-Test'], 'ok');
    assert.equal(client.headers['X-Swarm-Backend-ID'], '2');
  });
  withEnvironment({
    ...cleanClientEnvironment,
    SWARMUI_MCP_COMFY_URL: 'file:///tmp/comfy',
  }, () => {
    assert.throws(() => new ComfyClient(), /http or https/);
  });
  withEnvironment({
    ...cleanClientEnvironment,
    SWARMUI_MCP_COMFY_URL: 'http://user:pass@127.0.0.1:8188',
  }, () => {
    assert.throws(() => new ComfyClient(), /must not be embedded/);
  });
});

test('queue responses require a real prompt id and no node errors', () => {
  const accepted = normalizeQueueResponse({
    prompt_id: 'prompt-123',
    number: 7,
    node_errors: {},
  }, 'client-123');
  assert.deepEqual(accepted, {
    client_id: 'client-123',
    prompt_id: 'prompt-123',
    number: 7,
    node_errors: {},
    response: {
      prompt_id: 'prompt-123',
      number: 7,
      node_errors: {},
    },
  });

  assert.throws(
    () => normalizeQueueResponse({
      prompt_id: 'prompt-123',
      node_errors: { '5': { errors: [{ message: 'invalid model' }] } },
    }, 'client-123'),
    /node errors/i,
  );
  assert.throws(
    () => normalizeQueueResponse({ number: 7, node_errors: {} }, 'client-123'),
    /no prompt_id/i,
  );
  assert.throws(
    () => normalizeQueueResponse('not-json', 'client-123'),
    /invalid prompt response/i,
  );
});
