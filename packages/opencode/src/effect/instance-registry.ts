import { LocationServiceMap, buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Context, Effect, Layer } from "effect"

const disposers = new Set<(directory: string) => Promise<void>>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string) {
  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
}

export const instanceLocationServiceMapLayer = buildLocationServiceMap().pipe(
  Layer.tap((context) =>
    Effect.gen(function* () {
      const locations = Context.get(context, LocationServiceMap.Service)
      const unregister = registerDisposer((directory) =>
        Effect.runPromise(locations.invalidate(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
    }),
  ),
)
