# Backend Indexer JSON Edition

A comprehensive system for extracting structured JSON data from Bubble.io backend workflows, replacing screenshot capture with detailed data extraction for RAG applications.

## Purpose

This version focuses on:
- Extracting complete workflow data in structured JSON format with `wf_item` identifiers
- Capturing detailed workflow steps, actions, and parameters from the properties panel
- Building comprehensive JSON databases with cross-workflow dependency tracking
- Version control with SHA-256 hashing for weekly change detection
- API-first approach for workflow metadata extraction and analysis

## Key Differences from Original

- **JSON-First**: All data extracted and stored in JSON format
- **Dropdown Navigation**: Uses the workflow dropdown menu to systematically capture all steps
- **Structured Data**: Focus on extracting structured metadata rather than screenshots
- **API Integration Ready**: Designed for easy integration with other tools via JSON

## Installation

```bash
npm install
```

## Configuration

1. Set up Google Drive credentials (optional):
   ```bash
   cd push-to-gdrive
   # Add your credentials.json file
   ```

2. Configure browser profile:
   - Browser profile data is stored in `browser-profiles/default`

## Usage

### Extract Workflow JSON Data (NEW)
```bash
# Extract first 5 workflows (quick test)
npm run capture-json

# Extract specific number of workflows
MAX_WORKFLOWS=10 npm run capture-json

# Test extraction with 2 workflows
npm run test-json
```

### Legacy Screenshot Capture
```bash
npm run capture
```

### Upload to Google Drive
```bash
npm run upload
```

## Project Structure

```
backend-indexer-json/
├── capture-workflows-json.js  # Main JSON extraction script (NEW)
├── test-json-extraction.js    # Test suite for JSON extraction (NEW)
├── lib/                        # Core extraction modules (NEW)
│   ├── workflow-parser.js     # Workflow metadata extraction
│   ├── step-extractor.js      # Step and action extraction
│   ├── parameter-extractor.js # Parameter extraction
│   ├── hash-generator.js      # Version control hashing
│   ├── diff-engine.js         # Snapshot comparison
│   └── dependency-analyzer.js # Cross-workflow dependencies
├── capture-*.js               # Legacy capture scripts
├── state-manager/             # State management utilities
├── push-to-gdrive/            # Google Drive integration
├── workflow-data/             # JSON output directory
├── snapshots/                 # Weekly snapshots (NEW)
├── dependencies/              # Dependency graphs (NEW)
├── changes/                   # Change tracking (NEW)
└── browser-profiles/          # Browser profile storage
```

## Data Format

Workflows are captured in the following JSON structure:

```json
{
  "workflow_id": "string",
  "workflow_name": "string",
  "steps": [
    {
      "step_number": 1,
      "action_type": "string",
      "action_details": {},
      "timestamp": "ISO 8601"
    }
  ],
  "metadata": {
    "captured_at": "ISO 8601",
    "version": "string"
  }
}
```

## Development Status

This is a specialized fork focusing on JSON data extraction from Bubble.io backend workflows.

## License

MIT