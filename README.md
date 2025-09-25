# Bubble.io Backend Workflow Extractor

A comprehensive system for extracting, indexing, and analyzing Bubble.io backend workflows with multiple extraction methods and Google Drive integration.

## Overview

This project provides automated tools to extract backend workflow data from Bubble.io applications, supporting both JSON data extraction and screenshot capture. It features dropdown-based navigation for comprehensive workflow step extraction with unique `wf_item` identifiers.

## Features

- **Multiple Extraction Methods**:
  - Dropdown-based extraction with comprehensive step details
  - Advanced JSON extraction with property panel analysis
  - Legacy screenshot capture for visual documentation

- **Comprehensive Data Capture**:
  - Workflow metadata and configuration
  - Step-by-step action details
  - Parameter extraction from properties panel
  - Cross-workflow dependencies
  - Conditional logic analysis

- **Version Control & Change Tracking**:
  - SHA-256 hashing for content versioning
  - Weekly snapshot comparisons
  - Diff engine for change detection

- **Google Drive Integration**:
  - OAuth2 authentication
  - Automated upload to specified folders
  - Batch upload support

## Prerequisites

- Node.js v14+ and npm
- Python 3.7+ (for Google Drive integration)
- Chrome browser installed
- Bubble.io account with backend access

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd backend-indexer-json
```

### 2. Install Node.js Dependencies

```bash
npm install
```

### 3. Install Python Dependencies (for Google Drive)

```bash
pip install -r requirements.txt
```

### 4. Set Up Browser Profile

The system uses a persistent Chrome profile to maintain login sessions:

```bash
# Profile will be created automatically at:
# browser-profiles/default/
```

First run will require manual login to Bubble.io.

### 5. Configure Google Drive (Optional)

```bash
cd push-to-gdrive

# Copy environment template
cp .env.example .env

# Edit .env and set your folder ID
# GOOGLE_DRIVE_DEFAULT_FOLDER_ID=your_folder_id_here

# Place your OAuth credentials file
# Download from Google Cloud Console as credentials.json

# Authenticate with Google Drive
python main.py auth
```

## Usage

### Quick Start (Windows)

#### Option 1: Double-Click Extraction
Simply double-click `EXTRACT-WORKFLOWS.bat` to run full extraction with GitHub upload.

#### Option 2: Control Panel (Interactive Menu)
Run `extraction-control-panel.bat` for an interactive menu with multiple options:
- Full extraction with GitHub upload
- Test extraction (2 workflows only)
- Test GitHub integration
- Check previous extraction results
- Install/update dependencies

#### Option 3: PowerShell (Advanced)
```powershell
# Run with menu
.\run-extraction.ps1

# Direct execution
.\run-extraction.ps1 -Mode full              # Full extraction
.\run-extraction.ps1 -Mode test              # Test extraction
.\run-extraction.ps1 -Mode full -MaxWorkflows 10  # Limited extraction
.\run-extraction.ps1 -Mode full -SkipGitHub  # Skip GitHub upload
```

### Command Line Usage

Extract workflows using the dropdown navigation method:

```bash
# Extract default set of workflows
node extract-workflow-dropdown.js

# Extract specific number
MAX_WORKFLOWS=10 node extract-workflow-dropdown.js

# Start from specific index
START_INDEX=5 MAX_WORKFLOWS=10 node extract-workflow-dropdown.js

# Test mode (2 workflows)
node test-dropdown-extraction.js
```


### Upload to Google Drive

```bash
# Upload latest extraction
cd push-to-gdrive
python main.py upload ../extracted-workflows-dropdown/latest

