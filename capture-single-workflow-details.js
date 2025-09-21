const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

async function captureSingleWorkflowDetails() {
    const profilePath = path.join(__dirname, 'browser-profiles', 'default');
    const bubbleUrl = 'https://bubble.io/page?id=upgradefromstr&tab=BackendWorkflows&name=index&type=api&wf_item=cqVKW3&version=test';

    console.log('Opening Chrome for detailed workflow text capture...');

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1440, height: 3600 },
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--window-size=1440,3600'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const page = await context.newPage();
    await page.goto(bubbleUrl);

    // Wait for page to load
    await page.waitForTimeout(5000);

    console.log('\n=== Capturing Current Workflow Details ===\n');

    // Get the current workflow name from URL
    const currentUrl = page.url();
    const urlObj = new URL(currentUrl);
    const wfItem = urlObj.searchParams.get('wf_item');

    console.log(`Current workflow ID: ${wfItem}`);
    console.log(`URL: ${currentUrl}`);

    // Capture the detailed workflow content
    const workflowDetails = await captureDetailedWorkflowElements(page);

    // Create output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const outputDir = path.join(__dirname, 'workflow-detailed-captures');

    try {
        await fs.mkdir(outputDir, { recursive: true });
    } catch (err) {
        console.log('Directory already exists or error:', err.message);
    }

    // Save the captured data
    const outputFileName = `workflow_${wfItem}_${timestamp}_detailed.json`;
    const outputPath = path.join(outputDir, outputFileName);

    await fs.writeFile(outputPath, JSON.stringify(workflowDetails, null, 2));

    console.log('\n=== Capture Summary ===');
    console.log(`File saved: ${outputFileName}`);
    console.log(`Total sections found: ${workflowDetails.sections?.length || 0}`);
    console.log(`Total rows captured: ${workflowDetails.all_rows?.length || 0}`);
    console.log(`Total parameters: ${workflowDetails.parameters?.length || 0}`);

    // Display the captured text content
    console.log('\n=== Captured Workflow Text Content ===\n');

    if (workflowDetails.endpoint_name) {
        console.log(`Endpoint Name: ${workflowDetails.endpoint_name}`);
    }

    if (workflowDetails.sections && workflowDetails.sections.length > 0) {
        console.log('\n--- Sections ---');
        workflowDetails.sections.forEach((section, idx) => {
            console.log(`\n[Section ${idx + 1}] ${section.name}`);
            if (section.rows && section.rows.length > 0) {
                section.rows.forEach(row => {
                    console.log(`  • ${row.caption}: ${row.value || row.type || 'N/A'}`);
                });
            }
        });
    }

    if (workflowDetails.parameters && workflowDetails.parameters.length > 0) {
        console.log('\n--- Parameters ---');
        workflowDetails.parameters.forEach((param, idx) => {
            console.log(`\n[Parameter ${idx + 1}]`);
            console.log(`  Key: ${param.key || 'N/A'}`);
            console.log(`  Type: ${param.type || 'N/A'}`);
            console.log(`  Is List: ${param.is_list}`);
            console.log(`  Optional: ${param.optional}`);
            console.log(`  Querystring: ${param.querystring}`);
        });
    }

    if (workflowDetails.checkbox_settings) {
        console.log('\n--- Checkbox Settings ---');
        Object.entries(workflowDetails.checkbox_settings).forEach(([key, value]) => {
            console.log(`  ${key}: ${value}`);
        });
    }

    if (workflowDetails.dropdown_settings) {
        console.log('\n--- Dropdown Settings ---');
        Object.entries(workflowDetails.dropdown_settings).forEach(([key, value]) => {
            console.log(`  ${key}: ${value}`);
        });
    }

    console.log('\n=== Raw Text Display ===\n');
    if (workflowDetails.raw_text_content && workflowDetails.raw_text_content.length > 0) {
        workflowDetails.raw_text_content.slice(0, 50).forEach((text, idx) => {
            console.log(`${idx + 1}. ${text}`);
        });
        if (workflowDetails.raw_text_content.length > 50) {
            console.log(`... and ${workflowDetails.raw_text_content.length - 50} more items`);
        }
    }

    console.log('\nClosing browser...');
    await context.close();

    console.log('\n=== Process Complete ===');
    console.log(`Details saved to: ${outputPath}`);
}

