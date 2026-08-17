/** Video Workspace method group 12. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Handles queue row action buttons. */
    handleJobClick(job, event) {
        let button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        let action = button.dataset.action;
        if (['running', 'submitting'].includes(job.status) && ['retry', 'up', 'down', 'delete'].includes(action)) {
            this.setStatus(`'${job.name}' is active. Cancel it before changing queue state.`, true);
            return;
        }
        if (action == 'edit') {
            let applied = this.applyValuesToForm(job.input, false);
            this.openWorkspace();
            this.setStatus(`Loaded '${job.name}' into the Generate form (${applied} parameters).`);
        }
        else if (action == 'duplicate') {
            let copy = {
                ...this.clone(job),
                id: this.makeId('video-job'),
                name: `${job.name} Copy`,
                status: 'queued',
                outputs: [],
                error: null,
                completedOutputs: 0,
                progress: 0,
                createdAt: Date.now()
            };
            delete copy.startedAt;
            delete copy.completedAt;
            delete copy.actualInput;
            delete copy.resolvedBackend;
            this.queue.splice(this.queue.indexOf(job) + 1, 0, copy);
        }
        else if (action == 'retry') {
            job.status = 'queued';
            job.error = null;
            job.outputs = [];
            job.completedOutputs = 0;
            job.progress = 0;
            delete job.startedAt;
            delete job.completedAt;
            delete job.actualInput;
            delete job.resolvedBackend;
        }
        else if (action == 'up' || action == 'down') {
            let index = this.queue.indexOf(job);
            let next = index + (action == 'up' ? -1 : 1);
            if (next >= 0 && next < this.queue.length) {
                this.queue.splice(index, 1);
                this.queue.splice(next, 0, job);
            }
        }
        else if (action == 'delete') {
            this.queue = this.queue.filter(item => item.id != job.id);
            this.selectedJobs.delete(job.id);
        }
        this.saveQueue();
        this.renderQueue();
        if (this.queueRunning) {
            this.pumpQueue();
        }
    },

    /** Selects or clears selection for all queue jobs. */
    selectAllJobs() {
        if (this.selectedJobs.size == this.queue.length) {
            this.selectedJobs.clear();
        }
        else {
            this.selectedJobs = new Set(this.queue.map(job => job.id));
        }
        this.renderQueue();
    },

    /** Requeues selected jobs, moves them to the front, and starts dispatch. */
    runSelected() {
        let jobs = this.queue.filter(job => this.selectedJobs.has(job.id) && !['running', 'submitting'].includes(job.status));
        if (jobs.length == 0) {
            this.setStatus('Select at least one non-running job.', true);
            return;
        }
        for (let job of jobs) {
            job.status = 'queued';
            job.error = null;
            job.outputs = [];
            job.completedOutputs = 0;
            job.progress = 0;
            delete job.startedAt;
            delete job.completedAt;
            delete job.actualInput;
            delete job.resolvedBackend;
        }
        let selectedIds = new Set(jobs.map(job => job.id));
        this.queue = [...this.queue.filter(job => selectedIds.has(job.id)), ...this.queue.filter(job => !selectedIds.has(job.id))];
        this.queueRunning = true;
        this.saveQueue();
        this.renderQueue();
        this.updateQueueControls();
        this.pumpQueue();
    },

    /** Cancels the workspace generation session and marks active jobs cancelled. */
    cancelRunning() {
        this.queueRunning = false;
        for (let handler of this.generateHandlers.values()) {
            handler.interrupted = handler.batchesEver;
        }
        doInterrupt();
        let cancelled = 0;
        for (let job of this.queue) {
            if (['running', 'submitting'].includes(job.status)) {
                job.status = 'cancelled';
                job.error = 'Cancelled by user.';
                cancelled++;
            }
        }
        this.generateHandlers.clear();
        this.saveQueue();
        this.renderQueue();
        this.updateQueueControls();
        this.setStatus(`Cancelled ${cancelled} active workspace job${cancelled == 1 ? '' : 's'}.`);
    },

    /** Removes completed, failed, and cancelled jobs. */
    clearFinished() {
        this.queue = this.queue.filter(job => ['queued', 'running', 'submitting'].includes(job.status));
        this.selectedJobs = new Set([...this.selectedJobs].filter(id => this.queue.some(job => job.id == id)));
        this.saveQueue();
        this.renderQueue();
        this.setStatus('Cleared finished queue entries.');
    },

    /** Updates queue buttons and active count. */
    updateQueueControls() {
        let button = document.getElementById('video-workspace-start-queue');
        if (button) {
            button.textContent = this.queueRunning ? 'Pause Queue' : 'Start Queue';
        }
        let active = this.queue.filter(job => ['running', 'submitting'].includes(job.status)).length;
        let badge = document.getElementById('video-workspace-active-count');
        if (badge) {
            badge.textContent = `${active} active`;
        }
    }
});
