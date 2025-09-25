// Entity processing and management

import { LRUCache } from './lru-cache.js';
import { errorHandler } from './error-handler.js';
import { loadingManager } from './loading-manager.js';

export class EntityProcessor {
    constructor(wikidataService, firebaseService, dateTimeProcessor) {
        this.wikidataService = wikidataService;
        this.firebaseService = firebaseService;
        this.dateTimeProcessor = dateTimeProcessor;
        this.processedEntities = {
            people: [],
            organizations: [],
            places: [],
            unknown: [],
            events: []
        };
        
        // Enhanced caching systems with memory management
        this.entityCache = new LRUCache(500, 10); // 500 items, 10MB max
        this.wikidataCache = new LRUCache(1000, 20); // 1000 items, 20MB max
        this.nameVariationCache = new LRUCache(2000, 5); // 2000 items, 5MB max
        
        // Memory monitoring
        this.lastMemoryCheck = Date.now();
        this.memoryCheckInterval = 60000; // Check every minute
    }

    async processEntity(entityName, role, event) {
        
        // First check if entity exists in current session
        let entity = this.findExistingEntity(entityName);
        
        if (!entity) {
            // Always create new entity during ingest - deduplication happens separately
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
            
            // Update denormalized connection count
            entity.connectionCount = (entity.connectionCount || 0) + 1;
        }
        
        return entity;
    }

    async processLocationEntity(locationName, event) {
        let entity = this.findExistingEntity(locationName);
        
        if (!entity) {
            // Always create new entity during ingest - deduplication happens separately
            let wikidataInfo = null;
            
            // Check Wikidata cache first, but don't use null cache hits for locations either
            const cachedLocationData = this.wikidataCache.get(locationName);
            if (cachedLocationData !== undefined && cachedLocationData !== null) { // Only use successful cache hits
                wikidataInfo = cachedLocationData;
            } else {
                if (cachedLocationData === null) {
                }
                try {
                    // Add timeout wrapper for location Wikidata calls
                    wikidataInfo = await Promise.race([
                        this.wikidataService.searchWikidata(locationName),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Location Wikidata search timeout')), 8000)
                        )
                    ]);
                    // Cache the result for future use
                    this.wikidataCache.set(locationName, wikidataInfo);
                } catch (error) {
                    if (error.message === 'Location Wikidata search timeout') {
                        console.warn(`Location Wikidata search timeout for: ${locationName}`);
                    } else {
                        console.warn('EntityProcessor: Wikidata search failed for location', locationName, error);
                    }
                    // Cache null results to avoid repeated failed API calls
                    this.wikidataCache.set(locationName, null);
                    wikidataInfo = null;
                }
            }
            
            // Extract Wikidata fields for location
            const wikidataFields = this.extractWikidataFields(wikidataInfo);
            
            // Merge aliases properly for locations too
            const mergedAliases = [locationName];
            if (wikidataFields.aliases && Array.isArray(wikidataFields.aliases)) {
                wikidataFields.aliases.forEach(alias => {
                    if (!mergedAliases.includes(alias)) {
                        mergedAliases.push(alias);
                    }
                });
            }

            entity = {
                id: `place_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: locationName,
                type: 'place',
                category: this.classifyLocation(locationName, wikidataInfo),
                wikidata_id: wikidataInfo?.id || null,
                description: wikidataInfo?.description || '',
                connections: [],
                coordinates: wikidataInfo?.coordinates || null,
                // Always include these fields for places too
                educated_at: [],
                residences: [],
                member_of: [],
                languages_spoken: [],
                employer: [],
                occupation: [],
                spouse: [],
                children: [],
                parents: [],
                siblings: [],
                ...wikidataFields,
                aliases: mergedAliases // Put aliases last to ensure proper merging
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
            
            // Update denormalized connection count
            entity.connectionCount = (entity.connectionCount || 0) + 1;
        }
        
        return entity;
    }

    async createNewEntity(entityName, role) {
        let wikidataInfo = null;
        
        
        // Check Wikidata cache first, but don't use null cache hits - retry failed calls
        const cachedWikidata = this.wikidataCache.get(entityName);
        if (cachedWikidata !== undefined && cachedWikidata !== null) { // Only use successful cache hits
            wikidataInfo = cachedWikidata;
        } else {
            
            try {
                // Add timeout wrapper for Wikidata calls
                wikidataInfo = await Promise.race([
                    errorHandler.withErrorHandling(
                        () => this.wikidataService.searchWikidata(entityName),
                        { operation: 'wikidata_search', entityName }
                    ),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Wikidata search timeout')), 8000) // 8 second timeout
                    )
                ]);
                
                // Cache the result for future use
                this.wikidataCache.set(entityName, wikidataInfo);
            } catch (error) {
                if (error.message === 'Wikidata search timeout') {
                    console.warn(`Wikidata search timeout for entity: ${entityName}`);
                } else {
                    errorHandler.handleError(error, { 
                        operation: 'wikidata_search', 
                        entityName,
                        severity: errorHandler.constructor.Severity.LOW 
                    });
                }
                // Cache null results to avoid repeated failed API calls
                this.wikidataCache.set(entityName, null);
                wikidataInfo = null;
            }
        }
        
        // Check memory usage periodically
        this.checkMemoryUsage();
        
        // Extract Wikidata fields first
        const wikidataFields = this.extractWikidataFields(wikidataInfo);
        
        // Merge aliases properly - combine entity name with Wikidata aliases
        const mergedAliases = [entityName];
        if (wikidataFields.aliases && Array.isArray(wikidataFields.aliases)) {
            // Add Wikidata aliases that aren't already included
            wikidataFields.aliases.forEach(alias => {
                if (!mergedAliases.includes(alias)) {
                    mergedAliases.push(alias);
                }
            });
        }

        const entity = {
            id: `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: entityName,
            type: this.determineEntityType(entityName, wikidataInfo, role),
            wikidata_id: wikidataInfo?.id || null,
            description: wikidataInfo?.description || '',
            connections: [],
            // Always include these fields, even if empty, so they appear in Firebase
            educated_at: [],
            residences: [],
            member_of: [],
            languages_spoken: [],
            employer: [],
            occupation: [],
            spouse: [],
            children: [],
            parents: [],
            siblings: [],
            ...wikidataFields, // This will override the empty arrays if Wikidata has data
            aliases: mergedAliases // Put aliases last to ensure proper merging
        };
        
        // Add to appropriate collection
        if (entity.type === 'person') {
            this.processedEntities.people.push(entity);
        } else if (entity.type === 'organization') {
            this.processedEntities.organizations.push(entity);
        } else if (entity.type === 'place') {
            entity.category = this.classifyLocation(entityName, wikidataInfo);
            this.processedEntities.places.push(entity);
        } else {
            // entity.type === 'unknown'
            this.processedEntities.unknown.push(entity);
        }
        
        return entity;
    }

