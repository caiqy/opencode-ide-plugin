# 插件内图片保存修正规格

## 背景

当前图片预览弹层中的“保存”按钮由共享 WebGUI 直接调用浏览器下载逻辑：创建一个 `<a>` 元素，设置 `download` 属性后触发 `click()`。

这在普通浏览器页面中可用，但在两个插件宿主中都存在能力缺口：

- **VSCode 插件**：WebGUI 运行在 Webview 内的 iframe 中，iframe 当前未声明 `allow-downloads`；因此即使点击了 `<a download>`，下载也可能被宿主环境静默拦截。
- **JetBrains 插件**：WebGUI 运行在 JCEF 浏览器中，仓库当前没有为图片下载接入专门的宿主保存能力或下载处理器；仅依赖前端原生下载，用户点击后无报错但也无实际保存结果。

因此，当前“保存”按钮在浏览器环境可用，但在插件环境里语义不成立。

## 目标

- 修复图片预览弹层中的“保存”按钮，使其在 **VSCode 插件** 与 **JetBrains 插件** 中都能真正保存图片到用户指定位置。
- 保留普通浏览器环境中的现有下载行为，不影响网页版使用。
- 复用现有 `ideBridge` 架构，让宿主负责“选择保存路径 + 写文件”，而不是继续依赖浏览器下载能力。
- 覆盖 generated image URL 与 data URL 两类现有图片来源，避免只修一半链路。
- 为该行为补齐前端与宿主测试，防止后续回归。

## 非目标

- 不修改图片预览、缩放、拖拽本身的交互。
- 不引入“批量保存全部图片”或“记住上次保存目录”等增强能力。
- 不把保存行为改成“打开系统浏览器后用户自行另存为”。
- 不改造 `generate_image` 工具本身的输出格式或附件契约。

## 根因总结

### 1. 共享前端保存逻辑只适用于浏览器

`packages/opencode/webgui/src/components/parts/ImageOverlay.tsx` 中的保存按钮直接调用 `downloadUrl(url, alt)`；而 `packages/opencode/webgui/src/lib/fileUtils.ts` 中的 `downloadUrl()` 仅做了以下事情：

1. 必要时将 data URL 转成 blob URL。
2. 创建 `<a>` 元素。
3. 设置 `href` 与 `download`。
4. 调用 `link.click()` 触发下载。

这套逻辑默认依赖浏览器原生下载能力，没有检测当前是否运行在 IDE 插件内，也没有在失败时回退到宿主保存。

### 2. VSCode Webview iframe 缺少下载能力保障

`hosts/vscode-plugin/resources/webview/index.html` 用 iframe 承载 WebGUI，并声明了 sandbox：

- `allow-scripts`
- `allow-same-origin`
- `allow-forms`
- `allow-popups`
- `allow-modals`
- `allow-pointer-lock`
- `allow-top-navigation-by-user-activation`

但没有 `allow-downloads`。因此 `<a download>` 在该环境中不能作为可靠能力假设。

同时，VSCode 插件里 iframe 内 WebGUI 的 `ideBridge` 请求并不是走 `CommunicationBridge`，而是走 `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` 暴露的 `/idebridge/{session}/send` 通道，再由 `hosts/vscode-plugin/src/ui/WebviewController.ts` 在 `createSession()` 时注入宿主 handlers。当前这条链路只覆盖了 `openFile`、`openUrl`、`reloadPath`、`clipboardWrite`、`ensureAndOpenFile`、存储与更新相关动作，并没有“保存文件/保存图片”处理。

### 3. JetBrains 插件未提供保存图片 bridge 能力

