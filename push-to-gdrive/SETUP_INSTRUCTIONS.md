# Google Drive Upload Tool - Setup Instructions

## Prerequisites
- Python 3.7 or higher
- Google account with Google Drive access

## Step 1: Google Cloud Console Setup

### 1.1 Create a Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" dropdown at the top
3. Click "New Project"
4. Enter a project name (e.g., "Drive Upload Tool")
5. Click "Create"

### 1.2 Enable Google Drive API
1. In the Google Cloud Console, select your project
2. Go to "APIs & Services" > "Library"
3. Search for "Google Drive API"
4. Click on "Google Drive API"
5. Click "Enable"

### 1.3 Create OAuth2 Credentials
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. If prompted, configure the OAuth consent screen first:
   - Choose "External" for user type (unless using G Suite)
   - Fill in required fields:
     - App name: "Drive Upload Tool"
     - User support email: your email
     - Developer contact: your email
   - Add scopes:
     - Click "Add or Remove Scopes"
     - Search and select:
       - `../auth/drive.file` (View and manage Google Drive files)
       - `../auth/drive.metadata.readonly` (View metadata for files)
   - Add test users (your email) if in testing mode
   - Click "Save and Continue"

4. Back in "Create OAuth client ID":
   - Application type: Select "Desktop app"
   - Name: "Drive Upload CLI"
   - Click "Create"

5. Download the credentials:
   - Click the download button (⬇) next to your OAuth 2.0 Client ID
   - Save the file as `client_secret.json` in this project directory

## Step 2: Install Python Dependencies

```bash
pip install -r requirements.txt
```

## Step 3: Set Up Environment (Optional)

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` if you want to set default values (optional).

## Step 4: Authenticate with Google Drive

Run the authentication command:
```bash
python main.py auth
```

This will:
1. Open your default browser
2. Ask you to sign in to Google
3. Request permissions to access Google Drive
4. Save authentication tokens locally

**Note**: If you're on a headless server (no browser), use:
```bash
python main.py auth --manual
```
This will provide a URL to visit on another device and let you enter the authorization code manually.

## Step 5: Set Default Upload Folder (Optional)

Set a default folder for uploads:
```bash
python main.py set-folder
```

This will:
1. List all folders in your Google Drive
2. Let you select or create a folder
3. Save it as the default upload destination

## Usage Examples

### Check Authentication Status
```bash
python main.py status
```

### Upload a Single File
```bash
python main.py upload myfile.pdf
```

### Upload to Specific Folder
```bash
python main.py upload myfile.pdf --folder FOLDER_ID
```

### Batch Upload Files
```bash
# Upload all files from a directory
python main.py batch ./documents

# Upload only PDF files
python main.py batch ./documents --pattern "*.pdf"

# Upload to specific folder
python main.py batch ./documents --folder FOLDER_ID
```

## File Structure

After setup, your directory should contain:
```
push-to-gdrive/
├── main.py                 # Main CLI interface
├── google_drive_uploader.py # Core upload functionality
├── auth_flow.py           # OAuth authentication handler
├── requirements.txt       # Python dependencies
├── .env                  # Environment variables (optional)
├── client_secret.json    # Google OAuth credentials (downloaded from Google)
├── token.json           # Saved authentication tokens (created after auth)
└── settings.json        # App settings (created after setting folder)
```

## Security Notes

1. **Keep `client_secret.json` private** - This file contains your OAuth credentials
2. **Don't commit `token.json`** - This contains your access tokens
3. **Add to `.gitignore`**:
   ```
   client_secret.json
   token.json
   settings.json
   .env
   ```

## Troubleshooting

### "Client secrets file not found"
- Make sure you've downloaded the credentials from Google Cloud Console
- Rename the file to `client_secret.json`
- Place it in the same directory as `main.py`

### "Authentication failed"
- Check that Google Drive API is enabled in your Google Cloud project
- Ensure your OAuth consent screen is configured properly
- Try deleting `token.json` and re-authenticating

### "Permission denied" errors
- Make sure your OAuth app has the correct scopes
- Re-authenticate with `python main.py auth`

### Browser doesn't open during authentication
- Use manual mode: `python main.py auth --manual`
- Or set a different browser as default

## API Quotas and Limits

Google Drive API has the following limits:
- 1,000,000,000 requests per day
- 1,000 requests per 100 seconds per user
- Maximum file size: 5TB

For most personal use, you won't hit these limits.

## Support

For issues or questions:
1. Check the error messages in the console
2. Review the logs (if enabled)
3. Ensure all setup steps were completed
4. Check Google Cloud Console for any API errors