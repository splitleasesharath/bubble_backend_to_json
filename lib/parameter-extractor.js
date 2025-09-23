class ParameterExtractor {
    constructor() {
        this.parameterTypes = {
            'text': 'text',
            'number': 'number',
            'yes/no': 'boolean',
            'boolean': 'boolean',
            'date': 'date',
            'date range': 'date_range',
            'file': 'file',
            'image': 'image',
            'geographic address': 'address',
            'option set': 'option_set',
            'list': 'list_of_things'
        };

        this.dataTypes = new Set([
            'User',
            'Proposal',
            'Listing',
            'Message',
            'Thread',
            'Conversation',
            'Payment',
            'Lease',
            'Agreement',
            'Virtual Meeting',
            'Schedule',
            'Photo',
            'Document'
        ]);
    }

    async extractWorkflowParameters(page) {
        const parameters = [];

        try {
            // Look for the parameters section
            const parametersSections = [
                'div[prop_name="parameters"]',
                'div[section_name="parameters"]',
                'div.parameters-section',
                'div[class*="workflow-parameters"]'
            ];

            let parametersPanel = null;
            for (const selector of parametersSections) {
                parametersPanel = await page.$(selector);
                if (parametersPanel) break;
            }

            if (!parametersPanel) {
                console.log('      ℹ️ No workflow parameters section found');
                return parameters;
            }

            // Find all parameter entries
            const paramEntries = await parametersPanel.$$('div.entry, div[class*="parameter-entry"], div[class*="param-row"]');

            console.log(`      Found ${paramEntries.length} parameter entries`);

            for (let i = 0; i < paramEntries.length; i++) {
                const entry = paramEntries[i];
                const param = await this.extractSingleParameter(entry, i);
                if (param && (param.key || param.name)) {
                    parameters.push(param);
                }
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting workflow parameters:', error.message);
        }

        return parameters;
    }

    async extractStepParameters(propertiesPanel) {
        const parameters = [];

        try {
            // Look for parameter fields in the properties panel
            const parameterFields = await this.findParameterFields(propertiesPanel);

            for (const field of parameterFields) {
                const param = await this.extractParameterFromField(field);
                if (param) {
                    parameters.push(param);
                }
            }

            // Also look for mapped parameters (for workflow calls)
            const mappedParams = await this.extractMappedParameters(propertiesPanel);
            parameters.push(...mappedParams);

        } catch (error) {
            console.error('      ⚠️ Error extracting step parameters:', error.message);
        }

        return parameters;
    }

    async extractSingleParameter(entry, index) {
        const param = {
            key: null,
            name: null,
            type: 'text',
            data_type: null,
            optional: true,
            is_list: false,
            in_querystring: false,
            in_header: false,
            in_body: true,
            default_value: null,
            description: null,
            validation: null
        };

        try {
            // Extract key/name
            const keyInput = await entry.$('input[id*="key"], input[placeholder*="Key"], input[placeholder*="Parameter"]');
            if (keyInput) {
                param.key = await keyInput.inputValue() || await keyInput.getAttribute('value');
                param.name = param.key;
            }

            // Extract type from dropdown
            const typeDropdown = await entry.$('div.dropdown-caption, select[id*="type"]');
            if (typeDropdown) {
                const typeText = await typeDropdown.textContent() || await typeDropdown.inputValue();
                param.type = this.normalizeParameterType(typeText);

                // Check if it's a custom data type
                if (this.dataTypes.has(typeText)) {
                    param.data_type = typeText;
                    param.type = 'custom_type';
                }
            }

            // Extract checkbox states
            await this.extractParameterFlags(entry, param);

            // Extract default value
            const defaultInput = await entry.$('input[placeholder*="Default"], input[id*="default"]');
            if (defaultInput) {
                param.default_value = await defaultInput.inputValue();
            }

            // Extract description
            const descInput = await entry.$('input[placeholder*="Description"], textarea[placeholder*="Description"]');
            if (descInput) {
                param.description = await descInput.inputValue();
            }

            // Extract validation rules
            param.validation = await this.extractValidationRules(entry);

        } catch (error) {
            console.error(`      ⚠️ Error extracting parameter ${index}:`, error.message);
        }

        return param;
    }

    async extractParameterFlags(entry, param) {
        // Check for optional checkbox
        const optionalCheckbox = await entry.$('div.component-checkbox[id*="optional"], input[type="checkbox"][id*="optional"]');
        if (optionalCheckbox) {
            const isChecked = await this.isCheckboxChecked(optionalCheckbox);
            param.optional = isChecked;
        }

        // Check for is_list checkbox
        const listCheckbox = await entry.$('div.component-checkbox[id*="is_list"], input[type="checkbox"][id*="list"]');
        if (listCheckbox) {
            const isChecked = await this.isCheckboxChecked(listCheckbox);
            param.is_list = isChecked;
        }

        // Check for querystring checkbox
        const querystringCheckbox = await entry.$('div.component-checkbox[id*="in_url"], div.component-checkbox[id*="querystring"]');
        if (querystringCheckbox) {
            const isChecked = await this.isCheckboxChecked(querystringCheckbox);
            param.in_querystring = isChecked;
            if (isChecked) param.in_body = false;
        }

        // Check for header checkbox
        const headerCheckbox = await entry.$('div.component-checkbox[id*="header"]');
        if (headerCheckbox) {
            const isChecked = await this.isCheckboxChecked(headerCheckbox);
            param.in_header = isChecked;
            if (isChecked) param.in_body = false;
        }

        // Check for private/public
        const privateCheckbox = await entry.$('div.component-checkbox[id*="private"]');
        if (privateCheckbox) {
            const isChecked = await this.isCheckboxChecked(privateCheckbox);
            param.is_private = isChecked;
        }
    }

    async isCheckboxChecked(checkbox) {
        // Handle both div-based and input-based checkboxes
        const tagName = await checkbox.evaluate(el => el.tagName.toLowerCase());

        if (tagName === 'input') {
            return await checkbox.isChecked();
        } else {
            const classes = await checkbox.getAttribute('class');
            return classes?.includes('checked') || false;
        }
    }

    async extractValidationRules(entry) {
        const validation = {};

        try {
            // Look for min/max values
            const minInput = await entry.$('input[placeholder*="Min"], input[id*="min"]');
            if (minInput) {
                const minValue = await minInput.inputValue();
                if (minValue) validation.min = minValue;
            }

            const maxInput = await entry.$('input[placeholder*="Max"], input[id*="max"]');
            if (maxInput) {
                const maxValue = await maxInput.inputValue();
                if (maxValue) validation.max = maxValue;
            }

            // Look for pattern/regex
            const patternInput = await entry.$('input[placeholder*="Pattern"], input[id*="regex"]');
            if (patternInput) {
                const pattern = await patternInput.inputValue();
                if (pattern) validation.pattern = pattern;
            }

            // Look for required field
            const requiredCheckbox = await entry.$('div.component-checkbox[id*="required"]');
            if (requiredCheckbox) {
                validation.required = await this.isCheckboxChecked(requiredCheckbox);
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting validation rules:', error.message);
        }

        return Object.keys(validation).length > 0 ? validation : null;
    }

    async findParameterFields(panel) {
        const fields = [];

        // Look for input fields that represent parameters
        const fieldSelectors = [
            'div[class*="field-mapping"]',
            'div[class*="parameter-field"]',
            'div.field-row',
            'div[prop_name*="field"]'
        ];

        for (const selector of fieldSelectors) {
            const elements = await panel.$$(selector);
            fields.push(...elements);
        }

        // Also look for specific action fields
        const actionFields = await panel.$$('div.row[prop_name]');
        for (const field of actionFields) {
            const propName = await field.getAttribute('prop_name');
            if (propName && !['action_type', 'thing_type', 'condition'].includes(propName)) {
                fields.push(field);
            }
        }

        return fields;
    }

    async extractParameterFromField(field) {
        const param = {
            key: null,
            value: null,
            source: null,
            type: 'dynamic'
        };

        try {
            // Get the field name
            const propName = await field.getAttribute('prop_name');
            if (propName) {
                param.key = propName;
            } else {
                // Try to get from caption
                const caption = await field.$('.caption');
                if (caption) {
                    param.key = await caption.textContent();
                    param.key = param.key?.replace(':', '').trim();
                }
            }

            // Get the value
            const input = await field.$('input, textarea');
            if (input) {
                param.value = await input.inputValue();
                param.source = 'input';
            } else {
                const dropdown = await field.$('.dropdown-caption');
                if (dropdown) {
                    param.value = await dropdown.textContent();
                    param.source = 'dropdown';
                }
            }

            // Determine type based on value pattern
            if (param.value) {
                param.type = this.inferParameterType(param.value);
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting parameter from field:', error.message);
        }

        return param.key ? param : null;
    }

    async extractMappedParameters(panel) {
        const mappedParams = [];

        try {
            // Look for parameter mapping sections
            const mappingSections = await panel.$$('div[class*="parameter-mapping"], div[class*="field-mapping"]');

            for (const section of mappingSections) {
                const mapping = {
                    target_param: null,
                    source_type: null,
                    source_value: null,
                    transformation: null
                };

                // Get target parameter name
                const targetInput = await section.$('input[placeholder*="Parameter"], input[placeholder*="Field"]');
                if (targetInput) {
                    mapping.target_param = await targetInput.inputValue();
                }

                // Get source value
                const sourceInput = await section.$('input[placeholder*="Value"], input[placeholder*="Source"]');
                if (sourceInput) {
                    const value = await sourceInput.inputValue();
                    mapping.source_value = value;
                    mapping.source_type = this.determineSourceType(value);
                }

                // Check for transformation
                const transformDropdown = await section.$('.dropdown-caption[id*="transform"]');
                if (transformDropdown) {
                    mapping.transformation = await transformDropdown.textContent();
                }

                if (mapping.target_param || mapping.source_value) {
                    mappedParams.push(mapping);
                }
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting mapped parameters:', error.message);
        }

        return mappedParams;
    }

    normalizeParameterType(typeText) {
        if (!typeText) return 'text';

        const normalized = typeText.toLowerCase().trim();
        return this.parameterTypes[normalized] || normalized.replace(/\s+/g, '_');
    }

    inferParameterType(value) {
        if (!value) return 'text';

        // Check for boolean
        if (value === 'true' || value === 'false' || value === 'yes' || value === 'no') {
            return 'boolean';
        }

        // Check for number
        if (/^\d+$/.test(value)) {
            return 'number';
        }

        // Check for date
        if (/\d{4}-\d{2}-\d{2}/.test(value)) {
            return 'date';
        }

        // Check for expression
        if (value.includes('.') || value.includes('[') || value.includes('Result of')) {
            return 'expression';
        }

        // Check for variable
        if (value.startsWith('$') || value.startsWith('@')) {
            return 'variable';
        }

        return 'text';
    }

    determineSourceType(value) {
        if (!value) return 'literal';

        // Check for literal values
        if (value.startsWith('"') || value.startsWith("'")) {
            return 'literal';
        }

        // Check for expressions
        if (value.includes('.') || value.includes('[')) {
            return 'expression';
        }

        // Check for workflow results
        if (value.includes('Result of') || value.includes('Step')) {
            return 'workflow_result';
        }

        // Check for current user/thing
        if (value.includes('Current') || value.includes('This')) {
            return 'context';
        }

        // Check for variables
        if (value.startsWith('$') || value.startsWith('@')) {
            return 'variable';
        }

        return 'dynamic';
    }
}

module.exports = ParameterExtractor;