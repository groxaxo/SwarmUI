/** Video Workspace method group 02. */
Object.assign(VideoWorkspaceHelper.prototype, {
    /** Creates the Video Workspace bottom tab and its UI. */
    injectWorkspace() {
        if (document.getElementById('Video-Workspace-Tab')) {
            return;
        }
        let tabList = getRequiredElementById('bottombartabcollection');
        let tabContent = getRequiredElementById('t2i_bottom_bar_content');
        let tabItem = document.createElement('li');
        tabItem.className = 'nav-item';
        tabItem.setAttribute('role', 'presentation');
        tabItem.innerHTML = '<a class="nav-link" id="video-workspace-tab-button" data-bs-toggle="tab" href="#Video-Workspace-Tab" aria-selected="false" tabindex="-1" role="tab">Video Workspace</a>';
        tabList.appendChild(tabItem);

        let pane = createDiv('Video-Workspace-Tab', 'tab-pane genpage-bottom-tab video-workspace-pane');
        pane.setAttribute('role', 'tabpanel');
        pane.innerHTML = `
            <div class="video-workspace-shell">
                <div class="video-workspace-header">
                    <div>
                        <h3>Video Workspace</h3>
                        <p>Create, modify, extend, recreate, and queue videos without rebuilding the same parameter stack.</p>
                    </div>
                    <div class="video-workspace-actions">
                        <button class="basic-button" id="video-workspace-new">New Video</button>
                        <button class="basic-button" id="video-workspace-reuse">Reuse Current Settings</button>
                        <button class="basic-button" id="video-workspace-use-source">Use Current Video As Source</button>
                        <button class="basic-button" id="video-workspace-queue-current">Queue Current</button>
                        <button class="basic-button" id="video-workspace-generate-current">Generate Now</button>
                    </div>
                </div>
                <div class="video-workspace-grid">
                    <section class="video-workspace-card">
                        <div class="video-workspace-card-heading">
                            <div>
                                <h4>Swappable component packs</h4>
                                <p>Capture only the component groups you need, then apply them to the current form or selected queued jobs.</p>
                            </div>
                            <span class="video-workspace-badge" id="video-workspace-pack-count">0 packs</span>
                        </div>
                        <div class="video-workspace-row">
                            <label for="video-workspace-pack-select">Pack</label>
                            <select id="video-workspace-pack-select" class="auto-dropdown"></select>
                            <input id="video-workspace-pack-name" class="auto-text" type="text" placeholder="Pack name" />
                        </div>
                        <div class="video-workspace-categories" id="video-workspace-categories"></div>
                        <div class="video-workspace-actions compact">
                            <button class="basic-button" id="video-workspace-save-pack">Save Current As Pack</button>
                            <button class="basic-button" id="video-workspace-apply-pack">Apply To Form</button>
                            <button class="basic-button" id="video-workspace-apply-pack-jobs">Apply To Selected Jobs</button>
                            <button class="basic-button" id="video-workspace-duplicate-pack">Duplicate</button>
                            <button class="basic-button danger-button" id="video-workspace-delete-pack">Delete</button>
                        </div>
                        <div class="video-workspace-component-summary" id="video-workspace-component-summary"></div>
                    </section>
                    <section class="video-workspace-card">
                        <div class="video-workspace-card-heading">
                            <div>
                                <h4>GPU routing and queue dispatch</h4>
                                <p>Pin jobs to one ComfyUI backend or rotate them across independent GPU backends.</p>
                            </div>
                            <span class="video-workspace-badge" id="video-workspace-active-count">0 active</span>
                        </div>
                        <div class="video-workspace-routing-grid">
                            <label>Default backend
                                <select id="video-workspace-default-backend" class="auto-dropdown"></select>
                            </label>
                            <label>Text encoder device
                                <select id="video-workspace-default-clip" class="auto-dropdown"></select>
                            </label>
                            <label>Concurrent submissions
                                <input id="video-workspace-concurrency" type="number" min="1" max="32" step="1" value="1" />
                            </label>
                            <label class="video-workspace-check-label">
                                <input id="video-workspace-round-robin" type="checkbox" /> Round-robin automatic jobs across backends
                            </label>
                        </div>
                        <div class="video-workspace-source-target">
                            <label for="video-workspace-source-target">Video source parameter</label>
                            <select id="video-workspace-source-target" class="auto-dropdown"></select>
                            <span id="video-workspace-source-label">No source video selected</span>
                        </div>
                        <div class="video-workspace-note">
                            The selected backend owns the diffusion model and VAE for that job. Text encoders can be moved separately when the backend exposes <code>Set CLIP Device</code>. Arbitrary node-level sharding still depends on the ComfyUI workflow or custom nodes used.
                        </div>
                    </section>
                </div>
                <section class="video-workspace-card video-workspace-queue-card">
                    <div class="video-workspace-card-heading">
                        <div>
                            <h4>Video job queue</h4>
                            <p>Edit, duplicate, reorder, retry, and route each captured job before dispatch.</p>
                        </div>
                        <div class="video-workspace-actions compact">
                            <button class="basic-button" id="video-workspace-start-queue">Start Queue</button>
                            <button class="basic-button" id="video-workspace-run-selected">Prioritize Selected</button>
                            <button class="basic-button danger-button" id="video-workspace-cancel-running">Cancel Running</button>
                            <button class="basic-button" id="video-workspace-select-all">Select All</button>
                            <button class="basic-button" id="video-workspace-clear-completed">Clear Finished</button>
                        </div>
                    </div>
                    <div class="video-workspace-queue" id="video-workspace-queue"></div>
                </section>
                <div class="video-workspace-status" id="video-workspace-status">Ready.</div>
            </div>`;
        tabContent.appendChild(pane);

        let categories = getRequiredElementById('video-workspace-categories');
        for (let category of this.categoryDefinitions) {
            let label = document.createElement('label');
            label.className = 'video-workspace-check-label';
            label.innerHTML = `<input type="checkbox" data-video-workspace-category="${category.id}" checked /> ${escapeHtml(category.label)}`;
            categories.appendChild(label);
        }
    }
});
