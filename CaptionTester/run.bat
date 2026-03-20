@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
if "%~1"=="" (
    python caption_tester.py --from-config
) else (
    python caption_tester.py %*
)
if errorlevel 1 pause
