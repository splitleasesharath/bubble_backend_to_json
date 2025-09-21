const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

class StateManager {
    constructor(profileName = 'default') {
        this.profileName = profileName;
        this.profilePath = path.join(__dirname, '..', 'browser-profiles', profileName);
        this.configPath = path.join(this.profilePath, 'config.json');
        this.config = {
            headless: false,
            channel: 'chrome',
            viewport: { width: 1280, height: 720 },
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        };
    }

    async ensureProfileExists() {
        try {
            await fs.access(this.profilePath);
        } catch {
            await fs.mkdir(this.profilePath, { recursive: true });
            console.log(`Created new profile directory: ${this.profilePath}`);
        }

        try {
            await fs.access(this.configPath);
            const savedConfig = JSON.parse(await fs.readFile(this.configPath, 'utf-8'));
            this.config = { ...this.config, ...savedConfig };
        } catch {
            await this.saveConfig();
        }
    }

    async saveConfig(additionalConfig = {}) {
        this.config = { ...this.config, ...additionalConfig };
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    }

    async launchForManualLogin(url = null) {
        await this.ensureProfileExists();

        console.log('Launching Chrome for manual login...');
        console.log(`Profile: ${this.profileName}`);
        console.log(`Data directory: ${this.profilePath}`);

        const context = await chromium.launchPersistentContext(this.profilePath, {
            ...this.config,
            headless: false
        });

        const page = await context.newPage();

        if (url) {
            console.log(`Navigating to: ${url}`);
            await page.goto(url);
        }

        console.log('\n========================================');
        console.log('MANUAL LOGIN INSTRUCTIONS:');
        console.log('1. Complete your login in the opened browser');
        console.log('2. Navigate through any 2FA/captcha if needed');
        console.log('3. Once logged in, press Enter in this terminal');
        console.log('4. The browser state will be saved automatically');
        console.log('========================================\n');

        await new Promise(resolve => {
            process.stdin.once('data', resolve);
        });

        console.log('Saving browser state...');

        const cookies = await context.cookies();
        const localStorage = await page.evaluate(() => {
            const items = {};
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                items[key] = window.localStorage.getItem(key);
            }
            return items;
        });

        const sessionStorage = await page.evaluate(() => {
            const items = {};
            for (let i = 0; i < window.sessionStorage.length; i++) {
                const key = window.sessionStorage.key(i);
                items[key] = window.sessionStorage.getItem(key);
            }
            return items;
        });

        const state = {
            cookies,
            localStorage,
            sessionStorage,
            url: page.url(),
            savedAt: new Date().toISOString()
        };

        await fs.writeFile(
            path.join(this.profilePath, 'state.json'),
            JSON.stringify(state, null, 2)
        );

        console.log('State saved successfully!');
        console.log(`Cookies: ${cookies.length}`);
        console.log(`LocalStorage items: ${Object.keys(localStorage).length}`);
        console.log(`SessionStorage items: ${Object.keys(sessionStorage).length}`);

        await context.close();
        return state;
    }

    async launchWithSavedState(options = {}) {
        await this.ensureProfileExists();

        const statePath = path.join(this.profilePath, 'state.json');
        let savedState = null;

        try {
            savedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
            console.log(`Loading saved state from: ${savedState.savedAt}`);
        } catch (error) {
            console.log('No saved state found. Use launchForManualLogin() first.');
        }

        const context = await chromium.launchPersistentContext(this.profilePath, {
            ...this.config,
            ...options
        });

        return { context, savedState };
    }

    async createPage(context, restoreState = true) {
        const page = await context.newPage();

        if (restoreState) {
            const statePath = path.join(this.profilePath, 'state.json');
            try {
                const savedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));

                if (savedState.localStorage && Object.keys(savedState.localStorage).length > 0) {
                    await page.goto(savedState.url || 'about:blank');
                    await page.evaluate((items) => {
                        Object.entries(items).forEach(([key, value]) => {
                            window.localStorage.setItem(key, value);
                        });
                    }, savedState.localStorage);
                }

                if (savedState.sessionStorage && Object.keys(savedState.sessionStorage).length > 0) {
                    await page.evaluate((items) => {
                        Object.entries(items).forEach(([key, value]) => {
                            window.sessionStorage.setItem(key, value);
                        });
                    }, savedState.sessionStorage);
                }

                console.log('State restored to page');
            } catch (error) {
                console.log('Could not restore state:', error.message);
            }
        }

        return page;
    }

    async listProfiles() {
        const profilesDir = path.join(__dirname, '..', 'browser-profiles');
        try {
            const profiles = await fs.readdir(profilesDir);
            return profiles.filter(async (profile) => {
                const stats = await fs.stat(path.join(profilesDir, profile));
                return stats.isDirectory();
            });
        } catch {
            return [];
        }
    }

    async deleteProfile(profileName = null) {
        const targetProfile = profileName || this.profileName;
        const targetPath = path.join(__dirname, '..', 'browser-profiles', targetProfile);

        try {
            await fs.rm(targetPath, { recursive: true, force: true });
            console.log(`Deleted profile: ${targetProfile}`);
            return true;
        } catch (error) {
            console.error(`Failed to delete profile: ${error.message}`);
            return false;
        }
    }

    async getSessionInfo() {
        const statePath = path.join(this.profilePath, 'state.json');
        try {
            const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
            return {
                profile: this.profileName,
                savedAt: state.savedAt,
                url: state.url,
                cookiesCount: state.cookies?.length || 0,
                localStorageCount: Object.keys(state.localStorage || {}).length,
                sessionStorageCount: Object.keys(state.sessionStorage || {}).length
            };
        } catch {
            return null;
        }
    }
}

module.exports = StateManager;