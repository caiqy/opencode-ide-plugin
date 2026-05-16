# VSCode 插件注入 opencode-ui User-Agent 版本设计

**日期**: 2026-05-16
**状态**: 设计已确认

## 概述

当前外部请求中的 `User-Agent` 类似：

```text
opencode/1.14.28 opencode-ui/1.14.28 (codex app)
```

其中 `opencode-ui/<版本>` 现在由 `packages/opencode/src/installation/index.ts` 中的 `InstallationVersion` 拼接。`InstallationVersion` 表示 opencode 核心后端版本，不表示 VSCode 插件版本。因此当 VSCode 插件版本与内置或系统 opencode 后端版本不一致时，UA 中的 `opencode-ui/<版本>` 会错误地显示为核心版本。

本次目标是：在 VSCode 插件启动后端时，把实际安装的 VSCode 插件版本注入给后端；后端只在收到该注入值时用它作为 `opencode-ui/<版本>`，否则保持现有 fallback 逻辑。

## 目标

1. VSCode 插件启动的后端进程中，UA 的 `opencode-ui/<版本>` 使用 VSCode 插件自身版本
2. UA 的 `opencode/<版本>` 继续使用 opencode 核心版本
3. 非 VSCode 插件入口（CLI、用户手动运行的系统 opencode）不受影响，继续使用当前 fallback
4. 保持 provider、Codex、安装检查等现有 `Installation.userAgent()` 调用点无需逐一修改
5. 用测试覆盖环境变量覆盖与 fallback 行为

## 不在范围内

- 不新增 `opencode serve` CLI 参数
- 不让后端主动读取 VSCode 插件目录或插件 `package.json`
- 不改变 `opencode/<版本>` 的语义
- 不处理 JetBrains 插件的 UA 注入；JetBrains 若后续需要，可复用同一个环境变量协议
- 不修改 UI 中显示的版本号逻辑

## 当前现状与根因

### 后端 UA 现状

`packages/opencode/src/installation/index.ts` 中定义：

