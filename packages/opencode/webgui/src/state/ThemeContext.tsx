import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useLocalStorage } from "../hooks/useLocalStorage"
import { ideBridge } from "../lib/ideBridge"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 默认主题：暗色（若用户曾手动切换，会以 oc-webgui-theme 已保存值为准）
  const [theme, setTheme] = useLocalStorage<Theme>("oc-webgui-theme", "dark")
  const [hydrated, setHydrated] = useState(false)
  const setThemeRef = useRef(setTheme)
  const userTouchedRef = useRef(false)

  useEffect(() => {
    setThemeRef.current = setTheme
  }, [setTheme])

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
        // 若用户在 host 同步完成前已手动切换，则不覆盖用户选择
        if (!userTouchedRef.current) {
          setThemeRef.current(host)
        }
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
  }, [])

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
    userTouchedRef.current = true
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
