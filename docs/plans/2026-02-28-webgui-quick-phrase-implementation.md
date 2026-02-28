# WebGUI Quick Phrase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 webgui 内新增可配置快捷短语，并在聊天输入区通过双击触发发送或填充。

**Architecture:** 采用 `state/repo` 持久层 + `SettingsPanel` 配置 UI + `MessageInput` 展示与交互三层结构。数据存储走 `scopedStorage("global")`，加载时做 preset 同步，保证预置项可隐藏和排序但不可编辑删除。功能只落在 `packages/opencode/webgui`，不改上游 Config/schema。

**Tech Stack:** React 19 + TypeScript + Vitest + Testing Library + scopedStorage repo pattern

---

### Task 1: Define repository

**Files:**

- Create: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`
- Create: `packages/opencode/webgui/src/state/repo/quickPhrasePreset.ts`
- Test: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.test.ts`

**Step 1: Write the failing test**  
新增用例：`loadQuickPhrases` 会把 preset 与 global 存储合并，且返回模式默认值 `double_send`。  
新增用例：旧数据缺字段时能回退到安全结构。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts -t "loadQuickPhrases"`  
Expected: FAIL，提示 repo API 或 preset 同步逻辑不存在。

**Step 3: Write minimal implementation**  
实现 `quickPhraseRepo` 的类型、key、`loadQuickPhrases`、`saveQuickPhrases` 和 `syncPreset` 最小逻辑。  
实现 preset 常量与基础 merge 规则（按稳定 id 对齐）。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts -t "loadQuickPhrases"`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/state/repo/quickPhraseRepo.ts src/state/repo/quickPhrasePreset.ts src/state/repo/quickPhraseRepo.test.ts
git commit -m "feat(webgui): add quick phrase repo load and preset sync"
```

---

### Task 2: Add mutation rules

**Files:**

- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`
- Test: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.test.ts`

**Step 1: Write the failing test**  
新增用例覆盖 `addCustomPhrase`、`updateCustomPhrase`、`removeCustomPhrase`、`togglePhraseHidden`、`reorderPhrases`。  
新增用例确保 preset 仅允许隐藏/排序，不允许编辑/删除。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts -t "preset"`  
Expected: FAIL，提示 preset 保护规则未实现。

**Step 3: Write minimal implementation**  
补齐 mutation API，并沿用串行队列避免并发写覆盖。  
在 API 内统一做 source 判定与输入净化。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/state/repo/quickPhraseRepo.ts src/state/repo/quickPhraseRepo.test.ts
git commit -m "feat(webgui): enforce quick phrase mutation constraints"
```

---

### Task 3: Wire settings entry

**Files:**

- Modify: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
- Test: `packages/opencode/webgui/src/components/SettingsPanel/TabBar.test.tsx`
- Test: `packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx`
- Create: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`

**Step 1: Write the failing test**  
在 `TabBar.test.tsx` 增加“快捷短语”标签存在与切换断言。  
在 `index.test.tsx` 增加切换后渲染 `QuickPhrasesTab` 的断言。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx`  
Expected: FAIL，找不到新 Tab 或 panel 内容。

**Step 3: Write minimal implementation**  
扩展 tab union，添加“快捷短语”按钮并在 `SettingsPanel` 挂载新 Tab 组件。  
先传最小 props，确保结构可渲染。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/SettingsPanel/TabBar.tsx src/components/SettingsPanel/index.tsx src/components/SettingsPanel/TabBar.test.tsx src/components/SettingsPanel/index.test.tsx src/components/settings/QuickPhrasesTab.tsx
git commit -m "feat(webgui): add quick phrases tab entry in settings"
```

---

### Task 4: Build management form

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`
- Create: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.test.tsx`
- Modify: `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`（仅补充必要导出）

**Step 1: Write the failing test**  
新增组件测试：模式下拉可切换 `double_send / confirm_send / fill_input`。  
新增组件测试：自定义短语可新增、编辑、删除。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/settings/QuickPhrasesTab.test.tsx -t "自定义"`  
Expected: FAIL，操作入口或事件未实现。

**Step 3: Write minimal implementation**  
实现模式下拉和自定义列表 CRUD UI，调用 repo mutation。  
为 preset 项显示只读状态，禁用编辑/删除按钮。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/settings/QuickPhrasesTab.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/settings/QuickPhrasesTab.tsx src/components/settings/QuickPhrasesTab.test.tsx src/components/SettingsPanel/index.tsx src/state/repo/quickPhraseRepo.ts
git commit -m "feat(webgui): implement quick phrase settings CRUD and mode select"
```

---

### Task 5: Enforce hide and reorder

**Files:**

