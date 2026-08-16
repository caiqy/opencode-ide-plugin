import { useDropdown } from "../hooks/useDropdown"

interface VariantSelectorProps {
  variants: string[] | undefined
  selectedVariant: string | undefined
  onSelect: (variant: string | undefined) => void
  disabled?: boolean
  isReasoningModel?: boolean
}

const formatVariantName = (variant: string) => {
  const translated =
    variant === "low"
      ? "低"
      : variant === "medium"
        ? "中"
        : variant === "high"
          ? "高"
          : variant === "none"
            ? "无"
            : variant === "max"
              ? "最大"
              : variant === "xhigh"
                ? "超高"
                : variant === "ultra"
                  ? "极高"
                  : undefined

  if (translated) return translated
  return variant.charAt(0).toUpperCase() + variant.slice(1)
}

export function VariantSelector({
  variants,
  selectedVariant,
  onSelect,
  disabled,
  isReasoningModel,
}: VariantSelectorProps) {
  const { isOpen, dropdownRef, close, toggle } = useDropdown()

  const hasVariants = variants && variants.length > 0
  const isDisabled = disabled || !hasVariants

  const handleSelect = (variant: string | undefined) => {
    onSelect(variant)
    close()
  }

  const getCurrentDisplay = () => {
    if (selectedVariant) return formatVariantName(selectedVariant)
    if (isDisabled && !isReasoningModel) return ""
    return "默认"
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggle}
        disabled={isDisabled}
        className="flex h-6 max-w-24 items-center gap-1 rounded px-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        title="选择推理强度"
        data-tip="选择推理强度"
      >
        <svg className="h-[17px] w-[17px] shrink-0 translate-y-px" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.5 4a3 3 0 0 0-3 3v.2A3.5 3.5 0 0 0 4 10.5a3.5 3.5 0 0 0 2 3.15V14a3 3 0 0 0 5.5 1.65A3 3 0 0 0 17 14v-.35a3.5 3.5 0 0 0 2-3.15 3.5 3.5 0 0 0-2.5-3.3V7a3 3 0 0 0-3-3c-.75 0-1.44.28-2 .75A3 3 0 0 0 9.5 4Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 10.5h.01M15 10.5h.01M10.5 14h3M12 7v7" />
        </svg>
        <span className="truncate">{getCurrentDisplay()}</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          {/* Options list */}
          <div className="overflow-y-auto flex-1">
            {/* Default option */}
            <button
              onClick={() => handleSelect(undefined)}
              className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 ${
                selectedVariant === undefined
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                  : "text-gray-900 dark:text-gray-100"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">默认</span>
                <span className="text-gray-500 dark:text-gray-400">Default</span>
              </span>
              {selectedVariant === undefined && (
                <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            {/* Variant options */}
            {variants?.map((variant) => {
              const isSelected = selectedVariant === variant

              return (
                <button
                  key={variant}
                  onClick={() => handleSelect(variant)}
                  className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                    isSelected
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{formatVariantName(variant)}</span>
                    <span className="text-gray-500 dark:text-gray-400">{variant}</span>
                  </span>
                  {isSelected && (
                    <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
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
        </div>
      )}
    </div>
  )
}
