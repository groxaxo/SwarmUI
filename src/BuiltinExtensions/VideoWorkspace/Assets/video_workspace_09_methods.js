/** Video Workspace method group 09. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Dispatches queued jobs up to the configured concurrency. */
    pumpQueue() {
        if (!this.queueRunning || !this.initialized) {
            return;
        }
        let active = this.queue.filter(job => ['submitting', 'running'].includes(job.status)).length;
        let concurrency = Math.max(1, this.settings.concurrency || 1);
        while (active < concurrency) {
            let job = this.queue.find(item => item.status == 'queued');
            if (!job) {
                break;
            }
            this.dispatchJob(job);
            active++;
        }
        if (active == 0 && !this.queue.some(job => job.status == 'queued')) {
            this.queueRunning = false;
            this.setStatus('Video queue complete.');
        }
        this.updateQueueControls();
    },

    /** Submits one captured job through SwarmUI's normal generation WebSocket and backend queue. */
    dispatchJob(job) {
        if (!job.input) {
            job.status = 'failed';
            job.error = 'Job input is unavailable after browser reload.';
            this.renderQueue();
            return;
        }
        let input = this.clone(job.input);
        let metadata = input.extra_metadata && typeof input.extra_metadata == 'object' ? input.extra_metadata : {};
        input.extra_metadata = {
            ...metadata,
            video_workspace_job_id: job.id,
            video_workspace_job_name: job.name
        };
        let backend = this.backendForJob(job);
        if (backend) {
            input.exactbackendid = backend;
            job.resolvedBackend = backend;
        }
        else {
            delete input.exactbackendid;
            job.resolvedBackend = 'auto';
        }
        if (job.clipDevice && job.clipDevice != 'default') {
            input.setclipdevice = job.clipDevice;
        }
        else {
            delete input.setclipdevice;
        }
        job.status = 'submitting';
        job.error = null;
        job.outputs = [];
        job.completedOutputs = 0;
        job.expectedOutputs = this.expectedOutputs(input);
        job.startedAt = Date.now();
        this.renderQueue();
        let handler = new VideoWorkspaceGenerateHandler(this, job.id);
        this.generateHandlers.set(job.id, handler);
        try {
            handler.doGenerateJob(input, actualInput => {
                let actualMetadata = actualInput.extra_metadata && typeof actualInput.extra_metadata == 'object' ? actualInput.extra_metadata : {};
                actualInput.extra_metadata = {
                    ...actualMetadata,
                    video_workspace_job_id: job.id,
                    video_workspace_job_name: job.name
                };
                job.status = 'running';
                job.actualInput = this.clone(actualInput);
                this.handleGenerationLifecycle('submitted', { input: actualInput }, job.id);
                this.saveQueue();
                this.renderQueue();
                this.updateQueueControls();
            });
        }
        catch (e) {
            this.generateHandlers.delete(job.id);
            job.status = 'failed';
            job.error = e.message;
            this.saveQueue();
            this.renderQueue();
            this.pumpQueue();
        }
    },

    /** Converts raw GenerateHandler messages into workspace lifecycle events. */
    handleGenerationData(data, fallbackJobId = null) {
        if (!data) {
            return;
        }
        if (data.gen_progress) {
            this.handleGenerationLifecycle('progress', { data: data.gen_progress }, fallbackJobId);
        }
        if (data.image) {
            this.handleGenerationLifecycle('output', { data }, fallbackJobId);
        }
        if (data.error) {
            this.handleGenerationLifecycle('error', { data, error: data.error }, fallbackJobId);
        }
        if (data.socket_intention == 'close') {
            this.handleGenerationLifecycle('socket_closed', { data }, fallbackJobId);
        }
    },

    /** Marks the exact workspace job failed when its dedicated generation socket errors. */
    handleQueueHandlerError(message, jobId = null) {
        let job = this.queue.find(item => item.id == jobId) || this.queue.find(item => ['submitting', 'running'].includes(item.status));
        if (!job) {
            return false;
        }
        if (['completed', 'completed_partial', 'failed', 'cancelled'].includes(job.status)) {
            return true;
        }
        this.generateHandlers.delete(job.id);
        job.status = 'failed';
        job.error = message?.message || `${message}`;
        this.saveQueue();
        this.renderQueue();
        this.setStatus(`'${job.name}' failed: ${job.error}`, true);
        this.pumpQueue();
        return true;
    },

    /** Extracts workspace job metadata from a generated output or progress metadata string. */
    jobMetadata(metadata) {
        if (!metadata) {
            return {};
        }
        try {
            let readable = typeof interpretMetadata == 'function' ? interpretMetadata(metadata) : metadata;
            let parsed = typeof readable == 'string' ? JSON.parse(readable) : readable;
            let extra = parsed?.sui_extra_data || {};
            let params = parsed?.sui_image_params || {};
            return {
                jobId: extra.video_workspace_job_id || params.video_workspace_job_id || parsed.video_workspace_job_id,
                intermediate: extra.intermediate || params.intermediate
            };
        }
        catch (e) {
            return {};
        }
    }
});
