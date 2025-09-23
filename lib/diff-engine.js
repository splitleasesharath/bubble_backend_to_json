const fs = require('fs').promises;
const path = require('path');

class DiffEngine {
    constructor(hashGenerator) {
        this.hashGenerator = hashGenerator;
        this.severityLevels = {
            HIGH: 'high',
            MEDIUM: 'medium',
            LOW: 'low'
        };
    }

    async compareSnapshots(oldSnapshot, newSnapshot) {
        const changes = {
            timestamp: new Date().toISOString(),
            from_snapshot: oldSnapshot.captured_at || oldSnapshot.timestamp,
            to_snapshot: newSnapshot.captured_at || newSnapshot.timestamp,
            summary: {
                workflows_added: 0,
                workflows_removed: 0,
                workflows_modified: 0,
                steps_added: 0,
                steps_removed: 0,
                steps_modified: 0,
                total_changes: 0
            },
            changes: []
        };

        // Create maps for easier comparison
        const oldWorkflows = new Map(oldSnapshot.workflows?.map(w => [w.wf_item, w]) || []);
        const newWorkflows = new Map(newSnapshot.workflows?.map(w => [w.wf_item, w]) || []);

        // Find added workflows
        for (const [wf_item, workflow] of newWorkflows) {
            if (!oldWorkflows.has(wf_item)) {
                changes.changes.push(this.createWorkflowAddedChange(workflow));
                changes.summary.workflows_added++;
            }
        }

        // Find removed workflows
        for (const [wf_item, workflow] of oldWorkflows) {
            if (!newWorkflows.has(wf_item)) {
                changes.changes.push(this.createWorkflowRemovedChange(workflow));
                changes.summary.workflows_removed++;
            }
        }

        // Find modified workflows
        for (const [wf_item, newWorkflow] of newWorkflows) {
            const oldWorkflow = oldWorkflows.get(wf_item);
            if (oldWorkflow) {
                const workflowChanges = await this.compareWorkflows(oldWorkflow, newWorkflow);
                if (workflowChanges.length > 0) {
                    changes.changes.push(...workflowChanges);
                    changes.summary.workflows_modified++;

                    // Count step-level changes
                    workflowChanges.forEach(change => {
                        if (change.type === 'step_added') changes.summary.steps_added++;
                        if (change.type === 'step_removed') changes.summary.steps_removed++;
                        if (change.type === 'step_modified') changes.summary.steps_modified++;
                    });
                }
            }
        }

        changes.summary.total_changes = changes.changes.length;

        return changes;
    }

    async compareWorkflows(oldWorkflow, newWorkflow) {
        const changes = [];

        // Compare workflow-level hash first
        if (oldWorkflow.hash === newWorkflow.hash) {
            return changes; // No changes
        }

        // Compare metadata
        const metadataChanges = this.compareMetadata(oldWorkflow.metadata, newWorkflow.metadata);
        if (metadataChanges) {
            changes.push({
                type: 'workflow_modified',
                workflow_id: newWorkflow.workflow_id,
                wf_item: newWorkflow.wf_item,
                severity: this.severityLevels.MEDIUM,
                details: {
                    type: 'metadata_changed',
                    changes: metadataChanges
                }
            });
        }

        // Compare interface
        const interfaceChanges = this.compareInterface(oldWorkflow.interface, newWorkflow.interface);
        if (interfaceChanges) {
            changes.push({
                type: 'workflow_modified',
                workflow_id: newWorkflow.workflow_id,
                wf_item: newWorkflow.wf_item,
                severity: this.severityLevels.HIGH,
                details: {
                    type: 'interface_changed',
                    changes: interfaceChanges
                }
            });
        }

        // Compare steps
        const stepChanges = this.compareSteps(oldWorkflow.steps || [], newWorkflow.steps || []);
        changes.push(...stepChanges.map(change => ({
            ...change,
            workflow_id: newWorkflow.workflow_id,
            workflow_wf_item: newWorkflow.wf_item
        })));

        return changes;
    }

