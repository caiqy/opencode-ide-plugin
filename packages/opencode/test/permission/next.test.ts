import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import { test, expect } from "bun:test"
import os from "os"
import path from "path"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { provideTmpdirInstance, provideTmpdirServer, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Approval } from "@opencode-ai/core/approval"
import { Session } from "../../src/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { reply as llmReply, TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { syncApproval } from "../../src/session/approval-sync"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = AppNodeBuilder.build(
  LayerNode.group([Permission.node, EventV2Bridge.node, CrossSpawnSpawner.node, InstanceStore.node]),
  [[InstanceStore.bootstrapNode, noopBootstrap]],
)
const it = testEffect(env)
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const guardianIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Permission.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      Session.node,
      SessionProjector.node,
      testLLMServerNode,
    ]),
    [[InstanceStore.bootstrapNode, noopBootstrap]],
  ),
)

const rejectAll = (message?: string) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (const req of yield* permission.list()) {
      yield* permission.reply({
        requestID: req.id,
        reply: "reject",
        message,
      })
    }
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === count) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
      }),
    )
  })

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
  })

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const withDir = <A, E, R>(options: { git?: boolean }, self: () => Effect.Effect<A, E, R>) =>
  provideTmpdirInstance(() => self(), options)

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const createGuardianSession = Effect.fn("Test.createGuardianSession")(function* (title: string) {
  return yield* (yield* Session.Service).create({ title, permission: [ApprovalV1.rule("automatic")] })
})

const guardianConfig = (url: string) => ({
  ...testProviderConfig(url),
  agent: { approval: { model: "test/test-model" } },
})

// fromConfig tests

test("fromConfig - string value becomes wildcard rule", () => {
  const result = Permission.fromConfig({ bash: "allow" })
  expect(result).toEqual([{ permission: "bash", pattern: "*", action: "allow" }])
})

test("fromConfig - object value converts to rules array", () => {
  const result = Permission.fromConfig({ bash: { "*": "allow", rm: "deny" } })
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
  ])
})

test("fromConfig - mixed string and object values", () => {
  const result = Permission.fromConfig({
    bash: { "*": "allow", rm: "deny" },
    edit: "allow",
    webfetch: "ask",
  })
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
    { permission: "edit", pattern: "*", action: "allow" },
    { permission: "webfetch", pattern: "*", action: "ask" },
  ])
})

test("fromConfig - empty object", () => {
  const result = Permission.fromConfig({})
  expect(result).toEqual([])
})

