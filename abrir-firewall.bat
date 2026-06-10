@echo off
chcp 65001 >nul
title FPS Arena - Abrir firewall para jugar desde el celular

REM Si no se ejecuta como administrador, se relanza pidiendo permisos (UAC)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Solicitando permisos de administrador...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   Abriendo el puerto 3000 para que el celular pueda entrar
echo ============================================================
echo.

REM Quita una regla previa por las dudas y crea la nueva
netsh advfirewall firewall delete rule name="FPS Arena 3000" >nul 2>&1
netsh advfirewall firewall add rule name="FPS Arena 3000" dir=in action=allow protocol=TCP localport=3000 profile=any

echo.
echo  LISTO. Ahora, con el server encendido (npm start o la app),
echo  entra desde el celular (misma Wi-Fi) a:
echo.
echo        http://192.168.100.7:3000
echo.
echo  (Si tu IP cambia, miralo con el comando: ipconfig)
echo.
pause
