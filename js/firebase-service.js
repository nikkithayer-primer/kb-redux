// Firebase database operations

import { db } from './config.js';
import { collection, addDoc, updateDoc, doc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
                console.log(`Updated existing ${collectionName.slice(0, -1)}: ${entity.name}`);
            } else {
                await addDoc(collection(this.db, collectionName), sanitizedEntity);
                console.log(`Created new ${collectionName.slice(0, -1)}: ${entity.name}`);
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
            console.log(`Saved event: ${event.sentence}`);
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
                    const aliasQuery = query(collection(this.db, collectionName), where('aliases', 'array-contains', variation));
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

            for (const collectionName of collections) {
                const snapshot = await getDocs(collection(this.db, collectionName));
                snapshot.forEach(doc => {
                    data[collectionName].push({
                        firestoreId: doc.id,
                        firestoreCollection: collectionName,
                        ...doc.data()
                    });
                });
            }

            console.log('Loaded existing data from Firebase:', {
                people: data.people.length,
                organizations: data.organizations.length,
                places: data.places.length,
                events: data.events.length
            });

            return data;
        } catch (error) {
            console.error('Error loading existing data:', error);
            return {
                people: [],
                organizations: [],
                places: [],
                events: []
            };
        }
    }
}
