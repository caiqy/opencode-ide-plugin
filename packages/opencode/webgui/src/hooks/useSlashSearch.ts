import { useEffect, useMemo, useState } from "react"
import { sdk } from "../lib/api/sdkClient"
import { filterSlashItems, type SlashItem } from "../components/slash/utils"

export interface UseSlashSearchResult {
  results: SlashItem[]
  isLoading: boolean
  error: Error | null
}

const MAX_RESULTS = 50

type Cache = {
  items: SlashItem[]
  error: Error | null
  promise: Promise<void> | null
  done: boolean
}

const cache: Cache = {
  items: [],
  error: null,
  promise: null,
  done: false,
}

function parseCommandSource(cmd: unknown): SlashItem["source"] | undefined {
  if (!cmd || typeof cmd !== "object") return
  if (!("source" in cmd)) return
  const v = (cmd as { source?: unknown }).source
  if (v === "command" || v === "mcp" || v === "skill") return v
}

function parseMessage(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return
  if (!("message" in err)) return
  const v = (err as { message?: unknown }).message
  if (typeof v === "string" && v) return v
}

async function loadOnce() {
  if (cache.promise) return cache.promise

  cache.done = false
  cache.promise = (async () => {
    const [commandsRes, skillsRes] = await Promise.allSettled([sdk.command.list(), sdk.app.skills()])

    const problems: string[] = []

    const commandItems: SlashItem[] = []
    if (commandsRes.status === "fulfilled") {
      if (commandsRes.value.error) problems.push(parseMessage(commandsRes.value.error) ?? "Failed to load commands")
      if (commandsRes.value.data) {
        for (const cmd of commandsRes.value.data) {
          commandItems.push({
            id: `command:${cmd.name}`,
            kind: "command",
            name: cmd.name,
            description: cmd.description,
            source: parseCommandSource(cmd) ?? "command",
          })
        }
      }
    } else {
      problems.push(commandsRes.reason instanceof Error ? commandsRes.reason.message : "Failed to load commands")
    }

    const skillItems: SlashItem[] = []
    if (skillsRes.status === "fulfilled") {
      if (skillsRes.value.error) problems.push(parseMessage(skillsRes.value.error) ?? "Failed to load skills")
      if (skillsRes.value.data) {
        for (const skill of skillsRes.value.data) {
          skillItems.push({
            id: `skill:${skill.name}`,
            kind: "skill",
            name: skill.name,
            description: skill.description,
          })
        }
      }
    } else {
      problems.push(skillsRes.reason instanceof Error ? skillsRes.reason.message : "Failed to load skills")
    }

    cache.items = [...commandItems, ...skillItems]
    cache.error = problems.length > 0 ? new Error(problems[0]!) : null
  })().finally(() => {
    cache.done = true
  })

  return cache.promise
}

export function __resetSlashSearchCache() {
  cache.items = []
  cache.error = null
  cache.promise = null
  cache.done = false
}

export function useSlashSearch(query: string): UseSlashSearchResult {
  const [items, setItems] = useState<SlashItem[]>(() => cache.items)
  const [isLoading, setIsLoading] = useState(() => !cache.done)
  const [error, setError] = useState<Error | null>(() => cache.error)

  useEffect(() => {
    const state = { active: true }

    setItems(cache.items)
    setError(cache.error)
    setIsLoading(!cache.done)

    loadOnce()
      .then(() => {
        if (!state.active) return
        setItems(cache.items)
        setError(cache.error)
      })
      .catch((err) => {
        if (!state.active) return
        const errorObj = err instanceof Error ? err : new Error("Failed to load slash items")
        setError(errorObj)
      })
      .finally(() => {
        if (!state.active) return
        setIsLoading(false)
      })

    return () => {
      state.active = false
    }
  }, [])

  const results = useMemo(() => {
    return filterSlashItems(items, query).slice(0, MAX_RESULTS)
  }, [items, query])

  return { results, isLoading, error }
}
