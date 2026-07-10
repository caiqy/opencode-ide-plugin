# Core WebGUI Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the read-only reviewer, provider-native generated-image attachments, and a passing release preflight.

**Architecture:** Restore the two capabilities at their original ownership boundaries: Agent owns the built-in reviewer definition, and SessionProcessor owns provider tool-result normalization before persistence. Release HTML remains generated from the existing release-content source.

**Tech Stack:** TypeScript, Effect v4, Bun test, existing release-content generator.

## Global Constraints

- Do not restore the removed scout agent.
- Do not add dependencies.
- Keep reviewer read-only by default: only `read`, `grep`, and `glob` are allowed.
- Generated images must be persisted through `FSUtil` and expose `relativePath`.
- Do not run Java or Gradle.
- Do not commit, tag, push, or publish unless the user explicitly requests it.

## File Map

- `packages/opencode/src/agent/agent.ts`: built-in reviewer registration.
- `packages/opencode/test/agent/agent.test.ts`: reviewer identity and permission regression tests.
- `packages/opencode/src/session/processor.ts`: provider tool-result normalization and persistence.
- `packages/opencode/test/session/processor-effect.test.ts`: end-to-end processor image attachment regression test.
- `hosts/jetbrains-plugin/description.html`: generated release description.
- `hosts/jetbrains-plugin/changelog.html`: generated release changelog.

---

### Task 1: Restore the native read-only reviewer

**Files:**
- Modify: `packages/opencode/src/agent/agent.ts:12-15,200-225`
- Modify: `packages/opencode/test/agent/agent.test.ts:47-59,112-121`

**Interfaces:**
- Consumes: `Permission.merge(...)`, `Permission.fromConfig(...)`, existing `prompt/reviewer.txt`.
- Produces: `Agent.Service.get("reviewer") -> Agent.Info` with `mode: "subagent"` and `native: true`.

- [ ] **Step 1: Add failing default and configured-reviewer tests**

Extend the native-agent name assertion and add these cases near the explore-agent tests:

```ts
expect(names).toContain("reviewer")

it.instance("reviewer agent is a native read-only subagent", () =>
  Effect.gen(function* () {
    const reviewer = yield* load((svc) => svc.get("reviewer"))
    expect(reviewer?.native).toBe(true)
    expect(reviewer?.mode).toBe("subagent")
    expect(evalPerm(reviewer, "read")).toBe("allow")
    expect(evalPerm(reviewer, "grep")).toBe("allow")
    expect(evalPerm(reviewer, "glob")).toBe("allow")
    expect(evalPerm(reviewer, "edit")).toBe("deny")
    expect(evalPerm(reviewer, "write")).toBe("deny")
    expect(evalPerm(reviewer, "bash")).toBe("deny")
  }),
)

it.instance(
  "reviewer model override preserves native read-only semantics",
  () =>
    Effect.gen(function* () {
      const reviewer = yield* load((svc) => svc.get("reviewer"))
      expect(String(reviewer?.model?.providerID)).toBe("openai")
      expect(String(reviewer?.model?.modelID)).toBe("gpt-5")
      expect(reviewer?.native).toBe(true)
      expect(reviewer?.mode).toBe("subagent")
      expect(evalPerm(reviewer, "edit")).toBe("deny")
    }),
  { config: { agent: { reviewer: { model: "openai/gpt-5" } } } },
)
```

- [ ] **Step 2: Run the reviewer tests and confirm the regression**

Run from `packages/opencode`:

```powershell
bun test test/agent/agent.test.ts -t reviewer
```

Expected: FAIL because `reviewer` is absent or becomes a non-native `mode: "all"` agent when configured.

- [ ] **Step 3: Restore the reviewer definition**

Add the existing prompt import:

```ts
import PROMPT_REVIEWER from "./prompt/reviewer.txt"
```

Insert this built-in entry immediately after `explore` and before `compaction`:

```ts
reviewer: {
  name: "reviewer",
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      read: "allow",
      grep: "allow",
      glob: "allow",
    }),
    user,
  ),
  description:
    "Read-only review agent for checking task completion, architecture quality, code quality, necessary comments, risks, and test gaps during implementation or after changes are complete.",
  prompt: PROMPT_REVIEWER,
  options: {},
  mode: "subagent",
  native: true,
},
```

Do not add the old `experimentalScout` branch.

- [ ] **Step 4: Verify the focused test and package typecheck**

Run from `packages/opencode`:

```powershell
bun test test/agent/agent.test.ts -t reviewer
bun typecheck
```

Expected: both reviewer tests PASS; typecheck exits 0.

- [ ] **Step 5: Review checkpoint**

Inspect only the reviewer diff and verify that configured reviewer fields overlay the built-in entry rather than entering the unknown-agent branch. Do not commit without explicit user approval.

---

### Task 2: Restore provider-native generated-image persistence

**Files:**
- Modify: `packages/opencode/src/session/processor.ts:1-29,84-98,161-185,709-725`
- Modify: `packages/opencode/test/session/processor-effect.test.ts:189-210,968-1014`

**Interfaces:**
- Consumes: `normalizeImageGenerationOutput(input)`, `persistGeneratedImageAttachments(fs, root, attachments)`, `FSUtil.Service`.
- Produces: completed `SessionV1.ToolPart.state.attachments` with generated-image URLs and `relativePath`.

- [ ] **Step 1: Add a failing provider-image processor test**

