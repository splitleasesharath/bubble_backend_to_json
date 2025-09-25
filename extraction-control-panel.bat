@echo off
setlocal EnableDelayedExpansion

:: Bubble.io Backend Workflow Extractor
:: Batch script for easy execution

cls
echo ================================================================================
echo                    BUBBLE.IO BACKEND WORKFLOW EXTRACTOR
echo ================================================================================
echo.

:: Check if Node.js is installed
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Display current directory
echo Current Directory: %CD%
echo.

:: Check if required files exist
if not exist "extract-workflow-dropdown.js" (
    echo [ERROR] extract-workflow-dropdown.js not found!
    echo Please make sure you're running this script from the project directory.
    pause
    exit /b 1
)

:: Display menu
echo Select an option:
echo ================================================================================
echo.
echo   1. Run Full Extraction (with GitHub upload)
echo   2. Run Test Extraction (2 workflows only)
echo   3. Test GitHub Integration
echo   4. Check Combined Output from Last Run
echo   5. Install/Update Dependencies
echo   6. Exit
echo.
echo ================================================================================
echo.

set /p choice="Enter your choice (1-6): "

if "%choice%"=="1" goto :full_extraction
if "%choice%"=="2" goto :test_extraction
if "%choice%"=="3" goto :test_github
if "%choice%"=="4" goto :check_output
if "%choice%"=="5" goto :install_deps
if "%choice%"=="6" goto :end

echo Invalid choice. Please try again.
timeout /t 2 >nul
goto :start

:full_extraction
echo.
echo ================================================================================
echo Starting FULL Workflow Extraction...
echo ================================================================================
echo.
echo This will:
echo - Extract ALL workflows from Bubble.io
echo - Create individual JSON files for each workflow
echo - Combine all workflows into ALL_WORKFLOWS_COMBINED.json
echo - Upload combined file to GitHub logs repository
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo Starting extraction at %date% %time%...
echo.

node extract-workflow-dropdown.js

if %errorlevel% equ 0 (
    echo.
    echo ================================================================================
    echo Extraction completed successfully!
    echo Check the extracted-workflows-dropdown folder for results.
    echo ================================================================================
) else (
    echo.
    echo ================================================================================
    echo [ERROR] Extraction failed with error code %errorlevel%
    echo ================================================================================
)
pause
goto :end

:test_extraction
echo.
echo ================================================================================
echo Starting TEST Extraction (2 workflows only)...
echo ================================================================================
echo.

set MAX_WORKFLOWS=2
node test-dropdown-extraction.js

if %errorlevel% equ 0 (
    echo.
    echo ================================================================================
    echo Test extraction completed successfully!
    echo ================================================================================
) else (
    echo.
    echo ================================================================================
    echo [ERROR] Test extraction failed with error code %errorlevel%
    echo ================================================================================
)
pause
goto :end

:test_github
echo.
echo ================================================================================
echo Testing GitHub Integration...
echo ================================================================================
echo.

node test-github-integration.js

pause
goto :end

:check_output
echo.
echo ================================================================================
echo Checking Combined Output from Last Run...
echo ================================================================================
echo.

node test-combined-output.js

pause
goto :end

:install_deps
echo.
echo ================================================================================
echo Installing/Updating Dependencies...
echo ================================================================================
echo.

echo Installing Node.js dependencies...
npm install

echo.
echo Installing GitHub logger dependencies...
cd github-logger
npm install
cd ..

echo.
echo ================================================================================
echo Dependencies installation complete!
echo ================================================================================
pause
goto :end

:end
echo.
echo Thank you for using Bubble.io Backend Workflow Extractor!
echo.
exit /b 0