    findExistingEntity(name) {
        const allEntities = [
            ...this.processedEntities.people,
            ...this.processedEntities.organizations,
            ...this.processedEntities.places,
            ...this.processedEntities.unknown
        ];
        
        // First try exact name matching for speed
        const nameLower = name.toLowerCase();
        let match = allEntities.find(entity => 
            entity.name.toLowerCase() === nameLower ||
            (entity.aliases && entity.aliases.some(alias => alias.toLowerCase() === nameLower))
        );
        
        if (match) {
            return match;
        }
        
        // Try normalized form matching
        const normalizedName = this.normalizeEntityName(name);
        const normalizedNameLower = normalizedName.toLowerCase();
        
        if (normalizedNameLower !== nameLower) {
            match = allEntities.find(entity => {
                // Check if entity name or aliases match the normalized form
                const entityNormalizedLower = this.normalizeEntityName(entity.name).toLowerCase();
                if (entityNormalizedLower === normalizedNameLower) {
                    return true;
                }
                
                // Check aliases
                if (entity.aliases) {
                    return entity.aliases.some(alias => {
                        const aliasNormalizedLower = this.normalizeEntityName(alias).toLowerCase();
                        return aliasNormalizedLower === normalizedNameLower;
                    });
                }
                
                return false;
            });
        }
        
        return match || null;
    }

