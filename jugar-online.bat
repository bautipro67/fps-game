@echo off
chcp 65001 >nul
title FPS Arena - Jugar online con amigos
cd /d "%~dp0"

echo ============================================================
echo    FPS ARENA - Crear partida online para tus amigos
echo ============================================================
echo.

REM --- 1) Descargar cloudflared la primera vez ---
if not exist cloudflared.exe (
    echo Descargando cloudflared ^(solo la primera vez, ~20 MB^)...
    powershell -Command "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing } catch { exit 1 }"
    if not exist cloudflared.exe (
        echo.
        echo  ERROR: no se pudo descargar cloudflared. Revisa tu conexion a internet.
        echo.
        pause
        exit /b
    )
    echo Descarga completa.
    echo.
)

REM --- 2) Instalar dependencias si falta node_modules ---
if not exist node_modules (
    echo Instalando dependencias del juego ^(solo la primera vez^)...
    call npm install
    echo.
)

REM --- 3) Arrancar el servidor del juego en otra ventana ---
echo Arrancando el servidor del juego...
start "FPS Arena - Servidor (no cerrar)" cmd /k "node server.js"

REM esperar a que el servidor levante
timeout /t 3 /nobreak >nul

REM --- 4) Abrir el tunel publico ---
echo.
echo ============================================================
echo   MIRA ABAJO la linea con:   https://....trycloudflare.com
echo   ^>^>^> Esa URL se la pasas a tus amigos. Listo. ^<^<^<
echo.
echo   (Para terminar: cerra esta ventana y la del servidor)
echo ============================================================
echo.

cloudflared.exe tunnel --url http://localhost:3000

pause
