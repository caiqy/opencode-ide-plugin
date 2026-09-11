# 添加上下文菜单与 IDE 原生选择器

## 需求与交互目标

将 WebGUI 输入框左侧的“+”按钮升级为“添加上下文”（Add Context）功能。点击该按钮后展开上下文操作菜单，初始提供“文件”和“文件夹”选项，后续可无缝追加其他上下文来源。在 VSCode / JetBrains 插件宿主中，点击选项分别唤起宿主的原生文件或文件夹选择对话框，直接获取真实的本地物理绝对路径并插入输入框；通过“文件”选中的图片恢复为图片附件（缩略图、模型可见），其余文件仍以路径引用插入；在纯浏览器环境下提供安全降级，不再弹出“文件路径不可用”错误。

## 界面与交互行为

1. **触发按钮**：
   - 维持在输入框工具栏最左侧。
   - `title`、`data-tip` 和 `aria-label` 均定义为“添加上下文”。
   - 具备 `aria-haspopup="menu"` 和 `aria-expanded` 状态指示。
2. **上下文下拉菜单**：
   - 基于轻量浮层展示，定位在按钮正上方。
   - 数据源驱动，初始选项：
     - `文件`：带有文件图标，点击调出多选文件流程。
     - `文件夹`：带有文件夹图标，点击调出目录选择流程。
   - 支持 Escape 键关闭、点击外部区域自动关闭，并在关闭后安全恢复触发按钮焦点。
3. **“文件”选择结果分流**：
   - 图片文件：以图片附件插入输入框，复用现有附件机制（72×72 缩略图、右上角移除按钮，发送后模型可见图片内容），不插入 @路径 引用。
   - 非图片文件：以 `@路径` 引用插入（外部文件绝对路径，工作区内文件按规范相对路径）。
   - 图片内容读取失败：回退为 `@路径` 引用插入，不弹出错误提示。

## 通信协议扩展：selectFiles

IDE Bridge 双向通信增强 `selectFiles` 请求：

- **请求**：`type: "selectFiles"`
  - `payload.mode`：`"file" | "directory"`，缺省为 `"file"`。
  - `payload.multiple`：布尔值，是否支持多选，缺省在 `file` 时为 `true`，`directory` 时为 `false`。
- **响应成功**：
  - 未取消且有选择：`ok: true, result: { cancelled: false, paths: string[] }`
  - 用户取消选择：`ok: true, result: { cancelled: true, paths: [] }`
- **响应失败**：`ok: false, error: string`

## 通信协议扩展：readFiles

IDE Bridge 双向通信新增 `readFiles` 请求：

- **请求**：`type: "readFiles"`
  - `payload.paths`：`string[]`，待读取文件的绝对路径列表。
- **响应成功**：`ok: true, result: { files: Array<{ path: string; base64?: string; error?: string }> }`
  - 每个条目对应一个输入路径；`base64` 为文件内容；单文件读取失败时返回 `error`，不影响其他文件。
- **响应失败**：`ok: false, error: string`

## 宿主端实现

### VSCode 插件（hosts/vscode-plugin）

1. `IdeBridgeServer` 注册 `selectFiles` 路由。
2. `WebviewController` 实现 `selectFiles`：
   - 当 `mode === "directory"` 时：配置 `canSelectFiles: false`, `canSelectFolders: true`, `canSelectMany: multiple ?? false`, `openLabel: "选择文件夹"`。
   - 当 `mode === "file"` 时：配置 `canSelectFiles: true`, `canSelectFolders: false`, `canSelectMany: multiple ?? true`, `openLabel: "选择文件"`。
   - 若用户确认，返回 `paths: uris.map(u => u.fsPath)`；若取消，返回 `cancelled: true, paths: []`。
3. `WebviewController` 实现 `readFiles`：按路径读取文件内容并 base64 编码返回；单文件失败时返回该文件的 `error`，不影响其他文件。

### JetBrains 插件（hosts/jetbrains-plugin）