```ts
const OPENCODE_USER_AGENT_PRODUCT = `opencode/${InstallationVersion}`
const INSTALLATION_USER_AGENT_PRODUCT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`
const UI_USER_AGENT_PRODUCT = `opencode-ui/${InstallationVersion}`
```

`Installation.userAgent()` 会把 `UI_USER_AGENT_PRODUCT` 固定追加到 product 列表末尾，因此所有调用都会得到 `opencode-ui/${InstallationVersion}`。

### VSCode 插件版本来源

VSCode 插件已经多处使用真实插件版本：

- `context.extension.packageJSON.version`
- `ActivityBarProvider` 和 `extension.ts` 用该版本做 WebGUI cache buster
- 更新检查也以该版本作为 `currentVersion`

说明插件版本在宿主侧是可靠且已经可用的。

### 后端启动链路

`hosts/vscode-plugin/src/backend/BackendLauncher.ts` 通过 `spawn(...)` 启动后端：

```ts
return spawn(args[0], args.slice(1), {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
  shell,
  windowsHide: true,
})
```

因此 VSCode 插件可以在启动后端时注入额外环境变量，无需改 CLI 参数或后端启动协议。

### 根因总结

根因是 `opencode-ui` UA product 使用了后端核心版本常量，而不是宿主插件版本。后端本身不知道 VSCode 插件版本，VSCode 插件也没有把该信息传入后端。

## 方案比较

### 方案 A：VSCode 插件通过环境变量注入 UI 版本（采用）

做法：

- `BackendLauncher` 保存插件版本
- 创建 `BackendLauncher` 时传入 `context.extension.packageJSON.version`
- `spawnBackend()` 的 `env` 中增加 `OPENCODE_UI_VERSION=<插件版本>`
- 后端 `Installation.userAgent()` 拼 `opencode-ui` product 时优先使用 `process.env.OPENCODE_UI_VERSION`
- 环境变量不存在或为空时回退到 `InstallationVersion`

优点：

- 改动范围小，符合现有后端进程启动方式
- 只影响 VSCode 插件启动的后端，不影响 CLI
- 系统 opencode fallback 也能收到当前插件版本，语义仍正确：UI 宿主是当前 VSCode 插件
- 不要求后端知道插件目录、publisher 或 extension ID

缺点：

- 版本来源是运行时环境变量，需要测试约束 fallback 与覆盖行为

### 方案 B：后端读取 VSCode 插件 `package.json`

不采用原因：

- 后端不知道插件安装路径
- 插件 ID、publisher、开发模式路径都可能变化
- 会让核心后端反向依赖 VSCode 插件目录结构
- 对系统 opencode 或非 VSCode 入口不稳

### 方案 C：新增 `opencode serve --ui-version <version>` 参数

不采用原因：

- 需要扩展 CLI 参数、解析逻辑与文档
- 只为一个宿主启动场景新增公开参数，范围偏大
- 环境变量已足以表达“宿主进程注入运行时元数据”

## 最终设计

## 一、环境变量协议

新增后端可识别的环境变量：

```text
OPENCODE_UI_VERSION
```

语义：

- 当值为非空字符串时，`Installation.userAgent()` 使用它拼接 `opencode-ui/<值>`
- 当值不存在或 trim 后为空时，继续使用 `InstallationVersion`
- 只影响 `opencode-ui` product，不影响 `opencode` product 或 installation-scoped base product
- VSCode 插件侧若没有有效插件版本，必须显式移除子进程 env 中继承来的 `OPENCODE_UI_VERSION`，避免父进程环境污染后端 UA

示例：

```text
OPENCODE_UI_VERSION=26.5.1602
```

得到：

```text
opencode/1.14.28 opencode-ui/26.5.1602 (codex app)
```

## 二、VSCode 插件注入设计

### BackendLauncher 构造参数

`BackendLauncher` 目前构造参数为：

```ts
constructor(extensionPath?: string)
```

改为接收可选 options：

```ts
constructor(options?: { extensionPath?: string; extensionVersion?: string })
```

保留兼容调用可通过重载或小范围更新调用点完成。推荐直接更新当前唯一主要调用点：

```ts
this.backendLauncher = new BackendLauncher({
  extensionPath: this.context!.extensionUri.fsPath,
  extensionVersion: this.context!.extension.packageJSON.version,
})
```

### spawn 环境变量

`spawnBackend()` 中将环境变量改为基于 `process.env` 合并插件版本：

```ts
env: {
  ...process.env,
  OPENCODE_UI_VERSION: this.extensionVersion,
}
```

如果 `extensionVersion` 缺失或为空，不注入该变量，避免把空值传给后端。
同时要从传给子进程的 env 中删除任何继承来的 `OPENCODE_UI_VERSION`，避免用户 shell 或 VSCode 宿主进程中已有的陈旧值覆盖 fallback 语义。

### 日志

不需要在常规日志中输出完整 UA。可选地记录：

```text
Using extension UI version: 26.5.1602
```

该值不是 secret，可以用于诊断；但不是必须。

## 三、后端 UA 设计

### 版本选择函数

在 `packages/opencode/src/installation/index.ts` 中将 `UI_USER_AGENT_PRODUCT` 从固定常量改为由函数生成：

```ts
function uiVersion() {
  const value = process.env.OPENCODE_UI_VERSION?.trim()
  return value || InstallationVersion
}

