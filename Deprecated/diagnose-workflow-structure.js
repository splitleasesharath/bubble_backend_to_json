const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

async function diagnoseWorkflowStructure() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');

    console.log('🔬 Starting Workflow Structure Diagnosis...\n');

    const context = await chromium.launchPersistentContext(profilePath, {
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

    const page = await context.newPage();

    // Load workflow list
    const workflowsPath = path.join(__dirname, 'workflow-ids-final.json');
    const workflowsList = JSON.parse(await fs.readFile(workflowsPath, 'utf-8'));

    console.log(`📚 Loaded ${workflowsList.length} workflows\n`);

    // Test with first 2 workflows
    for (let i = 0; i < Math.min(2, workflowsList.length); i++) {
        const workflow = workflowsList[i];

        console.log(`\n${'='.repeat(60)}`);
        console.log(`📦 Analyzing Workflow ${i + 1}: ${workflow.name}`);
        console.log(`🔗 URL: ${workflow.full_url}`);
        console.log(`${'='.repeat(60)}\n`);

        // Navigate to workflow
        console.log('🌐 Navigating to workflow...');
        await page.goto(workflow.full_url, { waitUntil: 'domcontentloaded' });

        // Wait for different stages and analyze what appears
        console.log('\n⏱️ Analyzing page load stages...\n');

        // Stage 1: Initial load
        await page.waitForTimeout(2000);
        console.log('📍 Stage 1 (2s): Initial DOM loaded');
        let analysis1 = await analyzePage(page, 'stage1');

        // Stage 2: Wait more
        await page.waitForTimeout(3000);
        console.log('📍 Stage 2 (5s): After additional wait');
        let analysis2 = await analyzePage(page, 'stage2');

        // Stage 3: Wait for network idle
        await page.waitForLoadState('networkidle');
        console.log('📍 Stage 3: Network idle');
        let analysis3 = await analyzePage(page, 'stage3');

        // Stage 4: Wait for specific elements
        console.log('\n🔍 Waiting for specific elements...');

        // Check for canvas
        const canvasExists = await page.$('canvas').then(el => !!el);
        console.log(`  Canvas element: ${canvasExists ? '✅ Found' : '❌ Not found'}`);

        // Check for workflow steps (various selectors)
        const stepSelectors = [
            'div[class*="workflow-step"]',
            'div[class*="action-box"]',
            'div[class*="step-box"]',
            'div[class*="workflow-action"]',
            '*[class*="1ql74v"]', // Classes we found earlier
            'div:has-text("Step ")',
            'text=/Step\\s+\\d+/'
        ];

        console.log('\n📊 Checking for step elements:');
        for (const selector of stepSelectors) {
            try {
                const count = await page.locator(selector).count();
                if (count > 0) {
                    console.log(`  ✅ "${selector}": ${count} elements found`);

                    // Get first element details
                    const first = await page.locator(selector).first();
                    const text = await first.textContent().catch(() => 'N/A');
                    const box = await first.boundingBox().catch(() => null);

                    console.log(`     First element text: "${text?.substring(0, 50)}..."`);
                    if (box) {
                        console.log(`     Position: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);
                    }
                }
            } catch (e) {
                // Selector didn't work
            }
        }

        // Check for properties panel
        console.log('\n📋 Checking for properties panel:');
        const panelSelectors = [
            'div[class*="property-editor"]',
            'div[class*="properties-panel"]',
            'div[class*="inspector"]',
            'div:has-text("Endpoint name")',
            'div:has-text("Parameter definition")'
        ];

        for (const selector of panelSelectors) {
            try {
                const exists = await page.locator(selector).first().isVisible().catch(() => false);
                if (exists) {
                    console.log(`  ✅ "${selector}": Visible`);
                }
            } catch (e) {
                // Continue
            }
        }

        // Try to understand the actual workflow structure
        console.log('\n🏗️ Analyzing workflow structure:');

        const structure = await page.evaluate(() => {
            const result = {
                title: document.title,
                url: window.location.href,
                hasCanvas: false,
                workflowSteps: [],
                visibleTexts: [],
                importantElements: []
            };

            // Check for canvas
            const canvas = document.querySelector('canvas');
            if (canvas) {
                result.hasCanvas = true;
                result.canvasSize = {
                    width: canvas.width,
                    height: canvas.height
                };
            }

            // Find all elements with "Step" in text
            const allElements = document.querySelectorAll('*');
            const stepElements = [];

            for (const el of allElements) {
                const text = el.textContent || '';
                if (text.match(/^Step\s+\d+/) && !text.includes('Backend Workflows')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        // Check if this is a unique element (not a parent of another step)
                        const hasStepChild = Array.from(el.children).some(child =>
                            child.textContent && child.textContent.match(/^Step\s+\d+/)
                        );

                        if (!hasStepChild) {
                            stepElements.push({
                                text: text.substring(0, 200),
                                tagName: el.tagName,
                                className: el.className,
                                id: el.id,
                                position: {
                                    x: Math.round(rect.x),
                                    y: Math.round(rect.y),
                                    width: Math.round(rect.width),
                                    height: Math.round(rect.height)
                                },
                                isVisible: rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
                            });
                        }
                    }
                }
            }

            result.workflowSteps = stepElements;

            // Get important visible texts
            const importantTexts = [
                'Add Ai Credits',
                'Make changes',
                'Create',
                'Delete',
                'Schedule',
                'Trigger'
            ];

            for (const searchText of importantTexts) {
                const elements = Array.from(document.querySelectorAll('*')).filter(el => {
                    const text = el.textContent || '';
                    return text.includes(searchText) && !el.querySelector('*:has-text("' + searchText + '")');
                });

                for (const el of elements.slice(0, 3)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        result.visibleTexts.push({
                            text: searchText,
                            fullText: el.textContent?.substring(0, 100),
                            className: el.className,
                            position: {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y)
                            }
                        });
                    }
                }
            }

            // Find the main workflow area
            const workflowArea = document.querySelector('[class*="workflow-canvas"], [class*="editor-canvas"], .mainwindow');
            if (workflowArea) {
                const rect = workflowArea.getBoundingClientRect();
                result.workflowAreaSize = {
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y)
                };
            }

            return result;
        });

        console.log('\n📈 Structure Analysis:');
        console.log(`  Canvas found: ${structure.hasCanvas}`);
        console.log(`  Workflow steps found: ${structure.workflowSteps.length}`);
        console.log(`  Important texts found: ${structure.visibleTexts.length}`);

        if (structure.workflowAreaSize) {
            console.log(`  Workflow area: ${structure.workflowAreaSize.width}x${structure.workflowAreaSize.height} at (${structure.workflowAreaSize.x}, ${structure.workflowAreaSize.y})`);
        }

        if (structure.workflowSteps.length > 0) {
            console.log('\n  Step Details:');
            structure.workflowSteps.forEach((step, idx) => {
                console.log(`    Step ${idx + 1}:`);
                console.log(`      Text: "${step.text.substring(0, 50)}..."`);
                console.log(`      Position: (${step.position.x}, ${step.position.y})`);
                console.log(`      Size: ${step.position.width}x${step.position.height}`);
                console.log(`      Visible: ${step.isVisible}`);
            });
        }

        // Save diagnostic data
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const diagnosticDir = path.join(__dirname, 'diagnostic-data', timestamp);
        await fs.mkdir(diagnosticDir, { recursive: true });

        const diagnosticFile = path.join(diagnosticDir, `workflow_${i + 1}_${workflow.wf_item}.json`);
        await fs.writeFile(diagnosticFile, JSON.stringify({
            workflow: workflow,
            structure: structure,
            timestamp: new Date().toISOString()
        }, null, 2));

        // Take screenshot
        const screenshotPath = path.join(diagnosticDir, `workflow_${i + 1}_${workflow.wf_item}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log(`\n💾 Diagnostic data saved to: ${diagnosticDir}`);

        // Small delay before next workflow
        await page.waitForTimeout(2000);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🔬 DIAGNOSIS COMPLETE');
    console.log('='.repeat(60));
    console.log('\nKey Findings:');
    console.log('- Check diagnostic-data folder for detailed analysis');
    console.log('- Screenshots saved for visual inspection');
    console.log('='.repeat(60) + '\n');

    // Keep browser open for inspection
    console.log('Browser will remain open for manual inspection.');
    console.log('Press Ctrl+C to close.\n');

    await new Promise(() => {});
}

async function analyzePage(page, stage) {
    return await page.evaluate((stageLabel) => {
        const elements = document.querySelectorAll('*');
        const analysis = {
            stage: stageLabel,
            totalElements: elements.length,
            hasCanvas: !!document.querySelector('canvas'),
            stepElements: 0,
            visibleDivs: 0
        };

        // Count elements with "Step" text
        for (const el of elements) {
            const text = el.textContent || '';
            if (text.match(/^Step\s+\d+/)) {
                analysis.stepElements++;
            }

            if (el.tagName === 'DIV') {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    analysis.visibleDivs++;
                }
            }
        }

        console.log(`  [${stageLabel}] Total elements: ${analysis.totalElements}, Steps: ${analysis.stepElements}, Visible divs: ${analysis.visibleDivs}`);

        return analysis;
    }, stage);
}

// Run diagnosis
diagnoseWorkflowStructure().catch(console.error);