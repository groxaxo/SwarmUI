/** Video Workspace method group 08. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Updates the selected source-video description. */
    updateSourceLabel() {
        let label = document.getElementById('video-workspace-source-label');
        if (!label) {
            return;
        }
        if (!this.sourceVideo) {
            label.textContent = 'No source video selected';
            return;
        }
        let name = getImageFullSrc(this.sourceVideo).split('/').pop();
        let target = document.getElementById('video-workspace-source-target');
        let targetName = target && target.selectedOptions.length ? target.selectedOptions[0].textContent : 'video input';
        label.textContent = `${name} → ${targetName}`;
    },

    /** Uses the currently selected output as the workspace source video. */
    useCurrentVideoAsSource() {
        let media = currentImageHelper.getCurrentImage();
        if (!media || media.tagName != 'VIDEO') {
            this.setStatus('Select a video output first.', true);
            return;
        }
        this.setVideoSource(media.dataset.src || currentImgSrc, true);
    },

    /** Fetches a selected video and assigns it to the chosen video parameter. */
    async setVideoSource(src, open = false) {
        if (open) {
            this.openWorkspace();
        }
        let select = document.getElementById('video-workspace-source-target');
        let paramId = select?.value;
        let param = gen_param_types.find(item => item.id == paramId);
        let elem = param ? document.getElementById(`input_${param.id}`) : null;
        if (!param || !elem) {
            this.setStatus('No compatible video input parameter is currently available.', true);
            return;
        }
        this.sourceVideo = src;
        this.updateSourceLabel();
        this.setStatus('Loading source video into the selected parameter...');
        try {
            let response = await fetch(src);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            let blob = await response.blob();
            let filename = getImageFullSrc(src).split('/').pop() || 'source-video.mp4';
            let mime = blob.type || isVideoExt(src) || 'video/mp4';
            let file = new File([blob], filename, { type: mime });
            let transfer = new DataTransfer();
            transfer.items.add(file);
            this.enableParam(param);
            elem.files = transfer.files;
            elem.dataset.filename = filename;
            triggerChangeFor(elem);
            this.setStatus(`Loaded '${filename}' into ${param.name}.`);
        }
        catch (e) {
            console.log('Video Workspace failed to load source video:', e);
            this.setStatus(`Could not load source video: ${e.message}`, true);
        }
    },

    /** Calculates expected final outputs for a generation input. */
    expectedOutputs(input) {
        let images = Math.max(1, parseInt(input?.images) || 1);
        let batch = Math.max(1, parseInt(input?.batchsize) || 1);
        return images * batch;
    },

    /** Adds current generation settings to the editable workspace queue. */
    addCurrentToQueue(name = null) {
        let input = getGenInput();
        if (!input.model && !input.comfyworkflowraw && !input.comfyuicustomworkflow) {
            this.setStatus('Select a model or custom ComfyUI workflow before queueing the job.', true);
            return;
        }
        let job = {
            id: this.makeId('video-job'),
            name: name || `Video Job ${this.queue.length + 1}`,
            input: this.clone(input),
            status: 'queued',
            backend: this.settings.defaultBackend || 'auto',
            clipDevice: this.settings.defaultClipDevice || 'default',
            createdAt: Date.now(),
            outputs: [],
            error: null,
            completedOutputs: 0,
            expectedOutputs: this.expectedOutputs(input),
            sessionOnly: this.containsInlineMedia(input)
        };
        this.queue.push(job);
        this.saveQueue();
        this.renderQueue();
        this.openWorkspace();
        this.setStatus(`Queued '${job.name}'${job.sessionOnly ? ' for this browser session (contains inline media)' : ''}.`);
        if (this.queueRunning) {
            this.pumpQueue();
        }
    },

    /** Returns backend routing for a job, including round-robin automatic selection. */
    backendForJob(job) {
        if (job.backend && job.backend != 'auto') {
            return job.backend;
        }
        let backends = this.availableBackends();
        if (!this.settings.roundRobin || backends.length == 0) {
            return null;
        }
        let backend = backends[this.roundRobinIndex % backends.length];
        this.roundRobinIndex++;
        return backend.value;
    },

    /** Starts or pauses queue dispatch without interrupting already-running jobs. */
    toggleQueue() {
        this.queueRunning = !this.queueRunning;
        this.updateQueueControls();
        if (this.queueRunning) {
            this.setStatus('Queue dispatch started. Existing server-side backend scheduling remains active.');
            this.pumpQueue();
        }
        else {
            this.setStatus('Queue dispatch paused. Running jobs continue.');
        }
    }
});
