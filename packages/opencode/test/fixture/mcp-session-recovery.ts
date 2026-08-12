import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const sdk =
  process.env.MCP_RECOVERY_MODULE === "cjs"
    ? {
        Client: require("@modelcontextprotocol/sdk/client/index.js").Client,
        LATEST_PROTOCOL_VERSION: require("@modelcontextprotocol/sdk/types.js").LATEST_PROTOCOL_VERSION,
        StreamableHTTPClientTransport: require("@modelcontextprotocol/sdk/client/streamableHttp.js")
          .StreamableHTTPClientTransport,
      }
    : {
        Client: (await import("@modelcontextprotocol/sdk/client/index.js")).Client,
        LATEST_PROTOCOL_VERSION: (await import("@modelcontextprotocol/sdk/types.js")).LATEST_PROTOCOL_VERSION,
        StreamableHTTPClientTransport: (await import("@modelcontextprotocol/sdk/client/streamableHttp.js"))
          .StreamableHTTPClientTransport,
      }

const posts: Array<{ method: string; session: string | null }> = []
const mode = process.env.MCP_RECOVERY_MODE ?? "success"
const concurrent = mode === "concurrent"
let initializeCount = 0
let pingCount = 0
let blockReplacementToken = false
let tokenWaiters = 0
let tokenWaitersStarted!: () => void
const replacementTokenWaiters = new Promise<void>((resolve) => (tokenWaitersStarted = resolve))
let tokenWaitersReleased!: () => void
const releaseReplacementTokens = new Promise<void>((resolve) => (tokenWaitersReleased = resolve))
let replacementStarted!: () => void
const replacement = new Promise<void>((resolve) => (replacementStarted = resolve))
let replacementReleased!: () => void
const releaseReplacement = new Promise<void>((resolve) => (replacementReleased = resolve))
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method === "DELETE") return new Response(null, { status: 200 })

    const message = (await request.json()) as { id?: number; method: string }
    const session = request.headers.get("mcp-session-id")
    posts.push({ method: message.method, session })

    if (message.method === "initialize") {
      initializeCount++
      if (initializeCount === 2) replacementStarted()
      if (
        initializeCount === 2 &&
        (mode === "abort-waiter" ||
          mode === "timeout-waiter" ||
          mode === "timeout-auth-waiter" ||
          mode === "abort-auth-waiter")
      ) {
        await releaseReplacement
      }
      if (initializeCount === 2 && mode === "rehandshake-failure") return new Response("re-handshake failed", { status: 500 })
      return Response.json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: sdk.LATEST_PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "test", version: "1" },
          },
        },
        { headers: { "mcp-session-id": initializeCount === 1 ? "expired" : "replacement" } },
      )
    }

    if (message.method === "notifications/initialized") {
      if ((mode === "timeout-auth-waiter" || mode === "abort-auth-waiter") && session === "replacement") {
        blockReplacementToken = true
      }
      return new Response(null, { status: 202 })
    }
    if (message.method !== "ping") return new Response(null, { status: 202 })

    pingCount++
    if (concurrent && pingCount === 2) await replacement
    if (mode === "retry-limit") return new Response("Session not found", { status: 404 })
    if (mode === "rehandshake-failure" && pingCount <= 2) return new Response("Session not found", { status: 404 })
    if (pingCount <= (concurrent ? 2 : 1)) return new Response("Session not found", { status: 404 })
    return Response.json({ jsonrpc: "2.0", id: message.id, result: {} })
  },
})
const client = new sdk.Client({ name: "test", version: "1" })
const transport = new sdk.StreamableHTTPClientTransport(
  server.url,
  mode === "timeout-auth-waiter" || mode === "abort-auth-waiter"
    ? {
        authProvider: {
          tokens: async () => {
            if (!blockReplacementToken) return { access_token: "test", token_type: "Bearer" }
            tokenWaiters++
            if (tokenWaiters === 2) tokenWaitersStarted()
            await releaseReplacementTokens
            return { access_token: "test", token_type: "Bearer" }
          },
        },
        ...(mode === "abort-auth-waiter"
          ? {
              fetch: (...args: Parameters<typeof fetch>) => {
                const [input, init] = args
                const requestInit = { ...init }
                delete requestInit.signal
                return fetch(input, requestInit)
              },
            }
          : {}),
      }
    : undefined,
)

