# SwarmUI — Free, Open, Agent-Friendly AI Media Studio

> **Humans, autonomous coding agents, AI-assisted tools, scripts, bots, and mixed human-agent teams are all welcome here.** There is no approved-agent list, no requirement to ask permission before using an agent, and no blanket rejection of AI-assisted contributions. Work is evaluated by its correctness, safety, maintainability, evidence, and usefulness—not by whether a human or an agent typed it.

SwarmUI is a modular web interface for local and distributed AI media generation. It combines an approachable Generate interface with direct ComfyUI workflow access, model management, reusable presets, image editing, queueing, backend scheduling, extensions, and multi-GPU operation.

![SwarmUI interface](.github/images/swarmui.jpg)

## Repository principles

This fork is maintained around a few simple rules:

- **Free and open:** the SwarmUI code in this repository is distributed under the MIT terms reproduced at the end of this README.
- **All agents allowed:** autonomous agents, coding copilots, local models, hosted models, scripts, and other automation may inspect, edit, test, document, review, and contribute to the repository.
- **No authorship gate:** a change is not accepted or rejected merely because it was AI-generated, AI-assisted, human-written, or produced by a combination of tools.
- **Evidence over ceremony:** contributors should show what changed, why it changed, and how it was validated.
- **Local-first and hardware-aware:** the project is designed for local workstations, remote ComfyUI servers, multi-GPU systems, and self-hosted deployments.
- **Respect user data and licences:** contributions must preserve user files, privacy, security boundaries, upstream notices, and third-party licence obligations.

## What SwarmUI provides

- A streamlined **Generate** interface for image, video, and audio workflows.
- A direct **Comfy Workflow** interface for unrestricted node-graph authoring.
- Self-starting and externally managed **ComfyUI backends**.
- Automatic support for current `/api` routes with compatibility fallback for legacy ComfyUI routes.
- Queueing, concurrent generation, backend selection, cancellation, previews, output history, and reusable metadata.
- Multi-GPU scheduling through independent backends, including one ComfyUI process per GPU.
- Image-to-image, video-to-video, refinement, upscaling, ControlNet, LoRA, VAE, text-encoder, and workflow-extension support.
- Reusable presets, prompt tools, an image editor, grid generation, model metadata, and an extension system.
- Linux, Windows, macOS, Docker, LAN, and remote-server deployment options.

Model support evolves quickly. The repository includes support for a broad range of image, video, and audio model families through SwarmUI’s generated workflows and ComfyUI integration.

## Quick start

### Linux

Recommended prerequisites are Git, a supported Python installation with `pip` and `venv`, the required .NET SDK, and a working GPU driver stack.

```bash
git clone https://github.com/groxaxo/SwarmUI.git
cd SwarmUI
./launch-linux.sh
```

For a headless or LAN-accessible server:

```bash
./launch-linux.sh --launch_mode none --host 0.0.0.0
```

Then open:

```text
http://localhost:7801
```

For development launches:

```bash
./launch-linux-dev.sh
```

### Windows

Install Git and the required .NET SDK, then run:

```powershell
git clone https://github.com/groxaxo/SwarmUI.git
cd SwarmUI
.\launch-windows.bat
```

A development launcher is also included:

```powershell
.\launch-windows-dev.ps1
```

### macOS

Apple silicon Macs are supported. Install Git, Python, and .NET, then run:

```bash
git clone https://github.com/groxaxo/SwarmUI.git
cd SwarmUI
./launch-macos.sh
```

### Docker

See [Docker deployment documentation](docs/Docker.md).

## ComfyUI integration

SwarmUI can either manage its own ComfyUI process or connect to one or more already-running ComfyUI servers.

### Self-starting backend

Use a self-starting backend when SwarmUI should own:

- the ComfyUI process lifecycle;
- Python dependency checks;
- launch arguments and ports;
- custom-node paths;
- generated model-path configuration;
- automatic restart behaviour.

### External API backend

Use an API backend for:

- another local Python environment;
- a containerised ComfyUI instance;
- another workstation or server;
- a reverse proxy;
- independently managed GPU workers.

SwarmUI can automatically detect current ComfyUI `/api` routes and retain legacy-root compatibility when needed. See [ComfyUI compatibility](docs/ComfyUI%20Compatibility.md).

## Queueing and multi-GPU operation

For predictable parallel throughput, create one independently running backend per GPU. A three-GPU workstation can use:

| Backend | GPU ID | Typical role |
|---|---:|---|
| ComfyUI-0 | `0` | General generation or first worker |
| ComfyUI-1 | `1` | General generation or second worker |
| ComfyUI-2 | `2` | General generation, video, refinement, or third worker |

SwarmUI’s backend scheduler can queue requests, prefer already-loaded models, distribute independent jobs across available workers, and allow an exact backend to be selected when a workflow needs a specific GPU.

