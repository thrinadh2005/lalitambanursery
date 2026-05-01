@echo off
title SRI LALITAMBA NURSERY - Local Launch
color 0A

echo Starting SRI LALITAMBA NURSERY...
echo.

:: Kill any existing process on port 3002
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: Start server
echo Server starting at http://localhost:3002
start http://localhost:3002
node server.js

pause
