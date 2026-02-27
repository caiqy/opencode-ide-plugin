import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { loadTheme, saveTheme } from "./repo/themeRepo"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark")
  const [hydrated, setHydrated] = useState(false)
  const touched = useRef(false)

  useEffect(() => {
    let live = true
    void loadTheme().then((value) => {
      if (!live) return
      if (!touched.current && (value === "light" || value === "dark")) {
        setTheme(value)
      }
      setHydrated(true)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }

    if (!hydrated) return
    void saveTheme(theme)
  }, [theme, hydrated])

  const toggleTheme = () => {
    touched.current = true
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
