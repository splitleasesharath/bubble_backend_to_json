const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

async function captureWorkflowHTML() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    console.log('Opening Chrome to capture workflow HTML...');

    const context = await chromium.launchPersistentContext(profilePath, {
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
    await page.goto(bubbleUrl);

    // Wait for page to load
    console.log('Waiting for workflow to load...');
    await page.waitForTimeout(5000);

    // Capture the full HTML
    const fullHTML = await page.content();

    // Save full HTML for analysis
    await fs.writeFile('workflow-page-full.html', fullHTML);
    console.log('Full HTML saved to workflow-page-full.html');

    // Try to find workflow-specific elements
    console.log('\n=== Analyzing Workflow Structure ===\n');

    // Look for elements with specific patterns
    const patterns = [
        // Look for workflow action containers
        { selector: 'div[class*="action"]', name: 'Action elements' },
        { selector: 'div[class*="step"]', name: 'Step elements' },
        { selector: 'div[class*="workflow"]', name: 'Workflow elements' },
        { selector: 'div[class*="wf"]', name: 'WF elements' },

        // Look for numbered elements
        { selector: 'div:has(span:matches("^\\d+$"))', name: 'Numbered elements' },
        { selector: '*[class*="number"]', name: 'Number class elements' },

        // Look for clickable/interactive elements
        { selector: 'div[role="button"]', name: 'Button role elements' },
        { selector: 'div[tabindex]', name: 'Tabindex elements' },
        { selector: '[class*="clickable"]', name: 'Clickable class elements' },
        { selector: '[class*="selectable"]', name: 'Selectable class elements' },

        // Look for canvas/main area elements
        { selector: 'div[class*="canvas"]', name: 'Canvas elements' },
        { selector: 'div[class*="main"]', name: 'Main area elements' },
        { selector: 'div[class*="content"]', name: 'Content elements' },

        // Data attributes
        { selector: '[data-action]', name: 'Data-action elements' },
        { selector: '[data-step]', name: 'Data-step elements' },
        { selector: '[data-id]', name: 'Data-id elements' }
    ];

    for (const pattern of patterns) {
        try {
            const elements = await page.$$(pattern.selector);
            if (elements.length > 0) {
                console.log(`${pattern.name}: ${elements.length} found`);

                // Get more details about the first few elements
                for (let i = 0; i < Math.min(3, elements.length); i++) {
                    try {
                        const box = await elements[i].boundingBox();
                        const classes = await elements[i].getAttribute('class');
                        const text = await elements[i].textContent();

                        console.log(`  Element ${i + 1}:`);
                        if (classes) console.log(`    Classes: ${classes.substring(0, 100)}`);
                        if (text) console.log(`    Text: ${text.substring(0, 50).trim()}`);
                        if (box) console.log(`    Position: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`);
                    } catch (err) {
                        // Continue
                    }
                }
            }
        } catch (err) {
            // Continue with next pattern
        }
    }

    // Look for workflow steps in the main content area
    console.log('\n=== Searching for Workflow Steps in Main Area ===\n');

    // Find all elements in the main content area (right side)
    const allElements = await page.$$('div, span, button');
    const mainAreaElements = [];

    for (const elem of allElements) {
        try {
            const box = await elem.boundingBox();
            if (box && box.x > 400 && box.width > 50 && box.height > 20) {
                const classes = await elem.getAttribute('class');
                const text = await elem.textContent();

                // Look for elements that might be workflow steps
                if (text && (
                    text.match(/^Step \d+/i) ||
                    text.match(/^Action/i) ||
                    text.match(/^\d+\./) ||
                    text.match(/^#\d+/) ||
                    (classes && (
                        classes.includes('action') ||
                        classes.includes('step') ||
                        classes.includes('workflow')
                    ))
                )) {
                    mainAreaElements.push({
                        tagName: await elem.evaluate(el => el.tagName),
                        classes: classes,
                        text: text.substring(0, 100),
                        position: box
                    });
                }
            }
        } catch (err) {
            // Continue
        }
    }

    console.log(`Found ${mainAreaElements.length} potential workflow step elements in main area`);

    // Display first 10 elements
    for (let i = 0; i < Math.min(10, mainAreaElements.length); i++) {
        const elem = mainAreaElements[i];
        console.log(`\nElement ${i + 1}:`);
        console.log(`  Tag: ${elem.tagName}`);
        console.log(`  Classes: ${elem.classes || 'none'}`);
        console.log(`  Text: ${elem.text.trim()}`);
        console.log(`  Position: x=${elem.position.x}, y=${elem.position.y}`);
    }

    // Save structured analysis
    const analysis = {
        url: bubbleUrl,
        timestamp: new Date().toISOString(),
        patterns: {},
        mainAreaElements: mainAreaElements.slice(0, 20)
    };

    for (const pattern of patterns) {
        try {
            const elements = await page.$$(pattern.selector);
            analysis.patterns[pattern.name] = elements.length;
        } catch (err) {
            analysis.patterns[pattern.name] = 0;
        }
    }

    await fs.writeFile('workflow-analysis.json', JSON.stringify(analysis, null, 2));
    console.log('\n=== Analysis saved to workflow-analysis.json ===');

    // Take a screenshot for visual reference
    await page.screenshot({ path: 'workflow-structure.png', fullPage: false });
    console.log('Screenshot saved to workflow-structure.png');

    // Close browser
    await context.close();
    console.log('\nAnalysis complete!');
}

captureWorkflowHTML().catch(console.error);