Add a provider-executed image stream beside `providerErrorLLM`:

```ts
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAF/gL+ee1vNwAAAABJRU5ErkJggg=="

const providerImageLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolInputStart({ id: "call-image", name: "image_generation" }),
        LLMEvent.toolInputEnd({ id: "call-image", name: "image_generation" }),
        LLMEvent.toolCall({ id: "call-image", name: "image_generation", input: {}, providerExecuted: true }),
        LLMEvent.toolResult({
          id: "call-image",
          name: "image_generation",
          result: { type: "json", value: { result: pngBase64 } },
          providerExecuted: true,
        }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ),
  }),
)
const providerImageEnv = LayerNode.compile(root, [...replacements, [LLM.node, providerImageLLM]])
const itProviderImage = testEffect(providerImageEnv)
```

Add the integration assertion:

```ts
itProviderImage.live("persists provider-native generated images as attachments", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "generate an image")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "generate an image" }],
          tools: {},
        })

        const parts = yield* MessageV2.parts(msg.id)
        const call = parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
        expect(call?.state.status).toBe("completed")
        if (call?.state.status !== "completed") return
        expect(call.state.output).toBe("已生成 1 张图片：")
        expect(call.state.attachments?.[0]?.relativePath).toContain(".opencode/generated-images/")
        expect(await Bun.file(path.join(dir, call.state.attachments?.[0]?.relativePath ?? "missing")).exists()).toBe(true)
      }),
    { config: cfg },
  ),
)
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run from `packages/opencode`:

```powershell
bun test test/session/processor-effect.test.ts -t "provider-native generated images"
```

Expected: FAIL because the completed tool has no attachment or `relativePath`.

- [ ] **Step 3: Restore normalization and persistence in SessionProcessor**

Add imports:

```ts
import { FSUtil } from "@opencode-ai/core/fs-util"
import { normalizeImageGenerationOutput } from "./generated-image"
import { persistGeneratedImageAttachments } from "./generated-image-persistence"
```

Bind the service once in the layer:

```ts
const fs = yield* FSUtil.Service
```

Replace the body of `completeToolCall` after its running-state guard with:

```ts
const normalized = normalizeImageGenerationOutput({
  tool: match.part.tool,
  sessionID: match.part.sessionID,
  messageID: match.part.messageID,
  output,
})
const attachmentsExit = yield* persistGeneratedImageAttachments(
  fs,
  ctx.assistantMessage.path.root,
  normalized.attachments,
).pipe(Effect.exit)
if (Exit.isFailure(attachmentsExit)) {
  const detail = errorMessage(Cause.squash(attachmentsExit.cause))
  yield* failToolCall(toolCallID, new Error(`Failed to persist generated image attachment: ${detail}`))
  return
}
yield* session.updatePart({
  ...match.part,
  state: {
    status: "completed",
    input: match.part.state.input,
    output: normalized.output,
    metadata: normalized.metadata,
    title: normalized.title,
    time: { start: match.part.state.time.start, end: Date.now() },
    attachments: attachmentsExit.value,
  },
})
yield* settleToolCall(toolCallID)
```

Add `FSUtil.node` to `SessionProcessor.node.deps`.

- [ ] **Step 4: Verify image and processor regressions**

Run from `packages/opencode`:

```powershell
bun test test/session/processor-effect.test.ts -t "provider-native generated images"
bun test test/session/generated-image.test.ts test/session/generated-image-persistence.test.ts test/session/processor-streaming-input.test.ts
bun typecheck
```

Expected: all selected tests PASS; typecheck exits 0.

- [ ] **Step 5: Review checkpoint**

Confirm ordinary tool outputs still pass through unchanged and persistence failure produces a tool error instead of a completed part with broken URLs. Do not commit without explicit user approval.

---

### Task 3: Regenerate release content and restore preflight

**Files:**
- Regenerate: `hosts/jetbrains-plugin/description.html`
- Regenerate: `hosts/jetbrains-plugin/changelog.html`

**Interfaces:**
- Consumes: `script/release-content-sync.ts` and its canonical source data.
- Produces: byte-for-byte current release HTML accepted by preflight.

- [ ] **Step 1: Record the failing preflight check**

Run from the repository root:

```powershell
bun run release-content:check
```

Expected: FAIL listing exactly `hosts/jetbrains-plugin/description.html` and `hosts/jetbrains-plugin/changelog.html`.

- [ ] **Step 2: Regenerate through the canonical script**

Run from the repository root:

```powershell
bun run release-content:sync
```

Expected: the two generated HTML files are updated; no source code is changed.

- [ ] **Step 3: Verify release preflight input**

Run:

```powershell
bun run release-content:check
git diff --check -- hosts/jetbrains-plugin/description.html hosts/jetbrains-plugin/changelog.html
```

Expected: both commands exit 0.

- [ ] **Step 4: Review checkpoint**

Verify the HTML diff is generator-only formatting/content synchronization. Do not run Java/Gradle and do not commit without explicit user approval.

---

## Plan Verification

After all three tasks, run:

```powershell
bun run release-content:check
```

Then from `packages/opencode`:

```powershell
bun typecheck
bun test test/agent/agent.test.ts test/session/processor-effect.test.ts test/session/generated-image.test.ts test/session/generated-image-persistence.test.ts test/session/processor-streaming-input.test.ts
```

Expected: release check exits 0; all selected tests pass; typecheck exits 0.
