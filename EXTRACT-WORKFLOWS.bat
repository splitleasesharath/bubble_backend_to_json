@echo off
:: Quick extraction script - just double-click to run!

echo ================================================================================
echo            STARTING BUBBLE.IO WORKFLOW EXTRACTION
echo ================================================================================
echo.
echo This will extract all workflows and upload to GitHub automatically.
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo Starting extraction...
echo.

node extract-workflow-dropdown.js

if %errorlevel% equ 0 (
    echo.
    echo ================================================================================
    echo SUCCESS! Extraction completed.
    echo ================================================================================
    echo.
    echo Check the 'extracted-workflows-dropdown' folder for your files.
) else (
    echo.
    echo ================================================================================
    echo ERROR: Extraction failed!
    echo ================================================================================
)

echo.
pause