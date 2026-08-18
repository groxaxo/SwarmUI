# SwarmUI Workflow MCP Server

A repository-local MCP server for the workflows bundled with SwarmUI:

- **LTX 2.5** image-to-video with synchronized audio and two-stage latent upscaling.
- **MiniMax H3** Ampere presets and long-form FL2VA, Ref2VA, and FLFA workflow atoms.

The server uses the current MCP TypeScript SDK over stdio. It is read-only by default and never rewrites the workflow files.

## Requirements

- Node.js 20 or newer.
- SwarmUI checked out with the bundled workflow directory present.
- A ComfyUI endpoint only when using remote validation, queue, history, or cancellation tools.

## Install

```bash
cd integrations/workflow-mcp
npm install
npm test
```

The project client configurations start `src/index.js` automatically after dependencies are installed.

## Tools

| Tool | Effect |
| --- | --- |
| `list_workflows` | Search and filter the bundled catalog. |
| `inspect_workflow` | Read models, node types, CUDA devices, placeholders, hashes, and readiness. |
| `get_workflow` | Read metadata, wrapper, API prompt, or UI graph. |
| `materialize_workflow` | Clone a prompt and apply high-level overrides or exact JSON Pointer patches. |
| `validate_workflow` | Validate references/placeholders locally and optionally compare node classes with `/object_info`. |
| `get_backend_status` | Read `/system_stats` from the configured backend. |
| `get_queue` | Read the ComfyUI queue. |
| `get_history` | Read all history or one prompt. |
| `queue_workflow` | Submit a validated bundled workflow; write-gated. |
| `cancel_workflow` | Delete/interrupt a prompt and optionally delete history; write-gated. |
| `server_capabilities` | Report paths, families, endpoint state, and write policy. |

The server also exposes a workflow catalog resource, one resource per workflow, and the `prepare-video-workflow` MCP prompt.

## Environment

| Variable | Purpose |
| --- | --- |
| `SWARMUI_REPO_ROOT` | Explicit SwarmUI repository root. Usually set by each project client config. |
| `SWARMUI_WORKFLOW_ROOT` | Optional override for the bundled workflow directory. |
| `SWARMUI_MCP_COMFY_URL` | Direct Comfy URL, such as `http://127.0.0.1:8188`, or Swarm proxy URL such as `http://127.0.0.1:7801/ComfyBackendDirect`. |
| `SWARMUI_MCP_HEADERS_JSON` | Optional JSON object of local authentication/proxy headers. Never commit secrets here. |
| `SWARMUI_MCP_BACKEND_ID` | Optional SwarmUI backend ID, sent as `X-Swarm-Backend-ID`. |
| `SWARMUI_MCP_TIMEOUT_MS` | HTTP timeout, 1–900000 ms. Default: 30000. |
| `SWARMUI_MCP_ALLOW_WRITES` | Must equal `true` before queue/cancel tools can write. Default client configs set `false`. |

Queue and cancel calls still require `confirm=true` even when the write environment gate is enabled.

## Examples

List ready LTX workflows:

```json
{
  "family": "ltx-2.5",
  "ready": true
}
```

Materialize an LTX 2.5 clip:

```json
{
  "workflowId": "LTX 2.5/LTX 2.5 Official Rolling Segment Core",
  "prompt": "A controlled cinematic push-in across a windswept rooftop...",
  "negativePrompt": "watermark, subtitles, duplicated subject, broken anatomy",
  "firstImage": "rooftop-start.png",
  "seed": 250001,
  "width": 1344,
  "height": 768,
  "frames": 121,
  "fps": 24,
  "filenamePrefix": "video/ltx-2.5/rooftop"
}
```

Materialize the recommended H3 preset without changing its three-GPU placement:

```json
{
  "workflowId": "MiniMax H3/01 Ampere Native 1MP Max Quality Speed API",
  "script": "SHOT ONE...\n---\nSHOT TWO...\n---\nSHOT THREE...",
  "seed": 157987240705331,
  "filenamePrefix": "video/minimax-h3/campaign"
}
```

For exact node edits, add patches after the high-level overrides:

```json
{
  "workflowId": "MiniMax H3/01 Ampere Native 1MP Max Quality Speed API",
  "patches": [
    {
      "op": "replace",
      "path": "/5/inputs/preview_first_shot",
      "value": true
    }
  ]
}
```

## Safety model

- Workflow IDs resolve only from the recursively scanned bundled catalog; tools do not accept arbitrary file paths.
- Symlinks are not followed while scanning.
- JSON Pointer patches reject prototype-pollution segments and excessive depth/count.
- Comfy endpoints are process configuration, never tool arguments, reducing model-controlled SSRF exposure.
- Story placeholders block queueing until replaced.
- LTX customisation is restricted to the LTX 2.5 family; no LTX 2.3 compatibility path exists.
- MiniMax H3 CUDA placement remains unchanged unless an explicit JSON Pointer patch changes it.

## Validation

```bash
node --check src/index.js
npm test
python3 ../../launchtools/validate-workflow-mcp-integration.py
```

The Python validator does not require npm dependencies or a running backend. A live MCP/Comfy smoke test still requires `npm install` and a configured endpoint.
