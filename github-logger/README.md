# GitHub Logger

A simple, standalone tool to push log files to a GitHub repository. Each log is converted to JSON format with metadata and pushed as a new file with a timestamp.

## Features

- Push any file to GitHub as a JSON log entry
- Automatic timestamp generation for unique file names
- Metadata capture (file size, modification time, etc.)
- JSON formatting with structured content
- Custom commit messages support
- Minimal dependencies (just Octokit)

## Setup

### 1. Prerequisites

- Node.js installed
- GitHub account
- A GitHub repository for storing logs

### 2. Installation

```bash
# Navigate to the github-logger directory
cd github-logger

# Install dependencies
npm install
```

### 3. GitHub Token Setup

1. Create a GitHub Personal Access Token:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Give it a name (e.g., "Log Repository Access")
   - Select the `repo` scope (full control of private repositories)
   - Generate and copy the token

2. Create `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and add your token:
   ```
   GITHUB_TOKEN=ghp_your_actual_token_here
   ```

### 4. Configure Repository

1. Edit `config.json`:
   ```json
   {
     "repository": {
       "owner": "your-github-username",
       "repo": "your-log-repository-name",
       "branch": "main"
     },
     "logPath": "logs/",
     "commitMessageTemplate": "Add log: {timestamp}"
   }
   ```

2. Create your log repository on GitHub:
   - Go to https://github.com/new
   - Create a new repository (can be private)
   - Initialize with README if desired

## Usage

### Basic Usage

Push a log file to GitHub:

```bash
node github-logger.js path/to/your/logfile.txt
```

### With Custom Commit Message

```bash
node github-logger.js path/to/logfile.txt --message "Custom commit message"
```

### Examples

```bash
# Push a JSON extraction file
node github-logger.js ../extracted-workflows-dropdown/workflows.json

# Push a text log with custom message
node github-logger.js ../debug.log --message "Debug run for workflow extraction"

# Push from parent directory workflow data
node github-logger.js ../workflow-data/extraction.json
```

## Output Format

All files are converted to JSON with the following structure:

```json
{
  "timestamp": "2025-09-25T14:30:45.123Z",
  "source": "original-filename.txt",
  "sourcePath": "full/path/to/original-filename.txt",
  "content": "... file content (JSON or text) ...",
  "metadata": {
    "size": 1024,
    "type": ".txt",
    "modified": "2025-09-25T14:00:00.000Z"
  }
}
```

Files are saved in the repository as:
```
logs/2025-09-25_14-30-45_original-filename.json
```

## Integration with Parent Project

This logger can be called from the parent project scripts:

```javascript
// From parent project
const { exec } = require('child_process');

exec('node github-logger/github-logger.js workflow-data/latest.json', (error, stdout, stderr) => {
    if (error) {
        console.error(`Error: ${error}`);
        return;
    }
    console.log(`Log pushed: ${stdout}`);
});
```

Or add to parent package.json scripts:

```json
{
  "scripts": {
    "log-push": "node github-logger/github-logger.js",
    "log-workflow": "node github-logger/github-logger.js workflow-data/latest.json"
  }
}
```

## Troubleshooting

### Token Issues
- Ensure your token has `repo` permissions
- Check token hasn't expired
- Verify token is correctly set in `.env` file

### Repository Access
- Confirm repository name and owner are correct in `config.json`
- Verify you have write access to the repository
- Check branch name exists (usually "main" or "master")

### File Not Found
- Use absolute or relative paths from the github-logger directory
- Ensure file exists before running the command

### Push Failures
- Check internet connection
- Verify GitHub API status at https://www.githubstatus.com/
- Review error messages for specific API issues

## Security Notes

- **Never commit `.env` file** - it contains your GitHub token
- Keep your token secure and rotate periodically
- Use minimal permissions (just `repo` scope)
- Consider using GitHub Apps for production use

## License

MIT