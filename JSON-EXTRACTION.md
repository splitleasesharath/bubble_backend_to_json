# JSON Workflow Extraction System

## Overview

This system extracts structured JSON data from Bubble.io backend workflows, replacing screenshot capture with comprehensive data extraction. It captures workflow metadata, steps, actions, parameters, and cross-workflow dependencies for RAG (Retrieval Augmented Generation) use cases.

## Features

- **Complete Workflow Extraction**: Captures all workflow metadata, steps, and parameters
- **Unique Identifiers**: Uses `wf_item` as primary key for workflows and steps
- **Dependency Analysis**: Identifies and tracks cross-workflow calls and dependencies
- **Version Control**: SHA-256 hashing for change detection
- **Diff Engine**: Compares weekly snapshots to track changes
- **JSON Output**: Structured data ready for database storage and RAG processing

## Installation

```bash
# Install dependencies (if not already installed)
npm install

# Verify installation
node test-json-extraction.js
```

## Usage

### Basic Extraction

```bash
# Extract first 5 workflows (default)
node capture-workflows-json.js

# Extract specific number of workflows
MAX_WORKFLOWS=10 node capture-workflows-json.js

# Extract all workflows
MAX_WORKFLOWS=0 node capture-workflows-json.js

# Start from specific index
START_INDEX=50 MAX_WORKFLOWS=20 node capture-workflows-json.js
```

### Test Mode

```bash
# Run test extraction (2 workflows only)
node test-json-extraction.js
```

## JSON Structure

### Workflow Document

```json
{
  "workflow_id": "wf_core_send_message",
  "wf_item": "cqVKW3",
  "name": "CORE send new message",
  "version": 1,
  "hash": "sha256:...",
  "captured_at": "2025-09-21T10:00:00Z",
  "metadata": {
    "endpoint": "send_new_message",
    "trigger": {
      "type": "api_event",
      "method": "POST"
    },
    "response_type": "json_object",
    "timezone": "US/Eastern",
    "exposed_as_api": true,
    "requires_authentication": true
  },
  "interface": {
    "inputs": [
      {
        "key": "thread",
        "type": "Thread",
        "required": false,
        "is_list": false
      }
    ],
    "outputs": []
  },
  "steps": [
    {
      "wf_item": "step_4e7a1b",
      "order": 1,
      "title": "Create Message",
      "action": "create_thing",
      "thing_type": "Message",
      "condition": {
        "raw": "proposal is not empty",
        "normalized": "proposal != null",
        "variables": ["proposal"],
        "operators": ["!="]
      },
      "parameters": [
        {
          "key": "thread",
          "type": "Thread",
          "optional": true,
          "is_list": false
        }
      ],
      "step_hash": "sha256:..."
    }
  ],
  "dependencies": []
}
```

### Cross-Workflow Call

```json
{
  "wf_item": "s-0142",
  "order": 7,
  "title": "Schedule reminder",
  "action": "schedule_api_workflow",
  "call": {
    "target": {
      "workflow_id": "wf_core_expiration_reminder",
      "wf_item": "cqxuw2",
      "mode": "async"
    },
    "mapping": [
      {
        "to": "date_change_type",
        "from": {"expr": "Message.Change.Type"}
      },
      {
        "to": "timezone",
        "from": {"literal": "US/Eastern"}
      }
    ],
    "on_result": {
      "capture_as": "reminder_job_id",
      "error_policy": "propagate"
    }
  }
}
```

## Output Structure

```
backend-indexer-json/
├── workflow-data/
│   └── session-2025-09-21T10-00-00/
│       ├── wf_core_send_message_cqVKW3.json
│       ├── wf_core_expiration_reminder_cqxuw2.json
│       └── extraction-summary.json
├── snapshots/
│   └── 2025-09-21/
│       └── [workflow files]
├── dependencies/
│   └── deps_2025-09-21T10-00-00.json
└── changes/
    └── week_2025-09-21_changes.json
```

## Modules

### Core Modules

- **capture-workflows-json.js**: Main orchestrator for extraction
- **lib/workflow-parser.js**: Extracts workflow metadata
- **lib/step-extractor.js**: Extracts step details and actions
- **lib/parameter-extractor.js**: Extracts parameters from properties panel
- **lib/hash-generator.js**: Generates content hashes for versioning
- **lib/diff-engine.js**: Compares snapshots for changes
- **lib/dependency-analyzer.js**: Analyzes cross-workflow dependencies

### Key Classes

