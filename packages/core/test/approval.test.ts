import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { Approval } from "../src/approval"
import { ApprovalV1 } from "../src/v1/approval"

describe("ApprovalV1", () => {
  test("stores the latest mode in a permission ruleset marker", () => {
    const ruleset = [ApprovalV1.rule("manual"), ApprovalV1.rule("full")]

    expect(ApprovalV1.modeFromRuleset(ruleset)).toBe("full")
    expect(ApprovalV1.modeFromRuleset([])).toBe("manual")
  })

  test("replaces only the approval marker in a permission ruleset", () => {
    expect(
      ApprovalV1.withRuleset(
        [{ permission: "bash", pattern: "git *", action: "allow" }, ApprovalV1.rule("automatic")],
        "full",
      ),
    ).toEqual([{ permission: "bash", pattern: "git *", action: "allow" }, ApprovalV1.rule("full")])
  })

  test("adds and removes a durable restrictive transition marker", () => {
    const ruleset = [{ permission: "bash", pattern: "*", action: "allow" as const }, ApprovalV1.rule("full")]
    const fenced = ApprovalV1.withTransition(ruleset)

    expect(ApprovalV1.isTransitioning(fenced)).toBe(true)
    expect(ApprovalV1.withoutTransition(fenced)).toEqual(ruleset)
  })
})

