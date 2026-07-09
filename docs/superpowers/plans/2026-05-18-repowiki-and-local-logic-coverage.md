# Repowiki and Local Logic Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面同步近半个月本地 fork 逻辑到 repowiki，并用直接回归断言与 coverage 映射锁住后续上游同步不能丢的行为。

**Architecture:** 采用主题驱动：先建立“本地逻辑点 -> repowiki 页面 -> 测试文件”的 coverage 矩阵，再补当前明确缺失的 `generate_image` readonly 输入执行级回归，最后同步 repowiki 各章节。已有直接覆盖的主题不重复造测试，而是在 coverage 矩阵中记录证据，保持测试护栏精确且低维护成本。

**Tech Stack:** Markdown、Bun test、Vitest、Mocha/VSCode test、Gradle/JUnit、TypeScript、Kotlin。

---

## File Structure

- Create: `docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md`
  - 负责记录四大主题的本地逻辑点、repowiki 章节、现有/新增测试证据与补测结论。

- Modify: `packages/opencode/test/tool/generate-image.test.ts`
  - 增加 `generate_image` edit action 接收 readonly / frozen image input array 的执行级回归测试。
  - 如测试暴露实现缺口，才最小修改 `packages/opencode/src/tool/generate-image.ts`。

- Modify: `docs/repowiki/README.md`
  - 增加近期高风险主题索引。

- Modify: `docs/repowiki/01-webgui-architecture.md`
  - 增加 dev project path override 与 generated image 预览链路说明。

- Modify: `docs/repowiki/02-ide-bridge.md`
  - 增加 `saveImage` 与 `getExtensionVersion` bridge 契约。

- Modify: `docs/repowiki/03-state-storage.md`
  - 增加 non-git 项目按目录隔离对 workspace scoped storage 的影响。

- Modify: `docs/repowiki/04-session-chat.md`
  - 增加 assistant completed time、stream timeout retry、aborted load retry、scroll 稳定性与图片聊天展示说明。

- Modify: `docs/repowiki/05-subtasks-tools-mcp.md`
  - 增加 `generate_image`、图片附件网格、ImageOverlay 与保存链路说明。

- Modify: `docs/repowiki/06-settings-update-localization.md`
  - 更新 JetBrains public Marketplace 查询、空结果与本地安装语义。

- Modify: `docs/repowiki/07-host-plugins.md`
  - 增加 VSCode/JetBrains 版本注入、identity 对齐、dev 启动与发布内容说明。

- Modify: `docs/repowiki/08-upstream-adaptations.md`
  - 将图片链路、non-git identity、stream timeout retry、host bridge 扩展加入上游同步风险总表。

---

### Task 1: 创建本地逻辑 coverage 矩阵初稿

**Files:**

- Create: `docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md`

- [ ] **Step 1: 写入 coverage 矩阵文档**

创建 `docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md`，内容如下：

```markdown
# 本地逻辑覆盖矩阵（2026-05-18）

范围来自：

- `docs/superpowers/specs/2026-05-18-repowiki-and-local-logic-coverage-design.md`
- 2026-05-04 到 2026-05-18 的 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`
- 近半个月提交中涉及 WebGUI、IDE host、图片生成、non-git 隔离、更新链路和 UI 稳定性的本地 fork 改动

判定口径：

- `已直接覆盖`：测试直接断言该本地契约，不依赖旁路行为。
- `新增覆盖`：本次补入直接断言。
- `文档锁定`：行为已有直接测试，repowiki 本次补充维护入口和同步风险。
- `无需补测`：已有直接测试足够，本次不重复造测试。

## A. 图片链路

