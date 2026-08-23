import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's approval mode, deny rules, and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => rule.permission === "task")
  const canTodo = input.subagent.permission.some((rule) => rule.permission === "todowrite")
  const inherited = input.parentSessionPermission.filter(
    (rule) =>
      rule.permission === "external_directory" ||
      rule.permission === ApprovalV1.RulePermission ||
      rule.action === "deny",
  )
  const defaults = [
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
  return [
    ...inherited,
    ...defaults.filter(
      (item) =>
        !inherited.some(
          (rule) =>
            rule.permission === item.permission && rule.pattern === item.pattern && rule.action === item.action,
        ),
    ),
  ]
}