async function captureDetailedWorkflowElements(page) {
    const workflowDetails = {
        timestamp: new Date().toISOString(),
        url: page.url(),
        endpoint_name: null,
        sections: [],
        all_rows: [],
        parameters: [],
        checkbox_settings: {},
        dropdown_settings: {},
        raw_text_content: [],
        context_menu: null,
        overview_data: {}
    };

    try {
        await page.waitForTimeout(2000);

        // Capture the main overview div
        const overviewDiv = await page.$('div.rows.overview[node_type="APIEvent"]');
        if (overviewDiv) {
            console.log('Found main overview div with node_type="APIEvent"');

            // Get all sections within the overview
            const sections = await overviewDiv.$$('div.section');
            console.log(`Found ${sections.length} sections`);

            for (const section of sections) {
                const sectionData = {
                    name: await section.getAttribute('section_name') || 'unnamed',
                    rows: []
                };

                // Get all rows in this section
                const rows = await section.$$('div.row');
                console.log(`  Section "${sectionData.name}" has ${rows.length} rows`);

                for (const row of rows) {
                    try {
                        const propName = await row.getAttribute('prop_name');
                        const caption = await row.$eval('div.caption', el => el.textContent).catch(() => null);

                        const rowData = {
                            prop_name: propName,
                            caption: caption?.trim(),
                            value: null,
                            type: null
                        };

                        // Check for different input types
                        const textInput = await row.$('input.property-editor-control');
                        if (textInput) {
                            rowData.value = await textInput.getAttribute('value') || await textInput.inputValue();
                            rowData.type = 'text_input';
                        }

                        // Check for checkbox
                        const checkbox = await row.$('div.component-checkbox');
                        if (checkbox) {
                            const classes = await checkbox.getAttribute('class');
                            rowData.value = classes?.includes('checked') ? true : false;
                            rowData.type = 'checkbox';

                            if (caption) {
                                workflowDetails.checkbox_settings[caption.trim()] = rowData.value;
                            }
                        }

                        // Check for dropdown
                        const dropdown = await row.$('div.spot.property-editor-control, div.dropdown-caption');
                        if (dropdown) {
                            rowData.value = await dropdown.textContent();
                            rowData.type = 'dropdown';

                            if (caption) {
                                workflowDetails.dropdown_settings[caption.trim()] = rowData.value?.trim();
                            }
                        }

                        // Special handling for endpoint name
                        if (propName === 'wf_name' && rowData.value) {
                            workflowDetails.endpoint_name = rowData.value;
                        }

                        sectionData.rows.push(rowData);
                        workflowDetails.all_rows.push(rowData);

                    } catch (err) {
                        console.log(`Error processing row: ${err.message}`);
                    }
                }

                workflowDetails.sections.push(sectionData);
            }
        } else {
            console.log('Main overview div not found, trying alternative selectors...');

            // Try alternative selectors
            const alternativeSelectors = [
                'div.rows',
                'div[node_type]',
                'div.overview',
                '.workflow-properties',
                '.workflow-settings'
            ];

            for (const selector of alternativeSelectors) {
                const element = await page.$(selector);
                if (element) {
                    console.log(`Found element with selector: ${selector}`);
                    const text = await element.textContent();
                    if (text) {
                        workflowDetails.raw_text_content.push(`[${selector}] ${text.substring(0, 200)}...`);
                    }
                }
            }
        }

        // Capture parameters specifically
        const parameterSection = await page.$('div[prop_name="parameters"]');
        if (parameterSection) {
            console.log('Found parameters section');

            const paramEntries = await parameterSection.$$('div.entry');
            console.log(`Found ${paramEntries.length} parameter entries`);

            for (const entry of paramEntries) {
                const paramData = {
                    key: null,
                    type: null,
                    is_list: false,
                    optional: false,
                    querystring: false
                };

                // Get key
                const keyInput = await entry.$('input[id*="key"]');
                if (keyInput) {
                    paramData.key = await keyInput.inputValue();
                }

                // Get type from dropdown
                const typeDropdown = await entry.$('div.dropdown-caption');
                if (typeDropdown) {
                    paramData.type = await typeDropdown.textContent();
                }

                // Get checkbox states
                const checkboxes = await entry.$$('div.component-checkbox');
                for (const checkbox of checkboxes) {
                    const id = await checkbox.getAttribute('id');
                    const isChecked = (await checkbox.getAttribute('class'))?.includes('checked');

                    if (id?.includes('is_list')) paramData.is_list = isChecked;
                    if (id?.includes('optional')) paramData.optional = isChecked;
                    if (id?.includes('in_url')) paramData.querystring = isChecked;
                }

                if (paramData.key || paramData.type) {
                    workflowDetails.parameters.push(paramData);
                }
            }
        }

        // Capture all visible text content
        const allTextElements = await page.$$('div, span, p, label, input[type="text"]');
        for (const element of allTextElements.slice(0, 200)) { // Limit to first 200 elements
            try {
                const text = await element.textContent();
                if (text && text.trim() && text.length > 2 && text.length < 200) {
                    const isVisible = await element.isVisible();
                    if (isVisible) {
                        workflowDetails.raw_text_content.push(text.trim());
                    }
                }
            } catch (err) {
                // Continue
            }
        }

        // Remove duplicates from raw text
        workflowDetails.raw_text_content = [...new Set(workflowDetails.raw_text_content)];

        // Try to capture context menu if visible
        const contextMenu = await page.$('.context-menu, .workflow-menu, [class*="menu"]');
        if (contextMenu) {
            workflowDetails.context_menu = await contextMenu.textContent();
        }

    } catch (err) {
        console.log('Error during detailed capture:', err.message);
    }

    return workflowDetails;
}

captureSingleWorkflowDetails().catch(console.error);