| ID  | 本地逻辑点                                                                                                       | repowiki 章节                                             | 测试证据                                                                                                                                                                                                                         | 覆盖结论             |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A1  | `generate_image` 结果持久化到 `.opencode/generated-images`，返回 file attachment，且不带旧 `source` metadata。   | `05-subtasks-tools-mcp.md`、`08-upstream-adaptations.md`  | `packages/opencode/test/tool/generate-image.test.ts`：`writes images into .opencode/generated-images and returns file attachments without source metadata`；`packages/opencode/test/session/generated-image-persistence.test.ts` | 已直接覆盖，无需补测 |
| A2  | generated image 路由只允许项目内 `.opencode/generated-images`，阻止路径逃逸与 symlink/junction 逃逸。            | `01-webgui-architecture.md`、`08-upstream-adaptations.md` | `packages/opencode/test/server/generated-image-route.test.ts`；`packages/opencode/test/tool/generate-image.test.ts` symlink/junction escape 用例                                                                                 | 已直接覆盖，无需补测 |
| A3  | `generate_image` edit action 接受 readonly/frozen image input array，不改写调用方入参。                          | `05-subtasks-tools-mcp.md`、`08-upstream-adaptations.md`  | 本次新增：`packages/opencode/test/tool/generate-image.test.ts` 的 readonly edit image inputs 回归                                                                                                                                | 新增覆盖             |
| A4  | WebGUI tool attachment 图片网格稳定展示多图顺序、编号、文件名和 relativePath 专用路由。                          | `05-subtasks-tools-mcp.md`                                | `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`；`ToolImageAttachments.test.tsx`                                                                                                                         | 已直接覆盖，无需补测 |
| A5  | Markdown 中 `.opencode/generated-images` 图片使用专用图片路由，并携带当前 directory/worktree 上下文。            | `01-webgui-architecture.md`、`04-session-chat.md`         | `packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`                                                                                                                                                              | 已直接覆盖，无需补测 |
| A6  | `ImageOverlay` 保存、缩放、拖拽、Esc、阴影点击关闭、图片/工具栏点击不关闭。                                      | `05-subtasks-tools-mcp.md`                                | `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`                                                                                                                                                            | 已直接覆盖，无需补测 |
| A7  | Host `saveImage` bridge 能处理 data URL、remote URL、generated-image relative URL、取消、无 handler 和非法输入。 | `02-ide-bridge.md`、`07-host-plugins.md`                  | `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`；`webviewController.test.ts`；`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`                                                | 已直接覆盖，无需补测 |

## B. 宿主版本与更新链路

| ID  | 本地逻辑点                                                                                                              | repowiki 章节                                              | 测试证据                                                                                                                                             | 覆盖结论             |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| B1  | VSCode backend 环境注入 `OPENCODE_UI_VERSION`，空版本不注入且清理继承的 stale 值。                                      | `07-host-plugins.md`、`08-upstream-adaptations.md`         | `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`                                                                                         | 已直接覆盖，无需补测 |
| B2  | opencode UI user agent 使用注入的 UI version，installation-scoped user agent 保留 accept header。                       | `07-host-plugins.md`、`08-upstream-adaptations.md`         | `packages/opencode/test/installation/installation.test.ts`                                                                                           | 已直接覆盖，无需补测 |
| B3  | VSCode / JetBrains `getExtensionVersion` 返回宿主真实版本，JetBrains 与 `getUpdateInfo` 共用同一 version source。       | `02-ide-bridge.md`、`07-host-plugins.md`                   | `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`；`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt` | 已直接覆盖，无需补测 |
| B4  | JetBrains 使用 public Marketplace 查询；空 marketplace result 视为 manual check / unavailable，不保留旧 cached update。 | `06-settings-update-localization.md`、`07-host-plugins.md` | `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`                                                       | 已直接覆盖，无需补测 |
| B5  | JetBrains plugin id / vendor / marketplace metadata 不回退到旧身份。                                                    | `07-host-plugins.md`                                       | `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`                                                                   | 已直接覆盖，无需补测 |

## C. 同步隔离链路

| ID  | 本地逻辑点                                                                                      | repowiki 章节                                       | 测试证据                                                                                                             | 覆盖结论             |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| C1  | non-git 普通目录生成稳定且非 global 的 project id。                                             | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`returns a stable non-git project id for plain directories`        | 已直接覆盖，无需补测 |
| C2  | 不同 non-git 目录生成不同 project id，不互相串状态。                                            | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`assigns different non-git project ids to different directories`   | 已直接覆盖，无需补测 |
| C3  | legacy global session 会在运行时迁移到目录派生的 non-git project id。                           | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`migrates legacy global sessions for plain directories at runtime` | 已直接覆盖，无需补测 |
| C4  | Vite dev-only directory override 只在 serve proxy 注入 `x-opencode-directory`，未设置时不注入。 | `01-webgui-architecture.md`、`07-host-plugins.md`   | `packages/opencode/webgui/vite.config.test.ts`                                                                       | 已直接覆盖，无需补测 |

## D. WebGUI 稳定性链路

