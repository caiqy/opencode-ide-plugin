import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

const nitroConfig: any = (() => {
  const target = process.env.OPENCODE_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "solid-start-windows-runtime",
      enforce: "pre",
      resolveId(id) {
        // Solid Start injects these paths before Vite can normalize Windows separators.
        if (!id.includes("@solidjsstartdistserver")) return
        if (id.endsWith("server-runtime"))
          return fileURLToPath(new URL("./server-runtime.js", import.meta.resolve("@solidjs/start/server")))
        if (id.endsWith("server-fns-runtime"))
          return fileURLToPath(new URL("./server-fns-runtime.js", import.meta.resolve("@solidjs/start/server")))
      },
    },
    solidStart() as PluginOption,
    {
      name: "solid-start-windows-app-entry",
      config() {
        if (process.platform !== "win32") return
        return {
          define: {
            "import.meta.env.START_APP_ENTRY": JSON.stringify(
              fileURLToPath(new URL("./src/app.tsx", import.meta.url)),
            ),
          },
        }
      },
    },
    nitro({
      ...nitroConfig,
      baseURL: process.env.OPENCODE_BASE_URL,
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3002,
  },
  worker: {
    format: "es",
  },
})
