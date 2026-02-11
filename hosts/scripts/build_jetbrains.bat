@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Opencode JetBrains Plugin Build Script
REM Supports building two variants:
REM   - Standard:  bundles opencode binaries (default)
REM   - GUI-only:  no binaries, uses system opencode, embeds webgui-dist
REM
REM By default both variants are built. Use --gui-only or --standard-only to
REM build a single variant.

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"
set "PLUGIN_DIR=%ROOT_DIR%\hosts\jetbrains-plugin"
set "GRADLEW=%PLUGIN_DIR%\gradlew.bat"
set "WEBGUI_DIR=%ROOT_DIR%\packages\opencode\webgui"
set "WEBGUI_DIST=%ROOT_DIR%\packages\opencode\webgui-dist"

set "BUILD_STANDARD=true"
set "BUILD_GUI_ONLY=true"
set "SKIP_BINARIES=false"

:parse_args
if "%~1"=="" goto args_done
if "%~1"=="--gui-only" (
  set "BUILD_STANDARD=false"
  set "BUILD_GUI_ONLY=true"
  shift
  goto parse_args
)
if "%~1"=="--standard-only" (
  set "BUILD_STANDARD=true"
  set "BUILD_GUI_ONLY=false"
  shift
  goto parse_args
)
if "%~1"=="--skip-binaries" (
  set "SKIP_BINARIES=true"
  shift
  goto parse_args
)
if "%~1"=="--help" (
  echo Usage: %~nx0 [OPTIONS]
  echo Options:
  echo   --gui-only        Build only the gui-only variant (no binaries)
  echo   --standard-only   Build only the standard variant (with binaries)
  echo   --skip-binaries   Skip building backend binaries
  echo   --help            Show this help message
  exit /b 0
)
shift
goto parse_args
:args_done

if not exist "%PLUGIN_DIR%" (
  echo [ERROR] JetBrains plugin directory not found at %PLUGIN_DIR%
  exit /b 1
)

if not exist "%GRADLEW%" (
  echo [ERROR] gradlew.bat not found at %GRADLEW%
  exit /b 1
)

echo Opencode JetBrains Plugin Build Script
echo Plugin directory: %PLUGIN_DIR%
if "%BUILD_STANDARD%"=="true" echo   Variant: standard (with binaries)
if "%BUILD_GUI_ONLY%"=="true" echo   Variant: gui-only (system opencode)

REM ─── Standard variant ──────────────────────────────────────────────────

if not "%BUILD_STANDARD%"=="true" goto skip_standard

echo [INFO] Building standard variant

if "%SKIP_BINARIES%"=="true" goto skip_std_binaries
echo [INFO] Building opencode binaries
pushd "%ROOT_DIR%" >nul
call hosts\scripts\build_opencode.bat
set "BIN_STATUS=%ERRORLEVEL%"
popd >nul
if not "%BIN_STATUS%"=="0" (
  echo [ERROR] Failed to build opencode binaries
  exit /b %BIN_STATUS%
)
:skip_std_binaries

pushd "%PLUGIN_DIR%" >nul
call "%GRADLEW%" clean buildPlugin
set "GRADLE_STATUS=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_STATUS%"=="0" (
  echo [ERROR] Standard JetBrains plugin build failed
  exit /b %GRADLE_STATUS%
)
echo [INFO] Standard variant built

:skip_standard

REM ─── GUI-only variant ──────────────────────────────────────────────────

if not "%BUILD_GUI_ONLY%"=="true" goto skip_gui_only

echo [INFO] Building gui-only variant

if not exist "%WEBGUI_DIST%" (
  echo [INFO] Building webgui...
  pushd "%WEBGUI_DIR%" >nul
  if exist "node_modules\.bin\vite" (
    call npm run build
  ) else (
    call npm install
    call npm run build
  )
  popd >nul
)

if not exist "%WEBGUI_DIST%" (
  echo [ERROR] webgui-dist not found at %WEBGUI_DIST% after build
  exit /b 1
)

pushd "%PLUGIN_DIR%" >nul
call "%GRADLEW%" buildPlugin -PguiOnly=true "-PwebguiDist=%WEBGUI_DIST%"
set "GRADLE_STATUS=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_STATUS%"=="0" (
  echo [ERROR] GUI-only JetBrains plugin build failed
  exit /b %GRADLE_STATUS%
)
echo [INFO] GUI-only variant built

:skip_gui_only

echo [INFO] Build completed successfully
exit /b 0
