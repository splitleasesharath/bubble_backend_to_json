const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const WorkflowParser = require('./lib/workflow-parser');
const StepExtractor = require('./lib/step-extractor');
const ParameterExtractor = require('./lib/parameter-extractor');
const HashGenerator = require('./lib/hash-generator');
const DependencyAnalyzer = require('./lib/dependency-analyzer');
const { BROWSER_CONFIG, launchBrowserWithSession } = require('./config/browser-config');

class WorkflowJSONCapture {
    constructor() {
        this.profilePath = BROWSER_CONFIG.profilePath;
        this.baseUrl = BROWSER_CONFIG.urls.baseUrl;
        this.workflowsData = [];
        this.dependencies = [];
        this.sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

        // Initialize parsers
        this.workflowParser = new WorkflowParser();
        this.stepExtractor = new StepExtractor();
        this.parameterExtractor = new ParameterExtractor();
        this.hashGenerator = new HashGenerator();
        this.dependencyAnalyzer = new DependencyAnalyzer();
    }

    async initialize() {
        console.log('🚀 Starting Workflow JSON Capture System...');
        console.log(`📅 Session: ${this.sessionTimestamp}`);

        // Create output directories
        const outputDir = path.join(__dirname, 'workflow-data', `session-${this.sessionTimestamp}`);
        const snapshotDir = path.join(__dirname, 'snapshots', this.sessionTimestamp.split('T')[0]);

        await fs.mkdir(outputDir, { recursive: true });
        await fs.mkdir(snapshotDir, { recursive: true });

        return { outputDir, snapshotDir };
    }

    async launchBrowser() {
        const { browser, page } = await launchBrowserWithSession();
        return { context: browser, page };
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

        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000); // Wait for dynamic content

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
            // Extract workflow metadata
            console.log('  📊 Extracting workflow metadata...');
            workflowData.metadata = await this.workflowParser.extractMetadata(page);

            // Extract workflow interface (parameters)
            console.log('  📝 Extracting workflow parameters...');
            workflowData.interface.inputs = await this.parameterExtractor.extractWorkflowParameters(page);

            // Extract all steps/actions
            console.log('  🔄 Extracting workflow steps...');
            const steps = await this.extractAllSteps(page);
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

    async extractAllSteps(page) {
        const steps = [];

        // Find all step elements in the main canvas
        const stepElements = await page.$$('div[class*="step"], div[class*="action"], div[role="button"][class*="workflow"]');

        console.log(`    Found ${stepElements.length} potential step elements`);

        for (let i = 0; i < stepElements.length; i++) {
            const element = stepElements[i];

            try {
                // Check if this is actually a step
                const text = await element.textContent();
                if (!text || !text.includes('Step')) continue;

                // Extract step number
                const stepMatch = text.match(/Step\s+(\d+)/i);
                const stepNumber = stepMatch ? parseInt(stepMatch[1]) : i + 1;

                console.log(`    📌 Processing Step ${stepNumber}...`);

                // Click on the step to open properties panel
                await element.click();
                await page.waitForTimeout(1000);

                // Extract step data
                const stepData = await this.extractStepDetails(page, stepNumber, element);

                // Try to extract wf_item from current URL or step properties
                const currentUrl = page.url();
                const urlObj = new URL(currentUrl);
                const stepWfItem = urlObj.searchParams.get('action_id') ||
                                   urlObj.searchParams.get('step_id') ||
                                   `step_${stepNumber}_${Date.now()}`;

                stepData.wf_item = stepWfItem;
                stepData.step_hash = this.hashGenerator.generateStepHash(stepData);

                steps.push(stepData);

                // Close properties panel if open
                const closeButton = await page.$('button[aria-label="Close"], div.close-button, div[class*="close"]');
                if (closeButton) {
                    await closeButton.click();
                    await page.waitForTimeout(500);
                }

            } catch (error) {
                console.error(`    ⚠️ Error processing step ${i + 1}: ${error.message}`);
            }
        }

        return steps.sort((a, b) => a.order - b.order);
    }

