import { db } from './config.js';
import { collection, doc, getDocs, updateDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

class EntityProfile {
    constructor() {
        this.entityId = new URLSearchParams(window.location.search).get('id');
        this.entityType = new URLSearchParams(window.location.search).get('type');
        this.currentEntity = null;
        this.allEntities = [];
        this.allEvents = [];
        this.networkGraph = null;
        this.map = null;
        
        if (!this.entityId || !this.entityType) {
            window.location.href = 'index.html';
            return;
        }
        
        this.initializeEventListeners();
        this.loadEntityData();
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
        safeAddEventListener('editBtn', 'click', () => this.toggleEditMode());
        safeAddEventListener('cancelEditBtn', 'click', () => this.toggleEditMode(false));
        safeAddEventListener('entityForm', 'submit', (e) => this.saveEntity(e));
        
        // Wikidata search
        safeAddEventListener('wikidataSearch', 'input', (e) => this.searchWikidata(e.target.value));
        safeAddEventListener('editWikidataId', 'input', (e) => this.validateWikidataId(e.target.value));
        
        // Merge functionality
        safeAddEventListener('mergeBtn', 'click', () => this.showMergeModal());
        safeAddEventListener('closeMergeModal', 'click', () => this.hideMergeModal());
        safeAddEventListener('cancelMergeBtn', 'click', () => this.hideMergeModal());
        safeAddEventListener('confirmMergeBtn', 'click', () => this.performMerge());
        safeAddEventListener('fetchWikidataBtn', 'click', () => this.fetchWikidataInfo());
        
        // Other actions
        safeAddEventListener('viewConnectionsBtn', 'click', () => this.showAllConnections());
        safeAddEventListener('exportBtn', 'click', () => this.exportEntityData());
        
        // Entity type change handler
        safeAddEventListener('editType', 'change', (e) => this.updateAdditionalFields(e.target.value));
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
            
            console.log('Current entity loaded:', this.currentEntity);
            
            // Load all entities for connections
            await this.loadAllEntities();
            console.log('All entities loaded:', this.allEntities.length);
            
            // Load all events
            await this.loadAllEvents();
            console.log('All events loaded:', this.allEvents.length);
            
            // Render the profile
            this.renderEntityProfile();
            this.renderConnections();
            this.renderEvents();
            this.initializeNetworkGraph();
            this.initializeMap();
            
        } catch (error) {
            console.error('Error loading entity data:', error);
            this.showError('Failed to load entity data');
        }
    }

    async loadAllEntities() {
        const collections = ['people', 'organizations', 'places'];
        this.allEntities = [];
        
        for (const collectionName of collections) {
            const querySnapshot = await getDocs(collection(db, collectionName));
            querySnapshot.forEach((doc) => {
                this.allEntities.push({
                    id: doc.id,
                    firestoreId: doc.id,
                    type: collectionName.slice(0, -1), // Remove 's' from collection name
                    ...doc.data()
                });
            });
        }
    }

    async loadAllEvents() {
        const querySnapshot = await getDocs(collection(db, 'events'));
        this.allEvents = [];
        
        querySnapshot.forEach((doc) => {
            this.allEvents.push({
                id: doc.id,
                ...doc.data()
            });
        });
    }

    renderEntityProfile() {
        const entity = this.currentEntity;
        
        document.getElementById('entityName').textContent = entity.name;
        document.getElementById('entityType').textContent = entity.type || entity.category || 'Entity';
        document.getElementById('entityDescription').textContent = entity.description || 'No description available';
        
        // Render meta information
        const metaContainer = document.getElementById('entityMeta');
        metaContainer.innerHTML = '';
        
        const metaFields = this.getMetaFields(entity);
        metaFields.forEach(field => {
            if (field.value) {
                const metaItem = document.createElement('div');
                metaItem.className = 'meta-item';
                metaItem.innerHTML = `
                    <div class="meta-label">${field.label}</div>
                    <div class="meta-value">${field.value}</div>
                `;
                metaContainer.appendChild(metaItem);
            }
        });
    }

    getMetaFields(entity) {
        const commonFields = [
            { label: 'Wikidata ID', value: entity.wikidata_id },
            { label: 'Aliases', value: entity.aliases ? entity.aliases.join(', ') : null }
        ];
        
        if (entity.type === 'person') {
            return [
                ...commonFields,
                { label: 'Occupation', value: entity.occupation },
                { label: 'Job Title', value: entity.jobTitle },
                { label: 'Current Employer', value: entity.currentEmployer },
                { label: 'Education', value: entity.educatedAt ? entity.educatedAt.join(', ') : null },
                { label: 'Current Residence', value: entity.currentResidence },
                { label: 'Date of Birth', value: entity.dateOfBirth }
            ];
        } else if (entity.type === 'organization') {
            return [
                ...commonFields,
                { label: 'Category', value: entity.category },
                { label: 'Industry', value: entity.industry },
                { label: 'Founded', value: entity.founded },
                { label: 'Location', value: entity.location },
                { label: 'Employees', value: entity.employees }
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

    renderConnections() {
        const connectionsList = document.getElementById('connectionsList');
        connectionsList.innerHTML = '';
        
        // Find events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            event.target.includes(this.currentEntity.name) ||
            event.locations.includes(this.currentEntity.name)
        );
        
        if (relatedEvents.length === 0) {
            connectionsList.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">No connections found</p>';
            return;
        }
        
        // Sort events by date (most recent first)
        const sortedEvents = relatedEvents.sort((a, b) => {
            const dateA = this.parseEventDate(a.dateReceived);
            const dateB = this.parseEventDate(b.dateReceived);
            return dateB - dateA;
        });
        
        sortedEvents.slice(0, 10).forEach(event => {
            const connectionItem = document.createElement('div');
            connectionItem.className = 'connection-item';
            
            // Parse entities from the event
            const actors = event.actor.split(',').map(a => a.trim());
            const targets = event.target.split(',').map(t => t.trim());
            const locations = event.locations.split(',').map(l => l.trim());
            
            // Find other entities (not the current one)
            const otherEntities = [...actors, ...targets, ...locations].filter(name => 
                name.toLowerCase() !== this.currentEntity.name.toLowerCase()
            );
            
            // Determine relationship type
            let relationshipType = 'connected to';
            let relatedEntityNames = otherEntities;
            
            if (actors.includes(this.currentEntity.name)) {
                relationshipType = `${event.action}`;
                relatedEntityNames = [...targets, ...locations];
            } else if (targets.includes(this.currentEntity.name)) {
                relationshipType = 'target of';
                relatedEntityNames = [...actors, ...locations];
            } else if (locations.includes(this.currentEntity.name)) {
                relationshipType = 'location of';
                relatedEntityNames = [...actors, ...targets];
            }
            
            const displayNames = relatedEntityNames.slice(0, 3).join(', ') || 'Event';
            
            // Find a clickable entity
            let clickableEntity = null;
            for (const name of relatedEntityNames) {
                clickableEntity = this.findEntityByName(name);
                if (clickableEntity) break;
            }
            
            // Format the date
            const eventDate = this.parseEventDate(event.dateReceived);
            const dateString = eventDate ? eventDate.toLocaleDateString() : 'Unknown date';
            
            connectionItem.innerHTML = `
                <div class="connection-type">${relationshipType} ${displayNames}</div>
                <div class="connection-details">
                    Action: ${event.action}<br>
                    Date: ${dateString}
                </div>
            `;
            
            if (clickableEntity) {
                connectionItem.onclick = () => {
                    const typeParam = clickableEntity.type === 'person' ? 'people' : 
                                     clickableEntity.type === 'organization' ? 'organizations' : 'places';
                    window.location.href = `profile.html?id=${clickableEntity.id}&type=${typeParam}`;
                };
                connectionItem.style.cursor = 'pointer';
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
            event.target.includes(this.currentEntity.name) ||
            event.locations.includes(this.currentEntity.name)
        );
        
        if (relatedEvents.length === 0) {
            eventsList.innerHTML = '<p style="color: #7f8c8d; text-align: center; padding: 20px;">No related events found</p>';
            return;
        }
        
        // Sort events by date (most recent first)
        const sortedEvents = relatedEvents.sort((a, b) => {
            const dateA = this.parseEventDate(a.dateReceived);
            const dateB = this.parseEventDate(b.dateReceived);
            return dateB - dateA;
        });
        
        sortedEvents.slice(0, 10).forEach(event => {
            const eventItem = document.createElement('div');
            eventItem.className = 'event-item';
            
            // Format the date properly
            const eventDate = this.parseEventDate(event.dateReceived);
            const dateString = eventDate ? eventDate.toLocaleDateString() : 'Unknown date';
            
            eventItem.innerHTML = `
                <div class="event-sentence">${event.sentence}</div>
                <div class="event-meta">
                    <span>${dateString}</span>
                    <span class="event-location">${event.locations}</span>
                </div>
            `;
            
            eventsList.appendChild(eventItem);
        });
    }

    initializeNetworkGraph() {
        const container = document.getElementById('networkGraph');
        container.innerHTML = '';
        
        const width = container.clientWidth;
        const height = 400;
        
        const svg = d3.select('#networkGraph')
            .append('svg')
            .attr('width', width)
            .attr('height', height);
        
        // Prepare data for network graph
        const nodes = [this.currentEntity];
        const links = [];
        
        // Add connected entities based on events
        const connectedEntities = new Set();
        
        // Find events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            event.target.includes(this.currentEntity.name) ||
            event.locations.includes(this.currentEntity.name)
        );
        
        console.log('Related events for network graph:', relatedEvents.length);
        console.log('Current entity name:', this.currentEntity.name);
        
        // For each related event, find other entities involved
        relatedEvents.forEach(event => {
            const actors = event.actor.split(',').map(a => a.trim());
            const targets = event.target.split(',').map(t => t.trim());
            const locations = event.locations.split(',').map(l => l.trim());
            
            // Combine all entities from this event
            const allEventEntities = [...actors, ...targets, ...locations];
            
            allEventEntities.forEach(entityName => {
                if (entityName !== this.currentEntity.name) {
                    const relatedEntity = this.findEntityByName(entityName);
                    console.log(`Looking for entity: ${entityName}, found:`, relatedEntity ? relatedEntity.name : 'not found');
                    if (relatedEntity && !connectedEntities.has(relatedEntity.id)) {
                        connectedEntities.add(relatedEntity.id);
                        nodes.push(relatedEntity);
                        
                        // Determine relationship type
                        let relationshipType = 'connected to';
                        if (actors.includes(this.currentEntity.name) && targets.includes(entityName)) {
                            relationshipType = event.action;
                        } else if (targets.includes(this.currentEntity.name) && actors.includes(entityName)) {
                            relationshipType = 'target of';
                        } else if (locations.includes(entityName)) {
                            relationshipType = 'located at';
                        }
                        
                        links.push({
                            source: this.currentEntity,
                            target: relatedEntity,
                            type: relationshipType,
                            action: event.action,
                            eventId: event.id
                        });
                    }
                }
            });
        });
        
        // Remove duplicates
        const uniqueNodes = nodes.filter((node, index, self) => 
            index === self.findIndex(n => n.id === node.id)
        );
        
        // Create force simulation
        const simulation = d3.forceSimulation(uniqueNodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2));
        
        // Add links
        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', 2);
        
        // Add nodes
        const node = svg.append('g')
            .selectAll('circle')
            .data(uniqueNodes)
            .enter().append('circle')
            .attr('r', d => d.id === this.currentEntity.id ? 12 : 8)
            .attr('fill', d => this.getNodeColor(d.type))
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));
        
        // Add labels
        const label = svg.append('g')
            .selectAll('text')
            .data(uniqueNodes)
            .enter().append('text')
            .text(d => d.name)
            .attr('font-size', '12px')
            .attr('font-family', 'SF Pro Display, sans-serif')
            .attr('fill', '#333')
            .attr('text-anchor', 'middle')
            .attr('dy', -15);
        
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
        
        // Drag functions
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
        
        // Add tooltips
        node.append('title').text(d => `${d.name} (${d.type})`);
        
        this.networkGraph = { svg, simulation };
    }

    getNodeColor(type) {
        const colors = {
            person: '#e74c3c',
            organization: '#3498db',
            place: '#27ae60'
        };
        return colors[type] || '#95a5a6';
    }

    initializeMap() {
        const mapContainer = document.getElementById('map');
        
        // Initialize Leaflet map
        this.map = L.map('map').setView([39.8283, -98.5795], 4); // Center on US
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);
        
        // Add markers for event locations
        this.addEventMarkers();
    }

    addEventMarkers() {
        if (!this.map) return;
        
        // Find events related to this entity
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            event.target.includes(this.currentEntity.name) ||
            event.locations.includes(this.currentEntity.name)
        );
        
        // Extract unique locations from events
        const locationCounts = {};
        relatedEvents.forEach(event => {
            if (event.locations) {
                const locations = event.locations.split(',').map(l => l.trim());
                locations.forEach(location => {
                    locationCounts[location] = (locationCounts[location] || 0) + 1;
                });
            }
        });
        
        // Add markers for each location
        Object.entries(locationCounts).forEach(async ([locationName, count]) => {
            const coordinates = await this.getLocationCoordinates(locationName);
            if (coordinates) {
                const marker = L.marker([coordinates.lat, coordinates.lng])
                    .addTo(this.map)
                    .bindPopup(`
                        <strong>${locationName}</strong><br>
                        ${count} event${count > 1 ? 's' : ''}
                    `);
            }
        });
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

    toggleEditMode(show = true) {
        const editForm = document.getElementById('editForm');
        const profileHeader = document.querySelector('.profile-header');
        
        if (show) {
            this.populateEditForm();
            editForm.style.display = 'block';
            profileHeader.style.display = 'none';
        } else {
            editForm.style.display = 'none';
            profileHeader.style.display = 'block';
        }
    }

    populateEditForm() {
        const entity = this.currentEntity;
        
        document.getElementById('editName').value = entity.name || '';
        document.getElementById('editAliases').value = entity.aliases ? entity.aliases.join(', ') : '';
        document.getElementById('editType').value = entity.type || 'person';
        document.getElementById('editDescription').value = entity.description || '';
        document.getElementById('editWikidataId').value = entity.wikidata_id || '';
        
        this.updateAdditionalFields(entity.type || 'person');
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
            const formData = new FormData(event.target);
            const updatedEntity = { ...this.currentEntity };
            
            // Update basic fields
            updatedEntity.name = document.getElementById('editName').value;
            updatedEntity.aliases = document.getElementById('editAliases').value.split(',').map(a => a.trim()).filter(a => a);
            updatedEntity.type = document.getElementById('editType').value;
            updatedEntity.description = document.getElementById('editDescription').value;
            updatedEntity.wikidata_id = document.getElementById('editWikidataId').value;
            
            // Update additional fields
            const additionalFields = this.getAdditionalFieldsForType(updatedEntity.type);
            additionalFields.forEach(field => {
                const value = document.getElementById(field.id).value;
                if (value) {
                    if (field.type === 'number') {
                        updatedEntity[field.property] = parseInt(value);
                    } else {
                        updatedEntity[field.property] = value;
                    }
                }
            });
            
            // Handle coordinates for places
            if (updatedEntity.type === 'place') {
                const lat = document.getElementById('editLatitude')?.value;
                const lng = document.getElementById('editLongitude')?.value;
                if (lat && lng) {
                    updatedEntity.coordinates = {
                        lat: parseFloat(lat),
                        lng: parseFloat(lng)
                    };
                }
            }
            
            // Update in Firebase
            const entityRef = doc(db, this.entityType, this.currentEntity.firestoreId);
            await updateDoc(entityRef, updatedEntity);
            
            // Update local data
            this.currentEntity = updatedEntity;
            
            // Refresh the display
            this.renderEntityProfile();
            this.toggleEditMode(false);
            
            this.showSuccess('Entity updated successfully!');
            
        } catch (error) {
            console.error('Error saving entity:', error);
            this.showError('Failed to save entity changes');
        }
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
                
                // Update form fields with Wikidata information
                if (entity.labels?.en?.value) {
                    document.getElementById('editName').value = entity.labels.en.value;
                }
                
                if (entity.descriptions?.en?.value) {
                    document.getElementById('editDescription').value = entity.descriptions.en.value;
                }
                
                // Extract additional information based on claims
                await this.populateFieldsFromWikidata(entity);
            }
        } catch (error) {
            console.error('Error fetching Wikidata entity:', error);
        }
    }

    async populateFieldsFromWikidata(wikidataEntity) {
        if (!wikidataEntity.claims) return;
        
        const entityType = document.getElementById('editType').value;
        
        if (entityType === 'person') {
            // Date of birth (P569)
            if (wikidataEntity.claims.P569 && document.getElementById('editDateOfBirth')) {
                const dob = wikidataEntity.claims.P569[0]?.mainsnak?.datavalue?.value?.time;
                if (dob) {
                    const date = new Date(dob.replace(/^\+/, ''));
                    document.getElementById('editDateOfBirth').value = date.toISOString().split('T')[0];
                }
            }
            
            // Occupation (P106)
            if (wikidataEntity.claims.P106 && document.getElementById('editOccupation')) {
                const occupationValue = await this.resolveWikidataProperty(wikidataEntity.claims.P106[0]);
                if (occupationValue) {
                    document.getElementById('editOccupation').value = occupationValue;
                }
            }
        }
        
        if (entityType === 'place') {
            // Coordinates (P625)
            if (wikidataEntity.claims.P625) {
                const coords = wikidataEntity.claims.P625[0]?.mainsnak?.datavalue?.value;
                if (coords) {
                    if (document.getElementById('editLatitude')) {
                        document.getElementById('editLatitude').value = coords.latitude;
                    }
                    if (document.getElementById('editLongitude')) {
                        document.getElementById('editLongitude').value = coords.longitude;
                    }
                }
            }
            
            // Population (P1082)
            if (wikidataEntity.claims.P1082 && document.getElementById('editPopulation')) {
                const population = wikidataEntity.claims.P1082[0]?.mainsnak?.datavalue?.value?.amount;
                if (population) {
                    document.getElementById('editPopulation').value = parseInt(population.replace('+', ''));
                }
            }
            
            // Country (P17)
            if (wikidataEntity.claims.P17 && document.getElementById('editCountry')) {
                const countryValue = await this.resolveWikidataProperty(wikidataEntity.claims.P17[0]);
                if (countryValue) {
                    document.getElementById('editCountry').value = countryValue;
                }
            }
        }
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
            instanceLower.includes('university') || instanceLower.includes('government')) {
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
                console.log(`Updated entity in Firebase: ${updatedEntity.name}`);
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

    showMergeModal() {
        document.getElementById('mergeModal').style.display = 'block';
    }

    hideMergeModal() {
        document.getElementById('mergeModal').style.display = 'none';
        this.resetMergeModal();
    }

    resetMergeModal() {
        // Reset form fields
        document.getElementById('mergeSearch').value = '';
        document.getElementById('newWikidataId').value = '';
        document.getElementById('mergeSearchResults').innerHTML = '';
        
        // Hide and reset preview
        const previewDiv = document.getElementById('wikidataPreview');
        previewDiv.classList.add('hidden');
        previewDiv.innerHTML = '';
        
        // Reset fetch button
        const fetchBtn = document.getElementById('fetchWikidataBtn');
        fetchBtn.textContent = 'Fetch Wikidata Info';
        fetchBtn.disabled = false;
        fetchBtn.onclick = () => this.fetchWikidataInfo();
        
        // Clear pending update
        this.pendingWikidataUpdate = null;
    }

    async performMerge() {
        // Implementation for merging entities
        console.log('Merge functionality to be implemented');
        this.hideMergeModal();
    }

    async fetchWikidataInfo() {
        const wikidataId = document.getElementById('newWikidataId').value.trim();
        
        if (!wikidataId) {
            this.showError('Please enter a Wikidata ID');
            return;
        }
        
        if (!wikidataId.match(/^Q\d+$/)) {
            this.showError('Wikidata ID must be in format Q123456');
            return;
        }
        
        try {
            // Show loading state
            const fetchBtn = document.getElementById('fetchWikidataBtn');
            const originalText = fetchBtn.textContent;
            fetchBtn.textContent = 'Fetching...';
            fetchBtn.disabled = true;
            
            // Fetch the new Wikidata entity
            const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`);
            const data = await response.json();
            
            if (!data.entities || !data.entities[wikidataId]) {
                this.showError('Wikidata entity not found');
                fetchBtn.textContent = originalText;
                fetchBtn.disabled = false;
                return;
            }
            
            const wikidataEntity = data.entities[wikidataId];
            
            // Parse the Wikidata entity to get structured data
            const parsedData = await this.parseWikidataEntityForUpdate(wikidataEntity);
            
            // Show preview of what will change
            this.showWikidataPreview(parsedData);
            
            // Store the parsed data for later use
            this.pendingWikidataUpdate = parsedData;
            
            // Update button text
            fetchBtn.textContent = 'Apply Changes';
            fetchBtn.onclick = () => this.applyWikidataChanges();
            fetchBtn.disabled = false;
            
        } catch (error) {
            console.error('Error fetching Wikidata info:', error);
            this.showError('Failed to fetch Wikidata information');
            
            const fetchBtn = document.getElementById('fetchWikidataBtn');
            fetchBtn.textContent = 'Fetch Wikidata Info';
            fetchBtn.disabled = false;
        }
    }

    showWikidataPreview(parsedData) {
        const previewDiv = document.getElementById('wikidataPreview');
        previewDiv.classList.remove('hidden');
        
        const currentType = this.currentEntity.type || this.currentEntity.category;
        const newType = parsedData.type;
        const typeChanged = currentType !== newType;
        
        previewDiv.innerHTML = `
            <div class="preview-title">${parsedData.name}</div>
            <div class="preview-description">${parsedData.description || 'No description available'}</div>
            <div class="preview-details">
                <strong>Type:</strong> ${parsedData.type} ${typeChanged ? `(was: ${currentType})` : ''}<br>
                <strong>Wikidata ID:</strong> ${parsedData.wikidata_id}<br>
                ${parsedData.aliases && parsedData.aliases.length > 0 ? `<strong>Aliases:</strong> ${parsedData.aliases.join(', ')}<br>` : ''}
                ${parsedData.coordinates ? `<strong>Coordinates:</strong> ${parsedData.coordinates.lat}, ${parsedData.coordinates.lng}<br>` : ''}
                ${parsedData.occupation ? `<strong>Occupation:</strong> ${parsedData.occupation}<br>` : ''}
                ${parsedData.country ? `<strong>Country:</strong> ${parsedData.country}<br>` : ''}
                ${parsedData.population ? `<strong>Population:</strong> ${parsedData.population.toLocaleString()}<br>` : ''}
            </div>
            ${typeChanged ? '<div class="preview-warning">⚠️ This will change the entity type and may move it to a different collection in your knowledge base.</div>' : ''}
            <div style="margin-top: 10px; font-size: 0.9rem; color: #6c757d;">
                <strong>Note:</strong> All existing connections and events will be preserved.
            </div>
        `;
    }

    async applyWikidataChanges() {
        if (!this.pendingWikidataUpdate) {
            this.showError('No Wikidata changes to apply');
            return;
        }
        
        try {
            this.showStatus('Updating entity with Wikidata information...', 'info');
            
            // Update the current entity with new Wikidata information
            await this.updateEntityWithWikidata(this.pendingWikidataUpdate);
            
            this.showSuccess('Entity updated with new Wikidata information!');
            this.hideMergeModal();
            
            // Refresh the profile display
            this.renderEntityProfile();
            
            // Clear pending update
            this.pendingWikidataUpdate = null;
            
        } catch (error) {
            console.error('Error applying Wikidata changes:', error);
            this.showError('Failed to update entity');
        }
    }

    showAllConnections() {
        // Implementation for showing all connections in a modal or separate view
        console.log('Show all connections functionality to be implemented');
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
}

// Initialize the profile page
document.addEventListener('DOMContentLoaded', () => {
    new EntityProfile();
});
