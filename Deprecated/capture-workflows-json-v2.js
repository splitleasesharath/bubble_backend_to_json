const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const HashGenerator = require('./lib/hash-generator');
const DependencyAnalyzer = require('./lib/dependency-analyzer');

class WorkflowJSONCaptureV2 {
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
        console.log('🚀 Starting Improved Workflow JSON Capture System V2...');
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
            viewport: { width: 1440, height: 900 },
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        const page = await context.newPage();

        // Set up console logging to see what's happening in the page
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('Browser error:', msg.text());
            }
        });

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

        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(5000); // Wait for dynamic content to fully load

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
            // Extract workflow metadata from the properties panel
            console.log('  📊 Extracting workflow metadata...');
            workflowData.metadata = await this.extractWorkflowMetadata(page);

            // Extract workflow parameters
            console.log('  📝 Extracting workflow parameters...');
            workflowData.interface.inputs = await this.extractWorkflowParameters(page);

            // Extract all steps from the main canvas
            console.log('  🔄 Extracting workflow steps...');
            const steps = await this.extractWorkflowSteps(page);
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

    async extractWorkflowMetadata(page) {
        const metadata = {
            endpoint: null,
            trigger: { type: 'api_event', method: 'POST' },
            response_type: 'json_object',
            timezone: 'US/Eastern',
            exposed_as_api: true,
            requires_authentication: true,
            description: null,
            settings: {}
        };

        try {
            // Look for the workflow header/title area for metadata
            const workflowHeader = await page.$('div[class*="workflow-header"], div[class*="editor-header"]');

            if (workflowHeader) {
                const headerText = await workflowHeader.textContent();
                console.log(`    Found header: ${headerText?.substring(0, 50)}...`);
            }

            // Try to extract from URL parameters
            const url = page.url();
            const urlObj = new URL(url);
            metadata.wf_item = urlObj.searchParams.get('wf_item');

            // Extract workflow name from the page
            const workflowName = await page.$eval('span[class*="workflow-name"], div[class*="title"]',
                el => el.textContent
            ).catch(() => null);

            if (workflowName) {
                // Clean the workflow name to get endpoint
                metadata.endpoint = workflowName.trim()
                    .replace(/^(CORE|core)[-\s]+/, '')
                    .replace(/\s+is\s+called$/, '')
                    .replace(/\s+/g, '_')
                    .toLowerCase();
            }

            // Look for API Event indicator
            const hasAPIEvent = await page.$('text=API Event').catch(() => null);
            if (hasAPIEvent) {
                metadata.trigger.type = 'api_event';
            }

            // Look for Schedule API Workflow indicator
            const hasSchedule = await page.$('text=Schedule API Workflow').catch(() => null);
            if (hasSchedule) {
                metadata.trigger.type = 'scheduled';
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting metadata:', error.message);
        }

        return metadata;
    }

    async extractWorkflowParameters(page) {
        const parameters = [];

        try {
            // Look for the parameters section in the workflow
            // This is typically in the gray panel when you click on the workflow

            // First, try to click on the workflow settings/properties
            const workflowSettingsButton = await page.$('button[aria-label*="Settings"], div[class*="settings"]');
            if (workflowSettingsButton) {
                await workflowSettingsButton.click();
                await page.waitForTimeout(1000);
            }

            // Look for parameter entries
            const paramEntries = await page.$$('div[class*="parameter"], div[class*="param-entry"]');

            console.log(`    Found ${paramEntries.length} potential parameter entries`);

            for (const entry of paramEntries) {
                const param = await this.extractParameterFromEntry(entry);
                if (param && param.key) {
                    parameters.push(param);
                }
            }

            // Also try to extract from visible text that mentions parameters
            const visibleText = await page.$$eval('div', elements =>
                elements.map(el => el.textContent).filter(text =>
                    text && (text.includes('Parameter') || text.includes('parameter'))
                )
            );

            // Parse parameters from text if found
            for (const text of visibleText) {
                const paramMatch = text.match(/(?:Parameter|parameter):\s*(\w+)/);
                if (paramMatch && !parameters.find(p => p.key === paramMatch[1])) {
                    parameters.push({
                        key: paramMatch[1],
                        type: 'text',
                        optional: true
                    });
                }
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting parameters:', error.message);
        }

        return parameters;
    }

    async extractParameterFromEntry(entry) {
        try {
            const param = {
                key: null,
                type: 'text',
                optional: true,
                is_list: false
            };

            // Try to get parameter name
            const keyInput = await entry.$('input[placeholder*="Parameter"], input[placeholder*="Key"]');
            if (keyInput) {
                param.key = await keyInput.inputValue();
            }

            // Try to get parameter type
            const typeElement = await entry.$('div[class*="type"], select[class*="type"]');
            if (typeElement) {
                param.type = await typeElement.textContent();
            }

            // Check for optional checkbox
            const optionalCheckbox = await entry.$('input[type="checkbox"][id*="optional"]');
            if (optionalCheckbox) {
                param.optional = await optionalCheckbox.isChecked();
            }

            return param;
        } catch (error) {
            return null;
        }
    }

    async extractWorkflowSteps(page) {
        const steps = [];

        try {
            // Wait for the canvas to be visible
            await page.waitForSelector('canvas, div[class*="canvas"], div[class*="workflow-editor"]',
                { timeout: 10000 }
            ).catch(() => console.log('    ⚠️ Canvas not found'));

            // Look for step elements in the main workflow area
            // Steps are usually numbered and have specific visual indicators
            const stepSelectors = [
                'div[class*="workflow-step"]',
                'div[class*="action-box"]',
                'div[data-step]',
                'div[role="button"][class*="step"]',
                // Also look for numbered elements that might be steps
                'div:has-text("Step 1")',
                'div:has-text("Step 2")',
                'div:has-text("Step 3")'
            ];

            let allStepElements = [];

            for (const selector of stepSelectors) {
                const elements = await page.$$(selector).catch(() => []);
                allStepElements.push(...elements);
            }

            // Also try to find steps by looking for numbered boxes
            const numberedElements = await page.$$eval('div', elements => {
                return elements
                    .filter(el => {
                        const text = el.textContent || '';
                        // Look for "Step N" pattern and make sure it's not in the sidebar
                        return /^Step\s+\d+/i.test(text.trim()) &&
                               !el.closest('[class*="sidebar"]') &&
                               !el.closest('[class*="navigation"]');
                    })
                    .map(el => ({
                        text: el.textContent.substring(0, 100),
                        className: el.className,
                        id: el.id
                    }));
            });

            console.log(`    Found ${numberedElements.length} numbered step elements`);

            // Extract step data for each found element
            for (let i = 0; i < numberedElements.length; i++) {
                const stepNumber = i + 1;

                const stepData = {
                    wf_item: `step_${stepNumber}_${Date.now()}`,
                    order: stepNumber,
                    title: `Step ${stepNumber}`,
                    action: 'unknown',
                    thing_type: null,
                    condition: null,
                    parameters: [],
                    call: null
                };

                // Try to extract more details from the step text
                const stepText = numberedElements[i].text;
                if (stepText) {
                    // Extract action type from text
                    stepData.title = this.extractStepTitle(stepText);
                    stepData.action = this.extractActionType(stepText);
                    stepData.condition = this.extractCondition(stepText);
                }

                // Generate hash for the step
                stepData.step_hash = this.hashGenerator.generateStepHash(stepData);

                steps.push(stepData);
            }

            // If no steps found with the above methods, try clicking on the canvas
            if (steps.length === 0) {
                console.log('    ℹ️ No steps found with selectors, trying canvas click method...');

                // Click on different areas of the canvas to reveal steps
                const canvas = await page.$('canvas, div[class*="canvas"]');
                if (canvas) {
                    const box = await canvas.boundingBox();
                    if (box) {
                        // Click at different positions to find steps
                        const positions = [
                            { x: box.x + 100, y: box.y + 100 },
                            { x: box.x + 300, y: box.y + 100 },
                            { x: box.x + 500, y: box.y + 100 }
                        ];

                        for (const pos of positions) {
                            await page.mouse.click(pos.x, pos.y);
                            await page.waitForTimeout(500);

                            // Check if a properties panel opened
                            const propertiesPanel = await page.$('div[class*="properties"], div[class*="editor-panel"]');
                            if (propertiesPanel) {
                                const stepData = await this.extractStepFromPanel(propertiesPanel, steps.length + 1);
                                if (stepData) {
                                    steps.push(stepData);
                                }
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting steps:', error.message);
        }

        // If still no steps found, create a default one
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

    extractStepTitle(text) {
        // Remove "Step N" prefix and clean up
        const cleaned = text.replace(/^Step\s+\d+[:\s]*/i, '').trim();

        // Take only the first meaningful part (before excessive text)
        const lines = cleaned.split('\n');
        if (lines.length > 0) {
            // Find the actual action title (usually after step number)
            for (const line of lines) {
                // Skip navigation/menu items
                if (line.includes('Backend Workflows') ||
                    line.includes('Uncategorized') ||
                    line.includes('WORKFLOW:')) {
                    continue;
                }

                // Look for action-like text
                if (line.includes('Make changes') ||
                    line.includes('Create') ||
                    line.includes('Delete') ||
                    line.includes('Schedule') ||
                    line.includes('Add')) {
                    return line.trim();
                }
            }
        }

        // Fallback: return first 50 chars
        return cleaned.substring(0, 50).trim();
    }

    extractActionType(text) {
        const actionPatterns = {
            'make_changes': /make\s+changes\s+to/i,
            'create_thing': /create\s+(a\s+)?new/i,
            'delete_thing': /delete/i,
            'schedule_api_workflow': /schedule\s+(api\s+)?workflow/i,
            'trigger_custom_event': /trigger\s+custom\s+event/i,
            'send_email': /send\s+email/i,
            'add_to_list': /add.*to.*list/i,
            'remove_from_list': /remove.*from.*list/i
        };

        for (const [action, pattern] of Object.entries(actionPatterns)) {
            if (pattern.test(text)) {
                return action;
            }
        }

        return 'unknown_action';
    }

    extractCondition(text) {
        // Look for condition patterns
        const conditionPatterns = [
            /only\s+when\s+(.+)/i,
            /when\s+(.+)\s+is/i,
            /if\s+(.+)/i
        ];

        for (const pattern of conditionPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }

        return null;
    }

    async extractStepFromPanel(panel, stepNumber) {
        try {
            const stepData = {
                wf_item: `step_${stepNumber}_${Date.now()}`,
                order: stepNumber,
                title: `Step ${stepNumber}`,
                action: 'unknown',
                thing_type: null,
                condition: null,
                parameters: []
            };

            // Extract action type
            const actionDropdown = await panel.$('div[prop_name="action_type"] .dropdown-caption');
            if (actionDropdown) {
                stepData.action = await actionDropdown.textContent();
            }

            // Extract thing type
            const thingDropdown = await panel.$('div[prop_name="thing_type"] .dropdown-caption');
            if (thingDropdown) {
                stepData.thing_type = await thingDropdown.textContent();
            }

            // Extract condition
            const conditionInput = await panel.$('input[prop_name="condition"], textarea[prop_name="condition"]');
            if (conditionInput) {
                stepData.condition = await conditionInput.inputValue();
            }

            stepData.step_hash = this.hashGenerator.generateStepHash(stepData);

            return stepData;
        } catch (error) {
            return null;
        }
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
                hash: w.hash
            }))
        };

        const summaryPath = path.join(outputDir, 'extraction-summary.json');
        await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

        console.log('\n📊 Summary saved to extraction-summary.json');

        return summary;
    }

    async saveDependencies() {
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

            // Navigate to base URL
            await page.goto(this.baseUrl);
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
                await page.waitForTimeout(2000);
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
    const capture = new WorkflowJSONCaptureV2();

    // Configure options
    const options = {
        maxWorkflows: process.env.MAX_WORKFLOWS ? parseInt(process.env.MAX_WORKFLOWS) : 2,
        startIndex: process.env.START_INDEX ? parseInt(process.env.START_INDEX) : 0
    };

    console.log('🚀 Starting Improved Workflow JSON Extraction V2...');
    console.log(`📋 Options: Max ${options.maxWorkflows || 'all'} workflows, starting from index ${options.startIndex}`);

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

module.exports = WorkflowJSONCaptureV2;