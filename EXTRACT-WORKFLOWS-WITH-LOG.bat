@echo off
:: Automatic extraction with logging - for debugging and scheduled tasks
cd /d "%~dp0"

:: Set up log file with timestamp
set "logfile=extraction-logs\extraction_%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log"
set "logfile=%logfile: =0%"

:: Create logs directory if it doesn't exist
if not exist "extraction-logs" mkdir "extraction-logs"

echo ================================================================================ >> "%logfile%"
echo BUBBLE.IO WORKFLOW EXTRACTION - AUTOMATIC MODE WITH LOGGING >> "%logfile%"
echo ================================================================================ >> "%logfile%"
echo. >> "%logfile%"
echo Starting extraction at %date% %time%... >> "%logfile%"
echo Working directory: %CD% >> "%logfile%"
echo. >> "%logfile%"

:: Display on screen too
echo ================================================================================
echo            BUBBLE.IO WORKFLOW EXTRACTION - AUTOMATIC MODE
echo ================================================================================
echo.
echo Starting extraction at %date% %time%...
echo Log file: %logfile%
echo.

:: Run the extraction with output to both console and log file
node extract-workflow-dropdown.js 2>&1 | powershell -command "& {$input | Tee-Object -FilePath '%logfile%' -Append | Write-Host}"

:: Get the exit code
set exitcode=%errorlevel%

if %exitcode% equ 0 (
    echo. >> "%logfile%"
    echo ================================================================================ >> "%logfile%"
    echo SUCCESS! Extraction completed at %time% >> "%logfile%"
    echo ================================================================================ >> "%logfile%"

    echo.
    echo ================================================================================
    echo SUCCESS! Extraction completed at %time%
    echo ================================================================================
    echo Log saved to: %logfile%
    exit /b 0
) else (
    echo. >> "%logfile%"
    echo ================================================================================ >> "%logfile%"
    echo ERROR: Extraction failed with code %exitcode% >> "%logfile%"
    echo ================================================================================ >> "%logfile%"

    echo.
    echo ================================================================================
    echo ERROR: Extraction failed with code %exitcode%
    echo ================================================================================
    echo Check log file: %logfile%

    :: Only pause on error
    echo.
    echo Press any key to close...
    pause >nul
    exit /b 1
)