interface ScrollToBottomButtonProps {
  visible: boolean
  onClick: () => void
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps) {
  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="滚动到底部"
      title="滚动到底部"
      onClick={onClick}
      tabIndex={0}
      className="pointer-events-auto flex h-[30px] w-[30px] items-center justify-center rounded-full border border-gray-300 bg-gray-100/90 text-gray-700 shadow-md transition-opacity duration-200 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800/90 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M8 3v8.5M4 8l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
