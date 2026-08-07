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
import { openWithPolicy } from "./tabPolicy"
import { loadTabs, saveTabs } from "./repo/tabsRepo"

type TabState = {
  openTabs: string[]
  activeTab: string
}

const empty: TabState = {
  openTabs: [],
  activeTab: "",
}

function persist(next: TabState) {
  void saveTabs({ open_tabs: next.openTabs, active_tab: next.activeTab }).catch(() => {})
}

function sameTabs(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((id, i) => id === b[i])
}

function useTabStoreInternal() {
  const [state, setState] = useState(empty)
  const [loaded, setLoaded] = useState(false)
  const ref = useRef(state)
  const ready = useRef(false)

  function validated(tabs: string[], active: string): TabState {
    const validActive = tabs.includes(active) ? active : tabs[tabs.length - 1] || ""
    return { openTabs: tabs, activeTab: validActive }
  }

  const save = useCallback((next: TabState) => {
    ref.current = next
    setState(next)
    if (!ready.current) return
    persist(next)
  }, [])

  useEffect(() => {
    let live = true
    void loadTabs()
      .then((res) => {
        if (!live) return
        if (res.open_tabs.length > 0) {
          const next = validated(res.open_tabs, res.active_tab)
          ref.current = next
          setState(next)
        }
        ready.current = true
        setLoaded(true)
      })
      .catch(() => {
        if (!live) return
        ready.current = true
        setLoaded(true)
      })

    return () => {
      live = false
    }
  }, [])

  const activateTab = useCallback((sessionId: string) => {
    if (!ref.current.openTabs.includes(sessionId)) return
    const next = {
      openTabs: ref.current.openTabs,
      activeTab: sessionId,
    }
    ref.current = next
    setState(next)
    if (!ready.current) return
    persist(next)
  }, [])

  const openTab = useCallback(
    (sessionId: string) => {
      const prev = ref.current
      const next = openWithPolicy(ref.current, sessionId)
      if (sameTabs(next.openTabs, prev.openTabs)) {
        activateTab(sessionId)
        return
      }
      save(next)
    },
    [activateTab, save],
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

  const reorderTabs = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      if (from < 0 || to < 0) return
      if (from >= ref.current.openTabs.length || to >= ref.current.openTabs.length) return

      const openTabs = [...ref.current.openTabs]
      const moved = openTabs[from]
      openTabs.splice(from, 1)
      openTabs.splice(to, 0, moved)

      save({
        openTabs,
        activeTab: ref.current.activeTab,
      })
    },
    [save],
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

  const pruneTabs = useCallback(
    (validIds: Set<string>) => {
      const openTabs = ref.current.openTabs.filter((id) => validIds.has(id))
      if (openTabs.length === ref.current.openTabs.length) return
      const activeTab = openTabs.includes(ref.current.activeTab)
        ? ref.current.activeTab
        : openTabs[openTabs.length - 1] || ""
      save({ openTabs, activeTab })
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
    activateTab,
    reorderTabs,
    replaceTab,
    closeOtherTabs,
    closeTabsToRight,
    pruneTabs,
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
