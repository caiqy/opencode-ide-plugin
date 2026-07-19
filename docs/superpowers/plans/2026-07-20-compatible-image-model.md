---
change: compatible-image-model
design-doc: docs/superpowers/specs/2026-07-19-compatible-image-model-design.md
base-ref: a5defaf2d4adc70abeca45dd785527e4b678f08d
---

# 兼容图片默认模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 实施 agent 不勾选本计划或 OpenSpec checkbox，由主会话协调者在验证证据齐全后统一勾选。

**目标：** 让 `generate_image` 从模型 `options.defaultForImageGeneration` 解析优先默认模型，同时保留顶层 `image_model` 回退，使迁移后的配置可被官方 OpenCode schema 严格接受。

**架构：** `packages/opencode/src/tool/generate-image/config.ts` 新增不依赖服务的 `resolveConfiguredImageModel`，仅扫描合并后 `cfg.provider` 的显式对象键。`GenerateImageTool.execute` 只在 provider/model 没有完整提供时调用它，再复用 `resolveModelParts` 和原有 provider、adapter、permission 链路；完整参数绕过 marker 的读取与校验。

**技术栈：** TypeScript、Bun test、Effect、现有 `ConfigV1`/`ConfigProviderV1` schema、jsonc-parser、官方 `https://opencode.ai/config.json` JSON Schema。

## 全局约束

- 不新增运行时或开发依赖，不修改公开 schema、Protocol/HttpApi、Provider catalog 或配置深合并，不运行 `bun run generate`，不编辑 SDK/generated 源码。
- marker 仅位于 `provider.<provider>.models.<model>.options.defaultForImageGeneration`；以 provider/model 对象键构成默认值，不读取 `model.id`，不扫描动态 catalog。
- marker 只能是布尔值：缺失/`false` 忽略，唯一 `true` 优先于旧 `image_model`，多个 `true` 按 `provider/model` 排序后明确失败。
- 项目层替换全局 marker 必须显式将继承项设为 `false`，再将目标设为 `true`；不引入特殊删除或合并语义。
- 所有 package 测试和 `bun typecheck` 均从 `packages/opencode` 执行，绝不从仓库根运行测试。发布内容同步从仓库根执行。
- 实施 agent 每个任务仅暂存该任务允许的文件；Comet、OpenSpec、Design Doc 和计划协调产物由主会话另行提交，实施 agent 不暂存它们。

## 文件范围

- `packages/opencode/src/tool/generate-image/config.ts`：marker resolver 和新错误引导。
- `packages/opencode/src/tool/generate-image.ts`：`GenerateImageTool.execute` 的惰性默认值接线与参数说明。
- `packages/opencode/test/tool/generate-image-config.test.ts`：解析、合并和错误契约。
- `packages/opencode/test/tool/generate-image.test.ts`：真实工具接线回归。
- `samples/opencode.jsonc`、`docs/release-content/README.shared.md`、`docs/release-content/description.shared.md`：迁移样例与用户说明。
- `hosts/vscode-plugin/README.md`、`hosts/jetbrains-plugin/README.md`、`hosts/jetbrains-plugin/description.html`：只由 `bun run release-content:sync` 生成。

### Task 1: Marker resolver 测试与实现闭环

**OpenSpec 映射：**
- `1.1 扩展 generate-image-config 测试，覆盖唯一标记、对象键寻址、新标记优先、旧字段回退和完整工具参数绕过默认值`（本任务完成 resolver 相关部分；工具级绕过回归在 Task 2 完成后由协调者勾选）。
- `1.2 增加非布尔标记、多个启用标记、false 标记、项目层显式覆盖及缺失默认值场景`
- `2.1 从显式 cfg.provider 模型节点解析唯一的 defaultForImageGeneration 标记，并生成 provider/model 默认值`

**文件：**
- 修改：`packages/opencode/test/tool/generate-image-config.test.ts:8-215`
- 修改：`packages/opencode/src/tool/generate-image/config.ts:1-60`

**产出接口：** `resolveConfiguredImageModel(provider: ConfigV1.Info["provider"], imageModel?: string): string | undefined`；它只接收显式 provider 配置和旧字段值。

- [x] **Task 1 / Step 1: 写入 resolver 的失败测试**

在现有 config helper import 中加入 `resolveConfiguredImageModel`，用纯函数测试锁定以下输入输出：

