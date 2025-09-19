# Knowledge Base Redux

A minimalist web application that processes CSV data to build an interactive knowledge graph with Firebase backend integration.

## Features

- **CSV Upload & Processing**: Upload CSV files with Actor, Action, Target, Sentence, Date Received, Locations, and Datetimes columns
- **Intelligent Entity Recognition**: Automatically identifies people, organizations, and places from CSV data
- **Wikidata Integration**: Looks up entities in Wikidata to enrich profiles with additional information
- **Datetime Processing**: Resolves relative time expressions (e.g., "yesterday", "2 days ago") against the Date Received
- **Location Classification**: Categorizes locations as cities, states, countries, islands, regions, borders, etc.
- **Interactive Visualizations**: 
  - D3.js network graphs showing entity connections
  - Leaflet maps displaying event locations
- **Firebase Backend**: Stores all data in Firestore for persistence and synchronization
- **Entity Profiles**: Detailed pages for each entity with editing capabilities
- **Entity Merging**: Ability to merge duplicate entities and update Wikidata associations

## Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd knowledge-base-redux
   ```

2. **Firebase Configuration**
   - The app is already configured to use Firebase (config.js contains the configuration)
   - Make sure the Firebase project is set up with Firestore enabled

3. **Start the development server**
   ```bash
   # Using Python (recommended)
   python3 -m http.server 8000
   
   # Or using npm
   npm run dev
   ```

4. **Open the application**
   - Navigate to `http://localhost:8000` in your web browser

## CSV Format

The application expects CSV files with the following columns:

- **Actor**: The entity performing the action (can be comma-separated for multiple actors)
- **Action**: The action being performed
- **Target**: The entity being acted upon (can be comma-separated for multiple targets)
- **Sentence**: A descriptive sentence about the event
- **Date Received**: ISO timestamp when the data was received
- **Locations**: Location(s) where the event occurred (can be comma-separated)
- **Datetimes**: When the event occurred (supports relative terms like "yesterday")

### Example CSV Row:
```csv
Actor,Action,Target,Sentence,Date Received,Locations,Datetimes
"Donald Trump","criticized","Joe Biden","Donald Trump criticized Joe Biden during a press conference.","2025-09-18T05:45:26+00:00","Washington,DC","yesterday"
```

## Data Processing

### Entity Recognition
- **People**: Identified by name patterns and Wikidata classification
- **Organizations**: Companies, institutions, government agencies
- **Places**: Cities, states, countries, geographic features

### Location Classification
The system automatically classifies locations into categories:
- Cities (e.g., "New York", "Los Angeles")
- States/Provinces (e.g., "California", "Texas")
- Countries (e.g., "United States", "Canada")
- Islands (e.g., "Hawaii", "Manhattan")
- Regions (e.g., "Middle East", "Pacific Northwest")
- Geographic features (mountains, rivers, etc.)

### Datetime Processing
Relative time expressions are resolved against the "Date Received":
- "yesterday" → Date Received - 1 day
- "today" → Date Received
- "tomorrow" → Date Received + 1 day
- "3 days ago" → Date Received - 3 days

## Usage

1. **Upload CSV**: Drag and drop or select a CSV file using the upload interface
2. **Process Data**: Click "Process Data" to parse the CSV and enrich entities with Wikidata
3. **Browse Entities**: View the automatically created knowledge base entities
4. **Explore Profiles**: Click on any entity to view its detailed profile page with:
   - Connection network visualization
   - Event location map
   - Editable entity information
   - Related events and connections

## Technology Stack

- **Frontend**: Vanilla JavaScript (ES6 modules), HTML5, CSS3
- **Backend**: Firebase Firestore
- **Visualizations**: 
  - D3.js for network graphs
  - Leaflet.js for maps
- **APIs**: Wikidata Query Service for entity enrichment
- **Styling**: Modern CSS with flexbox and grid layouts

## File Structure

```
knowledge-base-redux/
├── index.html              # Main application page
├── profile.html            # Entity profile page
├── app.js                  # Main application logic
├── profile.js              # Profile page functionality
├── config.js               # Firebase configuration
├── knowledgeBaseData.js    # Sample data structure
├── package.json            # Project configuration
└── README.md              # This file
```

## API Integration

### Wikidata
The application integrates with Wikidata to:
- Search for entities by name
- Retrieve detailed entity information
- Extract structured data (coordinates, dates, relationships)
- Populate entity profiles automatically

### Firebase Firestore Collections
- `people`: Person entities
- `organizations`: Organization entities  
- `places`: Location entities
- `events`: Processed events from CSV data

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
