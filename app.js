// Main application entry point with modular architecture

import { KnowledgeBaseApp } from './js/knowledge-base-app.js';

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new KnowledgeBaseApp();
        console.log('Knowledge Base App initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Knowledge Base App:', error);
        
        // Show error to user
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = 'Failed to initialize application: ' + error.message;
            statusDiv.className = 'status error';
        }
    }
});

// Export for global access if needed
export { KnowledgeBaseApp };