try {
  await client.connect(transport)
  if (concurrent) await Promise.all([client.ping(), client.ping()])
  if (mode === "abort-waiter") {
    const recovering = client.ping()
    await replacement
    const controller = new AbortController()
    const waiting = client.ping({ signal: controller.signal })
    controller.abort(new Error("waiter aborted"))
    const aborted = await Promise.race([
      waiting.then(
        () => false,
        () => true,
      ),
      Bun.sleep(250).then(() => {
        throw new Error("waiting request did not abort before recovery completed")
      }),
    ])
    replacementReleased()
    await recovering
    await client.ping()
    process.stdout.write(JSON.stringify({ posts, aborted }))
  } else if (mode === "timeout-waiter") {
    const recovering = client.ping()
    await replacement
    const waiting = client.ping({ timeout: 20 })
    const timedOut = await Promise.race([
      waiting.then(
        () => false,
        () => true,
      ),
      Bun.sleep(250).then(() => {
        throw new Error("waiting request did not time out before recovery completed")
      }),
    ])
    replacementReleased()
    await recovering
    await Bun.sleep(50)
    const retried = posts.filter((post) => post.method === "ping" && post.session === "replacement").length > 1
    process.stdout.write(JSON.stringify({ posts, timedOut, retried }))
  } else if (mode === "timeout-auth-waiter") {
    const recovering = client.ping()
    await replacement
    const waiting = client.ping({ timeout: 100 })
    replacementReleased()
    await Promise.race([
      replacementTokenWaiters,
      Bun.sleep(250).then(() => {
        throw new Error("replacement-session requests did not reach auth token preparation")
      }),
    ])
    const timedOut = await Promise.race([
      waiting.then(
        () => false,
        () => true,
      ),
      Bun.sleep(250).then(() => {
        throw new Error("waiting request did not time out while auth token preparation was blocked")
      }),
    ])
    tokenWaitersReleased()
    await recovering
    await Bun.sleep(50)
    process.stdout.write(JSON.stringify({ posts, timedOut }))
  } else if (mode === "abort-auth-waiter") {
    const recovering = client.ping()
    await replacement
    const controller = new AbortController()
    const waiting = client.ping({ signal: controller.signal })
    replacementReleased()
    await Promise.race([
      replacementTokenWaiters,
      Bun.sleep(250).then(() => {
        throw new Error("replacement-session requests did not reach auth token preparation")
      }),
    ])
    controller.abort(new Error("waiter aborted"))
    const aborted = await Promise.race([
      waiting.then(
        () => false,
        () => true,
      ),
      Bun.sleep(250).then(() => {
        throw new Error("waiting request did not abort while auth token preparation was blocked")
      }),
    ])
    tokenWaitersReleased()
    await recovering
    await Bun.sleep(50)
    process.stdout.write(JSON.stringify({ posts, aborted }))
  } else if (mode === "rehandshake-failure") {
    const failed = await client.ping().then(
      () => false,
      () => true,
    )
    const recovered = await client.ping().then(
      () => ({ success: true }),
      (error: unknown) => ({ success: false, error: error instanceof Error ? error.message : String(error) }),
    )
    process.stdout.write(JSON.stringify({ posts, failed, recovered }))
  } else if (mode === "retry-limit") {
    const failed = await client.ping().then(
      () => false,
      () => true,
    )
    process.stdout.write(JSON.stringify({ posts, failed }))
  } else {
    if (!concurrent) await client.ping()
    process.stdout.write(JSON.stringify(posts))
  }
} finally {
  await client.close()
  server.stop(true)
}
