class StepExtractor {
    constructor() {
        this.actionTypes = {
            'create': 'create_thing',
            'make changes': 'make_changes',
            'delete': 'delete_thing',
            'schedule': 'schedule_api_workflow',
            'trigger': 'trigger_custom_event',
            'send email': 'send_email',
            'charge': 'charge_user',
            'log': 'log_event',
            'return data': 'return_data',
            'terminate': 'terminate_workflow',
            'reset': 'reset_data',
            'go to page': 'navigate',
            'set state': 'set_custom_state',
            'show message': 'show_alert'
        };

        this.conditionPatterns = [
            /only when\s+(.+)/i,
            /when\s+(.+)/i,
            /if\s+(.+)/i,
            /condition:\s*(.+)/i,
            /run if:\s*(.+)/i
        ];
    }

    async extractTitle(stepText) {
        if (!stepText) return '';

        // Remove "Step X" prefix
        let title = stepText.replace(/Step\s+\d+[:\s]*/i, '').trim();

        // Extract just the action title (usually the first line)
        const lines = title.split('\n');
        if (lines.length > 0) {
            title = lines[0].trim();
        }

        // Clean up common prefixes
        title = title.replace(/^(Create|Make|Delete|Schedule|Send|Trigger)\s+/i, '');

        return title;
    }

    async extractActionType(page) {
        // Try to find action type from various sources
        const actionSelectors = [
            'div[prop_name="action_type"] .dropdown-caption',
            'div.action-type',
            'span[class*="action-type"]',
            'div[class*="step-action"]'
        ];

        for (const selector of actionSelectors) {
            const element = await page.$(selector);
            if (element) {
                const actionText = await element.textContent();
                if (actionText) {
                    return this.normalizeActionType(actionText.trim());
                }
            }
        }

        // Try to infer from step text
        const stepElements = await page.$$('div[class*="step"], div[class*="action"]');
        for (const element of stepElements) {
            const text = await element.textContent();
            if (text) {
                const actionType = this.inferActionType(text);
                if (actionType) return actionType;
            }
        }

        return 'unknown_action';
    }

    normalizeActionType(actionText) {
        const normalized = actionText.toLowerCase().trim();

        // Check against known action types
        for (const [pattern, type] of Object.entries(this.actionTypes)) {
            if (normalized.includes(pattern)) {
                return type;
            }
        }

        // Clean up and return as snake_case
        return normalized.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    }

    inferActionType(text) {
        const lowerText = text.toLowerCase();

        // Check for action keywords
        for (const [pattern, type] of Object.entries(this.actionTypes)) {
            if (lowerText.includes(pattern)) {
                return type;
            }
        }

        // Check for API workflow patterns
        if (lowerText.includes('api') || lowerText.includes('workflow')) {
            if (lowerText.includes('schedule')) return 'schedule_api_workflow';
            if (lowerText.includes('trigger')) return 'trigger_api_workflow';
            if (lowerText.includes('cancel')) return 'cancel_api_workflow';
        }

        // Check for data operations
        if (lowerText.includes('create') && lowerText.includes('thing')) return 'create_thing';
        if (lowerText.includes('make') && lowerText.includes('changes')) return 'make_changes';
        if (lowerText.includes('delete')) return 'delete_thing';
        if (lowerText.includes('copy')) return 'copy_thing';

        return null;
    }

    async extractActionDetails(propertiesPanel) {
        const details = {
            thing_type: null,
            condition: null,
            run_as: null,
            ignore_privacy_rules: false,
            batch_size: null
        };

        try {
            // Extract thing type (for create/modify/delete actions)
            const thingTypeDropdown = await propertiesPanel.$('div[prop_name="thing_type"] .dropdown-caption');
            if (thingTypeDropdown) {
                details.thing_type = await thingTypeDropdown.textContent();
            }

            // Extract condition
            details.condition = await this.extractCondition(propertiesPanel);

            // Extract "Run as" user
            const runAsInput = await propertiesPanel.$('input[prop_name="run_as"]');
            if (runAsInput) {
                details.run_as = await runAsInput.inputValue();
            }

            // Extract privacy rules checkbox
            const privacyCheckbox = await propertiesPanel.$('div.component-checkbox[prop_name*="privacy"]');
            if (privacyCheckbox) {
                const classes = await privacyCheckbox.getAttribute('class');
                details.ignore_privacy_rules = classes?.includes('checked') || false;
            }

            // Extract batch size for bulk operations
            const batchInput = await propertiesPanel.$('input[prop_name="batch_size"]');
            if (batchInput) {
                details.batch_size = await batchInput.inputValue();
            }

            // Extract additional action-specific details
            const additionalDetails = await this.extractActionSpecificDetails(propertiesPanel);
            Object.assign(details, additionalDetails);

        } catch (error) {
            console.error('      ⚠️ Error extracting action details:', error.message);
        }

        return details;
    }

