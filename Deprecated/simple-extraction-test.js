const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

async function main() {
    console.log('Starting simple extraction test...');

    let browser;
    try {
        // Launch browser
        browser = await chromium.launchPersistentContext(
            'C:\\Users\\Split Lease\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1',
            {
                channel: 'chrome',
                headless: false,
                viewport: { width: 1920, height: 1080 },
                timeout: 60000
            }
        );

        console.log('Browser launched');

        // Get page
        const page = browser.pages()[0] || await browser.newPage();

        // Set longer default timeout
        page.setDefaultTimeout(30000);

        // Navigate to page
        console.log('Navigating to Bubble.io...');
        await page.goto('https://bubble.io/page?id=pluginmarketplace&tab=tabs-2', {
            waitUntil: 'domcontentloaded'
        });

        console.log('Page loaded, waiting for content...');
        await page.waitForTimeout(8000);

        // Extract all text content
        console.log('Extracting page content...');
        const pageContent = await page.evaluate(() => {
            const results = {
                title: document.title,
                url: window.location.href,
                elements: []
            };

            // Get all div elements
            const divs = document.querySelectorAll('div');
            const seenTexts = new Set();

            divs.forEach((div, index) => {
                const text = div.textContent?.trim();
                if (text && text.length > 5 && text.length < 200 && !seenTexts.has(text)) {
                    const rect = div.getBoundingClientRect();

                    // Only include visible elements
                    if (rect.width > 0 && rect.height > 0) {
                        seenTexts.add(text);
                        results.elements.push({
                            text: text,
                            position: {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height)
                            },
                            index: index
                        });
                    }
                }
            });

            return results;
        });

        console.log(`Extracted ${pageContent.elements.length} unique text elements`);

        // Filter for potential workflow steps
        const workflowSteps = pageContent.elements.filter(el => {
            const text = el.text;
            return (
                // In center area
                el.position.x > 250 &&
                el.position.x < 1450 &&
                // Contains action keywords
                (text.includes('Add') ||
                 text.includes('Deduct') ||
                 text.includes('Create') ||
                 text.includes('Update') ||
                 text.includes('Credits') ||
                 text.includes('User') ||
                 text.includes('Step') ||
                 text.includes('Action')) &&
                // Not navigation
                !text.includes('Backend Workflows') &&
                !text.includes('IN THIS APP') &&
                !text.includes('Uncategorized')
            );
        });

        console.log(`Found ${workflowSteps.length} potential workflow steps`);

        // Save screenshot
        const screenshotPath = path.join(__dirname, 'debug-screenshots', 'simple-test.png');
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved: ${screenshotPath}`);

        // Save extracted data
        const outputData = {
            timestamp: new Date().toISOString(),
            pageTitle: pageContent.title,
            url: pageContent.url,
            totalElements: pageContent.elements.length,
            workflowSteps: workflowSteps,
            allElements: pageContent.elements.slice(0, 50) // First 50 for debugging
        };

        const outputPath = path.join(__dirname, 'workflow-json-output', `simple-extraction-${Date.now()}.json`);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));

        console.log(`\n=== Results ===`);
        console.log(`Total elements: ${pageContent.elements.length}`);
        console.log(`Workflow steps: ${workflowSteps.length}`);
        console.log(`Output saved: ${outputPath}`);

        if (workflowSteps.length > 0) {
            console.log('\nFirst few workflow steps:');
            workflowSteps.slice(0, 5).forEach((step, i) => {
                console.log(`  ${i + 1}. "${step.text.substring(0, 60)}..."`);
            });
        }

        // Keep browser open briefly
        console.log('\nKeeping browser open for 5 seconds...');
        await page.waitForTimeout(5000);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

main().catch(console.error);