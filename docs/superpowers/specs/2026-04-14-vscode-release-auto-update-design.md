# VSCode 插件基于 GitHub Release 的自动更新设计

**日期**: 2026-04-14
**状态**: 设计已确认

## 概述

为当前项目的 VSCode 插件增加基于 GitHub Release 的更新检测与一键安装能力。更新检查由 VSCode 插件后台定时执行；当发现当前仓库有更新的 `.vsix` 发布包时，通过现有 IdeBridge 主动通知 WebGUI；用户在 WebGUI 中点击“立即更新”后，由 VSCode 插件下载 `.vsix` 到临时目录并调用 VSCode 原生命令完成安装。

本设计目标是实现“检测 + 通知 + 一键安装”，同时保持现有 WebGUI / IDE Bridge / VSCode 扩展分层不变，不让 WebGUI 直接承担下载或安装职责。

## 需求

1. **后台定时检查**：VSCode 插件激活后定时查询当前项目仓库的 GitHub Release
2. **WebGUI 展示更新提示**：发现新版本后，在 WebGUI 中展示轻量更新提示
3. **一键安装**：用户点击更新后，由 VSCode 插件自动下载并安装 `.vsix`
4. **状态可见**：WebGUI 中可看到下载中、安装中、成功、失败等状态
5. **失败可恢复**：GitHub 查询失败不打扰用户；下载/安装失败时可重试
6. **兼容现有架构**：继续复用 `IdeBridgeServer` 与 `ideBridge.ts`，不新增独立通信通道

## 方案选择

### 采用方案 A：VSCode 插件驱动，WebGUI 展示

```
VSCode 定时器 → GitHub Releases API → 发现新版本
       ↓
IdeBridgeServer 推送 updateAvailable 给 WebGUI
       ↓
WebGUI 显示更新提示条 / 卡片
       ↓
用户点击“立即更新”
       ↓
IdeBridge.request("installUpdate")
       ↓
VSCode 插件下载 .vsix → installExtension
       ↓
返回状态并提示 reload
```

### 选择理由

- **权限边界正确**：下载文件、写临时目录、调用 VSCode 安装命令都只能稳定地由 VSCode 插件承担
- **避免 WebGUI 网络限制**：GitHub API 查询放在 VSCode 侧，可避免浏览器同源、代理、CORS 等问题
- **复用现有机制**：项目已有 `IdeBridgeServer` 的 SSE 推送和请求/响应能力，适合承载更新事件与更新动作
- **符合用户期望**：检查时机明确要求由 VSCode 插件定时执行，而不是依赖 WebGUI 打开时触发

### 不采用的方案

- **WebGUI 主动发起更新查询**：依赖 webview 是否打开，且首屏会受网络请求影响
- **纯系统通知，不经过 WebGUI**：用户看不到持续状态，且与当前“WebGUI 为主要交互面板”的定位不一致
- **静默后台自动安装**：风险过高，且不符合扩展升级的用户确认预期

## 技术设计

## 一、职责边界

### VSCode 插件负责

- 定时查询当前项目 GitHub Release
- 解析最新版本与 `.vsix` 资源地址
- 对比本地已安装扩展版本与远端版本
- 将“发现新版本”事件推送给 WebGUI
- 接收 WebGUI 发起的安装请求
- 下载 `.vsix` 到临时目录
- 调用 VSCode 扩展安装命令
- 回传安装状态并在成功后提示 reload

### WebGUI 负责

- 监听来自 IdeBridge 的更新事件
- 展示可更新提示 UI
- 展示下载中 / 安装中 / 成功 / 失败状态
- 将“立即更新”“查看 Release”等用户操作通过 IdeBridge 发回 VSCode 插件

### IdeBridge 负责

- 传递 VSCode → WebGUI 的 `updateAvailable` / `updateState` 推送事件
- 传递 WebGUI → VSCode 的 `installUpdate` / `getUpdateInfo` 请求

## 二、GitHub Release 查询

### 查询接口

