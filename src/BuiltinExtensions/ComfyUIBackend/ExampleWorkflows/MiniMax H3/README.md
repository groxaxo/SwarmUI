# MiniMax H3 bundled workflows

These files are vendored snapshots from `groxaxo/minimax-h3` at commit `aad0f45d5848297ef5569392c6f930f628ec3d65`.

SwarmUI copies example `.json` files into `CustomWorkflows/Examples` only when a corresponding user copy does not already exist. This means repository updates can add new defaults without overwriting a workflow that a user has edited or explicitly deleted.

## Included presets

| SwarmUI file | Upstream source | Purpose |
| --- | --- | --- |
| `00 Calibrate Ampere Native 1MP One Shot API.json` | `workflows/00-calibrate-ampere-native1mp-one-shot-api.json` | First-run shape/VRAM calibration on the 3× RTX 3090 Ampere layout. |
| `01 Ampere Native 1MP Max Quality Speed API.json` | `workflows/01-ampere-native1mp-max-quality-speed-api.json` | Recommended native-1MP quality/speed preset. |
| `02 Ampere Native 1MP Aggressive Throughput API.json` | `workflows/02-ampere-native1mp-aggressive-throughput-api.json` | Higher-residency preset to use only after calibration proves headroom. |
| `03 Ampere 960x544 Max Throughput API.json` | `workflows/03-ampere-960x544-max-throughput-api.json` | Lower-resolution single-pass maximum-throughput preset. |
| `04 Ampere Native 1MP INT8 Video VAE Headroom API.json` | `workflows/04-ampere-native1mp-int8-video-vae-headroom-api.json` | Native-1MP preset with INT8 ConvRot video VAE for extra VRAM headroom. |
| `Story/05 Longform FL2VA Chain Template API.json` | `workflows/story/05-longform-fl2va-chain-template-api.json` | FL2VA long-form story atom template. |
| `Story/06 Longform Ref2VA Chain Template API.json` | `workflows/story/06-longform-ref2va-chain-template-api.json` | Ref2VA long-form story atom template. |
| `Story/07 Single Atom FLFA INT8 API.json` | `workflows/story/07-single-atom-flfa-int8-api.json` | First/last-frame constrained story atom. |

## Format and requirements

The upstream MiniMax H3 workflows are ComfyUI **API-format prompts**, not editable Comfy UI graphs. The SwarmUI wrapper stores the exact prompt under `prompt` and leaves `workflow` null. They are intended for direct generation/automation use and require the MiniMax H3 node stack and the model filenames referenced by each prompt.

The Ampere presets deliberately refer to `cuda:0`, `cuda:1`, and `cuda:2`. They are specifically designed for the three-GPU configuration documented by the MiniMax H3 project; do not expect them to remap automatically to a different topology.

The `Story` templates contain explicit `PIPELINE_REPLACES_*` placeholders and should not be queued unchanged.

Optional MiniMax H3 integrations are intentionally not bundled. In particular, `workflows/optional/` remains opt-in because those workflows have additional external custom-node dependencies and their own release/licensing cadence.

## Updating the vendored copies

When refreshing these defaults:

1. Pin the new `groxaxo/minimax-h3` commit SHA before copying anything.
2. Compare all five top-level files in `workflows/` plus the three files in `workflows/story/`.
3. Preserve the upstream prompt object byte-for-byte semantically under the SwarmUI `prompt` field; only the outer SwarmUI metadata wrapper should differ.
4. Update the provenance SHA in each description and in this README.
5. Do not overwrite files under `CustomWorkflows/Examples`; those are user state.
