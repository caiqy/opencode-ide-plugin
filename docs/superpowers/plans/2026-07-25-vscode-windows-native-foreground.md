# VS Code Windows Native Foreground Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击 OpenCodeUI Windows toast 后，把前台权限定向转交给产生通知的 VS Code 主进程，再由现有 relay 前置准确窗口、打开 OpenCode 并切换会话。

**Architecture:** 基于 SnoreToast `v0.7.0` 维护一个最小 x64 派生版本，同时覆盖进程内 `ToastEventHandler::Invoke` 与 COM `Activate` 两条点击路径。TypeScript 通过现有 `pid` 参数传入 `process.ppid`，注册与通知发送均使用同一修改版二进制；点击后的 named pipe、`asExternalUri` relay 和会话路由保持不变。

**Tech Stack:** C++17、Win32 `AllowSetForegroundWindow`、Windows Runtime Toast API、CMake、Visual Studio Build Tools、TypeScript、`node-notifier`、Mocha、VSIX。

## Global Constraints

- 固定上游基线：KDE SnoreToast `v0.7.0`，commit `5aee2959cc107b69acbaedb3068de9d85b54666e`。
- Windows 通知身份必须保持 `caiqy.opencode-ui`；顶部为 `OpenCodeUI` 与 VS Code 小图标，正文为 `resources/icon.png`。
- 只允许 `AllowSetForegroundWindow(process.ppid)`；不得使用 `ASFW_ANY`、HWND 枚举、窗口标题匹配、PowerShell runtime 或其他窗口启发式。
- 注册与通知发送必须使用 `hosts/vscode-plugin/resources/windows/snoretoast-x64.exe`，不得混用 `node-notifier` 原版 SnoreToast。
- `AllowSetForegroundWindow` 失败时继续现有 relay；不得降级为 IDE 内通知。
- 对应 LGPL 源码与许可证保存在仓库并进入 VSIX；`native/snoretoast/build/**` 不得进入 VSIX。
- 不新增 npm 或原生运行时依赖；不重建未变化的 WebGUI、JetBrains 或 OpenCode backend。
- 版本保持 `26.7.2401`；固定包名为 `opencode-vscode-win-amd64-26.7.2401.vsix`。
- SHA-256 `EF8AB9C5E019D8FDBA06240A11F03DC69A134850647286E63CCE6EF39FBEF804` 作废。
- VS Code 全量测试允许保留唯一既有 `readUris` descriptor 基线失败，其他新增失败必须修复。
- 不提交、不推送、不创建 PR；不回退工作树中的其他改动。

---

### Task 1: Vendor and patch foreground-aware SnoreToast

