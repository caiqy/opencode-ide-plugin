import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

export type Theme = "light" | "dark"

const key = "opencode:webgui:global:theme:v1"

export async function loadTheme(): Promise<Theme> {
  const value = await scopedStateGetJSON<unknown>("global", key, "dark")
  if (value === "light") return "light"
  return "dark"
}

export async function saveTheme(theme: Theme) {
  return scopedStateSetJSON("global", key, theme)
}
