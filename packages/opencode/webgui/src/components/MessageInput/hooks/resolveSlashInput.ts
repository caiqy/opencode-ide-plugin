import {
  hasCommandSearchCache,
  loadCommandSearchCommands,
  resetCommandSearchCache,
} from "../../../hooks/useCommandSearch"

type SlashResolution = { mode: "prompt" } | { mode: "command"; name: string; arguments: string }

export function resetSlashInputCache() {
  resetCommandSearchCache()
}

function parseSlashInput(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) return null

  const [head, ...tail] = trimmed.split(/\s+/)
  const name = head.slice(1)
  if (!name) return null

  return {
    name,
    arguments: tail.join(" "),
  }
}

function matchesName(name: string, commands: Awaited<ReturnType<typeof loadCommandSearchCommands>>) {
  return commands.some((item) => item.name === name)
}

export async function resolveSlashInput(text: string): Promise<SlashResolution> {
  const parsed = parseSlashInput(text)
  if (!parsed) {
    return { mode: "prompt" }
  }

  const hadCache = hasCommandSearchCache()
  const loaded = await loadCommandSearchCommands()
  if (!matchesName(parsed.name, loaded)) {
    if (!hadCache) {
      return { mode: "prompt" }
    }

    const refreshed = await loadCommandSearchCommands({ force: true })
    if (!matchesName(parsed.name, refreshed)) {
      return { mode: "prompt" }
    }
  }

  return {
    mode: "command",
    name: parsed.name,
    arguments: parsed.arguments,
  }
}
