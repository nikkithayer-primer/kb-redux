import { db } from './config.js';
import { collection, doc, getDocs, updateDoc, query, where, deleteDoc, addDoc, limit, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

class EntityProfile {
    constructor(entityId = null, entityType = null) {
        this.entityId = entityId || new URLSearchParams(window.location.search).get('id');
        this.entityType = entityType || new URLSearchParams(window.location.search).get('type');
        this.currentEntity = null;
        this.allEntities = [];
        this.allEvents = [];
        this.networkGraph = null;
        this.map = null;
        
        // Simple caching to prevent repeated queries
        this.entityCache = new Map();
        this.eventsCache = new Map();
        
        // Only redirect if we're on the profile.html page
        if (!this.entityId || !this.entityType) {
            if (window.location.pathname.includes('profile.html')) {
                window.location.href = 'index.html';
                return;
            }
        }
        
        this.initializeEventListeners();
        if (this.entityId && this.entityType) {
            this.loadEntityData();
        }
    }

    loadSpecificEntity(entityId, entityType) {
        this.entityId = entityId;
        this.entityType = entityType;
        this.cleanup();
        this.loadEntityData();
    }

    cleanup() {
        // Clean up map
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        
        // Clear containers
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.innerHTML = '';
        }
        
        const networkContainer = document.getElementById('networkGraph');
        if (networkContainer) {
            networkContainer.innerHTML = '';
        }
    }

    initializeEventListeners() {
        // Helper function to safely add event listeners
        const safeAddEventListener = (id, event, handler) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener(event, handler);
            } else {
                console.warn(`Element with id '${id}' not found`);
            }
        };

        // Edit functionality
        safeAddEventListener('editBtn', 'click', () => this.showEditModal());
        safeAddEventListener('closeEditModal', 'click', () => this.hideEditModal());
        safeAddEventListener('cancelEditBtn', 'click', () => this.hideEditModal());
        safeAddEventListener('entityForm', 'submit', (e) => this.saveEntity(e));
        
        // Wikidata search
        safeAddEventListener('wikidataSearch', 'input', (e) => this.searchWikidata(e.target.value));
        safeAddEventListener('editWikidataId', 'input', (e) => this.validateWikidataId(e.target.value));
        
        // Clear Wikidata ID button
        safeAddEventListener('clearWikidataId', 'click', () => this.clearWikidataId());
        
        // Other actions
        safeAddEventListener('exportBtn', 'click', () => this.exportEntityData());
        
        // Entity type change handler (no additional fields to update anymore)
        // safeAddEventListener('editType', 'change', (e) => this.updateAdditionalFields(e.target.value));
    }

    async loadEntityData() {
        try {
            // Load the specific entity
            const entityQuery = query(collection(db, this.entityType), where('id', '==', this.entityId));
            const entitySnapshot = await getDocs(entityQuery);
            
            if (entitySnapshot.empty) {
                this.showError('Entity not found');
                return;
            }
            
            this.currentEntity = { 
                firestoreId: entitySnapshot.docs[0].id, 
                ...entitySnapshot.docs[0].data() 
            };
            
            // Load all entities for connections
            await this.loadRelatedEntities();
            
            // Render the profile
            this.renderEntityProfile();
            this.renderConnections();
            this.renderEvents();
            
            // Only show network graph and map for known entity types
            if (this.currentEntity.type !== 'unknown') {
                this.showNetworkGraphAndMap();
                this.initializeNetworkGraph();
                this.initializeMap();
            } else {
                this.hideNetworkGraphAndMap();
            }
            
        } catch (error) {
            console.error('Error loading entity data:', error);
            this.showError('Failed to load entity data');
        }
    }

    async loadRelatedEntities() {
        // Only load entities that are actually connected to this entity
        // Much more efficient than loading everything
        this.allEntities = [this.currentEntity]; // Start with current entity
        this.relatedEntityIds = new Set([this.currentEntity.id]);
        
        // Get events related to this entity to find connections
        await this.loadRelatedEvents();
        
        // Extract entity names from related events
        const entityNames = new Set();
        this.allEvents.forEach(event => {
            // Add actors
            if (event.actor) {
                event.actor.split(',').forEach(name => entityNames.add(name.trim()));
            }
            // Add targets
            if (event.target) {
                event.target.split(',').forEach(name => entityNames.add(name.trim()));
            }
            // Add locations
            if (event.locations) {
                if (Array.isArray(event.locations)) {
                    event.locations.forEach(loc => {
                        const locName = typeof loc === 'string' ? loc : loc.name;
                        if (locName) entityNames.add(locName);
                    });
                } else {
                    event.locations.split(',').forEach(name => entityNames.add(name.trim()));
                }
            }
        });

        // Query only for entities we actually need
        const collections = ['people', 'organizations', 'places'];
        const nameArray = Array.from(entityNames);
        
        // Batch queries in chunks of 10 (Firestore 'in' query limit)
        for (const collectionName of collections) {
            for (let i = 0; i < nameArray.length; i += 10) {
                const nameChunk = nameArray.slice(i, i + 10);
                if (nameChunk.length === 0) continue;
                
                try {
                    const q = query(
                        collection(db, collectionName),
                        where('name', 'in', nameChunk)
                    );
                    const querySnapshot = await getDocs(q);
                    
                    querySnapshot.forEach((doc) => {
                        const entityData = {
                            id: doc.id,
                            firestoreId: doc.id,
                            type: collectionName.slice(0, -1),
                            ...doc.data()
                        };
                        
                        // Only add if not already present
                        if (!this.relatedEntityIds.has(entityData.id)) {
                            this.allEntities.push(entityData);
                            this.relatedEntityIds.add(entityData.id);
                        }
                    });
                } catch (error) {
                    console.warn(`Error querying ${collectionName}:`, error);
                }
            }
        }
        
    }

    async loadRelatedEvents() {
        // Only load events that mention this entity
        const entityName = this.currentEntity.name;
        
        // Check cache first
        if (this.eventsCache.has(entityName)) {
            this.allEvents = this.eventsCache.get(entityName);
            return;
        }
        
        this.allEvents = [];
        
        try {
            // Query events where this entity is an actor
            const actorQuery = query(
                collection(db, 'events'),
                where('actor', '>=', entityName),
                where('actor', '<=', entityName + '\uf8ff')
            );
            const actorSnapshot = await getDocs(actorQuery);
            
            // Query events where this entity is a target
            const targetQuery = query(
                collection(db, 'events'),
                where('target', '>=', entityName),
                where('target', '<=', entityName + '\uf8ff')
            );
            const targetSnapshot = await getDocs(targetQuery);
            
            const eventIds = new Set();
            
            // Process actor events
            actorSnapshot.forEach((doc) => {
                const eventData = { id: doc.id, ...doc.data() };
                if (eventData.actor && eventData.actor.includes(entityName)) {
                    this.allEvents.push(eventData);
                    eventIds.add(doc.id);
                }
            });
            
            // Process target events (avoid duplicates)
            targetSnapshot.forEach((doc) => {
                if (!eventIds.has(doc.id)) {
                    const eventData = { id: doc.id, ...doc.data() };
                    if (eventData.target && eventData.target.includes(entityName)) {
                        this.allEvents.push(eventData);
                        eventIds.add(doc.id);
                    }
                }
            });
            
            // TODO: Add location-based queries if needed
            
        } catch (error) {
            console.error('Error loading related events:', error);
            // Fallback: load a limited number of recent events
            const fallbackQuery = query(
                collection(db, 'events'),
                orderBy('dateReceived', 'desc'),
                limit(100)
            );
            const fallbackSnapshot = await getDocs(fallbackQuery);
            fallbackSnapshot.forEach((doc) => {
                const eventData = { id: doc.id, ...doc.data() };
                if (this.isEventRelatedToEntity(eventData, entityName)) {
                    this.allEvents.push(eventData);
                }
            });
        }
        
        // Cache the results
        this.eventsCache.set(entityName, this.allEvents);
        
    }
    
    isEventRelatedToEntity(event, entityName) {
        return (event.actor && event.actor.includes(entityName)) ||
               (event.target && event.target.includes(entityName)) ||
               (event.locations && 
                (Array.isArray(event.locations) 
                    ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === entityName)
                    : event.locations.includes(entityName)));
    }

    renderEntityProfile() {
        const entity = this.currentEntity;
        
        document.getElementById('entityName').textContent = entity.name;
        
        // Update entity type with badge styling
        const entityTypeElement = document.getElementById('entityType');
        const entityType = entity.type || entity.category || 'unknown';
        entityTypeElement.textContent = entityType.charAt(0).toUpperCase() + entityType.slice(1);
        entityTypeElement.className = `entity-type-badge ${entityType}`;
        
        const description = entity.description || 'No description available';
        document.getElementById('entityDescription').textContent = description;
        
        // Render comprehensive data grid
        const metaContainer = document.getElementById('entityMeta');
        metaContainer.innerHTML = '';
        metaContainer.className = 'entity-data-grid';
        
        const allFields = this.getAllEntityFields(entity);
        allFields.forEach(field => {
            if (field.value !== null && field.value !== undefined && field.value !== '') {
                const gridItem = document.createElement('div');
                gridItem.className = 'data-grid-item';
                gridItem.innerHTML = `
                    <div class="data-label">${field.label}</div>
                    <div class="data-value">${field.value}</div>
                `;
                metaContainer.appendChild(gridItem);
            }
        });
    }

    getMetaFields(entity) {
        const formatArray = (arr) => Array.isArray(arr) ? arr.join(', ') : arr;
        
        const commonFields = [
            { label: 'Wikidata ID', value: entity.wikidata_id },
            { label: 'Aliases', value: formatArray(entity.aliases) }
        ];
        
        if (entity.type === 'person') {
            const personFields = [
                ...commonFields,
                { label: 'Occupation', value: formatArray(entity.occupation) },
                { label: 'Job Title', value: entity.jobTitle },
                { label: 'Current Employer', value: entity.currentEmployer },
                { label: 'Employer', value: formatArray(entity.employer) },
                { label: 'Education', value: entity.educatedAt ? entity.educatedAt.join(', ') : null },
                { label: 'Educated At', value: formatArray(entity.educated_at) },
                { label: 'Current Residence', value: entity.currentResidence },
                { label: 'Residences', value: formatArray(entity.residences) },
                { label: 'Languages Spoken', value: formatArray(entity.languages_spoken) },
                { label: 'Member Of', value: formatArray(entity.member_of) },
                { label: 'Date of Birth', value: entity.dateOfBirth }
            ];
            
            // Add family relationships if they exist
            if (entity.family_relations) {
                const familyFields = [];
                if (entity.family_relations.father) familyFields.push({ label: 'Father', value: formatArray(entity.family_relations.father) });
                if (entity.family_relations.mother) familyFields.push({ label: 'Mother', value: formatArray(entity.family_relations.mother) });
                if (entity.family_relations.spouse) familyFields.push({ label: 'Spouse', value: formatArray(entity.family_relations.spouse) });
                if (entity.family_relations.children) familyFields.push({ label: 'Children', value: formatArray(entity.family_relations.children) });
                if (entity.family_relations.siblings) familyFields.push({ label: 'Siblings', value: formatArray(entity.family_relations.siblings) });
                if (entity.family_relations.parents) familyFields.push({ label: 'Parents', value: formatArray(entity.family_relations.parents) });
                if (entity.family_relations.relatives) familyFields.push({ label: 'Relatives', value: formatArray(entity.family_relations.relatives) });
                
                return [...personFields, ...familyFields];
            }
            
            return personFields;
        } else if (entity.type === 'organization') {
            return [
                ...commonFields,
                { label: 'Category', value: entity.category },
                { label: 'Industry', value: entity.industry },
                { label: 'Founded', value: entity.founded },
                { label: 'Location', value: entity.location },
                { label: 'Employees', value: entity.employees },
                { label: 'Member Of', value: formatArray(entity.member_of) }
            ];
        } else if (entity.type === 'place') {
            return [
                ...commonFields,
                { label: 'Category', value: entity.category },
                { label: 'Country', value: entity.country },
                { label: 'State', value: entity.state },
                { label: 'Population', value: entity.population },
                { label: 'Coordinates', value: entity.coordinates ? `${entity.coordinates.lat}, ${entity.coordinates.lng}` : null }
            ];
        }
        
        return commonFields;
    }

    getAllEntityFields(entity) {
        const fields = [];
        
        // Helper function to format values
        const formatValue = (value) => {
            if (value === null || value === undefined) return null;
            if (Array.isArray(value)) {
                return value.length > 0 ? value.join(', ') : null;
            }
            if (typeof value === 'object') {
                if (value.lat && value.lng) {
                    return `${value.lat}, ${value.lng}`;
                }
                return JSON.stringify(value);
            }
            if (typeof value === 'boolean') {
                return value ? 'Yes' : 'No';
            }
            if (typeof value === 'number') {
                return value.toLocaleString();
            }
            return String(value);
        };

        // Core identification fields
        if (entity.wikidata_id) {
            fields.push({ 
                label: 'Wikidata ID', 
                value: `<a href="https://www.wikidata.org/wiki/${entity.wikidata_id}" target="_blank" class="wikidata-link">${entity.wikidata_id}</a>`
            });
        }
        
        // Names and aliases
        if (entity.aliases && entity.aliases.length > 0) {
            fields.push({ label: 'Aliases', value: formatValue(entity.aliases) });
        }
        
        // Type and category information
        if (entity.type && entity.type !== entity.category) {
            fields.push({ label: 'Type', value: entity.type });
        }
        if (entity.category) fields.push({ label: 'Category', value: entity.category });
        
        // Person-specific fields
        if (entity.occupation) fields.push({ label: 'Occupation', value: formatValue(entity.occupation) });
        if (entity.jobTitle) fields.push({ label: 'Job Title', value: entity.jobTitle });
        if (entity.currentEmployer) fields.push({ label: 'Current Employer', value: entity.currentEmployer });
        if (entity.previousEmployers) fields.push({ label: 'Previous Employers', value: formatValue(entity.previousEmployers) });
        if (entity.organization) fields.push({ label: 'Organization', value: entity.organization });
        if (entity.educatedAt) fields.push({ label: 'Education', value: formatValue(entity.educatedAt) });
        if (entity.currentResidence) fields.push({ label: 'Current Residence', value: entity.currentResidence });
        if (entity.previousResidences) fields.push({ label: 'Previous Residences', value: formatValue(entity.previousResidences) });
        if (entity.dateOfBirth) fields.push({ label: 'Date of Birth', value: entity.dateOfBirth });
        if (entity.gender) fields.push({ label: 'Gender', value: entity.gender });
        if (entity.expertise) fields.push({ label: 'Expertise', value: formatValue(entity.expertise) });
        
        // Enhanced Wikidata fields
        if (entity.employer) fields.push({ label: 'Employer', value: formatValue(entity.employer) });
        if (entity.educated_at) fields.push({ label: 'Educated At (Wikidata)', value: formatValue(entity.educated_at) });
        if (entity.residences) fields.push({ label: 'Residences', value: formatValue(entity.residences) });
        if (entity.languages_spoken) fields.push({ label: 'Languages Spoken', value: formatValue(entity.languages_spoken) });
        if (entity.member_of) fields.push({ label: 'Member Of', value: formatValue(entity.member_of) });
        
        // Family relationships
        if (entity.family_relations) {
            if (entity.family_relations.father) fields.push({ label: 'Father', value: formatValue(entity.family_relations.father) });
            if (entity.family_relations.mother) fields.push({ label: 'Mother', value: formatValue(entity.family_relations.mother) });
            if (entity.family_relations.spouse) fields.push({ label: 'Spouse', value: formatValue(entity.family_relations.spouse) });
            if (entity.family_relations.children) fields.push({ label: 'Children', value: formatValue(entity.family_relations.children) });
            if (entity.family_relations.siblings) fields.push({ label: 'Siblings', value: formatValue(entity.family_relations.siblings) });
            if (entity.family_relations.parents) fields.push({ label: 'Parents', value: formatValue(entity.family_relations.parents) });
            if (entity.family_relations.relatives) fields.push({ label: 'Relatives', value: formatValue(entity.family_relations.relatives) });
        }
        
        // Organization-specific fields
        if (entity.industry) fields.push({ label: 'Industry', value: entity.industry });
        if (entity.founded) fields.push({ label: 'Founded', value: entity.founded });
        if (entity.employees) fields.push({ label: 'Employees', value: formatValue(entity.employees) });
        
        // Location-specific fields
        if (entity.location) fields.push({ label: 'Location', value: entity.location });
        if (entity.country) fields.push({ label: 'Country', value: entity.country });
        if (entity.state) fields.push({ label: 'State', value: entity.state });
        if (entity.population) fields.push({ label: 'Population', value: formatValue(entity.population) });
        if (entity.coordinates) fields.push({ label: 'Coordinates', value: formatValue(entity.coordinates) });
        
        // Connection and activity information
        // (Total connections count moved to Connections section header)
        
        // Timestamps and metadata
        if (entity.created) fields.push({ label: 'Created', value: new Date(entity.created).toLocaleString() });
        if (entity.updated) fields.push({ label: 'Updated', value: new Date(entity.updated).toLocaleString() });
        if (entity.lastModified) fields.push({ label: 'Last Modified', value: new Date(entity.lastModified).toLocaleString() });
        
        // Any other fields that might exist
        Object.keys(entity).forEach(key => {
            // Skip fields we've already handled or internal fields
            const skipFields = [
                'id', 'firestoreId', 'name', 'description', 'type', 'category', 'wikidata_id',
                'aliases', 'occupation', 'jobTitle', 'currentEmployer', 'previousEmployers', 
                'organization', 'educatedAt', 'currentResidence', 'previousResidences',
                'dateOfBirth', 'gender', 'expertise', 'industry', 'founded', 'employees',
                'location', 'country', 'state', 'population', 'coordinates', 'connections',
                'created', 'updated', 'lastModified', 'connectionCount', 'actualConnectionCount'
            ];
            
            if (!skipFields.includes(key) && entity[key] !== null && entity[key] !== undefined && entity[key] !== '') {
                const formattedValue = formatValue(entity[key]);
                if (formattedValue) {
                    // Convert camelCase to readable label
                    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    fields.push({ label, value: formattedValue });
                }
            }
        });
        
        return fields;
    }

    renderConnections() {
        // Initialize filter event listeners
        this.initializeConnectionFilters();
        
        // Store all connections for filtering
        this.allConnections = this.processConnectionsData();
        
        // Update connections section header with count
        this.updateConnectionsHeader();
        
        // Render with default filter (all)
        this.renderFilteredConnections('all');
    }

    updateConnectionsHeader() {
        // Find the connections section specifically by looking for the section that contains connectionsList
        const connectionsList = document.getElementById('connectionsList');
        if (connectionsList) {
            const connectionsSection = connectionsList.closest('.content-section');
            if (connectionsSection) {
                const connectionsTitle = connectionsSection.querySelector('h2.section-title');
                if (connectionsTitle) {
                    const totalConnections = this.allConnections ? this.allConnections.length : 0;
                    connectionsTitle.textContent = `Connections (${totalConnections})`;
                }
            }
        }
    }

    initializeConnectionFilters() {
        const filterPills = document.querySelectorAll('.filter-pill');
        filterPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                // Remove active class from all pills
                filterPills.forEach(p => p.classList.remove('active'));
                // Add active class to clicked pill
                e.target.classList.add('active');
                // Filter connections
                this.renderFilteredConnections(e.target.dataset.filter);
            });
        });
    }

    processConnectionsData() {
        // Find events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            (event.target && event.target.includes(this.currentEntity.name)) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
                : event.locations && event.locations.includes(this.currentEntity.name))
        );

        // Process each event into connection data
        const connections = relatedEvents.map(event => {
            const actors = event.actor.split(',').map(a => a.trim());
            const targets = event.target ? event.target.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];
            const locations = Array.isArray(event.locations) 
                ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name)
                : (event.locations ? event.locations.split(',').map(l => l.trim()) : []);

            // Determine this entity's role in the event
            let role = 'connected';
            let primaryEntity = '';
            let otherEntities = [];

            if (actors.includes(this.currentEntity.name)) {
                role = 'actor';
                primaryEntity = targets.length > 0 ? targets[0] : (locations.length > 0 ? locations[0] : '');
                otherEntities = [...targets.slice(1), ...locations];
            } else if (targets.includes(this.currentEntity.name)) {
                role = 'target';
                primaryEntity = actors.length > 0 ? actors[0] : '';
                otherEntities = [...actors.slice(1), ...locations];
            } else if (locations.some(loc => loc === this.currentEntity.name)) {
                role = 'location';
                primaryEntity = actors.length > 0 ? actors[0] : (targets.length > 0 ? targets[0] : '');
                otherEntities = [...actors.slice(1), ...targets];
            }

            return {
                event,
                role,
                primaryEntity,
                otherEntities: otherEntities.filter(e => e && e.length > 0),
                date: this.parseEventDate(event.dateReceived)
            };
        });

        // Sort by date (most recent first)
        return connections.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return b.date - a.date;
        });
    }

    renderFilteredConnections(filter) {
        const connectionsList = document.getElementById('connectionsList');
        connectionsList.innerHTML = '';

        // Filter connections based on selected filter
        let filteredConnections = this.allConnections;
        if (filter !== 'all') {
            filteredConnections = this.allConnections.filter(conn => conn.role === filter);
        }

        if (filteredConnections.length === 0) {
            connectionsList.innerHTML = '<div class="connections-empty">No connections found for this filter</div>';
            return;
        }

        // Render up to 20 connections
        filteredConnections.slice(0, 20).forEach(connection => {
            const connectionItem = document.createElement('div');
            connectionItem.className = 'connection-item';
            
            // Find clickable entity
            let clickableEntity = null;
            if (connection.primaryEntity) {
                clickableEntity = this.findEntityByName(connection.primaryEntity);
            }

            // Format date
            const dateString = connection.date ? this.formatTimelineDate(connection.date) : 'Unknown date';
            
            // Create other entities list
            const otherEntitiesText = connection.otherEntities.length > 0 
                ? `Also involved: ${connection.otherEntities.slice(0, 3).join(', ')}${connection.otherEntities.length > 3 ? '...' : ''}`
                : '';

            connectionItem.innerHTML = `
                <div class="connection-header">
                    <div class="connection-entities">
                        <div class="connection-primary-entity">${connection.primaryEntity || 'Unknown Entity'}</div>
                    </div>
                    <div class="connection-meta">
                        <span class="connection-role ${connection.role}">${connection.role}</span>
                        <span class="connection-date">${dateString}</span>
                    </div>
                </div>
                <div class="connection-sentence">${connection.event.sentence || 'No description available'}</div>
                ${otherEntitiesText ? `<div class="connection-other-entities">${otherEntitiesText}</div>` : ''}
            `;

            // Add click handler to primary entity name only
            if (clickableEntity) {
                const primaryEntityElement = connectionItem.querySelector('.connection-primary-entity');
                if (primaryEntityElement) {
                    primaryEntityElement.addEventListener('click', () => {
                        const typeParam = clickableEntity.type === 'person' ? 'people' : 
                                         clickableEntity.type === 'organization' ? 'organizations' : 
                                         clickableEntity.type === 'place' ? 'places' : 'unknown';
                        
                        if (window.location.pathname.includes('profile.html')) {
                            window.location.href = `profile.html?id=${clickableEntity.id}&type=${typeParam}`;
                        } else {
                            // We're in the main app, use the showProfile method
                            if (window.app && window.app.showProfile) {
                                window.app.showProfile(clickableEntity.id, typeParam);
                            }
                        }
                    });
                }
            }

            connectionsList.appendChild(connectionItem);
        });
    }

    renderEvents() {
        const eventsList = document.getElementById('eventsList');
        eventsList.innerHTML = '';
        
        // Find events related to this entity
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            (event.target && event.target.includes(this.currentEntity.name)) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
                : event.locations && event.locations.includes(this.currentEntity.name))
        );
        
        if (relatedEvents.length === 0) {
            eventsList.innerHTML = '<div class="events-empty">No related events found</div>';
            return;
        }

        // Group events by timeline hierarchy (year > month > day)
        const timelineGroups = this.groupEventsByTimeline(relatedEvents);
        
        // Render hierarchical timeline
        this.renderHierarchicalTimeline(timelineGroups, eventsList);
    }

    groupEventsByTimeline(events) {
        const groups = new Map();
        
        events.forEach(event => {
            // Use new duration fields if available, fall back to legacy
            const startDate = event.startDate ? new Date(event.startDate) : this.parseEventDate(event.dateReceived);
            const granularity = event.granularity || 'day';
            const duration = event.duration || 'instant';
            
            if (!startDate || isNaN(startDate.getTime())) return;
            
            const year = startDate.getFullYear();
            const month = startDate.getMonth();
            const day = startDate.getDate();
            
            // Create hierarchical keys
            const yearKey = year.toString();
            const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
            const dayKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            
            // Initialize groups if they don't exist
            if (!groups.has(yearKey)) {
                groups.set(yearKey, {
                    type: 'year',
                    date: new Date(year, 0, 1),
                    label: year.toString(),
                    events: [],
                    children: new Map()
                });
            }
            
            const yearGroup = groups.get(yearKey);
            
            // For events with year granularity, add directly to year
            if (granularity === 'year') {
                yearGroup.events.push({ ...event, timelineLevel: 3 });
                return;
            }
            
            // Month level
            if (!yearGroup.children.has(monthKey)) {
                yearGroup.children.set(monthKey, {
                    type: 'month',
                    date: new Date(year, month, 1),
                    label: new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
                    events: [],
                    children: new Map()
                });
            }
            
            const monthGroup = yearGroup.children.get(monthKey);
            
            // For events with month granularity, add to month
            if (granularity === 'month' || granularity === 'quarter') {
                monthGroup.events.push({ ...event, timelineLevel: 2 });
                return;
            }
            
            // Day level
            if (!monthGroup.children.has(dayKey)) {
                monthGroup.children.set(dayKey, {
                    type: 'day',
                    date: new Date(year, month, day),
                    label: new Date(year, month, day).toLocaleDateString(),
                    events: [],
                    children: new Map()
                });
            }
            
            const dayGroup = monthGroup.children.get(dayKey);
            dayGroup.events.push({ ...event, timelineLevel: 1 });
        });
        
        return groups;
    }

    renderHierarchicalTimeline(groups, container) {
        // Sort years in descending order (most recent first)
        const sortedYears = Array.from(groups.entries()).sort((a, b) => b[1].date - a[1].date);
        
        sortedYears.forEach(([yearKey, yearGroup]) => {
            const yearElement = this.createTimelineGroup(yearGroup, 3);
            container.appendChild(yearElement);
            
            // Sort months in descending order
            const sortedMonths = Array.from(yearGroup.children.entries()).sort((a, b) => b[1].date - a[1].date);
            
            sortedMonths.forEach(([monthKey, monthGroup]) => {
                const monthElement = this.createTimelineGroup(monthGroup, 2);
                yearElement.appendChild(monthElement);
                
                // Sort days in descending order
                const sortedDays = Array.from(monthGroup.children.entries()).sort((a, b) => b[1].date - a[1].date);
                
                sortedDays.forEach(([dayKey, dayGroup]) => {
                    const dayElement = this.createTimelineGroup(dayGroup, 1);
                    monthElement.appendChild(dayElement);
                });
            });
        });
    }

    createTimelineGroup(group, level) {
        const groupElement = document.createElement('div');
        groupElement.className = `timeline-group timeline-level-${level}`;
        
        // Create header
        const headerElement = document.createElement('div');
        headerElement.className = `timeline-header timeline-header-${level}`;
        headerElement.innerHTML = `
            <span class="timeline-label">${group.label}</span>
            <div class="timeline-right">
                <span class="timeline-count">${this.getTotalEventCount(group)} events</span>
            </div>
        `;
        groupElement.appendChild(headerElement);
        
        // Create events container
        const eventsContainer = document.createElement('div');
        eventsContainer.className = `timeline-events timeline-events-${level}`;
        
        // Add events for this group
        group.events.forEach(event => {
            const eventElement = this.createEventItem(event);
            eventsContainer.appendChild(eventElement);
        });
        
        groupElement.appendChild(eventsContainer);
        
        // Make collapsible for higher levels
        if (level > 1) {
            headerElement.style.cursor = 'pointer';
            headerElement.addEventListener('click', () => {
                eventsContainer.classList.toggle('collapsed');
                headerElement.classList.toggle('collapsed');
            });
        }
        
        return groupElement;
    }

    getTotalEventCount(group) {
        let count = group.events.length;
        group.children.forEach(child => {
            count += this.getTotalEventCount(child);
        });
        return count;
    }

    createEventItem(event) {
        const eventItem = document.createElement('div');
        eventItem.className = `event-item event-level-${event.timelineLevel || 1}`;
        
        // Format duration if available
        const durationInfo = this.formatEventDuration(event);
        
        // Determine the role of the current entity in this event
        let role = 'location'; // default
        if (event.actor && event.actor.includes(this.currentEntity.name)) {
            role = 'actor';
        } else if (event.target && event.target.includes(this.currentEntity.name)) {
            role = 'target';
        } else if (Array.isArray(event.locations) 
            ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
            : event.locations && event.locations.includes(this.currentEntity.name)) {
            role = 'location';
        }
        
        // Format location with icon
        const locationText = Array.isArray(event.locations) 
            ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name).filter(l => l).join(', ')
            : event.locations || '';
        
        // Format sources
        const sourcesText = Array.isArray(event.sources) && event.sources.length > 0
            ? event.sources.join(', ')
            : '';
        
        eventItem.innerHTML = `
            <div class="event-date">${durationInfo}</div>
            <div class="event-sentence">${event.sentence || 'No description available'}</div>
            <div class="event-meta">
                <span class="event-action ${role}">${role}</span>
                ${locationText ? `<span class="event-location">${locationText}</span>` : ''}
                ${sourcesText ? `<span class="event-sources">Sources: ${sourcesText}</span>` : ''}
            </div>
        `;

        return eventItem;
    }

    formatEventDuration(event) {
        // Use new duration fields if available
        if (event.startDate && event.granularity) {
            const startDate = new Date(event.startDate);
            const granularity = event.granularity;
            
            switch (granularity) {
                case 'year':
                    return startDate.getFullYear().toString();
                case 'quarter':
                    const quarter = Math.floor(startDate.getMonth() / 3) + 1;
                    return `Q${quarter} ${startDate.getFullYear()}`;
                case 'month':
                    return startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                case 'day':
                    return startDate.toLocaleDateString();
                default:
                    return this.formatTimelineDate(startDate);
            }
        }
        
        // Fall back to legacy formatting
        const eventDate = this.parseEventDate(event.dateReceived);
        return eventDate ? this.formatTimelineDate(eventDate) : 'Unknown date';
    }

    initializeNetworkGraph() {
        const container = document.getElementById('networkGraph');
        
        // Show loading state immediately
        this.showNetworkLoading(container);
        
        // Use Intersection Observer for lazy loading with fallback
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        // Graph is visible, start rendering
                        observer.disconnect(); // Only load once
                        this.startNetworkRendering(container);
                    }
                });
            }, {
                rootMargin: '50px', // Start loading when 50px away from viewport
                threshold: 0.1
            });
            
            observer.observe(container);
        } else {
            // Fallback for older browsers - load after a short delay
            setTimeout(() => {
                this.startNetworkRendering(container);
            }, 500);
        }
    }

    startNetworkRendering(container) {
        // Update loading text to show we're actively building
        const loadingText = container.querySelector('.network-loading-text');
        if (loadingText) {
            loadingText.textContent = 'Analyzing connections...';
        }
        
        // Use requestAnimationFrame to defer the heavy computation
        requestAnimationFrame(() => {
            setTimeout(() => {
                this.renderNetworkGraph(container);
            }, 100); // Small delay to ensure loading state is visible
        });
    }

    showNetworkLoading(container) {
        container.innerHTML = `
            <div class="network-loading">
                <div class="network-loading-spinner"></div>
                <div class="network-loading-text">Building network graph...</div>
            </div>
        `;
    }

    renderNetworkGraph(container) {
        // Clear loading state and start rendering
        container.innerHTML = '';
        
        const width = container.clientWidth;
        const height = 400;
        
        const svg = d3.select('#networkGraph')
            .append('svg')
            .attr('width', width)
            .attr('height', height);
        
        // Zoom behavior with drag navigation enabled
        const zoom = d3.zoom()
            .scaleExtent([0.5, 3])
            .filter((event) => {
                // Allow wheel zoom and drag pan, but not on nodes/text
                if (event.type === 'wheel') return true;
                if (event.type === 'mousedown') {
                    // Only allow drag on background, not on nodes or labels
                    return !event.target.closest('circle') && !event.target.closest('text');
                }
                return true;
            })
            .on('zoom', (event) => {
                zoomGroup.attr('transform', event.transform);
            });
        
        // Apply zoom to SVG
        svg.call(zoom);
        
        // Create a group for all zoomable content
        const zoomGroup = svg.append('g');
        
        // Prepare data for enhanced network graph - optimized processing
        const { nodes, links } = this.processNetworkData();
        
        // Continue with rendering after data is processed
        this.renderNetworkElements(container, svg, zoomGroup, nodes, links, width, height, zoom);
    }

    processNetworkData() {
        const nodes = [];
        const links = [];
        const processedEntities = new Set();
        
        // Add the center entity
        const centerEntity = { ...this.currentEntity, isCenter: true, degree: 0 };
        nodes.push(centerEntity);
        processedEntities.add(centerEntity.id);
        
        // Find first-degree connections (direct connections to center entity)
        const firstDegreeConnections = this.getEntityConnections(centerEntity);
        
        // Limit connections to prevent performance issues
        const maxFirstDegree = 20;
        const maxSecondDegree = 30;
        
        firstDegreeConnections.slice(0, maxFirstDegree).forEach(connection => {
            if (!processedEntities.has(connection.entity.id)) {
                const firstDegreeNode = { ...connection.entity, isCenter: false, degree: 1 };
                nodes.push(firstDegreeNode);
                processedEntities.add(connection.entity.id);
                
                // Add link from center to first-degree entity
                links.push({
                    source: centerEntity.id,
                    target: connection.entity.id,
                    relationshipType: connection.relationshipType,
                    isDirect: connection.isDirect,
                    action: connection.action,
                    events: connection.events
                });
                
                // Find second-degree connections (entities connected to first-degree entities)
                const secondDegreeConnections = this.getEntityConnections(connection.entity);
                
                secondDegreeConnections.slice(0, Math.floor(maxSecondDegree / maxFirstDegree)).forEach(secondConnection => {
                    // Only add if not already processed and not the center entity
                    if (!processedEntities.has(secondConnection.entity.id) && 
                        secondConnection.entity.id !== centerEntity.id) {
                        
                        const secondDegreeNode = { ...secondConnection.entity, isCenter: false, degree: 2 };
                        nodes.push(secondDegreeNode);
                        processedEntities.add(secondConnection.entity.id);
                        
                        // Add link from first-degree to second-degree entity
                        links.push({
                            source: connection.entity.id,
                            target: secondConnection.entity.id,
                            relationshipType: secondConnection.relationshipType,
                            isDirect: secondConnection.isDirect,
                            action: secondConnection.action,
                            events: secondConnection.events
                        });
                    }
                });
            }
        });
        
        return { nodes, links };
    }

    renderNetworkElements(container, svg, zoomGroup, nodes, links, width, height, zoom) {
        
        
        // Create force simulation with different forces for different degrees
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.source.degree === 0 ? 120 : 80))
            .force('charge', d3.forceManyBody().strength(d => d.degree === 0 ? -800 : d.degree === 1 ? -400 : -200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(d => d.degree === 0 ? 20 : d.degree === 1 ? 15 : 10));
        
        // Add links with color coding
        const link = zoomGroup.append('g')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('stroke', d => this.getLinkColor(d.relationshipType, d.isDirect))
            .attr('stroke-opacity', 0.8)
            .attr('stroke-width', d => d.isDirect ? 2 : 1)
            .attr('stroke-dasharray', d => d.isDirect ? '0' : '5,5');
        
        // Add nodes with different sizes for different degrees - NO DRAG, just clicks
        const node = zoomGroup.append('g')
            .selectAll('circle')
            .data(nodes)
            .enter().append('circle')
            .attr('r', d => d.degree === 0 ? 16 : d.degree === 1 ? 10 : 7)
            .attr('fill', d => this.getNodeColor(d.type))
            .attr('stroke', d => d.degree === 0 ? '#333' : '#fff')
            .attr('stroke-width', d => d.degree === 0 ? 2 : 2)
            .attr('opacity', d => d.degree === 2 ? 0.7 : 1)
            .style('cursor', 'pointer')
            .style('pointer-events', 'all') // Ensure mouse events work
            .on('click', (event, d) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                
                this.navigateToEntity(d.id, d.type);
            })
            .on('mouseover', function(event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d => (d.degree === 0 ? 16 : d.degree === 1 ? 10 : 7) * 1.3)
                    .attr('stroke-width', 4)
                    .style('filter', 'brightness(1.1)');
            })
            .on('mouseout', function(event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr('r', d => d.degree === 0 ? 16 : d.degree === 1 ? 10 : 7)
                    .attr('stroke-width', d => d.degree === 0 ? 2 : 2)
                    .style('filter', 'none');
            });
        
        // Add labels with different styling for different degrees - NO DRAG, just clicks
        const label = zoomGroup.append('g')
            .selectAll('text')
            .data(nodes)
            .enter().append('text')
            .text(d => d.name.length > 12 ? d.name.substring(0, 12) + '...' : d.name)
            .attr('font-size', d => d.degree === 0 ? '14px' : d.degree === 1 ? '12px' : '10px')
            .attr('font-family', 'SF Pro Display, sans-serif')
            .attr('font-weight', d => d.degree === 0 ? 'bold' : 'normal')
            .attr('fill', d => d.degree === 0 ? '#2c3e50' : '#333')
            .attr('text-anchor', 'middle')
            .attr('dy', d => d.degree === 0 ? -20 : d.degree === 1 ? -15 : -12)
            .style('cursor', 'pointer')
            .style('pointer-events', 'all') // Ensure mouse events work
            .style('user-select', 'none') // Prevent text selection
            .on('click', (event, d) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                
                this.navigateToEntity(d.id, d.type);
            })
            .on('mouseover', function(event, d) {
                d3.select(this)
                    .style('text-decoration', 'underline')
                    .style('fill', '#007bff')
                    .style('font-weight', 'bold');
            })
            .on('mouseout', function(event, d) {
                d3.select(this)
                    .style('text-decoration', 'none')
                    .style('fill', d.degree === 0 ? '#2c3e50' : '#333')
                    .style('font-weight', d.degree === 0 ? 'bold' : 'normal');
            });
        
        // Update positions on simulation tick
        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            
            node
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);
            
            label
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });
        
        // No drag functions needed - removed for simplicity and reliability
        
        // Enhanced tooltips
        node.append('title').text(d => {
            const degreeText = d.degree === 0 ? 'Center Entity' : 
                             d.degree === 1 ? 'Direct Connection' : 
                             'Second Degree Connection';
            return `${d.name} (${d.type})\n${degreeText}`;
        });
        
        // Link tooltips
        link.append('title').text(d => {
            const relationshipText = d.isDirect ? 
                `Direct relationship: ${d.relationshipType}` : 
                `Neutral connection: ${d.relationshipType}`;
            return relationshipText;
        });
        
        // Store references for later use
        this.networkGraph = { svg, simulation, zoom, zoomGroup, nodes, labels: label };
        
        // Add zoom controls
        this.addZoomControls(container, zoom, svg);
        
        // Add keyboard navigation
        this.addKeyboardNavigation(container, zoom, svg);
    }

    addZoomControls(container, zoom, svg) {
        // Create zoom controls container with improved styling
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'network-zoom-controls';
        controlsDiv.innerHTML = `
            <button class="zoom-btn" id="profileZoomIn" title="Zoom In (+)">+</button>
            <button class="zoom-btn" id="profileZoomOut" title="Zoom Out (-)">−</button>
            <button class="zoom-btn" id="profileZoomReset" title="Reset Zoom (0)">⌂</button>
        `;
        
        // Position controls in top-right corner
        controlsDiv.style.position = 'absolute';
        controlsDiv.style.top = '10px';
        controlsDiv.style.right = '10px';
        controlsDiv.style.zIndex = '1000';
        controlsDiv.style.display = 'flex';
        controlsDiv.style.flexDirection = 'column';
        controlsDiv.style.gap = '5px';
        
        // Add to container (make container relative if not already)
        container.style.position = 'relative';
        container.appendChild(controlsDiv);
        
        // Add event listeners
        document.getElementById('profileZoomIn').addEventListener('click', () => {
            svg.transition().duration(300).call(zoom.scaleBy, 1.5);
        });
        
        document.getElementById('profileZoomOut').addEventListener('click', () => {
            svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.5);
        });
        
        document.getElementById('profileZoomReset').addEventListener('click', () => {
            svg.transition().duration(500).call(
                zoom.transform,
                d3.zoomIdentity.translate(0, 0).scale(1)
            );
        });
    }

    addKeyboardNavigation(container, zoom, svg) {
        // Add keyboard event listener
        const handleKeyPress = (event) => {
            if (!container.contains(document.activeElement) && !container.matches(':hover')) {
                return; // Only handle keys when focused on the network graph
            }
            
            switch(event.key) {
                case '+':
                case '=':
                    event.preventDefault();
                    svg.transition().duration(300).call(
                        zoom.scaleBy, 1.5
                    );
                    break;
                case '-':
                case '_':
                    event.preventDefault();
                    svg.transition().duration(300).call(
                        zoom.scaleBy, 1 / 1.5
                    );
                    break;
                case '0':
                    event.preventDefault();
                    svg.transition().duration(500).call(
                        zoom.transform,
                        d3.zoomIdentity
                    );
                    break;
            }
        };
        
        // Make container focusable and add event listeners
        container.setAttribute('tabindex', '0');
        container.addEventListener('keydown', handleKeyPress);
        
        // Add focus styling
        container.style.outline = 'none';
        container.addEventListener('focus', () => {
            container.style.boxShadow = '0 0 0 2px #007bff';
        });
        container.addEventListener('blur', () => {
            container.style.boxShadow = 'none';
        });
    }

    getEntityConnections(entity) {
        const connections = [];
        
        // Find all events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(entity.name) || 
            (event.target && event.target.includes(entity.name)) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === entity.name)
                : event.locations && event.locations.includes(entity.name))
        );
        
        relatedEvents.forEach(event => {
            const actors = event.actor.split(',').map(a => a.trim());
            const targets = event.target ? event.target.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];
            const locations = Array.isArray(event.locations) 
                ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name)
                : (event.locations ? event.locations.split(',').map(l => l.trim()) : []);
            
            // Check all entities in this event
            [...actors, ...targets, ...locations].forEach(entityName => {
                if (entityName !== entity.name) {
                    const relatedEntity = this.findEntityByName(entityName);
                    if (relatedEntity) {
                        // Determine relationship type and if it's direct
                        let relationshipType = 'connected';
                        let isDirect = false;
                        
                        if (actors.includes(entity.name) && targets.includes(entityName)) {
                            // Entity is actor, other is target - direct relationship
                            relationshipType = event.action;
                            isDirect = true;
                        } else if (targets.includes(entity.name) && actors.includes(entityName)) {
                            // Entity is target, other is actor - direct relationship
                            relationshipType = `target of ${event.action}`;
                            isDirect = true;
                        } else if (locations.includes(entityName)) {
                            // Other entity is a location - neutral relationship
                            relationshipType = 'located at';
                            isDirect = false;
                        } else if (locations.includes(entity.name)) {
                            // Current entity is a location - neutral relationship
                            relationshipType = 'location of';
                            isDirect = false;
                        } else {
                            // Both are actors or both are targets - neutral relationship
                            relationshipType = 'co-involved in';
                            isDirect = false;
                        }
                        
                        // Check if this connection already exists
                        const existingConnection = connections.find(c => c.entity.id === relatedEntity.id);
                        if (existingConnection) {
                            // Strengthen existing connection
                            existingConnection.events.push(event);
                            // If any relationship is direct, mark the connection as direct
                            if (isDirect) {
                                existingConnection.isDirect = true;
                                existingConnection.relationshipType = relationshipType;
                            }
                        } else {
                            connections.push({
                                entity: relatedEntity,
                                relationshipType,
                                isDirect,
                                action: event.action,
                                events: [event]
                            });
                        }
                    }
                }
            });
        });
        
        return connections;
    }

    getLinkColor(relationshipType, isDirect) {
        if (isDirect) {
            // Direct relationships - stronger colors
            if (relationshipType.includes('target of')) {
                return '#e74c3c'; // Red for being targeted
            } else {
                return '#999'; // Blue for acting upon
            }
        } else {
            // Neutral relationships - muted colors
            return '#95a5a6'; // Gray for neutral connections
        }
    }

    hideNetworkGraphAndMap() {
        // Hide network graph section completely
        const networkSection = document.querySelector('.content-section:has(#networkGraph)');
        if (networkSection) {
            networkSection.style.display = 'none';
        }
        
        // Hide map section completely
        const mapSection = document.querySelector('.content-section:has(#map)');
        if (mapSection) {
            mapSection.style.display = 'none';
        }
    }

    showNetworkGraphAndMap() {
        // Show network graph section
        const networkSection = document.querySelector('.content-section:has(#networkGraph)');
        if (networkSection) {
            networkSection.style.display = 'block';
        }
        
        // Show map section
        const mapSection = document.querySelector('.content-section:has(#map)');
        if (mapSection) {
            mapSection.style.display = 'block';
        }
    }

    getNodeColor(type) {
        // Use colors that match the entity type badges for consistency
        const colors = {
            person: '#991b1b',      // Matches .entity-type-badge.person color
            organization: '#1e40af', // Matches .entity-type-badge.organization color
            place: '#166534',       // Matches .entity-type-badge.place color
            unknown: '#6b7280'      // Matches .entity-type-badge.unknown color (gray-500)
        };
        return colors[type] || '#6b7280';
    }

    initializeMap() {
        const mapContainer = document.getElementById('map');
        
        // Clean up existing map if it exists
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        
        // Clear the map container
        if (mapContainer) {
            mapContainer.innerHTML = '';
        }
        
        // Initialize Leaflet map
        this.map = L.map('map').setView([39.8283, -98.5795], 4); // Center on US
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        
        // Add markers for event locations
        this.addEventMarkers();
    }

    async addEventMarkers() {
        if (!this.map) return;
        
        // Find events related to this entity
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            (event.target && event.target.includes(this.currentEntity.name)) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
                : event.locations && event.locations.includes(this.currentEntity.name))
        );
        
        // Extract unique locations from events
        const locationCounts = {};
        relatedEvents.forEach(event => {
            if (event.locations) {
                const locations = Array.isArray(event.locations) 
                    ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name)
                    : event.locations.split(',').map(l => l.trim());
                locations.forEach(location => {
                    locationCounts[location] = (locationCounts[location] || 0) + 1;
                });
            }
        });
        
        // Collect all markers and their coordinates for auto-zoom
        const markers = [];
        const markerPromises = Object.entries(locationCounts).map(async ([locationName, count]) => {
            const coordinates = await this.getLocationCoordinates(locationName);
            if (coordinates) {
                const marker = L.marker([coordinates.lat, coordinates.lng])
                    .addTo(this.map)
                    .bindPopup(`
                        <strong>${locationName}</strong><br>
                        ${count} event${count > 1 ? 's' : ''}
                    `);
                markers.push(marker);
                return marker;
            }
            return null;
        });
        
        // Wait for all markers to be added, then auto-zoom to fit them
        await Promise.all(markerPromises);
        
        if (markers.length > 0) {
            // Create a group of all markers and fit the map to show them all
            const group = new L.featureGroup(markers);
            this.map.fitBounds(group.getBounds(), {
                padding: [20, 20], // Add some padding around the markers
                maxZoom: 10 // Don't zoom in too much for single locations
            });
        }
    }

    async getLocationCoordinates(locationName) {
        // First try to find in our entities
        const locationEntity = this.allEntities.find(entity => 
            entity.type === 'place' && entity.name === locationName
        );
        
        if (locationEntity && locationEntity.coordinates) {
            return locationEntity.coordinates;
        }
        
        // Fallback to a simple geocoding service (you might want to use a better one)
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1`);
            const data = await response.json();
            
            if (data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon)
                };
            }
        } catch (error) {
            console.warn('Geocoding failed for:', locationName, error);
        }
        
        return null;
    }

    findEntityById(id) {
        return this.allEntities.find(entity => entity.id === id);
    }

    findEntityByName(name) {
        return this.allEntities.find(entity => 
            entity.name.toLowerCase() === name.toLowerCase() ||
            (entity.aliases && entity.aliases.some(alias => alias.toLowerCase() === name.toLowerCase()))
        );
    }

    parseEventDate(timestamp) {
        if (!timestamp) return null;
        
        try {
            // Handle Firestore Timestamp objects
            if (timestamp.toDate) {
                return timestamp.toDate();
            } else if (timestamp.seconds) {
                return new Date(timestamp.seconds * 1000);
            } else {
                // Regular date string or Date object
                const date = new Date(timestamp);
                return isNaN(date.getTime()) ? null : date;
            }
        } catch (error) {
            console.warn('Error parsing event date:', timestamp, error);
            return null;
        }
    }

    formatTimelineDate(date) {
        if (!date) return 'Unknown';
        
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Format based on how recent the event is
        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else if (diffDays < 30) {
            const weeks = Math.floor(diffDays / 7);
            return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
        } else if (diffDays < 365) {
            const months = Math.floor(diffDays / 30);
            return months === 1 ? '1 month ago' : `${months} months ago`;
        } else {
            return date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            });
        }
    }

    showEditModal() {
        this.populateEditForm();
        const editModal = document.getElementById('editModal');
        editModal.classList.remove('hidden');
    }

    hideEditModal() {
        const editModal = document.getElementById('editModal');
        editModal.classList.add('hidden');
        this.resetEditForm();
    }

    resetEditForm() {
        // Reset form fields (only the fields that exist in the simplified form)
        const editTypeEl = document.getElementById('editType');
        if (editTypeEl) editTypeEl.value = 'person';
        
        const editWikidataIdEl = document.getElementById('editWikidataId');
        if (editWikidataIdEl) editWikidataIdEl.value = '';
        
        const wikidataSearchEl = document.getElementById('wikidataSearch');
        if (wikidataSearchEl) wikidataSearchEl.value = '';
        
        const searchResultsEl = document.getElementById('searchResults');
        if (searchResultsEl) searchResultsEl.innerHTML = '';
    }

    populateEditForm() {
        const entity = this.currentEntity;
        
        // Only populate the fields that are still editable
        document.getElementById('editType').value = entity.type || 'person';
        document.getElementById('editWikidataId').value = entity.wikidata_id || '';
    }

    updateAdditionalFields(entityType) {
        const container = document.getElementById('additionalFields');
        container.innerHTML = '';
        
        const fields = this.getAdditionalFieldsForType(entityType);
        
        fields.forEach(field => {
            const formGroup = document.createElement('div');
            formGroup.className = 'form-group';
            
            formGroup.innerHTML = `
                <label class="form-label" for="${field.id}">${field.label}</label>
                <input type="${field.type}" class="form-input" id="${field.id}" 
                       value="${this.currentEntity[field.property] || ''}" 
                       placeholder="${field.placeholder || ''}">
            `;
            
            container.appendChild(formGroup);
        });
    }

    getAdditionalFieldsForType(entityType) {
        if (entityType === 'person') {
            return [
                { id: 'editOccupation', label: 'Occupation', type: 'text', property: 'occupation' },
                { id: 'editJobTitle', label: 'Job Title', type: 'text', property: 'jobTitle' },
                { id: 'editCurrentEmployer', label: 'Current Employer', type: 'text', property: 'currentEmployer' },
                { id: 'editCurrentResidence', label: 'Current Residence', type: 'text', property: 'currentResidence' },
                { id: 'editDateOfBirth', label: 'Date of Birth', type: 'date', property: 'dateOfBirth' }
            ];
        } else if (entityType === 'organization') {
            return [
                { id: 'editCategory', label: 'Category', type: 'text', property: 'category' },
                { id: 'editIndustry', label: 'Industry', type: 'text', property: 'industry' },
                { id: 'editFounded', label: 'Founded', type: 'number', property: 'founded' },
                { id: 'editLocation', label: 'Location', type: 'text', property: 'location' },
                { id: 'editEmployees', label: 'Employees', type: 'number', property: 'employees' }
            ];
        } else if (entityType === 'place') {
            return [
                { id: 'editCategory', label: 'Category', type: 'text', property: 'category' },
                { id: 'editCountry', label: 'Country', type: 'text', property: 'country' },
                { id: 'editState', label: 'State', type: 'text', property: 'state' },
                { id: 'editPopulation', label: 'Population', type: 'number', property: 'population' },
                { id: 'editLatitude', label: 'Latitude', type: 'number', property: 'latitude', placeholder: '37.7749' },
                { id: 'editLongitude', label: 'Longitude', type: 'number', property: 'longitude', placeholder: '-122.4194' }
            ];
        }
        
        return [];
    }

    async saveEntity(event) {
        event.preventDefault();
        
        try {
            let updatedEntity = { ...this.currentEntity };
            
            // Update only the editable fields
            updatedEntity.type = document.getElementById('editType').value;
            const newWikidataId = document.getElementById('editWikidataId').value.trim();
            
            // Check if Wikidata ID was cleared
            const wikidataCleared = this.currentEntity.wikidata_id && !newWikidataId;
            
            if (wikidataCleared) {
                
                // Remove wikidata_id
                updatedEntity.wikidata_id = null;
                
                // Clear all Wikidata-derived fields
                const wikidataFields = this.getWikidataFields();
                wikidataFields.forEach(field => {
                    if (Array.isArray(updatedEntity[field])) {
                        updatedEntity[field] = [];
                    } else {
                        delete updatedEntity[field];
                    }
                });
                
                // Reset aliases to just the entity name
                updatedEntity.aliases = [updatedEntity.name];
                
                // Clear description if it came from Wikidata
                updatedEntity.description = '';
                
            } else {
                // Set the new Wikidata ID (could be same, new, or empty)
                updatedEntity.wikidata_id = newWikidataId || null;
            }
            
            // Check if entity type has changed
            const originalType = this.currentEntity.type;
            const newType = updatedEntity.type;
            const typeChanged = originalType !== newType;
            
            if (typeChanged) {
                
                // If entity has Wikidata ID, re-fetch Wikidata info for the new type
                if (updatedEntity.wikidata_id) {
                    try {
                        const wikidataInfo = await this.fetchAndParseWikidataInfo(updatedEntity.wikidata_id);
                        if (wikidataInfo) {
                            // Extract fields appropriate for the new entity type
                            const newWikidataFields = this.extractWikidataFieldsForType(wikidataInfo, newType);
                            
                            // Merge new Wikidata fields into the entity
                            updatedEntity = { ...updatedEntity, ...newWikidataFields };
                        }
                    } catch (error) {
                        console.warn('Failed to re-fetch Wikidata info for type change:', error);
                    }
                }
                
                // Delete from old collection
                const oldEntityRef = doc(db, this.entityType, this.currentEntity.firestoreId);
                await deleteDoc(oldEntityRef);
                
                // Determine new collection name
                const newCollectionName = this.getCollectionNameForType(newType);
                
                // Create in new collection
                const newEntityData = { ...updatedEntity };
                delete newEntityData.firestoreId; // Remove old firestore ID
                delete newEntityData.firestoreCollection;
                
                const newDocRef = await addDoc(collection(db, newCollectionName), newEntityData);
                
                // Update entity with new firestore info
                updatedEntity.firestoreId = newDocRef.id;
                updatedEntity.firestoreCollection = newCollectionName;
                
                // Update the current entityType for future operations
                this.entityType = newCollectionName;
            } else {
                // Type hasn't changed, just update in place
                const entityRef = doc(db, this.entityType, this.currentEntity.firestoreId);
                const updateData = { ...updatedEntity };
                delete updateData.firestoreId;
                delete updateData.firestoreCollection;
                await updateDoc(entityRef, updateData);
            }
            
            // Update local data
            this.currentEntity = updatedEntity;
            
            // Refresh the display
            this.renderEntityProfile();
            
            // If type changed, we need to refresh the entire profile view
            if (typeChanged) {
                // Re-initialize network graph and map based on new type
                if (updatedEntity.type !== 'unknown') {
                    this.showNetworkGraphAndMap();
                    this.initializeNetworkGraph();
                    this.initializeMap();
                } else {
                    this.hideNetworkGraphAndMap();
                }
            }
            
            this.hideEditModal();
            
            if (typeChanged) {
                this.showSuccess(`Entity updated and moved to ${newType} collection successfully!`);
            } else {
                this.showSuccess('Entity updated successfully!');
            }
            
        } catch (error) {
            console.error('Error saving entity:', error);
            this.showError('Failed to save entity changes');
        }
    }

    getCollectionNameForType(entityType) {
        // Map entity types to their Firebase collection names
        switch (entityType) {
            case 'person':
                return 'people';
            case 'organization':
                return 'organizations';
            case 'place':
                return 'places';
            case 'unknown':
                return 'unknown';
            default:
                return 'unknown'; // fallback to unknown for unrecognized types
        }
    }

    // Fetch and parse Wikidata information for an entity
    async fetchAndParseWikidataInfo(wikidataId) {
        try {
            const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`);
            const data = await response.json();
            
            if (data.entities && data.entities[wikidataId]) {
                const entity = data.entities[wikidataId];
                return await this.parseWikidataEntityForUpdate(entity);
            }
        } catch (error) {
            console.error('Error fetching Wikidata entity for type change:', error);
        }
        return null;
    }

    // Parse Wikidata entity data for updating existing entities
    async parseWikidataEntityForUpdate(entity) {
        const parsedData = {
            id: entity.id,
            description: entity.descriptions?.en?.value || '',
            aliases: entity.aliases?.en?.map(alias => alias.value) || []
        };

        // Parse claims for various properties
        if (entity.claims) {
            // Instance of (P31)
            if (entity.claims.P31) {
                parsedData.instance_of = await this.resolveWikidataPropertyArray(entity.claims.P31);
            }

            // Occupation (P106) - for people
            if (entity.claims.P106) {
                parsedData.occupation = await this.resolveWikidataPropertyArray(entity.claims.P106);
            }

            // Date of birth (P569) - for people
            if (entity.claims.P569) {
                const birthClaim = entity.claims.P569[0];
                if (birthClaim?.mainsnak?.datavalue?.value?.time) {
                    parsedData.dateOfBirth = birthClaim.mainsnak.datavalue.value.time;
                }
            }

            // Country (P17)
            if (entity.claims.P17) {
                parsedData.country = await this.resolveWikidataPropertyArray(entity.claims.P17);
            }

            // Population (P1082) - for places
            if (entity.claims.P1082) {
                const popClaim = entity.claims.P1082[0];
                if (popClaim?.mainsnak?.datavalue?.value?.amount) {
                    parsedData.population = parseInt(popClaim.mainsnak.datavalue.value.amount);
                }
            }

            // Coordinates (P625) - for places
            if (entity.claims.P625) {
                const coordClaim = entity.claims.P625[0];
                if (coordClaim?.mainsnak?.datavalue?.value) {
                    const coord = coordClaim.mainsnak.datavalue.value;
                    parsedData.coordinates = {
                        lat: coord.latitude,
                        lng: coord.longitude
                    };
                }
            }

            // Additional array properties
            const arrayProperties = {
                P69: 'educated_at',      // educated at
                P551: 'residences',      // residence
                P463: 'member_of',       // member of
                P1412: 'languages_spoken', // languages spoken
                P108: 'employer',        // employer
                P26: 'spouse',           // spouse
                P40: 'children',         // child
                P22: 'parents',          // father
                P25: 'parents',          // mother
                P3373: 'siblings'        // sibling
            };

            for (const [prop, field] of Object.entries(arrayProperties)) {
                if (entity.claims[prop]) {
                    if (!parsedData[field]) parsedData[field] = [];
                    const resolved = await this.resolveWikidataPropertyArray(entity.claims[prop]);
                    if (field === 'parents' && parsedData.parents) {
                        parsedData.parents = [...parsedData.parents, ...resolved];
                    } else {
                        parsedData[field] = resolved;
                    }
                }
            }
        }

        return parsedData;
    }

    // Resolve Wikidata property array (simplified version)
    async resolveWikidataPropertyArray(claims) {
        const results = [];
        const maxClaims = Math.min(claims.length, 5); // Limit to 5 claims

        for (let i = 0; i < maxClaims; i++) {
            const claim = claims[i];
            if (claim?.mainsnak?.datavalue?.value?.id) {
                const qId = claim.mainsnak.datavalue.value.id;
                try {
                    const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qId}&format=json&origin=*`);
                    const data = await response.json();
                    const label = data.entities?.[qId]?.labels?.en?.value || qId;
                    results.push(label);
                } catch (error) {
                    results.push(qId); // Fallback to Q-ID
                }
            }
        }

        return results;
    }

    // Extract Wikidata fields appropriate for the entity type
    extractWikidataFieldsForType(wikidataInfo, entityType) {
        const fields = {};
        
        // Common fields for all types
        if (wikidataInfo.description) fields.description = wikidataInfo.description;
        if (wikidataInfo.aliases && Array.isArray(wikidataInfo.aliases)) {
            fields.aliases = wikidataInfo.aliases;
        }
        
        // Type-specific fields
        if (entityType === 'person') {
            // Person-specific fields
            if (wikidataInfo.occupation) fields.occupation = wikidataInfo.occupation;
            if (wikidataInfo.dateOfBirth) fields.dateOfBirth = wikidataInfo.dateOfBirth;
            if (wikidataInfo.educated_at) fields.educated_at = wikidataInfo.educated_at;
            if (wikidataInfo.residences) fields.residences = wikidataInfo.residences;
            if (wikidataInfo.member_of) fields.member_of = wikidataInfo.member_of;
            if (wikidataInfo.languages_spoken) fields.languages_spoken = wikidataInfo.languages_spoken;
            if (wikidataInfo.employer) fields.employer = wikidataInfo.employer;
            if (wikidataInfo.spouse) fields.spouse = wikidataInfo.spouse;
            if (wikidataInfo.children) fields.children = wikidataInfo.children;
            if (wikidataInfo.parents) fields.parents = wikidataInfo.parents;
            if (wikidataInfo.siblings) fields.siblings = wikidataInfo.siblings;
        } else if (entityType === 'organization') {
            // Organization-specific fields
            if (wikidataInfo.founded) fields.founded = wikidataInfo.founded;
            if (wikidataInfo.country) fields.country = wikidataInfo.country;
            if (wikidataInfo.member_of) fields.member_of = wikidataInfo.member_of;
            if (wikidataInfo.instance_of) fields.instance_of = wikidataInfo.instance_of;
        } else if (entityType === 'place') {
            // Place-specific fields
            if (wikidataInfo.country) fields.country = wikidataInfo.country;
            if (wikidataInfo.population) fields.population = wikidataInfo.population;
            if (wikidataInfo.coordinates) fields.coordinates = wikidataInfo.coordinates;
            if (wikidataInfo.instance_of) fields.instance_of = wikidataInfo.instance_of;
        }
        
        return fields;
    }

    // Clear Wikidata ID and all Wikidata-derived fields
    clearWikidataId() {
        // Clear the input field
        document.getElementById('editWikidataId').value = '';
        
        // Clear the search results
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('wikidataSearch').value = '';
        
    }

    // Get list of all Wikidata-derived fields that should be cleared
    getWikidataFields() {
        return [
            // Common fields
            'description',
            'aliases',
            
            // Person fields
            'occupation',
            'dateOfBirth',
            'educated_at',
            'residences',
            'member_of',
            'languages_spoken',
            'employer',
            'spouse',
            'children',
            'parents',
            'siblings',
            
            // Organization fields
            'founded',
            'country',
            'instance_of',
            
            // Place fields
            'population',
            'coordinates'
        ];
    }

    async searchWikidata(searchTerm) {
        if (searchTerm.length < 3) {
            document.getElementById('searchResults').innerHTML = '';
            return;
        }
        
        try {
            const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json&origin=*&limit=5`);
            const data = await response.json();
            
            const resultsContainer = document.getElementById('searchResults');
            resultsContainer.innerHTML = '';
            
            if (data.search && data.search.length > 0) {
                data.search.forEach(result => {
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'search-result';
                    resultDiv.innerHTML = `
                        <div class="result-title">${result.label}</div>
                        <div class="result-description">${result.description || 'No description'}</div>
                    `;
                    
                    resultDiv.onclick = () => {
                        document.getElementById('editWikidataId').value = result.id;
                        resultsContainer.innerHTML = '';
                        this.fetchEntityFromWikidata(result.id);
                    };
                    
                    resultsContainer.appendChild(resultDiv);
                });
            } else {
                resultsContainer.innerHTML = '<div class="search-result">No results found</div>';
            }
        } catch (error) {
            console.error('Wikidata search error:', error);
        }
    }

    async fetchEntityFromWikidata(wikidataId) {
        try {
            const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`);
            const data = await response.json();
            
            if (data.entities && data.entities[wikidataId]) {
                const entity = data.entities[wikidataId];
                
                // Note: Form fields are simplified - only type and wikidata_id are editable
                // The Wikidata information will be applied when the entity is saved and type changes are processed
                
                // Extract additional information based on claims
                await this.populateFieldsFromWikidata(entity);
            }
        } catch (error) {
            console.error('Error fetching Wikidata entity:', error);
        }
    }

    async populateFieldsFromWikidata(wikidataEntity) {
        // This method is no longer needed since the edit form is simplified
        // to only show type and wikidata_id fields. Wikidata information
        // is automatically applied when the entity is saved and processed.
        // Wikidata information is automatically applied when the entity is saved and processed
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

    async parseWikidataEntityForUpdate(wikidataEntity) {
        const result = {
            wikidata_id: wikidataEntity.id,
            name: wikidataEntity.labels?.en?.value || this.currentEntity.name,
            description: wikidataEntity.descriptions?.en?.value || '',
            aliases: []
        };

        // Extract aliases from Wikidata
        if (wikidataEntity.aliases && wikidataEntity.aliases.en) {
            result.aliases = wikidataEntity.aliases.en.map(alias => alias.value);
        }
        
        // Add current name to aliases if it's different from the new name
        if (this.currentEntity.name !== result.name) {
            result.aliases.push(this.currentEntity.name);
        }
        
        // Preserve existing aliases
        if (this.currentEntity.aliases) {
            result.aliases = [...new Set([...result.aliases, ...this.currentEntity.aliases])];
        }

        if (wikidataEntity.claims) {
            // Determine entity type from instance_of (P31)
            if (wikidataEntity.claims.P31) {
                result.instance_of = await this.resolveWikidataProperty(wikidataEntity.claims.P31[0]);
                result.type = this.determineEntityTypeFromWikidata(result.instance_of);
                result.category = result.type; // For consistency
            }

            // Extract type-specific properties
            if (result.type === 'person') {
                // Person-specific properties
                if (wikidataEntity.claims.P569) { // date of birth
                    result.dateOfBirth = this.extractClaimValue(wikidataEntity.claims.P569[0]);
                }
                if (wikidataEntity.claims.P106) { // occupation
                    result.occupation = await this.resolveWikidataProperty(wikidataEntity.claims.P106[0]);
                }
                if (wikidataEntity.claims.P39) { // position held
                    result.jobTitle = await this.resolveWikidataProperty(wikidataEntity.claims.P39[0]);
                }
                if (wikidataEntity.claims.P108) { // employer
                    result.currentEmployer = await this.resolveWikidataProperty(wikidataEntity.claims.P108[0]);
                }
                if (wikidataEntity.claims.P551) { // residence
                    result.currentResidence = await this.resolveWikidataProperty(wikidataEntity.claims.P551[0]);
                }
                if (wikidataEntity.claims.P21) { // gender
                    const genderId = this.extractClaimValue(wikidataEntity.claims.P21[0]);
                    result.gender = genderId === 'Q6581097' ? 'male' : genderId === 'Q6581072' ? 'female' : null;
                }
            } else if (result.type === 'organization') {
                // Organization-specific properties
                if (wikidataEntity.claims.P571) { // inception
                    result.founded = this.extractClaimValue(wikidataEntity.claims.P571[0]);
                }
                if (wikidataEntity.claims.P159) { // headquarters location
                    result.location = await this.resolveWikidataProperty(wikidataEntity.claims.P159[0]);
                }
                if (wikidataEntity.claims.P452) { // industry
                    result.industry = await this.resolveWikidataProperty(wikidataEntity.claims.P452[0]);
                }
                if (wikidataEntity.claims.P1128) { // employees
                    result.employees = parseInt(this.extractClaimValue(wikidataEntity.claims.P1128[0]));
                }
            } else if (result.type === 'place') {
                // Place-specific properties
                if (wikidataEntity.claims.P625) { // coordinates
                    const coords = wikidataEntity.claims.P625[0];
                    if (coords.mainsnak.datavalue) {
                        result.coordinates = {
                            lat: coords.mainsnak.datavalue.value.latitude,
                            lng: coords.mainsnak.datavalue.value.longitude
                        };
                    }
                }
                if (wikidataEntity.claims.P17) { // country
                    result.country = await this.resolveWikidataProperty(wikidataEntity.claims.P17[0]);
                }
                if (wikidataEntity.claims.P131) { // located in administrative territorial entity
                    result.state = await this.resolveWikidataProperty(wikidataEntity.claims.P131[0]);
                }
                if (wikidataEntity.claims.P1082) { // population
                    const population = this.extractClaimValue(wikidataEntity.claims.P1082[0]);
                    if (population) {
                        result.population = parseInt(population.replace(/^\+/, ''));
                    }
                }
            }
        }

        return result;
    }

    determineEntityTypeFromWikidata(instanceOf) {
        if (!instanceOf) return this.currentEntity.type || 'place';
        
        const instanceLower = instanceOf.toLowerCase();
        
        // Person indicators
        if (instanceLower.includes('human') || instanceLower.includes('person')) {
            return 'person';
        }
        
        // Organization indicators
        if (instanceLower.includes('organization') || instanceLower.includes('company') || 
            instanceLower.includes('corporation') || instanceLower.includes('institution') ||
            instanceLower.includes('university') || instanceLower.includes('government') ||
            instanceLower.includes('business') || instanceLower.includes('enterprise') ||
            instanceLower.includes('firm') || instanceLower.includes('agency')) {
            return 'organization';
        }
        
        // Place indicators (default for most geographic entities)
        return 'place';
    }

    async updateEntityWithWikidata(newData) {
        try {
            // Preserve critical existing data
            const updatedEntity = {
                ...this.currentEntity, // Start with existing entity
                ...newData, // Override with new Wikidata information
                // Preserve these critical fields
                id: this.currentEntity.id,
                firestoreId: this.currentEntity.firestoreId,
                connections: this.currentEntity.connections || [],
                // Preserve timestamp information
                timestamp: this.currentEntity.timestamp
            };

            // Update in Firebase
            if (updatedEntity.firestoreId) {
                const entityRef = doc(db, this.entityType, updatedEntity.firestoreId);
                const updateData = { ...updatedEntity };
                delete updateData.firestoreId; // Remove Firestore metadata
                delete updateData.firestoreCollection;
                
                await updateDoc(entityRef, updateData);
            }

            // Update local entity
            this.currentEntity = updatedEntity;

        } catch (error) {
            console.error('Error updating entity with Wikidata:', error);
            throw error;
        }
    }

    validateWikidataId(id) {
        const wikidataPattern = /^Q\d+$/;
        const input = document.getElementById('editWikidataId');
        
        if (id && !wikidataPattern.test(id)) {
            input.setCustomValidity('Wikidata ID must be in format Q123456');
        } else {
            input.setCustomValidity('');
        }
    }




    exportEntityData() {
        const dataStr = JSON.stringify(this.currentEntity, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this.currentEntity.name.replace(/\s+/g, '_')}_data.json`;
        link.click();
        
        URL.revokeObjectURL(url);
    }

    showStatus(message, type = 'info') {
        // Simple status message implementation
        const statusDiv = document.createElement('div');
        statusDiv.className = `status-message status-${type}`;
        statusDiv.textContent = message;
        statusDiv.style.position = 'fixed';
        statusDiv.style.top = '20px';
        statusDiv.style.right = '20px';
        statusDiv.style.zIndex = '1000';
        
        document.body.appendChild(statusDiv);
        
        const timeout = type === 'success' ? 3000 : type === 'error' ? 5000 : 4000;
        setTimeout(() => {
            if (document.body.contains(statusDiv)) {
                document.body.removeChild(statusDiv);
            }
        }, timeout);
    }

    showSuccess(message) {
        this.showStatus(message, 'success');
    }

    showError(message) {
        this.showStatus(message, 'error');
    }

    navigateToEntity(entityId, entityType) {
        // Check if we're in the standalone profile.html page or embedded view
        if (window.location.pathname.includes('profile.html')) {
            // Standalone profile page - navigate to new profile
            window.location.href = `profile.html?id=${entityId}&type=${entityType}`;
        } else {
            // Embedded in main app - check if KnowledgeBaseApp is available
            if (window.app && typeof window.app.showProfile === 'function') {
                window.app.showProfile(entityId, entityType);
            } else {
                // Fallback: navigate to standalone profile page
                window.location.href = `profile.html?id=${entityId}&type=${entityType}`;
            }
        }
    }
}

// Initialize the profile page (only if on profile.html)
if (window.location.pathname.includes('profile.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        new EntityProfile();
    });
}

// Export the class for use in other modules
export { EntityProfile };
