/// <reference types="node" />

import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { defaultLegacyStorageRoots, scanLegacyStorage } from "./legacyStorageGate"

const tmp: string[] = []

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-storage-gate-"))
  tmp.push(dir)
  return dir
}

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text, "utf8")
}

describe("legacy storage gate", () => {
  afterEach(async () => {
    await Promise.all(tmp.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it("flags legacy symbols in production source", async () => {
    const root = await fixture()
    await write(
      path.join(root, "packages/opencode/webgui/src/state/themeRepo.ts"),
      "export const x = () => globalStateGetJSON('k', 'v')\n",
    )

    const out = await scanLegacyStorage({
      base: root,
      roots: ["packages/opencode/webgui/src"],
    })

    expect(out.length).toBe(1)
    expect(out[0]?.rule).toBe("globalState*")
  })

  it("ignores test paths including Kotlin src/test", async () => {
    const root = await fixture()
    await write(
      path.join(root, "packages/opencode/webgui/src/state/themeRepo.test.ts"),
      "export const x = () => globalStateSetJSON('k', 'v')\n",
    )
    await write(path.join(root, "packages/opencode/webgui/src/test/local.ts"), "export const x = () => sdk.kv\n")
    await write(
      path.join(root, "hosts/vscode-plugin/src/test/suite/bridge.test.ts"),
      "export const x = () => uiSetState\n",
    )
    await write(
      path.join(root, "hosts/jetbrains-plugin/src/test/kotlin/paviko/opencode/ui/FooTest.kt"),
      'val x = "kv.update"\n',
    )

    const out = await scanLegacyStorage({
      base: root,
      roots: ["packages/opencode/webgui/src", "hosts/vscode-plugin/src", "hosts/jetbrains-plugin/src"],
    })

    expect(out).toEqual([])
  })

  it("repo production source has zero legacy symbols", async () => {
    const base = path.resolve(process.cwd(), "../../..")
    const out = await scanLegacyStorage({
      base,
      roots: defaultLegacyStorageRoots(),
    })
    expect(out).toEqual([])
  })
})
