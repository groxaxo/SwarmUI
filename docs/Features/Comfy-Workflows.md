# Custom Comfy Workflows in SwarmUI

SwarmUI supports reusable ComfyUI workflows through the **Comfy Workflow** tab and workflow browser. Entries may contain an editable UI graph, an API-format prompt, or both.

## Bundled library

Defaults live under:

```text
src/BuiltinExtensions/ComfyUIBackend/ExampleWorkflows/
```

At startup, missing `*.json` examples are copied recursively to `CustomWorkflows/Examples/`. Existing user copies and `.deleted` markers are never overwritten.

The bundled groups are:

- **Basic SDXL** — the original editable example.
- **MiniMax H3** — five Ampere presets plus three long-form story atoms from `groxaxo/minimax-h3`.
- **LTX 2.5** — one complete queueable I2V API workflow plus a scanner-excluded three-segment orchestration descriptor from `groxaxo/ltx-2.5`.

Pinned snapshots avoid private-repository credentials or network access at runtime.

## Workflow fields

| Field | Purpose |
| --- | --- |
| `workflow` | Editable Comfy UI graph. |
| `prompt` | ComfyUI API-format prompt. |
| `custom_params` | Additional workflow-specific data. |
| `param_values` | Persisted linked values. |
| `image` | Optional browser preview. |
| `description` | Provenance and usage notes. |
| `enable_in_simple` | Simple-mode exposure. |

## Native API-prompt import

When `workflow` is absent or null but `prompt` is available, the workflow browser calls the embedded Comfy frontend's native:

```javascript
app.loadApiJson(prompt, name)
```

ComfyUI creates the visual nodes from the API object, applies named widget values, connects inputs by name, arranges the graph, and represents unavailable custom nodes with explicit placeholders. This keeps the canonical API prompt as the single source of truth while still providing an editable canvas.

## MiniMax H3 defaults

Pinned source commit:

```text
aad0f45d5848297ef5569392c6f930f628ec3d65
```

Included entries:

1. `00 Calibrate Ampere Native 1MP One Shot API`
2. `01 Ampere Native 1MP Max Quality Speed API`
3. `02 Ampere Native 1MP Aggressive Throughput API`
4. `03 Ampere 960x544 Max Throughput API`
5. `04 Ampere Native 1MP INT8 Video VAE Headroom API`
6. `Story/05 Longform FL2VA Chain Template API`
7. `Story/06 Longform Ref2VA Chain Template API`
8. `Story/07 Single Atom FLFA INT8 API`

The API prompts explicitly target `cuda:0`, `cuda:1`, and `cuda:2`. Run them in a Comfy process that can see the intended three RTX 3090 GPUs. Replace all `PIPELINE_REPLACES_*` placeholders in story templates before queueing.

## LTX 2.5 defaults

Pinned source commit:

```text
0c60382b4d9d79a7b7abc2505e9f6c4a3c6f9879
```

`LTX 2.5 Official Rolling Segment Core.json` contains a complete two-stage I2V API graph using:

- the LTX 2.5 distilled transformer;
- the projected Gemma 4 encoder;
- LTX 2.5 video and audio VAEs;
- official stage-one and stage-two sigma schedules;
- latent x2 upscaling;
- tiled video decode, synchronized audio, and MP4 output.

The bundled graph contains no legacy LTX-AV checkpoint or Gemma 3 runtime payload.

`LTX 2.5 Standard 15s Three Prompt Rolling Chain.story.json.example` is an orchestration descriptor, not a Comfy graph. Its suffix prevents SwarmUI's `*.json` scanner from treating it as a workflow.

## Usage

1. Open **Comfy Workflow**.
2. Click **Browse Workflows**.
3. Select LTX 2.5 or a MiniMax H3 preset.
4. Let ComfyUI import the API prompt into an editable canvas.
5. Resolve missing models or custom nodes.
6. Inspect CUDA assignments and replace placeholders.
7. Queue directly or use **Use This Workflow In Generate Tab**.

## Multi-GPU and Docker

SwarmUI's MultiGPU control distributes ordinary graph branches across backends. MiniMax H3's Ampere presets instead own internal `cuda:0`/`cuda:1`/`cuda:2` placement; do not combine those modes without rewriting topology.

The Standard Docker image already contains `ExampleWorkflows`. The Compose example persists `CustomWorkflows`, and `SWARM_GPU_COUNT` defaults to `3`.

## Validation

Run locally:

```bash
python3 launchtools/validate-bundled-comfy-workflows.py
```

The validator checks API dependencies, required LTX 2.5 assets and topology, absence of legacy LTX runtime markers, all eight H3 workflows, story placeholders, the scanner-excluded LTX descriptor, and activation of the native API-import fallback.

Defaults belong only in `ExampleWorkflows`, never in user state under `CustomWorkflows/Examples`.
