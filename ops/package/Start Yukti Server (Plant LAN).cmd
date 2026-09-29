@echo off
title Yukti Server (plant LAN)
cd /d "%~dp0"
echo Serving Yukti to desktop clients on the plant network: port 8000 on all interfaces.
echo Allow TCP 8000 in Windows Firewall for the plant subnet only.
yukti-server.exe --host 0.0.0.0 --port 8000
