import { db } from './config.js';
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

class KnowledgeBaseApp {
    constructor() {
        this.csvData = null;
        this.processedEntities = {
            people: [],
            organizations: [],
            places: [],
            events: []
        };
        this.filteredEntities = [];
        this.sortField = 'name';
        this.sortDirection = 'asc';
        this.initializeEventListeners();
        this.loadExistingData();
    }

    initializeEventListeners() {
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');
        const processBtn = document.getElementById('processBtn');
        const clearBtn = document.getElementById('clearBtn');

        // File upload handling
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processFile(files[0]);
            }
        });

        // Button handlers
        processBtn.addEventListener('click', () => this.processData());
        clearBtn.addEventListener('click', () => this.clearData());
        
        // Table controls
        document.getElementById('typeFilter').addEventListener('change', (e) => this.filterEntities());
        document.getElementById('entitySearch').addEventListener('input', (e) => this.filterEntities());
        
        // Table sorting
        document.addEventListener('click', (e) => {
            if (e.target.closest('.sortable')) {
                const sortField = e.target.closest('.sortable').dataset.sort;
                this.sortEntities(sortField);
            }
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        if (!file.name.endsWith('.csv')) {
            this.showStatus('Please select a CSV file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.csvData = this.parseCSV(e.target.result);
            this.showStatus(`Loaded ${this.csvData.length} rows from CSV`, 'success');
            document.getElementById('processingControls').classList.remove('hidden');
        };
        reader.readAsText(file);
    }

    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCSVLine(lines[i]);
            if (values.length === headers.length) {
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index].trim();
                });
                data.push(row);
            }
        }
        return data;
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current);
        return result;
    }

    async processData() {
        if (!this.csvData) {
            this.showStatus('No CSV data to process', 'error');
            return;
        }

        this.showStatus('Processing CSV data and checking for duplicates...', 'info');
        this.showProgress(0);

        let newEvents = 0;
        let duplicateEvents = 0;
        let newEntities = 0;
        let updatedEntities = 0;

        try {
            // Process each row
            for (let i = 0; i < this.csvData.length; i++) {
                const row = this.csvData[i];
                const initialEventCount = this.processedEntities.events.length;
                
                await this.processRow(row);
                
                // Track if a new event was added
                if (this.processedEntities.events.length > initialEventCount) {
                    newEvents++;
                } else {
                    duplicateEvents++;
                }
                
                this.showProgress((i + 1) / this.csvData.length * 100);
            }

            // Save to Firebase
            this.showStatus('Saving to Firebase...', 'info');
            await this.saveToFirebase();
            
            const statusMessage = `Processing complete! Added ${newEvents} new events, skipped ${duplicateEvents} duplicates.`;
            this.showStatus(statusMessage, 'success');
            
            this.updateStatistics();
            this.renderEntities();
            
        } catch (error) {
            console.error('Error processing data:', error);
            this.showStatus(`Error processing data: ${error.message}`, 'error');
        }
    }

    async processRow(row) {
        // Parse entities from Actor, Target, and Locations
        const actors = this.parseEntities(row.Actor);
        const targets = this.parseEntities(row.Target);
        const locations = this.parseEntities(row.Locations);
        
        // Process datetime
        const processedDatetime = this.processDateTime(row.Datetimes, row['Date Received']);
        
        // Validate dates before creating event
        const dateReceived = new Date(row['Date Received']);
        if (isNaN(dateReceived.getTime())) {
            console.warn('Invalid Date Received:', row['Date Received']);
            return; // Skip this row if date is invalid
        }
        
        // Create event
        const event = {
            id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            actor: row.Actor,
            action: row.Action,
            target: row.Target,
            sentence: row.Sentence,
            dateReceived: dateReceived,
            locations: row.Locations,
            datetimes: row.Datetimes,
            processedDatetime: processedDatetime && !isNaN(processedDatetime.getTime()) ? processedDatetime : null,
            timestamp: new Date()
        };

        // Check if this event already exists
        const existingEvent = await this.findDuplicateEvent(event);
        if (existingEvent) {
            console.log(`Skipping duplicate event: ${event.sentence}`);
            return; // Skip processing this duplicate event
        }

        this.processedEntities.events.push(event);

        // Process each entity type
        for (const actor of actors) {
            await this.processEntity(actor, 'actor', event);
        }
        
        for (const target of targets) {
            await this.processEntity(target, 'target', event);
        }
        
        for (const location of locations) {
            await this.processLocationEntity(location, event);
        }
    }

    parseEntities(entityString) {
        if (!entityString) return [];
        
        // Handle comma-separated entities, being careful with place names like "Washington, D.C."
        const entities = [];
        const parts = entityString.split(',');
        
        let current = '';
        for (let i = 0; i < parts.length; i++) {
            current += parts[i];
            
            // Check if this looks like a complete entity
            if (i === parts.length - 1 || this.isCompleteEntity(current, parts[i + 1])) {
                entities.push(current.trim());
                current = '';
            } else {
                current += ',';
            }
        }
        
        return entities.filter(e => e.length > 0);
    }

    isCompleteEntity(current, next) {
        // Simple heuristic: if next part starts with uppercase, it's likely a new entity
        // unless current ends with a known abbreviation
        if (!next) return true;
        
        const abbreviations = ['D.C.', 'U.S.', 'U.K.', 'N.Y.', 'L.A.'];
        const endsWithAbbr = abbreviations.some(abbr => current.trim().endsWith(abbr.slice(0, -1)));
        
        if (endsWithAbbr) return false;
        
        return next.trim().charAt(0) === next.trim().charAt(0).toUpperCase();
    }

    processDateTime(datetimeString, dateReceived) {
        const receivedDate = new Date(dateReceived);
        
        // If datetime is empty, use dateReceived
        if (!datetimeString || datetimeString.trim() === '') {
            return receivedDate;
        }
        
        const datetime = datetimeString.toLowerCase();
        
        // Handle relative terms
        if (datetime.includes('yesterday')) {
            const yesterday = new Date(receivedDate);
            yesterday.setDate(yesterday.getDate() - 1);
            return yesterday;
        }
        
        if (datetime.includes('today')) {
            return new Date(receivedDate);
        }
        
        if (datetime.includes('tomorrow')) {
            const tomorrow = new Date(receivedDate);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow;
        }
        
        // Handle "X days ago"
        const daysAgoMatch = datetime.match(/(\d+)\s+days?\s+ago/);
        if (daysAgoMatch) {
            const daysAgo = parseInt(daysAgoMatch[1]);
            const date = new Date(receivedDate);
            date.setDate(date.getDate() - daysAgo);
            return date;
        }
        
        // Handle day-of-week relative dates (e.g., "Tuesday night", "Wednesday evening")
        const dayTimeMatch = datetime.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(morning|afternoon|evening|night)?/i);
        if (dayTimeMatch) {
            const targetDay = dayTimeMatch[1].toLowerCase();
            const timeOfDay = dayTimeMatch[2]?.toLowerCase() || 'morning';
            
            const dayMap = {
                'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
                'thursday': 4, 'friday': 5, 'saturday': 6
            };
            
            const timeMap = {
                'morning': 9,
                'afternoon': 15,
                'evening': 19,
                'night': 21
            };
            
            const targetDayNum = dayMap[targetDay];
            const currentDayNum = receivedDate.getDay();
            
            // Calculate days difference (looking backward from received date)
            let daysDiff = currentDayNum - targetDayNum;
            if (daysDiff <= 0) {
                daysDiff += 7; // Go back to previous week
            }
            
            const targetDate = new Date(receivedDate);
            targetDate.setDate(targetDate.getDate() - daysDiff);
            targetDate.setHours(timeMap[timeOfDay], 0, 0, 0);
            
            return targetDate;
        }
        
        // Handle "this week", "last week", etc.
        if (datetime.includes('this week')) {
            return new Date(receivedDate);
        }
        
        if (datetime.includes('last week')) {
            const lastWeek = new Date(receivedDate);
            lastWeek.setDate(lastWeek.getDate() - 7);
            return lastWeek;
        }
        
        // Handle "this morning", "this afternoon", etc.
        const thisTimeMatch = datetime.match(/this\s+(morning|afternoon|evening|night)/i);
        if (thisTimeMatch) {
            const timeOfDay = thisTimeMatch[1].toLowerCase();
            const timeMap = {
                'morning': 9,
                'afternoon': 15,
                'evening': 19,
                'night': 21
            };
            
            const thisTime = new Date(receivedDate);
            thisTime.setHours(timeMap[timeOfDay], 0, 0, 0);
            return thisTime;
        }
        
        // Handle "last night", "last evening", etc.
        const lastTimeMatch = datetime.match(/last\s+(morning|afternoon|evening|night)/i);
        if (lastTimeMatch) {
            const timeOfDay = lastTimeMatch[1].toLowerCase();
            const timeMap = {
                'morning': 9,
                'afternoon': 15,
                'evening': 19,
                'night': 21
            };
            
            const lastTime = new Date(receivedDate);
            // "Last night" typically refers to the previous day's night
            if (timeOfDay === 'night' || timeOfDay === 'evening') {
                lastTime.setDate(lastTime.getDate() - 1);
            }
            lastTime.setHours(timeMap[timeOfDay], 0, 0, 0);
            return lastTime;
        }
        
        // Handle "earlier today", "later today"
        if (datetime.includes('earlier today') || datetime.includes('later today')) {
            return new Date(receivedDate);
        }
        
        // Handle "X hours ago"
        const hoursAgoMatch = datetime.match(/(\d+)\s+hours?\s+ago/i);
        if (hoursAgoMatch) {
            const hoursAgo = parseInt(hoursAgoMatch[1]);
            const date = new Date(receivedDate);
            date.setHours(date.getHours() - hoursAgo);
            return date;
        }
        
        // Handle "X minutes ago"
        const minutesAgoMatch = datetime.match(/(\d+)\s+minutes?\s+ago/i);
        if (minutesAgoMatch) {
            const minutesAgo = parseInt(minutesAgoMatch[1]);
            const date = new Date(receivedDate);
            date.setMinutes(date.getMinutes() - minutesAgo);
            return date;
        }
        
        // Try to parse as regular date
        try {
            const parsedDate = new Date(datetimeString);
            // Check if the parsed date is valid
            if (isNaN(parsedDate.getTime())) {
                console.warn('Invalid datetime string:', datetimeString);
                return null;
            }
            return parsedDate;
        } catch (error) {
            console.warn('Error parsing datetime:', datetimeString, error);
            return null;
        }
    }

    async processEntity(entityName, role, event) {
        // Check if entity already exists (in processed entities or Firebase)
        let entity = this.findExistingEntity(entityName);
        
        if (!entity) {
            // Check if entity exists in Firebase
            entity = await this.findEntityInFirebase(entityName);
        }
        
        if (!entity) {
            // Try to get data from Wikidata
            const wikidataInfo = await this.searchWikidata(entityName);
            
            entity = {
                id: `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: entityName,
                aliases: [entityName],
                type: this.determineEntityType(entityName, wikidataInfo),
                wikidata_id: wikidataInfo?.id || null,
                description: wikidataInfo?.description || '',
                connections: [],
                ...this.extractWikidataFields(wikidataInfo)
            };
            
            // Add to appropriate collection
            if (entity.type === 'person') {
                this.processedEntities.people.push(entity);
            } else if (entity.type === 'organization') {
                this.processedEntities.organizations.push(entity);
            } else {
                this.processedEntities.places.push(entity);
            }
        } else {
            // Entity exists, make sure it's in our processed entities for this session
            this.ensureEntityInProcessedList(entity);
        }
        
        // Check if this connection/event already exists for this entity
        const connectionExists = this.connectionExists(entity, event, role);
        
        // Add connection to event only if it doesn't already exist
        if (!connectionExists && event.dateReceived && !isNaN(event.dateReceived.getTime())) {
            entity.connections.push({
                id: event.id,
                type: role,
                action: event.action,
                timestamp: event.dateReceived,
                eventId: event.id,
                relatedEntities: {
                    actors: this.parseEntities(event.actor),
                    targets: this.parseEntities(event.target),
                    locations: this.parseEntities(event.locations)
                }
            });
        }
    }

    async processLocationEntity(locationName, event) {
        const locations = this.parseLocationHierarchy(locationName);
        
        for (const location of locations) {
            let entity = this.findExistingEntity(location.name);
            
            if (!entity) {
                const wikidataInfo = await this.searchWikidata(location.name);
                
                entity = {
                    id: `place_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    name: location.name,
                    aliases: [location.name],
                    type: 'place',
                    category: location.category || this.classifyLocation(location.name, wikidataInfo),
                    wikidata_id: wikidataInfo?.id || null,
                    description: wikidataInfo?.description || '',
                    connections: [],
                    coordinates: wikidataInfo?.coordinates || null,
                    ...this.extractLocationFields(wikidataInfo)
                };
                
                this.processedEntities.places.push(entity);
            }
            
            // Add connection to event (only if we have a valid timestamp)
            if (event.dateReceived && !isNaN(event.dateReceived.getTime())) {
                entity.connections.push({
                    id: event.id,
                    type: 'location_of',
                    action: event.action,
                    timestamp: event.dateReceived,
                    eventId: event.id,
                    relatedEntities: {
                        actors: this.parseEntities(event.actor),
                        targets: this.parseEntities(event.target),
                        locations: this.parseEntities(event.locations)
                    }
                });
            }
        }
    }

    parseLocationHierarchy(locationString) {
        const locations = [];
        const parts = locationString.split(',').map(p => p.trim());
        
        if (parts.length === 1) {
            locations.push({ name: parts[0], category: null });
        } else if (parts.length === 2) {
            // Handle cases like "Memphis, Tennessee" or "Washington, D.C."
            if (parts[1].length <= 3 || parts[1] === 'D.C.') {
                locations.push({ name: locationString, category: 'city' });
            } else {
                locations.push({ name: parts[0], category: 'city' });
                locations.push({ name: parts[1], category: 'state' });
            }
        }
        
        return locations;
    }

    classifyLocation(locationName, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instanceOf = wikidataInfo.instance_of.toLowerCase();
            
            // Check for specific location types
            if (instanceOf.includes('city') || instanceOf.includes('municipality')) return 'city';
            if (instanceOf.includes('state') || instanceOf.includes('province')) return 'state';
            if (instanceOf.includes('country') || instanceOf.includes('nation')) return 'country';
            if (instanceOf.includes('island')) return 'island';
            if (instanceOf.includes('region') || instanceOf.includes('area')) return 'region';
            if (instanceOf.includes('county') || instanceOf.includes('district')) return 'county';
            if (instanceOf.includes('border') || instanceOf.includes('boundary')) return 'border';
            if (instanceOf.includes('continent')) return 'continent';
            if (instanceOf.includes('ocean') || instanceOf.includes('sea')) return 'water_body';
            if (instanceOf.includes('mountain') || instanceOf.includes('peak')) return 'mountain';
            if (instanceOf.includes('river') || instanceOf.includes('lake')) return 'water_body';
        }
        
        // Enhanced heuristics based on location name patterns
        const name = locationName.toLowerCase();
        
        // Check for common city patterns
        if (name.includes('city') || name.endsWith(', ca') || name.endsWith(', ny') || 
            name.endsWith(', tx') || name.endsWith(', fl')) return 'city';
            
        // Check for state patterns
        if (name.includes('state') || this.isUSState(name)) return 'state';
        
        // Check for country patterns
        if (this.isCountry(name)) return 'country';
        
        // Check for other geographic features
        if (name.includes('county') || name.includes('parish')) return 'county';
        if (name.includes('island') || name.includes('isle')) return 'island';
        if (name.includes('region') || name.includes('area') || name.includes('territory')) return 'region';
        if (name.includes('border') || name.includes('crossing')) return 'border';
        if (name.includes('mountain') || name.includes('peak') || name.includes('range')) return 'mountain';
        if (name.includes('river') || name.includes('lake') || name.includes('bay') || 
            name.includes('ocean') || name.includes('sea')) return 'water_body';
        
        // Default classification based on comma structure
        const parts = locationName.split(',').map(p => p.trim());
        if (parts.length === 2) {
            // Format like "City, State" or "City, Country"
            const secondPart = parts[1].toLowerCase();
            if (this.isUSState(secondPart) || secondPart.length <= 3) {
                return 'city'; // First part is likely a city
            }
        }
        
        return 'location';
    }
    
    isUSState(name) {
        const usStates = [
            'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
            'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
            'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
            'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
            'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
            'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
            'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
            'wisconsin', 'wyoming', 'district of columbia', 'd.c.'
        ];
        
        const stateAbbreviations = [
            'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in',
            'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv',
            'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn',
            'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc'
        ];
        
        return usStates.includes(name.toLowerCase()) || stateAbbreviations.includes(name.toLowerCase());
    }
    
    isCountry(name) {
        const commonCountries = [
            'united states', 'usa', 'canada', 'mexico', 'united kingdom', 'uk', 'france', 'germany',
            'italy', 'spain', 'russia', 'china', 'japan', 'india', 'australia', 'brazil', 'argentina',
            'south africa', 'egypt', 'nigeria', 'kenya', 'morocco', 'israel', 'turkey', 'greece',
            'poland', 'netherlands', 'belgium', 'sweden', 'norway', 'denmark', 'finland', 'ireland',
            'portugal', 'switzerland', 'austria', 'czech republic', 'hungary', 'romania', 'bulgaria',
            'croatia', 'serbia', 'ukraine', 'belarus', 'estonia', 'latvia', 'lithuania'
        ];
        
        return commonCountries.includes(name.toLowerCase());
    }

    findExistingEntity(name) {
        const allEntities = [
            ...this.processedEntities.people,
            ...this.processedEntities.organizations,
            ...this.processedEntities.places
        ];
        
        // Generate search variations for more flexible matching
        const searchVariations = this.generateSearchVariations(name);
        
        for (const variation of searchVariations) {
            const variationLower = variation.toLowerCase();
            const match = allEntities.find(entity => 
                entity.name.toLowerCase() === variationLower ||
                (entity.aliases && entity.aliases.some(alias => alias.toLowerCase() === variationLower))
            );
            
            if (match) {
                if (variation !== name) {
                    console.log(`Found existing entity match for "${name}" -> "${variation}": ${match.name}`);
                }
                return match;
            }
        }
        
        return null;
    }

    async findEntityInFirebase(name) {
        try {
            const collections = ['people', 'organizations', 'places'];
            const searchVariations = this.generateSearchVariations(name);
            
            for (const collectionName of collections) {
                // Try each search variation
                for (const variation of searchVariations) {
                    // Search by name
                    const nameQuery = query(collection(db, collectionName), where('name', '==', variation));
                    const nameSnapshot = await getDocs(nameQuery);
                    
                    if (!nameSnapshot.empty) {
                        const doc = nameSnapshot.docs[0];
                        if (variation !== name) {
                            console.log(`Found Firebase entity match for "${name}" -> "${variation}": ${doc.data().name}`);
                        }
                        return {
                            firestoreId: doc.id,
                            firestoreCollection: collectionName,
                            ...doc.data()
                        };
                    }
                    
                    // Search by aliases
                    const aliasQuery = query(collection(db, collectionName), where('aliases', 'array-contains', variation));
                    const aliasSnapshot = await getDocs(aliasQuery);
                    
                    if (!aliasSnapshot.empty) {
                        const doc = aliasSnapshot.docs[0];
                        if (variation !== name) {
                            console.log(`Found Firebase entity alias match for "${name}" -> "${variation}": ${doc.data().name}`);
                        }
                        return {
                            firestoreId: doc.id,
                            firestoreCollection: collectionName,
                            ...doc.data()
                        };
                    }
                }
            }
        } catch (error) {
            console.warn('Error searching Firebase for entity:', name, error);
        }
        
        return null;
    }

    ensureEntityInProcessedList(entity) {
        // Make sure the entity is in the appropriate processed list
        const entityType = entity.type || entity.category;
        let targetList;
        
        if (entityType === 'person') {
            targetList = this.processedEntities.people;
        } else if (entityType === 'organization') {
            targetList = this.processedEntities.organizations;
        } else {
            targetList = this.processedEntities.places;
        }
        
        // Check if it's already in the list
        const exists = targetList.find(e => e.id === entity.id);
        if (!exists) {
            targetList.push(entity);
        }
    }

    connectionExists(entity, event, role) {
        if (!entity.connections) {
            entity.connections = [];
            return false;
        }
        
        // Check if a similar connection already exists
        return entity.connections.some(connection => 
            connection.action === event.action &&
            connection.type === role &&
            this.isSameEvent(connection, event)
        );
    }

    isSameEvent(connection, event) {
        // Check if this is the same event by comparing key properties
        if (connection.eventId === event.id) {
            return true;
        }
        
        // Check if it's a duplicate event by comparing content
        if (connection.relatedEntities) {
            const sameActors = this.arraysEqual(
                connection.relatedEntities.actors || [], 
                this.parseEntities(event.actor)
            );
            const sameTargets = this.arraysEqual(
                connection.relatedEntities.targets || [], 
                this.parseEntities(event.target)
            );
            const sameAction = connection.action === event.action;
            const sameDay = this.isSameDay(connection.timestamp, event.dateReceived);
            
            return sameActors && sameTargets && sameAction && sameDay;
        }
        
        return false;
    }

    arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        
        const sorted1 = [...arr1].sort();
        const sorted2 = [...arr2].sort();
        
        return sorted1.every((val, index) => val === sorted2[index]);
    }

    isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }

    async findDuplicateEvent(newEvent) {
        // First check in processed events for this session
        const duplicateInProcessed = this.processedEntities.events.find(event => 
            this.eventsAreDuplicate(event, newEvent)
        );
        
        if (duplicateInProcessed) {
            return duplicateInProcessed;
        }
        
        // Then check in Firebase
        try {
            const eventsQuery = query(
                collection(db, 'events'), 
                where('actor', '==', newEvent.actor),
                where('action', '==', newEvent.action),
                where('target', '==', newEvent.target)
            );
            const eventsSnapshot = await getDocs(eventsQuery);
            
            for (const doc of eventsSnapshot.docs) {
                const existingEvent = doc.data();
                if (this.eventsAreDuplicate(existingEvent, newEvent)) {
                    return {
                        firestoreId: doc.id,
                        ...existingEvent
                    };
                }
            }
        } catch (error) {
            console.warn('Error checking for duplicate events in Firebase:', error);
        }
        
        return null;
    }

    eventsAreDuplicate(event1, event2) {
        // Check if events are duplicates based on key properties
        const sameActor = event1.actor === event2.actor;
        const sameAction = event1.action === event2.action;
        const sameTarget = event1.target === event2.target;
        const sameSentence = event1.sentence === event2.sentence;
        const sameDay = this.isSameDay(event1.dateReceived, event2.dateReceived);
        
        // Events are duplicates if they have the same sentence or 
        // if they have the same actor, action, target on the same day
        return sameSentence || (sameActor && sameAction && sameTarget && sameDay);
    }

    determineEntityType(name, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instanceOf = wikidataInfo.instance_of.toLowerCase();
            if (instanceOf.includes('human') || instanceOf.includes('person')) return 'person';
            if (instanceOf.includes('organization') || instanceOf.includes('company')) return 'organization';
            if (instanceOf.includes('place') || instanceOf.includes('location')) return 'place';
        }
        
        // Default heuristics
        if (this.isPersonName(name)) return 'person';
        if (this.isOrganizationName(name)) return 'organization';
        return 'place';
    }

    isPersonName(name) {
        // Simple heuristic: check if it looks like a person name
        const parts = name.trim().split(' ');
        return parts.length >= 2 && parts.every(part => 
            part.charAt(0) === part.charAt(0).toUpperCase()
        );
    }

    isOrganizationName(name) {
        const orgKeywords = ['corp', 'inc', 'llc', 'ltd', 'company', 'corporation', 'institute', 'university', 'college'];
        const nameLower = name.toLowerCase();
        return orgKeywords.some(keyword => nameLower.includes(keyword));
    }

    async searchWikidata(entityName) {
        try {
            // Try multiple search variations for better matching
            const searchVariations = this.generateSearchVariations(entityName);
            
            for (const searchQuery of searchVariations) {
                const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchQuery)}&language=en&format=json&origin=*&limit=10`;
                const response = await fetch(searchUrl);
                const data = await response.json();
                
                if (data.search && data.search.length > 0) {
                    // Try to find the best match by checking aliases
                    const bestMatch = await this.findBestWikidataMatch(data.search, entityName);
                    
                    if (bestMatch) {
                        // Get detailed entity data
                        const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${bestMatch.id}&format=json&origin=*`;
                        const detailResponse = await fetch(detailUrl);
                        const detailData = await detailResponse.json();
                        
                        if (detailData.entities && detailData.entities[bestMatch.id]) {
                            return await this.parseWikidataEntity(detailData.entities[bestMatch.id]);
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Wikidata search failed:', error);
        }
        return null;
    }

    generateSearchVariations(query) {
        const variations = [query];
        const lowerQuery = query.toLowerCase().trim();
        
        // Remove common prefixes and articles
        const prefixesToRemove = ['the ', 'a ', 'an '];
        for (const prefix of prefixesToRemove) {
            if (lowerQuery.startsWith(prefix)) {
                const withoutPrefix = query.substring(prefix.length).trim();
                if (withoutPrefix.length > 0) {
                    variations.push(withoutPrefix);
                }
            }
        }
        
        // Add version with "the" if it doesn't already have it
        if (!lowerQuery.startsWith('the ')) {
            variations.push(`the ${query}`);
        }
        
        // Remove punctuation variations
        const noPunctuation = query.replace(/[.,!?;:'"()-]/g, '').trim();
        if (noPunctuation !== query && noPunctuation.length > 0) {
            variations.push(noPunctuation);
        }
        
        // Remove duplicates and return
        return [...new Set(variations)];
    }

    async findBestWikidataMatch(searchResults, originalQuery) {
        const originalLower = originalQuery.toLowerCase().trim();
        
        // First, try exact matches on label or description
        for (const result of searchResults) {
            const labelLower = result.label?.toLowerCase() || '';
            
            if (labelLower === originalLower) {
                return result;
            }
        }
        
        // Then check aliases by fetching full entity data for top results
        for (const result of searchResults.slice(0, 5)) { // Check top 5 results
            try {
                const entityResponse = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${result.id}&format=json&origin=*&props=aliases|labels`);
                const entityData = await entityResponse.json();
                
                if (entityData.entities && entityData.entities[result.id]) {
                    const entity = entityData.entities[result.id];
                    
                    // Check aliases (Also known as)
                    if (entity.aliases && entity.aliases.en) {
                        for (const alias of entity.aliases.en) {
                            if (alias.value.toLowerCase() === originalLower) {
                                console.log(`Found exact alias match for "${originalQuery}": ${result.label} (${result.id})`);
                                return result;
                            }
                        }
                    }
                    
                    // Check for partial matches with common variations
                    const searchVariations = this.generateSearchVariations(originalQuery);
                    for (const variation of searchVariations) {
                        const variationLower = variation.toLowerCase();
                        
                        // Check against label
                        if (entity.labels?.en?.value?.toLowerCase() === variationLower) {
                            console.log(`Found label match for "${originalQuery}" -> "${variation}": ${result.label} (${result.id})`);
                            return result;
                        }
                        
                        // Check against aliases
                        if (entity.aliases && entity.aliases.en) {
                            for (const alias of entity.aliases.en) {
                                if (alias.value.toLowerCase() === variationLower) {
                                    console.log(`Found alias match for "${originalQuery}" -> "${variation}": ${result.label} (${result.id})`);
                                    return result;
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn(`Error checking aliases for ${result.id}:`, error);
                continue;
            }
        }
        
        // If no exact match found, return the first result
        console.log(`Using first search result for "${originalQuery}": ${searchResults[0].label} (${searchResults[0].id})`);
        return searchResults[0];
    }

    async parseWikidataEntity(entity) {
        const result = {
            id: entity.id,
            description: entity.descriptions?.en?.value || '',
            labels: entity.labels?.en?.value || '',
        };
        
        if (entity.claims) {
            // Extract common properties
            if (entity.claims.P31) { // instance of
                result.instance_of = await this.resolveWikidataProperty(entity.claims.P31[0]);
            }
            if (entity.claims.P625) { // coordinates
                const coords = entity.claims.P625[0];
                if (coords.mainsnak.datavalue) {
                    result.coordinates = {
                        lat: coords.mainsnak.datavalue.value.latitude,
                        lng: coords.mainsnak.datavalue.value.longitude
                    };
                }
            }
            if (entity.claims.P569) { // date of birth
                result.dateOfBirth = this.extractClaimValue(entity.claims.P569[0]);
            }
            if (entity.claims.P106) { // occupation
                result.occupation = await this.resolveWikidataProperty(entity.claims.P106[0]);
            }
            if (entity.claims.P17) { // country
                result.country = await this.resolveWikidataProperty(entity.claims.P17[0]);
            }
            if (entity.claims.P1082) { // population
                result.population = this.extractClaimValue(entity.claims.P1082[0]);
            }
        }
        
        return result;
    }

    async resolveWikidataProperty(claim) {
        try {
            const value = this.extractClaimValue(claim);
            
            // If it's a Wikidata entity ID (like Q123456), resolve it to a label
            if (value && typeof value === 'string' && value.match(/^Q\d+$/)) {
                const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${value}&format=json&origin=*&props=labels`);
                const data = await response.json();
                
                if (data.entities && data.entities[value] && data.entities[value].labels && data.entities[value].labels.en) {
                    return data.entities[value].labels.en.value;
                }
            }
            
            return value;
        } catch (error) {
            console.warn('Error resolving Wikidata property:', error);
            return this.extractClaimValue(claim);
        }
    }

    extractClaimValue(claim) {
        if (claim.mainsnak.datavalue) {
            const value = claim.mainsnak.datavalue.value;
            if (typeof value === 'string') return value;
            if (value.time) return value.time;
            if (value.text) return value.text;
            if (value.id) return value.id;
        }
        return null;
    }

    extractWikidataFields(wikidataInfo) {
        if (!wikidataInfo) return {};
        
        return {
            dateOfBirth: wikidataInfo.dateOfBirth || null,
            occupation: wikidataInfo.occupation || null,
            coordinates: wikidataInfo.coordinates || null
        };
    }

    extractLocationFields(wikidataInfo) {
        if (!wikidataInfo) return {};
        
        return {
            coordinates: wikidataInfo.coordinates || null,
            country: wikidataInfo.country || null,
            population: wikidataInfo.population || null
        };
    }

    sanitizeDataForFirebase(data) {
        if (data === null || data === undefined) return data;
        
        if (data instanceof Date) {
            // Check if the date is valid
            if (isNaN(data.getTime())) {
                console.warn('Invalid date detected, converting to null:', data);
                return null;
            }
            return data;
        }
        
        if (Array.isArray(data)) {
            return data.map(item => this.sanitizeDataForFirebase(item));
        }
        
        if (typeof data === 'object') {
            const sanitized = {};
            for (const key in data) {
                sanitized[key] = this.sanitizeDataForFirebase(data[key]);
            }
            return sanitized;
        }
        
        return data;
    }

    async saveToFirebase() {
        try {
            // Save people
            for (const person of this.processedEntities.people) {
                const sanitizedPerson = this.sanitizeDataForFirebase(person);
                await this.saveOrUpdateEntity(sanitizedPerson, 'people');
            }
            
            // Save organizations
            for (const org of this.processedEntities.organizations) {
                const sanitizedOrg = this.sanitizeDataForFirebase(org);
                await this.saveOrUpdateEntity(sanitizedOrg, 'organizations');
            }
            
            // Save places
            for (const place of this.processedEntities.places) {
                const sanitizedPlace = this.sanitizeDataForFirebase(place);
                await this.saveOrUpdateEntity(sanitizedPlace, 'places');
            }
            
            // Save events (only new ones)
            for (const event of this.processedEntities.events) {
                const sanitizedEvent = this.sanitizeDataForFirebase(event);
                await addDoc(collection(db, 'events'), sanitizedEvent);
            }
            
        } catch (error) {
            console.error('Error saving to Firebase:', error);
            throw error;
        }
    }

    async saveOrUpdateEntity(entity, collectionName) {
        try {
            if (entity.firestoreId) {
                // Update existing entity
                const entityRef = doc(db, collectionName, entity.firestoreId);
                const updateData = { ...entity };
                delete updateData.firestoreId; // Remove Firestore metadata
                delete updateData.firestoreCollection;
                
                await updateDoc(entityRef, updateData);
                console.log(`Updated existing ${collectionName.slice(0, -1)}: ${entity.name}`);
            } else {
                // Create new entity
                await addDoc(collection(db, collectionName), entity);
                console.log(`Created new ${collectionName.slice(0, -1)}: ${entity.name}`);
            }
        } catch (error) {
            console.error(`Error saving ${collectionName.slice(0, -1)} ${entity.name}:`, error);
            throw error;
        }
    }

    async loadExistingData() {
        try {
            // Load existing data from Firebase
            const collections = ['people', 'organizations', 'places', 'events'];
            
            for (const collectionName of collections) {
                const querySnapshot = await getDocs(collection(db, collectionName));
                this.processedEntities[collectionName] = [];
                
                querySnapshot.forEach((doc) => {
                    this.processedEntities[collectionName].push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
            }
            
            this.updateStatistics();
            this.renderEntities();
            
        } catch (error) {
            console.error('Error loading existing data:', error);
        }
    }

    updateStatistics() {
        document.getElementById('peopleCount').textContent = this.processedEntities.people.length;
        document.getElementById('organizationsCount').textContent = this.processedEntities.organizations.length;
        document.getElementById('placesCount').textContent = this.processedEntities.places.length;
        document.getElementById('eventsCount').textContent = this.processedEntities.events.length;
    }

    renderEntities() {
        // Prepare all entities with normalized data
        this.filteredEntities = [
            ...this.processedEntities.people.map(e => ({...e, category: 'person'})),
            ...this.processedEntities.organizations.map(e => ({...e, category: 'organization'})),
            ...this.processedEntities.places.map(e => ({...e, category: 'place'}))
        ];
        
        this.filterEntities();
    }

    filterEntities() {
        const typeFilter = document.getElementById('typeFilter').value;
        const searchTerm = document.getElementById('entitySearch').value.toLowerCase();
        
        // Get all entities
        const allEntities = [
            ...this.processedEntities.people.map(e => ({...e, category: 'person'})),
            ...this.processedEntities.organizations.map(e => ({...e, category: 'organization'})),
            ...this.processedEntities.places.map(e => ({...e, category: 'place'}))
        ];
        
        // Apply filters
        this.filteredEntities = allEntities.filter(entity => {
            const matchesType = !typeFilter || entity.category === typeFilter;
            const matchesSearch = !searchTerm || 
                entity.name.toLowerCase().includes(searchTerm) ||
                (entity.description && entity.description.toLowerCase().includes(searchTerm)) ||
                (entity.aliases && entity.aliases.some(alias => alias.toLowerCase().includes(searchTerm)));
            
            return matchesType && matchesSearch;
        });
        
        // Sort entities
        this.sortEntitiesArray();
        
        // Render table
        this.renderTable();
    }

    sortEntities(field) {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        
        this.updateSortIndicators();
        this.sortEntitiesArray();
        
        this.renderTable();
    }

    sortEntitiesArray() {
        this.filteredEntities.sort((a, b) => {
            let aValue, bValue;
            
            switch (this.sortField) {
                case 'name':
                    aValue = a.name.toLowerCase();
                    bValue = b.name.toLowerCase();
                    break;
                case 'type':
                    aValue = a.category;
                    bValue = b.category;
                    break;
                case 'description':
                    aValue = (a.description || '').toLowerCase();
                    bValue = (b.description || '').toLowerCase();
                    break;
                case 'connections':
                    aValue = (a.connections || []).length;
                    bValue = (b.connections || []).length;
                    break;
                case 'wikidata':
                    aValue = a.wikidata_id ? 1 : 0;
                    bValue = b.wikidata_id ? 1 : 0;
                    break;
                default:
                    aValue = a.name.toLowerCase();
                    bValue = b.name.toLowerCase();
            }
            
            if (aValue < bValue) return this.sortDirection === 'asc' ? -1 : 1;
            if (aValue > bValue) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    updateSortIndicators() {
        // Remove all existing sort classes
        document.querySelectorAll('.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });
        
        // Add sort class to current field
        const currentSortTh = document.querySelector(`[data-sort="${this.sortField}"]`);
        if (currentSortTh) {
            currentSortTh.classList.add(`sort-${this.sortDirection}`);
        }
    }


    renderTable() {
        const tableBody = document.getElementById('entitiesTableBody');
        tableBody.innerHTML = '';
        
        if (this.filteredEntities.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="no-results">No entities found matching your criteria</td></tr>';
            return;
        }
        
        this.filteredEntities.forEach(entity => {
            const row = this.createTableRow(entity);
            tableBody.appendChild(row);
        });
        
        this.updateSortIndicators();
    }


    createTableRow(entity) {
        const row = document.createElement('tr');
        
        const connectionsCount = entity.connections ? entity.connections.length : 0;
        const entityType = entity.category || entity.type;
        const description = entity.description || 'No description available';
        const truncatedDescription = description.length > 100 ? description.substring(0, 100) + '...' : description;
        
        row.innerHTML = `
            <td class="entity-name-cell" onclick="window.location.href='profile.html?id=${entity.id}&type=${entityType}s'">${entity.name}</td>
            <td><span class="entity-type-badge ${entityType}">${entityType}</span></td>
            <td class="entity-description-cell" title="${description}">${truncatedDescription}</td>
            <td class="connections-count">${connectionsCount}</td>
            <td>${entity.wikidata_id ? `<a href="https://www.wikidata.org/wiki/${entity.wikidata_id}" class="wikidata-link">${entity.wikidata_id}</a>` : '—'}</td>
        `;
        
        return row;
    }


    showEntityProfile(entity) {
        // Navigate to profile page
        const entityType = entity.category || entity.type;
        const typeParam = entityType === 'person' ? 'people' : 
                         entityType === 'organization' ? 'organizations' : 'places';
        window.location.href = `profile.html?id=${entity.id}&type=${typeParam}`;
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('statusMessage');
        statusDiv.innerHTML = `<div class="status-message status-${type}">${message}</div>`;
    }

    showProgress(percent) {
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        
        if (percent > 0) {
            progressBar.classList.remove('hidden');
            progressFill.style.width = `${percent}%`;
        } else {
            progressBar.classList.add('hidden');
        }
    }

    clearData() {
        this.csvData = null;
        this.processedEntities = {
            people: [],
            organizations: [],
            places: [],
            events: []
        };
        
        document.getElementById('processingControls').classList.add('hidden');
        document.getElementById('statusMessage').innerHTML = '';
        this.showProgress(0);
        this.updateStatistics();
        this.renderEntities();
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new KnowledgeBaseApp();
});
