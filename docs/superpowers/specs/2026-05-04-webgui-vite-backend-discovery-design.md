# WebGUI Vite 本地后端自动发现设计

> 日期：2026-05-04
> 状态：待审阅

## 概述

为 `packages/opencode/webgui` 增加一条仅用于本地开发的联调链路：当开发者以 Vite dev server 运行 WebGUI 时，由 Vite 在 **Node 侧** 自动探测当前机器上已运行的 localhost opencode 后端，并把浏览器中的 API / SSE 请求代理到该后端。这样开发者可以通过浏览器直接打开本地 WebGUI，获得 HMR 热更新，同时继续复用当前系统里已运行的 opencode 后端。

本次设计明确不改 embedded `/app` 正式运行链路，不做浏览器侧端口扫描，也不负责自动拉起后端。若未探测到可用后端，Vite dev 必须直接启动失败并输出明确错误。

## 目标

1. **浏览器本地联调**：开发者可通过 Vite dev server 打开 WebGUI 页面并获得热更新。
2. **自动发现已运行后端**：启动 Vite 时自动发现 localhost 上已运行的 opencode backend。
3. **不依赖手工改端口**：常见场景下无需手工修改前端 base URL。
4. **失败时快速暴露问题**：找不到后端时 Vite 直接失败，而不是启动一个半可用页面。
5. **不影响正式链路**：embedded `/app`、插件内 `/app`、生产构建行为保持不变。

## 非目标

- 不做系统进程枚举或按 PID 精确识别 opencode 进程。
- 不在找不到后端时自动启动 `opencode serve` / `opencode web`。
- 不在浏览器运行时做端口扫描。
- 不修改 embedded WebGUI 的 `/app` 路由或 `packages/opencode/src/webgui/embed.generated.ts` 相关行为。
- 不把 dev-only 发现逻辑扩散进正常业务模块。

## 方案选择

采用“**Vite Node 侧自动发现 + Vite proxy 转发**”方案。

```text
启动 Vite dev
   ↓
Node 侧执行 backend discovery
   ↓
按候选端口探测 localhost opencode backend
   ↓
命中后生成 backend base URL
   ↓
Vite dev server 以 /app 提供前端资源
   ↓
浏览器请求 API / SSE
   ↓
Vite proxy 转发到已发现的 backend
```

### 选择理由

- **适合 HMR**：前端资源由 Vite 提供，代码改动可立即在浏览器可见。
- **避免浏览器限制**：端口探测放在 Node 侧，规避 CORS、超时噪音和前端首屏抖动。
- **不污染正式运行时**：探测逻辑只在 dev 启动期存在，不进入 embedded `/app`。
- **失败语义清晰**：找不到后端时直接阻止 Vite 启动，开发者能立刻看到问题。

## 备选方案与取舍

### 方案 A：Vite Node 侧发现后端并代理（采用）

- 启动 Vite 时在 Node 侧探测 localhost 后端
- 发现成功后配置 dev proxy
- 未发现则直接报错退出

优点：

- 运行时简单
- 不改浏览器侧状态机
- 最符合“只探测已运行 localhost 后端”与“找不到就失败”这两个约束

缺点：

- 只能发现可通过 HTTP 成功验证的实例
- 候选端口范围需要控制，避免过慢

### 方案 B：优先显式环境变量，找不到再自动发现（本次不采用）

- 支持 `OPENCODE_BASE_URL` 手工覆盖
- 未设置时再自动发现

优点：

- 排查问题时可手工指定

缺点：

- 增加一层分支和文档负担
- 当前用户目标是“自动探测”为主，不需要先引入覆盖入口

### 方案 C：浏览器首屏运行时扫描端口（不采用）

- 页面加载后由前端逐端口探测 localhost

优点：

- 看似前端自洽

缺点：

- 容易遇到浏览器网络限制
- 首屏体验更差
- 不符合“找不到后端时 Vite 直接失败”要求

## 技术设计

## 一、职责边界

### Vite dev 负责

- 在启动阶段调用 backend discovery
- 根据 discovery 结果配置 dev server proxy
- 在终端输出命中的 backend URL
- discovery 失败时终止启动并输出诊断信息

### discovery 模块负责

- 维护候选端口顺序
- 对候选端口发起轻量 HTTP 校验
- 判断目标是否为 opencode backend
- 返回结构化 discovery 结果或失败原因

### WebGUI 浏览器端负责

- 继续以当前 origin 请求 API / SSE
- 不感知端口扫描细节
- 不承担后端发现、重试或错误提示职责

### opencode backend 负责

- 继续提供现有 HTTP / SSE 接口
- 不为本次新增任何 dev-only 端口发现协议

## 二、发现范围与候选端口

### 发现目标

首版只探测：

- `http://127.0.0.1:<port>`

