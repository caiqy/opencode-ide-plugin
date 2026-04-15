interface TabBarProps {
  activeTab: "general" | "advanced" | "quick-phrases"
  onTabChange: (tab: "general" | "advanced" | "quick-phrases") => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const all: { id: typeof activeTab; label: string; icon: string }[] = [
    { id: "general", label: "常规", icon: "⚙️" },
    { id: "quick-phrases", label: "快捷短语", icon: "🏷️" },
    { id: "advanced", label: "高级", icon: "🔧" },
  ]

  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex px-4">
        {all.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  )
}
