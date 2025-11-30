import { useState, useRef, useCallback } from "react"
import { useClickOutsideWithEscape } from "./useClickOutside"

export function useDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const dropdownRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setSearchTerm("")
  }, [])

  // Close dropdown when clicking outside or pressing Escape
  useClickOutsideWithEscape(dropdownRef, close, { enabled: isOpen })

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
