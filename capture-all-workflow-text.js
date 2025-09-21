const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const { uploadFolderToGoogleDrive } = require('./upload-folder-to-gdrive');

async function captureAllWorkflowText() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    const MAX_WORKFLOWS = null;

    console.log('Opening Chrome for text capture...');

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

    await page.waitForTimeout(5000);

    const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const captureDir = path.join(__dirname, 'workflow-text-captures', `session-${sessionTimestamp}`);
    try {
        await fs.mkdir(captureDir, { recursive: true });
        console.log(`Created session capture directory: ${captureDir}`);
    } catch (err) {
        console.log('Error creating capture directory:', err);
    }

    console.log('Expanding all folders...');

    const expandButtons = await page.$$('div[role="button"] svg');
    console.log(`Found ${expandButtons.length} expand buttons`);

    for (let i = 1; i < expandButtons.length && i < 30; i++) {
        try {
            await expandButtons[i].click();
            await page.waitForTimeout(200);
            console.log(`Expanded folder ${i}`);
        } catch (err) {
        }
    }

    if (expandButtons.length > 0) {
        try {
            await expandButtons[0].click();
            await page.waitForTimeout(200);
            console.log('Ensured Uncategorized is expanded');
        } catch (err) {
        }
    }

    await page.waitForTimeout(3000);

    console.log('\n=== Starting Workflow Text Capture ===\n');

    const workflowData = [];
    const processedUrls = new Set();

    const workflowSelectors = [
        'div[class*="tree-item"] span:not([class*="folder"])',
        'div[class*="workflow-item"]',
        'span[class*="workflow-name"]',
        'div.list-item span',
        'div[role="treeitem"] span'
    ];

    let totalCaptures = 0;

    for (const selector of workflowSelectors) {
        const elements = await page.$$(selector);
        console.log(`Found ${elements.length} elements with selector: ${selector}`);

        for (const element of elements) {
            try {
                const text = await element.textContent();

                if (!text ||
                    text.match(/^\d+$/) ||
                    text.includes('×') ||
                    text.includes('folder') ||
                    text.length < 3 ||
                    text.length > 100) {
                    continue;
                }

                const box = await element.boundingBox();
                if (!box || box.x > 500) {
                    continue;
                }

                await element.click();
                await page.waitForTimeout(1500);

                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const wfItem = urlObj.searchParams.get('wf_item');

                if (wfItem && !processedUrls.has(wfItem)) {
                    processedUrls.add(wfItem);

                    console.log(`\nCapturing workflow: ${text.trim()}`);

                    const workflowContent = await captureWorkflowElements(page);

                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                    const safeName = text.trim()
                        .replace(/[^a-zA-Z0-9-_]/g, '_')
                        .replace(/_+/g, '_')
                        .substring(0, 50);

                    const textFileName = `${timestamp}_${safeName}_${wfItem}.json`;
                    const textFilePath = path.join(captureDir, textFileName);

                    await fs.writeFile(textFilePath, JSON.stringify(workflowContent, null, 2));

                    totalCaptures++;

                    const workflowInfo = {
                        name: text.trim(),
                        wf_item: wfItem,
                        full_url: currentUrl,
                        capture_file: textFileName,
                        index: workflowData.length + 1,
                        stats: {
                            total_elements: workflowContent.elements?.length || 0,
                            total_actions: workflowContent.actions?.length || 0,
                            total_triggers: workflowContent.triggers?.length || 0,
                            conditions_count: workflowContent.conditions?.length || 0,
                            custom_events: workflowContent.custom_events?.length || 0
                        }
                    };

                    workflowData.push(workflowInfo);

                    console.log(`${totalCaptures}. ${text.trim()}`);
                    console.log(`   ID: ${wfItem}`);
                    console.log(`   Elements captured: ${workflowInfo.stats.total_elements}`);
                    console.log(`   Actions: ${workflowInfo.stats.total_actions}`);
                    console.log(`   File: ${textFileName}`);

                    if (MAX_WORKFLOWS && totalCaptures >= MAX_WORKFLOWS) {
                        console.log(`\nReached maximum of ${MAX_WORKFLOWS} workflows, stopping...`);
                        break;
                    }
                }
            } catch (err) {
                console.log(`Error processing workflow: ${err.message}`);
            }
        }

        if (MAX_WORKFLOWS && totalCaptures >= MAX_WORKFLOWS) {
            break;
        }
    }

    const outputPath = path.join(captureDir, 'workflow-text-summary.json');
    await fs.writeFile(outputPath, JSON.stringify(workflowData, null, 2));

    console.log(`\n=== Text Capture Complete ===`);
    console.log(`Total workflows captured: ${totalCaptures}`);
    console.log(`Session directory: ${captureDir}`);
    console.log(`Summary saved to: ${outputPath}`);

    const csvPath = path.join(captureDir, 'workflow-text-summary.csv');
    const csvContent = 'Index,Workflow Name,wf_item ID,Elements,Actions,Triggers,Conditions,Custom Events,Capture File\n' +
        workflowData.map(w =>
            `${w.index},"${w.name}","${w.wf_item}",${w.stats.total_elements},${w.stats.total_actions},${w.stats.total_triggers},${w.stats.conditions_count},${w.stats.custom_events},"${w.capture_file}"`
        ).join('\n');

    await fs.writeFile(csvPath, csvContent);
    console.log(`CSV saved to: ${csvPath}`);

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

    const totalStats = workflowData.reduce((acc, w) => {
        acc.total_elements += w.stats.total_elements;
        acc.total_actions += w.stats.total_actions;
        acc.total_triggers += w.stats.total_triggers;
        acc.conditions_count += w.stats.conditions_count;
        acc.custom_events += w.stats.custom_events;
        return acc;
    }, {
        total_elements: 0,
        total_actions: 0,
        total_triggers: 0,
        conditions_count: 0,
        custom_events: 0
    });

    console.log('\nOverall Statistics:');
    console.log(`  Total Elements: ${totalStats.total_elements}`);
    console.log(`  Total Actions: ${totalStats.total_actions}`);
    console.log(`  Total Triggers: ${totalStats.total_triggers}`);
    console.log(`  Total Conditions: ${totalStats.conditions_count}`);
    console.log(`  Total Custom Events: ${totalStats.custom_events}`);

    console.log('\nClosing browser...');
    await context.close();

    console.log('\n=== Uploading to Google Drive ===');
    console.log('Starting automatic upload to Google Drive...');

    try {
        const uploadSuccess = await uploadFolderToGoogleDrive(captureDir, {
            pattern: '*',
            deleteAfterUpload: false,
            showProgress: true,
            createSubfolder: true
        });

        if (uploadSuccess) {
            console.log('\n=== Process Complete ===');
            console.log('Text captures uploaded to Google Drive successfully!');

            const folderName = path.basename(captureDir);
            const newFolderPath = path.join(
                path.dirname(captureDir),
                `gdrive_${folderName}`
            );
            console.log(`Local copy available at: ${newFolderPath}`);
        } else {
            console.log('\n=== Upload Warning ===');
            console.log('Google Drive upload may have had issues.');
            console.log(`Text captures are still available locally at: ${captureDir}`);
        }
    } catch (uploadError) {
        console.error('\n=== Upload Error ===');
        console.error('Failed to upload to Google Drive:', uploadError.message);
        console.log('Text captures are still available locally at:', captureDir);
        console.log('\nYou can manually upload later using:');
        console.log(`node upload-folder-to-gdrive.js "${captureDir}"`);
    }

    console.log('\n=== All tasks completed ===');
}

