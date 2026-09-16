# WebGUI ACP 管理面板与 MCP/Skills 视觉重构

## 需求与交互目标

在 WebGUI 顶栏的状态面板（StatusPopover）中，新增用于管理 IDE 宿主能力（Agent Client Protocol）的「ACP」标签页；支持大类和子功能的开关控制与工作区持久化存储；重构弹窗视觉层级，扩宽至 420px 并采用紧凑单行 Segmented Pill 标签栏；将 MCP、ACP、Skills 统一升级为“微质感分层卡片 + 描述展开流”，配备轻量级实时搜索过滤与子项命中智能展开功能；同时利用现有后端接口完整展示 MCP 与 Skills 的详细描述。

## 详细行为规范

1. **容器尺寸与标签栏**：
   - 弹窗容器宽度扩至 `w-[420px]`，高度上限增至 `max-h-[72vh]`。
   - 标签栏采用单行紧凑 Segmented Pill 样式，包含 6 个 Tab：`Server`、`MCP`、`ACP`、`LSP`、`Plugins`、`Skills`。
   - 标签栏支持键盘 Left / Right 方向键无障碍循环切换。

2. **ACP 标签页能力展现与降级**：
   - 在已连接 IDE 宿主时，通过 `ideBridge` 动态请求 `getAcpCapabilities` 获取能力清单。
   - 每个大类卡片展示大类名称、连通性状态药丸徽章（如绿点 connected）、已启用工具计数（如 `3/5 启用`）、Master Switch 以及一句话功能描述。
   - 点击“展开/收起”可平滑展开子工具列表；子工具列表具备左侧微边框与缩进排版，清晰呈现子工具名称、详细功能描述和独立 Switch。
   - 在独立外部浏览器（未检测到 `ideBridge`）中打开时，ACP 标签常驻显示，面板内容展示友好的未连接宿主说明与指引，不报错、不闪退。

3. **开关联动与统一配置持久化**：
   - 大类开关具备“记忆恢复模式”：关闭大类时，该分类下所有子功能立即禁用；重新开启大类时，自动恢复此前保存的子项开启组合，避免重复勾选。
   - 所有开关操作均即点即生效：本地状态乐观更新，同时异步通过 `sdk.config.update` 持久化到 `opencode.json` 中，统一在项目级维护 `acp` 配置节点（结构如 `acp.<category>.enabled` 及 `acp.<category>.tools.<toolId>`），与 `mcp` 和 `permission.skill` 存储模式完全一致。

4. **实时搜索过滤与智能展开**：
   - MCP、ACP、Skills 面板顶部常驻轻量搜索输入框。
   - 输入检索词时，即时对名称与描述进行不区分大小写的模糊匹配。
   - 当检索词命中了某个大类折叠下的子工具时，大类卡片自动展开，使匹配项直观可见。
   - 清空搜索框后，卡片恢复原始折叠状态。

5. **MCP 与 Skills 视觉重构与描述补充**：
   - MCP 面板：采用统一分层卡片样式，显示服务描述、连通性状态徽章（带状态微型圆点）、已启用工具计数；展开后展示各个子工具的功能描述（`description`）与独立开关。
   - Skills 面板：采用卡片流样式，完整展示技能名称、来源徽章（如 Built-in / Project）、技能详细描述（支持超出两行时折叠展开），并保留启用开关。

## 验收场景

- Scenario: 状态面板新增 ACP 标签页与尺寸升级
  - GIVEN 用户打开 WebGUI 的状态面板
  - WHEN 面板呈现时
  - THEN 容器宽度为 420px 且最大高度为 72vh
  - AND 标签栏以单行紧凑 Segmented Pill 样式展示 Server, MCP, ACP, LSP, Plugins, Skills 共 6 个 Tab 并支持键盘左右键导航

- Scenario: 连接宿主时 ACP 呈现大类能力卡片流
  - GIVEN WebGUI 运行于 VS Code 或其他支持 ideBridge 的 IDE 环境中
  - WHEN 用户切换至 ACP 标签页
  - THEN 页面通过 ideBridge 获取宿主上报的能力列表并呈现为分层卡片
  - AND 每个大类卡片展示标题、连通性状态徽章、已启用工具计数胶囊及一句话描述

- Scenario: ACP 大类卡片展开子功能列表与描述
  - GIVEN ACP 标签页展示了大类卡片
  - WHEN 用户点击大类卡片的展开按钮
  - THEN 卡片下方展开显示缩进的子功能列表
  - AND 每个子功能展示名称、功能描述和独立开关

- Scenario: ACP 大类开关采用记忆恢复模式
  - GIVEN 某个 ACP 大类此前勾选了部分子功能
  - WHEN 用户关闭该大类 Master Switch
  - THEN 该分类下的所有子功能被禁用
  - AND 当用户重新开启该大类 Master Switch 时，自动恢复之前选中的子功能集合

- Scenario: ACP 开关即点即生效与 opencode.json 持久化
  - GIVEN 用户在 ACP 标签页中切换大类或子功能开关
  - WHEN 用户点击 Switch 控件
  - THEN 界面本地乐观更新
  - AND 系统异步调用统一配置流程将状态持久化到 opencode.json 中

- Scenario: 独立浏览器模式下 ACP 安全降级与友好空状态
  - GIVEN WebGUI 运行在未连接 IDE 宿主的独立浏览器环境中
  - WHEN 用户切换至 ACP 标签页
  - THEN 标签页正常可用且内部展示未连接 IDE 宿主的友好提示文案

- Scenario: 顶部实时搜索过滤与子项命中自动展开
  - GIVEN 用户在 MCP、ACP 或 Skills 标签页中
  - WHEN 用户在顶部搜索框输入关键词
  - THEN 列表根据关键词对标题与描述进行实时模糊过滤
  - AND 若搜索词命中了某个折叠大类下的子工具，该大类卡片自动展开并呈现匹配项

- Scenario: MCP 标签页卡片流与描述展示
  - GIVEN 用户切换至 MCP 标签页
  - WHEN 面板渲染时
  - THEN 每个 MCP 服务展示为卡片形态，包含服务描述、带连通性色彩的状态药丸与已启用工具计数
  - AND 展开后展示各子工具的完整功能描述与独立开关

- Scenario: Skills 标签页卡片流与描述展示
  - GIVEN 用户切换至 Skills 标签页
  - WHEN 面板渲染时
  - THEN 每个技能展示为卡片形态，包含技能名称、来源徽章以及后端返回的技能描述文本（支持多行折叠）
