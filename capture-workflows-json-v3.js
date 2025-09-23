const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Improved selectors based on Bubble.io structure
const SELECTORS = {
    // Wait for editor to load
    editorCanvas: 'div[class*="editor_canvas"], div[class*="workflow_canvas"], div[class*="canvas"]',

    // Navigation sidebar (to exclude)
    navigationSidebar: 'div[class*="sidebar"], div[class*="navigation"], div[class*="left_panel"]',

    // Workflow steps in center canvas
    workflowSteps: [
        'div[class*="workflow_step"]',
        'div[class*="action_box"]',
        'div[class*="step_container"]',
        'div[class*="workflow_action"]',
        'div[data-action-id]',
        'div[data-step-id]',
        // More specific selectors for Bubble.io
        'div[class*="box"][class*="action"]',
        'div[class*="box"][class*="step"]',
        '.workflow-step',
        '.action-step'
    ].join(', '),

    // Properties panel
    propertiesPanel: 'div[class*="properties"], div[class*="right_panel"], div[class*="inspector"]',

    // Step title within a step element
    stepTitle: [
        'div[class*="title"]',
        'div[class*="header"]',
        'div[class*="label"]',
        'span[class*="name"]',
        'span[class*="title"]',
        'div[class*="action_name"]',
        'div[class*="step_name"]'
    ].join(', ')
};

async function waitForBubbleEditor(page) {
    console.log('Waiting for Bubble.io editor to load...');

    try {
        // Wait for editor canvas instead of network idle
        await page.waitForSelector(SELECTORS.editorCanvas, {
            timeout: 15000,
            state: 'visible'
        });
        console.log('Editor canvas detected');

        // Give dynamic content time to render
        await page.waitForTimeout(3000);

        // Wait for any loading indicators to disappear
        const loadingIndicators = await page.$$('div[class*="loading"], div[class*="spinner"], div[class*="progress"]');
        if (loadingIndicators.length > 0) {
            console.log('Waiting for loading indicators to clear...');
            await page.waitForSelector('div[class*="loading"], div[class*="spinner"], div[class*="progress"]', {
                state: 'hidden',
                timeout: 10000
            }).catch(() => console.log('Loading indicators timeout - continuing'));
        }

        console.log('Editor loaded successfully');
    } catch (error) {
        console.log('Editor wait timeout - continuing with extraction');
    }
}

async function extractWorkflowSteps(page) {
    console.log('Extracting workflow steps...');

    // Get all potential step elements
    const stepElements = await page.$$(SELECTORS.workflowSteps);
    console.log(`Found ${stepElements.length} potential step elements`);

    const steps = [];
    const seenPositions = new Set();

    for (const element of stepElements) {
        try {
            const box = await element.boundingBox();
            if (!box) continue;

            // Filter out navigation (left) and properties (right) panels
            // Center canvas is typically between x:300 and x:1400
            if (box.x < 250 || box.x > 1450) {
                continue;
            }

            // Deduplicate by position
            const posKey = `${Math.round(box.x/10)}-${Math.round(box.y/10)}`;
            if (seenPositions.has(posKey)) {
                continue;
            }
            seenPositions.add(posKey);

            // Extract step details
            const stepData = await element.evaluate(el => {
                // Find the title/header within this step element
                const findStepTitle = () => {
                    // Try to find title element within this step
                    const titleSelectors = [
                        'div[class*="title"]',
                        'div[class*="header"]',
                        'div[class*="action_name"]',
                        'div[class*="step_name"]',
                        'span[class*="name"]',
                        'div[class*="label"]'
                    ];

                    for (const selector of titleSelectors) {
                        const titleEl = el.querySelector(selector);
                        if (titleEl && titleEl.textContent.trim()) {
                            const text = titleEl.textContent.trim();
                            // Filter out navigation items
                            if (!text.includes('Backend Workflows') &&
                                !text.includes('IN THIS APP') &&
                                !text.includes('Uncategorized') &&
                                text.length > 2 &&
                                text.length < 100) {
                                return text;
                            }
                        }
                    }

                    // Fallback: get text but filter out known navigation patterns
                    const fullText = el.textContent || '';
                    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

                    // Find the most likely step title
                    for (const line of lines) {
                        if (line.length > 2 &&
                            line.length < 100 &&
                            !line.includes('Backend Workflows') &&
                            !line.includes('IN THIS APP') &&
                            !line.includes('Uncategorized') &&
                            !/^\d+$/.test(line)) { // Not just a number
                            return line;
                        }
                    }

                    return null;
                };

                const title = findStepTitle();
                if (!title) return null;

                // Extract additional details
                const details = {};

                // Look for action type
                if (el.querySelector('[data-action-type]')) {
                    details.actionType = el.querySelector('[data-action-type]').getAttribute('data-action-type');
                }

                // Look for step ID
                if (el.getAttribute('data-step-id')) {
                    details.stepId = el.getAttribute('data-step-id');
                } else if (el.getAttribute('data-action-id')) {
                    details.stepId = el.getAttribute('data-action-id');
                }

                // Get any visible parameters
                const paramElements = el.querySelectorAll('[class*="param"], [class*="field"], [class*="input"]');
                if (paramElements.length > 0) {
                    details.parameters = [];
                    paramElements.forEach(param => {
                        const paramText = param.textContent.trim();
                        if (paramText && paramText.length < 200) {
                            details.parameters.push(paramText);
                        }
                    });
                }

                return {
                    title,
                    ...details,
                    fullText: el.textContent.substring(0, 500) // For debugging
                };
            });

            if (stepData && stepData.title) {
                steps.push({
                    ...stepData,
                    position: { x: Math.round(box.x), y: Math.round(box.y) }
                });
                console.log(`  Found step: "${stepData.title}"`);
            }
        } catch (error) {
            console.log('Error processing step element:', error.message);
        }
    }

    return steps;
}

