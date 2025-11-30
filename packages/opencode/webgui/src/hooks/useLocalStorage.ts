import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react"

/**
 * Error handler for localStorage operations
 */
type ErrorHandler = (error: Error) => void

/**
 * Serializer/deserializer functions for custom types
 */
interface Serializer<T> {
  serialize: (value: T) => string
  deserialize: (value: string) => T
}

/**
 * Options for useLocalStorage hook
 */
interface UseLocalStorageOptions<T> {
  /**
   * Custom serializer/deserializer (default: JSON)
   */
  serializer?: Serializer<T>

  /**
   * Error handler for localStorage operations
   */
  onError?: ErrorHandler

  /**
   * Sync state across tabs/windows (default: false)
   */
  syncAcrossTabs?: boolean
}

const defaultSerializer = {
  serialize: JSON.stringify,
  deserialize: JSON.parse,
}

/**
 * Custom hook for managing localStorage with React state synchronization.
 * Provides automatic serialization, error handling, and optional cross-tab sync.
 *
 * @param key - localStorage key
 * @param initialValue - Initial value if key doesn't exist
 * @param options - Configuration options
 * @returns [value, setValue, removeValue] tuple
 *
 * @example
 * ```tsx
 * const [theme, setTheme, removeTheme] = useLocalStorage("theme", "dark")
 *
 * // Set value
 * setTheme("light")
 *
 * // Remove value (resets to initial value)
 * removeTheme()
 * ```
 *
 * @example
 * ```tsx
 * // With custom serializer
 * const [user, setUser] = useLocalStorage("user", null, {
 *   serializer: {
 *     serialize: (user) => btoa(JSON.stringify(user)),
 *     deserialize: (str) => JSON.parse(atob(str))
 *   }
 * })
 * ```
 *
 * @example
 * ```tsx
 * // With cross-tab synchronization
 * const [count, setCount] = useLocalStorage("count", 0, {
 *   syncAcrossTabs: true
 * })
 * ```
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const { serializer = defaultSerializer, onError, syncAcrossTabs = false } = options

  // Get initial value from localStorage or use initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? serializer.deserialize(item) : initialValue
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Failed to read from localStorage")
      onError?.(err)
      return initialValue
    }
  })

  // Update localStorage when state changes
  const setValue: Dispatch<SetStateAction<T>> = useCallback(
    (value) => {
      try {
        // Allow value to be a function like useState
        const valueToStore = value instanceof Function ? value(storedValue) : value

        // Remove from localStorage if value is null or undefined
        if (valueToStore === null || valueToStore === undefined) {
          window.localStorage.removeItem(key)
          setStoredValue(initialValue)
          return
        }

        setStoredValue(valueToStore)

        // Save to localStorage
        window.localStorage.setItem(key, serializer.serialize(valueToStore))
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Failed to write to localStorage")
        onError?.(err)
      }
    },
    [key, storedValue, serializer, onError, initialValue],
  )

  // Remove value from localStorage
  const removeValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key)
      setStoredValue(initialValue)
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Failed to remove from localStorage")
      onError?.(err)
    }
  }, [key, initialValue, onError])

  // Listen for changes in other tabs/windows
  useEffect(() => {
    if (!syncAcrossTabs) return

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== key || event.storageArea !== window.localStorage) {
        return
      }

      try {
        if (event.newValue === null) {
          setStoredValue(initialValue)
        } else {
          setStoredValue(serializer.deserialize(event.newValue))
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Failed to sync localStorage across tabs")
        onError?.(err)
      }
    }

    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [key, initialValue, serializer, onError, syncAcrossTabs])

  return [storedValue, setValue, removeValue]
}

/**
 * Hook to read a value from localStorage without state management.
 * Useful for one-time reads.
 *
 * @param key - localStorage key
 * @param fallback - Fallback value if key doesn't exist
 * @returns The value from localStorage or fallback
 *
 * @example
 * ```tsx
 * const theme = useLocalStorageValue("theme", "dark")
 * ```
 */
export function useLocalStorageValue<T>(key: string, fallback: T): T {
  try {
    const item = window.localStorage.getItem(key)
    return item ? JSON.parse(item) : fallback
  } catch {
    return fallback
  }
}

/**
 * Hook to check if a localStorage key exists
 *
 * @param key - localStorage key
 * @returns true if key exists, false otherwise
 *
 * @example
 * ```tsx
 * const hasSeenOnboarding = useLocalStorageKey("onboarding_completed")
 * ```
 */
export function useLocalStorageKey(key: string): boolean {
  const [exists, setExists] = useState(() => window.localStorage.getItem(key) !== null)

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key) {
        setExists(event.newValue !== null)
      }
    }

    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [key])

  return exists
}