#### WorkflowJSONCapture

Main class that orchestrates the extraction process:

```javascript
const capture = new WorkflowJSONCapture();
const result = await capture.run({
    maxWorkflows: 10,
    startIndex: 0
});
```

#### HashGenerator

Generates deterministic hashes for change detection:

```javascript
const hashGen = new HashGenerator();
const workflowHash = hashGen.generateWorkflowHash(workflowData);
const stepHash = hashGen.generateStepHash(stepData);
```

#### DiffEngine

Compares snapshots to identify changes:

```javascript
const diffEngine = new DiffEngine(hashGenerator);
const changes = await diffEngine.compareSnapshots(oldSnapshot, newSnapshot);
const report = await diffEngine.generateDiffReport(changes);
```

#### DependencyAnalyzer

Analyzes workflow dependencies:

```javascript
const analyzer = new DependencyAnalyzer();
const dependencies = analyzer.analyze(workflow);
const graph = analyzer.buildDependencyGraph(workflows);
```

## Weekly Comparison Workflow

1. **Take Snapshot**
   ```bash
   node capture-workflows-json.js
   ```

2. **Compare with Previous Week**
   ```javascript
   const DiffEngine = require('./lib/diff-engine');
   const oldSnapshot = require('./snapshots/2025-09-14/summary.json');
   const newSnapshot = require('./snapshots/2025-09-21/summary.json');

   const diff = new DiffEngine();
   const changes = await diff.compareSnapshots(oldSnapshot, newSnapshot);
   ```

3. **Generate Report**
   ```javascript
   const report = await diff.generateDiffReport(changes);
   await diff.saveDiffReport(report, './changes/weekly-report.json');
   ```

## Change Detection

### Severity Levels

- **HIGH**: Workflow added/removed, action type changed, target workflow changed
- **MEDIUM**: Condition changed, parameters modified, interface changed
- **LOW**: Title changed, step reordered, description updated

### Change Types

- `workflow_added`: New workflow detected
- `workflow_removed`: Workflow deleted
- `workflow_modified`: Metadata or settings changed
- `step_added`: New step in workflow
- `step_removed`: Step deleted from workflow
- `step_modified`: Step details changed
- `step_reordered`: Step position changed
- `interface_changed`: Input/output parameters modified
- `dependency_changed`: Cross-workflow call modified

## RAG Integration

### Chunking Strategy

The system supports three levels of chunking for RAG:

1. **Workflow Level**: Overview and metadata
2. **Step Level**: Individual step details (primary chunk)
3. **Parameter Level**: Detailed parameter information

### Metadata for RAG

Each chunk includes metadata for precise retrieval:

```json
{
  "workflow_id": "wf_core_send_message",
  "workflow_name": "CORE send new message",
  "wf_item": "cqVKW3",
  "step_wf_item": "step_4e7a1b",
  "action": "create_thing",
  "version": 1,
  "hash": "sha256:...",
  "captured_at": "2025-09-21T10:00:00Z"
}
```

## Troubleshooting

### Common Issues

1. **Browser Profile Not Found**
   - Ensure `browser-profiles/default` directory exists
   - Run manual login first if needed

2. **Workflow Not Loading**
   - Check URL format in `workflow-ids-final.json`
   - Verify authentication is active

3. **Properties Panel Not Found**
   - Increase wait times in extraction
   - Check for UI changes in Bubble editor

### Debug Mode

```bash
# Enable verbose logging
DEBUG=true node capture-workflows-json.js

# Test single workflow
MAX_WORKFLOWS=1 START_INDEX=0 node capture-workflows-json.js
```

## Performance

- **Processing Speed**: ~10-15 seconds per workflow
- **Memory Usage**: ~200MB for 300 workflows
- **Storage**: ~100KB per workflow JSON file
- **Total Dataset**: ~30MB for 300 workflows

## Best Practices

1. **Regular Snapshots**: Run weekly for consistent change tracking
2. **Incremental Processing**: Use START_INDEX for large datasets
3. **Validation**: Always validate extracted data with test script
4. **Backup**: Keep multiple snapshot versions for rollback
5. **Monitoring**: Check extraction-summary.json for completeness

## Future Enhancements

- [ ] Parallel workflow processing
- [ ] Real-time change notifications
- [ ] Database integration (PostgreSQL/MongoDB)
- [ ] API endpoint for data access
- [ ] Visual dependency graph generation
- [ ] Automated validation reports
- [ ] Integration with version control

## License

MIT