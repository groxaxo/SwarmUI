# MiniMax H3 bundled workflows

These files are pinned snapshots from `groxaxo/minimax-h3` commit `aad0f45d5848297ef5569392c6f930f628ec3d65`.

SwarmUI copies example `.json` files into `CustomWorkflows/Examples` only when a corresponding user copy does not already exist. Repository updates therefore add defaults without overwriting a workflow a user has edited or explicitly deleted.

## Included presets

| SwarmUI file | Upstream source | Purpose |
| --- | --- | --- |
| `00 Calibrate Ampere Native 1MP One Shot API.json` | `workflows/00-calibrate-ampere-native1mp-one-shot-api.json` | First-run shape/VRAM calibration on 3× RTX 3090. |
| `01 Ampere Native 1MP Max Quality Speed API.json` | `workflows/01-ampere-native1mp-max-quality-speed-api.json` | Recommended native-1MP quality/speed preset. |
| `02 Ampere Native 1MP Aggressive Throughput API.json` | `workflows/02-ampere-native1mp-aggressive-throughput-api.json` | Higher-residency preset after calibration proves headroom. |
| `03 Ampere 960x544 Max Throughput API.json` | `workflows/03-ampere-960x544-max-throughput-api.json` | Lower-resolution single-pass maximum throughput. |
| `04 Ampere Native 1MP INT8 Video VAE Headroom API.json` | `workflows/04-ampere-native1mp-int8-video-vae-headroom-api.json` | Native-1MP preset with INT8 ConvRot video VAE. |
| `Story/05 Longform FL2VA Chain Template API.json` | `workflows/story/05-longform-fl2va-chain-template-api.json` | FL2VA long-form story atom. |
| `Story/06 Longform Ref2VA Chain Template API.json` | `workflows/story/06-longform-ref2va-chain-template-api.json` | Ref2VA long-form story atom. |
| `Story/07 Single Atom FLFA INT8 API.json` | `workflows/story/07-single-atom-flfa-int8-api.json` | First/last-frame constrained story atom. |

## Native editable import

The upstream files are canonical ComfyUI API-format prompts, preserved under `prompt`. Their `workflow` field remains null rather than storing a second, potentially drifting graph representation.

When selected in **Browse Workflows**, SwarmUI now calls the embedded Comfy frontend's `app.loadApiJson()` method. Comfy creates the real editable nodes, widgets, named connections, and missing-node placeholders directly from the canonical prompt.

The Ampere presets deliberately address `cuda:0`, `cuda:1`, and `cuda:2`; they target the three-GPU RTX 3090 topology and do not automatically remap. The `Story` templates contain `PIPELINE_REPLACES_*` placeholders and must not be queued unchanged.

Optional integrations under upstream `workflows/optional/` remain opt-in because they have additional custom-node dependencies and separate release/licensing cadence.

## Updating

1. Pin the new `groxaxo/minimax-h3` commit.
2. Compare all five top-level workflows plus the three story workflows.
3. Preserve the upstream API prompt semantically under `prompt`.
4. Verify SwarmUI's native API-import fallback remains active.
5. Run `python3 launchtools/validate-bundled-comfy-workflows.py`.
6. Never overwrite user state under `CustomWorkflows/Examples`.
