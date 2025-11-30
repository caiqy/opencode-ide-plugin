export function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-gray-500 dark:text-gray-400">
        <p className="text-lg font-medium mb-2">No messages yet</p>
        <p className="text-sm">Send a message to start the conversation</p>
      </div>
    </div>
  )
}
