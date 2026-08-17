# Video Workspace

Video Workspace adds reusable video production controls on top of SwarmUI's existing Generate tab, ComfyUI workflows, History, and backend scheduler.

## Core workflow

Open **Generate → Video Workspace**.

- **New Video** opens the relevant video groups without enabling every advanced option.
- **Generate Now** runs the current Generate settings immediately.
- **Queue Current** captures the complete enabled input as an editable job.
- **Recreate Video** restores generation metadata from a selected video.
- **Remix Video** restores the settings and also loads that output into the selected video-source parameter.
- **Use As Video Source** loads an existing output into a registered `video` or `video_list` input.

The workspace reads and writes the normal SwarmUI parameters. Model-specific video controls, custom workflow inputs, LoRAs, prompts, image/audio/video guides, samplers, output settings, metadata, validation, and History continue to use the standard generation path.

## Component packs

Component packs are partial parameter snapshots. Select the component groups to capture, name the pack, and choose **Save Current As Pack**.

Supported groups include prompts, models, text encoders, sampling, video controls, media sources, output/refine controls, GPU routing, and other custom workflow inputs.

A pack can be:

- applied to the current Generate form;
- applied to selected queue jobs;
- duplicated for a variant;
- updated or deleted.

Inline media blobs are excluded from persistent packs to avoid exhausting browser storage.

## Editable queue

Each captured job can be renamed, loaded back into the form, duplicated, reordered, retried, deleted, assigned to a backend, and assigned a supported text-encoder device.

**Start Queue** dispatches work. Selecting it again pauses new submissions while active jobs continue. **Concurrent submissions** limits active workspace jobs. **Cancel Running** interrupts the workspace generation session.

Jobs then enter SwarmUI's existing server-side backend queue, model-pressure scheduler, cancellation flow, progress reporting, output saving, metadata handling, and History.

Jobs without inline media persist in browser local storage. Jobs containing pasted or uploaded inline media are marked **Session-only media** and remain available until the page is reloaded.

## GPU routing

### Whole jobs

A job can use the normal automatic scheduler or an exact backend ID. With round-robin enabled, automatic jobs rotate across the currently exposed backend IDs before entering the normal scheduler.

For three GPUs, configure one self-starting ComfyUI backend per GPU:

| Backend | GPU ID |
| --- | ---: |
| ComfyUI-0 | `0` |
| ComfyUI-1 | `1` |
| ComfyUI-2 | `2` |

Set workspace concurrency to `3` to submit independent jobs across all three workers.

### Text encoders

When the backend exposes `OverrideCLIPDevice`, the workspace maps **Text encoder device** to SwarmUI's existing **Set CLIP Device** parameter. Device choices are discovered from ComfyUI rather than assumed.

Device names are process-local. A backend launched with one visible physical GPU normally exposes it as `cuda:0`. Cross-device text-encoder placement inside one workflow requires the relevant GPUs to be visible to that ComfyUI process and the workflow/node stack to support the transfer.

### Sharding boundary

The exact backend determines where the job's diffusion model and VAE execute. Arbitrary node-level tensor sharding still requires a ComfyUI workflow or custom nodes that explicitly support it. Video Workspace preserves and queues those workflow inputs but does not invent implicit cross-process tensor transfers.

## Validation

Verify these cases before production use:

1. Generate a video immediately and through the workspace queue.
2. Recreate settings from both the current output and History.
3. Load an output video into a video-to-video or extension input.
4. Apply a model-only or sampling-only pack without overwriting unrelated controls.
5. Pause, resume, cancel, retry, reorder, and duplicate queue jobs.
6. Pin jobs to each backend and test round-robin dispatch.
7. Confirm the text-encoder selector appears only when the backend exposes that capability.
8. Confirm outputs retain normal metadata and History behavior.