    compareMetadata(oldMeta, newMeta) {
        if (!oldMeta && !newMeta) return null;
        if (!oldMeta || !newMeta) return { added: !oldMeta, removed: !newMeta };

        const changes = {};

        // Compare important fields
        const fieldsToCompare = [
            'endpoint',
            'trigger.type',
            'trigger.method',
            'response_type',
            'timezone',
            'exposed_as_api',
            'requires_authentication'
        ];

        for (const field of fieldsToCompare) {
            const oldValue = this.getNestedValue(oldMeta, field);
            const newValue = this.getNestedValue(newMeta, field);

            if (oldValue !== newValue) {
                changes[field] = {
                    from: oldValue,
                    to: newValue
                };
            }
        }

        return Object.keys(changes).length > 0 ? changes : null;
    }

    compareInterface(oldInterface, newInterface) {
        if (!oldInterface && !newInterface) return null;

        const changes = {
            inputs: this.compareParameterLists(
                oldInterface?.inputs || [],
                newInterface?.inputs || []
            ),
            outputs: this.compareParameterLists(
                oldInterface?.outputs || [],
                newInterface?.outputs || []
            )
        };

        if (!changes.inputs && !changes.outputs) return null;

        return changes;
    }

    compareParameterLists(oldParams, newParams) {
        const oldMap = new Map(oldParams.map(p => [p.key || p.name, p]));
        const newMap = new Map(newParams.map(p => [p.key || p.name, p]));

        const changes = {
            added: [],
            removed: [],
            modified: []
        };

        // Find added parameters
        for (const [key, param] of newMap) {
            if (!oldMap.has(key)) {
                changes.added.push(param);
            }
        }

        // Find removed parameters
        for (const [key, param] of oldMap) {
            if (!newMap.has(key)) {
                changes.removed.push(param);
            }
        }

        // Find modified parameters
        for (const [key, newParam] of newMap) {
            const oldParam = oldMap.get(key);
            if (oldParam) {
                const paramChanges = this.compareParameters(oldParam, newParam);
                if (paramChanges) {
                    changes.modified.push({
                        key,
                        changes: paramChanges
                    });
                }
            }
        }

        if (changes.added.length === 0 &&
            changes.removed.length === 0 &&
            changes.modified.length === 0) {
            return null;
        }

        return changes;
    }

    compareParameters(oldParam, newParam) {
        const changes = {};

        const fieldsToCompare = ['type', 'optional', 'is_list', 'default_value'];

        for (const field of fieldsToCompare) {
            if (oldParam[field] !== newParam[field]) {
                changes[field] = {
                    from: oldParam[field],
                    to: newParam[field]
                };
            }
        }

        return Object.keys(changes).length > 0 ? changes : null;
    }

    compareSteps(oldSteps, newSteps) {
        const changes = [];

        // Create maps by wf_item for comparison
        const oldStepsMap = new Map(oldSteps.map(s => [s.wf_item, s]));
        const newStepsMap = new Map(newSteps.map(s => [s.wf_item, s]));

        // Find added steps
        for (const [wf_item, step] of newStepsMap) {
            if (!oldStepsMap.has(wf_item)) {
                changes.push({
                    type: 'step_added',
                    wf_item,
                    severity: this.severityLevels.HIGH,
                    details: {
                        order: step.order,
                        title: step.title,
                        action: step.action
                    }
                });
            }
        }

        // Find removed steps
        for (const [wf_item, step] of oldStepsMap) {
            if (!newStepsMap.has(wf_item)) {
                changes.push({
                    type: 'step_removed',
                    wf_item,
                    severity: this.severityLevels.HIGH,
                    details: {
                        order: step.order,
                        title: step.title,
                        action: step.action
                    }
                });
            }
        }

        // Find modified or reordered steps
        for (const [wf_item, newStep] of newStepsMap) {
            const oldStep = oldStepsMap.get(wf_item);
            if (oldStep) {
                // Check if step was reordered
                if (oldStep.order !== newStep.order) {
                    changes.push({
                        type: 'step_reordered',
                        wf_item,
                        severity: this.severityLevels.LOW,
                        details: {
                            from_order: oldStep.order,
                            to_order: newStep.order,
                            title: newStep.title
                        }
                    });
                }

                // Check if step was modified
                if (oldStep.step_hash !== newStep.step_hash) {
                    const stepChanges = this.compareStepDetails(oldStep, newStep);
                    if (stepChanges) {
                        changes.push({
                            type: 'step_modified',
                            wf_item,
                            severity: this.calculateStepChangeSeverity(stepChanges),
                            details: stepChanges
                        });
                    }
                }
            }
        }

        return changes;
    }

