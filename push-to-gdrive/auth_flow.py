import os
import logging
import webbrowser
from typing import Optional
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class AuthFlow:
    """Handles OAuth2 authentication flow for Google Drive"""

    def __init__(self, client_secrets_file: str, scopes: list, port: int = 8080):
        """
        Initialize authentication flow

        Args:
            client_secrets_file: Path to client secrets JSON file
            scopes: List of OAuth scopes
            port: Local port for OAuth callback (default 8080)
        """
        self.client_secrets_file = client_secrets_file
        self.scopes = scopes
        self.port = port

    def authenticate(self) -> Optional[Credentials]:
        """
        Run the interactive OAuth flow

        Returns:
            Google OAuth2 credentials or None if failed
        """
        if not os.path.exists(self.client_secrets_file):
            logger.error(f"Client secrets file not found: {self.client_secrets_file}")
            logger.error("Please download it from Google Cloud Console")
            return None

        try:
            # Create flow instance
            flow = InstalledAppFlow.from_client_secrets_file(
                self.client_secrets_file,
                self.scopes
            )

            # Run local server for OAuth callback
            logger.info("Starting OAuth flow...")
            logger.info(f"Opening browser for authorization...")
            logger.info(f"If browser doesn't open, please visit the URL shown below")

            # Run the OAuth flow
            creds = flow.run_local_server(
                port=self.port,
                prompt='consent',
                access_type='offline',
                include_granted_scopes='true',
                success_message='Authentication successful! You can close this window.',
                open_browser=True,
                authorization_prompt_message='Please visit this URL to authorize this application: {url}'
            )

            logger.info("Authentication successful!")
            return creds

        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            return None

    def authenticate_with_manual_code(self) -> Optional[Credentials]:
        """
        Run OAuth flow with manual code entry (for environments without browser)

        Returns:
            Google OAuth2 credentials or None if failed
        """
        if not os.path.exists(self.client_secrets_file):
            logger.error(f"Client secrets file not found: {self.client_secrets_file}")
            return None

        try:
            flow = InstalledAppFlow.from_client_secrets_file(
                self.client_secrets_file,
                self.scopes
            )

            # Generate authorization URL
            auth_url, _ = flow.authorization_url(
                prompt='consent',
                access_type='offline',
                include_granted_scopes='true'
            )

            print("\n" + "="*50)
            print("Please visit this URL to authorize the application:")
            print(auth_url)
            print("="*50 + "\n")

            # Get authorization code from user
            code = input("Enter the authorization code: ").strip()

            # Exchange code for credentials
            flow.fetch_token(code=code)
            creds = flow.credentials

            logger.info("Authentication successful!")
            return creds

        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            return None