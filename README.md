# Backend Indexer JSON Edition

A fork of the backend-indexer project focused on JSON-based data extraction and structured workflow analysis.

## Purpose

This version focuses on:
- Extracting workflow data in structured JSON format
- Capturing detailed workflow step information via dropdown navigation
- Building comprehensive JSON databases of workflow structures
- API-first approach for workflow metadata extraction

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

### Capture Workflow JSON Data
```bash
npm run capture-json
```

### Upload to Google Drive
```bash
npm run upload
```

## Project Structure

```
backend-indexer-json/
├── capture-*.js           # Various capture scripts
├── state-manager/         # State management utilities
├── push-to-gdrive/        # Google Drive integration
├── workflow-data/         # JSON output directory
└── browser-profiles/      # Browser profile storage
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