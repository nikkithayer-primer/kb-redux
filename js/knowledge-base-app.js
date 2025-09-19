// Main application class that orchestrates all modules

import { CSVParser } from './csv-parser.js';
import { WikidataService } from './wikidata-service.js';
import { FirebaseService } from './firebase-service.js';
import { DateTimeProcessor } from './datetime-processor.js';
import { EntityProcessor } from './entity-processor.js';
import { TableManager } from './table-manager.js';

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
        const fileInput = document.getElementById('csvFile');
        const processBtn = document.getElementById('processBtn');
        const clearBtn = document.getElementById('clearBtn');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        processBtn.addEventListener('click', () => this.processData());
        clearBtn.addEventListener('click', () => this.clearData());
        
        // Table manager events
        this.tableManager.initializeEventListeners();
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
                await this.processRow(row);
                processedRows++;
                
                if (processedRows % 10 === 0) {
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
        // Validate required fields
        if (!row.Actor || !row.Action || !row.Target || !row['Date Received']) {
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
            target: row.Target,
            sentence: row.Sentence,
            dateReceived: dateReceived,
            processedDatetime: processedDatetime,
            locations: row.Locations ? this.csvParser.parseLocations(row.Locations) : []
        };

        // Check for duplicate events
        const duplicateEvent = await this.firebaseService.findDuplicateEvent(event);
        if (duplicateEvent) {
            console.log('Skipping duplicate event:', event.sentence);
            return;
        }

        // Add to processed events
        this.entityProcessor.processedEntities.events.push(event);

        // Process actors
        const actors = this.csvParser.parseEntities(row.Actor);
        for (const actor of actors) {
            await this.entityProcessor.processEntity(actor, 'actor', event);
        }

        // Process targets
        const targets = this.csvParser.parseEntities(row.Target);
        for (const target of targets) {
            await this.entityProcessor.processEntity(target, 'target', event);
        }

        // Process locations
        if (row.Locations) {
            const locations = this.csvParser.parseLocations(row.Locations);
            for (const location of locations) {
                await this.entityProcessor.processLocationEntity(location.name, event);
            }
        }
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
        document.getElementById('csvFile').value = '';
        
        // Clear table
        this.tableManager.clearTable();
        
        this.showStatus('Data cleared', 'info');
    }

    showStatus(message, type = 'info') {
        const statusDiv = document.getElementById('status');
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        
        // Auto-hide success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                statusDiv.textContent = '';
                statusDiv.className = 'status';
            }, 3000);
        }
    }

    showEntityProfile(entity) {
        // Navigate to profile page
        const entityType = entity.category || entity.type;
        const typeParam = entityType === 'person' ? 'people' : 
                         entityType === 'organization' ? 'organizations' : 'places';
        window.location.href = `profile.html?id=${entity.id}&type=${typeParam}`;
    }
}
