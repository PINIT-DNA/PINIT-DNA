@echo off
echo =============================================
echo   PINIT-DNA Python AI Microservice
echo   Port: 8001
echo =============================================
echo.

REM Check Python
python --version 2>nul
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ first.
    pause
    exit /b 1
)

REM Install dependencies if needed
echo Installing/verifying dependencies...
pip install -r requirements.txt --quiet

echo.
echo Starting AI service on http://localhost:8001
echo Press Ctrl+C to stop.
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
pause
