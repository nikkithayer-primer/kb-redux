// Deduplication service for managing duplicate entities in Firebase

import { db } from './config.js';
import { collection, doc, getDocs, updateDoc, deleteDoc, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export class DeduplicationService {
    constructor() {
        this.db = db;
        this.collections = ['people', 'organizations', 'places', 'unknown'];
    }

    async runDeduplication() {
        let totalDuplicatesFound = 0;
        let totalDuplicatesRemoved = 0;

        try {
            for (const collectionName of this.collections) {
                const duplicates = await this.findDuplicatesInCollection(collectionName);
                
                if (duplicates.length > 0) {
                    totalDuplicatesFound += duplicates.length;
                    
                    for (const duplicateGroup of duplicates) {
                        const removed = await this.mergeDuplicateGroup(duplicateGroup, collectionName);
                        totalDuplicatesRemoved += removed;
                    }
                }
            }
            return {
                duplicateGroupsFound: totalDuplicatesFound,
                duplicatesRemoved: totalDuplicatesRemoved
            };

        } catch (error) {
            console.error('Error during deduplication:', error);
            throw error;
        }
    }

    async findDuplicatesInCollection(collectionName) {
        try {
            // Use indexed query to only get entities with Wikidata IDs
            // This is much more efficient than scanning all documents
            const q = query(
                collection(this.db, collectionName),
                where('wikidata_id', '!=', null),
                orderBy('wikidata_id'),
                orderBy('name')
            );
            
            const snapshot = await getDocs(q);
            const wikidataGroups = new Map();
            
            snapshot.forEach(doc => {
                const data = doc.data();
                const wikidataId = data.wikidata_id;
                
                if (!wikidataGroups.has(wikidataId)) {
                    wikidataGroups.set(wikidataId, []);
                }
                
                wikidataGroups.get(wikidataId).push({
                    firestoreId: doc.id,
                    ...data
                });
            });

            // Find groups with more than one entity (duplicates)
            const duplicateGroups = [];
            
            for (const [wikidataId, entities] of wikidataGroups) {
                if (entities.length > 1) {
                    // Sort by creation date or ID to determine which is "older"
                    const sortedGroup = entities.sort((a, b) => {
                        // If both have timestamps, use those
                        if (a.created && b.created) {
                            return new Date(a.created) - new Date(b.created);
                        }
                        // If both have IDs, use those (assuming earlier IDs are older)
                        if (a.id && b.id) {
                            return a.id.localeCompare(b.id);
                        }
                        // Fallback to firestoreId
                        return a.firestoreId.localeCompare(b.firestoreId);
                    });
                    
                    duplicateGroups.push({
                        wikidataId,
                        entities: sortedGroup
                    });
                }
            }

            return duplicateGroups;

        } catch (error) {
            console.error(`Error finding duplicates in ${collectionName}:`, error);
            throw error;
        }
    }

    async mergeDuplicateGroup(duplicateGroup, collectionName) {
        try {
            const { wikidataId, entities } = duplicateGroup;
            const keepEntity = entities[0]; // The oldest entity
            const duplicateEntities = entities.slice(1); // All other entities to be merged

            // Merge connections and data from duplicates into the keep entity
            let mergedConnections = keepEntity.connections || [];
            let mergedAliases = new Set(keepEntity.aliases || []);

            for (const duplicate of duplicateEntities) {
                // Merge connections
                if (duplicate.connections && duplicate.connections.length > 0) {
                    mergedConnections = mergedConnections.concat(duplicate.connections);
                }

                // Merge aliases
                if (duplicate.aliases) {
                    duplicate.aliases.forEach(alias => mergedAliases.add(alias));
                }

                // Add the duplicate's name as an alias if it's different
                if (duplicate.name !== keepEntity.name) {
                    mergedAliases.add(duplicate.name);
                }
            }

            // Update the keep entity with merged data
            const updatedEntity = {
                ...keepEntity,
                connections: mergedConnections,
                aliases: Array.from(mergedAliases),
                lastDeduplication: new Date().toISOString()
            };

            // Remove Firestore metadata before updating
            const updateData = { ...updatedEntity };
            delete updateData.firestoreId;
            delete updateData.firestoreCollection;

            // Update the keep entity in Firebase
            const keepEntityRef = doc(this.db, collectionName, keepEntity.firestoreId);
            await updateDoc(keepEntityRef, updateData);

            // Update events to reference the keep entity instead of duplicates
            await this.updateEventsForMergedEntity(keepEntity, duplicateEntities);

            // Delete duplicate entities
            for (const duplicate of duplicateEntities) {
                const duplicateRef = doc(this.db, collectionName, duplicate.firestoreId);
                await deleteDoc(duplicateRef);
            }

            return duplicateEntities.length;

        } catch (error) {
            console.error('Error merging duplicate group:', error);
            throw error;
        }
    }

    async updateEventsForMergedEntity(keepEntity, duplicateEntities) {
        try {
            // Get all events
            const eventsSnapshot = await getDocs(collection(this.db, 'events'));
            const eventsToUpdate = [];

            eventsSnapshot.forEach(doc => {
                const event = doc.data();
                let needsUpdate = false;
                let updatedEvent = { ...event };

                // Check if any duplicate entity names appear in the event
                for (const duplicate of duplicateEntities) {
                    // Update actor field
                    if (event.actor && event.actor.includes(duplicate.name)) {
                        updatedEvent.actor = updatedEvent.actor.replace(
                            new RegExp(`\\b${duplicate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
                            keepEntity.name
                        );
                        needsUpdate = true;
                    }

                    // Update target field
                    if (event.target && event.target.includes(duplicate.name)) {
                        updatedEvent.target = updatedEvent.target.replace(
                            new RegExp(`\\b${duplicate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
                            keepEntity.name
                        );
                        needsUpdate = true;
                    }

                    // Update locations if it's an array
                    if (Array.isArray(event.locations)) {
                        const updatedLocations = event.locations.map(location => 
                            location === duplicate.name ? keepEntity.name : location
                        );
                        if (JSON.stringify(updatedLocations) !== JSON.stringify(event.locations)) {
                            updatedEvent.locations = updatedLocations;
                            needsUpdate = true;
                        }
                    }

                    // Update sentence field
                    if (event.sentence && event.sentence.includes(duplicate.name)) {
                        updatedEvent.sentence = updatedEvent.sentence.replace(
                            new RegExp(`\\b${duplicate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'),
                            keepEntity.name
                        );
                        needsUpdate = true;
                    }
                }

                if (needsUpdate) {
                    eventsToUpdate.push({
                        id: doc.id,
                        data: updatedEvent
                    });
                }
            });

            // Update all events that reference the merged entities
            for (const eventUpdate of eventsToUpdate) {
                const eventRef = doc(this.db, 'events', eventUpdate.id);
                await updateDoc(eventRef, eventUpdate.data);
            }

        } catch (error) {
            console.error('Error updating events for merged entity:', error);
            throw error;
        }
    }

    async getDeduplicationPreview() {
        try {
            const preview = {};
            let totalDuplicates = 0;

            for (const collectionName of this.collections) {
                const duplicates = await this.findDuplicatesInCollection(collectionName);
                preview[collectionName] = duplicates.map(group => ({
                    wikidataId: group.wikidataId,
                    count: group.entities.length,
                    entities: group.entities.map(e => ({
                        name: e.name,
                        id: e.id,
                        firestoreId: e.firestoreId,
                        connections: e.connections ? e.connections.length : 0
                    }))
                }));
                totalDuplicates += duplicates.reduce((sum, group) => sum + (group.entities.length - 1), 0);
            }

            return {
                preview,
                totalDuplicatesToRemove: totalDuplicates
            };

        } catch (error) {
            console.error('Error generating deduplication preview:', error);
            throw error;
        }
    }
}