describe("Approval", () => {
  test("builds the approval request with the concrete tool name", () => {
    expect(
      Approval.input({
        permission: "edit",
        tool: "write",
        patterns: ["src/index.ts"],
        metadata: { path: "src/index.ts" },
      }),
    ).toEqual({
      permission: "edit",
      tool: "write",
      patterns: ["src/index.ts"],
      metadata: { path: "src/index.ts" },
    })
  })

  test("shares synchronized approval modes by Session", () => {
    Approval.runtime.set("ses_shared", "full")
    expect(Approval.runtime.get("ses_shared")).toBe("full")
    Approval.runtime.set("ses_shared", "manual")
    expect(Approval.runtime.get("ses_shared")).toBe("manual")
    Approval.runtime.clear("ses_shared")
    expect(Approval.runtime.get("ses_shared")).toBeUndefined()
  })

  test("tracks an explicit mode clear until the Session lifecycle ends", async () => {
    Approval.runtime.set("ses_cleared", "full")
    Approval.runtime.clear("ses_cleared")
    expect(Approval.runtime.isCleared("ses_cleared")).toBe(true)

    await Effect.runPromise(Approval.runtime.dispose("ses_cleared"))
    expect(Approval.runtime.isCleared("ses_cleared")).toBe(false)
  })

  test("dispose detaches an active restriction from a reused Session ID", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const oldStarted = yield* Deferred.make<void>()
          const releaseOld = yield* Deferred.make<void>()
          const old = yield* Approval.runtime
            .withRestriction(
              "ses_restricted_reused",
              Deferred.succeed(oldStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseOld))),
            )
            .pipe(Effect.forkScoped)
          yield* Deferred.await(oldStarted)

          yield* Approval.runtime.dispose("ses_restricted_reused")
          expect(Approval.runtime.isRestricting("ses_restricted_reused")).toBe(false)

          const releaseNext = yield* Deferred.make<void>()
          const next = yield* Approval.runtime
            .withRestriction("ses_restricted_reused", Deferred.await(releaseNext))
            .pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          expect(Approval.runtime.isRestricting("ses_restricted_reused")).toBe(true)

          yield* Deferred.succeed(releaseOld, undefined)
          yield* Fiber.join(old)
          expect(Approval.runtime.isRestricting("ses_restricted_reused")).toBe(true)

          yield* Deferred.succeed(releaseNext, undefined)
          yield* Fiber.join(next)
          expect(Approval.runtime.isRestricting("ses_restricted_reused")).toBe(false)
        }),
      ),
    )
  })

  test("an old unregister cannot remove a newer drain bucket", async () => {
    const first = Approval.runtime.register("ses_reused", Effect.void)
    first()
    const calls: string[] = []
    const second = Approval.runtime.register(
      "ses_reused",
      Effect.sync(() => calls.push("second")),
    )

    first()
    await Effect.runPromise(Approval.runtime.drain("ses_reused"))
    second()

    expect(calls).toEqual(["second"])
  })

  test("keeps a drain registration that declines settlement", async () => {
    let allowed = false
    let calls = 0
    Approval.runtime.register(
      "ses_guarded_drain",
      Effect.sync(() => {
        calls++
        return allowed
      }),
    )

    await Effect.runPromise(Approval.runtime.drain("ses_guarded_drain"))
    allowed = true
    await Effect.runPromise(Approval.runtime.drain("ses_guarded_drain"))
    await Effect.runPromise(Approval.runtime.drain("ses_guarded_drain"))

    expect(calls).toBe(2)
  })

  test("disposes registered Session cleanup and removes its drain", async () => {
    const calls: string[] = []
    Approval.runtime.register(
      "ses_dispose",
      Effect.sync(() => calls.push("drain")),
      Effect.sync(() => calls.push("dispose")),
    )

    await Effect.runPromise(Approval.runtime.dispose("ses_dispose"))
    await Effect.runPromise(Approval.runtime.drain("ses_dispose"))

    expect(calls).toEqual(["dispose"])
  })

  test("runs one registered pending reviewer for a Session", async () => {
    const calls: string[] = []
    const review = Effect.sync(() => calls.push("review"))
    const first = Approval.runtime.register("ses_review", Effect.void, Effect.void, 0, 0, review)
    const second = Approval.runtime.register("ses_review", Effect.void, Effect.void, 0, 0, review)

    await Effect.runPromise(Approval.runtime.review("ses_review"))
    first?.()
    second?.()

    expect(calls).toEqual(["review"])
  })

  test("joins concurrent reviews for the same Session", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let calls = 0
          const review = Effect.sync(() => calls++).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          )
          const unregister = Approval.runtime.register("ses_review_concurrent", Effect.void, Effect.void, 0, 0, review)
          const first = yield* Approval.runtime.review("ses_review_concurrent").pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const second = yield* Approval.runtime.review("ses_review_concurrent").pipe(Effect.forkScoped)
          yield* Effect.yieldNow

          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(first)
          yield* Fiber.join(second)
          unregister?.()

          expect(calls).toBe(1)
        }),
      ),
    )
  })

  test("starts a new review after the same Session ID is disposed", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const old = Approval.runtime.register(
            "ses_review_recreated",
            Effect.void,
            Effect.void,
            Approval.runtime.revision("ses_review_recreated"),
            Approval.runtime.lifecycle("ses_review_recreated"),
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release))),
          )
          const first = yield* Approval.runtime.review("ses_review_recreated").pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          yield* Approval.runtime.dispose("ses_review_recreated")
          let calls = 0
          const next = Approval.runtime.register(
            "ses_review_recreated",
            Effect.void,
            Effect.void,
            Approval.runtime.revision("ses_review_recreated"),
            Approval.runtime.lifecycle("ses_review_recreated"),
            Effect.sync(() => calls++),
          )

          const second = yield* Approval.runtime.review("ses_review_recreated").pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          expect(calls).toBe(1)

          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(first)
          yield* Fiber.join(second)
          old?.()
          next?.()
        }),
      ),
    )
  })

  test("propagates an interrupted review owner to concurrent joiners", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const unregister = Approval.runtime.register(
            "ses_review_interrupted",
            Effect.void,
            Effect.void,
            Approval.runtime.revision("ses_review_interrupted"),
            Approval.runtime.lifecycle("ses_review_interrupted"),
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          )
          const owner = yield* Approval.runtime.review("ses_review_interrupted").pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          const joiner = yield* Approval.runtime.review("ses_review_interrupted").pipe(Effect.forkScoped)
          yield* Effect.yieldNow

          yield* Fiber.interrupt(owner)
          expect(Exit.isFailure(yield* Fiber.await(joiner))).toBe(true)
          unregister?.()
        }),
      ),
    )
  })

  test("rejects a registration captured before Session disposal", async () => {
    const calls: string[] = []
    const revision = Approval.runtime.revision("ses_disposed_between_evaluate_and_register")
    const lifecycle = Approval.runtime.lifecycle("ses_disposed_between_evaluate_and_register")

    await Effect.runPromise(Approval.runtime.dispose("ses_disposed_between_evaluate_and_register"))
    const unregister = Approval.runtime.register(
      "ses_disposed_between_evaluate_and_register",
      Effect.sync(() => calls.push("drain")),
      Effect.void,
      revision,
      lifecycle,
    )
    await Effect.runPromise(Approval.runtime.drain("ses_disposed_between_evaluate_and_register"))

    expect(unregister).toBeUndefined()
    expect(calls).toEqual([])
  })

  test("falls back to ask for invalid output, failures, and defects", async () => {
    expect(await Effect.runPromise(Approval.decide(Effect.succeed("allow")))).toBe("allow")
    expect(await Effect.runPromise(Approval.decide(Effect.succeed("invalid")))).toBe("ask")
    expect(await Effect.runPromise(Approval.decide(Effect.fail("failed")))).toBe("ask")
    expect(await Effect.runPromise(Approval.decide(Effect.die("defect")))).toBe("ask")
  })

  test("keeps the first and latest user authorization evidence when the transcript is bounded", () => {
    const transcript = Approval.transcript([
      { role: "user", text: `first authorization ${"a".repeat(12_000)}` },
      ...Array.from({ length: 30 }, (_, index) => ({
        role: "assistant" as const,
        text: `assistant ${index} ${"x".repeat(2_000)}`,
      })),
      { role: "user", text: `latest authorization ${"b".repeat(12_000)}` },
    ])

    expect(transcript.text).toContain("first authorization")
    expect(transcript.text).toContain("latest authorization")
    expect(transcript.text).toContain("<guardian_truncated")
    expect(transcript.text).toContain("Some conversation entries were omitted.")
    expect(transcript.text.length).toBeLessThan(45_000)
  })

  test("bounds tool evidence separately from user messages", () => {
    const transcript = Approval.transcript([
      { role: "user", text: "Delete the generated file only." },
      ...Array.from({ length: 20 }, (_, index) => ({
        role: "tool" as const,
        name: "read",
        text: `tool evidence ${index} ${"z".repeat(2_000)}`,
      })),
    ])

    expect(transcript.text).toContain("Delete the generated file only.")
    expect(transcript.text).toContain("tool read")
    expect(transcript.text).toContain("Some conversation entries were omitted.")
  })

  test("separates untrusted transcript evidence from the exact planned action", () => {
    const prompt = Approval.guardianPrompt({
      sessionID: "ses_guardian",
      transcript: [{ role: "user", text: "Update src/index.ts." }],
      action: Approval.input({
        permission: "edit",
        tool: "apply_patch",
        patterns: ["src/index.ts"],
        metadata: { patch: "*** Begin Patch" },
        cwd: "D:/repo",
        justification: "Implement the requested change",
      }),
    })

    expect(prompt).toContain(">>> TRANSCRIPT START")
    expect(prompt).toContain(">>> TRANSCRIPT END")
    expect(prompt).toContain(">>> APPROVAL REQUEST START")
    expect(prompt).toContain('"tool": "apply_patch"')
    expect(prompt).toContain('"cwd": "D:/repo"')
    expect(prompt).toContain("ses_guardian")
  })

  test("accepts critical risk only when the outcome is deny", () => {
    expect(
      Approval.assess({ risk_level: "critical", user_authorization: "high", outcome: "deny", rationale: "x" }),
    ).toBe("deny")
    expect(
      Approval.assess({ risk_level: "critical", user_authorization: "high", outcome: "allow", rationale: "x" }),
    ).toBe("ask")
    expect(
      Approval.assess({ risk_level: "critical", user_authorization: "unknown", outcome: "ask", rationale: "x" }),
    ).toBe("ask")
  })

  test("gates high-risk allows on medium or high user authorization", () => {
    expect(
      Approval.assess({ risk_level: "high", user_authorization: "medium", outcome: "allow", rationale: "x" }),
    ).toBe("allow")
    expect(Approval.assess({ risk_level: "high", user_authorization: "high", outcome: "allow", rationale: "x" })).toBe(
      "allow",
    )
    expect(Approval.assess({ risk_level: "high", user_authorization: "low", outcome: "allow", rationale: "x" })).toBe(
      "ask",
    )
    expect(
      Approval.assess({ risk_level: "high", user_authorization: "unknown", outcome: "allow", rationale: "x" }),
    ).toBe("ask")
    expect(
      Approval.assess({ risk_level: "high", user_authorization: "unknown", outcome: "deny", rationale: "x" }),
    ).toBe("deny")
    expect(Approval.assess({ risk_level: "high", user_authorization: "high", outcome: "ask", rationale: "x" })).toBe(
      "ask",
    )
  })

  test("passes through low and medium risk outcomes unchanged", () => {
    expect(Approval.assess({ risk_level: "low", user_authorization: "high", outcome: "allow", rationale: "x" })).toBe(
      "allow",
    )
    expect(Approval.assess({ risk_level: "low", user_authorization: "unknown", outcome: "ask", rationale: "x" })).toBe(
      "ask",
    )
    expect(Approval.assess({ risk_level: "medium", user_authorization: "high", outcome: "deny", rationale: "x" })).toBe(
      "deny",
    )
  })

  test("renders a compaction checkpoint that keeps the summary and recent context", () => {
    const checkpoint = Approval.checkpoint("summarized goal", "recent tail")
    expect(checkpoint).toContain("<conversation-checkpoint>")
    expect(checkpoint).toContain("<summary>\nsummarized goal\n</summary>")
    expect(checkpoint).toContain("<recent-context>\nrecent tail\n</recent-context>")
  })

  test("accepts only complete structured Guardian assessments", () => {
    const decode = Schema.decodeUnknownSync(Approval.Assessment)
    expect(
      decode({
        risk_level: "medium",
        user_authorization: "high",
        outcome: "allow",
        rationale: "The requested edit is scoped and reversible.",
      }),
    ).toEqual({
      risk_level: "medium",
      user_authorization: "high",
      outcome: "allow",
      rationale: "The requested edit is scoped and reversible.",
    })
    expect(() => decode({ outcome: "allow" })).toThrow()
    expect(() =>
      decode({
        risk_level: "severe",
        user_authorization: "high",
        outcome: "allow",
        rationale: "invalid",
      }),
    ).toThrow()
  })
})
