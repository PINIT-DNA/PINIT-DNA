@echo off
setlocal
cd /d "%~dp0"

echo =============================================
echo   PINIT-DNA Python AI — isolated venv setup
echo =============================================

python --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Python 3.11+ not found on PATH.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 exit /b 1
)

echo Installing pinned dependencies (this may take a few minutes)...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo.
echo Done. Start manually:  .venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
echo Or run backend from repo root:  npm run dev  (auto-starts AI on :8001)
echo.
endlocal
