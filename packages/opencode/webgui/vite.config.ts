import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "fs"
import { resolve } from "path"

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"))

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
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
  },
}))
