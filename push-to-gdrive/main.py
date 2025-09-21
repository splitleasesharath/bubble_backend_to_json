#!/usr/bin/env python3
"""
Google Drive Upload Tool
A simple command-line tool for uploading files to Google Drive
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from typing import Optional
from colorama import init, Fore, Style
from tqdm import tqdm
from dotenv import load_dotenv

from google_drive_uploader import GoogleDriveUploader
from auth_flow import AuthFlow

# Initialize colorama for Windows
init(autoreset=True)

# Load environment variables
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class GoogleDriveCLI:
    """Command-line interface for Google Drive operations"""

    def __init__(self):
        self.uploader = GoogleDriveUploader()

    def print_success(self, message: str):
        """Print success message in green"""
        print(f"{Fore.GREEN}[OK] {message}{Style.RESET_ALL}")

    def print_error(self, message: str):
        """Print error message in red"""
        print(f"{Fore.RED}[ERROR] {message}{Style.RESET_ALL}")

    def print_info(self, message: str):
        """Print info message in blue"""
        print(f"{Fore.BLUE}[INFO] {message}{Style.RESET_ALL}")

    def print_warning(self, message: str):
        """Print warning message in yellow"""
        print(f"{Fore.YELLOW}[WARNING] {message}{Style.RESET_ALL}")

    def authenticate(self, manual: bool = False) -> bool:
        """Run authentication flow"""
        self.print_info("Starting authentication process...")

        auth = AuthFlow(
            client_secrets_file=self.uploader.CLIENT_SECRETS_FILE,
            scopes=self.uploader.SCOPES
        )

        if manual:
            creds = auth.authenticate_with_manual_code()
        else:
            creds = auth.authenticate()

        if creds:
            self.uploader.save_credentials(creds)
            self.uploader.creds = creds
            self.print_success("Authentication successful! Credentials saved.")
            return True
        else:
            self.print_error("Authentication failed!")
            return False

    def check_auth_status(self) -> bool:
        """Check and display authentication status"""
        if self.uploader.is_authenticated():
            self.print_success("Authenticated with Google Drive")
            if self.uploader.default_folder_id:
                self.print_info(f"Default folder ID: {self.uploader.default_folder_id}")
            return True
        else:
            self.print_warning("Not authenticated. Please run: python main.py auth")
            return False

    def select_folder(self) -> Optional[str]:
        """Interactive folder selection"""
        try:
            self.print_info("Fetching folders from Google Drive...")
            folders = self.uploader.list_folders()

            if not folders:
                self.print_warning("No folders found in your Google Drive")
                create = input("Would you like to create a new folder? (y/n): ").lower()
                if create == 'y':
                    name = input("Enter folder name: ").strip()
                    folder = self.uploader.create_folder(name)
                    return folder['id']
                return None

            # Display folders
            print("\n" + "="*50)
            print("Available Folders:")
            print("="*50)
            print(f"{'#':<5} {'Folder Name':<40}")
            print("-"*50)

            for i, folder in enumerate(folders, 1):
                print(f"{i:<5} {folder['name']:<40}")

            print("-"*50)
            print(f"{0:<5} {'Create new folder':<40}")
            print("="*50)

            # Get user selection
            while True:
                try:
                    choice = input("\nSelect folder number (or 0 to create new): ").strip()
                    choice = int(choice)

                    if choice == 0:
                        name = input("Enter new folder name: ").strip()
                        folder = self.uploader.create_folder(name)
                        return folder['id']
                    elif 1 <= choice <= len(folders):
                        return folders[choice - 1]['id']
                    else:
                        self.print_error("Invalid selection. Please try again.")
                except ValueError:
                    self.print_error("Please enter a valid number.")
                except KeyboardInterrupt:
                    print("\n")
                    return None

        except Exception as e:
            self.print_error(f"Error selecting folder: {e}")
            return None

    def set_default_folder(self):
        """Set default upload folder"""
        if not self.check_auth_status():
            return

        folder_id = self.select_folder()
        if folder_id:
            self.uploader.save_default_folder(folder_id)
            self.print_success(f"Default folder set: {folder_id}")
        else:
            self.print_warning("No folder selected")

    def upload_file(self, file_path: str, folder_id: Optional[str] = None):
        """Upload a file to Google Drive"""
        if not self.check_auth_status():
            return

        # Check if file exists
        if not os.path.exists(file_path):
            self.print_error(f"File not found: {file_path}")
            return

        # Get file info
        file_name = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)

        # Determine target folder
        target_folder = folder_id or self.uploader.default_folder_id
        if not target_folder:
            self.print_info("No default folder set. Please select a folder:")
            target_folder = self.select_folder()
            if not target_folder:
                self.print_error("Upload cancelled - no folder selected")
                return

            # Ask if user wants to save as default
            save_default = input("Save as default folder? (y/n): ").lower()
            if save_default == 'y':
                self.uploader.save_default_folder(target_folder)

        # Upload file with progress bar
        self.print_info(f"Uploading: {file_name} ({file_size:,} bytes)")

        try:
            result = self.uploader.upload_file(
                file_path=file_path,
                folder_id=target_folder
            )

            if result['success']:
                self.print_success(f"File uploaded successfully!")
                self.print_info(f"File ID: {result['file_id']}")
                self.print_info(f"View link: {result['web_view_link']}")
            else:
                self.print_error(f"Upload failed: {result.get('error', 'Unknown error')}")

        except Exception as e:
            self.print_error(f"Upload failed: {e}")

    def batch_upload(self, directory: str, pattern: str = "*", folder_id: Optional[str] = None):
        """Upload multiple files from a directory"""
        if not self.check_auth_status():
            return

        # Get files to upload
        path = Path(directory)
        if not path.exists():
            self.print_error(f"Directory not found: {directory}")
            return

        files = list(path.glob(pattern))
        if not files:
            self.print_warning(f"No files found matching pattern: {pattern}")
            return

        self.print_info(f"Found {len(files)} files to upload")

        # Determine target folder
        target_folder = folder_id or self.uploader.default_folder_id
        if not target_folder:
            self.print_info("No default folder set. Please select a folder:")
            target_folder = self.select_folder()
            if not target_folder:
                self.print_error("Upload cancelled - no folder selected")
                return

        # Upload files with progress
        success_count = 0
        for file_path in tqdm(files, desc="Uploading files"):
            if file_path.is_file():
                try:
                    result = self.uploader.upload_file(
                        file_path=str(file_path),
                        folder_id=target_folder
                    )
                    if result['success']:
                        success_count += 1
                except Exception as e:
                    logger.error(f"Failed to upload {file_path}: {e}")

        self.print_success(f"Upload complete: {success_count}/{len(files)} files uploaded successfully")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description='Google Drive Upload Tool')
    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Auth command
    auth_parser = subparsers.add_parser('auth', help='Authenticate with Google Drive')
    auth_parser.add_argument('--manual', action='store_true',
                            help='Use manual code entry (for headless environments)')

    # Status command
    subparsers.add_parser('status', help='Check authentication status')

    # Set folder command
    subparsers.add_parser('set-folder', help='Set default upload folder')

    # Upload command
    upload_parser = subparsers.add_parser('upload', help='Upload file to Google Drive')
    upload_parser.add_argument('file', help='Path to file to upload')
    upload_parser.add_argument('--folder', help='Target folder ID (optional)')

    # Batch upload command
    batch_parser = subparsers.add_parser('batch', help='Upload multiple files')
    batch_parser.add_argument('directory', help='Directory containing files')
    batch_parser.add_argument('--pattern', default='*', help='File pattern (e.g., *.pdf)')
    batch_parser.add_argument('--folder', help='Target folder ID (optional)')

    # Parse arguments
    args = parser.parse_args()

    # Initialize CLI
    cli = GoogleDriveCLI()

    # Handle commands
    if args.command == 'auth':
        cli.authenticate(manual=args.manual)
    elif args.command == 'status':
        cli.check_auth_status()
    elif args.command == 'set-folder':
        cli.set_default_folder()
    elif args.command == 'upload':
        cli.upload_file(args.file, args.folder)
    elif args.command == 'batch':
        cli.batch_upload(args.directory, args.pattern, args.folder)
    else:
        # Show help if no command provided
        parser.print_help()
        print("\n" + "="*50)
        print("Quick Start Guide:")
        print("="*50)
        print("1. First, authenticate:       python main.py auth")
        print("2. Set default folder:         python main.py set-folder")
        print("3. Upload a file:              python main.py upload file.pdf")
        print("4. Upload multiple files:      python main.py batch ./folder --pattern *.pdf")
        print("="*50)


if __name__ == "__main__":
    main()