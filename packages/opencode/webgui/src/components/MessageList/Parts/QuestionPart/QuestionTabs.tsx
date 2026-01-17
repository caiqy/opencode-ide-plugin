import { cn } from "../../../../utils/classNames"

interface QuestionTabsProps {
  tabs: Array<{ header: string; answered: boolean }>
  activeTab: number
  onTabChange: (index: number) => void
  showConfirm: boolean
}

export function QuestionTabs({ tabs, activeTab, onTabChange, showConfirm }: QuestionTabsProps) {
  const isConfirmTab = activeTab === tabs.length

  return (
    <div className="flex flex-row gap-1 px-3 py-2 border-b border-[#e4e9f2] dark:border-gray-800 bg-[#f8fafc] dark:bg-gray-900/50">
      {tabs.map((tab, index) => {
        const isActive = index === activeTab
        return (
          <button
            key={index}
            onClick={() => onTabChange(index)}
            className={cn(
              "px-2 py-1 text-xs rounded transition-colors",
              isActive
                ? "bg-blue-600 text-white"
                : tab.answered
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            )}
          >
            {tab.header}
            {tab.answered && !isActive && <span className="ml-1 text-green-600 dark:text-green-400">✓</span>}
          </button>
        )
      })}
      {showConfirm && (
        <button
          onClick={() => onTabChange(tabs.length)}
          className={cn(
            "px-2 py-1 text-xs rounded transition-colors",
            isConfirmTab
              ? "bg-blue-600 text-white"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
          )}
        >
          Confirm
        </button>
      )}
    </div>
  )
}
