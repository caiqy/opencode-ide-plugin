# Lightweight Specification: Existing Capabilities Baseline

**Feature Branch**: baseline only
**Created**: 2026-05-18
**Status**: 基线
**Input**: 用户确认需要把现有功能整理为 Spec Kit 文档。

## User Scenarios & Testing _(mandatory)_

### User Story 1 - 在 IDE 中使用 WebGUI (Priority: P1)

作为开发者，我可以从 VSCode 或 JetBrains 打开 OpenCode，并在 IDE 内使用 WebGUI chat，而不需要离开当前 workspace。

**Why this priority**: 这是本仓库的核心价值。

**Independent Test**: 打开 IDE panel/tool window，确认 backend launch、WebGUI load、session creation 和 prompt entry 都可用。

**Acceptance Scenarios**:

1. **Given** 一个受支持的 IDE workspace，**When** 用户打开 OpenCode panel/tool window，**Then** plugin 会启动或连接 opencode backend，并加载 `/app`。
2. **Given** WebGUI 已在 IDE 中加载，**When** 用户创建 session 并发送文本，**Then** session 会出现并收到 message updates。

---

### User Story 2 - 向 prompt 添加 IDE context (Priority: P1)

作为开发者，我可以把 IDE 中的文件、选中行、拖拽文件或粘贴路径加入当前 WebGUI prompt。

**Why this priority**: context insertion 是 IDE 集成的核心工作流。

**Independent Test**: 在受影响 IDE host 中执行每个 context command，并确认 message input 收到预期 path 或 line-range context。

**Acceptance Scenarios**:

1. **Given** IDE 中有一个文件，**When** 用户选择 Add to context，**Then** 当前 prompt 包含该文件路径。
2. **Given** editor 中有选中行，**When** 用户选择 Add lines to context，**Then** 当前 prompt 包含 line-range reference。
3. **Given** path insertion command 或 drag/drop action，**When** host 发送 bridge event，**Then** WebGUI 插入路径且不破坏普通文本输入。

---

### User Story 3 - 保留 upstream opencode 行为 (Priority: P1)

作为 maintainer，我可以合并 upstream opencode 改动，同时保留 upstream core behavior 和本地 WebGUI / IDE adaptations。

**Why this priority**: 本仓库必须持续跟进 upstream，同时不能让 IDE 支持变得脆弱。

**Independent Test**: 对每个 upstream merge conflict，确认 upstream logic 和 local logic 是否都被保留；运行受影响的 core/WebGUI/IDE validation。

**Acceptance Scenarios**:

1. **Given** shared core code 中出现 upstream conflict，**When** conflict 被解决，**Then** resolution 记录 upstream behavior 与 IDE/WebGUI behavior 如何被保留。
2. **Given** 存在不可避免的不兼容，**When** 两种行为无法共存，**Then** implementation 停止，直到用户选择取舍。

---

### User Story 4 - 打包 IDE plugins (Priority: P2)

作为 maintainer，我可以产出可测试的 VSCode 和 JetBrains plugin artifacts，并包含预期 bundled backend 和 version metadata。

**Why this priority**: packaging 是本地测试和发布的必要前提。

**Independent Test**: 运行对应 packaging command，并验证 artifact 存在且包含预期 version 和 bundled binary/metadata。

**Acceptance Scenarios**:

1. **Given** 一个 VSCode Windows package request，**When** VSIX workflow 运行，**Then** artifact 包含 Windows amd64 backend binary 和正确 manifest version。
2. **Given** 一个 JetBrains plugin package request，**When** `buildPlugin` 使用计算出的 version property 运行，**Then** 生成 plugin ZIP。

## Compatibility & Regression Constraints _(mandatory for this repository)_

- **Upstream Compatibility**: 现有 opencode CLI、TUI、API 和 server behavior 必须保持兼容，除非 future spec 明确变更。
- **Affected Clients**: opencode core, WebGUI `/app`, VSCode plugin, JetBrains plugin。
- **No-Regression Requirement**: `overview.md` 中的 capabilities 和 `regression-matrix.md` 中的 rows 是当前 baseline。
- **Clarifications Needed**: 基线清单本身无待澄清项。future changes 如果改变列出的 capability，必须在 implementation 前澄清 scope 和 client impact。

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: opencode MUST 在 `/app` 提供 WebGUI SPA，支持 asset serving 和 SPA fallback，并且必须在 workspace routes 拦截前处理。
- **FR-002**: WebGUI MUST 支持 session creation、session switching、message loading、prompt entry、message display 和 SSE-driven updates。
- **FR-003**: WebGUI MUST 同时能在 browser-like context 和 VSCode / JetBrains host views 中运行。
- **FR-004**: IDE hosts MUST 提供 token-protected local bridge，支持 SSE events 和 POST request/reply semantics。
- **FR-005**: IDE hosts MUST 支持 files、selected lines、pasted paths 和 supported drag/drop paths 的 context insertion workflows。
- **FR-006**: IDE hosts MUST 启动或连接 `opencode serve`，并在 backend ready 后加载 `/app` WebGUI。
- **FR-007**: storage-backed WebGUI preferences 和 session UI state MUST 保留其已记录的 scope behavior。
- **FR-008**: packaging workflows MUST 产出包含 required version metadata 和 bundled resources 的 artifacts。
- **FR-009**: Future changes MUST 提供映射到 affected regression matrix rows 的 validation evidence。

### Key Entities _(include if feature involves data)_

- **Session**: opencode conversation state，由 WebGUI 展示并由用户选择。
- **Bridge Session**: IDE-host local connection，包含 session ID、token、metadata、handlers 和 SSE clients。
- **Client Surface**: opencode core、WebGUI、VSCode plugin、JetBrains plugin 中的一个。
- **Validation Evidence**: 用于证明 requirement 或 regression matrix row 的 command result 或 manual scenario result。

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 每个高风险 future change 都能通过 `overview.md` 识别 affected clients，而无需从零重新探索仓库。
- **SC-002**: 每次 upstream merge 都能从 `regression-matrix.md` 选择 relevant rows，并记录 validation evidence 或 waiver。
- **SC-003**: 每个 future implementation summary 在适用时都能引用 `validation.md`，为每个受影响 package 提供至少一个 executable command。
- **SC-004**: 任何 future planned change 都不得移除 baseline capability，除非有 explicit spec requirement 和 user-approved tradeoff。

## Assumptions

- 本 baseline 描述当前已知行为；它不保证每个行为都已经拥有完整 automated tests。
- Future feature specs 可以 supersede 单项 baseline requirement，但必须明确 intended change 和 affected clients。
- 对难以用 unit tests 覆盖的 host integration behavior，manual IDE checks 仍然必要。
