const { launchBrowserWithSession, BROWSER_CONFIG } = require('./config/browser-config');

async function debugElements() {
    const { browser, page } = await launchBrowserWithSession();

    try {
        // Navigate to base URL
        console.log('Navigating to Bubble.io editor...');
        await page.goto(BROWSER_CONFIG.urls.baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(5000);

        // Expand folders
        console.log('Expanding folders...');
        const expandButtons = await page.$$('div[role="button"] svg');
        for (let i = 0; i < expandButtons.length && i < 10; i++) {
            try {
                await expandButtons[i].click();
                await page.waitForTimeout(200);
            } catch (err) {}
        }

        await page.waitForTimeout(2000);

        // Find and log elements
        console.log('\nAnalyzing elements...\n');
        const elements = await page.$$('div[role="treeitem"] span');

        console.log(`Total elements found: ${elements.length}\n`);

        // Sample first 20 elements
        for (let i = 0; i < Math.min(20, elements.length); i++) {
            const element = elements[i];
            const text = await element.textContent();
            const box = await element.boundingBox();

            console.log(`Element ${i + 1}:`);
            console.log(`  Text: "${text}"`);
            console.log(`  Position: x=${box?.x}, y=${box?.y}`);
            console.log(`  Size: ${box?.width}x${box?.height}`);

            // Check our filter conditions
            if (!text) {
                console.log(`  FILTERED: No text`);
            } else if (text.match(/^\d+$/)) {
                console.log(`  FILTERED: Just numbers`);
            } else if (text.includes('×')) {
                console.log(`  FILTERED: Contains ×`);
            } else if (box && box.x > 500) {
                console.log(`  FILTERED: Too far right (x > 500)`);
            } else if (text.toLowerCase().includes('uncategorized')) {
                console.log(`  FILTERED: Contains 'uncategorized'`);
            } else if (text.toLowerCase().includes('category')) {
                console.log(`  FILTERED: Contains 'category'`);
            } else if (text.length < 3) {
                console.log(`  FILTERED: Too short`);
            } else {
                console.log(`  ✅ WOULD PROCESS THIS`);
            }
            console.log('');
        }

    } finally {
        await browser.close();
    }
}

debugElements().catch(console.error);