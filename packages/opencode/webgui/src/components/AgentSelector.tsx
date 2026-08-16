import { useState, useEffect } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Agent } from "@opencode-ai/sdk/client"
import { useDropdown } from "../hooks/useDropdown"

interface AgentSelectorProps {
  selectedAgent?: string
  onSelect: (agentName: string) => void | Promise<void>
  disabled?: boolean
}

export function AgentSelector({ selectedAgent, onSelect, disabled }: AgentSelectorProps) {
  const { isOpen, searchTerm, setSearchTerm, dropdownRef, close, toggle } = useDropdown()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load agents on mount
  useEffect(() => {
    let active = true

    async function loadAgents() {
      setIsLoading(true)
      try {
        const response = await sdk.app.agents()

        if (!active) return

        if (response.error) {
          console.error("[AgentSelector] Failed to load agents:", response.error)
          setIsLoading(false)
          return
        }

        if (response.data) {
          // Filter agents to only show 'primary' and 'all' modes (not 'subagent') and hide 'hidden' agents
          const filteredAgents = response.data.filter((agent: any) => agent.mode !== "subagent" && !agent.hidden)
          setAgents(filteredAgents)
        }
      } catch (err) {
        if (active) {
          console.error("[AgentSelector] Failed to load agents:", err)
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    loadAgents()
    return () => {
      active = false
    }
  }, [])

  const cap = (name: string) => {
    if (!name) return ""
    return name[0].toUpperCase() + name.slice(1)
  }

  // Get current selection display
  const getCurrentDisplay = () => {
    if (!selectedAgent) {
      // Use first available agent or fallback to 'build'
      return agents.length > 0 ? cap(agents[0].name) : "Build"
    }

    const agent = agents.find((a) => a.name === selectedAgent)
    return agent ? cap(agent.name) : cap(selectedAgent)
  }

  const handleSelect = async (agentName: string) => {
    await onSelect(agentName)
    close()
  }

  // Filter agents based on search term
  const filteredAgents = agents.filter((agent) => {
    if (!searchTerm) return true
    const lowerSearch = searchTerm.toLowerCase()
    return (
      agent.name.toLowerCase().includes(lowerSearch) ||
      (agent.description && agent.description.toLowerCase().includes(lowerSearch))
    )
  })

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={toggle}
        disabled={disabled || isLoading}
        className="flex h-6 max-w-28 items-center gap-1 rounded px-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        title="选择智能体"
        data-tip="选择智能体"
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="8" width="16" height="12" rx="2" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8V4m-4 10h.01M16 14h.01M9 18h6" />
        </svg>
        <span className="truncate">{getCurrentDisplay()}</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          {/* Search input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索智能体…"
              className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Agents list */}
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">正在加载智能体…</div>
            ) : filteredAgents.length === 0 ? (
              <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                {searchTerm ? "未找到智能体" : "暂无可用智能体"}
              </div>
            ) : (
              filteredAgents.map((agent) => {
                const isSelected = selectedAgent === agent.name

                return (
                  <button
                    key={agent.name}
                    onClick={() => handleSelect(agent.name)}
                    className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{cap(agent.name)}</span>
                        {agent.builtIn && (
                          <span className="px-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] rounded">
                            内置
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">
                          {agent.description}
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
