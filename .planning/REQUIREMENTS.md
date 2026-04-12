# Requirements: OpenCode IDE Plugin

**Defined:** 2026-04-12
**Core Value:** 上游合并后构建通过且功能不退化

## v1 Requirements

初始发布的需求。每项对应路线图中的阶段。

### Sync Foundation

- [ ] **SYNC-01**: 开发者可以在专用 sync 分支上执行上游 fetch + merge，不影响主开发分支
- [ ] **SYNC-02**: 合并后生成冲突检测报告，按风险区域分类（downstream-only / upstream-only / shared）
- [ ] **SYNC-03**: 合并后自动检查 SDK 是否需要重新生成（检测 server routes / openapi spec 变更）
- [ ] **SYNC-04**: 合并后检查 4 个 dependency patch 是否仍能正常应用
- [ ] **SYNC-05**: 提供清晰的回滚路径（sync 分支隔离，merge --abort / reset --hard）
- [ ] **SYNC-06**: 记录可重复的合并流程文档（检查单格式）

### Build Verification

- [ ] **BUILD-01**: 合并后自动运行 bun typecheck 验证类型安全
- [ ] **BUILD-02**: 合并后自动构建 webgui（vite build）
- [ ] **BUILD-03**: 合并后自动编译 VSCode 插件（pnpm + tsc）
- [ ] **BUILD-04**: 合并后自动编译 JetBrains 插件（gradle build）
- [ ] **BUILD-05**: 合并后运行测试套件（vitest for webgui, mocha for vscode）
- [ ] **BUILD-06**: 构建验证结果输出结构化报告（pass/fail per component）

### Impact Analysis

- [ ] **IMPACT-01**: 上游变更按区域分类为安全（upstream-only dirs）和风险（shared dirs）
- [ ] **IMPACT-02**: 实际 merge 前可以执行试运行预览冲突文件，不修改工作树
- [ ] **IMPACT-03**: 从上游 commit 历史提取变更日志，按类别分组（feat/fix/refactor/breaking）
- [ ] **IMPACT-04**: 记录每次同步的元数据（时间、吸收的 commit 数、冲突数），追踪合并频率

## v2 Requirements

推迟到未来版本。已记录但不在当前路线图中。

### Deep Analysis

- **DEEP-01**: 自动 diff 上游路由定义，检测影响 WebGUI 的 API 合同变更
- **DEEP-02**: 检测 config schema 变更，标记影响 webgui 设置面板的字段修改
- **DEEP-03**: 对每个冲突文件建议合并策略（take upstream / take ours / manual merge）
- **DEEP-04**: 对比 package.json catalog 版本，报告 TypeScript/依赖版本偏差
- **DEEP-05**: 追踪上游 TUI 功能在 WebGUI 中的实现对等度

### Evolving Needs

- **EVOLVE-01**: 后续优化需求（待明确，随上游更新和用户需求陆续提出）

## Out of Scope

| Feature                    | Reason                                                             |
| -------------------------- | ------------------------------------------------------------------ |
| Automatic merge resolution | any 类型 (434+) 导致自动解决无法被类型系统验证，必须人工审查       |
| Cherry-pick workflow       | 创建平行历史，每次 cherry-pick 都是合并债务，长期更难维护          |
| Rebase onto upstream       | 384 个下游 commit 的 rebase 会重写历史，破坏 PR                    |
| 自动定时触发合并 (cron)    | 上游变化过快，无人监管的自动合并会产生坏分支                       |
| 双向同步（贡献回上游）     | 下游有中文 UI、React 替代 SolidJS 等差异，几乎无法直接上游化       |
| Git submodule 隔离上游     | 项目修改了上游文件（patches, SDK, build config），submodule 不支持 |
| 自动修补 sdkClient.ts      | 手写的 566 行 fetch wrapper 用 any 类型，自动修补会引入隐蔽 bug    |

## Traceability

需求与阶段的映射关系。在路线图创建时更新。

| Requirement | Phase                       | Status  |
| ----------- | --------------------------- | ------- |
| SYNC-01     | Phase 1: Merge Foundation   | Pending |
| SYNC-02     | Phase 3: Conflict Detection | Pending |
| SYNC-03     | Phase 3: Conflict Detection | Pending |
| SYNC-04     | Phase 3: Conflict Detection | Pending |
| SYNC-05     | Phase 1: Merge Foundation   | Pending |
| SYNC-06     | Phase 1: Merge Foundation   | Pending |
| BUILD-01    | Phase 2: Build Verification | Pending |
| BUILD-02    | Phase 2: Build Verification | Pending |
| BUILD-03    | Phase 2: Build Verification | Pending |
| BUILD-04    | Phase 2: Build Verification | Pending |
| BUILD-05    | Phase 2: Build Verification | Pending |
| BUILD-06    | Phase 2: Build Verification | Pending |
| IMPACT-01   | Phase 4: Impact Analysis    | Pending |
| IMPACT-02   | Phase 4: Impact Analysis    | Pending |
| IMPACT-03   | Phase 4: Impact Analysis    | Pending |
| IMPACT-04   | Phase 4: Impact Analysis    | Pending |

**Coverage:**

- v1 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0

---

_Requirements defined: 2026-04-12_
_Last updated: 2026-04-12 after initial definition_
