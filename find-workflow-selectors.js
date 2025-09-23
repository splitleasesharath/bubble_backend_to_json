const { chromium } = require('playwright');
const path = require('path');

async function findWorkflowSelectors() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    await page.goto(bubbleUrl);
    await page.waitForTimeout(5000);

    // Expand folders
    const expandButtons = await page.$$('div[role="button"] svg');
    for (let i = 0; i < expandButtons.length && i < 5; i++) {
        try {
            await expandButtons[i].click();
            await page.waitForTimeout(200);
        } catch (err) {}
    }

    await page.waitForTimeout(2000);

    // Find workflow items
    const workflowInfo = await page.evaluate(() => {
        const results = [];

        // Look for workflow items specifically
        const workflowItems = document.querySelectorAll('[data-name="WorkflowItem"]');

        workflowItems.forEach(item => {
            const id = item.getAttribute('data-item-id');
            const textEl = item.querySelector('._13jwfz74, ._13jwfz75, ._13jwfz76');
            const text = textEl ? textEl.textContent : 'Unknown';

            results.push({
                selector: '[data-name="WorkflowItem"]',
                id: id,
                text: text,
                className: item.className
            });
        });

        return results;
    });

    console.log(`Found ${workflowInfo.length} workflow items:`);
    workflowInfo.slice(0, 10).forEach(w => {
        console.log(`  - ${w.text} (id: ${w.id})`);
    });

    // Keep browser open
    console.log('\nPress Ctrl+C to close.');
    await new Promise(() => {});
}

findWorkflowSelectors().catch(console.error);