import { MCP } from "@/mcp"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AddPayload, AuthCallbackPayload, EnabledPayload, StatusMap, UnsupportedOAuthError } from "../groups/mcp"

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

export const mcpHandlers = HttpApiBuilder.group(InstanceHttpApi, "mcp", (handlers) =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    const status = Effect.fn("McpHttpApi.status")(function* () {
      return yield* mcp.status()
    })

    const add = Effect.fn("McpHttpApi.add")(function* (ctx: { payload: typeof AddPayload.Type }) {
      const result = (yield* mcp.add(ctx.payload.name, ctx.payload.config)).status
      return yield* Schema.decodeUnknownEffect(StatusMap)(
        "status" in result ? { [ctx.payload.name]: result } : result,
      ).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const tools = Effect.fn("McpHttpApi.tools")(function* (ctx: { params: { name: string } }) {
      const result = yield* mcp.toolsByServer(ctx.params.name)
      return {
        server: ctx.params.name,
        ...result,
      }
    })

    const enabled = Effect.fn("McpHttpApi.enabled")(function* (ctx: {
      params: { name: string }
      payload: typeof EnabledPayload.Type
    }) {
      yield* mcp.setEnabled(ctx.params.name, ctx.payload.enabled)
      return true
    })

    const toolEnabled = Effect.fn("McpHttpApi.toolEnabled")(function* ({
      params: { name, toolId },
      payload,
    }: {
      params: { name: string; toolId: string }
      payload: typeof EnabledPayload.Type
    }) {
      if (!toolId.startsWith(`${sanitize(name)}_`)) {
        return yield* new HttpApiError.BadRequest({})
      }
      yield* mcp.setToolEnabled(toolId, payload.enabled)
      return true
    })

    const authStart = Effect.fn("McpHttpApi.authStart")(function* (ctx: { params: { name: string } }) {
      if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
        return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
      }
      return yield* mcp.startAuth(ctx.params.name)
    })

    const authCallback = Effect.fn("McpHttpApi.authCallback")(function* (ctx: {
      params: { name: string }
      payload: typeof AuthCallbackPayload.Type
    }) {
      return yield* mcp.finishAuth(ctx.params.name, ctx.payload.code)
    })

    const authAuthenticate = Effect.fn("McpHttpApi.authAuthenticate")(function* (ctx: { params: { name: string } }) {
      if (!(yield* mcp.supportsOAuth(ctx.params.name))) {
        return yield* new UnsupportedOAuthError({ error: `MCP server ${ctx.params.name} does not support OAuth` })
      }
      return yield* mcp.authenticate(ctx.params.name)
    })

    const authRemove = Effect.fn("McpHttpApi.authRemove")(function* (ctx: { params: { name: string } }) {
      yield* mcp.removeAuth(ctx.params.name)
      return { success: true as const }
    })

    const connect = Effect.fn("McpHttpApi.connect")(function* (ctx: { params: { name: string } }) {
      yield* mcp.connect(ctx.params.name)
      return true
    })

    const disconnect = Effect.fn("McpHttpApi.disconnect")(function* (ctx: { params: { name: string } }) {
      yield* mcp.disconnect(ctx.params.name)
      return true
    })

    return handlers
      .handle("status", status)
      .handle("add", add)
      .handle("tools", tools)
      .handle("enabled", enabled)
      .handle("toolEnabled", toolEnabled)
      .handle("authStart", authStart)
      .handle("authCallback", authCallback)
      .handle("authAuthenticate", authAuthenticate)
      .handle("authRemove", authRemove)
      .handle("connect", connect)
      .handle("disconnect", disconnect)
  }),
)
