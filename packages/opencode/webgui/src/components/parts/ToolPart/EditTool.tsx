interface EditToolProps {
  diff: string
}

export function EditTool({ diff }: EditToolProps) {
  // Filter to only show changed lines (additions, deletions, and hunk headers for context)
  const lines = diff.split("\n")

  return (
    <div className="px-3 py-1.5">
      <div className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
        <pre className="font-mono text-[11px] whitespace-pre leading-[1.6]">
          {lines.map((line, i) => {
            // Skip file-level headers (---, +++, diff, index lines)
            if (
              line.startsWith("---") ||
              line.startsWith("+++") ||
              line.startsWith("diff ") ||
              line.startsWith("index ")
            )
              return null

            if (line.startsWith("+")) {
              return (
                <div key={i} className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                  {line}
                </div>
              )
            }
            if (line.startsWith("-")) {
              return (
                <div key={i} className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 opacity-70">
                  {line}
                </div>
              )
            }
            if (line.startsWith("@@")) {
              return (
                <div key={i} className="text-gray-400 dark:text-gray-500 text-[10px] mt-1">
                  {line}
                </div>
              )
            }
            // Context lines (unchanged)
            return (
              <div key={i} className="text-gray-500 dark:text-gray-500">
                {line || " "}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}
