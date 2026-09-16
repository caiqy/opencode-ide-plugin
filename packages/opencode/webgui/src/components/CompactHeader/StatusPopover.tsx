import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useClickOutside } from "../../hooks/useClickOutside"
import {
  DEFAULT_STATUS_TAB,
  STATUS_TABS,
  buildAcpView,
  buildLspView,
  buildMcpView,
  buildPluginView,
  buildServerView,
  buildSkillView,
  type Tab,
} from "./status"
import { useStatusPopoverData } from "./useStatusPopoverData"

interface StatusPopoverProps {
  open: boolean
  connectionState: ConnectionState
  onClose: () => void
  triggerRef?: RefObject<HTMLElement | null>
}

function stamp(value: number | null) {
  if (!value) return null
  return new Date(value).toLocaleString()
}

function nextTab(tab: Tab, dir: 1 | -1) {
  const list = STATUS_TABS.map((item) => item.id)
  const idx = list.indexOf(tab)
  return list[(idx + dir + list.length) % list.length] ?? DEFAULT_STATUS_TAB
}

export function StatusPopover({ open, connectionState, onClose, triggerRef }: StatusPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>(DEFAULT_STATUS_TAB)
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState<Record<string, string>>({})
  const [expandedSkills, setExpandedSkills] = useState<Record<string, boolean>>({})
  const data = useStatusPopoverData({ open, connectionState })
  const refs = triggerRef ? ([triggerRef] as unknown as RefObject<HTMLElement>[]) : []

  const close = useCallback(
    (focus = true) => {
      onClose()
      if (focus) queueMicrotask(() => triggerRef?.current?.focus())
    },
    [onClose, triggerRef],
  )

  useClickOutside(ref, () => close(false), {
    enabled: open,
    excludeRefs: refs,
  })

  useEffect(() => {
    if (!open) return
    setTab(DEFAULT_STATUS_TAB)
    setShow({})
    setSearch({})
  }, [open])

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => document.getElementById(`status-tab-${DEFAULT_STATUS_TAB}`)?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [close, open])

  const servers = useMemo(() => buildServerView(data.servers), [data.servers])
  const mcp = useMemo(() => buildMcpView(data.mcp), [data.mcp])
  const acp = useMemo(
    () =>
      buildAcpView(
        data.acp ?? {
          state: "ready",
          data: { installed: false, categories: [] },
          error: null,
          updatedAt: null,
        },
      ),
    [data.acp],
  )
  const lsp = useMemo(() => buildLspView(data.lsp), [data.lsp])
  const plugins = useMemo(() => buildPluginView(data.plugins), [data.plugins])
  const skills = useMemo(() => buildSkillView(data.skills), [data.skills])

  if (!open) return null

  const mcpQuery = (search.mcp || "").trim().toLowerCase()
  const filteredMcpItems = mcp.items.filter((item) => {
    if (!mcpQuery) return true
    if (item.name.toLowerCase().includes(mcpQuery)) return true
    if (item.description && item.description.toLowerCase().includes(mcpQuery)) return true
    return item.tools.some(
      (t) =>
        t.name.toLowerCase().includes(mcpQuery) ||
        (t.description && t.description.toLowerCase().includes(mcpQuery)),
    )
  })

  const acpQuery = (search.acp || "").trim().toLowerCase()
  const filteredAcpCategories = acp.categories.filter((cat) => {
    if (!acpQuery) return true
    if (cat.name.toLowerCase().includes(acpQuery)) return true
    if (cat.description && cat.description.toLowerCase().includes(acpQuery)) return true
    return cat.tools.some(
      (t) =>
        t.name.toLowerCase().includes(acpQuery) ||
        (t.description && t.description.toLowerCase().includes(acpQuery)),
    )
  })

  const skillsQuery = (search.skills || "").trim().toLowerCase()
  const filteredSkillItems = skills.items.filter((item) => {
    if (!skillsQuery) return true
    if (item.name.toLowerCase().includes(skillsQuery)) return true
    if (item.description && item.description.toLowerCase().includes(skillsQuery)) return true
    return false
  })

  return (
    <div
      ref={ref}
      id="status-popover"
      role="dialog"
      aria-label="状态面板"
      className="modern-card absolute left-2 right-2 top-full z-50 mt-1.5 flex max-h-[72vh] flex-col overflow-hidden rounded-xl border border-gray-200/80 shadow-2xl backdrop-blur-md dark:border-gray-800/80 dark:bg-gray-950/95"
    >
      <div
        className="border-b border-gray-200/80 bg-gray-50/70 px-2 py-1.5 dark:border-gray-800/80 dark:bg-gray-900/60"
        role="tablist"
        aria-label="状态标签页"
      >
        <div className="grid grid-cols-6 gap-1">
          {STATUS_TABS.map((item) => {
            const active = item.id === tab
            return (
              <button
                key={item.id}
                id={`status-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`status-panel-${item.id}`}
                tabIndex={active ? 0 : -1}
                className={`truncate rounded-md px-1.5 py-1 text-center text-xs font-medium transition-all ${
                  active
                    ? "bg-gray-900 text-white shadow-sm dark:bg-gray-100 dark:text-gray-900"
                    : "text-gray-600 hover:bg-gray-200/60 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-100"
                }`}
                onClick={() => setTab(item.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
                  e.preventDefault()
                  const id = nextTab(item.id, e.key === "ArrowRight" ? 1 : -1)
                  setTab(id)
                  queueMicrotask(() => document.getElementById(`status-tab-${id}`)?.focus())
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <div data-testid="status-scroll" className="min-h-0 overflow-y-auto">
        <Panel tab={tab} id="servers">
          <div className="space-y-2 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox
              state={servers.state}
              error={servers.error}
              updatedAt={servers.updatedAt}
              onRetry={data.refreshAll}
            />
            <div>SSE 连接：{servers.summary.connection}</div>
            {servers.summary.backendUrl ? <div>后端地址：{servers.summary.backendUrl}</div> : null}
            <div>IDE bridge：{servers.summary.bridge.ready ? "ready" : "not ready"}</div>
            <div>路径：{servers.summary.directory ?? servers.summary.worktree ?? "未知"}</div>
          </div>
        </Panel>

        <Panel tab={tab} id="mcp">
          <div className="space-y-2.5 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900 dark:text-gray-100">MCP 服务</span>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-0.5 text-xs text-blue-600 transition hover:bg-blue-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-800 disabled:text-gray-400"
                disabled={data.mcpRefreshing}
                onClick={() => void data.refreshMcp()}
              >
                {data.mcpRefreshing ? "刷新中..." : mcp.refreshLabel}
              </button>
            </div>

            <SearchInput
              value={search.mcp || ""}
              placeholder="搜索 MCP 服务或子工具..."
              onChange={(val) => setSearch((prev) => ({ ...prev, mcp: val }))}
            />

            <StateBox state={mcp.state} error={mcp.error} updatedAt={mcp.updatedAt} />

            {filteredMcpItems.length === 0 && mcp.items.length > 0 ? (
              <div className="py-3 text-center text-gray-400">无匹配的 MCP 服务</div>
            ) : null}

            {filteredMcpItems.map((item) => {
              const matchesSubtool =
                Boolean(mcpQuery) &&
                item.tools.some(
                  (t) =>
                    t.name.toLowerCase().includes(mcpQuery) ||
                    (t.description && t.description.toLowerCase().includes(mcpQuery)),
                )
              const on = matchesSubtool || show[item.name] === true
              const activeCount = item.tools.filter((t) => t.enabled).length
              const totalCount = item.tools.length

              return (
                <div
                  key={item.name}
                  className="rounded-lg border border-gray-200/80 bg-white/40 p-2.5 transition-all dark:border-gray-800/80 dark:bg-gray-900/30"
                >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                          <StatusBadge status={item.status} />
                          {totalCount > 0 ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              {activeCount}/{totalCount} 启用
                            </span>
                          ) : null}
                        </div>
                        {item.description ? (
                          <p className="text-[11px] text-gray-500 line-clamp-2 dark:text-gray-400">
                            {item.description}
                          </p>
                        ) : null}
                        {item.reason ? (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400">{item.reason}</span>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2 pt-0.5">
                        {totalCount > 0 ? (
                          <button
                            type="button"
                            className="whitespace-nowrap text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            aria-label={`${on ? "收起" : "展开"}工具 ${item.name}`}
                            aria-expanded={on}
                            onClick={() =>
                              setShow((prev) => ({
                                ...prev,
                                [item.name]: !(prev[item.name] === true),
                              }))
                            }
                          >
                            {on ? "收起" : "展开"}
                          </button>
                        ) : null}
                        <Switch
                          label={`切换 ${item.name}`}
                          checked={item.enabled}
                          disabled={item.disabled || data.mcpBusy[item.name] === true}
                          loading={data.mcpBusy[item.name] === true}
                          onToggle={() => void data.toggleMcp(item.name)}
                        />
                      </div>
                    </div>

                    {on && totalCount > 0 ? (
                      <div className="mt-2.5 space-y-2 border-l-2 border-gray-200 pl-3 pt-1 dark:border-gray-800">
                        {item.tools.map((tool) => {
                          const busy = data.mcpToolBusy[item.name]?.[tool.id] === true
                          return (
                            <div key={tool.id} className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                                  {tool.name}
                                </span>
                                {tool.description ? (
                                  <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                    {tool.description}
                                  </p>
                                ) : null}
                              </div>
                            <Switch
                              label={`切换 ${tool.name}`}
                              checked={tool.enabled}
                              disabled={busy}
                              loading={busy}
                              onToggle={() => {
                                void (async () => {
                                  await data.toggleTool(item.name, tool.id, !tool.enabled)
                                })()
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel tab={tab} id="acp">
          <div className="space-y-2.5 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">ACP 宿主能力</span>
                <span className="ml-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  Agent Client Protocol
                </span>
              </div>
              {acp.installed && data.refreshAcp ? (
                <button
                  type="button"
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-blue-600 transition hover:bg-blue-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-800"
                  onClick={() => void data.refreshAcp?.()}
                >
                  刷新
                </button>
              ) : null}
            </div>

            <SearchInput
              value={search.acp || ""}
              placeholder="搜索 ACP 宿主能力或子工具..."
              onChange={(val) => setSearch((prev) => ({ ...prev, acp: val }))}
            />

            <StateBox state={acp.state} error={acp.error} updatedAt={acp.updatedAt} />

            {!acp.installed ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <div className="mb-1 text-base">🔌</div>
                <div className="font-medium text-gray-700 dark:text-gray-200">未连接 IDE 宿主</div>
                <div className="mt-1">{acp.fallbackNote}</div>
              </div>
            ) : (
              <>
                {filteredAcpCategories.length === 0 && acp.categories.length > 0 ? (
                  <div className="py-3 text-center text-gray-400">无匹配的 ACP 宿主能力</div>
                ) : null}

                {filteredAcpCategories.map((cat) => {
                  const matchesSubtool =
                    Boolean(acpQuery) &&
                    cat.tools.some(
                      (t) =>
                        t.name.toLowerCase().includes(acpQuery) ||
                        (t.description && t.description.toLowerCase().includes(acpQuery)),
                    )
                  const on = matchesSubtool || show[cat.id] === true
                  const activeToolsCount = cat.tools.filter((t) => t.enabled).length
                  const totalToolsCount = cat.tools.length
                  const isCatBusy = data.acpBusy?.[cat.id] === true

                  return (
                    <div
                      key={cat.id}
                      className="rounded-lg border border-gray-200/80 bg-white/40 p-2.5 transition-all dark:border-gray-800/80 dark:bg-gray-900/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{cat.name}</span>
                            <StatusBadge status={cat.status} />
                            {totalToolsCount > 0 ? (
                              <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                {activeToolsCount}/{totalToolsCount} 启用
                              </span>
                            ) : null}
                          </div>
                          {cat.description ? (
                            <p className="text-[11px] text-gray-500 line-clamp-2 dark:text-gray-400">
                              {cat.description}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                          {totalToolsCount > 0 ? (
                            <button
                              type="button"
                              className="whitespace-nowrap text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              aria-label={`${on ? "收起" : "展开"}工具 ${cat.name}`}
                              aria-expanded={on}
                              onClick={() =>
                                setShow((prev) => ({
                                  ...prev,
                                  [cat.id]: !(prev[cat.id] === true),
                                }))
                              }
                            >
                              {on ? "收起" : "展开"}
                            </button>
                          ) : null}
                          <Switch
                            label={`切换 ${cat.name}`}
                            checked={cat.enabled}
                            disabled={isCatBusy}
                            loading={isCatBusy}
                            onToggle={() => void data.toggleAcpCategory?.(cat.id)}
                          />
                        </div>
                      </div>

                      {on && totalToolsCount > 0 ? (
                        <div className="mt-2.5 space-y-2 border-l-2 border-gray-200 pl-3 pt-1 dark:border-gray-800">
                          {cat.tools.map((tool) => {
                            const isToolBusy = data.acpToolBusy?.[cat.id]?.[tool.id] === true
                            return (
                              <div key={tool.id} className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                                    {tool.name}
                                  </span>
                                  {tool.description ? (
                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                      {tool.description}
                                    </p>
                                  ) : null}
                                </div>
                                <Switch
                                  label={`切换 ${tool.name}`}
                                  checked={tool.enabled}
                                  disabled={!cat.enabled || isToolBusy}
                                  loading={isToolBusy}
                                  onToggle={() =>
                                    void data.toggleAcpTool?.(cat.id, tool.id, !tool.enabled)
                                  }
                                />
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </Panel>

        <Panel tab={tab} id="lsp">
          <div className="space-y-2 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox state={lsp.state} error={lsp.error} updatedAt={lsp.updatedAt} onRetry={data.refreshAll} />
            {lsp.items.map((item) => (
              <div key={item.id} className="font-medium text-gray-800 dark:text-gray-200">
                {item.name}
              </div>
            ))}
          </div>
        </Panel>

        <Panel tab={tab} id="plugins">
          <div className="space-y-2 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox
              state={plugins.state}
              error={plugins.error}
              updatedAt={plugins.updatedAt}
              empty={plugins.empty}
              onRetry={data.refreshAll}
            />
            {plugins.items.map((item) => (
              <div key={item} className="font-medium text-gray-800 dark:text-gray-200">
                {item}
              </div>
            ))}
          </div>
        </Panel>

        <Panel tab={tab} id="skills">
          <div className="space-y-2.5 px-3.5 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900 dark:text-gray-100">技能列表</span>
            </div>

            <SearchInput
              value={search.skills || ""}
              placeholder="搜索技能与描述..."
              onChange={(val) => setSearch((prev) => ({ ...prev, skills: val }))}
            />

            <StateBox
              state={skills.state}
              error={skills.error}
              updatedAt={skills.updatedAt}
              onRetry={data.refreshAll}
            />

            {filteredSkillItems.length === 0 && skills.items.length > 0 ? (
              <div className="py-3 text-center text-gray-400">无匹配的技能</div>
            ) : null}

            {filteredSkillItems.map((item) => (
              <div
                key={item.name}
                className="rounded-lg border border-gray-200/80 bg-white/40 p-2.5 transition-all dark:border-gray-800/80 dark:bg-gray-900/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                      {item.source ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          {item.source}
                        </span>
                      ) : null}
                    </div>
                    {item.description ? (
                      <div className="mt-0.5">
                        <p
                          className={`text-[11px] text-gray-500 dark:text-gray-400 ${
                            !expandedSkills[item.name] ? "line-clamp-2" : ""
                          }`}
                        >
                          {item.description}
                        </p>
                        {item.description.length > 50 ? (
                          <button
                            type="button"
                            className="mt-0.5 whitespace-nowrap text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() =>
                              setExpandedSkills((prev) => ({
                                ...prev,
                                [item.name]: !(prev[item.name] === true),
                              }))
                            }
                          >
                            {expandedSkills[item.name] ? "收起" : "展开全部"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <Switch
                    label={`切换 ${item.name}`}
                    checked={item.enabled}
                    disabled={data.skillBusy[item.name] === true}
                    loading={data.skillBusy[item.name] === true}
                    onToggle={() => void data.toggleSkill(item.name)}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative mb-1">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-400 dark:text-gray-500">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-200 bg-gray-50/80 py-1 pl-8 pr-7 text-xs text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-blue-400"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="清空搜索"
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null

  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        connected
      </span>
    )
  }

  if (status === "disabled") {
    return (
      <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.2 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        disabled
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.2 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
      {status}
    </span>
  )
}

function Panel(props: { tab: Tab; id: Tab; children: ReactNode }) {
  const active = props.tab === props.id
  return (
    <div id={`status-panel-${props.id}`} role="tabpanel" aria-labelledby={`status-tab-${props.id}`} hidden={!active}>
      {props.children}
    </div>
  )
}

function StateBox(props: {
  state: string
  error: string | null
  updatedAt: number | null
  empty?: string
  onRetry?: () => void | Promise<void>
}) {
  if (props.state === "failed") {
    return (
      <div className="flex items-center justify-between gap-2">
        <span>数据失败：{props.error}</span>
        {props.onRetry ? (
          <button type="button" className="text-blue-600 dark:text-blue-400" onClick={() => void props.onRetry?.()}>
            重试
          </button>
        ) : null}
      </div>
    )
  }
  if (props.state === "stale") return <div>数据可能不是最新，上次更新于 {stamp(props.updatedAt)}</div>
  if (props.state === "empty") return <div>{props.empty ?? "暂无可展示数据"}</div>
  return null
}

function Switch(props: {
  label: string
  checked: boolean
  disabled?: boolean
  loading?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      disabled={props.disabled}
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-[2px] transition ${props.checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-700"} disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={props.onToggle}
    >
      {props.loading ? (
        <span
          aria-hidden="true"
          className={`h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin transition ${
            props.checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`h-4 w-4 rounded-full bg-white transition ${props.checked ? "translate-x-4" : "translate-x-0"}`}
        />
      )}
    </button>
  )
}
