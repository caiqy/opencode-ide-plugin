import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { sdk } from "../lib/api/sdkClient"
import { isVirtualTab, openVirtualUnique, openWithPolicy } from "./tabPolicy"
import { uiBridgeTabs } from "./uiBridgeState"

const key = "webgui_tabs"
const delay = 500

type TabState = {
  openTabs: string[]
  activeTab: string
}

const empty: TabState = {
  openTabs: [],
  activeTab: "",
}

function parse(input: unknown) {
  if (!input || typeof input !== "object") return null
  if (!Array.isArray((input as { openTabs?: unknown }).openTabs)) return null
  if (!(input as { openTabs: unknown[] }).openTabs.every((id) => typeof id === "string")) return null
  if (typeof (input as { activeTab?: unknown }).activeTab !== "string") return null

  return {
    openTabs: (input as { openTabs: string[] }).openTabs,
    activeTab: (input as { activeTab: string }).activeTab,
  }
}

function store(next: TabState) {
  void sdk.kv
    .update({
      body: {
        [key]: next,
      },
    })
    .catch(() => {})
}

function useTabStoreInternal() {
  const [state, setState] = useState(empty)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef(state)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback((next: TabState) => {
    ref.current = next
    setState(next)
    store(next)
  }, [])

  const saveDebounced = useCallback((next: TabState) => {
    ref.current = next
    setState(next)
    if (timer.current) {
      clearTimeout(timer.current)
    }
    timer.current = setTimeout(() => {
      store(ref.current)
      timer.current = null
    }, delay)
  }, [])

  useEffect(() => {
    let live = true
    void sdk.kv
      .get()
      .then((res) => {
        if (!live) return
        const data = parse(res.data?.[key])
        if (data && data.openTabs.length > 0) {
          const tabs = data.openTabs
          const active = data.activeTab
          const validActive = tabs.includes(active) ? active : tabs[tabs.length - 1] || ""
          const next = { openTabs: tabs, activeTab: validActive }
          ref.current = next
          setState(next)
        } else {
          const bridge = uiBridgeTabs()
          if (bridge.openTabs.length > 0) {
            const validActive = bridge.openTabs.includes(bridge.activeTab)
              ? bridge.activeTab
              : bridge.openTabs[bridge.openTabs.length - 1] || ""
            const next = { openTabs: bridge.openTabs, activeTab: validActive }
            ref.current = next
            setState(next)
          }
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!live) return
        const bridge = uiBridgeTabs()
        if (bridge.openTabs.length > 0) {
          const validActive = bridge.openTabs.includes(bridge.activeTab)
            ? bridge.activeTab
            : bridge.openTabs[bridge.openTabs.length - 1] || ""
          const next = { openTabs: bridge.openTabs, activeTab: validActive }
          ref.current = next
          setState(next)
        }
        setLoaded(true)
      })

    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (timer.current) {
        store(ref.current)
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [])

  const openTab = useCallback(
    (sessionId: string) => {
      const next = isVirtualTab(sessionId)
        ? openVirtualUnique(ref.current, sessionId)
        : openWithPolicy(ref.current, sessionId)
      save(next)
    },
    [save],
  )

  const closeTab = useCallback(
    (sessionId: string) => {
      const index = ref.current.openTabs.indexOf(sessionId)
      if (index < 0) return

      const openTabs = ref.current.openTabs.filter((id) => id !== sessionId)
      const activeTab =
        ref.current.activeTab === sessionId
          ? openTabs.length === 0
            ? ""
            : openTabs[Math.min(index, openTabs.length - 1)]
          : ref.current.activeTab

      save({
        openTabs,
        activeTab,
      })
    },
    [save],
  )

  const removeTab = useCallback(
    (sessionId: string) => {
      if (!ref.current.openTabs.includes(sessionId)) return
      const openTabs = ref.current.openTabs.filter((id) => id !== sessionId)
      const activeTab =
        ref.current.activeTab === sessionId ? openTabs[openTabs.length - 1] || "" : ref.current.activeTab
      save({
        openTabs,
        activeTab,
      })
    },
    [save],
  )

  const setActiveTab = useCallback(
    (sessionId: string) => {
      if (!ref.current.openTabs.includes(sessionId)) return
      save({
        openTabs: ref.current.openTabs,
        activeTab: sessionId,
      })
    },
    [save],
  )

  const reorderTabs = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      if (from < 0 || to < 0) return
      if (from >= ref.current.openTabs.length || to >= ref.current.openTabs.length) return

      const openTabs = [...ref.current.openTabs]
      const moved = openTabs[from]
      openTabs.splice(from, 1)
      openTabs.splice(to, 0, moved)

      saveDebounced({
        openTabs,
        activeTab: ref.current.activeTab,
      })
    },
    [saveDebounced],
  )

  const replaceTab = useCallback(
    (oldId: string, newId: string) => {
      const index = ref.current.openTabs.indexOf(oldId)
      if (index < 0) return
      if (oldId === newId) return

      if (ref.current.openTabs.includes(newId)) {
        save({
          openTabs: ref.current.openTabs.filter((id) => id !== oldId),
          activeTab: ref.current.activeTab === oldId ? newId : ref.current.activeTab,
        })
        return
      }

      save({
        openTabs: ref.current.openTabs.map((id, i) => (i === index ? newId : id)),
        activeTab: ref.current.activeTab === oldId ? newId : ref.current.activeTab,
      })
    },
    [save],
  )

  const closeOtherTabs = useCallback(
    (keepId: string) => {
      if (!ref.current.openTabs.includes(keepId)) return
      save({
        openTabs: [keepId],
        activeTab: keepId,
      })
    },
    [save],
  )

  const closeTabsToRight = useCallback(
    (id: string) => {
      const index = ref.current.openTabs.indexOf(id)
      if (index < 0) return
      const openTabs = ref.current.openTabs.slice(0, index + 1)
      const activeTab = openTabs.includes(ref.current.activeTab) ? ref.current.activeTab : id
      save({
        openTabs,
        activeTab,
      })
    },
    [save],
  )

  return {
    openTabs: state.openTabs,
    activeTab: state.activeTab,
    loaded,
    openTab,
    closeTab,
    removeTab,
    setActiveTab,
    reorderTabs,
    replaceTab,
    closeOtherTabs,
    closeTabsToRight,
  }
}

type TabStore = ReturnType<typeof useTabStoreInternal>

const TabStoreContext = createContext<TabStore | null>(null)

export function TabStoreProvider({ children }: { children: ReactNode }) {
  const store = useTabStoreInternal()
  return createElement(TabStoreContext.Provider, { value: store }, children)
}

export function useTabStore() {
  const store = useContext(TabStoreContext)
  if (!store) {
    throw new Error("useTabStore must be used within a TabStoreProvider")
  }
  return store
}
