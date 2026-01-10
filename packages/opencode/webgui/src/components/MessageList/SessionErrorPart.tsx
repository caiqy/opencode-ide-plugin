import type { SessionErrorPart as SessionErrorPartType } from "../../types/messages"

interface SessionErrorPartProps {
  part: SessionErrorPartType
}

export function SessionErrorPart({ part }: SessionErrorPartProps) {
  return (
    <div className="modern-card overflow-hidden border-red-200 dark:border-red-900/30">
      <div className="px-3 py-2 bg-red-50 dark:bg-red-900/10 flex items-start gap-2">
        <div className="mt-0.5 text-red-600 dark:text-red-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-red-600 dark:text-red-400 mb-0.5">
            Session Error
          </div>
          <div className="text-sm text-red-700 dark:text-red-300">
            {part.message}
          </div>
        </div>
      </div>
    </div>
  )
}
