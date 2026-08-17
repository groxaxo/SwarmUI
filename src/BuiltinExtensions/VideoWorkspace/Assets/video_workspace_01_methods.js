/** Video Workspace method group 01. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Runs initialization after the Generate page DOM and core helpers are available. */
    initializeWhenReady() {
        let initialize = () => {
            if (this.initialized || !document.getElementById('bottombartabcollection') || !document.getElementById('t2i_bottom_bar_content')) {
                if (!this.initialized) {
                    setTimeout(initialize, 50);
                }
                return;
            }
            this.initialized = true;
            this.injectWorkspace();
            this.bindEvents();
            this.registerMediaActions();
            if (typeof postParamBuildSteps != 'undefined') {
                postParamBuildSteps.push(() => this.refreshDynamicControls());
            }
            this.refreshDynamicControls();
            this.renderComponentPacks();
            this.renderQueue();
            this.updateQueueControls();
        };
        if (document.readyState == 'loading') {
            document.addEventListener('DOMContentLoaded', initialize);
        }
        else {
            initialize();
        }
    },

    /** Safely loads JSON from local storage. */
    loadJSON(key, fallback) {
        try {
            let raw = localStorage.getItem(this.storagePrefix + key);
            return raw ? JSON.parse(raw) : fallback;
        }
        catch (e) {
            console.log(`Video Workspace could not load '${key}':`, e);
            return fallback;
        }
    },

    /** Restores persistent component packs, queue entries, and workspace settings. */
    loadState() {
        this.componentPacks = this.loadJSON('componentPacks', []);
        this.settings = { ...this.settings, ...this.loadJSON('settings', {}) };
        this.queue = this.loadJSON('queue', []).map(job => ({
            ...job,
            status: ['running', 'submitting'].includes(job.status) ? 'queued' : (job.status || 'queued'),
            outputs: job.outputs || [],
            completedOutputs: 0,
            expectedOutputs: this.expectedOutputs(job.input || {})
        }));
    },

    /** Saves workspace settings. */
    saveSettings() {
        localStorage.setItem(this.storagePrefix + 'settings', JSON.stringify(this.settings));
    },

    /** Saves component packs. Packs never contain inline media blobs. */
    saveComponentPacks() {
        localStorage.setItem(this.storagePrefix + 'componentPacks', JSON.stringify(this.componentPacks));
    },

    /** Saves queue entries that do not contain session-only inline media data. */
    saveQueue() {
        let persistentJobs = this.queue.filter(job => !job.sessionOnly).map(job => ({
            ...job,
            status: ['running', 'submitting'].includes(job.status) ? 'queued' : job.status,
            completedOutputs: 0
        }));
        localStorage.setItem(this.storagePrefix + 'queue', JSON.stringify(persistentJobs));
    },

    /** Returns a stable unique identifier for a queue job or component pack. */
    makeId(prefix) {
        if (window.crypto && typeof window.crypto.randomUUID == 'function') {
            return `${prefix}-${window.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    },

    /** Deep-clones ordinary generation input data. */
    clone(value) {
        return JSON.parse(JSON.stringify(value));
    },

    /** Returns true when a value recursively contains an inline data URL. */
    containsInlineMedia(value) {
        if (typeof value == 'string') {
            return value.startsWith('data:') || value.length > 2_000_000;
        }
        if (Array.isArray(value)) {
            return value.some(item => this.containsInlineMedia(item));
        }
        if (value && typeof value == 'object') {
            return Object.values(value).some(item => this.containsInlineMedia(item));
        }
        return false;
    }
});
