/** Video Workspace method group 03. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Wires workspace controls to their actions. */
    bindEvents() {
        getRequiredElementById('video-workspace-new').addEventListener('click', () => this.newVideo());
        getRequiredElementById('video-workspace-reuse').addEventListener('click', () => this.reuseCurrentSettings());
        getRequiredElementById('video-workspace-use-source').addEventListener('click', () => this.useCurrentVideoAsSource());
        getRequiredElementById('video-workspace-queue-current').addEventListener('click', () => this.addCurrentToQueue());
        getRequiredElementById('video-workspace-generate-current').addEventListener('click', () => mainGenHandler.doGenerate());
        getRequiredElementById('video-workspace-save-pack').addEventListener('click', () => this.saveCurrentAsPack());
        getRequiredElementById('video-workspace-apply-pack').addEventListener('click', () => this.applySelectedPackToForm());
        getRequiredElementById('video-workspace-apply-pack-jobs').addEventListener('click', () => this.applySelectedPackToJobs());
        getRequiredElementById('video-workspace-duplicate-pack').addEventListener('click', () => this.duplicateSelectedPack());
        getRequiredElementById('video-workspace-delete-pack').addEventListener('click', () => this.deleteSelectedPack());
        getRequiredElementById('video-workspace-start-queue').addEventListener('click', () => this.toggleQueue());
        getRequiredElementById('video-workspace-run-selected').addEventListener('click', () => this.runSelected());
        getRequiredElementById('video-workspace-cancel-running').addEventListener('click', () => this.cancelRunning());
        getRequiredElementById('video-workspace-select-all').addEventListener('click', () => this.selectAllJobs());
        getRequiredElementById('video-workspace-clear-completed').addEventListener('click', () => this.clearFinished());
        getRequiredElementById('video-workspace-pack-select').addEventListener('change', () => this.syncPackName());
        getRequiredElementById('video-workspace-default-backend').addEventListener('change', event => {
            this.settings.defaultBackend = event.target.value;
            this.saveSettings();
        });
        getRequiredElementById('video-workspace-default-clip').addEventListener('change', event => {
            this.settings.defaultClipDevice = event.target.value;
            this.saveSettings();
        });
        getRequiredElementById('video-workspace-concurrency').addEventListener('change', event => {
            this.settings.concurrency = Math.max(1, Math.min(32, parseInt(event.target.value) || 1));
            event.target.value = this.settings.concurrency;
            this.saveSettings();
            this.pumpQueue();
        });
        getRequiredElementById('video-workspace-round-robin').addEventListener('change', event => {
            this.settings.roundRobin = event.target.checked;
            this.saveSettings();
        });
        getRequiredElementById('video-workspace-source-target').addEventListener('change', () => this.updateSourceLabel());
    },

    /** Adds video-specific actions to current-output and History menus. */
    registerMediaActions() {
        if (typeof registerMediaButton != 'function') {
            return;
        }
        registerMediaButton('Remix Video', src => this.remixVideo(src), 'Restore this video\'s settings and load it as the selected video source.', ['video'], true, true);
        registerMediaButton('Recreate Video', src => this.recreateVideo(src), 'Reuse this video\'s generation metadata, then open Video Workspace.', ['video'], true, true);
        registerMediaButton('Use As Video Source', src => this.setVideoSource(src, true), 'Load this video into the selected video-source parameter.', ['video'], false, true);
        registerMediaButton('Queue Recreate', src => this.queueRecreate(src), 'Reuse this video\'s settings and add the result to Video Workspace queue.', ['video'], false, true);
    },

    /** Opens the workspace tab. */
    openWorkspace() {
        let button = getRequiredElementById('video-workspace-tab-button');
        button.click();
    },

    /** Updates a small user-visible workspace status message. */
    setStatus(message, isError = false) {
        let elem = document.getElementById('video-workspace-status');
        if (!elem) {
            return;
        }
        elem.textContent = message;
        elem.classList.toggle('video-workspace-status-error', isError);
    },

    /** Returns a lower-case descriptor for a parameter and its containing groups. */
    describeParam(param) {
        let parts = [param.id, param.name, param.type, param.subtype];
        let group = param.group;
        while (group) {
            parts.push(group.id, group.name);
            group = group.parent;
        }
        return parts.filter(value => value).join(' ').toLowerCase();
    }
});
