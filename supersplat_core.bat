@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title SuperSplat Core

REM ============================================================
REM  Этот файл делает ТОЛЬКО запуск:
REM    1. проверка Docker
REM    2. проверка образа SAM
REM    3. docker compose up -d
REM    4. ожидание /health
REM    5. smoke-тест
REM    6. npm run develop
REM    7. Edge
REM
REM  Вызывается через call из supersplat_launcher.bat.
REM  Возвращает управление через exit /b.
REM  Все exit — только с /b, иначе рушится цепочка call.
REM ============================================================

set "PROJECT_DIR=%USERPROFILE%\Documents\work\supersplat_yi"
set "SERVER_DIR=%PROJECT_DIR%\server_sam"
set "EDGE_PROFILE=%TEMP%\supersplat-edge-profile"
set "SAM_URL=http://localhost:8000"

REM ============================================================
REM  Отключаем приветственные экраны Edge
REM ============================================================
reg add "HKCU\Software\Policies\Microsoft\Edge" /v HideFirstRunExperience /t REG_DWORD /d 1 /f >nul 2>&1

REM ============================================================
REM  [0/6] Очистка временного профиля Edge
REM ============================================================
echo.
echo [0/6] Чистим временный профиль Edge...
powershell -NoProfile -Command ^
  "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*supersplat-edge-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul

timeout /t 1 /nobreak >nul
if exist "%EDGE_PROFILE%" (
    rd /s /q "%EDGE_PROFILE%" 2>nul
    timeout /t 1 /nobreak >nul
    if exist "%EDGE_PROFILE%" (
        echo       [ВНИМАНИЕ] Профиль НЕ удалился — папка занята!
    ) else (
        echo       Старый профиль удалён.
    )
) else (
    echo       Старого профиля нет — пропускаем.
)

REM ============================================================
REM  Проверка папок проекта
REM ============================================================
if not exist "%PROJECT_DIR%" (
    echo [ОШИБКА] Папка не найдена: %PROJECT_DIR%
    pause
    exit /b 1
)
if not exist "%SERVER_DIR%" (
    echo [ОШИБКА] Папка SAM-сервера не найдена: %SERVER_DIR%
    pause
    exit /b 1
)

REM ============================================================
REM  [1/6] Проверка Docker
REM ============================================================
echo.
echo [1/6] Проверяем Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Docker не запущен.
    echo         Запустите Docker Desktop и повторите.
    pause
    exit /b 1
)
echo       Docker работает.

REM ============================================================
REM  [2/6] Проверка, что образ SAM существует
REM ============================================================
echo.
echo [2/6] Проверяем образ SAM-сервера...
cd /d "%SERVER_DIR%"
set "IMAGE_ID="
for /f %%I in ('docker compose images -q sam-server 2^>nul') do set "IMAGE_ID=%%I"
if "!IMAGE_ID!"=="" (
    echo.
    echo [ОШИБКА] Образ SAM-сервера не найден.
    echo         Запустите лаунчер снова и выберите "Y" для обновления.
    pause
    exit /b 1
)
echo       Образ найден: !IMAGE_ID!

REM ============================================================
REM  [3/6] Запуск SAM-сервера
REM ============================================================
echo.
echo [3/6] Запускаем SAM-сервер...
docker compose up -d
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Не удалось запустить SAM-сервер.
    pause
    exit /b 1
)
echo       Контейнер запущен.

REM ============================================================
REM  [4/6] Ожидание готовности SAM
REM ============================================================
echo.
echo [4/6] Ждём загрузки модели SAM (до 60 секунд)...
set /a WAIT_COUNT=0
:wait_loop
set /a WAIT_COUNT+=1

curl -s -o nul -w "%%{http_code}" "%SAM_URL%/health" > "%TEMP%\sam_health.txt" 2>nul
set /p HEALTH_CODE=<"%TEMP%\sam_health.txt"
del "%TEMP%\sam_health.txt" >nul 2>&1

if "%HEALTH_CODE%"=="200" (
    echo       SAM-сервер готов (после %WAIT_COUNT% попыток^).
    goto sam_ready
)

if %WAIT_COUNT% GEQ 30 (
    echo.
    echo [ОШИБКА] SAM-сервер не отвечает после 60 секунд.
    echo         Логи: docker compose logs sam-server
    pause
    exit /b 1
)

timeout /t 2 /nobreak >nul
goto wait_loop

:sam_ready

REM ============================================================
REM  [5/6] Smoke-тест SAM
REM ============================================================
echo.
echo [5/6] Запускаем smoke-тест SAM-сервера...

REM Ищем Git Bash. В PATH часто стоит WSL-заглушка bash.exe,
REM которая падает с ошибкой WSL. Поэтому используем полный путь.
set "BASH_EXE="
set "GIT_USR_BIN="
if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\usr\bin\bash.exe" & set "GIT_USR_BIN=C:\Program Files\Git\usr\bin"
if not defined BASH_EXE if exist "C:\Program Files\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files\Git\bin\bash.exe" & set "GIT_USR_BIN=C:\Program Files\Git\usr\bin"
if not defined BASH_EXE if exist "C:\Program Files (x86)\Git\usr\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\usr\bin\bash.exe" & set "GIT_USR_BIN=C:\Program Files (x86)\Git\usr\bin"
if not defined BASH_EXE if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH_EXE=C:\Program Files (x86)\Git\bin\bash.exe" & set "GIT_USR_BIN=C:\Program Files (x86)\Git\usr\bin"
if not defined BASH_EXE if exist "%LOCALAPPDATA%\Programs\Git\usr\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\usr\bin\bash.exe" & set "GIT_USR_BIN=%LOCALAPPDATA%\Programs\Git\usr\bin"
if not defined BASH_EXE if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_EXE=%LOCALAPPDATA%\Programs\Git\bin\bash.exe" & set "GIT_USR_BIN=%LOCALAPPDATA%\Programs\Git\usr\bin"

if not defined BASH_EXE (
    echo.
    echo [ОШИБКА] Git Bash не найден.
    echo         Установите Git for Windows: https://git-scm.com/download/win
    pause
    exit /b 1
)

REM Добавляем Unix-утилиты Git Bash в PATH, чтобы dirname/awk/sed
REM были доступны при запуске bash.exe из cmd.exe
set "PATH=%PATH%;!GIT_USR_BIN!"

echo       Используем Git Bash: !BASH_EXE!
echo       Unix-утилиты: !GIT_USR_BIN!

cd /d "%SERVER_DIR%"
"!BASH_EXE!" tests/test_smoke.sh
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Smoke-тест SAM-сервера не прошёл.
    echo         Логи: docker compose logs sam-server
    pause
    exit /b 1
)
echo       Smoke-тест пройден.

REM ============================================================
REM  [6/6] Запуск dev-сервера и Edge
REM ============================================================
echo.
echo [6/6] Запускаем SuperSplat dev-сервер...
cd /d "%PROJECT_DIR%"
start "SuperSplat Dev Server" cmd /k "cd /d "%PROJECT_DIR%" && npm run develop"

echo       Ждём 5 секунд, пока dev-сервер поднимется...
timeout /t 5 /nobreak >nul

echo       Открываем Edge...
start "" msedge.exe --user-data-dir="%EDGE_PROFILE%" --no-first-run --new-window "http://localhost:3000"

echo.
echo ============================================================
echo  ГОТОВО! SuperSplat + SAM-сервер запущены.
echo ============================================================
echo.
echo  SAM-сервер: %SAM_URL%
echo  SuperSplat: http://localhost:3000
echo.
exit /b 0