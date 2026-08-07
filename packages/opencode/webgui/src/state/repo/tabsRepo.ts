import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

const key = "opencode:webgui:workspace:tabs:v1"

export type Tabs = {
  open_tabs: string[]
  active_tab: string
}

const fallback: Tabs = {
  open_tabs: [],
  active_tab: "",
}

function parse(input: unknown): Tabs {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback
  const open_tabs = Array.isArray((input as { open_tabs?: unknown }).open_tabs)
    ? (input as { open_tabs: unknown[] }).open_tabs.filter((id): id is string => typeof id === "string")
    : []
  const active_tab =
    typeof (input as { active_tab?: unknown }).active_tab === "string"
      ? (input as { active_tab: string }).active_tab
      : ""
  const safe = open_tabs.includes(active_tab) ? active_tab : open_tabs[open_tabs.length - 1] || ""
  return {
    open_tabs,
    active_tab: safe,
  }
}

export async function loadTabs(): Promise<Tabs> {
  const value = await scopedStateGetJSON<unknown>("workspace", key, fallback)
  return parse(value)
}

export async function saveTabs(value: Tabs) {
  return scopedStateSetJSON("workspace", key, parse(value))
}
