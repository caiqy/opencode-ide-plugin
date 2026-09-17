import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defineConfig } from "@vscode/test-cli"

// Tests launch a real backend through the extension. Point its data directory at a
// throwaway temp folder so test sessions never land in the user's real opencode database.
const testDataRoot = mkdtempSync(path.join(tmpdir(), "opencode-vscode-test-data-"))

const env = {
  XDG_DATA_HOME: testDataRoot,
  XDG_CACHE_HOME: path.join(testDataRoot, "cache"),
  XDG_CONFIG_HOME: path.join(testDataRoot, "config"),
  XDG_STATE_HOME: path.join(testDataRoot, "state"),
}

export default defineConfig([
  {
    label: "default",
    files: "out/test/**/*.test.js",
    version: "1.74.0",
    workspaceFolder: "./test-fixtures",
    env,
    mocha: {
      ui: "tdd",
      timeout: 20000,
    },
    launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
  },
  // `vscode.lm.tools` only exists on modern VS Code, so the ACP language model
  // tool capability mapping is exercised on a recent host instead of 1.74.0.
  // 1.120.0 exposes the built-in browser tools (with real inputSchema) to the
  // extension host; newer hosts move them behind the agent host in headless runs.
  // Group derivation is covered by the toolGroupFromReference unit test.
  {
    label: "lm-tools",
    files: "out/test/test/suite/webviewController.test.js",
    version: "1.120.0",
    workspaceFolder: "./test-fixtures",
    env,
    mocha: {
      ui: "tdd",
      timeout: 20000,
      grep: "language model tool inputSchema",
    },
    launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
  },
])
