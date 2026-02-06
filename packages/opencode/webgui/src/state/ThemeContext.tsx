import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useLocalStorage } from "../hooks/useLocalStorage"
import { ideBridge } from "../lib/ideBridge"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocalStorage<Theme>("oc-webgui-theme", systemTheme())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const sync = async () => {
      if (!ideBridge.isInstalled()) {
        setHydrated(true)
        return
      }

      const local = window.localStorage.getItem("oc-webgui-theme")
      const reply = await ideBridge.request("storageGet", {
        keys: ["oc-webgui-theme"],
      })
      const host = typeof reply.result?.["oc-webgui-theme"] === "string" ? reply.result["oc-webgui-theme"] : null

      if (host === "light" || host === "dark") {
        setTheme(host)
        setHydrated(true)
        return
      }

      if (local === "light" || local === "dark") {
        await ideBridge.request("storageSet", {
          key: "oc-webgui-theme",
          value: local,
        })
      }

      setHydrated(true)
    }

    sync()
  }, [setTheme])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }

    if (!hydrated || !ideBridge.isInstalled()) {
      return
    }

    ideBridge.request("storageSet", {
      key: "oc-webgui-theme",
      value: theme,
    })
  }, [theme, hydrated])

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"))
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
