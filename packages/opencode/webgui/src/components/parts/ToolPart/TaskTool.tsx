import { MarkdownRenderer } from "../../MarkdownRenderer"

type Props = {
  text: string
  empty: boolean
}

export function TaskTool({ text, empty }: Props) {
  if (empty) return <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">无可展示内容</div>
  return (
    <div className="px-3 py-1.5 text-xs overflow-x-auto max-h-60 overflow-y-auto">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  )
}
