import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")

describe("legacy settings page cleanup", () => {
  it("移除了设置中 API 密钥与模型页的残留文件", () => {
    expect(existsSync(path.join(root, "settings", "ModelsTab.tsx"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ModelsTab.test.tsx"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ApiKeysTab", "index.tsx"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ApiKeysTab", "index.test.tsx"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ApiKeysTab", "hooks", "useApiKeys.ts"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ApiKeysTab", "hooks", "useOAuthFlow.ts"))).toBe(false)
    expect(existsSync(path.join(root, "settings", "ApiKeysTab", "hooks", "useProviderManagement.ts"))).toBe(false)
  })
})
