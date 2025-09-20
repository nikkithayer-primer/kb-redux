// Wikidata API integration and entity resolution

export class WikidataService {
    constructor() {
        this.cache = new Map();
    }

    async searchWikidata(entityName) {
        // Clean the entity name before searching
        const cleanedName = this.cleanEntityName(entityName);
        
        // Check cache first (using original name as key)
        if (this.cache.has(entityName)) {
            return this.cache.get(entityName);
        }

        try {
            // Single search query - no variations for speed
            const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanedName)}&language=en&format=json&origin=*&limit=5`;
            
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // Reduced to 5 second timeout
            
            try {
                const response = await fetch(searchUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await response.json();
                
                if (data.search && data.search.length > 0) {
                    // Use the first result directly for speed
                    const firstMatch = data.search[0];
                    
                    // Get detailed entity data
                    const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${firstMatch.id}&format=json&origin=*`;
                    
                    const detailController = new AbortController();
                    const detailTimeoutId = setTimeout(() => detailController.abort(), 5000);
                    
                    try {
                        const detailResponse = await fetch(detailUrl, { signal: detailController.signal });
                        clearTimeout(detailTimeoutId);
                        const detailData = await detailResponse.json();
                        
                        if (detailData.entities && detailData.entities[firstMatch.id]) {
                            const result = await this.parseWikidataEntity(detailData.entities[firstMatch.id]);
                            this.cache.set(entityName, result);
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

            // Occupation (P106) - for people (handle all values)
            if (entity.claims.P106) {
                result.occupation = await this.resolveWikidataPropertyArray(entity.claims.P106);
            }

            // Aliases (P1449) - handle all values
            if (entity.claims.P1449) {
                result.aliases = await this.resolveWikidataPropertyArray(entity.claims.P1449);
            }

            // Languages spoken (P1412) - for people
            if (entity.claims.P1412) {
                result.languages_spoken = await this.resolveWikidataPropertyArray(entity.claims.P1412);
            }

            // Employer (P108) - for people
            if (entity.claims.P108) {
                result.employer = await this.resolveWikidataPropertyArray(entity.claims.P108);
            }

            // Educated at (P69) - for people
            if (entity.claims.P69) {
                result.educated_at = await this.resolveWikidataPropertyArray(entity.claims.P69);
            }

            // Residence (P551) - for people
            if (entity.claims.P551) {
                result.residences = await this.resolveWikidataPropertyArray(entity.claims.P551);
            }

            // Member of (P463) - for people/organizations
            if (entity.claims.P463) {
                result.member_of = await this.resolveWikidataPropertyArray(entity.claims.P463);
            }

            // Family relationships
            const familyRelations = {};
            
            // Father (P22)
            if (entity.claims.P22) {
                familyRelations.father = await this.resolveWikidataPropertyArray(entity.claims.P22);
            }
            
            // Mother (P25)
            if (entity.claims.P25) {
                familyRelations.mother = await this.resolveWikidataPropertyArray(entity.claims.P25);
            }
            
            // Spouse (P26)
            if (entity.claims.P26) {
                familyRelations.spouse = await this.resolveWikidataPropertyArray(entity.claims.P26);
            }
            
            // Child (P40)
            if (entity.claims.P40) {
                familyRelations.children = await this.resolveWikidataPropertyArray(entity.claims.P40);
            }
            
            // Sibling (P3373)
            if (entity.claims.P3373) {
                familyRelations.siblings = await this.resolveWikidataPropertyArray(entity.claims.P3373);
            }
            
            // Parent (P8810) - general parent property
            if (entity.claims.P8810) {
                familyRelations.parents = await this.resolveWikidataPropertyArray(entity.claims.P8810);
            }
            
            // Relative (P1038) - general relative property
            if (entity.claims.P1038) {
                familyRelations.relatives = await this.resolveWikidataPropertyArray(entity.claims.P1038);
            }

            // Only add family_relations if there are any relationships
            if (Object.keys(familyRelations).length > 0) {
                result.family_relations = familyRelations;
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

    async resolveWikidataPropertyArray(claims) {
        try {
            // Limit to first 10 items to avoid excessive API calls
            const limitedClaims = claims.slice(0, 10);
            const results = await Promise.all(
                limitedClaims.map(claim => this.resolveWikidataProperty(claim))
            );
            
            // Filter out null/undefined values and return unique values
            const validResults = results.filter(result => result != null && result !== '');
            return [...new Set(validResults)];
        } catch (error) {
            console.warn('Error resolving Wikidata property array:', error);
            return [];
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