`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 当前只支持如 `openFile`、`ensureAndOpenFile`、`openUrl`、`reloadPath`、`clipboardWrite`、更新相关请求等动作，没有任何“保存文件”动作。

`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt` 负责创建 JCEF 浏览器并加载 WebGUI，但当前仓库没有为下载行为接入专门的 JCEF 下载处理器，因此前端的 `<a download>` 不能被视为可工作的保存方案。

## 方案选择

本次采用 **插件感知的保存回退方案**：

- **浏览器环境**：继续保留当前 `<a download>` 行为。
- **插件环境**：当 `ideBridge` 已安装时，保存动作优先走宿主保存 API，而不是浏览器下载。
- **失败回退**：若宿主保存失败，再考虑回退到浏览器下载；但在插件环境中，主路径必须是 bridge，而不是先赌浏览器下载能成功。

不采用“打开系统浏览器让用户另存为”的方案，因为这会改变按钮语义并显著降低体验。

## 设计

### 1. WebGUI：新增宿主保存入口

在 `packages/opencode/webgui/src/lib/fileUtils.ts` 附近补充一个新的保存入口，职责应为：

- 对外暴露一个统一的“保存图片”函数，供 `ImageOverlay` 调用。
- 若当前 **没有** `ideBridge`，继续复用现有 `downloadUrl()`。
- 若当前 **有** `ideBridge`，改为向宿主发送保存请求。

该入口需要支持两类来源：

1. **data URL**：直接把完整 data URL 交给宿主，由宿主解码并写文件。
2. **普通 URL**（包括 `/generated-image?...`）：由宿主自行拉取 URL 内容并写文件，避免 Webview 内下载限制。

按钮组件 `ImageOverlay.tsx` 不应继续直接依赖 `downloadUrl()`，而应调用新的统一保存入口。

### 2. Bridge 协议：新增 `saveImage`

在共享 `ideBridge` 协议中新增一个请求类型，例如：`saveImage`。

请求 payload 至少需要包含：

- `url`: 图片来源 URL 或 data URL
- `filename`: 建议保存文件名

该协议约束为：

- WebGUI 发请求
- 宿主弹出保存对话框
- 用户取消时返回成功/取消语义之一，但不能静默吞掉
- 真正写入失败时返回错误，便于前端后续决定是否提示或回退

本次不要求在 UI 上额外增加保存成功 Toast；但 bridge 应有明确响应语义，方便测试。

### 3. VSCode 宿主实现

在 `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` 中新增 `saveImage` 请求类型，并在 `hosts/vscode-plugin/src/ui/WebviewController.ts` 的 `createSession()` handlers 中注入对应实现，最小实现应为：

1. 读取 `url` 和 `filename`
2. 使用 `vscode.window.showSaveDialog()` 让用户选择保存位置
3. 根据输入来源获取字节：
   - 若是 data URL：在宿主侧解码 base64
   - 若是普通 URL：在宿主侧 `fetch` 获取二进制
4. 使用 `vscode.workspace.fs.writeFile()` 写入目标路径
5. 通过现有 reply/错误语义返回结果

这样可以避免继续依赖 iframe 下载权限。

### 4. JetBrains 宿主实现

在 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 中新增 `saveImage` 分支，最小实现应为：

1. 读取 `url` 和 `filename`
2. 调起 IntelliJ 平台的保存对话框
3. 获取图片字节：
   - data URL：本地解码
   - 普通 URL：通过 HTTP 拉取
4. 写入用户选定路径
5. 返回成功或错误响应

目标是让 JetBrains 宿主具备与 VSCode 对齐的显式保存能力，而不是依赖 JCEF 对 `<a download>` 的隐式支持。

### 5. 浏览器兼容策略

为避免回归网页版：

- `downloadUrl()` 保留，继续作为浏览器 fallback。
- 新的统一保存函数只在检测到 `ideBridge.isInstalled()` 时切换到宿主保存。
- 普通浏览器不会走 bridge 分支，因此现有网页版行为保持不变。

## 错误处理

- **用户取消保存**：不视为异常崩溃；前端可不提示，也可在后续迭代中补提示，但本次至少不能误报成功。
- **bridge 不可用**：回退到 `downloadUrl()`。
- **宿主拉取 URL 或写文件失败**：返回结构化错误给前端；本次至少要保证错误可测试、可记录。
- **data URL 非法**：宿主侧直接返回错误，不写入空文件。

## 测试设计

### 前端测试

补充 `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx` 与/或 `packages/opencode/webgui/src/lib/fileUtils.test.ts`，覆盖：

1. 未安装 `ideBridge` 时，点击保存仍调用 `downloadUrl()`。
2. 已安装 `ideBridge` 时，点击保存改为请求 `saveImage`，不再直接调用浏览器下载。
3. `saveImage` bridge 失败时的回退行为符合设计。

### VSCode 测试

补充 `hosts/vscode-plugin/src/test/suite/` 下对应测试，覆盖：

1. `IdeBridgeServer` 收到 `saveImage` 请求时会路由到对应 handler。
2. data URL 会被正确解码并写入文件。
3. 普通 URL 会被获取并写入文件。
4. 用户取消保存时不会继续写文件。

### JetBrains 测试

若现有测试基建允许，补充 `IdeBridge` 的单元测试或可测试辅助函数，至少覆盖：

1. data URL 解码逻辑
2. 普通 URL 获取逻辑
3. 保存路径为空/取消时不写文件

如直接为 UI 对话框写集成测试成本过高，可将“字节解析 + 写入”提炼为可测试辅助逻辑，再对其做单元测试。

## 兼容性与风险

### 兼容性

- 浏览器环境继续使用现有下载方式。
- generated image 与 data URL 两类图片都可纳入同一保存入口。
- 不改变现有附件结构与图片展示方式。

### 风险

- VSCode/JetBrains 两端宿主保存实现细节不同，需要各自处理取消、网络读取、二进制写入。
- 如果普通 URL 在插件环境中无法被宿主直接访问，可能需要对 URL 来源做额外规范；当前已知 `/generated-image?...` 为本地后端地址，应可由宿主访问。
- 若前端把 bridge 失败后无条件回退到 `downloadUrl()`，可能再次出现“看起来点了但没保存”的静默假成功；因此回退条件必须明确。

## 成功标准

- 在 **VSCode 插件** 中，点击图片预览弹层“保存”会弹出保存对话框并成功写入图片文件。
- 在 **JetBrains 插件** 中，点击同一按钮也能完成保存。
- 在普通浏览器网页版中，现有保存行为不退化。
- data URL 与 generated image URL 至少各有一条测试覆盖保存链路。

## 实施范围

- `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- `packages/opencode/webgui/src/lib/fileUtils.ts`
- `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
- `packages/opencode/webgui/src/lib/fileUtils.test.ts`
- `packages/opencode/webgui/src/lib/ideBridge.ts`（如需补类型/帮助方法）
- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- `hosts/vscode-plugin/src/test/suite/` 下相关测试
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- JetBrains 侧相关测试或可测试辅助逻辑