test("fromConfig - expands tilde to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "~/projects/*": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: `${os.homedir()}/projects/*`, action: "allow" }])
})

test("fromConfig - expands $HOME to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "$HOME/projects/*": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: `${os.homedir()}/projects/*`, action: "allow" }])
})

test("fromConfig - expands $HOME without trailing slash", () => {
  const result = Permission.fromConfig({ external_directory: { $HOME: "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: os.homedir(), action: "allow" }])
})

test("fromConfig - does not expand tilde in middle of path", () => {
  const result = Permission.fromConfig({ external_directory: { "/some/~/path": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: "/some/~/path", action: "allow" }])
})

// Permission precedence follows config insertion order. `evaluate()` uses the
// last matching rule, so later config entries intentionally override earlier
// entries even when a wildcard appears after a specific permission.

test("fromConfig - preserves top-level config key order", () => {
  const wildcardFirst = Permission.fromConfig({ "*": "deny", bash: "allow" })
  const specificFirst = Permission.fromConfig({ bash: "allow", "*": "deny" })

  expect(wildcardFirst.map((r) => r.permission)).toEqual(["*", "bash"])
  expect(specificFirst.map((r) => r.permission)).toEqual(["bash", "*"])

  expect(Permission.evaluate("bash", "ls", wildcardFirst).action).toBe("allow")
  expect(Permission.evaluate("bash", "ls", specificFirst).action).toBe("deny")
})

test("fromConfig - wildcard acts as fallback when it appears before specifics", () => {
  const ruleset = Permission.fromConfig({ "*": "ask", bash: "allow" })
  expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("ask")
  expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
})

test("fromConfig - top-level ordering is not sorted by wildcard specificity", () => {
  const ruleset = Permission.fromConfig({
    bash: "allow",
    "*": "ask",
    edit: "deny",
    "mcp_*": "allow",
  })
  expect(ruleset.map((r) => r.permission)).toEqual(["bash", "*", "edit", "mcp_*"])
})

test("fromConfig - sub-pattern insertion order inside a tool key is preserved", () => {
  const ruleset = Permission.fromConfig({ bash: { "*": "deny", "git *": "allow" } })
  expect(ruleset.map((r) => r.pattern)).toEqual(["*", "git *"])
  expect(Permission.evaluate("bash", "rm foo", ruleset).action).toBe("deny")
  expect(Permission.evaluate("bash", "git status", ruleset).action).toBe("allow")
})

test("fromConfig - documented fallback-first example", () => {
  const ruleset = Permission.fromConfig({ "*": "ask", bash: "allow", edit: "deny" })
  expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
  expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("deny")
  expect(Permission.evaluate("read", "foo.ts", ruleset).action).toBe("ask")
})

test("fromConfig - expands exact tilde to home directory", () => {
  const result = Permission.fromConfig({ external_directory: { "~": "allow" } })
  expect(result).toEqual([{ permission: "external_directory", pattern: os.homedir(), action: "allow" }])
})

test("evaluate - matches expanded tilde pattern", () => {
  const ruleset = Permission.fromConfig({ external_directory: { "~/projects/*": "allow" } })
  const result = Permission.evaluate("external_directory", `${os.homedir()}/projects/file.txt`, ruleset)
  expect(result.action).toBe("allow")
})

test("evaluate - matches expanded $HOME pattern", () => {
  const ruleset = Permission.fromConfig({ external_directory: { "$HOME/projects/*": "allow" } })
  const result = Permission.evaluate("external_directory", `${os.homedir()}/projects/file.txt`, ruleset)
  expect(result.action).toBe("allow")
})

// merge tests

test("merge - simple concatenation", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "bash", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "*", action: "deny" },
  ])
})

test("merge - adds new permission", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "edit", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "edit", pattern: "*", action: "deny" },
  ])
})

test("merge - concatenates rules for same permission", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "foo", action: "ask" }],
    [{ permission: "bash", pattern: "*", action: "deny" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "foo", action: "ask" },
    { permission: "bash", pattern: "*", action: "deny" },
  ])
})

test("merge - multiple rulesets", () => {
  const result = Permission.merge(
    [{ permission: "bash", pattern: "*", action: "allow" }],
    [{ permission: "bash", pattern: "rm", action: "ask" }],
    [{ permission: "edit", pattern: "*", action: "allow" }],
  )
  expect(result).toEqual([
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "ask" },
    { permission: "edit", pattern: "*", action: "allow" },
  ])
})

test("merge - empty ruleset does nothing", () => {
  const result = Permission.merge([{ permission: "bash", pattern: "*", action: "allow" }], [])
  expect(result).toEqual([{ permission: "bash", pattern: "*", action: "allow" }])
})

test("merge - preserves rule order", () => {
  const result = Permission.merge(
    [
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "src/secret/*", action: "deny" },
    ],
    [{ permission: "edit", pattern: "src/secret/ok.ts", action: "allow" }],
  )
  expect(result).toEqual([
    { permission: "edit", pattern: "src/*", action: "allow" },
    { permission: "edit", pattern: "src/secret/*", action: "deny" },
    { permission: "edit", pattern: "src/secret/ok.ts", action: "allow" },
  ])
})

test("merge - config permission overrides default ask", () => {
  const defaults: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "ask" }]
  const config: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const merged = Permission.merge(defaults, config)

  expect(Permission.evaluate("bash", "ls", merged).action).toBe("allow")
  expect(Permission.evaluate("edit", "foo.ts", merged).action).toBe("ask")
})

test("merge - config ask overrides default allow", () => {
  const defaults: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const config: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "ask" }]
  const merged = Permission.merge(defaults, config)

  expect(Permission.evaluate("bash", "ls", merged).action).toBe("ask")
})

// evaluate tests

test("evaluate - exact pattern match", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "bash", pattern: "rm", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard pattern match", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "bash", pattern: "*", action: "allow" }])
  expect(result.action).toBe("allow")
})

test("evaluate - last matching rule wins", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "rm", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - last matching rule wins (wildcard after specific)", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "rm", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - glob pattern match", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [{ permission: "edit", pattern: "src/*", action: "allow" }])
  expect(result.action).toBe("allow")
})

test("evaluate - last matching glob wins", () => {
  const result = Permission.evaluate("edit", "src/components/Button.tsx", [
    { permission: "edit", pattern: "src/*", action: "deny" },
    { permission: "edit", pattern: "src/components/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - order matters for specificity", () => {
  const result = Permission.evaluate("edit", "src/components/Button.tsx", [
    { permission: "edit", pattern: "src/components/*", action: "allow" },
    { permission: "edit", pattern: "src/*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - unknown permission returns ask", () => {
  const result = Permission.evaluate("unknown_tool", "anything", [
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("ask")
})

test("evaluate - empty ruleset returns ask", () => {
  const result = Permission.evaluate("bash", "rm", [])
  expect(result.action).toBe("ask")
})

test("evaluate - no matching pattern returns ask", () => {
  const result = Permission.evaluate("edit", "etc/passwd", [{ permission: "edit", pattern: "src/*", action: "allow" }])
  expect(result.action).toBe("ask")
})

test("evaluate - empty rules array returns ask", () => {
  const result = Permission.evaluate("bash", "rm", [])
  expect(result.action).toBe("ask")
})

test("evaluate - multiple matching patterns, last wins", () => {
  const result = Permission.evaluate("edit", "src/secret.ts", [
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "src/*", action: "allow" },
    { permission: "edit", pattern: "src/secret.ts", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - non-matching patterns are skipped", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [
    { permission: "edit", pattern: "*", action: "ask" },
    { permission: "edit", pattern: "test/*", action: "deny" },
    { permission: "edit", pattern: "src/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - exact match at end wins over earlier wildcard", () => {
  const result = Permission.evaluate("bash", "/bin/rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "/bin/rm", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard at end overrides earlier exact match", () => {
  const result = Permission.evaluate("bash", "/bin/rm", [
    { permission: "bash", pattern: "/bin/rm", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

// wildcard permission tests

test("evaluate - wildcard permission matches any permission", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "*", pattern: "*", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard permission with specific pattern", () => {
  const result = Permission.evaluate("bash", "rm", [{ permission: "*", pattern: "rm", action: "deny" }])
  expect(result.action).toBe("deny")
})

test("evaluate - glob permission pattern", () => {
  const result = Permission.evaluate("mcp_server_tool", "anything", [
    { permission: "mcp_*", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - specific permission and wildcard permission combined", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - wildcard permission does not match when specific exists", () => {
  const result = Permission.evaluate("edit", "src/foo.ts", [
    { permission: "*", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "src/*", action: "allow" },
  ])
  expect(result.action).toBe("allow")
})

test("evaluate - multiple matching permission patterns combine rules", () => {
  const result = Permission.evaluate("mcp_dangerous", "anything", [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "mcp_*", pattern: "*", action: "allow" },
    { permission: "mcp_dangerous", pattern: "*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - wildcard permission fallback for unknown tool", () => {
  const result = Permission.evaluate("unknown_tool", "anything", [
    { permission: "*", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "*", action: "allow" },
  ])
  expect(result.action).toBe("ask")
})

test("evaluate - later wildcard permission can override earlier specific permission", () => {
  const result = Permission.evaluate("bash", "rm", [
    { permission: "bash", pattern: "*", action: "allow" },
    { permission: "*", pattern: "*", action: "deny" },
  ])
  expect(result.action).toBe("deny")
})

test("evaluate - merges multiple rulesets", () => {
  const config: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
  const approved: PermissionV1.Ruleset = [{ permission: "bash", pattern: "rm", action: "deny" }]
  const result = Permission.evaluate("bash", "rm", config, approved)
  expect(result.action).toBe("deny")
})

// disabled tests

test("disabled - returns empty set when all tools allowed", () => {
  const result = Permission.disabled(["bash", "edit", "read"], [{ permission: "*", pattern: "*", action: "allow" }])
  expect(result.size).toBe(0)
})

test("disabled - full access keeps denied tools visible", () => {
  const result = Permission.disabled(
    ["bash", "edit", "read"],
    [{ permission: "*", pattern: "*", action: "deny" }, ApprovalV1.rule("full")],
  )
  expect(result).toEqual(new Set())
})

test("disabled - disables tool when denied", () => {
  const result = Permission.disabled(
    ["bash", "edit", "read"],
    [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(false)
  expect(result.has("read")).toBe(false)
})

test("disabled - disables edit/write/apply_patch when edit denied", () => {
  const result = Permission.disabled(
    ["edit", "write", "apply_patch", "bash"],
    [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("edit")).toBe(true)
  expect(result.has("write")).toBe(true)
  expect(result.has("apply_patch")).toBe(true)
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when partially denied", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when action is ask", () => {
  const result = Permission.disabled(["bash", "edit"], [{ permission: "*", pattern: "*", action: "ask" }])
  expect(result.size).toBe(0)
})

test("disabled - does not disable when specific allow after wildcard deny", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "echo *", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - does not disable when wildcard allow after deny", () => {
  const result = Permission.disabled(
    ["bash"],
    [
      { permission: "bash", pattern: "rm *", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
})

test("disabled - disables multiple tools", () => {
  const result = Permission.disabled(
    ["bash", "edit", "webfetch"],
    [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "webfetch", pattern: "*", action: "deny" },
    ],
  )
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(true)
  expect(result.has("webfetch")).toBe(true)
})

test("disabled - wildcard permission denies all tools", () => {
  const result = Permission.disabled(["bash", "edit", "read"], [{ permission: "*", pattern: "*", action: "deny" }])
  expect(result.has("bash")).toBe(true)
  expect(result.has("edit")).toBe(true)
  expect(result.has("read")).toBe(true)
})

test("disabled - specific allow overrides wildcard deny", () => {
  const result = Permission.disabled(
    ["bash", "edit", "read"],
    [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ],
  )
  expect(result.has("bash")).toBe(false)
  expect(result.has("edit")).toBe(true)
  expect(result.has("read")).toBe(true)
})

it.instance("ask - an explicit clear does not reactivate a stale full marker", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessionID = SessionID.make("session_cleared_stale_full")
    const ruleset = [ApprovalV1.rule("full")]
    Approval.runtime.set(sessionID, "full")
    Approval.runtime.clear(sessionID)
    const request = yield* permission
      .ask({
        sessionID,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset,
      })
      .pipe(Effect.forkScoped)

    const pending = (yield* waitForPending(1))[0]!
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("syncApproval closes full access before publishing a restrictive permission update", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create({ title: "Restrictive transition", permission: [ApprovalV1.rule("full")] })
    const child = yield* sessions.create({
      parentID: session.id,
      title: "Restrictive child",
      permission: [ApprovalV1.rule("full")],
    })
    Approval.runtime.set(session.id, "full")
    Approval.runtime.set(child.id, "full")
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== SessionV1.Event.Updated.type || (event.data as { info: Session.Info }).info.id !== session.id)
        return Effect.void
      return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const update = yield* syncApproval({ sessions, sessionID: session.id, approval: "manual" }).pipe(Effect.forkScoped)
    yield* Deferred.await(publishing)

    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(update)
    const pending = (yield* waitForPending(1))[0]!
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("syncApproval fences full access before publishing its durable marker", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const parent = yield* sessions.create({ title: "Full activation" })
    const child = yield* sessions.create({ parentID: parent.id, title: "Full child" })
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== SessionV1.Event.Updated.type || (event.data as { info: Session.Info }).info.id !== parent.id)
        return Effect.void
      return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const update = yield* syncApproval({ sessions, sessionID: parent.id, approval: "full" }).pipe(Effect.forkScoped)
    yield* Deferred.await(publishing)

    const request = yield* permission
      .ask({
        sessionID: parent.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)
    const pending = (yield* waitForPending(1))[0]!
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(update)
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("syncApproval drains requests admitted near the end of a full tree update", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const parent = yield* sessions.create({ title: "Full tree tail" })
    const child = yield* sessions.create({ parentID: parent.id, title: "Full tree child" })
    const grandchild = yield* sessions.create({ parentID: child.id, title: "Full tree grandchild" })
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const unsubscribe = yield* events.listen((event) => {
      if (
        event.type !== SessionV1.Event.Updated.type ||
        (event.data as { info: Session.Info }).info.id !== grandchild.id
      )
        return Effect.void
      return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const update = yield* syncApproval({ sessions, sessionID: parent.id, approval: "full" }).pipe(Effect.forkScoped)
    yield* Deferred.await(publishing)
    expect(Approval.runtime.get(child.id)).toBe("full")

    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)
    yield* waitForPending(1)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(update)

    expect(yield* permission.list()).toEqual([])
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("interrupting a full tree update cannot skip its final drain", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const parent = yield* sessions.create({ title: "Interrupted full tree" })
    const child = yield* sessions.create({ parentID: parent.id, title: "Interrupted full child" })
    const grandchild = yield* sessions.create({ parentID: child.id, title: "Interrupted full grandchild" })
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const unsubscribe = yield* events.listen((event) => {
      if (
        event.type !== SessionV1.Event.Updated.type ||
        (event.data as { info: Session.Info }).info.id !== grandchild.id
      )
        return Effect.void
      return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const update = yield* syncApproval({ sessions, sessionID: parent.id, approval: "full" }).pipe(Effect.forkScoped)
    yield* Deferred.await(publishing)

    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)
    yield* waitForPending(1)
    const interrupting = yield* Deferred.make<void>()
    const interrupt = yield* Effect.gen(function* () {
      yield* Deferred.succeed(interrupting, undefined)
      yield* Fiber.interrupt(update)
    }).pipe(Effect.forkScoped)
    yield* Deferred.await(interrupting)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(interrupt)

    expect(yield* permission.list()).toEqual([])
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("full activation stays fenced until its final drain completes", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const parent = yield* sessions.create({ title: "Fenced full finalization" })
    const child = yield* sessions.create({ parentID: parent.id, title: "Fenced full child" })
    const grandchild = yield* sessions.create({ parentID: child.id, title: "Fenced full grandchild" })
    const sibling = yield* sessions.create({ parentID: parent.id, title: "Blocked full sibling" })
    const treeBlocked = yield* Deferred.make<void>()
    const drainBlocked = yield* Deferred.make<void>()
    const releaseTree = yield* Deferred.make<void>()
    const releaseDrain = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() =>
      Effect.all([Deferred.succeed(releaseTree, undefined), Deferred.succeed(releaseDrain, undefined)]).pipe(
        Effect.asVoid,
      ),
    )
    const unsubscribe = yield* events.listen((event) => {
      if (
        event.type !== SessionV1.Event.Updated.type ||
        (event.data as { info: Session.Info }).info.id !== grandchild.id
      )
        return Effect.void
      return Deferred.succeed(treeBlocked, undefined).pipe(Effect.andThen(Deferred.await(releaseTree)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const full = yield* syncApproval({ sessions, sessionID: parent.id, approval: "full" }).pipe(Effect.forkScoped)
    yield* Deferred.await(treeBlocked)
    const unregister = Approval.runtime.register(
      sibling.id,
      Deferred.succeed(drainBlocked, undefined).pipe(Effect.andThen(Deferred.await(releaseDrain))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))
    yield* Deferred.succeed(releaseTree, undefined)
    yield* Deferred.await(drainBlocked)

    const late = yield* sessions.create({ parentID: child.id, title: "Late full child" })
    const finished = yield* Deferred.make<void>()
    const request = yield* permission
      .ask({
        sessionID: late.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.ensuring(Deferred.succeed(finished, undefined)), Effect.forkScoped)
    const admission = yield* Effect.race(
      Deferred.await(finished).pipe(Effect.as("full" as const)),
      waitForPending(1).pipe(Effect.as("pending" as const)),
    )
    yield* Deferred.succeed(releaseDrain, undefined)
    yield* Fiber.join(full)
    const remaining = yield* permission.list()
    if (remaining.length > 0) yield* permission.reply({ requestID: remaining[0]!.id, reply: "once" })
    yield* Fiber.join(request)
    expect(admission).toBe("pending")
    expect(remaining).toEqual([])
  }),
)

guardianIt.instance("child full does not drain through an ancestor restriction", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const parent = yield* sessions.create({ title: "Restricting full parent" })
    const child = yield* sessions.create({
      parentID: parent.id,
      title: "Restricted full child",
    })
    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      })
      .pipe(Effect.forkScoped)
    const pending = (yield* waitForPending(1))[0]!
    yield* sessions.setPermission({ sessionID: parent.id, permission: [ApprovalV1.rule("full")] })
    yield* sessions.setPermission({ sessionID: child.id, permission: [ApprovalV1.rule("full")] })
    Approval.runtime.set(parent.id, "full")
    const publishing = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let blocked = false
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    const restrictedSessions = {
      ...sessions,
      setPermission: (input: Parameters<typeof sessions.setPermission>[0]) =>
        sessions.setPermission(input).pipe(
          Effect.tap(() => {
            if (blocked || input.sessionID !== parent.id || !ApprovalV1.isTransitioning(input.permission))
              return Effect.void
            blocked = true
            return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
          }),
        ),
    }
    const restrict = yield* syncApproval({
      sessions: restrictedSessions,
      sessionID: parent.id,
      approval: "manual",
    }).pipe(Effect.forkScoped)
    yield* Deferred.await(publishing)

    yield* syncApproval({ sessions, sessionID: child.id, approval: "full" })
    const remaining = yield* permission.list()
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(restrict)
    if (remaining.length > 0) yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(request)
    expect(remaining).toEqual([pending])
  }),
)

guardianIt.instance("syncApproval does not drain a newer child manual request", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const parent = yield* sessions.create({ title: "Concurrent full parent" })
    const child = yield* sessions.create({ parentID: parent.id, title: "Concurrent manual child" })
    const grandchild = yield* sessions.create({ parentID: child.id, title: "Concurrent grandchild" })
    const fullBlocked = yield* Deferred.make<void>()
    const finalDrainBlocked = yield* Deferred.make<void>()
    const childUpdating = yield* Deferred.make<void>()
    const releaseTree = yield* Deferred.make<void>()
    const releaseDrain = yield* Deferred.make<void>()
    let blocked = false
    yield* Effect.addFinalizer(() =>
      Effect.all([Deferred.succeed(releaseTree, undefined), Deferred.succeed(releaseDrain, undefined)]).pipe(
        Effect.asVoid,
      ),
    )
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== SessionV1.Event.Updated.type) return Effect.void
      const sessionID = (event.data as { info: Session.Info }).info.id
      if (sessionID === child.id && blocked) return Deferred.succeed(childUpdating, undefined).pipe(Effect.asVoid)
      if (sessionID !== grandchild.id || blocked) return Effect.void
      blocked = true
      return Deferred.succeed(fullBlocked, undefined).pipe(Effect.andThen(Deferred.await(releaseTree)))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
    const full = yield* syncApproval({ sessions, sessionID: parent.id, approval: "full" }).pipe(Effect.forkScoped)
    yield* Deferred.await(fullBlocked)
    const unregister = Approval.runtime.register(
      parent.id,
      Deferred.succeed(finalDrainBlocked, undefined).pipe(Effect.andThen(Deferred.await(releaseDrain))),
    )
    yield* Effect.addFinalizer(() => Effect.sync(unregister))
    const manual = yield* syncApproval({ sessions, sessionID: child.id, approval: "manual" }).pipe(Effect.forkScoped)
    yield* Deferred.succeed(releaseTree, undefined)
    yield* Deferred.await(finalDrainBlocked)
    yield* Deferred.await(childUpdating)
    while (Approval.runtime.get(child.id) !== "manual") yield* Effect.yieldNow

    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)
    yield* waitForPending(1)
    yield* Deferred.succeed(releaseDrain, undefined)
    yield* Fiber.join(full)
    yield* Fiber.join(manual)

    const pending = (yield* permission.list())[0]!
    expect(pending).toBeDefined()
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(request)
  }),
)

guardianIt.instance("syncApproval keeps a durable fence when descendant persistence fails", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const sessions = yield* Session.Service
    const parent = yield* sessions.create({ title: "Failed tree transition", permission: [ApprovalV1.rule("full")] })
    const child = yield* sessions.create({
      parentID: parent.id,
      title: "Failed child transition",
      permission: [ApprovalV1.rule("full")],
    })
    Approval.runtime.set(parent.id, "full")
    Approval.runtime.set(child.id, "full")
    const broken = {
      ...sessions,
      setPermission: (input: Parameters<typeof sessions.setPermission>[0]) =>
        input.sessionID === child.id ? Effect.die("child write failed") : sessions.setPermission(input),
    }

    const target = [{ permission: "read", pattern: "*", action: "allow" as const }]
    expect(
      Exit.isFailure(
        yield* syncApproval({ sessions: broken, sessionID: parent.id, permission: target }).pipe(Effect.exit),
      ),
    ).toBe(true)
    yield* Approval.runtime.dispose(parent.id)
    yield* Approval.runtime.dispose(child.id)
    const request = yield* permission
      .ask({
        sessionID: child.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
        ruleset: [ApprovalV1.rule("full")],
      })
      .pipe(Effect.forkScoped)

    const pending = (yield* waitForPending(1))[0]!
    yield* permission.reply({ requestID: pending.id, reply: "once" })
    yield* Fiber.join(request)
    expect(ApprovalV1.isTransitioning((yield* sessions.get(parent.id)).permission ?? [])).toBe(true)

    yield* syncApproval({ sessions, sessionID: parent.id, permission: target })
    expect(ApprovalV1.isTransitioning((yield* sessions.get(parent.id)).permission ?? [])).toBe(false)
    expect((yield* sessions.get(child.id)).permission).not.toContainEqual(
      expect.objectContaining({ permission: ApprovalV1.RulePermission }),
    )
  }),
)

guardianIt.live("automatic review does not settle while an ancestor transition is active", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "Automatic transition" })
        const child = yield* sessions.create({
          parentID: parent.id,
          title: "Automatic child",
          permission: [ApprovalV1.rule("manual")],
        })
        Approval.runtime.set(child.id, "manual")
        const request = yield* permission
          .ask({
            sessionID: child.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [ApprovalV1.rule("manual")],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        Approval.runtime.set(child.id, "automatic")
        const releaseReview = Promise.withResolvers<void>()
        yield* llm.push(
          llmReply()
            .wait(releaseReview.promise)
            .tool("guardian_decision", {
              risk_level: "low",
              user_authorization: "high",
              outcome: "allow",
              rationale: "The command is read-only.",
            })
            .item(),
        )
        const review = yield* Approval.runtime.review(child.id).pipe(Effect.forkScoped)
        yield* llm.wait(1)
        const releaseFence = yield* Deferred.make<void>()
        const fenceStarted = yield* Deferred.make<void>()
        const fence = yield* Approval.runtime
          .withRestriction(
            parent.id,
            Deferred.succeed(fenceStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFence))),
          )
          .pipe(Effect.forkScoped)
        yield* Deferred.await(fenceStarted)
        releaseReview.resolve()
        yield* Fiber.join(review)

        expect(yield* permission.list()).toHaveLength(1)
        const pending = (yield* permission.list())[0]!
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        yield* Deferred.succeed(releaseFence, undefined)
        yield* Fiber.join(fence)
        yield* Fiber.join(request)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("direct automatic ask rechecks an ancestor transition after Guardian returns", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessions = yield* Session.Service
        const parent = yield* sessions.create({ title: "Direct automatic transition" })
        const child = yield* sessions.create({ parentID: parent.id, title: "Direct automatic child" })
        Approval.runtime.set(child.id, "automatic")
        const releaseReview = Promise.withResolvers<void>()
        yield* llm.push(
          llmReply()
            .wait(releaseReview.promise)
            .tool("guardian_decision", {
              risk_level: "low",
              user_authorization: "high",
              outcome: "allow",
              rationale: "The command is read-only.",
            })
            .item(),
        )
        const request = yield* permission
          .ask({
            sessionID: child.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [ApprovalV1.rule("automatic")],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* llm.wait(1)
        const releaseFence = yield* Deferred.make<void>()
        const fenceStarted = yield* Deferred.make<void>()
        const fence = yield* Approval.runtime
          .withRestriction(
            parent.id,
            Deferred.succeed(fenceStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFence))),
          )
          .pipe(Effect.forkScoped)
        yield* Deferred.await(fenceStarted)
        releaseReview.resolve()

        const pending = (yield* waitForPending(1))[0]!
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        yield* Deferred.succeed(releaseFence, undefined)
        yield* Fiber.join(fence)
        yield* Fiber.join(request)
      }),
    { git: true, config: guardianConfig },
  ),
)

// ask tests

guardianIt.live("automatic Guardian reviews Session transcript with a real read-tool continuation", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "README.md"), "guardian evidence"))
        const sessions = yield* Session.Service
        const session = yield* sessions.create({ title: "Guardian", permission: [ApprovalV1.rule("automatic")] })
        const messageID = MessageID.ascending()
        yield* sessions.updateMessage({
          id: messageID,
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          tools: {},
          mode: "",
        } as unknown as SessionV1.Info)
        yield* sessions.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID,
          type: "text",
          text: "Inspect README.md before approving this edit.",
        })
        expect(yield* sessions.messages({ sessionID: session.id, limit: 200 })).toHaveLength(1)
        yield* llm.push(
          llmReply().tool("glob", { pattern: "README.md" }),
          llmReply().tool("guardian_decision", {
            risk_level: "low",
            user_authorization: "high",
            outcome: "allow",
            rationale: "The requested edit is scoped and reversible.",
          }),
        )
        const permission = yield* Permission.Service
        const review = yield* permission
          .ask({
            sessionID: session.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write", reason: "Implement the requested change" },
            always: [],
            ruleset: session.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)

        yield* llm.wait(1)
        yield* llm.wait(2)
        yield* Fiber.join(review)
        expect(yield* permission.list()).toEqual([])
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs[0])).toContain("Inspect README.md before approving this edit.")
        expect(
          (inputs[0]?.messages as Array<{ role?: string; content?: string }>).find((message) => message.role === "user")
            ?.content,
        ).toContain(`"cwd": ${JSON.stringify(dir)}`)
        expect(
          ((inputs[0]?.tools ?? []) as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .filter((name): name is string => name !== undefined)
            .toSorted(),
        ).toEqual(["glob", "grep", "guardian_decision", "read"])
        expect(JSON.stringify(inputs[1])).toContain("README.md")
      }),
    {
      git: true,
      config: guardianConfig,
    },
  ),
)

guardianIt.live("automatic Guardian denies explicit risks and keeps uncertain results pending", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const denied = yield* createGuardianSession("Guardian deny")
        yield* llm.tool("guardian_decision", {
          risk_level: "high",
          user_authorization: "unknown",
          outcome: "deny",
          rationale: "The destructive action was not authorized.",
        })
        expect(
          yield* fail(
            permission.ask({
              sessionID: denied.id,
              permission: "bash",
              patterns: ["rm -rf important"],
              metadata: { tool: "bash" },
              always: [],
              ruleset: denied.permission ?? [],
              toolName: "bash",
            }),
          ),
        ).toBeInstanceOf(PermissionV1.RejectedError)
        expect(yield* permission.list()).toEqual([])

        const uncertain = yield* createGuardianSession("Guardian ask")
        yield* llm.tool("guardian_decision", {
          risk_level: "medium",
          user_authorization: "low",
          outcome: "ask",
          rationale: "The target is ambiguous.",
        })
        const review = yield* permission
          .ask({
            sessionID: uncertain.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: uncertain.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        const pending = (yield* waitForPending(1))[0]!
        expect(pending.sessionID).toBe(uncertain.id)
        yield* permission.reply({ requestID: pending.id, reply: "reject" })
        expect(Exit.isFailure(yield* Fiber.await(review))).toBe(true)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("automatic Guardian falls back after a failed investigation or the final decision turn", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const failed = yield* createGuardianSession("Guardian tool failure")
        yield* llm.tool("glob", { pattern: "*", path: path.dirname(dir) })
        const failedReview = yield* permission
          .ask({
            sessionID: failed.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: failed.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        const failedPending = (yield* waitForPending(1))[0]!
        yield* permission.reply({ requestID: failedPending.id, reply: "reject" })
        expect(Exit.isFailure(yield* Fiber.await(failedReview))).toBe(true)

        const exhausted = yield* createGuardianSession("Guardian exhausted")
        yield* llm.push(
          llmReply().tool("glob", { pattern: "README.md" }),
          llmReply().tool("glob", { pattern: "README.md" }),
          llmReply().tool("glob", { pattern: "README.md" }),
          llmReply().tool("glob", { pattern: "README.md" }),
        )
        const exhaustedReview = yield* permission
          .ask({
            sessionID: exhausted.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: exhausted.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        const exhaustedPending = (yield* waitForPending(1))[0]!
        const inputs = yield* llm.inputs
        expect(
          ((inputs.at(-1)?.tools ?? []) as Array<{ function?: { name?: string } }>)
            .map((tool) => tool.function?.name)
            .filter((name): name is string => name !== undefined),
        ).toEqual(["guardian_decision"])
        yield* permission.reply({ requestID: exhaustedPending.id, reply: "reject" })
        expect(Exit.isFailure(yield* Fiber.await(exhaustedReview))).toBe(true)
      }),
    { git: true, config: guardianConfig },
  ),
)

const guardianFallback = (name: string, build: (dir: string) => ReturnType<typeof llmReply>[]) =>
  guardianIt.live(name, () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const session = yield* createGuardianSession(`Guardian ${name}`)
          yield* llm.push(...build(dir))
          const review = yield* permission
            .ask({
              sessionID: session.id,
              permission: "edit",
              patterns: ["src/index.ts"],
              metadata: { tool: "write" },
              always: [],
              ruleset: session.permission ?? [],
              toolName: "write",
            })
            .pipe(Effect.forkScoped)
          const pending = (yield* waitForPending(1))[0]!
          expect(pending.permission).toBe("edit")
          yield* permission.reply({ requestID: pending.id, reply: "reject" })
          expect(Exit.isFailure(yield* Fiber.await(review))).toBe(true)
        }),
      { git: true, config: guardianConfig },
    ),
  )

guardianIt.live("automatic Guardian binds builtin read/glob/grep over same-named custom tools", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "README.md"), "guardian evidence"))
        const toolDir = path.join(dir, ".opencode", "tool")
        yield* Effect.promise(() =>
          Bun.write(
            path.join(toolDir, "read.ts"),
            "export default { description: 'custom read', args: {}, execute: async () => 'CUSTOM READ OUTPUT' }",
          ),
        )
        const session = yield* createGuardianSession("Guardian builtin tools")
        yield* llm.push(
          llmReply().tool("read", { filePath: path.join(dir, "README.md") }),
          llmReply().tool("guardian_decision", {
            risk_level: "low",
            user_authorization: "high",
            outcome: "allow",
            rationale: "scoped and reversible",
          }),
        )
        const permission = yield* Permission.Service
        const review = yield* permission
          .ask({
            sessionID: session.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: session.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        yield* llm.wait(2)
        yield* Fiber.join(review)
        const inputs = yield* llm.inputs
        expect(JSON.stringify(inputs[1])).toContain("guardian evidence")
        expect(JSON.stringify(inputs[1])).not.toContain("CUSTOM READ OUTPUT")
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("automatic Guardian retains the first user request in a long session transcript", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const session = yield* sessions.create({
          title: "Guardian long transcript",
          permission: [ApprovalV1.rule("automatic")],
        })
        const first = "AUTHORIZE the migration of the payment service to the new ledger."
        for (let i = 0; i < 201; i++) {
          const id = MessageID.ascending()
          yield* sessions.updateMessage({
            id,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() + i },
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            tools: {},
            mode: "",
          } as unknown as SessionV1.Info)
          yield* sessions.updatePart({
            id: PartID.ascending(),
            sessionID: session.id,
            messageID: id,
            type: "text",
            text: i === 0 ? first : `filler ${i} `.repeat(40),
          })
        }
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "authorized by the first request",
        })
        const permission = yield* Permission.Service
        const review = yield* permission
          .ask({
            sessionID: session.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: session.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        yield* llm.wait(1)
        yield* Fiber.join(review)
        const prompt = JSON.stringify((yield* llm.inputs)[0])
        expect(prompt).toContain(first)
        expect(prompt).toContain("Some conversation entries were omitted.")
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("automatic Guardian falls back to ask when a round mixes investigation with a decision", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "README.md"), "guardian evidence"))
        const permission = yield* Permission.Service
        const session = yield* createGuardianSession("Guardian mixed round")
        yield* llm.push(
          llmReply().tool("glob", { pattern: "README.md" }).tool("guardian_decision", {
            risk_level: "low",
            user_authorization: "high",
            outcome: "allow",
            rationale: "scoped and reversible",
          }),
        )
        const review = yield* permission
          .ask({
            sessionID: session.id,
            permission: "edit",
            patterns: ["src/index.ts"],
            metadata: { tool: "write" },
            always: [],
            ruleset: session.permission ?? [],
            toolName: "write",
          })
          .pipe(Effect.forkScoped)
        const pending = (yield* waitForPending(1))[0]!
        expect(pending.permission).toBe("edit")
        yield* permission.reply({ requestID: pending.id, reply: "reject" })
        expect(Exit.isFailure(yield* Fiber.await(review))).toBe(true)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianFallback("automatic Guardian falls back to ask when a round returns multiple decisions", () => [
  llmReply()
    .tool("guardian_decision", {
      risk_level: "high",
      user_authorization: "unknown",
      outcome: "deny",
      rationale: "first decision",
    })
    .tool("guardian_decision", {
      risk_level: "low",
      user_authorization: "high",
      outcome: "allow",
      rationale: "second decision",
    }),
])

guardianFallback("automatic Guardian falls back to ask when a decision shares a round with a failed tool", (dir) => [
  llmReply()
    .tool("glob", { pattern: "*", path: path.dirname(dir) })
    .tool("guardian_decision", {
      risk_level: "low",
      user_authorization: "high",
      outcome: "allow",
      rationale: "scoped and reversible",
    }),
])

guardianFallback("automatic Guardian falls back to ask for a critical allow", () => [
  llmReply().tool("guardian_decision", {
    risk_level: "critical",
    user_authorization: "high",
    outcome: "allow",
    rationale: "incorrect critical allow",
  }),
])

guardianFallback("automatic Guardian falls back to ask for a low-authorization high-risk allow", () => [
  llmReply().tool("guardian_decision", {
    risk_level: "high",
    user_authorization: "low",
    outcome: "allow",
    rationale: "insufficient authorization",
  }),
])

it.instance(
  "ask - resolves immediately when action is allow",
  () =>
    Effect.gen(function* () {
      const result = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      expect(result).toBeUndefined()
    }),
  { git: true },
)

it.instance(
  "ask - full access bypasses permission rules",
  () =>
    Effect.gen(function* () {
      const result = yield* ask({
        sessionID: SessionID.make("session_full_access"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "deny" }, ApprovalV1.rule("full")],
      })
      expect(result).toBeUndefined()
      expect(yield* list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "ask - full ruleset rejects when lifecycle changes while loading state",
  () =>
    Effect.gen(function* () {
      const sessionID = SessionID.make("session_full_lifecycle")
      const instance = yield* InstanceRef
      if (!instance) throw new Error("InstanceRef not provided")
      let disposed = false

      const error = yield* fail(
        ask({
          sessionID,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [ApprovalV1.rule("full")],
        }).pipe(
          Effect.provideService(InstanceRef, {
            ...instance,
            get directory() {
              if (!disposed) {
                disposed = true
                Effect.runSync(Approval.runtime.dispose(sessionID))
              }
              return instance.directory
            },
          }),
        ),
      )

      expect(error).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "ask - full ruleset retries when approval changes while checking ancestors",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_full_revision")
      Approval.runtime.set(sessionID, "full")
      let changed = false
      const isRestricting = Approval.runtime.isRestricting
      Approval.runtime.isRestricting = (current) => {
        if (current === sessionID && !changed) {
          changed = true
          Approval.runtime.set(sessionID, "manual")
        }
        return isRestricting(current)
      }
      yield* Effect.addFinalizer(() => Effect.sync(() => (Approval.runtime.isRestricting = isRestricting)))

      const error = yield* fail(
        permission.ask({
          sessionID,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }, ApprovalV1.rule("full")],
        }),
      )

      expect(changed).toBe(true)
      expect(error).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

guardianIt.instance(
  "ask - full ruleset notices a restriction established while loading the Session",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const session = yield* sessions.create({ title: "Restriction lookup" })
      Approval.runtime.set(session.id, "full")
      let checks = 0
      const isRestricting = Approval.runtime.isRestricting
      Approval.runtime.isRestricting = (sessionID) => sessionID === session.id && ++checks > 1
      yield* Effect.addFinalizer(() => Effect.sync(() => (Approval.runtime.isRestricting = isRestricting)))

      const error = yield* fail(
        permission.ask({
          sessionID: session.id,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }, ApprovalV1.rule("full")],
        }),
      )

      expect(checks).toBeGreaterThan(1)
      expect(error).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

it.instance(
  "ask - full gate bypasses a stale ruleset",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_full_gate")
      yield* permission.setApproval({ sessionID, approval: "full" })

      yield* permission.ask({
        sessionID,
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
      })
      expect(yield* permission.list()).toEqual([])
    }),
  { git: true },
)

it.instance(
  "ask - manual gate overrides a stale full ruleset",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_manual_gate")
      yield* permission.setApproval({ sessionID, approval: "manual" })

      const error = yield* fail(
        permission.ask({
          sessionID,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }, ApprovalV1.rule("full")],
        }),
      )
      expect(error).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

it.instance(
  "ask - full gate clears pending requests",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_full_gate_pending")
      const request = yield* permission
        .ask({
          sessionID,
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        .pipe(Effect.forkScoped)
      yield* waitForPending(1)

      yield* permission.setApproval({ sessionID, approval: "full" })
      yield* Fiber.join(request)
      expect(yield* permission.list()).toEqual([])
    }),
  { git: true },
)

guardianIt.live("setApproval - automatic reviews an existing pending request", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "Pending automatic review" })
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The user authorized this read-only command.",
        })

        yield* permission.setApproval({ sessionID: session.id, approval: "automatic" })

        yield* Fiber.join(request)
        expect(yield* permission.list()).toEqual([])
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval - automatic settles each pending request independently", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "Multiple automatic reviews" })
        const request = (pattern: string) =>
          permission
            .ask({
              sessionID: session.id,
              permission: "bash",
              patterns: [pattern],
              metadata: {},
              always: [],
              ruleset: [],
              toolName: "bash",
            })
            .pipe(Effect.forkScoped)
        const denied = yield* request("rm important")
        const allowed = yield* request("git status")
        yield* waitForPending(2)
        yield* llm.tool("guardian_decision", {
          risk_level: "high",
          user_authorization: "unknown",
          outcome: "deny",
          rationale: "The destructive action was not authorized.",
        })
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The read-only command was authorized.",
        })

        yield* permission.setApproval({ sessionID: session.id, approval: "automatic" })

        expect(Exit.isFailure(yield* Fiber.await(denied))).toBe(true)
        expect(Exit.isSuccess(yield* Fiber.await(allowed))).toBe(true)
        expect(yield* permission.list()).toEqual([])
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval - automatic does not publish Replied before Asked", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const events = yield* EventV2Bridge.Service
        const session = yield* sessions.create({ title: "Ordered automatic review" })
        const asked = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const order: string[] = []
        const unsubscribe = yield* events.listen((event) => {
          if (event.type === Permission.Event.Asked.type) {
            order.push("asked")
            return Deferred.succeed(asked, undefined).pipe(Effect.andThen(Deferred.await(release)))
          }
          if (event.type === Permission.Event.Replied.type) order.push("replied")
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(asked)
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The read-only command was authorized.",
        })
        const update = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.forkScoped)
        yield* Effect.yieldNow

        expect(order).toEqual(["asked"])
        expect(yield* llm.inputs).toEqual([])
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(update)
        yield* Fiber.join(request)
        expect(order).toEqual(["asked", "replied"])
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval - automatic ignores a Guardian result after switching to manual", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "Stale automatic review" })
        const release = Promise.withResolvers<void>()
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.push(
          llmReply()
            .wait(release.promise)
            .tool("guardian_decision", {
              risk_level: "low",
              user_authorization: "high",
              outcome: "allow",
              rationale: "The read-only command was authorized.",
            })
            .item(),
        )
        const automatic = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.forkScoped)
        yield* llm.wait(1)

        yield* permission.setApproval({ sessionID: session.id, approval: "manual" })
        release.resolve()
        yield* Fiber.join(automatic)

        const pending = yield* permission.list()
        expect(pending).toHaveLength(1)
        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
        yield* Fiber.join(request)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("runtime review settles pending requests after an external automatic sync", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "External automatic review" })
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The read-only command was authorized.",
        })

        Approval.runtime.set(session.id, "automatic")
        yield* Approval.runtime.review(session.id)

        expect(yield* permission.list()).toEqual([])
        yield* Fiber.join(request)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval coalesces concurrent automatic reviews", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "Concurrent automatic review" })
        const release = Promise.withResolvers<void>()
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.push(
          llmReply()
            .wait(release.promise)
            .tool("guardian_decision", {
              risk_level: "low",
              user_authorization: "high",
              outcome: "allow",
              rationale: "The read-only command was authorized.",
            })
            .item(),
        )
        const first = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.forkScoped)
        yield* llm.wait(1)
        const second = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.forkScoped)
        yield* Effect.yieldNow

        release.resolve()
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(yield* llm.calls).toBe(1)
        yield* Fiber.join(request)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval - claims an automatic result before publishing Replied", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const events = yield* EventV2Bridge.Service
        const session = yield* sessions.create({ title: "Automatic terminal claim" })
        const publishing = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Permission.Event.Replied.type) return Effect.void
          return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The read-only command was authorized.",
        })
        const automatic = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.forkScoped)
        yield* Deferred.await(publishing)

        expect(yield* permission.list()).toEqual([])
        const manual = yield* permission
          .setApproval({ sessionID: session.id, approval: "manual" })
          .pipe(Effect.forkScoped)
        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(automatic)
        yield* Fiber.join(request)
        yield* Fiber.join(manual)
        expect(Approval.runtime.get(session.id)).toBe("manual")
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.live("setApproval - rejects an automatic result when Replied publication fails", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const events = yield* EventV2Bridge.Service
        const session = yield* sessions.create({ title: "Failed automatic publication" })
        const unsubscribe = yield* events.listen((event) =>
          event.type === Permission.Event.Replied.type ? Effect.die("listener failed") : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
            toolName: "bash",
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)
        yield* llm.tool("guardian_decision", {
          risk_level: "low",
          user_authorization: "high",
          outcome: "allow",
          rationale: "The read-only command was authorized.",
        })

        const automatic = yield* permission
          .setApproval({ sessionID: session.id, approval: "automatic" })
          .pipe(Effect.exit)

        expect(Exit.isSuccess(automatic)).toBe(true)
        expect(yield* permission.list()).toEqual([])
        expect(yield* Fiber.join(request).pipe(Effect.flip)).toBeInstanceOf(PermissionV1.RejectedError)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.instance(
  "full and remove reject pending requests when Replied publication fails",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const unsubscribe = yield* events.listen((event) =>
        event.type === Permission.Event.Replied.type ? Effect.die("listener failed") : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      for (const action of ["full", "remove"] as const) {
        const session = yield* sessions.create({ title: `Failed ${action} publication` })
        const request = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["git status"],
            metadata: {},
            always: [],
            ruleset: [],
          })
          .pipe(Effect.forkScoped)
        yield* waitForPending(1)

        const terminal = yield* (
          action === "full"
            ? permission.setApproval({ sessionID: session.id, approval: "full" })
            : sessions.remove(session.id)
        ).pipe(Effect.exit)

        expect(Exit.isSuccess(terminal)).toBe(true)
        expect(yield* permission.list()).toEqual([])
        expect(yield* Fiber.join(request).pipe(Effect.flip)).toBeInstanceOf(PermissionV1.RejectedError)
      }
    }),
  { git: true },
)

guardianIt.instance(
  "remove - rejects V1 pending requests before removing their Session",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Pending deletion" })
      const permission = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const order: string[] = []
      const unsubscribe = yield* events.listen((event) => {
        if (
          event.type === Permission.Event.Asked.type ||
          event.type === Permission.Event.Replied.type ||
          event.type === SessionV1.Event.Deleted.type
        ) {
          order.push(event.type)
        }
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const request = yield* permission
        .ask({
          sessionID: session.id,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: session.permission ?? [],
        })
        .pipe(Effect.forkScoped)
      const pending = (yield* waitForPending(1))[0]!

      yield* sessions.remove(session.id)

      expect(yield* permission.list()).toEqual([])
      expect(Exit.isFailure(yield* Fiber.await(request))).toBe(true)
      expect(order).toEqual([Permission.Event.Asked.type, Permission.Event.Replied.type, SessionV1.Event.Deleted.type])
      expect(pending.sessionID).toBe(session.id)
    }),
  { git: true },
)

guardianIt.live("ask - does not register a V1 evaluator after deletion and same-ID recreation", () =>
  provideTmpdirServer(
    ({ llm }) =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const events = yield* EventV2Bridge.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({ title: "Lifecycle", permission: [ApprovalV1.rule("automatic")] })
        const release = Promise.withResolvers<void>()
        const outcome = yield* Deferred.make<"asked" | "failed" | "completed">()
        const unsubscribe = yield* events.listen((event) =>
          event.type === Permission.Event.Asked.type
            ? Deferred.succeed(outcome, "asked").pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* llm.hold("waiting", release.promise)
        const old = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: session.permission ?? [],
          })
          .pipe(Effect.forkScoped)
        yield* Fiber.await(old).pipe(
          Effect.flatMap((exit) => Deferred.succeed(outcome, Exit.isFailure(exit) ? "failed" : "completed")),
          Effect.forkScoped,
        )

        yield* llm.wait(1)
        yield* sessions.remove(session.id)
        yield* events.publish(SessionV1.Event.Created, { sessionID: session.id, info: session })
        release.resolve()

        expect(yield* Deferred.await(outcome)).toBe("failed")
        expect(yield* Fiber.join(old).pipe(Effect.flip)).toBeInstanceOf(PermissionV1.RejectedError)
        expect(yield* permission.list()).toEqual([])

        const next = yield* permission
          .ask({
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          })
          .pipe(Effect.forkScoped)
        const pending = (yield* waitForPending(1))[0]!
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        yield* Fiber.join(next)
      }),
    { git: true, config: guardianConfig },
  ),
)

guardianIt.instance(
  "remove - serializes deletion after an already queued approval update",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ title: "Approval deletion race" })
      const permission = yield* Permission.Service
      const [approval, deletion] = yield* Approval.runtime.withUpdate(session.id)(
        Effect.gen(function* () {
          const approval = yield* permission
            .setApproval({ sessionID: session.id, approval: "full" })
            .pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          expect(Approval.runtime.get(session.id)).toBeUndefined()
          const deletion = yield* sessions.remove(session.id).pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          return [approval, deletion] as const
        }),
      )

      yield* Fiber.join(approval)
      yield* Fiber.join(deletion)

      expect(Approval.runtime.get(session.id)).toBeUndefined()
    }),
  { git: true },
)

it.instance(
  "ask - full gate drains pending requests registered by another permission protocol",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_cross_protocol_pending")
      const drained = yield* Deferred.make<void>()
      let calls = 0
      const unregister = Approval.runtime.register(
        sessionID,
        Effect.sync(() => calls++).pipe(Effect.andThen(Deferred.succeed(drained, undefined))),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unregister))

      yield* permission.setApproval({ sessionID, approval: "full" })

      expect(yield* Deferred.isDone(drained)).toBe(true)
      expect(calls).toBe(1)
    }),
  { git: true },
)

it.instance(
  "ask - full gate is not visible before existing pending requests drain",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("session_full_activation_order")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const unregister = Approval.runtime.register(
        sessionID,
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unregister))

      const update = yield* permission.setApproval({ sessionID, approval: "full" }).pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      expect(Approval.runtime.get(sessionID)).not.toBe("full")

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(update)
      expect(Approval.runtime.get(sessionID)).toBe("full")
    }),
  { git: true },
)

it.instance(
  "reply - interruption cannot orphan a pending waiter",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const request = yield* permission
        .ask({
          sessionID: SessionID.make("session_interrupt_reply"),
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        .pipe(Effect.forkScoped)
      const pending = (yield* waitForPending(1))[0]!
      const replying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((event) =>
        event.type === Permission.Event.Replied.type &&
        (event.data as { requestID: PermissionV1.ID }).requestID === pending.id
          ? Deferred.succeed(replying, undefined).pipe(Effect.andThen(Deferred.await(release)))
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const response = yield* permission.reply({ requestID: pending.id, reply: "once" }).pipe(Effect.forkScoped)
      yield* Deferred.await(replying)
      const interrupted = yield* Fiber.interrupt(response).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(interrupted)
      yield* Effect.yieldNow

      expect(request.pollUnsafe()).toBeDefined()
    }),
  { git: true },
)

it.instance(
  "reply - manual reply racing full access publishes one terminal event",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const sessionID = SessionID.make("session_reply_full_race")
      const request = yield* permission
        .ask({
          sessionID,
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })
        .pipe(Effect.forkScoped)
      const pending = (yield* waitForPending(1))[0]!
      const replying = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const replies: PermissionV1.ID[] = []
      const unsubscribe = yield* events.listen((event) => {
        if (event.type !== Permission.Event.Replied.type) return Effect.void
        const id = (event.data as { requestID: PermissionV1.ID }).requestID
        if (id !== pending.id) return Effect.void
        replies.push(id)
        return Deferred.succeed(replying, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const manual = yield* permission.reply({ requestID: pending.id, reply: "once" }).pipe(Effect.forkScoped)
      yield* Deferred.await(replying)
      const full = yield* permission.setApproval({ sessionID, approval: "full" }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(manual)
      yield* Fiber.join(full)
      yield* Fiber.join(request)

      expect(replies).toEqual([pending.id])
    }),
  { git: true },
)

it.instance(
  "ask - rejects a duplicate pending request ID without replacing the waiter",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const id = PermissionV1.ID.ascending("per_duplicate_pending")
      const input = {
        id,
        sessionID: SessionID.make("session_duplicate_pending"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }
      const first = yield* permission.ask(input).pipe(Effect.forkScoped)
      yield* waitForPending(1)

      const duplicate = yield* permission.ask(input).pipe(Effect.exit)

      expect(Exit.isFailure(duplicate) && Cause.squash(duplicate.cause)).toBeInstanceOf(Error)
      expect(yield* permission.list()).toHaveLength(1)
      yield* permission.reply({ requestID: id, reply: "once" })
      yield* Fiber.join(first)
    }),
  { git: true },
)

it.instance(
  "reply - stale cleanup cannot delete a new request reusing the same ID",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const events = yield* EventV2Bridge.Service
      const id = PermissionV1.ID.ascending("per_reused_pending")
      const input = {
        id,
        sessionID: SessionID.make("session_reused_pending"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }
      const old = yield* permission.ask(input).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      const publishing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let first = true
      const unsubscribe = yield* events.listen((event) => {
        if (event.type !== Permission.Event.Replied.type) return Effect.void
        if ((event.data as { requestID: PermissionV1.ID }).requestID !== id || !first) return Effect.void
        first = false
        return Deferred.succeed(publishing, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const oldReply = yield* permission.reply({ requestID: id, reply: "once" }).pipe(Effect.forkScoped)
      yield* Deferred.await(publishing)
      yield* Fiber.interrupt(old)
      expect(yield* permission.list()).toEqual([])
      const next = yield* permission.ask(input).pipe(Effect.forkScoped)
      yield* waitForPending(1)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(oldReply)

      expect(yield* permission.list()).toHaveLength(1)
      yield* permission.reply({ requestID: id, reply: "once" })
      yield* Fiber.join(next)
    }),
  { git: true },
)

it.instance(
  "ask - throws DeniedError when action is deny",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      )
      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

it.live("ask - override deny wins over live always approval", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const first = yield* ask({
        id: PermissionV1.ID.make("per_skill_allow"),
        sessionID: SessionID.make("session_test"),
        permission: "skill",
        patterns: ["brainstorming"],
        metadata: {},
        always: ["brainstorming"],
        ruleset: Permission.fromConfig({ skill: "ask" }),
      }).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* reply({ requestID: PermissionV1.ID.make("per_skill_allow"), reply: "always" })
      yield* Fiber.join(first)

      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "skill",
          patterns: ["brainstorming"],
          metadata: {},
          always: ["brainstorming"],
          ruleset: Permission.merge(
            Permission.fromConfig({ skill: "ask" }),
            Permission.fromConfig({ skill: { brainstorming: "deny" } }),
          ),
        }),
      )
      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      if (err instanceof PermissionV1.DeniedError) {
        expect(err.ruleset).toContainEqual({ permission: "skill", pattern: "brainstorming", action: "deny" })
      }
    }),
  ),
)

it.live("ask - config deny wins over persisted always approval", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const first = yield* ask({
        id: PermissionV1.ID.make("per_skill_persisted_allow"),
        sessionID: SessionID.make("session_test"),
        permission: "skill",
        patterns: ["brainstorming"],
        metadata: {},
        always: ["brainstorming"],
        ruleset: Permission.fromConfig({ skill: "ask" }),
      }).pipe(Effect.forkScoped)
      yield* waitForPending(1)
      yield* reply({ requestID: PermissionV1.ID.make("per_skill_persisted_allow"), reply: "always" })
      yield* Fiber.join(first)

      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "skill",
          patterns: ["brainstorming"],
          metadata: {},
          always: ["brainstorming"],
          ruleset: Permission.fromConfig({ skill: { brainstorming: "deny" } }),
        }),
      )
      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  ),
)

it.live("ask - stays pending when action is ask", () =>
  withDir({ git: true }, () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  ),
)

it.instance(
  "ask - adds request to pending list",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: { cmd: "ls" },
        always: ["ls"],
        tool: {
          messageID: MessageID.make("msg_test"),
          callID: "call_test",
        },
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const items = yield* waitForPending(1)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: { cmd: "ls" },
        always: ["ls"],
        tool: {
          messageID: MessageID.make("msg_test"),
          callID: "call_test",
        },
      })

      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

it.instance(
  "ask - publishes asked event",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const seen = yield* Deferred.make<PermissionV1.Request>()
      const unsub = yield* events.listen((event) => {
        if (event.type === Permission.Event.Asked.type)
          Deferred.doneUnsafe(seen, Effect.succeed(event.data as PermissionV1.Request))
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      const fiber = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: { cmd: "ls" },
        always: ["ls"],
        tool: {
          messageID: MessageID.make("msg_test"),
          callID: "call_test",
        },
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      expect(
        yield* Deferred.await(seen).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting for permission asked event")),
          }),
        ),
      ).toMatchObject({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
      })

      yield* rejectAll()
      yield* Fiber.await(fiber)
    }),
  { git: true },
)

// reply tests

it.instance(
  "reply - once resolves the pending ask",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_test1"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionV1.ID.make("per_test1"), reply: "once" })
      yield* Fiber.join(fiber)
    }),
  { git: true },
)

it.instance(
  "reply - reject throws RejectedError",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_test2"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionV1.ID.make("per_test2"), reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "reply - reject with message throws CorrectedError",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_test2b"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({
        requestID: PermissionV1.ID.make("per_test2b"),
        reply: "reject",
        message: "Use a safer command",
      })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err).toBeInstanceOf(PermissionV1.CorrectedError)
        expect(String(err)).toContain("Use a safer command")
      }
    }),
  { git: true },
)

it.instance(
  "reply - always persists approval and resolves",
  () =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_test3"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["ls"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      yield* reply({ requestID: PermissionV1.ID.make("per_test3"), reply: "always" })
      yield* Fiber.join(fiber)

      const result = yield* ask({
        sessionID: SessionID.make("session_test2"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      expect(result).toBeUndefined()
    }),
  { git: true },
)

it.instance(
  "reply - reject cancels all pending for same session",
  () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionV1.ID.make("per_test4a"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionV1.ID.make("per_test4b"),
        sessionID: SessionID.make("session_same"),
        permission: "edit",
        patterns: ["foo.ts"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionV1.ID.make("per_test4a"), reply: "reject" })

      const [ea, eb] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isFailure(ea)).toBe(true)
      expect(Exit.isFailure(eb)).toBe(true)
      if (Exit.isFailure(ea)) expect(Cause.squash(ea.cause)).toBeInstanceOf(PermissionV1.RejectedError)
      if (Exit.isFailure(eb)) expect(Cause.squash(eb.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "reply - always resolves matching pending requests in same session",
  () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionV1.ID.make("per_test5a"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["ls"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionV1.ID.make("per_test5b"),
        sessionID: SessionID.make("session_same"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionV1.ID.make("per_test5a"), reply: "always" })

      yield* Fiber.join(a)
      yield* Fiber.join(b)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "reply - always keeps other session pending",
  () =>
    Effect.gen(function* () {
      const a = yield* ask({
        id: PermissionV1.ID.make("per_test6a"),
        sessionID: SessionID.make("session_a"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["ls"],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      const b = yield* ask({
        id: PermissionV1.ID.make("per_test6b"),
        sessionID: SessionID.make("session_b"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(2)
      yield* reply({ requestID: PermissionV1.ID.make("per_test6a"), reply: "always" })

      yield* Fiber.join(a)
      expect((yield* list()).map((item) => item.id)).toEqual([PermissionV1.ID.make("per_test6b")])

      yield* rejectAll()
      yield* Fiber.await(b)
    }),
  { git: true },
)

it.instance(
  "reply - publishes replied event",
  () =>
    Effect.gen(function* () {
      const events = yield* EventV2Bridge.Service
      const seen = yield* Deferred.make<{
        sessionID: SessionID
        requestID: PermissionV1.ID
        reply: PermissionV1.Reply
      }>()

      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_test7"),
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)

      const unsub = yield* events.listen((event) => {
        if (event.type === Permission.Event.Replied.type)
          Deferred.doneUnsafe(
            seen,
            Effect.succeed(
              event.data as { sessionID: SessionID; requestID: PermissionV1.ID; reply: PermissionV1.Reply },
            ),
          )
        return Effect.void
      })
      yield* Effect.addFinalizer(() => unsub)

      yield* reply({ requestID: PermissionV1.ID.make("per_test7"), reply: "once" })
      yield* Fiber.join(fiber)
      expect(
        yield* Deferred.await(seen).pipe(
          Effect.timeoutOrElse({
            duration: "1 second",
            orElse: () => Effect.fail(new Error("timed out waiting for permission replied event")),
          }),
        ),
      ).toEqual({
        sessionID: SessionID.make("session_test"),
        requestID: PermissionV1.ID.make("per_test7"),
        reply: "once",
      })
    }),
  { git: true },
)

it.live("permission requests stay isolated by directory", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped({ git: true })
    const two = yield* tmpdirScoped({ git: true })
    const store = yield* InstanceStore.Service

    const a = yield* store
      .provide(
        { directory: one },
        ask({
          id: PermissionV1.ID.make("per_dir_a"),
          sessionID: SessionID.make("session_dir_a"),
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        }),
      )
      .pipe(Effect.forkScoped)

    const b = yield* store
      .provide(
        { directory: two },
        ask({
          id: PermissionV1.ID.make("per_dir_b"),
          sessionID: SessionID.make("session_dir_b"),
          permission: "bash",
          patterns: ["pwd"],
          metadata: {},
          always: [],
          ruleset: [],
        }),
      )
      .pipe(Effect.forkScoped)

    const onePending = yield* store.provide({ directory: one }, waitForPending(1))
    const twoPending = yield* store.provide({ directory: two }, waitForPending(1))

    expect(onePending).toHaveLength(1)
    expect(twoPending).toHaveLength(1)
    expect(onePending[0].id).toBe(PermissionV1.ID.make("per_dir_a"))
    expect(twoPending[0].id).toBe(PermissionV1.ID.make("per_dir_b"))

    yield* store.provide({ directory: one }, reply({ requestID: onePending[0].id, reply: "reject" }))
    yield* store.provide({ directory: two }, reply({ requestID: twoPending[0].id, reply: "reject" }))

    yield* Fiber.await(a)
    yield* Fiber.await(b)
  }),
)

it.instance(
  "pending permission rejects on instance dispose",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const store = yield* InstanceStore.Service
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_dispose"),
        sessionID: SessionID.make("session_dispose"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      const ctx = yield* store.load({ directory: test.directory })
      yield* store.dispose(ctx)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "pending permission rejects on instance reload",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const store = yield* InstanceStore.Service
      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_reload"),
        sessionID: SessionID.make("session_reload"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      yield* store.reload({ directory: test.directory })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)

it.instance(
  "reply - fails for unknown requestID",
  () =>
    Effect.gen(function* () {
      const exit = yield* reply({ requestID: PermissionV1.ID.make("per_unknown"), reply: "once" }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "Permission.NotFoundError", requestID: "per_unknown" })
      }
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "ask - checks all patterns and stops on first deny",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["echo hello", "rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "*", action: "allow" },
            { permission: "bash", pattern: "rm *", action: "deny" },
          ],
        }),
      )
      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
    }),
  { git: true },
)

it.instance(
  "ask - allows all patterns when all match allow rules",
  () =>
    Effect.gen(function* () {
      const result = yield* ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["echo hello", "ls -la", "pwd"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })
      expect(result).toBeUndefined()
    }),
  { git: true },
)

it.instance(
  "ask - should deny even when an earlier pattern is ask",
  () =>
    Effect.gen(function* () {
      const err = yield* fail(
        ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["echo hello", "rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [
            { permission: "bash", pattern: "echo *", action: "ask" },
            { permission: "bash", pattern: "rm *", action: "deny" },
          ],
        }),
      )

      expect(err).toBeInstanceOf(PermissionV1.DeniedError)
      expect(yield* list()).toHaveLength(0)
    }),
  { git: true },
)

it.instance(
  "ask - abort should clear pending request",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const store = yield* InstanceStore.Service

      const fiber = yield* ask({
        id: PermissionV1.ID.make("per_reload"),
        sessionID: SessionID.make("session_reload"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      }).pipe(Effect.forkScoped)

      const pending = yield* waitForPending(1)
      expect(pending).toHaveLength(1)
      yield* store.reload({ directory: test.directory })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.RejectedError)
    }),
  { git: true },
)
