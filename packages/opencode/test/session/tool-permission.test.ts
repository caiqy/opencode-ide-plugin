import { describe, expect, test } from "bun:test"
import { Permission } from "../../src/permission"
import { MessageID, SessionID } from "../../src/session/schema"
import { buildToolPermissionAsk } from "../../src/session/tool-permission"

describe("session tool permission payload", () => {
  test("buildToolPermissionAsk 包含 tool messageID/callID 绑定", () => {
    const ruleset = Permission.fromConfig({ glob: "ask" })
    const payload = buildToolPermissionAsk({
      sessionID: SessionID.make("session_1"),
      messageID: MessageID.make("msg_1"),
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
      messageID: MessageID.make("msg_1"),
      callID: "call_1",
    })
  })

  test("buildToolPermissionAsk 保留原权限请求字段", () => {
    const ruleset = Permission.fromConfig({ edit: "ask" })
    const payload = buildToolPermissionAsk({
      sessionID: SessionID.make("session_2"),
      messageID: MessageID.make("msg_2"),
      callID: "call_2",
      ruleset,
      req: {
        permission: "edit",
        patterns: ["/tmp/a.ts"],
        always: ["/tmp/*"],
        metadata: { filePath: "/tmp/a.ts" },
      },
    })

    expect(payload.sessionID).toBe(SessionID.make("session_2"))
    expect(payload.ruleset).toBe(ruleset)
    expect(payload.permission).toBe("edit")
    expect(payload.patterns).toEqual(["/tmp/a.ts"])
    expect(payload.always).toEqual(["/tmp/*"])
    expect(payload.metadata).toEqual({ filePath: "/tmp/a.ts" })
  })

  test("buildToolPermissionAsk 将即时 overlay 规则合并进 ruleset", () => {
    const ruleset = Permission.fromConfig({ skill: { brainstorming: "allow" } })
    const overlayRuleset = Permission.fromConfig({ skill: { brainstorming: "deny" } })
    const payload = buildToolPermissionAsk({
      sessionID: SessionID.make("session_3"),
      messageID: MessageID.make("msg_3"),
      callID: "call_3",
      ruleset,
      overlayRuleset,
      req: {
        permission: "skill",
        patterns: ["brainstorming"],
        always: ["brainstorming"],
        metadata: {},
      },
    })

    expect(Permission.evaluate("skill", "brainstorming", payload.ruleset).action).toBe("deny")
    expect(payload.ruleset.at(-1)).toMatchObject({
      permission: "skill",
      pattern: "brainstorming",
      action: "deny",
    })
  })
})