```ts
expect(
  resolveConfiguredImageModel(
    { openai: { models: { "gpt-image-2": { id: "api-image-id", options: { defaultForImageGeneration: true } } } } },
    "legacy/image",
  ),
).toBe("openai/gpt-image-2")

expect(resolveConfiguredImageModel({ openai: { models: { "gpt-image-2": { options: {} } } } }, "legacy/image")).toBe(
  "legacy/image",
)
expect(resolveConfiguredImageModel({ openai: { models: { "gpt-image-2": { options: { defaultForImageGeneration: false } } } } }, undefined)).toBe(
  undefined,
)
```

再加入：字符串 marker 抛出 `provider.openai.models.gpt-image-2.options.defaultForImageGeneration must be a boolean`；以 `zeta/image-z`、`alpha/image-a` 的逆序输入断言歧义错误稳定列出 `alpha/image-a, zeta/image-z`；无 marker/无 legacy 返回 `undefined`。

使用已有 `tmpdir`、`Instance.provide` 和 `getConfig()` 增加严格加载测试，断言开放 `options` 保留 `defaultForImageGeneration: true`。项目层覆盖使用 `packages/opencode/test/config/config.test.ts:167-210` 已有 `withGlobalConfigDir`/`withConfigTree` 的同等 setup：全局写 `gpt-image-2: true`，项目写 `gpt-image-2: false` 和 `gpt-image-3: true`，读取合并后的 `config.provider` 后断言 resolver 返回 `openai/gpt-image-3`；省略 false 的反例必须报多默认歧义。

- [x] **Task 1 / Step 2: 运行 RED 证据**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image-config.test.ts`

Expected: FAIL，报 `resolveConfiguredImageModel` 未导出或 marker 行为未实现；原有 `resolveModelParts`、adapter、credential 测试继续可执行。

- [x] **Task 1 / Step 3: 实现最小纯 resolver**

在 `imageModelGuidance` 和 `resolveModelParts` 之间导出函数。参数类型从 `ConfigV1.Info["provider"]` 推导；只扫描 `Object.entries(provider ?? {})` 和每个 `provider.models ?? {}`。核心判断为：

```ts
const value = model.options?.defaultForImageGeneration
const path = `provider.${providerID}.models.${modelID}.options.defaultForImageGeneration`
if (value === undefined || value === false) return []
if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`)
return [`${providerID}/${modelID}`]
```

收集启用项后：0 个返回 legacy `imageModel`；1 个返回该对象键组合；多个先 `.sort()` 再抛出包含全部冲突项的错误。不得导入 `Config.Service` 或 `Provider.Service`，不得创建新 schema、服务或配置类型。

- [x] **Task 1 / Step 4: 运行 GREEN 证据和最小范围检查**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image-config.test.ts`

Expected: PASS；唯一 marker、对象键而非 API id、优先/回退、`false`、类型错误、排序歧义、项目层显式 false 和缺失默认值全部通过，原有覆盖矩阵不回归。

工作目录：仓库根

Run: `git diff --check -- packages/opencode/src/tool/generate-image/config.ts packages/opencode/test/tool/generate-image-config.test.ts`

Expected: exit 0，未触及 `packages/core` schema 或 Config 合并代码。

- [x] **Task 1 / Step 5: 提交闭环（实施 agent 执行）**

```bash
git add packages/opencode/src/tool/generate-image/config.ts packages/opencode/test/tool/generate-image-config.test.ts
git commit -m "feat(opencode): resolve configured image model"
```

Expected: 提交后本任务分支为绿；暂存区不包含计划、OpenSpec、Design Doc 或其他协调文件。

### Task 2: GenerateImageTool 接线测试与实现闭环

**OpenSpec 映射：**
- `1.1 扩展 generate-image-config 测试，覆盖唯一标记、对象键寻址、新标记优先、旧字段回退和完整工具参数绕过默认值`（本任务完成完整工具参数绕过部分）。
- `2.2 将兼容默认值接入 GenerateImageTool，保留现有参数覆盖和旧 image_model 回退语义`

**文件：**
- 修改：`packages/opencode/test/tool/generate-image.test.ts:782-1346`
- 修改：`packages/opencode/src/tool/generate-image.ts:10,23-27,92-101`

**消费接口：** Task 1 的 `resolveConfiguredImageModel(cfg.provider, cfg.image_model)` 和现有 `resolveModelParts({ imageModel, provider, model })`。

- [ ] **Task 2 / Step 1: 写入工具接线的失败测试**

在 `describe("generate_image tool", ...)` 中，复用 `providerLayer`、`initTool`、`provideTmpdirInstance` 与本地 `Bun.serve`。添加未提供 provider/model 的调用，项目 config 为：

```ts
{
  provider: {
    openai: {
      models: { "gpt-image-2": { options: { defaultForImageGeneration: true } } },
    },
  },
}
```

断言 request JSON 的 `model` 是 `gpt-image-2`，permission `patterns` 是 `["openai/gpt-image-2"]`，result metadata 含同一 provider/model。再添加完整 `{ provider: "openai", model: "gpt-image-2" }` 调用，配置带两个 `true` 或一个字符串 marker；断言 handler 成功收到 `gpt-image-2`，没有默认 marker 错误。

- [ ] **Task 2 / Step 2: 运行 RED 证据**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image.test.ts`

