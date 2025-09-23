const crypto = require('crypto');

class HashGenerator {
    constructor() {
        this.algorithm = 'sha256';
        this.encoding = 'hex';
    }

    generateWorkflowHash(workflowData) {
        const canonicalized = this.canonicalizeWorkflow(workflowData);
        return this.hash(canonicalized);
    }

    generateStepHash(stepData) {
        const canonicalized = this.canonicalizeStep(stepData);
        return this.hash(canonicalized);
    }

    generateParameterHash(parameters) {
        const canonicalized = this.canonicalizeParameters(parameters);
        return this.hash(canonicalized);
    }

    hash(data) {
        const jsonString = JSON.stringify(data);
        return crypto
            .createHash(this.algorithm)
            .update(jsonString)
            .digest(this.encoding);
    }

    canonicalizeWorkflow(workflow) {
        // Create a deterministic representation of the workflow
        const canonical = {
            workflow_id: workflow.workflow_id,
            wf_item: workflow.wf_item,
            name: workflow.name,
            metadata: this.canonicalizeMetadata(workflow.metadata),
            interface: this.canonicalizeInterface(workflow.interface),
            steps: workflow.steps?.map(step => this.canonicalizeStep(step)) || []
        };

        // Sort steps by order to ensure consistency
        canonical.steps.sort((a, b) => a.order - b.order);

        return canonical;
    }

    canonicalizeStep(step) {
        // Create a deterministic representation of a step
        const canonical = {
            wf_item: step.wf_item,
            order: step.order,
            title: step.title?.trim() || '',
            action: step.action || '',
            thing_type: step.thing_type || null,
            condition: this.canonicalizeCondition(step.condition),
            parameters: this.canonicalizeParameters(step.parameters),
            call: step.call ? this.canonicalizeCall(step.call) : null
        };

        // Remove null/undefined values
        Object.keys(canonical).forEach(key => {
            if (canonical[key] === null || canonical[key] === undefined) {
                delete canonical[key];
            }
        });

        return canonical;
    }

    canonicalizeMetadata(metadata) {
        if (!metadata) return {};

        const canonical = {
            endpoint: metadata.endpoint?.trim() || null,
            trigger_type: metadata.trigger?.type || null,
            trigger_method: metadata.trigger?.method || null,
            response_type: metadata.response_type || null,
            timezone: metadata.timezone || 'US/Eastern',
            exposed_as_api: !!metadata.exposed_as_api,
            requires_authentication: metadata.requires_authentication !== false
        };

        // Sort settings if they exist
        if (metadata.settings) {
            canonical.settings = this.sortObject(metadata.settings);
        }

        return canonical;
    }

    canonicalizeInterface(interface_) {
        if (!interface_) return { inputs: [], outputs: [] };

        return {
            inputs: this.canonicalizeParameterList(interface_.inputs || []),
            outputs: this.canonicalizeParameterList(interface_.outputs || [])
        };
    }

    canonicalizeParameterList(parameters) {
        if (!Array.isArray(parameters)) return [];

        return parameters
            .map(param => ({
                key: param.key || param.name || '',
                type: param.type || 'text',
                required: !param.optional,
                is_list: !!param.is_list,
                default: param.default_value || null
            }))
            .sort((a, b) => a.key.localeCompare(b.key));
    }

    canonicalizeParameters(parameters) {
        if (!parameters) return [];

        if (Array.isArray(parameters)) {
            return parameters
                .map(param => {
                    if (typeof param === 'object') {
                        const canonical = {
                            key: param.key || param.name || param.target_param || '',
                            type: param.type || 'text',
                            value: param.value || param.source_value || null,
                            optional: param.optional !== false,
                            is_list: !!param.is_list
                        };

                        // Remove null values
                        Object.keys(canonical).forEach(key => {
                            if (canonical[key] === null) delete canonical[key];
                        });

                        return canonical;
                    }
                    return param;
                })
                .sort((a, b) => {
                    const keyA = typeof a === 'object' ? a.key : String(a);
                    const keyB = typeof b === 'object' ? b.key : String(b);
                    return keyA.localeCompare(keyB);
                });
        }

        return [];
    }

