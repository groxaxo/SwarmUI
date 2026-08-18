# Docker

There are two Dockerfiles currently: [`launchtools/StandardDockerfile.docker`](/launchtools/StandardDockerfile.docker) and [`launchtools/Experimental-Dockerfile.docker`](/launchtools/Experimental-Dockerfile.docker).

The Standard Dockerfile is a general-purpose SwarmUI image. The example Compose file is [`launchtools/example-docker-compose.yml`](/launchtools/example-docker-compose.yml).

## Standard Compose quick start

From the SwarmUI repository root:

```bash
HOST_UID="$(id -u)" HOST_GID="$(id -g)" \
SWARM_GPU_COUNT=3 \
docker compose -f launchtools/example-docker-compose.yml up --build
```

Open SwarmUI on port `7801` after startup.

The Compose example defaults to **three NVIDIA GPUs** because the bundled MiniMax H3 Ampere workflows explicitly reference `cuda:0`, `cuda:1`, and `cuda:2`. If you are not using those workflows, override the count to match your host:

```bash
SWARM_GPU_COUNT=1 docker compose -f launchtools/example-docker-compose.yml up --build
```

The host must have a working NVIDIA driver and NVIDIA Container Toolkit configuration for GPU reservations to work. The Compose file does not install or alter host drivers.

## Persistent data

The example Compose configuration separates application code from persistent user state:

- `swarmdata` → `/SwarmUI/Data`
- `swarmbackend` → `/SwarmUI/dlbackend`
- `swarmdlnodes` → `/SwarmUI/src/BuiltinExtensions/ComfyUIBackend/DLNodes`
- `swarmextensions` → `/SwarmUI/src/Extensions`
- `./Models` → `/SwarmUI/Models`
- `./Output` → `/SwarmUI/Output`
- `./src/BuiltinExtensions/ComfyUIBackend/CustomWorkflows` → persistent user workflow library

Keep the `CustomWorkflows` bind mount if you want workflow edits and deletions to survive an image rebuild.

## Bundled workflow library

The Standard image now contains the repository's built-in workflow examples under:

```text
/SwarmUI/src/BuiltinExtensions/ComfyUIBackend/ExampleWorkflows
```

This includes:

- the existing Basic SDXL example;
- eight pinned MiniMax H3 workflow presets/templates from `groxaxo/minimax-h3`;
- the canonical LTX 2.5 workflow-library entries selected by `groxaxo/ltx-2.5`.

SwarmUI copies an example into `CustomWorkflows/Examples` only when that user-state copy does not already exist. Consequently:

- rebuilding the image makes newly bundled examples available;
- a locally edited workflow is not silently overwritten;
- a workflow explicitly deleted through SwarmUI remains deleted via its marker;
- Docker startup does not need credentials to the private MiniMax H3 or LTX repositories.

See [Custom Comfy Workflows](/docs/Features/Comfy-Workflows.md) for the exact source pins, workflow formats, and model/node requirements.

## MiniMax H3 Docker topology

The bundled Ampere presets are authored for a single ComfyUI process that can see three GPUs and internally assigns work among them. They use explicit device strings such as:

```text
cuda:0
cuda:1
cuda:2
```

Therefore, for those presets:

1. expose three GPUs to the SwarmUI/ComfyUI container;
2. use a Comfy self-start backend whose process inherits those three visible devices;
3. do not combine the preset with a one-backend-per-GPU topology unless you rewrite its internal CUDA assignments.

This is different from ordinary SwarmUI throughput scaling, where one self-starting backend per GPU is often preferable. The [ComfyUI Compatibility](/docs/ComfyUI%20Compatibility.md) runbook covers that topology separately.

## LTX 2.5 Docker notes

The LTX 2.5 default library is also baked into the image. The workflow JSON does **not** bundle the large model weights. Mount the required models under `./Models` using the folder categories referenced by the workflow, such as `diffusion_models`, `vae`, `text_encoders`, and `latent_upscale_models`.

The LTX rolling-chain story specification contains an input-frame path placeholder. Replace it with a path accessible to the running workflow before execution.

## External ComfyUI

If SwarmUI should connect to a ComfyUI process outside the container, uncomment `network_mode: host` on Linux or otherwise provide a routable host/container address. Then configure a **ComfyUI API** backend in SwarmUI. Be aware that host networking changes the container's network isolation model.

## Rebuilding after workflow updates

After pulling a SwarmUI commit that updates bundled examples:

```bash
docker compose -f launchtools/example-docker-compose.yml build --no-cache swarmui
docker compose -f launchtools/example-docker-compose.yml up -d swarmui
```

A fresh user-state directory receives all bundled examples. Existing `CustomWorkflows` content remains authoritative and is not clobbered.

## Experimental image

The Experimental Dockerfile is not the recommended path for the bundled production workflow library. Use the Standard image unless you specifically need functionality documented for the experimental container.
