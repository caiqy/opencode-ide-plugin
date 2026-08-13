---
change: merge-upstream-tags
design-doc: docs/superpowers/specs/2026-08-10-merge-upstream-tags-design.md
base-ref: baf0674fd108ac43785cb4f4622c6f58e7c645f6
---

# 上游逐 Tag 合并实施计划

> **供执行型 Agent 使用：** 每个任务开始前都重新加载下文的“可恢复会话函数块”。使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐项执行；不得跳过停止条件。

**目标：** 从 `v1.18.7` 起顺序集成 `opencode` 的稳定 release tag，保留每个 tag 的独立双父 merge 边界，并在每一边界完成严格零失败验证，直至远端前沿一次查询无新增。

**架构：** 先建立从所有 workspace package manifest 反向依赖图推导的验证影响闭包，再将当前 HEAD 的完整闭包修至严格零失败。每个 tag 是独立事务：精确获取、语义冲突处理、必要生成、隔离 merge index、双父提交、闭包验证和必要聚焦修复；报告中的机器可读快照使任意任务可跨会话恢复。

**技术栈：** Git、PowerShell 7、vfox 管理的 Bun `1.3.14`、Node.js `22.23.1`、Corepack/pnpm、Bun test、TypeScript 原生预览 typecheck。

## 全局约束

