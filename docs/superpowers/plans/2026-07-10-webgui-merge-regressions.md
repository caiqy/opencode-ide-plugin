# WebGUI Merge Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 恢复上游大版本合并后丢失的 fork WebGUI 构建、编辑工具流式输入、配置更新语义、单 target 打包和 generated-image SDK 契约。

**Architecture:** 恢复合并前已有的小型行为，不新增兼容框架。Schema 是 SDK 真源；`script/targets.ts` 是构建 target 真源；`Config` 的 instance cache 在 reload 时显式失效。

**Tech Stack:** TypeScript、Effect、Bun、React、Vitest、OpenAPI SDK generator。

## Global Constraints

- 不执行 Java/Gradle。
- 不直接编辑 generated SDK；修改 Schema 后运行仓库生成命令。
- 保留当前工作树中版本号、ToolPart 和文档改动。
- 不自动 commit。

---

### Task 1: 恢复编辑工具流式 raw

**Files:**
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/test/session/processor-streaming-input.test.ts`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.streaming.test.tsx`

- [ ] 恢复 `STREAMABLE_TOOLS` 在 `tool-input-delta` 中对 pending `state.raw` 的逐 delta 累加。
- [ ] 先把 write/edit/apply_patch 测试期望改回非空 raw 并确认失败，再实现生产代码。
- [ ] 删除生产端不可能生成的 `running + raw` 测试和对应前端兼容，只保留 pending 流式预览。
- [ ] 运行 processor 定向测试和 ToolPart streaming 测试。

### Task 2: 恢复 fork WebGUI 构建与 target 解析

**Files:**
- Modify: `packages/opencode/script/build.ts`
- Test: `packages/opencode/script/targets.test.ts`
- Verify: `.github/workflows/release.yml`

- [ ] 在 build 中恢复 `packages/opencode/webgui` 构建、`webgui-dist` 收集和 `src/webgui/embed.generated.ts` 生成，同时保留上游 `packages/app` bundle。
- [ ] 恢复调用 `targets(process.argv)` 和按目标安装 native dependencies。
- [ ] 运行 target parser 测试。
- [ ] 在无旧 `embed.generated.ts` / `webgui-dist` 的临时 checkout 中执行 Windows single build，确认生成当前 WebGUI 版本。

### Task 3: 恢复配置热更新与替换语义

**Files:**
- Modify: `packages/opencode/src/config/config.ts`
- Modify: `packages/opencode/test/config/config.test.ts`
- Modify: `packages/opencode/test/server/httpapi-config.test.ts`

- [ ] 增加失败测试：同一 instance 调用 reload 后 `Config.get()` 返回新 global config。
- [ ] 增加 JSON/JSONC PATCH 测试：`agent`、`provider` 顶层对象替换并删除省略字段。
- [ ] `reload()` 同时 invalidate global cache 和当前 `InstanceState`。
- [ ] 恢复 `agent`、`provider` 的顶层替换写入语义。
- [ ] 运行 config 与 HttpApi config 定向测试。

### Task 4: 恢复 generated-image SDK 契约

**Files:**
- Modify: `packages/schema/src/v1/session.ts`
- Generated: `packages/sdk/openapi.json`
- Generated: `packages/sdk/js/openapi.json`
- Generated: `packages/sdk/js/src/v2/gen/*`
- Test: `packages/sdk/js/generated-contract.test.ts`

- [ ] 先运行 generated contract 测试并确认 v2/OpenAPI 失败。
- [ ] 给 `FilePartInput` 恢复可选 `relativePath`。
- [ ] 按仓库规则运行生成命令，不手改生成文件。
- [ ] 重新运行 generated contract 测试，要求 3/3 通过。

### Task 5: 集成验证与重新打包

- [ ] 运行 WebGUI 全量 Vitest。
- [ ] 在 `packages/opencode` 运行 `bun typecheck` 和相关定向测试。
- [ ] 验证构建产物 `/app` 使用当前 fork WebGUI 版本。
- [ ] 按 `YY.M.DDNN` 递增 VSCode/WebGUI 版本并重打 Windows VSIX。
- [ ] 校验 VSIX manifest、内置 Windows amd64 二进制和文件大小。
- [ ] 明确标记旧 `26.7.901` 为无效产物并删除。
