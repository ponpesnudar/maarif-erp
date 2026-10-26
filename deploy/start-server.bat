@echo off
rem Menjalankan server dan menyalakannya lagi otomatis bila berhenti. Jadwalkan file ini di Task Scheduler (At startup).
cd /d %~dp0..
if not exist data mkdir data
:ulang
echo [%date% %time%] server mulai >> data\server.log
node src\server.js >> data\server.log 2>&1
echo [%date% %time%] server berhenti, mulai ulang 5 detik lagi >> data\server.log
timeout /t 5 /nobreak >nul
goto ulang