- 事实源为 [Design Doc](../specs/2026-08-10-merge-upstream-tags-design.md) 与 `docs/openspec/changes/merge-upstream-tags/specs/upstream-release-integration/spec.md`。下方任务 1-28 与 OpenSpec 28 项 task 一一对应。
- Build 工作方式必须在执行前由 Comet 与用户联合决策并写入 `docs/openspec/changes/merge-upstream-tags/.comet.yaml`。本计划只断言该决定，绝不创建、切换或删除分支/worktree。
- branch/worktree 决定要求当前分支等于 `bound_branch`，且不得是 `ide-plugin`；worktree 还要求绝对 `git-dir` 与 `git-common-dir` 不同。`current` 仅在 Comet `direct_override` 明确记录用户联合选择和设计偏差时可用。分支名必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+){0,2}$`；推荐值为 `merge-upstream-tags`。
- 仅接受 `opencode` remote 的稳定 `vMAJOR.MINOR.PATCH` tag；不得使用 `dev`、`latest` 或任意未标记 commit。
- 每个 release merge 必须恰有两个父提交：第一父是该轮开始前已验证状态，第二父精确为远端 tag 的 peeled commit；提交信息精确为 `chore(opencode): merge upstream vX.Y.Z`。
- 每轮 merge 前 staged index 必须为空。merge index 只包含 Git 自动合并结果、逐项调查后的冲突解决和规定生成物；报告、OpenSpec、Native、Design、计划和初始 dirty 路径不得进入 merge/fix 提交。branch 隔离允许 initial marker 中的既有 dirty 路径原样保留，但不得修改、stage 或提交。
- 所有 native 命令必须经会话函数显式检查退出码。`git merge --no-ff --no-commit` 是唯一例外：退出 0 可继续；非 0 仅在 exit 为 1、`MERGE_HEAD` 精确等于 tag peeled commit 且 unmerged index 非空时作为冲突现场继续。
- 不使用整文件 `ours`/`theirs` 解决语义冲突；不手工拼 `bun.lock`；不直接编辑 `packages/client/src/generated/**`、`packages/client/src/generated-effect/**` 或 legacy SDK 生成输出。
- 公共 Protocol 或 Server `HttpApi` 变化必须同时从 `packages/client` 运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run generate`，并从 `packages/sdk/js` 运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build`。只能提交这些命令的输出。
- 测试、typecheck 和 build 一律从 owning package 目录运行。typecheck 一律为 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck`，禁止直接运行 `tsc`。
- 当前 Windows Classic change 的 `@opencode-ai/core` 和 `@opencode-ai/sdk-next` 测试 gate 分别固定为从 owning package 运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --only-failures --max-concurrency=1` 和 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --timeout 5000 --max-concurrency=1`；仅改变本 change 的验证调度，不修改 package script、测试范围或其他 package gate。baseline、逐 tag 和最终验证统一从 report matrix 读取对应命令。
- 严格零失败表示每条门禁的失败和错误均为 0。既有 intentional skip/todo 可以保留，但任务 3 或任务 24 的动态扩展基线必须记录每个 package 的数量，后续任何轮次都不得增加、启用或新增 skip/todo 来规避失败。
- 等价替换候选必须记录双方入口、调用路径、输出、覆盖、风险和建议后暂停，等待用户明确选择；不得自行替换。
- 不运行 App Playwright E2E、benchmark、稳定性测试或 Desktop 平台打包。VS Code 验证只运行 compile/test，不运行任何 `package` 或 VSIX 打包脚本。
- 持续维护 `docs/superpowers/reports/2026-08-10-merge-upstream-tags.md`。报告命令行只保留完整命令、退出码、计数和首个失败签名，不复制完整终端日志。
- 每个聚焦修复和等价候选先在报告写入唯一 marker。fix 使用 `merge-upstream-tags:fix`，等价候选使用 `merge-upstream-tags:equivalence`；均以 tag 和从 1 递增的 N 标识，`paths` 必须是调查完成后的唯一 repo-relative `/` 路径。函数会机器断言 marker 恰好一个、路径唯一且合法。
- 发现等价候选后必须运行 `Assert-EquivalenceMarker tag N`，确认 marker 有唯一、合法 paths 和 recommendation 后暂停；报告 marker 不是自动选择上游替换的授权。
- 所有规划产物、报告和 OpenSpec tasks 提交均使用 `Commit-ExactPaths` 的精确 allowlist 与 `git commit --only`；已有 staged 路径使操作停止，不能被任一文档提交混入。
- fix 候选路径仅由 `git diff --name-only --no-renames`、`git diff --cached --name-only --no-renames` 和 `git ls-files --others --exclude-standard` 的路径集合提供；诊断从中明确选择唯一 repo-relative `/` 列表写入 marker，绝不以全量 diff 自动决定 fixPaths。`--no-renames` 使 rename 以删除/新增两条路径表示，故新增、删除和 rename 均可精确 stage/比对。

## 文件边界

- 创建/修改：`docs/superpowers/reports/2026-08-10-merge-upstream-tags.md`，保存环境、机器可读初始快照、每 tag 的对象 SHA/peeled commit、闭包、门禁、冲突、修复、前沿和审计证据。
- 修改：`docs/openspec/changes/merge-upstream-tags/tasks.md`，仅在对应验收实际完成后勾选。
- 条件修改：运行时由冲突 index、报告中的诊断 owning path 和实际 diff 确定的源码、测试、manifest、lockfile 或命令生成物；不得预设冲突文件名。
- 禁止直接修改：Runtime 管理的 Comet 状态、原 `ide-plugin` worktree、`packages/client/src/generated/**`、`packages/client/src/generated-effect/**` 和 SDK 生成物；Comet 状态只通过公开 Runtime 命令推进，生成物只通过规定命令更新。

## 可恢复会话函数块

在每个任务开始时，从仓库根目录完整粘贴并执行本块。它不写入仓库，不创建脚本；任何后续函数都不依赖上一 PowerShell 会话变量。

```powershell
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$BaseRef = 'baf0674fd108ac43785cb4f4622c6f58e7c645f6'
$InitialStateRef = '76e3d3c007ac74e9321112b86ac0dab12e29e8d8'
$ReportPath = 'docs/superpowers/reports/2026-08-10-merge-upstream-tags.md'
$PlanPath = 'docs/superpowers/plans/2026-08-10-merge-upstream-tags.md'
$DesignPath = 'docs/superpowers/specs/2026-08-10-merge-upstream-tags-design.md'
$TasksPath = 'docs/openspec/changes/merge-upstream-tags/tasks.md'
$CometPath = 'docs/openspec/changes/merge-upstream-tags/.comet.yaml'
$repoRootLines = @(& git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse --show-toplevel failed' }
# PowerShell 会把函数的单行输出展开成标量；所有单值都先保留为数组并断言数量。
if ($repoRootLines.Count -ne 1) { throw 'git rev-parse --show-toplevel did not return exactly one line' }
$RepoRoot = $repoRootLines[0].Trim()

function Assert-NativeExit([string]$Step, [int]$ExitCode) {
  if ($ExitCode -ne 0) { throw "$Step failed with exit code $ExitCode" }
}

function Invoke-GitChecked([string]$Step, [string[]]$Arguments) {
  $output = @(& git @Arguments)
  Assert-NativeExit "git $Step" $LASTEXITCODE
  return $output
}

function Get-OneLine([string]$Step, [string[]]$Lines) {
  $values = @($Lines | Where-Object { $_ -ne '' })
  if ($values.Count -ne 1) { throw "$Step must return exactly one non-empty line, got $($values.Count)" }
  return $values[0].Trim()
}

function Invoke-Checked([string]$Step, [scriptblock]$Command) {
  & $Command
  Assert-NativeExit $Step $LASTEXITCODE
}

function Get-GitRef([string]$Ref) {
  $lines = @(Invoke-GitChecked "rev-parse $Ref" @('rev-parse', '--verify', $Ref))
  return Get-OneLine "git rev-parse $Ref" $lines
}

function Get-OptionalGitRef([string]$Ref) {
  $output = @(& git rev-parse -q --verify $Ref)
  $exit = $LASTEXITCODE
  if ($exit -eq 0) { return Get-OneLine "git rev-parse $Ref" $output }
  if ($exit -eq 1) { return $null }
  throw "git rev-parse $Ref failed with exit code $exit"
}

function Assert-IndexEmpty {
  & git diff --cached --quiet
  $exit = $LASTEXITCODE
  if ($exit -eq 0) { return }
  if ($exit -eq 1) { throw 'staged index is not empty before merge' }
  throw "git diff --cached --quiet failed with exit code $exit"
}

function Assert-NoUnmergedIndex {
  $unmerged = @(Invoke-GitChecked 'list unmerged paths' @('diff', '--name-only', '--diff-filter=U'))
  if ($unmerged.Count -gt 0) { throw "unmerged paths remain: $($unmerged -join ', ')" }
}

function Get-CometScalar([string]$Name) {
  $line = @(Get-Content -LiteralPath $CometPath | Where-Object { $_ -match "^$([regex]::Escape($Name)):\s*" })
  if ($line.Count -ne 1) { throw "expected exactly one $Name entry in $CometPath" }
  return (($line[0] -replace "^$([regex]::Escape($Name)):\s*", '').Trim().Trim("'", '"'))
}

function Assert-ExecutionWorkspace {
  $boundBranch = Get-CometScalar 'bound_branch'
  $isolation = Get-CometScalar 'isolation'
  $directOverride = Get-CometScalar 'direct_override'
  if ($boundBranch -in @('', 'null')) { throw 'Comet bound_branch is not applied; stop for the joint Build decision' }
  if ($isolation -notin @('branch', 'worktree', 'current')) { throw 'Comet isolation is not a supported joint Build decision' }
  if ($boundBranch -notmatch '^[a-z0-9]+(?:-[a-z0-9]+){0,2}$') { throw "invalid bound branch name: $boundBranch" }
  $branchLines = @(Invoke-GitChecked 'branch --show-current' @('branch', '--show-current'))
  $branch = Get-OneLine 'git branch --show-current' $branchLines
  if ($branch -ne $boundBranch) { throw "current branch $branch does not equal Comet bound_branch $boundBranch" }
  if ($isolation -in @('branch', 'worktree') -and $branch -eq 'ide-plugin') { throw 'branch/worktree Build decision may not execute on ide-plugin' }
  $worktrees = @(Invoke-GitChecked 'worktree list' @('worktree', 'list', '--porcelain'))
  if ($worktrees -notcontains "worktree $RepoRoot") { throw 'current repository root is absent from git worktree list' }
  if ($isolation -eq 'worktree') {
    $gitDirLines = @(Invoke-GitChecked 'absolute git dir' @('rev-parse', '--absolute-git-dir'))
    $commonDirLines = @(Invoke-GitChecked 'git common dir' @('rev-parse', '--git-common-dir'))
    $gitDir = Get-OneLine 'git --absolute-git-dir' $gitDirLines
    $commonDir = Get-OneLine 'git --git-common-dir' $commonDirLines
    $commonAbsolute = if ([IO.Path]::IsPathRooted($commonDir)) { [IO.Path]::GetFullPath($commonDir) } else { [IO.Path]::GetFullPath((Join-Path $RepoRoot $commonDir)) }
    if ([IO.Path]::GetFullPath($gitDir) -eq $commonAbsolute) { throw 'worktree isolation requires git-dir and git-common-dir to differ' }
  }
  if ($isolation -eq 'current' -and $directOverride -in @('', 'null')) { throw 'current isolation requires an explicit Comet/user direct_override and recorded design deviation' }
  return [pscustomobject]@{ Branch = $branch; Isolation = $isolation; DirectOverride = $directOverride; Root = $RepoRoot }
}

function Get-RemoteTagObject([string]$Tag) {
  $lines = @(Invoke-GitChecked "ls-remote $Tag" @('ls-remote', '--tags', 'opencode', "refs/tags/$Tag", "refs/tags/$Tag^{}"))
  $objectLine = @($lines | Where-Object { $_ -match "\srefs/tags/$([regex]::Escape($Tag))$" })
  if ($objectLine.Count -ne 1) { throw "$Tag is missing or ambiguous on opencode" }
  $objectFields = @($objectLine[0] -split '\s+')
  if ($objectFields.Count -ne 2) { throw "$Tag remote object line is malformed" }
  $object = $objectFields[0]
  $peeledLine = @($lines | Where-Object { $_ -match "\srefs/tags/$([regex]::Escape($Tag))\^\{\}$" })
  if ($peeledLine.Count -gt 1) { throw "$Tag has multiple peeled refs" }
  $peeled = if ($peeledLine.Count -eq 0) { $object } else {
    $peeledFields = @($peeledLine[0] -split '\s+')
    if ($peeledFields.Count -ne 2) { throw "$Tag remote peeled line is malformed" }
    $peeledFields[0]
  }
  return [pscustomobject]@{ Tag = $Tag; Object = $object; Peeled = $peeled; Annotated = ($peeled -ne $object) }
}

function Fetch-VerifiedTag([string]$Tag) {
  $remote = Get-RemoteTagObject $Tag
  Invoke-GitChecked "fetch $Tag" @('fetch', '--no-tags', 'opencode', "refs/tags/${Tag}:refs/tags/${Tag}") | Out-Null
  $localObject = Get-GitRef "refs/tags/$Tag"
  $localPeeled = Get-GitRef "$Tag^{commit}"
  if ($localObject -ne $remote.Object) { throw "$Tag local tag object does not match remote object" }
  if ($localPeeled -ne $remote.Peeled) { throw "$Tag local peeled commit does not match remote peeled commit" }
  return $remote
}

function Get-StableReleaseTags {
  $lines = @(Invoke-GitChecked 'ls-remote stable tags' @('ls-remote', '--tags', '--refs', 'opencode'))
  return @($lines | ForEach-Object {
    $parts = $_ -split '\s+'
    if ($parts.Count -ne 2) { throw "stable tag line is malformed: $_" }
    $tag = $parts[1] -replace '^refs/tags/', ''
    if ($tag -match '^v\d+\.\d+\.\d+$') { [pscustomobject]@{ Tag = $tag; Version = [version]$tag.Substring(1) } }
  } | Sort-Object Version)
}

function Get-KnownTagNames {
  return @('v1.18.7','v1.18.8','v1.18.9','v1.18.10','v1.18.11','v1.18.12','v1.18.13','v1.18.14','v1.18.15','v1.18.16')
}

function Get-LatestVerifiedTag {
  $verified = @((Invoke-GitChecked 'verified tag subjects' @('log', '--first-parent', '--format=%s', "$BaseRef..HEAD")) |
    Where-Object { $_ -match '^docs\(opencode\): verify upstream v\d+\.\d+\.\d+$' } |
    ForEach-Object { $_ -replace '^docs\(opencode\): verify upstream ', '' } |
    Sort-Object { [version]$_.Substring(1) })
  if ($verified.Count -eq 0) { throw 'no verified upstream tag exists' }
  $latest = $verified[-1]
  Get-TagMergeRecord $latest | Out-Null
  return $latest
}

function Get-PendingReleaseTags {
  $latest = Get-LatestVerifiedTag
  $frontier = [version]$latest.Substring(1)
  return @(Get-StableReleaseTags | Where-Object { $_.Version -gt $frontier })
}

function Get-InitialState {
  Invoke-GitChecked 'initial state source ancestor' @('merge-base', '--is-ancestor', $InitialStateRef, 'HEAD') | Out-Null
  $content = (@(Invoke-GitChecked 'show initial state report' @('show', "${InitialStateRef}:$ReportPath")) -join "`n")
  $matches = @([regex]::Matches($content, '<!-- merge-upstream-tags:initial (?<json>\{.*?\}) -->', 'Singleline'))
  if ($matches.Count -ne 1) { throw 'report must contain exactly one merge-upstream-tags initial-state marker' }
  return ($matches[0].Groups['json'].Value | ConvertFrom-Json)
}

function Get-PathFingerprint([string]$Path) {
  $fullPath = Join-Path $RepoRoot $Path
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { return '<missing>' }
  return (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-InitialDirtyUnchanged {
  $initial = Get-InitialState
  foreach ($path in @($initial.protected)) {
    $property = $initial.fingerprints.PSObject.Properties[$path]
    if ($null -eq $property) { throw "initial dirty path lacks fingerprint: $path" }
    if ((Get-PathFingerprint $path) -ne $property.Value) { throw "initial dirty path changed: $path" }
  }
}

function Assert-RepositoryPathSet([string]$Label, [string[]]$Paths) {
  if ($Paths.Count -eq 0) { throw "$Label has no paths" }
  $invalid = @($Paths | Where-Object {
    [string]::IsNullOrWhiteSpace($_) -or $_ -match '\\' -or $_ -match '^/' -or $_ -match '(^|/)\.\.(/|$)'
  })
  if ($invalid.Count -gt 0) { throw "$Label has invalid repo-relative slash paths: $($invalid -join ', ')" }
  $duplicates = @($Paths | Group-Object | Where-Object { $_.Count -ne 1 } | ForEach-Object Name)
  if ($duplicates.Count -gt 0) { throw "$Label has duplicate paths: $($duplicates -join ', ')" }
}

function Get-ReportMarker([string]$Kind, [string]$Tag, [int]$Attempt) {
  $content = [IO.File]::ReadAllText((Join-Path $RepoRoot $ReportPath))
  $pattern = "<!-- merge-upstream-tags:$([regex]::Escape($Kind)):$([regex]::Escape($Tag)):$Attempt (?<json>\{.*?\}) -->"
  $matches = @([regex]::Matches($content, $pattern, 'Singleline'))
  if ($matches.Count -ne 1) { throw "report must contain exactly one $Kind marker for $Tag attempt $Attempt" }
  $marker = $matches[0].Groups['json'].Value | ConvertFrom-Json
  $paths = @($marker.paths)
  Assert-RepositoryPathSet "$Kind marker for $Tag attempt $Attempt" ([string[]]$paths)
  return $marker
}

function Get-DiagnosedFixPaths([string]$Tag, [int]$Attempt) {
  $marker = Get-ReportMarker 'fix' $Tag $Attempt
  return [string[]]@($marker.paths)
}

function Assert-EquivalenceMarker([string]$Tag, [int]$Attempt) {
  $marker = Get-ReportMarker 'equivalence' $Tag $Attempt
  if ([string]::IsNullOrWhiteSpace($marker.recommendation)) { throw "equivalence marker for $Tag attempt $Attempt lacks a recommendation" }
  return $marker
}

function Get-StatusSnapshot {
  $unstaged = @(Invoke-GitChecked 'list unstaged paths' @('diff', '--name-only', '--no-renames'))
  $staged = @(Invoke-GitChecked 'list staged paths' @('diff', '--cached', '--name-only', '--no-renames'))
  $untracked = @(Invoke-GitChecked 'list untracked paths' @('ls-files', '--others', '--exclude-standard'))
  return [pscustomobject]@{ Dirty = @($unstaged + $untracked | Sort-Object -Unique); Staged = @($staged | Sort-Object -Unique); Untracked = $untracked }
}

function Get-InitialStatusRecord {
  $porcelain = @(Invoke-GitChecked 'record initial porcelain status' @('status', '--porcelain=v1', '--untracked-files=all'))
  $snapshot = Get-StatusSnapshot
  return [pscustomobject]@{ Porcelain = $porcelain; Dirty = $snapshot.Dirty; Staged = $snapshot.Staged; Untracked = $snapshot.Untracked }
}

function Assert-ExactPathSet([string]$Label, [string[]]$Actual, [string[]]$Expected) {
  $difference = @(Compare-Object -ReferenceObject @($Expected | Sort-Object -Unique) -DifferenceObject @($Actual | Sort-Object -Unique))
  if ($difference.Count -gt 0) { throw "$Label differs from the explicit path set: $($difference.InputObject -join ', ')" }
}

function Commit-ExactPaths([string]$Message, [string[]]$Paths) {
  Assert-IndexEmpty
  Assert-RepositoryPathSet "commit $Message" $Paths
  Invoke-GitChecked "stage $Message" (@('add', '--') + $Paths) | Out-Null
  $staged = @(Invoke-GitChecked "list staged $Message paths" @('diff', '--cached', '--name-only', '--no-renames'))
  Assert-ExactPathSet "staged $Message" $staged $Paths
  Invoke-GitChecked "commit $Message" (@('commit', '--only', '-m', $Message, '--') + $Paths) | Out-Null
  Assert-IndexEmpty
}

function Commit-ChangeArtifacts([string]$Message) {
  Assert-IndexEmpty
  $changePrefix = 'docs/openspec/changes/merge-upstream-tags/'
  $changeRoot = Join-Path $RepoRoot $changePrefix
  $changePaths = @(Get-ChildItem -LiteralPath $changeRoot -Recurse -File -Force | ForEach-Object {
    [IO.Path]::GetRelativePath($RepoRoot, $_.FullName).Replace('\', '/')
  })
  if ($changePaths.Count -eq 0) { throw 'merge-upstream-tags change prefix has no artifacts' }
  $nativePrefix = 'docs/comet/changes/merge-upstream-tags/'
  $nativeRoot = Join-Path $RepoRoot $nativePrefix
  $nativePaths = @(Get-ChildItem -LiteralPath $nativeRoot -Recurse -File -Force | ForEach-Object {
    [IO.Path]::GetRelativePath($RepoRoot, $_.FullName).Replace('\', '/')
  })
  if ($nativePaths.Count -eq 0) { throw 'merge-upstream-tags Native change prefix has no artifacts' }
  $expected = @($changePaths + $nativePaths + $DesignPath + $PlanPath + $ReportPath | Sort-Object -Unique)
  Assert-RepositoryPathSet 'planning artifact allowlist' $expected
  Invoke-GitChecked 'stage complete change artifacts' (@('add', '-f', '--') + $expected) | Out-Null
  $staged = @(Invoke-GitChecked 'list staged planning artifacts' @('diff', '--cached', '--name-only', '--no-renames'))
  $outsidePrefix = @($staged | Where-Object { $_ -notlike "$changePrefix*" -and $_ -notlike "$nativePrefix*" -and $_ -notin @($DesignPath, $PlanPath, $ReportPath) })
  if ($outsidePrefix.Count -gt 0) { throw "planning stage escaped the change-prefix allowlist: $($outsidePrefix -join ', ')" }
  Assert-ExactPathSet 'staged complete planning artifacts' $staged $expected
  Invoke-GitChecked 'commit complete change artifacts' (@('commit', '--only', '-m', $Message, '--') + $expected) | Out-Null
  Assert-IndexEmpty
}

function Commit-DocumentSubset([string]$Message) {
  Assert-IndexEmpty
  $tracked = @(Invoke-GitChecked "list modified docs for $Message" @('diff', '--name-only', '--no-renames', '--', $ReportPath, $TasksPath))
  $untracked = @(Invoke-GitChecked "list untracked docs for $Message" @('ls-files', '--others', '--exclude-standard', '--', $ReportPath, $TasksPath))
  $paths = @($tracked + $untracked | Sort-Object -Unique)
  if ($paths.Count -eq 0) { return $false }
  Commit-ExactPaths $Message $paths
  return $true
}

function Assert-FixPaths([string[]]$FixPaths) {
  Assert-InitialDirtyUnchanged
  $initial = Get-InitialState
  Assert-RepositoryPathSet 'focused fix' $FixPaths
  $forbidden = @($FixPaths | Where-Object {
    $_ -eq $ReportPath -or $_ -eq $TasksPath -or $_ -eq $DesignPath -or $_ -eq $PlanPath -or
    $_ -like 'docs/openspec/changes/merge-upstream-tags/*' -or $_ -like 'docs/comet/changes/merge-upstream-tags/*' -or
    $initial.dirty -contains $_ -or $initial.staged -contains $_
  })
  if ($forbidden.Count -gt 0) { throw "forbidden fix paths: $($forbidden -join ', ')" }
  $status = Get-StatusSnapshot
  $trackedChanged = @(Invoke-GitChecked 'list tracked focused fix changes' @('diff', '--name-only', '--no-renames'))
  $changed = @($trackedChanged + $status.Untracked | Sort-Object -Unique)
  $unexpected = @($changed | Where-Object { $_ -ne $ReportPath -and $FixPaths -notcontains $_ -and $initial.protected -notcontains $_ -and $initial.staged -notcontains $_ })
  if ($unexpected.Count -gt 0) { throw "unowned working changes during focused fix: $($unexpected -join ', ')" }
  foreach ($path in $FixPaths) {
    if ($changed -notcontains $path) { throw "diagnosed fix path has no add/delete/rename change: $path" }
  }
}

function Commit-FocusedFix([string]$Tag, [int]$Attempt) {
  Assert-IndexEmpty
  $fixPaths = Get-DiagnosedFixPaths $Tag $Attempt
  Assert-FixPaths $fixPaths
  Invoke-GitChecked "stage focused $Tag fix" (@('add', '--') + $fixPaths) | Out-Null
  Invoke-GitChecked "check focused $Tag fix" (@('diff', '--cached', '--check', '--') + $fixPaths) | Out-Null
  $staged = @(Invoke-GitChecked "list staged focused $Tag fix" @('diff', '--cached', '--name-only', '--no-renames'))
  Assert-ExactPathSet "staged focused $Tag fix" $staged $fixPaths
  Invoke-GitChecked "commit focused $Tag fix" (@('commit', '--only', '-m', "fix: restore $Tag package gate", '--') + $fixPaths) | Out-Null
  Assert-IndexEmpty
}

function Assert-FinalCleanGate {
  Invoke-GitChecked 'final committed range diff check' @('diff', '--check', "$BaseRef..HEAD") | Out-Null
  Invoke-GitChecked 'final working diff check' @('diff', '--check') | Out-Null
  Assert-NoUnmergedIndex
  Assert-IndexEmpty
  Assert-InitialDirtyUnchanged
  $initial = Get-InitialState
  $status = Get-StatusSnapshot
  $allowedDocs = @($ReportPath, $TasksPath) + @($initial.protected) + @($initial.staged)
  $unexpectedDirty = @($status.Dirty | Where-Object { $allowedDocs -notcontains $_ })
  $unexpectedUntracked = @($status.Untracked | Where-Object { $allowedDocs -notcontains $_ })
  if ($unexpectedDirty.Count -gt 0) { throw "unexpected final dirty paths: $($unexpectedDirty -join ', ')" }
  if ($unexpectedUntracked.Count -gt 0) { throw "unexpected final untracked paths: $($unexpectedUntracked -join ', ')" }
  $generatedDrift = @($status.Dirty | Where-Object {
    $_ -like 'packages/client/src/generated/*' -or $_ -like 'packages/client/src/generated-effect/*' -or $_ -like 'packages/sdk/js/*'
  })
  if ($generatedDrift.Count -gt 0) { throw "uncommitted generated drift: $($generatedDrift -join ', ')" }
}

function Start-TagMerge([string]$Tag) {
  Assert-IndexEmpty
  if ($null -ne (Get-OptionalGitRef 'MERGE_HEAD')) { throw 'an existing merge is active' }
  $base = Get-GitRef 'HEAD'
  $remote = Fetch-VerifiedTag $Tag
  $output = @(& git merge --no-ff --no-commit $Tag)
  $mergeExit = $LASTEXITCODE
  $mergeHead = Get-OptionalGitRef 'MERGE_HEAD'
  if ($mergeExit -eq 0 -and $mergeHead -ne $remote.Peeled) { throw "merge $Tag completed without an active MERGE_HEAD" }
  if ($mergeExit -ne 0) {
    if ($mergeExit -ne 1) { throw "merge $Tag failed with unexpected exit code $mergeExit" }
    if ($mergeHead -ne $remote.Peeled) { throw "merge $Tag exit 1 without the expected MERGE_HEAD" }
    $unmerged = @(Invoke-GitChecked "list conflict paths $Tag" @('diff', '--name-only', '--diff-filter=U'))
    if ($unmerged.Count -eq 0) { throw "merge $Tag exit 1 has no unmerged paths" }
  }
  return [pscustomobject]@{ Tag = $Tag; Base = $base; Object = $remote.Object; Peeled = $remote.Peeled; Annotated = $remote.Annotated }
}

function Assert-MergeReady([pscustomobject]$Merge) {
  if ((Get-OptionalGitRef 'MERGE_HEAD') -ne $Merge.Peeled) { throw "MERGE_HEAD does not equal $($Merge.Tag) peeled commit" }
  Assert-NoUnmergedIndex
  Assert-InitialDirtyUnchanged
  Invoke-GitChecked "cached diff check $($Merge.Tag)" @('diff', '--cached', '--check') | Out-Null
  $initial = Get-InitialState
  $staged = @(Invoke-GitChecked "list staged $($Merge.Tag) paths" @('diff', '--cached', '--name-only'))
  $forbidden = @($staged | Where-Object {
    $_ -eq $ReportPath -or $_ -eq $TasksPath -or $_ -eq $DesignPath -or $_ -eq $PlanPath -or
    $_ -like 'docs/openspec/changes/merge-upstream-tags/*' -or $_ -like 'docs/comet/changes/merge-upstream-tags/*' -or
    $initial.dirty -contains $_ -or $initial.staged -contains $_
  })
  if ($forbidden.Count -gt 0) { throw "merge index contains forbidden paths: $($forbidden -join ', ')" }
  $unstaged = @(Invoke-GitChecked "list unstaged $($Merge.Tag) paths" @('diff', '--name-only'))
  $unexpectedUnstaged = @($unstaged | Where-Object { $_ -ne $ReportPath -and $initial.protected -notcontains $_ })
  if ($unexpectedUnstaged.Count -gt 0) { throw "unstaged merge paths remain: $($unexpectedUnstaged -join ', ')" }
  $status = Get-StatusSnapshot
  $unexpectedStatus = @($status.Dirty | Where-Object { $_ -ne $ReportPath -and $initial.protected -notcontains $_ -and $initial.staged -notcontains $_ })
  if ($unexpectedStatus.Count -gt 0) { throw "only the attributed report and initial dirty paths may remain dirty during merge: $($unexpectedStatus -join ', ')" }
}

function Commit-TagMerge([pscustomobject]$Merge) {
  Assert-MergeReady $Merge
  Invoke-GitChecked "commit merge $($Merge.Tag)" @('commit', '-m', "chore(opencode): merge upstream $($Merge.Tag)") | Out-Null
  $parentLines = @(Invoke-GitChecked "parents $($Merge.Tag)" @('rev-list', '--parents', '-n', '1', 'HEAD'))
  $parentLine = Get-OneLine "parents $($Merge.Tag)" $parentLines
  $parents = @($parentLine -split '\s+')
  if ($parents.Count -ne 3 -or $parents[1] -ne $Merge.Base -or $parents[2] -ne $Merge.Peeled) { throw "invalid $($Merge.Tag) merge parent chain" }
  $subjectLines = @(Invoke-GitChecked "subject $($Merge.Tag)" @('log', '-1', '--format=%s'))
  $subject = Get-OneLine "subject $($Merge.Tag)" $subjectLines
  if ($subject -ne "chore(opencode): merge upstream $($Merge.Tag)") { throw "invalid $($Merge.Tag) merge subject" }
}

function Get-TagMergeRecord([string]$Tag) {
  $subject = "chore(opencode): merge upstream $Tag"
  $lines = @(Invoke-GitChecked "first-parent log for $Tag" @('log', '--first-parent', '--format=%H%x09%P%x09%s', "$BaseRef..HEAD"))
  $matches = @($lines | Where-Object {
    $fields = @($_ -split "`t", 3)
    $fields.Count -eq 3 -and $fields[2] -eq $subject
  })
  if ($matches.Count -ne 1) { throw "expected exactly one first-parent merge for $Tag" }
  $parts = @($matches[0] -split "`t", 3)
  if ($parts.Count -ne 3) { throw "$Tag first-parent record is malformed" }
  $parents = @($parts[1] -split '\s+')
  if ($parents.Count -ne 2) { throw "$Tag merge record has not two parents" }
  $remote = Get-RemoteTagObject $Tag
  if ($parents[1] -ne $remote.Peeled) { throw "$Tag second parent no longer matches remote peeled commit" }
  return [pscustomobject]@{ Tag = $Tag; Commit = $parts[0]; RoundBase = $parents[0]; Peeled = $parents[1]; Object = $remote.Object }
}
```

## 影响闭包、生成与验证规约

每轮先用 `Get-TagMergeRecord` 或当前 merge 的 `$Merge.Base` 获取 diff，再从根 `package.json` 的 `workspaces.packages`（兼容 `workspaces` 数组）把每个 workspace glob 转为 tracked manifest 集合。仅这些 workspace manifest 建立 `dependencies`、`devDependencies`、`peerDependencies` 的反向图；VS Code host 是图外显式 external consumer。先汇总直接 owner、根/shared-config owner、全部条件 owner 和 external consumer，再统一递归 BFS；根 `package.json`、共享 TypeScript 配置和 `bun.lock` 仅扩展消费者，绝不作为 test package 或从仓库根运行测试。

```powershell
Set-StrictMode -Version Latest

function Get-ImpactClosure([string[]]$ChangedPaths) {
  $rootManifest = Get-Content -LiteralPath (Join-Path $RepoRoot 'package.json') -Raw | ConvertFrom-Json
  $workspacePatterns = if ($rootManifest.workspaces -is [array]) { @($rootManifest.workspaces) } else { @($rootManifest.workspaces.packages) }
  if ($workspacePatterns.Count -eq 0) { throw 'root package.json has no workspaces packages' }
  $manifestPaths = @($workspacePatterns | ForEach-Object {
    $workspace = $_.TrimEnd('/')
    @(Invoke-GitChecked "list workspace manifests for $workspace" @('ls-files', '--', ":(glob)$workspace/package.json"))
  } | Sort-Object -Unique)
  if ($manifestPaths.Count -eq 0) { throw 'root workspaces resolved to no tracked package manifests' }
  $packages = @($manifestPaths | ForEach-Object {
    $json = Get-Content -LiteralPath (Join-Path $RepoRoot $_) -Raw | ConvertFrom-Json
    $directory = [IO.Path]::GetDirectoryName($_)
    [pscustomobject]@{ Name = $json.name; Directory = $(if ($null -eq $directory) { '' } else { $directory.Replace('\', '/') }); Json = $json }
  } | Where-Object { $_.Name -and $_.Directory -notin @('', '.') })
  $duplicateNames = @($packages | Group-Object Name | Where-Object { $_.Count -ne 1 } | ForEach-Object Name)
  if ($duplicateNames.Count -gt 0) { throw "duplicate workspace package names: $($duplicateNames -join ', ')" }
  $hostManifestPaths = @(Invoke-GitChecked 'locate VS Code host manifest' @('ls-files', '--', 'hosts/vscode-plugin/package.json'))
  if ($hostManifestPaths.Count -ne 1) { throw 'VS Code host manifest must be one tracked external consumer' }
  $hostJson = Get-Content -LiteralPath (Join-Path $RepoRoot $hostManifestPaths[0]) -Raw | ConvertFrom-Json
  $hostPackage = [pscustomobject]@{ Name = $hostJson.name; Directory = 'hosts/vscode-plugin'; Json = $hostJson }
  $byName = @{}
  $reverse = @{}
  foreach ($package in $packages) { $byName[$package.Name] = $package; $reverse[$package.Name] = [Collections.Generic.List[object]]::new() }
  foreach ($package in $packages) {
    foreach ($sectionName in @('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')) {
      $sectionProperty = $package.Json.PSObject.Properties[$sectionName]
      if ($null -eq $sectionProperty) { continue }
      $section = $sectionProperty.Value
      if ($null -eq $section) { continue }
      foreach ($dependency in $section.PSObject.Properties.Name) { if ($byName.ContainsKey($dependency)) { $reverse[$dependency].Add($package) } }
    }
  }
  $owners = [Collections.Generic.HashSet[string]]::new()
  $includeHost = $false
  $rootChanged = $false
  foreach ($path in $ChangedPaths) {
    if ($path -like "$($hostPackage.Directory)/*") { $includeHost = $true; continue }
    $owner = @($packages | Where-Object { $path -like "$($_.Directory)/*" } | Sort-Object { $_.Directory.Length } -Descending | Select-Object -First 1)
    if ($owner.Count -eq 0) { $rootChanged = $true; continue }
    [void]$owners.Add($owner[0].Name)
  }
  if ($rootChanged) { foreach ($package in $packages) { [void]$owners.Add($package.Name) }; $includeHost = $true }
  $publicApiPaths = @($ChangedPaths | Where-Object {
    $_ -like 'packages/protocol/*' -or $_ -like 'packages/server/src/*' -or $_ -like 'packages/opencode/src/server/*'
  })
  if ($publicApiPaths.Count -gt 0) {
    foreach ($name in '@opencode-ai/client','@opencode-ai/sdk','opencode','webgui') {
      if ($byName.ContainsKey($name)) { [void]$owners.Add($name) }
    }
    $includeHost = $true
  }
  $serverBehavior = @($ChangedPaths | Where-Object { $_ -like 'packages/opencode/src/*' -or $_ -like 'packages/core/src/*' -or $_ -like 'packages/server/src/*' })
  if ($serverBehavior.Count -gt 0 -and $byName.ContainsKey('webgui')) { [void]$owners.Add('webgui') }
  $queue = [Collections.Generic.Queue[string]]::new()
  foreach ($name in $owners) { $queue.Enqueue($name) }
  while ($queue.Count -gt 0) { foreach ($consumer in $reverse[$queue.Dequeue()]) { if ($owners.Add($consumer.Name)) { $queue.Enqueue($consumer.Name) } } }
  return [pscustomobject]@{ Packages = @($owners | ForEach-Object { $byName[$_] } | Where-Object { $_ }); ExternalConsumers = $(if ($includeHost) { @($hostPackage) } else { @() }); PublicApi = ($publicApiPaths.Count -gt 0); RootChanged = $rootChanged }
}

$hostOnly = Get-ImpactClosure @('hosts/vscode-plugin/package.json')
if ($hostOnly.RootChanged -or $hostOnly.Packages.Count -ne 0 -or $hostOnly.ExternalConsumers.Count -ne 1 -or $hostOnly.ExternalConsumers[0].Directory -ne 'hosts/vscode-plugin') {
  throw 'host-only impact closure must include only the VS Code external consumer'
}
```

- 对 `$closure.Packages` 和 `$closure.ExternalConsumers` 中每个真实 manifest，读取其 `scripts`；只从该 package 目录运行存在的 `test`、`typecheck`、`build`。分别使用 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test`、`vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck` 和 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build`。
- 当前 Windows Classic change 有两个 test 调度例外：matrix ID `packages-core-test` 使用 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --only-failures --max-concurrency=1`，matrix ID `packages-sdk-next-test` 使用 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --timeout 5000 --max-concurrency=1`。不修改对应 `package.json`；命令仍执行完整测试集合，并要求 fail/error 为 0、skip/todo 不增加。
- `packages/opencode/webgui` 的 `test` 是 watch 模式，使用 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run`；其 build 使用 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build`。
- 若 `$closure.PublicApi` 为真，必须同时执行：`packages/client` 的 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run generate`；`packages/sdk/js` 的 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build`、test、typecheck；`packages/opencode` 的 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:httpapi`；WebGUI 和 VS Code 宿主门禁。生成变更提交后执行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run check:generated`。
- Task 3 baseline 只从仓库根运行一次 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun install --frozen-lockfile`。Task 2 矩阵提交之后，只要 Task 3 聚焦修复或任一后续 tag 的语义处理实际改变根/工作区 manifest 或 `bun.lock`，就先运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun install` 重新生成 lockfile，再运行 conditional `root-frozen-after-regenerate` 并重跑其余受影响 default gates；该 conditional ID 就是本轮 frozen 验证，不重复 default root frozen。不得手工编辑 lockfile。
- `hosts/vscode-plugin/package.json` 是宿主 extension manifest。只要宿主进入闭包，就读取完整 `packageManager` pin，要求严格匹配完整 pnpm version 和 128 位 lowercase SHA-512 hash；用 `vfox exec nodejs@22.23.1 -- corepack pnpm --version` 实际执行 Corepack，且输出必须等于捕获的 pin version。随后无条件运行 Corepack frozen install、compile 和 test；报告必须注明后者自动执行 `pretest`（compile 和 lint）。
- Task 2 矩阵提交之后，只要 Task 3 聚焦修复或任一后续 tag 的语义处理实际改变 `hosts/vscode-plugin/package.json` 或 `pnpm-lock.yaml`，就先运行 `vfox exec nodejs@22.23.1 -- corepack pnpm install --lockfile-only`，再运行 conditional `vscode-frozen-after-lockfile` 并重跑其余 host default gates；该 conditional ID 就是本轮 frozen 验证，不重复 default host frozen。`package-lock.json` 若变化必须在报告注明其生成来源；本计划不运行 npm install。
- 对每条测试命令记录 pass/fail/error/skip/todo。fail/error 必须为 0；skip/todo 与任务 3 基线或该 package 的任务 24 动态扩展基线相比不得增加。没有标准计数输出的命令也必须记录退出码为 0 及其可见计数摘要。

宿主进入闭包时在 `hosts/vscode-plugin` 目录执行：

```powershell
$hostManifest = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$pin = [string]$hostManifest.packageManager
$pinMatch = [regex]::Match($pin, '^pnpm@(?<version>\d+\.\d+\.\d+)\+sha512\.(?<hash>[0-9a-f]{128})$')
if (-not $pinMatch.Success) { throw "packageManager is not a complete pnpm pin: $pin" }
$pinVersion = $pinMatch.Groups['version'].Value
$corepackVersionLines = @(& vfox exec nodejs@22.23.1 -- corepack pnpm --version)
Assert-NativeExit 'Corepack pinned pnpm version' $LASTEXITCODE
$corepackVersion = Get-OneLine 'Corepack pinned pnpm version' $corepackVersionLines
if ($corepackVersion -ne $pinVersion) { throw "Corepack pnpm version $corepackVersion does not match manifest pin $pinVersion" }
Invoke-Checked 'Corepack frozen install' { vfox exec nodejs@22.23.1 -- corepack pnpm install --frozen-lockfile }
Invoke-Checked 'VS Code compile' { vfox exec nodejs@22.23.1 -- corepack pnpm run compile }
Invoke-Checked 'VS Code test with pretest' { vfox exec nodejs@22.23.1 -- corepack pnpm test }
```

## 实施任务

### Task 1：确认 Build 决策、执行工作区并提交规划产物（OpenSpec 1.1）

**文件：** `docs/openspec/changes/merge-upstream-tags/.comet.yaml`（只读）、`docs/openspec/changes/merge-upstream-tags/**`、`docs/superpowers/specs/2026-08-10-merge-upstream-tags-design.md`、本计划。

- [x] **步骤 1：加载函数并在任何提交前断言 base、Comet 与用户工作方式**

  ```powershell
  Assert-ExecutionWorkspace
  if ((Get-GitRef 'HEAD') -ne $BaseRef) { throw 'HEAD is not the approved base ref before planning-artifact commit' }
  Invoke-Checked 'vfox current' { vfox current }
  Invoke-Checked 'Bun version' { vfox exec bun@1.3.14 nodejs@22.23.1 -- bun --version }
  Invoke-Checked 'Node version' { vfox exec bun@1.3.14 nodejs@22.23.1 -- node --version }
  ```

  验收：`bound_branch` 和 `isolation` 均非 `null`，与用户确认一致；`current` 模式另有 `direct_override` 和报告中的设计偏差。branch/worktree 的当前 branch 精确匹配且不是 `ide-plugin`，worktree 的 Git 目录隔离已验证。若决定尚未写入 Comet，停止并请求 Comet/用户完成决定，本计划不创建分支。

- [x] **步骤 2：中立化执行工作区并记录初始快照**

  将既有用户/工具升级改动原样保留。通过 `git status --porcelain=v1 --untracked-files=all` 获取 raw snapshot、dirty 和 staged 路径，并将真实数组序列化进报告的唯一 initial marker；已有 staged 路径或活动 merge 时停止。branch 隔离可保留 marker 中的既有 dirty 路径，但后续不得修改、stage 或提交；新出现的 allowlist 外路径仍使门禁失败。

  ```powershell
  $initial = Get-InitialStatusRecord
  $protected = @($initial.Dirty | Where-Object {
    $_ -ne $ReportPath -and $_ -ne $DesignPath -and $_ -ne $PlanPath -and
    $_ -notlike 'docs/openspec/changes/merge-upstream-tags/*' -and
    $_ -notlike 'docs/comet/changes/merge-upstream-tags/*'
  })
  $fingerprints = [ordered]@{}
  foreach ($path in $protected) { $fingerprints[$path] = Get-PathFingerprint $path }
  $initial.Porcelain
  [pscustomobject]@{ dirty = $initial.Dirty; staged = $initial.Staged; untracked = $initial.Untracked; porcelain = $initial.Porcelain; protected = $protected; fingerprints = $fingerprints } | ConvertTo-Json -Compress
  ```

  将该压缩 JSON 放入报告的 `<!-- merge-upstream-tags:initial JSON -->` 单行 comment。验收：报告中的 initial marker 使用上述真实 JSON，且恰好一个；`protected` 只含 allowlist 外既有路径并有逐文件 SHA-256；之后所有 merge 前 `Assert-IndexEmpty` 成功；初始 dirty/staged 路径成为 fix/merge denylist，protected 路径还必须保持指纹不变。

- [x] **步骤 3：刷新官方发布事实并记录可恢复起点**

  通过 `Get-StableReleaseTags` 查询 `opencode` 远端，验证 `v1.18.6` 是 `$BaseRef` 的祖先，记录查询时间、快照 HEAD、最高已集成 tag `v1.18.6` 和版本升序待处理队列。只查询稳定 `vMAJOR.MINOR.PATCH` tag；本步骤不开始 merge。

  验收：报告明确区分快照 HEAD 与规划提交后的 HEAD，包含最高已集成 tag、完整待处理队列和远端查询证据；队列至少从 `v1.18.7` 开始。

- [x] **步骤 4：在 base 校验后初始提交规划产物与起点报告**

  ```powershell
  Commit-ChangeArtifacts 'docs(opencode): plan upstream tag merge'
  ```

  验收：函数递归收集并强制 stage `docs/openspec/changes/merge-upstream-tags/**` 与 `docs/comet/changes/merge-upstream-tags/**` 的完整文件集，再加 Design、plan 和起点报告；staged set 必须精确等于这些 allowlist。根 `.comet/`、`.gitignore`、`.agents/`、`.opencode/`、`skills-lock.json` 不能通过该 allowlist。后续 merge 时已提交的 change 产物必须保持干净，报告的新验证记录和 initial marker 中的既有 dirty 路径是唯一允许的 unstaged 例外。

**提交边界：** 一个 `docs(opencode): plan upstream tag merge` 提交。不得在该任务创建/切换 branch 或 worktree。

### Task 2：建立已知队列闭包与门禁矩阵（OpenSpec 1.2）

**文件：** `docs/superpowers/reports/2026-08-10-merge-upstream-tags.md`。

- [x] **步骤 1：发现并精确校验 v1.18.7 至 v1.18.16**

  ```powershell
  $knownTags = Get-KnownTagNames
  foreach ($tag in $knownTags) { Fetch-VerifiedTag $tag | Format-List Tag,Object,Peeled,Annotated }
  ```

  验收：每个 tag 报告 remote object SHA 和 peeled commit SHA；annotated tag 的两者可不同，lightweight tag 的两者必须相同。

- [x] **步骤 2：从总 diff 建反向依赖闭包并记录矩阵**

  ```powershell
  $paths = foreach ($tag in (Get-KnownTagNames)) { Invoke-GitChecked "diff v1.18.6 to $tag" @('diff', '--name-only', 'v1.18.6', "$tag^{commit}") }
  $closure = Get-ImpactClosure @($paths | Sort-Object -Unique)
  $closure.Packages | Select-Object Name,Directory | Format-Table -AutoSize
  ```

  验收：报告包含直接 owner、递归反向消费者、根/shared-config 扩展原因、WebGUI/VS Code 特殊边界、每个 package 的真实 scripts，以及任务 3 将填写的 skip/todo 计数字段和采集命令。根不是验证 package。

- [x] **步骤 3：提交矩阵报告**

  ```powershell
  Commit-ExactPaths 'docs(opencode): define upstream merge gate' @($ReportPath, $TasksPath, $PlanPath)
  ```

**提交边界：** 一个 `docs(opencode): define upstream merge gate` 提交，只包含 report、OpenSpec tasks 和本计划的实际变更。

### Task 3：将当前 HEAD 修至严格零失败基线（OpenSpec 1.3）

**文件：** 报告中诊断出的 owning source/test/manifest 路径；`docs/superpowers/reports/2026-08-10-merge-upstream-tags.md`；`docs/openspec/changes/merge-upstream-tags/tasks.md`。

- [ ] **步骤 1：从任务 2 的 package 目录完整运行基线矩阵**

  先把 report 中唯一 gate matrix 的 `packages-core-test.command` 更新为已批准的 pinned 低并发命令 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --only-failures --max-concurrency=1`，并把 `packages-sdk-next-test.command` 更新为 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --timeout 5000 --max-concurrency=1`。保留既有失败 attempt 历史，把最新 baseline result 中对应 gate 恢复为 pending，并记录 Design/Spec commits `a54e9b1b1b0f36aa0cc0b8816167c8e856f925b7`、`afb3c61627`；不得修改对应 `package.json`。

  在任何 package 门禁前，从仓库根无条件运行：

  ```powershell
  Invoke-Checked 'root Bun frozen install' { vfox exec bun@1.3.14 nodejs@22.23.1 -- bun install --frozen-lockfile }
  ```

  随后对每个闭包 package 执行 matrix 指定的 test/typecheck/build 和适用条件门禁；逐命令记录 fail/error/skip/todo。验收：`packages-core-test` 和 `packages-sdk-next-test` 精确使用批准的 `--max-concurrency=1` 命令，其他 gate 不变；任何 fail/error 非 0 或 skip/todo 增加均关闭基线；不从根运行 test。

- [ ] **步骤 2：按报告中的实际 owning path 创建聚焦修复**

  每个根因先把诊断后的真实 owning 路径写入 `baseline` 的下一个报告 fix marker，随后提交；不允许由整个 `git diff` 自动收集路径。

  ```powershell
  Commit-FocusedFix 'baseline' 1
  ```

  验收：`Commit-FocusedFix` 拒绝报告、OpenSpec、Design、计划和初始 dirty；提交使用 `--only`，只包含报告 marker 中的实际 owning paths。发现阶段先对失败 gate 做聚焦 RED/GREEN，再从下一 gate 继续，避免重复已通过门禁；全部适用 gate 至少单独通过一次后，从矩阵首条执行一次最终完整重跑。最终重跑若发现回归，聚焦修复后再完整重跑，只有最新完整 attempt 全部通过才关闭基线。

- [ ] **步骤 3：记录零失败并关闭 1.1-1.3**

  ```powershell
  Commit-ExactPaths 'docs(opencode): verify pre-merge baseline' @($ReportPath, $TasksPath, $PlanPath)
  ```

  验收：当前 HEAD 是严格零失败 verified state；报告中基线 skip/todo 数量固定。

**提交边界：** 每个已诊断根因一个 `fix: restore baseline package gate` 提交，随后一个只含 report、OpenSpec tasks 和 plan 实际变更的 `docs(opencode): verify pre-merge baseline` 提交。

### Task 4：合并 v1.18.7（OpenSpec 2.1）

**文件：** 运行时冲突 index 确定的路径及规定生成物。

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.7'`；逐路径调查 `$merge.Base` 与 tag 的语义、调用方和测试。公共 Protocol/HttpApi 变化同时运行 Client generate 与 legacy SDK build；等价替换暂停用户选择。
- [ ] 逐项 stage 已调查的冲突解法和生成物，运行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：MERGE_HEAD 在提交前等于 `v1.18.7` peeled commit；可接受空树 merge index；提交后父链准确。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.7` 双父提交。

### Task 5：验证并修复 v1.18.7（OpenSpec 2.2）

**文件：** 报告诊断的 owning paths、报告、OpenSpec tasks。

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.7'`，以 `$round.RoundBase..HEAD` 重建闭包并运行完整矩阵；不依赖上一会话临时变量。
- [ ] 每个失败先写 v1.18.7 的下一个报告 fix marker，再以该 marker 的递增 N 作为第二参数调用 `Commit-FocusedFix`，从头复验本轮矩阵。
- [ ] 零失败后提交报告和勾选 2.1、2.2：`docs(opencode): verify upstream v1.18.7`。

验收：fail/error 为 0，skip/todo 不增，下一 tag 前 index 为空。

### Task 6：合并 v1.18.8（OpenSpec 2.3）

- [x] 执行 `$merge = Start-TagMerge 'v1.18.8'`，以实际冲突 index 完成语义决策、必要生成和用户等价替换暂停。
- [x] 逐路径 stage 后运行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：精确 tag object/peeled SHA、MERGE_HEAD 和双父链均正确；空树差异仍允许 merge。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.8` 双父提交。

### Task 7：验证并修复 v1.18.8（OpenSpec 2.4）

- [x] 执行 `$round = Get-TagMergeRecord 'v1.18.8'`，从 `$round.RoundBase..HEAD` 重建递归闭包并运行完整矩阵。
- [x] 每个根因先写报告 fix marker，再以其递增 N 作为第二参数调用 `Commit-FocusedFix`，每次后从头重跑。
- [x] 零失败后提交报告/tasks：`docs(opencode): verify upstream v1.18.8`。

验收：本轮所有 package 门禁从各 package 目录运行，fail/error 为 0、skip/todo 不增。

### Task 8：合并 v1.18.9（OpenSpec 2.5）

- [x] 执行 `$merge = Start-TagMerge 'v1.18.9'`；实际冲突按所有权解决，公共 API 同时生成 Client 和 legacy SDK。
- [x] `v1.18.9`：执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：没有报告/初始 dirty 进入 merge index，第二父精确为 v1.18.9 peeled commit。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.9` 双父提交。

### Task 9：验证并修复 v1.18.9（OpenSpec 2.6）

- [x] 执行 `$round = Get-TagMergeRecord 'v1.18.9'`，以其第一父重建闭包和矩阵。
- [x] 每个失败先写报告 fix marker，再以其递增 N 作为第二参数调用 `Commit-FocusedFix`，从第一条门禁重跑。
- [x] 零失败后提交 `docs(opencode): verify upstream v1.18.9` 并勾选 2.5、2.6。

验收：当前 HEAD 是 verified state，且无 staged 路径。

### Task 10：合并 v1.18.10（OpenSpec 3.1）

- [x] 执行 `$merge = Start-TagMerge 'v1.18.10'`，调查实际冲突、生成物和等价替换候选。
- [x] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：remote object/peeled SHA 已记录，merge 保留独立双父边界。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.10` 双父提交。

### Task 11：验证并修复 v1.18.10（OpenSpec 3.2）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.10'`，从记录的第一父重新推导闭包与条件门禁。
- [ ] 每个失败使用报告 marker，并以其递增 N 调用 `Commit-FocusedFix`；完整矩阵重跑至零失败。
- [ ] 提交 `docs(opencode): verify upstream v1.18.10` 并勾选 3.1、3.2。

验收：HttpApi/Client/SDK/WebGUI/VS Code 条件验证在触发时均有退出 0 证据。

### Task 12：合并 v1.18.11（OpenSpec 3.3）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.11'`，逐项处理实际冲突；等价替换候选保留现场等待用户。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：MERGE_HEAD 精确、unmerged index 为空、cached diff check 通过。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.11` 双父提交。

### Task 13：验证并修复 v1.18.11（OpenSpec 3.4）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.11'`，对 `$round.RoundBase..HEAD` 完整验证。
- [ ] 每个根因写 marker 后以递增 N 执行 `Commit-FocusedFix`，从头复验。
- [ ] 提交 `docs(opencode): verify upstream v1.18.11` 并勾选 3.3、3.4。

验收：不以 skip/todo、retry、sleep 或扩大 timeout 取得通过。

### Task 14：合并 v1.18.12（OpenSpec 3.5）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.12'`；遵循 manifest 先于 lockfile、源先于生成物的决策顺序。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：lockfile 仅由 vfox Bun 或受控 Corepack/pnpm 更新。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.12` 双父提交。

### Task 15：验证并修复 v1.18.12（OpenSpec 3.6）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.12'`，重新加载会话函数后重建矩阵。
- [ ] 每个失败由报告 marker 定义实际 path，以递增 N 调用 `Commit-FocusedFix`，完整重跑。
- [ ] 提交 `docs(opencode): verify upstream v1.18.12` 并勾选 3.5、3.6。

验收：严格零失败及 skip/todo 不增加后才可推进。

### Task 16：合并 v1.18.13（OpenSpec 4.1）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.13'`，将冲突的所有权和生成命令写入报告。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：下游宿主/发布版本不被上游 workspace 版本覆盖。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.13` 双父提交。

### Task 17：验证并修复 v1.18.13（OpenSpec 4.2）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.13'`，从其第一父重建闭包。
- [ ] 用报告 marker 和递增 N 的 `Commit-FocusedFix` 逐根因收敛，再完整复验。
- [ ] 提交 `docs(opencode): verify upstream v1.18.13` 并勾选 4.1、4.2。

验收：每条适用默认和条件门禁退出 0。

### Task 18：合并 v1.18.14（OpenSpec 4.3）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.14'`，调查运行时出现的冲突路径；不虚构文件名。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：空 staged tree 不阻止合法双父 merge；MERGE_HEAD 和父链是唯一边界依据。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.14` 双父提交。

### Task 19：验证并修复 v1.18.14（OpenSpec 4.4）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.14'`，重建实际闭包和完整矩阵。
- [ ] 先在报告写实际 owning paths，再以递增 N 调用 `Commit-FocusedFix`，从头复验。
- [ ] 提交 `docs(opencode): verify upstream v1.18.14` 并勾选 4.3、4.4。

验收：无未归因工作区漂移，无新增 skip/todo。

### Task 20：合并 v1.18.15（OpenSpec 4.5）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.15'`，按语义解决实际冲突并执行适用的生成/lock 流程。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：merge 不混入后续 tag、docs 或用户路径。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.15` 双父提交。

### Task 21：验证并修复 v1.18.15（OpenSpec 4.6）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.15'`，从其第一父重建 matrix。
- [ ] 每个失败在报告 marker 固化实际 paths 后以递增 N 运行 `Commit-FocusedFix`，重跑全部门禁。
- [ ] 提交 `docs(opencode): verify upstream v1.18.15` 并勾选 4.5、4.6。

验收：当前 verified state 是下一 tag 唯一允许第一父。

### Task 22：合并 v1.18.16（OpenSpec 4.7）

- [ ] 执行 `$merge = Start-TagMerge 'v1.18.16'`，完成实际冲突的语义决策和适用生成。
- [ ] 执行 `Assert-MergeReady $merge`、`Commit-TagMerge $merge`。

验收：此 tag 只清空当前已知队列，不宣称远端前沿稳定。

**提交边界：** 一个 `chore(opencode): merge upstream v1.18.16` 双父提交。

### Task 23：验证并修复 v1.18.16（OpenSpec 4.8）

- [ ] 执行 `$round = Get-TagMergeRecord 'v1.18.16'`，完整验证其实际闭包。
- [ ] 每个根因写报告 marker 后以递增 N 调用 `Commit-FocusedFix`，从第一条门禁重跑。
- [ ] 提交 `docs(opencode): verify upstream v1.18.16` 并勾选 4.7、4.8。

验收：fail/error 为 0、skip/todo 不增加，随后进入动态前沿查询。

### Task 24：从最新 verified tag 重新查询前沿（OpenSpec 5.1）

**文件：** 报告、OpenSpec tasks。

- [ ] **步骤 1：从 Git 历史重建最新 verified tag，而不是固定版本**

  ```powershell
  $latestVerified = Get-LatestVerifiedTag
  $pending = @(Get-PendingReleaseTags | Sort-Object Version)
  $pending | Select-Object Tag,Version | Format-Table -AutoSize
  ```

  验收：报告记录由 Git 提交重建的最新 verified tag、查询时间和 pending 队列；不将 `v1.18.16` 写为固定前沿。

- [ ] **步骤 2：对新增 tag 先扩展当前基线闭包**

  在本步骤重新运行 `$pending = @(Get-PendingReleaseTags | Sort-Object Version)`。对每个 `$pending.Tag` 执行 `Fetch-VerifiedTag`，以当前 verified HEAD 和该 peeled commit 的 diff 运行 `Get-ImpactClosure`。对于此前未在任务 2 出现的 package/消费者，先在当前 HEAD 运行其门禁并记录独立 skip/todo 基线；任何 fail/error 非 0 或新增 skip/todo 都阻止 merge。

  验收：远端对象和 peeled commit 已记录；root/shared config 只扩展消费者。

**提交边界：** 有 pending 时不提交前沿稳定结论；无 pending 时进入任务 25 的幂等无新增记录。

### Task 25：逐项处理动态 tag，直到一次无新增（OpenSpec 5.2）

**文件：** 运行时冲突/修复文件、报告、OpenSpec tasks。

- [ ] **步骤 1：每轮只选择一个当前 pending tag**

  本任务开始时重新加载函数块并运行：

  ```powershell
  $pending = @(Get-PendingReleaseTags | Sort-Object Version)
  if ($pending.Count -eq 0) { return }
  $item = $pending[0]
  ```

  验收：`$item` 是当前版本最小的 pending tag，不使用未定义变量，也不批量处理整个数组。

- [ ] **步骤 2：仅处理 `$item.Tag` 的完整事务**

  对 `$item.Tag`：运行 `Start-TagMerge $item.Tag`、语义冲突/等价替换协议、必要 Client+legacy SDK 生成、`Assert-MergeReady`、`Commit-TagMerge`；再以 `Get-TagMergeRecord $item.Tag` 重建闭包、完整验证、报告 fix marker 和 `Commit-FocusedFix`。每个 tag 仅在零失败后提交 `docs(opencode): verify upstream vX.Y.Z`。

  验收：每个动态 tag 具有自己精确 fetch、双父 merge、父链审计、完整 package 门禁和报告证据；不得批量 merge。

- [ ] **步骤 3：完成当前 pending 后重新进入 task 24**

  每个 `$item.Tag` 验证后重新加载函数块并运行 `$pending = @(Get-PendingReleaseTags | Sort-Object Version)`；若又有 pending，回到本任务步骤 1。仅 `$pending.Count -eq 0` 才结束循环。

- [ ] **步骤 4：幂等记录稳定前沿结论**

  ```powershell
  if ($pending.Count -ne 0) { throw 'release frontier still has pending tags' }
  $committed = Commit-DocumentSubset 'docs(opencode): confirm upstream release frontier'
  "frontier docs commit created: $committed"
  ```

  验收：最后一次实际 `ls-remote` 查询无新增稳定 release；首次可提交 report/tasks 两者，Task 28 重开后的再次验证在 tasks 未变化时只提交 report。只有 report/tasks 实际变更的非空子集才 stage/commit；无文档变化则不创建空提交。

**提交边界：** 每个动态 tag 独立 merge/fix/verify 提交；每个无新增查询按实际 report/tasks 子集创建零个或一个 `docs(opencode): confirm upstream release frontier` 提交。

### Task 26：审计父链、生成物、宿主 manifest 与 lockfile（OpenSpec 6.1）

**文件：** 报告、OpenSpec tasks。

- [ ] **步骤 1：审计所有 first-parent merge 和远端对象**

  从 `$BaseRef..HEAD` 收集每个 `chore(opencode): merge upstream vX.Y.Z` subject；对每项调用 `Get-TagMergeRecord`，确认恰有一次、第一父在 first-parent 链、第二父等于远端 peeled commit，并将 remote object SHA、peeled SHA、annotated 状态记录到报告。

- [ ] **步骤 2：审计生成来源与 VS Code 宿主版本保护**

  ```powershell
  Invoke-GitChecked 'final committed diff check' @('diff', '--check', "$BaseRef..HEAD") | Out-Null
  Invoke-GitChecked 'client generated audit' @('diff', "$BaseRef..HEAD", '--', 'packages/client/src/generated', 'packages/client/src/generated-effect')
  Invoke-GitChecked 'legacy SDK generated audit' @('diff', "$BaseRef..HEAD", '--', 'packages/sdk/js')
  Invoke-GitChecked 'VS Code manifest and lock audit' @('diff', "$BaseRef..HEAD", '--', 'hosts/vscode-plugin/package.json', 'hosts/vscode-plugin/pnpm-lock.yaml', 'hosts/vscode-plugin/package-lock.json')
  ```

  对 Protocol/HttpApi 改动复跑 Client `check:generated` 和 SDK build；核对报告中生成命令。核对 `hosts/vscode-plugin/package.json` 的 extension 版本、`packageManager` pin、pnpm/package lock 变化及下游发布版本保护。验收：所有产物都有源变更和规定命令来源；没有上游 workspace 版本覆盖宿主版本。

- [ ] **步骤 3：提交审计证据并勾选 6.1**

  调用 `Commit-DocumentSubset 'docs(opencode): audit upstream merge chain'`，只提交报告/tasks 的实际变更子集。验收：审计失败回到所属 tag 的修复/验证，再重跑本任务。

### Task 27：最终跨包严格零失败验证（OpenSpec 6.2）

**文件：** 报告、OpenSpec tasks；若失败，仅报告中实际 owning paths。

- [ ] **步骤 1：合并整个执行期间闭包并运行最终矩阵**

  合并任务 2、每个 tag 和动态 tag 的 closure，去重后从 package 目录运行存在的默认门禁。公共 API 触发时必须包含：Client test/typecheck/check:generated、legacy SDK test/typecheck/build、OpenCode test/typecheck/build/test:httpapi、WebGUI test:run/build、VS Code Corepack/pnpm pin/frozen/compile/test。

  验收：每条命令 fail/error 为 0，skip/todo 不高于任务 3 基线或对应动态扩展基线；不运行 App E2E、benchmark 或 Desktop 打包。

- [ ] **步骤 2：检查最终 Git 状态与 merge 痕迹**

  ```powershell
  Assert-FinalCleanGate
  if ($null -ne (Get-OptionalGitRef 'MERGE_HEAD')) { throw 'merge remains active after final verification' }
  ```

  验收：检查 committed range、working diff、unmerged、unstaged、untracked 和 staged。此时仅明确归因的报告/tasks 可保持 dirty；任何 generated drift 阻塞。不用全仓 conflict-marker grep，以 unmerged index、每轮 cached diff check 和最终 range diff check 为准，避免 fixture 假阳性。

- [ ] **步骤 3：提交最终验证并勾选 6.2**

  调用 `Commit-DocumentSubset 'docs(opencode): verify upstream integration'`，只提交报告/tasks 的实际变更子集。验收：若最终矩阵失败，创建报告 marker、聚焦修复、重跑所属与最终矩阵。

### Task 28：独立审查、前沿复核与最终证据（OpenSpec 6.3）

**文件：** 报告、OpenSpec tasks。

- [ ] **步骤 1：对 `$BaseRef..HEAD` 做 thorough 独立审查**

  审查 Protocol/HttpApi、Client/legacy SDK 生成一致性、WebGUI/VS Code 消费面、宿主版本保护、每个 merge 父链、冲突决策和聚焦修复归属。额外按 `AGENTS.md` 核对 runtime 依赖方向：Schema 只能向 Core/Protocol 供给依赖，Core/Protocol 才可供给 Server；Client runtime 只能依赖 Schema/Protocol，不得依赖 Core/Server；`sdk-next` 负责组合 Client、Core 和 Server。按 Critical、Important、Minor 写入报告；Critical/Important 必须修复并重新执行其 tag、任务 26 和任务 27。

- [ ] **步骤 2：再次运行 task 24 的动态前沿查询**

  重新加载函数块并运行任务 24 步骤 1。若发现 pending，不得完成任务 28：重新打开并执行任务 24、25，随后重跑任务 26 和任务 27，最后从任务 28 步骤 1 重新开始审查。只接受 `$pending.Count -eq 0`。验收：最终结论以最后一次实际查询为准，而非任何固定 tag。

- [ ] **步骤 3：提交最终审查并勾选 6.3**

  调用 `Commit-DocumentSubset 'docs(opencode): record upstream integration review'`，只提交报告/tasks 的实际变更子集。验收：基线零失败、每 tag 零失败、最后一次前沿无新增、生成/父链/宿主审计通过，且没有未处理等价替换或 Critical/Important 阻塞。

## 计划自检

- 覆盖：任务 1-3 对应 OpenSpec 1.1-1.3；任务 4-23 覆盖已知 `v1.18.7` 至 `v1.18.16` 的 20 项 merge/验证；任务 24-25 覆盖动态前沿；任务 26-28 覆盖最终审计、跨包验证与独立审查。
- 可恢复：每个任务重新加载会话函数；验证从 Git 中精确 subject/第二父重建 round base；fix path 从报告 marker 加载，不从 PowerShell 遗留变量或全量 diff 推断。若任一 helper 在 stage 后因校验、hook 或 commit 失败，只运行 `git restore --staged -- <the same exact allowlist paths>`，随后重新检查 index；不使用 reset，也不改动 working tree。
- 停止条件：缺失 Comet Build 决策、错误 branch/worktree、非空 index、tag object/peeled 不一致、无效 MERGE_HEAD、未解决冲突、非零 fail/error、skip/todo 增加、等价替换、未归因路径和动态 pending tag 均阻止推进。
- 范围：不新增仓库脚本，不直接编辑 generated，不执行 App E2E/benchmark/Desktop 打包。
