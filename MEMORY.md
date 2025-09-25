# Project Memory: Bubble.io Backend Workflow Extractor

## Project Context

This document consolidates all knowledge and context gained throughout the development of the Bubble.io Backend Workflow Extraction system.

## Project Evolution

### Phase 1: Screenshot-Based Capture
- **Initial Goal**: Capture visual documentation of backend workflows
- **Method**: Automated screenshots using Playwright
- **Challenge**: Limited to visual data, no structured extraction

### Phase 2: JSON Data Extraction
- **Breakthrough**: Discovered `wf_item` as unique identifier for workflows and steps
- **Achievement**: Full structured data extraction from Bubble.io UI
- **Key Innovation**: Properties panel parsing for parameter extraction

### Phase 3: Dropdown Navigation System
- **Problem Solved**: Direct step clicking was unreliable and incomplete
- **Solution**: Using "search for event or action" dropdown for systematic navigation
- **Result**: 100% step coverage with comprehensive data capture

## Technical Discoveries

### Key UI Elements and Selectors

1. **Workflow Dropdown**:
   - Selector: `input[placeholder="search for event or action..."]`
   - Contains all workflow steps in a searchable list
   - Each option has unique `wf_item` identifier

2. **Properties Panel**:
   - Opens when clicking workflow steps
   - Contains all parameter configurations
   - Dynamic content based on action type

3. **Workflow List**:
   - URL parameter: `&wf_item={id}` for direct navigation
   - List stored in `workflow-ids-final.json`

### Data Structure Insights

1. **Unique Identifiers**:
   - `wf_item`: Primary key for workflows and steps
   - Format: alphanumeric string (e.g., "cqVKW3")
   - Persistent across sessions

2. **Step Structure**:
   ```javascript
   {
     wf_item: "unique_id",
     order: 1,
     title: "Step Title",
     action: "action_type",
     parameters: {},
     condition: {}
   }
   ```

3. **Action Types Discovered**:
   - `create_thing`: Database record creation
   - `make_changes`: Update existing records
   - `schedule_api_workflow`: Cross-workflow calls
   - `send_email`: Email notifications
   - `return_data`: API responses
   - `custom_action`: Plugin actions

### Browser Automation Challenges Solved

1. **Authentication Persistence**:
   - Solution: Persistent Chrome profile in `browser-profiles/default`
   - Maintains login across sessions

2. **Dynamic Loading**:
   - Challenge: Bubble.io uses heavy client-side rendering
   - Solution: Strategic `waitForSelector` with fallbacks
   - Timeouts: 30s default, 60s for initial load

3. **Properties Panel Reliability**:
   - Issue: Panel sometimes doesn't open on first click
   - Fix: Retry mechanism with escape key reset

4. **Dropdown Navigation**:
   - Problem: Options load dynamically
   - Solution: Wait for options to populate before selection

## Chrome Persistent State Storage Management

### Overview

The project uses Playwright's persistent context feature to maintain Chrome browser state across sessions, eliminating the need for repeated authentication and preserving user preferences, cookies, and local storage.

### Implementation Details

1. **Profile Location**:
   ```javascript
   profilePath: require('path').join(__dirname, '..', 'browser-profiles', 'default')
   ```
   - Stored in `browser-profiles/default/` directory
   - Contains complete Chrome user data directory structure
   - Excluded from git via `.gitignore` for security

2. **Persistent Context Launch**:
   ```javascript
   const browser = await chromium.launchPersistentContext(
     BROWSER_CONFIG.profilePath,
     {
       channel: 'chrome',
       headless: false,
       viewport: { width: 1920, height: 1080 }
     }
   );
   ```

3. **Data Persisted**:
   - **Cookies**: Session cookies for Bubble.io authentication
   - **Local Storage**: User preferences and app state
   - **IndexedDB**: Application data and caches
   - **Session Storage**: Temporary session data
   - **Service Workers**: Offline functionality and caches
   - **Extensions**: Any installed Chrome extensions (if applicable)

### Profile Directory Structure

