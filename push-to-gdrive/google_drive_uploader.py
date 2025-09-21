import os
import json
import logging
from typing import Optional, Dict, Any, Union, List
import io
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaFileUpload
from googleapiclient.errors import HttpError

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class GoogleDriveUploader:
    """Handles Google Drive operations including authentication and file uploads"""

    def __init__(self, config_dir: str = None):
        """Initialize the uploader with configuration directory"""
        self.config_dir = config_dir or os.path.dirname(os.path.abspath(__file__))
        self.CLIENT_SECRETS_FILE = os.path.join(self.config_dir, 'client_secret.json')
        self.TOKEN_FILE = os.path.join(self.config_dir, 'token.json')
        self.SETTINGS_FILE = os.path.join(self.config_dir, 'settings.json')

        self.SCOPES = [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.metadata.readonly',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
            'openid'
        ]

        self.creds = None
        self.service = None
        self.default_folder_id = self._load_default_folder()

    def _load_default_folder(self) -> Optional[str]:
        """Load the default folder ID from settings"""
        if os.path.exists(self.SETTINGS_FILE):
            try:
                with open(self.SETTINGS_FILE, 'r') as f:
                    settings = json.load(f)
                    return settings.get('default_folder_id')
            except Exception as e:
                logger.error(f"Error loading settings: {e}")
        return None

    def save_default_folder(self, folder_id: str) -> None:
        """Save the default folder ID to settings"""
        settings = {}
        if os.path.exists(self.SETTINGS_FILE):
            try:
                with open(self.SETTINGS_FILE, 'r') as f:
                    settings = json.load(f)
            except:
                pass

        settings['default_folder_id'] = folder_id

        with open(self.SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)

        self.default_folder_id = folder_id
        logger.info(f"Default folder saved: {folder_id}")

    def load_credentials(self) -> Optional[Credentials]:
        """Load credentials from token file"""
        if os.path.exists(self.TOKEN_FILE):
            try:
                self.creds = Credentials.from_authorized_user_file(self.TOKEN_FILE, self.SCOPES)
                return self.creds
            except Exception as e:
                logger.error(f"Error loading credentials: {e}")
        return None

    def save_credentials(self, creds: Credentials) -> None:
        """Save credentials to token file"""
        with open(self.TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
        logger.info("Credentials saved successfully")

    def refresh_credentials(self) -> bool:
        """Refresh expired credentials"""
        if self.creds and self.creds.expired and self.creds.refresh_token:
            try:
                self.creds.refresh(Request())
                self.save_credentials(self.creds)
                logger.info("Credentials refreshed successfully")
                return True
            except Exception as e:
                logger.error(f"Error refreshing credentials: {e}")
        return False

    def is_authenticated(self) -> bool:
        """Check if we have valid authentication"""
        if not self.creds:
            self.load_credentials()

        if self.creds:
            if self.creds.valid:
                return True
            elif self.creds.expired and self.creds.refresh_token:
                return self.refresh_credentials()

        return False

    def get_service(self):
        """Get or create the Google Drive service"""
        if not self.service and self.is_authenticated():
            try:
                self.service = build('drive', 'v3', credentials=self.creds, cache_discovery=False)
            except Exception as e:
                logger.error(f"Error creating service: {e}")
                raise
        return self.service

    def list_folders(self, parent_id: str = None) -> List[Dict[str, str]]:
        """List folders in Google Drive"""
        try:
            service = self.get_service()
            if not service:
                raise Exception("Not authenticated")

            query = "mimeType='application/vnd.google-apps.folder' and trashed=false"
            if parent_id:
                query += f" and '{parent_id}' in parents"

            results = service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)',
                orderBy='name'
            ).execute()

            return results.get('files', [])

        except HttpError as e:
            logger.error(f"HTTP error listing folders: {e}")
            raise
        except Exception as e:
            logger.error(f"Error listing folders: {e}")
            raise

    def create_folder(self, name: str, parent_id: str = None) -> Dict[str, str]:
        """Create a new folder in Google Drive"""
        try:
            service = self.get_service()
            if not service:
                raise Exception("Not authenticated")

            file_metadata = {
                'name': name,
                'mimeType': 'application/vnd.google-apps.folder'
            }

            if parent_id:
                file_metadata['parents'] = [parent_id]

            folder = service.files().create(
                body=file_metadata,
                fields='id, name'
            ).execute()

            logger.info(f"Folder created: {folder['name']} (ID: {folder['id']})")
            return folder

        except HttpError as e:
            logger.error(f"HTTP error creating folder: {e}")
            raise
        except Exception as e:
            logger.error(f"Error creating folder: {e}")
            raise

    def upload_file(self,
                   file_path: str = None,
                   file_stream: io.BytesIO = None,
                   file_name: str = None,
                   mime_type: str = 'application/octet-stream',
                   folder_id: str = None) -> Dict[str, Any]:
        """
        Upload a file to Google Drive

        Args:
            file_path: Path to file on disk (use this OR file_stream)
            file_stream: In-memory file stream (use this OR file_path)
            file_name: Name for the file (required if using file_stream)
            mime_type: MIME type of the file
            folder_id: Target folder ID (uses default if not specified)

        Returns:
            Dict with file ID, name, and web link
        """
        try:
            service = self.get_service()
            if not service:
                raise Exception("Not authenticated")

            # Determine file name
            if file_path:
                file_name = file_name or os.path.basename(file_path)
            elif not file_name:
                raise ValueError("file_name is required when using file_stream")

            # Use default folder if not specified
            target_folder = folder_id or self.default_folder_id

            # Prepare metadata
            file_metadata = {'name': file_name}
            if target_folder:
                file_metadata['parents'] = [target_folder]

            # Prepare media upload
            if file_path:
                if not os.path.exists(file_path):
                    raise FileNotFoundError(f"File not found: {file_path}")
                media = MediaFileUpload(file_path, mimetype=mime_type, resumable=True)
            else:
                media = MediaIoBaseUpload(file_stream, mimetype=mime_type, resumable=True)

            # Upload file
            file = service.files().create(
                body=file_metadata,
                media_body=media,
                fields='id, name, webViewLink'
            ).execute()

            logger.info(f"File uploaded: {file['name']} (ID: {file['id']})")

            return {
                'success': True,
                'file_id': file.get('id'),
                'file_name': file.get('name'),
                'web_view_link': file.get('webViewLink')
            }

        except HttpError as e:
            error_msg = f"HTTP error uploading file: {e}"
            logger.error(error_msg)
            return {'success': False, 'error': error_msg}
        except Exception as e:
            error_msg = f"Error uploading file: {e}"
            logger.error(error_msg)
            return {'success': False, 'error': error_msg}

    def get_file_info(self, file_id: str) -> Dict[str, Any]:
        """Get information about a file"""
        try:
            service = self.get_service()
            if not service:
                raise Exception("Not authenticated")

            file = service.files().get(
                fileId=file_id,
                fields='id, name, mimeType, size, webViewLink, parents'
            ).execute()

            return file

        except HttpError as e:
            logger.error(f"HTTP error getting file info: {e}")
            raise
        except Exception as e:
            logger.error(f"Error getting file info: {e}")
            raise