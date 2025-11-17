import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    // Apply theme to document root
    console.log("[ThemeProvider] Applying theme:", theme)
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    console.log("[ThemeProvider] document.documentElement.classList:", document.documentElement.classList.toString())
  }, [theme])

  const toggleTheme = () => {
    console.log("[ThemeProvider] Toggle theme called, current:", theme)
    setTheme((prev) => {
      const newTheme = prev === "light" ? "dark" : "light"
      console.log("[ThemeProvider] New theme:", newTheme)
      return newTheme
    })
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