    async extractStepDetails(page, stepNumber, stepElement) {
        const stepData = {
            order: stepNumber,
            title: '',
            action: '',
            thing_type: null,
            condition: null,
            parameters: [],
            call: null,
            outputs: []
        };

        try {
            // Extract from the step element
            const stepText = await stepElement.textContent();
            stepData.title = await this.stepExtractor.extractTitle(stepText);
            stepData.action = await this.stepExtractor.extractActionType(page);

            // Extract from properties panel
            const propertiesPanel = await this.findPropertiesPanel(page);

            if (propertiesPanel) {
                // Extract action details
                const actionDetails = await this.stepExtractor.extractActionDetails(propertiesPanel);
                Object.assign(stepData, actionDetails);

                // Extract parameters
                stepData.parameters = await this.parameterExtractor.extractStepParameters(propertiesPanel);

                // Check if this is a workflow call
                if (stepData.action === 'schedule_api_workflow' ||
                    stepData.action === 'trigger_custom_event' ||
                    stepData.action === 'call_workflow') {

                    stepData.call = await this.extractCallDetails(propertiesPanel);
                }
            }

        } catch (error) {
            console.error(`      ⚠️ Error extracting step details: ${error.message}`);
        }

        return stepData;
    }

    async findPropertiesPanel(page) {
        // Try multiple selectors for the properties panel
        const selectors = [
            'div.property-editor',
            'div.properties-panel',
            'div[class*="properties"]',
            'div.context-menu:visible',
            'div.workflow-properties',
            'div.action-properties',
            'div.grey-menu',
            'div[role="dialog"]'
        ];

        for (const selector of selectors) {
            const panel = await page.$(selector);
            if (panel && await panel.isVisible()) {
                return panel;
            }
        }

        return null;
    }

    async extractCallDetails(propertiesPanel) {
        const callData = {
            target: {
                workflow_id: null,
                endpoint: null,
                mode: 'async'
            },
            mapping: [],
            on_result: null
        };

        try {
            // Extract target workflow
            const workflowDropdown = await propertiesPanel.$('div[prop_name="workflow"] .dropdown-caption');
            if (workflowDropdown) {
                const workflowName = await workflowDropdown.textContent();
                callData.target.workflow_id = workflowName?.trim();

                // Try to find the wf_item for the target
                const targetWorkflow = this.workflowsList?.find(w =>
                    w.name.includes(workflowName) || workflowName.includes(w.name)
                );
                if (targetWorkflow) {
                    callData.target.wf_item = targetWorkflow.wf_item;
                }
            }

            // Extract parameter mappings
            const paramMappings = await propertiesPanel.$$('div[class*="parameter-mapping"]');
            for (const mapping of paramMappings) {
                const toParam = await mapping.$eval('input[placeholder*="Parameter"]', el => el.value).catch(() => null);
                const fromValue = await mapping.$eval('input[placeholder*="Value"]', el => el.value).catch(() => null);

                if (toParam && fromValue) {
                    callData.mapping.push({
                        to: toParam,
                        from: this.parseParameterSource(fromValue)
                    });
                }
            }

            // Extract execution mode
            const modeCheckbox = await propertiesPanel.$('input[id*="async"], div.component-checkbox[prop_name*="async"]');
            if (modeCheckbox) {
                const isAsync = await modeCheckbox.isChecked?.() ||
                               (await modeCheckbox.getAttribute('class'))?.includes('checked');
                callData.target.mode = isAsync ? 'async' : 'sync';
            }

        } catch (error) {
            console.error(`      ⚠️ Error extracting call details: ${error.message}`);
        }

        return callData;
    }

    parseParameterSource(value) {
        if (!value) return { literal: null };

        // Check if it's a literal value
        if (value.startsWith('"') || value.startsWith("'")) {
            return { literal: value.slice(1, -1) };
        }

        // Check if it's an expression
        if (value.includes('.') || value.includes('[')) {
            return { expr: value };
        }

        // Check if it's a variable reference
        if (value.startsWith('$') || value.includes('Result of')) {
            return { var: value.replace('$', '').replace('Result of ', '') };
        }

        // Default to expression
        return { expr: value };
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
            this.browser = context;
            this.page = page;

            // Navigate to base URL
            await this.page.goto(this.baseUrl);
            await this.page.waitForTimeout(5000);

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
                    await this.navigateToWorkflow(this.page, workflow);

                    // Extract data
                    const workflowData = await this.extractWorkflowData(this.page, workflow);

                    // Save data
                    await this.saveWorkflowData(workflowData, outputDir, snapshotDir);

                    this.workflowsData.push(workflowData);

                } catch (error) {
                    console.error(`❌ Failed to process workflow: ${error.message}`);
                }

                // Small delay between workflows
                await page.waitForTimeout(1000);
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
    const capture = new WorkflowJSONCapture();

    // Configure options
    const options = {
        maxWorkflows: process.env.MAX_WORKFLOWS ? parseInt(process.env.MAX_WORKFLOWS) : 5,
        startIndex: process.env.START_INDEX ? parseInt(process.env.START_INDEX) : 0
    };

    console.log('🚀 Starting Workflow JSON Extraction...');
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

module.exports = WorkflowJSONCapture;