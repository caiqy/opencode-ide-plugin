# 目标

在 WebGUI 顶栏的状态面板（StatusPopover）中，新增用于管理 IDE 宿主能力（Agent Client Protocol）的「ACP」标签页；支持大类和子功能的开关控制与统一配置持久化存储（统一保存至 `opencode.json`，与 MCP、Skills 保持一致）；重构弹窗视觉层级，扩宽至 420px 并采用紧凑单行 Segmented Pill 标签栏；将 MCP、ACP、Skills 统一升级为“微质感分层卡片 + 描述展开流”，配备轻量级实时搜索过滤与子项命中智能展开功能；同时利用现有后端接口完整展示 MCP 与 Skills 的详细描述。

# 范围

- **VS Code 宿主端能力探测（hosts/vscode-plugin）**：
  - 在 `IdeBridgeServer` 与 `CommunicationBridge` 中新增 ACP 能力上报方法：
    - `getAcpCapabilities`：基于 `vscode.lm.tools` 探测 VS Code 核心及扩展工具并构建大类与子工具 Schema 清单（包含内置命令、任务与问题诊断、集成浏览器、已安装语言扩展工具等）。
- **WebGUI ideBridge 客户端封装（packages/opencode/webgui）**：
  - 在 `src/lib/ideBridge.ts` 中新增 `getAcpCapabilities` 请求封装，支持类型化交互与安全降级。
- **配置模型与存储规范（packages/core & opencode.json）**：
  - 在配置定义中支持 `acp` 顶级配置节点（结构为 `acp.<category>.enabled` 及 `acp.<category>.tools.<toolId>`），与 `mcp` 和 `permission.skill` 统一在 `opencode.json` 中持久化维护。
- **状态面板数据层重构（packages/opencode/webgui）**：
  - 在 `src/components/CompactHeader/status.ts` 中定义通用的 ACP 大类与子工具视图模型。
  - 在 `src/components/CompactHeader/useStatusPopoverData.ts` 中接入 ACP 数据获取、大类开关“记忆恢复模式”联动控制、即点即生效持久化逻辑（通过 `sdk.config.update` 写入 `opencode.json`）。
  - 扩展 MCP 与 Skills 的数据处理，提取现成后端接口已具备的 `description` 字段。
  - 支持独立浏览器模式下的空状态探测（`ideBridge.isInstalled()` 为 `false` 时安全降级）。
- **状态面板 UI 与视觉层级重构（packages/opencode/webgui）**：
  - 在 `StatusPopover.tsx` 中将弹窗宽度扩宽至 `w-[420px]`，高度上限增至 `max-h-[72vh]`。
  - 标签栏升级为紧凑单行 Segmented Pill 样式，平滑容纳 6 个 Tab（`Server | MCP | ACP | LSP | Plugins | Skills`），支持键盘左右箭头导航。
  - 提炼通用的微质感卡片组件（大类名称、状态药丸徽章如绿点 connected、工具计数胶囊如 `3/5 启用`、Master Switch、可折叠描述）。
  - 在 MCP、ACP、Skills 顶部增加轻量实时搜索过滤框；若检索词命中了子工具，自动展开对应的大类卡片。
  - MCP 面板升级为卡片流，展示 Server 描述、状态药丸、启用计数，展开显示子工具描述与独立开关。
  - Skills 面板升级为卡片流，展示技能名称、来源与完整描述文本。
- **自动化测试**：
  - 补齐 `useStatusPopoverData.test.tsx` 关于 ACP 加载、记忆恢复开关联动、搜索过滤与配置持久化的测试。
  - 补齐 `StatusPopover.test.tsx` 关于 6 个 Tab 导航、420px 容器、搜索输入与卡片展开的渲染测试。

# 非目标

- 本期不修改 OpenCode 后端核心的执行循环与提示词编译，工具调用基于标准契约抽象，后续按虚拟 MCP 适配器形式一键挂载。
- 不修改 JetBrains 宿主的 Kotlin 代码，界面基于通用 Schema 驱动，双端通用。

# 验收示例

- A1：状态面板新增 ACP 标签页，弹窗容器宽度扩至 420px，最大高度调整为 72vh，6 个 Tab 采用单行紧凑 Segmented Pill 渲染并支持键盘左右键切换。
- A2：在连接 IDE 宿主时，ACP 标签页通过 ideBridge 获取能力清单，以分层卡片展示宿主大类能力、状态徽章、已启用工具计数及一句话描述。
- A3：ACP 大类卡片支持展开与收起子功能列表；子功能列表以缩进和左边框排列，展示子工具名称、功能描述和独立开关。
- A4：操作 ACP 大类开关时采用记忆恢复模式：关闭大类时停用该分类全部子功能，重新开启大类时恢复此前保存的子功能勾选组合。
- A5：用户调整 ACP 大类或子功能开关时即点即生效，本地乐观更新并通过统一配置流程异步持久化到 opencode.json 中。
- A6：在独立外部浏览器模式下打开 WebGUI 时，ACP 标签页正常显示，内部呈现友好的空状态提示（提示未连接 IDE 宿主）。
- A7：MCP、ACP、Skills 标签页顶部均提供轻量实时搜索过滤框，支持对名称与描述进行模糊检索；命中的子功能会自动展开其所属大类卡片。
- A8：MCP 标签页视觉重构为卡片流，显示 Server 描述、状态药丸徽章（带连通性颜色）、已启用工具计数，展开后展示各子工具的功能描述与独立开关。
- A9：Skills 标签页重构为卡片流，完整渲染后端返回的技能描述文本（支持防溢出折叠），并保留启用开关。

# 约束与不变量

- 弹窗宽度保持 420px，避免在侧边栏或小屏下遮挡主对话区。
- 单行 Tab 栏必须保持轻巧紧凑，不换行，支持无障碍焦点导航。
- 遵循已有 `ideBridge` 的 HTTP/SSE 通信规范，参数异常或通信断开时静默降级不崩溃。
- 开关操作必须具备乐观更新，防止网络或 IPC 延迟造成界面卡顿。
- 配置存储格式与项目现有 `opencode.json` 的整体结构及验证规则严格兼容。

# 决策

- 已确认：新标签页定名为 `ACP`，排在 MCP 之后，表示 IDE 宿主协同能力。
- 已确认：采用 Schema 驱动架构，宿主动态上报大类与子工具清单。
- 已确认：独立浏览器模式下保留 ACP Tab 并展示未连接宿主空状态提示。
- 已确认：ACP 开关状态与 MCP、Skills 一致，统一保存在 `opencode.json` 中。
- 已确认：大类开关采用“记忆恢复模式”，开启时恢复上次的子项勾选组合。
- 已确认：弹窗扩宽至 420px，高度上限至 72vh，采用单行 Segmented Pill 导航。
- 已确认：MCP、ACP、Skills 统一采用分层卡片、微质感药丸徽章与描述展开流。
- 已确认：在 MCP、ACP、Skills 顶部提供即时搜索框，搜索命中子工具时自动展开所属大类。
- 已确认：充分利用后端已有的 `description` 字段呈现详细功能描述。

# 待解决问题

# 验证预期

- 执行 `pnpm --filter opencode-webgui test` 运行相关前端单元测试，确保现有测试及新增 ACP / 搜索 / 描述测试全部通过。
- 执行 `bun typecheck` 确保 TypeScript 类型检查通过。
- 在浏览器/Webview 中检查 420px 弹窗布局、Segmented Pill 标签栏、卡片流和搜索交互的视觉质感与边界情况。
