const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class BatchWorkflowExtractor {
    constructor() {
        this.outputDir = path.join(__dirname, 'extracted-workflows');
        this.profilePath = path.join(__dirname, 'browser-profiles', 'default');
        this.baseUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&version=test';
        this.batchSize = 20; // Process 20 workflows before restarting browser
        this.failedWorkflows = [];
    }

    async launchBrowser() {
        console.log('🌐 Launching browser with persistent session...');
        console.log(`📁 Profile: ${this.profilePath}`);

        const browser = await chromium.launchPersistentContext(
            this.profilePath,
            {
                channel: 'chrome',
                headless: false,
                viewport: { width: 1920, height: 1080 },
                timeout: 60000
            }
        );

        const page = browser.pages()[0] || await browser.newPage();
        page.setDefaultTimeout(30000);

        // Navigate to base URL to ensure session is active
        console.log('Navigating to Bubble.io editor...');
        await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);
        console.log('Editor loaded with active session');

        return { browser, page };
    }

    async extractWorkflowData(page) {
        // Wait for content with shorter timeout
        await page.waitForSelector('[data-name="EventCard"], [data-name="ActionCard"]', {
            timeout: 5000
        }).catch(() => null);

        // Same extraction logic as before
        const workflowData = await page.evaluate(() => {
            const result = {
                workflow_name: '',
                folder: '',
                steps: []
            };

            const eventCard = document.querySelector('[data-name="EventCard"]');
            if (eventCard) {
                const eventText = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31');
                if (eventText) {
                    result.workflow_name = eventText.textContent.trim().replace(' is called', '');
                }
            }

            let stepOrder = 1;

            if (eventCard) {
                const eventId = eventCard.getAttribute('data-id');
                const eventType = eventCard.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || 'API Event';
                const eventName = eventCard.querySelector('span._1nfonn87._1lkv1fwa._1ij2r31')?.textContent || '';

                const step = {
                    order: stepOrder++,
                    action: `${eventType}: ${eventName}`,
                    context: {}
                };

                const propertyEditor = document.querySelector(`.property-editor-2[data-node-id="${eventId}"]`);
                if (propertyEditor) {
                    const endpointInput = propertyEditor.querySelector('input[id*="wf_name"]');
                    if (endpointInput) {
                        step.context.endpoint_name = endpointInput.value;
                    }

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

                    const triggerOption = propertyEditor.querySelector('[data-prop-name="trigger_option"] .spot');
                    if (triggerOption) {
                        step.context.trigger_verb = triggerOption.textContent.trim();
                    }

                    const responseType = propertyEditor.querySelector('[data-prop-name="response_type"] .spot');
                    if (responseType) {
                        step.context.response_type = responseType.textContent.trim();
                    }

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

            const actionCards = document.querySelectorAll('[data-name="ActionCard"]');
            actionCards.forEach(card => {
                const actionId = card.getAttribute('data-id');
                const stepLabel = card.querySelector('span._1nfonn87._1lkv1fw9')?.textContent || `Step ${stepOrder}`;
                const actionName = card.querySelector('span._1nfonn87._1lkv1fwa._1lkv1fwe._1ij2r31')?.textContent || '';

                const step = {
                    order: stepOrder++,
                    action: actionName || stepLabel
                };

                const propertyEditor = document.querySelector(`.property-editor-2[data-node-id="${actionId}"]`);
                if (propertyEditor) {
                    const titleElement = propertyEditor.querySelector('.static-title');
                    if (titleElement && titleElement.textContent !== step.action) {
                        step.action = titleElement.textContent.trim();
                    }

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

    async processWorkflow(page, workflow, attemptNumber = 1) {
        console.log(`Processing: ${workflow.name} (Attempt ${attemptNumber})`);

        try {
            const url = `https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=${workflow.wf_item}&version=test`;

            // Use shorter timeout and catch navigation errors
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Wait for content to stabilize
            await page.waitForTimeout(3000);

            // Extract workflow data
            const workflowData = await this.extractWorkflowData(page);

            // Add metadata
            workflowData.wf_item = workflow.wf_item;
            workflowData.extracted_at = new Date().toISOString();
            workflowData.hash = crypto.createHash('sha256')
                .update(JSON.stringify(workflowData.steps))
                .digest('hex')
                .substring(0, 16);

            return { success: true, data: workflowData };

        } catch (error) {
            console.error(`  ❌ Error: ${error.message}`);

            if (attemptNumber === 1) {
                // Track for retry
                this.failedWorkflows.push(workflow);
            }

            return {
                success: false,
                data: {
                    workflow_name: workflow.name,
                    wf_item: workflow.wf_item,
                    error: error.message,
                    extracted_at: new Date().toISOString(),
                    steps: []
                }
            };
        }
    }

    async processBatch(workflows, batchNumber, totalBatches) {
        console.log(`\n📦 Processing Batch ${batchNumber}/${totalBatches} (${workflows.length} workflows)`);

        const { browser, page } = await this.launchBrowser();
        const results = [];

        try {
            for (const workflow of workflows) {
                const result = await this.processWorkflow(page, workflow);
                results.push(result.data);

                // Save individual workflow
                const fileName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                const filePath = path.join(this.outputDir, fileName);
                await fs.writeFile(filePath, JSON.stringify(result.data, null, 2));
                console.log(`  ✅ Saved: ${fileName} (${result.data.steps ? result.data.steps.length : 0} steps)`);

                // Small delay between workflows
                await page.waitForTimeout(1000);
            }
        } finally {
            await browser.close();
            console.log(`  🔄 Browser closed for batch ${batchNumber}`);
        }

        return results;
    }

    async run() {
        try {
            // Create output directory
            await fs.mkdir(this.outputDir, { recursive: true });

            // Load workflow list
            const workflowListPath = path.join(__dirname, 'workflow-ids-final.json');
            const workflowList = JSON.parse(await fs.readFile(workflowListPath, 'utf-8'));
            console.log(`📚 Loaded ${workflowList.length} workflows`);

            // Split into batches
            const batches = [];
            for (let i = 0; i < workflowList.length; i += this.batchSize) {
                batches.push(workflowList.slice(i, i + this.batchSize));
            }

            console.log(`📊 Split into ${batches.length} batches of up to ${this.batchSize} workflows each`);

            // Process each batch
            const allResults = [];
            for (let i = 0; i < batches.length; i++) {
                const batchResults = await this.processBatch(batches[i], i + 1, batches.length);
                allResults.push(...batchResults);

                // Longer delay between batches
                if (i < batches.length - 1) {
                    console.log('  ⏸️  Waiting 5 seconds before next batch...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            // Retry failed workflows if any
            if (this.failedWorkflows.length > 0) {
                console.log(`\n🔄 Retrying ${this.failedWorkflows.length} failed workflows...`);

                const { browser, page } = await this.launchBrowser();
                try {
                    for (const workflow of this.failedWorkflows) {
                        const result = await this.processWorkflow(page, workflow, 2);

                        // Update the result in allResults
                        const index = allResults.findIndex(r => r.wf_item === workflow.wf_item);
                        if (index !== -1 && result.success) {
                            allResults[index] = result.data;

                            // Save updated file
                            const fileName = `${workflow.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
                            const filePath = path.join(this.outputDir, fileName);
                            await fs.writeFile(filePath, JSON.stringify(result.data, null, 2));
                            console.log(`  ✅ Retry successful: ${fileName}`);
                        }
                    }
                } finally {
                    await browser.close();
                }
            }

            // Save combined results
            const combinedData = {
                workflows: allResults,
                extracted_at: new Date().toISOString(),
                total_workflows: allResults.length,
                total_steps: allResults.reduce((sum, w) => sum + (w.steps ? w.steps.length : 0), 0),
                failed_count: allResults.filter(w => w.error).length
            };

            const combinedPath = path.join(this.outputDir, 'combined-workflows.json');
            await fs.writeFile(combinedPath, JSON.stringify(combinedData, null, 2));

            // Final summary
            console.log('\n' + '='.repeat(60));
            console.log('🎉 EXTRACTION COMPLETE');
            console.log('='.repeat(60));
            console.log(`✅ Total workflows: ${combinedData.total_workflows}`);
            console.log(`📝 Total steps extracted: ${combinedData.total_steps}`);
            console.log(`❌ Failed workflows: ${combinedData.failed_count}`);
            console.log(`💾 Output directory: ${this.outputDir}`);

        } catch (error) {
            console.error('Fatal error:', error);
        }
    }
}

// Run if called directly
if (require.main === module) {
    const extractor = new BatchWorkflowExtractor();
    extractor.run().catch(console.error);
}

module.exports = BatchWorkflowExtractor;