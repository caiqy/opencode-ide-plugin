# Design: WebGUI 更多功能菜单新增“配置文件”入口

## 背景

当前 WebGUI 的更多功能菜单中已有“设置”入口，但缺少快速打开 OpenCode 全局配置文件的入口。用户希望在不离开当前交互的情况下，直接从菜单进入配置文件编辑。

本次需求明确为：

- 在更多功能菜单中新增“配置文件”按钮；
- 位置在“设置”上方；
- 点击后打开 `~/.config/opencode/opencode.jsonc`；
- 若目录或文件不存在，需先创建（文件创建为空文件）再打开；
- 失败时显示错误 toast；
- 打开方式优先使用 IDE（通过现有 IDE Bridge 能力）。

---

## 目标与非目标

### 目标

1. 菜单中新增“配置文件”入口，并位于“设置”上方。
2. 点击后保证可在 IDE 中打开 `~/.config/opencode/opencode.jsonc`。
3. 目录/文件不存在时自动创建：
   - `~/.config/opencode/`
   - `~/.config/opencode/opencode.jsonc`（空文件）
4. 创建或打开失败时给出明确错误提示（toast）。

### 非目标

1. 不修改 `opencode.json` 相关行为（本次固定使用 `opencode.jsonc`）。
2. 不新增命令面板命令或快捷键。
3. 不改动配置 schema、配置读取优先级或后端配置合并逻辑。

---

## 方案对比（含推荐）

### 方案 A（推荐）：Bridge 新增“确保并打开”原子能力

在 IDE Bridge 增加新消息类型（如 `ensureAndOpenFile`），由宿主端统一执行：

1. 展开 `~` 到用户目录；
2. 确保目录存在；
3. 确保文件存在（不存在则创建空文件）；
4. 打开文件。

优点：

- 逻辑原子化，避免“创建成功但打开失败后前端状态不一致”；
- 复用现有 bridge 通信模型，符合“IDE 打开”的目标路径；
- WebGUI 侧只负责触发与反馈，职责清晰。

缺点：

- 需要同时改 WebGUI 与 VSCode 插件桥接处理分支。

### 方案 B：后端 API 先确保，再由前端 `openFile`

新增服务端路由负责创建目录/文件，前端再调用现有 `openFile`。

优点：

- 文件保障逻辑集中在服务端，便于后续复用。

缺点：

- 相比 bridge 原子操作，链路更长、失败点更多；
- 需要额外 API 设计与权限边界校验。

### 方案 C：仅复用现有 `openFile`

直接打开目标路径，不做创建。

优点：

- 改动最小。

缺点：

- 不满足“文件不存在先创建再打开”的硬需求。

---

## 设计决策

采用**方案 A**：在 bridge 层实现“确保并打开”能力，WebGUI 只负责入口与错误反馈。

---

## 架构与数据流

### 1) 菜单结构变更

在 `CompactHeader/ActionButtons` 的更多功能菜单中，插入新菜单项：

- “命令面板”
- **“配置文件”（新增）**
- “设置”

并确保“配置文件”位于“设置”上方。

### 2) WebGUI 触发流程

点击“配置文件”后：

1. 触发 `handleMenuItemClick` 以保持与现有菜单行为一致（执行后关闭菜单）；
2. 调用 bridge 请求（如 `ideBridge.request("ensureAndOpenFile", { path: "~/.config/opencode/opencode.jsonc" })`）；
3. 请求失败时显示错误 toast（`打开配置文件失败`）。

### 3) VSCode Bridge 执行流程

收到 `ensureAndOpenFile` 后：

1. 校验 payload 路径；
2. 展开 `~`；
3. `mkdir -p ~/.config/opencode`；
4. 若 `opencode.jsonc` 不存在则创建空文件；
5. 复用现有 `handleOpenFile` 打开目标文件；
6. 成功回包 `ok`，失败回包 `error`。

---

## 错误处理

1. 路径非法或为空：bridge 返回错误；
2. 目录创建失败：bridge 返回错误；
3. 文件创建失败：bridge 返回错误；
4. IDE 打开失败：bridge 返回错误；
5. WebGUI 捕获失败后统一 toast：`打开配置文件失败`（可附简短错误原因）。

---

## 测试策略

### WebGUI 组件测试

1. 菜单包含“配置文件”文案；
2. “配置文件”渲染顺序位于“设置”之前；
3. 点击“配置文件”会触发对应回调并关闭菜单。

### WebGUI 行为测试

1. 点击后会调用 bridge 的 `ensureAndOpenFile`；
2. bridge 抛错时出现错误 toast。

### VSCode Bridge 测试/验证

1. 目录和文件都不存在：会创建并成功打开；
2. 目录存在文件不存在：仅创建文件并成功打开；
3. 文件已存在：直接打开且不改写文件内容。

---

## 验收标准

1. 更多功能菜单中“配置文件”位于“设置”上方；
2. 点击“配置文件”目标固定为 `~/.config/opencode/opencode.jsonc`；
3. 缺失目录/文件时会先创建（文件为空）再打开；
4. 任一失败场景下用户可见错误 toast；
5. 不影响既有“设置”、命令面板、分享等菜单行为。
