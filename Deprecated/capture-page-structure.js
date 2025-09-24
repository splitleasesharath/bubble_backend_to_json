const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

async function capturePageStructure() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    console.log('🔍 Starting Page Structure Analysis...\n');
    console.log('📍 Target URL:', bubbleUrl);
    console.log('');

    const context = await chromium.launchPersistentContext(profilePath, {
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

    console.log('🌐 Navigating to workflow page...');
    await page.goto(bubbleUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for page to fully load
    console.log('⏳ Waiting for page to fully load...');
    await page.waitForTimeout(8000);

    // Create output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = path.join(__dirname, 'page-analysis', timestamp);
    await fs.mkdir(outputDir, { recursive: true });

    console.log(`📁 Output directory: ${outputDir}\n`);

    // 1. Capture screenshot
    console.log('📸 Capturing screenshot...');
    const screenshotPath = path.join(outputDir, 'workflow-page.png');
    await page.screenshot({
        path: screenshotPath,
        fullPage: true
    });
    console.log('  ✅ Screenshot saved');

    // 2. Capture full HTML
    console.log('\n📄 Capturing HTML structure...');
    const fullHtml = await page.content();
    const htmlPath = path.join(outputDir, 'workflow-page.html');
    await fs.writeFile(htmlPath, fullHtml);
    console.log('  ✅ Full HTML saved');

    // 3. Extract and log page structure
    console.log('\n🏗️ Analyzing page structure...');

    const pageStructure = await page.evaluate(() => {
        const structure = {
            title: document.title,
            url: window.location.href,
            mainSections: [],
            workflowElements: [],
            stepElements: [],
            canvasElements: [],
            propertiesPanels: [],
            navigationElements: [],
            interactiveElements: []
        };

        // Find main sections
        const mainDivs = document.querySelectorAll('div[class*="main"], div[class*="content"], div[class*="editor"]');
        mainDivs.forEach(div => {
            structure.mainSections.push({
                className: div.className,
                id: div.id || 'no-id',
                childCount: div.children.length,
                text: div.textContent?.substring(0, 100)
            });
        });

        // Find workflow-related elements
        const workflowElements = document.querySelectorAll('[class*="workflow"], [id*="workflow"]');
        workflowElements.forEach(el => {
            structure.workflowElements.push({
                tagName: el.tagName,
                className: el.className,
                id: el.id,
                text: el.textContent?.substring(0, 50)
            });
        });

        // Find step elements
        const stepPatterns = [
            'div[class*="step"]',
            'div[class*="action"]',
            'div[data-step]',
            '*[id*="step"]'
        ];

        stepPatterns.forEach(pattern => {
            const elements = document.querySelectorAll(pattern);
            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                structure.stepElements.push({
                    selector: pattern,
                    tagName: el.tagName,
                    className: el.className,
                    id: el.id,
                    text: el.textContent?.substring(0, 50),
                    position: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                    }
                });
            });
        });

        // Find canvas elements
        const canvases = document.querySelectorAll('canvas, svg, [class*="canvas"]');
        canvases.forEach(canvas => {
            const rect = canvas.getBoundingClientRect();
            structure.canvasElements.push({
                tagName: canvas.tagName,
                className: canvas.className,
                id: canvas.id,
                position: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            });
        });

        // Find properties panels
        const panels = document.querySelectorAll('[class*="properties"], [class*="panel"], [class*="editor-panel"]');
        panels.forEach(panel => {
            structure.propertiesPanels.push({
                className: panel.className,
                id: panel.id,
                visible: panel.offsetParent !== null,
                text: panel.textContent?.substring(0, 100)
            });
        });

        // Find navigation elements
        const navElements = document.querySelectorAll('[class*="sidebar"], [class*="navigation"], [class*="menu"]');
        navElements.forEach(nav => {
            structure.navigationElements.push({
                className: nav.className,
                id: nav.id,
                text: nav.textContent?.substring(0, 100)
            });
        });

        // Find interactive elements
        const buttons = document.querySelectorAll('button, [role="button"], [class*="clickable"]');
        structure.interactiveElements.buttonCount = buttons.length;

        const inputs = document.querySelectorAll('input, textarea, select');
        structure.interactiveElements.inputCount = inputs.length;

        return structure;
    });

    // Save structure analysis
    const structurePath = path.join(outputDir, 'page-structure.json');
    await fs.writeFile(structurePath, JSON.stringify(pageStructure, null, 2));
    console.log('  ✅ Page structure analysis saved');

    // 4. Extract specific workflow elements
    console.log('\n🔍 Extracting specific workflow elements...');

    const workflowDetails = await page.evaluate(() => {
        const details = {
            workflowName: null,
            visibleSteps: [],
            sidebar: null,
            mainCanvas: null,
            propertiesPanel: null
        };

        // Get workflow name
        const nameElements = document.querySelectorAll('*');
        for (const el of nameElements) {
            if (el.textContent?.includes('core-ai-credits')) {
                details.workflowName = el.textContent.trim();
                break;
            }
        }

        // Find visible step elements
        const allDivs = document.querySelectorAll('div');
        allDivs.forEach(div => {
            const text = div.textContent || '';
            if (text.match(/^Step\s+\d+/i)) {
                const rect = div.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    details.visibleSteps.push({
                        text: text.substring(0, 200),
                        position: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height
                        },
                        className: div.className,
                        parent: div.parentElement?.className
                    });
                }
            }
        });

        // Find sidebar
        const sidebar = document.querySelector('[class*="sidebar"], [class*="tree"]');
        if (sidebar) {
            details.sidebar = {
                className: sidebar.className,
                width: sidebar.getBoundingClientRect().width,
                itemCount: sidebar.querySelectorAll('div[role="button"], span').length
            };
        }

        // Find main canvas area
        const canvas = document.querySelector('canvas, [class*="canvas"], [class*="editor-main"]');
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            details.mainCanvas = {
                tagName: canvas.tagName,
                className: canvas.className,
                position: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                }
            };
        }

        return details;
    });

    const detailsPath = path.join(outputDir, 'workflow-details.json');
    await fs.writeFile(detailsPath, JSON.stringify(workflowDetails, null, 2));
    console.log('  ✅ Workflow details extracted');

    // 5. Try to find and click on a step to reveal properties
    console.log('\n🖱️ Attempting to click on workflow elements...');

    // Click on the main canvas area to ensure focus
    const canvasArea = await page.$('canvas, div[class*="canvas"]');
    if (canvasArea) {
        const box = await canvasArea.boundingBox();
        if (box) {
            // Click in the middle of the canvas
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(2000);

            console.log('  ✅ Clicked on canvas area');

            // Capture after click
            const afterClickPath = path.join(outputDir, 'after-canvas-click.png');
            await page.screenshot({ path: afterClickPath, fullPage: true });

            // Check what appeared after click
            const afterClickStructure = await page.evaluate(() => {
                const panels = document.querySelectorAll('[class*="properties"], [class*="panel"], [class*="editor"]');
                const visiblePanels = [];

                panels.forEach(panel => {
                    if (panel.offsetParent !== null) {
                        visiblePanels.push({
                            className: panel.className,
                            id: panel.id,
                            text: panel.textContent?.substring(0, 200)
                        });
                    }
                });

                return visiblePanels;
            });

            const afterClickPath2 = path.join(outputDir, 'after-click-panels.json');
            await fs.writeFile(afterClickPath2, JSON.stringify(afterClickStructure, null, 2));
        }
    }

    // 6. Look for steps in a different way
    console.log('\n🔎 Searching for steps using text content...');

    const stepSearch = await page.evaluate(() => {
        const results = {
            stepsFound: [],
            actionsFound: []
        };

        // Search for "Step" text
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let node;
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text.match(/^Step\s+\d+/i)) {
                const parent = node.parentElement;
                if (parent) {
                    const rect = parent.getBoundingClientRect();
                    results.stepsFound.push({
                        text: text.substring(0, 100),
                        parentTag: parent.tagName,
                        parentClass: parent.className,
                        position: {
                            x: rect.x,
                            y: rect.y,
                            width: rect.width,
                            height: rect.height
                        }
                    });
                }
            }

            // Also look for action keywords
            if (text.match(/Make changes|Create|Delete|Schedule|Add|Remove/i)) {
                const parent = node.parentElement;
                if (parent && !parent.className.includes('sidebar')) {
                    results.actionsFound.push({
                        text: text.substring(0, 50),
                        parentClass: parent.className
                    });
                }
            }
        }

        return results;
    });

    const stepSearchPath = path.join(outputDir, 'step-search-results.json');
    await fs.writeFile(stepSearchPath, JSON.stringify(stepSearch, null, 2));
    console.log('  ✅ Step search completed');

    // 7. Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 ANALYSIS SUMMARY');
    console.log('='.repeat(60));
    console.log(`📁 All files saved to: ${outputDir}`);
    console.log('\nFiles created:');
    console.log('  - workflow-page.png (screenshot)');
    console.log('  - workflow-page.html (full HTML)');
    console.log('  - page-structure.json (DOM analysis)');
    console.log('  - workflow-details.json (workflow elements)');
    console.log('  - after-canvas-click.png (post-interaction)');
    console.log('  - after-click-panels.json (revealed panels)');
    console.log('  - step-search-results.json (text search)');
    console.log('');
    console.log(`Found ${workflowDetails.visibleSteps.length} potential step elements`);
    console.log(`Found ${stepSearch.stepsFound.length} steps via text search`);
    console.log(`Found ${stepSearch.actionsFound.length} action keywords`);
    console.log('='.repeat(60) + '\n');

    // Keep browser open for manual inspection
    console.log('🔍 Browser will remain open for manual inspection.');
    console.log('Press Ctrl+C to close when done.\n');

    // Wait indefinitely (user will close manually)
    await new Promise(() => {});
}

// Run the capture
capturePageStructure().catch(console.error);