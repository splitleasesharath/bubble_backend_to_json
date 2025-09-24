const path = require('path');
const fs = require('fs').promises;
const { spawn, spawnSync } = require('child_process');

/**
 * Check if Google Drive authentication is set up
 */
async function checkGoogleDriveAuth() {
    const tokenPath = path.join(__dirname, 'push-to-gdrive', 'token.json');
    try {
        await fs.access(tokenPath);
        console.log('✓ Google Drive authentication found');
        return true;
    } catch (error) {
        console.log('✗ Google Drive not authenticated');
        console.log('Please run: python push-to-gdrive/main.py auth');
        return false;
    }
}

/**
 * Get or create a Google Drive folder for screenshots
 */
async function ensureGoogleDriveFolder() {
    return new Promise((resolve, reject) => {
        const pythonPath = 'python';
        const scriptPath = path.join(__dirname, 'push-to-gdrive', 'main.py');

        // First check if a default folder is set
        const statusProcess = spawnSync(pythonPath, [scriptPath, 'status'], {
            cwd: path.join(__dirname, 'push-to-gdrive'),
            encoding: 'utf8'
        });

        if (statusProcess.stdout && statusProcess.stdout.includes('Default folder ID:')) {
            console.log('✓ Default Google Drive folder already set');
            resolve(true);
        } else {
            console.log('Setting up default Google Drive folder...');

            // Set a default folder
            const setFolderProcess = spawn(pythonPath, [scriptPath, 'set-folder'], {
                cwd: path.join(__dirname, 'push-to-gdrive'),
                stdio: 'inherit'
            });

            setFolderProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✓ Google Drive folder configured');
                    resolve(true);
                } else {
                    reject(new Error('Failed to set up Google Drive folder'));
                }
            });

            setFolderProcess.on('error', reject);
        }
    });
}

/**
 * Upload a folder to Google Drive
 * @param {string} folderPath - Path to the folder to upload
 * @param {Object} options - Upload options
 * @returns {Promise<boolean>} - Success status
 */
async function uploadFolderToGoogleDrive(folderPath, options = {}) {
    const {
        pattern = '*',
        deleteAfterUpload = false,
        showProgress = true,
        targetFolderId = '1Xgr-M6Qb40gZNnBZoWYlPZP2jA6kYSTe', // Default folder ID for workflow screenshots
        createSubfolder = true // Create a subfolder with the same name as local folder
    } = options;

    try {
        // Check if folder exists
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) {
            throw new Error(`Path is not a directory: ${folderPath}`);
        }

        // Check authentication
        const isAuthenticated = await checkGoogleDriveAuth();
        if (!isAuthenticated) {
            console.log('\n=== Google Drive Setup Required ===');
            console.log('Please authenticate with Google Drive first:');
            console.log('1. Run: python push-to-gdrive/main.py auth');
            console.log('2. Follow the authentication steps');
            console.log('3. Run this script again');
            return false;
        }

        // Ensure folder is configured
        await ensureGoogleDriveFolder();

        // Count files to upload
        const files = await fs.readdir(folderPath);
        const matchingFiles = files.filter(file => {
            if (pattern === '*') return true;
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(file);
        });

        console.log(`\n=== Starting Google Drive Upload ===`);
        console.log(`Folder: ${folderPath}`);
        console.log(`Files to upload: ${matchingFiles.length}`);
        console.log(`Pattern: ${pattern}`);

        // Get folder name for subfolder creation
        const folderName = path.basename(folderPath);

        return new Promise((resolve, reject) => {
            const pythonPath = 'python';
            let scriptPath;
            let args;

            if (createSubfolder && targetFolderId) {
                // Use the subfolder upload script
                scriptPath = path.join(__dirname, 'push-to-gdrive', 'upload_to_subfolder.py');
                args = [
                    folderPath,
                    '--parent-folder', targetFolderId,
                    '--subfolder-name', folderName,
                    '--pattern', pattern
                ];
                console.log(`Creating subfolder '${folderName}' in Google Drive...`);
            } else {
                // Use regular batch upload
                scriptPath = path.join(__dirname, 'push-to-gdrive', 'main.py');
                args = ['batch', folderPath, '--pattern', pattern];

                // Add target folder if specified
                if (targetFolderId) {
                    args.push('--folder', targetFolderId);
                }
            }

            const uploadProcess = spawn(pythonPath, [scriptPath, ...args], {
                cwd: path.join(__dirname, 'push-to-gdrive'),
                stdio: showProgress ? 'inherit' : 'pipe'
            });

            let output = '';

            if (!showProgress) {
                uploadProcess.stdout.on('data', (data) => {
                    output += data.toString();
                });

                uploadProcess.stderr.on('data', (data) => {
                    console.error(data.toString());
                });
            }

            uploadProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log('\n✓ Google Drive upload completed successfully!');

                    // Rename folder to indicate it's been uploaded
                    const folderName = path.basename(folderPath);
                    if (!folderName.startsWith('gdrive_')) {
                        const parentDir = path.dirname(folderPath);
                        const newFolderName = `gdrive_${folderName}`;
                        const newFolderPath = path.join(parentDir, newFolderName);

                        try {
                            await fs.rename(folderPath, newFolderPath);
                            console.log(`✓ Folder renamed to: ${newFolderName}`);

                            // Update folderPath for deletion if needed
                            folderPath = newFolderPath;
                        } catch (renameError) {
                            console.error(`✗ Failed to rename folder: ${renameError.message}`);
                        }
                    }

                    // Delete local folder if requested
                    if (deleteAfterUpload) {
                        try {
                            await fs.rm(folderPath, { recursive: true, force: true });
                            console.log(`✓ Local folder deleted: ${folderPath}`);
                        } catch (delError) {
                            console.error(`✗ Failed to delete local folder: ${delError.message}`);
                        }
                    }

                    resolve(true);
                } else {
                    console.error(`\n✗ Google Drive upload failed with code ${code}`);
                    if (!showProgress && output) {
                        console.error('Output:', output);
                    }
                    reject(new Error(`Upload process exited with code ${code}`));
                }
            });

            uploadProcess.on('error', (error) => {
                console.error('✗ Failed to start upload process:', error);
                reject(error);
            });
        });
    } catch (error) {
        console.error('Upload error:', error.message);
        return false;
    }
}

