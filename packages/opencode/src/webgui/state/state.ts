import path from "path"
import { Global } from "../../global"
import { z } from "zod"
import TOML from "@iarna/toml"

/**
 * State management for TUI preferences
 * Syncs with ~/.local/state/tui TOML file
 */

export const ModelUsageSchema = z.object({
  provider_id: z.string(),
  model_id: z.string(),
  last_used: z.string(),
})

export const AgentUsageSchema = z.object({
  agent_name: z.string(),
  last_used: z.string(),
})

export const AgentModelSchema = z.object({
  provider_id: z.string(),
  model_id: z.string(),
})

export const StateSchema = z.object({
  theme: z.string().optional(),
  agent_model: z.record(z.string(), AgentModelSchema).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  variant: z.record(z.string(), z.string()).optional(),
  recently_used_models: z.array(ModelUsageSchema).optional(),
  recently_used_agents: z.array(AgentUsageSchema).optional(),
  show_tool_details: z.boolean().optional(),
  show_thinking_blocks: z.boolean().optional(),
})

export type State = z.infer<typeof StateSchema>
export type ModelUsage = z.infer<typeof ModelUsageSchema>
export type AgentUsage = z.infer<typeof AgentUsageSchema>
export type AgentModel = z.infer<typeof AgentModelSchema>

type RawTomlState = { [key: string]: unknown }

const STATE_FILE_PATH = path.join(Global.Path.state, "tui")

function defaultState(): State {
  return {
    theme: "opencode",
    agent: "build",
    agent_model: {},
    recently_used_models: [],
    recently_used_agents: [],
  }
}

/**
 * Read state from TOML file
 */
export async function read(): Promise<State> {
  try {
    const file = Bun.file(STATE_FILE_PATH)
    const exists = await file.exists()

    if (!exists) {
      // Return default state if file doesn't exist
      return defaultState()
    }

    const content = await file.text()

    // Fix unquoted RFC3339 timestamps that Bun.TOML can't parse
    // Replace patterns like: last_used = 2025-11-04T13:25:25.427920869+01:00
    // with: last_used = "2025-11-04T13:25:25.427920869+01:00"
    const fixedContent = content.replace(/(\b(?:last_used)\s*=\s*)(\d{4}-\d{2}-\d{2}T[^\s\n]+)/g, '$1"$2"')

    const parsed = TOML.parse(fixedContent) as unknown

    // Normalize to a plain JSON-serializable object to strip TOML metadata (e.g. symbol keys)
    const plain = JSON.parse(JSON.stringify(parsed))

    // Validate the parsed data (unknown keys are preserved in raw TOML during writes,
    // but stripped from the typed State view)
    const validated = StateSchema.parse(plain)
    return validated
  } catch (error) {
    console.error("Failed to read state file:", error)
    // Return default state on error
    return defaultState()
  }
}

/**
 * Write state to TOML file (merges with existing state)
 */
export async function write(partial: Partial<State>): Promise<void> {
  try {
    const file = Bun.file(STATE_FILE_PATH)
    const exists = await file.exists()

    let raw: RawTomlState

    if (!exists) {
      raw = { ...defaultState() }
    } else {
      const content = await file.text()
      const fixedContent = content.replace(/(\b(?:last_used)\s*=\s*)(\d{4}-\d{2}-\d{2}T[^\s\n]+)/g, '$1"$2"')
      try {
        raw = TOML.parse(fixedContent) as RawTomlState
      } catch (parseError) {
        console.error("Failed to parse state file for write:", parseError)
        raw = { ...defaultState() }
      }
    }

    if (partial.theme !== undefined) {
      ;(raw as any).theme = partial.theme
    }
    if (partial.provider !== undefined) {
      ;(raw as any).provider = partial.provider
    }
    if (partial.model !== undefined) {
      ;(raw as any).model = partial.model
    }
    if (partial.agent !== undefined) {
      ;(raw as any).agent = partial.agent
    }
    if (partial.show_tool_details !== undefined) {
      ;(raw as any).show_tool_details = partial.show_tool_details
    }
    if (partial.show_thinking_blocks !== undefined) {
      ;(raw as any).show_thinking_blocks = partial.show_thinking_blocks
    }
    if (partial.recently_used_models !== undefined) {
      ;(raw as any).recently_used_models = partial.recently_used_models
    }
    if (partial.recently_used_agents !== undefined) {
      ;(raw as any).recently_used_agents = partial.recently_used_agents
    }

    if (partial.agent_model) {
      const existingAgentModel = ((raw as any).agent_model as Record<string, AgentModel> | undefined) || {}
      ;(raw as any).agent_model = { ...existingAgentModel, ...partial.agent_model }
    }

    if (partial.variant) {
      const existingVariant = ((raw as any).variant as Record<string, string> | undefined) || {}
      ;(raw as any).variant = { ...existingVariant, ...partial.variant }
    }

    const toml = TOML.stringify(raw as any)
    await Bun.write(STATE_FILE_PATH, toml)
  } catch (error) {
    console.error("Failed to write state file:", error)
    throw new Error("Failed to write state file")
  }
}
