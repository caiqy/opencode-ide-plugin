import { useCallback, useEffect, useRef, useState } from "react"

interface TabBarProps {
  activeTab: "provider" | "general" | "agents" | "advanced" | "quick-phrases"
  onTabChange: (tab: "provider" | "general" | "agents" | "advanced" | "quick-phrases") => void
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const all: { id: typeof activeTab; label: string; icon: string }[] = [
    { id: "general", label: "常用设置", icon: "⚙️" },
    { id: "provider", label: "Provider 设置", icon: "🔌" },
    { id: "agents", label: "Agent 配置", icon: "🤖" },
    { id: "quick-phrases", label: "快捷短语", icon: "🏷️" },
  ]

  const updateScrollButtons = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 2)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2)
  }, [])

  useEffect(() => {
    updateScrollButtons()
    const el = containerRef.current
    if (!el) return
    el.addEventListener("scroll", updateScrollButtons, { passive: true })
    window.addEventListener("resize", updateScrollButtons)
    return () => {
      el.removeEventListener("scroll", updateScrollButtons)
      window.removeEventListener("resize", updateScrollButtons)
    }
  }, [updateScrollButtons])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const activeBtn = container.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement | null
    if (activeBtn) {
      activeBtn.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "nearest" })
    }
    const timer = setTimeout(updateScrollButtons, 300)
    return () => clearTimeout(timer)
  }, [activeTab, updateScrollButtons])

  const scroll = (direction: "left" | "right") => {
    const el = containerRef.current
    if (!el) return
    const amount = 140
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    })
    setTimeout(updateScrollButtons, 300)
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    if (e.deltaY !== 0 && container.scrollWidth > container.clientWidth) {
      container.scrollLeft += e.deltaY
      updateScrollButtons()
    }
  }

  return (
    <div className="shrink-0 relative flex items-center border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50">
      {/* 左滚动按钮 */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          aria-label="向左滚动标签"
          className="shrink-0 z-10 w-6 h-full flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Tabs 滚动区 */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        className="flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max px-2 sm:px-3 -mb-px">
          {all.map((tab) => (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`shrink-0 whitespace-nowrap px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                  : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
              }`}
            >
              <span className="mr-1 sm:mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 右滚动按钮 */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          aria-label="向右滚动标签"
          className="shrink-0 z-10 w-6 h-full flex items-center justify-center text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.1)]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
