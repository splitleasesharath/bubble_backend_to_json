# Push to Google Drive - CLI Upload Tool

A lightweight, secure command-line tool for uploading files to Google Drive with OAuth2 authentication. Built with Python, this tool provides an interactive authentication flow and supports both single and batch file uploads.

## 🚀 Features

- **OAuth2 Authentication**: Secure authentication using Google's OAuth2 flow
- **Interactive Folder Selection**: Browse and select Google Drive folders
- **Single & Batch Uploads**: Upload one file or entire directories
- **Progress Tracking**: Visual progress indicators for uploads
- **Credential Management**: Secure storage and automatic token refresh
- **Cross-platform**: Works on Windows, macOS, and Linux

## 📋 Prerequisites

- Python 3.7 or higher
- Google account with Google Drive access
- Google Cloud Console project with Drive API enabled

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone https://github.com/splitleasesharath/push-to-gdrive.git
cd push-to-gdrive
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Google Cloud Console Setup

#### Create a Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it (e.g., "push-to-gdrive")
4. Click "Create"

#### Enable Google Drive API
1. Navigate to "APIs & Services" → "Library"
2. Search for "Google Drive API"
3. Click on it and press "Enable"

#### Configure OAuth Consent Screen
1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" user type
3. Fill in the required fields:
   - App name: "Drive Upload Tool"
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `../auth/drive.file`
   - `../auth/drive.metadata.readonly`
5. Add your email as a test user

#### Create OAuth2 Credentials
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select "Desktop app" as application type
4. Name it "Drive Upload CLI"
5. Download the JSON file
6. **IMPORTANT**: Save as `client_secret.json` in the project root

## 🎯 Usage

### Initial Authentication

```bash
python main.py auth
```

This opens your browser for Google authentication. For headless servers, use:

```bash
python main.py auth --manual
```

### Check Authentication Status

```bash
python main.py status
```

### Set Default Upload Folder

```bash
python main.py set-folder
```

This will:
- List all your Google Drive folders
- Let you select or create a new folder
- Save it as the default destination

### Upload Files

#### Single File Upload
```bash
# Upload to default folder
python main.py upload myfile.pdf

# Upload to specific folder
python main.py upload myfile.pdf --folder FOLDER_ID
```

#### Batch Upload
```bash
# Upload all files from a directory
python main.py batch ./documents

# Upload only specific file types
python main.py batch ./documents --pattern "*.pdf"

# Upload to specific folder
python main.py batch ./documents --folder FOLDER_ID
```

## 📁 Project Structure

```
push-to-gdrive/
├── main.py                    # CLI interface and command handler
├── google_drive_uploader.py   # Core Google Drive operations
├── auth_flow.py              # OAuth2 authentication handler
├── requirements.txt          # Python dependencies
├── .env.example             # Environment variables template
├── .gitignore              # Git ignore rules
├── README.md               # This file
├── SETUP_INSTRUCTIONS.md   # Detailed setup guide
└── client_secret.json      # OAuth credentials (user-provided, git-ignored)
```

## 🔐 Security

### Protected Files
The following files contain sensitive data and are automatically excluded from version control:
- `client_secret.json` - OAuth2 credentials
- `token.json` - User access tokens
- `settings.json` - User preferences
- `.env` - Environment variables

### Best Practices
1. Never commit `client_secret.json` to version control
2. Keep your access tokens (`token.json`) private
3. Use `.env` for sensitive configuration
4. Regularly review and revoke unused tokens in Google Account settings

## 🔧 Configuration

### Environment Variables (Optional)

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Available options:
- `GOOGLE_DRIVE_DEFAULT_FOLDER_ID` - Default upload folder
- `OAUTH_PORT` - Custom port for OAuth callback (default: 8080)

## 📊 API Limits

Google Drive API quotas:
- 1,000,000,000 requests per day
- 1,000 requests per 100 seconds per user
- Maximum file size: 5TB

## 🐛 Troubleshooting

### "Client secrets file not found"
- Ensure `client_secret.json` is in the project root
- Download it from Google Cloud Console → Credentials

### "Authentication failed"
- Verify Google Drive API is enabled
- Check OAuth consent screen configuration
- Delete `token.json` and re-authenticate

### "Permission denied"
- Ensure correct OAuth scopes are configured
- Re-run `python main.py auth`

### Browser doesn't open
- Use manual mode: `python main.py auth --manual`
- Copy the URL and open in any browser

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Built with Google Drive API v3
- Uses `google-auth-oauthlib` for OAuth2 flow
- Inspired by the need for simple, secure file uploads

## 📧 Support

For issues or questions:
1. Check the [Setup Instructions](SETUP_INSTRUCTIONS.md)
2. Review error messages in console
3. Open an issue on GitHub

---

**Repository**: https://github.com/splitleasesharath/push-to-gdrive

*Developed by splitleasesharath*