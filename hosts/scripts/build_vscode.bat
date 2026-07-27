@echo off
REM Opencode VSCode Extension Build Script for Windows
REM Standard only: bundles opencode binaries.

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"
set "PLUGIN_DIR=%ROOT_DIR%\hosts\vscode-plugin"

if not exist "%PLUGIN_DIR%\package.json" (
    echo [ERROR] package.json not found. Please run this script from the repository root.
    exit /b 1
)

echo Opencode VSCode Extension Build Script
echo Plugin directory: %PLUGIN_DIR%
echo Root directory: %ROOT_DIR%

set "BUILD_TYPE=development"
set "SKIP_BINARIES=false"
set "SKIP_TESTS=false"
set "PACKAGE_ONLY=false"
set "SINGLE_PLATFORM=false"

:parse_args
if "%~1"=="" goto args_done
if "%~1"=="--production" (
    set "BUILD_TYPE=production"
    shift
    goto parse_args
)
if "%~1"=="--skip-binaries" (
    set "SKIP_BINARIES=true"
    shift
    goto parse_args
)
if "%~1"=="--skip-tests" (
    set "SKIP_TESTS=true"
    shift
    goto parse_args
)
if "%~1"=="--package-only" (
    set "PACKAGE_ONLY=true"
    shift
    goto parse_args
)
if "%~1"=="--single" (
    set "SINGLE_PLATFORM=true"
    shift
    goto parse_args
)
if "%~1"=="--windows-only" (
    set "SINGLE_PLATFORM=true"
    shift
    goto parse_args
)
if "%~1"=="--help" (
    echo Usage: %0 [OPTIONS]
    echo   --production      Build for production ^(default: development^)
    echo   --skip-binaries   Skip building backend binaries
    echo   --skip-tests      Skip running tests
    echo   --package-only    Only create the .vsix package ^(skip compilation^)
    echo   --single          Build backend for current platform only
    echo   --windows-only    Alias for --single
    echo   --help            Show this help message
    exit /b 0
)
echo [ERROR] Unknown option: %~1
exit /b 1

:args_done

echo [INFO] Building VSCode extension in %BUILD_TYPE% mode
echo [INFO]   Variant: standard (with binaries)

cd /d "%PLUGIN_DIR%"

if defined PLUGIN_VERSION (
    echo [INFO] Overriding version with PLUGIN_VERSION=%PLUGIN_VERSION%
    node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); pkg.version=process.argv[1]; fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');" "%PLUGIN_VERSION%"
)

if "%PACKAGE_ONLY%"=="false" (
    echo [INFO] Cleaning previous build artifacts...
    if not exist "node_modules" (
        echo [WARN] Dependencies not installed; skipping script clean and removing artifacts manually.
        if exist "out" rmdir /s /q "out"
        del /f /q *.vsix 2>nul
    ) else (
        call pnpm run clean 2>nul
        if errorlevel 1 (
            echo [WARN] Clean command failed, applying fallback removal...
            if exist "out" rmdir /s /q "out"
            del /f /q *.vsix 2>nul
        )
    )
)

if "%PACKAGE_ONLY%"=="false" (
    echo [INFO] Installing dependencies...
    where pnpm >nul 2>&1
    if not errorlevel 1 (
        call pnpm install --frozen-lockfile
    ) else (
        where npm >nul 2>&1
        if errorlevel 1 (
            echo [ERROR] Neither pnpm nor npm found. Please install a package manager.
            exit /b 1
        )
        call npm install
    )
)

if "%SKIP_BINARIES%"=="false" (
    if "%PACKAGE_ONLY%"=="false" (
        echo [INFO] Building backend binaries...
        cd /d "%ROOT_DIR%"
        if exist "hosts\scripts\build_opencode.bat" (
            if "%SINGLE_PLATFORM%"=="true" (
                echo [INFO] Single-platform backend build enabled: --single
                call hosts\scripts\build_opencode.bat --single
            ) else (
                call hosts\scripts\build_opencode.bat
            )
            if errorlevel 1 (
                echo [ERROR] Backend binary build failed.
                exit /b 1
            )
        ) else (
            echo [ERROR] Backend build script not found at hosts\scripts\build_opencode.bat
            exit /b 1
        )
        cd /d "%PLUGIN_DIR%"
    )
)

if "%PACKAGE_ONLY%"=="false" (
    echo [INFO] Compiling TypeScript...
    if "%BUILD_TYPE%"=="production" (
        call pnpm run compile:production
    ) else (
        call pnpm run compile
    )
)

if "%PACKAGE_ONLY%"=="false" (
    echo [INFO] Running linter...
    call pnpm run lint
    if errorlevel 1 echo [WARN] Linting failed, continuing with build...
)