# Upload specific folder
python upload_to_subfolder.py --folder-path ../workflow-data
```

## Output Structure

```
backend-indexer-json/
├── extracted-workflows-dropdown/    # Dropdown extraction output
│   └── 2025-09-24_00-24-15/
│       ├── workflows.json           # All workflows data
│       ├── summary.json             # Extraction summary
│       └── individual/              # Per-workflow files
├── workflow-data/                   # Legacy extraction output
├── snapshots/                       # Weekly snapshots
├── dependencies/                    # Dependency graphs
└── changes/                         # Change tracking
```

## JSON Data Structure

### Workflow Object

```json
{
  "workflow_id": "wf_core_example",
  "wf_item": "unique_id",
  "name": "Workflow Name",
  "metadata": {
    "endpoint": "api_endpoint",
    "trigger": {
      "type": "api_event",
      "method": "POST"
    },
    "exposed_as_public_api_workflow": "Y/N"
  },
  "steps": [
    {
      "wf_item": "step_unique_id",
      "order": 1,
      "title": "Step Title",
      "action": "action_type",
      "parameters": {},
      "condition": {}
    }
  ]
}
```

## Scripts Reference

### Main Extraction Scripts

- `extract-workflow-dropdown.js` - Primary dropdown-based extractor (CURRENT)
- `test-dropdown-extraction.js` - Test suite for dropdown extraction

### Library Modules

- `lib/workflow-parser.js` - Parses workflow metadata
- `lib/step-extractor.js` - Extracts step details
- `lib/parameter-extractor.js` - Extracts parameters from UI
- `lib/hash-generator.js` - Generates content hashes
- `lib/diff-engine.js` - Compares snapshots
- `lib/dependency-analyzer.js` - Analyzes workflow dependencies

### Utility Scripts

- `state-manager/StateManager.js` - Manages extraction state
- `config/browser-config.js` - Browser configuration
- `debug-element-content.js` - Debug tool for UI analysis

### Google Drive Integration

- `push-to-gdrive/main.py` - Main CLI for Google Drive
- `push-to-gdrive/auth_flow.py` - OAuth authentication
- `push-to-gdrive/google_drive_uploader.py` - Upload handler
- `push-to-gdrive/upload_to_subfolder.py` - Subfolder uploads

## Configuration

### Browser Configuration

Edit `config/browser-config.js`:

```javascript
{
  profilePath: './browser-profiles/default',
  launchOptions: {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1920, height: 1080 }
  },
  urls: {
    baseUrl: 'your_bubble_app_url'
  }
}
```

### Environment Variables

```bash
# Extraction settings
MAX_WORKFLOWS=10        # Number of workflows to extract
START_INDEX=0          # Starting workflow index
BATCH_SIZE=5          # Batch processing size

# Google Drive
GOOGLE_DRIVE_DEFAULT_FOLDER_ID=folder_id
OAUTH_PORT=8080
```

## Troubleshooting

### Common Issues

1. **Browser Won't Launch**
   - Ensure Chrome is installed
   - Check browser profile path exists
   - Try deleting profile and re-authenticating

2. **Workflow Not Loading**
   - Verify Bubble.io authentication
   - Check URL format in config
   - Increase timeout values

3. **Properties Panel Missing**
   - Wait for full page load
   - Check for UI changes in Bubble editor
   - Try manual navigation first

4. **Google Drive Auth Failed**
   - Verify credentials.json exists
   - Check OAuth consent screen configuration
   - Ensure correct scopes are requested

### Debug Mode

```bash
# Enable verbose logging
DEBUG=true node extract-workflow-dropdown.js

# Test single workflow
MAX_WORKFLOWS=1 node extract-workflow-dropdown.js

# Check element selectors
node debug-element-content.js
```

## Performance

- **Extraction Speed**: ~10-15 seconds per workflow
- **Memory Usage**: ~200MB for typical session
- **Storage**: ~100KB per workflow JSON
- **Batch Processing**: 5-10 workflows per batch recommended

## Best Practices

1. **Regular Snapshots**: Run weekly for change tracking
2. **Incremental Extraction**: Use START_INDEX for large sets
3. **Validation**: Always run test extraction first
4. **Backup**: Keep multiple snapshot versions
5. **Monitoring**: Check summary.json for completeness

## Development

### Running Tests

```bash
# Test dropdown extraction
node test-dropdown-extraction.js

# Test specific workflow
WORKFLOW_ID=specific_id node test-dropdown-extraction.js
```

### Adding New Extractors

1. Create new extractor in project root
2. Import required libraries from `lib/`
3. Use `browser-config.js` for browser setup
4. Follow existing patterns for data structure

## Security Notes

- Never commit `credentials.json` or `token.json`
- Keep `.env` files out of version control
- Browser profiles contain session data - exclude from git
- Use read-only Google Drive scopes when possible

## License

MIT

## Support

For issues or questions:
1. Check troubleshooting guide above
2. Review existing scripts in `Deprecated/` for alternatives
3. Create an issue with error logs and configuration

## Changelog

See `ROLLBACK_POINTS.md` for version history and important commits.