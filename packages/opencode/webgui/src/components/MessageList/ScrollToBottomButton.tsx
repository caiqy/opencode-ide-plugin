interface ScrollToBottomButtonProps {
  visible: boolean
  onClick: () => void
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps) {
  return (
    <div className="fixed bottom-24 right-6 z-30 pointer-events-none">
      <button
        type="button"
        aria-label="滚动到底部"
        title="滚动到底部"
        onClick={onClick}
        tabIndex={visible ? 0 : -1}
        className={`flex items-center justify-center w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-100/90 dark:bg-gray-800/90 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 shadow-md transition-opacity duration-200 ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8 3v8.5M4 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
