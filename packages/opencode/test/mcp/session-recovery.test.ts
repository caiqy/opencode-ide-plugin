import path from "node:path"
import { describe, expect, test } from "bun:test"

describe("mcp session recovery", () => {
  async function fixture(mode?: string, module?: "cjs") {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/mcp-session-recovery.ts")], {
      cwd: path.join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        ...(mode ? { MCP_RECOVERY_MODE: mode } : {}),
        ...(module ? { MCP_RECOVERY_MODULE: module } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      Bun.readableStreamToText(child.stdout),
      Bun.readableStreamToText(child.stderr),
    ])
    expect(code, stderr).toBe(0)
    return JSON.parse(stdout) as Array<{ method: string; session: string | null }>
  }

  test("reinitializes and retries once after a session-bound POST returns 404", async () => {
    expect(await fixture()).toEqual([
      { method: "initialize", session: null },
      { method: "notifications/initialized", session: "expired" },
      { method: "ping", session: "expired" },
      { method: "initialize", session: null },
      { method: "notifications/initialized", session: "replacement" },
      { method: "ping", session: "replacement" },
    ])
  })

  test("retries a concurrent stale response after recovery completes", async () => {
    const posts = await fixture("concurrent")
    expect(posts.filter((post) => post.method === "initialize").map((post) => post.session)).toEqual([null, null])
    expect(posts.filter((post) => post.method === "ping" && post.session === "expired")).toHaveLength(2)
    expect(posts.filter((post) => post.method === "ping" && post.session === "replacement")).toHaveLength(2)
  })

  test("aborts a waiting request without retrying it after shared recovery", async () => {
    for (const module of [undefined, "cjs"] as const) {
      const result = (await fixture("abort-waiter", module)) as unknown as {
        posts: Array<{ method: string; session: string | null }>
        aborted: boolean
      }
      expect(result.aborted).toBeTrue()
      expect(result.posts.filter((post) => post.method === "initialize")).toHaveLength(2)
      expect(result.posts.filter((post) => post.method === "ping" && post.session === "replacement")).toHaveLength(2)
    }
  })

  test("times out a waiting request without retrying it after shared recovery", async () => {
    for (const module of [undefined, "cjs"] as const) {
      const result = (await fixture("timeout-waiter", module)) as unknown as {
        posts: Array<{ method: string; session: string | null }>
        timedOut: boolean
        retried: boolean
      }
      expect(result.timedOut).toBeTrue()
      expect(result.retried).toBeFalse()
      expect(result.posts.filter((post) => post.method === "initialize")).toHaveLength(2)
      expect(result.posts.filter((post) => post.method === "ping" && post.session === "replacement")).toHaveLength(1)
    }
  })

  test("clears a failed re-handshake so a later request can recover", async () => {
    const result = (await fixture("rehandshake-failure")) as unknown as {
      posts: Array<{ method: string; session: string | null }>
      failed: boolean
      recovered: { success: boolean; error?: string }
    }
    expect(result.failed).toBeTrue()
    expect(result.recovered.success, result.recovered.error).toBeTrue()
    expect(result.posts.filter((post) => post.method === "initialize")).toHaveLength(3)
  })

  test("stops after one retry when the replacement session is also missing", async () => {
    const result = (await fixture("retry-limit")) as unknown as {
      posts: Array<{ method: string; session: string | null }>
      failed: boolean
    }
    expect(result.failed).toBeTrue()
    expect(result.posts.filter((post) => post.method === "initialize")).toHaveLength(2)
    expect(result.posts.filter((post) => post.method === "ping" && post.session === "expired")).toHaveLength(1)
    expect(result.posts.filter((post) => post.method === "ping" && post.session === "replacement")).toHaveLength(1)
  })
})