- Modify: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`
- Modify: `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.test.tsx`
- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`
- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.test.ts`

**Step 1: Write the failing test**  
新增测试：preset 允许隐藏/显示，允许调整顺序。  
新增测试：preset 编辑和删除操作被阻止并给出稳定行为。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts src/components/settings/QuickPhrasesTab.test.tsx -t "preset"`  
Expected: FAIL，预置限制或排序逻辑未达标。

**Step 3: Write minimal implementation**  
在 repo 增加隐藏与排序 API 并保持稳定 id 顺序。  
在 UI 提供隐藏开关和上移/下移按钮，preset 仅开放这两类操作。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts src/components/settings/QuickPhrasesTab.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/settings/QuickPhrasesTab.tsx src/components/settings/QuickPhrasesTab.test.tsx src/state/repo/quickPhraseRepo.ts src/state/repo/quickPhraseRepo.test.ts
git commit -m "feat(webgui): support preset hide and reorder rules"
```

---

### Task 6: Render phrase bar

**Files:**

- Create: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.tsx`
- Create: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: Write the failing test**  
新增 `QuickPhraseBar.test.tsx`：默认单行、横向滚动、存在展开/收起按钮。  
在 `index.test.tsx` 增加断言：输入区上方渲染快捷短语栏。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/MessageInput/QuickPhraseBar.test.tsx src/components/MessageInput/index.test.tsx -t "快捷短语"`  
Expected: FAIL，组件不存在或未挂载。

**Step 3: Write minimal implementation**  
实现 `QuickPhraseBar` 的布局与折叠状态，默认展示一行并可横向滚动。  
在 `MessageInput` 的 `EditorContent` 上方接入该组件。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/MessageInput/QuickPhraseBar.test.tsx src/components/MessageInput/index.test.tsx -t "快捷短语"`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/MessageInput/QuickPhraseBar.tsx src/components/MessageInput/QuickPhraseBar.test.tsx src/components/MessageInput/index.tsx src/components/MessageInput/index.test.tsx
git commit -m "feat(webgui): add quick phrase bar above message input"
```

---

### Task 7: Implement double-click actions

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.test.tsx`
- Modify: `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`（读取 mode）

**Step 1: Write the failing test**  
新增行为测试：仅双击触发，单击不触发。  
新增行为测试：`double_send` 直接发，`confirm_send` 走全局 `ConfirmModal`，`fill_input` 仅填充输入框不发送。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx -t "double"`  
Expected: FAIL，触发模式与确认流程未实现。

**Step 3: Write minimal implementation**  
在 bar 项绑定 `onDoubleClick`，按 mode 分发到发送、确认发送、填充输入。  
`confirm_send` 复用现有 `ConfirmModal` 组件并复用现有提交函数链路。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/MessageInput/QuickPhraseBar.tsx src/components/MessageInput/index.tsx src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx src/state/repo/quickPhraseRepo.ts
git commit -m "feat(webgui): support quick phrase double-click modes with confirm modal"
```

---

### Task 8: Align disabled state

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.test.tsx`
- Test: `packages/opencode/webgui/src/components/SettingsPanel/index.test.tsx`（回归）

**Step 1: Write the failing test**  
新增测试：AI 生成中快捷短语全禁用，空闲后恢复。  
新增测试：禁用规则与输入框 `isDisabled` 一致。

**Step 2: Run test to verify it fails**  
Run (in `packages/opencode/webgui`): `bun run test:run src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx -t "禁用"`  
Expected: FAIL，禁用态未完全对齐。

**Step 3: Write minimal implementation**  
把 `busy` 状态透传到 `QuickPhraseBar`，禁用所有标签和展开按钮。  
保持 UI 仅展示，不允许触发双击逻辑。

**Step 4: Run test to verify it passes**  
Run (in `packages/opencode/webgui`): `bun run test:run src/state/repo/quickPhraseRepo.test.ts src/components/SettingsPanel/index.test.tsx src/components/settings/QuickPhrasesTab.test.tsx src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx`  
Expected: PASS。

**Step 5: Commit**

```bash
git add src/components/MessageInput/index.tsx src/components/MessageInput/QuickPhraseBar.tsx src/components/MessageInput/index.test.tsx src/components/MessageInput/QuickPhraseBar.test.tsx src/components/SettingsPanel/index.test.tsx
git commit -m "fix(webgui): align quick phrase availability with message input state"
```

---

### 建议提交拆分

1. `feat(webgui): add quick phrase repo load and preset sync`
2. `feat(webgui): enforce quick phrase mutation constraints`
3. `feat(webgui): add quick phrases tab entry in settings`
4. `feat(webgui): implement quick phrase settings CRUD and mode select`
5. `feat(webgui): support preset hide and reorder rules`
6. `feat(webgui): add quick phrase bar above message input`
7. `feat(webgui): support quick phrase double-click modes with confirm modal`
8. `fix(webgui): align quick phrase availability with message input state`
