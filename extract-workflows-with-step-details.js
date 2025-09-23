const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

async function extractWorkflowsWithStepDetails() {
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

            if (wfItem && !processedUrls.has(wfItem)) {
                processedUrls.add(wfItem);

                console.log(`\nProcessing: ${text.trim()} (${wfItem})`);

                // Click the workflow
                await element.click();
                await page.waitForTimeout(2000);

                // Get the current URL after clicking
                const currentUrl = page.url();

                // First, get all step elements in the canvas
                const stepElements = await page.evaluate(() => {
                    const steps = [];
                    const allElements = document.querySelectorAll('*');
                    const processedSteps = new Set();

                    for (const element of allElements) {
                        const text = element.textContent || '';
                        const stepMatch = text.match(/^Step\s+(\d+)/);

                        if (!stepMatch) continue;

                        const rect = element.getBoundingClientRect();
                        // Must be in canvas area
                        if (rect.x < 250 || rect.x > 1500 || rect.width === 0 || rect.height === 0) continue;

                        const stepNumber = parseInt(stepMatch[1]);
                        if (processedSteps.has(stepNumber)) continue;
                        processedSteps.add(stepNumber);

                        // Clean the text
                        let cleanText = text.replace(/^Step\s+\d+[:\s]*/, '').trim();
                        const lines = cleanText.split('\n');
                        for (const line of lines) {
                            if (line && !line.match(/^(Backend|IN THIS|Uncategorized|\d+$)/)) {
                                cleanText = line.trim();
                                break;
                            }
                        }

                        steps.push({
                            stepNumber,
                            text: cleanText.substring(0, 200),
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height
                        });
                    }

                    return steps.sort((a, b) => a.stepNumber - b.stepNumber);
                });

                console.log(`  Found ${stepElements.length} steps in canvas`);

                // Now click on each step to get its properties
                const stepsWithDetails = [];

                for (const stepInfo of stepElements) {
                    console.log(`  Clicking Step ${stepInfo.stepNumber}...`);

                    // Click on the step element at its position
                    await page.mouse.click(stepInfo.x + stepInfo.width/2, stepInfo.y + stepInfo.height/2);
                    await page.waitForTimeout(1000);

                    // Extract properties from the grey panel on the right
                    const stepDetails = await page.evaluate(() => {
                        const details = {
                            parameters: [],
                            properties: {},
                            rawText: ''
                        };

                        // Look for the properties panel (grey menu on the right)
                        const propertyPanels = document.querySelectorAll('[class*="property-editor"], [class*="properties-panel"], [class*="inspector"]');

                        for (const panel of propertyPanels) {
                            const rect = panel.getBoundingClientRect();
                            // Properties panel is usually on the right side
                            if (rect.x > window.innerWidth * 0.5) {
                                details.rawText = panel.textContent.substring(0, 2000);

                                // Extract key-value pairs
                                const lines = panel.textContent.split('\n');
                                let currentKey = null;

                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed) continue;

                                    // Common property keys
                                    if (trimmed.match(/^(Type|Key|Value|Only when|Thing to change|Data source|Field to change|List to add to|Expression):/i)) {
                                        const [key, ...valueParts] = trimmed.split(':');
                                        const value = valueParts.join(':').trim();
                                        details.properties[key.trim()] = value;
                                    } else if (trimmed.includes(':')) {
                                        const [key, value] = trimmed.split(':');
                                        if (key && value) {
                                            details.properties[key.trim()] = value.trim();
                                        }
                                    }
                                }

                                // Look for parameter definitions
                                const paramSection = panel.textContent.match(/Parameter[^:]*:\s*([^\n]+)/gi);
                                if (paramSection) {
                                    paramSection.forEach(param => {
                                        const [, value] = param.split(':');
                                        if (value) {
                                            details.parameters.push(value.trim());
                                        }
                                    });
                                }

                                break;
                            }
                        }

                        return details;
                    });

                    stepsWithDetails.push({
                        order: stepInfo.stepNumber,
                        title: stepInfo.text,
                        position: {
                            x: stepInfo.x,
                            y: stepInfo.y
                        },
                        properties: stepDetails.properties,
                        parameters: stepDetails.parameters,
                        raw_properties_text: stepDetails.rawText.substring(0, 500)
                    });
                }

                // Extract workflow-level metadata (click outside steps first)
                await page.mouse.click(100, 300); // Click in empty space
                await page.waitForTimeout(500);

                const workflowMetadata = await page.evaluate(() => {
                    const metadata = {
                        endpoint: null,
                        trigger: { type: null, method: null },
                        response_type: null
                    };

                    // Check for API endpoint info
                    const endpointEl = Array.from(document.querySelectorAll('*')).find(el =>
                        el.textContent && el.textContent.includes('Endpoint name')
                    );

                    if (endpointEl) {
                        const nextEl = endpointEl.nextElementSibling;
                        if (nextEl) metadata.endpoint = nextEl.textContent.trim();
                    }

                    // Check workflow type
                    const bodyText = document.body.textContent;
                    if (bodyText.includes('API Workflow')) {
                        metadata.trigger.type = 'api_workflow';
                    } else if (bodyText.includes('Schedule API')) {
                        metadata.trigger.type = 'scheduled';
                    } else if (bodyText.includes('Custom event')) {
                        metadata.trigger.type = 'custom_event';
                    }

                    return metadata;
                });

                // Create the full workflow object
                const workflow = {
                    workflow_id: text.trim().replace(/[^a-z0-9-_]/gi, '_'),
                    wf_item: wfItem,
                    name: text.trim(),
                    url: currentUrl,
                    captured_at: new Date().toISOString(),
                    version: 1,
                    metadata: workflowMetadata,
                    interface: { inputs: [], outputs: [] },
                    steps: stepsWithDetails,
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
                console.log(`  ✅ Extracted ${workflow.steps.length} steps with properties`);

                // Limit for testing
                if (totalProcessed >= 3) {
                    console.log('\nReached test limit of 3 workflows');
                    break;
                }
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

extractWorkflowsWithStepDetails().catch(console.error);