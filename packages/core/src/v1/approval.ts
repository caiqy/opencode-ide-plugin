export * as ApprovalV1 from "./approval"

import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"
import { PermissionV1 } from "./permission"

export const Mode = Session.Approval
export type Mode = Session.Approval

// Stored beside session permission rules as the single durable mode marker; normal tools never request this name.
export const RulePermission = "opencode_approval_mode"
export const TransitionPermission = "opencode_approval_transition"

export function rule(mode: Mode): PermissionV1.Rule {
  return { permission: RulePermission, pattern: mode, action: "ask" }
}

export function modeFromRuleset(ruleset: PermissionV1.Ruleset): Mode {
  const value = ruleset.findLast((item) => item.permission === RulePermission)?.pattern
  return Schema.is(Mode)(value) ? value : "manual"
}

export function withRuleset(ruleset: PermissionV1.Ruleset | undefined, mode: Mode): PermissionV1.Ruleset {
  return [...(ruleset ?? []).filter((item) => item.permission !== RulePermission), rule(mode)]
}

export function withTransition(ruleset: PermissionV1.Ruleset): PermissionV1.Ruleset {
  return [...withoutTransition(ruleset), { permission: TransitionPermission, pattern: "*", action: "deny" }]
}

export function withoutTransition(ruleset: PermissionV1.Ruleset): PermissionV1.Ruleset {
  return ruleset.filter((item) => item.permission !== TransitionPermission)
}

export function isTransitioning(ruleset: PermissionV1.Ruleset): boolean {
  return ruleset.some((item) => item.permission === TransitionPermission)
}