Expected: 未提供工具覆盖的 marker 选择用例 FAIL；完整 provider+model 绕过用例可 PASS，作为既有恢复通道的回归保护。

- [ ] **Task 2 / Step 3: 接入惰性默认值解析**

将 resolver 加入 `./generate-image/config` import。在 `const cfg = yield* config.get()` 后写入：

```ts
const imageModel = providerOverride && modelOverride ? undefined : resolveConfiguredImageModel(cfg.provider, cfg.image_model)
const modelParts = resolveModelParts({ imageModel, provider: providerOverride, model: modelOverride })
```

完整参数时绝不调用 resolver；只有一个覆盖参数时仍交由既有 `resolveModelParts` 矩阵处理。将 `Parameters.model` 的 description 从 `configured image_model` 改为 `configured default image model`，但不改变参数 schema 结构。

- [ ] **Task 2 / Step 4: 运行 GREEN 证据**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image.test.ts test/tool/generate-image-config.test.ts`

Expected: PASS；marker 自动选择、显式参数绕过、旧 `image_model` 回退、permission metadata、编辑输入和图片落盘回归全部通过，所有 API 调用仍由测试的 `Bun.serve` 处理。

- [ ] **Task 2 / Step 5: 提交闭环（实施 agent 执行）**

```bash
git add packages/opencode/src/tool/generate-image.ts packages/opencode/test/tool/generate-image.test.ts
git commit -m "feat(opencode): use image model marker in tool"
```

Expected: 提交后分支为绿，且不暂存 Task 1 以外的协调产物。

### Task 3: 错误提示测试与实现闭环

**OpenSpec 映射：**
- `2.3 更新缺失、无效和歧义错误，使其指向新配置形态及冲突模型`

**文件：**
- 修改：`packages/opencode/test/tool/generate-image-config.test.ts:117-215`
- 修改：`packages/opencode/src/tool/generate-image/config.ts:7,14-59,154-173`

**消费接口：** Task 1 的类型/歧义错误与 Task 2 的惰性解析路径。

- [ ] **Task 3 / Step 1: 写入错误引导的失败断言**

把当前匹配 `configure { "image_model": "openai/gpt-image-2" }` 的缺失/仅 provider/仅 model 断言改为要求新 marker 示例和 `or pass provider and model`。固定示例包含：

```text
provider.openai.models.gpt-image-2.options.defaultForImageGeneration: true
```

保留 malformed legacy `image_model` 的验证语义，但不再把旧字段作为新用户的首选配置示例；为 provider 覆盖默认 provider 的错误也要求新引导。

- [ ] **Task 3 / Step 2: 运行 RED 证据**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image-config.test.ts`

Expected: FAIL，仅因旧 `imageModelGuidance`/provider override 文案不符合新断言；Task 1 的解析行为仍 PASS。

- [ ] **Task 3 / Step 3: 最小化更新错误文案**

将 `imageModelGuidance` 改为 marker 配置加完整参数替代方案，使 `resolveModelParts` 的缺失分支复用该常量。保留 `model is required when provider overrides image_model provider` 的行为，但附加相同新引导。不得新增旧字段的运行时弃用警告，非布尔和歧义错误继续分别给出完整路径和排序冲突项。

