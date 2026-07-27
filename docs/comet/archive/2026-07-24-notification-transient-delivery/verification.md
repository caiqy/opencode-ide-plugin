# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-0c5320623c7072c8d24226a127cabaf580ffe203135b6e1a3af699ec39023758",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideBridge.test.ts",
      "packages/opencode/webgui/src/lib/ideBridge.ts",
      "packages/opencode/webgui/src/lib/ideNotifications.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-30fdcfbfe220b3d3e9d0d1d653de2b1cf5047bb0f2411af8e6e2567bae7f4133",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideBridge.test.ts",
      "packages/opencode/webgui/src/lib/ideBridge.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-99c0b81a4f00672651337fb083ca1c7e99f6fa50301008ef28d135ed856fa8f4",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideBridge.test.ts",
      "packages/opencode/webgui/src/lib/ideBridge.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-a644a7a049339d2d4f31e549a8aae405024b946b8ca070c89bc2201bb13cf1d7",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideBridge.test.ts",
      "packages/opencode/webgui/src/lib/ideBridge.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-f39e6b07150c5aa9376b802655eceaadc4e21883b951abe104d2896288da31fc",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideBridge.ts",
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- `vfox current`：Bun 1.3.14、Node.js 20.20.2、Java 21.0.2+13 为 vfox 当前版本。
- RED，`packages/opencode/webgui: bun run test:run src/lib/ideBridge.test.ts`：12 项中新增 2 项失败；网络 reject 与 HTTP 500 场景在断线重连后均实际调用 fetch 2 次，预期为 1 次。
- GREEN，重复上述命令：1 file、12 tests 全部通过。新增两个场景的 fetch 均保持 1 次；既有“网络错误重试耗尽后 request 会 reject”继续通过。
- `packages/opencode/webgui: bun run test:run src/lib/ideBridge.test.ts src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx src/state/MessagesContext.task-result.test.tsx`：4 files、35 tests 全部通过。
- `packages/opencode/webgui: bun run test:run`：158 files、1382 tests 全部通过。
- `packages/opencode/webgui: bun run build`：TypeScript 与 Vite production build 成功；仅有既存 chunk-size warning。
- `packages/opencode/webgui: bun x eslint src/lib/ideBridge.ts src/lib/ideBridge.test.ts src/lib/ideNotifications.ts src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx`：退出码 0，无输出。
- `hosts/vscode-plugin: pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer showNotification"`：compile 成功，VS Code 1.74 Extension Host 定向测试 2/2 通过；本机其他扩展输出 proposed API 与短暂 unresponsive warning，最终 host 退出码为 0。
- `hosts/jetbrains-plugin: vfox exec java@21.0.2+13 -- .\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"`：`BUILD SUCCESSFUL`，8 tasks 中 1 executed、7 up-to-date。
- `git diff --check`：退出码 0，仅输出工作树 LF/CRLF 转换提示，无空白错误。
- Comet Build：使用已授权的 snapshot/evidence 临时预算后，完整 scope `a8d2d1a293249500d409cbd2638e1c175660fb66b9ae1c44f6500881b8a379b2` 成功封印。

# Skipped checks

- 未跳过 brief 要求的检查。未处理低优先级 MessagesContext session 状态集合增长，按本 change Non-goals 明确排除。

# Spec consistency

`sendTransient()` 同步检查 bridge 配置与 ready，接受时调用共用 `doSend()` 一次并返回 true。`doSend()` 的 `allowRetry=false` 同时禁止网络异常和 HTTP 5xx 的 `requeueWithBackoff()`；`sendIdeNotification()` 直接返回该入口结果，消除了调用前 ready 检查与普通 send 之间的竞态。普通 `send()`、`request()`、flushQueue 和 retryCount 默认路径未变。

# Known limitations and risks

- POST 是异步 fire-and-forget；`sendTransient()` 的 true 表示接受一次尝试，不表示远端已成功显示通知，这是规格定义的语义。
- VS Code host 受本机其他扩展影响输出 proposed API/unresponsive warning，但目标测试通过且退出码为 0。
- Vite 保留既存大 chunk warning，与本次 bridge 发送语义无关。
- Comet 大仓库证据需要临时预算补丁；每次均在工作区外备份、`finally` 恢复 Runtime 原 SHA-256 `0f93bd698d5d8259f88525816a8493ae3ca1b3626c108fbf517193b0dc6d7dbb` 并删除备份。

# Conclusion

五项验收均有生产代码或真实 bridge 回归证据。RED 证明通知在 reject/500 后会被重连补发，GREEN 证明易失入口只尝试一次，同时普通请求重试、WebGUI 全量、build、lint 和两个 host 回归均通过，可以归档。
