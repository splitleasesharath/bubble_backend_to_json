const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');
const fs = require('fs').promises;
const path = require('path');

async function debugPageContent() {
    console.log('Starting page content debug...\n');

    let browser, page;
    try {
        // Launch browser with session
        ({ browser, page } = await launchBrowserWithSession());
        console.log('Browser launched with persistent session\n');

        // Navigate to workflow
        const testWorkflow = 'core-ai-credits-add-ai-credits-to-user';
        const wfItem = 'cqVKW3'; // From your workflow list
        const url = `https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=${wfItem}&version=test`;

        console.log(`Navigating to: ${url}\n`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for content to load
        console.log('Waiting for content to load...');
        await page.waitForTimeout(8000);

        // Take screenshot
        const screenshotPath = path.join(__dirname, 'debug-screenshots', 'current-page.png');
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`Screenshot saved: ${screenshotPath}\n`);

        // Get all visible text elements in center area
        console.log('Extracting visible elements in workflow area...\n');
        const elements = await page.evaluate(() => {
            const results = [];
            const allDivs = document.querySelectorAll('div');

            allDivs.forEach(div => {
                const rect = div.getBoundingClientRect();

                // Only center area (workflow canvas)
                if (rect.x > 300 && rect.x < 1400 && rect.width > 0 && rect.height > 0) {
                    const text = div.textContent?.trim();

                    if (text && text.length > 2 && text.length < 200) {
                        // Check if this looks like a workflow step
                        const looksLikeStep =
                            text.includes('Add') ||
                            text.includes('Deduct') ||
                            text.includes('Create') ||
                            text.includes('Update') ||
                            text.includes('Delete') ||
                            text.includes('Send') ||
                            text.includes('Credits') ||
                            text.includes('User') ||
                            text.includes('Step') ||
                            text.includes('Action');

                        results.push({
                            text: text,
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                            className: div.className,
                            id: div.id,
                            looksLikeStep
                        });
                    }
                }
            });

            return results;
        });

        console.log(`Found ${elements.length} text elements in center area\n`);

        // Show potential workflow steps
        const potentialSteps = elements.filter(e => e.looksLikeStep);
        console.log(`Found ${potentialSteps.length} potential workflow steps:\n`);

        potentialSteps.forEach((step, i) => {
            console.log(`Step ${i + 1}:`);
            console.log(`  Text: "${step.text.substring(0, 80)}..."`);
            console.log(`  Position: (${step.x}, ${step.y})`);
            console.log(`  Class: ${step.className || 'none'}`);
            console.log(`  ID: ${step.id || 'none'}\n`);
        });

        // Save all elements for analysis
        const outputPath = path.join(__dirname, 'debug-output', `page-elements-${Date.now()}.json`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify({
            url,
            timestamp: new Date().toISOString(),
            totalElements: elements.length,
            potentialSteps: potentialSteps.length,
            elements: elements
        }, null, 2));

        console.log(`Full element data saved to: ${outputPath}`);

        // Keep browser open for manual inspection
        console.log('\nBrowser will remain open for 10 seconds for inspection...');
        await page.waitForTimeout(10000);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('\nBrowser closed');
        }
    }
}

debugPageContent().catch(console.error);