import { useState, useEffect, useCallback, useRef } from "react"

export interface UseMentionNavigationOptions {
  itemCount: number
  onSelect: (index: number) => void
  onClose: () => void
  isOpen: boolean
}

export interface UseMentionNavigationResult {
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  listRef: React.RefObject<HTMLDivElement | null>
}

export function useMentionNavigation({
  itemCount,
  onSelect,
  onClose,
  isOpen,
}: UseMentionNavigationOptions): UseMentionNavigationResult {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [itemCount])

  // Scroll selected item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return

    const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    }
  }, [selectedIndex, isOpen])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isOpen) return

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          if (itemCount <= 0) return
          setSelectedIndex((prev) => (prev + 1) % itemCount)
          break

        case "ArrowUp":
          event.preventDefault()
          if (itemCount <= 0) return
          setSelectedIndex((prev) => (prev - 1 + itemCount) % itemCount)
          break

        case "Enter":
        case "Tab":
          event.preventDefault()
          if (itemCount <= 0) return
          onSelect(selectedIndex)
          break

        case "Escape":
          event.preventDefault()
          onClose()
          break
      }
    },
    [isOpen, itemCount, selectedIndex, onSelect, onClose],
  )

  // Attach keyboard event listener
  useEffect(() => {
    if (!isOpen) return

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  return {
    selectedIndex,
    setSelectedIndex,
    listRef,
  }
}
