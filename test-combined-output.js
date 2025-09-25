const fs = require('fs').promises;
const path = require('path');

/**
 * Test script to verify the ALL_WORKFLOWS_COMBINED.json functionality
 * This simulates what happens after extraction by checking if the combination works
 */

async function testCombinedOutput() {
    console.log('🧪 Testing Combined Workflow Output...\n');

    try {
        // Find the most recent run directory
        const dropdownDir = path.join(__dirname, 'extracted-workflows-dropdown');
        const dirs = await fs.readdir(dropdownDir);
        const runDirs = dirs.filter(d => d.startsWith('run-')).sort().reverse();

        if (runDirs.length === 0) {
            console.log('❌ No extraction runs found. Please run extraction first.');
            return;
        }

        const latestRun = runDirs[0];
        const runPath = path.join(dropdownDir, latestRun);
        console.log(`📁 Checking latest run: ${latestRun}\n`);

        // Check if ALL_WORKFLOWS_COMBINED.json exists
        const combinedPath = path.join(runPath, 'ALL_WORKFLOWS_COMBINED.json');
        const combinedExists = await fs.access(combinedPath).then(() => true).catch(() => false);

        if (!combinedExists) {
            console.log('❌ ALL_WORKFLOWS_COMBINED.json not found');
            console.log('   This might be from a run before the combination feature was added.\n');

            // Count individual workflow files
            const files = await fs.readdir(runPath);
            const workflowFiles = files.filter(f =>
                f.endsWith('.json') &&
                !['combined-workflows-dropdown.json', 'dropdown-structure.json', 'RUN_SUMMARY.json'].includes(f)
            );

            console.log(`📊 Found ${workflowFiles.length} individual workflow files`);
            console.log('💡 Run the extraction again to generate ALL_WORKFLOWS_COMBINED.json');
            return;
        }

        // Read and analyze the combined file
        console.log('✅ ALL_WORKFLOWS_COMBINED.json found!\n');
        const combinedData = JSON.parse(await fs.readFile(combinedPath, 'utf8'));

        // Display metadata
        console.log('📋 Extraction Metadata:');
        console.log(`   Run Timestamp: ${combinedData.extraction_metadata.run_timestamp}`);
        console.log(`   Combined At: ${combinedData.extraction_metadata.combined_at}`);
        console.log(`   Total Workflows: ${combinedData.extraction_metadata.total_workflows}`);
        console.log(`   Total Steps: ${combinedData.extraction_metadata.total_steps}`);
        console.log(`   Source Directory: ${combinedData.extraction_metadata.source_directory}\n`);

        // Display first few workflows
        console.log('📚 Sample Workflows (first 5):');
        const sampleWorkflows = combinedData.workflows.slice(0, 5);
        sampleWorkflows.forEach((wf, i) => {
            console.log(`   ${i + 1}. ${wf.workflow_name}`);
            console.log(`      - WF Item: ${wf.wf_item}`);
            console.log(`      - Steps: ${wf.steps?.length || 0}`);
            if (wf.hash) console.log(`      - Hash: ${wf.hash}`);
        });

        // File size analysis
        const stats = await fs.stat(combinedPath);
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`\n📊 File Statistics:`);
        console.log(`   File Size: ${fileSizeMB} MB`);
        console.log(`   Average size per workflow: ${(stats.size / combinedData.extraction_metadata.total_workflows / 1024).toFixed(2)} KB`);

        // Verify data integrity
        console.log('\n🔍 Data Integrity Check:');
        let hasAllRequiredFields = true;
        let missingFieldsCount = 0;

        combinedData.workflows.forEach(wf => {
            if (!wf.workflow_name || !wf.wf_item || !wf.steps) {
                missingFieldsCount++;
                hasAllRequiredFields = false;
            }
        });

        if (hasAllRequiredFields) {
            console.log('   ✅ All workflows have required fields');
        } else {
            console.log(`   ⚠️ ${missingFieldsCount} workflows missing required fields`);
        }

        // Compare with individual files count
        const files = await fs.readdir(runPath);
        const individualWorkflowFiles = files.filter(f =>
            f.endsWith('.json') &&
            !['combined-workflows-dropdown.json', 'dropdown-structure.json',
              'RUN_SUMMARY.json', 'ALL_WORKFLOWS_COMBINED.json'].includes(f)
        );

        console.log(`\n📈 File Counts:`);
        console.log(`   Individual workflow files: ${individualWorkflowFiles.length}`);
        console.log(`   Workflows in combined file: ${combinedData.workflows.length}`);

        if (individualWorkflowFiles.length === combinedData.workflows.length) {
            console.log('   ✅ Count matches!');
        } else {
            console.log(`   ⚠️ Count mismatch (difference: ${Math.abs(individualWorkflowFiles.length - combinedData.workflows.length)})`);
        }

        console.log('\n✨ Test complete! The combination feature is working correctly.');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
testCombinedOutput().catch(console.error);