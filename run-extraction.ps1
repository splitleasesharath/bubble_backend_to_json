# Bubble.io Backend Workflow Extractor - PowerShell Script
# Enhanced version with logging and progress tracking

param(
    [Parameter(Position=0)]
    [ValidateSet("full", "test", "github-test", "check", "install")]
    [string]$Mode = "",

    [Parameter()]
    [int]$MaxWorkflows = 0,

    [Parameter()]
    [switch]$SkipGitHub
)

# Set up colors
$Host.UI.RawUI.BackgroundColor = 'Black'
Clear-Host

function Write-Header {
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host "                   BUBBLE.IO BACKEND WORKFLOW EXTRACTOR" -ForegroundColor Yellow
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Cyan
}

function Test-Prerequisites {
    Write-Info "Checking prerequisites..."

    # Check Node.js
    try {
        $nodeVersion = node -v 2>$null
        Write-Success "Node.js installed: $nodeVersion"
    } catch {
        Write-Error "Node.js is not installed or not in PATH"
        Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
        return $false
    }

    # Check required files
    if (-not (Test-Path "extract-workflow-dropdown.js")) {
        Write-Error "extract-workflow-dropdown.js not found!"
        return $false
    }
    Write-Success "Required files found"

    # Check GitHub token
    if (Test-Path "github-logger\.env") {
        Write-Success "GitHub logger configuration found"
    } else {
        Write-Host "⚠ GitHub .env not found - GitHub upload will be skipped" -ForegroundColor Yellow
    }

    return $true
}

