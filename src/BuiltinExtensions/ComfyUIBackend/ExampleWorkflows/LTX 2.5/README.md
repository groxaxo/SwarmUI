# LTX 2.5 bundled workflows

These files are vendored from `groxaxo/ltx-2.5` at commit `0c60382b4d9d79a7b7abc2505e9f6c4a3c6f9879`.

The source repository's `scripts/install_workflow_library.py` defines two canonical library entries, and SwarmUI ships those same two entries by default:

| SwarmUI file | Upstream source | Semantics |
| --- | --- | --- |
| `LTX 2.5 Official Rolling Segment Core.json` | `templates/video_ltx2_5_i2v.json` | Editable Comfy UI image-to-video graph for one rolling segment. |
| `LTX 2.5 Standard 15s Three Prompt Rolling Chain.story.json` | `examples/ltx25-standard-15s-three-prompt-chain.json` | Story-chain specification for three linked prompts; not a directly queueable Comfy graph. |

## Official rolling segment core

The rolling-segment workflow expects the LTX 2.5 model set named by the graph, including the distilled transformer, video/audio VAEs, Gemma text encoders, and latent spatial upscaler. Replace the demo first-frame image before generation.

The source graph is stored under the SwarmUI `workflow` field. SwarmUI's example-copy mechanism places it in `CustomWorkflows/Examples/LTX 2.5` on first availability without clobbering an existing user copy.

## Three-prompt rolling-chain specification

The `.story.json` entry is intentionally represented as a story specification under `custom_params`. It contains an absolute input-frame placeholder and three prompt placeholders. Replace all four placeholders before handing it to the LTX rolling-chain tooling.

This distinction is intentional: a story chain coordinates multiple rolling-segment invocations and cannot be faithfully represented as a single queueable Comfy prompt without changing its semantics.

## Updating the vendored copies

1. Pin the new `groxaxo/ltx-2.5` commit SHA.
2. Inspect `scripts/install_workflow_library.py` first; its `INSTALLS` map is the source of truth for the canonical friendly library set.
3. Refresh the two source files named by that map.
4. Preserve graph/story semantics rather than coercing both files into one JSON shape.
5. Update provenance in the SwarmUI wrappers and this README.
6. Never overwrite user state under `CustomWorkflows/Examples`.
