import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Session, Provider } from "@opencode-ai/sdk/client"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import { eventEmitter, type ServerEvent } from "../lib/api/events"
import { cleanupDeletedSessionDraft } from "./repo/draftRepo"
import { addRecentModel, loadModelPrefs } from "./repo/modelPrefsRepo"
import { loadSelection, patchSelection, saveSelection } from "./repo/selectionRepo"
import { SESSION_LIST_LIMIT, SESSION_LIST_PAGE_SIZE } from "./sessionPaging"

/**
 * Session context state
 */
type SessionStatusInfo = {
  type: string
  attempt: number
  message: string
  next: number
}

type SessionDiffStatusInfo = {
  type: "updating" | "latest" | "failed"
  message: string
}

interface SessionContextState {
  // Current active session
  currentSession: Session | null
  setCurrentSession: (session: Session | null) => void

  // All sessions
  sessions: Session[]
  setSessions: (sessions: Session[]) => void
  hasMore: boolean

  // Loading and error states
  isCreating: boolean
  isLoading: boolean
  isLoadingMore: boolean
  error: Error | null

  // Idle state for current session
  isIdle: boolean
  // Set a specific session's idle state
  setSessionIdle: (sessionId: string, isIdle: boolean) => void

  // Idle state for arbitrary session (e.g. subagent session)
  isSessionIdle: (sessionId: string) => boolean

  // Reasoning state per session
  isReasoning: boolean
  setReasoning: (sessionId: string, active: boolean) => void

  // Reasoning state for arbitrary session (e.g. subagent session)
  isSessionReasoning: (sessionId: string) => boolean

  // Foreground activation coordination for the current session
  foregroundSessions: Set<string>
  beginForegroundSession: (sessionId: string) => void
  endForegroundSession: (sessionId: string) => void

  // Session diff data (per session)
  sessionDiff: Record<string, SnapshotFileDiff[]>
  sessionDiffStatus: Record<string, SessionDiffStatusInfo>

  // Session status for current session
  currentStatus: SessionStatusInfo

  // Model and Agent selection
  selectedProviderId: string | undefined
  selectedModelId: string | undefined
  selectedAgent: string
  setSelectedModel: (providerId: string | undefined, modelId: string | undefined) => Promise<void>
  setSelectedAgent: (agent: string) => Promise<void>

  // Variant selection (per provider/model combo)
  selectedVariant: string | undefined
  selectionRevision: number
  selectionSessionId: string | null
  setSelectedVariant: (variant: string | undefined) => Promise<void>

  // One-time notice when restored selection is auto-adjusted
  selectionRestoreNotice: string | null
  clearSelectionRestoreNotice: () => void

  // IDE bridge restore (does not persist to server)
  restoreSelections: (
    state: {
      providerId: string | null
      modelId: string | null
      agent: string | null
      variant: string | null
    },
    sessionID?: string | null,
  ) => void
  resolveSelections: (sessionID?: string | null, notice?: string | null) => void

  // Actions
  createSession: (options?: { title?: string }) => Promise<Session | null>
  loadSessions: () => Promise<void>
  loadMoreSessions: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
  regenerateSessionTitle: (sessionId: string) => Promise<boolean>
  updateSessionTitle: (sessionId: string, title: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<boolean>
  forkSession: (sessionId: string, messageId: string) => Promise<Session | null>
  revertToMessage: (sessionId: string, messageId: string, partId?: string) => Promise<Session | null>
  unrevertSession: (sessionId: string) => Promise<Session | null>
  redoNext: (sessionId: string) => Promise<Session | null>
  retrySession: (sessionId: string) => Promise<void>
  clearError: () => void
}

const SessionContext = createContext<SessionContextState | null>(null)

function hasModel(providers: Provider[], providerId: string | undefined, modelId: string | undefined): boolean {
  if (!providerId || !modelId) return false
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return false
  const models = provider.models as Record<string, unknown>
  return Boolean(models[modelId])
}

function firstAvailableModel(providers: Provider[]): { providerId: string; modelId: string } | undefined {
  for (const provider of providers) {
    const models = provider.models as Record<string, unknown>
    const firstModelId = Object.keys(models)[0]
    if (!firstModelId) continue
    return {
      providerId: provider.id,
      modelId: firstModelId,
    }
  }
}

function modelVariants(
  providers: Provider[],
  providerId: string | undefined,
  modelId: string | undefined,
): string[] | undefined {
  if (!providerId || !modelId) return undefined
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return undefined
  const model = (provider.models as Record<string, { variants?: Record<string, unknown> } | undefined>)[modelId]
  if (!model?.variants) return undefined
  return Object.keys(model.variants)
}

/**
 * Hook to access session context
 *
 * @throws Error if used outside SessionProvider
 */
export function useSession() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return context
}

interface SessionProviderProps {
  children: ReactNode
}

/**
 * Check if a session title is a default auto-generated title
 * Matches pattern: "New session - 2025-10-31T11:44:37.671Z" or "Child session - ..."
 */
export function isDefaultTitle(title: string): boolean {
  return /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

function isSubagentSession(session: Session): boolean {
  if (!session.parentID) return false
  const title = session.title || ""
  return /\(@[^)]* subagent\)$/.test(title)
}

/**
 * Session provider component
 *
 * Manages the current active session state and provides session-related actions.
 */
