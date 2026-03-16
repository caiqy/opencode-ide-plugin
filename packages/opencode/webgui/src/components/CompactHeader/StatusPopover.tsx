import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useClickOutside } from "../../hooks/useClickOutside"
import { DEFAULT_STATUS_TAB, STATUS_TABS, buildLspView, buildMcpView, buildPluginView, buildServerView } from "./status"
import { useStatusPopoverData } from "./useStatusPopoverData"

type Tab = (typeof STATUS_TABS)[number]["id"]
const TOOL_HINT = "已保存，将在下一轮回复生效"

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
  const tid = useRef<number | null>(null)
  const [tab, setTab] = useState<Tab>(DEFAULT_STATUS_TAB)
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [hint, setHint] = useState<string | null>(null)
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

  useEffect(
    () => () => {
      if (tid.current !== null) window.clearTimeout(tid.current)
    },
    [],
  )

  const save = useCallback(() => {
    setHint(TOOL_HINT)
    if (tid.current !== null) window.clearTimeout(tid.current)
    tid.current = window.setTimeout(() => {
      setHint(null)
      tid.current = null
    }, 1800)
  }, [])

  const servers = useMemo(() => buildServerView(data.servers), [data.servers])
  const mcp = useMemo(() => buildMcpView(data.mcp), [data.mcp])
  const lsp = useMemo(() => buildLspView(data.lsp), [data.lsp])
  const plugins = useMemo(() => buildPluginView(data.plugins), [data.plugins])

  if (!open) return null

  return (
    <div
      ref={ref}
      id="status-popover"
      role="dialog"
      aria-label="状态面板"
      className="modern-card absolute right-2 top-full z-50 mt-2 flex max-h-[60vh] w-[360px] flex-col"
    >
      <div className="border-b border-gray-200 px-2 py-2 dark:border-gray-800" role="tablist" aria-label="状态标签页">
        <div className="flex gap-1">
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
                className={`rounded px-2 py-1 text-xs ${active ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" : "text-gray-600 dark:text-gray-300"}`}
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
          <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox
              state={servers.state}
              error={servers.error}
              updatedAt={servers.updatedAt}
              onRetry={data.refreshAll}
            />
            <div>SSE 连接：{servers.summary.connection}</div>
            <div>IDE bridge：{servers.summary.bridge.ready ? "ready" : "not ready"}</div>
            <div>路径：{servers.summary.directory ?? servers.summary.worktree ?? "未知"}</div>
          </div>
        </Panel>

        <Panel tab={tab} id="mcp">
          <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <div className="flex items-center justify-between">
              <span>MCP</span>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-blue-600 dark:border-gray-700 dark:text-blue-400 disabled:text-gray-400"
                disabled={data.mcpRefreshing}
                onClick={() => void data.refreshMcp()}
              >
                {data.mcpRefreshing ? "刷新中..." : mcp.refreshLabel}
              </button>
            </div>
            <StateBox state={mcp.state} error={mcp.error} updatedAt={mcp.updatedAt} />
            {hint ? <div className="text-[11px] text-emerald-600 dark:text-emerald-400">{hint}</div> : null}
            {mcp.items.map((item) => {
              const on = show[item.name] === true
              return (
                <div
                  key={item.name}
                  className="space-y-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0 dark:border-gray-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <span>{item.name}</span>
                      {item.reason ? (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">{item.reason}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.tools.length > 0 ? (
                        <button
                          type="button"
                          className="text-[11px] text-gray-500 dark:text-gray-400"
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
                      <span>{item.status}</span>
                      <Switch
                        label={`切换 ${item.name}`}
                        checked={item.enabled}
                        disabled={item.disabled || data.mcpBusy[item.name] === true}
                        loading={data.mcpBusy[item.name] === true}
                        onToggle={() => void data.toggleMcp(item.name)}
                      />
                    </div>
                  </div>
                  {on
                    ? item.tools.map((tool) => {
                        const busy = data.mcpToolBusy[item.name]?.[tool.id] === true
                        return (
                          <div
                            key={tool.id}
                            className="ml-3 flex items-center justify-between gap-2 border-l border-gray-200 pl-2 dark:border-gray-800"
                          >
                            <span className="text-[11px] text-gray-600 dark:text-gray-300">{tool.name}</span>
                            <Switch
                              label={`切换 ${tool.name}`}
                              checked={tool.enabled}
                              disabled={busy}
                              loading={busy}
                              onToggle={() => {
                                void (async () => {
                                  const ok = await data.toggleTool(item.name, tool.id, !tool.enabled)
                                  if (!ok) return
                                  save()
                                })()
                              }}
                            />
                          </div>
                        )
                      })
                    : null}
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel tab={tab} id="lsp">
          <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox state={lsp.state} error={lsp.error} updatedAt={lsp.updatedAt} onRetry={data.refreshAll} />
            {lsp.items.map((item) => (
              <div key={item.id}>{item.name}</div>
            ))}
          </div>
        </Panel>

        <Panel tab={tab} id="plugins">
          <div className="space-y-2 px-3 py-3 pr-4 text-xs text-gray-700 dark:text-gray-200">
            <StateBox
              state={plugins.state}
              error={plugins.error}
              updatedAt={plugins.updatedAt}
              empty={plugins.empty}
              onRetry={data.refreshAll}
            />
            {plugins.items.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
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
      className={`flex h-5 w-9 items-center rounded-full p-[2px] transition ${props.checked ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-700"} disabled:cursor-not-allowed disabled:opacity-60`}
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
