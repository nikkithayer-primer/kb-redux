// Wikidata API integration and entity resolution

export class WikidataService {
    constructor() {
        this.cache = new Map();
    }

    async searchWikidata(entityName) {
        // Check cache first
        if (this.cache.has(entityName)) {
            return this.cache.get(entityName);
        }

        try {
            // Try multiple search variations for better matching
            const searchVariations = this.generateSearchVariations(entityName);
            
            for (const searchQuery of searchVariations) {
                const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchQuery)}&language=en&format=json&origin=*&limit=10`;
                const response = await fetch(searchUrl);
                const data = await response.json();
                
                if (data.search && data.search.length > 0) {
                    // Try to find the best match by checking aliases
                    const bestMatch = await this.findBestWikidataMatch(data.search, entityName);
                    
                    if (bestMatch) {
                        // Get detailed entity data
                        const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${bestMatch.id}&format=json&origin=*`;
                        const detailResponse = await fetch(detailUrl);
                        const detailData = await detailResponse.json();
                        
                        if (detailData.entities && detailData.entities[bestMatch.id]) {
                            const result = await this.parseWikidataEntity(detailData.entities[bestMatch.id]);
                            this.cache.set(entityName, result);
                            return result;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('Wikidata search failed:', error);
        }
        
        this.cache.set(entityName, null);
        return null;
    }

    generateSearchVariations(query) {
        const variations = [query];
        const lowerQuery = query.toLowerCase().trim();
        
        // Remove common prefixes and articles
        const prefixesToRemove = ['the ', 'a ', 'an '];
        for (const prefix of prefixesToRemove) {
            if (lowerQuery.startsWith(prefix)) {
                const withoutPrefix = query.substring(prefix.length).trim();
                if (withoutPrefix.length > 0) {
                    variations.push(withoutPrefix);
                }
            }
        }
        
        // Add version with "the" if it doesn't already have it
        if (!lowerQuery.startsWith('the ')) {
            variations.push(`the ${query}`);
        }
        
        // Remove punctuation variations
        const noPunctuation = query.replace(/[.,!?;:'"()-]/g, '').trim();
        if (noPunctuation !== query && noPunctuation.length > 0) {
            variations.push(noPunctuation);
        }
        
        // Remove duplicates and return
        return [...new Set(variations)];
    }

    async findBestWikidataMatch(searchResults, originalQuery) {
        const originalLower = originalQuery.toLowerCase().trim();
        
        // First, try exact matches on label or description
        for (const result of searchResults) {
            const labelLower = result.label?.toLowerCase() || '';
            
            if (labelLower === originalLower) {
                return result;
            }
        }
        
        // Then check aliases by fetching full entity data for top results
        for (const result of searchResults.slice(0, 5)) { // Check top 5 results
            try {
                const entityResponse = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${result.id}&format=json&origin=*&props=aliases|labels`);
                const entityData = await entityResponse.json();
                
                if (entityData.entities && entityData.entities[result.id]) {
                    const entity = entityData.entities[result.id];
                    
                    // Check aliases (Also known as)
                    if (entity.aliases && entity.aliases.en) {
                        for (const alias of entity.aliases.en) {
                            if (alias.value.toLowerCase() === originalLower) {
                                console.log(`Found exact alias match for "${originalQuery}": ${result.label} (${result.id})`);
                                return result;
                            }
                        }
                    }
                    
                    // Check for partial matches with common variations
                    const searchVariations = this.generateSearchVariations(originalQuery);
                    for (const variation of searchVariations) {
                        const variationLower = variation.toLowerCase();
                        
                        // Check against label
                        if (entity.labels?.en?.value?.toLowerCase() === variationLower) {
                            console.log(`Found label match for "${originalQuery}" -> "${variation}": ${result.label} (${result.id})`);
                            return result;
                        }
                        
                        // Check against aliases
                        if (entity.aliases && entity.aliases.en) {
                            for (const alias of entity.aliases.en) {
                                if (alias.value.toLowerCase() === variationLower) {
                                    console.log(`Found alias match for "${originalQuery}" -> "${variation}": ${result.label} (${result.id})`);
                                    return result;
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn(`Error checking aliases for ${result.id}:`, error);
                continue;
            }
        }
        
        // If no exact match found, return the first result
        console.log(`Using first search result for "${originalQuery}": ${searchResults[0].label} (${searchResults[0].id})`);
        return searchResults[0];
    }

    async parseWikidataEntity(entity) {
        const result = {
            id: entity.id,
            description: entity.descriptions?.en?.value || '',
            labels: entity.labels?.en?.value || '',
        };

        if (entity.claims) {
            // Instance of (P31)
            if (entity.claims.P31) {
                result.instance_of = await this.resolveWikidataProperty(entity.claims.P31[0]);
            }

            // Occupation (P106) - for people
            if (entity.claims.P106) {
                result.occupation = await this.resolveWikidataProperty(entity.claims.P106[0]);
            }

            // Country (P17) - for places
            if (entity.claims.P17) {
                result.country = await this.resolveWikidataProperty(entity.claims.P17[0]);
            }

            // Coordinates (P625) - for places
            if (entity.claims.P625) {
                const coords = entity.claims.P625[0];
                if (coords.mainsnak.datavalue) {
                    result.coordinates = {
                        lat: coords.mainsnak.datavalue.value.latitude,
                        lng: coords.mainsnak.datavalue.value.longitude
                    };
                }
            }

            // Population (P1082) - for places
            if (entity.claims.P1082) {
                const population = this.extractClaimValue(entity.claims.P1082[0]);
                if (population) {
                    result.population = parseInt(population.replace(/^\+/, ''));
                }
            }

            // Date of birth (P569) - for people
            if (entity.claims.P569) {
                result.dateOfBirth = this.extractClaimValue(entity.claims.P569[0]);
            }

            // Founded date (P571) - for organizations
            if (entity.claims.P571) {
                result.founded = this.extractClaimValue(entity.claims.P571[0]);
            }
        }

        return result;
    }

    async resolveWikidataProperty(claim) {
        try {
            const value = this.extractClaimValue(claim);
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
}
