import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"

interface DiffNavigationProps {
  diffs: SnapshotFileDiff[]
  selectedFile: number
  onSelectFile: (index: number) => void
}

export function DiffNavigation({ diffs, selectedFile, onSelectFile }: DiffNavigationProps) {
  if (diffs.length <= 1) {
    return null
  }

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto bg-gray-50 dark:bg-gray-950">
      {diffs.map((diff, index) => (
        <button
          key={index}
          onClick={() => onSelectFile(index)}
          disabled={!diff.file}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
            selectedFile === index
              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-900"
          }`}
          title={diff.file ?? "Unavailable file"}
          data-tip={diff.file ?? "Unavailable file"}
        >
          {diff.file ? diff.file.split("/").pop() || diff.file : "Unavailable file"}
        </button>
      ))}
    </div>
  )
}