if "%SKIP_TESTS%"=="false" (
    if "%PACKAGE_ONLY%"=="false" (
        echo [INFO] Running tests...
        call pnpm run test
        if errorlevel 1 echo [WARN] Tests failed, continuing with build...
    )
)

set "VSCE_CMD=vsce"
where vsce >nul 2>&1
if errorlevel 1 (
    where npx >nul 2>&1
    if not errorlevel 1 (
        set "VSCE_CMD=npx -y @vscode/vsce"
    ) else (
        echo [WARN] vsce not found and npx unavailable; attempting global install via npm
        call npm install -g @vscode/vsce
    )
)

for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (
    for /f "tokens=1-2 delims=/" %%c in ("%%a") do (
        set "MONTH=%%c"
        set "DAY=%%d"
    )
    set "YEAR=%%b"
)
for /f "tokens=1-2 delims=: " %%a in ('time /t') do (
    set "HOUR=%%a"
    set "MINUTE=%%b"
)
set "TIMESTAMP=%YEAR%%MONTH%%DAY%-%HOUR%%MINUTE%"

echo [INFO] Checking for required binaries...
set "MISSING_BINARIES=false"
set "SINGLE_ARCH=amd64"
set "BUN_ARCH="
for /f %%A in ('bun -e "process.stdout.write(process.arch)" 2^>nul') do set "BUN_ARCH=%%A"
if /I "%BUN_ARCH%"=="arm64" set "SINGLE_ARCH=arm64"
if /I "%BUN_ARCH%"=="x64" set "SINGLE_ARCH=amd64"
if "%BUN_ARCH%"=="" (
    if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "SINGLE_ARCH=arm64"
    if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "SINGLE_ARCH=arm64"
)
if "%SINGLE_PLATFORM%"=="true" (
    if not exist "resources\bin\windows\%SINGLE_ARCH%\opencode.exe" (
        echo [WARN] Missing binary: resources\bin\windows\%SINGLE_ARCH%\opencode.exe
        if /I "%SINGLE_ARCH%"=="amd64" (
            if exist "resources\bin\windows\arm64\opencode.exe" (
                echo [INFO] Found windows\arm64 binary. Possible shell/runtime arch mismatch.
            )
        )
        if /I "%SINGLE_ARCH%"=="arm64" (
            if exist "resources\bin\windows\amd64\opencode.exe" (
                echo [INFO] Found windows\amd64 binary. Possible shell/runtime arch mismatch.
            )
        )
        set "MISSING_BINARIES=true"
    )
) else (
    if not exist "resources\bin\windows\amd64\opencode.exe" (
        echo [WARN] Missing binary: resources\bin\windows\amd64\opencode.exe
        set "MISSING_BINARIES=true"
    )
    if not exist "resources\bin\macos\amd64\opencode" (
        echo [WARN] Missing binary: resources\bin\macos\amd64\opencode
        set "MISSING_BINARIES=true"
    )
    if not exist "resources\bin\macos\arm64\opencode" (
        echo [WARN] Missing binary: resources\bin\macos\arm64\opencode
        set "MISSING_BINARIES=true"
    )
    if not exist "resources\bin\linux\amd64\opencode" (
        echo [WARN] Missing binary: resources\bin\linux\amd64\opencode
        set "MISSING_BINARIES=true"
    )
    if not exist "resources\bin\linux\arm64\opencode" (
        echo [WARN] Missing binary: resources\bin\linux\arm64\opencode
        set "MISSING_BINARIES=true"
    )
)
if "%MISSING_BINARIES%"=="true" (
    if "%SKIP_BINARIES%"=="false" (
        if "%SINGLE_PLATFORM%"=="true" (
            echo [ERROR] Current-platform binary is missing. Packaging aborted.
        ) else (
            echo [ERROR] Some binaries are missing. Packaging aborted.
            echo [ERROR] Run 'hosts\scripts\build_opencode.bat' from the repository root and retry.
        )
        exit /b 1
    ) else (
        if "%SINGLE_PLATFORM%"=="true" (
            echo [WARN] Current-platform binary is missing. The extension may not run on this machine.
        ) else (
            echo [WARN] Some binaries are missing. The extension may not work on all platforms.
            echo [WARN] Run 'hosts\scripts\build_opencode.bat' from the repository root to build all binaries.
        )
    )
)

if "%BUILD_TYPE%"=="production" (
    call %VSCE_CMD% package --allow-missing-repository --out "opencode-vscode-%TIMESTAMP%.vsix"
) else (
    call %VSCE_CMD% package --pre-release --allow-missing-repository --out "opencode-vscode-dev-%TIMESTAMP%.vsix"
)
if errorlevel 1 exit /b 1

echo [INFO] Build completed successfully!
echo [INFO] Extension packages created in: %PLUGIN_DIR%

echo Packages created:
for %%F in ("%PLUGIN_DIR%\*.vsix") do echo   %%~nxF

endlocal
exit /b 0