| ID  | 本地逻辑点                                                                               | repowiki 章节              | 测试证据                                                                                                        | 覆盖结论             |
| --- | ---------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------- |
| D1  | 贴底时 tail resize / 内容展开 / 容器高度变化会保持自动跟随，用户离开底部后停止自动滚动。 | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`                           | 已直接覆盖，无需补测 |
| D2  | history anchor / prepend / trim 不破坏历史位置。                                         | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.test.tsx`；`useTopTrim.test.tsx`    | 已直接覆盖，无需补测 |
| D3  | aborted latest/older message load 不误标加载完成或错误，并允许后续 retry。               | `04-session-chat.md`       | `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`                                        | 已直接覆盖，无需补测 |
| D4  | assistant completed time 与 interrupted 可以同时展示，非法 completedAt 不展示。          | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`；`MessageRow.test.tsx`             | 已直接覆盖，无需补测 |
| D5  | bash 运行中 title 使用 input description，image_generation title 不重复污染结果区。      | `05-subtasks-tools-mcp.md` | `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`；`utils.test.ts`                        | 已直接覆盖，无需补测 |
| D6  | StatusPopover 展示真实 backend 地址，未注入时回退当前 origin。                           | `05-subtasks-tools-mcp.md` | `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`；`StatusPopover.test.tsx` | 已直接覆盖，无需补测 |

## 当前补测最小集合

本矩阵下，唯一需要新增的直接回归断言是：

1. `packages/opencode/test/tool/generate-image.test.ts`：`accepts readonly edit image inputs without mutating the caller array`

其余主题已有直接测试，后续工作重点是把这些证据同步到 repowiki，避免上游同步时只靠提交记忆判断本地行为。
```

- [ ] **Step 2: 确认 coverage 文档没有占位词**

运行内容搜索：

```powershell
rg "TBD|TODO|待补|占位" docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md
```

Expected: 无匹配输出。

- [ ] **Step 3: 可选 checkpoint**

仅当用户明确要求本会话创建 commit 时执行：

```powershell
git add docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md
git commit -m "docs(superpowers): map local logic coverage"
```

Expected: 创建 coverage 文档 commit。若用户未明确要求 commit，跳过本步骤。

---

### Task 2: 补 `generate_image` readonly edit input 直接回归测试

**Files:**

- Modify: `packages/opencode/test/tool/generate-image.test.ts`
- Modify only if test fails: `packages/opencode/src/tool/generate-image.ts`

- [ ] **Step 1: 在 `generate-image.test.ts` 末尾补 readonly edit input 测试**

在 `describe("generate_image tool", () => {` 内、`auto-allows generate_image when permission config is allow` 测试之前插入：

```ts
it.live("accepts readonly edit image inputs without mutating the caller array", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        let imageFieldNames: string[] = []
        const readonlyImages = Object.freeze(["input.png"] as string[])

        using server = Bun.serve({
          port: 0,
          fetch: async (request) => {
            const form = await request.formData()
            imageFieldNames = form.getAll("image[]").map((value) => {
              if (value instanceof File) {
                return value.name
              }
              return String(value)
            })

            return Response.json({
              data: [
                {
                  b64_json: Buffer.from(pngBytes).toString("base64"),
                },
              ],
            })
          },
        })

        const tool = yield* initTool(providerLayer(String(server.url)))
        const result = yield* tool.execute(
          {
            action: "edit",
            prompt: "make the image darker",
            provider: "openai",
            model: "gpt-image-2",
            images: readonlyImages as unknown as string[],
          },
          {
            ...toolCtx,
            messageID: MessageID.make("msg_readonly-edit-image"),
            ask: () => Effect.void,
          },
        )

        expect(readonlyImages).toEqual(["input.png"])
        expect(imageFieldNames).toEqual(["input.png"])
        expect(result.output).toBe("已生成 1 张图片：")
        expect(result.attachments).toHaveLength(1)
      }),
    {
      config: {
        image_model: "openai/gpt-image-2",
      },
      init: async (dir) => {
        await Bun.write(path.join(dir, "input.png"), Buffer.from(pngBase64, "base64"))
      },
    },
  ),
)
```

- [ ] **Step 2: 运行 focused backend test**

Run from `packages/opencode`:

```powershell
bun test test/tool/generate-image.test.ts --timeout 30000
```

Expected: PASS。如果测试失败并提示 readonly/frozen array 被写入或 edit image inputs 丢失，继续 Step 3；如果通过，跳过 Step 3。

- [ ] **Step 3: 仅在 Step 2 失败时最小修复 readonly 输入处理**

如果 Step 2 失败，修改 `packages/opencode/src/tool/generate-image.ts` 中 `execute` 内读取 `params.images` 的部分。

把：

```ts
const generateImages = normalizeGenerateImages(params.images)
const editImages = action === "edit" ? params.images : undefined
```

改为：

```ts
const inputImages = params.images ? [...params.images] : undefined
const generateImages = normalizeGenerateImages(inputImages)
const editImages = action === "edit" ? inputImages : undefined
```

Expected: 后续内部逻辑只使用 `inputImages` 副本，不会依赖或改写调用方传入的 readonly/frozen array。

- [ ] **Step 4: 重新运行 focused backend test**

Run from `packages/opencode`:

```powershell
bun test test/tool/generate-image.test.ts --timeout 30000
```

