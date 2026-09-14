import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defineConfig } from "@vscode/test-cli"

// Tests launch a real backend through the extension. Point its data directory at a
// throwaway temp folder so test sessions never land in the user's real opencode database.
const testDataRoot = mkdtempSync(path.join(tmpdir(), "opencode-vscode-test-data-"))

export default defineConfig({
  files: "out/test/**/*.test.js",
  version: "1.74.0",
  workspaceFolder: "./test-fixtures",
  env: {
    XDG_DATA_HOME: testDataRoot,
    XDG_CACHE_HOME: path.join(testDataRoot, "cache"),
    XDG_CONFIG_HOME: path.join(testDataRoot, "config"),
    XDG_STATE_HOME: path.join(testDataRoot, "state"),
  },
  mocha: {
    ui: "tdd",
    timeout: 20000,
  },
  launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
})
