// Main application class that orchestrates all modules

import { CSVParser } from './csv-parser.js';
import { WikidataService } from './wikidata-service.js';
import { FirebaseService } from './firebase-service.js';
import { DateTimeProcessor } from './datetime-processor.js';
import { EntityProcessor } from './entity-processor.js';
import { TableManager } from './table-manager.js';
import { EntityProfile } from './profile.js';
import { DeduplicationService } from './deduplication-service.js';

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
    }

    initializeEventListeners() {
        // File upload
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Deduplication button
        document.getElementById('deduplicationBtn').addEventListener('click', () => this.runDeduplication());
        
        // Export knowledge base button
        document.getElementById('exportKnowledgeBaseBtn').addEventListener('click', () => this.exportKnowledgeBase());
        
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

        try {
            this.showStatus('Processing data...', 'info');
            let processedRows = 0;
            let skippedDuplicates = 0;
            const totalRows = this.csvParser.rawData.length;

            for (const row of this.csvParser.rawData) {
                try {
                    await this.processRow(row);
                    processedRows++;
                } catch (rowError) {
                    console.error(`Error processing row ${processedRows + 1}:`, rowError);
                    processedRows++; // Still increment to avoid infinite loop
                }
                
                if (processedRows % 5 === 0) {
                    this.showStatus(`Processing... ${processedRows}/${totalRows} rows`, 'info');
                }
            }
            this.showStatus('Saving to Firebase...', 'info');
            await this.saveToFirebase();
            
            this.showStatus(`Processing complete! Processed ${processedRows} rows, skipped ${skippedDuplicates} duplicates.`, 'success');
            this.renderEntities();
        } catch (error) {
            this.showStatus('Error processing data: ' + error.message, 'error');
            console.error('Error processing data:', error);
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
            locations: row.Locations ? this.csvParser.parseLocations(row.Locations) : []
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

        // Process all entities in parallel for better performance
        const entityPromises = [];

        // Process actors
        const actors = this.csvParser.parseEntities(row.Actor);
        actors.forEach(actor => {
            entityPromises.push(
                this.entityProcessor.processEntity(actor, 'actor', event)
                    .catch(error => console.error('Error processing actor:', error))
            );
        });

        // Process targets (only if Target field is not empty)
        if (row.Target && row.Target.trim()) {
            const targets = this.csvParser.parseEntities(row.Target);
            targets.forEach(target => {
                entityPromises.push(
                    this.entityProcessor.processEntity(target, 'target', event)
                        .catch(error => console.error('Error processing target:', error))
                );
            });
        }

        // Process locations
        if (row.Locations) {
            const locations = this.csvParser.parseLocations(row.Locations);
            locations.forEach(location => {
                entityPromises.push(
                    this.entityProcessor.processLocationEntity(location.name, event)
                        .catch(error => console.error('Error processing location:', error))
                );
            });
        }

        // Wait for all entity processing to complete
        await Promise.all(entityPromises);
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
        try {
            this.showStatus('Loading existing data...', 'info');
            const existingData = await this.firebaseService.loadExistingData();
            
            // Update entity processor with existing data
            this.entityProcessor.processedEntities = existingData;
            
            // Update table
            this.renderEntities();
            
            if (existingData.people.length + existingData.organizations.length + existingData.places.length + existingData.unknown.length > 0) {
                this.showStatus(`Loaded existing data: ${existingData.people.length} people, ${existingData.organizations.length} organizations, ${existingData.places.length} places, ${existingData.unknown.length} unknown`, 'success');
            }
        } catch (error) {
            console.error('Error loading existing data:', error);
            this.showStatus('Error loading existing data', 'error');
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
        try {
            // Disable the button during processing
            const deduplicationBtn = document.getElementById('deduplicationBtn');
            const originalText = deduplicationBtn.textContent;
            deduplicationBtn.disabled = true;
            deduplicationBtn.textContent = 'Checking for duplicates...';

            this.showStatus('Analyzing entities for duplicates...', 'info');

            // Get preview of what will be deduplicated
            const preview = await this.deduplicationService.getDeduplicationPreview();
            
            if (preview.totalDuplicatesToRemove === 0) {
                this.showStatus('No duplicates found with matching Wikidata IDs', 'success');
                deduplicationBtn.disabled = false;
                deduplicationBtn.textContent = originalText;
                return;
            }

            // Show confirmation dialog
            const confirmMessage = `Found ${preview.totalDuplicatesToRemove} duplicate entities to remove.\n\nThis will:\n- Keep the oldest entity in each duplicate group\n- Merge all connections and events to the kept entity\n- Delete the duplicate entities\n\nProceed with deduplication?`;
            
            if (!confirm(confirmMessage)) {
                this.showStatus('Deduplication cancelled', 'info');
                deduplicationBtn.disabled = false;
                deduplicationBtn.textContent = originalText;
                return;
            }

            // Run deduplication
            deduplicationBtn.textContent = 'Removing duplicates...';
            this.showStatus('Running deduplication process...', 'info');

            const result = await this.deduplicationService.runDeduplication();

            // Show success message
            this.showStatus(`Deduplication complete! Removed ${result.duplicatesRemoved} duplicate entities from ${result.duplicateGroupsFound} groups.`, 'success');

            // Refresh the table to show updated data
            await this.loadExistingData();

        } catch (error) {
            console.error('Error during deduplication:', error);
            this.showStatus('Error during deduplication: ' + error.message, 'error');
        } finally {
            // Re-enable the button
            const deduplicationBtn = document.getElementById('deduplicationBtn');
            deduplicationBtn.disabled = false;
            deduplicationBtn.textContent = 'Remove Duplicates';
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
            console.log(`Merging ${draggedEntity.name} into ${targetEntity.name}`);

            // 1. Load both entities from Firebase to get complete data
            console.log('Step 1: Loading entity data...');
            const draggedEntityData = await this.firebaseService.getEntityById(draggedEntity.id, draggedEntity.type);
            const targetEntityData = await this.firebaseService.getEntityById(targetEntity.id, targetEntity.type);

            if (!draggedEntityData || !targetEntityData) {
                throw new Error(`Could not load entity data for merge. Dragged: ${!!draggedEntityData}, Target: ${!!targetEntityData}`);
            }

            console.log('Step 1 completed: Entity data loaded');

            // 2. Find all events that reference the dragged entity
            console.log('Step 2: Loading all events...');
            const allEvents = await this.firebaseService.loadAllEvents();
            console.log(`Loaded ${allEvents.length} total events`);
            
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

            console.log(`Step 2 completed: Found ${eventsToUpdate.length} events to update`);

            // 3. Update events to reference the target entity instead
            console.log('Step 3: Updating event references...');
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

            console.log('Step 3 completed: Event references updated');

            // 4. Add dragged entity name as alias to target entity
            console.log('Step 4: Updating target entity aliases...');
            const updatedTargetEntity = { ...targetEntityData };
            if (!updatedTargetEntity.aliases) {
                updatedTargetEntity.aliases = [];
            }
            if (!updatedTargetEntity.aliases.includes(draggedEntity.name)) {
                updatedTargetEntity.aliases.push(draggedEntity.name);
            }
            console.log('Step 4 completed: Aliases updated');

            // 5. Perform the merge in Firebase
            console.log('Step 5: Performing Firebase merge...');
            await this.firebaseService.mergeEntities(
                draggedEntity.id,
                draggedEntity.type,
                targetEntity.id,
                targetEntity.type,
                updatedTargetEntity,
                eventUpdates
            );
            console.log('Step 5 completed: Firebase merge successful');

            // 6. Update local data and refresh UI
            console.log('Step 6: Updating local data and refreshing UI...');
            this.updateLocalDataAfterMerge(draggedEntity, targetEntity, updatedTargetEntity, eventUpdates);
            console.log('Step 6 completed: Local data updated and UI refreshed');

            console.log('Entity merge completed successfully');

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
}
