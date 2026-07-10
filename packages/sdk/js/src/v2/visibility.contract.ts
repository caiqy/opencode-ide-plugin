import type { OpencodeClient } from "./gen/sdk.gen.js"
import type { SessionVisibilityData } from "./gen/types.gen.js"

type RequireSessionIDs<T extends { sessionIDs: string[] }> = T

type VisibilityDataContract = RequireSessionIDs<SessionVisibilityData["body"]>
type VisibilityMethodContract = RequireSessionIDs<Parameters<OpencodeClient["session"]["visibility"]>[0]>

export type { VisibilityDataContract, VisibilityMethodContract }