Expected: PASS。

- [ ] **Step 5: 可选 checkpoint**

仅当用户明确要求本会话创建 commit 时执行：

```powershell
git add packages/opencode/test/tool/generate-image.test.ts packages/opencode/src/tool/generate-image.ts
git commit -m "test(opencode): lock readonly image edit inputs"
```

Expected: 创建测试或测试加最小修复 commit。若 `generate-image.ts` 未修改，`git add` 会忽略无变化文件。若用户未明确要求 commit，跳过本步骤。

---

### Task 3: 更新 repowiki README 与 WebGUI 架构/聊天/工具章节

**Files:**

- Modify: `docs/repowiki/README.md`
- Modify: `docs/repowiki/01-webgui-architecture.md`
- Modify: `docs/repowiki/04-session-chat.md`
- Modify: `docs/repowiki/05-subtasks-tools-mcp.md`

- [ ] **Step 1: 在 `docs/repowiki/README.md` 增加近期风险索引**

在 `## 核心代码入口` 前插入：

```markdown
## 近期高风险主题索引

近半个月新增或收口的本地 fork 逻辑，后续同步上游时优先检查：

- **图片生成 / 预览 / 保存链路：** 见 [01](./01-webgui-architecture.md)、[02](./02-ide-bridge.md)、[04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md)、[08](./08-upstream-adaptations.md)。重点是 `generate_image`、`.opencode/generated-images`、generated-image 路由、Markdown/tool attachment 预览、ImageOverlay 与 host `saveImage`。
- **宿主版本 / 更新 / bridge 能力：** 见 [02](./02-ide-bridge.md)、[06](./06-settings-update-localization.md)、[07](./07-host-plugins.md)、[08](./08-upstream-adaptations.md)。重点是 `getExtensionVersion`、`OPENCODE_UI_VERSION`、JetBrains public Marketplace 查询、空 Marketplace 结果和 plugin identity 对齐。
- **non-git 项目隔离与 dev 路径覆盖：** 见 [01](./01-webgui-architecture.md)、[03](./03-state-storage.md)、[07](./07-host-plugins.md)、[08](./08-upstream-adaptations.md)。重点是 non-git project id 按目录派生，workspace 状态不再坍缩到 global project。
- **WebGUI 稳定性补丁：** 见 [04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md)。重点是 scroll follow / anchoring、aborted message load retry、assistant completed time、bash running title、StatusPopover backend 地址和 overlay 阴影点击关闭。
```

- [ ] **Step 2: 在 `01-webgui-architecture.md` 更新 dev proxy 与图片预览链路**

在 `## Vite dev 的 backend 发现与代理` 的“当前约定”列表后追加：

```markdown
- `WebGUI: dev` 可通过 `OPENCODE_DEV_DIRECTORY_OVERRIDE` 覆盖测试项目路径；Vite 只在 `serve` 模式把该值注入为 `x-opencode-directory`，正式 `vite build` 和 embedded `/app` 不读取这个变量。
- generated image 预览在 dev proxy 中也要转发 `/generated-image` 与 `/app/generated-image`，否则 WebGUI dev 无法预览项目内 `.opencode/generated-images` 文件。
```

在 `## 项目与 worktree 上下文` 后追加新小节：

```markdown
## Generated image 预览入口

图片生成链路会把生成文件落到当前项目的 `.opencode/generated-images/`，WebGUI 中有两个主要消费入口：

- Markdown 图片：`MarkdownRenderer` 识别 `.opencode/generated-images` 相对路径，并通过 `getGeneratedImageUrl(relativePath, directoryOrWorktree)` 生成带实例目录上下文的专用路由。
- Tool attachment 图片：`ToolImageAttachments` 优先使用 attachment 的 `relativePath`，同样通过 generated-image 路由加载；缺少 `relativePath` 的旧 data URL attachment 仍按原 URL 展示。

维护时要保证 ProjectContext 的 `directory/worktree` 与 generated-image 路由一起演进。只改图片组件而忘记实例目录上下文，会导致多项目或 non-git 目录下预览串项目。
```

- [ ] **Step 3: 在 `04-session-chat.md` 补聊天稳定性与图片展示说明**

在 `## 消息流与分页` 段落的消息模型说明后追加：

```markdown
加载失败和 abort 的收口规则：

- latest / older 请求如果因为 abort 结束，不应误标为已加载或错误状态。
- `ensureSession` 遇到已中止的 pending latest 时，应使用新的 AbortSignal 重新发起加载。
- 这条链路由 `MessagesContext.pagination.test.tsx` 直接锁定，避免会话切换或卸载时留下不可恢复的 loading/error 状态。
```

