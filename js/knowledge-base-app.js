// Main application class that orchestrates all modules

import { CSVParser } from './csv-parser.js';
import { WikidataService } from './wikidata-service.js';
import { FirebaseService } from './firebase-service.js';
import { DateTimeProcessor } from './datetime-processor.js';
import { EntityProcessor } from './entity-processor.js';
import { TableManager } from './table-manager.js';
import { EntityProfile } from './profile.js';
import { DeduplicationService } from './deduplication-service.js';
import { errorHandler } from './error-handler.js';
import { loadingManager } from './loading-manager.js';

export class KnowledgeBaseApp {
    constructor() {
        // Initialize services
        this.csvParser = new CSVParser();
        this.wikidataService = new WikidataService();
        this.firebaseService = new FirebaseService();
        this.dateTimeProcessor = new DateTimeProcessor();
        this.entityProcessor = new EntityProcessor(this.wikidataService, this.firebaseService, this.dateTimeProcessor);
        this.tableManager = new TableManager();
        this.deduplicationService = new DeduplicationService();
        
        // Initialize UI
        this.initializeEventListeners();
        this.loadExistingData();
        
        // Make some methods globally accessible for debugging
        window.clearWikidataCache = () => this.entityProcessor.clearWikidataCache();
        window.debugEntityProcessor = () => console.log('EntityProcessor cache stats:', this.entityProcessor.getCacheStats());
    }