**Files:**
- Create: `hosts/vscode-plugin/native/snoretoast/CMakeLists.txt`
- Create: `hosts/vscode-plugin/native/snoretoast/COPYING.LGPL-3`
- Create: `hosts/vscode-plugin/native/snoretoast/README.OpenCodeUI.md`
- Create: `hosts/vscode-plugin/native/snoretoast/build-x64.bat`
- Create: `hosts/vscode-plugin/native/snoretoast/src/CMakeLists.txt`
- Create: `hosts/vscode-plugin/native/snoretoast/src/config.h.in`
- Create from upstream: `hosts/vscode-plugin/native/snoretoast/src/linkhelper.cpp`
- Create from upstream: `hosts/vscode-plugin/native/snoretoast/src/linkhelper.h`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/main.cpp`
- Create from upstream: `hosts/vscode-plugin/native/snoretoast/src/snoretoastactioncenterintegration.h`
- Create from upstream: `hosts/vscode-plugin/native/snoretoast/src/snoretoastactions.h`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/snoretoasts.cpp`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/snoretoasts.h`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/toasteventhandler.cpp`
- Create from upstream: `hosts/vscode-plugin/native/snoretoast/src/toasteventhandler.h`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/utils.cpp`
- Create and modify from upstream: `hosts/vscode-plugin/native/snoretoast/src/utils.h`
- Test: `hosts/vscode-plugin/native/snoretoast/src/foregroundprocesstest.cpp`
- Produce: `hosts/vscode-plugin/resources/windows/snoretoast-x64.exe`
- Produce: `hosts/vscode-plugin/resources/windows/snoretoast-LICENSE.txt`
- Modify: `hosts/vscode-plugin/.vscodeignore`

**Interfaces:**
- Consumes: `-appID caiqy.opencode-ui`、`-pid <VS Code main PID>`、toast activation payload、现有 named pipe。
- Produces: `Utils::parseProcessId(std::wstring_view)`、`Utils::allowSetForegroundWindow(std::wstring_view)`、`SnoreToasts::setForegroundProcessId(const std::wstring &)`、`SnoreToasts::foregroundProcessId()` 与修改版 x64 executable。

- [ ] **Step 1: Vendor the exact upstream source baseline**

从 commit `5aee2959cc107b69acbaedb3068de9d85b54666e` 逐字复制以下文件并保留原版权头：

```text
COPYING.LGPL-3
src/config.h.in
src/linkhelper.cpp
src/linkhelper.h
src/main.cpp
src/snoretoastactioncenterintegration.h
src/snoretoastactions.h
src/snoretoasts.cpp
src/snoretoasts.h
src/toasteventhandler.cpp
src/toasteventhandler.h
src/utils.cpp
src/utils.h
```

原始文件来源固定为以下 base URL 加上述相对路径：

```text
https://raw.githubusercontent.com/KDE/snoretoast/5aee2959cc107b69acbaedb3068de9d85b54666e/
```

不复制 `examples/`、`data/` 或 `cmake/cmakerc/`。在 `main.cpp` 删除 `cmrc` include、`CMRC_DECLARE`、`getIcon()` 及 `if (image.empty()) image = getIcon();`；调用者未传 `-p` 时沿用 SnoreToast 已有的纯文本模板。

- [ ] **Step 2: Add the minimal CMake build**

创建根 `CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.8)

project(snoretoast VERSION 0.7.0)
set(SNORETOAST_CALLBACK_GUID eb1fdd5b-8f70-4b5a-b230-998a2dc19303)

option(BUILD_STATIC_RUNTIME "Link statically to the MSVC runtime" ON)

include(GenerateExportHeader)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_INCLUDE_CURRENT_DIR ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/bin)

if(BUILD_STATIC_RUNTIME AND MSVC)
  foreach(build_type DEBUG RELEASE RELWITHDEBINFO)
    string(REPLACE "/MD" "/MT" CMAKE_CXX_FLAGS_${build_type} "${CMAKE_CXX_FLAGS_${build_type}}")
  endforeach()
endif()

enable_testing()
add_subdirectory(src)
```

创建 `src/CMakeLists.txt`：

```cmake
configure_file(config.h.in config.h @ONLY)

add_library(libsnoretoast STATIC
  snoretoasts.cpp
  toasteventhandler.cpp
  linkhelper.cpp
  utils.cpp
)
target_link_libraries(libsnoretoast PUBLIC runtimeobject shlwapi user32)
target_compile_definitions(libsnoretoast
  PRIVATE UNICODE _UNICODE __WRL_CLASSIC_COM_STRICT__ WIN32_LEAN_AND_MEAN NOMINMAX
  PUBLIC __WRL_CLASSIC_COM_STRICT__
)
target_include_directories(libsnoretoast PUBLIC ${CMAKE_CURRENT_BINARY_DIR})
generate_export_header(libsnoretoast)

add_executable(snoretoast WIN32 main.cpp)
target_link_libraries(snoretoast PRIVATE libsnoretoast)
target_compile_definitions(snoretoast PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)

add_executable(snoretoast-foreground-test foregroundprocesstest.cpp)
target_link_libraries(snoretoast-foreground-test PRIVATE libsnoretoast)
target_compile_definitions(snoretoast-foreground-test PRIVATE UNICODE _UNICODE)
add_test(NAME snoretoast-foreground-test COMMAND snoretoast-foreground-test)
```

- [ ] **Step 3: Write the failing native test**

创建 `src/foregroundprocesstest.cpp`：

```cpp
#include "snoretoasts.h"
#include "utils.h"

