import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 30_000;

function parseBoolean(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function parseHeaders() {
  const raw = process.env.SWARMUI_MCP_HEADERS_JSON?.trim();
  if (!raw) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch (error) {
    throw new Error(`SWARMUI_MCP_HEADERS_JSON is invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SWARMUI_MCP_HEADERS_JSON must be a JSON object.');
  }
  const headers = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`Header '${name}' must have a string value.`);
    }
    headers[name] = value;
  }
  return headers;
}

function endpointUrl() {
  const raw = process.env.SWARMUI_MCP_COMFY_URL?.trim();
  if (!raw) {
    throw new Error(
      'No ComfyUI endpoint is configured. Set SWARMUI_MCP_COMFY_URL, for example http://127.0.0.1:8188 or http://127.0.0.1:7801/ComfyBackendDirect.',
    );
  }
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SWARMUI_MCP_COMFY_URL must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Credentials must not be embedded in SWARMUI_MCP_COMFY_URL. Use SWARMUI_MCP_HEADERS_JSON.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  url.search = '';
  url.hash = '';
  return url;
}

function timeoutMs() {
  const raw = process.env.SWARMUI_MCP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 15 * 60_000) {
    throw new Error('SWARMUI_MCP_TIMEOUT_MS must be an integer from 1 to 900000.');
  }
  return parsed;
}

export function writesEnabled() {
  return parseBoolean(process.env.SWARMUI_MCP_ALLOW_WRITES);
}

export function requireWriteConfirmation(confirm) {
  if (!writesEnabled()) {
    throw new Error(
      'Workflow writes are disabled. Set SWARMUI_MCP_ALLOW_WRITES=true in the local client configuration, then restart the MCP server.',
    );
  }
  if (confirm !== true) {
    throw new Error('This write requires confirm=true after reviewing the materialized workflow.');
  }
}

export class ComfyClient {
  constructor() {
    this.baseUrl = endpointUrl();
    this.headers = parseHeaders();
    const backendId = process.env.SWARMUI_MCP_BACKEND_ID?.trim();
    if (backendId) {
      if (!/^\d+$/.test(backendId)) {
        throw new Error('SWARMUI_MCP_BACKEND_ID must be a non-negative integer.');
      }
      this.headers['X-Swarm-Backend-ID'] = backendId;
    }
    this.timeout = timeoutMs();
  }

  async request(route, { method = 'GET', body = undefined } = {}) {
    const relative = String(route).replace(/^\/+/, '');
    if (relative.includes('..')) {
      throw new Error(`Refusing unsafe ComfyUI route '${relative}'.`);
    }
    const url = new URL(relative, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...this.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        }
        catch {
          parsed = text;
        }
      }
      if (!response.ok) {
        throw new Error(
          `ComfyUI ${method} ${url.pathname} failed with ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
        );
      }
      return parsed;
    }
    catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`ComfyUI request timed out after ${this.timeout} ms: ${method} ${url.pathname}`);
      }
      throw error;
    }
    finally {
      clearTimeout(timer);
    }
  }

  systemStats() {
    return this.request('system_stats');
  }

  objectInfo() {
    return this.request('object_info');
  }

  queue() {
    return this.request('queue');
  }

  history(promptId = null) {
    return this.request(promptId ? `history/${encodeURIComponent(promptId)}` : 'history');
  }

  async queuePrompt(prompt, { clientId = null } = {}) {
    const effectiveClientId = clientId || `swarmui-workflow-mcp-${randomUUID()}`;
    const response = await this.request('prompt', {
      method: 'POST',
      body: { prompt, client_id: effectiveClientId },
    });
    return { client_id: effectiveClientId, response };
  }

  async cancelPrompt(promptId, { deleteHistory = true } = {}) {
    if (!promptId || typeof promptId !== 'string') {
      throw new Error('promptId must be a non-empty string.');
    }
    const before = await this.queue();
    const running = Array.isArray(before?.queue_running) ? before.queue_running : [];
    const pending = Array.isArray(before?.queue_pending) ? before.queue_pending : [];
    const idFromQueueEntry = entry => Array.isArray(entry) && entry.length > 1 ? String(entry[1]) : null;
    const isRunning = running.some(entry => idFromQueueEntry(entry) === promptId);
    const isPending = pending.some(entry => idFromQueueEntry(entry) === promptId);
    const actions = [];

    if (isPending) {
      await this.request('queue', { method: 'POST', body: { delete: [promptId] } });
      actions.push('deleted-pending');
    }
    if (isRunning) {
      await this.request('interrupt', { method: 'POST', body: {} });
      actions.push('interrupted-running');
    }
    if (deleteHistory) {
      await this.request('history', { method: 'POST', body: { delete: [promptId] } });
      actions.push('deleted-history');
    }

    return {
      prompt_id: promptId,
      found_running: isRunning,
      found_pending: isPending,
      actions,
      queue_after: await this.queue(),
    };
  }
}
