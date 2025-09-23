// CSV parsing and file handling functionality

export class CSVParser {
    constructor() {
        this.rawData = null;
    }

    async parseFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const csv = e.target.result;
                    const rows = this.parseCSV(csv);
                    this.rawData = rows;
                    resolve(rows);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseCSV(csv) {
        const lines = csv.split('\n');
        const headers = this.parseCSVLine(lines[0]);
        const rows = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const values = this.parseCSVLine(line);
                const row = {};
                headers.forEach((header, index) => {
                    row[header] = values[index] || '';
                });
                rows.push(row);
            }
        }

        return rows;
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        let i = 0;

        while (i < line.length) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"' && !inQuotes) {
                inQuotes = true;
            } else if (char === '"' && inQuotes) {
                if (nextChar === '"') {
                    current += '"';
                    i++; // Skip next quote
                } else {
                    inQuotes = false;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
            i++;
        }

        result.push(current.trim());
        return result;
    }

    parseEntities(entityString) {
        if (!entityString || entityString.trim() === '') return [];
        
        // First split by conjunctions (and, &, plus)
        const conjunctionPattern = /\s+(?:and|&|\+)\s+/i;
        const conjunctionParts = entityString.split(conjunctionPattern);
        
        if (conjunctionParts.length > 1) {
            // Multiple entities connected by conjunctions
            const splitEntities = [];
            
            for (const part of conjunctionParts) {
                // For each part, also check for comma-separated entities
                const commaSplit = this.parseCommaSeparatedEntities(part.trim());
                splitEntities.push(...commaSplit);
            }
            
            return splitEntities;
        }
        
        // No conjunctions found, just parse comma-separated entities
        return this.parseCommaSeparatedEntities(entityString);
    }

    parseCommaSeparatedEntities(entityString) {
        if (!entityString || entityString.trim() === '') return [];
        
        // Handle comma-separated entities, being careful with locations like "Washington, D.C."
        const entities = [];
        const parts = entityString.split(',');
        let current = '';
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            current += (current ? ', ' : '') + part;
            
            // Check if this looks like a complete entity
            // Simple heuristic: if the next part starts with a capital letter and current doesn't end with common abbreviations
            if (i === parts.length - 1 || 
                (parts[i + 1] && parts[i + 1].trim().match(/^[A-Z]/) && 
                 !current.match(/\b(D\.C\.|U\.S\.|U\.K\.|St\.|Dr\.|Mr\.|Mrs\.|Ms\.)$/))) {
                entities.push(current.trim());
                current = '';
            }
        }
        
        return entities.filter(e => e.length > 0);
    }

    parseLocations(locationString) {
        const entities = this.parseEntities(locationString);
        return entities.map(location => ({
            name: location,
            category: this.classifyLocation(location)
        }));
    }

    parseSources(sourceString) {
        if (!sourceString || sourceString.trim() === '') return [];
        
        // Parse sources similar to entities, but return as simple array
        const sources = this.parseEntities(sourceString);
        return sources.filter(source => source && source.trim() !== '');
    }

    classifyLocation(locationName) {
        const name = locationName.toLowerCase();
        
        // Countries
        const commonCountries = [
            'united states', 'usa', 'america', 'canada', 'mexico', 'brazil', 'argentina',
            'united kingdom', 'uk', 'england', 'france', 'germany', 'italy', 'spain',
            'russia', 'china', 'japan', 'india', 'australia', 'south africa'
        ];
        
        if (commonCountries.includes(name)) {
            return 'country';
        }
        
        // States/Provinces
        if (name.includes('state') || name.includes('province') || 
            name.match(/\b(california|texas|florida|new york|illinois|pennsylvania|ohio|georgia|north carolina|michigan)\b/)) {
            return 'state';
        }
        
        // Cities
        if (name.includes('city') || name.includes('town') || 
            name.match(/\b(new york|los angeles|chicago|houston|philadelphia|phoenix|san antonio|san diego|dallas|san jose)\b/)) {
            return 'city';
        }
        
        // Default to place
        return 'place';
    }
}
