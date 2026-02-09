import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Session, FileDiff, Provider } from "@opencode-ai/sdk/client"
import { eventEmitter } from "../lib/api/events"
import { loadLastSelectionFromHost, saveLastSelectionToHost } from "./lastSelectionStore"

/**
 * Session context state
 */
type SessionStatusInfo = {
  type: string
  attempt: number
  message: string
  next: number
}

interface SessionContextState {
  // Current active session
  currentSession: Session | null
  setCurrentSession: (session: Session | null) => void

  // All sessions
  sessions: Session[]
  setSessions: (sessions: Session[]) => void

  // Loading and error states
  isCreating: boolean
  isLoading: boolean
  error: Error | null

  // Idle state for current session
  isIdle: boolean
  // Set a specific session's idle state
  setSessionIdle: (sessionId: string, isIdle: boolean) => void

  // Reasoning state per session
  isReasoning: boolean
  setReasoning: (sessionId: string, active: boolean) => void

  // Session diff data (per session)
  sessionDiff: Record<string, FileDiff[]>

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
  setSelectedVariant: (variant: string | undefined) => Promise<void>

  // One-time notice when restored selection is auto-adjusted
  selectionRestoreNotice: string | null
  clearSelectionRestoreNotice: () => void

  // IDE bridge restore (does not persist to server)
  restoreSelections: (state: {
    providerId: string | null
    modelId: string | null
    agent: string | null
    variant: string | null
  }) => void

  // Virtual session tracking
  isVirtualSession: boolean

