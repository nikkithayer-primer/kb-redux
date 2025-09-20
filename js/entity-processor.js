// Entity processing and management

export class EntityProcessor {
    constructor(wikidataService, firebaseService, dateTimeProcessor) {
        this.wikidataService = wikidataService;
        this.firebaseService = firebaseService;
        this.dateTimeProcessor = dateTimeProcessor;
        this.processedEntities = {
            people: [],
            organizations: [],
            places: [],
            events: []
        };
    }

    async processEntity(entityName, role, event) {
        // First check if entity exists in current session
        let entity = this.findExistingEntity(entityName);
        
        if (!entity) {
            // Check Firebase
            entity = await this.firebaseService.findEntityInFirebase(entityName, [entityName]);
        }
        
        if (entity) {
            // Entity exists, add it to processed list if not already there
            this.ensureEntityInProcessedList(entity);
        } else {
            // Create new entity
            entity = await this.createNewEntity(entityName, role);
        }
        
        // Add connection if it doesn't already exist
        if (!this.connectionExists(entity, event, role)) {
            const connection = {
                eventId: event.id,
                action: event.action,
                role: role,
                relatedEntities: {
                    actors: this.parseEntities(event.actor),
                    targets: this.parseEntities(event.target),
                    locations: event.locations || []
                },
                timestamp: event.dateReceived,
                sentence: event.sentence
            };
            
            if (!entity.connections) entity.connections = [];
            entity.connections.push(connection);
        }
        
        return entity;
    }

    async processLocationEntity(locationName, event) {
        console.log('EntityProcessor: Processing location entity', locationName);
        let entity = this.findExistingEntity(locationName);
        
        if (!entity) {
            entity = await this.firebaseService.findEntityInFirebase(locationName, [locationName]);
        }
        
        if (entity) {
            this.ensureEntityInProcessedList(entity);
        } else {
            let wikidataInfo = null;
            
            try {
                wikidataInfo = await this.wikidataService.searchWikidata(locationName);
                console.log('EntityProcessor: Wikidata search completed for location', locationName);
            } catch (error) {
                console.warn('EntityProcessor: Wikidata search failed for location', locationName, error);
            }
            
            entity = {
                id: `place_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: locationName,
                aliases: [locationName],
                type: 'place',
                category: this.classifyLocation(locationName, wikidataInfo),
                wikidata_id: wikidataInfo?.id || null,
                description: wikidataInfo?.description || '',
                connections: [],
                coordinates: wikidataInfo?.coordinates || null,
                ...this.extractLocationFields(wikidataInfo)
            };
            
            this.processedEntities.places.push(entity);
        }
        
        // Add connection
        if (!this.connectionExists(entity, event, 'location')) {
            const connection = {
                eventId: event.id,
                action: event.action,
                role: 'location',
                relatedEntities: {
                    actors: this.parseEntities(event.actor),
                    targets: this.parseEntities(event.target),
                    locations: event.locations || []
                },
                timestamp: event.dateReceived,
                sentence: event.sentence
            };
            
            if (!entity.connections) entity.connections = [];
            entity.connections.push(connection);
        }
        
        return entity;
    }

    async createNewEntity(entityName, role) {
        console.log('EntityProcessor: Creating new entity for', entityName);
        let wikidataInfo = null;
        
        try {
            wikidataInfo = await this.wikidataService.searchWikidata(entityName);
            console.log('EntityProcessor: Wikidata search completed for', entityName);
        } catch (error) {
            console.warn('EntityProcessor: Wikidata search failed for', entityName, error);
        }
        
        const entity = {
            id: `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: entityName,
            aliases: [entityName],
            type: this.determineEntityType(entityName, wikidataInfo, role),
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
            entity.type = 'place';
            entity.category = this.classifyLocation(entityName, wikidataInfo);
            this.processedEntities.places.push(entity);
        }
        
        return entity;
    }

    findExistingEntity(name) {
        const allEntities = [
            ...this.processedEntities.people,
            ...this.processedEntities.organizations,
            ...this.processedEntities.places
        ];
        
        // Simple name matching for speed
        const nameLower = name.toLowerCase();
        const match = allEntities.find(entity => 
            entity.name.toLowerCase() === nameLower ||
            (entity.aliases && entity.aliases.some(alias => alias.toLowerCase() === nameLower))
        );
        
        if (match) {
            return match;
        }
        
        return null;
    }

    ensureEntityInProcessedList(entity) {
        const entityType = entity.type || entity.category;
        let targetList;
        
        if (entityType === 'person') {
            targetList = this.processedEntities.people;
        } else if (entityType === 'organization') {
            targetList = this.processedEntities.organizations;
        } else {
            targetList = this.processedEntities.places;
        }
        
        // Check if entity already exists in the list
        const exists = targetList.find(e => e.id === entity.id || 
            (entity.firestoreId && e.firestoreId === entity.firestoreId));
        
        if (!exists) {
            targetList.push(entity);
        }
    }

    connectionExists(entity, event, role) {
        if (!entity.connections) return false;
        
        return entity.connections.some(connection => 
            connection.action === event.action &&
            connection.role === role &&
            this.isSameEvent(connection, event)
        );
    }

    isSameEvent(connection, event) {
        // Check by event ID first
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
            const sameDay = this.dateTimeProcessor.isSameDay(connection.timestamp, event.dateReceived);
            
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

    parseEntities(entityString) {
        if (!entityString || entityString.trim() === '') return [];
        
        const entities = [];
        const parts = entityString.split(',');
        let current = '';
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            current += (current ? ', ' : '') + part;
            
            if (i === parts.length - 1 || 
                (parts[i + 1] && parts[i + 1].trim().match(/^[A-Z]/) && 
                 !current.match(/\b(D\.C\.|U\.S\.|U\.K\.|St\.|Dr\.|Mr\.|Mrs\.|Ms\.)$/))) {
                entities.push(current.trim());
                current = '';
            }
        }
        
        return entities.filter(e => e.length > 0);
    }

    determineEntityType(name, wikidataInfo, role = null) {
        // Use role hint if available
        if (role === 'actor' || role === 'target') {
            if (this.isPerson(name, wikidataInfo)) return 'person';
            if (this.isOrganization(name, wikidataInfo)) return 'organization';
        }
        
        // Default logic
        if (this.isPerson(name, wikidataInfo)) return 'person';
        if (this.isOrganization(name, wikidataInfo)) return 'organization';
        return 'place';
    }

    isPerson(name, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('human') || instance.includes('person')) {
                return true;
            }
        }
        
