interface GenericOutputProps {
  output: string
}

export function GenericOutput({ output }: GenericOutputProps) {
  return (
    <div className="px-3 py-1.5">
      <div className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
        <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output}</pre>
      </div>
    </div>
  )
}
