import { useState, useRef, useCallback, type RefObject } from "react"
import { useClickOutsideWithEscape } from "./useClickOutside"

interface UseDropdownOptions {
  /** Additional refs to exclude from click-outside detection (e.g. portal containers) */
  excludeRefs?: RefObject<HTMLElement>[]
  /** Restore focus to this element whenever the dropdown closes (e.g. Escape or selecting an item) */
  restoreFocusRef?: RefObject<HTMLElement | null>
}

export function useDropdown(options: UseDropdownOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef(options.restoreFocusRef)
  restoreFocusRef.current = options.restoreFocusRef

  const close = useCallback(() => {
    setIsOpen(false)
    setSearchTerm("")
    restoreFocusRef.current?.current?.focus()
  }, [])

  // Close dropdown when clicking outside or pressing Escape
  useClickOutsideWithEscape(dropdownRef, close, { enabled: isOpen, excludeRefs: options.excludeRefs })

  const toggle = () => setIsOpen((v) => !v)

  return {
    isOpen,
    searchTerm,
    setSearchTerm,
    dropdownRef,
    close,
    toggle,
  }
}
