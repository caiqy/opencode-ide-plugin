import { AppRuntime } from "@/effect/app-runtime"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceStore } from "./instance-store"
import { containsPath as containsPathInContext, context } from "./instance-context"
import type { InstanceContext } from "./instance-context"
import type * as Project from "./project"

export type { InstanceContext } from "./instance-context"

export const Instance = {
  async provide<R>(input: {
    directory: string
    init?: () => Promise<any>
    worktree?: string
    project?: InstanceStore.LoadInput["project"]
    fn: () => R
  }): Promise<R> {
    const directory = FSUtil.resolve(input.directory)
    const ctx = await AppRuntime.runPromise(
      InstanceStore.Service.use((store) =>
        store.load({
          directory,
          worktree: input.worktree,
          project: input.project,
        }),
      ),
    )
    return await context.provide(ctx, async () => {
      await input.init?.()
      return input.fn()
    })
  },
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },

  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * For non-git projects, directory and worktree are the same real directory.
   * For git worktrees opened from subdirectories, worktree stays anchored at the repo root.
   */
  containsPath(filepath: string, ctx?: InstanceContext) {
    return containsPathInContext(filepath, ctx ?? context.use())
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = FSUtil.resolve(input.directory)
    const ctx = await AppRuntime.runPromise(
      InstanceStore.Service.use((store) =>
        store.reload({
          directory,
          worktree: input.worktree,
          project: input.project,
        }),
      ),
    )
    await input.init?.()
    return ctx
  },
  async dispose() {
    const ctx = context.use()
    await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.dispose(ctx)))
  },
  async disposeAll() {
    await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.disposeAll()))
  },
}
