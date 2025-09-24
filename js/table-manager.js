// Table rendering and management functionality

export class TableManager {
    constructor() {
        this.filteredEntities = [];
        this.sortField = 'name';
        this.sortDirection = 'asc';
        this.allEntities = [];
    }

    initializeEventListeners() {
        // Filter toggle controls
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-toggle')) {
                this.handleFilterToggle(e.target);
            }
        });
        
        // Search control
        document.getElementById('entitySearch').addEventListener('input', () => this.filterEntities());
        
        // Clear search button
        document.getElementById('clearEntitySearch').addEventListener('click', () => this.clearSearch());
        
        // Table sorting
        document.addEventListener('click', (e) => {
            if (e.target.closest('.sortable')) {
                const sortField = e.target.closest('.sortable').dataset.sort;
                this.sortEntities(sortField);
            }
        });
    }

    updateAllEntities(processedEntities) {
        // Use denormalized connection counts for better performance
        this.allEntities = [
            ...processedEntities.people.map(e => ({...e, category: 'person'})),
            ...processedEntities.organizations.map(e => ({...e, category: 'organization'})),
            ...processedEntities.places.map(e => ({...e, category: 'place'})),
            ...processedEntities.unknown.map(e => ({...e, category: 'unknown'}))
        ].map(entity => {
            // Use the denormalized connection count if available, otherwise calculate it
            const connectionCount = entity.connectionCount !== undefined 
                ? entity.connectionCount 
                : (entity.connections ? entity.connections.length : 0);
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

    handleFilterToggle(clickedToggle) {
        // Remove active class from all toggles
        document.querySelectorAll('.filter-toggle').forEach(toggle => {
            toggle.classList.remove('active');
        });
        
        // Add active class to clicked toggle
        clickedToggle.classList.add('active');
        
        // Trigger filtering
        this.filterEntities();
    }

    filterEntities() {
        const activeToggle = document.querySelector('.filter-toggle.active');
        const typeFilter = activeToggle ? activeToggle.dataset.type : '';
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
        
        // Make row draggable
        row.draggable = true;
        row.dataset.entityId = entity.firestoreId || entity.id; // Use firestoreId for Firebase lookups
        row.dataset.entityType = collectionName;
        row.dataset.entityName = entity.name;
        
        row.innerHTML = `
            <td class="entity-name-cell" onclick="window.app.showProfile('${entity.id}', '${collectionName}')">${entity.name}</td>
            <td><span class="entity-type-badge ${entityType}">${entityType}</span></td>
            <td class="entity-description-cell" title="${description}">${truncatedDescription}</td>
            <td class="connections-count">${connectionsCount}</td>
            <td>${entity.wikidata_id ? `<a href="https://www.wikidata.org/wiki/${entity.wikidata_id}" class="wikidata-link">${entity.wikidata_id}</a>` : '—'}</td>
        `;
        
        // Add drag and drop event listeners
        this.addDragAndDropListeners(row);
        
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
            case 'unknown':
                return 'unknown';
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

    addDragAndDropListeners(row) {
        // Drag start
        row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', ''); // Required for Firefox
            row.classList.add('dragging');
            
            // Store the dragged entity data
            this.draggedEntity = {
                id: row.dataset.entityId,
                type: row.dataset.entityType,
                name: row.dataset.entityName,
                element: row
            };
        });

        // Drag end
        row.addEventListener('dragend', (e) => {
            row.classList.remove('dragging');
            this.clearDropZones();
            // Don't clear draggedEntity here if a merge is in progress
            if (!this.mergeInProgress) {
                this.draggedEntity = null;
            }
        });

        // Drag over (required for drop to work)
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (this.draggedEntity && row.dataset.entityId !== this.draggedEntity.id) {
                row.classList.add('drop-zone');
            }
        });

        // Drag leave
        row.addEventListener('dragleave', (e) => {
            // Only remove drop-zone if we're actually leaving the row
            if (!row.contains(e.relatedTarget)) {
                row.classList.remove('drop-zone');
            }
        });

        // Drop
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedEntity && row.dataset.entityId !== this.draggedEntity.id) {
                console.log('Drop event triggered:', {
                    draggedEntity: this.draggedEntity.name,
                    targetEntity: row.dataset.entityName,
                    draggedElement: this.draggedEntity.element
                });
                
                this.handleEntityMerge(this.draggedEntity, {
                    id: row.dataset.entityId,
                    type: row.dataset.entityType,
                    name: row.dataset.entityName,
                    element: row
                });
            }
            this.clearDropZones();
        });
    }

    clearDropZones() {
        const dropZones = document.querySelectorAll('.drop-zone');
        dropZones.forEach(zone => zone.classList.remove('drop-zone'));
    }

    async handleEntityMerge(draggedEntity, targetEntity) {
        try {
            // Show confirmation dialog
            const confirmMessage = `Merge "${draggedEntity.name}" into "${targetEntity.name}"?\n\n` +
                                 `This will:\n` +
                                 `• Move all events from "${draggedEntity.name}" to "${targetEntity.name}"\n` +
                                 `• Add "${draggedEntity.name}" as an alias to "${targetEntity.name}"\n` +
                                 `• Delete the "${draggedEntity.name}" entity\n\n` +
                                 `This action cannot be undone.`;

            if (!confirm(confirmMessage)) {
                this.draggedEntity = null;
                return;
            }

            // Set merge flag to prevent dragend from clearing draggedEntity
            this.mergeInProgress = true;

            // Show loading state
            targetEntity.element.style.opacity = '0.5';
            draggedEntity.element.style.opacity = '0.5';

            // Call the merge function from the main app
            if (window.app && window.app.mergeEntities) {
                console.log('Starting merge process...');
                await window.app.mergeEntities(draggedEntity, targetEntity);
                console.log('Merge completed, removing element...');
                
                // Remove the dragged row from the table immediately
                console.log('Removing dragged element:', {
                    element: draggedEntity.element,
                    parentNode: draggedEntity.element?.parentNode,
                    entityId: draggedEntity.id,
                    entityName: draggedEntity.name
                });
                
                if (draggedEntity.element && draggedEntity.element.parentNode) {
                    draggedEntity.element.parentNode.removeChild(draggedEntity.element);
                    console.log('Dragged element removed successfully');
                } else {
                    // Try to find the element by data attribute as fallback
                    console.log('Primary removal failed, trying fallback method...');
                    const tableBody = document.getElementById('entitiesTableBody');
                    if (tableBody) {
                        const elementToRemove = tableBody.querySelector(`tr[data-entity-id="${draggedEntity.id}"]`);
                        if (elementToRemove) {
                            elementToRemove.remove();
                            console.log('Dragged element removed using fallback method');
                        } else {
                            console.error('Could not find dragged element to remove:', draggedEntity.id);
                        }
                    } else {
                        console.error('Could not find table body element');
                    }
                }
                
                // Update the target row with new connection count if available
                this.updateRowAfterMerge(targetEntity);
                
                // Update connection counts for all visible rows
                this.updateAllConnectionCounts();
                
                // Reset opacity
                targetEntity.element.style.opacity = '1';
                
                // Show success message
                this.showMergeSuccess(draggedEntity.name, targetEntity.name);
            } else {
                throw new Error('Merge functionality not available');
            }

        } catch (error) {
            console.error('Error merging entities:', error);
            
            // Reset opacity
            targetEntity.element.style.opacity = '1';
            if (draggedEntity.element) {
                draggedEntity.element.style.opacity = '1';
            }
            
            alert('Error merging entities: ' + error.message);
        } finally {
            // Clear merge flag and dragged entity
            this.mergeInProgress = false;
            this.draggedEntity = null;
        }
    }

    updateRowAfterMerge(targetEntity) {
        try {
            // Find the updated entity data from the app
            if (window.app && window.app.entityProcessor) {
                const collections = ['people', 'organizations', 'places', 'unknown'];
                let updatedEntity = null;
                
                // Find the updated entity
                for (const collection of collections) {
                    const entities = window.app.entityProcessor.processedEntities[collection];
                    if (entities) {
                        updatedEntity = entities.find(e => 
                            e.firestoreId === targetEntity.id || e.id === targetEntity.id
                        );
                        if (updatedEntity) break;
                    }
                }
                
                if (updatedEntity) {
                    // Update the connection count in the table row
                    const connectionCountCell = targetEntity.element.querySelector('.connections-count');
                    if (connectionCountCell) {
                        const newCount = updatedEntity.connectionCount || 0;
                        connectionCountCell.textContent = newCount;
                        console.log(`Updated connection count for ${targetEntity.name}: ${newCount}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error updating row after merge:', error);
        }
    }

    updateAllConnectionCounts() {
        try {
            console.log('Updating connection counts for all visible rows...');
            const tableBody = document.getElementById('entitiesTableBody');
            if (!tableBody) return;

            const rows = tableBody.querySelectorAll('tr[data-entity-id]');
            rows.forEach(row => {
                const entityId = row.dataset.entityId;
                if (entityId && window.app && window.app.entityProcessor) {
                    // Find the entity in the processed data
                    const collections = ['people', 'organizations', 'places', 'unknown'];
                    let entity = null;
                    
                    for (const collection of collections) {
                        const entities = window.app.entityProcessor.processedEntities[collection];
                        if (entities) {
                            entity = entities.find(e => e.firestoreId === entityId || e.id === entityId);
                            if (entity) break;
                        }
                    }
                    
                    if (entity) {
                        const connectionCountCell = row.querySelector('.connections-count');
                        if (connectionCountCell) {
                            const newCount = entity.connectionCount || 0;
                            connectionCountCell.textContent = newCount;
                        }
                    }
                }
            });
            console.log('Connection counts updated for all visible rows');
        } catch (error) {
            console.error('Error updating all connection counts:', error);
        }
    }

    showMergeSuccess(draggedName, targetName) {
        // Create a temporary success message
        const message = document.createElement('div');
        message.className = 'merge-success-message';
        message.textContent = `Successfully merged "${draggedName}" into "${targetName}"`;
        document.body.appendChild(message);

        // Remove after 3 seconds
        setTimeout(() => {
            if (message.parentNode) {
                message.parentNode.removeChild(message);
            }
        }, 3000);
    }

    clearSearch() {
        // Clear the search input
        document.getElementById('entitySearch').value = '';
        
        // Trigger filtering to show all entities again
        this.filterEntities();
    }
}
