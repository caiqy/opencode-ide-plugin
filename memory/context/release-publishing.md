# 基于 tag 的正式发版流程

当用户说“发布下一个版本”时：不要重新探索仓库流程，直接按这里执行正式发版。

## 适用范围

- 触发 `.github/workflows/release.yml`
- 发布 GitHub Release
- 发布 VSCode Marketplace
- 发布 JetBrains Marketplace

## 默认前提

- 当前仓库分支默认是 `ide-plugin`
- 发版依赖的 GitHub Actions secrets 已配置完成，至少包括：
  - `VSCE_PAT`
  - `JETBRAINS_MARKETPLACE_TOKEN`
  - `JETBRAINS_CERTIFICATE_CHAIN`
  - `JETBRAINS_PRIVATE_KEY`
  - `JETBRAINS_PRIVATE_KEY_PASSWORD`

## 快速规则

- 使用仓库通用版本规则：见 `memory/context/versioning.md`
- `发布下一个版本` 指的是：
  1. 只提交本次实现相关改动，不顺带提交无关文件
  2. 推送当前分支到 `origin`
  3. 计算并创建“下一个”正式版 tag：`vYY.M.DDNN`
  4. 推送该 tag，触发 `release.yml`
  5. 跟进 GitHub Actions，重点观察：
     - `publish-vscode-marketplace`
     - `publish-jetbrains-marketplace`
     - `release`
- 跨天后日期段必须更新；例如 `v26.5.303` 的下一天首个正式版应为 `v26.5.400`

## 执行顺序

1. 查看 `git status` / `git diff` / 最近提交风格
2. 只暂存并提交与本次发布目标相关的文件
3. `git push -u origin ide-plugin`（如果上游已建立，正常 `git push` 即可）
4. 按版本规则确定下一个未占用 tag
5. `git tag v<next-version>`
6. `git push origin v<next-version>`
7. 轮询 GitHub Actions run，直到拿到成功/失败结果或至少确认 run 已启动

## 版本号判断

- 先看当天已有 tag / 最近成功或测试过的 tag
- 如果当天还没有发版，从 `00` 开始
- 如果当天已经有 `vYY.M.DD03`，下一个就是 `vYY.M.DD04`
- 如果已经跨天，则回到新日期段的 `00`

## 成功标准

- 本地相关改动已 commit 并 push
- 新 tag 已 push 到远端
- `release.yml` 已启动
- 后续能明确汇报 run id、状态，以及 Marketplace / Release 是否成功
