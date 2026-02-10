interface WriteToolProps {
  content: string
  filePath: string
}

export function WriteTool({ content }: WriteToolProps) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
        <pre className="font-mono text-[11px] whitespace-pre leading-[1.6]">
          {content.split("\n").map((line, i) => (
            <div key={i} className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
              {`+${line}` || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
