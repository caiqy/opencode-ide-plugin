export type TabState = {
  openTabs: string[]
  activeTab: string
}

export const MAX_OPEN_TABS = 6

export function isVirtualTab(id: string) {
  return id.startsWith("virtual-")
}

function evictOne(openTabs: string[], incomingId: string) {
  const evictIndex = openTabs.findIndex((id) => id !== incomingId)
  if (evictIndex !== -1) return openTabs.filter((_, i) => i !== evictIndex)
  return [incomingId]
}

function capTabs(openTabs: string[], incomingId: string): string[] {
  if (openTabs.length <= MAX_OPEN_TABS) return openTabs
  return capTabs(evictOne(openTabs, incomingId), incomingId)
}

export function openWithPolicy(state: TabState, incomingId: string): TabState {
  if (state.openTabs.includes(incomingId)) {
    return {
      openTabs: state.openTabs,
      activeTab: incomingId,
    }
  }

  return {
    openTabs: capTabs([...state.openTabs, incomingId], incomingId),
    activeTab: incomingId,
  }
}

export function openVirtualUnique(state: TabState, virtualId: string): TabState {
  if (!isVirtualTab(virtualId)) return openWithPolicy(state, virtualId)

  const virtual = state.openTabs.find((id) => isVirtualTab(id))
  if (virtual) {
    return {
      openTabs: state.openTabs,
      activeTab: virtual,
    }
  }

  return openWithPolicy(state, virtualId)
}
