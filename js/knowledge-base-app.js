// Main application class that orchestrates all modules

import { CSVParser } from './csv-parser.js';
import { WikidataService } from './wikidata-service.js';
import { FirebaseService } from './firebase-service.js';
import { DateTimeProcessor } from './datetime-processor.js';
import { EntityProcessor } from './entity-processor.js';
import { TableManager } from './table-manager.js';
import { EntityProfile } from '../profile.js';

export class KnowledgeBaseApp {
    constructor() {
        // Initialize services
        this.csvParser = new CSVParser();
        this.wikidataService = new WikidataService();
        this.firebaseService = new FirebaseService();
        this.dateTimeProcessor = new DateTimeProcessor();
        this.entityProcessor = new EntityProcessor(this.wikidataService, this.firebaseService, this.dateTimeProcessor);
        this.tableManager = new TableManager();
        
        // Initialize UI
        this.initializeEventListeners();
        this.loadExistingData();
    }

    initializeEventListeners() {
        // File upload
        const fileInput = document.getElementById('fileInput');
        const processBtn = document.getElementById('processBtn');
        const clearBtn = document.getElementById('clearBtn');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        processBtn.addEventListener('click', () => this.processData());
        clearBtn.addEventListener('click', () => this.clearData());
        
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
            console.log('Parsed CSV data:', rows);
            
            // Show processing controls
            document.getElementById('processingControls').classList.remove('hidden');
            
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
            console.log('Starting processData with', this.csvParser.rawData.length, 'rows');
            this.showStatus('Processing data...', 'info');
            let processedRows = 0;
            let skippedDuplicates = 0;
            const totalRows = this.csvParser.rawData.length;

            console.log('About to start processing rows...');
            for (const row of this.csvParser.rawData) {
                console.log(`Processing row ${processedRows + 1}:`, row);
                try {
                    await this.processRow(row);
                    processedRows++;
                    console.log(`Successfully processed row ${processedRows}`);
                } catch (rowError) {
                    console.error(`Error processing row ${processedRows + 1}:`, rowError);
                    processedRows++; // Still increment to avoid infinite loop
                }
                
                if (processedRows % 5 === 0) {
                    this.showStatus(`Processing... ${processedRows}/${totalRows} rows`, 'info');
                }
            }

            console.log('Finished processing rows, starting Firebase save...');
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
        console.log('processRow: Starting row processing');
        
        // Validate required fields
        if (!row.Actor || !row.Action || !row.Target || !row['Date Received']) {
            console.warn('Skipping row with missing required fields:', row);
            return;
        }
        console.log('processRow: Validation passed');

        // Parse and validate date received
        const dateReceived = new Date(row['Date Received']);
        if (isNaN(dateReceived.getTime())) {
            console.warn('Skipping row with invalid Date Received:', row['Date Received']);
            return;
        }
        console.log('processRow: Date parsing passed');

        // Process datetime
        console.log('processRow: Processing datetime...');
        const processedDatetime = this.dateTimeProcessor.processDateTime(row.Datetimes, dateReceived);
        console.log('processRow: Datetime processed');

        // Create event object
        const event = {
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            actor: row.Actor,
            action: row.Action,
            target: row.Target,
            sentence: row.Sentence,
            dateReceived: dateReceived,
            processedDatetime: processedDatetime,
            locations: row.Locations ? this.csvParser.parseLocations(row.Locations) : []
        };
        console.log('processRow: Event object created:', event);

        // Check for duplicate events
        console.log('processRow: Checking for duplicates...');
        try {
            const duplicateEvent = await this.firebaseService.findDuplicateEvent(event);
            if (duplicateEvent) {
                console.log('Skipping duplicate event:', event.sentence);
                return;
            }
            console.log('processRow: No duplicates found');
        } catch (duplicateError) {
            console.error('processRow: Error checking duplicates:', duplicateError);
        }

        // Add to processed events
        this.entityProcessor.processedEntities.events.push(event);
        console.log('processRow: Event added to processed list');

        // Process actors
        console.log('processRow: Processing actors...');
        const actors = this.csvParser.parseEntities(row.Actor);
        for (const actor of actors) {
            console.log('processRow: Processing actor:', actor);
            try {
                await this.entityProcessor.processEntity(actor, 'actor', event);
                console.log('processRow: Actor processed successfully');
            } catch (actorError) {
                console.error('processRow: Error processing actor:', actorError);
            }
        }

        // Process targets
        console.log('processRow: Processing targets...');
        const targets = this.csvParser.parseEntities(row.Target);
        for (const target of targets) {
            console.log('processRow: Processing target:', target);
            try {
                await this.entityProcessor.processEntity(target, 'target', event);
                console.log('processRow: Target processed successfully');
            } catch (targetError) {
                console.error('processRow: Error processing target:', targetError);
            }
        }

        // Process locations
        if (row.Locations) {
            console.log('processRow: Processing locations...');
            const locations = this.csvParser.parseLocations(row.Locations);
            for (const location of locations) {
                console.log('processRow: Processing location:', location.name);
                try {
                    await this.entityProcessor.processLocationEntity(location.name, event);
                    console.log('processRow: Location processed successfully');
                } catch (locationError) {
                    console.error('processRow: Error processing location:', locationError);
                }
            }
        }
        
        console.log('processRow: Row processing completed');
    }

    async saveToFirebase() {
        try {
            // Save people
            for (const person of this.entityProcessor.processedEntities.people) {
                await this.firebaseService.saveOrUpdateEntity(person, 'people');
            }

            // Save organizations
            for (const org of this.entityProcessor.processedEntities.organizations) {
                await this.firebaseService.saveOrUpdateEntity(org, 'organizations');
            }

            // Save places
            for (const place of this.entityProcessor.processedEntities.places) {
                await this.firebaseService.saveOrUpdateEntity(place, 'places');
            }

            // Save events
            for (const event of this.entityProcessor.processedEntities.events) {
                await this.firebaseService.saveEvent(event);
            }

            console.log('All data saved to Firebase successfully');
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
            
            if (existingData.people.length + existingData.organizations.length + existingData.places.length > 0) {
                this.showStatus(`Loaded existing data: ${existingData.people.length} people, ${existingData.organizations.length} organizations, ${existingData.places.length} places`, 'success');
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
        document.getElementById('peopleCount').textContent = this.entityProcessor.processedEntities.people.length;
        document.getElementById('organizationsCount').textContent = this.entityProcessor.processedEntities.organizations.length;
        document.getElementById('placesCount').textContent = this.entityProcessor.processedEntities.places.length;
        document.getElementById('eventsCount').textContent = this.entityProcessor.processedEntities.events.length;
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
        
        // Hide processing controls
        document.getElementById('processingControls').classList.add('hidden');
        
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

    showEntityProfile(entity) {
        // Navigate to profile page (legacy method, now redirects to showProfile)
        const entityType = entity.category || entity.type;
        const typeParam = entityType === 'person' ? 'people' : 
                         entityType === 'organization' ? 'organizations' : 'places';
        this.showProfile(entity.id, typeParam);
    }
}
