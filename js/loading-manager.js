// Loading state management and progress tracking

export class LoadingManager {
    constructor() {
        this.activeOperations = new Map();
        this.loadingOverlay = null;
        this.progressBar = null;
        this.statusText = null;
        this.cancelCallbacks = new Map();
        
        this.initializeUI();
    }

    initializeUI() {
        // Create loading overlay if it doesn't exist
        if (!document.getElementById('loadingOverlay')) {
            this.createLoadingOverlay();
        }
        
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.progressBar = document.getElementById('progressBar');
        this.statusText = document.getElementById('loadingStatus');
    }

    createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.className = 'loading-overlay hidden';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <div class="loading-info">
                    <div id="loadingStatus" class="loading-status">Loading...</div>
                    <div class="progress-container">
                        <div id="progressBar" class="progress-bar">
                            <div class="progress-fill"></div>
                        </div>
                        <div id="progressText" class="progress-text">0%</div>
                    </div>
                    <div class="loading-actions">
                        <button id="cancelLoadingBtn" class="btn btn-secondary">Cancel</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Add cancel functionality
        document.getElementById('cancelLoadingBtn').addEventListener('click', () => {
            this.cancelAllOperations();
        });
    }

    // Start a loading operation
    startOperation(operationId, config = {}) {
        const operation = {
            id: operationId,
            startTime: Date.now(),
            status: config.status || 'Loading...',
            progress: 0,
            cancellable: config.cancellable !== false,
            showProgress: config.showProgress !== false,
            timeout: config.timeout || 30000, // 30 second default timeout
            onCancel: config.onCancel
        };

        this.activeOperations.set(operationId, operation);
        
        // Set up timeout
        if (operation.timeout) {
            setTimeout(() => {
                if (this.activeOperations.has(operationId)) {
                    this.timeoutOperation(operationId);
                }
            }, operation.timeout);
        }

        this.updateUI();
        return operation;
    }

    // Update operation progress
    updateProgress(operationId, progress, status) {
        const operation = this.activeOperations.get(operationId);
        if (!operation) return;

        operation.progress = Math.max(0, Math.min(100, progress));
        if (status) operation.status = status;

        this.updateUI();
    }

    // Complete an operation
    completeOperation(operationId) {
        const operation = this.activeOperations.get(operationId);
        if (operation) {
            this.activeOperations.delete(operationId);
            this.cancelCallbacks.delete(operationId);
        }

        this.updateUI();
    }

    // Cancel a specific operation
    cancelOperation(operationId) {
        const operation = this.activeOperations.get(operationId);
        if (!operation) return;

        // Call cancel callback if provided
        const cancelCallback = this.cancelCallbacks.get(operationId);
        if (cancelCallback) {
            try {
                cancelCallback();
            } catch (error) {
                console.error('Error in cancel callback:', error);
            }
        }

        // Call operation's onCancel if provided
        if (operation.onCancel) {
            try {
                operation.onCancel();
            } catch (error) {
                console.error('Error in operation onCancel:', error);
            }
        }

        this.activeOperations.delete(operationId);
        this.cancelCallbacks.delete(operationId);
        this.updateUI();
    }

    // Cancel all operations
    cancelAllOperations() {
        const operationIds = Array.from(this.activeOperations.keys());
        operationIds.forEach(id => this.cancelOperation(id));
    }

    // Set cancel callback for an operation
    setCancelCallback(operationId, callback) {
        this.cancelCallbacks.set(operationId, callback);
    }

    // Timeout an operation
    timeoutOperation(operationId) {
        const operation = this.activeOperations.get(operationId);
        if (!operation) return;

        console.warn(`Operation ${operationId} timed out after ${operation.timeout}ms`);
        this.cancelOperation(operationId);
        
        // Show timeout message
        if (this.statusText) {
            this.statusText.textContent = 'Operation timed out';
        }
    }

    // Update the UI based on current operations
    updateUI() {
        const hasOperations = this.activeOperations.size > 0;
        
        if (!this.loadingOverlay) return;

        if (hasOperations) {
            this.showLoading();
        } else {
            this.hideLoading();
        }
    }

    showLoading() {
        if (!this.loadingOverlay) return;

        this.loadingOverlay.classList.remove('hidden');
        
        // Calculate overall progress and status
        const operations = Array.from(this.activeOperations.values());
        const totalProgress = operations.reduce((sum, op) => sum + op.progress, 0);
        const avgProgress = operations.length > 0 ? totalProgress / operations.length : 0;
        
        // Update progress bar
        if (this.progressBar) {
            const progressFill = this.progressBar.querySelector('.progress-fill');
            if (progressFill) {
                progressFill.style.width = `${avgProgress}%`;
            }
        }

        // Update progress text
        const progressText = document.getElementById('progressText');
        if (progressText) {
            progressText.textContent = `${Math.round(avgProgress)}%`;
        }

        // Update status text
        if (this.statusText && operations.length > 0) {
            const currentOp = operations[operations.length - 1]; // Show latest operation
            this.statusText.textContent = currentOp.status;
        }

        // Update cancel button visibility
        const cancelBtn = document.getElementById('cancelLoadingBtn');
        if (cancelBtn) {
            const hasCancellable = operations.some(op => op.cancellable);
            cancelBtn.style.display = hasCancellable ? 'block' : 'none';
        }
    }

    hideLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('hidden');
        }
    }

    // Utility method to wrap async operations with loading
    async withLoading(operationId, asyncOperation, config = {}) {
        this.startOperation(operationId, config);
        
        try {
            // Set up cancellation if the operation supports it
            if (config.cancellable && asyncOperation.cancel) {
                this.setCancelCallback(operationId, () => asyncOperation.cancel());
            }

            const result = await asyncOperation();
            this.completeOperation(operationId);
            return result;
        } catch (error) {
            this.completeOperation(operationId);
            throw error;
        }
    }

    // Create a loading wrapper for functions
    createLoadingWrapper(operationId, config = {}) {
        return async (asyncOperation) => {
            return this.withLoading(operationId, asyncOperation, config);
        };
    }

    // Batch operations with shared loading state
    async withBatchLoading(operations, config = {}) {
        const batchId = `batch_${Date.now()}`;
        this.startOperation(batchId, {
            status: config.status || 'Processing batch operations...',
            ...config
        });

        try {
            const results = [];
            const total = operations.length;

            for (let i = 0; i < operations.length; i++) {
                const progress = ((i + 1) / total) * 100;
                this.updateProgress(batchId, progress, 
                    config.getStatus ? config.getStatus(i, total) : `Processing ${i + 1}/${total}...`
                );

                const result = await operations[i]();
                results.push(result);
            }

            this.completeOperation(batchId);
            return results;
        } catch (error) {
            this.completeOperation(batchId);
            throw error;
        }
    }

    // Get current loading state
    getLoadingState() {
        return {
            isLoading: this.activeOperations.size > 0,
            operationCount: this.activeOperations.size,
            operations: Array.from(this.activeOperations.entries()).map(([id, op]) => ({
                id,
                status: op.status,
                progress: op.progress,
                duration: Date.now() - op.startTime
            }))
        };
    }

    // Debug method
    debug() {
        console.log('LoadingManager state:', this.getLoadingState());
    }
}

// Create global instance
export const loadingManager = new LoadingManager();
