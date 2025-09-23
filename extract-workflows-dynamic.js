const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Dynamic Workflow Extractor
 * Following the holy iteration approach from Backend_agentic_screenshotter
 *
 * This script:
 * 1. Expands all folders to see all workflows
 * 2. Finds workflow elements dynamically in the sidebar
 * 3. Clicks each workflow sequentially
 * 4. Extracts data from what's currently on screen
 * 5. Handles new/deleted workflows automatically
 */

class DynamicWorkflowExtractor {
    constructor() {
        this.outputDir = path.join(__dirname, 'extracted-workflows-dynamic');
        this.profilePath = path.join(__dirname, 'browser-profiles', 'default');
        this.bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&version=test';
        this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    async launch() {
        console.log('🚀 Starting Dynamic Workflow Extraction...');
        console.log('📅 Session:', this.sessionTimestamp);

        const context = await chromium.launchPersistentContext(this.profilePath, {
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
        await page.goto(this.bubbleUrl);

        console.log('⏳ Waiting for page to load...');
        await page.waitForTimeout(5000);

        return { context, page };
    }

    async expandAllFolders(page) {
        console.log('\n📂 Expanding all folders...');

        // Find all expand buttons
        const expandButtons = await page.$$('div[role="button"] svg');
        console.log(`Found ${expandButtons.length} expand buttons`);

        // Expand all folders (skip first if Uncategorized is already open)
        for (let i = 1; i < expandButtons.length && i < 30; i++) {
            try {
                await expandButtons[i].click();
                await page.waitForTimeout(200);
                console.log(`  ✓ Expanded folder ${i}`);
            } catch (err) {
                // Continue
            }
        }

        // Ensure Uncategorized is expanded
        if (expandButtons.length > 0) {
            try {
                await expandButtons[0].click();
                await page.waitForTimeout(200);
                console.log('  ✓ Ensured Uncategorized is expanded');
            } catch (err) {
                // Already expanded
            }
        }

        await page.waitForTimeout(2000);
    }

    async extractWorkflowData(page) {
        // Extract data from current workflow page
        const data = await page.evaluate(() => {
            const result = {
                workflow_name: '',
                folder: '',
                steps: []
            };

            // Get workflow trigger/event card
            const eventCard = document.querySelector('[data-name="EventCard"]');
            if (!eventCard) {
                // Try alternative selectors for the trigger
                const triggerElement = document.querySelector('div[role="button"][aria-label*="Event"], div[role="button"][aria-label*="trigger"]');
                if (!triggerElement) {
                    return result;
                }
            }

            // Extract workflow name from event card
            if (eventCard) {
                const eventText = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31, span[class*="workflow-name"]');
                if (eventText) {
                    result.workflow_name = eventText.textContent.trim().replace(' is called', '');
                }
            }

            let stepOrder = 1;

            // Process trigger/event
            if (eventCard) {
                const eventId = eventCard.getAttribute('data-id');
                const eventType = eventCard.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || 'API Event';
                const eventName = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31')?.textContent || '';

                const step = {
                    order: stepOrder++,
                    action: `${eventType}: ${eventName}`,
                    context: {}
                };

                // Check for property editor panel
                const propertyEditor = document.querySelector(`.property-editor-2[data-node-id="${eventId}"], .property-editor-2`);
                if (propertyEditor) {
                    // Extract endpoint name
                    const endpointInput = propertyEditor.querySelector('input[placeholder*="endpoint"], input[id*="wf_name"]');
                    if (endpointInput) {
                        step.context.endpoint_name = endpointInput.value;
                    }

                    // Extract checkboxes
                    const checkboxes = {
                        expose: propertyEditor.querySelector('[id*="expose"]'),
                        auth: propertyEditor.querySelector('[id*="auth_unecessary"]'),
                        privacy: propertyEditor.querySelector('[id*="ignore_privacy"]')
                    };

                    if (checkboxes.expose?.classList.contains('checked')) {
                        step.context.exposed_as_public_api_workflow = 'Y';
                    }
                    if (checkboxes.auth?.classList.contains('checked')) {
                        step.context.can_run_without_authentication = 'Y';
                    }
                    if (checkboxes.privacy?.classList.contains('checked')) {
                        step.context.ignore_privacy_rules = 'Y';
                    }

                    // Extract trigger method
                    const triggerOption = propertyEditor.querySelector('[data-prop-name="trigger_option"] .spot');
                    if (triggerOption) {
                        step.context.trigger_verb = triggerOption.textContent.trim();
                    }

                    // Extract response type
                    const responseType = propertyEditor.querySelector('[data-prop-name="response_type"] .spot');
                    if (responseType) {
                        step.context.response_type = responseType.textContent.trim();
                    }

                    // Extract parameters
                    const paramEntries = propertyEditor.querySelectorAll('.object-list-editor .entry');
                    if (paramEntries.length > 0) {
                        step.context.parameters = [];
                        paramEntries.forEach(entry => {
                            const keyInput = entry.querySelector('input[id*="key"]');
                            const typeEl = entry.querySelector('.dropdown-caption');

                            if (keyInput?.value) {
                                step.context.parameters.push({
                                    key: keyInput.value,
                                    type: typeEl?.textContent.trim() || 'text'
                                });
                            }
                        });
                    }
                }

                result.steps.push(step);
            }

            // Process action cards
            const actionCards = document.querySelectorAll('[data-name="ActionCard"]');
            actionCards.forEach(card => {
                const actionName = card.querySelector('span._1nfonn87._1lkv1fwa._1lkv1fwe._1ij2r31')?.textContent || '';
                const stepLabel = card.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || `Step ${stepOrder}`;

                result.steps.push({
                    order: stepOrder++,
                    action: actionName || stepLabel
                });
            });

            return result;
        });

        return data;
    }

    async processWorkflows(page) {
        const workflowData = [];
        const processedUrls = new Set();

        console.log('\n🔍 Finding workflow elements in sidebar...');

        // Multiple selectors to find workflow items
        const workflowSelectors = [
            'div[class*="tree-item"] span:not([class*="folder"])',
            'div[class*="workflow-item"]',
            'span[class*="workflow-name"]',
            'div.list-item span',
            'div[role="treeitem"] span'
        ];

        let totalProcessed = 0;

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

                    // Check if it's in the sidebar (left side)
                    const box = await element.boundingBox();
                    if (!box || box.x > 500) {
                        continue;
                    }

                    // Click the workflow
                    console.log(`\n[${totalProcessed + 1}] Clicking: ${text.trim()}`);
                    await element.click();
                    await page.waitForTimeout(2000); // Wait for content to load

                    // Get the URL and extract wf_item
                    const currentUrl = page.url();
                    const urlObj = new URL(currentUrl);
                    const wfItem = urlObj.searchParams.get('wf_item');

                    if (wfItem && !processedUrls.has(wfItem)) {
                        processedUrls.add(wfItem);

                        // Extract workflow data
                        const extractedData = await this.extractWorkflowData(page);

                        // Add metadata
                        extractedData.wf_item = wfItem;
                        extractedData.workflow_name = extractedData.workflow_name || text.trim();
                        extractedData.extracted_at = new Date().toISOString();
                        extractedData.url = currentUrl;
                        extractedData.hash = crypto.createHash('sha256')
                            .update(JSON.stringify(extractedData.steps))
                            .digest('hex')
                            .substring(0, 16);

                        workflowData.push(extractedData);
                        totalProcessed++;

                        // Save individual workflow file
                        const safeName = text.trim()
                            .replace(/[^a-zA-Z0-9-_]/g, '_')
                            .replace(/_+/g, '_')
                            .substring(0, 50);

                        const fileName = `${safeName}_${wfItem}.json`;
                        const filePath = path.join(this.outputDir, fileName);
                        await fs.writeFile(filePath, JSON.stringify(extractedData, null, 2));

                        console.log(`  ✅ Extracted: ${extractedData.steps.length} steps`);
                        console.log(`  💾 Saved: ${fileName}`);
                    }
                } catch (err) {
                    console.log(`  ❌ Error processing workflow: ${err.message}`);
                    // Continue to next element
                }
            }
        }

        return { workflowData, totalProcessed };
    }