不首版支持：

- 局域网 IP
- 非 localhost 主机名
- 远程容器 / SSH 转发目标

这样能减少 DNS / hosts 差异，也更符合“当前系统中运行的本地后端”场景。

### 候选端口策略

首版推荐固定顺序：

1. `4096`
2. `4097`
3. `4098`
4. `4099`
5. `4100`

这是一个刻意收紧的固定候选列表：既覆盖默认端口及其邻近端口，又避免把 Vite 启动时间拉得过长。本次不扩展为复杂端口全量扫描器。

## 三、后端识别策略

### 校验原则

不能只通过 `/app` 返回 200 来判断，因为任意本地网页服务都可能命中该条件。必须通过 **opencode 特征 API** 做结构化校验。

### 推荐校验顺序

优先请求：

- `/global/config`

判定条件：

1. HTTP 返回成功
2. `Content-Type` 与 JSON 语义匹配
3. 返回值可解析为对象
4. 返回对象包含当前 opencode 配置结构中的关键字段，至少能证明它不是任意静态网页服务

若某端口可连但不满足结构校验，应记为“端口存在但不是目标 backend”，而不是“命中成功”。

## 四、Vite proxy 与请求路径

### 资源与接口分流

浏览器打开 Vite dev 地址后：

- `/app` 及前端静态资源由 Vite 提供
- WebGUI 发起的 API / SSE 请求继续命中当前 origin
- Vite 负责把这些请求代理到已发现的 backend

### 设计约束

- 尽量保持前端现有相对路径调用方式
- 不要求业务模块感知真实 backend 端口
- 避免把 dev 特判散落到 `sdkClient.ts` 之外的多个模块

如果现有 `sdkClient.ts` 的 `window.location.origin` 与 `/app` 路径组合会导致请求落到错误路径，则应优先在 dev 配置层修正，而不是把大量 dev 判断写进业务调用点。

## 五、失败语义与日志

### discovery 失败

当所有候选端口都未通过校验时：

- Vite dev 直接启动失败
- 终端打印：
  - 已尝试的端口列表
  - 每个端口的失败类别（连接失败 / 响应非目标 / 解析失败）
  - 最终提示“请先启动本地 opencode backend”

### 端口可连但不是 opencode

这类情况单独记录为：

- 端口响应存在
- 但接口结构校验失败

这样能帮助区分“后端没开”和“本机该端口跑了别的服务”。

### 多个候选同时命中

首版策略：

- 按候选顺序取第一个命中实例
- 终端打印最终使用的 backend URL

本次不实现多实例选择器，也不弹交互式选择。

## 六、文件边界

### 主要改动

- `packages/opencode/webgui/vite.config.ts`
- `packages/opencode/webgui/dev/discoverBackend.ts`

### 尽量不改动

- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/webgui/server/app.ts`
- `packages/opencode/src/webgui/embed.generated.ts`
- embedded `/app` 的任何正式路由逻辑

### 最小化原则

本次把变更限制在 WebGUI dev tooling 层，避免把“如何找到本地后端”这个开发时问题下沉到正式运行时代码里。

## 七、验证方案

### 手工验证

至少覆盖以下场景：

1. **存在 backend**
   - 先启动一个本地 opencode backend
   - 再启动 WebGUI Vite dev
   - 确认能成功打开页面
   - 确认页面 API / SSE 正常联通

2. **HMR 生效**
   - 修改一个 WebGUI 组件
   - 确认浏览器无需重启即可看到变化

3. **不存在 backend**
   - 不启动 opencode backend
   - 启动 Vite dev
   - 确认启动阶段直接失败，且日志明确提示发现失败

4. **错误端口占用**
   - 若某候选端口被其他服务占用
   - 确认 discovery 能识别为“非 opencode backend”而不是误连

### 自动化覆盖

若实现中把 discovery 提炼为纯函数或可注入 HTTP 请求器，建议补最小单元测试覆盖：

- 候选端口顺序
- 首个命中即停止
- 全部失败时抛出结构化错误
- 非目标 JSON 结构不会被误识别为成功

本次不要求引入端到端浏览器测试。

## 八、后续可扩展方向

以下方向确认有价值，但不属于本次范围：

- 支持显式环境变量覆盖 backend URL
- 支持自动拉起本地后端
- 支持更大的可配置扫描范围
- 支持多命中实例选择
- 支持远程 / 容器 / SSH 转发场景

## 结论

本次设计采用“Vite Node 侧自动发现已运行 localhost opencode backend，并由 Vite proxy 转发 API / SSE”的最小方案，以满足浏览器本地联调与 HMR 的需求。它把端口发现限制在开发时启动阶段，失败时快速终止，并明确不影响 embedded `/app` 正式运行链路，因此风险集中、边界清晰、适合先作为本地开发能力落地。
