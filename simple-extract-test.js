const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

async function testExtraction() {
    console.log('Starting simple extraction test...');

    // Launch browser with persistent context
    const browser = await chromium.launchPersistentContext(
        'C:\\Users\\Split Lease\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1',
        {
            channel: 'chrome',
            headless: false,
            viewport: { width: 1920, height: 1080 }
        }
    );

    try {
        const page = browser.pages()[0] || await browser.newPage();

        // Navigate to Bubble.io editor
        console.log('Navigating to Bubble.io...');
        await page.goto('https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&version=test');
        await page.waitForTimeout(5000);

        // Navigate to a specific workflow
        console.log('Navigating to workflow...');
        await page.goto('https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test');
        await page.waitForTimeout(5000);

        // Extract visible text
        const pageText = await page.evaluate(() => {
            return document.body.innerText;
        });

        // Save the text
        await fs.writeFile('page-text.txt', pageText);
        console.log('Page text saved to page-text.txt');

        // Take screenshot
        await page.screenshot({ path: 'workflow-screenshot.png' });
        console.log('Screenshot saved');

        // Keep browser open for inspection
        console.log('Browser will stay open for 10 seconds...');
        await page.waitForTimeout(10000);

    } finally {
        await browser.close();
        console.log('Browser closed');
    }
}

testExtraction().catch(console.error);