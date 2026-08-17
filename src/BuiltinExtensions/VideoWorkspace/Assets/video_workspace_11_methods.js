/** Video Workspace method group 11. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Renders queue rows and their editing/routing controls. */
    renderQueue() {
        let container = document.getElementById('video-workspace-queue');
        if (!container) {
            return;
        }
        if (this.queue.length == 0) {
            container.innerHTML = '<div class="video-workspace-empty">No video jobs queued. Capture the current Generate settings or recreate a video from History.</div>';
            this.updateQueueControls();
            return;
        }
        container.innerHTML = '';
        let backends = this.availableBackends();
        let clipDevices = this.availableClipDevices();
        for (let index = 0; index < this.queue.length; index++) {
            let job = this.queue[index];
            let row = createDiv(null, `video-workspace-job video-workspace-job-${job.status}`);
            row.dataset.jobId = job.id;
            let selected = this.selectedJobs.has(job.id) ? ' checked' : '';
            let active = ['running', 'submitting'].includes(job.status);
            let activeDisabled = active ? ' disabled' : '';
            let backendOptions = '<option value="auto">Auto scheduler</option>' + backends.map(backend => `<option value="${escapeHtml(backend.value)}"${job.backend == backend.value ? ' selected' : ''}>${escapeHtml(backend.name)}</option>`).join('');
            let clipOptions = '<option value="default">Backend default</option>' + clipDevices.map(device => `<option value="${escapeHtml(device)}"${job.clipDevice == device ? ' selected' : ''}>${escapeHtml(device)}</option>`).join('');
            let outputLinks = (job.outputs || []).slice(-3).map(output => `<a href="${escapeHtmlForUrl(output)}" target="_blank">${escapeHtml(getImageFullSrc(output).split('/').pop())}</a>`).join('');
            row.innerHTML = `
                <div class="video-workspace-job-select"><input type="checkbox" data-action="select"${selected} /></div>
                <div class="video-workspace-job-main">
                    <input class="video-workspace-job-name auto-text" data-action="rename" value="${escapeHtml(job.name)}" />
                    <div class="video-workspace-job-meta">
                        <span class="video-workspace-job-status">${escapeHtml(this.statusLabel(job))}</span>
                        <span>${job.sessionOnly ? 'Session-only media' : 'Persistent'}</span>
                        <span>${job.resolvedBackend ? `Backend ${escapeHtml(job.resolvedBackend)}` : ''}</span>
                    </div>
                    ${job.error ? `<div class="video-workspace-job-error">${escapeHtml(`${job.error}`)}</div>` : ''}
                    ${outputLinks ? `<div class="video-workspace-job-outputs">${outputLinks}</div>` : ''}
                </div>
                <div class="video-workspace-job-routing">
                    <label>Backend<select data-action="backend" class="auto-dropdown">${backendOptions}</select></label>
                    <label>Text encoder<select data-action="clip" class="auto-dropdown">${clipOptions}</select></label>
                </div>
                <div class="video-workspace-job-actions">
                    <button class="basic-button" data-action="edit">Load / Edit</button>
                    <button class="basic-button" data-action="duplicate">Duplicate</button>
                    <button class="basic-button" data-action="retry"${activeDisabled}>Queue</button>
                    <button class="basic-button" data-action="up"${activeDisabled || (index == 0 ? ' disabled' : '')}>↑</button>
                    <button class="basic-button" data-action="down"${activeDisabled || (index == this.queue.length - 1 ? ' disabled' : '')}>↓</button>
                    <button class="basic-button danger-button" data-action="delete"${activeDisabled}>Delete</button>
                </div>`;
            row.addEventListener('change', event => this.handleJobChange(job, event));
            row.addEventListener('click', event => this.handleJobClick(job, event));
            container.appendChild(row);
        }
        this.updateQueueControls();
    },

    /** Handles queue row selection, renaming, and route editing. */
    handleJobChange(job, event) {
        let action = event.target.dataset.action;
        if (action == 'select') {
            if (event.target.checked) {
                this.selectedJobs.add(job.id);
            }
            else {
                this.selectedJobs.delete(job.id);
            }
        }
        else if (action == 'rename') {
            job.name = event.target.value.trim() || job.name;
        }
        else if (action == 'backend') {
            job.backend = event.target.value;
        }
        else if (action == 'clip') {
            job.clipDevice = event.target.value;
        }
        this.saveQueue();
    }
});
