@echo off
chcp 65001 >nul
title SuperSplat Launcher

REM ============================================================
REM  ВНИМАНИЕ: ЭТОТ ФАЙЛ НЕ ДОЛЖЕН МЕНЯТЬСЯ.
REM
REM  Это диспетчер. Вся логика живёт в:
REM    - supersplat_update.bat  (git pull + пересборка образа)
REM    - supersplat_core.bat    (Docker + SAM + тест + Edge)
REM
REM  Если нужно изменить поведение — правьте core или update.
REM  Этот файл только спрашивает Y/N и вызывает нужный.
REM
REM  Заморозка нужна, чтобы git pull не сломал ярлыки:
REM  старый процесс launcher продолжает работать, но он
REM  не содержит логики, которая может устареть.
REM ============================================================

set "PROJECT_DIR=%USERPROFILE%\Documents\work\supersplat_yi"

REM --- Проверка папок и файлов ---
if not exist "%PROJECT_DIR%" (
    echo [ОШИБКА] Папка не найдена: %PROJECT_DIR%
    pause
    exit /b 1
)
if not exist "%~dp0supersplat_update.bat" (
    echo [ОШИБКА] Файл supersplat_update.bat не найден рядом с лаунчером.
    pause
    exit /b 1
)
if not exist "%~dp0supersplat_core.bat" (
    echo [ОШИБКА] Файл supersplat_core.bat не найден рядом с лаунчером.
    pause
    exit /b 1
)

REM --- Вопрос про обновление ---
echo.
choice /C YN /M "Хотите обновить проект из git?"
if errorlevel 2 goto skip_update

REM --- Y: обновление, потом ядро ---
echo.
echo Запускаем обновление...
echo.
call "%~dp0supersplat_update.bat"
goto run_core

:skip_update
echo.
echo Обновление пропущено.

:run_core
echo.
echo Запускаем SuperSplat...
echo.
call "%~dp0supersplat_core.bat"

exit /b %errorlevel%