import { defineConfig, type UserConfig, type ProxyOptions } from "vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "fs"
import { resolve } from "path"
import { BackendDiscoveryError, discoverBackend } from "./dev/discoverBackend"

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"))

const proxyRoots = [
  "/generated-image",
  "/app/generated-image",
  "/global",
  "/session",
  "/config",
  "/project",
  "/provider",
  "/sync",
  "/mcp",
  "/permission",
  "/question",
  "/tui",
  "/command",
  "/agent",
  "/skill",
  "/path",
  "/lsp",
  "/formatter",
  "/event",
  "/pty",
  "/experimental",
  "/auth",
  "/vcs",
]

function devDirectoryOverride() {
  const value = process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE?.trim()
  return value ? value : null
}

function proxyEntry(
  root: string,
  backendUrl: string,
  directoryOverride: string | null,
): readonly [string, ProxyOptions] {
  return [
    root,
    {
      target: backendUrl,
      changeOrigin: true,
      ws: root === "/event" || root === "/pty",
      configure(proxy) {
        if (!directoryOverride) return
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader("x-opencode-directory", directoryOverride)
        })
      },
    },
  ] as const
}

function formatDiscoveryError(error: BackendDiscoveryError) {
  return [
    "[webgui] No running opencode backend found on localhost.",
    ...error.attempts.map((item) => `- ${item.url}: ${item.reason} (${item.detail})`),
    "[webgui] Start opencode backend first, then retry Vite dev.",
  ].join("\n")
}

function viteCommand() {
  return process.argv.includes("build") ? "build" : "serve"
}

function viteMode() {
  const index = process.argv.indexOf("--mode")
  if (index >= 0) {
    return process.argv[index + 1] ?? "development"
  }
  return viteCommand() === "serve" ? "development" : "production"
}

// https://vite.dev/config/
const command = viteCommand()
const mode = viteMode()

const shared: UserConfig = {
  plugins: [react()],
  base: "/app",
  build: {
    outDir: "../webgui-dist",
    emptyOutDir: true,
    minify: mode === "development" ? false : "esbuild",
    sourcemap: mode === "development" ? true : false,
  },
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production"),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __OPENCODE_BACKEND_URL__: JSON.stringify(undefined),
  },
}

let config: UserConfig = shared

if (command === "serve") {
  try {
    const backend = await discoverBackend()
    const directoryOverride = devDirectoryOverride()
    console.log(`[webgui] Using opencode backend ${backend.url}`)

    config = {
      ...shared,
      define: {
        ...shared.define,
        __OPENCODE_BACKEND_URL__: JSON.stringify(backend.url),
      },
      server: {
        proxy: Object.fromEntries(proxyRoots.map((root) => proxyEntry(root, backend.url, directoryOverride))),
      },
    }
  } catch (error) {
    if (error instanceof BackendDiscoveryError) {
      throw new Error(formatDiscoveryError(error))
    }
    throw error
  }
}

export default defineConfig(config)