在 `## 滚动稳态` 列表后追加：

```markdown
近期稳定化约束：

- tail 区域 resize、工具输出展开、思考块展开和容器高度变化时，如果用户仍贴底，必须继续保持自动跟随。
- 用户通过滚轮、scrollbar 或键盘主动离开底部后，tail resize 不能把用户强行拉回底部。
- history 区高度变化只维护历史 anchor，不触发 tail 自动滚动；tail 区变化才驱动自动跟随。
```

在 `## 消息展示层` 的能力列表后追加：

```markdown
近期展示契约：

- assistant meta 在存在 `completedAt` 时追加完整结束时间；`completedAt` 与 `interrupted` 可同时显示，非法时间戳不展示。
- `stream_timeout` 属于可重试的上游流内错误，后端会进入 retry 状态并通过 TypingIndicator 显示重试提示，而不是立即固化成最终错误卡片。
- 图片可以来自普通附件、Markdown generated image 路径或 tool result attachments；生成图片的模型上下文以 tool attachment 为准，保存到本地文件不改变模型上下文。
```

- [ ] **Step 4: 在 `05-subtasks-tools-mcp.md` 补图片工具与 StatusPopover 说明**

在 `## 工具调用展示` 之后、`## Diff、patch 与文件变更浏览` 之前插入：

````markdown
## 图片生成工具与预览

`generate_image` 是本 fork 为 IDE/WebGUI 场景保留的关键工具能力。它的展示链路不是普通文本 output，而是：

```text
generate_image provider result
  -> .opencode/generated-images project file
  -> ToolStateCompleted.attachments[]
  -> ToolImageAttachments 缩略图网格
  -> ImageOverlay 预览 / 保存
```
````

当前契约：

- 工具名 `image_generation` / `generate_image` 在 UI 中显示为“图片生成”。
- 工具 output 保留 `已生成 N 张图片：` 摘要，不把 `Image #N filename` 拼成重复标题。
- 图片编号只按图片附件计数，前置 text attachment 不导致跳号。
- attachment 存在 `relativePath` 时，预览和缩略图都使用 generated-image 专用路由；旧 data URL 图片仍可显示。
- `ImageOverlay` 支持保存、缩放、重置、适应窗口、滚轮缩放、拖拽平移、Esc 关闭；点击图片外阴影/空白区域关闭，点击图片本体或工具栏不关闭。

保存链路通过 WebGUI `saveImage()` 分流：插件环境走 IDE bridge `saveImage`，普通浏览器环境回退到下载链接。

````

在 `## Server 状态分区` 的列表后追加：

```markdown
- `后端地址`：优先展示 Vite dev 注入的 `__OPENCODE_BACKEND_URL__`，未注入时回退当前 origin。这个字段用于区分“WebGUI 当前页面地址”和“实际 opencode backend 目标”，本地多端口联调时尤其重要。
````

- [ ] **Step 5: 搜索重复或过时表述**

Run from repository root:

```powershell
rg "MarketplaceRequests|PluginDownloader|站内更新|qtkj\.opencode-ui|/app/api" docs/repowiki
```

Expected: 如果命中 `站内更新` 或旧 JetBrains 更新描述，留到 Task 4 修正；如果命中 `qtkj.opencode-ui`，只能保留在历史迁移语境；不应出现 `MarketplaceRequests`、`PluginDownloader` 或把 `/app/api` 当新主链路的描述。

- [ ] **Step 6: 可选 checkpoint**

仅当用户明确要求本会话创建 commit 时执行：

```powershell
git add docs/repowiki/README.md docs/repowiki/01-webgui-architecture.md docs/repowiki/04-session-chat.md docs/repowiki/05-subtasks-tools-mcp.md
git commit -m "docs(repowiki): document webgui image and stability contracts"
```

Expected: 创建 WebGUI/图片相关 repowiki commit。若用户未明确要求 commit，跳过本步骤。

---

### Task 4: 更新 bridge、state、update、host 与 upstream 章节

**Files:**

- Modify: `docs/repowiki/02-ide-bridge.md`
- Modify: `docs/repowiki/03-state-storage.md`
- Modify: `docs/repowiki/06-settings-update-localization.md`
- Modify: `docs/repowiki/07-host-plugins.md`
- Modify: `docs/repowiki/08-upstream-adaptations.md`

- [ ] **Step 1: 在 `02-ide-bridge.md` 更新 UI -> Host 请求列表**

把 `## UI → Host 请求` 下的请求列表改成包含以下内容：

