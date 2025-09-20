import { db } from './config.js';
import { collection, doc, getDocs, updateDoc, query, where, deleteDoc, addDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

class EntityProfile {
    constructor(entityId = null, entityType = null) {
        this.entityId = entityId || new URLSearchParams(window.location.search).get('id');
        this.entityType = entityType || new URLSearchParams(window.location.search).get('type');
        this.currentEntity = null;
        this.allEntities = [];
        this.allEvents = [];
        this.networkGraph = null;
        this.map = null;
        
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
        
        
        // Other actions
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
            
            // Only show network graph and map for known entity types
            if (this.currentEntity.type !== 'unknown') {
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
        if (entity.id) fields.push({ label: 'Entity ID', value: entity.id });
        if (entity.firestoreId) fields.push({ label: 'Database ID', value: entity.firestoreId });
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
        if (entity.occupation) fields.push({ label: 'Occupation', value: entity.occupation });
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
        if (entity.connections && entity.connections.length > 0) {
            fields.push({ label: 'Total Connections', value: entity.connections.length });
        }
        
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
                'created', 'updated', 'lastModified'
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
        const connectionsList = document.getElementById('connectionsList');
        connectionsList.innerHTML = '';
        
        // Find events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            event.target.includes(this.currentEntity.name) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
                : event.locations && event.locations.includes(this.currentEntity.name))
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
            const locations = Array.isArray(event.locations) 
                ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name)
                : (event.locations ? event.locations.split(',').map(l => l.trim()) : []);
            
            // Find other entities (not the current one)
            const otherEntities = [...actors, ...targets, ...locations].filter(name => 
                name.toLowerCase() !== this.currentEntity.name.toLowerCase()
            );
            
            // Determine relationship type
            let relationshipType = 'Connected to:';
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
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === this.currentEntity.name)
                : event.locations && event.locations.includes(this.currentEntity.name))
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
                    <span class="event-location">${Array.isArray(event.locations) 
                        ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name).join(', ')
                        : event.locations || ''}</span>
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
        
        // Create zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 10])
            .on('zoom', (event) => {
                zoomGroup.attr('transform', event.transform);
            });
        
        // Apply zoom to SVG
        svg.call(zoom);
        
        // Create a group for all zoomable content
        const zoomGroup = svg.append('g');
        
        // Prepare data for enhanced network graph
        const nodes = [];
        const links = [];
        const processedEntities = new Set();
        
        // Add the center entity
        const centerEntity = { ...this.currentEntity, isCenter: true, degree: 0 };
        nodes.push(centerEntity);
        processedEntities.add(centerEntity.id);
        
        console.log('Building network graph for:', centerEntity.name);
        
        // Find first-degree connections (direct connections to center entity)
        const firstDegreeConnections = this.getEntityConnections(centerEntity);
        
        firstDegreeConnections.forEach(connection => {
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
                
                secondDegreeConnections.forEach(secondConnection => {
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
        
        console.log(`Network graph: ${nodes.length} nodes, ${links.length} links`);
        console.log('Degree distribution:', {
            center: nodes.filter(n => n.degree === 0).length,
            firstDegree: nodes.filter(n => n.degree === 1).length,
            secondDegree: nodes.filter(n => n.degree === 2).length
        });
        
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
            .attr('stroke-width', d => d.isDirect ? 3 : 2)
            .attr('stroke-dasharray', d => d.isDirect ? '0' : '5,5');
        
        // Add nodes with different sizes for different degrees
        const node = zoomGroup.append('g')
            .selectAll('circle')
            .data(nodes)
            .enter().append('circle')
            .attr('r', d => d.degree === 0 ? 16 : d.degree === 1 ? 10 : 7)
            .attr('fill', d => this.getNodeColor(d.type))
            .attr('stroke', d => d.degree === 0 ? '#333' : '#fff')
            .attr('stroke-width', d => d.degree === 0 ? 2 : 2)
            .attr('opacity', d => d.degree === 2 ? 0.7 : 1)
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));
        
        // Add labels with different styling for different degrees
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
            .attr('dy', d => d.degree === 0 ? -20 : d.degree === 1 ? -15 : -12);
        
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
        
        // Drag functions that work with zoom
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
        this.networkGraph = { svg, simulation, zoom, zoomGroup };
        
        // Add zoom controls
        this.addZoomControls(container, zoom, svg);
    }

    addZoomControls(container, zoom, svg) {
        // Create zoom controls container
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'network-zoom-controls';
        controlsDiv.innerHTML = `
            <button class="zoom-btn" id="profileZoomIn" title="Zoom In">+</button>
            <button class="zoom-btn" id="profileZoomOut" title="Zoom Out">−</button>
            <button class="zoom-btn" id="profileZoomReset" title="Reset Zoom">⌂</button>
            <button class="zoom-btn" id="profileZoomFit" title="Fit to Screen">⊡</button>
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
        
        document.getElementById('profileZoomFit').addEventListener('click', () => {
            this.zoomToFitNodes(svg, zoom);
        });
    }

    zoomToFitNodes(svg, zoom) {
        if (!this.networkGraph || !this.networkGraph.zoomGroup) return;
        
        try {
            const bounds = this.networkGraph.zoomGroup.node().getBBox();
            const fullWidth = svg.node().clientWidth || 800;
            const fullHeight = svg.node().clientHeight || 400;
            const width = bounds.width;
            const height = bounds.height;
            const midX = bounds.x + width / 2;
            const midY = bounds.y + height / 2;

            if (width === 0 || height === 0) return;

            const scale = Math.min(fullWidth / width, fullHeight / height) * 0.8;
            const translate = [fullWidth / 2 - scale * midX, fullHeight / 2 - scale * midY];

            svg.transition().duration(750).call(
                zoom.transform,
                d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
            );
        } catch (error) {
            console.warn('Could not fit nodes to screen:', error);
        }
    }

    getEntityConnections(entity) {
        const connections = [];
        
        // Find all events where this entity is involved
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(entity.name) || 
            event.target.includes(entity.name) ||
            (Array.isArray(event.locations) 
                ? event.locations.some(loc => (typeof loc === 'string' ? loc : loc.name) === entity.name)
                : event.locations && event.locations.includes(entity.name))
        );
        
        relatedEvents.forEach(event => {
            const actors = event.actor.split(',').map(a => a.trim());
            const targets = event.target.split(',').map(t => t.trim());
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
                return '#2980b9'; // Blue for acting upon
            }
        } else {
            // Neutral relationships - muted colors
            return '#95a5a6'; // Gray for neutral connections
        }
    }

    hideNetworkGraphAndMap() {
        // Hide network graph section
        const networkSection = document.querySelector('.content-section:has(#networkGraph)');
        if (networkSection) {
            networkSection.style.display = 'none';
        }
        
        // Hide map section
        const mapSection = document.querySelector('.content-section:has(#map)');
        if (mapSection) {
            mapSection.style.display = 'none';
        }
        
        // Show a message for unknown entities
        const connectionsSection = document.querySelector('.content-section:has(#connectionsList)');
        if (connectionsSection) {
            const existingMessage = connectionsSection.querySelector('.unknown-entity-message');
            if (!existingMessage) {
                const message = document.createElement('div');
                message.className = 'unknown-entity-message';
                message.innerHTML = `
                    <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 10px 0; text-align: center;">
                        <h4 style="color: #6c757d; margin-bottom: 10px;">Unknown Entity</h4>
                        <p style="color: #6c757d; margin: 0;">This entity type is not fully classified. Network graph and map are not available.</p>
                        <p style="color: #6c757d; margin: 5px 0 0 0; font-size: 14px;">You can edit this entity to change its type if more information becomes available.</p>
                    </div>
                `;
                connectionsSection.insertBefore(message, connectionsSection.firstChild.nextSibling);
            }
        }
    }

    getNodeColor(type) {
        const colors = {
            person: '#e74c3c',
            organization: '#3498db',
            place: '#27ae60',
            unknown: '#95a5a6'
        };
        return colors[type] || '#95a5a6';
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

    addEventMarkers() {
        if (!this.map) return;
        
        // Find events related to this entity
        const relatedEvents = this.allEvents.filter(event => 
            event.actor.includes(this.currentEntity.name) || 
            event.target.includes(this.currentEntity.name) ||
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

    showEditModal() {
        this.populateEditForm();
        const editModal = document.getElementById('editModal');
        editModal.style.display = 'flex';
    }

    hideEditModal() {
        const editModal = document.getElementById('editModal');
        editModal.style.display = 'none';
        this.resetEditForm();
    }

    resetEditForm() {
        // Reset form fields
        document.getElementById('editName').value = '';
        document.getElementById('editAliases').value = '';
        document.getElementById('editDescription').value = '';
        document.getElementById('editWikidataId').value = '';
        document.getElementById('wikidataSearch').value = '';
        document.getElementById('searchResults').innerHTML = '';
        
        // Clear additional fields
        const additionalFields = document.getElementById('additionalFields');
        additionalFields.innerHTML = '';
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
            
            // Check if entity type has changed
            const originalType = this.currentEntity.type;
            const newType = updatedEntity.type;
            const typeChanged = originalType !== newType;
            
            if (typeChanged) {
                console.log(`Entity type changed from ${originalType} to ${newType}, moving between collections`);
                
                // Delete from old collection
                const oldEntityRef = doc(db, this.entityType, this.currentEntity.firestoreId);
                await deleteDoc(oldEntityRef);
                console.log(`Deleted entity from ${this.entityType} collection`);
                
                // Determine new collection name
                const newCollectionName = this.getCollectionNameForType(newType);
                
                // Create in new collection
                const newEntityData = { ...updatedEntity };
                delete newEntityData.firestoreId; // Remove old firestore ID
                delete newEntityData.firestoreCollection;
                
                const newDocRef = await addDoc(collection(db, newCollectionName), newEntityData);
                console.log(`Created entity in ${newCollectionName} collection with ID: ${newDocRef.id}`);
                
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
                console.log(`Updated entity in ${this.entityType} collection`);
            }
            
            // Update local data
            this.currentEntity = updatedEntity;
            
            // Refresh the display
            this.renderEntityProfile();
            
            // If type changed, we need to refresh the entire profile view
            if (typeChanged) {
                // Re-initialize network graph and map based on new type
                if (updatedEntity.type !== 'unknown') {
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

// Initialize the profile page (only if on profile.html)
if (window.location.pathname.includes('profile.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        new EntityProfile();
    });
}

// Export the class for use in other modules
export { EntityProfile };
