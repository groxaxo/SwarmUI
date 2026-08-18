---
name: swarmui-video-workflows
description: Inspect, customize, validate, queue, monitor, and cancel the bundled SwarmUI LTX 2.5 and MiniMax H3 ComfyUI workflows through the swarmui-workflows MCP server.
---

# SwarmUI video workflows

Use the `swarmui-workflows` MCP server whenever the user asks to inspect, prepare, adapt, run, monitor, or troubleshoot a bundled LTX or MiniMax video workflow.

## Required operating sequence

1. Call `server_capabilities` when endpoint or write state is unclear.
2. Call `list_workflows` with the requested family.
3. Call `inspect_workflow` before selecting a workflow. Report required models, custom node classes, CUDA devices, placeholders, and queue readiness.
4. Call `materialize_workflow` with the smallest set of high-level overrides. Use `patches` only for a node input that has no high-level option.
5. Call `validate_workflow`. Use `remote=true` when a Comfy endpoint is configured and runtime compatibility matters.
6. Queue only when the user explicitly requested execution, validation passes, and `ready_to_queue` is true.
7. Record the returned prompt ID, then use `get_queue` and `get_history` for status and output evidence.
8. Use `cancel_workflow` only on explicit cancellation intent.

## Family rules

### LTX

- Use **LTX 2.5 only**. Never substitute LTX 2.3, old LTX-AV checkpoints, Gemma 3 payloads, or legacy workflow metadata.
- Prefer `LTX 2.5/LTX 2.5 Official Rolling Segment Core` for local image-to-video.
- Supply `firstImage`, prompt, seed, dimensions, frames, FPS, and output prefix explicitly for production runs.
- LTX frame count must be `8n+1`; use 121, 241, or 361 unless the user requires another valid count.
- The two-stage graph aligns final dimensions to a safe x2 latent-upscale geometry. Surface any alignment warning.
- The `.story.json.example` file is an orchestration descriptor, not a queueable Comfy graph.

### MiniMax H3

- Start with `00 Calibrate...` on a new hardware/runtime combination.
- Prefer `01 Ampere Native 1MP Max Quality Speed API` after calibration on the three-RTX-3090 host.
- Preserve the bundled `cuda:0`, `cuda:1`, and `cuda:2` allocation unless the user explicitly requests a topology change.
- `02` is aggressive and should follow demonstrated VRAM headroom; `03` prioritizes throughput; `04` uses the INT8 video VAE.
- Story workflows contain `PIPELINE_REPLACES_*` placeholders and must never be queued unchanged.
- For FLFA, supply both `firstImage` and `finalImage`.

## Write policy

Read tools are the default. `queue_workflow` and `cancel_workflow` require both:

- local `SWARMUI_MCP_ALLOW_WRITES=true`; and
- `confirm=true` in the tool call.

Do not request or embed secrets in repository files. Authentication headers belong in the user's local `SWARMUI_MCP_HEADERS_JSON` environment setting.

## Exact edits

JSON Pointer patches target the materialized Comfy API prompt, for example:

```json
{
  "op": "replace",
  "path": "/5/inputs/preview_first_shot",
  "value": true
}
```

Always inspect the prompt before constructing a pointer. Never patch `__proto__`, `prototype`, or `constructor`; the server rejects them.

## Failure handling

- Missing node classes: report the exact `remote.missing_node_classes`; do not guess that the backend supports them.
- Missing models: report the filenames from `inspect_workflow` and the expected Comfy model folders.
- Unresolved placeholders: replace them through high-level inputs or exact patches, then revalidate.
- Endpoint unavailable: keep the workflow materialized locally and report that no queue action occurred.
- OOM on H3: step back from `02` to `01`, then `03`; do not silently rearrange GPU placement.
- OOM on LTX 2.5: reduce final dimensions or frame count while keeping the two-stage graph and LTX 2.5 model family.
