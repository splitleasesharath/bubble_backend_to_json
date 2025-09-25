const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Dropdown-based Workflow Extractor
 * Uses the chronological dropdown menu to detect and extract all workflows
 */

class DropdownWorkflowExtractor {
    constructor() {
        // Create timestamped directory for this run
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        this.outputDir = path.join(__dirname, 'extracted-workflows-dropdown', `run-${timestamp}`);
        this.workflows = [];
        this.dropdownStructure = [];
        this.timestamp = timestamp;
    }

    async openWorkflowDropdown(page) {
        console.log('\n📂 Opening workflow dropdown menu...');

        // Find and click the search input area that has the dropdown
        const searchContainer = await page.$('div.menubar-page-search-input-container[aria-label="workflowSearch"]');

        if (!searchContainer) {
            console.log('  ⚠️ Could not find workflow search dropdown button');
            return false;
        }

        // Click the button inside the container to open dropdown
        const dropdownButton = await searchContainer.$('button');
        if (dropdownButton) {
            await dropdownButton.click();
            console.log('  ✓ Clicked dropdown button');

            // Wait for dropdown menu to appear
            await page.waitForSelector('div.menubar-dropdown', { timeout: 5000 });
            await page.waitForTimeout(1000); // Let dropdown fully render
            console.log('  ✓ Dropdown menu opened');
            return true;
        }

        return false;
    }

    async parseDropdownStructure(page) {
        console.log('\n🔍 Parsing dropdown structure...');

        const dropdownItems = await page.$$eval('div.menubar-dropdown .context-menu-item', items => {
            return items.map((item, index) => {
                // Get the text content
                const textElement = item.querySelector('span._1nfonn87');
                const text = textElement ? textElement.textContent.trim() : '';

                // Get indentation level from style
                const indentElement = item.querySelector('div._5r6zugz');
                let indentLevel = 0;
                if (indentElement) {
                    const style = indentElement.getAttribute('style');
                    const match = style ? style.match(/--_5r6zug2:\s*(\d+)px/) : null;
                    if (match) {
                        indentLevel = parseInt(match[1]);
                    }
                }

                return {
                    index,
                    text,
                    indentLevel,
                    isWorkflowGroup: indentLevel === 0 || !indentElement,
                    isWorkflowTrigger: text.includes(' is called'),
                    isAction: indentLevel === 24
                };
            });
        });

        console.log(`  Found ${dropdownItems.length} items in dropdown`);

        // Build hierarchical structure
        const workflows = [];
        let currentWorkflow = null;

        for (const item of dropdownItems) {
            if (item.isWorkflowGroup && !item.isWorkflowTrigger) {
                // This is a parent group like "(L2) Duplicate A Listing"
                if (currentWorkflow && currentWorkflow.trigger) {
                    workflows.push(currentWorkflow);
                }
                currentWorkflow = {
                    group: item.text,
                    index: item.index,
                    trigger: null,
                    workflow_name: null,
                    steps_preview: []
                };
            } else if (item.isWorkflowTrigger) {
                // This is the actual workflow trigger
                const workflowName = item.text.replace(' is called', '').trim();
                if (!currentWorkflow) {
                    currentWorkflow = {
                        group: workflowName,
                        index: item.index,
                        trigger: null,
                        workflow_name: null,
                        steps_preview: []
                    };
                }
                currentWorkflow.trigger = item.text;
                currentWorkflow.workflow_name = workflowName;
            } else if (item.isAction && currentWorkflow) {
                // This is an action step
                currentWorkflow.steps_preview.push(item.text);
            }
        }

        // Don't forget the last workflow
        if (currentWorkflow && currentWorkflow.trigger) {
            workflows.push(currentWorkflow);
        }

        console.log(`  ✓ Parsed ${workflows.length} workflows from dropdown`);
        this.dropdownStructure = workflows;
        return workflows;
    }

