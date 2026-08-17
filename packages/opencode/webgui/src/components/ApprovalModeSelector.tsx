import { useId, useRef, useEffect } from "react"
import { useDropdown } from "../hooks/useDropdown"
import type { ApprovalMode } from "../state/approval"

const modes = [
  { value: "manual", label: "手动审批" },
  { value: "automatic", label: "自动审批" },
  { value: "full", label: "完全访问" },
] as const

interface ApprovalModeSelectorProps {
  value: ApprovalMode
  onSelect: (mode: ApprovalMode) => void
  disabled?: boolean
}

export function ApprovalModeSelector({ value, onSelect, disabled }: ApprovalModeSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { isOpen, dropdownRef, close, toggle } = useDropdown({ restoreFocusRef: triggerRef })
  const current = modes.find((mode) => mode.value === value) ?? modes[0]
  const menuId = useId()
  const selectedIndex = Math.max(modes.findIndex((mode) => mode.value === value), 0)

  // Focus the selected item when the menu opens
  useEffect(() => {
    if (!isOpen) return
    itemRefs.current[selectedIndex]?.focus()
  }, [isOpen, selectedIndex])

  const focusItem = (index: number) => {
    itemRefs.current[(index + modes.length) % modes.length]?.focus()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      close()
      return
    }
    const currentFocus = itemRefs.current.findIndex((item) => item === document.activeElement)
    const from = currentFocus === -1 ? selectedIndex : currentFocus
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      itemRefs.current[from]?.click()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusItem(from + 1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      focusItem(from - 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusItem(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusItem(modes.length - 1)
    }
  }

  return (
    <div className="relative" ref={dropdownRef} data-testid="auto-approve">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex h-6 max-w-28 items-center gap-1 rounded px-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        title="选择审批模式"
        data-tip="选择审批模式"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 5-3.5 8.4-7 10-3.5-1.6-7-5-7-10V6l7-3z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 12 2 2 4-4" />
        </svg>
        <span className="truncate">{current.label}</span>
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label="审批模式"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-full start-0 z-50 mb-1 min-w-[180px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {modes.map((mode, index) => {
            const selected = mode.value === value
            return (
              <button
                key={mode.value}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  onSelect(mode.value)
                  close()
                }}
                className={`flex w-full items-center justify-between border-b border-gray-100 px-3 py-2.5 text-start text-xs last:border-0 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                  selected
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                    : "text-gray-900 dark:text-gray-100"
                }`}
              >
                <span className="font-medium">{mode.label}</span>
                {selected && (
                  <svg className="ms-2 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