```markdown
两端共同支持：

- `openFile`：在 IDE 中打开文件，支持行号/范围。
- `openUrl`：用宿主打开外部 URL。
- `reloadPath`：文件写入后刷新 IDE 文件系统视图。
- `clipboardWrite`：写入系统剪贴板。
- `restartHost`：重启或重载宿主。
- `ensureAndOpenFile`：确保文件存在并打开。
- `storageGet` / `storageSet`：读写 `global | workspace | mem` scoped storage。
- `saveImage`：保存 WebGUI 图片预览中的 data URL、remote URL 或 generated-image relative URL。取消保存返回 `{ cancelled: true }`，不支持时返回明确错误。
- `getExtensionVersion`：返回宿主插件真实版本，供 WebGUI 更新 UI 和 user agent 相关展示使用。

VSCode 与 JetBrains 共同支持的更新请求：

- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`
```

把 JetBrains 更新限制改成：

```markdown
JetBrains 更新限制：

- 只使用公开 JetBrains Marketplace release 查询作为远端版本来源。
- Marketplace 安装版可检查更新，但安装动作以打开 IDE Plugins 页面并由用户手动更新为主。
- 本地 ZIP / 开发版返回 `unsupported` 或仅支持手动检查提示。
- 空 Marketplace 结果视为当前没有可安装更新，不能保留旧 cached update。
```

- [ ] **Step 2: 在 `03-state-storage.md` 补 non-git 目录隔离小节**

在 `## 三类作用域` 后插入：

```markdown
## non-git 项目目录隔离

non-git 普通目录现在会按目录派生稳定 project id，不再坍缩到 `ProjectID.global` / `worktree = "/"`。这会影响 workspace 级 scoped storage 的真实边界：

- 同一个 non-git 目录重复打开，应恢复同一组 workspace tabs、drafts、selection。
- 不同 non-git 目录即使都没有 Git，也不能共享 workspace tabs、drafts、selection。
- 历史 global project session 会在运行时迁移到目录派生的 non-git project id。

维护时如果调整 project identity、path normalize 或 session list 逻辑，必须同时跑 `packages/opencode/test/project/project.test.ts`，确认 non-git 目录隔离没有退回 global。
```

- [ ] **Step 3: 在 `06-settings-update-localization.md` 更新 IDE 更新流**

把 `JetBrains 现已补齐同名更新 API，但有明确边界：` 下面四条替换为：

```markdown
JetBrains 现已补齐同名更新 API，但有明确边界：

- 使用公开 JetBrains Marketplace release 查询，不依赖内部下载 API。
- Marketplace 安装版可以检查到 newer release，并返回带 `manualUpdate` 的结构化结果。
- 空 Marketplace 结果视为当前没有可安装更新，同时清理 cached update，不能继续提示旧版本。
- 本地 ZIP / 开发版不执行站内自动安装；需要用户安装新 ZIP 或通过 IDE Plugins 页面处理。
- 更新成功后的生效方式以 IDE 原生提示为准。
```

把维护注意点中的 JetBrains 更新句替换为：

```markdown
- 维护 JetBrains 发布链路时，不要移除 `distribution.channel=marketplace` 注入；维护更新链路时，不要把 public Marketplace 查询改回内部下载 API 或保留空结果前的旧 cached update。
```

- [ ] **Step 4: 在 `07-host-plugins.md` 补 host 版本和 dev 约定**

在 `## VSCode 插件` 职责列表后追加：

```markdown
版本与 user agent 约定：

- VSCode backend 启动时通过 `BackendLauncher` 注入 `OPENCODE_UI_VERSION=<extension.version>`。
- 空白 extension version 不注入，并会移除继承环境中的 stale `OPENCODE_UI_VERSION`。
- opencode 后端用该值生成 `opencode-ui/<version>` user agent，供安装/更新/API 请求识别插件 UI 来源。
```

在 `### VSCode 本地开发入口约定` 的维护约束后追加：

```markdown
- `WebGUI: dev` 可提示输入 `OPENCODE_DEV_DIRECTORY_OVERRIDE`，默认是 `${workspaceFolder}`；该值只影响 Vite dev proxy 的 `x-opencode-directory`，不进入正式 build。
```

在 `## JetBrains 插件` 职责列表后追加：

```markdown
版本与更新约定：

- `getExtensionVersion` 通过 `PluginVersionSource` 返回当前安装插件版本，并与 `getUpdateInfo.currentVersion` 共用同一来源。
- JetBrains 更新服务只以 public Marketplace release 查询判断是否有新版本；newer release 返回 `manualUpdate=true`，由用户在 IDE Plugins 页面完成更新。
- 空 Marketplace 结果必须清理 cached update 并返回不可用/手动检查语义，不能继续显示旧的可更新版本。
```

把 `## 双端差异` 表中更新行替换为：