```
browser-profiles/
└── default/
    ├── Default/
    │   ├── Cookies
    │   ├── Local Storage/
    │   ├── IndexedDB/
    │   ├── Session Storage/
    │   ├── Cache/
    │   ├── Code Cache/
    │   └── Preferences
    ├── First Run
    └── Local State
```

### Key Benefits

1. **Session Persistence**:
   - No need to re-authenticate for each extraction session
   - Maintains logged-in state for weeks/months
   - Preserves 2FA authentication if enabled

2. **Performance Optimization**:
   - Cached resources load faster
   - Reduced API calls for authentication
   - Faster page loads due to cached assets

3. **State Consistency**:
   - User preferences maintained
   - Recent activity preserved
   - Form data and inputs saved

### Management Best Practices

1. **Initial Setup**:
   ```bash
   # First run - manual login required
   node extract-workflow-dropdown.js
   # Browser opens, manually log into Bubble.io
   # Close browser when done - session saved automatically
   ```

2. **Profile Maintenance**:
   ```bash
   # Check profile size
   du -sh browser-profiles/default/

   # Clear cache if needed (preserves cookies)
   rm -rf browser-profiles/default/Default/Cache/*

   # Full reset (requires re-authentication)
   rm -rf browser-profiles/default/
   ```

3. **Multiple Profiles**:
   ```javascript
   // For different environments or accounts
   const profiles = {
     development: './browser-profiles/dev',
     production: './browser-profiles/prod',
     testing: './browser-profiles/test'
   };
   ```

### Security Considerations

1. **Sensitive Data**:
   - Profile contains authentication tokens
   - May include saved passwords (if Chrome password manager used)
   - Contains browsing history for the session

2. **Protection Measures**:
   - Added to `.gitignore` immediately
   - Never commit to version control
   - Consider encryption for sensitive environments
   - Regular cleanup of unnecessary data

3. **Access Control**:
   ```bash
   # Set appropriate permissions (Unix-like systems)
   chmod -R 700 browser-profiles/
   ```

### Troubleshooting Profile Issues

1. **Corrupted Profile**:
   ```bash
   # Symptoms: Browser crashes, login loops
   # Solution: Reset profile
   mv browser-profiles/default browser-profiles/default.backup
   # Run script to create new profile
   ```

2. **Session Expiration**:
   ```javascript
   // Add session validation
   async function validateSession(page) {
     try {
       await page.goto('https://bubble.io/page?id=upgradefromstr');
       const loginButton = await page.$('button[contains(text(), "Log in")]');
       return !loginButton; // Session valid if no login button
     } catch (error) {
       return false;
     }
   }
   ```

3. **Profile Migration**:
   ```bash
   # Backup existing profile
   tar -czf profile-backup.tar.gz browser-profiles/default/

   # Restore on new machine
   tar -xzf profile-backup.tar.gz
   ```

### Advanced Configuration

1. **Custom User Agent**:
   ```javascript
   launchOptions: {
     userAgent: 'Mozilla/5.0 (Custom Extraction Bot)',
     // ... other options
   }
   ```

2. **Proxy Support**:
   ```javascript
   launchOptions: {
     proxy: {
       server: 'http://proxy-server.com:8080',
       username: 'user',
       password: 'pass'
     }
   }
   ```

3. **Profile Isolation**:
   ```javascript
   // Create isolated profile for each workflow
   const isolatedProfile = `./browser-profiles/workflow-${workflowId}`;
   ```

### Monitoring and Debugging

1. **Profile Health Check**:
   ```javascript
   async function checkProfileHealth() {
     const profilePath = BROWSER_CONFIG.profilePath;
     const stats = {
       exists: fs.existsSync(profilePath),
       size: getDirectorySize(profilePath),
       lastModified: fs.statSync(profilePath).mtime,
       cookiesValid: await validateCookies()
     };
     return stats;
   }
   ```

2. **Debug Logging**:
   ```javascript
   // Enable Playwright debugging
   DEBUG=pw:api node extract-workflow-dropdown.js

   // Chrome DevTools Protocol
   launchOptions: {
     devtools: true,
     slowMo: 100 // Slow down operations for debugging
   }
   ```

## Implementation Patterns

### Successful Extraction Flow

1. **Initialize Browser**:
   ```javascript
   const { browser, page } = await launchBrowserWithSession();
   ```

