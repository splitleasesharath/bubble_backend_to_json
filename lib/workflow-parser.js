class WorkflowParser {
    constructor() {
        this.metadataSelectors = {
            endpoint: 'input[prop_name="wf_name"], input[placeholder*="endpoint"]',
            trigger: 'div[prop_name="trigger_type"] .dropdown-caption',
            method: 'div[prop_name="method"] .dropdown-caption',
            responseType: 'div[prop_name="response_type"] .dropdown-caption',
            timezone: 'div[prop_name="timezone"] .dropdown-caption',
            exposed: 'div.component-checkbox[prop_name="exposed"]',
            authenticate: 'div.component-checkbox[prop_name="authenticate"]',
            description: 'textarea[prop_name="description"], input[prop_name="description"]'
        };
    }

    async extractMetadata(page) {
        const metadata = {
            endpoint: null,
            trigger: { type: null, method: null },
            response_type: null,
            timezone: 'US/Eastern',
            exposed_as_api: false,
            requires_authentication: true,
            description: null,
            settings: {}
        };

        try {
            // Wait for properties panel to be available
            await page.waitForTimeout(2000);

            // Look for the main workflow properties panel
            const propertiesPanel = await this.findWorkflowPropertiesPanel(page);

            if (!propertiesPanel) {
                console.log('    ⚠️ Workflow properties panel not found, trying alternative extraction...');
                return await this.extractMetadataFromAlternativeSources(page);
            }

            // Extract endpoint name
            const endpointInput = await propertiesPanel.$(this.metadataSelectors.endpoint);
            if (endpointInput) {
                metadata.endpoint = await endpointInput.inputValue() ||
                                   await endpointInput.getAttribute('value');
            }

            // Extract trigger type
            const triggerDropdown = await propertiesPanel.$(this.metadataSelectors.trigger);
            if (triggerDropdown) {
                const triggerText = await triggerDropdown.textContent();
                metadata.trigger.type = this.normalizeTriggerType(triggerText?.trim());
            }

            // Extract HTTP method
            const methodDropdown = await propertiesPanel.$(this.metadataSelectors.method);
            if (methodDropdown) {
                metadata.trigger.method = await methodDropdown.textContent();
            }

            // Extract response type
            const responseDropdown = await propertiesPanel.$(this.metadataSelectors.responseType);
            if (responseDropdown) {
                metadata.response_type = await responseDropdown.textContent();
            }

            // Extract timezone
            const timezoneDropdown = await propertiesPanel.$(this.metadataSelectors.timezone);
            if (timezoneDropdown) {
                metadata.timezone = await timezoneDropdown.textContent();
            }

            // Extract exposed checkbox
            const exposedCheckbox = await propertiesPanel.$(this.metadataSelectors.exposed);
            if (exposedCheckbox) {
                const classes = await exposedCheckbox.getAttribute('class');
                metadata.exposed_as_api = classes?.includes('checked') || false;
            }

            // Extract authentication checkbox
            const authCheckbox = await propertiesPanel.$(this.metadataSelectors.authenticate);
            if (authCheckbox) {
                const classes = await authCheckbox.getAttribute('class');
                metadata.requires_authentication = classes?.includes('checked') !== false;
            }

            // Extract description
            const descriptionField = await propertiesPanel.$(this.metadataSelectors.description);
            if (descriptionField) {
                metadata.description = await descriptionField.inputValue() ||
                                      await descriptionField.getAttribute('value');
            }

            // Extract additional settings
            metadata.settings = await this.extractAdditionalSettings(propertiesPanel);

        } catch (error) {
            console.error('    ⚠️ Error extracting metadata:', error.message);
        }

        return metadata;
    }

    async findWorkflowPropertiesPanel(page) {
        const selectors = [
            'div.rows.overview[node_type="APIEvent"]',
            'div.workflow-properties',
            'div[class*="workflow-settings"]',
            'div.property-editor[data-type="workflow"]',
            'div.properties-panel:not([style*="display: none"])',
            'div#workflow-properties'
        ];

        for (const selector of selectors) {
            const panel = await page.$(selector);
            if (panel) {
                const isVisible = await panel.isVisible().catch(() => false);
                if (isVisible) {
                    return panel;
                }
            }
        }

        // Try to click on workflow settings if not visible
        const settingsButton = await page.$('button[aria-label*="Settings"], div[class*="settings-button"]');
        if (settingsButton) {
            await settingsButton.click();
            await page.waitForTimeout(1000);

            // Try again after clicking settings
            for (const selector of selectors) {
                const panel = await page.$(selector);
                if (panel && await panel.isVisible()) {
                    return panel;
                }
            }
        }

        return null;
    }

    async extractMetadataFromAlternativeSources(page) {
        const metadata = {
            endpoint: null,
            trigger: { type: 'api_event', method: 'POST' },
            response_type: 'json_object',
            timezone: 'US/Eastern',
            exposed_as_api: true,
            requires_authentication: true,
            description: null,
            settings: {}
        };

        try {
            // Try to extract from URL
            const url = page.url();
            const urlObj = new URL(url);

            // Extract workflow item from URL
            const wfItem = urlObj.searchParams.get('wf_item');
            if (wfItem) {
                metadata.wf_item = wfItem;
            }

            // Extract type from URL
            const type = urlObj.searchParams.get('type');
            if (type === 'api') {
                metadata.trigger.type = 'api_event';
            } else if (type === 'data') {
                metadata.trigger.type = 'data_trigger';
            }

            // Try to find any visible text that might contain metadata
            const allText = await page.$$eval('div, span, p', elements =>
                elements.map(el => el.textContent?.trim()).filter(Boolean)
            );

            // Look for patterns in text
            for (const text of allText) {
                // Look for endpoint patterns
                if (text.includes('Endpoint') && !metadata.endpoint) {
                    const match = text.match(/Endpoint[:\s]+([a-zA-Z0-9_-]+)/);
                    if (match) metadata.endpoint = match[1];
                }

                // Look for timezone
                if (text.includes('Timezone') || text.includes('timezone')) {
                    const match = text.match(/(US\/\w+|UTC|GMT[+-]\d+)/);
                    if (match) metadata.timezone = match[1];
                }

                // Look for response type
                if (text.includes('Response') && text.includes('type')) {
                    if (text.includes('JSON')) metadata.response_type = 'json_object';
                    else if (text.includes('Text')) metadata.response_type = 'text';
                    else if (text.includes('File')) metadata.response_type = 'file';
                }
            }

        } catch (error) {
            console.error('    ⚠️ Error in alternative extraction:', error.message);
        }

        return metadata;
    }

    async extractAdditionalSettings(propertiesPanel) {
        const settings = {};

        try {
            // Extract all checkboxes
            const checkboxes = await propertiesPanel.$$('div.component-checkbox[prop_name]');
            for (const checkbox of checkboxes) {
                const propName = await checkbox.getAttribute('prop_name');
                if (propName && !['exposed', 'authenticate'].includes(propName)) {
                    const classes = await checkbox.getAttribute('class');
                    settings[propName] = classes?.includes('checked') || false;
                }
            }

            // Extract all dropdowns
            const dropdowns = await propertiesPanel.$$('div[prop_name] .dropdown-caption');
            for (const dropdown of dropdowns) {
                const parent = await dropdown.evaluateHandle(el => el.parentElement);
                const propName = await parent.asElement()?.getAttribute('prop_name');
                if (propName && !['trigger_type', 'method', 'response_type', 'timezone'].includes(propName)) {
                    settings[propName] = await dropdown.textContent();
                }
            }

            // Extract rate limiting settings
            const rateLimitInput = await propertiesPanel.$('input[prop_name*="rate_limit"]');
            if (rateLimitInput) {
                settings.rate_limit = await rateLimitInput.inputValue();
            }

            // Extract timeout settings
            const timeoutInput = await propertiesPanel.$('input[prop_name*="timeout"]');
            if (timeoutInput) {
                settings.timeout = await timeoutInput.inputValue();
            }

        } catch (error) {
            console.error('    ⚠️ Error extracting additional settings:', error.message);
        }

        return settings;
    }

    normalizeTriggerType(triggerText) {
        if (!triggerText) return 'api_event';

        const normalized = triggerText.toLowerCase().replace(/\s+/g, '_');

        // Map common trigger types
        const triggerMap = {
            'api_event': 'api_event',
            'api_workflow': 'api_workflow',
            'schedule_api_workflow': 'scheduled',
            'scheduled': 'scheduled',
            'recurring_event': 'recurring',
            'database_trigger': 'data_trigger',
            'data_trigger': 'data_trigger',
            'webhook': 'webhook',
            'custom_event': 'custom_event'
        };

        return triggerMap[normalized] || normalized;
    }

    async extractWorkflowName(page) {
        // Try multiple methods to get workflow name
        const nameSelectors = [
            'h1.workflow-name',
            'div.workflow-title',
            'span[class*="workflow-name"]',
            'div[class*="header"] span[class*="title"]'
        ];

        for (const selector of nameSelectors) {
            const element = await page.$(selector);
            if (element) {
                const name = await element.textContent();
                if (name && name.trim()) {
                    return name.trim();
                }
            }
        }

        // Try to extract from page title
        const title = await page.title();
        if (title && title.includes('|')) {
            const parts = title.split('|');
            return parts[0].trim();
        }

        return null;
    }

    async extractWorkflowDescription(page) {
        const descSelectors = [
            'div.workflow-description',
            'p.workflow-desc',
            'textarea[name="description"]',
            'div[class*="description"] p'
        ];

        for (const selector of descSelectors) {
            const element = await page.$(selector);
            if (element) {
                const desc = await element.textContent() || await element.inputValue();
                if (desc && desc.trim()) {
                    return desc.trim();
                }
            }
        }

        return null;
    }
}

module.exports = WorkflowParser;