async function extractWorkflowMetadata(page) {
    console.log('Extracting workflow metadata...');

    try {
        // Look for workflow name and properties in the properties panel
        const metadata = await page.evaluate(() => {
            const data = {};

            // Try to find workflow name
            const nameSelectors = [
                '[class*="workflow_name"]',
                '[class*="endpoint_name"]',
                'input[placeholder*="endpoint"]',
                'input[value*="workflow"]'
            ];

            for (const selector of nameSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    data.name = el.value || el.textContent.trim();
                    break;
                }
            }

            // Try to find workflow ID
            const idSelectors = [
                '[data-workflow-id]',
                '[class*="workflow_id"]',
                'input[name*="wf_item"]'
            ];

            for (const selector of idSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    data.wf_item = el.getAttribute('data-workflow-id') ||
                                  el.value ||
                                  el.textContent.trim();
                    break;
                }
            }

            return data;
        });

        return metadata;
    } catch (error) {
        console.log('Error extracting metadata:', error.message);
        return {};
    }
}

async function captureWorkflow(page, workflowItem, index) {
    console.log(`\nProcessing workflow ${index + 1}: ${workflowItem}`);

    try {
        // Click on the workflow item
        const itemSelector = `div:has-text("${workflowItem}")`;
        await page.click(itemSelector, { timeout: 5000 });
        console.log(`Clicked on ${workflowItem}`);

        // Wait for editor to update
        await waitForBubbleEditor(page);

        // Extract workflow data
        const metadata = await extractWorkflowMetadata(page);
        const steps = await extractWorkflowSteps(page);

        // Generate workflow data
        const workflowData = {
            wf_item: workflowItem,
            name: metadata.name || workflowItem,
            timestamp: new Date().toISOString(),
            metadata: metadata,
            steps: steps,
            stepCount: steps.length,
            hash: crypto.createHash('sha256')
                       .update(JSON.stringify(steps))
                       .digest('hex')
                       .substring(0, 16)
        };

        console.log(`  Extracted ${steps.length} steps`);

        return workflowData;
    } catch (error) {
        console.error(`Error capturing workflow ${workflowItem}:`, error.message);
        return {
            wf_item: workflowItem,
            error: error.message,
            timestamp: new Date().toISOString(),
            steps: []
        };
    }
}

async function main() {
    const browser = await chromium.launchPersistentContext(
        'C:\\Users\\Split Lease\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1',
        {
            channel: 'chrome',
            headless: false,
            viewport: { width: 1920, height: 1080 }
        }
    );

    const page = browser.pages()[0] || await browser.newPage();

    // Navigate to Bubble.io editor
    await page.goto('https://bubble.io/page?id=pluginmarketplace&tab=tabs-2', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });

    console.log('Navigated to Bubble.io editor');
    await waitForBubbleEditor(page);

    // Define test workflows
    const testWorkflows = [
        'core-ai-credits-add-ai-credits-to-user',
        'core-ai-credits-deduct-ai-credits-from-user'
    ];

    const results = {
        captureDate: new Date().toISOString(),
        version: '3.0',
        workflows: [],
        summary: {
            total: 0,
            successful: 0,
            failed: 0,
            totalSteps: 0
        }
    };

    // Process each workflow
    for (let i = 0; i < testWorkflows.length; i++) {
        const workflowData = await captureWorkflow(page, testWorkflows[i], i);
        results.workflows.push(workflowData);

        if (workflowData.error) {
            results.summary.failed++;
        } else {
            results.summary.successful++;
            results.summary.totalSteps += workflowData.stepCount;
        }

        // Wait between workflows
        await page.waitForTimeout(2000);
    }

    results.summary.total = testWorkflows.length;

    // Save results
    const outputDir = path.join(__dirname, 'workflow-json-output');
    await fs.mkdir(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, `workflows-${Date.now()}.json`);
    await fs.writeFile(outputFile, JSON.stringify(results, null, 2));

    console.log('\n=== Extraction Complete ===');
    console.log(`Total workflows: ${results.summary.total}`);
    console.log(`Successful: ${results.summary.successful}`);
    console.log(`Failed: ${results.summary.failed}`);
    console.log(`Total steps extracted: ${results.summary.totalSteps}`);
    console.log(`Output saved to: ${outputFile}`);

    await browser.close();
}

main().catch(console.error);