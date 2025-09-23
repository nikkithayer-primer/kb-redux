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
            throw error;
        }
    }

    async saveEvent(event) {
        try {
            const sanitizedEvent = this.sanitizeDataForFirebase(event);
            await addDoc(collection(this.db, 'events'), sanitizedEvent);
        } catch (error) {
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
            // Silently handle error
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
            // Silently handle error
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
                    batches.push(currentBatch);
                }
                const newBatch = writeBatch(this.db);
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
                        const entityRef = doc(this.db, collectionName, entity.firestoreId);
                        const updateData = { ...sanitizedEntity };
                        delete updateData.firestoreId;
                        delete updateData.firestoreCollection;
                        currentBatch.update(entityRef, updateData);
                    } else {
                        // Add new entity - generate new document reference
                        const entityRef = doc(collection(this.db, collectionName));
                        currentBatch.set(entityRef, sanitizedEntity);
                        
                        // Set the firestoreId for future reference
                        entity.firestoreId = entityRef.id;
                        entity.firestoreCollection = collectionName;
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
            try {
                const commitPromises = batches.map((b, index) => {
                    return b.commit().catch((error) => {
                        throw error;
                    });
                });
                
                await Promise.all(commitPromises);
            } catch (batchError) {
                throw batchError;
            }
            
            return { success: true, batchCount: batches.length };
        } catch (error) {
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
            return { events: [], lastDoc: null, hasMore: false };
        }
    }

    async exportAllData() {
        try {
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
            }

            // Load all events
            const eventsRef = collection(this.db, 'events');
            const eventsSnapshot = await getDocs(eventsRef);
            
            exportData.events = eventsSnapshot.docs.map(doc => ({
                id: doc.id,
                firestoreId: doc.id,
                ...doc.data()
            }));
            
            return exportData;

        } catch (error) {
            throw error;
        }
    }

    async getEntityById(entityId, collectionName) {
        try {
            const docRef = doc(this.db, collectionName, entityId);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const entityData = {
                    id: docSnap.id,
                    firestoreId: docSnap.id,
                    ...docSnap.data()
                };
                return entityData;
            } else {
                return null;
            }
        } catch (error) {
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
            throw error;
        }
    }

    async mergeEntities(draggedEntityId, draggedEntityType, targetEntityId, targetEntityType, updatedTargetEntity, eventUpdates) {
        try {
            const batch = writeBatch(this.db);
            
            // 1. Update the target entity with new aliases
            const targetDocRef = doc(this.db, targetEntityType, targetEntityId);
            const { id, firestoreId, ...targetEntityData } = updatedTargetEntity;
            batch.update(targetDocRef, targetEntityData);
            
            // 2. Update all events
            eventUpdates.forEach((event, index) => {
                try {
                    // Use firestoreId for Firebase document reference, fallback to id
                    const eventId = event.firestoreId || event.id;
                    const eventDocRef = doc(this.db, 'events', eventId);
                    const { id, firestoreId, ...eventData } = event;
                    batch.update(eventDocRef, eventData);
                } catch (eventError) {
                    throw eventError;
                }
            });
            
            // 3. Delete the dragged entity
            const draggedDocRef = doc(this.db, draggedEntityType, draggedEntityId);
            batch.delete(draggedDocRef);
            
            // Execute the batch
            await batch.commit();
            
        } catch (error) {
            throw error;
        }
    }
}