    compareStepDetails(oldStep, newStep) {
        const changes = {};

        // Compare basic fields
        if (oldStep.title !== newStep.title) {
            changes.title = { from: oldStep.title, to: newStep.title };
        }

        if (oldStep.action !== newStep.action) {
            changes.action = { from: oldStep.action, to: newStep.action };
        }

        if (oldStep.thing_type !== newStep.thing_type) {
            changes.thing_type = { from: oldStep.thing_type, to: newStep.thing_type };
        }

        // Compare condition
        const conditionChange = this.compareConditions(oldStep.condition, newStep.condition);
        if (conditionChange) {
            changes.condition = conditionChange;
        }

        // Compare parameters
        const paramChanges = this.compareParameterLists(
            oldStep.parameters || [],
            newStep.parameters || []
        );
        if (paramChanges) {
            changes.parameters = paramChanges;
        }

        // Compare call details (if workflow call)
        if (oldStep.call || newStep.call) {
            const callChanges = this.compareCallDetails(oldStep.call, newStep.call);
            if (callChanges) {
                changes.call = callChanges;
            }
        }

        return Object.keys(changes).length > 0 ? changes : null;
    }

    compareConditions(oldCondition, newCondition) {
        // Handle null conditions
        if (!oldCondition && !newCondition) return null;
        if (!oldCondition || !newCondition) {
            return {
                from: oldCondition?.raw || oldCondition || null,
                to: newCondition?.raw || newCondition || null
            };
        }

        // Compare condition objects
        const oldRaw = oldCondition.raw || oldCondition;
        const newRaw = newCondition.raw || newCondition;

        if (oldRaw !== newRaw) {
            return {
                from: oldRaw,
                to: newRaw,
                variables_changed: this.compareArrays(
                    oldCondition.variables || [],
                    newCondition.variables || []
                )
            };
        }

        return null;
    }

    compareCallDetails(oldCall, newCall) {
        if (!oldCall && !newCall) return null;
        if (!oldCall || !newCall) {
            return { added: !oldCall, removed: !newCall };
        }

        const changes = {};

        // Compare target
        if (oldCall.target?.workflow_id !== newCall.target?.workflow_id) {
            changes.target_workflow = {
                from: oldCall.target?.workflow_id,
                to: newCall.target?.workflow_id
            };
        }

        if (oldCall.target?.mode !== newCall.target?.mode) {
            changes.mode = {
                from: oldCall.target?.mode,
                to: newCall.target?.mode
            };
        }

        // Compare mapping
        const mappingChanges = this.compareMappings(oldCall.mapping || [], newCall.mapping || []);
        if (mappingChanges) {
            changes.mapping = mappingChanges;
        }

        return Object.keys(changes).length > 0 ? changes : null;
    }

    compareMappings(oldMappings, newMappings) {
        const oldMap = new Map(oldMappings.map(m => [m.to, m]));
        const newMap = new Map(newMappings.map(m => [m.to, m]));

        const changes = [];

        // Find mapping changes
        for (const [to, newMapping] of newMap) {
            const oldMapping = oldMap.get(to);
            if (!oldMapping) {
                changes.push({
                    type: 'mapping_added',
                    param: to,
                    from: newMapping.from
                });
            } else if (JSON.stringify(oldMapping.from) !== JSON.stringify(newMapping.from)) {
                changes.push({
                    type: 'mapping_changed',
                    param: to,
                    from_value: oldMapping.from,
                    to_value: newMapping.from
                });
            }
        }

        // Find removed mappings
        for (const [to, oldMapping] of oldMap) {
            if (!newMap.has(to)) {
                changes.push({
                    type: 'mapping_removed',
                    param: to
                });
            }
        }

        return changes.length > 0 ? changes : null;
    }

    calculateStepChangeSeverity(changes) {
        // Determine severity based on types of changes
        if (changes.action || changes.call?.target_workflow) {
            return this.severityLevels.HIGH;
        }

        if (changes.condition || changes.parameters) {
            return this.severityLevels.MEDIUM;
        }

        return this.severityLevels.LOW;
    }

