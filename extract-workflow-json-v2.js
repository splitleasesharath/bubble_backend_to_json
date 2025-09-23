const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class WorkflowExtractor {
    constructor() {
        this.outputDir = path.join(__dirname, 'extracted-workflows');
    }

    async extractWorkflowData(page) {
        console.log('Extracting workflow data...');

        // Wait for workflow canvas to load
        await page.waitForSelector('[data-name="EventCard"], [data-name="ActionCard"]', {
            timeout: 10000
        }).catch(() => console.log('No cards found in timeout period'));

        // Extract all workflow data from the page
        const workflowData = await page.evaluate(() => {
            const result = {
                workflow_name: '',
                folder: '',
                steps: []
            };

            // Get workflow name from the page title or first event card
            const eventCard = document.querySelector('[data-name="EventCard"]');
            if (eventCard) {
                const eventText = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31');
                if (eventText) {
                    result.workflow_name = eventText.textContent.trim().replace(' is called', '');
                }
            }

            // Extract folder from navigation if visible
            const folderElement = document.querySelector('.folder-name, .category-name');
            if (folderElement) {
                result.folder = folderElement.textContent.trim();
            }

            // Extract all steps (Event + Actions)
            let stepOrder = 1;

            // First, get the trigger/event card
            if (eventCard) {
                const eventId = eventCard.getAttribute('data-id');
                const eventType = eventCard.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || 'API Event';
                const eventName = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31')?.textContent || '';

                const step = {
                    order: stepOrder++,
                    action: `${eventType}: ${eventName}`,
                    context: {}
                };

                // Try to extract context from property editor if it exists
                const propertyEditor = document.querySelector(`.property-editor-2[data-node-id="${eventId}"]`);
                if (propertyEditor) {
                    // Extract endpoint name
                    const endpointInput = propertyEditor.querySelector('input[id*="wf_name"]');
                    if (endpointInput) {
                        step.context.endpoint_name = endpointInput.value;
                    }

                    // Extract checkboxes
                    const exposeCheckbox = propertyEditor.querySelector('#api\\.' + eventId + '\\.properties\\.expose');
                    if (exposeCheckbox && exposeCheckbox.classList.contains('checked')) {
                        step.context.exposed_as_public_api_workflow = 'Y';
                    }

                    const authCheckbox = propertyEditor.querySelector('#api\\.' + eventId + '\\.properties\\.auth_unecessary');
                    if (authCheckbox && authCheckbox.classList.contains('checked')) {
                        step.context.can_run_without_authentication = 'Y';
                    }

                    const privacyCheckbox = propertyEditor.querySelector('#api\\.' + eventId + '\\.properties\\.ignore_privacy_rules');
                    if (privacyCheckbox && privacyCheckbox.classList.contains('checked')) {
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
                    const parameterEntries = propertyEditor.querySelectorAll('.object-list-editor .entry');
                    if (parameterEntries.length > 0) {
                        step.context.parameters = [];
                        parameterEntries.forEach(entry => {
                            const keyInput = entry.querySelector('input[id*="parameters"][id*="key"]');
                            const typeDropdown = entry.querySelector('.dropdown-caption.new-composer');
                            const isListCheckbox = entry.querySelector('[id*="is_list"]');
                            const queryStringCheckbox = entry.querySelector('[id*="in_url"]');

                            if (keyInput && keyInput.value) {
                                const param = {
                                    key: keyInput.value,
                                    type: typeDropdown ? typeDropdown.textContent.trim() : '',
                                    'is_list/array': isListCheckbox && isListCheckbox.classList.contains('checked') ? 'Y' : 'Optional',
                                    querystring: queryStringCheckbox && queryStringCheckbox.classList.contains('checked') ? 'Y' : 'N'
                                };
                                step.context.parameters.push(param);
                            }
                        });
                    }
                }

                result.steps.push(step);
            }

            // Now get all action cards
            const actionCards = document.querySelectorAll('[data-name="ActionCard"]');
            actionCards.forEach(card => {
                const actionId = card.getAttribute('data-id');
                const stepLabel = card.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || `Step ${stepOrder}`;
                const actionName = card.querySelector('span._1nfonn87._1lkv1fwa._1lkv1fwe._1ij2r31')?.textContent || '';

                const step = {
                    order: stepOrder++,
                    action: actionName || stepLabel
                };

                // Try to extract additional context from property editor
                const propertyEditor = document.querySelector(`.property-editor-2[data-node-id="${actionId}"]`);
                if (propertyEditor) {
                    const titleElement = propertyEditor.querySelector('.static-title');
                    if (titleElement && titleElement.textContent !== step.action) {
                        step.action = titleElement.textContent.trim();
                    }

                    // Extract field mappings if it's a "Make changes" or "Create" action
                    const fieldEntries = propertyEditor.querySelectorAll('.object-list-editor .entry');
                    if (fieldEntries.length > 0) {
                        step.fields = [];
                        fieldEntries.forEach(entry => {
                            const fieldName = entry.querySelector('[data-prop-name="key"] .spot')?.textContent;
                            const fieldValue = entry.querySelector('.dynamic')?.textContent;
                            if (fieldName) {
                                step.fields.push({
                                    field: fieldName,
                                    value: fieldValue || ''
                                });
                            }
                        });
                    }
                }

                result.steps.push(step);
            });

            return result;
        });

        return workflowData;
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

    async run() {
        const { browser, page } = await launchBrowserWithSession();

        try {
            // Create output directory
            await fs.mkdir(this.outputDir, { recursive: true });

            // Navigate to base URL first to ensure session is active
            console.log('Navigating to Bubble.io editor...');
            await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log('Editor loaded with active session');

            // Expand all folders to see all workflows
            await this.expandAllFolders(page);

            // Process workflows dynamically from sidebar
            const results = {
                workflows: [],
                extracted_at: new Date().toISOString(),
                total_steps: 0
            };

            // Find workflow elements dynamically in sidebar
            console.log('\n🔍 Finding workflow elements in sidebar...');

            const workflowSelectors = [
                'div[class*="tree-item"] span:not([class*="folder"])',
                'div[class*="workflow-item"]',
                'span[class*="workflow-name"]',
                'div.list-item span',
                'div[role="treeitem"] span'
            ];

            const processedUrls = new Set();
            let totalProcessed = 0;

            for (const selector of workflowSelectors) {
                const elements = await page.$$(selector);
                console.log(`Found ${elements.length} elements with selector: ${selector}`);

                for (const element of elements) {
                    try {
                        const text = await element.textContent();

                        // Filter out non-workflow items
                        if (!text || text.match(/^\d+$/) || text.includes('×')) {
                            continue;
                        }

                        // Check if it's in the sidebar (left side)
                        const box = await element.boundingBox();
                        if (!box || box.x > 500) continue;

                        // Skip folder names and very short/long items
                        if (text.toLowerCase().includes('uncategorized') ||
                            text.toLowerCase().includes('category') ||
                            text.length < 3) {
                            continue;
                        }

                        // Click the workflow
                        console.log(`\n[${totalProcessed + 1}] Clicking: ${text.trim()}`);
                        await element.click();
                        await page.waitForTimeout(2000);

                        // Get the URL and extract wf_item
                        const currentUrl = page.url();
                        const urlObj = new URL(currentUrl);
                        const wfItem = urlObj.searchParams.get('wf_item');

                        if (wfItem && !processedUrls.has(wfItem)) {
                            processedUrls.add(wfItem);

                            // Extract workflow data
                            const data = await this.extractWorkflowData(page);
                            data.wf_item = wfItem;
                            data.workflow_name = data.workflow_name || text.trim();
                            data.extracted_at = new Date().toISOString();
                            data.hash = crypto.createHash('sha256')
                                .update(JSON.stringify(data.steps))
                                .digest('hex')
                                .substring(0, 16);

                            results.workflows.push(data);
                            results.total_steps += data.steps ? data.steps.length : 0;
                            totalProcessed++;

                            // Save individual workflow
                            const fileName = `${text.trim().replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                            const filePath = path.join(this.outputDir, fileName);
                            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                            console.log(`  ✅ Extracted: ${data.steps ? data.steps.length : 0} steps`);
                            console.log(`  💾 Saved: ${fileName}`);
                        }
                    } catch (error) {
                        console.log(`  ❌ Error: ${error.message}`);
                    }
                }
            }

            // Save combined results
            const combinedPath = path.join(this.outputDir, 'combined-workflows.json');
            await fs.writeFile(combinedPath, JSON.stringify(results, null, 2));

            console.log('\n=== Dynamic Extraction Complete ===');
            console.log(`Total workflows found & processed: ${results.workflows.length}`);
            console.log(`Total steps extracted: ${results.total_steps}`);
            console.log(`Output directory: ${this.outputDir}`);

        } finally {
            await browser.close();
        }
    }
}

// Run if called directly
if (require.main === module) {
    const extractor = new WorkflowExtractor();
    extractor.run().catch(console.error);
}

module.exports = WorkflowExtractor;