// Table rendering and management functionality

export class TableManager {
    constructor() {
        this.filteredEntities = [];
        this.sortField = 'name';
        this.sortDirection = 'asc';
        this.allEntities = [];
    }

    initializeEventListeners() {
        // Filter and search controls
        document.getElementById('typeFilter').addEventListener('change', () => this.filterEntities());
        document.getElementById('entitySearch').addEventListener('input', () => this.filterEntities());
        
        // Table sorting
        document.addEventListener('click', (e) => {
            if (e.target.closest('.sortable')) {
                const sortField = e.target.closest('.sortable').dataset.sort;
                this.sortEntities(sortField);
            }
        });
    }

    updateAllEntities(processedEntities) {
        // Calculate actual connection counts from events
        const events = processedEntities.events || [];
        
        this.allEntities = [
            ...processedEntities.people.map(e => ({...e, category: 'person'})),
            ...processedEntities.organizations.map(e => ({...e, category: 'organization'})),
            ...processedEntities.places.map(e => ({...e, category: 'place'}))
        ].map(entity => {
            // Calculate real connection count from events
            const connectionCount = this.calculateConnectionCount(entity, events);
            return {
                ...entity,
                actualConnectionCount: connectionCount
            };
        });
        
        this.filterEntities();
    }

    calculateConnectionCount(entity, events) {
        // Count events where this entity appears as actor, target, or location
        return events.filter(event => {
            const actors = event.actor ? event.actor.split(',').map(a => a.trim()) : [];
            const targets = event.target ? event.target.split(',').map(t => t.trim()) : [];
            const locations = Array.isArray(event.locations) 
                ? event.locations.map(loc => typeof loc === 'string' ? loc : loc.name)
                : (event.locations ? event.locations.split(',').map(l => l.trim()) : []);
            
            return actors.includes(entity.name) || 
                   targets.includes(entity.name) || 
                   locations.includes(entity.name) ||
                   (entity.aliases && entity.aliases.some(alias => 
                       actors.includes(alias) || targets.includes(alias) || locations.includes(alias)
                   ));
        }).length;
    }

    filterEntities() {
        const typeFilter = document.getElementById('typeFilter').value;
        const searchTerm = document.getElementById('entitySearch').value.toLowerCase();
        
        // Get all entities if not already loaded
        if (this.allEntities.length === 0) {
            return;
        }
        
        // Apply filters
        this.filteredEntities = this.allEntities.filter(entity => {
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
                    aValue = a.actualConnectionCount || 0;
                    bValue = b.actualConnectionCount || 0;
                    break;
                case 'wikidata':
                    aValue = a.wikidata_id || '';
                    bValue = b.wikidata_id || '';
                    break;
                default:
                    aValue = a.name.toLowerCase();
                    bValue = b.name.toLowerCase();
            }
            
            if (this.sortDirection === 'asc') {
                return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            } else {
                return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            }
        });
    }

    updateSortIndicators() {
        // Remove existing sort indicators
        document.querySelectorAll('.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });
        
        // Add current sort indicator
        const currentSortTh = document.querySelector(`[data-sort="${this.sortField}"]`);
        if (currentSortTh) {
            currentSortTh.classList.add(`sort-${this.sortDirection}`);
        }
    }

    renderTable() {
        const tableBody = document.getElementById('entitiesTableBody');
        tableBody.innerHTML = '';
        
        if (this.filteredEntities.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="no-results">No entities found matching your criteria</td></tr>';
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
        
        // Use the calculated connection count from events, not the stored connections array
        const connectionsCount = entity.actualConnectionCount || 0;
        const entityType = entity.category || entity.type;
        const description = entity.description || 'No description available';
        const truncatedDescription = description.length > 100 ? description.substring(0, 100) + '...' : description;
        
        // Map entity type to collection name
        const collectionName = this.getCollectionName(entityType);
        
        row.innerHTML = `
            <td class="entity-name-cell" onclick="window.app.showProfile('${entity.id}', '${collectionName}')">${entity.name}</td>
            <td><span class="entity-type-badge ${entityType}">${entityType}</span></td>
            <td class="entity-description-cell" title="${description}">${truncatedDescription}</td>
            <td class="connections-count">${connectionsCount}</td>
            <td>${entity.wikidata_id ? `<a href="https://www.wikidata.org/wiki/${entity.wikidata_id}" class="wikidata-link">${entity.wikidata_id}</a>` : '—'}</td>
        `;
        
        return row;
    }

    getCollectionName(entityType) {
        // Map entity types to their Firebase collection names
        switch (entityType) {
            case 'person':
                return 'people';
            case 'organization':
                return 'organizations';
            case 'place':
                return 'places';
            default:
                return entityType + 's'; // fallback
        }
    }

    clearTable() {
        this.allEntities = [];
        this.filteredEntities = [];
        const tableBody = document.getElementById('entitiesTableBody');
        tableBody.innerHTML = '<tr><td colspan="5" class="no-results">No data loaded</td></tr>';
    }
}
