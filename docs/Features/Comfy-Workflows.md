# Custom Comfy Workflows in SwarmUI

SwarmUI supports reusable ComfyUI workflows through the **Comfy Workflow** tab and the workflow browser. A saved workflow can contain an editable Comfy UI graph, an API-format prompt, Swarm-specific custom parameters, or a combination of those fields.

## Bundled example library

Built-in examples live under:

```text
src/BuiltinExtensions/ComfyUIBackend/ExampleWorkflows/
```

At startup SwarmUI scans that tree recursively. Every example `.json` that does not already have a corresponding user copy is copied to:

```text
src/BuiltinExtensions/ComfyUIBackend/CustomWorkflows/Examples/
```

This is deliberately **no-clobber** behaviour. Once an example has been copied into user state, later application updates do not silently replace the user's edited copy. If a user deletes a built-in example through SwarmUI, the `.deleted` marker also prevents it from being recreated automatically.

The standard install now includes three groups:

- **Basic SDXL** — the original editable SwarmUI/Comfy example.
- **MiniMax H3** — the five Ampere production API prompts plus three long-form story API templates from `groxaxo/minimax-h3`.
- **LTX 2.5** — the two canonical workflow-library entries selected by `groxaxo/ltx-2.5/scripts/install_workflow_library.py`.

The source repositories are private operational repositories, so SwarmUI vendors pinned snapshots. A normal install or Docker build therefore does **not** need GitHub credentials or network access to those repositories at runtime.

## Workflow JSON shapes

SwarmUI custom-workflow files may contain these top-level fields:

| Field | Purpose |
| --- | --- |
| `workflow` | Editable Comfy UI graph shown in the embedded Comfy editor. |
| `prompt` | ComfyUI API-format prompt/object used for direct generation. |
| `custom_params` | Additional workflow-specific data or Swarm parameter definitions. |
| `param_values` | Persisted values for linked parameters. |
| `image` | Optional workflow-browser preview image. |
| `description` | Human-readable workflow description. |
| `enable_in_simple` | Whether the workflow is exposed in Simple mode. |

A workflow does not have to use every field. Preserving the source format is more important than forcing all workflows into the same shape.

## MiniMax H3 defaults

The MiniMax H3 source snapshot is pinned to commit:

```text
aad0f45d5848297ef5569392c6f930f628ec3d65
```

The bundled set is:

1. `00 Calibrate Ampere Native 1MP One Shot API`
2. `01 Ampere Native 1MP Max Quality Speed API` — recommended production preset
3. `02 Ampere Native 1MP Aggressive Throughput API`
4. `03 Ampere 960x544 Max Throughput API`
5. `04 Ampere Native 1MP INT8 Video VAE Headroom API`
6. `Story/05 Longform FL2VA Chain Template API`
7. `Story/06 Longform Ref2VA Chain Template API`
8. `Story/07 Single Atom FLFA INT8 API`

These source files are API-format Comfy prompts, so the SwarmUI wrappers store the upstream object under `prompt` and leave `workflow` null. They require the MiniMax H3 custom nodes and exact model names referenced by the prompt.

The Ampere presets explicitly target `cuda:0`, `cuda:1`, and `cuda:2`. They are designed for a three-GPU RTX 3090 topology and do not automatically remap themselves to another layout.

The story templates contain `PIPELINE_REPLACES_*` placeholders. They are templates for the long-form pipeline and should not be queued unchanged.

MiniMax H3's `workflows/optional/` tree remains opt-in. Those integrations intentionally have extra external custom-node dependencies and separate licensing/release cadence.

See `ExampleWorkflows/MiniMax H3/README.md` for source-path provenance and update rules.

## LTX 2.5 defaults

The LTX source snapshot is pinned to commit:

```text
0c60382b4d9d79a7b7abc2505e9f6c4a3c6f9879
```

The LTX repository's workflow-library installer designates exactly two canonical entries:

### LTX 2.5 Official Rolling Segment Core

Source:

```text
templates/video_ltx2_5_i2v.json
```

This is an editable Comfy UI graph for one image-to-video rolling segment. Replace the bundled demo first frame and install the LTX model files named by the graph before queueing it.

### LTX 2.5 Standard 15s Three Prompt Rolling Chain

Source:

```text
examples/ltx25-standard-15s-three-prompt-chain.json
```

This is a **story-chain specification**, not a single Comfy graph. SwarmUI therefore preserves it under `custom_params`. Replace the absolute input-frame placeholder and the three prompt placeholders, then feed the specification to the LTX rolling-chain tooling.

See `ExampleWorkflows/LTX 2.5/README.md` for provenance and maintenance rules.

## Using an editable workflow

1. Open **Comfy Workflow**.
2. Click **Browse Workflows**.
3. Select a workflow that has an editable `workflow` graph, such as Basic SDXL or the LTX rolling-segment core.
4. Resolve any missing model or input-image references.
5. Edit and queue it directly, or click **Use This Workflow In Generate Tab** to expose it through SwarmUI generation controls.
6. Use **Save Workflow** if you want a user-owned variant.

## Using API-format workflows

API-format examples such as the bundled MiniMax H3 presets are primarily intended for direct generation/automation. They may not have a visual graph because the upstream source is already the compiled Comfy prompt object.

Before queueing one:

- verify every `class_type` exists in the active Comfy backend;
- verify every referenced model is present;
- check explicit CUDA device assignments;
- replace pipeline placeholders when present;
- review output paths and video settings.

## Multi-backend and multi-GPU considerations

SwarmUI's **MultiGPU** control can split ordinary workflow output branches across backends. That is different from a workflow whose nodes explicitly address `cuda:0`, `cuda:1`, and `cuda:2` internally.

For the bundled MiniMax H3 Ampere presets, the workflow itself owns the three-device placement. Run them against a Comfy process that can see all three intended GPUs. Do not combine that internal placement with one-backend-per-GPU scheduling unless you intentionally rewrite the workflow topology.

For ordinary workflows, one Comfy self-start backend per GPU remains the predictable throughput configuration described in [ComfyUI Compatibility](../ComfyUI%20Compatibility.md).

## Docker behaviour

The Standard Docker image copies the repository source into `/SwarmUI`, so bundled `ExampleWorkflows` are already inside the image. They do not need a private-repository clone or a separate workflow volume.

The example Compose file mounts `CustomWorkflows` as persistent user state. On first start, SwarmUI copies any missing bundled examples into that mount. Existing edited examples are not overwritten on container rebuilds.

The Compose example also exposes all requested NVIDIA GPUs through the `SWARM_GPU_COUNT` variable, defaulting to `3` for the bundled MiniMax H3 Ampere presets. Set it to another number if your host topology differs.

## Updating bundled workflows

Bundled workflow updates should be provenance-bound:

1. Pin the upstream commit SHA.
2. Identify the upstream canonical workflow set before copying files.
3. Preserve the source JSON semantics inside the Swarm wrapper.
4. Update source commit/path information in each bundled description and README.
5. Validate every resulting JSON document parses.
6. Verify a fresh Swarm user state receives the new examples.
7. Verify an existing modified/deleted example is not overwritten or resurrected.
8. For Docker, rebuild the Standard image and verify the examples populate the persistent `CustomWorkflows` mount.

Do not edit `CustomWorkflows/Examples` in the repository to update defaults. That directory is user state; defaults belong only in `ExampleWorkflows`.
