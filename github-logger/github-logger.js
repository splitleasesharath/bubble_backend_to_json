#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Load configuration
let config;
try {
    config = require('./config.json');
} catch (error) {
    console.error('Error loading config.json. Please create it from config.example.json');
    process.exit(1);
}

// Initialize Octokit with GitHub token
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

/**
 * Generate timestamp string for file naming
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, -5); // Remove milliseconds and Z
}

/**
 * Read and process input file
 * @param {string} filePath - Path to the file to process
 * @returns {object} Processed content as JSON
 */
async function processFile(filePath) {
    try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        const fileName = path.basename(filePath);

        // Try to parse as JSON, otherwise treat as text
        let processedContent;
        try {
            processedContent = JSON.parse(content);
        } catch {
            processedContent = content;
        }

        return {
            timestamp: new Date().toISOString(),
            source: fileName,
            sourcePath: filePath,
            content: processedContent,
            metadata: {
                size: stats.size,
                type: path.extname(filePath),
                modified: stats.mtime.toISOString()
            }
        };
    } catch (error) {
        throw new Error(`Failed to process file: ${error.message}`);
    }
}

/**
 * Push content to GitHub repository
 * @param {object} jsonContent - JSON content to push
 * @param {string} originalFileName - Original file name for reference
 * @param {string} customMessage - Optional custom commit message
 */
async function pushToGitHub(jsonContent, originalFileName, customMessage) {
    try {
        const timestamp = getTimestamp();
        const baseFileName = path.basename(originalFileName, path.extname(originalFileName));
        const fileName = `${timestamp}_${baseFileName}.json`;
        const filePath = `${config.logPath}${fileName}`;

        // Prepare content for GitHub
        const contentString = JSON.stringify(jsonContent, null, 2);
        const contentBase64 = Buffer.from(contentString).toString('base64');

        // Prepare commit message
        const commitMessage = customMessage ||
            config.commitMessageTemplate.replace('{timestamp}', timestamp);

        console.log(`Pushing to: ${config.repository.owner}/${config.repository.repo}/${filePath}`);

        // Check if file exists (to get SHA if updating)
        let sha;
        try {
            const { data: existingFile } = await octokit.repos.getContent({
                owner: config.repository.owner,
                repo: config.repository.repo,
                path: filePath,
                ref: config.repository.branch
            });
            sha = existingFile.sha;
        } catch (error) {
            // File doesn't exist, which is expected for new logs
            sha = undefined;
        }

        // Create or update file
        const response = await octokit.repos.createOrUpdateFileContents({
            owner: config.repository.owner,
            repo: config.repository.repo,
            path: filePath,
            message: commitMessage,
            content: contentBase64,
            branch: config.repository.branch,
            sha: sha
        });

        console.log(`Successfully pushed log to GitHub!`);
        console.log(`Commit SHA: ${response.data.commit.sha}`);
        console.log(`File URL: ${response.data.content.html_url}`);

        return response.data;
    } catch (error) {
        throw new Error(`Failed to push to GitHub: ${error.message}`);
    }
}

/**
 * Main function
 */
async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);

        if (args.length === 0) {
            console.log('Usage: node github-logger.js <file-path> [--message "custom message"]');
            process.exit(1);
        }

        const filePath = args[0];
        let customMessage = null;

        // Check for custom message flag
        const messageIndex = args.indexOf('--message');
        if (messageIndex !== -1 && args[messageIndex + 1]) {
            customMessage = args[messageIndex + 1];
        }

        // Validate GitHub token
        if (!process.env.GITHUB_TOKEN) {
            console.error('Error: GITHUB_TOKEN not found in environment variables.');
            console.error('Please create a .env file with your GitHub token.');
            process.exit(1);
        }

        // Process the file
        console.log(`Processing file: ${filePath}`);
        const jsonContent = await processFile(filePath);

        // Push to GitHub
        await pushToGitHub(jsonContent, path.basename(filePath), customMessage);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { processFile, pushToGitHub, getTimestamp };