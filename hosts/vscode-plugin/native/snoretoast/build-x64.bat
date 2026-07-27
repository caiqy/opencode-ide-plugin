@echo off
setlocal

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" exit /b 1

for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_INSTALL=%%I"
if not defined VS_INSTALL exit /b 1

call "%VS_INSTALL%\Common7\Tools\VsDevCmd.bat" -arch=amd64 -host_arch=amd64
if errorlevel 1 exit /b 1

set "CMAKE=%VS_INSTALL%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "CTEST=%VS_INSTALL%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe"
set "NINJA=%VS_INSTALL%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
for %%I in ("%~dp0.") do set "SOURCE=%%~fI"
set "BUILD=%SOURCE%\build"
set "OUTPUT=%SOURCE%\..\..\resources\windows"

if not exist "%BUILD%" mkdir "%BUILD%"
pushd "%BUILD%"
"%CMAKE%" -G Ninja "-DCMAKE_MAKE_PROGRAM=%NINJA%" -DCMAKE_BUILD_TYPE=Release -DBUILD_STATIC_RUNTIME=ON "%SOURCE%"
if errorlevel 1 (
  popd
  exit /b 1
)
"%CMAKE%" --build .
if errorlevel 1 (
  popd
  exit /b 1
)
"%CTEST%" --output-on-failure
if errorlevel 1 (
  popd
  exit /b 1
)
popd

if not exist "%OUTPUT%" mkdir "%OUTPUT%"
copy /y "%BUILD%\bin\snoretoast.exe" "%OUTPUT%\snoretoast-x64.exe" >nul
if errorlevel 1 exit /b 1
copy /y "%SOURCE%\COPYING.LGPL-3" "%OUTPUT%\snoretoast-LICENSE.txt" >nul
if errorlevel 1 exit /b 1
"%OUTPUT%\snoretoast-x64.exe" -v
exit /b %errorlevel%
