const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const { uploadFolderToGoogleDrive } = require('./upload-folder-to-gdrive');

async function screenshotAllWorkflows() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    // Configuration - set to null to capture all workflows
    const MAX_SCREENSHOTS = null; // Set to a number (e.g., 250) to limit, or null for no limit
    const CAPTURE_WORKFLOW_STEPS = true; // Set to true to capture individual workflow steps
    const STEP_WAIT_TIME = 1000; // Time to wait after clicking each step

    console.log('Opening Chrome with 1440x3600 resolution...');

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1440, height: 3600 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--window-size=1440,3600'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await context.newPage();
    await page.goto(bubbleUrl);

    // Wait for page to load
    await page.waitForTimeout(5000);

    // Create timestamped directory for this session's screenshots
    const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const screenshotDir = path.join(__dirname, 'workflow-screenshots', `session-${sessionTimestamp}`);
    try {
        await fs.mkdir(screenshotDir, { recursive: true });
        console.log(`Created session screenshot directory: ${screenshotDir}`);
    } catch (err) {
        console.log('Error creating screenshot directory:', err);
    }

    console.log('Expanding all folders...');

    // Expand all folders - skip first one if Uncategorized is already open
    const expandButtons = await page.$$('div[role="button"] svg');
    console.log(`Found ${expandButtons.length} expand buttons`);

    // Start from index 1 to skip already-open Uncategorized
    for (let i = 1; i < expandButtons.length && i < 30; i++) {
        try {
            await expandButtons[i].click();
            await page.waitForTimeout(200);
            console.log(`Expanded folder ${i}`);
        } catch (err) {
            // Continue
        }
    }

    // Ensure Uncategorized is expanded
    if (expandButtons.length > 0) {
        try {
            await expandButtons[0].click();
            await page.waitForTimeout(200);
            console.log('Ensured Uncategorized is expanded');
        } catch (err) {
            // Continue
        }
    }

    await page.waitForTimeout(3000);

    console.log('\n=== Starting Workflow Screenshot Capture ===\n');

    const workflowData = [];
    const processedUrls = new Set();

    // Find all workflow items
    const workflowSelectors = [
        'div[class*="tree-item"] span:not([class*="folder"])',
        'div[class*="workflow-item"]',
        'span[class*="workflow-name"]',
        'div.list-item span',
        'div[role="treeitem"] span'
    ];

    let totalScreenshots = 0;

    for (const selector of workflowSelectors) {
        const elements = await page.$$(selector);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);

        for (const element of elements) {
            try {
                const text = await element.textContent();

                // Filter out non-workflow items
                if (!text ||
                    text.match(/^\d+$/) || // Just numbers
                    text.includes('×') || // Count indicators
                    text.includes('folder') || // Folder names
                    text.length < 3 || // Too short
                    text.length > 100) { // Too long
                    continue;
                }

                // Check if it's in the sidebar
                const box = await element.boundingBox();
                if (!box || box.x > 500) {
                    continue;
                }

                // Click the workflow
                await element.click();
                await page.waitForTimeout(1000); // Wait a bit longer for content to load

                // Get the URL and extract wf_item
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const wfItem = urlObj.searchParams.get('wf_item');

                if (wfItem && !processedUrls.has(wfItem)) {
                    processedUrls.add(wfItem);

                    // Generate timestamp
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

                    // Sanitize workflow name for filename
                    const safeName = text.trim()
                        .replace(/[^a-zA-Z0-9-_]/g, '_') // Replace special chars with underscore
                        .replace(/_+/g, '_') // Replace multiple underscores with single
                        .substring(0, 50); // Limit length

                    // Create workflow-specific directory if capturing steps
                    let workflowDir = screenshotDir;
                    if (CAPTURE_WORKFLOW_STEPS) {
                        workflowDir = path.join(screenshotDir, `${safeName}_${wfItem}`);
                        await fs.mkdir(workflowDir, { recursive: true });
                    }

                    // Create screenshot filename: timestamp_name-of-wf_wf_item.png
                    const screenshotName = CAPTURE_WORKFLOW_STEPS
                        ? `00_overview_${timestamp}.png`
                        : `${timestamp}_${safeName}_${wfItem}.png`;
                    const screenshotPath = path.join(workflowDir, screenshotName);

                    // Take overview screenshot
                    await page.screenshot({
                        path: screenshotPath,
                        fullPage: false // Just the viewport
                    });

                    totalScreenshots++;

                    // Capture individual workflow steps if enabled
                    let stepData = [];
                    if (CAPTURE_WORKFLOW_STEPS) {
                        console.log(`   Capturing workflow steps...`);

                        // Find and click workflow steps/actions
                        // Based on HTML analysis, Bubble workflow steps:
                        // - Have text starting with "Step X"
                        // - Are in the main content area (x > 600)
                        // - Have data-id attributes
                        const stepSelectors = [
                            // Primary selector - elements with data-id containing Step text
                            '[data-id]:has-text("Step")',
                            'div[data-id]',

                            // Text-based selectors for Step elements
                            'div:has-text("Step 1")',
                            'div:has-text("Step 2")',
                            'div:has-text("Step 3")',
                            'div:has-text("Step 4")',
                            'div:has-text("Step 5")',

                            // Generic text pattern
                            'text=/Step \\d+/',

                            // Class-based selectors from analysis
                            'div[class*="_1ql74v3"]',
                            'div[class*="_5r6zug"]',
                            'div[class*="_1mig948"]',

                            // Fallback selectors
                            'div:has-text("Add ")',
                            'div:has-text("Create ")',
                            'div:has-text("Update ")',
                            'div:has-text("Delete ")',
                            'div:has-text("Send ")',
                            'div:has-text("Make changes")'
                        ];

                        let stepCount = 0;

                        // First, let's try to find any clickable elements in the workflow area
                        console.log(`   Looking for workflow steps...`);

                        // Debug: Find all clickable elements in the main content area
                        const allClickables = await page.$$('div[role="button"], div[tabindex], [class*="clickable"], [class*="selectable"]');
                        console.log(`   Found ${allClickables.length} total clickable elements`);

                        // Filter to main content area only
                        let mainAreaClickables = [];
                        for (const elem of allClickables) {
                            const box = await elem.boundingBox();
                            if (box && box.x > 500) {
                                mainAreaClickables.push(elem);
                            }
                        }
                        console.log(`   Found ${mainAreaClickables.length} clickable elements in main content area`);

                        // Try multiple selectors to find workflow steps
                        for (const stepSelector of stepSelectors) {
                            try {
                                const steps = await page.$$(stepSelector);

                                if (steps.length > 0) {
                                    console.log(`   Found ${steps.length} elements with selector: ${stepSelector}`);
                                    for (let i = 0; i < steps.length; i++) {
                                        try {
                                            // Check if element is visible and within the main content area
                                            const stepBox = await steps[i].boundingBox();
                                            if (!stepBox || stepBox.x < 600) {
                                                continue; // Skip sidebar elements (workflow steps are at x > 700)
                                            }

                                            // Get step text if available
                                            let stepText = '';
                                            try {
                                                stepText = await steps[i].textContent() || `Step ${i + 1}`;
                                                stepText = stepText.trim().substring(0, 50);
                                            } catch {
                                                stepText = `Step ${i + 1}`;
                                            }

                                            // Click the step to expand it
                                            await steps[i].click();
                                            await page.waitForTimeout(STEP_WAIT_TIME);

                                            stepCount++;

                                            // Generate step screenshot name
                                            const stepTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                                            const stepScreenshotName = `step_${String(stepCount).padStart(2, '0')}_${stepText.replace(/[^a-zA-Z0-9]/g, '_')}_${stepTimestamp}.png`;
                                            const stepPath = path.join(workflowDir, stepScreenshotName);

                                            // Take screenshot of expanded step
                                            await page.screenshot({
                                                path: stepPath,
                                                fullPage: false
                                            });

                                            stepData.push({
                                                stepNumber: stepCount,
                                                stepText: stepText,
                                                screenshot: stepScreenshotName
                                            });

                                            console.log(`     Step ${stepCount}: ${stepText}`);

                                            // Try to collapse the step if possible
                                            try {
                                                await steps[i].click();
                                                await page.waitForTimeout(300);
                                            } catch {
                                                // If we can't collapse, that's okay
                                            }

                                        } catch (stepErr) {
                                            // Continue processing other steps
                                        }
                                    }

                                    // If we found steps with this selector, break out
                                    if (stepCount > 0) {
                                        break;
                                    }
                                }
                            } catch (err) {
                                // Try next selector
                            }
                        }

                        if (stepCount > 0) {
                            console.log(`   Captured ${stepCount} workflow steps`);
                        }
                    }

                    const workflowInfo = {
                        name: text.trim(),
                        wf_item: wfItem,
                        full_url: currentUrl,
                        screenshot: screenshotName,
                        index: workflowData.length + 1,
                        ...(CAPTURE_WORKFLOW_STEPS && {
                            directory: `${safeName}_${wfItem}`,
                            totalSteps: stepData.length,
                            steps: stepData
                        })
                    };

                    workflowData.push(workflowInfo);

                    console.log(`${totalScreenshots}. ${text.trim()}`);
                    console.log(`   ID: ${wfItem}`);
                    console.log(`   Screenshot: ${screenshotName}`);

                    // Check if we've reached the maximum (if set)
                    if (MAX_SCREENSHOTS && totalScreenshots >= MAX_SCREENSHOTS) {
                        console.log(`\nReached maximum of ${MAX_SCREENSHOTS} workflows, stopping...`);
                        break;
                    }
                }
            } catch (err) {
                console.log(`Error processing workflow: ${err.message}`);
                // Continue to next element
            }
        }

        // Check if we've reached the maximum (if set)
        if (MAX_SCREENSHOTS && totalScreenshots >= MAX_SCREENSHOTS) {
            break;
        }
    }

    // If we haven't found many, try more specific approach
    if (totalScreenshots < 20) {
        console.log('\nTrying more specific selectors...');

        const prefixes = ['core', 'CORE', 'L2', 'L3', 'daily', 'signup', 'update', 'create', 'delete'];

        for (const prefix of prefixes) {
            const items = await page.$$(`text=/^${prefix}/`);

            for (const item of items) {
                try {
                    const text = await item.textContent();
                    const box = await item.boundingBox();

                    if (box && box.x < 500) {
                        await item.click();
                        await page.waitForTimeout(1000);

                        const currentUrl = page.url();
                        const urlObj = new URL(currentUrl);
                        const wfItem = urlObj.searchParams.get('wf_item');

                        if (wfItem && !processedUrls.has(wfItem)) {
                            processedUrls.add(wfItem);

                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                            const safeName = text.trim()
                                .replace(/[^a-zA-Z0-9-_]/g, '_')
                                .replace(/_+/g, '_')
                                .substring(0, 50);

                            // Create workflow-specific directory if capturing steps
                            let workflowDir = screenshotDir;
                            if (CAPTURE_WORKFLOW_STEPS) {
                                workflowDir = path.join(screenshotDir, `${safeName}_${wfItem}`);
                                await fs.mkdir(workflowDir, { recursive: true });
                            }

                            const screenshotName = CAPTURE_WORKFLOW_STEPS
                                ? `00_overview_${timestamp}.png`
                                : `${timestamp}_${safeName}_${wfItem}.png`;
                            const screenshotPath = path.join(workflowDir, screenshotName);

                            await page.screenshot({
                                path: screenshotPath,
                                fullPage: false
                            });

                            totalScreenshots++;

                            // Capture individual workflow steps if enabled
                            let stepData = [];
                            if (CAPTURE_WORKFLOW_STEPS) {
                                console.log(`   Capturing workflow steps...`);

                                // Same step capturing logic as above
                                const stepSelectors = [
                                    // Based on HTML analysis
                                    '[data-id]:has-text("Step")',
                                    'div[data-id]',
                                    'div:has-text("Step 1")',
                                    'div:has-text("Step 2")',
                                    'div:has-text("Step 3")',
                                    'div:has-text("Step 4")',
                                    'div:has-text("Step 5")',
                                    'text=/Step \\d+/',
                                    'div[class*="_1ql74v3"]',
                                    'div[class*="_5r6zug"]',
                                    'div[class*="_1mig948"]',
                                    'div:has-text("Add ")',
                                    'div:has-text("Create ")',
                                    'div:has-text("Update ")',
                                    'div:has-text("Delete ")',
                                    'div:has-text("Send ")',
                                    'div:has-text("Make changes")'
                                ];

                                let stepCount = 0;

                                console.log(`   Looking for workflow steps...`);

                                // Debug: Find clickable elements
                                const allClickables = await page.$$('div[role="button"], div[tabindex], [class*="clickable"], [class*="selectable"]');
                                console.log(`   Found ${allClickables.length} total clickable elements`);

                                let mainAreaClickables = [];
                                for (const elem of allClickables) {
                                    const box = await elem.boundingBox();
                                    if (box && box.x > 500) {
                                        mainAreaClickables.push(elem);
                                    }
                                }
                                console.log(`   Found ${mainAreaClickables.length} clickable elements in main content area`);

                                for (const stepSelector of stepSelectors) {
                                    try {
                                        const steps = await page.$$(stepSelector);

                                        if (steps.length > 0) {
                                            for (let i = 0; i < steps.length; i++) {
                                                try {
                                                    const stepBox = await steps[i].boundingBox();
                                                    if (!stepBox || stepBox.x < 500) {
                                                        continue;
                                                    }

                                                    let stepText = '';
                                                    try {
                                                        stepText = await steps[i].textContent() || `Step ${i + 1}`;
                                                        stepText = stepText.trim().substring(0, 50);
                                                    } catch {
                                                        stepText = `Step ${i + 1}`;
                                                    }

                                                    await steps[i].click();
                                                    await page.waitForTimeout(STEP_WAIT_TIME);

                                                    stepCount++;

                                                    const stepTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                                                    const stepScreenshotName = `step_${String(stepCount).padStart(2, '0')}_${stepText.replace(/[^a-zA-Z0-9]/g, '_')}_${stepTimestamp}.png`;
                                                    const stepPath = path.join(workflowDir, stepScreenshotName);

                                                    await page.screenshot({
                                                        path: stepPath,
                                                        fullPage: false
                                                    });

                                                    stepData.push({
                                                        stepNumber: stepCount,
                                                        stepText: stepText,
                                                        screenshot: stepScreenshotName
                                                    });

                                                    console.log(`     Step ${stepCount}: ${stepText}`);

                                                    try {
                                                        await steps[i].click();
                                                        await page.waitForTimeout(300);
                                                    } catch {
                                                        // If we can't collapse, that's okay
                                                    }

                                                } catch (stepErr) {
                                                    // Continue
                                                }
                                            }

                                            if (stepCount > 0) {
                                                break;
                                            }
                                        }
                                    } catch (err) {
                                        // Try next selector
                                    }
                                }

                                if (stepCount > 0) {
                                    console.log(`   Captured ${stepCount} workflow steps`);
                                }
                            }

                            workflowData.push({
                                name: text.trim(),
                                wf_item: wfItem,
                                full_url: currentUrl,
                                screenshot: screenshotName,
                                index: workflowData.length + 1,
                                ...(CAPTURE_WORKFLOW_STEPS && {
                                    directory: `${safeName}_${wfItem}`,
                                    totalSteps: stepData.length,
                                    steps: stepData
                                })
                            });

                            console.log(`${totalScreenshots}. ${text.trim()}`);
                            console.log(`   ID: ${wfItem}`);
                            console.log(`   Screenshot: ${screenshotName}`);

                            // Check if we've reached the maximum (if set)
                            if (MAX_SCREENSHOTS && totalScreenshots >= MAX_SCREENSHOTS) {
                                break;
                            }
                        }
                    }
                } catch (err) {
                    // Continue
                }
            }

            // Check if we've reached the maximum (if set)
            if (MAX_SCREENSHOTS && totalScreenshots >= MAX_SCREENSHOTS) {
                break;
            }
        }
    }

    // Save results with screenshot info in the session directory
    const outputPath = path.join(screenshotDir, 'workflow-data.json');
    await fs.writeFile(outputPath, JSON.stringify(workflowData, null, 2));

    console.log(`\n=== Screenshot Capture Complete ===`);
    console.log(`Total workflows captured: ${totalScreenshots}`);
    console.log(`Session directory: ${screenshotDir}`);
    console.log(`Data saved to: ${outputPath}`);

    // Create CSV with screenshot info in the session directory
    const csvPath = path.join(screenshotDir, 'workflow-data.csv');
    const csvContent = 'Index,Workflow Name,wf_item ID,Screenshot Filename\n' +
        workflowData.map(w => `${w.index},"${w.name}","${w.wf_item}","${w.screenshot}"`).join('\n');

    await fs.writeFile(csvPath, csvContent);
    console.log(`CSV saved to: ${csvPath}`);

    // Create summary
    const summary = {};
    workflowData.forEach(w => {
        const prefix = w.name.split('-')[0].split('_')[0].trim();
        summary[prefix] = (summary[prefix] || 0) + 1;
    });

    console.log('\nWorkflow distribution:');
    Object.entries(summary)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([prefix, count]) => {
            console.log(`  ${prefix}: ${count} workflows`);
        });

    // Upload to Google Drive
    console.log('\n=== Uploading to Google Drive ===');

    // Ask user if they want to upload
    console.log('The screenshots have been saved locally.');
    console.log('Starting automatic upload to Google Drive...');

    try {
        // Close the browser before uploading
        await context.close();

        // Upload the entire session folder to Google Drive
        // This will create a subfolder with the session name (e.g., session-2025-09-21T10-30-45)
        const uploadSuccess = await uploadFolderToGoogleDrive(screenshotDir, {
            pattern: '*',
            deleteAfterUpload: false,
            showProgress: true,
            createSubfolder: true // Creates subfolder with same name as local folder
        });

        if (uploadSuccess) {
            console.log('\n=== Process Complete ===');
            console.log('Screenshots captured and uploaded to Google Drive successfully!');

            // The folder has been renamed with gdrive_ prefix
            const folderName = path.basename(screenshotDir);
            const newFolderPath = path.join(
                path.dirname(screenshotDir),
                `gdrive_${folderName}`
            );
            console.log(`Local copy available at: ${newFolderPath}`);
        } else {
            console.log('\n=== Upload Warning ===');
            console.log('Google Drive upload may have had issues.');
            console.log(`Screenshots are still available locally at: ${screenshotDir}`);
        }
    } catch (uploadError) {
        console.error('\n=== Upload Error ===');
        console.error('Failed to upload to Google Drive:', uploadError.message);
        console.log('Screenshots are still available locally at:', screenshotDir);
        console.log('\nYou can manually upload later using:');
        console.log(`node upload-folder-to-gdrive.js "${screenshotDir}"`);
    }
}

screenshotAllWorkflows().catch(console.error);