    initializeEventListeners() {
        // File upload
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Deduplication button
        document.getElementById('deduplicationBtn').addEventListener('click', () => this.runDeduplication());
        
        // Export knowledge base button
        document.getElementById('exportKnowledgeBaseBtn').addEventListener('click', () => this.exportKnowledgeBase());
        
        // Wipe database button
        document.getElementById('wipeDatabaseBtn').addEventListener('click', () => this.wipeDatabaseWithConfirmation());
        
        // Manual entry modal
        document.getElementById('manualEntryBtn').addEventListener('click', () => this.showManualEntryModal());
        document.getElementById('closeManualEntryModal').addEventListener('click', () => this.hideManualEntryModal());
        document.getElementById('cancelManualEntry').addEventListener('click', () => this.hideManualEntryModal());
        document.getElementById('manualEntryForm').addEventListener('submit', (e) => this.handleManualEntrySubmit(e));
        
        // Table manager events
        this.tableManager.initializeEventListeners();
        
        // Profile view events
        const backBtn = document.getElementById('backToMainBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.showMainView());
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    async processFile(file) {
        try {
            this.showStatus('Reading CSV file...', 'info');
            const rows = await this.csvParser.parseFile(file);
            this.showStatus(`Loaded ${rows.length} rows from CSV`, 'success');
            
            
            // Automatically start processing the data
            setTimeout(() => this.processData(), 1000);
        } catch (error) {
            this.showStatus('Error reading CSV file: ' + error.message, 'error');
            console.error('CSV parsing error:', error);
        }
    }

    async processData() {
        if (!this.csvParser.rawData) {
            this.showStatus('Please select a CSV file first', 'error');
            return;
        }

        const operationId = 'process_data';
        
        try {
            const totalRows = this.csvParser.rawData.length;
            
            // Start loading with cancellation support and longer timeout
            const abortController = new AbortController();
            loadingManager.startOperation(operationId, {
                status: `Processing ${totalRows} rows...`,
                cancellable: true,
                timeout: Math.max(120000, totalRows * 2000), // Dynamic timeout: 2 seconds per row, minimum 2 minutes
                onCancel: () => abortController.abort()
            });

            let processedRows = 0;
            let skippedDuplicates = 0;
            const batchSize = 5; // Process rows in smaller batches

            // Process rows in batches to prevent timeout and provide better progress feedback
            for (let i = 0; i < this.csvParser.rawData.length; i += batchSize) {
                // Check for cancellation
                if (abortController.signal.aborted) {
                    throw new Error('Operation cancelled by user');
                }

                const batch = this.csvParser.rawData.slice(i, i + batchSize);
                const batchPromises = batch.map(async (row, batchIndex) => {
                    try {
                        await this.processRow(row);
                        return { success: true, index: i + batchIndex };
                    } catch (rowError) {
                        errorHandler.handleError(rowError, { 
                            operation: 'process_row', 
                            rowIndex: i + batchIndex + 1,
                            severity: errorHandler.constructor.Severity.LOW 
                        });
                        return { success: false, index: i + batchIndex, error: rowError };
                    }
                });

                // Process batch with timeout protection
                try {
                    const batchResults = await Promise.allSettled(batchPromises);
                    processedRows += batchResults.length;
                    
                    // Update progress after each batch
                    const progress = (processedRows / totalRows) * 75; // Reserve 25% for saving and UI
                    loadingManager.updateProgress(operationId, progress, 
                        `Processed ${processedRows}/${totalRows} rows (batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(totalRows/batchSize)})`);
                    
                    // Brief pause to prevent overwhelming the system
                    if (i + batchSize < this.csvParser.rawData.length) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                    
                } catch (batchError) {
                    console.warn(`Batch processing error for rows ${i}-${i + batchSize - 1}:`, batchError);
                    processedRows += batch.length; // Still count as processed to avoid infinite loop
                }
            }
            
            // Save to Firebase
            loadingManager.updateProgress(operationId, 75, 'Saving to database...');
            await this.saveToFirebase();
            
            // Update UI
            loadingManager.updateProgress(operationId, 90, 'Updating interface...');
            this.renderEntities();
            
            // Complete operation
            loadingManager.completeOperation(operationId);
            
            this.showStatus(`Processing complete! Processed ${processedRows} rows, skipped ${skippedDuplicates} duplicates.`, 'success');
            
        } catch (error) {
            loadingManager.completeOperation(operationId);
            
            errorHandler.handleError(error, { 
                operation: 'process_data',
                severity: errorHandler.constructor.Severity.HIGH 
            });
        }
    }

    async processRow(row) {
        // Validate required fields - Target is optional
        if (!row.Actor || !row.Action || !row['Date Received']) {
            console.warn('Skipping row with missing required fields:', row);
            return;
        }

        // Parse and validate date received
        const dateReceived = new Date(row['Date Received']);
        if (isNaN(dateReceived.getTime())) {
            console.warn('Skipping row with invalid Date Received:', row['Date Received']);
            return;
        }

        // Process datetime
        const processedDatetime = this.dateTimeProcessor.processDateTime(row.Datetimes, dateReceived);

        // Create event object
        const event = {
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            actor: row.Actor,
            action: row.Action,
            target: row.Target || '', // Target is optional, default to empty string
            sentence: row.Sentence,
            dateReceived: dateReceived,
            processedDatetime: processedDatetime,
            locations: row.Locations ? this.csvParser.parseLocations(row.Locations) : [],
            sources: (row.Sources || row.Source) ? this.csvParser.parseSources(row.Sources || row.Source) : []
        };

        // Check for duplicate events
        try {
            const duplicateEvent = await this.firebaseService.findDuplicateEvent(event);
            if (duplicateEvent) {
                return; // Skip duplicate
            }
        } catch (duplicateError) {
            console.error('Error checking duplicates:', duplicateError);
        }

        // Add to processed events
        this.entityProcessor.processedEntities.events.push(event);

        // Process all entities in parallel for better performance with timeout protection
        const entityPromises = [];

        // Process actors
        const actors = this.csvParser.parseEntities(row.Actor);
        actors.forEach(actor => {
            entityPromises.push(
                Promise.race([
                    this.entityProcessor.processEntity(actor, 'actor', event),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Actor processing timeout: ${actor}`)), 15000)
                    )
                ]).catch(error => {
                    console.error('Error processing actor:', actor, error.message);
                    return null; // Return null to continue processing
                })
            );
        });

        // Process targets (only if Target field is not empty)
        if (row.Target && row.Target.trim()) {
            const targets = this.csvParser.parseEntities(row.Target);
            targets.forEach(target => {
                entityPromises.push(
                    Promise.race([
                        this.entityProcessor.processEntity(target, 'target', event),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error(`Target processing timeout: ${target}`)), 15000)
                        )
                    ]).catch(error => {
                        console.error('Error processing target:', target, error.message);
                        return null; // Return null to continue processing
                    })
                );
            });
        }

        // Process locations
        if (row.Locations) {
            const locations = this.csvParser.parseLocations(row.Locations);
            locations.forEach(location => {
                entityPromises.push(
                    Promise.race([
                        this.entityProcessor.processLocationEntity(location.name, event),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error(`Location processing timeout: ${location.name}`)), 15000)
                        )
                    ]).catch(error => {
                        console.error('Error processing location:', location.name, error.message);
                        return null; // Return null to continue processing
                    })
                );
            });
        }

        // Wait for all entity processing to complete with overall timeout
        try {
            await Promise.race([
                Promise.allSettled(entityPromises),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Row processing timeout')), 30000) // 30 second timeout for entire row
                )
            ]);
        } catch (error) {
            console.warn(`Row processing timeout or error for row with actor: ${row.Actor}`, error);
            // Continue processing even if some entities fail
        }
    }

    async saveToFirebase() {
        try {
            // Use batch operations for much better performance
            const entities = {
                people: this.entityProcessor.processedEntities.people,
                organizations: this.entityProcessor.processedEntities.organizations,
                places: this.entityProcessor.processedEntities.places,
                unknown: this.entityProcessor.processedEntities.unknown
            };
            
            const events = this.entityProcessor.processedEntities.events;
            
            const result = await this.firebaseService.saveBatch(entities, events);
            console.log(`Saved data in ${result.batchCount} batch(es)`);

        } catch (error) {
            console.error('Error saving to Firebase:', error);
            throw error;
        }
    }

    async loadExistingData() {
        const operationId = 'load_existing_data';
        
        try {
            loadingManager.startOperation(operationId, {
                status: 'Loading existing data...',
                cancellable: false,
                timeout: 15000 // 15 second timeout
            });
            
            const existingData = await errorHandler.withErrorHandling(
                () => this.firebaseService.loadExistingData(),
                { operation: 'firebase_load', source: 'initialization' }
            );
            
            if (existingData) {
                loadingManager.updateProgress(operationId, 70, 'Processing loaded data...');
                
                // Update entity processor with existing data
                this.entityProcessor.processedEntities = existingData;
                
                loadingManager.updateProgress(operationId, 90, 'Updating interface...');
                
                // Update table
                this.renderEntities();
                
                const totalEntities = existingData.people.length + existingData.organizations.length + 
                                    existingData.places.length + existingData.unknown.length;
                
                if (totalEntities > 0) {
                    this.showStatus(`Loaded existing data: ${existingData.people.length} people, ${existingData.organizations.length} organizations, ${existingData.places.length} places, ${existingData.unknown.length} unknown`, 'success');
                }
            }
            
            loadingManager.completeOperation(operationId);
            
        } catch (error) {
            loadingManager.completeOperation(operationId);
            
            errorHandler.handleError(error, { 
                operation: 'load_existing_data',
                severity: errorHandler.constructor.Severity.MEDIUM 
            });
        }
    }

    renderEntities() {
        this.tableManager.updateAllEntities(this.entityProcessor.processedEntities);
        this.updateStatistics();
    }

    updateStatistics() {
        const peopleCount = this.entityProcessor.processedEntities.people.length;
        const organizationsCount = this.entityProcessor.processedEntities.organizations.length;
        const placesCount = this.entityProcessor.processedEntities.places.length;
        const unknownCount = this.entityProcessor.processedEntities.unknown.length;
        const eventsCount = this.entityProcessor.processedEntities.events.length;
        const totalEntities = peopleCount + organizationsCount + placesCount + unknownCount;

        // Safely update elements if they exist
        const peopleCountEl = document.getElementById('peopleCount');
        if (peopleCountEl) peopleCountEl.textContent = peopleCount;
        
        const organizationsCountEl = document.getElementById('organizationsCount');
        if (organizationsCountEl) organizationsCountEl.textContent = organizationsCount;
        
        const placesCountEl = document.getElementById('placesCount');
        if (placesCountEl) placesCountEl.textContent = placesCount;
        
        const unknownCountEl = document.getElementById('unknownCount');
        if (unknownCountEl) unknownCountEl.textContent = unknownCount;
        
        const eventsCountEl = document.getElementById('eventsCount');
        if (eventsCountEl) eventsCountEl.textContent = eventsCount;
        
        const totalCountEl = document.getElementById('totalCount');
        if (totalCountEl) totalCountEl.textContent = totalEntities;
    }

    clearData() {
        // Clear processed data
        this.entityProcessor.processedEntities = {
            people: [],
            organizations: [],
            places: [],
            events: []
        };
        
        // Clear CSV data
        this.csvParser.rawData = null;
        
        // Clear file input
        document.getElementById('fileInput').value = '';
        
        // Clear table
        this.tableManager.clearTable();
        
        
        this.showStatus('Data cleared', 'info');
    }

    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('statusMessage');
        statusDiv.textContent = message;
        statusDiv.className = `status-message status-${type}`;
        
        // Auto-hide success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = '';
            }, 3000);
        }
    }

    showProfile(entityId, entityType) {
        // Hide main view, show profile view
        document.getElementById('mainView').classList.add('hidden');
        document.getElementById('profileView').classList.remove('hidden');
        
        // Initialize profile with entity data
        if (!this.profileManager) {
            this.profileManager = new EntityProfile();
        }
        this.profileManager.loadSpecificEntity(entityId, entityType);
    }

    showMainView() {
        // Hide profile view, show main view
        document.getElementById('profileView').classList.add('hidden');
        document.getElementById('mainView').classList.remove('hidden');
    }

    async runDeduplication() {
        const operationId = 'deduplication';
        const deduplicationBtn = document.getElementById('deduplicationBtn');
        const originalText = deduplicationBtn.textContent;
        
        try {
            // Disable the button during processing
            deduplicationBtn.disabled = true;
            deduplicationBtn.textContent = 'Checking for duplicates...';

            const abortController = new AbortController();
            loadingManager.startOperation(operationId, {
                status: 'Analyzing entities for duplicates...',
                cancellable: true,
                timeout: 120000, // 2 minute timeout
                onCancel: () => abortController.abort()
            });

            // Get preview of what will be deduplicated
            const preview = await errorHandler.withErrorHandling(
                () => this.deduplicationService.getDeduplicationPreview(),
                { operation: 'deduplication_preview', source: 'user_action' }
            );
            
            if (abortController.signal.aborted) {
                throw new Error('Deduplication cancelled by user');
            }
            
            if (!preview || preview.totalDuplicatesToRemove === 0) {
                loadingManager.completeOperation(operationId);
                this.showStatus('No duplicates found with matching Wikidata IDs', 'success');
                return;
            }

            // Show confirmation dialog
            const confirmMessage = `Found ${preview.totalDuplicatesToRemove} duplicate entities to remove.\n\nThis will:\n- Keep the oldest entity in each duplicate group\n- Merge all connections and events to the kept entity\n- Delete the duplicate entities\n\nProceed with deduplication?`;
            
            if (!confirm(confirmMessage)) {
                loadingManager.completeOperation(operationId);
                this.showStatus('Deduplication cancelled', 'info');
                return;
            }

            // Run deduplication
            loadingManager.updateProgress(operationId, 30, 'Removing duplicates...');
            deduplicationBtn.textContent = 'Removing duplicates...';

            const result = await errorHandler.withErrorHandling(
                () => this.deduplicationService.runDeduplication(),
                { operation: 'deduplication_execution', source: 'user_action' }
            );

            if (abortController.signal.aborted) {
                throw new Error('Deduplication cancelled by user');
            }

            // Refresh the table to show updated data
            loadingManager.updateProgress(operationId, 80, 'Refreshing data...');
            await this.loadExistingData();

            loadingManager.completeOperation(operationId);
            
            // Show success message
            if (result) {
                this.showStatus(`Deduplication complete! Removed ${result.duplicatesRemoved} duplicate entities from ${result.duplicateGroupsFound} groups.`, 'success');
            }

        } catch (error) {
            loadingManager.completeOperation(operationId);
            
            errorHandler.handleError(error, { 
                operation: 'deduplication',
                severity: errorHandler.constructor.Severity.HIGH 
            });
        } finally {
            // Re-enable the button
            deduplicationBtn.disabled = false;
            deduplicationBtn.textContent = originalText;
        }
    }

    showEntityProfile(entity) {
        // Navigate to profile page (legacy method, now redirects to showProfile)
        const entityType = entity.category || entity.type;
        const typeParam = entityType === 'person' ? 'people' : 
                         entityType === 'organization' ? 'organizations' : 
                         entityType === 'unknown' ? 'unknown' : 'places';
        this.showProfile(entity.id, typeParam);
    }

    async exportKnowledgeBase() {
        try {
            // Disable button during export
            const exportBtn = document.getElementById('exportKnowledgeBaseBtn');
            const originalText = exportBtn.innerHTML;
            exportBtn.disabled = true;
            exportBtn.innerHTML = '<span>⏳</span> Exporting...';

            this.showStatus('Preparing knowledge base export...', 'info');

            // Gather all data from Firebase
            const allData = await this.firebaseService.exportAllData();

            // Create export object with metadata
            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    version: '1.0',
                    totalEntities: Object.values(allData.entities).reduce((sum, collection) => sum + collection.length, 0),
                    totalEvents: allData.events.length,
                    collections: Object.keys(allData.entities)
                },
                entities: allData.entities,
                events: allData.events
            };

            // Create and download file
            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            // Create download link
            const link = document.createElement('a');
            link.href = url;
            link.download = `knowledge-base-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up
            URL.revokeObjectURL(url);

            this.showStatus(`Knowledge base exported successfully! (${exportData.metadata.totalEntities} entities, ${exportData.metadata.totalEvents} events)`, 'success');

        } catch (error) {
            console.error('Error exporting knowledge base:', error);
            this.showStatus('Error exporting knowledge base: ' + error.message, 'error');
        } finally {
            // Re-enable button
            const exportBtn = document.getElementById('exportKnowledgeBaseBtn');
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<span>📁</span> Export JSON';
        }
    }

    showManualEntryModal() {
        const modal = document.getElementById('manualEntryModal');
        modal.classList.remove('hidden');
        
        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('manualDateReceived').value = today;
    }

    hideManualEntryModal() {
        const modal = document.getElementById('manualEntryModal');
        modal.classList.add('hidden');
        
        // Reset form
        document.getElementById('manualEntryForm').reset();
    }

    async handleManualEntrySubmit(e) {
        e.preventDefault();
        
        try {
            // Get form values
            const formData = {
                Actor: document.getElementById('manualActor').value.trim(),
                Action: document.getElementById('manualAction').value.trim(),
                Target: document.getElementById('manualTarget').value.trim(),
                Sentence: document.getElementById('manualSentence').value.trim(),
                'Date Received': document.getElementById('manualDateReceived').value,
                Locations: document.getElementById('manualLocations').value.trim(),
                Sources: document.getElementById('manualSources').value.trim(),
                DateTime: document.getElementById('manualDateTime').value
            };

            // Validate required fields
            if (!formData.Actor || !formData.Action || !formData.Sentence || !formData['Date Received']) {
                this.showStatus('Please fill in all required fields', 'error');
                return;
            }

            // Disable submit button
            const submitBtn = document.getElementById('submitManualEntry');
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';

            this.showStatus('Processing manual entry...', 'info');

            // Process the single row using existing pipeline
            await this.processRow(formData);

            // Save to Firebase
            await this.saveToFirebase();

            // Reload data to show the new entry
            await this.loadExistingData();

            this.showStatus('Manual entry added successfully!', 'success');
            this.hideManualEntryModal();

        } catch (error) {
            console.error('Error processing manual entry:', error);
            this.showStatus('Error processing manual entry: ' + error.message, 'error');
        } finally {
            // Re-enable submit button
            const submitBtn = document.getElementById('submitManualEntry');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Entry';
        }
    }

    async mergeEntities(draggedEntity, targetEntity) {
        try {
            // 1. Load both entities from Firebase to get complete data
            const draggedEntityData = await this.firebaseService.getEntityById(draggedEntity.id, draggedEntity.type);
            const targetEntityData = await this.firebaseService.getEntityById(targetEntity.id, targetEntity.type);

            if (!draggedEntityData || !targetEntityData) {
                throw new Error(`Could not load entity data for merge. Dragged: ${!!draggedEntityData}, Target: ${!!targetEntityData}`);
            }

            // 2. Find all events that reference the dragged entity
            const allEvents = await this.firebaseService.loadAllEvents();
            
            const eventsToUpdate = allEvents.filter(event => {
                try {
                    const shouldUpdate = event.actor.includes(draggedEntity.name) || 
                           (event.target && event.target.includes(draggedEntity.name)) ||
                           (Array.isArray(event.locations) 
                               ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === draggedEntity.name)
                               : event.locations && event.locations.includes(draggedEntity.name));
                    
                    if (shouldUpdate) {
                        console.log('Event to update:', {
                            id: event.id,
                            firestoreId: event.firestoreId,
                            actor: event.actor,
                            target: event.target
                        });
                    }
                    
                    return shouldUpdate;
                } catch (filterError) {
                    console.error('Error filtering event:', event, filterError);
                    return false;
                }
            });

            // 3. Update events to reference the target entity instead
            const eventUpdates = eventsToUpdate.map(event => {
                try {
                    const updatedEvent = { ...event };
                    
                    // Replace in actor
                    if (updatedEvent.actor && updatedEvent.actor.includes(draggedEntity.name)) {
                        updatedEvent.actor = updatedEvent.actor.replace(draggedEntity.name, targetEntity.name);
                    }
                    
                    // Replace in target
                    if (updatedEvent.target && updatedEvent.target.includes(draggedEntity.name)) {
                        updatedEvent.target = updatedEvent.target.replace(draggedEntity.name, targetEntity.name);
                    }
                    
                    // Replace in locations
                    if (Array.isArray(updatedEvent.locations)) {
                        updatedEvent.locations = updatedEvent.locations.map(loc => {
                            if (typeof loc === 'string') {
                                return loc === draggedEntity.name ? targetEntity.name : loc;
                            } else if (loc && loc.name === draggedEntity.name) {
                                return { ...loc, name: targetEntity.name };
                            }
                            return loc;
                        });
                    } else if (updatedEvent.locations === draggedEntity.name) {
                        updatedEvent.locations = targetEntity.name;
                    }
                    
                    return updatedEvent;
                } catch (updateError) {
                    console.error('Error updating event:', event, updateError);
                    throw updateError;
                }
            });

            // 4. Add dragged entity name as alias to target entity
            const updatedTargetEntity = { ...targetEntityData };
            if (!updatedTargetEntity.aliases) {
                updatedTargetEntity.aliases = [];
            }
            if (!updatedTargetEntity.aliases.includes(draggedEntity.name)) {
                updatedTargetEntity.aliases.push(draggedEntity.name);
            }

            // 5. Perform the merge in Firebase
            await this.firebaseService.mergeEntities(
                draggedEntity.id,
                draggedEntity.type,
                targetEntity.id,
                targetEntity.type,
                updatedTargetEntity,
                eventUpdates
            );

            // 6. Update local data and refresh UI
            this.updateLocalDataAfterMerge(draggedEntity, targetEntity, updatedTargetEntity, eventUpdates);


        } catch (error) {
            console.error('Error in mergeEntities:', error);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }

    updateLocalDataAfterMerge(draggedEntity, targetEntity, updatedTargetEntity, eventUpdates) {
        try {
            console.log('Updating local data after merge...');
            
            // Update the target entity in local storage
            const collections = ['people', 'organizations', 'places', 'unknown'];
            let removedEntity = null;
            let updatedTargetIndex = -1;
            let targetCollection = null;
            
            collections.forEach(collection => {
                if (this.entityProcessor && this.entityProcessor.processedEntities && this.entityProcessor.processedEntities[collection]) {
                    const entities = this.entityProcessor.processedEntities[collection];
                    
                    // Remove dragged entity
                    const draggedIndex = entities.findIndex(e => e.id === draggedEntity.id);
                    if (draggedIndex !== -1) {
                        console.log(`Removing dragged entity from ${collection}:`, draggedEntity.name);
                        removedEntity = entities.splice(draggedIndex, 1)[0];
                    }
                    
                    // Update target entity
                    const targetIndex = entities.findIndex(e => e.id === targetEntity.id);
                    if (targetIndex !== -1) {
                        console.log(`Updating target entity in ${collection}:`, targetEntity.name);
                        entities[targetIndex] = updatedTargetEntity;
                        updatedTargetIndex = targetIndex;
                        targetCollection = collection;
                    }
                }
            });

            // Update events in local storage
            if (this.entityProcessor.processedEntities.events) {
                console.log('Updating local events...');
                eventUpdates.forEach(updatedEvent => {
                    const eventIndex = this.entityProcessor.processedEntities.events.findIndex(e => 
                        e.firestoreId === updatedEvent.firestoreId || e.id === updatedEvent.id
                    );
                    if (eventIndex !== -1) {
                        this.entityProcessor.processedEntities.events[eventIndex] = updatedEvent;
                    }
                });
            }

            // Recalculate connection counts for all entities
            console.log('Recalculating connection counts...');
            this.recalculateConnectionCounts();

            // Skip full table refresh to preserve element references during merge
            // The table manager will handle the specific row updates
            console.log('Skipping full table refresh to preserve element references...');
            
            // Update statistics
            this.updateStatistics();
            
            console.log('Local data update completed');
            
        } catch (error) {
            console.error('Error updating local data after merge:', error);
            throw error;
        }
    }

    recalculateConnectionCounts() {
        try {
            const collections = ['people', 'organizations', 'places', 'unknown'];
            const allEvents = this.entityProcessor.processedEntities.events || [];
            
            // Reset all connection counts
            collections.forEach(collection => {
                if (this.entityProcessor.processedEntities[collection]) {
                    this.entityProcessor.processedEntities[collection].forEach(entity => {
                        entity.connectionCount = 0;
                        entity.connections = [];
                    });
                }
            });
            
            // Recalculate based on current events
            allEvents.forEach(event => {
                // Count actor connections
                if (event.actor) {
                    this.incrementEntityConnectionCount(event.actor);
                }
                
                // Count target connections
                if (event.target) {
                    this.incrementEntityConnectionCount(event.target);
                }
                
                // Count location connections
                if (event.locations) {
                    if (Array.isArray(event.locations)) {
                        event.locations.forEach(location => {
                            const locationName = typeof location === 'string' ? location : location.name;
                            if (locationName) {
                                this.incrementEntityConnectionCount(locationName);
                            }
                        });
                    } else if (typeof event.locations === 'string') {
                        this.incrementEntityConnectionCount(event.locations);
                    }
                }
            });
            
            console.log('Connection counts recalculated');
            
        } catch (error) {
            console.error('Error recalculating connection counts:', error);
        }
    }

    incrementEntityConnectionCount(entityName) {
        const collections = ['people', 'organizations', 'places', 'unknown'];
        
        for (const collection of collections) {
            if (this.entityProcessor.processedEntities[collection]) {
                const entity = this.entityProcessor.processedEntities[collection].find(e => 
                    e.name === entityName || (e.aliases && e.aliases.includes(entityName))
                );
                if (entity) {
                    entity.connectionCount = (entity.connectionCount || 0) + 1;
                    return; // Found and updated, no need to check other collections
                }
            }
        }
    }

    async wipeDatabaseWithConfirmation() {
        // Show confirmation dialog
        const confirmMessage = `⚠️ WARNING: This will permanently delete ALL data from the database.

This action will remove:
• All people, organizations, places, and unknown entities
• All events and connections
• All imported CSV data
• All manually entered data

This action CANNOT be undone.

Are you absolutely sure you want to continue?`;

        if (!confirm(confirmMessage)) {
            return; // User cancelled
        }

        // Second confirmation for extra safety
        const secondConfirmation = prompt(
            'To confirm deletion, please type "DELETE ALL DATA" (case sensitive):'
        );

        if (secondConfirmation !== 'DELETE ALL DATA') {
            this.showStatus('Database wipe cancelled - confirmation text did not match.', 'info');
            return;
        }

        try {
            this.showStatus('Wiping database... This may take a moment.', 'info');
            
            // Use loading manager for this operation
            loadingManager.startOperation('wipe_database', {
                message: 'Wiping all database collections...',
                timeout: 60000 // 60 second timeout
            });

            await this.firebaseService.wipeAllCollections();
            
            // Clear local data
            this.entityProcessor.processedEntities = {
                people: [],
                organizations: [],
                places: [],
                unknown: [],
                events: []
            };

            // Clear UI
            this.tableManager.updateAllEntities(this.entityProcessor.processedEntities);
            this.updateStatistics();
            
            loadingManager.completeOperation('wipe_database');
            this.showStatus('✅ Database successfully wiped. All data has been permanently deleted.', 'success');
            
        } catch (error) {
            console.error('Error wiping database:', error);
            loadingManager.completeOperation('wipe_database');
            this.showStatus(`❌ Error wiping database: ${error.message}`, 'error');
        }
    }
}
