interface RevertSummaryProps {
  onRedo: () => void
  onRestore: () => void
  isRevertBusy: boolean
}

export function RevertSummary({ onRedo, onRestore, isRevertBusy }: RevertSummaryProps) {
  return (
    <div className="text-xs px-2 py-1.5 rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <span className="truncate mr-2">此处之后的消息与变更已隐藏（已回退）。</span>
        <div className="flex gap-2">
          <button
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onRedo}
            disabled={isRevertBusy}
          >
            重做
          </button>
          <button
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onRestore}
            disabled={isRevertBusy}
          >
            恢复
          </button>
        </div>
      </div>
    </div>
  )
}
