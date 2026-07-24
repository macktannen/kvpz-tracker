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
python verify_build.py
pause
