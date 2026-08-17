/** Video Workspace method group 07. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Refreshes dynamic backend, device, source-target, and component controls after parameter rebuilds. */
    refreshDynamicControls() {
        if (!this.initialized) {
            return;
        }
        this.refreshBackendOptions();
        this.refreshClipDeviceOptions();
        this.refreshSourceTargets();
        this.renderComponentSummary();
    },

    /** Reads available backend IDs from the Exact Backend ID parameter. */
    availableBackends() {
        let param = gen_param_types.find(item => item.id == 'exactbackendid' || this.describeParam(item).includes('exact backend'));
        let values = [];
        let names = [];
        if (param && param.values) {
            values = [...param.values];
            names = param.value_names ? [...param.value_names] : [...values];
        }
        let elem = document.getElementById('input_exactbackendid');
        if (elem && elem.options) {
            values = [...elem.options].map(option => option.value);
            names = [...elem.options].map(option => option.textContent);
        }
        let output = [];
        for (let i = 0; i < values.length; i++) {
            let value = `${values[i]}`;
            if (!value || value.toLowerCase() == 'any' || value.toLowerCase() == 'auto') {
                continue;
            }
            output.push({ value, name: names[i] || `Backend ${value}` });
        }
        return output;
    },

    /** Rebuilds the default backend selector. */
    refreshBackendOptions() {
        let select = document.getElementById('video-workspace-default-backend');
        if (!select) {
            return;
        }
        let prior = this.settings.defaultBackend || 'auto';
        select.innerHTML = '<option value="auto">Auto scheduler</option>';
        for (let backend of this.availableBackends()) {
            let option = document.createElement('option');
            option.value = backend.value;
            option.textContent = backend.name;
            select.appendChild(option);
        }
        select.value = [...select.options].some(option => option.value == prior) ? prior : 'auto';
        this.settings.defaultBackend = select.value;
        this.settings.concurrency = Math.max(1, this.settings.concurrency || 1);
        getRequiredElementById('video-workspace-concurrency').value = this.settings.concurrency;
        getRequiredElementById('video-workspace-round-robin').checked = this.settings.roundRobin;
    },

    /** Reads text-encoder device choices from Set CLIP Device. */
    availableClipDevices() {
        let param = gen_param_types.find(item => item.id == 'setclipdevice' || this.describeParam(item).includes('set clip device'));
        let values = param?.values ? [...param.values] : [];
        let elem = document.getElementById('input_setclipdevice');
        if (elem && elem.options) {
            values = [...elem.options].map(option => option.value);
        }
        return [...new Set(values.filter(value => value))];
    },

    /** Rebuilds the default text-encoder device selector. */
    refreshClipDeviceOptions() {
        let select = document.getElementById('video-workspace-default-clip');
        if (!select) {
            return;
        }
        let prior = this.settings.defaultClipDevice || 'default';
        select.innerHTML = '<option value="default">Backend default</option>';
        for (let device of this.availableClipDevices()) {
            let option = document.createElement('option');
            option.value = device;
            option.textContent = device;
            select.appendChild(option);
        }
        select.value = [...select.options].some(option => option.value == prior) ? prior : 'default';
        this.settings.defaultClipDevice = select.value;
    },

    /** Rebuilds the source-video target selector. */
    refreshSourceTargets() {
        let select = document.getElementById('video-workspace-source-target');
        if (!select) {
            return;
        }
        let prior = select.value;
        select.innerHTML = '';
        let params = this.videoSourceParams();
        if (params.length == 0) {
            select.innerHTML = '<option value="">No video input parameter available</option>';
            select.disabled = true;
            return;
        }
        select.disabled = false;
        params.sort((a, b) => {
            let score = param => /(source|input|init|video2video|extend)/.test(this.describeParam(param)) ? 0 : 1;
            return score(a) - score(b);
        });
        for (let param of params) {
            let option = document.createElement('option');
            option.value = param.id;
            option.textContent = param.name;
            select.appendChild(option);
        }
        if (prior && params.some(param => param.id == prior)) {
            select.value = prior;
        }
    }
});
