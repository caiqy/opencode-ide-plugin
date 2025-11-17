interface AgentPartProps {
  part: {
    id: string
    type: "agent"
    name: string
    source?: {
      value: string
      start: number
      end: number
    }
  }
}

export function AgentPart({ part }: AgentPartProps) {
  // Agent parts are typically inline references in user messages
  // They don't need expansion, just a visual indicator
  return (
    <span className="inline-flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded px-1.5 py-0.5 text-xs font-medium">
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      <span>{part.name}</span>
    </span>
  )
}