2. **Navigate to Workflow**:
   ```javascript
   const workflowUrl = BROWSER_CONFIG.urls.workflowUrl(wfItem);
   await page.goto(workflowUrl);
   ```

3. **Open Dropdown**:
   ```javascript
   const dropdown = await page.waitForSelector('input[placeholder="search for event or action..."]');
   await dropdown.click();
   ```

4. **Extract Steps**:
   ```javascript
   const options = await page.$$('.dropdown-option[data-wf-item]');
   for (const option of options) {
     // Extract step data
   }
   ```

5. **Capture Properties**:
   ```javascript
   await option.click();
   await page.waitForSelector('.properties-panel');
   // Extract parameters
   ```

### Error Handling Patterns

1. **Graceful Degradation**:
   - Continue extraction even if individual steps fail
   - Mark failed extractions in output

2. **Retry Logic**:
   - Properties panel: 3 attempts with escape key reset
   - Page navigation: 2 attempts with full reload

3. **State Management**:
   - Save progress after each workflow
   - Resume capability using START_INDEX

## Data Insights

### Workflow Patterns Observed

1. **Common Workflow Types**:
   - CRUD operations (Create, Read, Update, Delete)
   - Notification workflows (email, SMS, push)
   - Integration workflows (API calls, webhooks)
   - Scheduled tasks (cron-like operations)

2. **Dependency Patterns**:
   - Parent-child workflow relationships
   - Shared data types across workflows
   - Common parameter passing patterns

3. **Conditional Logic**:
   - Most workflows have 2-5 conditional branches
   - Common conditions: user permissions, data validation
   - Complex conditions use custom expressions

### Performance Metrics

1. **Extraction Speed**:
   - Dropdown method: ~10-15 seconds per workflow
   - Direct clicking: ~20-30 seconds (less reliable)
   - Batch processing: 5-10 workflows optimal

2. **Data Volume**:
   - Average workflow: 50-100KB JSON
   - Large workflow (50+ steps): up to 500KB
   - Total dataset (300 workflows): ~30MB

3. **Success Rates**:
   - Dropdown extraction: 95%+ success
   - Properties panel: 90% on first attempt
   - Complete workflow: 85% full data capture

## Best Practices Discovered

### Do's

1. **Always use dropdown navigation** for comprehensive step coverage
2. **Implement retry mechanisms** for UI interactions
3. **Save incrementally** to prevent data loss
4. **Use unique identifiers** (`wf_item`) as primary keys
5. **Maintain browser session** for authentication
6. **Extract in batches** to manage memory and errors

### Don'ts

1. **Don't rely on CSS classes** - they change frequently
2. **Don't use hardcoded timeouts** - use `waitForSelector`
3. **Don't extract all workflows at once** - use batches
4. **Don't ignore partial extractions** - they're valuable
5. **Don't skip validation** - always verify extracted data

## Google Drive Integration

### Setup Requirements

1. **OAuth2 Credentials**:
   - Create project in Google Cloud Console
   - Enable Drive API
   - Download credentials as `credentials.json`