1. `IdeBridge.kt` 注册 `selectFiles` 处理逻辑。
2. 在 EDT 线程中调起原生文件/目录选择器：
   - 根据 `mode` 决定是选择文件还是选择文件夹。
   - 支持 `chooseFilesHook` 便于单元测试模拟。
   - 返回选中的文件或文件夹绝对路径列表。
3. 实现 `readFiles`：按路径读取文件字节并 base64 编码返回；单文件失败时返回该文件的 `error`，不影响其他文件。

## WebGUI 前端接入与降级（packages/opencode/webgui）

1. 点击“文件”：
   - 若 `ideBridge.isInstalled()`：请求 `selectFiles({ mode: "file", multiple: true })`；成功后按扩展名分流：图片请求 `readFiles` 获取内容并以图片附件（Data URL）插入，读取失败的图片回退为 `insertPaths`；非图片调用 `insertPaths(paths)` 插入路径引用。若取消则静默关闭；若出错降级触发 `<input type="file" multiple>`。
   - 若无 Bridge：触发 `<input type="file" multiple>`。图片经 File API 读取为 Data URL 后作为图片附件插入，与粘贴图片一致；非图片若拿不到 `file.path` 则回退以 `file.name` 插入引用，禁止报错弹窗。
2. 点击“文件夹”：
   - 若 `ideBridge.isInstalled()`：请求 `selectFiles({ mode: "directory", multiple: false })`，成功后调用 `pastePath(paths[0])`；若取消则静默关闭。
   - 若无 Bridge：触发带 `webkitdirectory` 的隐藏目录 input。

## 验收场景

- Scenario: 展开添加上下文菜单
  - GIVEN WebGUI 处于就绪状态
  - WHEN 用户点击工具栏的“+”按钮
  - THEN 界面展开上下文菜单，并包含“文件”和“文件夹”选项

- Scenario: VSCode 环境下选择文件
  - GIVEN WebGUI 运行于 VSCode 插件中
  - WHEN 用户在上下文菜单中点击“文件”
  - THEN 调出 VSCode 原生文件选择对话框
  - AND 选中的非图片文件以绝对路径形式插入输入框，工作区内文件按规范以相对路径插入

- Scenario: VSCode 环境下选择文件夹
  - GIVEN WebGUI 运行于 VSCode 插件中
  - WHEN 用户在上下文菜单中点击“文件夹”
  - THEN 调出 VSCode 原生文件夹选择对话框
  - AND 选中的外部文件夹以绝对路径形式插入输入框，工作区内文件夹按规范以相对路径插入

- Scenario: JetBrains 环境下原生文件与目录选择
  - GIVEN WebGUI 运行于 JetBrains 插件中
  - WHEN 用户分别点击“文件”与“文件夹”
  - THEN 调起 IDE 原生对应的选择器并将非图片文件与目录引用按相同规范插入输入框

- Scenario: 取消原生选择
  - GIVEN 用户打开了任何 IDE 的文件或目录选择对话框
  - WHEN 用户点击取消或关闭窗口
  - THEN 输入框不发生任何修改，不弹出错误提示

- Scenario: 纯浏览器环境安全降级
  - GIVEN WebGUI 运行于无 IDE Bridge 的环境
  - WHEN 用户选取文件
  - THEN 图片自动转为图片附件插入，非图片且无法获取本地真实路径时自动使用名称插入引用，不弹出“文件路径不可用”错误

- Scenario: 选择图片转为图片附件
  - GIVEN WebGUI 运行于 VSCode 或 JetBrains 插件中
  - WHEN 用户在上下文菜单中点击“文件”并选中图片
  - THEN 图片以图片附件形式插入输入框并显示缩略图
  - AND 发送消息时图片内容随消息传递给模型

- Scenario: 图片读取失败回退路径引用
  - GIVEN 用户选中的图片无法被宿主读取
  - WHEN 图片内容读取失败
  - THEN 该图片以 @路径 引用插入输入框，且不弹出错误提示
