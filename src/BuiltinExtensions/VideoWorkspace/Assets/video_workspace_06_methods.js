/** Video Workspace method group 06. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Duplicates the selected component pack. */
    duplicateSelectedPack() {
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        if (!pack) {
            this.setStatus('Select a component pack first.', true);
            return;
        }
        let copy = {
            ...this.clone(pack),
            id: this.makeId('pack'),
            name: `${pack.name} Copy`,
            updatedAt: Date.now()
        };
        this.componentPacks.push(copy);
        this.saveComponentPacks();
        this.renderComponentPacks(copy.id);
        this.setStatus(`Duplicated '${pack.name}'.`);
    },

    /** Deletes the selected component pack. */
    deleteSelectedPack() {
        let id = getRequiredElementById('video-workspace-pack-select').value;
        let pack = this.componentPacks.find(item => item.id == id);
        if (!pack) {
            this.setStatus('Select a component pack first.', true);
            return;
        }
        this.componentPacks = this.componentPacks.filter(item => item.id != id);
        this.saveComponentPacks();
        this.renderComponentPacks();
        this.setStatus(`Deleted component pack '${pack.name}'.`);
    },

    /** Opens the most relevant video groups for a fresh job without enabling every advanced option. */
    newVideo() {
        this.openWorkspace();
        let groups = new Map();
        for (let param of gen_param_types) {
            if (this.categoryForParam(param) != 'video') {
                continue;
            }
            let group = param.group;
            while (group) {
                groups.set(group.id, group);
                group = group.parent;
            }
        }
        for (let group of groups.values()) {
            if (typeof setGroupAdvancedOverride == 'function') {
                setGroupAdvancedOverride(group.id, true);
            }
            let content = document.getElementById(`input_group_content_${group.id}`);
            let parent = content ? findParentOfClass(content, 'input-group') : null;
            if (content && parent) {
                doGroupOpenUpdate(content, parent, true);
            }
        }
        this.setStatus(`Opened ${groups.size} video-related groups. Enable only the workflow controls you need, then generate or queue.`);
    },

    /** Reuses the currently selected output's metadata. */
    reuseCurrentSettings() {
        if (!currentMetadataVal) {
            this.setStatus('Select a generated video with metadata first.', true);
            return;
        }
        copy_current_image_params();
        this.openWorkspace();
        this.setStatus('Reused the selected output settings. Modify components, then generate or queue.');
    },

    /** Loads output metadata even when a History context action was used without selecting the video first. */
    withOutputMetadata(src, action) {
        if (currentImgSrc == src && currentMetadataVal) {
            action(currentMetadataVal);
            return;
        }
        let fullPath = getImageFullSrc(src);
        let slash = fullPath.lastIndexOf('/');
        let folder = slash == -1 ? '' : fullPath.substring(0, slash);
        let filename = slash == -1 ? fullPath : fullPath.substring(slash + 1);
        genericRequest('ListImages', { path: folder, depth: 1, sortBy: 'Name', sortReverse: false }, data => {
            let match = data.files?.find(file => file.src == filename);
            if (!match?.metadata) {
                this.setStatus(`No reusable generation metadata was found for '${filename}'.`, true);
                return;
            }
            setCurrentImage(src, match.metadata, 'history');
            action(match.metadata);
        });
    },

    /** Restores a selected video's settings and immediately loads that output as the remix source. */
    remixVideo(src) {
        this.sourceVideo = src;
        this.withOutputMetadata(src, () => {
            copy_current_image_params();
            this.openWorkspace();
            this.setVideoSource(src);
        });
    },

    /** Recreates a selected video by restoring its metadata. */
    recreateVideo(src) {
        this.sourceVideo = src;
        this.withOutputMetadata(src, () => {
            copy_current_image_params();
            this.openWorkspace();
            this.updateSourceLabel();
            this.setStatus('Reused the selected video settings. Swap components, modify controls, then generate or queue.');
        });
    },

    /** Restores selected video settings and captures the recreated job in the queue. */
    queueRecreate(src) {
        this.sourceVideo = src;
        this.withOutputMetadata(src, () => {
            copy_current_image_params();
            this.openWorkspace();
            this.addCurrentToQueue('Recreate Video');
        });
    },

    /** Returns all currently available video input parameters. */
    videoSourceParams() {
        return gen_param_types.filter(param => param.type == 'video' || param.type == 'video_list');
    }
});
