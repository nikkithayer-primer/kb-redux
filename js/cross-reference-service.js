// Cross-reference optimization service for efficient entity relationship queries

import { db } from './config.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export class CrossReferenceService {
    constructor() {
        this.db = db;
        this.relationshipCache = new Map();
        this.entityConnectionCache = new Map();
    }

    // Get entities that frequently appear together
    async getRelatedEntities(entityName, maxResults = 10) {
        const cacheKey = `related_${entityName}_${maxResults}`;
        
        if (this.relationshipCache.has(cacheKey)) {
            return this.relationshipCache.get(cacheKey);
        }

        try {
            // Query events where this entity appears as actor
            const actorEvents = await this.getEventsForEntity(entityName, 'actor');
            
            // Query events where this entity appears as target
            const targetEvents = await this.getEventsForEntity(entityName, 'target');
            
            // Combine and analyze co-occurrences
            const allEvents = [...actorEvents, ...targetEvents];
            const coOccurrences = this.analyzeCoOccurrences(entityName, allEvents);
            
            // Sort by frequency and return top results
            const sortedRelated = Object.entries(coOccurrences)
                .sort(([,a], [,b]) => b.count - a.count)
                .slice(0, maxResults)
                .map(([name, data]) => ({
                    name,
                    connectionCount: data.count,
                    relationshipTypes: data.types,
                    lastInteraction: data.lastDate
                }));

            // Cache the result
            this.relationshipCache.set(cacheKey, sortedRelated);
            
            return sortedRelated;
        } catch (error) {
            console.error('Error getting related entities:', error);
            return [];
        }
    }

    async getEventsForEntity(entityName, role) {
        try {
            const q = query(
                collection(this.db, 'events'),
                where(role, '==', entityName),
                orderBy('dateReceived', 'desc'),
                limit(100) // Limit for performance
            );
            
            const snapshot = await getDocs(q);
            const events = [];
            
            snapshot.forEach(doc => {
                events.push(doc.data());
            });
            
            return events;
        } catch (error) {
            console.error(`Error getting events for ${role} ${entityName}:`, error);
            return [];
        }
    }

    analyzeCoOccurrences(targetEntity, events) {
        const coOccurrences = {};
        
        events.forEach(event => {
            const entities = new Set();
            
            // Extract all entities from the event
            if (event.actor && event.actor !== targetEntity) {
                const actors = event.actor.split(',').map(a => a.trim());
                actors.forEach(actor => entities.add(actor));
            }
            
            if (event.target && event.target.trim() !== '' && event.target !== targetEntity) {
                const targets = event.target.split(',').map(t => t.trim());
                targets.forEach(target => {
                    if (target.length > 0) {
                        entities.add(target);
                    }
                });
            }
            
            if (event.locations) {
                const locations = Array.isArray(event.locations) 
                    ? event.locations 
                    : event.locations.split(',').map(l => l.trim());
                locations.forEach(location => entities.add(location));
            }
            
            // Count co-occurrences
            entities.forEach(entityName => {
                if (entityName !== targetEntity && entityName.length > 0) {
                    if (!coOccurrences[entityName]) {
                        coOccurrences[entityName] = {
                            count: 0,
                            types: new Set(),
                            lastDate: null
                        };
                    }
                    
                    coOccurrences[entityName].count++;
                    coOccurrences[entityName].types.add(event.action);
                    
                    const eventDate = new Date(event.dateReceived);
                    if (!coOccurrences[entityName].lastDate || eventDate > coOccurrences[entityName].lastDate) {
                        coOccurrences[entityName].lastDate = eventDate;
                    }
                }
            });
        });
        
        // Convert Sets to Arrays for serialization
        Object.keys(coOccurrences).forEach(key => {
            coOccurrences[key].types = Array.from(coOccurrences[key].types);
        });
        
        return coOccurrences;
    }

    // Get connection statistics for an entity
    async getEntityConnectionStats(entityId, entityType) {
        const cacheKey = `stats_${entityId}`;
        
        if (this.entityConnectionCache.has(cacheKey)) {
            return this.entityConnectionCache.get(cacheKey);
        }

        try {
            // Get the entity document
            const entityQuery = query(
                collection(this.db, entityType),
                where('id', '==', entityId)
            );
            
            const entitySnapshot = await getDocs(entityQuery);
            if (entitySnapshot.empty) {
                return null;
            }
            
            const entity = entitySnapshot.docs[0].data();
            const entityName = entity.name;
            
            // Get all events involving this entity
            const [actorEvents, targetEvents] = await Promise.all([
                this.getEventsForEntity(entityName, 'actor'),
                this.getEventsForEntity(entityName, 'target')
            ]);
            
            const allEvents = [...actorEvents, ...targetEvents];
            
            // Analyze connection patterns
            const stats = {
                totalConnections: allEvents.length,
                asActor: actorEvents.length,
                asTarget: targetEvents.length,
                actionTypes: this.getActionTypeStats(allEvents),
                timelineStats: this.getTimelineStats(allEvents),
                topRelatedEntities: await this.getRelatedEntities(entityName, 5)
            };
            
            // Cache the result
            this.entityConnectionCache.set(cacheKey, stats);
            
            return stats;
        } catch (error) {
            console.error('Error getting entity connection stats:', error);
            return null;
        }
    }

    getActionTypeStats(events) {
        const actionCounts = {};
        
        events.forEach(event => {
            const action = event.action;
            actionCounts[action] = (actionCounts[action] || 0) + 1;
        });
        
        return Object.entries(actionCounts)
            .sort(([,a], [,b]) => b - a)
            .map(([action, count]) => ({ action, count }));
    }

    getTimelineStats(events) {
        if (events.length === 0) return null;
        
        const dates = events.map(e => new Date(e.dateReceived)).sort();
        const firstEvent = dates[0];
        const lastEvent = dates[dates.length - 1];
        
        // Group by month for timeline visualization
        const monthlyActivity = {};
        events.forEach(event => {
            const date = new Date(event.dateReceived);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyActivity[monthKey] = (monthlyActivity[monthKey] || 0) + 1;
        });
        
        return {
            firstEvent,
            lastEvent,
            totalDays: Math.ceil((lastEvent - firstEvent) / (1000 * 60 * 60 * 24)),
            monthlyActivity: Object.entries(monthlyActivity)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, count]) => ({ month, count }))
        };
    }

    // Clear caches
    clearCache() {
        this.relationshipCache.clear();
        this.entityConnectionCache.clear();
    }

    // Get cache statistics
    getCacheStats() {
        return {
            relationshipCacheSize: this.relationshipCache.size,
            entityConnectionCacheSize: this.entityConnectionCache.size
        };
    }
}