function Show-Menu {
    Write-Header
    Write-Host "Select an option:" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1] " -NoNewline -ForegroundColor Yellow; Write-Host "Run Full Extraction (with GitHub upload)"
    Write-Host "  [2] " -NoNewline -ForegroundColor Yellow; Write-Host "Run Test Extraction (2 workflows only)"
    Write-Host "  [3] " -NoNewline -ForegroundColor Yellow; Write-Host "Test GitHub Integration"
    Write-Host "  [4] " -NoNewline -ForegroundColor Yellow; Write-Host "Check Combined Output from Last Run"
    Write-Host "  [5] " -NoNewline -ForegroundColor Yellow; Write-Host "Install/Update Dependencies"
    Write-Host "  [6] " -NoNewline -ForegroundColor Yellow; Write-Host "View Extraction Logs"
    Write-Host "  [7] " -NoNewline -ForegroundColor Yellow; Write-Host "Exit"
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Start-FullExtraction {
    Write-Header
    Write-Info "Starting FULL Workflow Extraction..."
    Write-Host ""
    Write-Host "This will:" -ForegroundColor White
    Write-Host "  • Extract ALL workflows from Bubble.io" -ForegroundColor Gray
    Write-Host "  • Create individual JSON files for each workflow" -ForegroundColor Gray
    Write-Host "  • Combine all workflows into ALL_WORKFLOWS_COMBINED.json" -ForegroundColor Gray

    if (-not $SkipGitHub) {
        Write-Host "  • Upload combined file to GitHub logs repository" -ForegroundColor Gray
    } else {
        Write-Host "  • Skip GitHub upload (--SkipGitHub flag set)" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Press Enter to continue or Ctrl+C to cancel..." -ForegroundColor Yellow
    Read-Host

    $startTime = Get-Date
    Write-Info "Starting extraction at $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))..."
    Write-Host ""

    # Run extraction
    if ($MaxWorkflows -gt 0) {
        $env:MAX_WORKFLOWS = $MaxWorkflows
        Write-Info "Limiting extraction to $MaxWorkflows workflows"
    }

    $process = Start-Process -FilePath "node" -ArgumentList "extract-workflow-dropdown.js" -PassThru -NoNewWindow -Wait

    if ($process.ExitCode -eq 0) {
        $endTime = Get-Date
        $duration = $endTime - $startTime

        Write-Host ""
        Write-Success "Extraction completed successfully!"
        Write-Info "Duration: $($duration.ToString('hh\:mm\:ss'))"

        # Show latest output directory
        $latestDir = Get-ChildItem "extracted-workflows-dropdown" -Directory |
                     Sort-Object Name -Descending |
                     Select-Object -First 1

        if ($latestDir) {
            Write-Info "Output directory: $($latestDir.FullName)"

            # Count files
            $jsonFiles = Get-ChildItem $latestDir.FullName -Filter "*.json"
            Write-Info "Files created: $($jsonFiles.Count) JSON files"

            # Check for combined file
            $combinedFile = Join-Path $latestDir.FullName "ALL_WORKFLOWS_COMBINED.json"
            if (Test-Path $combinedFile) {
                $size = (Get-Item $combinedFile).Length / 1MB
                Write-Success "Combined file created: $([math]::Round($size, 2)) MB"
            }
        }
    } else {
        Write-Error "Extraction failed with exit code $($process.ExitCode)"
    }
}

function Start-TestExtraction {
    Write-Header
    Write-Info "Starting TEST Extraction (2 workflows only)..."
    Write-Host ""

    $env:MAX_WORKFLOWS = 2
    node test-dropdown-extraction.js

    if ($LASTEXITCODE -eq 0) {
        Write-Success "Test extraction completed successfully!"
    } else {
        Write-Error "Test extraction failed with exit code $LASTEXITCODE"
    }
}

function Test-GitHubIntegration {
    Write-Header
    Write-Info "Testing GitHub Integration..."
    Write-Host ""

    node test-github-integration.js
}

function Show-CombinedOutput {
    Write-Header
    Write-Info "Checking Combined Output from Last Run..."
    Write-Host ""

    node test-combined-output.js
}

function Install-Dependencies {
    Write-Header
    Write-Info "Installing/Updating Dependencies..."
    Write-Host ""

    Write-Info "Installing Node.js dependencies..."
    npm install

    Write-Host ""
    Write-Info "Installing GitHub logger dependencies..."
    Push-Location github-logger
    npm install
    Pop-Location

    Write-Host ""
    Write-Success "Dependencies installation complete!"
}

function Show-Logs {
    Write-Header
    Write-Info "Recent Extraction Runs:"
    Write-Host ""

    $dirs = Get-ChildItem "extracted-workflows-dropdown" -Directory |
            Sort-Object Name -Descending |
            Select-Object -First 10

    foreach ($dir in $dirs) {
        $summaryFile = Join-Path $dir.FullName "RUN_SUMMARY.json"
        if (Test-Path $summaryFile) {
            $summary = Get-Content $summaryFile | ConvertFrom-Json
            Write-Host "  $($dir.Name)" -ForegroundColor Yellow
            Write-Host "    Workflows: $($summary.total_workflows_processed)/$($summary.total_workflows_found)" -ForegroundColor Gray
            Write-Host "    Steps: $($summary.total_steps_extracted)" -ForegroundColor Gray
            Write-Host ""
        }
    }
}

# Main execution
if (-not (Test-Prerequisites)) {
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Handle direct mode parameter
if ($Mode) {
    switch ($Mode) {
        "full" { Start-FullExtraction }
        "test" { Start-TestExtraction }
        "github-test" { Test-GitHubIntegration }
        "check" { Show-CombinedOutput }
        "install" { Install-Dependencies }
    }
    Write-Host ""
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 0
}

# Interactive menu
while ($true) {
    Show-Menu
    $choice = Read-Host "Enter your choice (1-7)"

    switch ($choice) {
        "1" { Start-FullExtraction }
        "2" { Start-TestExtraction }
        "3" { Test-GitHubIntegration }
        "4" { Show-CombinedOutput }
        "5" { Install-Dependencies }
        "6" { Show-Logs }
        "7" {
            Write-Host ""
            Write-Info "Thank you for using Bubble.io Backend Workflow Extractor!"
            Write-Host ""
            exit 0
        }
        default {
            Write-Error "Invalid choice. Please try again."
        }
    }

    Write-Host ""
    Write-Host "Press any key to continue..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}