    ensureEntityInProcessedList(entity) {
        const entityType = entity.type || entity.category;
        let targetList;
        
        if (entityType === 'person') {
            targetList = this.processedEntities.people;
        } else if (entityType === 'organization') {
            targetList = this.processedEntities.organizations;
        } else if (entityType === 'place') {
            targetList = this.processedEntities.places;
        } else {
            targetList = this.processedEntities.unknown;
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

    normalizeEntityName(name) {
        let normalized = name.trim();
        
        // Handle possessives - remove 's or s'
        normalized = normalized.replace(/['']s$/i, '');  // Qatar's → Qatar
        normalized = normalized.replace(/s['']$/i, '');  // countries' → countries
        
        // Handle common plurals
        const pluralRules = [
            // Irregular plurals (most specific first)
            { pattern: /\bchildren$/i, replacement: 'child' },
            { pattern: /\bpeople$/i, replacement: 'person' },
            { pattern: /\bmen$/i, replacement: 'man' },
            { pattern: /\bwomen$/i, replacement: 'woman' },
            { pattern: /\bmice$/i, replacement: 'mouse' },
            { pattern: /\bfeet$/i, replacement: 'foot' },
            { pattern: /\bgeese$/i, replacement: 'goose' },
            { pattern: /\bteeth$/i, replacement: 'tooth' },
            
            // Common group/organization plurals
            { pattern: /\bhouthis$/i, replacement: 'Houthi' },
            { pattern: /\btaliban$/i, replacement: 'Taliban' }, // Already singular but often treated as plural
            { pattern: /\bhezbollah$/i, replacement: 'Hezbollah' },
            { pattern: /\bisraelis$/i, replacement: 'Israeli' },
            { pattern: /\bpalestinians$/i, replacement: 'Palestinian' },
            { pattern: /\bamericans$/i, replacement: 'American' },
            { pattern: /\brussians$/i, replacement: 'Russian' },
            { pattern: /\bchinese$/i, replacement: 'Chinese' }, // Same for singular/plural
            { pattern: /\brepublicans$/i, replacement: 'Republican' },
            { pattern: /\bdemocrats$/i, replacement: 'Democrat' },
            
            // Words ending in -ies
            { pattern: /ies$/i, replacement: 'y' },
            
            // Words ending in -ves
            { pattern: /ves$/i, replacement: 'f' },
            
            // Words ending in -ses, -ches, -shes, -xes
            { pattern: /(s|ch|sh|x)es$/i, replacement: '$1' },
            
            // Words ending in -s (but not -ss, -us, -is)
            { pattern: /([^susi])s$/i, replacement: '$1' },
        ];
        
        // Apply plural rules
        for (const rule of pluralRules) {
            if (rule.pattern.test(normalized)) {
                normalized = normalized.replace(rule.pattern, rule.replacement);
                break; // Apply only the first matching rule
            }
        }
        
        return normalized.trim();
    }

    generateSearchVariations(query) {
        // Check cache first
        if (this.nameVariationCache.has(query)) {
            return this.nameVariationCache.get(query);
        }
        
        const variations = [query];
        const lowerQuery = query.toLowerCase().trim();
        
        // Add normalized form (handle plurals and possessives)
        const normalized = this.normalizeEntityName(query);
        if (normalized !== query) {
            variations.push(normalized);
        }
        
        // Remove common prefixes and articles
        const prefixesToRemove = ['the ', 'a ', 'an '];
        for (const prefix of prefixesToRemove) {
            if (lowerQuery.startsWith(prefix)) {
                const withoutPrefix = query.substring(prefix.length).trim();
                if (withoutPrefix.length > 0) {
                    variations.push(withoutPrefix);
                    // Also normalize the version without prefixes
                    const normalizedWithoutPrefix = this.normalizeEntityName(withoutPrefix);
                    if (normalizedWithoutPrefix !== withoutPrefix) {
                        variations.push(normalizedWithoutPrefix);
                    }
                }
            }
        }
        
        // Add version with "the" if it doesn't already have it
        if (!lowerQuery.startsWith('the ')) {
            variations.push(`the ${query}`);
            // Also add normalized version with "the"
            if (normalized !== query) {
                variations.push(`the ${normalized}`);
            }
        }
        
        // Remove punctuation variations
        const noPunctuation = query.replace(/[.,!?;:'"()-]/g, '').trim();
        if (noPunctuation !== query && noPunctuation.length > 0) {
            variations.push(noPunctuation);
            // Also normalize the version without punctuation
            const normalizedNoPunctuation = this.normalizeEntityName(noPunctuation);
            if (normalizedNoPunctuation !== noPunctuation) {
                variations.push(normalizedNoPunctuation);
            }
        }
        
        // Remove duplicates
        const uniqueVariations = [...new Set(variations)];
        
        // Cache the result
        this.nameVariationCache.set(query, uniqueVariations);
        
        return uniqueVariations;
    }

    // Cache management methods
    clearCaches() {
        this.entityCache.clear();
        this.wikidataCache.clear();
        this.nameVariationCache.clear();
    }

    // Clear just the Wikidata cache to force fresh API calls
    clearWikidataCache() {
        this.wikidataCache.clear();
    }

    getCacheStats() {
        return {
            entityCacheSize: this.entityCache.size,
            wikidataCacheSize: this.wikidataCache.size,
            nameVariationCacheSize: this.nameVariationCache.size
        };
    }

    splitCompoundEntities(entityString) {
        if (!entityString || entityString.trim() === '') return [];
        
        // First split by conjunctions (and, &, plus)
        const conjunctionPattern = /\s+(?:and|&|\+)\s+/i;
        const conjunctionParts = entityString.split(conjunctionPattern);
        
        if (conjunctionParts.length > 1) {
            // Multiple entities connected by conjunctions
            const splitEntities = [];
            
            for (const part of conjunctionParts) {
                // For each part, also check for comma-separated entities
                const commaSplit = this.parseCommaSeparatedEntities(part.trim());
                splitEntities.push(...commaSplit);
            }
            
            return splitEntities;
        }
        
        // No conjunctions found, just parse comma-separated entities
        return this.parseCommaSeparatedEntities(entityString);
    }

    parseCommaSeparatedEntities(entityString) {
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

    parseEntities(entityString) {
        return this.splitCompoundEntities(entityString);
    }

    determineEntityType(name, wikidataInfo, role = null) {
        // Strong role-based hints - actors and targets are often people
        if (role === 'actor' || role === 'target') {
            // First check if it's clearly NOT a person
            if (this.isOrganization(name, wikidataInfo)) return 'organization';
            if (this.isPlace(name, wikidataInfo)) return 'place';
            
            // If it's not clearly an org or place, and it's an actor/target, lean towards person
            if (this.isPerson(name, wikidataInfo)) return 'person';
            
            // For actors/targets that don't clearly match other categories, don't assume person
            // Let it fall through to the default classification logic
        }
        
        // Default logic for non-actor/target entities
        if (this.isPerson(name, wikidataInfo)) return 'person';
        if (this.isOrganization(name, wikidataInfo)) return 'organization';
        if (this.isPlace(name, wikidataInfo)) return 'place';
        return 'unknown';
    }

    isPerson(name, wikidataInfo) {
        // First check Wikidata if available
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('human') || instance.includes('person')) {
                return true;
            }
        }
        
        // Enhanced name patterns that suggest a person
        const personPatterns = [
            /^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|President|Prime Minister|Minister|Secretary|Ambassador|Senator|Representative|Governor|Mayor)/, // Titles
            /\b(Jr\.|Sr\.|III|IV)\b/, // Suffixes
        ];
        
        // Check for formal patterns first
        if (personPatterns.some(pattern => pattern.test(name))) {
            return true;
        }
        
        // Improved heuristics for person names
        const nameParts = name.trim().split(/\s+/);
        
        // Single word names are less likely to be people (unless they're known single names)
        if (nameParts.length === 1) {
            // Check for known single-name patterns or very short names that are likely organizations
            if (name.length <= 3 || /^(LLC|Inc|Corp|Ltd|GmbH|SA|AG|PLC|Technology)$/i.test(name)) {
                return false;
            }
            // Single names could be people (like "Madonna", "Cher") but are less common
            return false;
        }
        
        // Two or more words - check for explicit exclusions but don't assume person
        if (nameParts.length >= 2) {
            // Check if it looks like an organization
            const orgKeywords = [
                'corporation', 'company', 'inc', 'llc', 'ltd', 'corp', 'group', 'association', 
                'foundation', 'institute', 'university', 'college', 'school', 'hospital',
                'department', 'ministry', 'agency', 'bureau', 'office', 'commission',
                'party', 'union', 'federation', 'council', 'committee', 'board',
                'bank', 'financial', 'investment', 'capital', 'holdings', 'ventures',
                'international', 'national', 'government', 'global', 'worldwide', 'systems', 'solutions',
                'technologies', 'semiconductor', 'services', 'industries', 'enterprises', 'partners'
            ];
            
            const nameLower = name.toLowerCase();
            if (orgKeywords.some(keyword => nameLower.includes(keyword))) {
                return false;
            }
            
            // Check for place indicators
            const placeKeywords = [
                'city', 'town', 'village', 'county', 'state', 'province', 'region',
                'country', 'republic', 'kingdom', 'district', 'territory', 'island',
                'mountain', 'river', 'lake', 'ocean', 'sea', 'bay', 'valley', 'street',
                'avenue', 'road', 'boulevard', 'square', 'plaza', 'center', 'centre'
            ];
            
            if (placeKeywords.some(keyword => nameLower.includes(keyword))) {
                return false;
            }
            
            // Don't assume person just based on word count - require explicit indicators
        }
        
        return false;
    }

    isOrganization(name, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('organization') || instance.includes('company') || 
                instance.includes('corporation') || instance.includes('institution') ||
                instance.includes('business') || instance.includes('enterprise') ||
                instance.includes('firm') || instance.includes('agency')) {
                return true;
            }
        }
        
        const orgKeywords = ['corp', 'inc', 'llc', 'ltd', 'company', 'corporation', 'institute', 'university', 'business', 'college'];
        const nameLower = name.toLowerCase();
        return orgKeywords.some(keyword => nameLower.includes(keyword));
    }