    async clickWorkflowInDropdown(page, workflowItem) {
        console.log(`\n  Clicking workflow: ${workflowItem.workflow_name}`);

        // Re-open dropdown if needed
        const dropdownVisible = await page.$('div.menubar-dropdown');
        if (!dropdownVisible) {
            await this.openWorkflowDropdown(page);
        }

        // Find and click the specific workflow trigger item
        const dropdownItems = await page.$$('div.menubar-dropdown .context-menu-item');

        for (const item of dropdownItems) {
            const text = await item.$eval('span._1nfonn87', el => el.textContent.trim()).catch(() => '');
            if (text === workflowItem.trigger) {
                await item.click();
                console.log(`    ✓ Clicked: ${text}`);

                // Wait for workflow to load
                await page.waitForTimeout(3000);

                // Check if workflow loaded by looking for canvas elements
                try {
                    await page.waitForSelector('[data-name="EventCard"], [data-name="ActionCard"]', {
                        timeout: 5000
                    });
                    return true;
                } catch (e) {
                    console.log('    ⚠️ Workflow may not have loaded properly');
                }
                break;
            }
        }

        return false;
    }

    async extractWorkflowDetails(page, workflowItem) {
        console.log(`  Extracting detailed workflow data with full configuration...`);

        const workflowData = {
            workflow_name: workflowItem.workflow_name,
            workflow_group: workflowItem.group,
            dropdown_position: workflowItem.index,
            steps_preview: workflowItem.steps_preview,
            folder: workflowItem.group,
            steps: [],
            extracted_at: new Date().toISOString()
        };

        // Get URL parameters
        const currentUrl = page.url();
        const urlObj = new URL(currentUrl);
        workflowData.wf_item = urlObj.searchParams.get('wf_item');

        // Wait for workflow to be fully loaded
        await page.waitForTimeout(3000);

        // First, wait for the workflow canvas to have content
        try {
            await page.waitForSelector('[data-name="EventCard"], [data-name="ActionCard"]', {
                timeout: 10000
            });
        } catch (e) {
            console.log('    ⚠️ No workflow cards found after waiting 10 seconds');
            return workflowData;
        }

        // Extract trigger/event card with full details
        const eventCard = await page.$('[data-name="EventCard"]');
        if (eventCard) {
            console.log('    Processing trigger/event card...');

            // Get event type (e.g., "API Event")
            const eventType = await eventCard.$('span._1nfonn87._1lkv1fw9._1lkv1fwe._1ij2r33');
            const eventTypeText = eventType ? await eventType.textContent() : 'Event';

            // Get event/workflow name from the specific class
            const eventText = await eventCard.$('span._1nfonn87._1lkv1fwa._1ij2r31._1lkv1fwe');
            if (eventText) {
                workflowData.workflow_name = (await eventText.textContent()).trim().replace(' is called', '');
            }

            // Click to open event properties
            console.log('      Clicking event card to open properties...');
            await eventCard.click();
            await page.waitForTimeout(2000);

            // Capture the wf_item from URL after clicking the event
            const eventUrl = page.url();
            const eventUrlObj = new URL(eventUrl);
            const eventWfItem = eventUrlObj.searchParams.get('wf_item');

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
                wf_item: eventWfItem,  // Add wf_item for the trigger
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

        // Get all action cards chronologically
        let actionCards = await page.$$('[data-name="ActionCard"]');
        console.log(`    Found ${actionCards.length} action steps to process chronologically`);

        if (actionCards.length === 0 && eventCard) {
            console.log('    ⚠️ Warning: No action cards found, but event card exists');
        }

        let stepOrder = workflowData.steps.length + 1;

        // Process each action card chronologically with full detail extraction
        for (let i = 0; i < actionCards.length; i++) {
            console.log(`    Processing action ${i + 1}/${actionCards.length} chronologically...`);

            // Re-query action cards each time in case DOM changes after clicking
            actionCards = await page.$$('[data-name="ActionCard"]');
            if (i >= actionCards.length) {
                console.log('      Action card no longer available after DOM change, skipping...');
                break;
            }

            try {
                const stepDetails = await this.extractStepDetailsWithClick(page, actionCards[i]);

                const step = {
                    order: stepOrder++,
                    action: stepDetails.title || `Step ${stepOrder - 1}`,
                    ...stepDetails
                };

                workflowData.steps.push(step);
            } catch (error) {
                console.log(`      Error extracting action ${i + 1}: ${error.message}`);
            }

            // Small delay between clicking steps
            await page.waitForTimeout(500);
        }

        // Log if no steps were extracted despite having cards
        if (workflowData.steps.length === 0 && (eventCard || actionCards.length > 0)) {
            console.log('    ⚠️ ERROR: Workflow has cards but NO steps were extracted!');
        }

        // Generate hash for tracking
        workflowData.hash = crypto.createHash('sha256')
            .update(JSON.stringify(workflowData.steps))
            .digest('hex')
            .substring(0, 16);

        return workflowData;
    }

    async extractStepDetailsWithClick(page, actionCard) {
        const stepDetails = {
            title: '',
            action_type: '',
            step_number: '',
            wf_item: null,  // Add wf_item for the step
            configuration: {},
            fields: [],
            conditions: null
        };

        try {
            // Get step number (e.g., "Step 1")
            const stepLabel = await actionCard.$('span._1nfonn87._1lkv1fw9._1lkv1fwe._1ij2r33');
            if (stepLabel) {
                stepDetails.step_number = await stepLabel.textContent();
            }

            // Get action title from the specific class pattern
            const titleElement = await actionCard.$('span._1nfonn87._1lkv1fwa._1lkv1fwe._1ij2r31');
            if (titleElement) {
                stepDetails.title = await titleElement.textContent();
            }

            // Get condition text if present
            const conditionElement = await actionCard.$('span._1nfonn87._1lkv1fwa._1lkv1fwc._1ij2r33');
            if (conditionElement) {
                const conditionText = await conditionElement.textContent();
                if (conditionText && conditionText.startsWith('Only when')) {
                    stepDetails.conditions = conditionText.replace('Only when ', '');
                }
            }

            // Click the action card to open property panel
            console.log(`      Clicking step: ${stepDetails.title || 'Unknown Step'}`);
            await actionCard.click();
            await page.waitForTimeout(2000); // Wait longer for property panel to open

            // Capture the wf_item from URL after clicking the step
            const currentUrl = page.url();
            const urlObj = new URL(currentUrl);
            stepDetails.wf_item = urlObj.searchParams.get('wf_item');

            if (stepDetails.wf_item) {
                console.log(`        Captured wf_item: ${stepDetails.wf_item}`);
            }

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

    async combineAllWorkflowFiles() {
        console.log('\n📚 Combining all workflow files into single JSON...');

        try {
            const files = await fs.readdir(this.outputDir);
            const workflowFiles = files.filter(f =>
                f.endsWith('.json') &&
                !['combined-workflows-dropdown.json', 'dropdown-structure.json',
                 'RUN_SUMMARY.json', 'ALL_WORKFLOWS_COMBINED.json'].includes(f)
            );

            const allWorkflows = [];

            for (const file of workflowFiles) {
                const filePath = path.join(this.outputDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const workflow = JSON.parse(content);
                allWorkflows.push(workflow);
            }

            const combinedData = {
                extraction_metadata: {
                    run_timestamp: this.timestamp,
                    total_workflows: allWorkflows.length,
                    total_steps: allWorkflows.reduce((sum, w) => sum + (w.steps?.length || 0), 0),
                    combined_at: new Date().toISOString(),
                    source_directory: path.basename(this.outputDir)
                },
                workflows: allWorkflows.sort((a, b) =>
                    a.workflow_name.localeCompare(b.workflow_name)
                )
            };

            const combinedPath = path.join(this.outputDir, 'ALL_WORKFLOWS_COMBINED.json');
            await fs.writeFile(combinedPath, JSON.stringify(combinedData, null, 2));

            console.log(`  ✅ Combined ${allWorkflows.length} workflows into ALL_WORKFLOWS_COMBINED.json`);
            console.log(`  📊 Total size: ${(JSON.stringify(combinedData).length / 1024 / 1024).toFixed(2)} MB`);

            return combinedData;
        } catch (error) {
            console.log(`  ⚠️ Failed to combine workflow files: ${error.message}`);
            return null;
        }
    }

    async run() {
        const { browser, page } = await launchBrowserWithSession();

        try {
            await fs.mkdir(this.outputDir, { recursive: true });

            console.log(`\n📁 Creating output directory: ${path.basename(this.outputDir)}`);
            console.log('Navigating to Bubble.io editor...');
            await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            console.log('Editor loaded with active session');

            // Open dropdown and parse structure
            const dropdownOpened = await this.openWorkflowDropdown(page);
            if (!dropdownOpened) {
                console.log('❌ Failed to open workflow dropdown');
                return;
            }

            const workflows = await this.parseDropdownStructure(page);
            console.log(`\n📋 Found ${workflows.length} workflows to process`);

            // Close dropdown before processing
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);

            const results = {
                workflows: [],
                extracted_at: new Date().toISOString(),
                total_workflows: workflows.length,
                total_steps: 0
            };

            // Process each workflow
            for (let i = 0; i < workflows.length; i++) {
                const workflow = workflows[i];
                console.log(`\n[${i + 1}/${workflows.length}] Processing: ${workflow.workflow_name}`);

                try {
                    // Click workflow in dropdown
                    const clicked = await this.clickWorkflowInDropdown(page, workflow);

                    if (clicked) {
                        // Extract workflow details
                        const workflowData = await this.extractWorkflowDetails(page, workflow);

                        results.workflows.push(workflowData);
                        results.total_steps += workflowData.steps.length;

                        // Save individual workflow file
                        const safeName = workflow.workflow_name
                            .replace(/[^a-zA-Z0-9-_]/g, '_')
                            .substring(0, 50);
                        const fileName = `${safeName}_${workflowData.hash}.json`;
                        const filePath = path.join(this.outputDir, fileName);

                        await fs.writeFile(filePath, JSON.stringify(workflowData, null, 2));
                        console.log(`  ✅ Extracted ${workflowData.steps.length} steps`);
                        console.log(`  💾 Saved: ${fileName}`);
                    } else {
                        console.log('  ⚠️ Could not click workflow in dropdown');
                    }

                    // Small delay between workflows
                    await page.waitForTimeout(1000);

                } catch (error) {
                    console.log(`  ❌ Error processing workflow: ${error.message}`);
                }
            }

            // Save combined results
            const combinedPath = path.join(this.outputDir, 'combined-workflows-dropdown.json');
            await fs.writeFile(combinedPath, JSON.stringify(results, null, 2));

            // Save dropdown structure for reference
            const structurePath = path.join(this.outputDir, 'dropdown-structure.json');
            await fs.writeFile(structurePath, JSON.stringify(this.dropdownStructure, null, 2));

            // Save run summary with metadata
            const summary = {
                run_timestamp: this.timestamp,
                run_directory: path.basename(this.outputDir),
                extraction_started: results.extracted_at,
                extraction_completed: new Date().toISOString(),
                total_workflows_found: workflows.length,
                total_workflows_processed: results.workflows.length,
                total_steps_extracted: results.total_steps,
                average_steps_per_workflow: results.workflows.length > 0
                    ? (results.total_steps / results.workflows.length).toFixed(2)
                    : 0,
                workflows_summary: results.workflows.map(w => ({
                    name: w.workflow_name,
                    steps: w.steps.length,
                    wf_item: w.wf_item
                }))
            };

            const summaryPath = path.join(this.outputDir, 'RUN_SUMMARY.json');
            await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

            // Combine all individual workflow files
            const combinedData = await this.combineAllWorkflowFiles();

            console.log('\n=== Dropdown Extraction Complete ===');
            console.log(`Total workflows processed: ${results.workflows.length}`);
            console.log(`Total steps extracted: ${results.total_steps}`);
            if (combinedData) {
                console.log(`Combined file created: ALL_WORKFLOWS_COMBINED.json`);
            }
            console.log(`Timestamp: ${this.timestamp}`);
            console.log(`Output directory: ${this.outputDir}`);

        } catch (error) {
            console.error('Fatal error:', error);
        } finally {
            await browser.close();
        }
    }
}

// Run if called directly
if (require.main === module) {
    const extractor = new DropdownWorkflowExtractor();
    extractor.run().catch(console.error);
}

module.exports = DropdownWorkflowExtractor;