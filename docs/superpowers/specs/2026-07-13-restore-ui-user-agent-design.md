---
comet_change: restore-ui-user-agent
role: technical-design
canonical_spec: openspec
archived-with: 2026-07-14-restore-ui-user-agent
status: final
---

# 恢复 UI User-Agent 技术设计

## 目标

为 OpenCode 自己构造的出站 User-Agent 恢复 `opencode-ui/<version>` 产品 token，同时保证第三方、provider 和用户显式覆盖的 User-Agent 不变。OpenSpec delta spec 是行为验收的唯一事实源；本文只描述实现边界与验证方法。

## 模块边界

在 `packages/core/src/installation/` 增加一个无副作用的 User-Agent 定制函数。Core 是最低共同依赖层，因此 Core 模型目录、Core provider/tool，以及 `packages/opencode` 都可复用该函数，而不产生 Core 反向依赖 OpenCode。

该函数接收完整 User-Agent 字符串和可选 UI 版本：

1. 读取首个空白分隔 token；它不以 `opencode/` 开头时原样返回。
2. 扫描所有 comment 外的产品 token；已存在 `opencode-ui/*` 时原样返回。comment 可出现在产品序列中间，其内部文本不参与产品判定。
3. 对显式 UI 版本去除首尾空白；没有有效值时回退 `InstallationVersion`。
4. 将 `opencode-ui/<version>` 插入现有 comment 之前；没有 comment 时追加到末尾。

插入 comment 前而非简单追加可保持 RFC 风格的产品序列在 comment 之前。例如 `opencode/1 provider/2 (linux x64)` 变为 `opencode/1 provider/2 opencode-ui/3 (linux x64)`。函数不解析或重写 comment 内容，也不全局添加 `(codex app)`。

`customizeUserAgent` 未显式传入 UI 版本时在调用时读取 `OPENCODE_UI_VERSION`。版本字符串按现有契约只 trim，不增加未要求的编码或校验规则。由它初始化的模块常量是有意的进程启动快照：VS Code 在创建 backend 子进程时已注入环境变量，因此首次加载模块即可取得正确版本；运行中修改环境变量只影响之后的函数调用，不追溯更新常量。

## OpenCode Installation 组合

`packages/opencode/src/installation/index.ts` 的 `userAgent` 保持 OpenCode UA 的组合入口，并采用以下内部签名：

```ts
userAgent(options?: { client?: string; products?: string[]; system?: string }): string
```

`client` 默认 `"cli"`，base 保持 `opencode/<channel>/<version>/<client>`；`products` 按传入顺序追加；`system` 存在时作为末尾 comment `(<system>)`。组合完成后调用 Core 定制函数，因此最终顺序是 base、附加 products、UI product、system comment。`USER_AGENT` 继续由无参数 `userAgent()` 在模块加载时生成，现有消费者不需要知道 UI 版本来源。

该 options 对象只表达当前已有三个变量，不增加 builder 或新依赖。Core 中不依赖 OpenCode 的 client/channel 组合规则。

## 调用点迁移

迁移仅发生在 OpenCode 自己写入 `opencode/...` 的构造点：

- Core：`models-dev`、provider plugin headers、WebSearch。
- OpenCode：模型目录、LLM request、provider headers、OpenAI Codex、GitHub Copilot、xAI、DigitalOcean、Snowflake Cortex、WebSearch。

能使用 `Installation.USER_AGENT` 的路径直接使用它；需要附加 provider 产品或系统 comment 的路径调用 `Installation.userAgent(...)`；Core 自身路径直接调用 Core 定制函数。这样不引入只为转发参数而存在的包装层。

以下内容明确不迁移：

- `packages/console` 的产品 UA，它不以 `opencode/` 开头或属于独立服务。
- WebFetch 兼容性路径中的裸 `opencode`，它不满足首 token `opencode/` 契约。
- SDK 或 provider 在后续 header 合并中提供的 User-Agent。

打包脚本删除 Bun `--user-agent=opencode/...` 全局默认。该参数无法读取 backend 启动时注入的 UI 版本，也会把没有显式 OpenCode 归属的第三方 fetch 标记为 OpenCode；需要 OpenCode UA 的运行时调用点必须显式使用统一入口。

## Header 顺序

默认 OpenCode User-Agent 在请求默认 headers 阶段写入，model/provider/plugin/user headers 必须后合并。不在 fetch wrapper 或全局 middleware 中再次定制。因此后置的第三方 User-Agent 继续覆盖默认值，且不会获得 UI token。

xAI 与 Snowflake 的 `Headers.set` wrapper，以及 GitHub Copilot 的 fetch wrapper 当前会在调用者 headers 之后强制写入 OpenCode UA。xAI 和 Snowflake 改为先设置默认值，再合并调用者 headers。

Copilot 接收完整 `fetch(input, init)` 形态，不能假设 `init.headers` 是普通对象。它使用原生 `Headers` 依次合并 `input instanceof Request ? input.headers : undefined` 和 `init?.headers`，让 init 保持 fetch 的后置优先级；仅在合并结果没有 `User-Agent` 时补 OpenCode 默认值。原生 `Headers` 同时处理对象、tuple array、`Headers` 实例及 header 名大小写，不增加手写归一化逻辑。

这也是不在最终请求边界做统一拦截的核心原因：最终边界无法可靠区分 OpenCode 默认值与调用者有意提供的同名 header。

## 边界行为

- 空字符串、裸 `opencode`、`third-party/1 opencode/2`：原样返回。
- `opencode/2`：追加一个 UI token。
- `opencode/2 opencode-ui/old`：完整原样返回，不替换版本。
- `opencode/2 provider/1 (linux x64)`：保留产品顺序和 comment，只在 comment 前插入 UI token。
- 缺失、空字符串或纯空白环境变量：使用 `InstallationVersion`。
- 非空环境变量：trim 后使用。

函数只处理 header 值，不负责 header 名大小写归一、请求重试或网络错误。这些仍由现有客户端负责。

## 测试策略

先在 Core 为纯函数添加表驱动失败测试，覆盖首 token 判定、第三方后置 OpenCode token、幂等、版本 trim/fallback、comment 前插入。该测试是规则的主要回归保护。

随后为 OpenCode Installation helper 添加聚焦测试，证明 base、附加 provider 产品、system comment 与 UI token 的组合顺序。Core `models-dev` 增加请求 header 集成断言。xAI、Snowflake 与 Copilot 各增加一个最终请求断言：调用者提供大小写不同的第三方 UA 时必须胜出；Copilot 用 `Request.headers` 或非对象 `HeadersInit` 覆盖其额外输入形态。其他调用点不重复纯函数测试。

验证命令从各 package 目录运行：Core 与 OpenCode 聚焦测试、各自 `bun typecheck`，最后扫描 `User-Agent` 与硬编码 `opencode/`。扫描结果逐项分类；只有上述明确排除项可以保留。

## 风险与回滚

主要风险是遗漏并行的 Core/OpenCode 构造点，以及把 UI token 放进 comment。集中纯函数、comment 边界测试和残留扫描分别覆盖这两个风险。另一个风险是认证 wrapper 强制覆盖调用者 UA；这些路径需要有意调整合并顺序，并分别通过最终网络请求测试约束。

变更无 schema、协议、持久数据或依赖迁移。回滚仅需恢复 helper 和调用点表达式，不影响已有会话或缓存格式。