    isPlace(name, wikidataInfo) {
        if (wikidataInfo?.instance_of) {
            const instance = wikidataInfo.instance_of.toLowerCase();
            if (instance.includes('city') || instance.includes('country') || 
                instance.includes('state') || instance.includes('province') ||
                instance.includes('region') || instance.includes('territory') ||
                instance.includes('municipality') || instance.includes('district') ||
                instance.includes('location') || instance.includes('place')) {
                return true;
            }
        }
        
        // Check if it has coordinates (strong indicator of a place)
        if (wikidataInfo?.coordinates) {
            return true;
        }
        
        // Name-based heuristics for places
        const placeKeywords = ['city', 'town', 'village', 'county', 'state', 'province', 
                              'country', 'region', 'district', 'territory', 'island',
                              'mountain', 'river', 'lake', 'ocean', 'sea', 'bay', 'valley'];
        
        const nameLower = name.toLowerCase();
        return placeKeywords.some(keyword => nameLower.includes(keyword));
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
        
        // Basic fields
        if (wikidataInfo.occupation && wikidataInfo.occupation.length > 0) fields.occupation = wikidataInfo.occupation;
        if (wikidataInfo.dateOfBirth) fields.dateOfBirth = wikidataInfo.dateOfBirth;
        if (wikidataInfo.country) fields.country = wikidataInfo.country;
        if (wikidataInfo.founded) fields.founded = wikidataInfo.founded;
        if (wikidataInfo.instance_of) fields.instance_of = wikidataInfo.instance_of;
        
        // Enhanced fields that were being fetched but not saved - include even if empty to show in Firebase
        if (wikidataInfo.hasOwnProperty('aliases')) {
            fields.aliases = Array.isArray(wikidataInfo.aliases) ? wikidataInfo.aliases : [];
        }
        if (wikidataInfo.hasOwnProperty('educated_at')) {
            fields.educated_at = Array.isArray(wikidataInfo.educated_at) ? wikidataInfo.educated_at : [];
        }
        if (wikidataInfo.hasOwnProperty('residences')) {
            fields.residences = Array.isArray(wikidataInfo.residences) ? wikidataInfo.residences : [];
        }
        if (wikidataInfo.hasOwnProperty('member_of')) {
            fields.member_of = Array.isArray(wikidataInfo.member_of) ? wikidataInfo.member_of : [];
        }
        if (wikidataInfo.hasOwnProperty('languages_spoken')) {
            fields.languages_spoken = Array.isArray(wikidataInfo.languages_spoken) ? wikidataInfo.languages_spoken : [];
        }
        if (wikidataInfo.hasOwnProperty('employer')) {
            fields.employer = Array.isArray(wikidataInfo.employer) ? wikidataInfo.employer : [];
        }
        if (wikidataInfo.coordinates) fields.coordinates = wikidataInfo.coordinates;
        if (wikidataInfo.population) fields.population = wikidataInfo.population;
        
        // Family relations - include even if empty to show in Firebase
        if (wikidataInfo.hasOwnProperty('spouse')) {
            fields.spouse = Array.isArray(wikidataInfo.spouse) ? wikidataInfo.spouse : [];
        }
        if (wikidataInfo.hasOwnProperty('children')) {
            fields.children = Array.isArray(wikidataInfo.children) ? wikidataInfo.children : [];
        }
        if (wikidataInfo.hasOwnProperty('parents')) {
            fields.parents = Array.isArray(wikidataInfo.parents) ? wikidataInfo.parents : [];
        }
        if (wikidataInfo.hasOwnProperty('siblings')) {
            fields.siblings = Array.isArray(wikidataInfo.siblings) ? wikidataInfo.siblings : [];
        }
        
        return fields;
    }

