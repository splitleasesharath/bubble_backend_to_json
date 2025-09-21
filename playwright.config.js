const path = require('path');

const PROFILE_PATH = path.join(__dirname, 'browser-profiles', 'default');

const config = {
    profilePath: PROFILE_PATH,
    browserConfig: {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1440, height: 3600 }, // Extended portrait mode for long lists
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1440,3600' // Ensure window size matches viewport
        ],
        ignoreDefaultArgs: ['--enable-automation']
    }
};

module.exports = config;