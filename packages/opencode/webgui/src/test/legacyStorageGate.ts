/// <reference types="node" />

import fs from "fs/promises"
import path from "path"

type Rule = {
  id: string
  rx: RegExp
}

export type LegacyStorageViolation = {
  file: string
  line: number
  rule: string
  text: string
}

const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".kt", ".kts"])

const rules: Rule[] = [
  {
    id: "globalState*",
    rx: /\bglobalStateGetJSON\b|\bglobalStateSetJSON\b|\bglobalStateGet\b|\bglobalStateSet\b/,
  },
  {
    id: "sdk.kv/sdk.model",
    rx: /\bsdk\.(kv|model)\b/,
  },
  {
    id: "legacy host storage message",
    rx: /\buiGetState\b|\buiSetState\b|\bkv\.(get|update)\b|\bmodel\.(get|update)\b/,
  },
  {
    id: "legacy storage key",
    rx: /\bopencode_webgui_state_v1\b|\bopencode_favorite_models_v1\b/,
  },
]

function prod(file: string) {
  const norm = file.split(path.sep).join("/")
  if (!exts.has(path.extname(norm))) return false
  if (norm.includes("/src/test/")) return false
  if (norm.includes("/src/unitTest/")) return false
  if (norm.includes("/__tests__/")) return false
  const name = path.basename(norm)
  if (/\.test\.[^.]+$/.test(name)) return false
  if (/\.spec\.[^.]+$/.test(name)) return false
  return true
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const chunks = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(file)
      if (entry.isFile()) return [file]
      return []
    }),
  )
  return chunks.flat()
}

function match(line: string) {
  return rules.find((rule) => rule.rx.test(line))
}

export function defaultLegacyStorageRoots() {
  return ["packages/opencode/webgui/src", "hosts/vscode-plugin/src", "hosts/jetbrains-plugin/src"]
}

export async function scanLegacyStorage(input: { base: string; roots: string[] }): Promise<LegacyStorageViolation[]> {
  const dirs = input.roots.map((root) => path.resolve(input.base, root))
  const files = (await Promise.all(dirs.map((dir) => walk(dir)))).flat().filter(prod).sort()

  const out: LegacyStorageViolation[] = []
  for (const file of files) {
    const text = await fs.readFile(file, "utf8")
    const rel = path.relative(input.base, file).split(path.sep).join("/")
    text.split(/\r?\n/).forEach((line, idx) => {
      const rule = match(line)
      if (!rule) return
      out.push({ file: rel, line: idx + 1, rule: rule.id, text: line.trim() })
    })
  }
  return out
}
