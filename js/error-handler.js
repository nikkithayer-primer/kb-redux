// Centralized error handling service

export class ErrorHandler {
    constructor() {
        this.errorQueue = [];
        this.maxQueueSize = 100;
        this.isShowingError = false;
    }

    // Error categories for different handling strategies
    static ErrorTypes = {
        NETWORK: 'network',
        VALIDATION: 'validation', 
        PERMISSION: 'permission',
        PROCESSING: 'processing',
        SYSTEM: 'system',
        USER_INPUT: 'user_input'
    };

    // Error severity levels
    static Severity = {
        LOW: 'low',       // Log only
        MEDIUM: 'medium', // Log + notify user
        HIGH: 'high',     // Log + notify + stop operation
        CRITICAL: 'critical' // Log + notify + stop + reload
    };

    handleError(error, context = {}) {
        const errorInfo = this.categorizeError(error, context);
        
        // Log all errors
        this.logError(errorInfo);
        
        // Add to queue for tracking
        this.addToQueue(errorInfo);
        
        // Handle based on severity
        switch (errorInfo.severity) {
            case ErrorHandler.Severity.LOW:
                // Just log, no user notification
                break;
                
            case ErrorHandler.Severity.MEDIUM:
                this.showUserNotification(errorInfo, false);
                break;
                
            case ErrorHandler.Severity.HIGH:
                this.showUserNotification(errorInfo, true);
                throw new Error(errorInfo.userMessage);
                
            case ErrorHandler.Severity.CRITICAL:
                this.showCriticalError(errorInfo);
                throw new Error(errorInfo.userMessage);
        }
        
        return errorInfo;
    }

    categorizeError(error, context) {
        let type = ErrorHandler.ErrorTypes.SYSTEM;
        let severity = ErrorHandler.Severity.MEDIUM;
        let userMessage = 'An unexpected error occurred';
        let recoverable = true;

        // Network errors
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            type = ErrorHandler.ErrorTypes.NETWORK;
            userMessage = 'Network connection failed. Please check your internet connection.';
            severity = ErrorHandler.Severity.HIGH;
            recoverable = true;
        }
        // Firebase errors
        else if (error.code && error.code.startsWith('firestore/')) {
            type = ErrorHandler.ErrorTypes.NETWORK;
            severity = ErrorHandler.Severity.HIGH;
            
            switch (error.code) {
                case 'firestore/permission-denied':
                    type = ErrorHandler.ErrorTypes.PERMISSION;
                    userMessage = 'Access denied. Please check your permissions.';
                    break;
                case 'firestore/unavailable':
                    userMessage = 'Database temporarily unavailable. Please try again.';
                    break;
                case 'firestore/quota-exceeded':
                    userMessage = 'Database quota exceeded. Please contact support.';
                    severity = ErrorHandler.Severity.CRITICAL;
                    break;
                default:
                    userMessage = 'Database operation failed. Please try again.';
            }
        }
        // Validation errors
        else if (context.operation === 'validation' || error.name === 'ValidationError') {
            type = ErrorHandler.ErrorTypes.VALIDATION;
            severity = ErrorHandler.Severity.MEDIUM;
            userMessage = error.message || 'Invalid data provided';
            recoverable = true;
        }
        // Processing errors
        else if (context.operation === 'processing') {
            type = ErrorHandler.ErrorTypes.PROCESSING;
            severity = ErrorHandler.Severity.MEDIUM;
            userMessage = 'Failed to process data. Please try again.';
            recoverable = true;
        }
        // User input errors
        else if (context.source === 'user_input') {
            type = ErrorHandler.ErrorTypes.USER_INPUT;
            severity = ErrorHandler.Severity.LOW;
            userMessage = 'Please check your input and try again.';
            recoverable = true;
        }

        return {
            originalError: error,
            type,
            severity,
            userMessage,
            recoverable,
            context,
            timestamp: new Date(),
            id: this.generateErrorId()
        };
    }

    logError(errorInfo) {
        const logLevel = this.getLogLevel(errorInfo.severity);
        const logMessage = `[${errorInfo.type.toUpperCase()}] ${errorInfo.userMessage}`;
        
        console[logLevel](logMessage, {
            error: errorInfo.originalError,
            context: errorInfo.context,
            timestamp: errorInfo.timestamp,
            id: errorInfo.id
        });
    }

    showUserNotification(errorInfo, blocking = false) {
        if (this.isShowingError && !blocking) {
            return; // Don't spam user with multiple notifications
        }

        this.isShowingError = true;
        
        const statusDiv = document.getElementById('statusMessage');
        if (statusDiv) {
            statusDiv.textContent = errorInfo.userMessage;
            statusDiv.className = `status-message status-error ${errorInfo.severity}`;
            statusDiv.style.display = 'block';
            
            // Auto-hide non-critical errors
            if (errorInfo.severity !== ErrorHandler.Severity.CRITICAL) {
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                    this.isShowingError = false;
                }, 5000);
            }
        }

        // Also show in console for debugging
        console.warn('User notification:', errorInfo.userMessage);
    }

    showCriticalError(errorInfo) {
        const statusDiv = document.getElementById('statusMessage');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div class="critical-error">
                    <h3>Critical Error</h3>
                    <p>${errorInfo.userMessage}</p>
                    <button onclick="window.location.reload()" class="btn btn-primary">
                        Reload Application
                    </button>
                </div>
            `;
            statusDiv.className = 'status-message status-critical';
            statusDiv.style.display = 'block';
        }
    }

    // Utility methods
    generateErrorId() {
        return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getLogLevel(severity) {
        switch (severity) {
            case ErrorHandler.Severity.LOW: return 'log';
            case ErrorHandler.Severity.MEDIUM: return 'warn';
            case ErrorHandler.Severity.HIGH: return 'error';
            case ErrorHandler.Severity.CRITICAL: return 'error';
            default: return 'log';
        }
    }

    addToQueue(errorInfo) {
        this.errorQueue.push(errorInfo);
        
        // Keep queue size manageable
        if (this.errorQueue.length > this.maxQueueSize) {
            this.errorQueue.shift();
        }
    }

    // Get error statistics
    getErrorStats() {
        const stats = {
            total: this.errorQueue.length,
            byType: {},
            bySeverity: {},
            recent: this.errorQueue.slice(-10)
        };

        this.errorQueue.forEach(error => {
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
            stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
        });

        return stats;
    }

    // Clear error history
    clearErrors() {
        this.errorQueue = [];
        const statusDiv = document.getElementById('statusMessage');
        if (statusDiv) {
            statusDiv.style.display = 'none';
        }
        this.isShowingError = false;
    }

    // Wrapper for async operations with error handling
    async withErrorHandling(operation, context = {}) {
        try {
            return await operation();
        } catch (error) {
            const errorInfo = this.handleError(error, context);
            if (!errorInfo.recoverable) {
                throw error;
            }
            return null;
        }
    }

    // Create a safe version of a function that won't throw
    makeSafe(fn, context = {}) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handleError(error, { ...context, args });
                return null;
            }
        };
    }
}

// Create global instance
export const errorHandler = new ErrorHandler();
