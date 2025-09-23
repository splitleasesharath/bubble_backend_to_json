const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class WorkflowJSONExtractor {
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

    async extractWorkflowSteps(page) {
        // Wait for the canvas to be visible
        await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {});

        // Additional wait for dynamic content
        await page.waitForTimeout(3000);

        const steps = await page.evaluate(() => {
            const stepData = [];

            // Find all step elements - they appear as numbered boxes in the center canvas
            // Looking for elements that contain "Step X" text pattern
            const allElements = document.querySelectorAll('*');
            const processedSteps = new Set();

            for (const element of allElements) {
                const text = element.textContent || '';

                // Match "Step X" pattern but exclude navigation items
                const stepMatch = text.match(/^Step\s+(\d+)/);
                if (!stepMatch) continue;

                // Get bounding box to filter by position
                const rect = element.getBoundingClientRect();

                // Filter: Must be in the center canvas area (roughly x: 300-1400px)
                // and visible
                if (rect.x < 250 || rect.x > 1500) continue;
                if (rect.width === 0 || rect.height === 0) continue;

                // Get the step number
                const stepNumber = parseInt(stepMatch[1]);

                // Avoid duplicates
                if (processedSteps.has(stepNumber)) continue;
                processedSteps.add(stepNumber);

                // Extract the action text - it's usually after "Step X"
                let actionText = text.replace(/^Step\s+\d+[:\s]*/i, '');

                // Clean up the action text - remove any sidebar navigation that got mixed in
                // The actual action is usually the first meaningful text after Step number
                const lines = actionText.split('\n').map(l => l.trim()).filter(l => l);

                // Find the actual action line (skip navigation items)
                let actualAction = '';
                for (const line of lines) {
                    // Skip common navigation patterns
                    if (line.match(/^(Backend Workflows|IN THIS APP|\d+|Uncategorized|WORKFLOW)/)) continue;
                    if (line.match(/^(Bots|ChatGPT|Bulk Fix|MAIN|System|Zapier)/)) continue;
                    if (line.length < 3) continue;

                    // This is likely the actual action
                    actualAction = line;
                    break;
                }

                // If we couldn't find a clean action, try a different approach
                if (!actualAction) {
                    // Look for action keywords
                    const actionKeywords = [
                        'Schedule', 'Create', 'Delete', 'Update', 'Add', 'Send',
                        'Make', 'Trigger', 'Call', 'Return', 'Only when', 'Set'
                    ];

                    for (const line of lines) {
                        for (const keyword of actionKeywords) {
                            if (line.startsWith(keyword)) {
                                actualAction = line;
                                break;
                            }
                        }
                        if (actualAction) break;
                    }
                }

                // Default to first non-navigation line if still nothing
                if (!actualAction && lines.length > 0) {
                    actualAction = lines[0].substring(0, 100);
                }

                stepData.push({
                    stepNumber,
                    action: actualAction || 'Unknown Action',
                    fullText: text.substring(0, 200),
                    position: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                });
            }

            // Sort by step number
            stepData.sort((a, b) => a.stepNumber - b.stepNumber);

            return stepData;
        });

        return steps;
    }

    async extractWorkflowMetadata(page) {
        // Extract from the properties panel on the right
        const metadata = await page.evaluate(() => {
            const data = {
                endpoint: null,
                trigger: { type: null, method: null },
                response_type: null,
                timezone: 'US/Eastern',
                exposed_as_api: false,
                requires_authentication: true,
                description: null
            };

            // Look for endpoint name in properties panel
            const endpointElement = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('Endpoint name') &&
                el.nextElementSibling
            );

            if (endpointElement && endpointElement.nextElementSibling) {
                data.endpoint = endpointElement.nextElementSibling.textContent.trim();
            }

            // Look for trigger type
            const triggerElements = Array.from(document.querySelectorAll('*')).filter(el =>
                el.textContent && (
                    el.textContent.includes('API Workflow') ||
                    el.textContent.includes('Schedule API Workflow') ||
                    el.textContent.includes('Custom event') ||
                    el.textContent.includes('Do when condition is true')
                )
            );

            if (triggerElements.length > 0) {
                const triggerText = triggerElements[0].textContent;
                if (triggerText.includes('API Workflow')) {
                    data.trigger.type = 'api_workflow';
                    data.exposed_as_api = true;
                } else if (triggerText.includes('Schedule')) {
                    data.trigger.type = 'scheduled';
                } else if (triggerText.includes('Custom event')) {
                    data.trigger.type = 'custom_event';
                }
            }

            // Look for response type
            const responseElement = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('Return a 200 if condition')
            );

            if (responseElement) {
                data.response_type = 'JSON';
            }

            return data;
        });

        return metadata;
    }

    async extractWorkflowInterface(page) {
        // Extract parameters from the properties panel
        const interfaceData = await page.evaluate(() => {
            const inputs = [];
            const outputs = [];

            // Look for parameter definitions in the properties panel
            const paramSection = Array.from(document.querySelectorAll('*')).find(el =>
                el.textContent && el.textContent.includes('Parameter definition')
            );

            if (paramSection) {
                // Find parameter rows
                const paramContainer = paramSection.closest('[class*="property-editor"]') ||
                                      paramSection.parentElement;

                if (paramContainer) {
                    // Look for parameter entries
                    const paramEntries = paramContainer.querySelectorAll('[class*="parameter-row"], [class*="param-item"]');

                    paramEntries.forEach(entry => {
                        const text = entry.textContent || '';

                        // Try to extract parameter name and type
                        const nameMatch = text.match(/Key:\s*([^\s]+)/);
                        const typeMatch = text.match(/Type:\s*([^\s]+)/);

                        if (nameMatch) {
                            inputs.push({
                                key: nameMatch[1],
                                name: nameMatch[1],
                                type: typeMatch ? typeMatch[1] : 'text',
                                optional: text.includes('Optional'),
                                is_list: text.includes('list'),
                                in_body: true
                            });
                        }
                    });
                }
            }

            // If no params found, check for common patterns
            if (inputs.length === 0) {
                // Look for "user" parameter which is common
                const userParam = Array.from(document.querySelectorAll('*')).find(el =>
                    el.textContent && el.textContent.match(/Parameter.*user/i)
                );

                if (userParam) {
                    inputs.push({
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

            return { inputs, outputs };
        });

        return interfaceData;
    }

    async processWorkflow(workflow) {
        try {
            console.log(`\nProcessing: ${workflow.name}`);

            // Navigate to workflow
            await this.page.goto(workflow.full_url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait for page to stabilize
            await this.page.waitForTimeout(3000);

            // Extract data
            const steps = await this.extractWorkflowSteps(this.page);
            const metadata = await this.extractWorkflowMetadata(this.page);
            const interfaceData = await this.extractWorkflowInterface(this.page);

            // Build the workflow JSON structure
            const workflowData = {
                workflow_id: workflow.workflow_id,
                wf_item: workflow.wf_item,
                name: workflow.name,
                url: workflow.full_url,
                captured_at: new Date().toISOString(),
                version: 1,
                metadata,
                interface: interfaceData,
                steps: steps.map((step, index) => ({
                    order: step.stepNumber,
                    title: step.action,
                    action: this.detectActionType(step.action),
                    parameters: [],
                    outputs: [],
                    wf_item: `step_${step.stepNumber}_${Date.now()}`,
                    step_hash: this.generateHash({
                        order: step.stepNumber,
                        action: step.action
                    })
                })),
                dependencies: this.extractDependencies(steps),
                hash: ''
            };

            // Generate overall hash
            workflowData.hash = this.generateHash(workflowData);

            // Save to file
            const filename = `${workflow.workflow_id}_${workflow.wf_item}.json`;
            const filepath = path.join(this.baseDir, this.sessionId, filename);
            await fs.writeFile(filepath, JSON.stringify(workflowData, null, 2));

            console.log(`✅ Saved: ${filename}`);
            console.log(`   - ${steps.length} steps extracted`);

            return { success: true, data: workflowData };

        } catch (error) {
            console.error(`❌ Error processing ${workflow.name}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    detectActionType(actionText) {
        const actionMap = {
            'Schedule': 'schedule_api_workflow',
            'Create': 'create_thing',
            'Delete': 'delete_thing',
            'Update': 'make_changes',
            'Make changes': 'make_changes',
            'Send': 'send_email',
            'Add': 'add_to_list',
            'Return': 'return_data',
            'Only when': 'condition',
            'Trigger': 'trigger_custom_event',
            'Call': 'api_connector_call'
        };

        for (const [key, value] of Object.entries(actionMap)) {
            if (actionText.includes(key)) {
                return value;
            }
        }

        return 'custom_action';
    }

    extractDependencies(steps) {
        const deps = [];

        steps.forEach(step => {
            // Look for workflow calls
            if (step.action.includes('Schedule') && step.action.includes('API Workflow')) {
                // Try to extract the workflow name
                const match = step.action.match(/Schedule API Workflow\s+([^\s]+)/);
                if (match) {
                    deps.push({
                        type: 'workflow_call',
                        target: match[1],
                        step: step.stepNumber
                    });
                }
            }
        });

        return deps;
    }

    async run() {
        try {
            await this.init();

            // Load workflow list
            const workflowsPath = path.join(__dirname, 'workflow-ids-final.json');
            const workflows = JSON.parse(await fs.readFile(workflowsPath, 'utf-8'));

            console.log(`\n📊 Starting extraction of ${workflows.length} workflows\n`);

            // Process first 5 workflows as a test
            const testWorkflows = workflows.slice(0, 5);
            const results = [];

            for (const workflow of testWorkflows) {
                const result = await this.processWorkflow(workflow);
                results.push(result);

                // Small delay between workflows
                await this.page.waitForTimeout(2000);
            }

            // Summary
            const successful = results.filter(r => r.success).length;
            console.log(`\n✨ Extraction complete!`);
            console.log(`   - Success: ${successful}/${results.length}`);
            console.log(`   - Data saved to: ${path.join(this.baseDir, this.sessionId)}`);

        } catch (error) {
            console.error('Fatal error:', error);
        } finally {
            if (this.context) {
                await this.context.close();
            }
        }
    }
}

// Run the extractor
const extractor = new WorkflowJSONExtractor();
extractor.run().catch(console.error);