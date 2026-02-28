import { useEffect, useMemo, useRef, useState } from "react"
import {
  addCustomQuickPhrase,
  loadQuickPhraseState,
  reorderQuickPhrase,
  removeQuickPhrase,
  setQuickPhraseMode,
  toggleQuickPhraseHidden,
  updateCustomQuickPhrase,
  type QuickPhraseMode,
  type QuickPhraseState,
} from "../../state/repo/quickPhraseRepo"
import { quick_phrase_updated_event } from "../../state/repo/quickPhraseEvent"

export function QuickPhrasesTab() {
  const [mode, setMode] = useState<QuickPhraseMode>("fill_input")
  const [order, setOrder] = useState<string[]>([])
  const [items, setItems] = useState<QuickPhraseState["items"]>({})
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState("")
  const loading = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    return () => {
      mounted.current = false
    }
  }, [])

  function apply(state: QuickPhraseState) {
    setMode(state.mode)
    setOrder(state.order)
    setItems(state.items)
    window.dispatchEvent(new Event(quick_phrase_updated_event))
  }

  function sync(job: Promise<QuickPhraseState>) {
    const id = ++loading.current
    void job.then((state) => {
      if (!mounted.current) return
      if (id !== loading.current) return
      apply(state)
    })
  }

  const list = useMemo(
    () => order.map((id) => items[id]).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [items, order],
  )

  useEffect(() => {
    sync(loadQuickPhraseState())
  }, [])

  function move(id: string, delta: -1 | 1) {
    const idx = order.indexOf(id)
    if (idx < 0) return
    const next = [...order]
    const target = idx + delta
    if (target < 0 || target >= next.length) return
    const current = next[idx]!
    next[idx] = next[target]!
    next[target] = current
    sync(reorderQuickPhrase(next))
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">快捷短语设置</h3>

      <div>
        <label htmlFor="quick-phrase-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          输入模式
        </label>
        <select
          id="quick-phrase-mode"
          value={mode}
          onChange={(event) => {
            const next = event.target.value as QuickPhraseMode
            setMode(next)
            sync(setQuickPhraseMode(next))
          }}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        >
          <option value="double_send">双击发送</option>
          <option value="confirm_send">确认后发送</option>
          <option value="fill_input">回填输入框</option>
        </select>
      </div>

      <div className="space-y-2">
        {list.map((item) => (
          <div key={item.id} className="border border-gray-200 dark:border-gray-700 rounded p-2 space-y-1">
            {editing === item.id ? (
              <>
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                />
                <textarea
                  value={editBody}
                  onChange={(event) => setEditBody(event.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                />
                <button
                  onClick={() => {
                    if (!editTitle.trim() || !editBody.trim()) return
                    sync(updateCustomQuickPhrase(item.id, { title: editTitle, body: editBody }))
                    setEditing(null)
                  }}
                  aria-label={`保存-${item.id}`}
                  className="text-xs text-blue-600 dark:text-blue-400"
                >
                  保存
                </button>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.title}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{item.body}</div>
              </>
            )}
            {item.source === "custom" && editing !== item.id && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditing(item.id)
                    setEditTitle(item.title)
                    setEditBody(item.body)
                  }}
                  aria-label={`编辑-${item.id}`}
                  className="text-xs text-blue-600 dark:text-blue-400"
                >
                  编辑
                </button>
                <button
                  onClick={() => {
                    sync(removeQuickPhrase(item.id))
                  }}
                  aria-label={`删除-${item.id}`}
                  className="text-xs text-red-600 dark:text-red-400"
                >
                  删除
                </button>
              </div>
            )}
            {editing !== item.id && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    sync(toggleQuickPhraseHidden(item.id))
                  }}
                  aria-label={`${item.hidden ? "显示" : "隐藏"}-${item.id}`}
                  className="text-xs text-gray-600 dark:text-gray-300"
                >
                  {item.hidden ? "显示" : "隐藏"}
                </button>
                <button
                  onClick={() => move(item.id, -1)}
                  aria-label={`上移-${item.id}`}
                  className="text-xs text-gray-600 dark:text-gray-300"
                >
                  上移
                </button>
                <button
                  onClick={() => move(item.id, 1)}
                  aria-label={`下移-${item.id}`}
                  className="text-xs text-gray-600 dark:text-gray-300"
                >
                  下移
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="短语标题"
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="短语正文"
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
        />
        <button
          onClick={() => {
            if (!title.trim() || !body.trim()) return
            sync(addCustomQuickPhrase({ title: title.trim(), body }))
            setTitle("")
            setBody("")
          }}
          className="text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-700"
        >
          添加短语
        </button>
      </div>
    </div>
  )
}
