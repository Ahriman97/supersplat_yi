@echo off
chcp 65001 >nul
title SuperSplat Launcher

REM ============================================================
REM  Отключаем приветственные экраны Edge
REM ============================================================
reg add "HKCU\Software\Policies\Microsoft\Edge" /v HideFirstRunExperience /t REG_DWORD /d 1 /f >nul 2>&1

REM ============================================================
REM  Очистка временного профиля Edge от прошлого запуска
REM  Убиваем ТОЛЬКО процессы Edge с нашим профилем,
REM  основное окно пользователя не трогаем.
REM ============================================================
set "EDGE_PROFILE=%TEMP%\supersplat-edge-profile"

echo [0/4] Чистим временный профиль Edge...
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
REM  Создание ярлыка на рабочем столе (если ещё нет)
REM ============================================================
for /f "usebackq tokens=*" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESKTOP=%%D"
set "SHORTCUT=%DESKTOP%\SuperSplat Launcher.lnk"
if not exist "%SHORTCUT%" (
    echo [ИНФО] Создаю ярлык на рабочем столе...
    powershell -NoProfile -Command ^
        "$ws = New-Object -ComObject WScript.Shell;" ^
        "$sc = $ws.CreateShortcut('%SHORTCUT%');" ^
        "$sc.TargetPath = '%~f0';" ^
        "$sc.WorkingDirectory = '%~dp0';" ^
        "$sc.IconLocation = 'shell32.dll,137';" ^
        "$sc.Description = 'SuperSplat Launcher';" ^
        "$sc.Save()"
)

REM ============================================================
REM  Проверка папки проекта
REM ============================================================
set "PROJECT_DIR=%USERPROFILE%\Documents\supersplat_yi"
if not exist "%PROJECT_DIR%" (
    echo [ОШИБКА] Папка не найдена: %PROJECT_DIR%
    pause
    exit /b 1
)

REM ============================================================
REM  Обновление проекта
REM ============================================================
choice /C YN /M "Хотите обновить проект (git pull)?"
if errorlevel 2 goto no_update
if errorlevel 1 goto do_update

:do_update
echo.
echo [1/4] Обновление из git...
cd /d "%PROJECT_DIR%"
call git pull origin main
if errorlevel 1 (
    echo [ПРЕДУПРЕЖДЕНИЕ] git pull завершился с ошибкой. Продолжаем...
)
goto start_dev

:no_update
echo.
echo Пропускаем git pull.
cd /d "%PROJECT_DIR%"

REM ============================================================
REM  Запуск dev-сервера
REM ============================================================
:start_dev
echo.
echo [2/4] Запуск npm run develop...
start "SuperSplat Dev Server" cmd /k "cd /d "%PROJECT_DIR%" && npm run develop"

timeout /t 5 /nobreak >nul

REM ============================================================
REM  Запуск Edge с чистым профилем
REM ============================================================
echo [3/4] Открываем Edge с чистым профилем...
start "" msedge.exe --user-data-dir="%EDGE_PROFILE%" --no-first-run --new-window "http://localhost:3000"

echo.
echo [4/4] Готово! Сервер работает в отдельном окне.
exit /b 0