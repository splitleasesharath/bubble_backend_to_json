/**
 * Browser Configuration for Bubble.io Workflow Extraction
 * Uses persistent Chrome profile to maintain logged-in session
 */

const BROWSER_CONFIG = {
    // Use Playwright-managed profile with saved Bubble.io session
    profilePath: require('path').join(__dirname, '..', 'browser-profiles', 'default'),

    // Browser launch options
    launchOptions: {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1920, height: 1080 },
        timeout: 60000
    },

    // Default page settings
    pageDefaults: {
        defaultTimeout: 30000,
        waitForLoadTimeout: 10000
    },

    // Bubble.io specific URLs (using same URLs as working test)
    urls: {
        baseUrl: 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&version=test',
        workflowUrl: (wfItem) => `https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=${wfItem}&version=test`
    }
};

// Helper function to launch browser with persistent session
async function launchBrowserWithSession(playwright) {
    const { chromium } = playwright || require('playwright');

    console.log('🌐 Launching browser with persistent session...');
    console.log(`📁 Profile: ${BROWSER_CONFIG.profilePath}`);

    const browser = await chromium.launchPersistentContext(
        BROWSER_CONFIG.profilePath,
        BROWSER_CONFIG.launchOptions
    );

    const page = browser.pages()[0] || await browser.newPage();
    page.setDefaultTimeout(BROWSER_CONFIG.pageDefaults.defaultTimeout);

    return { browser, page };
}

module.exports = {
    BROWSER_CONFIG,
    launchBrowserWithSession
};