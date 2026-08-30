interface TabBarProps {
  activeTab: "provider" | "general" | "agents" | "advanced" | "quick-phrases"
  onTabChange: (tab: "provider" | "general" | "agents" | "advanced" | "quick-phrases") => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const all: { id: typeof activeTab; label: string; icon: string }[] = [
    { id: "general", label: "常用设置", icon: "⚙️" },
    { id: "provider", label: "Provider 设置", icon: "🔌" },
    { id: "agents", label: "Agent 配置", icon: "🤖" },
    { id: "quick-phrases", label: "快捷短语", icon: "🏷️" },
  ]

  return (
    <div className="overflow-x-auto border-b border-gray-200 [scrollbar-width:none] dark:border-gray-800 [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max px-4">
        {all.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
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
