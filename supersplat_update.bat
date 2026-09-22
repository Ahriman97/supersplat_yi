@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title SuperSplat Update

REM ============================================================
REM  Этот файл делает ТОЛЬКО обновление:
REM    1. git pull
REM    2. проверка хеша файлов server_sam/
REM    3. пересборка Docker-образа (если нужно)
REM
REM  Вызывается через call из supersplat_launcher.bat.
REM  Возвращает управление через exit /b.
REM  Все exit — только с /b, иначе рушится цепочка call.
REM ============================================================

set "PROJECT_DIR=%USERPROFILE%\Documents\work\supersplat_yi"
set "SERVER_DIR=%PROJECT_DIR%\server_sam"
set "HASH_FILE=%SERVER_DIR%\.server_hash"

REM --- Проверка папок ---
if not exist "%PROJECT_DIR%" (
    echo [ОШИБКА] Папка не найдена: %PROJECT_DIR%
    exit /b 1
)
if not exist "%SERVER_DIR%" (
    echo [ОШИБКА] Папка SAM-сервера не найдена: %SERVER_DIR%
    exit /b 1
)

REM ============================================================
REM  [1/3] Обновление из git
REM ============================================================
echo.
echo [1/3] Обновляем проект из git...
cd /d "%PROJECT_DIR%"
git pull origin main
if errorlevel 1 (
    echo.
    echo [ПРЕДУПРЕЖДЕНИЕ] git pull завершился с ошибкой.
    echo                  Продолжаем со старой версией.
    exit /b 1
)
echo       Git обновлён.

REM ============================================================
REM  [2/3] Проверка Docker
REM ============================================================
echo.
echo [2/3] Проверяем Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Docker не запущен.
    echo         Запустите Docker Desktop и повторите.
    exit /b 1
)
echo       Docker работает.

REM ============================================================
REM  [3/3] Проверка, нужно ли пересобирать образ
REM ============================================================
echo.
echo [3/3] Проверяем состояние Docker-образа SAM-сервера...

cd /d "%SERVER_DIR%"

REM --- Уровень 1: есть ли образ вообще ---
set "IMAGE_ID="
for /f %%I in ('docker compose images -q sam-server 2^>nul') do set "IMAGE_ID=%%I"

set "NEED_BUILD=0"

if "!IMAGE_ID!"=="" (
    echo       [ИНФО] Образ SAM-сервера отсутствует.
    set "NEED_BUILD=1"
) else (
    echo       Образ найден: !IMAGE_ID!
)

REM --- Уровень 2: считаем текущий хеш файлов ---
set "NEW_HASH="
for /f "delims=" %%H in ('powershell -NoProfile -Command "$files = Get-ChildItem -Path '%SERVER_DIR%' -Recurse -File -Include *.py,Dockerfile,requirements.txt | Where-Object { $_.FullName -notlike '*\models\*' -and $_.FullName -notlike '*\.git\*' -and $_.FullName -notlike '*\tests\*' -and $_.FullName -notlike '*\__pycache__\*' -and $_.FullName -notlike '*\node_modules\*' }; if ($files) { ($files ^| Get-FileHash -Algorithm MD5 ^| Sort-Object Path ^| ForEach-Object { $_.Hash }) -join '' ^| Get-FileHash -Algorithm MD5 ^| Select-Object -ExpandProperty Hash } else { 'NOFILES' }"') do set "NEW_HASH=%%H"

if "!NEW_HASH!"=="" (
    echo       [ПРЕДУПРЕЖДЕНИЕ] Не удалось вычислить хеш файлов.
    echo                        Образ будет пересобран на всякий случай.
    set "NEED_BUILD=1"
) else (
    echo       Текущий хеш: !NEW_HASH!
)

REM --- Уровень 3: сравнение с сохранённым хешем ---
if "!NEED_BUILD!"=="0" (
    if exist "%HASH_FILE%" (
        set /p OLD_HASH=<"%HASH_FILE%"
        if "!OLD_HASH!"=="" (
            echo       [ИНФО] Файл хеша пустой — пересобираем образ.
            set "NEED_BUILD=1"
        ) else if not "!OLD_HASH!"=="!NEW_HASH!" (
            echo       Хеш изменился.
            echo       Было: !OLD_HASH!
            echo       Стало: !NEW_HASH!
            set "NEED_BUILD=1"
        ) else (
            echo       Хеш совпадает — образ актуален.
        )
    ) else (
        echo       [ИНФО] Файл хеша не найден — пересобираем образ.
        set "NEED_BUILD=1"
    )
)

REM ============================================================
REM  Пересборка образа (если нужно)
REM ============================================================
if "!NEED_BUILD!"=="1" (
    echo.
    echo       Пересобираем Docker-образ SAM-сервера...
    echo       Это может занять 5-10 минут.
    echo.
    cd /d "%SERVER_DIR%"
    docker compose build
    if errorlevel 1 (
        echo.
        echo [ОШИБКА] Не удалось собрать образ.
        echo         Продолжаем со старым образом (если он есть).
        exit /b 1
    )

    if not "!NEW_HASH!"=="" (
        echo !NEW_HASH!> "%HASH_FILE%"
        echo       Образ пересобран, хеш сохранён.
    )
) else (
    echo       Пересборка не требуется.
)

exit /b 0