import { describe, expect, test } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { buildToolPermissionAsk } from "../../src/session/tool-permission"

describe("session tool permission payload", () => {
  test("buildToolPermissionAsk 包含 tool messageID/callID 绑定", () => {
    const ruleset = PermissionNext.fromConfig({ glob: "ask" })
    const payload = buildToolPermissionAsk({
      sessionID: "session_1",
      messageID: "message_1",
      callID: "call_1",
      ruleset,
      req: {
        permission: "glob",
        patterns: ["**/*.ts"],
        always: ["*"],
        metadata: { pattern: "**/*.ts" },
      },
    })

    expect(payload.tool).toEqual({
      messageID: "message_1",
      callID: "call_1",
    })
  })

  test("buildToolPermissionAsk 保留原权限请求字段", () => {
    const ruleset = PermissionNext.fromConfig({ edit: "ask" })
    const payload = buildToolPermissionAsk({
      sessionID: "session_2",
      messageID: "message_2",
      callID: "call_2",
      ruleset,
      req: {
        permission: "edit",
        patterns: ["/tmp/a.ts"],
        always: ["/tmp/*"],
        metadata: { filePath: "/tmp/a.ts" },
      },
    })

    expect(payload.sessionID).toBe("session_2")
    expect(payload.ruleset).toBe(ruleset)
    expect(payload.permission).toBe("edit")
    expect(payload.patterns).toEqual(["/tmp/a.ts"])
    expect(payload.always).toEqual(["/tmp/*"])
    expect(payload.metadata).toEqual({ filePath: "/tmp/a.ts" })
  })
})
