@echo off
rem Starts the PhoneBox agent (if it is not already running) and opens its settings page.
rem Add /quiet to skip opening the settings page.
set "APPDIR=%LOCALAPPDATA%\PhoneBox\app"
if not exist "%APPDIR%\PhoneBoxAgent.exe" (
  echo PhoneBox is not installed yet. From the phonebox folder run:  .\setup.ps1 -Version 0.9.24 -NoPhone
  pause
  exit /b 1
)
tasklist /FI "IMAGENAME eq PhoneBoxAgent.exe" 2>nul | find /I "PhoneBoxAgent.exe" >nul
if %errorlevel%==0 (
  echo PhoneBox is already running.
) else (
  echo Starting PhoneBox ...
  start "" /D "%APPDIR%" "%APPDIR%\PhoneBoxAgent.exe"
  timeout /t 4 /nobreak >nul
)
if /I not "%~1"=="/quiet" start "" http://127.0.0.1:8765
