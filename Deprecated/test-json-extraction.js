const WorkflowJSONCapture = require('./capture-workflows-json');

async function testExtraction() {
    console.log('🧪 Starting JSON Extraction Test...\n');

    const capture = new WorkflowJSONCapture();

    // Test with just 2 workflows for quick verification
    const testOptions = {
        maxWorkflows: 2,
        startIndex: 0
    };

    try {
        console.log('📋 Test Configuration:');
        console.log(`  - Max workflows: ${testOptions.maxWorkflows}`);
        console.log(`  - Start index: ${testOptions.startIndex}`);
        console.log('');

        const result = await capture.run(testOptions);

        console.log('\n✅ Test Completed Successfully!');
        console.log('\n📊 Test Results:');
        console.log(`  - Workflows processed: ${result.total_workflows}`);
        console.log(`  - Total steps extracted: ${result.total_steps}`);
        console.log(`  - Dependencies found: ${result.total_dependencies}`);

        if (result.workflows && result.workflows.length > 0) {
            console.log('\n📝 Sample Workflow:');
            const sample = result.workflows[0];
            console.log(`  - Name: ${sample.name}`);
            console.log(`  - WF Item: ${sample.wf_item}`);
            console.log(`  - Steps: ${sample.steps_count}`);
            console.log(`  - Hash: ${sample.hash.substring(0, 16)}...`);
        }

    } catch (error) {
        console.error('\n❌ Test Failed:', error);
        console.error('\nStack trace:', error.stack);
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    console.log('=' .repeat(60));
    console.log('  JSON EXTRACTION TEST SUITE');
    console.log('=' .repeat(60) + '\n');

    testExtraction()
        .then(() => {
            console.log('\n' + '=' .repeat(60));
            console.log('  ALL TESTS PASSED ✨');
            console.log('=' .repeat(60) + '\n');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n' + '=' .repeat(60));
            console.error('  TEST SUITE FAILED 💥');
            console.error('=' .repeat(60) + '\n');
            console.error(error);
            process.exit(1);
        });
}

module.exports = { testExtraction };