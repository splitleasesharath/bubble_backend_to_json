const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

async function waitForBubbleEditor(page) {
    console.log('Waiting for Bubble.io editor to load...');

    try {
        // Wait for any element that indicates the editor is loaded
        await page.waitForSelector('div, canvas', {
            timeout: 10000,
            state: 'visible'
        });

        // Give dynamic content time to render
        await page.waitForTimeout(5000);
        console.log('Editor loaded');
    } catch (error) {
        console.log('Editor wait timeout - continuing');
    }
}

async function clickWorkflowSafely(page, workflowName) {
    console.log(`Attempting to click workflow: ${workflowName}`);

    // Try multiple selector strategies
    const selectors = [
        `text="${workflowName}"`,
        `div:has-text("${workflowName}")`,
        `span:has-text("${workflowName}")`,
        `[class*="item"]:has-text("${workflowName}")`,
        `[class*="workflow"]:has-text("${workflowName}")`
    ];

    for (const selector of selectors) {
        try {
            const element = await page.$(selector);
            if (element) {
                const isVisible = await element.isVisible();
                if (isVisible) {
                    await element.click();
                    console.log(`Successfully clicked using selector: ${selector}`);
                    return true;
                }
            }
        } catch (error) {
            // Try next selector
        }
    }

    // If direct click fails, try to find in the sidebar
    console.log('Direct click failed, searching in sidebar...');
    try {
        // Look for the workflow in the left sidebar
        const sidebarItems = await page.$$('div[class*="sidebar"] div, div[class*="left"] div');
        for (const item of sidebarItems) {
            const text = await item.textContent();
            if (text && text.includes(workflowName)) {
                const isVisible = await item.isVisible();
                if (isVisible) {
                    await item.click();
                    console.log('Clicked workflow in sidebar');
                    return true;
                }
            }
        }
    } catch (error) {
        console.log('Sidebar search error:', error.message);
    }

    return false;
}

async function extractWorkflowSteps(page) {
    console.log('Extracting workflow steps...');

    // Use evaluate to extract all step data at once
    const steps = await page.evaluate(() => {
        const results = [];

        // Find all elements that might be workflow steps
        const allElements = document.querySelectorAll('div');
        const seenTexts = new Set();

        for (const el of allElements) {
            const rect = el.getBoundingClientRect();

            // Filter by position - center canvas area
            if (rect.x < 250 || rect.x > 1450 || rect.width === 0 || rect.height === 0) {
                continue;
            }

            const text = el.textContent || '';
            const trimmedText = text.trim();

            // Skip if empty or too long
            if (!trimmedText || trimmedText.length > 500) {
                continue;
            }

            // Skip navigation items
            if (trimmedText.includes('Backend Workflows') ||
                trimmedText.includes('IN THIS APP') ||
                trimmedText.includes('Uncategorized') ||
                trimmedText.match(/^\d+$/)) {
                continue;
            }

            // Look for action-like text
            const lines = trimmedText.split('\n').map(l => l.trim()).filter(l => l);
            for (const line of lines) {
                if (line.length > 3 &&
                    line.length < 100 &&
                    !seenTexts.has(line) &&
                    (line.includes('Add') ||
                     line.includes('Deduct') ||
                     line.includes('Create') ||
                     line.includes('Update') ||
                     line.includes('Delete') ||
                     line.includes('Send') ||
                     line.includes('Get') ||
                     line.includes('Set') ||
                     line.includes('Check') ||
                     line.includes('Credits') ||
                     line.includes('User'))) {

                    seenTexts.add(line);
                    results.push({
                        title: line,
                        position: { x: Math.round(rect.x), y: Math.round(rect.y) },
                        size: { width: Math.round(rect.width), height: Math.round(rect.height) }
                    });
                }
            }
        }

        return results;
    });

    console.log(`  Found ${steps.length} unique steps`);
    return steps;
}

async function captureWorkflow(page, workflowItem, index) {
    console.log(`\nProcessing workflow ${index + 1}: ${workflowItem}`);

    try {
        // Try to click on the workflow
        const clicked = await clickWorkflowSafely(page, workflowItem);

        if (!clicked) {
            console.log(`Could not find/click workflow: ${workflowItem}`);
            // Still try to extract what's visible
        }

        // Wait for any updates
        await page.waitForTimeout(3000);

        // Extract steps
        const steps = await extractWorkflowSteps(page);

        // Take a screenshot for debugging
        const screenshotDir = path.join(__dirname, 'debug-screenshots');
        await fs.mkdir(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `workflow-${index + 1}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  Screenshot saved: ${screenshotPath}`);

        // Generate workflow data
        const workflowData = {
            wf_item: workflowItem,
            name: workflowItem,
            timestamp: new Date().toISOString(),
            steps: steps,
            stepCount: steps.length,
            hash: crypto.createHash('sha256')
                       .update(JSON.stringify(steps))
                       .digest('hex')
                       .substring(0, 16)
        };

        console.log(`  Extracted ${steps.length} steps`);
        if (steps.length > 0) {
            console.log(`  First step: "${steps[0].title}"`);
        }

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

    // Take initial screenshot
    const screenshotDir = path.join(__dirname, 'debug-screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
        path: path.join(screenshotDir, 'initial-page.png'),
        fullPage: false
    });

    // Try to extract what's currently visible first
    console.log('\n=== Extracting visible content ===');
    const visibleSteps = await extractWorkflowSteps(page);
    console.log(`Found ${visibleSteps.length} steps on current page`);

    // Define test workflows
    const testWorkflows = [
        'core-ai-credits-add-ai-credits-to-user',
        'core-ai-credits-deduct-ai-credits-from-user'
    ];

    const results = {
        captureDate: new Date().toISOString(),
        version: '4.0',
        initialPageSteps: visibleSteps,
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
    console.log(`Initial page steps: ${visibleSteps.length}`);
    console.log(`Output saved to: ${outputFile}`);

    // Keep browser open for inspection
    console.log('\nBrowser will remain open for 10 seconds for inspection...');
    await page.waitForTimeout(10000);

    await browser.close();
}

main().catch(console.error);