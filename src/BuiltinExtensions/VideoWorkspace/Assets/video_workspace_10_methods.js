/** Video Workspace method group 10. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Receives core generation lifecycle events and advances queue state. */
    handleGenerationLifecycle(type, detail, fallbackJobId = null) {
        let metadata = detail?.data?.metadata || detail?.data?.gen_progress?.metadata || detail?.metadata;
        let info = this.jobMetadata(metadata);
        let input = detail?.input;
        let jobId = info.jobId || input?.extra_metadata?.video_workspace_job_id || fallbackJobId;
        if (!jobId) {
            return;
        }
        let job = this.queue.find(item => item.id == jobId);
        if (!job) {
            return;
        }
        if (['completed', 'completed_partial', 'failed', 'cancelled'].includes(job.status) && type != 'submitted') {
            return;
        }
        if (type == 'submitted') {
            job.status = 'running';
        }
        else if (type == 'progress') {
            job.status = 'running';
            job.progress = detail.data?.overall_percent ?? detail.data?.gen_progress?.overall_percent ?? job.progress;
        }
        else if (type == 'output') {
            let outputData = detail.data || {};
            if (outputData.image && !job.outputs.includes(outputData.image)) {
                job.outputs.push(outputData.image);
            }
            if (!info.intermediate) {
                job.completedOutputs++;
            }
            if (job.completedOutputs >= job.expectedOutputs) {
                job.status = 'completed';
                job.progress = 1;
                job.completedAt = Date.now();
                this.generateHandlers.delete(job.id);
                this.saveQueue();
                this.renderQueue();
                this.pumpQueue();
                return;
            }
        }
        else if (type == 'error') {
            this.generateHandlers.delete(job.id);
            job.status = 'failed';
            job.error = detail.error?.message || detail.error || detail.data?.error || 'Generation failed.';
            this.saveQueue();
            this.renderQueue();
            this.pumpQueue();
            return;
        }
        else if (type == 'socket_closed' && ['running', 'submitting'].includes(job.status)) {
            this.generateHandlers.delete(job.id);
            if (job.outputs.length > 0) {
                job.status = job.completedOutputs >= job.expectedOutputs ? 'completed' : 'completed_partial';
                job.progress = 1;
                job.completedAt = Date.now();
                if (job.status == 'completed_partial') {
                    job.error = `Generation returned ${job.completedOutputs} of ${job.expectedOutputs} expected final outputs.`;
                }
            }
            else {
                job.status = 'failed';
                job.error = 'Generation ended without a final output.';
            }
            this.saveQueue();
            this.renderQueue();
            this.pumpQueue();
            return;
        }
        this.renderQueue();
        this.updateQueueControls();
    },

    /** Returns readable queue status text. */
    statusLabel(job) {
        if (job.status == 'running' && Number.isFinite(job.progress)) {
            return `Running ${Math.round(job.progress * 100)}%`;
        }
        return (job.status || 'queued').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
    }
});
