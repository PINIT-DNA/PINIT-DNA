@echo off
title PINIT-DNA Backend - Node 4000 + Python AI 8001
cd /d "%~dp0"

echo.
echo  Terminal 1 - Backend (run this FIRST)
echo  ===================================
echo    npm run dev
echo           |
echo           v
echo    Node.js Backend  :4000
echo           |
echo           +-- auto-starts Python AI
echo           v
echo    Python AI Service :8001
echo.
echo  Terminal 2 - Frontend (separate terminal)
echo    cd client
echo    npm run dev   ^>  http://localhost:3000
echo.

call npm run dev
