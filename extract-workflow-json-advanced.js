const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Advanced Workflow Extractor
 * Clicks on each individual step/action to open property panels and extract detailed configuration
 */

class AdvancedWorkflowExtractor {
    constructor() {
        this.outputDir = path.join(__dirname, 'extracted-workflows-advanced');
    }

    async expandAllFolders(page) {
        console.log('\n📂 Expanding all folders...');

        const expandButtons = await page.$$('div[role="button"] svg');
        console.log(`Found ${expandButtons.length} expand buttons`);

        for (let i = 1; i < expandButtons.length && i < 30; i++) {
            try {
                await expandButtons[i].click();
                await page.waitForTimeout(200);
                console.log(`  ✓ Expanded folder ${i}`);
            } catch (err) {
                // Continue
            }
        }

        if (expandButtons.length > 0) {
            try {
                await expandButtons[0].click();
                await page.waitForTimeout(200);
                console.log('  ✓ Ensured Uncategorized is expanded');
            } catch (err) {}
        }

        await page.waitForTimeout(2000);
    }

    async extractStepDetails(page, actionCard) {
        const stepDetails = {
            title: '',
            action_type: '',
            configuration: {},
            fields: [],
            conditions: null
        };

        try {
            // Get basic info from the card
            const titleElement = await actionCard.$('span._1nfonn87._1lkv1fwa._1lkv1fwe._1ij2r31');
            if (titleElement) {
                stepDetails.title = await titleElement.textContent();
            }

            // Click the action card to open property panel
            console.log(`    Clicking step: ${stepDetails.title}`);
            await actionCard.click();
            await page.waitForTimeout(1500); // Wait for property panel to open

            // Find the property editor panel for this step
            const actionId = await actionCard.getAttribute('data-id');
            let propertyPanel = null;

            if (actionId) {
                propertyPanel = await page.$(`div.property-editor-2[data-node-id="${actionId}"]`);
            }

            if (!propertyPanel) {
                // Try to find any visible property panel
                propertyPanel = await page.$('div.property-editor-2:visible');
            }

            if (propertyPanel) {
                console.log('      Found property panel');

                // Extract the title from property panel
                const panelTitle = await propertyPanel.$('.static-title');
                if (panelTitle) {
                    const titleText = await panelTitle.textContent();
                    if (titleText) {
                        stepDetails.title = titleText.trim();
                    }
                }

                // Extract sections and their rows
                const sections = await propertyPanel.$$('div.section');
                for (const section of sections) {
                    const sectionName = await section.getAttribute('section_name');
                    if (!sectionName) continue;

                    const sectionData = {
                        name: sectionName,
                        fields: []
                    };

                    // Extract rows in this section
                    const rows = await section.$$('div.row');
                    for (const row of rows) {
                        try {
                            const propName = await row.getAttribute('prop_name');
                            const caption = await row.$eval('div.caption', el => el.textContent).catch(() => null);

                            const rowData = {
                                prop_name: propName,
                                caption: caption?.trim(),
                                value: null,
                                type: null
                            };

                            // Check for text input
                            const textInput = await row.$('input.property-editor-control');
                            if (textInput) {
                                rowData.value = await textInput.inputValue();
                                rowData.type = 'text';
                            }

                            // Check for checkbox
                            const checkbox = await row.$('div.component-checkbox');
                            if (checkbox) {
                                const classes = await checkbox.getAttribute('class');
                                rowData.value = classes?.includes('checked') ? true : false;
                                rowData.type = 'checkbox';
                            }

                            // Check for dropdown
                            const dropdown = await row.$('div.dropdown-caption');
                            if (dropdown) {
                                rowData.value = await dropdown.textContent();
                                rowData.type = 'dropdown';
                            }

                            // Check for expression/dynamic value
                            const expression = await row.$('span.dynamic');
                            if (expression) {
                                rowData.value = await expression.textContent();
                                rowData.type = 'expression';
                            }

                            if (rowData.value !== null || rowData.caption) {
                                sectionData.fields.push(rowData);
                            }
                        } catch (err) {
                            // Skip problematic row
                        }
                    }

                    if (sectionData.fields.length > 0) {
                        if (!stepDetails.configuration[sectionName]) {
                            stepDetails.configuration[sectionName] = sectionData.fields;
                        }
                    }
                }

                // Extract field mappings from object-list-editor
                const fieldEntries = await propertyPanel.$$('.object-list-editor .entry');
                for (const entry of fieldEntries) {
                    try {
                        const keyElement = await entry.$('[data-prop-name="key"] .spot, input[id*="key"]');
                        const valueElement = await entry.$('.dynamic, .text-composer');

                        const field = {
                            key: keyElement ? await keyElement.textContent() || await keyElement.inputValue() : null,
                            value: valueElement ? await valueElement.textContent() : null
                        };

                        if (field.key || field.value) {
                            stepDetails.fields.push(field);
                        }
                    } catch (err) {}
                }

                // Extract conditions
                const conditionRow = await propertyPanel.$('div.row[prop_name="condition"]');
                if (conditionRow) {
                    const conditionValue = await conditionRow.$eval('.spot, .dynamic', el => el.textContent).catch(() => null);
                    if (conditionValue && conditionValue !== 'Click') {
                        stepDetails.conditions = conditionValue;
                    }
                }
            } else {
                console.log('      No property panel found');
            }

        } catch (error) {
            console.log(`      Error extracting step details: ${error.message}`);
        }

        return stepDetails;
    }

