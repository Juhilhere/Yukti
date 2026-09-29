@echo off
title Yukti Server
cd /d "%~dp0"
echo Starting Yukti (this PC only) on http://127.0.0.1:8000 ...
start "" http://127.0.0.1:8000
yukti-server.exe --host 127.0.0.1 --port 8000
