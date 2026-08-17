/** Video Workspace method group 05. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Shows a compact summary of the selected pack or component categories ready to capture. */
    renderComponentSummary() {
        let target = document.getElementById('video-workspace-component-summary');
        if (!target) {
            return;
        }
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        if (!pack) {
            let categories = this.selectedCategories().map(category => this.categoryDefinitions.find(item => item.id == category)?.label || category);
            target.innerHTML = categories.length > 0
                ? `<span class="video-workspace-muted">Ready to capture: ${escapeHtml(categories.join(', '))}</span>`
                : '<span class="video-workspace-muted">Select at least one component category.</span>';
            return;
        }
        let entries = Object.entries(pack.values).slice(0, 18);
        if (entries.length == 0) {
            target.innerHTML = '<span class="video-workspace-muted">This pack has no captured components.</span>';
            return;
        }
        target.innerHTML = entries.map(([key, value]) => {
            let display = Array.isArray(value) ? value.join(', ') : `${value}`;
            if (display.length > 90) {
                display = `${display.substring(0, 87)}...`;
            }
            return `<span><b>${escapeHtml(key)}</b>: ${escapeHtml(display)}</span>`;
        }).join('');
    },

    /** Enables a parameter and all of its toggleable parent groups. */
    enableParam(param) {
        if (param.toggleable) {
            let toggle = document.getElementById(`input_${param.id}_toggle`);
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                doToggleEnable(`input_${param.id}`);
                triggerChangeFor(toggle);
            }
        }
        let group = param.group;
        while (group) {
            if (group.toggles) {
                let toggle = document.getElementById(`input_group_content_${group.id}_toggle`);
                if (toggle && !toggle.checked) {
                    toggle.checked = true;
                    triggerChangeFor(toggle);
                }
            }
            group = group.parent;
        }
        let elem = document.getElementById(`input_${param.id}`);
        if (elem && param.group) {
            toggleGroupOpen(elem, true);
        }
    },

    /** Applies a map of generation parameter values to the Generate form. */
    applyValuesToForm(values, skipInlineMedia = true) {
        let applied = 0;
        for (let param of gen_param_types) {
            if (!(param.id in values)) {
                continue;
            }
            let value = values[param.id];
            if (skipInlineMedia && this.containsInlineMedia(value)) {
                continue;
            }
            let elem = document.getElementById(`input_${param.id}`);
            if (!elem) {
                continue;
            }
            this.enableParam(param);
            try {
                setDirectParamValue(param, this.clone(value));
                applied++;
            }
            catch (e) {
                console.log(`Video Workspace could not apply parameter '${param.id}':`, e);
            }
        }
        if ('model' in values && values.model) {
            try {
                currentModelHelper.directSetModel(values.model);
            }
            catch (e) {
                console.log('Video Workspace could not set current model:', e);
            }
        }
        hideUnsupportableParams();
        return applied;
    },

    /** Applies the selected component pack to the current Generate form. */
    applySelectedPackToForm() {
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        if (!pack) {
            this.setStatus('Select a component pack first.', true);
            return;
        }
        let applied = this.applyValuesToForm(pack.values);
        this.setStatus(`Applied '${pack.name}' to ${applied} form parameters.`);
    },

    /** Applies the selected component pack to selected queued jobs. */
    applySelectedPackToJobs() {
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        if (!pack) {
            this.setStatus('Select a component pack first.', true);
            return;
        }
        let jobs = this.queue.filter(job => this.selectedJobs.has(job.id) && !['running', 'submitting'].includes(job.status));
        if (jobs.length == 0) {
            this.setStatus('Select at least one queued or finished job.', true);
            return;
        }
        for (let job of jobs) {
            job.input = { ...job.input, ...this.clone(pack.values) };
            if (pack.values.exactbackendid) {
                job.backend = `${pack.values.exactbackendid}`;
            }
            if (pack.values.setclipdevice) {
                job.clipDevice = `${pack.values.setclipdevice}`;
            }
            job.expectedOutputs = this.expectedOutputs(job.input);
            job.status = 'queued';
            job.error = null;
            delete job.startedAt;
            delete job.completedAt;
            delete job.actualInput;
            delete job.resolvedBackend;
            job.outputs = [];
            job.completedOutputs = 0;
            job.sessionOnly = this.containsInlineMedia(job.input);
        }
        this.saveQueue();
        this.renderQueue();
        this.setStatus(`Applied '${pack.name}' to ${jobs.length} selected job${jobs.length == 1 ? '' : 's'}.`);
    }
});
