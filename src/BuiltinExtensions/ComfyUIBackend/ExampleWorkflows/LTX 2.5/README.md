# LTX 2.5 bundled workflows

These files are pinned to `groxaxo/ltx-2.5` commit `0c60382b4d9d79a7b7abc2505e9f6c4a3c6f9879`.

| SwarmUI file | Upstream source | Semantics |
| --- | --- | --- |
| `LTX 2.5 Official Rolling Segment Core.json` | `templates/video_ltx2_5_i2v.json` plus `scripts/ltx25_workflow.py` | Queueable LTX 2.5 API prompt. SwarmUI opens it as a native editable Comfy graph with `app.loadApiJson()`. |
| `LTX 2.5 Standard 15s Three Prompt Rolling Chain.story.json.example` | `examples/ltx25-standard-15s-three-prompt-chain.json` | Three-segment orchestration descriptor, deliberately excluded from the `*.json` workflow scanner. |

## LTX 2.5 runtime contract

The queueable entry uses only the LTX 2.5 runtime family:

- `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`
- `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`
- `ltx-2.5-video-vae-bf16.safetensors`
- `ltx-2.5-audio-vae-bf16.safetensors`
- `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors`

The graph follows the official two-stage topology: low-resolution AV diffusion, latent x2 upscaling, high-resolution refinement, tiled video decode, synchronized audio decode, and MP4 output. Legacy LTX-AV checkpoint and Gemma 3 metadata are intentionally absent.

Replace `neon_cyborg_portrait.png` with your own first frame before generation. The default graph is 1344×768, 121 frames at 24 fps.

## API-prompt import

The LTX 2.5 entry intentionally stores the queueable graph under `prompt`. SwarmUI's workflow browser detects that `workflow` is null and calls the embedded Comfy frontend's native `app.loadApiJson()` importer. This creates the correct visual nodes, named widget values, links, and missing-node placeholders without maintaining a second graph copy.

The same import path is used by the bundled MiniMax H3 API workflows.

## Three-prompt descriptor

The `.json.example` file coordinates three successive LTX 2.5 rolling segments. Replace its first-frame path and prompt placeholders, then pass it to the LTX 2.5 sequence tooling. It is not represented as a fake single Comfy graph because that would change its orchestration semantics.

## Updating

1. Pin the new `groxaxo/ltx-2.5` commit.
2. Rebuild the API prompt from the official LTX 2.5 template and adapter.
3. Reject legacy runtime identifiers.
4. Keep orchestration descriptors outside the `*.json` scanner.
5. Run `python3 launchtools/validate-bundled-comfy-workflows.py`.
6. Never overwrite user state under `CustomWorkflows/Examples`.
