const DropdownWorkflowExtractor = require('./extract-workflow-dropdown');

/**
 * Test script for the dropdown-based workflow extractor
 * Runs extraction with limited workflows for testing
 */

async function testDropdownExtraction() {
    console.log('=== Starting Test Extraction ===');
    console.log('This will extract the first 5 workflows as a test...\n');

    const extractor = new DropdownWorkflowExtractor();

    // Override the run method to limit workflows for testing
    const originalRun = extractor.run.bind(extractor);

    extractor.run = async function() {
        const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');
        const fs = require('fs').promises;
        const path = require('path');

        const { browser, page } = await launchBrowserWithSession();

        try {
            await fs.mkdir(this.outputDir, { recursive: true });

            console.log('Navigating to Bubble.io editor...');
            await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log('Editor loaded with active session');

            // Open dropdown and parse structure
            const dropdownOpened = await this.openWorkflowDropdown(page);
            if (!dropdownOpened) {
                console.log('❌ Failed to open workflow dropdown');
                return;
            }

            const workflows = await this.parseDropdownStructure(page);
            console.log(`\n📋 Found ${workflows.length} workflows in dropdown`);

            // LIMIT TO FIRST 5 FOR TESTING
            const testWorkflows = workflows.slice(0, 5);
            console.log(`\n🧪 Testing with first ${testWorkflows.length} workflows`);

            // Close dropdown before processing
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);

            const results = {
                workflows: [],
                extracted_at: new Date().toISOString(),
                total_workflows: testWorkflows.length,
                total_steps: 0,
                test_run: true
            };

            // Process each workflow
            for (let i = 0; i < testWorkflows.length; i++) {
                const workflow = testWorkflows[i];
                console.log(`\n[${i + 1}/${testWorkflows.length}] Processing: ${workflow.workflow_name}`);

                try {
                    // Click workflow in dropdown
                    const clicked = await this.clickWorkflowInDropdown(page, workflow);

                    if (clicked) {
                        // Extract workflow details
                        const workflowData = await this.extractWorkflowDetails(page, workflow);

                        results.workflows.push(workflowData);
                        results.total_steps += workflowData.steps.length;

                        // Save individual workflow file
                        const safeName = workflow.workflow_name
                            .replace(/[^a-zA-Z0-9-_]/g, '_')
                            .substring(0, 50);
                        const fileName = `TEST_${safeName}_${workflowData.hash}.json`;
                        const filePath = path.join(this.outputDir, fileName);

                        await fs.writeFile(filePath, JSON.stringify(workflowData, null, 2));
                        console.log(`  ✅ Extracted ${workflowData.steps.length} steps`);
                        console.log(`  💾 Saved: ${fileName}`);
                    } else {
                        console.log('  ⚠️ Could not click workflow in dropdown');
                    }

                    // Small delay between workflows
                    await page.waitForTimeout(1000);

                } catch (error) {
                    console.log(`  ❌ Error processing workflow: ${error.message}`);
                }
            }

            // Save test results
            const testResultsPath = path.join(this.outputDir, 'TEST_RESULTS.json');
            await fs.writeFile(testResultsPath, JSON.stringify(results, null, 2));

            console.log('\n=== Test Extraction Complete ===');
            console.log(`Workflows tested: ${results.workflows.length}`);
            console.log(`Total steps extracted: ${results.total_steps}`);
            console.log(`Average steps per workflow: ${(results.total_steps / results.workflows.length).toFixed(1)}`);
            console.log(`Output directory: ${this.outputDir}`);

            // Display summary of what was extracted
            console.log('\nWorkflows extracted:');
            results.workflows.forEach((wf, idx) => {
                console.log(`  ${idx + 1}. ${wf.workflow_name} - ${wf.steps.length} steps`);
            });

        } catch (error) {
            console.error('Fatal error:', error);
        } finally {
            await browser.close();
        }
    };

    // Run the test
    await extractor.run();
}

// Execute test
testDropdownExtraction().catch(console.error);