```markdown
| 更新 | 支持 GitHub Release `.vsix` 更新 | Marketplace 安装版支持 public Marketplace 检查并打开 Plugins 页面手动更新；本地 ZIP / 开发版不执行自动安装 |
```

- [ ] **Step 5: 在 `08-upstream-adaptations.md` 增加本地适配风险小节**

在 `### Session prompt 的 IDE 附件处理` 后插入：

```markdown
### `generate_image` 与 generated image 项目文件

关键文件：

- `packages/opencode/src/tool/generate-image.ts`
- `packages/opencode/src/tool/generate-image/persist.ts`
- `packages/opencode/src/tool/generate-image/input.ts`
- `packages/opencode/src/server/routes/instance/generated-image.ts`
- `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
- `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`

用途：支持 IDE/WebGUI 内生成图片、保存项目内文件、展示缩略图、点击预览和后续上下文引用。

当前约定：

- 生成图片写入当前项目 `.opencode/generated-images/`，attachment 暴露 `relativePath` 和 generated-image route，不再只依赖 data URL。
- generated-image route 必须校验路径仍在当前项目内，并阻止 symlink/junction 逃逸。
- edit action 接受 project-relative path 或 data URL 图片输入，包括 readonly/frozen array 形式的调用方入参。
- WebGUI Markdown 与 tool attachment 都要使用当前 `directory/worktree` 构造 generated-image URL，避免多项目串图。
- 插件环境保存图片走 IDE bridge `saveImage`，浏览器环境才回退下载。

风险：上游 tool schema、session attachment 或 server route 重构时，容易丢失图片项目内持久化、readonly 输入兼容或 generated-image 专用路由。
```

在 `### 前台读取优先于后台 diff` 后插入：

```markdown
### non-git project identity

关键文件：

- `packages/opencode/src/project/project.ts`
- `packages/opencode/src/project/schema.ts`
- `packages/opencode/test/project/project.test.ts`

用途：IDE 里经常直接打开非 Git 临时目录，这些目录必须按实际目录隔离 project/session/workspace 状态。

当前约定：

- non-git 普通目录使用目录派生 project id，不使用 `ProjectID.global`。
- 同一目录重复打开得到稳定 project id，不同目录得到不同 project id。
- legacy global session 会在运行时迁移到目录派生 project id。

风险：上游 project identity 或 worktree fallback 改动可能把所有 non-git 目录重新合并到 global，导致 tabs、drafts、selection 和 session list 串项目。
```

在 `### Provider / Anthropic SSE 兼容补丁` 后追加：

```markdown
### Stream timeout auto-retry

关键文件：

- `packages/opencode/src/session/retry.ts`
- `packages/opencode/src/session/status.ts`
- `packages/opencode/webgui/src/components/TypingIndicator.tsx`

用途：部分 provider 会在长流式响应中返回 `stream_timeout`。本 fork 将其作为可重试状态展示，避免一次瞬时流错误直接固化为最终失败。

风险：上游 session status 或 provider error shape 改动时，可能把 retry 状态退化成普通 error，表现为 WebGUI 不再显示重试提示。
```

在 `## 上游同步检查重点` 的最低验证列表后追加：

```markdown
- 确认 `generate_image` 仍能生成项目内图片附件，并能编辑 readonly/frozen image input array。
- 确认 generated-image 路由和 Markdown/tool attachment 预览都带当前实例目录上下文。
- 确认 VSCode `OPENCODE_UI_VERSION` 与 JetBrains `getExtensionVersion` 仍来自宿主真实版本。
- 确认 JetBrains 空 Marketplace 查询结果不会保留旧 cached update。
```

- [ ] **Step 6: 可选 checkpoint**

仅当用户明确要求本会话创建 commit 时执行：

```powershell
git add docs/repowiki/02-ide-bridge.md docs/repowiki/03-state-storage.md docs/repowiki/06-settings-update-localization.md docs/repowiki/07-host-plugins.md docs/repowiki/08-upstream-adaptations.md
git commit -m "docs(repowiki): document host and upstream adaptation contracts"
```

Expected: 创建 host/upstream 相关 repowiki commit。若用户未明确要求 commit，跳过本步骤。

---

### Task 5: 更新 coverage 矩阵为最终验收导航

**Files:**

- Modify: `docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md`

- [ ] **Step 1: 确认新增 readonly 测试已在矩阵中标为新增覆盖**

检查矩阵 A3 行应为：

```markdown
| A3 | `generate_image` edit action 接受 readonly/frozen image input array，不改写调用方入参。 | `05-subtasks-tools-mcp.md`、`08-upstream-adaptations.md` | 本次新增：`packages/opencode/test/tool/generate-image.test.ts` 的 readonly edit image inputs 回归 | 新增覆盖 |
```

