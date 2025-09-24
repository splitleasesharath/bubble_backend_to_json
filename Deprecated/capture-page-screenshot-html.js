const { launchBrowserWithSession } = require('./config/browser-config');
const fs = require('fs').promises;
const path = require('path');

async function capturePageContent() {
    const { browser, page } = await launchBrowserWithSession();

    try {
        // Navigate to a workflow
        const url = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Wait for content
        await page.waitForTimeout(8000);

        // Take screenshot
        const screenshotPath = path.join(__dirname, 'workflow-screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot saved: ${screenshotPath}`);

        // Get full page HTML
        const html = await page.content();
        const htmlPath = path.join(__dirname, 'workflow-page.html');
        await fs.writeFile(htmlPath, html);
        console.log(`HTML saved: ${htmlPath}`);

        // Keep browser open for manual inspection
        console.log('\nKeeping browser open for 30 seconds...');
        await page.waitForTimeout(30000);

    } finally {
        await browser.close();
    }
}

capturePageContent().catch(console.error);