    canonicalizeCondition(condition) {
        if (!condition) return null;

        if (typeof condition === 'string') {
            return condition.trim().toLowerCase();
        }

        if (typeof condition === 'object') {
            return {
                raw: condition.raw?.trim() || '',
                normalized: condition.normalized || null,
                variables: Array.isArray(condition.variables) ?
                    [...condition.variables].sort() : [],
                operators: Array.isArray(condition.operators) ?
                    [...condition.operators].sort() : []
            };
        }

        return null;
    }

    canonicalizeCall(call) {
        if (!call) return null;

        const canonical = {
            target: {
                workflow_id: call.target?.workflow_id || null,
                wf_item: call.target?.wf_item || null,
                mode: call.target?.mode || 'async'
            },
            mapping: this.canonicalizeMapping(call.mapping)
        };

        if (call.on_result) {
            canonical.on_result = {
                capture_as: call.on_result.capture_as || null,
                error_policy: call.on_result.error_policy || 'propagate'
            };
        }

        return canonical;
    }

    canonicalizeMapping(mapping) {
        if (!Array.isArray(mapping)) return [];

        return mapping
            .map(map => ({
                to: map.to || '',
                from: this.canonicalizeSource(map.from)
            }))
            .sort((a, b) => a.to.localeCompare(b.to));
    }

    canonicalizeSource(source) {
        if (!source) return { literal: null };

        if (typeof source === 'string') {
            return { expr: source };
        }

        if (typeof source === 'object') {
            // Return only the relevant source type
            if (source.literal !== undefined) return { literal: source.literal };
            if (source.expr !== undefined) return { expr: source.expr };
            if (source.var !== undefined) return { var: source.var };
        }

        return { literal: null };
    }

    sortObject(obj) {
        if (!obj || typeof obj !== 'object') return obj;

        const sorted = {};
        Object.keys(obj)
            .sort()
            .forEach(key => {
                sorted[key] = obj[key];
            });

        return sorted;
    }

    compareHashes(hash1, hash2) {
        return hash1 === hash2;
    }

    generateDiffHash(diff) {
        // Generate a hash for a diff object to track changes
        const canonicalDiff = {
            type: diff.type,
            workflow_id: diff.workflow_id,
            wf_item: diff.wf_item || null,
            changes: diff.changes || []
        };

        return this.hash(canonicalDiff);
    }

    generateSnapshotHash(snapshots) {
        // Generate a hash for a collection of workflow snapshots
        if (!Array.isArray(snapshots)) {
            snapshots = [snapshots];
        }

        const canonicalSnapshots = snapshots
            .map(s => ({
                workflow_id: s.workflow_id,
                wf_item: s.wf_item,
                hash: s.hash
            }))
            .sort((a, b) => a.workflow_id.localeCompare(b.workflow_id));

        return this.hash(canonicalSnapshots);
    }

    validateHash(data, expectedHash) {
        const actualHash = typeof data === 'string' ? data : this.generateWorkflowHash(data);
        return actualHash === expectedHash;
    }

    generateMerkleRoot(hashes) {
        // Generate a Merkle root from a list of hashes
        if (!Array.isArray(hashes) || hashes.length === 0) {
            return this.hash('');
        }

        if (hashes.length === 1) {
            return hashes[0];
        }

        // Sort hashes to ensure consistency
        const sortedHashes = [...hashes].sort();

        // Build tree level by level
        let currentLevel = sortedHashes;

        while (currentLevel.length > 1) {
            const nextLevel = [];

            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = currentLevel[i + 1] || left; // Duplicate last if odd number

                const combined = left + right;
                const parentHash = crypto
                    .createHash(this.algorithm)
                    .update(combined)
                    .digest(this.encoding);

                nextLevel.push(parentHash);
            }

            currentLevel = nextLevel;
        }

        return currentLevel[0];
    }
}

module.exports = HashGenerator;