如果测试名称最终不同，把“readonly edit image inputs 回归”替换成实际测试名。

- [ ] **Step 2: 确认矩阵引用的测试文件都存在**

Run from repository root:

```powershell
Test-Path "packages/opencode/test/tool/generate-image.test.ts"; Test-Path "packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx"; Test-Path "hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts"; Test-Path "hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt"; Test-Path "packages/opencode/test/project/project.test.ts"
```

Expected: PowerShell 输出五个 `True`。

- [ ] **Step 3: 搜索 coverage 矩阵中的占位与自相矛盾描述**

Run from repository root:

```powershell
rg "TBD|TODO|未决定|以后补|可能需要" docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md
```

Expected: 无匹配输出。

- [ ] **Step 4: 可选 checkpoint**

仅当用户明确要求本会话创建 commit 时执行：

```powershell
git add docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md
git commit -m "docs(superpowers): finalize local logic coverage matrix"
```

Expected: 创建 coverage 最终更新 commit。若用户未明确要求 commit，跳过本步骤。

---

### Task 6: 运行目标验证集

**Files:**

- Read-only verification across modified tests and docs

- [ ] **Step 1: 验证 opencode 图片与 project 隔离测试**

Run from `packages/opencode`:

```powershell
bun test test/tool/generate-image.test.ts test/project/project.test.ts test/server/generated-image-route.test.ts test/session/generated-image.test.ts test/session/generated-image-persistence.test.ts test/installation/installation.test.ts --timeout 30000
```

Expected: PASS。该命令验证图片生成、generated-image route、non-git project identity 和 UI user agent 注入逻辑。

- [ ] **Step 2: 验证 WebGUI 图片、scroll、状态面板与 dev proxy 测试**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run vite.config.test.ts src/components/parts/ImageOverlay.test.tsx src/components/parts/ToolPart/index.test.tsx src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/components/MarkdownRenderer.test.tsx src/components/MessageList/hooks/useMessageScroll.test.tsx src/state/MessagesContext.pagination.test.tsx src/components/MessageList/AssistantMeta.test.tsx src/components/CompactHeader/useStatusPopoverData.test.tsx src/components/CompactHeader/StatusPopover.test.tsx
```

Expected: PASS。该命令验证 dev path override、图片预览、tool attachment 图片、Markdown generated image、scroll 稳定性、aborted message load retry、assistant completed time 与 StatusPopover backend 地址。

- [ ] **Step 3: 验证 VSCode host 测试**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile:production
```

Expected: PASS，TypeScript 编译通过。

然后运行 VSCode test runner：

```powershell
node ./out/test/runTest.js
```

Expected: PASS。该命令会执行 `backendLauncher.test.js`、`ideBridgeServer.test.js`、`webviewController.test.js`、`updateService.test.js` 等 suite，覆盖 `OPENCODE_UI_VERSION`、`getExtensionVersion`、`saveImage` 和更新链路。

- [ ] **Step 4: 验证 JetBrains unit tests**

Run from `hosts/jetbrains-plugin`:

```powershell
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --tests "paviko.opencode.update.PluginUpdateServiceTest" --no-daemon --console=plain
```

Expected: PASS。该命令验证 JetBrains `getExtensionVersion`、`saveImage`、public Marketplace 查询、空结果和 manual update 语义。

- [ ] **Step 5: 验证 repowiki 与 coverage 文档没有占位词**

Run from repository root:

```powershell
rg "TBD|TODO|待补|占位|以后补" docs/repowiki docs/superpowers/coverage/2026-05-18-local-logic-coverage-matrix.md
```

Expected: 无匹配输出。

- [ ] **Step 6: 查看工作区状态**

Run from repository root:

```powershell
git status --short
```

Expected: 只出现本计划涉及的文件变更；不应出现 `.env`、credential、临时构建产物或无关源码改动。

---

## Self-Review

- Spec coverage: 本计划覆盖了设计文档中的 repowiki 更新、四大主题覆盖盘点、缺失直接测试补强、coverage/mapping 文档与最终验证。
- Placeholder scan: 计划中没有 `TBD`、`TODO`、未定义占位任务或“类似上一步”式省略；每个改动步骤都给出明确文件、内容和命令。
- Type consistency: 测试代码使用现有 `testEffect`/`it.live`、`provideTmpdirInstance`、`GenerateImageTool`、`MessageID`、`Effect`、`Bun.serve`、`ImageOverlay`、`ToolImageAttachments` 等既有接口；PowerShell 命令遵守 Windows 环境，Gradle 命令追加 `--no-daemon --console=plain`。
