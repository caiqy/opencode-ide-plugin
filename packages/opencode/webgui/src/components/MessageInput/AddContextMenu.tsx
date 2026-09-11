import { useId, useRef, type ReactNode } from "react"
import { useDropdown } from "../../hooks/useDropdown"

export interface ContextOption {
  id: string
  label: string
  icon: ReactNode
  description?: string
  onClick: () => void | Promise<void>
}

interface AddContextMenuProps {
  onSelectFiles: () => void
  onSelectDirectory: () => void
  disabled?: boolean
  extraOptions?: ContextOption[]
}

export function AddContextMenu({
  onSelectFiles,
  onSelectDirectory,
  disabled = false,
  extraOptions = [],
}: AddContextMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { isOpen, dropdownRef, close, toggle } = useDropdown({ restoreFocusRef: triggerRef })
  const menuId = useId()

  const defaultOptions: ContextOption[] = [
    {
      id: "file",
      label: "文件",
      description: "选择一个或多个本地文件",
      icon: (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
      onClick: onSelectFiles,
    },
    {
      id: "directory",
      label: "文件夹",
      description: "选择本地文件夹/目录",
      icon: (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      ),
      onClick: onSelectDirectory,
    },
  ]

  const allOptions: ContextOption[] = [...defaultOptions, ...extraOptions]

  const focusItem = (index: number) => {
    itemRefs.current[(index + allOptions.length) % allOptions.length]?.focus()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      close()
      return
    }
    const currentFocus = itemRefs.current.findIndex((item) => item === document.activeElement)
    const from = currentFocus === -1 ? 0 : currentFocus
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
      focusItem(allOptions.length - 1)
    }
  }

  return (
    <div className="relative" ref={dropdownRef} data-testid="add-file">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="添加上下文"
        title="添加上下文"
        data-tip="添加上下文"
        data-testid="add-context"
        data-context-file-alias="add-file"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
        </svg>
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label="添加上下文"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-full start-0 z-50 mb-1 min-w-[140px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {allOptions.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              type="button"
              role="menuitem"
              data-testid={`add-context-${option.id}`}
              onClick={async () => {
                close()
                try {
                  await option.onClick()
                } catch (err) {
                  console.error("[AddContextMenu] Option click failed", err)
                }
              }}
              className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-start text-xs last:border-0 hover:bg-gray-100 text-gray-900 dark:border-gray-800 dark:hover:bg-gray-800 dark:text-gray-100"
            >
              <span className="text-gray-500 dark:text-gray-400">{option.icon}</span>
              <span className="font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
