@echo off
title KVPZ Tracker Local FAA Scraper Server
echo ========================================================
echo   Launching KVPZ Tracker & FAA Registry Scraper Server
echo ========================================================
echo.
echo Server running at: http://localhost:8080
echo.
echo Leave this window open while using your flight tracker!
echo Press Ctrl+C to stop.
echo.
"C:\Users\chadm\AppData\Roaming\uv\python\cpython-3.11-windows-x86_64-none\python.exe" verify_build.py
pause