- [ ] **Task 3 / Step 4: 运行 GREEN 证据**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image-config.test.ts test/tool/generate-image.test.ts`

Expected: PASS；缺失、局部覆盖、非布尔和歧义错误都指向 marker，完整参数仍是恢复路径，全部工具回归通过。

- [ ] **Task 3 / Step 5: 提交闭环（实施 agent 执行）**

```bash
git add packages/opencode/src/tool/generate-image/config.ts packages/opencode/test/tool/generate-image-config.test.ts
git commit -m "fix(opencode): clarify image model configuration errors"
```

Expected: 提交后分支为绿，且本提交只包含错误契约及其实现。

### Task 4: 样例、发布内容与迁移语义闭环

**OpenSpec 映射：**
- `3.1 将样例配置和 VS Code、JetBrains、发布说明中的顶层 image_model 示例迁移为 provider model 标记`
- `3.2 记录旧字段的过渡兼容、新标记优先级和官方版仅保证正常加载的边界`

**文件：**
- 修改：`samples/opencode.jsonc:1-112`
- 修改：`docs/release-content/README.shared.md:19-35`
- 修改：`docs/release-content/description.shared.md:17-32`
- 生成：`hosts/vscode-plugin/README.md`、`hosts/jetbrains-plugin/README.md`、`hosts/jetbrains-plugin/description.html`

- [ ] **Task 4 / Step 1: 记录变更前失败基线**

工作目录：仓库根

Run:

```powershell
rg -n '"image_model"\s*:|`image_model`:' samples/opencode.jsonc docs/release-content hosts/vscode-plugin/README.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html
```

Expected: exit 0；输出样例和发布内容中的旧顶层键值示例。此命令是迁移前证据，不是测试失败。

- [ ] **Task 4 / Step 2: 一次完成样例和 shared 文档迁移**

从 `samples/opencode.jsonc` 删除顶层 `image_model`。在既有 `provider.openai.models["gpt-image-2"].options` 保留 `imageApi: "openai-compatible"`，并加入：

```jsonc
"defaultForImageGeneration": true,
```

在两个 `docs/release-content/*.shared.md` 的“生图配置要点”同步替换旧键值示例为 `provider.openai.models["gpt-image-2"].options.defaultForImageGeneration: true`。同一处准确记录：新 marker 优先、旧顶层字段只在无 marker 时回退且不产生运行时警告、先添加 marker 验证定制版后删除旧字段、官方版只保证严格加载配置而不承诺 `generate_image` 功能。两份 shared 文档主体保持一致。

- [ ] **Task 4 / Step 3: 从仓库根生成并检查发布内容**

工作目录：仓库根

Run: `bun run release-content:sync; if ($?) { bun run release-content:check }`

Expected: sync 成功并输出 `updated 6 release content files`，随后输出 `release content is in sync`。只由 `script/release-content.ts:132-177` 更新生成 README/HTML，禁止手工编辑带 generated banner 的文件。

- [ ] **Task 4 / Step 4: 验证迁移结果并提交闭环**

工作目录：仓库根

Run:

```powershell
rg -n '"image_model"\s*:|`image_model`:' samples/opencode.jsonc docs/release-content hosts/vscode-plugin/README.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html
```

Expected: exit 1；旧字段可以在迁移语义的普通文字中被提及，但不存在 JSON 属性或可复制的 Markdown 键值示例。

```bash
git add samples/opencode.jsonc docs/release-content/README.shared.md docs/release-content/description.shared.md hosts/vscode-plugin/README.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html
git commit -m "docs: migrate image model configuration"
```

Expected: 提交后分支为绿；不暂存其他 generated 文件、计划或协调产物。

### Task 5: Package 聚焦测试与类型检查

**OpenSpec 映射：**
- `4.1 在 packages/opencode 运行聚焦测试和 bun typecheck`

**文件：**
- 验证：`packages/opencode/test/tool/generate-image-config.test.ts`
- 验证：`packages/opencode/test/tool/generate-image.test.ts`
- 验证：`packages/opencode/src/tool/generate-image/config.ts`
- 验证：`packages/opencode/src/tool/generate-image.ts`

**验证性质：** 这是纯验证任务。用户已批准不伪造 RED；记录实际命令、退出码和结果即可，不添加测试或实现代码。

- [ ] **Task 5 / Step 1: 运行聚焦行为测试**

工作目录：`packages/opencode`

Run: `bun test test/tool/generate-image-config.test.ts test/tool/generate-image.test.ts`

Expected: exit 0；覆盖唯一/false/无效/歧义 marker、项目层显式 false、legacy 回退、完整参数绕过和工具接线。

- [ ] **Task 5 / Step 2: 运行 package 类型检查**

工作目录：`packages/opencode`

Run: `bun typecheck`

Expected: exit 0；resolver、`GenerateImageTool` 和现有 `ConfigV1.Info["provider"]` 类型兼容，未产生 schema、SDK 或 generated 改动。

- [ ] **Task 5 / Step 3: 记录范围证据**

工作目录：仓库根

Run: `git diff --check; if ($?) { git diff --name-only }`

Expected: exit 0；无 whitespace error，改动仅在 Tasks 1-4 的允许文件内。主会话协调者据此勾选 `4.1`，实施 agent 不勾选任何 checkbox。

### Task 6: 官方 schema 严格兼容验证

**OpenSpec 映射：**
- `4.2 使用官方发布的 https://opencode.ai/config.json 或官方 CLI 验证迁移后示例可被严格加载，并确认配置不含定制顶层字段`

**文件：**
- 验证：`samples/opencode.jsonc`
- 验证：`https://opencode.ai/config.json`
- 验证：`https://models.dev/model-schema.json`

**验证性质：** 这是纯验证任务。用户已批准不伪造 RED；使用下载到系统临时目录的官方 schema 与临时 validator，不修改 `package.json`、lockfile 或仓库文件。

- [ ] **Task 6 / Step 1: 创建临时代表性 JSON 和下载官方 schema**

工作目录：仓库根。运行以下 PowerShell，生成标准 JSON，且将远程 refs 下载为本地文件供 Ajv 显式注册：

```powershell
$dir = Join-Path $env:TEMP "compatible-image-model-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null
$config = Join-Path $dir "compatible-image-model.json"
$schema = Join-Path $dir "config.json"
$modelSchema = Join-Path $dir "model-schema.json"
@'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": {
      "models": {
        "gpt-image-2": {
          "options": {
            "defaultForImageGeneration": true,
            "imageApi": "openai-compatible"
          }
        }
      }
    }
  }
}
'@ | Set-Content -LiteralPath $config -NoNewline
Invoke-WebRequest -Uri "https://opencode.ai/config.json" -OutFile $schema
Invoke-WebRequest -Uri "https://models.dev/model-schema.json" -OutFile $modelSchema
```

Expected: 三个临时文件存在；代表性配置没有顶层 `image_model`，且 `$schema` 和 `$modelSchema` 均来自官方地址。

- [ ] **Task 6 / Step 2: 以本地下载的官方 schema 执行严格验证**

继续使用 Step 1 的同一 PowerShell session：

```powershell
bunx --yes ajv-cli@5 validate --spec=draft2020 --strict=true -s $schema -r $modelSchema -d $config
```

Expected: exit 0 且输出 `valid`。`-s` 指向已下载的官方 schema，`-r` 注册官方 models.dev ref，因此不依赖 ajv-cli 从 URL 自动抓取 schema；`bunx` 只使用临时 CLI cache，不写 `package.json` 或 lockfile。

- [ ] **Task 6 / Step 3: 检查迁移样例并清理临时目录**

工作目录：仓库根。仍在同一 PowerShell session 执行：

```powershell
rg -n '"image_model"\s*:' samples/opencode.jsonc
$schemaStatus = $LASTEXITCODE
Remove-Item -LiteralPath $dir -Recurse -Force
if ($schemaStatus -ne 1) { throw "samples/opencode.jsonc still has a top-level image_model" }
```

Expected: exit 0；`rg` 没有匹配，临时目录被移除。主会话协调者记录官方 schema URL、校验器版本和成功输出后勾选 `4.2`；实施 agent 不勾选 checkbox。

## 覆盖自检

- Tasks 1-3 为三个独立源码闭环，均遵循 RED→GREEN、聚焦回归和独立提交；不会留下已完成但失败的测试。
- Task 4 一次完成 `3.1`/`3.2` 的样例、shared 文档、生成文档和迁移边界，不重复编辑相同文档。
- Tasks 5-6 只记录真实验证证据，不制造 RED；分别覆盖 package 回归/typecheck 与官方严格 schema 兼容。
- 计划未包含 schema、SDK、generated、OpenSpec、Design Doc 或依赖变更。
