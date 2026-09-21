import { ideBridge } from "../lib/ideBridge"

export type ApprovalMode = "manual" | "automatic" | "full"

const defaultApprovalKey = "commonSettings.defaultApprovalMode"

export async function loadDefaultApprovalMode(): Promise<ApprovalMode> {
  const value = ideBridge.isInstalled()
    ? (await ideBridge.storageGet("global", [defaultApprovalKey]))?.[defaultApprovalKey]
    : window.localStorage.getItem(defaultApprovalKey)
  return value === "automatic" || value === "full" ? value : "manual"
}

export async function saveDefaultApprovalMode(mode: ApprovalMode) {
  // Approval defaults must not enter the optimistic storage cache or its automatic retry queue.
  if (ideBridge.isInstalled()) return ideBridge.storageSet("global", defaultApprovalKey, mode)
  window.localStorage.setItem(defaultApprovalKey, mode)
  return true
}

export function approvalMode(
  ruleset: Array<{ permission: string; pattern: string }> | undefined,
): ApprovalMode {
  const pattern = ruleset?.slice().reverse().find((rule) => rule.permission === "opencode_approval_mode")?.pattern
  if (pattern === "automatic" || pattern === "full") return pattern
  return "manual"
}