        // Name patterns that suggest a person
        const personPatterns = [
            /^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)/, // Titles
            /\b(Jr\.|Sr\.|III|IV)\b/, // Suffixes
        ];
        
        return personPatterns.some(pattern => pattern.test(name));
    }

    isOrganization(name, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('organization') || instance.includes('company') || 
                instance.includes('corporation') || instance.includes('institution')) {
                return true;
            }
        }
        
        const orgKeywords = ['corp', 'inc', 'llc', 'ltd', 'company', 'corporation', 'institute', 'university', 'college'];
        const nameLower = name.toLowerCase();
        return orgKeywords.some(keyword => nameLower.includes(keyword));
    }

    classifyLocation(locationName, wikidataInfo) {
        const name = locationName.toLowerCase();
        
        // Use Wikidata info if available
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('country')) return 'country';
            if (instance.includes('city')) return 'city';
            if (instance.includes('state')) return 'state';
        }
        
        // Fallback to name-based classification
        const commonCountries = ['united states', 'usa', 'america', 'canada', 'mexico'];
        if (commonCountries.includes(name)) return 'country';
        
        if (name.includes('state') || name.includes('province')) return 'state';
        if (name.includes('city') || name.includes('town')) return 'city';
        
        return 'place';
    }

    extractWikidataFields(wikidataInfo) {
        if (!wikidataInfo) return {};
        
        const fields = {};
        
        if (wikidataInfo.occupation) fields.occupation = wikidataInfo.occupation;
        if (wikidataInfo.dateOfBirth) fields.dateOfBirth = wikidataInfo.dateOfBirth;
        if (wikidataInfo.country) fields.country = wikidataInfo.country;
        if (wikidataInfo.founded) fields.founded = wikidataInfo.founded;
        
        return fields;
    }

    extractLocationFields(wikidataInfo) {
        if (!wikidataInfo) return {};
        
        const fields = {};
        
        if (wikidataInfo.country) fields.country = wikidataInfo.country;
        if (wikidataInfo.population) fields.population = wikidataInfo.population;
        
        return fields;
    }
}
