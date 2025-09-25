const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;

/**
 * Test the GitHub integration by pushing a test JSON file
 */
async function testGitHubIntegration() {
    console.log('🧪 Testing GitHub Logger Integration...\n');

    try {
        // Create a test JSON file with minimal data
        const testData = {
            test: true,
            timestamp: new Date().toISOString(),
            message: "This is a test file to verify GitHub integration",
            extraction_metadata: {
                run_timestamp: new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5),
                total_workflows: 0,
                total_steps: 0,
                test_mode: true
            }
        };

        const testFilePath = path.join(__dirname, 'test-github-upload.json');
        await fs.writeFile(testFilePath, JSON.stringify(testData, null, 2));
        console.log('✅ Created test file: test-github-upload.json\n');

        // Call the GitHub logger
        console.log('🚀 Attempting to push to GitHub...\n');

        const githubLoggerPath = path.join(__dirname, 'github-logger', 'github-logger.js');
        const commitMessage = `Test: GitHub integration verification - ${new Date().toISOString()}`;

        const githubProcess = spawn('node', [
            githubLoggerPath,
            testFilePath,
            '--message',
            commitMessage
        ], {
            cwd: path.join(__dirname, 'github-logger'),
            env: { ...process.env },
            stdio: 'inherit'
        });

        githubProcess.on('close', async (code) => {
            if (code === 0) {
                console.log('\n✅ GitHub integration test successful!');
                console.log('Check: https://github.com/splitleasesharath/logs/tree/main/bubble_logs/backend');

                // Clean up test file
                await fs.unlink(testFilePath);
                console.log('🧹 Cleaned up test file');
            } else {
                console.log(`\n❌ GitHub integration failed (exit code: ${code})`);
                console.log('Please check:');
                console.log('1. GitHub token is set in github-logger/.env');
                console.log('2. Token has repo permissions');
                console.log('3. Repository exists and is accessible');
            }
        });

        githubProcess.on('error', async (error) => {
            console.log(`\n❌ Error running GitHub logger: ${error.message}`);
            // Clean up test file
            await fs.unlink(testFilePath).catch(() => {});
        });

    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

// Run the test
testGitHubIntegration().catch(console.error);