function uiUserAgentProduct() {
  return `opencode-ui/${uiVersion()}`
}
```

`userAgent()` 中使用 `uiUserAgentProduct()`，保证测试可以在运行时调整环境变量并观察结果。

### 保持调用方稳定

所有调用 `Installation.userAgent()` 的地方继续不变，包括：

- provider headers
- Codex OAuth / provider fetch
- installation latest 检查
- GitHub Copilot 相关请求

这样能确保统一 UA 语义由一个中心函数维护。

`Installation.USER_AGENT` 是模块加载时由 `userAgent({ base: "installation" })` 求值得到的常量。VSCode 插件注入方案依赖“环境变量先进入后端子进程，后端模块随后首次加载”的正常启动顺序；在这条真实链路下，`USER_AGENT` 初始化时可以读到插件版本。运行时动态修改 `process.env.OPENCODE_UI_VERSION` 不会 retroactively 更新已经初始化的 `USER_AGENT` 常量，因此测试中需要区分动态函数行为与进程启动前注入行为。

## 四、测试设计

### 后端测试

更新 `packages/opencode/test/installation/installation.test.ts`：

1. 保留原有 fallback 断言：未设置 `OPENCODE_UI_VERSION` 时仍为 `opencode-ui/${InstallationVersion}`
2. 新增覆盖断言：设置 `process.env.OPENCODE_UI_VERSION = "26.5.1602"` 时，`Installation.userAgent()` 输出 `opencode-ui/26.5.1602`
3. 覆盖 installation-scoped UA：`Installation.userAgent({ base: "installation" })` 或 `Installation.USER_AGENT` 的行为需要注意：
   - 若 `USER_AGENT` 是模块加载时常量，它不会随运行时 env 变化
   - 对运行时注入场景，进程启动前环境变量已存在，模块首次加载时可以读到
   - 为避免常量冻结问题扩大，本次推荐使 `USER_AGENT` 仍由当前 `userAgent({ base: "installation" })` 初始化；测试重点覆盖新进程加载时可用的函数行为

测试需要在 `finally` 中恢复原环境变量，避免污染同文件其他用例。

### VSCode 插件测试

若现有 VSCode 插件测试可覆盖 `BackendLauncher`，新增或扩展测试验证：

- 构造 `BackendLauncher({ extensionPath, extensionVersion: "26.5.1602" })`
- 启动后端时传给 `spawn` 的 env 包含 `OPENCODE_UI_VERSION: "26.5.1602"`
- 未提供 `extensionVersion` 时不强行注入空字符串
- 当父进程已有 `OPENCODE_UI_VERSION=stale` 但 `extensionVersion` 为空白时，子进程 env 中不应包含 `OPENCODE_UI_VERSION`

如果当前测试基础不方便 mock `child_process.spawn`，至少通过类型检查覆盖构造参数更新，并以后端 `Installation.userAgent()` 测试保证核心行为。

## 五、验收标准

1. VSCode 插件版本为 `26.5.1602`、opencode 后端版本为 `1.14.28` 时，请求 UA 中包含：

   ```text
   opencode/1.14.28 opencode-ui/26.5.1602
   ```

2. 纯 CLI / 未注入环境变量启动时，UA 仍包含：

   ```text
   opencode-ui/<InstallationVersion>
   ```

3. `opencode/<InstallationVersion>` 不被插件版本覆盖
4. 现有 `Installation.userAgent({ products: [...] })` 的 product 顺序保持：base、额外 products、`opencode-ui/...`
5. 相关测试与类型检查通过

## 风险与缓解

### 风险：环境变量污染测试

缓解：测试中保存旧值，并在 `finally` 恢复或删除。

### 风险：`USER_AGENT` 常量在模块加载时冻结

缓解：VSCode 插件会在后端进程启动前注入环境变量，后端模块加载时已经能读到。测试中对运行时变更主要覆盖 `userAgent()` 函数；如发现调用方需要动态值，再考虑把 `USER_AGENT` 改为函数或 getter。

### 风险：插件版本为空

缓解：VSCode 插件侧仅在版本为非空字符串时注入；后端侧对空白值 fallback 到 `InstallationVersion`。

## 实施顺序

1. 先写后端 failing test，证明 `OPENCODE_UI_VERSION` 当前不会覆盖 `opencode-ui` product
2. 实现后端 `uiUserAgentProduct()` 动态选择逻辑
3. 运行后端目标测试，确认 red -> green
4. 写或更新 VSCode 插件测试，证明 `BackendLauncher` 会把插件版本注入 env
5. 更新 `BackendLauncher` 构造参数和 `extension.ts` 调用点
6. 运行 VSCode 插件类型检查/测试
7. 做最终验证，确认 UA 语义与非 VSCode fallback 均正确