    async extractWorkflowWithDetails(page) {
        console.log('  Extracting workflow with detailed steps...');

        const workflowData = {
            workflow_name: '',
            folder: '',
            steps: []
        };

        // Get the trigger/event card
        const eventCard = await page.$('[data-name="EventCard"]');
        if (eventCard) {
            console.log('    Processing trigger/event...');

            // Get event name
            const eventText = await eventCard.$('span._1nfonn87._1lkv1fwa._1ij2r31');
            if (eventText) {
                workflowData.workflow_name = (await eventText.textContent()).trim().replace(' is called', '');
            }

            // Click to open event properties
            await eventCard.click();
            await page.waitForTimeout(1500);

            // Extract trigger configuration
            const eventId = await eventCard.getAttribute('data-id');
            let eventPanel = null;

            if (eventId) {
                eventPanel = await page.$(`div.property-editor-2[data-node-id="${eventId}"]`);
            }
            if (!eventPanel) {
                eventPanel = await page.$('div.property-editor-2:visible');
            }

            const triggerStep = {
                order: 1,
                action: `API Event: ${workflowData.workflow_name} is called`,
                context: {}
            };

            if (eventPanel) {
                // Extract endpoint name
                const endpointInput = await eventPanel.$('input[id*="wf_name"]');
                if (endpointInput) {
                    triggerStep.context.endpoint_name = await endpointInput.inputValue();
                }

                // Extract checkboxes
                const checkboxes = await eventPanel.$$('div.component-checkbox');
                for (const checkbox of checkboxes) {
                    const id = await checkbox.getAttribute('id');
                    const isChecked = (await checkbox.getAttribute('class'))?.includes('checked');

                    if (id?.includes('expose')) {
                        triggerStep.context.exposed_as_public_api_workflow = isChecked ? 'Y' : 'N';
                    } else if (id?.includes('auth_unecessary')) {
                        triggerStep.context.can_run_without_authentication = isChecked ? 'Y' : 'N';
                    } else if (id?.includes('ignore_privacy')) {
                        triggerStep.context.ignore_privacy_rules = isChecked ? 'Y' : 'N';
                    }
                }

                // Extract parameters
                const paramEntries = await eventPanel.$$('.object-list-editor .entry');
                if (paramEntries.length > 0) {
                    triggerStep.context.parameters = [];
                    for (const entry of paramEntries) {
                        const keyInput = await entry.$('input[id*="key"]');
                        const typeDropdown = await entry.$('.dropdown-caption');

                        if (keyInput) {
                            triggerStep.context.parameters.push({
                                key: await keyInput.inputValue(),
                                type: typeDropdown ? await typeDropdown.textContent() : 'text'
                            });
                        }
                    }
                }
            }

            workflowData.steps.push(triggerStep);
        }

        // Get all action cards
        const actionCards = await page.$$('[data-name="ActionCard"]');
        console.log(`    Found ${actionCards.length} action steps`);

        let stepOrder = workflowData.steps.length + 1;
        for (const actionCard of actionCards) {
            const stepDetails = await this.extractStepDetails(page, actionCard);

            const step = {
                order: stepOrder++,
                action: stepDetails.title || `Step ${stepOrder - 1}`,
                ...stepDetails
            };

            workflowData.steps.push(step);
        }

        return workflowData;
    }