/**
 * Upload a single file to Google Drive
 */
async function uploadFileToGoogleDrive(filePath, options = {}) {
    const { deleteAfterUpload = false } = options;

    try {
        // Check if file exists
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
        }

        // Check authentication
        const isAuthenticated = await checkGoogleDriveAuth();
        if (!isAuthenticated) {
            console.log('\n=== Google Drive Setup Required ===');
            console.log('Please authenticate first');
            return false;
        }

        console.log(`\n=== Uploading File to Google Drive ===`);
        console.log(`File: ${filePath}`);

        return new Promise((resolve, reject) => {
            const pythonPath = 'python';
            const scriptPath = path.join(__dirname, 'push-to-gdrive', 'main.py');
            const args = ['upload', filePath];

            const uploadProcess = spawn(pythonPath, [scriptPath, ...args], {
                cwd: path.join(__dirname, 'push-to-gdrive'),
                stdio: 'inherit'
            });

            uploadProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log('\n✓ File uploaded successfully!');

                    if (deleteAfterUpload) {
                        try {
                            await fs.unlink(filePath);
                            console.log(`✓ Local file deleted: ${filePath}`);
                        } catch (delError) {
                            console.error(`✗ Failed to delete local file: ${delError.message}`);
                        }
                    }

                    resolve(true);
                } else {
                    reject(new Error(`Upload failed with code ${code}`));
                }
            });

            uploadProcess.on('error', reject);
        });
    } catch (error) {
        console.error('Upload error:', error.message);
        return false;
    }
}

// Export functions for use in other scripts
module.exports = {
    uploadFolderToGoogleDrive,
    uploadFileToGoogleDrive,
    checkGoogleDriveAuth,
    ensureGoogleDriveFolder
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('Usage:');
        console.log('  node upload-folder-to-gdrive.js <folder-path> [options]');
        console.log('  node upload-folder-to-gdrive.js <file-path> --file [options]');
        console.log('\nOptions:');
        console.log('  --pattern <pattern>     File pattern for folder upload (default: *)');
        console.log('  --delete               Delete local files after successful upload');
        console.log('  --file                 Upload a single file instead of folder');
        console.log('\nExamples:');
        console.log('  node upload-folder-to-gdrive.js ./workflow-screenshots');
        console.log('  node upload-folder-to-gdrive.js ./workflow-screenshots --pattern "*.png"');
        console.log('  node upload-folder-to-gdrive.js ./workflow-screenshots --delete');
        console.log('  node upload-folder-to-gdrive.js ./report.pdf --file');
        process.exit(0);
    }

    const targetPath = args[0];
    const isFile = args.includes('--file');
    const deleteAfterUpload = args.includes('--delete');
    const patternIndex = args.indexOf('--pattern');
    const pattern = patternIndex !== -1 && args[patternIndex + 1] ? args[patternIndex + 1] : '*';

    (async () => {
        try {
            let success;
            if (isFile) {
                success = await uploadFileToGoogleDrive(targetPath, { deleteAfterUpload });
            } else {
                success = await uploadFolderToGoogleDrive(targetPath, {
                    pattern,
                    deleteAfterUpload,
                    showProgress: true
                });
            }

            process.exit(success ? 0 : 1);
        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    })();
}