    async run() {
        try {
            // Create output directory
            await fs.mkdir(this.outputDir, { recursive: true });
            console.log(`📁 Output directory: ${this.outputDir}`);

            // Launch browser
            const { context, page } = await this.launch();

            // Expand all folders
            await this.expandAllFolders(page);

            // Process all workflows
            const { workflowData, totalProcessed } = await this.processWorkflows(page);

            // Save combined results
            const combinedData = {
                session: this.sessionTimestamp,
                extracted_at: new Date().toISOString(),
                total_workflows: totalProcessed,
                total_steps: workflowData.reduce((sum, w) => sum + w.steps.length, 0),
                workflows: workflowData
            };

            const combinedPath = path.join(this.outputDir, `combined-workflows-${this.sessionTimestamp}.json`);
            await fs.writeFile(combinedPath, JSON.stringify(combinedData, null, 2));

            // Summary
            console.log('\n' + '='.repeat(60));
            console.log('🎉 DYNAMIC EXTRACTION COMPLETE');
            console.log('='.repeat(60));
            console.log(`✅ Total workflows processed: ${totalProcessed}`);
            console.log(`📝 Total steps extracted: ${combinedData.total_steps}`);
            console.log(`💾 Output directory: ${this.outputDir}`);
            console.log(`📊 Combined file: ${path.basename(combinedPath)}`);

            await context.close();

        } catch (error) {
            console.error('Fatal error:', error);
        }
    }
}

// Run if called directly
if (require.main === module) {
    const extractor = new DynamicWorkflowExtractor();
    extractor.run().catch(console.error);
}

module.exports = DynamicWorkflowExtractor;