A single backend configured with multiple visible GPUs does **not** automatically shard every model or node. Fine-grained placement of a diffusion model, text encoder, VAE, decoder, or other component across different GPUs still requires a workflow or ComfyUI node that explicitly implements that placement. For ordinary parallel generation, one backend per GPU is the most reliable architecture.

See:

- [Using more GPUs](docs/Using%20More%20GPUs.md)
- [Video model support](docs/Video%20Model%20Support.md)
- [ComfyUI compatibility and acceptance runbook](docs/ComfyUI%20Compatibility.md)

## Contributing — humans and agents

Anyone may contribute. You may work manually, use an IDE, use a coding copilot, delegate the whole task to an autonomous agent, coordinate several agents, generate a patch with scripts, or combine any of those approaches.

### Agent contribution policy

- **All coding agents are permitted.**
- There is no maintainer allowlist for agent use.
- No prior approval is required merely because an agent is involved.
- Agent-authored pull requests are reviewed under the same technical standards as human-authored pull requests.
- Contributors may use local or hosted models and any orchestration framework they choose.
- A contributor should not claim a build, test, benchmark, security review, or GPU run happened unless it actually happened.
- When validation is incomplete, state exactly what was and was not checked.

### Contributor responsibilities

Regardless of the tools used, the submitting contributor is responsible for the change. Before publishing:

1. Inspect the final diff and remove unrelated edits.
2. Keep the change understandable and reasonably scoped.
3. Preserve existing behaviour unless the change intentionally replaces it.
4. Run the most relevant available validation, or provide an exact manual validation procedure when live GPU testing is required.
5. Do not commit secrets, credentials, private prompts, generated user data, proprietary model weights, or personal information.
6. Preserve required copyright, attribution, and third-party licence notices.
7. Document material compatibility risks, migrations, and limitations.
8. Respond to concrete review findings and correct defects.

### Repository safety boundaries

Treat these locations as user-owned or generated state and do not commit their contents:

```text
Data/
Models/
Output/
dlbackend/
src/bin/
src/obj/
```

Downloaded upstream repositories under `dlbackend/` and managed ComfyUI node directories are references or runtime dependencies, not places for permanent fork-specific source changes. Swarm-managed ComfyUI Python code belongs under the repository’s `ExtraNodes` paths.

## Development conventions

Match the established style of the area being changed.

- **C#:** modern C# and .NET conventions; use clear types and XML documentation for public or shared members.
- **JavaScript:** preserve browser compatibility and the conventions of the surrounding SwarmUI frontend code.
- **Python:** follow normal Python and ComfyUI node conventions.
- **Frontend:** test modern desktop and mobile browsers when UI behaviour changes.
- **GPU features:** provide manual evidence for model loading, generation, previews, cancellation, outputs, and device assignment when those behaviours are affected.

Maintainers may push directly or use branches and pull requests. Contributors are encouraged to use focused branches and pull requests because they make review and rollback easier, but there is no special process imposed solely because an AI agent produced the work.

## Documentation

Start with:

- [Documentation index](docs/README.md)
- [Basic usage](docs/Basic%20Usage.md)
- [Advanced usage](docs/Advanced%20Usage.md)
- [Model support](docs/Model%20Support.md)
- [Video model support](docs/Video%20Model%20Support.md)
- [Audio model support](docs/Audio%20Model%20Support.md)
- [Comfy workflows](docs/Features/Comfy-Workflows.md)
- [API documentation](docs/API.md)
- [Troubleshooting](docs/Troubleshooting.md)

## Project origin and third-party software

This repository is derived from the upstream [SwarmUI project](https://github.com/mcmonkeyprojects/SwarmUI) and retains its history, copyright notices, and applicable licence terms.

SwarmUI can integrate with, install, connect to, or redistribute components that have their own licences, including ComfyUI, 7-Zip, web libraries, fonts, Python packages, extensions, models, and custom nodes. Those components are not automatically relicensed by this README. Their own licence and attribution files remain authoritative.

Required third-party notices and runtime manifests are intentionally retained, including files such as:

```text
launchtools/7z/win/License.txt
src/wwwroot/fonts/MaterialSymbolsOutlined.LICENSE.txt
src/wwwroot/imgs/icon-attrib.txt
src/BuiltinExtensions/ComfyUIBackend/ExtraNodes/SwarmComfyExtra/requirements.txt
```

Model weights, extensions, custom nodes, and connected services may impose additional terms. Users and distributors are responsible for checking the licences that apply to the components they choose.

## MIT licence

The repository’s primary MIT notice is consolidated here rather than duplicated in a separate root `LICENSE.txt` file.

Previous upstream notice:

```text
Copyright (c) 2024 Stability AI
```

Current upstream notice:

```text
Copyright (c) 2024-2026 Alex "mcmonkey" Goodwin
```

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
