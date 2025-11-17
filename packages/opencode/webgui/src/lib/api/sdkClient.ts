/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location
 */

import { createOpencodeClient } from "@opencode-ai/sdk/client"

// Create a single SDK client instance with relative baseUrl
// The server runs on the same origin, so we use '/' for relative requests
const baseClient = createOpencodeClient({ baseUrl: "/" })

/**
 * State API response types
 */
interface StateResponse {
  theme?: string
  agent_model?: Record<string, { provider_id: string; model_id: string }>
  provider?: string
  model?: string
  agent?: string
  recently_used_models?: Array<{
    provider_id: string
    model_id: string
    last_used: string // RFC3339 timestamp
  }>
  recently_used_agents?: Array<{
    agent_name: string
    last_used: string // RFC3339 timestamp
  }>
  show_tool_details?: boolean
  show_thinking_blocks?: boolean
}

/**
 * Extended SDK client with state management methods
 * TODO: Remove once SDK is regenerated with Stainless
 */
export const sdk = {
  ...baseClient,
  permissions: {
    respond: async (options: {
      path: { id: string; permissionID: string }
      body: { response: "once" | "always" | "reject" }
    }) => {
      return baseClient.postSessionIdPermissionsPermissionId(options as any)
    },
  },
  state: {
    get: async () => {
      try {
        const response = await fetch("/app/api/state", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })
        if (!response.ok) {
          return { error: { message: "Failed to fetch state" }, data: null }
        }
        const data = (await response.json()) as StateResponse
        return { data, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
    update: async (options: { body: Partial<StateResponse> }) => {
      try {
        const response = await fetch("/app/api/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        })
        if (!response.ok) {
          return { error: { message: "Failed to update state" }, data: null }
        }
        const data = (await response.json()) as StateResponse
        return { data, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
  },
}