    compareArrays(oldArray, newArray) {
        const added = newArray.filter(item => !oldArray.includes(item));
        const removed = oldArray.filter(item => !newArray.includes(item));

        if (added.length === 0 && removed.length === 0) return null;

        return { added, removed };
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    createWorkflowAddedChange(workflow) {
        return {
            type: 'workflow_added',
            workflow_id: workflow.workflow_id,
            wf_item: workflow.wf_item,
            severity: this.severityLevels.HIGH,
            details: {
                name: workflow.name,
                steps_count: workflow.steps?.length || 0
            }
        };
    }

    createWorkflowRemovedChange(workflow) {
        return {
            type: 'workflow_removed',
            workflow_id: workflow.workflow_id,
            wf_item: workflow.wf_item,
            severity: this.severityLevels.HIGH,
            details: {
                name: workflow.name,
                steps_count: workflow.steps?.length || 0
            }
        };
    }

    async generateDiffReport(changes) {
        const report = {
            title: 'Workflow Changes Report',
            generated_at: new Date().toISOString(),
            period: {
                from: changes.from_snapshot,
                to: changes.to_snapshot
            },
            summary: changes.summary,
            high_severity_changes: changes.changes.filter(c => c.severity === this.severityLevels.HIGH),
            medium_severity_changes: changes.changes.filter(c => c.severity === this.severityLevels.MEDIUM),
            low_severity_changes: changes.changes.filter(c => c.severity === this.severityLevels.LOW),
            most_changed_workflows: this.getMostChangedWorkflows(changes.changes),
            change_distribution: this.getChangeDistribution(changes.changes)
        };

        return report;
    }

    getMostChangedWorkflows(changes) {
        const workflowChangeCounts = {};

        changes.forEach(change => {
            const workflowId = change.workflow_id || change.workflow_wf_item;
            if (workflowId) {
                workflowChangeCounts[workflowId] = (workflowChangeCounts[workflowId] || 0) + 1;
            }
        });

        return Object.entries(workflowChangeCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([workflow_id, count]) => ({ workflow_id, change_count: count }));
    }

    getChangeDistribution(changes) {
        const distribution = {};

        changes.forEach(change => {
            distribution[change.type] = (distribution[change.type] || 0) + 1;
        });

        return distribution;
    }

    async saveDiffReport(report, outputPath) {
        const reportJson = JSON.stringify(report, null, 2);
        await fs.writeFile(outputPath, reportJson);

        // Also generate markdown report
        const markdownReport = this.generateMarkdownReport(report);
        const mdPath = outputPath.replace('.json', '.md');
        await fs.writeFile(mdPath, markdownReport);

        return { json: outputPath, markdown: mdPath };
    }

    generateMarkdownReport(report) {
        let md = `# ${report.title}\n\n`;
        md += `**Generated:** ${report.generated_at}\n\n`;
        md += `**Period:** ${report.period.from} to ${report.period.to}\n\n`;

        md += `## Summary\n\n`;
        md += `- **Workflows Added:** ${report.summary.workflows_added}\n`;
        md += `- **Workflows Removed:** ${report.summary.workflows_removed}\n`;
        md += `- **Workflows Modified:** ${report.summary.workflows_modified}\n`;
        md += `- **Steps Added:** ${report.summary.steps_added}\n`;
        md += `- **Steps Removed:** ${report.summary.steps_removed}\n`;
        md += `- **Steps Modified:** ${report.summary.steps_modified}\n`;
        md += `- **Total Changes:** ${report.summary.total_changes}\n\n`;

        if (report.high_severity_changes.length > 0) {
            md += `## High Severity Changes\n\n`;
            report.high_severity_changes.forEach(change => {
                md += `- **${change.type}** in ${change.workflow_id || change.wf_item}\n`;
            });
            md += '\n';
        }

        if (report.most_changed_workflows.length > 0) {
            md += `## Most Changed Workflows\n\n`;
            report.most_changed_workflows.forEach(w => {
                md += `- ${w.workflow_id}: ${w.change_count} changes\n`;
            });
            md += '\n';
        }

        return md;
    }
}

module.exports = DiffEngine;