    async extractCondition(panel) {
        // Try multiple selectors for conditions
        const conditionSelectors = [
            'div[prop_name="condition"]',
            'div[prop_name="only_when"]',
            'div.condition-editor',
            'textarea[placeholder*="condition"]',
            'div[class*="condition"] input'
        ];

        for (const selector of conditionSelectors) {
            const element = await panel.$(selector);
            if (element) {
                const conditionText = await element.textContent() ||
                                     await element.inputValue();
                if (conditionText && conditionText.trim()) {
                    return this.parseCondition(conditionText.trim());
                }
            }
        }

        // Try to find condition in visible text
        const allText = await panel.textContent();
        if (allText) {
            for (const pattern of this.conditionPatterns) {
                const match = allText.match(pattern);
                if (match) {
                    return this.parseCondition(match[1]);
                }
            }
        }

        return null;
    }

    parseCondition(conditionText) {
        if (!conditionText || conditionText === 'None' || conditionText === 'Always') {
            return null;
        }

        // Clean up the condition text
        let cleaned = conditionText
            .replace(/\s+/g, ' ')
            .replace(/^Only when\s+/i, '')
            .replace(/^When\s+/i, '')
            .trim();

        // Try to structure the condition
        const structured = {
            raw: cleaned,
            normalized: null,
            variables: [],
            operators: []
        };

        // Extract variables (things that look like field references)
        const variablePattern = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
        const variables = cleaned.match(variablePattern);
        if (variables) {
            structured.variables = [...new Set(variables)];
        }

        // Detect operators
        const operators = ['is', 'is not', 'contains', 'doesn\'t contain', '>', '<', '>=', '<=', '=', '!=', 'and', 'or'];
        for (const op of operators) {
            if (cleaned.toLowerCase().includes(op)) {
                structured.operators.push(op);
            }
        }

        // Try to normalize to a simplified format
        structured.normalized = this.normalizeCondition(cleaned);

        return structured;
    }

    normalizeCondition(condition) {
        // Convert to a normalized form for easier comparison
        let normalized = condition.toLowerCase()
            .replace(/\s+is\s+not\s+/g, ' != ')
            .replace(/\s+is\s+/g, ' = ')
            .replace(/\s+contains\s+/g, ' CONTAINS ')
            .replace(/doesn't contain/g, 'NOT_CONTAINS')
            .replace(/\s+and\s+/g, ' AND ')
            .replace(/\s+or\s+/g, ' OR ')
            .replace(/empty/g, 'null')
            .replace(/not empty/g, '!= null');

        return normalized;
    }

    async extractActionSpecificDetails(panel) {
        const details = {};

        try {
            // For email actions
            const emailTo = await panel.$('input[prop_name="to"], input[placeholder*="email"]');
            if (emailTo) {
                details.email_to = await emailTo.inputValue();
            }

            const emailSubject = await panel.$('input[prop_name="subject"]');
            if (emailSubject) {
                details.email_subject = await emailSubject.inputValue();
            }

            // For API workflow actions
            const workflowDropdown = await panel.$('div[prop_name="workflow"] .dropdown-caption');
            if (workflowDropdown) {
                details.target_workflow = await workflowDropdown.textContent();
            }

            const scheduleDate = await panel.$('input[prop_name="scheduled_date"]');
            if (scheduleDate) {
                details.scheduled_date = await scheduleDate.inputValue();
            }

            // For navigation actions
            const pageDropdown = await panel.$('div[prop_name="page"] .dropdown-caption');
            if (pageDropdown) {
                details.destination_page = await pageDropdown.textContent();
            }

            // For data return actions
            const returnData = await panel.$('textarea[prop_name="data"], input[prop_name="return_data"]');
            if (returnData) {
                details.return_data = await returnData.inputValue();
            }

            // For custom state actions
            const stateName = await panel.$('input[prop_name="state_name"]');
            if (stateName) {
                details.state_name = await stateName.inputValue();
            }

            const stateValue = await panel.$('input[prop_name="state_value"]');
            if (stateValue) {
                details.state_value = await stateValue.inputValue();
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting action-specific details:', error.message);
        }

        return details;
    }

    async extractStepConnections(panel) {
        const connections = {
            next: [],
            error_workflow: null,
            terminate_on_error: false
        };

        try {
            // Look for next step references
            const nextStepElements = await panel.$$('div[class*="next-step"], div[class*="connection"]');
            for (const element of nextStepElements) {
                const text = await element.textContent();
                if (text && text.includes('Step')) {
                    const match = text.match(/Step\s+(\d+)/);
                    if (match) {
                        connections.next.push(parseInt(match[1]));
                    }
                }
            }

            // Look for error handling
            const errorWorkflow = await panel.$('div[prop_name="error_workflow"] .dropdown-caption');
            if (errorWorkflow) {
                connections.error_workflow = await errorWorkflow.textContent();
            }

            const terminateCheckbox = await panel.$('div.component-checkbox[prop_name*="terminate"]');
            if (terminateCheckbox) {
                const classes = await terminateCheckbox.getAttribute('class');
                connections.terminate_on_error = classes?.includes('checked') || false;
            }

        } catch (error) {
            console.error('      ⚠️ Error extracting step connections:', error.message);
        }

        return connections;
    }
}

module.exports = StepExtractor;