使用 GitHub Releases API：

```text
GET https://api.github.com/repos/<owner>/<repo>/releases/latest
```

解析字段：

- `tag_name`：版本号
- `html_url`：Release 页面地址
- `body`：Release notes
- `published_at`：发布时间
- `assets[]`：查找 `.vsix` 资源
  - `name`
  - `browser_download_url`

### 版本来源

- 本地版本：`hosts/vscode-plugin/package.json` 中的 `version`
- 远端版本：`tag_name` 去掉可选的 `v` 前缀后参与比较

### 版本比较规则

- 使用规范化的版本比较，而不是字符串比较
- `26.4.1401 > 26.4.1400` 视为有更新
- 若远端 `tag_name` 无法被解析为有效版本，本次检查记为失败并忽略，不弹 UI

### `.vsix` 资源选择

- 优先选择 `assets[]` 中 `name` 以 `opencode-vscode-` 开头且以 `.vsix` 结尾的资源
- 如果只有一个 `.vsix` 资源，则直接采用该资源
- 如果存在多个 `.vsix` 资源但都不满足预期命名，则视为解析失败并只记录日志
- 如果 release 中不存在 `.vsix` 资源，则视为“无可安装更新”，不对用户提示更新

## 三、Bridge 接口设计

### WebGUI 接收的推送事件

通过现有 `message` 事件通道新增以下 `type`：

```ts
{
  type: "updateAvailable",
  payload: {
    version: string,
    currentVersion: string,
    releaseUrl: string,
    notes?: string,
    publishedAt?: string,
  }
}
```

```ts
{
  type: "updateState",
  payload: {
    state: "idle" | "downloading" | "installing" | "success" | "error",
    version?: string,
    message?: string,
    releaseUrl?: string,
  }
}
```

### WebGUI 发起的请求

```ts
ideBridge.request("installUpdate", { version: string })
```

同时增加：

```ts
ideBridge.request("getUpdateInfo")
```

用于 WebGUI 刷新、重连或后开面板时拉取当前缓存状态，避免只依赖早先的 SSE 推送。

## 四、VSCode 插件内部模块划分

建议新增目录：`hosts/vscode-plugin/src/update/`

### 1. `ReleaseChecker.ts`

职责：

- 请求 GitHub Releases API
- 解析响应
- 提取最新版本信息与 `.vsix` 下载地址
- 返回结构化结果

建议输出结构：

```ts
type ReleaseInfo = {
  version: string
  releaseUrl: string
  notes?: string
  publishedAt?: string
  vsixUrl: string
}
```

### 2. `UpdateInstaller.ts`

职责：

- 根据 `vsixUrl` 下载 `.vsix`
- 写入临时目录
- 调用 `vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(vsixPath))`
- 返回成功/失败结果

下载目标路径建议：

```text
os.tmpdir()/opencode-ui-update/opencode-ui-<version>.vsix
```

### 3. `UpdateService.ts`

职责：

- 管理定时器
- 调用 `ReleaseChecker`
- 维护最近一次已知更新状态
- 将更新事件广播给当前 bridge session
- 响应 `installUpdate` 与 `getUpdateInfo`

## 五、缓存与状态

### 内存状态

VSCode 插件内维护当前更新状态：

```ts
type UpdateState = {
  latestVersion?: string
  currentVersion: string
  releaseUrl?: string
  notes?: string
  publishedAt?: string
  vsixUrl?: string
  state: "idle" | "downloading" | "installing" | "success" | "error"
  message?: string
}
```

### 持久化缓存

通过 `context.globalState` 保存：

```ts
{
  lastCheckedAt: number,
  latestVersion?: string,
  releaseUrl?: string,
  notes?: string,
  publishedAt?: string,
  vsixUrl?: string,
}
```

用途：

- 控制轮询节流
- WebGUI 后开时仍可读取最近一次更新信息
- 避免每次激活都立刻重复请求 GitHub

## 六、定时检查策略