#include <cassert>
#include <roapi.h>

int wmain()
{
    assert(!Utils::parseProcessId(L""));
    assert(!Utils::parseProcessId(L"0"));
    assert(!Utils::parseProcessId(L"-1"));
    assert(!Utils::parseProcessId(L"12x"));
    assert(Utils::parseProcessId(L"42").value() == 42);

    assert(SUCCEEDED(Windows::Foundation::Initialize(RO_INIT_MULTITHREADED)));
    {
        SnoreToasts toast(L"caiqy.opencode-ui");
        toast.setForegroundProcessId(L"42");
        const auto activation = toast.formatAction(SnoreToastActions::Actions::Clicked);
        const auto data = Utils::splitData(activation);
        assert(data.at(L"foregroundProcessId") == L"42");
    }
    Windows::Foundation::Uninitialize();
    return 0;
}
```

- [ ] **Step 4: Add the reproducible build script and verify RED**

创建 `build-x64.bat`：

```bat
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
copy /y "%SOURCE%\COPYING.LGPL-3" "%OUTPUT%\snoretoast-LICENSE.txt" >nul
"%OUTPUT%\snoretoast-x64.exe" -v
exit /b %errorlevel%
```

运行：

```powershell
& ".\native\snoretoast\build-x64.bat"
```

目录：`hosts/vscode-plugin`

预期：FAIL；`foregroundprocesstest.cpp` 找不到 `Utils::parseProcessId`、`SnoreToasts::setForegroundProcessId` 或 `foregroundProcessId` payload。

- [ ] **Step 5: Implement PID validation and directed foreground grant**

在 `utils.h` 增加 include 与声明：

```cpp
#include <optional>
#include <string_view>

std::optional<DWORD> parseProcessId(std::wstring_view value);
bool allowSetForegroundWindow(std::wstring_view processId);
```

在 `utils.cpp` 增加：

```cpp
#include <cerrno>
#include <cwchar>

std::optional<DWORD> parseProcessId(std::wstring_view value)
{
    const std::wstring input(value);
    wchar_t *end = nullptr;
    errno = 0;
    const auto pid = std::wcstoul(input.c_str(), &end, 10);
    if (errno == ERANGE || pid == 0 || pid == ASFW_ANY
        || end != input.c_str() + input.size()) {
        return {};
    }
    return static_cast<DWORD>(pid);
}

bool allowSetForegroundWindow(std::wstring_view processId)
{
    const auto pid = parseProcessId(processId);
    if (!pid) {
        tLog << L"Rejected foreground process id: " << processId;
        return false;
    }
    if (!::AllowSetForegroundWindow(*pid)) {
        tLog << L"AllowSetForegroundWindow failed for " << *pid << L": " << GetLastError();
        return false;
    }
    return true;
}
```

在 `snoretoasts.h` 增加：

```cpp
void setForegroundProcessId(const std::wstring &processId);
std::wstring foregroundProcessId() const;
```

在 `SnoreToastsPrivate` 增加：

```cpp
std::wstring m_foregroundProcessId;
```

在 `snoretoasts.cpp` 增加 getter/setter，并把 activation payload 扩为：

```cpp
void SnoreToasts::setForegroundProcessId(const std::wstring &processId)
{
    d->m_foregroundProcessId = processId;
}

