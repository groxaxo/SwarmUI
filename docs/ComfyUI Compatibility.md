# ComfyUI Compatibility

SwarmUI can either start and manage its own ComfyUI process or connect to an already-running ComfyUI server. This compatibility layer targets **ComfyUI 0.33.0** and **comfyui-frontend-package 1.49.6** while preserving fallback support for older ComfyUI API routes.

## Backend modes

### ComfyUI Self-Starting

Use this mode when SwarmUI should own the ComfyUI process, Python environment, launch arguments, model-path configuration, and restart lifecycle.

SwarmUI generates an `extra-model-paths` YAML file and forwards both its established model folders and the current upstream ComfyUI folder categories. The compatibility manifest also validates the non-Torch Python packages needed by the current ComfyUI baseline.

### ComfyUI API

Use this mode when ComfyUI is launched separately, including another local environment, a container, another machine, or a reverse-proxied service.

The default address is:

```text
http://127.0.0.1:8188
```

The address field accepts values with or without `http://` or `https://`. A trailing `/api` is also accepted and normalized.

`API Path Mode` has three options:

- **Auto Detect** probes the current `/api` routes first and falls back to legacy root routes.
- **Force /api Prefix** is useful for current ComfyUI deployments or reverse proxies that expose only `/api`.
- **Force Legacy Root** is available for older ComfyUI versions and unusual proxies.

The older `Enable Frontend Dev` setting remains supported and forces `/api`.

## Dependency handling

The compatibility manifest aligns Swarm's managed checks with the required non-Torch packages used by the target ComfyUI release. This includes the current frontend package, `av >= 16.0.0`, tokenizers, safetensors, SQLAlchemy, Pillow, PyYAML, and the other core runtime dependencies.

SwarmUI intentionally does **not** replace or upgrade these packages automatically:

- `torch`
- `torchvision`
- `torchaudio`
- `torchsde`
- CUDA, ROCm, DirectML, or platform-specific accelerator packages

Those packages must remain matched to the machine, driver stack, and Python build. Blindly replacing them can convert a working CUDA environment into a CPU-only environment.

## Forwarded ComfyUI folders

In addition to SwarmUI's existing paths, self-starting backends forward these current upstream categories:

- `configs`
- `text_encoders`
- `diffusers`
- `vae_approx`
- `datasets`
- `photomaker`
- `classifiers`
- `audio_encoders`
- `background_removal`
- `frame_interpolation`
- `geometry_estimation`
- `optical_flow`
- `detection`

Multiple paths that resolve to the same ComfyUI category are deduplicated by ComfyUI.

## Multi-GPU configuration

For parallel generation throughput, the most predictable configuration is one self-starting backend per GPU:

| Backend | GPU ID | Suggested OverQueue |
| --- | ---: | ---: |
| ComfyUI-0 | `0` | `0` or `1` |
| ComfyUI-1 | `1` | `0` or `1` |
| ComfyUI-2 | `2` | `0` or `1` |

SwarmUI allocates a separate port to each self-starting backend and can schedule independent jobs across them.

A GPU ID such as `0,1,2` exposes multiple GPUs to one ComfyUI process. It does **not** automatically shard every model or workflow. Use that form only with ComfyUI nodes or workflows that explicitly implement multi-GPU execution.

For externally launched ComfyUI servers, add one SwarmUI API backend for each independently running ComfyUI instance.

## Manual validation

Repository policy requires developers to perform live validation manually.

1. Start SwarmUI and inspect the backend load log.
2. Confirm the log reports either `the /api prefix` or `legacy root routes`.
3. Confirm each configured ComfyUI backend reaches `Running`.
4. Refresh models and verify checkpoints, diffusion models, LoRAs, VAEs, and text encoders appear.
5. Run a basic generated workflow from the Generate tab.
6. Open the Comfy Workflow tab and run an API-format workflow.
7. Validate image upload, preview, cancellation, final output retrieval, and history cleanup.
8. For video or audio installations, run one representative workflow and confirm the returned media type.
9. With multiple GPUs, submit concurrent jobs and verify each backend uses only its configured GPU set.
10. When supporting an older ComfyUI deployment, force `Legacy Root` and repeat the basic generation test.

## Troubleshooting

### Backend returns 404 or HTML instead of JSON

Use `API Path Mode` to force `/api` or legacy root routing. For a reverse proxy, ensure WebSocket upgrades are enabled for the matching `/ws` or `/api/ws` path.

### ComfyUI starts after a package update but CUDA is unavailable

Do not keep upgrading random packages. Verify that the Python environment still contains a CUDA-enabled Torch build appropriate for the installed NVIDIA driver. Restore the known-good Torch stack before changing unrelated ComfyUI packages.

### Models are visible in ComfyUI but not SwarmUI

Refresh SwarmUI's model data and check that the folder is included in `Data/comfy-auto-model.yaml`. For external API backends, SwarmUI reads the model values exposed by ComfyUI's `object_info` response.

### Swarm core nodes are missing

Confirm the self-starting backend received both Swarm custom-node paths and review the ComfyUI import log for failures under `SwarmComfyCommon` or `SwarmComfyExtra`.
