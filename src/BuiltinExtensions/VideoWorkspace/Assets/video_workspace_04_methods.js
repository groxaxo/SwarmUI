/** Video Workspace method group 04. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Classifies a generation parameter into one swappable workspace component category. */
    categoryForParam(param) {
        let descriptor = this.describeParam(param);
        if (descriptor.includes('exactbackend') || descriptor.includes('backend type') || descriptor.includes('set clip device')) {
            return 'routing';
        }
        if (param.type == 'image' || param.type == 'image_list' || param.type == 'audio' || param.type == 'audio_list' || param.type == 'video' || param.type == 'video_list') {
            return 'media';
        }
        if (param.id == 'prompt' || param.id == 'negativeprompt' || param.view_type == 'prompt') {
            return 'prompts';
        }
        if (param.type == 'model' && /(clip|t5|llama|qwen|mistral|gemma|gpt.?oss|text.?enc)/.test(descriptor)) {
            return 'text_encoders';
        }
        if (param.type == 'model') {
            return 'models';
        }
        if (descriptor.includes('video')) {
            return 'video';
        }
        if (/(sampler|scheduler|steps|cfg|guidance|seed|sigma|denoise|creativity|conditioning)/.test(descriptor)) {
            return 'sampling';
        }
        if (/(format|resolution|width|height|upscale|refine|output|images|batch|trim|interpol)/.test(descriptor)) {
            return 'output';
        }
        return 'workflow';
    },

    /** Returns currently selected component-pack categories. */
    selectedCategories() {
        return [...document.querySelectorAll('[data-video-workspace-category]')]
            .filter(elem => elem.checked)
            .map(elem => elem.dataset.videoWorkspaceCategory);
    },

    /** Returns current generation values for selected component categories. */
    captureComponentValues(categories) {
        let input = getGenInput();
        let values = {};
        for (let param of gen_param_types) {
            let category = this.categoryForParam(param);
            if (!category || !categories.includes(category) || !(param.id in input)) {
                continue;
            }
            let value = input[param.id];
            if (category == 'media' && this.containsInlineMedia(value)) {
                continue;
            }
            values[param.id] = this.clone(value);
        }
        return values;
    },

    /** Saves the selected current parameter categories as a named reusable component pack. */
    saveCurrentAsPack() {
        let nameInput = getRequiredElementById('video-workspace-pack-name');
        let name = nameInput.value.trim() || `Video Pack ${this.componentPacks.length + 1}`;
        let categories = this.selectedCategories();
        let values = this.captureComponentValues(categories);
        if (Object.keys(values).length == 0) {
            this.setStatus('No enabled parameters matched the selected component categories.', true);
            return;
        }
        let selectedId = getRequiredElementById('video-workspace-pack-select').value;
        let existing = this.componentPacks.find(pack => pack.id == selectedId);
        if (existing) {
            existing.name = name;
            existing.categories = categories;
            existing.values = values;
            existing.updatedAt = Date.now();
        }
        else {
            existing = {
                id: this.makeId('pack'),
                name,
                categories,
                values,
                updatedAt: Date.now()
            };
            this.componentPacks.push(existing);
        }
        this.saveComponentPacks();
        this.renderComponentPacks(existing.id);
        this.setStatus(`Saved component pack '${name}' with ${Object.keys(values).length} parameters.`);
    },

    /** Renders the component-pack selector and component summary. */
    renderComponentPacks(preferredId = null) {
        let select = document.getElementById('video-workspace-pack-select');
        if (!select) {
            return;
        }
        let prior = preferredId || select.value;
        select.innerHTML = '<option value="">(New component pack)</option>';
        for (let pack of this.componentPacks) {
            let option = document.createElement('option');
            option.value = pack.id;
            option.textContent = pack.name;
            select.appendChild(option);
        }
        if (prior && this.componentPacks.some(pack => pack.id == prior)) {
            select.value = prior;
        }
        getRequiredElementById('video-workspace-pack-count').textContent = `${this.componentPacks.length} pack${this.componentPacks.length == 1 ? '' : 's'}`;
        this.syncPackName();
        this.renderComponentSummary();
    },

    /** Synchronizes selected component pack name and category checkboxes. */
    syncPackName() {
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        getRequiredElementById('video-workspace-pack-name').value = pack ? pack.name : '';
        if (pack) {
            for (let checkbox of document.querySelectorAll('[data-video-workspace-category]')) {
                checkbox.checked = pack.categories.includes(checkbox.dataset.videoWorkspaceCategory);
            }
        }
        this.renderComponentSummary();
    }
});
