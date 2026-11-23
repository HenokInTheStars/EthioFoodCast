@echo off
REM Starts the API; the virtual environment stays at the repository root.
cd /d "%~dp0"
set "PYTHON=%~dp0..\.venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo Creating virtual environment...
  python -m venv "%~dp0..\.venv" || goto :error
  "%PYTHON%" -m pip install -r requirements.txt || goto :error
)
"%PYTHON%" -m uvicorn api_server:app --host 127.0.0.1 --port 5000
goto :eof
:error
echo Setup failed. See ..\README.md.
pause
