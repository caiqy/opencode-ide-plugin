import { useState, useRef, useCallback, type RefObject } from "react"
import { useClickOutsideWithEscape } from "./useClickOutside"

interface UseDropdownOptions {
  /** Additional refs to exclude from click-outside detection (e.g. portal containers) */
  excludeRefs?: RefObject<HTMLElement>[]
}

export function useDropdown(options: UseDropdownOptions = {}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setSearchTerm("")
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
