@echo off
title KVPZ Node FAA Scraper Server
echo ========================================================
echo   Launching Node.js FAA Registry Scraper Server
echo ========================================================
echo.
echo Server running at: http://localhost:3001
echo.
echo Leave this window open while using your flight tracker!
echo Press Ctrl+C to stop.
echo.
node faa_server.js
pause