- **首次检查延迟**：插件激活后固定延迟 30 秒再开始首次查询
- **轮询间隔**：每 4 小时一次
- **重复通知控制**：同一版本只在首次发现时主动推送 `updateAvailable`
- **无打扰失败策略**：GitHub 查询失败仅写日志，不主动打断用户

## 七、WebGUI 交互设计

### UI 形态

使用轻量更新提示条或卡片，不采用强打断弹窗。

### 展示内容

- 当前版本号
- 最新版本号
- 简短提示文案
- 按钮：
  - `立即更新`
  - `查看 Release`
  - 可选 `稍后`

### 状态流转

- `idle`：仅显示可更新提示
- `downloading`：显示“下载中...”并禁用重复点击
- `installing`：显示“安装中...”
- `success`：显示“安装完成，请重载 VSCode”
- `error`：显示“更新失败，请重试”

### 交互原则

- 更新检查结果应常驻在 WebGUI 中可见，不依赖瞬时系统通知
- 安装失败时保留 `releaseUrl`，允许用户降级为手动打开 Release 页面

## 八、错误处理

### GitHub 查询失败

可能原因：网络失败、限流、无 latest release、返回结构异常。

处理策略：

- 不弹用户错误提示
- 记录插件日志
- 等待下次轮询继续重试

### 找不到 `.vsix`

处理策略：

- 视为当前 release 不可自动安装
- 不对用户展示“有更新可安装”提示
- 记录日志便于排查发布流程问题

### 下载失败

处理策略：

- 将 `updateState` 置为 `error`
- WebGUI 展示“下载失败，请稍后重试”
- 保留 `releaseUrl` 作为手动更新兜底出口

### 安装失败

处理策略：

- 将 `updateState` 置为 `error`
- WebGUI 展示“安装失败，可重试”
- 插件日志记录完整错误上下文

## 九、与现有代码的集成点

### VSCode 插件侧

- 在 `extension.ts` 中初始化 `UpdateService`
- 在合适位置将当前 bridge session 注册给 `UpdateService`，便于推送更新事件
- 在 `IdeBridgeServer.ts` 的 `handleSend` 中新增：
  - `installUpdate`
  - `getUpdateInfo`

### WebGUI 侧

- 在 `packages/opencode/webgui/src/lib/ideBridge.ts` 中接收新的推送消息类型
- 新增一个轻量 store / context / hook 保存更新状态
- 新增 `UpdateBanner` 或同类组件，用于渲染更新提示与状态

## 十、不涉及范围

- 不实现 JetBrains 插件自动更新
- 不实现静默后台自动安装
- 不实现“忽略此版本”或“跳过更新”功能（但缓存结构为后续扩展预留空间）
- 不修改 opencode 服务端或 WebGUI 后端 API
- 不改变现有 IDE Bridge 通信模型

## 测试策略

1. **版本比较测试**：验证版本规范化与大小比较
2. **Release 解析测试**：验证从 GitHub 响应中提取 `.vsix` 资源与版本信息
3. **UpdateService 状态测试**：验证发现更新、重复版本去重、错误状态流转
4. **Bridge 请求测试**：验证 `installUpdate` / `getUpdateInfo` 的响应逻辑
5. **WebGUI 组件测试**：验证更新提示展示、状态切换、按钮交互
6. **手工验证**：
   - 当前版本低于 release 时显示更新提示
   - 当前版本已最新时不提示
   - 网络失败时不打断用户
   - 安装成功后显示 reload 提示
   - 下载/安装失败时可重试

## 影响分析

- **改动范围**：VSCode 插件、IdeBridge、WebGUI 三层均有改动，但都属于局部增量改动
- **风险**：中低。核心风险集中在 GitHub 响应解析、VSIX 资源命名匹配与 VSCode 安装命令行为
- **兼容性**：高。设计保持现有插件主流程不变，只增加后台更新能力
- **可扩展性**：高。后续可在当前结构上继续增加“忽略版本”“手动检查更新”“查看 changelog”等功能
