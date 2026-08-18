# Workflow MCP server and coding-client skill

SwarmUI includes a repository-local MCP server for inspecting and operating the bundled **LTX 2.5** and **MiniMax H3** ComfyUI workflows from coding clients.

Supported project clients:

- OpenCode
- OpenAI Codex
- Claude Code
- OMP / oh-my-pi

All clients start the same stdio server at `integrations/workflow-mcp/src/index.js`. The shared skill is canonical under `.agents/skills/swarmui-video-workflows`; an identical Claude-compatible copy is committed under `.claude/skills/swarmui-video-workflows` and validated against the canonical file so the instructions cannot drift unnoticed.

## What the server does

The server recursively discovers `*.json` entries under:

```text
src/BuiltinExtensions/ComfyUIBackend/ExampleWorkflows/
```

It supports Swarm wrappers, raw Comfy API prompts, and UI workflow graphs. For every entry it reports:

- workflow family and stable ID;
- API/UI representations;
- node classes;
- model filenames;
- explicit CUDA device placement;
- placeholder tokens;
- local graph-reference errors;
- content SHA-256;
- queue and readiness state.

The server never scans arbitrary client-supplied paths. Symlinks are ignored during catalog traversal.

## Install dependencies

From the repository root:

```bash
cd integrations/workflow-mcp
npm install
npm test
```

Node.js 20 or newer is required. The server uses the MCP TypeScript SDK v2 and Zod v4.

## Client discovery

| Client | MCP config | Skill discovery |
| --- | --- | --- |
| OpenCode | `opencode.json` | `.agents/skills/swarmui-video-workflows/SKILL.md` |
| Codex | `.codex/config.toml` | `.agents/skills/swarmui-video-workflows/SKILL.md` |
| Claude Code | `.mcp.json` | `.claude/skills/swarmui-video-workflows/SKILL.md` |
| OMP | `.omp/mcp.json` | `.agents/skills/swarmui-video-workflows/SKILL.md` |

Restart the coding client after `npm install` so it starts the new MCP server. Each committed config is enabled but read-only by default. Claude Code's project config uses `bash` plus `git rev-parse --show-toplevel` so the server starts correctly even when Claude is launched from a repository subdirectory; native Windows users should run it through WSL or replace that command in their local configuration.

## Tool sequence

The normal workflow is:

1. `server_capabilities`
2. `list_workflows`
3. `inspect_workflow`
4. `materialize_workflow`
5. `validate_workflow`
6. `queue_workflow` only after explicit execution intent
7. `get_queue` and `get_history`
8. `cancel_workflow` only after explicit cancellation intent

The server also exposes:

- `get_workflow`
- `get_backend_status`
- catalog and per-workflow resources
- `prepare-video-workflow` MCP prompt

## Configuring a backend

The catalog and materialization tools need no running backend. Remote validation, status, queue, history, execution, and cancellation use a local environment variable:

```bash
export SWARMUI_MCP_COMFY_URL=http://127.0.0.1:8188
```

To route through SwarmUI instead:

```bash
export SWARMUI_MCP_COMFY_URL=http://127.0.0.1:7801/ComfyBackendDirect
```

The SwarmUI direct proxy requires an authenticated user with Comfy direct-call permission. Optional local configuration:

```bash
export SWARMUI_MCP_BACKEND_ID=0
export SWARMUI_MCP_HEADERS_JSON='{"Cookie":"your-local-session-cookie"}'
```

Never commit authentication data. Put local overrides in the client's user configuration or shell environment.

## Enabling queue and cancel writes

All committed client configs contain:

```text
SWARMUI_MCP_ALLOW_WRITES=false
```

To enable execution locally, change that environment value to `true` in the selected client's uncommitted or user-level configuration, then restart the client. The two write tools additionally require `confirm=true` per call.

This is intentionally a double gate:

- the repository cannot silently enable generation or cancellation;
- the model cannot queue or cancel without an explicit confirmed tool call.

Codex also configures `queue_workflow` and `cancel_workflow` for prompt-level approval.

## LTX 2.5 policy

The MCP server treats LTX as **LTX 2.5 only**:

- LTX 2.5 distilled transformer;
- projected Gemma 4 text encoder;
- LTX 2.5 video and audio VAEs;
- official two-stage sigma schedules;
- latent x2 upscaler;
- tiled video decode and synchronized audio.

There is no LTX 2.3 compatibility path. LTX frame counts must be `8n+1`; common values are 121, 241, and 361. For the two-stage workflow, dimensions are aligned to a safe latent-upscale geometry and any alignment is returned as a warning.

## MiniMax H3 policy

The five Ampere presets and three story atoms remain canonical API prompts. High-level materialization updates prompts, seeds, dimensions, frame count, FPS, input frames, and output prefix without changing internal model or CUDA placement.

On the intended three-RTX-3090 system:

- calibrate with workflow `00` first;
- prefer workflow `01` for quality/speed;
- use workflow `02` only after demonstrated VRAM headroom;
- use workflow `03` for maximum throughput;
- use workflow `04` for the INT8 video VAE option.

The bundled `cuda:0`, `cuda:1`, and `cuda:2` topology is preserved unless an exact JSON Pointer patch explicitly changes it. Story templates with `PIPELINE_REPLACES_*` tokens are never considered ready to queue.

## Exact node patches

High-level options are preferred. For an unexposed input, use a bounded JSON Pointer patch:

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

Patches are applied to a cloned prompt after high-level overrides. The server rejects path traversal through `__proto__`, `prototype`, or `constructor`, limits patch count/depth, and never writes the result back to the repository.

## Validation

Offline project validation:

```bash
python3 launchtools/validate-workflow-mcp-integration.py
```

Server core tests:

```bash
cd integrations/workflow-mcp
node --test
```

After dependencies are installed:

```bash
node --check src/index.js
npm test
```

A live acceptance test should additionally configure `SWARMUI_MCP_COMFY_URL`, call `get_backend_status`, run `validate_workflow` with `remote=true`, and—only when intended—queue one small test job and verify its history.

## Troubleshooting

**Server fails during startup**  
Run `npm install` inside `integrations/workflow-mcp` and confirm Node.js 20+.

**No workflows found**  
Start the client from the SwarmUI repository, or set `SWARMUI_REPO_ROOT`/`SWARMUI_WORKFLOW_ROOT` to the correct absolute path.

**Remote validation reports missing nodes**  
Install or update the required custom-node package. Use the exact `missing_node_classes` result; do not infer compatibility from a similar node name.

**Queue tool says writes are disabled**  
Enable `SWARMUI_MCP_ALLOW_WRITES=true` locally and restart the client. Do not commit that change.

**H3 out of memory**  
Return from aggressive workflow `02` to `01`, then use `03` or reduce dimensions/frame count. Do not silently rearrange the three-GPU allocation.

**LTX out of memory**  
Reduce dimensions or valid frame count while preserving the LTX 2.5 two-stage model family.