    extractLocationFields(wikidataInfo) {
        if (!wikidataInfo) return {};
        
        const fields = {};
        
        if (wikidataInfo.country) fields.country = wikidataInfo.country;
        if (wikidataInfo.population) fields.population = wikidataInfo.population;
        
        return fields;
    }

    // Memory management methods
    checkMemoryUsage() {
        const now = Date.now();
        if (now - this.lastMemoryCheck < this.memoryCheckInterval) {
            return;
        }
        
        this.lastMemoryCheck = now;
        
        const entityCacheStats = this.entityCache.getStats();
        const wikidataCacheStats = this.wikidataCache.getStats();
        const nameCacheStats = this.nameVariationCache.getStats();
        
        return {
            entityCache: entityCacheStats,
            wikidataCache: wikidataCacheStats,
            nameVariationCache: nameCacheStats,
            totalMemoryMB: (
                parseFloat(entityCacheStats.memory.mb) + 
                parseFloat(wikidataCacheStats.memory.mb) + 
                parseFloat(nameCacheStats.memory.mb)
            ).toFixed(2)
        };
        
        // Force cleanup if memory usage is high
        const totalMemoryPercentage = 
            parseFloat(entityCacheStats.memory.percentage) +
            parseFloat(wikidataCacheStats.memory.percentage) +
            parseFloat(nameCacheStats.memory.percentage);
            
        if (totalMemoryPercentage > 80) {
            console.warn('EntityProcessor: High memory usage detected, forcing cache cleanup');
            this.clearOldCaches();
        }
    }

    clearOldCaches() {
        // Clear oldest entries from all caches
        const entitiesToClear = Math.floor(this.entityCache.size() * 0.2);
        const wikidataToCache = Math.floor(this.wikidataCache.size() * 0.2);
        const namesToClear = Math.floor(this.nameVariationCache.size() * 0.2);
        
        for (let i = 0; i < entitiesToClear; i++) {
            this.entityCache.cleanup();
        }
        for (let i = 0; i < wikidataToCache; i++) {
            this.wikidataCache.cleanup();
        }
        for (let i = 0; i < namesToClear; i++) {
            this.nameVariationCache.cleanup();
        }
        
    }

    getMemoryStats() {
        return {
            entityCache: this.entityCache.getStats(),
            wikidataCache: this.wikidataCache.getStats(),
            nameVariationCache: this.nameVariationCache.getStats(),
            processedEntitiesCount: {
                people: this.processedEntities.people.length,
                organizations: this.processedEntities.organizations.length,
                places: this.processedEntities.places.length,
                unknown: this.processedEntities.unknown.length,
                events: this.processedEntities.events.length
            }
        };
    }
}
