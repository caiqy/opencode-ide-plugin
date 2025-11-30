interface RevertSummaryProps {
  onRedo: () => void
  onRestore: () => void
  isRevertBusy: boolean
}

export function RevertSummary({ onRedo, onRestore, isRevertBusy }: RevertSummaryProps) {
  return (
    <div className="text-xs px-2 py-1.5 rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <span className="truncate mr-2">Messages and changes after this point are hidden (reverted).</span>
        <div className="flex gap-2">
          <button
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onRedo}
            disabled={isRevertBusy}
          >
            Redo
          </button>
          <button
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onRestore}
            disabled={isRevertBusy}
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  )
}
