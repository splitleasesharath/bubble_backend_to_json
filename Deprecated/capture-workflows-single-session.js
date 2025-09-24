const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class SingleSessionWorkflowExtractor {
    constructor(sessionId = null) {
        this.sessionId = sessionId || `session-${new Date().toISOString().replace(/[:]/g, '-').slice(0, -5)}`;
        this.baseDir = path.join(__dirname, 'workflow-data');
        this.profilePath = path.join(__dirname, 'browser-profiles', 'default');
    }

    async init() {
        await fs.mkdir(this.baseDir, { recursive: true });
        await fs.mkdir(path.join(this.baseDir, this.sessionId), { recursive: true });

        this.context = await chromium.launchPersistentContext(this.profilePath, {
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

        this.page = await this.context.newPage();
    }

    generateHash(data) {
        const content = JSON.stringify(data, Object.keys(data).sort());
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    async navigateToBackendWorkflows() {
        console.log('🌐 Navigating to Backend Workflows...');

        // Navigate to the backend workflows page
        await this.page.goto('https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&version=test', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Wait for the workflow list to be loaded
        console.log('⏳ Waiting for workflow list to load...');
        await this.page.waitForSelector('[data-name="workflowList"]', { timeout: 15000 });
        await this.page.waitForTimeout(3000); // Let everything settle
    }

    async extractAllWorkflowsFromPage() {
        console.log('🔍 Extracting all workflows from current page state...\n');

        // Get list of all workflows from the sidebar
        const workflowList = await this.page.evaluate(() => {
            const workflows = [];

            // Find all workflow items in the sidebar
            const workflowElements = document.querySelectorAll('[data-name="WorkflowItem"]');

            workflowElements.forEach(element => {
                const id = element.getAttribute('data-item-id');
                const textElement = element.querySelector('._13jwfz74, ._13jwfz75');
                const name = textElement ? textElement.textContent.trim() : 'Unknown';

                workflows.push({
                    wf_item: id,
                    name: name,
                    element_id: element.id
                });
            });

            return workflows;
        });

        console.log(`📋 Found ${workflowList.length} workflows in sidebar\n`);

        const allWorkflowData = [];

        // Process each workflow by clicking on it
        for (let i = 0; i < workflowList.length; i++) {
            const workflow = workflowList[i];
            console.log(`Processing [${i + 1}/${workflowList.length}]: ${workflow.name}`);

            try {
                // Click on the workflow in the sidebar to load it
                await this.page.click(`[data-item-id="${workflow.wf_item}"]`);

                // Wait for the canvas to update
                await this.page.waitForTimeout(1500);

                // Extract workflow data from the current view
                const workflowData = await this.extractCurrentWorkflowData(workflow);

                if (workflowData) {
                    allWorkflowData.push(workflowData);

                    // Save individual workflow file
                    const filename = `${workflow.name.replace(/[^a-z0-9-_]/gi, '_')}_${workflow.wf_item}.json`;
                    const filepath = path.join(this.baseDir, this.sessionId, filename);
                    await fs.writeFile(filepath, JSON.stringify(workflowData, null, 2));

                    console.log(`  ✅ Extracted ${workflowData.steps.length} steps`);
                }

            } catch (error) {
                console.log(`  ❌ Error: ${error.message}`);
            }
        }

        return allWorkflowData;
    }

    async extractCurrentWorkflowData(workflow) {
        const data = await this.page.evaluate((wf) => {
            const result = {
                workflow_id: wf.name.replace(/[^a-z0-9-_]/gi, '_'),
                wf_item: wf.wf_item,
                name: wf.name,
                url: window.location.href,
                captured_at: new Date().toISOString(),
                version: 1,
                metadata: {
                    endpoint: null,
                    trigger: { type: null, method: null },
                    response_type: null,
                    timezone: 'US/Eastern',
                    exposed_as_api: false,
                    requires_authentication: true,
                    description: null,
                    settings: {}
                },
                interface: { inputs: [], outputs: [] },
                steps: [],
                dependencies: []
            };

            // Extract workflow steps from the canvas
            const stepElements = [];
            const allElements = document.querySelectorAll('*');
            const processedSteps = new Set();

            // First pass: find all step containers
            for (const element of allElements) {
                const text = element.textContent || '';

                // Check if this looks like a step
                const stepMatch = text.match(/^Step\s+(\d+)/);
                if (!stepMatch) continue;

                const rect = element.getBoundingClientRect();

                // Must be in canvas area (center of screen)
                if (rect.x < 250 || rect.x > 1500) continue;
                if (rect.width === 0 || rect.height === 0) continue;

                const stepNumber = parseInt(stepMatch[1]);
                if (processedSteps.has(stepNumber)) continue;

                processedSteps.add(stepNumber);

                // Extract clean action text
                let actionText = text.replace(/^Step\s+\d+[:\s]*/i, '').trim();

                // Remove navigation items that might be mixed in
                const lines = actionText.split('\n').map(l => l.trim()).filter(l => l);
                let cleanAction = '';

                for (const line of lines) {
                    // Skip navigation patterns
                    if (line.match(/^(Backend Workflows|IN THIS APP|\d+$|Uncategorized|WORKFLOW|Bots|ChatGPT)/i)) continue;
                    if (line.match(/^(Bulk Fix|MAIN|System|Zapier|House Manual|Messaging|Virtual)/i)) continue;

                    // Action keywords we're looking for
                    const actionKeywords = [
                        'Schedule', 'Create', 'Delete', 'Update', 'Add', 'Send', 'Make',
                        'Trigger', 'Call', 'Return', 'Only when', 'Set', 'Clear', 'Remove',
                        'Navigate', 'Show', 'Hide', 'Display', 'Reset', 'Log', 'Terminate'
                    ];

                    for (const keyword of actionKeywords) {
                        if (line.includes(keyword)) {
                            cleanAction = line;
                            break;
                        }
                    }

                    if (cleanAction) break;
                }

                // If no action found, use first meaningful line
                if (!cleanAction && lines.length > 0) {
                    cleanAction = lines.find(l => l.length > 3 && !l.match(/^\d+$/)) || 'Unknown Action';
                }

                stepElements.push({
                    order: stepNumber,
                    title: cleanAction || 'Unknown Action',
                    position: { x: rect.x, y: rect.y }
                });
            }

            // Sort by step number
            stepElements.sort((a, b) => a.order - b.order);

            // Convert to final step format
            result.steps = stepElements.map(step => ({
                order: step.order,
                title: step.title,
                action: this.detectActionType ? this.detectActionType(step.title) : 'custom_action',
                thing_type: null,
                condition: null,
                parameters: [],
                call: null,
                outputs: [],
                wf_item: `step_${step.order}_${Date.now()}`,
                step_hash: ''
            }));

            // Try to extract metadata from properties panel
            const endpointElement = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('Endpoint name')
            );

            if (endpointElement) {
                const nextEl = endpointElement.nextElementSibling;
                if (nextEl && nextEl.textContent) {
                    result.metadata.endpoint = nextEl.textContent.trim();
                }
            }

            // Check if it's an API workflow
            const apiWorkflowIndicator = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('API Workflow')
            );

            if (apiWorkflowIndicator) {
                result.metadata.trigger.type = 'api_workflow';
                result.metadata.exposed_as_api = true;
            }

            // Look for parameters
            const paramSection = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('Parameter definition')
            );

            if (paramSection) {
                // Common pattern: user parameter
                const userParamExists = document.body.textContent.includes('Parameter: user');
                if (userParamExists) {
                    result.interface.inputs.push({
                        key: 'user',
                        name: 'user',
                        type: 'custom_type',
                        data_type: 'User',
                        optional: true,
                        is_list: false,
                        in_body: true
                    });
                }
            }

            return result;
        }, workflow);

        // Generate hashes
        data.steps.forEach(step => {
            step.step_hash = this.generateHash({
                order: step.order,
                title: step.title,
                action: step.action
            });
        });

        data.hash = this.generateHash(data);

        return data;
    }

    async run() {
        try {
            await this.init();
            await this.navigateToBackendWorkflows();

            const workflows = await this.extractAllWorkflowsFromPage();

            // Save summary file
            const summaryPath = path.join(this.baseDir, this.sessionId, 'extraction-summary.json');
            await fs.writeFile(summaryPath, JSON.stringify({
                session_id: this.sessionId,
                extraction_date: new Date().toISOString(),
                total_workflows: workflows.length,
                workflows: workflows.map(w => ({
                    name: w.name,
                    wf_item: w.wf_item,
                    steps_count: w.steps.length
                }))
            }, null, 2));

            console.log('\n' + '='.repeat(60));
            console.log('✨ Extraction Complete!');
            console.log('='.repeat(60));
            console.log(`📊 Total workflows extracted: ${workflows.length}`);
            console.log(`📁 Data saved to: ${path.join(this.baseDir, this.sessionId)}`);
            console.log('='.repeat(60) + '\n');

        } catch (error) {
            console.error('Fatal error:', error);
        } finally {
            console.log('Browser will remain open for inspection. Press Ctrl+C to close.');
            // Keep browser open
            await new Promise(() => {});
        }
    }
}

// Helper to detect action type
SingleSessionWorkflowExtractor.prototype.detectActionType = function(actionText) {
    const actionMap = {
        'Schedule API Workflow': 'schedule_api_workflow',
        'Create a new thing': 'create_thing',
        'Create a new': 'create_thing',
        'Delete thing': 'delete_thing',
        'Delete a thing': 'delete_thing',
        'Make changes to': 'make_changes',
        'Send email': 'send_email',
        'Add to list': 'add_to_list',
        'Remove from list': 'remove_from_list',
        'Return data': 'return_data',
        'Only when': 'condition',
        'Trigger a custom event': 'trigger_custom_event',
        'API Connector': 'api_connector_call',
        'Terminate workflow': 'terminate',
        'Set state': 'set_state',
        'Clear list': 'clear_list'
    };

    for (const [key, value] of Object.entries(actionMap)) {
        if (actionText.includes(key)) {
            return value;
        }
    }

    return 'custom_action';
};

// Run the extractor
const extractor = new SingleSessionWorkflowExtractor();
extractor.run().catch(console.error);