    async run() {
        const { browser, page } = await launchBrowserWithSession();

        try {
            await fs.mkdir(this.outputDir, { recursive: true });

            console.log('Navigating to Bubble.io editor...');
            await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log('Editor loaded with active session');

            await this.expandAllFolders(page);

            console.log('\n🔍 Finding workflow elements in sidebar...');

            const processedUrls = new Set();
            let totalProcessed = 0;
            const results = {
                workflows: [],
                extracted_at: new Date().toISOString(),
                total_steps: 0
            };

            // Use prefix patterns to find workflows
            const prefixes = ['core', 'CORE', 'L2', 'L3'];
            const maxWorkflows = 5; // Limit for testing

            for (const prefix of prefixes) {
                if (totalProcessed >= maxWorkflows) break;

                const items = await page.$$(`text=/^${prefix}/`);
                console.log(`Found ${items.length} workflows starting with "${prefix}"`);

                for (const item of items) {
                    if (totalProcessed >= maxWorkflows) break;

                    try {
                        const text = await item.textContent();
                        const box = await item.boundingBox();

                        if (box && box.x < 500) {
                            console.log(`\n[${totalProcessed + 1}] Clicking workflow: ${text.trim()}`);
                            await item.click();
                            await page.waitForTimeout(2000);

                            const currentUrl = page.url();
                            const urlObj = new URL(currentUrl);
                            const wfItem = urlObj.searchParams.get('wf_item');

                            if (wfItem && !processedUrls.has(wfItem)) {
                                processedUrls.add(wfItem);

                                // Extract workflow with detailed steps
                                const data = await this.extractWorkflowWithDetails(page);
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
                                const safeName = text.trim()
                                    .replace(/[^a-zA-Z0-9-_]/g, '_')
                                    .substring(0, 50);
                                const fileName = `${safeName}_${wfItem}.json`;
                                const filePath = path.join(this.outputDir, fileName);
                                await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                                console.log(`  ✅ Extracted: ${data.steps ? data.steps.length : 0} steps with details`);
                                console.log(`  💾 Saved: ${fileName}`);
                            }
                        }
                    } catch (error) {
                        console.log(`  ❌ Error: ${error.message}`);
                    }
                }
            }

            // Save combined results
            const combinedPath = path.join(this.outputDir, 'combined-workflows-advanced.json');
            await fs.writeFile(combinedPath, JSON.stringify(results, null, 2));

            console.log('\n=== Advanced Extraction Complete ===');
            console.log(`Total workflows processed: ${results.workflows.length}`);
            console.log(`Total steps extracted: ${results.total_steps}`);
            console.log(`Output directory: ${this.outputDir}`);

        } finally {
            await browser.close();
        }
    }
}

// Run if called directly
if (require.main === module) {
    const extractor = new AdvancedWorkflowExtractor();
    extractor.run().catch(console.error);
}

module.exports = AdvancedWorkflowExtractor;