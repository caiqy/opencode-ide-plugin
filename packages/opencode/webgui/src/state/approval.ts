export type ApprovalMode = "manual" | "automatic" | "full"

export function approvalMode(
  ruleset: Array<{ permission: string; pattern: string }> | undefined,
): ApprovalMode {
  const pattern = ruleset?.slice().reverse().find((rule) => rule.permission === "opencode_approval_mode")?.pattern
  if (pattern === "automatic" || pattern === "full") return pattern
  return "manual"
}