std::wstring SnoreToasts::foregroundProcessId() const
{
    return d->m_foregroundProcessId;
}
```

```cpp
const auto foregroundProcessId = d->m_foregroundProcessId;
std::vector<std::pair<std::wstring_view, std::wstring_view>> data = {
    { L"action", SnoreToastActions::getActionString(action) },
    { L"notificationId", std::wstring_view(d->m_id) },
    { L"pipe", std::wstring_view(pipe) },
    { L"application", std::wstring_view(application) },
    { L"foregroundProcessId", std::wstring_view(foregroundProcessId) }
};
```

在 activation `ToastEventHandler::Invoke` 的 `SetEvent(m_event)` 前增加：

```cpp
Utils::allowSetForegroundWindow(m_toast.foregroundProcessId());
SetEvent(m_event);
```

在 `SnoreToasts::backgroundCallback` 中，必须在查找并写入 pipe 前增加：

```cpp
const auto foregroundProcessId = dataMap.find(L"foregroundProcessId");
if (foregroundProcessId != dataMap.cend()) {
    Utils::allowSetForegroundWindow(foregroundProcessId->second);
}

const auto pipe = dataMap.find(L"pipe");
```

不得在 dismissed、timeout 或 failed handler 中调用该函数。

- [ ] **Step 6: Preserve explicit app identity and store the target PID**

在 `main.cpp` 将无条件 PID AppID 查询：

```cpp
appID = getAppId(pid, appID);
```

改为显式 AppID 优先：

```cpp
if (appID.empty()) {
    appID = getAppId(pid, appID);
}
```

创建 `SnoreToasts app(appID)` 后立即保存同一个 PID：

```cpp
SnoreToasts app(appID);
app.setForegroundProcessId(pid);
app.setPipeName(pipe);
```

把 `-pid` help 文本改为：

```text
[-pid] <pid> | Target process for foreground activation; query its app id only when -appID is omitted.
```

- [ ] **Step 7: Document the fork and exclude only generated native objects**

创建 `README.OpenCodeUI.md`：

```markdown
# OpenCodeUI SnoreToast

This directory contains the corresponding source for the SnoreToast binary shipped by OpenCodeUI.

- Upstream: KDE SnoreToast v0.7.0
- Commit: `5aee2959cc107b69acbaedb3068de9d85b54666e`
- License: LGPL-3.0-or-later; see `COPYING.LGPL-3`

OpenCodeUI changes are limited to preserving an explicit AppUserModelID, carrying the VS Code main process ID in toast activation data, and calling `AllowSetForegroundWindow(pid)` before either activation callback reaches the existing named pipe. The embedded fallback icon was removed; OpenCodeUI always supplies `-p`.

