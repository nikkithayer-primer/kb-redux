// Firebase database operations

import { db } from './config.js';
import { collection, addDoc, updateDoc, doc, getDocs, getDoc, query, where, writeBatch, limit, startAfter, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export class FirebaseService {
    constructor() {
        this.db = db;
    }

    async saveOrUpdateEntity(entity, collectionName) {
        try {
            const sanitizedEntity = this.sanitizeDataForFirebase(entity);
            
            if (entity.firestoreId) {
                const entityRef = doc(this.db, collectionName, entity.firestoreId);
                const updateData = { ...sanitizedEntity };
                delete updateData.firestoreId;
                delete updateData.firestoreCollection;
                await updateDoc(entityRef, updateData);
            } else {
                await addDoc(collection(this.db, collectionName), sanitizedEntity);
            }
        } catch (error) {
            console.error(`Error saving ${collectionName.slice(0, -1)} ${entity.name}:`, error);
            throw error;
        }
    }

    async saveEvent(event) {
        try {
            const sanitizedEvent = this.sanitizeDataForFirebase(event);
            await addDoc(collection(this.db, 'events'), sanitizedEvent);
        } catch (error) {
            console.error('Error saving event:', error);
            throw error;
        }
    }

    async findEntityInFirebase(name, searchVariations = [name]) {
        try {
            const collections = ['people', 'organizations', 'places'];
            
            for (const collectionName of collections) {
                // Try each search variation
                for (const variation of searchVariations) {
                    // Search by name
                    const nameQuery = query(collection(this.db, collectionName), where('name', '==', variation));
                    const nameSnapshot = await getDocs(nameQuery);
                    
                    if (!nameSnapshot.empty) {
                        const doc = nameSnapshot.docs[0];
                        return {
                            firestoreId: doc.id,
                            firestoreCollection: collectionName,
                            ...doc.data()
                        };
                    }
                    
                    // Search by aliases
                    const aliasQuery = query(collection(this.db, collectionName), where('aliases', 'array-contains', variation));
                    const aliasSnapshot = await getDocs(aliasQuery);
                    
                    if (!aliasSnapshot.empty) {
                        const doc = aliasSnapshot.docs[0];
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

    async findDuplicateEvent(newEvent) {
        try {
            const eventsQuery = query(
                collection(this.db, 'events'),
                where('actor', '==', newEvent.actor),
                where('action', '==', newEvent.action),
                where('target', '==', newEvent.target)
            );
            const eventsSnapshot = await getDocs(eventsQuery);
            
            for (const doc of eventsSnapshot.docs) {
                const existingEvent = doc.data();
                if (this.eventsAreDuplicate(existingEvent, newEvent)) {
                    return { firestoreId: doc.id, ...existingEvent };
                }
            }
        } catch (error) {
            console.warn('Error checking for duplicate events in Firebase:', error);
        }
        return null;
    }

    eventsAreDuplicate(event1, event2) {
        // Check if sentences are identical
        if (event1.sentence && event2.sentence && event1.sentence === event2.sentence) {
            return true;
        }
        
        // Check if all key components match and dates are on the same day
        const sameActor = event1.actor === event2.actor;
        const sameAction = event1.action === event2.action;
        const sameTarget = event1.target === event2.target;
        const sameDay = this.isSameDay(event1.dateReceived, event2.dateReceived);
        
        return sameActor && sameAction && sameTarget && sameDay;
    }

    isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }

    sanitizeDataForFirebase(data) {
        if (data === null || data === undefined) return data;
        
        if (data instanceof Date) {
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

    async saveBatch(entities, events) {
        try {
            const batch = writeBatch(this.db);
            let operationCount = 0;
            const maxBatchSize = 500; // Firestore batch limit
            const batches = [];

            // Helper function to create a new batch when needed
            const createNewBatch = () => {
                if (operationCount > 0) {
                    console.log(`Creating new batch. Current batch has ${operationCount} operations. Total batches: ${batches.length + 1}`);
                    batches.push(currentBatch);
                }
                const newBatch = writeBatch(this.db);
                console.log(`New batch created. Total batches: ${batches.length}`);
                return newBatch;
            };

            let currentBatch = batch;

            // Add entities to batch
            for (const [collectionName, entityList] of Object.entries(entities)) {
                for (const entity of entityList) {
                    if (operationCount >= maxBatchSize) {
                        currentBatch = createNewBatch();
                        operationCount = 0;
                    }

                    const sanitizedEntity = this.sanitizeDataForFirebase(entity);
                    
                    if (entity.firestoreId && entity.firestoreCollection) {
                        // Update existing entity - only if it was loaded from Firebase
                        console.log(`Updating existing entity: ${entity.name} (${entity.firestoreId})`);
                        const entityRef = doc(this.db, collectionName, entity.firestoreId);
                        const updateData = { ...sanitizedEntity };
                        delete updateData.firestoreId;
                        delete updateData.firestoreCollection;
                        currentBatch.update(entityRef, updateData);
                    } else {
                        // Add new entity - generate new document reference
                        console.log(`Creating new entity: ${entity.name}`);
                        const entityRef = doc(collection(this.db, collectionName));
                        currentBatch.set(entityRef, sanitizedEntity);
                        
                        // Set the firestoreId for future reference
                        entity.firestoreId = entityRef.id;
                        entity.firestoreCollection = collectionName;
                        console.log(`Assigned new firestoreId: ${entity.firestoreId} to ${entity.name}`);
                    }
                    operationCount++;
                }
            }

            // Add events to batch
            for (const event of events) {
                if (operationCount >= maxBatchSize) {
                    currentBatch = createNewBatch();
                    operationCount = 0;
                }

                const sanitizedEvent = this.sanitizeDataForFirebase(event);
                const eventRef = doc(collection(this.db, 'events'));
                currentBatch.set(eventRef, sanitizedEvent);
                operationCount++;
            }

            // Add the final batch if it has operations
            if (operationCount > 0) {
                batches.push(currentBatch);
            }

            // Execute all batches
            console.log(`Executing ${batches.length} batch(es)...`);
            try {
                const commitPromises = batches.map((b, index) => {
                    console.log(`Committing batch ${index + 1}/${batches.length} with ${b._mutations ? b._mutations.length : 'unknown'} operations`);
                    return b.commit().then(() => {
                        console.log(`Batch ${index + 1} committed successfully`);
                    }).catch((error) => {
                        console.error(`Error committing batch ${index + 1}:`, error);
                        throw error;
                    });
                });
                
                await Promise.all(commitPromises);
                console.log(`All ${batches.length} batches committed successfully`);
            } catch (batchError) {
                console.error('Error committing batches:', batchError);
                throw batchError;
            }
            
            return { success: true, batchCount: batches.length };
        } catch (error) {
            console.error('Error in batch save:', error);
            throw error;
        }
    }

    async loadExistingData() {
        try {
            const collections = ['people', 'organizations', 'places', 'unknown', 'events'];
            const data = {
                people: [],
                organizations: [],
                places: [],
                unknown: [],
                events: []
            };

            // Load all collections in parallel for better performance
            const loadPromises = collections.map(async (collectionName) => {
                const snapshot = await getDocs(collection(this.db, collectionName));
                const items = [];
                snapshot.forEach(doc => {
                    items.push({
                        firestoreId: doc.id,
                        firestoreCollection: collectionName,
                        ...doc.data()
                    });
                });
                return { collectionName, items };
            });

            const results = await Promise.all(loadPromises);
            results.forEach(({ collectionName, items }) => {
                data[collectionName] = items;
            });

            return data;
        } catch (error) {
            console.error('Error loading existing data:', error);
            return {
                people: [],
                organizations: [],
                places: [],
                unknown: [],
                events: []
            };
        }
    }

    async loadEntitiesPaginated(collectionName, pageSize = 100, lastDoc = null) {
        try {
            let q = query(
                collection(this.db, collectionName),
                orderBy('name'),
                limit(pageSize)
            );

            if (lastDoc) {
                q = query(
                    collection(this.db, collectionName),
                    orderBy('name'),
                    startAfter(lastDoc),
                    limit(pageSize)
                );
            }

            const snapshot = await getDocs(q);
            const entities = [];
            let lastDocument = null;

            snapshot.forEach(doc => {
                entities.push({
                    firestoreId: doc.id,
                    firestoreCollection: collectionName,
                    ...doc.data()
                });
                lastDocument = doc;
            });

            return {
                entities,
                lastDoc: lastDocument,
                hasMore: entities.length === pageSize
            };
        } catch (error) {
            console.error(`Error loading paginated ${collectionName}:`, error);
            return { entities: [], lastDoc: null, hasMore: false };
        }
    }

    async loadEventsPaginated(pageSize = 100, lastDoc = null, filters = {}) {
        try {
            let q = query(
                collection(this.db, 'events'),
                orderBy('dateReceived', 'desc'),
                limit(pageSize)
            );

            // Add filters if provided
            if (filters.actor) {
                q = query(q, where('actor', '==', filters.actor));
            }
            if (filters.target) {
                q = query(q, where('target', '==', filters.target));
            }
            if (filters.action) {
                q = query(q, where('action', '==', filters.action));
            }

            if (lastDoc) {
                q = query(q, startAfter(lastDoc));
            }

            const snapshot = await getDocs(q);
            const events = [];
            let lastDocument = null;

            snapshot.forEach(doc => {
                events.push({
                    firestoreId: doc.id,
                    ...doc.data()
                });
                lastDocument = doc;
            });

            return {
                events,
                lastDoc: lastDocument,
                hasMore: events.length === pageSize
            };
        } catch (error) {
            console.error('Error loading paginated events:', error);
            return { events: [], lastDoc: null, hasMore: false };
        }
    }

    async exportAllData() {
        try {
            console.log('Exporting all knowledge base data...');
            
            const collections = ['people', 'organizations', 'places', 'unknown'];
            const exportData = {
                entities: {},
                events: []
            };

            // Load all entity collections
            for (const collectionName of collections) {
                const collectionRef = collection(this.db, collectionName);
                const snapshot = await getDocs(collectionRef);
                
                exportData.entities[collectionName] = snapshot.docs.map(doc => ({
                    id: doc.id,
                    firestoreId: doc.id,
                    ...doc.data()
                }));
                
                console.log(`Exported ${exportData.entities[collectionName].length} ${collectionName}`);
            }

            // Load all events
            const eventsRef = collection(this.db, 'events');
            const eventsSnapshot = await getDocs(eventsRef);
            
            exportData.events = eventsSnapshot.docs.map(doc => ({
                id: doc.id,
                firestoreId: doc.id,
                ...doc.data()
            }));
            
            console.log(`Exported ${exportData.events.length} events`);
            
            return exportData;

        } catch (error) {
            console.error('Error exporting all data:', error);
            throw error;
        }
    }

    async getEntityById(entityId, collectionName) {
        try {
            console.log(`Getting entity by ID: ${entityId} from collection: ${collectionName}`);
            const docRef = doc(this.db, collectionName, entityId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const entityData = {
                    id: docSnap.id,
                    firestoreId: docSnap.id,
                    ...docSnap.data()
                };
                console.log('Entity found:', entityData);
                return entityData;
            } else {
                console.log(`Entity not found: ${entityId} in ${collectionName}`);
                return null;
            }
        } catch (error) {
            console.error('Error getting entity by ID:', error);
            throw error;
        }
    }

    async loadAllEvents() {
        try {
            const eventsRef = collection(this.db, 'events');
            const snapshot = await getDocs(eventsRef);
            
            return snapshot.docs.map(doc => ({
                id: doc.id,
                firestoreId: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Error loading all events:', error);
            throw error;
        }
    }

    async mergeEntities(draggedEntityId, draggedEntityType, targetEntityId, targetEntityType, updatedTargetEntity, eventUpdates) {
        try {
            console.log('Starting Firebase merge operation...');
            console.log('Parameters:', {
                draggedEntityId,
                draggedEntityType,
                targetEntityId,
                targetEntityType,
                eventUpdatesCount: eventUpdates.length
            });
            
            const batch = writeBatch(this.db);
            
            // 1. Update the target entity with new aliases
            console.log('Adding target entity update to batch...');
            const targetDocRef = doc(this.db, targetEntityType, targetEntityId);
            const { id, firestoreId, ...targetEntityData } = updatedTargetEntity;
            batch.update(targetDocRef, targetEntityData);
            console.log('Target entity update added to batch');
            
            // 2. Update all events
            console.log(`Adding ${eventUpdates.length} event updates to batch...`);
            eventUpdates.forEach((event, index) => {
                try {
                    // Use firestoreId for Firebase document reference, fallback to id
                    const eventId = event.firestoreId || event.id;
                    console.log(`Updating event ${index + 1}: ${eventId}`);
                    const eventDocRef = doc(this.db, 'events', eventId);
                    const { id, firestoreId, ...eventData } = event;
                    batch.update(eventDocRef, eventData);
                    console.log(`Event ${index + 1}/${eventUpdates.length} added to batch`);
                } catch (eventError) {
                    console.error(`Error adding event ${index + 1} to batch:`, event, eventError);
                    throw eventError;
                }
            });
            console.log('All event updates added to batch');
            
            // 3. Delete the dragged entity
            console.log('Adding dragged entity deletion to batch...');
            const draggedDocRef = doc(this.db, draggedEntityType, draggedEntityId);
            batch.delete(draggedDocRef);
            console.log('Dragged entity deletion added to batch');
            
            // Execute the batch
            console.log('Committing batch...');
            await batch.commit();
            
            console.log('Firebase merge operation completed successfully');
            
        } catch (error) {
            console.error('Error in Firebase merge operation:', error);
            console.error('Error stack:', error.stack);
            throw error;
        }
    }
}
