// Wikidata API integration and entity resolution

export class WikidataService {
    constructor() {
        this.cache = new Map();
    }

    async searchWikidata(entityName) {
        console.log('WikidataService: Searching for', entityName);
        
        // Clean the entity name before searching
        const cleanedName = this.cleanEntityName(entityName);
        console.log('WikidataService: Cleaned name:', cleanedName);
        
        // Check cache first (using original name as key)
        if (this.cache.has(entityName)) {
            console.log('WikidataService: Found in cache');
            return this.cache.get(entityName);
        }

        try {
            // Single search query - no variations for speed
            console.log('WikidataService: Searching for:', cleanedName);
            const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanedName)}&language=en&format=json&origin=*&limit=5`;
            
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // Reduced to 5 second timeout
            
            try {
                const response = await fetch(searchUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await response.json();
                console.log('WikidataService: Search response received');
                
                if (data.search && data.search.length > 0) {
                    console.log('WikidataService: Found search results, using first match');
                    // Use the first result directly for speed
                    const firstMatch = data.search[0];
                    
                    console.log('WikidataService: Getting details for first match...');
                    // Get detailed entity data
                    const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${firstMatch.id}&format=json&origin=*`;
                    
                    const detailController = new AbortController();
                    const detailTimeoutId = setTimeout(() => detailController.abort(), 5000);
                    
                    try {
                        const detailResponse = await fetch(detailUrl, { signal: detailController.signal });
                        clearTimeout(detailTimeoutId);
                        const detailData = await detailResponse.json();
                        
                        if (detailData.entities && detailData.entities[firstMatch.id]) {
                            console.log('WikidataService: Parsing entity data...');
                            const result = await this.parseWikidataEntity(detailData.entities[firstMatch.id]);
                            this.cache.set(entityName, result);
                            console.log('WikidataService: Successfully processed', entityName);
                            return result;
                        }
                    } catch (detailError) {
                        clearTimeout(detailTimeoutId);
                        console.warn('WikidataService: Detail fetch failed:', detailError);
                    }
                }
            } catch (searchError) {
                clearTimeout(timeoutId);
                console.warn('WikidataService: Search fetch failed:', searchError);
            }
        } catch (error) {
            console.warn('Wikidata search failed:', error);
        }
        
        console.log('WikidataService: No results found for', entityName);
        this.cache.set(entityName, null);
        return null;
    }

    cleanEntityName(entityName) {
        if (!entityName || typeof entityName !== 'string') {
            return entityName;
        }
        
        let cleaned = entityName.trim();
        
        // Remove leading articles (case-insensitive)
        const articlesToRemove = ['the ', 'a ', 'an '];
        const lowerCleaned = cleaned.toLowerCase();
        
        for (const article of articlesToRemove) {
            if (lowerCleaned.startsWith(article)) {
                cleaned = cleaned.substring(article.length).trim();
                break; // Only remove the first matching article
            }
        }
        
        // Additional cleaning: remove extra whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        
        // Return original if cleaning resulted in empty string
        return cleaned.length > 0 ? cleaned : entityName;
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
        
        
        // Remove punctuation variations
        const noPunctuation = query.replace(/[.,!?;:'"()-]/g, '').trim();
        if (noPunctuation !== query && noPunctuation.length > 0) {
            variations.push(noPunctuation);
        }
        
        // Remove duplicates and return
        return [...new Set(variations)];
    }

    async findBestWikidataMatch(searchResults, originalQuery) {
        // For speed, just return the first result
        if (searchResults && searchResults.length > 0) {
            console.log(`Using first search result for "${originalQuery}": ${searchResults[0].label} (${searchResults[0].id})`);
            return searchResults[0];
        }
        return null;
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
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                try {
                    const response = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${value}&format=json&origin=*&props=labels`, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    const data = await response.json();
                    if (data.entities && data.entities[value] && data.entities[value].labels && data.entities[value].labels.en) {
                        return data.entities[value].labels.en.value;
                    }
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    console.warn('Error fetching Wikidata property:', fetchError);
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
