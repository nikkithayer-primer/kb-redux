# JavaScript Modules Documentation

This directory contains the refactored JavaScript code organized into modular, action-specific files.

## Module Overview

### Core Modules

#### `config.js`
- **Purpose**: Firebase configuration and initialization
- **Exports**: `db`, `app`
- **Dependencies**: Firebase SDK

#### `csv-parser.js`
- **Purpose**: CSV file parsing and entity extraction
- **Exports**: `CSVParser` class
- **Key Methods**:
  - `parseFile(file)` - Parse CSV file into structured data
  - `parseEntities(entityString)` - Extract entities from comma-separated strings
  - `parseLocations(locationString)` - Parse and classify locations
  - `classifyLocation(locationName)` - Classify location types

#### `wikidata-service.js`
- **Purpose**: Wikidata API integration and entity resolution
- **Exports**: `WikidataService` class
- **Key Methods**:
  - `searchWikidata(entityName)` - Search and resolve entities
  - `generateSearchVariations(query)` - Create flexible search terms
  - `findBestWikidataMatch()` - Find best match with alias checking
  - `parseWikidataEntity()` - Extract structured data from Wikidata

#### `datetime-processor.js`
- **Purpose**: Date and time processing utilities
- **Exports**: `DateTimeProcessor` class
- **Key Methods**:
  - `processDateTime(datetimeString, dateReceived)` - Process relative dates
  - `formatDate(date)` - Format dates for display
  - `isSameDay(date1, date2)` - Compare dates

#### `firebase-service.js`
- **Purpose**: Firebase database operations
- **Exports**: `FirebaseService` class
- **Key Methods**:
  - `saveOrUpdateEntity()` - Save or update entities
  - `findEntityInFirebase()` - Search for existing entities
  - `findDuplicateEvent()` - Check for duplicate events
  - `loadExistingData()` - Load all existing data

#### `entity-processor.js`
- **Purpose**: Entity processing and relationship management
- **Exports**: `EntityProcessor` class
- **Key Methods**:
  - `processEntity()` - Process and create entities
  - `findExistingEntity()` - Find entities in current session
  - `createNewEntity()` - Create new entities with Wikidata lookup
  - `connectionExists()` - Check for duplicate connections

#### `table-manager.js`
- **Purpose**: Table rendering and management
- **Exports**: `TableManager` class
- **Key Methods**:
  - `filterEntities()` - Apply filters and search
  - `sortEntities()` - Handle column sorting
  - `renderTable()` - Render entity table
  - `createTableRow()` - Create individual table rows

#### `knowledge-base-app.js`
- **Purpose**: Main application orchestrator
- **Exports**: `KnowledgeBaseApp` class
- **Dependencies**: All other modules
- **Key Methods**:
  - `processData()` - Main data processing pipeline
  - `processRow()` - Process individual CSV rows
  - `saveToFirebase()` - Save all processed data
  - `loadExistingData()` - Load existing data on startup

## Architecture Benefits

### Separation of Concerns
- Each module has a single, well-defined responsibility
- Easier to test and maintain individual components
- Cleaner code organization

### Modularity
- Easy to add new features by creating new modules
- Modules can be reused in other parts of the application
- Dependencies are explicit and manageable

### Maintainability
- Smaller files are easier to understand and modify
- Changes to one module don't affect others
- Better code reusability

### Testability
- Each module can be tested independently
- Easier to mock dependencies for unit testing
- Clear interfaces between modules

## Usage

The application is initialized in `app-new.js`:

```javascript
import { KnowledgeBaseApp } from './js/knowledge-base-app.js';

document.addEventListener('DOMContentLoaded', () => {
    window.app = new KnowledgeBaseApp();
});
```

## Migration Notes

The original monolithic `app.js` has been broken down into these focused modules. The functionality remains the same, but the code is now:

- More organized and easier to navigate
- Better separated by concern
- Easier to extend and maintain
- More testable

## File Structure

```
js/
├── README.md                 # This documentation
├── config.js                # Firebase configuration
├── csv-parser.js            # CSV parsing utilities
├── wikidata-service.js      # Wikidata API integration
├── datetime-processor.js    # Date/time processing
├── firebase-service.js      # Firebase operations
├── entity-processor.js      # Entity management
├── table-manager.js         # Table rendering
└── knowledge-base-app.js    # Main application class
```
