@echo off
:: Automatic extraction script - runs immediately without user input
cd /d "%~dp0"

echo ================================================================================
echo            BUBBLE.IO WORKFLOW EXTRACTION - AUTOMATIC MODE
echo ================================================================================
echo.
echo Starting extraction at %date% %time%...
echo Working directory: %CD%
echo.

:: Run the extraction
call node extract-workflow-dropdown.js

:: Check the exit code
if %errorlevel% equ 0 (
    echo.
    echo ================================================================================
    echo SUCCESS! Extraction completed at %time%
    echo ================================================================================
    echo Check the 'extracted-workflows-dropdown' folder for your files.
    exit /b 0
) else (
    echo.
    echo ================================================================================
    echo ERROR: Extraction failed with code %errorlevel%
    echo ================================================================================
    echo Trying to diagnose the issue...
    echo.

    :: Check if node is available
    node --version >nul 2>&1
    if errorlevel 1 (
        echo ERROR: Node.js is not installed or not in PATH
    )

    :: Check if the script exists
    if not exist "extract-workflow-dropdown.js" (
        echo ERROR: extract-workflow-dropdown.js not found in %CD%
    )

    :: Keep window open on error for debugging
    echo.
    echo Press any key to close...
    pause >nul
    exit /b 1
)