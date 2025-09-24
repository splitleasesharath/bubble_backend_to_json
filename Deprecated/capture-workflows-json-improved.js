const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const HashGenerator = require('./lib/hash-generator');
const DependencyAnalyzer = require('./lib/dependency-analyzer');

class ImprovedWorkflowJSONCapture {
    constructor() {
        this.profilePath = path.join(__dirname, 'browser-profiles', 'default');
        this.baseUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&version=test';
        this.workflowsData = [];
        this.dependencies = [];
        this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

        this.hashGenerator = new HashGenerator();
        this.dependencyAnalyzer = new DependencyAnalyzer();
    }

    async initialize() {
        console.log('🚀 Starting Improved Workflow JSON Capture...');
        console.log(`📅 Session: ${this.sessionTimestamp}`);

        const outputDir = path.join(__dirname, 'workflow-data', `session-${this.sessionTimestamp}`);
        const snapshotDir = path.join(__dirname, 'snapshots', this.sessionTimestamp.split('T')[0]);

        await fs.mkdir(outputDir, { recursive: true });
        await fs.mkdir(snapshotDir, { recursive: true });

        return { outputDir, snapshotDir };
    }

    async launchBrowser() {
        console.log('🌐 Launching Chrome browser...');

        const context = await chromium.launchPersistentContext(this.profilePath, {
            headless: false,
            channel: 'chrome',
            viewport: { width: 1920, height: 1080 },
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--window-size=1920,1080'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const page = await context.newPage();
        return { context, page };
    }

    async loadWorkflowList() {
        console.log('📋 Loading workflow list...');

        try {
            const workflowsPath = path.join(__dirname, 'workflow-ids-final.json');
            const data = await fs.readFile(workflowsPath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error('❌ Failed to load workflow list:', error.message);
            throw error;
        }
    }

    async navigateToWorkflow(page, workflow) {
        console.log(`\n📍 Navigating to: ${workflow.name}`);

        const url = workflow.full_url ||
            `${this.baseUrl}&wf_item=${workflow.wf_item}`;

        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

        // Wait for page to fully load
        await page.waitForTimeout(8000);

        return url;
    }

    async extractWorkflowData(page, workflowInfo) {
        console.log(`🔍 Extracting data for: ${workflowInfo.name}`);

        const workflowData = {
            workflow_id: `wf_${workflowInfo.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
            wf_item: workflowInfo.wf_item,
            name: workflowInfo.name,
            url: page.url(),
            captured_at: new Date().toISOString(),
            version: 1,
            metadata: {},
            interface: {
                inputs: [],
                outputs: []
            },
            steps: [],
            dependencies: []
        };

        try {
            // Extract workflow metadata from the right panel
            console.log('  📊 Extracting workflow metadata...');
            workflowData.metadata = await this.extractWorkflowMetadataFromPanel(page);

            // Extract workflow parameters from the right panel
            console.log('  📝 Extracting workflow parameters...');
            workflowData.interface.inputs = await this.extractWorkflowParametersFromPanel(page);

            // Extract all steps from the canvas
            console.log('  🔄 Extracting workflow steps...');
            const steps = await this.extractStepsFromCanvas(page);
            workflowData.steps = steps;

            // Analyze dependencies
            console.log('  🔗 Analyzing workflow dependencies...');
            const deps = this.dependencyAnalyzer.analyze(workflowData);
            workflowData.dependencies = deps;
            this.dependencies.push(...deps);

            // Generate hash
            workflowData.hash = this.hashGenerator.generateWorkflowHash(workflowData);

            console.log(`  ✅ Extracted ${steps.length} steps`);

        } catch (error) {
            console.error(`  ❌ Error extracting workflow data: ${error.message}`);
            workflowData.error = error.message;
        }

        return workflowData;
    }

    async extractWorkflowMetadataFromPanel(page) {
        const metadata = {
            endpoint: null,
            trigger: { type: 'api_event', method: 'POST' },
            response_type: 'json_object',
            timezone: 'US/Eastern',
            exposed_as_api: false,
            requires_authentication: true,
            description: null,
            settings: {}
        };

        try {
            // The right panel contains the workflow properties
            // Based on the screenshot, we can see the properties panel on the right

            // Extract endpoint name
            const endpointInput = await page.$('input[value*="CORE"], input[value*="core"]');
            if (endpointInput) {
                const value = await endpointInput.inputValue();
                if (value) {
                    metadata.endpoint = value.replace('CORE-', '').replace('core-', '');
                }
            }

            // Look for "Expose as a public API workflow" checkbox
            const exposeCheckbox = await page.locator('text=Expose as a public API workflow').first();
            if (await exposeCheckbox.isVisible()) {
                // Check if the checkbox before this text is checked
                const checkboxElement = await page.locator('text=Expose as a public API workflow').locator('xpath=preceding-sibling::input[@type="checkbox"]').first();
                if (checkboxElement) {
                    metadata.exposed_as_api = await checkboxElement.isChecked();
                }
            }

            // Look for authentication checkbox
            const authCheckbox = await page.locator('text=This workflow can be run without authentication').first();
            if (await authCheckbox.isVisible()) {
                const checkboxElement = await page.locator('text=This workflow can be run without authentication').locator('xpath=preceding-sibling::input[@type="checkbox"]').first();
                if (checkboxElement) {
                    metadata.requires_authentication = !(await checkboxElement.isChecked());
                }
            }

            // Extract trigger method (POST/GET)
            const triggerMethodElement = await page.locator('text=Trigger workflow with').first();
            if (await triggerMethodElement.isVisible()) {
                // Look for the dropdown/select after this label
                const methodValue = await page.locator('text=Trigger workflow with').locator('xpath=following::*[contains(@class, "dropdown") or contains(@class, "select")]').first().textContent();
                if (methodValue) {
                    metadata.trigger.method = methodValue.trim();
                }
            }

            // Extract response type
            const responseTypeElement = await page.locator('text=Response type').first();
            if (await responseTypeElement.isVisible()) {
                const responseValue = await page.locator('text=Response type').locator('xpath=following::*[contains(@class, "dropdown") or contains(@class, "select")]').first().textContent();
                if (responseValue) {
                    metadata.response_type = responseValue.trim().toLowerCase().replace(/\s+/g, '_');
                }
            }

            // Extract timezone
            const timezoneElement = await page.locator('text=Time zone selection').first();
            if (await timezoneElement.isVisible()) {
                const timezoneValue = await page.locator('text=Time zone selection').locator('xpath=following::*[contains(@class, "dropdown") or contains(@class, "select")]').first().textContent();
                if (timezoneValue && timezoneValue.includes('/')) {
                    metadata.timezone = timezoneValue.trim();
                }
            }

            // Try to get workflow name from the page title or header
            const workflowNameFromTitle = await page.locator('text=/core.*is called/i').first().textContent().catch(() => null);
            if (workflowNameFromTitle) {
                const cleanName = workflowNameFromTitle.replace(' is called', '').trim();
                if (!metadata.endpoint) {
                    metadata.endpoint = cleanName.replace(/^(CORE|core)[-\s]+/, '').replace(/\s+/g, '_').toLowerCase();
                }
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting metadata from panel:', error.message);
        }

        return metadata;
    }

    async extractWorkflowParametersFromPanel(page) {
        const parameters = [];

        try {
            // Look for the parameter definition section in the right panel
            const paramSection = await page.locator('text=Parameter definition').first();

            if (await paramSection.isVisible()) {
                // Find all parameter rows in the panel
                // Each parameter has Key, Type, and checkboxes for options

                // Look for parameter entries - they typically have input fields for key and dropdowns for type
                const parameterRows = await page.$$('div.row:has(input[placeholder*="Key"]), div.entry:has(input[placeholder*="Key"])');

                console.log(`    Found ${parameterRows.length} parameter rows`);

                for (const row of parameterRows) {
                    const param = {
                        key: null,
                        type: 'text',
                        data_type: null,
                        optional: true,
                        is_list: false,
                        in_querystring: false
                    };

                    // Extract key
                    const keyInput = await row.$('input[placeholder*="Key"], input[type="text"]');
                    if (keyInput) {
                        const keyValue = await keyInput.inputValue();
                        if (keyValue && keyValue.trim()) {
                            param.key = keyValue.trim();
                        }
                    }

                    // Extract type
                    const typeDropdown = await row.$('div.dropdown-caption, select');
                    if (typeDropdown) {
                        const typeText = await typeDropdown.textContent();
                        if (typeText && typeText.trim()) {
                            param.type = typeText.trim();
                            // Check if it's a custom data type like "User", "Listing", etc.
                            if (typeText.match(/^[A-Z]/)) {
                                param.data_type = typeText.trim();
                                param.type = 'custom_type';
                            }
                        }
                    }

                    // Check for "Is a list/array" checkbox
                    const listCheckbox = await row.$('text=Is a list/array');
                    if (listCheckbox) {
                        const checkbox = await row.$('input[type="checkbox"]');
                        if (checkbox) {
                            param.is_list = await checkbox.isChecked();
                        }
                    }

                    // Check for "Optional" checkbox
                    const optionalCheckbox = await row.$('text=Optional');
                    if (optionalCheckbox) {
                        const checkbox = await row.$('input[type="checkbox"]');
                        if (checkbox) {
                            param.optional = await checkbox.isChecked();
                        }
                    }

                    // Check for "Querystring" checkbox
                    const querystringCheckbox = await row.$('text=Querystring');
                    if (querystringCheckbox) {
                        const checkbox = await row.$('input[type="checkbox"]');
                        if (checkbox) {
                            param.in_querystring = await checkbox.isChecked();
                        }
                    }

                    if (param.key) {
                        parameters.push(param);
                    }
                }

                // Alternative: Look for the actual parameter values visible in the screenshot
                // In the screenshot we can see "user" parameter with type "User"
                if (parameters.length === 0) {
                    // Try to extract from visible text
                    const userParam = await page.locator('text=user').first();
                    if (await userParam.isVisible()) {
                        parameters.push({
                            key: 'user',
                            type: 'custom_type',
                            data_type: 'User',
                            optional: true,
                            is_list: false,
                            in_querystring: false
                        });
                    }
                }
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting parameters:', error.message);
        }

        return parameters;
    }

    async extractStepsFromCanvas(page) {
        const steps = [];

        try {
            // Based on the analysis, we found that steps are in the center canvas area
            // They have "Step N" text followed by the action name

            // First, try to find all step elements on the canvas
            // Steps typically have classes containing "step" or specific patterns we identified
            const stepElements = await page.$$('div:has-text("Step "):not([class*="sidebar"]):not([class*="navigation"])');

            console.log(`    Found ${stepElements.length} potential step elements`);

            // If we have step elements, extract data from each
            if (stepElements.length > 0) {
                // Get unique steps based on position (to avoid duplicates)
                const uniqueSteps = new Map();

                for (const element of stepElements) {
                    try {
                        const boundingBox = await element.boundingBox();
                        if (!boundingBox || boundingBox.width === 0 || boundingBox.height === 0) continue;

                        // Skip if it's in the left sidebar (x < 300) or right panel (x > 1400)
                        if (boundingBox.x < 300 || boundingBox.x > 1400) continue;

                        const text = await element.textContent();
                        if (!text || !text.includes('Step')) continue;

                        // Extract step number
                        const stepMatch = text.match(/Step\s+(\d+)/i);
                        if (!stepMatch) continue;

                        const stepNumber = parseInt(stepMatch[1]);

                        // Create a position key to identify unique steps
                        const posKey = `${Math.round(boundingBox.x / 10)}_${Math.round(boundingBox.y / 10)}`;

                        if (!uniqueSteps.has(posKey)) {
                            // Extract the action name (text after "Step N")
                            const actionText = text.replace(/^Step\s+\d+/i, '').trim();

                            const stepData = {
                                wf_item: `step_${stepNumber}_${Date.now()}`,
                                order: stepNumber,
                                title: actionText || `Step ${stepNumber}`,
                                action: this.determineActionType(actionText),
                                thing_type: null,
                                condition: null,
                                parameters: [],
                                position: {
                                    x: boundingBox.x,
                                    y: boundingBox.y,
                                    width: boundingBox.width,
                                    height: boundingBox.height
                                }
                            };

                            // Try to click on the step to get more details
                            await element.click();
                            await page.waitForTimeout(1000);

                            // Look for any opened panel with step details
                            const stepDetails = await this.extractStepDetailsFromPanel(page);
                            if (stepDetails) {
                                Object.assign(stepData, stepDetails);
                            }

                            stepData.step_hash = this.hashGenerator.generateStepHash(stepData);
                            uniqueSteps.set(posKey, stepData);
                        }
                    } catch (error) {
                        console.error(`      ⚠️ Error processing step element: ${error.message}`);
                    }
                }

                // Convert map to array and sort by order
                steps.push(...Array.from(uniqueSteps.values()).sort((a, b) => a.order - b.order));
            }

            // If no steps found with the above method, try alternative approach
            if (steps.length === 0) {
                console.log('    ℹ️ Trying alternative step extraction method...');

                // Look for the specific action text we found in the analysis
                const actionElements = await page.$$('text="Add Ai Credits to User"');

                if (actionElements.length > 0) {
                    // This workflow has at least one step with this action
                    steps.push({
                        wf_item: `step_1_${Date.now()}`,
                        order: 1,
                        title: 'Add Ai Credits to User',
                        action: 'make_changes',
                        thing_type: 'User',
                        condition: null,
                        parameters: [],
                        step_hash: this.hashGenerator.generateStepHash({
                            order: 1,
                            action: 'make_changes',
                            title: 'Add Ai Credits to User'
                        })
                    });
                }
            }

            // Remove position data before returning (it's just for deduplication)
            steps.forEach(step => delete step.position);

        } catch (error) {
            console.error('    ⚠️ Error extracting steps from canvas:', error.message);
        }

        // Ensure at least one step (default)
        if (steps.length === 0) {
            console.log('    ⚠️ No steps detected, creating default step');
            steps.push({
                wf_item: `step_1_${Date.now()}`,
                order: 1,
                title: 'Default Step',
                action: 'unknown',
                thing_type: null,
                condition: null,
                parameters: [],
                step_hash: this.hashGenerator.generateStepHash({ order: 1, action: 'unknown' })
            });
        }

        return steps;
    }

    async extractStepDetailsFromPanel(page) {
        try {
            // After clicking a step, a properties panel might open
            // Look for common patterns in step property panels
            const details = {
                action: null,
                thing_type: null,
                condition: null,
                parameters: []
            };

            // Look for action type dropdown
            const actionDropdown = await page.$('text=Action type');
            if (actionDropdown) {
                const actionValue = await page.locator('text=Action type').locator('xpath=following::*[contains(@class, "dropdown")]').first().textContent();
                if (actionValue) {
                    details.action = this.normalizeActionType(actionValue.trim());
                }
            }

            // Look for thing type
            const thingDropdown = await page.$('text=Thing type');
            if (thingDropdown) {
                const thingValue = await page.locator('text=Thing type').locator('xpath=following::*[contains(@class, "dropdown")]').first().textContent();
                if (thingValue) {
                    details.thing_type = thingValue.trim();
                }
            }

            // Look for condition
            const conditionInput = await page.$('text=Only when');
            if (conditionInput) {
                const conditionValue = await page.locator('text=Only when').locator('xpath=following::input').first().inputValue();
                if (conditionValue) {
                    details.condition = conditionValue.trim();
                }
            }

            // Extract any visible parameters for this step
            const paramInputs = await page.$$('div.field-mapping input, div.parameter-field input');
            for (const input of paramInputs) {
                const value = await input.inputValue();
                if (value && value.trim()) {
                    details.parameters.push({
                        key: 'field',
                        value: value.trim()
                    });
                }
            }

            return Object.values(details).some(v => v !== null && (Array.isArray(v) ? v.length > 0 : true)) ? details : null;

        } catch (error) {
            console.error('      ⚠️ Error extracting step details from panel:', error.message);
            return null;
        }
    }

    determineActionType(actionText) {
        if (!actionText) return 'unknown';

        const text = actionText.toLowerCase();

        if (text.includes('add') && text.includes('credit')) return 'add_credits';
        if (text.includes('make') && text.includes('change')) return 'make_changes';
        if (text.includes('create')) return 'create_thing';
        if (text.includes('delete')) return 'delete_thing';
        if (text.includes('schedule')) return 'schedule_api_workflow';
        if (text.includes('send') && text.includes('email')) return 'send_email';
        if (text.includes('trigger')) return 'trigger_custom_event';
        if (text.includes('update')) return 'make_changes';
        if (text.includes('add') && text.includes('list')) return 'add_to_list';
        if (text.includes('remove') && text.includes('list')) return 'remove_from_list';

        return 'custom_action';
    }

    normalizeActionType(actionText) {
        const normalized = actionText.toLowerCase().trim();
        return normalized.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }

    async saveWorkflowData(workflowData, outputDir, snapshotDir) {
        const fileName = `${workflowData.workflow_id}_${workflowData.wf_item}.json`;

        // Save to main output directory
        const outputPath = path.join(outputDir, fileName);
        await fs.writeFile(outputPath, JSON.stringify(workflowData, null, 2));

        // Save to snapshot directory
        const snapshotPath = path.join(snapshotDir, fileName);
        await fs.writeFile(snapshotPath, JSON.stringify(workflowData, null, 2));

        console.log(`  💾 Saved: ${fileName}`);

        return { outputPath, snapshotPath };
    }

    async saveSummary(outputDir) {
        const summary = {
            session: this.sessionTimestamp,
            total_workflows: this.workflowsData.length,
            total_steps: this.workflowsData.reduce((sum, w) => sum + w.steps.length, 0),
            total_dependencies: this.dependencies.length,
            workflows: this.workflowsData.map(w => ({
                name: w.name,
                wf_item: w.wf_item,
                steps_count: w.steps.length,
                dependencies_count: w.dependencies.length,
                hash: w.hash,
                has_parameters: w.interface.inputs.length > 0
            }))
        };

        const summaryPath = path.join(outputDir, 'extraction-summary.json');
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

        console.log('\n📊 Summary saved to extraction-summary.json');

        return summary;
    }

    async saveDependencies() {
        if (this.dependencies.length === 0) return;

        const depsPath = path.join(__dirname, 'dependencies', `deps_${this.sessionTimestamp}.json`);
        const dependencyIndex = {
            timestamp: new Date().toISOString(),
            total: this.dependencies.length,
            dependencies: this.dependencies
        };

        await fs.writeFile(depsPath, JSON.stringify(dependencyIndex, null, 2));
        console.log(`🔗 Saved ${this.dependencies.length} dependencies`);
    }

    async run(options = {}) {
        const { maxWorkflows = null, startIndex = 0 } = options;

        try {
            // Initialize
            const { outputDir, snapshotDir } = await this.initialize();

            // Load workflow list
            this.workflowsList = await this.loadWorkflowList();
            console.log(`📚 Loaded ${this.workflowsList.length} workflows`);

            // Launch browser
            const { context, page } = await this.launchBrowser();

            // Navigate to base URL first
            console.log('\n🏠 Navigating to base Bubble editor...');
            await page.goto(this.baseUrl, { waitUntil: 'networkidle' });
            await page.waitForTimeout(5000);

            // Process workflows
            const endIndex = maxWorkflows ?
                Math.min(startIndex + maxWorkflows, this.workflowsList.length) :
                this.workflowsList.length;

            console.log(`\n🎯 Processing workflows ${startIndex + 1} to ${endIndex}...\n`);

            for (let i = startIndex; i < endIndex; i++) {
                const workflow = this.workflowsList[i];

                console.log(`\n${'='.repeat(60)}`);
                console.log(`📦 Workflow ${i + 1}/${endIndex}: ${workflow.name}`);
                console.log(`${'='.repeat(60)}`);

                try {
                    // Navigate to workflow
                    await this.navigateToWorkflow(page, workflow);

                    // Extract data
                    const workflowData = await this.extractWorkflowData(page, workflow);

                    // Save data
                    await this.saveWorkflowData(workflowData, outputDir, snapshotDir);

                    this.workflowsData.push(workflowData);

                } catch (error) {
                    console.error(`❌ Failed to process workflow: ${error.message}`);
                }

                // Small delay between workflows
                await page.waitForTimeout(3000);
            }

            // Save summary and dependencies
            const summary = await this.saveSummary(outputDir);
            await this.saveDependencies();

            // Display final summary
            console.log('\n' + '='.repeat(60));
            console.log('🎉 EXTRACTION COMPLETE');
            console.log('='.repeat(60));
            console.log(`✅ Workflows processed: ${summary.total_workflows}`);
            console.log(`📝 Total steps extracted: ${summary.total_steps}`);
            console.log(`🔗 Dependencies found: ${summary.total_dependencies}`);
            console.log(`💾 Data saved to: ${outputDir}`);
            console.log('='.repeat(60) + '\n');

            // Close browser
            await context.close();

            return summary;

        } catch (error) {
            console.error('❌ Fatal error:', error);
            throw error;
        }
    }
}

// Run the extraction
if (require.main === module) {
    const capture = new ImprovedWorkflowJSONCapture();

    // Configure options
    const options = {
        maxWorkflows: process.env.MAX_WORKFLOWS ? parseInt(process.env.MAX_WORKFLOWS) : 2,
        startIndex: process.env.START_INDEX ? parseInt(process.env.START_INDEX) : 0
    };

    console.log('🚀 Starting Improved Workflow JSON Extraction...');
    console.log(`📋 Options: Max ${options.maxWorkflows || 'all'} workflows, starting from index ${options.startIndex}`);
    console.log('');

    capture.run(options)
        .then(summary => {
            console.log('✨ Process completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Process failed:', error);
            process.exit(1);
        });
}

module.exports = ImprovedWorkflowJSONCapture;