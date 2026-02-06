@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%..\.."
for %%I in ("%ROOT_DIR%") do set "ROOT_DIR=%%~fI"
set "PLUGIN_DIR=%ROOT_DIR%\hosts\jetbrains-plugin"
set "GRADLEW=%PLUGIN_DIR%\gradlew.bat"

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

echo [INFO] Building opencode binaries
pushd "%ROOT_DIR%" >nul
call hosts\scripts\build_opencode.bat
set "BIN_STATUS=%ERRORLEVEL%"
popd >nul
if not "%BIN_STATUS%"=="0" (
  echo [ERROR] Failed to build opencode binaries
  exit /b %BIN_STATUS%
)

echo [INFO] Building JetBrains plugin
set "GRADLE_VERSION_ARGS="
if defined PLUGIN_VERSION (
  echo [INFO] Overriding version with PLUGIN_VERSION=%PLUGIN_VERSION%
  set "GRADLE_VERSION_ARGS=-Pplugin.version=%PLUGIN_VERSION%"
)
pushd "%PLUGIN_DIR%" >nul
call "%GRADLEW%" buildPlugin %GRADLE_VERSION_ARGS% %*
set "GRADLE_STATUS=%ERRORLEVEL%"
popd >nul
if not "%GRADLE_STATUS%"=="0" (
  echo [ERROR] JetBrains plugin build failed
  exit /b %GRADLE_STATUS%
)

echo [INFO] Build completed successfully
exit /b 0
