# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-48529bae48a651a3e5641393252f6d0969f866c01c31802b46b6ab3713749308",
    "evidence_refs": [
      "hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts",
      "hosts/vscode-plugin/src/ui/IdeBridgeServer.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-78e7641b2c011bf835174fa5aea51bdd583a57d9a340364a04bd0a2befc05107",
    "evidence_refs": [
      "packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx",
      "packages/opencode/webgui/src/state/MessagesContext.tsx"
    ]
  },
  {
    "acceptance_id": "acceptance-9aa5b1649a9355923900afd3799dc0cb826ce4950285465afc5a70715f4e134c",
    "evidence_refs": [
      "packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx",
      "packages/opencode/webgui/src/state/MessagesContext.tsx"
    ]
  },
  {
    "acceptance_id": "acceptance-d3f9409b9ed68700fba6d7c0572ef1927cf38fd61a82d7709f719a2762e9db02",
    "evidence_refs": [
      "hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt"
    ]
  },
  {
    "acceptance_id": "acceptance-e870f8475871b9b6dbf170f8374196b489f1f6708f4d484b45fc97d1f2874601",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts",
      "packages/opencode/webgui/src/lib/ideNotifications.ts"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- RED：在 `packages/opencode/webgui` 运行 `bun run test:run src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx`，17 项中 3 项失败，分别证明非 busy/retry 前态误判、前台权限重放误通知、错误清理 idle 多发通知。
- RED：在 `hosts/vscode-plugin` 运行 `pnpm exec vscode-test --grep "IdeBridgeServer showNotification"`，2 项中 1 项失败，handler 实际收到未 trim 的 title/body。
- Green：重复上述 WebGUI 定向命令，2 files、17 tests 全部通过。
- Green：在 `hosts/vscode-plugin` 运行 `pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer showNotification"`，TypeScript compile 通过，2 tests 全部通过。
- Green：在 `packages/opencode/webgui` 运行 `bun run test:run`，158 files、1378 tests 全部通过。
- Green：在 `packages/opencode/webgui` 运行 `bun run build`，TypeScript 与 Vite build 成功；仅有既存 chunk-size warning。
- Green：在 `packages/opencode/webgui` 运行 `bun x eslint src/lib/ideNotifications.ts src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx`，通过且无输出。
- Green：设置 `JAVA_HOME` 为 vfox 管理的 OpenJDK 21.0.2 后，在 `hosts/jetbrains-plugin` 运行 `.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"`，`BUILD SUCCESSFUL`。
- Green：在仓库根运行 `git diff --check`，通过；仅输出工作树 LF/CRLF 转换提示。

# Skipped checks

- WebGUI 全量 `bun run lint` 已实际运行但未通过：仓库既有 633 errors、50 warnings，主要为 `no-explicit-any`、Fast Refresh 与 hooks 规则；未为本 change 扩大范围修复。窄范围新增文件与测试 lint 已通过。
- Comet `check` 两次扫描声明的 7 个文件均为 0 issues，但 receipt 因 current snapshot 未复用 scope limits 而 stale；未传入 stale receipt，也未修改未授权的第五个 Runtime 模块。

# Spec consistency

实现与完整目标规格一致：错误标记按 session 保存并由下一轮 busy/retry 重置；权限 ID 在首次观察即登记并由 replied 释放；idle helper 只接受 busy/retry 前态；VS Code 与 JetBrains 均验证 payload 并向平台传递 trim 后值。WebGUI 的固定 title/body 与 bridge payload 形状未改变。

# Known limitations and risks

- VS Code 定向测试运行于已缓存的 VS Code 1.74.0 Extension Host，启动时输出本机其他扩展的 proposed API warnings，但目标测试退出码为 0。
- JetBrains 首次通过普通 shell `vfox use --session` 未改变实际 Java 8 PATH，Gradle 在配置阶段失败；随后显式使用 vfox cache 中的 OpenJDK 21.0.2 成功完成定向测试。
- 全量 lint 基线不干净；本 change 不处理 683 项既有 lint 问题。

# Conclusion

五项验收均有对应生产代码或可运行回归测试证据，定向 RED/Green、WebGUI 全量测试与 build、VS Code compile/host 测试、JetBrains Java 21 定向测试均支持通过结论。已知限制均为既有 lint 基线、宿主告警或 Comet 可选 receipt stale，不影响本次通知行为。
