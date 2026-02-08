@echo off
title AlphaSwarm
cd /d f:\Alphaswarm
echo Killing stale pear processes...
wmic process where "name like '%%pear%%'" call terminate >nul 2>nul
timeout /t 3 /nobreak >nul
echo Starting AlphaSwarm...
echo.
call C:\Users\faber\AppData\Roaming\pear\bin\pear.cmd run . store1
pause
