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

    async processWorkflow(page, workflowName, wfItem) {
        console.log(`\nProcessing workflow: ${workflowName}`);

        try {
            // Navigate to workflow
            const url = BROWSER_CONFIG.urls.workflowUrl(wfItem);
            console.log(`Navigating to: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            // Wait for content to load
            await page.waitForTimeout(5000);

            // Extract workflow data
            const workflowData = await this.extractWorkflowData(page);

            // Add metadata
            workflowData.wf_item = wfItem;
            workflowData.extracted_at = new Date().toISOString();
            workflowData.hash = crypto.createHash('sha256')
                .update(JSON.stringify(workflowData.steps))
                .digest('hex')
                .substring(0, 16);

            return workflowData;
        } catch (error) {
            console.error(`Error processing workflow ${workflowName}:`, error.message);
            return {
                workflow_name: workflowName,
                wf_item: wfItem,
                error: error.message,
                extracted_at: new Date().toISOString(),
                steps: []
            };
        }
    }

    async run() {
        const { browser, page } = await launchBrowserWithSession();

        try {
            // Create output directory
            await fs.mkdir(this.outputDir, { recursive: true });

            // IMPORTANT: Navigate to base URL first to ensure session is active
            console.log('Navigating to Bubble.io editor...');
            await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log('Editor loaded with active session');

            // Load workflow list
            const workflowListPath = path.join(__dirname, 'workflow-ids-final.json');
            const workflowList = JSON.parse(await fs.readFile(workflowListPath, 'utf-8'));
            console.log(`Loaded ${workflowList.length} workflows`);

            // Process all workflows
            const testWorkflows = workflowList;
            const results = {
                workflows: [],
                extracted_at: new Date().toISOString(),
                total_steps: 0
            };

            for (let i = 0; i < testWorkflows.length; i++) {
                const workflow = testWorkflows[i];
                console.log(`\n[${i + 1}/${testWorkflows.length}] Processing...`);

                const data = await this.processWorkflow(page, workflow.name, workflow.wf_item);
                results.workflows.push(data);
                results.total_steps += data.steps ? data.steps.length : 0;

                // Save individual workflow
                const fileName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                const filePath = path.join(this.outputDir, fileName);
                await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                console.log(`  Saved: ${fileName}`);
                console.log(`  Steps extracted: ${data.steps ? data.steps.length : 0}`);

                // Add small delay between workflows to avoid overwhelming the browser
                if (i < testWorkflows.length - 1) {
                    await page.waitForTimeout(1000);
                }
            }

            // Save combined results
            const combinedPath = path.join(this.outputDir, 'combined-workflows.json');
            await fs.writeFile(combinedPath, JSON.stringify(results, null, 2));

            console.log('\n=== Extraction Complete ===');
            console.log(`Total workflows: ${results.workflows.length}`);
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