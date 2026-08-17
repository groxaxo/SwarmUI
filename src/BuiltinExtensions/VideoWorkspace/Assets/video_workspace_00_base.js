/** Dedicated generation handler that submits captured inputs exactly as queued, without inheriting the live form. */
class VideoWorkspaceGenerateHandler extends GenerateHandler {

    constructor(workspace, jobId) {
        super();
        this.workspace = workspace;
        this.jobId = jobId;
        this.validateModel = false;
        this.pendingImageCount = 1;
    }

    /** Uses the captured job input as-is rather than merging in the currently visible form. */
    getGenInput(input_overrides = {}, input_preoverrides = {}) {
        return this.workspace.clone(input_overrides);
    }

    /** Tracks the exact output count represented by the queued request. */
    beforeGenRun() {
        num_waiting_gens += this.pendingImageCount;
    }

    /** Submits one exact captured job. */
    doGenerateJob(input, postCollectRun) {
        this.pendingImageCount = this.workspace.expectedOutputs(input);
        this.doGenerate(input, {}, postCollectRun);
    }

    /** Forwards queue lifecycle data before the standard output UI consumes it. */
    internalHandleData(data, images, discardable, timeLastGenHit, actualInput, socketId, socket, isPreview, batch_id) {
        this.workspace.handleGenerationData(data, this.jobId);
        return super.internalHandleData(data, images, discardable, timeLastGenHit, actualInput, socketId, socket, isPreview, batch_id);
    }

    /** Associates an unscoped queue-handler error with this exact workspace job. */
    hadError(msg) {
        if (!this.workspace.handleQueueHandlerError(msg, this.jobId)) {
            super.hadError(msg);
        }
    }
}

/** Main Video Workspace state holder. Methods are attached by the following focused script files. */
class VideoWorkspaceHelper {

    constructor() {
        this.storagePrefix = 'swarmui.videoWorkspace.';
        this.queue = [];
        this.componentPacks = [];
        this.settings = {
            concurrency: 1,
            roundRobin: true,
            defaultBackend: 'auto',
            defaultClipDevice: 'default'
        };
        this.queueRunning = false;
        this.roundRobinIndex = 0;
        this.selectedJobs = new Set();
        this.sourceVideo = null;
        this.initialized = false;
        this.generateHandlers = new Map();
        this.categoryDefinitions = [
            { id: 'prompts', label: 'Prompts' },
            { id: 'models', label: 'Models' },
            { id: 'text_encoders', label: 'Text encoders' },
            { id: 'sampling', label: 'Sampling' },
            { id: 'video', label: 'Video controls' },
            { id: 'media', label: 'Media sources' },
            { id: 'output', label: 'Output / refine' },
            { id: 'routing', label: 'GPU routing' },
            { id: 'workflow', label: 'Other workflow inputs' }
        ];
        this.loadState();
        this.initializeWhenReady();
    }
}
