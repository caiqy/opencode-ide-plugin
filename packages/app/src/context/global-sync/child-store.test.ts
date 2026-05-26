import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { QueryOptionsApi, State } from "./types"

let createChildStoreManager: typeof import("./child-store").createChildStoreManager
let queryState: Array<{ isLoading: boolean; data: unknown }> = [
  { isLoading: false, data: undefined },
  { isLoading: false, data: undefined },
  { isLoading: false, data: undefined },
  { isLoading: false, data: undefined },
]

const child = () => createStore({} as State)
const emptyProvider = { all: [], connected: [], default: {} } satisfies ProviderListResponse
const queryOptions = {} as QueryOptionsApi

beforeAll(async () => {
  mock.module("@tanstack/solid-query", () => ({
    useQueries: () => queryState,
  }))

  mock.module("@/utils/persist", () => ({
    Persist: {
      workspace: () => ({ key: "workspace" }),
    },
    persisted: <T extends [unknown, unknown]>(_: unknown, store: T) => {
      const ready = Object.assign(() => true, { promise: undefined })
      return [store[0], store[1], null, ready]
    },
  }))

  const mod = await import("./child-store")
  createChildStoreManager = mod.createChildStoreManager
})

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", () => {
    queryState = [
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
    ]

    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions,
      global: { provider: () => emptyProvider },
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })

  test("child store path fallback includes configFile", () => {
    queryState = [
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
    ]

    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions,
      global: { provider: () => emptyProvider },
    })

    const [store] = manager.child("/repo", { bootstrap: false })

    expect(store.path).toEqual({
      state: "",
      config: "",
      configFile: "",
      worktree: "",
      directory: "",
      home: "",
    })
  })

  test("child provider fallback reads latest global provider", () => {
    queryState = [
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: undefined },
      { isLoading: false, data: emptyProvider },
    ]

    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    let provider: ProviderListResponse = emptyProvider
    const nextProvider: ProviderListResponse = {
      all: [{ id: "anthropic", name: "Anthropic", source: "env", env: [], options: {}, models: {} }],
      connected: [],
      default: {},
    }

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      queryOptions,
      global: { provider: () => provider },
    })

    const [store] = manager.child("/repo", { bootstrap: false })

    expect(store.provider).toEqual(emptyProvider)

    provider = nextProvider

    expect(store.provider).toEqual(nextProvider)
  })
})
