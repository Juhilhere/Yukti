@echo off
title Yukti Server
cd /d "%~dp0"
echo Starting Yukti (this PC only) on http://127.0.0.1:8000 ...
start "" http://127.0.0.1:8000
:run
yukti-server.exe --host 127.0.0.1 --port 8000
rem exit code 75 = restart requested from the admin console (e.g. after staging a backup restore)
if %errorlevel%==75 (echo Restarting Yukti... & timeout /t 2 /nobreak >nul & goto run)
