@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Opencode JetBrains Plugin Build Script
REM Standard only: bundles opencode binaries.

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"
set "PLUGIN_DIR=%ROOT_DIR%\hosts\jetbrains-plugin"
set "GRADLEW=%PLUGIN_DIR%\gradlew.bat"

set "SKIP_BINARIES=false"
set "GRADLE_VERSION_ARGS="

:parse_args
if "%~1"=="" goto args_done
if "%~1"=="--skip-binaries" (
  set "SKIP_BINARIES=true"
  shift
  goto parse_args
)
if "%~1"=="--help" (
  echo Usage: %~nx0 [OPTIONS]
  echo Options:
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
echo   Variant: standard (with binaries)

if defined PLUGIN_VERSION (
  echo [INFO] Overriding version with PLUGIN_VERSION=%PLUGIN_VERSION%
  set "GRADLE_VERSION_ARGS=-Pplugin.version=%PLUGIN_VERSION%"
)

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
call "%GRADLEW%" clean buildPlugin %GRADLE_VERSION_ARGS%
set "GRADLE_STATUS=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_STATUS%"=="0" (
  echo [ERROR] Standard JetBrains plugin build failed
  exit /b %GRADLE_STATUS%
)
echo [INFO] Standard variant built

echo [INFO] Build completed successfully
exit /b 0