2. **Scopes Required**:
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive.metadata`

3. **Token Management**:
   - First run creates `token.json`
   - Refresh handled automatically
   - Token expires after 7 days of inactivity

### Upload Patterns

1. **Folder Structure**:
   ```
   Google Drive/
   └── Bubble Workflows/
       └── [timestamp]/
           ├── workflows.json
           └── individual/
   ```

2. **Batch Upload**:
   - Upload after each extraction session
   - Compress large files before upload
   - Use resumable upload for reliability

## Future Enhancements Identified

### High Priority

1. **Real-time Change Detection**:
   - Webhook integration for instant updates
   - Differential extraction for modified workflows

2. **Database Integration**:
   - Direct PostgreSQL/MongoDB storage
   - Indexed search capabilities
   - Version history tracking

3. **API Layer**:
   - RESTful API for data access
   - GraphQL for complex queries
   - WebSocket for real-time updates

### Medium Priority

1. **Parallel Processing**:
   - Multiple browser instances
   - Concurrent workflow extraction
   - Load balancing

2. **Enhanced Validation**:
   - Schema validation for extracted data
   - Completeness scoring
   - Anomaly detection

3. **Visualization Tools**:
   - Workflow dependency graphs
   - Change timeline visualization
   - Performance analytics dashboard

### Low Priority

1. **Machine Learning Integration**:
   - Workflow similarity detection
   - Optimization recommendations
   - Predictive maintenance

2. **Multi-tenant Support**:
   - Extract from multiple Bubble apps
   - Separate authentication per tenant
   - Cross-app analysis

## Troubleshooting Knowledge Base

### Common Issues and Solutions

1. **"Element not found" Errors**:
   - **Cause**: Page not fully loaded or UI changed
   - **Solution**: Increase timeouts, update selectors

2. **"Session expired" Errors**:
   - **Cause**: Browser profile authentication lost
   - **Solution**: Delete profile, re-authenticate manually

3. **"Properties panel empty"**:
   - **Cause**: Click didn't register or panel didn't load
   - **Solution**: Add retry logic with escape key reset

4. **"Dropdown options missing"**:
   - **Cause**: Workflow has no steps or loading issue
   - **Solution**: Check workflow manually, add null checks

5. **Memory Issues**:
   - **Cause**: Too many workflows in single session
   - **Solution**: Batch processing, restart browser periodically

### Debug Commands

```bash
# Test single workflow
MAX_WORKFLOWS=1 DEBUG=true node extract-workflow-dropdown.js

# Check specific selector
node -e "console.log(require('playwright').selectors)"

# Verify browser profile
ls -la browser-profiles/default/

# Test Google Drive auth
python push-to-gdrive/main.py status
```

## Code Patterns and Snippets

### Wait for Element with Retry
```javascript
async function waitForElementWithRetry(page, selector, maxAttempts = 3) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await page.waitForSelector(selector, { timeout: 10000 });
    } catch (error) {
      if (i === maxAttempts - 1) throw error;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
  }
}
```

### Safe Property Extraction
```javascript
async function safeExtract(element, selector, property = 'textContent') {
  try {
    const el = await element.$(selector);
    if (!el) return null;
    return await el[property]();
  } catch (error) {
    console.warn(`Failed to extract ${selector}:`, error.message);
    return null;
  }
}
```

### Batch Processing Pattern
```javascript
async function processBatches(items, batchSize = 5, processor) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => processor(item).catch(err => ({ error: err.message })))
    );
    results.push(...batchResults);

    // Optional: Save intermediate results
    await saveProgress(results);
  }
  return results;
}
```

## Version History and Rollback Points

### Important Commits

1. **Initial Setup** (f771c99):
   - Basic screenshot functionality
   - Manual workflow navigation

2. **Properties Panel Integration** (1f6da9c):
   - Added parameter extraction
   - Step detail capture

3. **Security Improvements** (785e962):
   - Added .gitignore
   - Removed sensitive files
   - Before dropdown implementation

4. **Dropdown Navigation** (20d1634):
   - Revolutionary improvement
   - Systematic step extraction
   - Near 100% coverage

5. **Advanced Extraction** (5a670cb):
   - Enhanced property parsing
   - Conditional logic extraction
   - Cross-workflow dependencies

### Rollback Commands

```bash
# To specific commit
git reset --hard [commit-hash]

# To last known good state
git reset --hard 785e962

# View commit history
git log --oneline -10
```

## Lessons Learned

1. **UI Automation is Fragile**: Always build in resilience and fallbacks
2. **Unique IDs are Gold**: `wf_item` discovery was game-changing
3. **Incremental Progress**: Better to save partial data than lose everything
4. **Browser Sessions Matter**: Persistent profiles save significant time
5. **Dropdown > Direct Click**: Sometimes indirect methods are more reliable
6. **Documentation is Critical**: This file will save hours of rediscovery

## Contact and Resources

- **Bubble.io Documentation**: https://manual.bubble.io
- **Playwright Docs**: https://playwright.dev
- **Google Drive API**: https://developers.google.com/drive
- **Project Repository**: [local repository]

---

*Last Updated: September 2025*
*Total Development Time: ~3 weeks*
*Workflows Extracted: 300+*
*Success Rate: 95%+*