export function SessionProvider({ children }: SessionProviderProps) {
  const [currentSession, setCurrentSessionState] = useState<Session | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const [reasoningMap, setReasoningMap] = useState<Record<string, boolean>>({})
  const [foregroundCounts, setForegroundCounts] = useState<Record<string, number>>({})
  const [statusMap, setStatusMap] = useState<Record<string, SessionStatusInfo>>({})
  const [sessionDiffMap, setSessionDiffMap] = useState<Record<string, SnapshotFileDiff[]>>({})
  const [sessionDiffStatusMap, setSessionDiffStatusMap] = useState<Record<string, SessionDiffStatusInfo>>({})
  const draftCleanupQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sessionLimitRef = useRef(SESSION_LIST_LIMIT)
  const sessionWantRef = useRef(SESSION_LIST_LIMIT)
  const sessionMoreRef = useRef<Promise<void> | null>(null)
  const pendingSwitchForegroundRef = useRef<string | null>(null)
  const switchTokenRef = useRef(0)
  const sessionListTokenRef = useRef(0)
  const reconnectEpochRef = useRef(0)
  const statusVersionRef = useRef<Record<string, number>>({})
  const currentSessionEpochRef = useRef(0)
  const currentSessionIDRef = useRef<string | null>(null)

  const setSessionIdle = useCallback((sessionId: string, idle: boolean) => {
    if (!sessionId) return
    statusVersionRef.current[sessionId] = (statusVersionRef.current[sessionId] ?? 0) + 1
    setBusyMap((prev) => {
      const busy = prev[sessionId] ?? false
      const nextBusy = !idle
      if (busy === nextBusy) return prev
      if (!nextBusy) {
        if (!prev[sessionId]) return prev
        const next = { ...prev }
        delete next[sessionId]
        return next
      }
      return { ...prev, [sessionId]: true }
    })
  }, [])

  // Model and Agent selection state (synced with server/global state)
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>()
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>()
  const [selectedAgent, setSelectedAgentState] = useState<string>("build")
  const [agentModelMap, setAgentModelMap] = useState<Record<string, { provider_id: string; model_id: string }>>({})

  // Variant selection state (per provider/model combo, key = "providerId/modelId")
  const [selectedVariant, setSelectedVariantState] = useState<string | undefined>()
  const [selectionRevision, setSelectionRevision] = useState(0)
  const [selectionSessionId, setSelectionSessionId] = useState<string | null>(null)
  const [variantMap, setVariantMap] = useState<Record<string, string>>({})
  const [selectionRestoreNotice, setSelectionRestoreNotice] = useState<string | null>(null)
  const [selectionReadyForHostSync, setSelectionReadyForHostSync] = useState(false)

  const clearSelectionRestoreNotice = useCallback(() => {
    setSelectionRestoreNotice(null)
  }, [])

  const isReasoning = currentSession?.id ? Boolean(reasoningMap[currentSession.id]) : false
  const isIdle = currentSession?.id ? !(busyMap[currentSession.id] ?? false) : true

  const isSessionIdle = useCallback(
    (sessionId: string) => {
      if (!sessionId) return true
      return !(busyMap[sessionId] ?? false)
    },
    [busyMap],
  )

  const isSessionReasoning = useCallback(
    (sessionId: string) => {
      if (!sessionId) return false
      return Boolean(reasoningMap[sessionId])
    },
    [reasoningMap],
  )
  const currentStatus: SessionStatusInfo =
    currentSession?.id && statusMap[currentSession.id]
      ? statusMap[currentSession.id]
      : { type: "idle", attempt: 0, message: "", next: Date.now() }

  const setReasoning = useCallback((sessionId: string, active: boolean) => {
    if (!sessionId) return
    setReasoningMap((prev) => {
      const current = prev[sessionId] ?? false
      if (current === active) return prev
      if (active) {
        return { ...prev, [sessionId]: true }
      }
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
  }, [])

  const beginForegroundSession = useCallback((sessionId: string) => {
    if (!sessionId) return
    setForegroundCounts((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
  }, [])

  const endForegroundSession = useCallback((sessionId: string) => {
    if (!sessionId) return
    setForegroundCounts((prev) => {
      const count = prev[sessionId] ?? 0
      if (count <= 1) {
        if (!prev[sessionId]) return prev
        const next = { ...prev }
        delete next[sessionId]
        return next
      }
      return { ...prev, [sessionId]: count - 1 }
    })
  }, [])

  const replacePendingSwitchForeground = useCallback(
    (sessionId: string | null) => {
      const current = pendingSwitchForegroundRef.current
      if (current === sessionId) return
      if (current) {
        endForegroundSession(current)
      }
      pendingSwitchForegroundRef.current = sessionId
      if (sessionId) {
        beginForegroundSession(sessionId)
      }
    },
    [beginForegroundSession, endForegroundSession],
  )

  const consumePendingSwitchForeground = useCallback(
    (sessionId: string) => {
      if (pendingSwitchForegroundRef.current !== sessionId) return
      pendingSwitchForegroundRef.current = null
      endForegroundSession(sessionId)
    },
    [endForegroundSession],
  )

  const setCurrentSession = useCallback(
    (session: Session | null) => {
      if (!session || (pendingSwitchForegroundRef.current && pendingSwitchForegroundRef.current !== session.id)) {
        replacePendingSwitchForeground(null)
      }
      currentSessionEpochRef.current++
      currentSessionIDRef.current = session?.id ?? null
      setCurrentSessionState(session)
    },
    [replacePendingSwitchForeground],
  )

  const foregroundSessionKey = useMemo(
    () =>
      Object.keys(foregroundCounts)
        .filter((sessionId) => foregroundCounts[sessionId] > 0)
        .sort()
        .join("\0"),
    [foregroundCounts],
  )

  const foregroundSessions = useMemo(
    () => new Set(foregroundSessionKey ? foregroundSessionKey.split("\0") : []),
    [foregroundSessionKey],
  )

  const clearDeletedSessionDraft = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    await cleanupDeletedSessionDraft(sessionId)
  }, [])

  const queueDeletedSessionDraftCleanup = useCallback(
    (sessionId: string) => {
      if (!sessionId) return Promise.resolve()

      const run = () => clearDeletedSessionDraft(sessionId)
      const task = draftCleanupQueueRef.current.then(run, run)
      draftCleanupQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      )
      return task
    },
    [clearDeletedSessionDraft],
  )

  /**
   * Initialize state from repos + server config
   * Priority: workspace:last_selection -> global:model.recent -> config.model -> provider default -> providers first available
   */
  useEffect(() => {
    const initializeState = async () => {
      try {
        const [selection, modelPrefs, providersRes, configRes] = await Promise.all([
          loadSelection(),
          loadModelPrefs(),
          sdk.config.providers(),
          sdk.config.get(),
        ])

        const providers = providersRes.data?.providers ?? []
        const defaults = providersRes.data?.default ?? {}
        const providerDefault = providers
          .map((provider) => ({ providerId: provider.id, modelId: defaults[provider.id] }))
          .find((item) => hasModel(providers, item.providerId, item.modelId))
        const recent = modelPrefs.recent
        const configModel = (() => {
          if (!configRes.data?.model) return undefined
          const parts = configRes.data.model.split("/")
          if (parts.length !== 2) return undefined
          return {
            providerId: parts[0],
            modelId: parts[1],
          }
        })()

        setAgentModelMap(selection.agent_model_map)

        const agent = selection.agent || "build"
        setSelectedAgentState(agent)

        let providerId: string | undefined =
          selection.provider_id ?? selection.agent_model_map[agent]?.provider_id ?? undefined
        let modelId: string | undefined = selection.model_id ?? selection.agent_model_map[agent]?.model_id ?? undefined

        if (!providerId || !modelId) {
          if (recent.length > 0) {
            providerId = recent[0].providerID
            modelId = recent[0].modelID
          }
        }

        if ((!providerId || !modelId) && configModel) {
          providerId = configModel.providerId
          modelId = configModel.modelId
        }

        if ((!providerId || !modelId) && providers.length > 0) {
          const fallbackModel = providerDefault ?? firstAvailableModel(providers)
          providerId = fallbackModel?.providerId
          modelId = fallbackModel?.modelId
        }

        let didFallbackModel = false
        if (providers.length > 0 && !hasModel(providers, providerId, modelId)) {
          const fallbackRecent = recent.find((item) => hasModel(providers, item.providerID, item.modelID))
          const fallbackConfig =
            configModel && hasModel(providers, configModel.providerId, configModel.modelId) ? configModel : undefined
          const fallbackModel =
            (fallbackRecent
              ? {
                  providerId: fallbackRecent.providerID,
                  modelId: fallbackRecent.modelID,
                }
              : undefined) ||
            fallbackConfig ||
            providerDefault ||
            firstAvailableModel(providers)

          providerId = fallbackModel?.providerId
          modelId = fallbackModel?.modelId
          didFallbackModel = true
        }

        if (providerId && modelId) {
          setSelectedProviderId(providerId)
          setSelectedModelId(modelId)

          let initialVariant = selection.variant ?? undefined

          let didFallbackVariant = false
          if (initialVariant) {
            const variants = modelVariants(providers, providerId, modelId)
            if (!variants || !variants.includes(initialVariant)) {
              initialVariant = undefined
              didFallbackVariant = true
            }
          }

          setSelectedVariantState(initialVariant)
          setVariantMap(initialVariant ? { [`${providerId}/${modelId}`]: initialVariant } : {})

          if (didFallbackModel || didFallbackVariant) {
            setSelectionRestoreNotice("已恢复到当前可用配置")
          }
        }
      } catch (err) {
        console.error("[SessionContext] Failed to load state from server:", err)
      } finally {
        setSelectionReadyForHostSync(true)
      }
    }

    initializeState()
  }, [])

  useEffect(() => {
    if (!selectionReadyForHostSync) return

    void saveSelection({
      agent: selectedAgent ?? null,
      provider_id: selectedProviderId ?? null,
      model_id: selectedModelId ?? null,
      variant: selectedVariant ?? null,
      updated_at: Date.now(),
      agent_model_map: agentModelMap,
    })
  }, [selectionReadyForHostSync, selectedAgent, selectedProviderId, selectedModelId, selectedVariant, agentModelMap])

  /**
   * Set selected model and persist to repos
   * Also updates per-agent model preference
   */
  const setSelectedModel = useCallback(
    async (providerId: string | undefined, modelId: string | undefined) => {
      setSelectedProviderId(providerId)
      setSelectedModelId(modelId)
      setSelectionRevision((value) => value + 1)
      if (currentSession?.id) setSelectionSessionId(currentSession.id)

      // Restore variant for the new model
      if (providerId && modelId) {
        const modelKey = `${providerId}/${modelId}`
        setSelectedVariantState(variantMap[modelKey])
      } else {
        setSelectedVariantState(undefined)
      }

      if (providerId && modelId) {
        try {
          const currentAgent = selectedAgent
          const updatedAgentModel = currentAgent
            ? {
                ...agentModelMap,
                [currentAgent]: {
                  provider_id: providerId,
                  model_id: modelId,
                },
              }
            : agentModelMap

          setAgentModelMap(updatedAgentModel)
          await patchSelection({
            provider_id: providerId,
            model_id: modelId,
            agent_model_map: updatedAgentModel,
          })
          await addRecentModel({ providerID: providerId, modelID: modelId })
        } catch (err) {
          console.error("[SessionContext] Failed to save model preference:", err)
        }
      }
    },
    [agentModelMap, currentSession?.id, selectedAgent, variantMap],
  )

  /**
   * Set selected variant and persist to server
   * Updates per-model variant preference
   */
  const setSelectedVariant = useCallback(
    async (variant: string | undefined) => {
      setSelectedVariantState(variant)
      setSelectionRevision((value) => value + 1)
      if (currentSession?.id) setSelectionSessionId(currentSession.id)

      // Get current model key
      if (selectedProviderId && selectedModelId) {
        const modelKey = `${selectedProviderId}/${selectedModelId}`

        // Update variant map
        let updatedVariantMap = { ...variantMap }
        if (variant) {
          updatedVariantMap[modelKey] = variant
        } else {
          delete updatedVariantMap[modelKey]
        }
        setVariantMap(updatedVariantMap)
      }
    },
    [currentSession?.id, selectedModelId, selectedProviderId, variantMap],
  )

  /**
   * Set selected agent and persist to repos
   * Also handles per-agent model preferences
   */
  const setSelectedAgent = useCallback(
    async (newAgent: string) => {
      const currentAgent = selectedAgent
      const currentProvider = selectedProviderId
      const currentModel = selectedModelId

      const nextAgentModel =
        currentAgent && currentProvider && currentModel
          ? {
              ...agentModelMap,
              [currentAgent]: {
                provider_id: currentProvider,
                model_id: currentModel,
              },
            }
          : agentModelMap

      const preferred = nextAgentModel[newAgent]
      const newProvider = preferred?.provider_id ?? currentProvider
      const newModel = preferred?.model_id ?? currentModel

      setSelectedAgentState(newAgent)
      setSelectionRevision((value) => value + 1)
      setAgentModelMap(nextAgentModel)
      if (currentSession?.id) setSelectionSessionId(currentSession.id)

      if (newProvider !== currentProvider || newModel !== currentModel) {
        setSelectedProviderId(newProvider)
        setSelectedModelId(newModel)
        setSelectedVariantState(newProvider && newModel ? variantMap[`${newProvider}/${newModel}`] : undefined)
      }

      try {
        await patchSelection({
          agent: newAgent,
          provider_id: newProvider ?? null,
          model_id: newModel ?? null,
          agent_model_map: nextAgentModel,
        })
      } catch (err) {
        console.error("[SessionContext] Failed to save agent preference:", err)
      }
    },
    [agentModelMap, currentSession?.id, selectedAgent, selectedModelId, selectedProviderId, variantMap],
  )

  const restoreSelections = useCallback(
    (
      state: { providerId: string | null; modelId: string | null; agent: string | null; variant: string | null },
      sessionID?: string | null,
    ) => {
      // 注意：该函数会被会话激活协调器（useSessionActivation）与 IDE bridge 恢复流程调用。
      // 保持稳定引用有助于避免依赖变化导致的重复恢复。

      if (typeof state.agent === "string") {
        setSelectedAgentState(state.agent)
      }

      const nextProvider = typeof state.providerId === "string" ? state.providerId : undefined
      const nextModel = typeof state.modelId === "string" ? state.modelId : undefined
      const hasModel = !!(nextProvider && nextModel)

      if (hasModel && nextProvider && nextModel) {
        setSelectedProviderId(nextProvider)
        setSelectedModelId(nextModel)
      }

      if (state.variant === null) {
        // null 表示显式恢复为“默认”（即未选择）
        setSelectedVariantState(undefined)

        if (nextProvider && nextModel) {
          const key = `${nextProvider}/${nextModel}`
          setVariantMap((prev) => {
            if (!(key in prev)) return prev
            const next = { ...prev }
            delete next[key]
            return next
          })
        }
        setSelectionSessionId(sessionID ?? null)
        return
      }

      if (typeof state.variant === "string") {
        setSelectedVariantState(state.variant)
      }

      if (typeof state.variant === "string" && nextProvider && nextModel) {
        const key = `${nextProvider}/${nextModel}`
        const variant = state.variant
        setVariantMap((prev) => {
          const next = { ...prev }
          next[key] = variant
          return next
        })
      }
      setSelectionSessionId(sessionID ?? null)
    },
    [],
  )

  const resolveSelections = useCallback((sessionID?: string | null, notice?: string | null) => {
    if (notice) {
      setSelectionRestoreNotice(notice)
    }
    setSelectionSessionId(sessionID ?? null)
  }, [])

  /**
   * Load all sessions
   */
  const listSessions = useCallback(async (limit: number, more = false) => {
    const token = ++sessionListTokenRef.current
    sessionWantRef.current = Math.max(sessionWantRef.current, limit)
    if (more) setIsLoadingMore(true)
    else setIsLoading(true)
    setError(null)

    const stop = () => {
      if (more) setIsLoadingMore(false)
      else setIsLoading(false)
    }

    console.log("[SessionContext] Loading sessions...", { limit })

    try {
      const response = await sdk.session.list({ limit, roots: true })
      const stale = token !== sessionListTokenRef.current || limit < sessionWantRef.current

      if (response?.error) {
        if (stale) {
          stop()
          return
        }
        sessionWantRef.current = sessionLimitRef.current
        const errorData =
          response.error && typeof response.error === "object" && "data" in response.error ? response.error.data : null
        const errorMsg =
          errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
            ? String(errorData.message)
            : "Failed to load sessions"
        console.error("[SessionContext] Failed to load sessions:", errorMsg)
        setError(new Error(errorMsg))
        stop()
        return
      }

      if (response?.data) {
        if (stale) {
          stop()
          return
        }
        sessionLimitRef.current = limit
        sessionWantRef.current = limit
        setHasMore(response.data.length >= limit)
        console.log("[SessionContext] Sessions loaded:", response.data.length)
        setSessions(response.data.filter((s) => !isSubagentSession(s)))
        stop()
        return
      }

      stop()
    } catch (err) {
      if (token !== sessionListTokenRef.current || limit < sessionWantRef.current) {
        stop()
        return
      }
      sessionWantRef.current = sessionLimitRef.current
      const errorMsg = err instanceof Error ? err.message : "Failed to load sessions"
      console.error("[SessionContext] Failed to load sessions:", errorMsg)
      setError(new Error(errorMsg))
      stop()
    }
  }, [])

  const loadSessions = useCallback(() => {
    return listSessions(sessionLimitRef.current)
  }, [listSessions])

  const loadMoreSessions = useCallback(() => {
    if (sessionMoreRef.current) return sessionMoreRef.current
    const task = listSessions(sessionWantRef.current + SESSION_LIST_PAGE_SIZE, true).finally(() => {
      sessionMoreRef.current = null
    })
    sessionMoreRef.current = task
    return task
  }, [listSessions])

  /**
   * Create a new session
   */
  const createSession = useCallback(async (options?: { title?: string }) => {
    setIsCreating(true)
    setError(null)

    console.log("[SessionContext] Creating new session...", options)

    try {
      const response = await sdk.session.create({
        body: options,
      })

      if (response.error) {
        const errorMsg =
          "data" in response.error &&
          response.error.data &&
          typeof response.error.data === "object" &&
          "message" in response.error.data
            ? String(response.error.data.message)
            : "Failed to create session"
        console.error("[SessionContext] Failed to create session:", errorMsg)
        setError(new Error(errorMsg))
        setIsCreating(false)
        return null
      }

      if (response.data) {
        console.log("[SessionContext] Session created:", response.data.id)
        setCurrentSession(response.data)
        // Don't add to sessions list here - let the session.created event handler do it
        // This prevents duplicate sessions in the list
        setIsCreating(false)
        return response.data
      }

      setError(new Error("No session data returned"))
      setIsCreating(false)
      return null
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to create session"
      console.error("[SessionContext] Failed to create session:", errorMsg)
      setError(new Error(errorMsg))
      setIsCreating(false)
      return null
    }
  }, [])

  /**
   * Switch to a different session
   */
  const switchSession = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Switching to session:", sessionId)

      if (currentSession?.id === sessionId) {
        return
      }

      const token = ++switchTokenRef.current
      replacePendingSwitchForeground(sessionId)

      try {
        const session = sessions.find((s) => s.id === sessionId)
        if (session) {
          setCurrentSession(session)
          return
        }
        console.log("[SessionContext] Session not found in local list, fetching...")
        // If not in local list, fetch it
        const response = await sdk.session.get({ path: { id: sessionId } })
        if (token !== switchTokenRef.current) {
          return
        }
        if (response.data) {
          setCurrentSession(response.data)
          return
        }
      } catch (error) {
        if (token !== switchTokenRef.current) {
          return
        }
        replacePendingSwitchForeground(null)
        throw error
      }

      if (token !== switchTokenRef.current) {
        return
      }
      replacePendingSwitchForeground(null)
      throw new Error(`Session ${sessionId} not found`)
    },
    [currentSession?.id, replacePendingSwitchForeground, sessions, setCurrentSession],
  )

  /**
   * Update session title
   */
  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string) => {
      console.log("[SessionContext] Updating session title:", sessionId, title)

      try {
        const response = await sdk.session.update({
          path: { id: sessionId },
          body: { title },
        })

        if (response.error) {
          const errorMsg =
            "data" in response.error &&
            response.error.data &&
            typeof response.error.data === "object" &&
            "message" in response.error.data
              ? String(response.error.data.message)
              : "Failed to update session"
          console.error("[SessionContext] Failed to update session:", errorMsg)
          setError(new Error(errorMsg))
          return false
        }

        if (response.data) {
          console.log("[SessionContext] Session updated:", response.data.id)
          // Update in local state
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? response.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(response.data)
          }
          return true
        }

        return false
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to update session"
        console.error("[SessionContext] Failed to update session:", errorMsg)
        setError(new Error(errorMsg))
        return false
      }
    },
    [currentSession],
  )

  const regenerateSessionTitle = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Regenerating session title:", sessionId)

      try {
        const response = await sdk.session.regenerateTitle({
          path: { sessionID: sessionId },
        })

        if (response.error) {
          const errorMsg =
            "data" in response.error &&
            response.error.data &&
            typeof response.error.data === "object" &&
            "message" in response.error.data
              ? String(response.error.data.message)
              : response.error.message || "Failed to regenerate session title"
          console.error("[SessionContext] Failed to regenerate session title:", errorMsg)
          setError(new Error(errorMsg))
          return false
        }

        if (response.data) {
          console.log("[SessionContext] Session title regenerated:", response.data.id)
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? response.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(response.data)
          }
          return true
        }

        return false
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to regenerate session title"
        console.error("[SessionContext] Failed to regenerate session title:", errorMsg)
        setError(new Error(errorMsg))
        return false
      }
    },
    [currentSession],
  )

  /**
   * Delete a session
   */
  const deleteSession = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Deleting session:", sessionId)

      try {
        const response = await sdk.session.delete({
          path: { id: sessionId },
        })

        if (response.error) {
          const errorMsg =
            "data" in response.error &&
            response.error.data &&
            typeof response.error.data === "object" &&
            "message" in response.error.data
              ? String(response.error.data.message)
              : "Failed to delete session"
          console.error("[SessionContext] Failed to delete session:", errorMsg)
          setError(new Error(errorMsg))
          return false
        }

        console.log("[SessionContext] Session deleted:", sessionId)
        if (pendingSwitchForegroundRef.current === sessionId) {
          switchTokenRef.current++
          replacePendingSwitchForeground(null)
        }
        // Remove from local state
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        setReasoning(sessionId, false)

        // If deleting current session, clear it
        if (currentSessionIDRef.current === sessionId) {
          setCurrentSession(null)
        }

        return true
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to delete session"
        console.error("[SessionContext] Failed to delete session:", errorMsg)
        setError(new Error(errorMsg))
        return false
      }
    },
    [replacePendingSwitchForeground, setCurrentSession, setReasoning],
  )

  /**
   * Fork a session at a specific message
   */
  const forkSession = useCallback(async (sessionId: string, messageId: string) => {
    console.log("[SessionContext] Forking session:", sessionId, "at message:", messageId)

    try {
      const response = await sdk.session.fork({
        path: { id: sessionId },
        body: { messageID: messageId },
      })

      if (response.error) {
        const errorData =
          response.error && typeof response.error === "object" && "data" in response.error ? response.error.data : null
        const errorMsg =
          errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
            ? String(errorData.message)
            : "Failed to fork session"
        console.error("[SessionContext] Failed to fork session:", errorMsg)
        setError(new Error(errorMsg))
        return null
      }

      if (response.data) {
        console.log("[SessionContext] Session forked:", response.data.id)
        // Don't add to sessions list here - let the session.created event handler do it
        // This prevents duplicate sessions in the list
        return response.data
      }

      return null
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to fork session"
      console.error("[SessionContext] Failed to fork session:", errorMsg)
      setError(new Error(errorMsg))
      return null
    }
  }, [])

  /**
   * Revert (undo) to a specific message/part
   */
  const revertToMessage = useCallback(
    async (sessionId: string, messageId: string, partId?: string) => {
      console.log(
        "[SessionContext] Reverting session:",
        sessionId,
        "to message:",
        messageId,
        partId ? `(part: ${partId})` : "",
      )
      try {
        const response = await sdk.session.revert({
          path: { id: sessionId },
          body: { messageID: messageId, ...(partId ? { partID: partId } : {}) },
        })
        if (response.error) {
          const errorData =
            response.error && typeof response.error === "object" && "data" in response.error
              ? (response.error as any).data
              : null
          const errorMsg =
            errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
              ? String((errorData as any).message)
              : "Failed to revert session"
          console.error("[SessionContext] Failed to revert session:", errorMsg)
          setError(new Error(errorMsg))
          return null
        }
        if (response.data) {
          if (currentSession?.id === sessionId) setCurrentSession(response.data)
          return response.data
        }
        return null
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to revert session"
        console.error("[SessionContext] Failed to revert session:", errorMsg)
        setError(new Error(errorMsg))
        return null
      }
    },
    [currentSession],
  )

  /**
   * Restore all reverted messages (unrevert)
   */
  const unrevertSession = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Unreverting session:", sessionId)
      try {
        const response = await sdk.session.unrevert({ path: { id: sessionId } })
        if (response.error) {
          const errorData =
            response.error && typeof response.error === "object" && "data" in response.error
              ? (response.error as any).data
              : null
          const errorMsg =
            errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
              ? String((errorData as any).message)
              : "Failed to restore messages"
          console.error("[SessionContext] Failed to unrevert session:", errorMsg)
          setError(new Error(errorMsg))
          return null
        }
        if (response.data) {
          if (currentSession?.id === sessionId) setCurrentSession(response.data)
          return response.data
        }
        return null
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to restore messages"
        console.error("[SessionContext] Failed to unrevert session:", errorMsg)
        setError(new Error(errorMsg))
        return null
      }
    },
    [currentSession],
  )

  /**
   * Redo one step forward from current revert boundary.
   * If there is no next user message, fall back to unrevert (restore all).
   */
  const redoNext = useCallback(
    async (sessionId: string) => {
      try {
        const resp = await sdk.session.messages({ path: { id: sessionId } })
        if (resp.error || !resp.data) {
          const message =
            resp.error && typeof resp.error === "object" && "message" in resp.error
              ? String(resp.error.message)
              : "Failed to load messages for redo"
          setError(new Error(message))
          return null
        }
        const list = resp.data
        const session = currentSession?.id === sessionId ? currentSession : null
        const boundary = session?.revert?.messageID
        if (!boundary) return null
        const sorted = [...list].sort((a, b) => a.info.time.created - b.info.time.created)
        let target: string | null = null
        let seenBoundary = false
        for (const m of sorted) {
          if (m.info.id === boundary) {
            seenBoundary = true
            continue
          }
          if (!seenBoundary) continue
          if (m.info.role === "user") {
            target = m.info.id
            break
          }
        }
        if (!target) return await unrevertSession(sessionId)
        return await revertToMessage(sessionId, target)
      } catch (err) {
        setError(new Error(err instanceof Error ? err.message : "Failed to load messages for redo"))
        return null
      }
    },
    [currentSession, revertToMessage, unrevertSession],
  )

  /**
   * Retry a session's execution
   */
  const retrySession = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Retrying session:", sessionId)
      setSessionIdle(sessionId, false)
      try {
        const response = await sdk.session.retry({ path: { sessionID: sessionId } })
        if (!response?.error) return
        const errorMsg =
          response.error instanceof Error
            ? response.error.message
            : typeof response.error === "object" &&
                response.error !== null &&
                "message" in response.error &&
                typeof response.error.message === "string"
              ? response.error.message
              : "Failed to retry session"
        console.error("[SessionContext] Failed to retry session:", errorMsg)
        setError(new Error(errorMsg))
        setSessionIdle(sessionId, true)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to retry session"
        console.error("[SessionContext] Failed to retry session:", errorMsg)
        setError(new Error(errorMsg))
        setSessionIdle(sessionId, true)
      }
    },
    [setSessionIdle],
  )

  /**
   * Clear the current error
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Load sessions on mount
  useEffect(() => {
    void listSessions(SESSION_LIST_LIMIT)
  }, [listSessions])

  // Load session diff when current session changes
  useEffect(() => {
    const sessionId = currentSession?.id
    if (!sessionId) return

    const controller = new AbortController()
    let released = false
    const release = () => {
      if (released) return
      released = true
      endForegroundSession(sessionId)
    }

    beginForegroundSession(sessionId)
    consumePendingSwitchForeground(sessionId)

    const fetchDiff = async () => {
      try {
        const response = await sdk.session.diff({ path: { id: sessionId }, signal: controller.signal })
        if (controller.signal.aborted) return
        if (response.data) {
          setSessionDiffMap((prev) => ({ ...prev, [sessionId]: response.data }))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[SessionContext] Failed to load session diff:", err)
        }
      } finally {
        release()
      }
    }

    fetchDiff()
    return () => {
      controller.abort()
      release()
    }
  }, [beginForegroundSession, consumePendingSwitchForeground, currentSession?.id, endForegroundSession])

  // Listen for session events from SSE
  useEffect(() => {
    const handleServerConnected = async () => {
      const reconnectEpoch = ++reconnectEpochRef.current
      const sessionID = currentSessionIDRef.current
      const sessionEpoch = currentSessionEpochRef.current
      const statusVersions = { ...statusVersionRef.current }
      void loadSessions()
      const [statusResult, sessionResult] = await Promise.allSettled([
        sdk.session.status(),
        sessionID ? sdk.session.get({ path: { id: sessionID } }) : Promise.resolve({ data: null, error: null }),
      ])

      if (reconnectEpoch !== reconnectEpochRef.current) return

      if (
        statusResult.status === "fulfilled" &&
        statusResult.value.data
      ) {
        const entries = Object.entries(statusResult.value.data)
        const snapshot = new Map(entries)
        const unchanged = (id: string) => statusVersions[id] === statusVersionRef.current[id]
        setBusyMap((prev) => {
          const next = { ...prev }
          for (const id of new Set([...Object.keys(prev), ...snapshot.keys()])) {
            if (!unchanged(id)) continue
            if (snapshot.get(id)?.type !== "idle") next[id] = true
            else delete next[id]
          }
          return next
        })
        setStatusMap((prev) => {
          const next = { ...prev }
          for (const id of new Set([...Object.keys(prev), ...snapshot.keys()])) {
            if (!unchanged(id)) continue
            const value = snapshot.get(id)
            if (!value || value.type === "idle") {
              delete next[id]
              continue
            }
            next[id] = {
              type: value.type,
              attempt: value.type === "retry" ? value.attempt : 0,
              message: value.type === "retry" ? value.message : "",
              next: value.type === "retry" ? value.next : Date.now(),
            }
          }
          return next
        })
        for (const [id, value] of entries) {
          if (value.type === "idle" && unchanged(id)) setReasoning(id, false)
        }
      }

      if (
        sessionResult.status === "fulfilled" &&
        sessionResult.value.data &&
        sessionID === currentSessionIDRef.current &&
        sessionEpoch === currentSessionEpochRef.current &&
        sessionID === sessionResult.value.data.id
      ) {
        setCurrentSession(sessionResult.value.data)
      }
    }

    const handleSessionCreated = (event: any) => {
      if (event.type === "session.created" && event.properties?.info) {
        if (isSubagentSession(event.properties.info)) return
        console.log("[SessionContext] Session created event:", event.properties.info.id)
        setSessions((prev) => {
          // Check if already exists
          if (prev.some((s) => s.id === event.properties.info.id)) {
            return prev
          }
          return [event.properties.info, ...prev]
        })
      }
    }

    const handleSessionUpdated = (event: any) => {
      if (event.type === "session.updated" && event.properties?.info) {
        const updatedSession = event.properties.info
        console.log("[SessionContext] Session updated event:", updatedSession.id, {
          title: updatedSession.title,
          updated: new Date(updatedSession.time.updated).toISOString(),
          isDefaultTitle: isDefaultTitle(updatedSession.title),
        })

        const visible = !isSubagentSession(updatedSession)

        setSessions((prev) => {
          const exists = prev.find((s) => s.id === updatedSession.id)
          if (!visible) {
            return exists ? prev.filter((s) => s.id !== updatedSession.id) : prev
          }
          if (exists && exists.title !== updatedSession.title) {
            console.log("[SessionContext] 🎉 Session title CHANGED:", exists.title, "→", updatedSession.title)
          }
          const next = prev.filter((s) => s.id !== updatedSession.id)
          const idx = next.findIndex((s) => s.time.updated < updatedSession.time.updated)
          if (idx < 0) return [...next, updatedSession]
          return [...next.slice(0, idx), updatedSession, ...next.slice(idx)]
        })

        if (currentSession?.id === updatedSession.id) {
          setCurrentSession(updatedSession)
        }
      }
    }

    const handleSessionDeleted = (event: any) => {
      if (event.type === "session.deleted" && event.properties?.info) {
        const deletedId = event.properties.info.id
        console.log("[SessionContext] Session deleted event:", deletedId)
        void queueDeletedSessionDraftCleanup(deletedId).catch((err) => {
          console.error("[SessionContext] Failed to clear deleted session draft:", err)
        })
        setSessions((prev) => prev.filter((s) => s.id !== deletedId))
        setSessionDiffMap((prev) => {
          if (!prev[deletedId]) return prev
          const next = { ...prev }
          delete next[deletedId]
          return next
        })
        setSessionDiffStatusMap((prev) => {
          if (!prev[deletedId]) return prev
          const next = { ...prev }
          delete next[deletedId]
          return next
        })
        const isCurrent = currentSession?.id === deletedId
        if (isCurrent) {
          setCurrentSession(null)
        }
        setReasoning(deletedId, false)
      }
    }

    const handleSessionStatus = (event: any) => {
      if (event.type !== "session.status" || !event.properties) return
      const { sessionID, status } = event.properties as {
        sessionID: string
        status: SessionStatusInfo
      }
      if (status.type === "idle") {
        setSessionIdle(sessionID, true)
        setReasoning(sessionID, false)
      } else {
        setSessionIdle(sessionID, false)
      }
      setStatusMap((prev) => {
        if (status.type === "idle") {
          const next = { ...prev }
          delete next[sessionID]
          return next
        }
        return { ...prev, [sessionID]: status }
      })
    }

    const handleSessionDiff = (event: ServerEvent) => {
      if (event.type !== "session.diff") return
      const { sessionID, diff } = event.properties
      if (!sessionID) return
      setSessionDiffMap((prev) => ({ ...prev, [sessionID]: Array.isArray(diff) ? diff : [] }))
      setSessionDiffStatusMap((prev) => ({
        ...prev,
        [sessionID]: {
          type: "latest",
          message: "已是最新结果",
        },
      }))
    }

    const handleSessionDiffStatus = (event: any) => {
      if (event.type !== "session.diff.status" || !event.properties) return
      const { sessionID, status, message } = event.properties as {
        sessionID: string
        status: "scheduled" | "running" | "idle" | "deleted" | "failed"
        message: string
      }
      if (!sessionID) return

      if (status === "failed") {
        setSessionDiffStatusMap((prev) => ({
          ...prev,
          [sessionID]: {
            type: "failed",
            message,
          },
        }))
        return
      }

      if (status === "scheduled" || status === "running") {
        setSessionDiffStatusMap((prev) => ({
          ...prev,
          [sessionID]: {
            type: "updating",
            message,
          },
        }))
        return
      }

      if (status === "idle") {
        setSessionDiffStatusMap((prev) => ({
          ...prev,
          [sessionID]: {
            type: "latest",
            message: "已是最新结果",
          },
        }))
        return
      }

      if (status === "deleted") {
        setSessionDiffStatusMap((prev) => {
          if (!prev[sessionID]) return prev
          const next = { ...prev }
          delete next[sessionID]
          return next
        })
      }
    }

    const unsubscribeConnected = eventEmitter.on("server.connected", handleServerConnected)
    const unsubscribeCreated = eventEmitter.on("session.created", handleSessionCreated)
    const unsubscribeUpdated = eventEmitter.on("session.updated", handleSessionUpdated)
    const unsubscribeDeleted = eventEmitter.on("session.deleted", handleSessionDeleted)
    const unsubscribeStatus = eventEmitter.on("session.status", handleSessionStatus)
    const unsubscribeDiff = eventEmitter.on("session.diff", handleSessionDiff)
    const unsubscribeDiffStatus = eventEmitter.on("session.diff.status", handleSessionDiffStatus)

    return () => {
      unsubscribeConnected()
      unsubscribeCreated()
      unsubscribeUpdated()
      unsubscribeDeleted()
      unsubscribeStatus()
      unsubscribeDiff()
      unsubscribeDiffStatus()
    }
  }, [currentSession?.id, loadSessions, queueDeletedSessionDraftCleanup, setReasoning, setSessionIdle])

  const value: SessionContextState = {
    currentSession,
    setCurrentSession,
    sessions,
    setSessions,
    hasMore,
    isCreating,
    isLoading,
    isLoadingMore,
    error,
    isIdle,
    setSessionIdle,
    isSessionIdle,
    isReasoning,
    setReasoning,
    isSessionReasoning,
    foregroundSessions,
    beginForegroundSession,
    endForegroundSession,
    sessionDiff: sessionDiffMap,
    sessionDiffStatus: sessionDiffStatusMap,
    currentStatus,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    setSelectedModel,
    setSelectedAgent,
    selectedVariant,
    selectionRevision,
    selectionSessionId,
    setSelectedVariant,
    selectionRestoreNotice,
    clearSelectionRestoreNotice,
    restoreSelections,
    resolveSelections,
    createSession,
    loadSessions,
    loadMoreSessions,
    switchSession,
    regenerateSessionTitle,
    updateSessionTitle,
    deleteSession,
    forkSession,
    revertToMessage,
    unrevertSession,
    redoNext,
    retrySession,
    clearError,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