async function captureWorkflowElements(page) {
    const workflowContent = {
        timestamp: new Date().toISOString(),
        url: page.url(),
        elements: [],
        actions: [],
        triggers: [],
        conditions: [],
        custom_events: [],
        workflow_properties: {},
        raw_text: []
    };

    try {
        await page.waitForTimeout(1000);

        const workflowNameElement = await page.$('h1, h2, [class*="workflow-title"], [class*="workflow-name"]');
        if (workflowNameElement) {
            workflowContent.workflow_properties.name = await workflowNameElement.textContent();
        }

        const descriptionElement = await page.$('[class*="description"], [class*="workflow-description"]');
        if (descriptionElement) {
            workflowContent.workflow_properties.description = await descriptionElement.textContent();
        }

        const actionElements = await page.$$('[class*="action"], [class*="workflow-action"], [data-action], [class*="step"]');
        for (const element of actionElements) {
            try {
                const actionText = await element.textContent();
                if (actionText && actionText.trim()) {
                    const actionType = await element.getAttribute('data-action-type') ||
                                     await element.getAttribute('class') ||
                                     'unknown';

                    const actionData = {
                        text: actionText.trim(),
                        type: actionType,
                        properties: {}
                    };

                    const inputs = await element.$$('input, select, textarea');
                    for (const input of inputs) {
                        const name = await input.getAttribute('name') || await input.getAttribute('id');
                        const value = await input.getAttribute('value') || await input.textContent();
                        if (name) {
                            actionData.properties[name] = value;
                        }
                    }

                    workflowContent.actions.push(actionData);
                }
            } catch (err) {
                console.log('Error capturing action:', err.message);
            }
        }

        const triggerElements = await page.$$('[class*="trigger"], [class*="workflow-trigger"], [data-trigger]');
        for (const element of triggerElements) {
            try {
                const triggerText = await element.textContent();
                if (triggerText && triggerText.trim()) {
                    workflowContent.triggers.push({
                        text: triggerText.trim(),
                        type: await element.getAttribute('data-trigger-type') || 'unknown'
                    });
                }
            } catch (err) {
                console.log('Error capturing trigger:', err.message);
            }
        }

        const conditionElements = await page.$$('[class*="condition"], [class*="if-then"], [class*="when"]');
        for (const element of conditionElements) {
            try {
                const conditionText = await element.textContent();
                if (conditionText && conditionText.trim()) {
                    workflowContent.conditions.push({
                        text: conditionText.trim(),
                        type: await element.getAttribute('data-condition-type') || 'unknown'
                    });
                }
            } catch (err) {
                console.log('Error capturing condition:', err.message);
            }
        }

        const eventElements = await page.$$('[class*="event"], [class*="custom-event"], [data-event]');
        for (const element of eventElements) {
            try {
                const eventText = await element.textContent();
                if (eventText && eventText.trim()) {
                    workflowContent.custom_events.push({
                        text: eventText.trim(),
                        type: await element.getAttribute('data-event-type') || 'unknown'
                    });
                }
            } catch (err) {
                console.log('Error capturing event:', err.message);
            }
        }

        const mainContentArea = await page.$('main, [role="main"], .workflow-content, .content-area, #workflow-canvas');
        if (mainContentArea) {
            const allTextElements = await mainContentArea.$$('div, span, p, li, label, button');
            for (const element of allTextElements) {
                try {
                    const text = await element.textContent();
                    if (text && text.trim() && text.length > 3 && text.length < 500) {
                        const isVisible = await element.isVisible();
                        if (isVisible) {
                            workflowContent.raw_text.push(text.trim());
                        }
                    }
                } catch (err) {
                }
            }
        }

        const uniqueRawText = [...new Set(workflowContent.raw_text)];
        workflowContent.raw_text = uniqueRawText;

        const genericElements = await page.$$('[data-element], [data-component], .workflow-element');
        for (const element of genericElements) {
            try {
                const elementText = await element.textContent();
                const elementType = await element.getAttribute('data-element-type') ||
                                  await element.getAttribute('data-component-type') ||
                                  'generic';

                if (elementText && elementText.trim()) {
                    workflowContent.elements.push({
                        text: elementText.trim(),
                        type: elementType,
                        classes: await element.getAttribute('class'),
                        id: await element.getAttribute('id')
                    });
                }
            } catch (err) {
            }
        }

    } catch (err) {
        console.log('Error during element capture:', err.message);
    }

    return workflowContent;
}

captureAllWorkflowText().catch(console.error);