import { useEffect, useRef } from "react"

interface BashToolProps {
  command?: string
  output: string
}

export function BashTool({ command, output }: BashToolProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [output])

  return (
    <div className="px-3 py-1.5">
      <div ref={scrollRef} className="text-xs overflow-x-auto max-h-60 overflow-y-auto">
        <pre className="font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {command && <div className="text-gray-500 dark:text-gray-400 select-all">{`$ ${command}`}</div>}
          <span className="text-gray-700 dark:text-gray-300">{output}</span>
        </pre>
      </div>
    </div>
  )
}