Build on Windows x64 with `build-x64.bat`. The script runs the native test and writes the distributable binary and license to `resources/windows`.
```

在 `.vscodeignore` 增加：

```text
native/snoretoast/build/**
```

不要排除 `native/snoretoast/src/**`、`COPYING.LGPL-3`、README 或构建脚本。

- [ ] **Step 8: Build and verify GREEN**

运行：

```powershell
& ".\native\snoretoast\build-x64.bat"
```

目录：`hosts/vscode-plugin`

预期：CMake configure/build 成功，CTest 报 `100% tests passed, 0 tests failed`，`resources/windows/snoretoast-x64.exe` 与 `snoretoast-LICENSE.txt` 存在，`snoretoast-x64.exe -v` 退出码为 `0`。

---

### Task 2: Wire the custom binary and VS Code main PID

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`
- Modify: `hosts/vscode-plugin/src/ui/systemNotification.ts`

**Interfaces:**
- Consumes: `resources/windows/snoretoast-x64.exe` 与 Node `process.ppid`。
- Produces: Windows `NotificationOptions` 的 `customPath: string`、`pid: number`，以及同一路径执行的 `-install`。

- [ ] **Step 1: Write the failing TypeScript assertions**

在 source 与 test 的 `NotificationOptions` 中增加：

```ts
customPath?: string
pid?: number
```

在主 Windows options test 中把注册 command path 改为：

```ts
path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe")
```

把第一条通知的完整预期改为：

```ts
assert.deepStrictEqual(notifications[0]?.options, {
  title: "Agent finished",
  message: "Finished working.",
  icon: path.join(extensionUri.fsPath, "resources", "icon.png"),
  wait: true,
  sound: false,
  appID: "caiqy.opencode-ui",
  customPath: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
  pid: process.ppid,
})
```

第二条通知的完整预期为：

```ts
assert.deepStrictEqual(notifications[1]?.options, {
  title: "Permission needed",
  message: "Approve tool call.",
  icon: path.join(extensionUri.fsPath, "resources", "icon.png"),
  wait: true,
  sound: false,
  appID: "caiqy.opencode-ui",
  customPath: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
  pid: process.ppid,
})
```

- [ ] **Step 2: Run the narrow test and verify RED**

运行：

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

目录：`hosts/vscode-plugin`

预期：FAIL；注册仍指向 `node_modules/node-notifier/vendor/snoreToast`，通知 options 缺少 `customPath` 与 `pid`。

- [ ] **Step 3: Implement the minimal Windows wiring**

在 `showSystemNotification` 的 `appID` 后计算一次路径：

```ts
const appID = authority
const windowsNotifierPath =
  platform === "win32"
    ? join(input.extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe")
    : undefined
```

把现有 Windows 注册分支完整替换为：

```ts
if (windowsNotifierPath) {
  // ponytail: replacing the shortcut refreshes SnoreToast's versioned COM activator path.
  await (deps.removeWindowsShortcut ??
    (() => {
      const appData = process.env.APPDATA
      if (!appData) {
        throw new Error("APPDATA is required to register OpenCodeUI notifications")
      }
      return rm(
        join(
          appData,
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "OpenCodeUI",
          "OpenCodeUI.lnk",
        ),
        { force: true },
      )
    }))()
  await new Promise<void>((resolve, reject) => {
    (deps.runCommand ?? runCommand)(
      windowsNotifierPath,
      ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, appID],
      (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      },
    )
  })
}
```

保留现有 shortcut removal 函数体，不复制或重写。把 options 的 Windows spread 改为：

```ts
...(windowsNotifierPath
  ? {
      appID,
      customPath: windowsNotifierPath,
      pid: process.ppid,
    }
  : {}),
```

named-pipe callback、`openExternal(targetUri)`、Linux `notify-send` 和错误策略不变。

- [ ] **Step 4: Run the narrow test and verify GREEN**

运行：

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

目录：`hosts/vscode-plugin`

预期：全部 `system notification` tests 通过，测试不会执行真实快捷方式注册。

---

### Task 3: Verify, review, package, and run both native click paths

**Files:**
- Produce: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Modify: `.superpowers/sdd/task-4-report.md`
- Modify: `.superpowers/sdd/task-4-review.md`
- Modify: `.superpowers/sdd/final-review-webgui-vscode.md`
- Modify: `docs/superpowers/plans/2026-07-25-vscode-windows-notification-registration.md`

**Interfaces:**
- Consumes: Task 1 native binary/source/license、Task 2 TypeScript wiring、现有 Windows backend。
- Produces: inspected fixed-name VSIX、new SHA-256、independent review result、two-path Windows smoke evidence。

- [ ] **Step 1: Run focused and full automated verification**

运行：

```powershell
& ".\native\snoretoast\build-x64.bat"
pnpm run compile
pnpm run lint
pnpm test
```

目录：`hosts/vscode-plugin`

预期：native CTest 通过；compile 退出 `0`；lint 为 `0 errors`；notification tests 全部通过。`pnpm test` 只允许保留既有失败：

```text
WebviewController Test Suite > readUris 只把解析结果返回 webview，不通过 bridge 直接插入
TypeError: Descriptor for property stat is non-configurable and non-writable
```

- [ ] **Step 2: Request an independent read-only review**

复审范围必须包括：

```text
- explicit appID precedence over pid-derived AppUserModelID
- rejection of 0, malformed, overflow, and ASFW_ANY process IDs
- AllowSetForegroundWindow ordering in both activation paths
- no foreground grant in dismiss/timeout/failure paths
- registration and node-notifier customPath identity
- LGPL source/license/package inclusion
- no Windows/macOS/Linux regression outside the guarded win32 branch
```

所有 Critical 与 Important findings 必须修复并重新运行 Task 1/Task 2 窄测试；Minor findings记录在 review/report。

- [ ] **Step 3: Compile production output and replace the fixed-name VSIX**

运行：

```powershell
pnpm run compile:production
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
```

目录：`hosts/vscode-plugin`

预期：两条命令退出 `0`，固定名称 VSIX 被新包替换；无需重建未变化的 backend。

- [ ] **Step 4: Inspect package contents and compute the new hash**

运行以下 PowerShell 检查：

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = (Resolve-Path ".\opencode-vscode-win-amd64-26.7.2401.vsix").Path
$archive = [IO.Compression.ZipFile]::OpenRead($path)
try {
  $entries = @($archive.Entries.FullName)
  [pscustomobject]@{
    Files = $entries.Count
    Bytes = (Get-Item -LiteralPath $path).Length
    Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    NativeExe = $entries -contains "extension/resources/windows/snoretoast-x64.exe"
    NativeLicense = $entries -contains "extension/resources/windows/snoretoast-LICENSE.txt"
    CorrespondingSource = $entries -contains "extension/native/snoretoast/src/snoretoasts.cpp"
    NativeBuildObjects = @($entries -like "extension/native/snoretoast/build/*").Count
    OpenCodeRuntime = $entries -contains "extension/resources/bin/windows/amd64/opencode.exe"
    DotOpencode = @($entries -like "extension/.opencode/*").Count
    Tests = @($entries -like "extension/out/test/*").Count
  } | Format-List
} finally {
  $archive.Dispose()
}
```

预期：`NativeExe=True`、`NativeLicense=True`、`CorrespondingSource=True`、`NativeBuildObjects=0`、`OpenCodeRuntime=True`、`DotOpencode=0`、`Tests=0`；新 SHA-256 不等于 `EF8AB9C5E019D8FDBA06240A11F03DC69A134850647286E63CCE6EF39FBEF804`。

- [ ] **Step 5: Run the immediate in-process activation smoke**

1. 安装新 VSIX，打开两个不同 VS Code 窗口，并从其中一个窗口触发 OpenCode 通知。
2. 在 60 秒内点击 toast；点击前让另一个普通应用窗口遮住来源 VS Code。
3. 验证顶部身份为 `OpenCodeUI`、不创建空白 VS Code、准确来源窗口进入前台、OpenCode 面板打开且目标会话被选中。
4. 再把来源窗口最小化并重复，验证窗口恢复、前置和会话切换。

任一项失败时记录实际表现和 SnoreToast debug output，不执行 Task 3 Step 6。

- [ ] **Step 6: Run the delayed COM activation smoke**

1. 触发第二条通知后至少等待 65 秒，让原始 SnoreToast 进程退出。
2. 从 Windows Action Center 点击该通知；点击前让普通应用遮住来源 VS Code。
3. 验证顶部身份为 `OpenCodeUI`、不创建空白 VS Code、准确来源窗口进入前台、OpenCode 面板打开且目标会话被选中。

该步骤专门验证 `SnoreToastActionCenterIntegration::Activate → backgroundCallback → named pipe`，不能用 60 秒内点击结果代替。

- [ ] **Step 7: Update reports and close the old smoke checkbox**

在三个 SDD 报告中记录：

```text
- native build and CTest result
- compile/lint/full VS Code test counts
- independent review severities
- VSIX file count, byte size, and new SHA-256
- EF8AB9C5E019D8FDBA06240A11F03DC69A134850647286E63CCE6EF39FBEF804 hash is invalid
- immediate ToastEventHandler smoke result
- delayed COM activator smoke result
- minimized-window repeat result
- any remaining readUris/concurrency/platform risks
```

在 `2026-07-25-vscode-windows-notification-registration.md` 勾选 Task 2 Step 4，并补充链接到本计划和两条原生 smoke 证据。只有 Step 5 与 Step 6 均通过时，才可把当前 VSIX 标记为最终有效包。
