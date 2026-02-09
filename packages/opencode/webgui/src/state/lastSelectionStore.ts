import { ideBridge } from "../lib/ideBridge"

export const LAST_SELECTION_KEY = "opencode_last_selection_v1"

export interface LastSelectionV1 {
  v: 1
  agent: string | null
  providerId: string | null
  modelId: string | null
  variant: string | null
  updatedAt: number
}

function isNullableString(input: unknown): input is string | null {
  return input === null || typeof input === "string"
}

function parseLastSelection(raw: string): LastSelectionV1 | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object") return null
    if (parsed.v !== 1) return null
    if (!isNullableString(parsed.agent)) return null
    if (!isNullableString(parsed.providerId)) return null
    if (!isNullableString(parsed.modelId)) return null
    if (!isNullableString(parsed.variant)) return null
    if (typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt)) return null

    return {
      v: 1,
      agent: parsed.agent,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      variant: parsed.variant,
      updatedAt: parsed.updatedAt,
    }
  } catch {
    return null
  }
}

export async function loadLastSelectionFromHost(): Promise<LastSelectionV1 | null> {
  if (!ideBridge.isInstalled()) return null

  try {
    const result = await ideBridge.request("storageGet", {
      keys: [LAST_SELECTION_KEY],
    })

    const raw = typeof result.result?.[LAST_SELECTION_KEY] === "string" ? result.result[LAST_SELECTION_KEY] : null
    if (!raw) return null
    return parseLastSelection(raw)
  } catch {
    return null
  }
}

export async function saveLastSelectionToHost(value: LastSelectionV1): Promise<void> {
  if (!ideBridge.isInstalled()) return

  try {
    await ideBridge.request("storageSet", {
      key: LAST_SELECTION_KEY,
      value: JSON.stringify(value),
    })
  } catch (err) {
    console.error("[lastSelectionStore] Failed to save last selection:", err)
  }
}
