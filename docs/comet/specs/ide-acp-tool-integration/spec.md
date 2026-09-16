# 双端 IDE 宿主能力（ACP）适配与 AI 运行时调用

## 需求与交互目标

打通 VS Code 与 IntelliJ IDEA 双端 IDE 宿主能力（ACP, Agent Client Protocol）的展示与大模型运行时调用执行闭环：
1. **IntelliJ IDEA 宿主适配**：在 JetBrains 插件端支持 `getAcpCapabilities`（上报动作、终端、任务配置、代码问题等能力清单与 Schema）与 `executeAcpTool`（调度执行对应 IDE 操作）。
2. **VS Code 宿主适配**：在 VS Code 插件端补充 `parametersSchema` 并实现 `executeAcpTool`（调度内置命令与 `vscode.lm.invokeTool`）。
3. **环境凭据双保险直通**：宿主启动后台进程时自动注入环境变量 `OPENCODE_IDE_BRIDGE_URL` 与 `OPENCODE_IDE_BRIDGE_TOKEN`，同时 WebGUI 前端在加载时支持将 URL 携带的凭据向后端自动注册握手，对用户完全无感且零配置。
4. **OpenCode 核心层运行时装配**：在 `packages/opencode` 中动态探测宿主能力，按 `opencode.json` 开关状态将已启用的 ACP 工具注册给大模型；在模型发起 Tool Call 时通过 Bridge 转发至宿主执行并回填结果。
5. **安全降级**：独立外部浏览器或无宿主环境优雅降级，不挂载任何 ACP 工具。

## 详细行为规范

### 1. 通信协议与数据契约（IDE Bridge）

#### 请求：`getAcpCapabilities`
- **调用方**：WebGUI 或 OpenCode 后端
- **响应格式**：
  ```json
  {
    "categories": [
      {
        "id": "vscode" | "intellij" | "tasks_and_problems" | "integrated_browser" | "jupyter" | "extensions",
        "name": "string",
        "description": "string",
        "status": "connected" | "unavailable",
        "tools": [
          {
            "id": "string",
            "name": "string",
            "description": "string",
            "parametersSchema": { "type": "object", "properties": { ... } }
          }
        ]
      }
    ]
  }
  ```

#### 请求：`executeAcpTool`
- **调用方**：OpenCode 后端（大模型触发 Tool Call 时）
- **请求 Payload**：
  ```json
  {
    "category": "string",
    "toolId": "string",
    "parameters": { ... }
  }
  ```
- **响应格式**：
  ```json
  {
    "ok": true,
    "result": { "output": "执行结果文本或序列化对象" }
  }
  ```
  或者出错时：
  ```json
  {
    "ok": false,
    "error": "错误说明信息"
  }
  ```

### 2. 宿主通信凭据双保险机制（零用户配置）
- **通道 1（首选·进程自动注入）**：VS Code 插件的 `BackendLauncher.ts` 和 JetBrains 插件的 `BackendLauncher.kt` 在启动 `opencode serve` 进程时，自动注入：
  - `OPENCODE_IDE_BRIDGE_URL`：格式为 `http://127.0.0.1:{port}/idebridge/{sessionId}`
  - `OPENCODE_IDE_BRIDGE_TOKEN`：当前 session 的 token
- **通道 2（兜底·前端握手自动注册）**：WebGUI 启动时，若检测到宿主注入的 query 参数，通过服务端内部接口通知当前 OpenCode 实例更新活跃的 Bridge 地址。

### 3. OpenCode 核心层工具注册与执行（SessionTools）
- 工具命名规则：统一采用 `acp_{category}_{toolId}` 格式（字母数字下划线规范化），确保符合大模型 Tool Name 规范。
- 工具过滤：从 `Config.acp` 获取配置；如果大类未启用（`enabled: false`）或子工具未启用，不注册到 AI 上下文中。
- 工具执行：大模型产生 Tool Call 时，后端向宿主 Bridge 发送 `executeAcpTool` 请求，设定防御性超时（默认 60 秒）；获得输出后回传给会话。

## 验收场景

- Scenario: A1 JetBrains 宿主能力探测与展示对齐
  - GIVEN WebGUI 运行在 IntelliJ IDEA 插件环境中
  - WHEN 用户切换至状态面板中的 ACP 标签页
  - THEN 页面通过 ideBridge 获取 IDEA 上报的大类能力卡片（如 intellij 动作与终端、tasks_and_problems 任务与问题）
  - AND 不再呈现空状态，展示各子工具详细描述与开关控件

- Scenario: A2 VS Code 宿主端执行 ACP 工具
  - GIVEN VS Code 宿主收到 executeAcpTool 请求
  - WHEN 目标工具为内置命令（如 executeCommand）或扩展工具（通过 vscode.lm.invokeTool）
  - THEN 宿主调度执行对应操作并将文本/对象结果封装为 ok 回复

- Scenario: A3 JetBrains 宿主端执行 ACP 工具
  - GIVEN IntelliJ IDEA 宿主收到 executeAcpTool 请求
  - WHEN 目标工具为 Action 调度（如 executeAction）或问题诊断（getDiagnostics）
  - THEN 宿主在安全线程中调度执行并将结果数据以 JSON 格式封装为 ok 回复

- Scenario: A4 宿主通信凭据自动无感传递与双保险握手
  - GIVEN VS Code 或 IDEA 插件启动 opencode 后台，或 WebGUI 携带 Bridge 参数连接
  - WHEN 后台子进程启动或前端完成握手
  - THEN OpenCode 后端自动获得有效的 Bridge 地址与 Token，全流程无需用户进行任何配置

- Scenario: A5 AI 会话运行时根据配置动态装配 ACP 工具
  - GIVEN OpenCode 后端感知到宿主 Bridge 且 opencode.json 中开启了部分 ACP 工具
  - WHEN 初始化 AI 会话的模型工具清单
  - THEN 仅已启用的 ACP 工具被转换为带有正确名称、描述和参数 Schema 的 Tool 注册给模型
  - AND 未启用的工具或被关闭大类下的工具不会暴露给大模型

- Scenario: A6 大模型调用 ACP 工具端到端执行闭环
  - GIVEN AI 会话中大模型产生了 ACP 工具调用
  - WHEN OpenCode 执行循环拦截到该 Tool Call
  - THEN 后端通过 Bridge 向当前宿主发送 executeAcpTool 并等待执行结果
  - AND 执行结果安全写入 Tool Output，大模型感知到真实结果并继续生成后续回复

- Scenario: A7 独立浏览器模式安全降级
  - GIVEN OpenCode 运行在独立外部浏览器或无宿主 Bridge 的环境中
  - WHEN 创建会话并装配工具列表
  - THEN 系统安全降级且不注册任何 ACP 工具，会话正常运行无任何报错
