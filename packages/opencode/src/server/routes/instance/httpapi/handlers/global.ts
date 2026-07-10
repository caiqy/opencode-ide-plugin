import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import { InstanceStore } from "@/project/instance-store"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"

// Fields that only need config cache invalidation (no instance dispose required).
// Changes to these take effect on the next message/operation without reconnection.
const LIGHTWEIGHT_FIELDS = new Set([
  "agent",
  "mode",
  "username",
  "autoupdate",
  "snapshot",
  "share",
  "autoshare",
  "watcher",
  "theme",
  "default_agent",
  "small_model",
  "command",
  "skills",
  "layout",
  "keybinds",
  "compaction",
])

// Determine whether changed keys require full instance disposal. PATCH only
// checks keys present in the payload; PUT checks the union so deleted heavy
// fields are treated as meaningful changes.
function requiresDisposeForKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  keys: string[],
): boolean {
  if (keys.length === 0) return false

  // Fast path: if all keys are lightweight, no dispose needed regardless of values
  const heavyKeys = keys.filter((key) => !LIGHTWEIGHT_FIELDS.has(key))
  if (heavyKeys.length === 0) return false

  // Slow path: check if any heavy key actually changed
  for (const key of heavyKeys) {
    const prev = JSON.stringify(previous[key] ?? null)
    const value = JSON.stringify(next[key] ?? null)
    if (prev !== value) return true
  }
  return false
}

function requiresDispose(previous: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return requiresDisposeForKeys(
    previous,
    payload,
    Object.keys(payload).filter((key) => key !== "$schema"),
  )
}

function requiresDisposeForReplace(previous: Record<string, unknown>, replacement: Record<string, unknown>): boolean {
  return requiresDisposeForKeys(
    previous,
    replacement,
    Array.from(new Set([...Object.keys(previous), ...Object.keys(replacement)])).filter((key) => key !== "$schema"),
  )
}

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function eventResponse() {
  return Effect.gen(function* () {
    yield* Effect.logInfo("global event connected")
    const events = Stream.callback<GlobalBusEvent>((queue) => {
      const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", handler)),
        () => Effect.sync(() => GlobalBus.off("event", handler)),
      )
    })
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("global event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const agent = yield* Agent.Service
    const instances = yield* InstanceStore.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()
    const reloadAgentConfig = () =>
      instances.provideAll(
        Effect.gen(function* () {
          yield* config.reload()
          yield* agent.reloadModelConfig()
        }),
      ).pipe(Effect.catchCause((cause) => Effect.logWarning("agent config reload failed", { cause })))

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return yield* eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const previous = yield* config.getGlobal()
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) {
        const needsDispose = requiresDispose(
          previous as Record<string, unknown>,
          ctx.payload as Record<string, unknown>,
        )
        if (needsDispose) {
          yield* Effect.logInfo("config update requires dispose")
          bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
        } else {
          yield* Effect.logInfo("config update lightweight, reloading agent config")
          yield* reloadAgentConfig()
        }
      }
      return result.info
    })

    const configReplace = Effect.fn("GlobalHttpApi.configReplace")(function* (ctx) {
      const previous = yield* config.getGlobal()
      const result = yield* config.replaceGlobal(ctx.payload)
      if (result.changed) {
        const needsDispose = requiresDisposeForReplace(
          previous as Record<string, unknown>,
          ctx.payload as Record<string, unknown>,
        )
        if (needsDispose) {
          yield* Effect.logInfo("config replace requires dispose")
          bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
        } else {
          yield* Effect.logInfo("config replace lightweight, reloading agent config")
          yield* reloadAgentConfig()
        }
      }
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("configReplace", configReplace)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
