#!/usr/bin/env python3
"""
Upload files to a specific subfolder in Google Drive
Creates the subfolder if it doesn't exist
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from typing import Optional
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload
from tqdm import tqdm

from google_drive_uploader import GoogleDriveUploader

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class SubfolderUploader(GoogleDriveUploader):
    """Extended uploader that creates subfolders in Google Drive"""

    def find_or_create_subfolder(self, parent_folder_id: str, folder_name: str) -> str:
        """
        Find or create a subfolder in the specified parent folder

        Args:
            parent_folder_id: ID of the parent folder in Google Drive
            folder_name: Name of the subfolder to find or create

        Returns:
            The ID of the subfolder
        """
        if not self.service:
            self.get_service()

        # First, check if the folder already exists
        query = f"name='{folder_name}' and '{parent_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"

        try:
            results = self.service.files().list(
                q=query,
                spaces='drive',
                fields='files(id, name)',
                pageSize=1
            ).execute()

            items = results.get('files', [])

            if items:
                # Folder exists
                folder_id = items[0]['id']
                logger.info(f"Found existing folder '{folder_name}' with ID: {folder_id}")
                return folder_id
            else:
                # Create new folder
                file_metadata = {
                    'name': folder_name,
                    'mimeType': 'application/vnd.google-apps.folder',
                    'parents': [parent_folder_id]
                }

                folder = self.service.files().create(
                    body=file_metadata,
                    fields='id'
                ).execute()

                folder_id = folder.get('id')
                logger.info(f"Created new folder '{folder_name}' with ID: {folder_id}")
                return folder_id

        except HttpError as error:
            logger.error(f"An error occurred: {error}")
            raise

    def upload_directory_to_subfolder(self, local_dir: str, parent_folder_id: str,
                                     subfolder_name: str, pattern: str = "*") -> dict:
        """
        Upload all files from a local directory to a subfolder in Google Drive

        Args:
            local_dir: Path to local directory
            parent_folder_id: ID of the parent folder in Google Drive
            subfolder_name: Name of the subfolder to create/use
            pattern: File pattern to match (default: "*")

        Returns:
            Dict with upload results
        """
        # Ensure we're authenticated
        if not self.is_authenticated():
            logger.error("Not authenticated with Google Drive")
            return {'success': False, 'error': 'Not authenticated'}

        # Create or find the subfolder
        try:
            subfolder_id = self.find_or_create_subfolder(parent_folder_id, subfolder_name)
        except Exception as e:
            logger.error(f"Failed to create/find subfolder: {e}")
            return {'success': False, 'error': str(e)}

        # Get files to upload
        path = Path(local_dir)
        if not path.exists():
            logger.error(f"Directory not found: {local_dir}")
            return {'success': False, 'error': 'Directory not found'}

        files = list(path.glob(pattern))
        if not files:
            logger.warning(f"No files found matching pattern: {pattern}")
            return {'success': True, 'uploaded_count': 0, 'subfolder_id': subfolder_id}

        logger.info(f"Uploading {len(files)} files to subfolder '{subfolder_name}'")

        # Upload files with progress
        success_count = 0
        failed_files = []

        for file_path in tqdm(files, desc=f"Uploading to {subfolder_name}"):
            if file_path.is_file():
                try:
                    result = self.upload_file(
                        file_path=str(file_path),
                        folder_id=subfolder_id
                    )
                    if result['success']:
                        success_count += 1
                    else:
                        failed_files.append(str(file_path))
                except Exception as e:
                    logger.error(f"Failed to upload {file_path}: {e}")
                    failed_files.append(str(file_path))

        result = {
            'success': True,
            'uploaded_count': success_count,
            'total_files': len(files),
            'subfolder_id': subfolder_id,
            'subfolder_name': subfolder_name,
            'parent_folder_id': parent_folder_id
        }

        if failed_files:
            result['failed_files'] = failed_files

        logger.info(f"Upload complete: {success_count}/{len(files)} files uploaded successfully")
        return result


def main():
    """Main entry point for subfolder upload"""
    parser = argparse.ArgumentParser(description='Upload directory to Google Drive subfolder')
    parser.add_argument('local_dir', help='Local directory to upload')
    parser.add_argument('--parent-folder', required=True, help='Parent folder ID in Google Drive')
    parser.add_argument('--subfolder-name', required=True, help='Name of subfolder to create/use')
    parser.add_argument('--pattern', default='*', help='File pattern to match (e.g., *.png)')

    args = parser.parse_args()

    # Initialize uploader
    uploader = SubfolderUploader()

    # Check authentication
    if not uploader.is_authenticated():
        logger.error("Please authenticate first: python main.py auth")
        sys.exit(1)

    # Upload directory
    result = uploader.upload_directory_to_subfolder(
        local_dir=args.local_dir,
        parent_folder_id=args.parent_folder,
        subfolder_name=args.subfolder_name,
        pattern=args.pattern
    )

    if result['success']:
        print(f"\n✓ Successfully uploaded {result['uploaded_count']} files")
        print(f"✓ Subfolder: {result['subfolder_name']} (ID: {result['subfolder_id']})")
        sys.exit(0)
    else:
        print(f"\n✗ Upload failed: {result.get('error', 'Unknown error')}")
        sys.exit(1)


if __name__ == "__main__":
    main()