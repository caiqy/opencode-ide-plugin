interface BashToolProps {
  command?: string
  output: string
}

export function BashTool({ command, output }: BashToolProps) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
        <pre className="font-mono whitespace-pre-wrap">
          {command && <div className="text-gray-500 dark:text-gray-400 select-all">{`$ ${command}`}</div>}
          <span className="text-gray-700 dark:text-gray-300">{output}</span>
        </pre>
      </div>
    </div>
  )
}