  // Actions
  newVirtual: () => Session
  createSession: (options?: { title?: string }) => Promise<Session | null>
  materializeSession: () => Promise<Session | null>
  loadSessions: () => Promise<void>
  switchSession: (sessionId: string) => Promise<void>
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
 * Helper function to create a virtual session object
 */
function createVirtualSession(): Session {
  const now = Date.now()
  return {
    id: `virtual-${now}`,
    title: "",
    time: {
      created: now,
      updated: now,
    },
  } as Session
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
  const [currentSession, setCurrentSession] = useState<Session | null>(() => createVirtualSession())
  const [isVirtualSession, setIsVirtualSession] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const [reasoningMap, setReasoningMap] = useState<Record<string, boolean>>({})
  const [statusMap, setStatusMap] = useState<Record<string, SessionStatusInfo>>({})
  const [sessionDiffMap, setSessionDiffMap] = useState<Record<string, FileDiff[]>>({})

  const setSessionIdle = useCallback((sessionId: string, idle: boolean) => {
    if (!sessionId) return
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

  // Model and Agent selection state (synced with server state + localStorage fallback)
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>()
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>()
  const [selectedAgent, setSelectedAgentState] = useState<string>("build")
  const [agentModelMap, setAgentModelMap] = useState<Record<string, { provider_id: string; model_id: string }>>({})

  // Variant selection state (per provider/model combo, key = "providerId/modelId")
  const [selectedVariant, setSelectedVariantState] = useState<string | undefined>()
  const [variantMap, setVariantMap] = useState<Record<string, string>>({})
  const [selectionRestoreNotice, setSelectionRestoreNotice] = useState<string | null>(null)
  const [selectionReadyForHostSync, setSelectionReadyForHostSync] = useState(false)

  const clearSelectionRestoreNotice = useCallback(() => {
    setSelectionRestoreNotice(null)
  }, [])

  const isReasoning = currentSession?.id ? Boolean(reasoningMap[currentSession.id]) : false
  const isIdle = currentSession?.id ? !(busyMap[currentSession.id] ?? false) : true
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

  /**
   * Initialize state from server on mount
   * Priority: host last selection > kv/model > config > localStorage
   */
  useEffect(() => {
    const initializeState = async () => {
      try {
        const [kvRes, modelRes, providersRes, configRes, hostSelection] = await Promise.all([
          sdk.kv.get(),
          sdk.model.get(),
          sdk.config.providers(),
          sdk.config.get(),
          loadLastSelectionFromHost(),
        ])

        const kv = kvRes.data ?? {}
        const modelPrefs = modelRes.data
        const providers = providersRes.data?.providers ?? []
        const recent = modelPrefs?.recent ?? []
        const configModel = (() => {
          if (!configRes.data?.model) return undefined
          const parts = configRes.data.model.split("/")
          if (parts.length !== 2) return undefined
          return {
            providerId: parts[0],
            modelId: parts[1],
          }
        })()

        // Cache agent_model map from kv
        if (kv.webgui_agent_model) {
          setAgentModelMap(kv.webgui_agent_model)
        }

        // Load variant map from model.json
        if (modelPrefs?.variant) {
          setVariantMap(modelPrefs.variant as Record<string, string>)
        }

        // Set agent (host > kv > default)
        const agent = hostSelection?.agent || kv.webgui_agent || "build"
        setSelectedAgentState(agent)
        localStorage.setItem("opencode_selected_agent", agent)

        let providerId = kv.webgui_provider as string | undefined
        let modelId = kv.webgui_model as string | undefined

        // Prefer per-agent model in kv when available
        if (kv.webgui_agent_model?.[agent]) {
          providerId = kv.webgui_agent_model[agent].provider_id
          modelId = kv.webgui_agent_model[agent].model_id
        }

        // Host selection overrides kv when available
        if (hostSelection?.providerId && hostSelection?.modelId) {
          providerId = hostSelection.providerId
          modelId = hostSelection.modelId
        }

        // Fallback candidates for empty selection
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

        // Validate selected model against currently available providers/models
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
            firstAvailableModel(providers)

          providerId = fallbackModel?.providerId
          modelId = fallbackModel?.modelId
          didFallbackModel = true
        }

        // Set model/provider if we have them
        if (providerId && modelId) {
          setSelectedProviderId(providerId)
          setSelectedModelId(modelId)
          localStorage.setItem("opencode_selected_provider", providerId)
          localStorage.setItem("opencode_selected_model", modelId)

          // Priority for initial variant: host > model.json map
          let initialVariant =
            hostSelection?.variant ||
            (modelPrefs?.variant
              ? (modelPrefs.variant as Record<string, string>)[`${providerId}/${modelId}`]
              : undefined)

          // Validate variant if model variants are present
          let didFallbackVariant = false
          if (initialVariant) {
            const variants = modelVariants(providers, providerId, modelId)
            if (!variants || !variants.includes(initialVariant)) {
              initialVariant = undefined
              didFallbackVariant = true
            }
          }

          setSelectedVariantState(initialVariant)

          if (didFallbackModel || didFallbackVariant) {
            setSelectionRestoreNotice("已恢复到当前可用配置")
          }
        }
      } catch (err) {
        console.error("[SessionContext] Failed to load state from server, using localStorage fallback:", err)
        const savedProvider = localStorage.getItem("opencode_selected_provider")
        const savedModel = localStorage.getItem("opencode_selected_model")
        const savedAgent = localStorage.getItem("opencode_selected_agent")

        if (savedProvider) setSelectedProviderId(savedProvider)
        if (savedModel) setSelectedModelId(savedModel)
        if (savedAgent) setSelectedAgentState(savedAgent)
      } finally {
        setSelectionReadyForHostSync(true)
      }
    }

    initializeState()
  }, [])

  useEffect(() => {
    if (!selectionReadyForHostSync) return

    void saveLastSelectionToHost({
      v: 1,
      agent: selectedAgent ?? null,
      providerId: selectedProviderId ?? null,
      modelId: selectedModelId ?? null,
      variant: selectedVariant ?? null,
      updatedAt: Date.now(),
    })
  }, [selectionReadyForHostSync, selectedAgent, selectedProviderId, selectedModelId, selectedVariant])

  /**
   * Set selected model and persist to server + localStorage
   * Also updates per-agent model preference
   */
  const setSelectedModel = useCallback(
    async (providerId: string | undefined, modelId: string | undefined) => {
      setSelectedProviderId(providerId)
      setSelectedModelId(modelId)

      // Restore variant for the new model
      if (providerId && modelId) {
        const modelKey = `${providerId}/${modelId}`
        setSelectedVariantState(variantMap[modelKey])
      } else {
        setSelectedVariantState(undefined)
      }

      // Persist to localStorage as fallback
      if (providerId) {
        localStorage.setItem("opencode_selected_provider", providerId)
      } else {
        localStorage.removeItem("opencode_selected_provider")
      }
      if (modelId) {
        localStorage.setItem("opencode_selected_model", modelId)
      } else {
        localStorage.removeItem("opencode_selected_model")
      }

      // Persist to server state (including per-agent preference)
      if (providerId && modelId) {
        try {
          // Update cached agent_model map
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

          // Persist to kv.json (webgui-specific keys)
          await sdk.kv.update({
            body: {
              webgui_provider: providerId,
              webgui_model: modelId,
              webgui_agent_model: updatedAgentModel,
            },
          })

          // Update model.json recent list (shared with CLI)
          const modelRes = await sdk.model.get()
          const existing = modelRes.data?.recent ?? []
          const entry = { providerID: providerId, modelID: modelId }
          const deduped = [entry, ...existing.filter((r) => r.providerID !== providerId || r.modelID !== modelId)]
          if (deduped.length > 10) deduped.length = 10
          await sdk.model.update({ body: { recent: deduped } })
        } catch (err) {
          console.error("[SessionContext] Failed to save model preference to server:", err)
        }
      }
    },
    [selectedAgent, agentModelMap, variantMap],
  )

  /**
   * Set selected variant and persist to server
   * Updates per-model variant preference
   */
  const setSelectedVariant = useCallback(
    async (variant: string | undefined) => {
      setSelectedVariantState(variant)

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

        // Persist variant to model.json (shared with CLI)
        try {
          await sdk.model.update({
            body: {
              variant: updatedVariantMap,
            },
          })
        } catch (err) {
          console.error("[SessionContext] Failed to save variant preference:", err)
        }
      }
    },
    [selectedProviderId, selectedModelId, variantMap],
  )

  /**
   * Set selected agent and persist to server + localStorage
   * Also handles per-agent model preferences
   */
  const setSelectedAgent = useCallback(
    async (newAgent: string) => {
      try {
        // Fetch current kv to get agent_model map
        const kvRes = await sdk.kv.get()
        const currentAgent = selectedAgent
        const currentProvider = selectedProviderId
        const currentModel = selectedModelId

        // Save current model for current agent if we have one
        let agentModel = kvRes.data?.webgui_agent_model || {}
        if (currentAgent && currentProvider && currentModel) {
          agentModel = {
            ...agentModel,
            [currentAgent]: {
              provider_id: currentProvider,
              model_id: currentModel,
            },
          }
          console.log(`[SessionContext] Saved model for agent ${currentAgent}:`, currentProvider, currentModel)
        }

        // Check if new agent has a saved model preference
        let newProvider = currentProvider
        let newModel = currentModel

        if (agentModel[newAgent]) {
          newProvider = agentModel[newAgent].provider_id
          newModel = agentModel[newAgent].model_id
          console.log(`[SessionContext] Restoring model for agent ${newAgent}:`, newProvider, newModel)
        }

        // Update state
        setSelectedAgentState(newAgent)
        localStorage.setItem("opencode_selected_agent", newAgent)

        // Update model if it changed
        if (newProvider !== currentProvider || newModel !== currentModel) {
          setSelectedProviderId(newProvider)
          setSelectedModelId(newModel)
          if (newProvider) localStorage.setItem("opencode_selected_provider", newProvider)
          if (newModel) localStorage.setItem("opencode_selected_model", newModel)
        }

        // Persist to kv.json (webgui-specific keys)
        await sdk.kv.update({
          body: {
            webgui_agent: newAgent,
            webgui_agent_model: agentModel,
            webgui_provider: newProvider,
            webgui_model: newModel,
          },
        })
        console.log("[SessionContext] Agent and model preferences saved to server")
      } catch (err) {
        console.error("[SessionContext] Failed to save agent preference to server:", err)
        // Fallback to simple update
        setSelectedAgentState(newAgent)
        localStorage.setItem("opencode_selected_agent", newAgent)
      }
    },
    [selectedAgent, selectedProviderId, selectedModelId],
  )

  const restoreSelections = useCallback(
    (state: { providerId: string | null; modelId: string | null; agent: string | null; variant: string | null }) => {
      if (typeof state.agent === "string" && state.agent !== selectedAgent) {
        setSelectedAgentState(state.agent)
        localStorage.setItem("opencode_selected_agent", state.agent)
      }

      const nextProvider = typeof state.providerId === "string" ? state.providerId : undefined
      const nextModel = typeof state.modelId === "string" ? state.modelId : undefined
      const hasModel = !!(nextProvider && nextModel)

      if (hasModel && nextProvider !== selectedProviderId) {
        setSelectedProviderId(nextProvider)
        if (nextProvider) localStorage.setItem("opencode_selected_provider", nextProvider)
        if (!nextProvider) localStorage.removeItem("opencode_selected_provider")
      }

      if (hasModel && nextModel !== selectedModelId) {
        setSelectedModelId(nextModel)
        if (nextModel) localStorage.setItem("opencode_selected_model", nextModel)
        if (!nextModel) localStorage.removeItem("opencode_selected_model")
      }

      if (typeof state.variant === "string") setSelectedVariantState(state.variant)

      if (typeof state.variant === "string" && nextProvider && nextModel) {
        const key = `${nextProvider}/${nextModel}`
        const variant = state.variant
        setVariantMap((prev) => {
          const next = { ...prev }
          next[key] = variant
          return next
        })
      }
    },
    [selectedAgent, selectedProviderId, selectedModelId],
  )

  /**
   * Load all sessions
   */
  const loadSessions = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    console.log("[SessionContext] Loading sessions...")

    try {
      const response = await sdk.session.list()

      if (response.error) {
        const errorData =
          response.error && typeof response.error === "object" && "data" in response.error ? response.error.data : null
        const errorMsg =
          errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
            ? String(errorData.message)
            : "Failed to load sessions"
        console.error("[SessionContext] Failed to load sessions:", errorMsg)
        setError(new Error(errorMsg))
        setIsLoading(false)
        return
      }

      if (response.data) {
        console.log("[SessionContext] Sessions loaded:", response.data.length)
        // Sort by creation time (newest first)
        const sorted = response.data
          .filter((s) => !isSubagentSession(s))
          .sort((a, b) => b.time.created - a.time.created)
        setSessions(sorted)
        setIsLoading(false)
        return
      }

      setIsLoading(false)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to load sessions"
      console.error("[SessionContext] Failed to load sessions:", errorMsg)
      setError(new Error(errorMsg))
      setIsLoading(false)
    }
  }, [])

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
        setIsVirtualSession(false)
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
   * Start a new virtual session (not persisted until first message)
   */
  const newVirtual = useCallback(() => {
    const v = createVirtualSession()
    setCurrentSession(v)
    setIsVirtualSession(true)
    return v
  }, [])

  /**
   * Materialize a virtual session into a real session
   * This is called when the user sends their first message
   */
  const materializeSession = useCallback(async () => {
    if (!isVirtualSession) {
      console.log("[SessionContext] Session is already materialized")
      return currentSession
    }

    console.log("[SessionContext] Materializing virtual session...")

    // Create a real session
    const realSession = await createSession()

    if (realSession) {
      console.log("[SessionContext] Virtual session materialized:", realSession.id)
      return realSession
    }

    console.error("[SessionContext] Failed to materialize virtual session")
    return null
  }, [isVirtualSession, currentSession, createSession])

  /**
   * Switch to a different session
   */
  const switchSession = useCallback(
    async (sessionId: string) => {
      console.log("[SessionContext] Switching to session:", sessionId)

      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        setCurrentSession(session)
        setIsVirtualSession(false)
      } else {
        console.warn("[SessionContext] Session not found in local list, fetching...")
        // If not in local list, fetch it
        const response = await sdk.session.get({ path: { id: sessionId } })
        if (response.data) {
          setCurrentSession(response.data)
          setIsVirtualSession(false)
        }
      }
    },
    [sessions],
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
        // Remove from local state
        setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        setReasoning(sessionId, false)

        // If deleting current session, switch to another
        if (currentSession?.id === sessionId) {
          newVirtual()
        }

        return true
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to delete session"
        console.error("[SessionContext] Failed to delete session:", errorMsg)
        setError(new Error(errorMsg))
        return false
      }
    },
    [currentSession, sessions, setReasoning, newVirtual],
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
        // Switch to forked session
        setCurrentSession(response.data)
        setIsVirtualSession(false)
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
        const list = resp.data ?? []
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
      } catch (e) {
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
        await sdk.session.retry({ path: { sessionID: sessionId } })
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
    loadSessions()
  }, [loadSessions])

  // Load session diff when current session changes
  useEffect(() => {
    const sessionId = currentSession?.id
    if (!sessionId || isVirtualSession) return

    const controller = new AbortController()
    const fetchDiff = async () => {
      try {
        const response = await sdk.session.diff({ path: { id: sessionId } })
        if (controller.signal.aborted) return
        if (response.data) {
          setSessionDiffMap((prev) => ({ ...prev, [sessionId]: response.data }))
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("[SessionContext] Failed to load session diff:", err)
        }
      }
    }

    fetchDiff()
    return () => controller.abort()
  }, [currentSession?.id, isVirtualSession])

  // Listen for session events from SSE
  useEffect(() => {
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
          if (!exists) {
            return [updatedSession, ...prev]
          }
          if (exists.title !== updatedSession.title) {
            console.log("[SessionContext] 🎉 Session title CHANGED:", exists.title, "→", updatedSession.title)
          }
          return prev.map((s) => (s.id === updatedSession.id ? updatedSession : s))
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
        setSessions((prev) => prev.filter((s) => s.id !== deletedId))
        setSessionDiffMap((prev) => {
          if (!prev[deletedId]) return prev
          const next = { ...prev }
          delete next[deletedId]
          return next
        })
        const isCurrent = currentSession?.id === deletedId
        if (isCurrent) {
          newVirtual()
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

    const handleSessionDiff = (event: any) => {
      if (event.type !== "session.diff" || !event.properties) return
      const { sessionID, diff } = event.properties as { sessionID: string; diff: FileDiff[] }
      if (!sessionID) return
      setSessionDiffMap((prev) => ({ ...prev, [sessionID]: Array.isArray(diff) ? diff : [] }))
    }

    const unsubscribeCreated = eventEmitter.on("session.created", handleSessionCreated)
    const unsubscribeUpdated = eventEmitter.on("session.updated", handleSessionUpdated)
    const unsubscribeDeleted = eventEmitter.on("session.deleted", handleSessionDeleted)
    const unsubscribeStatus = eventEmitter.on("session.status", handleSessionStatus)
    const unsubscribeDiff = eventEmitter.on("session.diff", handleSessionDiff)

    return () => {
      unsubscribeCreated()
      unsubscribeUpdated()
      unsubscribeDeleted()
      unsubscribeStatus()
      unsubscribeDiff()
    }
  }, [currentSession?.id, setReasoning, setSessionIdle, newVirtual])

  const value: SessionContextState = {
    currentSession,
    setCurrentSession,
    sessions,
    setSessions,
    isCreating,
    isLoading,
    error,
    isIdle,
    setSessionIdle,
    isReasoning,
    setReasoning,
    sessionDiff: sessionDiffMap,
    currentStatus,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    setSelectedModel,
    setSelectedAgent,
    selectedVariant,
    setSelectedVariant,
    selectionRestoreNotice,
    clearSelectionRestoreNotice,
    restoreSelections,
    isVirtualSession,
    newVirtual,
    createSession,
    materializeSession,
    loadSessions,
    switchSession,
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
