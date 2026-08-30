import { describe, expect } from "bun:test"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Layer, MutableHashMap } from "effect"
import { disposeAllLocations, disposeInstance, withInstanceDisposal } from "../../src/effect/instance-registry"
import { testEffect } from "../lib/effect"

const invalidated: Location.Ref[] = []
const project = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const workspaceProject = Location.Ref.make({
  directory: AbsolutePath.make("/project"),
  workspaceID: WorkspaceV2.ID.make("wrk_test"),
})
const other = Location.Ref.make({ directory: AbsolutePath.make("/other") })
const it = testEffect(
  withInstanceDisposal(
    Layer.mock(LocationServiceMap.Service)({
      rcMap: {
        state: {
          _tag: "Open",
          map: MutableHashMap.make([project, undefined], [workspaceProject, undefined], [other, undefined]),
        },
      },
      invalidate: (ref: Location.Ref) =>
        Effect.sync(() => {
          invalidated.push(ref)
        }),
    } as unknown as LocationServiceMap.Service["Service"]),
  ),
)

describe("Instance registry", () => {
  it.live("invalidates registered V2 location maps when an instance is disposed", () =>
    Effect.gen(function* () {
      invalidated.length = 0
      yield* LocationServiceMap.Service
      yield* Effect.promise(() => disposeInstance("/project"))
      expect(invalidated).toEqual([project, workspaceProject])
    }),
  )

  it.live("invalidates cached V2 locations without matching legacy instances", () =>
    Effect.gen(function* () {
      invalidated.length = 0
      yield* LocationServiceMap.Service
      yield* Effect.promise(disposeAllLocations)
      expect(invalidated).toEqual([project, workspaceProject, other])
    }),
  )
})
