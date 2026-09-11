# Outcome

将 WebGUI 输入框左侧原有的“+（添加文件）”按钮升级为“+（添加上下文）”菜单入口。点击后弹出轻量级上下文选项浮层，初始提供“文件”与“文件夹”两个操作项，并具备扩展其他上下文来源的结构。通过 IDE Bridge 调用宿主原生选择器获取物理绝对路径并插入输入框；通过“文件”选中的图片恢复为图片附件插入（缩略图、模型可见），其余文件继续以路径引用插入；在非 IDE 纯浏览器环境下提供安全降级，不再弹出“文件路径不可用”错误。

# Scope

- WebGUI 工具栏升级：将 `+` 按钮文案与可访问名称调整为“添加上下文”，点击后弹出选项浮层，展示“文件”和“文件夹”，并支持平滑扩展更多上下文选项。
- IDE Bridge 双向通信协议扩展：`selectFiles` 消息支持 `mode: "file" | "directory"` 与 `multiple: boolean`；新增 `readFiles` 消息，按给定路径返回文件内容（base64）。
- VSCode 插件宿主端（`hosts/vscode-plugin`）：`WebviewController` 根据 `mode` 配置 `canSelectFiles` 与 `canSelectFolders`，分别唤起文件或目录选择器并返回 `fsPath`；新增 `readFiles` 处理，按路径读取文件内容。
- JetBrains 插件宿主端（`hosts/jetbrains-plugin`）：`IdeBridge.kt` 根据 `mode` 配置 `FileChooserDescriptor` 的 `chooseFiles` / `chooseFolders`，分别唤起文件或目录选择器并返回绝对路径；新增 `readFiles` 处理，按路径读取文件内容。
- WebGUI 前端（`packages/opencode/webgui`）：
  - 点击“文件”：有 Bridge 时调用 `selectFiles({ mode: "file", multiple: true })`；无 Bridge 时触发 `<input type="file" multiple>`。
  - 点击“文件夹”：有 Bridge 时调用 `selectFiles({ mode: "directory", multiple: false })`；无 Bridge 时触发 `<input type="file" webkitdirectory>`。
  - 选中的文件按类型分流：图片通过 `readFiles` 读取内容后以图片附件（Data URL）插入，复用现有 AttachmentNode 机制呈现（72×72 缩略图）；非图片通过 `insertPaths` 插入路径引用；图片读取失败时回退为路径引用，不弹错。
  - 选中的目录通过 `pastePath` 插入 `@目录路径/` 引用。
  - 无宿主（纯浏览器）时无法获取物理路径：图片经 File API 直接转为图片附件；非图片回退文件名引用，消除阻断。
- 为 WebGUI、VSCode 插件和 JetBrains 插件补充对应自动化单元测试。

# Non-goals

- 本次不实现除“文件”与“文件夹”之外的其他上下文类型（例如 Git 变更、打开编辑器列表等，但保留结构化扩展口）。
- 不修改大模型后端解析与消费 `@路径` 节点的核心业务逻辑。
- 不改写现有的编辑器拖拽（Drag & Drop）文件处理机制。
- 非图片文件（PDF、文本、二进制等）不恢复附件形式，继续以 @路径 引用插入。

# Acceptance examples

- A1：在 VSCode 插件环境下，点击“+（添加上下文）”展开浮层，选择“文件”调出原生文件选择器，选中的非图片文件以完整绝对路径插入，工作区内文件按规范以相对路径插入。
- A2：在 VSCode 插件环境下，点击“+（添加上下文）”选择“文件夹”调出原生目录选择器，选中的外部目录以完整绝对路径插入，工作区内目录按规范以相对路径插入。
- A3：在 JetBrains 插件环境下，点击“+（添加上下文）”能分别唤起文件或目录原生选择器，并把非图片文件与目录的路径按相同规则插入输入框。
- A4：在任何 IDE 原生对话框中点击取消或关闭时，输入框保持原样，不报错、不插入空节点。
- A5：在没有 IDE Bridge 的纯浏览器环境下，选择“文件”或“文件夹”能安全降级：图片以图片附件形式插入；非图片无法获得物理路径时以名称形式插入引用；不弹出“无法获取文件路径”错误。
- A6：WebGUI 与 VSCode 插件端的新增与既有单元测试均通过，JetBrains 插件端完成源码与单测编译。
- A7：在 VSCode 与 JetBrains 插件环境下，通过“文件”选中的图片以图片附件形式插入输入框，显示缩略图，且发送消息时图片内容随消息传递给模型（与粘贴图片一致），不再插入 @路径 引用。
- A8：IDE 宿主读取图片内容失败时，该图片回退为 @路径 引用插入，不弹出错误提示。

# Constraints and invariants

- 浮层菜单交互符合现有无障碍与键盘规范（Escape 关闭、点击外部关闭、恢复焦点至触发按钮）。
- IDE Bridge 遵循现有 JSON-RPC 风格消息协议格式（`type: "selectFiles"` / `type: "readFiles"`），保持 VSCode 与 JetBrains 端参数与返回结构对齐。
- 图片附件复用现有 AttachmentNode / AttachmentComponent 呈现与发送机制，与粘贴图片保持一致的缩略图与模型可见性；`readFiles` 单文件读取失败不影响其他文件。
- 原生对话框的调起与执行必须符合各宿主 UI 线程模型（VSCode Extension Host 异步调用，JetBrains EDT 调度）。
- 菜单数据源采用清晰的结构化定义，后续扩展选项无需重构浮层组件。

# Decisions

- 已确认：`+` 按钮升级为“添加上下文”下拉菜单，初始包含“文件”与“文件夹”两项。
- 已确认：通信协议使用 `selectFiles` 并携带 `mode: "file" | "directory"`。
- 已确认：目录插入沿用 `@目录路径/` 规范（调用 `pastePath` 或目录格式的 `insertPaths`）。
- 已确认：纯浏览器无 Bridge 时安全降级，拿不到路径时以名称兜底，彻底消除弹错。
- 已确认：通过“文件”选中的图片恢复为图片附件（缩略图、模型可见），非图片文件保持 @路径 引用。
- 已确认：IDE 宿主新增 `readFiles` 协议读取图片内容，纯浏览器环境使用 File API。
- 已确认：图片内容读取失败时回退为 @路径 引用，不弹错。

# Open questions

# 验证预期

- 针对 WebGUI：测试“添加上下文”菜单弹出与关闭、点击“文件”与“文件夹”分别触发对应 Bridge 请求或降级 input，以及无物理路径时的回退引用。
- 针对 WebGUI：测试“文件”选择结果按类型分流（图片转图片附件、非图片转路径）、图片读取失败回退路径、以及无 Bridge 时图片经 File API 转附件。
- 针对 VSCode 插件：测试 `selectFiles` 在 `mode="file"` 和 `mode="directory"` 时正确设置 `canSelectFiles` 与 `canSelectFolders`，并正确返回路径或取消。
- 针对 VSCode/JetBrains 插件：测试 `readFiles` 按路径返回 base64 内容，并覆盖单文件失败场景。
- 针对 JetBrains 插件：测试 `selectFiles` 根据 `mode` 分别配置支持文件与目录选择，并正确返回路径或取消。
