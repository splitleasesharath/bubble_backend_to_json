const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

async function extractWorkflowsToJSON() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    console.log('Opening Chrome...');

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1920, height: 1080 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await context.newPage();
    await page.goto(bubbleUrl);

    // Wait for page to load
    await page.waitForTimeout(5000);

    // Create timestamped directory for JSON files
    const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const dataDir = path.join(__dirname, 'workflow-data', `session-${sessionTimestamp}`);
    await fs.mkdir(dataDir, { recursive: true });
    console.log(`Created session data directory: ${dataDir}`);

    console.log('Expanding all folders...');

    // Expand all folders
    const expandButtons = await page.$$('div[role="button"] svg');
    console.log(`Found ${expandButtons.length} expand buttons`);

    for (let i = 1; i < expandButtons.length && i < 30; i++) {
        try {
            await expandButtons[i].click();
            await page.waitForTimeout(200);
        } catch (err) {
            // Continue
        }
    }

    await page.waitForTimeout(3000);

    console.log('\n=== Starting Workflow Data Extraction ===\n');

    const workflowData = [];
    const processedUrls = new Set();

    // Find all workflow items using the correct selector
    const workflowItems = await page.$$('[data-name="WorkflowItem"]');
    console.log(`Found ${workflowItems.length} workflow items`);

    let totalProcessed = 0;

    for (const element of workflowItems) {
            try {
                // Get workflow ID and name
                const wfItem = await element.getAttribute('data-item-id');
                const textEl = await element.$('._13jwfz74, ._13jwfz75, ._13jwfz76');
                const text = textEl ? await textEl.textContent() : null;

                if (!text || !wfItem) {
                    continue;
                }

                // Click the workflow
                await element.click();
                await page.waitForTimeout(2000);

                // Get the current URL after clicking
                const currentUrl = page.url();

                if (wfItem && !processedUrls.has(wfItem)) {
                    processedUrls.add(wfItem);

                    console.log(`Processing: ${text.trim()} (${wfItem})`);

                    // Extract workflow data from the page
                    const workflowJSON = await page.evaluate(() => {
                        const data = {
                            steps: [],
                            metadata: {},
                            interface: { inputs: [], outputs: [] }
                        };

                        // Find all step elements in the canvas
                        const allElements = document.querySelectorAll('*');
                        const stepData = [];

                        for (const element of allElements) {
                            const text = element.textContent || '';

                            // Look for Step patterns
                            if (text.match(/^Step\s+\d+/)) {
                                const rect = element.getBoundingClientRect();

                                // Must be in canvas area
                                if (rect.x > 250 && rect.x < 1500 && rect.width > 0) {
                                    // Clean the text
                                    let cleanText = text.replace(/^Step\s+\d+[:\s]*/, '').trim();

                                    // Remove navigation items
                                    const lines = cleanText.split('\n');
                                    for (const line of lines) {
                                        if (line && !line.match(/^(Backend|IN THIS|Uncategorized|\d+$)/)) {
                                            cleanText = line.trim();
                                            break;
                                        }
                                    }

                                    stepData.push({
                                        text: cleanText.substring(0, 200),
                                        x: rect.x,
                                        y: rect.y
                                    });
                                }
                            }
                        }

                        // Remove duplicates based on position
                        const uniqueSteps = [];
                        const seenPositions = new Set();

                        for (const step of stepData) {
                            const posKey = `${Math.round(step.x/50)}_${Math.round(step.y/50)}`;
                            if (!seenPositions.has(posKey)) {
                                seenPositions.add(posKey);
                                uniqueSteps.push(step);
                            }
                        }

                        // Sort by Y position (top to bottom)
                        uniqueSteps.sort((a, b) => a.y - b.y);

                        data.steps = uniqueSteps.map((step, index) => ({
                            order: index + 1,
                            title: step.text,
                            position: { x: step.x, y: step.y }
                        }));

                        // Try to get metadata from properties panel
                        const propsPanel = document.querySelector('[class*="property-editor"], [class*="properties-panel"]');
                        if (propsPanel) {
                            data.metadata.properties_text = propsPanel.textContent.substring(0, 500);
                        }

                        return data;
                    });

                    // Create the full workflow object
                    const workflow = {
                        workflow_id: text.trim().replace(/[^a-z0-9-_]/gi, '_'),
                        wf_item: wfItem,
                        name: text.trim(),
                        url: currentUrl,
                        captured_at: new Date().toISOString(),
                        version: 1,
                        metadata: workflowJSON.metadata,
                        interface: workflowJSON.interface,
                        steps: workflowJSON.steps,
                        dependencies: [],
                        hash: ''
                    };

                    // Generate hash
                    const content = JSON.stringify(workflow, Object.keys(workflow).sort());
                    workflow.hash = crypto.createHash('sha256').update(content).digest('hex');

                    // Save to file
                    const safeName = text.trim()
                        .replace(/[^a-zA-Z0-9-_]/g, '_')
                        .replace(/_+/g, '_')
                        .substring(0, 50);

                    const filename = `${safeName}_${wfItem}.json`;
                    const filepath = path.join(dataDir, filename);

                    await fs.writeFile(filepath, JSON.stringify(workflow, null, 2));

                    workflowData.push({
                        name: text.trim(),
                        wf_item: wfItem,
                        steps_count: workflow.steps.length,
                        file: filename
                    });

                    totalProcessed++;
                    console.log(`  ✓ Extracted ${workflow.steps.length} steps`);
                }

            } catch (err) {
                console.log(`Error processing element: ${err.message}`);
            }
        }

    // Save summary
    const summaryPath = path.join(dataDir, 'extraction-summary.json');
    await fs.writeFile(summaryPath, JSON.stringify({
        session: sessionTimestamp,
        total_workflows: totalProcessed,
        workflows: workflowData
    }, null, 2));

    console.log('\n=== Extraction Complete ===');
    console.log(`Total workflows processed: ${totalProcessed}`);
    console.log(`Data saved to: ${dataDir}`);

    // Keep browser open
    console.log('\nBrowser will remain open. Press Ctrl+C to close.');
    await new Promise(() => {});
}

extractWorkflowsToJSON().catch(console.error);