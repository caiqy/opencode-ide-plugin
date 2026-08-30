import { LocationServiceMap, buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Context, Effect, Layer } from "effect"

const disposers = new Set<(directory: string) => Promise<void>>()
const locationMaps = new Set<LocationServiceMap.Service["Service"]>()

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  disposers.add(disposer)
  return () => {
    disposers.delete(disposer)
  }
}

export async function disposeInstance(directory: string) {
  await Promise.allSettled([
    ...[...disposers].map((disposer) => disposer(directory)),
    ...[...locationMaps].map((locations) =>
      Effect.runPromise(
        Effect.forEach(
          refs(locations).filter((ref) => ref.directory === AbsolutePath.make(directory)),
          (ref) => locations.invalidate(ref),
          { discard: true },
        ),
      ),
    ),
  ])
}

export async function disposeAllLocations() {
  await Promise.allSettled(
    [...locationMaps].map((locations) => {
      return Effect.runPromise(
        Effect.forEach(refs(locations), (ref) => locations.invalidate(ref), { discard: true }),
      )
    }),
  )
}

function refs(locations: LocationServiceMap.Service["Service"]) {
  const state = locations.rcMap.state
  return state._tag === "Closed" ? [] : Array.from(state.map, ([ref]) => ref)
}

export function withInstanceDisposal<E, R>(
  layer: Layer.Layer<LocationServiceMap.Service, E, R>,
) {
  return layer.pipe(
    Layer.tap((context) =>
      Effect.gen(function* () {
        const locations = Context.get(context, LocationServiceMap.Service)
        locationMaps.add(locations)
        yield* Effect.addFinalizer(() => Effect.sync(() => locationMaps.delete(locations)))
      }),
    ),
  )
}

export function buildInstanceLocationServiceMap(
  replacements: Parameters<typeof buildLocationServiceMap>[0] = [],
) {
  return withInstanceDisposal(buildLocationServiceMap(replacements))
}

export const instanceLocationServiceMapLayer = buildInstanceLocationServiceMap()
