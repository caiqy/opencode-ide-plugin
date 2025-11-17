/**
 * Typing indicator component
 *
 * Shows animated dots while the assistant is generating a response.
 * Follows the compact UI design pattern with theme support.
 */

interface TypingIndicatorProps {
  /** Whether the indicator should be visible */
  visible: boolean
}

export function TypingIndicator({ visible }: TypingIndicatorProps) {
  return (
    <div className="my-1 h-4">
      {visible && (
        <button className="relative inline-flex items-center gap-0.5 pr-4 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
          <span className="leading-none">Generating</span>
          <div className="flex gap-0.5">
            <div
              className="w-0.5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0ms", animationDuration: "1s" }}
            />
            <div
              className="w-0.5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "200ms", animationDuration: "1s" }}
            />
            <div
              className="w-0.5 h-0.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "400ms", animationDuration: "1s" }}
            />
          </div>
        </button>
      )}
    </div>
  )
}
