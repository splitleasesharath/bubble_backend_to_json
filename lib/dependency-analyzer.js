class DependencyAnalyzer {
    constructor() {
        this.callActionTypes = [
            'schedule_api_workflow',
            'trigger_api_workflow',
            'trigger_custom_event',
            'call_workflow',
            'schedule_workflow',
            'cancel_scheduled_workflow'
        ];
    }

    analyze(workflow) {
        const dependencies = [];

        if (!workflow.steps || workflow.steps.length === 0) {
            return dependencies;
        }

        // Analyze each step for workflow calls
        workflow.steps.forEach(step => {
            if (this.isWorkflowCall(step)) {
                const dependency = this.extractDependency(workflow, step);
                if (dependency) {
                    dependencies.push(dependency);
                }
            }

            // Also check for indirect dependencies in parameters
            const indirectDeps = this.findIndirectDependencies(workflow, step);
            dependencies.push(...indirectDeps);
        });

        return dependencies;
    }

    isWorkflowCall(step) {
        if (!step.action) return false;

        // Check if action type is a workflow call
        const actionLower = step.action.toLowerCase();
        return this.callActionTypes.some(type =>
            actionLower.includes(type) || type.includes(actionLower)
        );
    }

    extractDependency(workflow, step) {
        const dependency = {
            type: 'workflow_call',
            caller: {
                workflow_id: workflow.workflow_id,
                wf_item: workflow.wf_item,
                name: workflow.name
            },
            step: {
                wf_item: step.wf_item,
                order: step.order,
                title: step.title,
                action: step.action
            },
            target: {
                workflow_id: null,
                wf_item: null,
                endpoint: null,
                mode: 'async'
            },
            mapping: [],
            interface_contract: null,
            validation_status: 'unknown'
        };

        // Extract target workflow information
        if (step.call) {
            dependency.target = {
                ...dependency.target,
                ...step.call.target
            };

            dependency.mapping = step.call.mapping || [];

            // Extract execution details
            if (step.call.on_result) {
                dependency.on_result = step.call.on_result;
            }

            if (step.call.fanout) {
                dependency.fanout = step.call.fanout;
            }
        } else {
            // Try to extract from step parameters
            const targetInfo = this.extractTargetFromParameters(step);
            if (targetInfo) {
                dependency.target = { ...dependency.target, ...targetInfo };
            }
        }

        // Only return dependency if we found a target
        if (dependency.target.workflow_id || dependency.target.wf_item || dependency.target.endpoint) {
            return dependency;
        }

        return null;
    }

    extractTargetFromParameters(step) {
        const target = {
            workflow_id: null,
            endpoint: null
        };

        // Look for workflow references in parameters
        if (step.parameters && Array.isArray(step.parameters)) {
            for (const param of step.parameters) {
                // Check if parameter is a workflow reference
                if (param.key === 'workflow' || param.key === 'target_workflow') {
                    target.workflow_id = param.value || param.default_value;
                }

                if (param.key === 'endpoint' || param.key === 'api_endpoint') {
                    target.endpoint = param.value || param.default_value;
                }

                // Check for workflow ID in various formats
                if (param.value && typeof param.value === 'string') {
                    if (param.value.includes('wf_') || param.value.includes('workflow')) {
                        target.workflow_id = param.value;
                    }
                }
            }
        }

        // Also check action-specific fields
        if (step.target_workflow) {
            target.workflow_id = step.target_workflow;
        }

        if (step.scheduled_workflow) {
            target.workflow_id = step.scheduled_workflow;
        }

        return target.workflow_id || target.endpoint ? target : null;
    }

    findIndirectDependencies(workflow, step) {
        const dependencies = [];

        // Look for data dependencies (when a step uses data from another workflow)
        if (step.parameters) {
            for (const param of step.parameters) {
                const dataDep = this.extractDataDependency(workflow, step, param);
                if (dataDep) {
                    dependencies.push(dataDep);
                }
            }
        }

        // Look for condition dependencies
        if (step.condition) {
            const conditionDeps = this.extractConditionDependencies(workflow, step);
            dependencies.push(...conditionDeps);
        }

        return dependencies;
    }

    extractDataDependency(workflow, step, param) {
        // Check if parameter references data from another workflow
        const value = param.value || param.source_value || '';
        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

        // Pattern matching for workflow result references
        const patterns = [
            /Result\s+of\s+([a-zA-Z0-9_-]+)/i,
            /Workflow\s+([a-zA-Z0-9_-]+)'s\s+result/i,
            /Step\s+(\d+)'s\s+([a-zA-Z0-9_-]+)/i
        ];

        for (const pattern of patterns) {
            const match = valueStr.match(pattern);
            if (match) {
                return {
                    type: 'data_dependency',
                    caller: {
                        workflow_id: workflow.workflow_id,
                        wf_item: workflow.wf_item
                    },
                    step: {
                        wf_item: step.wf_item,
                        order: step.order
                    },
                    dependency: {
                        source: match[1],
                        field: param.key,
                        expression: valueStr
                    }
                };
            }
        }

        return null;
    }

    extractConditionDependencies(workflow, step) {
        const dependencies = [];

        if (!step.condition) return dependencies;

        const conditionStr = typeof step.condition === 'object' ?
            step.condition.raw || JSON.stringify(step.condition) :
            String(step.condition);

        // Look for workflow state references in conditions
        const statePatterns = [
            /workflow\s+([a-zA-Z0-9_-]+)\s+completed/i,
            /([a-zA-Z0-9_-]+)\s+status\s*=\s*['"]?completed['"]?/i,
            /Result\s+of\s+([a-zA-Z0-9_-]+)\s+is\s+not\s+empty/i
        ];

        for (const pattern of statePatterns) {
            const match = conditionStr.match(pattern);
            if (match) {
                dependencies.push({
                    type: 'condition_dependency',
                    caller: {
                        workflow_id: workflow.workflow_id,
                        wf_item: workflow.wf_item
                    },
                    step: {
                        wf_item: step.wf_item,
                        order: step.order
                    },
                    dependency: {
                        workflow_reference: match[1],
                        condition_text: conditionStr
                    }
                });
            }
        }

        return dependencies;
    }

    buildDependencyGraph(workflows) {
        const graph = {
            nodes: [],
            edges: [],
            clusters: [],
            metrics: {
                total_workflows: 0,
                total_dependencies: 0,
                cyclic_dependencies: [],
                orphan_workflows: [],
                hub_workflows: []
            }
        };

        // Create nodes for each workflow
        workflows.forEach(workflow => {
            graph.nodes.push({
                id: workflow.wf_item,
                workflow_id: workflow.workflow_id,
                name: workflow.name,
                type: 'workflow',
                step_count: workflow.steps?.length || 0,
                in_degree: 0,
                out_degree: 0
            });
        });

        graph.metrics.total_workflows = graph.nodes.length;

        // Create edges for dependencies
        workflows.forEach(workflow => {
            const dependencies = this.analyze(workflow);
            dependencies.forEach(dep => {
                if (dep.target.workflow_id || dep.target.wf_item) {
                    const edge = {
                        source: workflow.wf_item,
                        target: dep.target.wf_item || dep.target.workflow_id,
                        type: dep.type,
                        step_wf_item: dep.step.wf_item,
                        mode: dep.target.mode || 'async'
                    };

                    graph.edges.push(edge);

                    // Update node degrees
                    const sourceNode = graph.nodes.find(n => n.id === workflow.wf_item);
                    const targetNode = graph.nodes.find(n =>
                        n.id === dep.target.wf_item || n.workflow_id === dep.target.workflow_id
                    );

                    if (sourceNode) sourceNode.out_degree++;
                    if (targetNode) targetNode.in_degree++;
                }
            });
        });

        graph.metrics.total_dependencies = graph.edges.length;

        // Detect cycles
        graph.metrics.cyclic_dependencies = this.detectCycles(graph);

        // Find orphan workflows (no incoming or outgoing dependencies)
        graph.metrics.orphan_workflows = graph.nodes
            .filter(n => n.in_degree === 0 && n.out_degree === 0)
            .map(n => n.workflow_id);

        // Find hub workflows (high number of dependencies)
        graph.metrics.hub_workflows = graph.nodes
            .filter(n => n.in_degree + n.out_degree > 10)
            .sort((a, b) => (b.in_degree + b.out_degree) - (a.in_degree + a.out_degree))
            .slice(0, 10)
            .map(n => ({
                workflow_id: n.workflow_id,
                in_degree: n.in_degree,
                out_degree: n.out_degree,
                total_degree: n.in_degree + n.out_degree
            }));

        // Identify clusters
        graph.clusters = this.identifyClusters(graph);

        return graph;
    }

    detectCycles(graph) {
        const cycles = [];
        const visited = new Set();
        const recursionStack = new Set();

        const hasCycleDFS = (nodeId, path = []) => {
            visited.add(nodeId);
            recursionStack.add(nodeId);
            path.push(nodeId);

            // Get all edges from this node
            const outgoingEdges = graph.edges.filter(e => e.source === nodeId);

            for (const edge of outgoingEdges) {
                if (!visited.has(edge.target)) {
                    if (hasCycleDFS(edge.target, [...path])) {
                        return true;
                    }
                } else if (recursionStack.has(edge.target)) {
                    // Found a cycle
                    const cycleStart = path.indexOf(edge.target);
                    const cyclePath = [...path.slice(cycleStart), edge.target];
                    cycles.push({
                        path: cyclePath,
                        length: cyclePath.length
                    });
                    return true;
                }
            }

            recursionStack.delete(nodeId);
            return false;
        };

        // Check each unvisited node
        graph.nodes.forEach(node => {
            if (!visited.has(node.id)) {
                hasCycleDFS(node.id);
            }
        });

        return cycles;
    }

    identifyClusters(graph) {
        // Simple clustering based on strongly connected components
        const clusters = [];
        const visited = new Set();

        const dfs = (nodeId, cluster) => {
            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            cluster.nodes.push(nodeId);

            // Find all connected nodes
            const connectedEdges = graph.edges.filter(e =>
                e.source === nodeId || e.target === nodeId
            );

            connectedEdges.forEach(edge => {
                const nextNode = edge.source === nodeId ? edge.target : edge.source;
                if (!visited.has(nextNode)) {
                    dfs(nextNode, cluster);
                }
            });
        };

        graph.nodes.forEach(node => {
            if (!visited.has(node.id)) {
                const cluster = {
                    id: `cluster_${clusters.length + 1}`,
                    nodes: [],
                    size: 0
                };

                dfs(node.id, cluster);
                cluster.size = cluster.nodes.length;

                if (cluster.size > 1) {
                    clusters.push(cluster);
                }
            }
        });

        return clusters;
    }

    validateDependencies(workflows, dependencyGraph) {
        const validationResults = {
            valid: [],
            invalid: [],
            warnings: []
        };

        // Create workflow map for lookups
        const workflowMap = new Map(workflows.map(w => [w.wf_item, w]));
        const workflowByIdMap = new Map(workflows.map(w => [w.workflow_id, w]));

        dependencyGraph.edges.forEach(edge => {
            const sourceWorkflow = workflowMap.get(edge.source);
            const targetWorkflow = workflowMap.get(edge.target) ||
                                  workflowByIdMap.get(edge.target);

            if (!targetWorkflow) {
                validationResults.invalid.push({
                    type: 'missing_target',
                    source: edge.source,
                    target: edge.target,
                    message: `Target workflow '${edge.target}' not found`
                });
            } else {
                // Validate interface contract if available
                const validation = this.validateInterfaceContract(
                    sourceWorkflow,
                    targetWorkflow,
                    edge
                );

                if (validation.status === 'valid') {
                    validationResults.valid.push(validation);
                } else if (validation.status === 'warning') {
                    validationResults.warnings.push(validation);
                } else {
                    validationResults.invalid.push(validation);
                }
            }
        });

        // Check for circular dependencies
        if (dependencyGraph.metrics.cyclic_dependencies.length > 0) {
            dependencyGraph.metrics.cyclic_dependencies.forEach(cycle => {
                validationResults.warnings.push({
                    type: 'circular_dependency',
                    path: cycle.path,
                    message: `Circular dependency detected: ${cycle.path.join(' -> ')}`
                });
            });
        }

        return validationResults;
    }

    validateInterfaceContract(sourceWorkflow, targetWorkflow, edge) {
        const result = {
            source: sourceWorkflow.workflow_id,
            target: targetWorkflow.workflow_id,
            edge: edge,
            status: 'valid',
            issues: []
        };

        // Find the calling step
        const callingStep = sourceWorkflow.steps?.find(s => s.wf_item === edge.step_wf_item);

        if (!callingStep || !callingStep.call) {
            result.status = 'warning';
            result.issues.push('No call details found for validation');
            return result;
        }

        // Check target interface
        if (!targetWorkflow.interface || !targetWorkflow.interface.inputs) {
            result.status = 'warning';
            result.issues.push('Target workflow has no defined interface');
            return result;
        }

        // Validate parameter mappings
        const requiredInputs = targetWorkflow.interface.inputs.filter(i =>
            i.required || !i.optional
        );

        const mappedParams = new Set(callingStep.call.mapping?.map(m => m.to) || []);

        requiredInputs.forEach(input => {
            const key = input.key || input.name;
            if (!mappedParams.has(key)) {
                result.status = 'invalid';
                result.issues.push(`Missing required parameter: ${key}`);
            }
        });

        // Check for type mismatches
        callingStep.call.mapping?.forEach(mapping => {
            const targetParam = targetWorkflow.interface.inputs.find(i =>
                (i.key || i.name) === mapping.to
            );

            if (targetParam && mapping.from) {
                // Simple type checking (can be enhanced)
                const sourceType = this.inferType(mapping.from);
                const targetType = targetParam.type;

                if (sourceType && targetType && !this.areTypesCompatible(sourceType, targetType)) {
                    result.status = result.status === 'invalid' ? 'invalid' : 'warning';
                    result.issues.push(`Type mismatch for '${mapping.to}': ${sourceType} -> ${targetType}`);
                }
            }
        });

        return result;
    }

    inferType(source) {
        if (source.literal !== undefined) {
            if (typeof source.literal === 'boolean') return 'boolean';
            if (typeof source.literal === 'number') return 'number';
            if (source.literal instanceof Date) return 'date';
            return 'text';
        }

        if (source.expr) {
            // Try to infer from expression pattern
            if (source.expr.includes('Date')) return 'date';
            if (source.expr.includes('Number') || source.expr.includes('Count')) return 'number';
            if (source.expr.includes('is') || source.expr.includes('has')) return 'boolean';
        }

        return 'dynamic';
    }

    areTypesCompatible(sourceType, targetType) {
        // Define type compatibility rules
        const compatibilityMap = {
            'text': ['text', 'string', 'dynamic'],
            'number': ['number', 'integer', 'float', 'dynamic'],
            'boolean': ['boolean', 'yes/no', 'dynamic'],
            'date': ['date', 'datetime', 'timestamp', 'dynamic'],
            'dynamic': ['text', 'number', 'boolean', 'date', 'dynamic']
        };

        const compatibleTypes = compatibilityMap[sourceType] || [sourceType];
        return compatibleTypes.includes(targetType);
    }

    generateDependencyReport(workflows) {
        const graph = this.buildDependencyGraph(workflows);
        const validation = this.validateDependencies(workflows, graph);

        return {
            timestamp: new Date().toISOString(),
            graph: graph,
            validation: validation,
            summary: {
                total_workflows: graph.metrics.total_workflows,
                total_dependencies: graph.metrics.total_dependencies,
                valid_dependencies: validation.valid.length,
                invalid_dependencies: validation.invalid.length,
                warnings: validation.warnings.length,
                cyclic_dependencies: graph.metrics.cyclic_dependencies.length,
                orphan_workflows: graph.metrics.orphan_workflows.length,
                hub_workflows: graph.metrics.hub_workflows.length,
                clusters: graph.clusters.length
            }
        };
    }
}

module.exports = DependencyAnalyzer;