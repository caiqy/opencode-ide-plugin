import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { mergeDeep } from "remeda"
import { Global } from "@opencode-ai/core/global"
import fsNode from "fs/promises"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { existsSync } from "fs"
import { Account } from "@/account/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "@opencode-ai/core/v1/config/console-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { RemoteAuthError } from "@opencode-ai/core/v1/config/error"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { ConfigAgent } from "./agent"
import { ConfigCommand } from "./command"
import { ConfigManaged } from "./managed"
import { ConfigParse } from "./parse"
import { ConfigPaths } from "./paths"
import { ConfigPlugin } from "./plugin"
import { ConfigVariable } from "./variable"
import { Npm } from "@opencode-ai/core/npm"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { isDeepStrictEqual } from "node:util"

// Custom merge function that concatenates array fields instead of replacing them
// Keep remeda's deep conditional merge type out of hot config-loading paths; TS profiling showed it dominates here.
function mergeConfig(target: Info, source: Info): Info {
  return mergeDeep(target, source) as Info
}

function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

function normalizeLoadedConfig(data: unknown) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  return copy
}

async function substituteWellKnownRemoteConfig(input: {
  value: unknown
  dir: string
  source: string
  env: Record<string, string>
}) {
  if (!isRecord(input.value) || typeof input.value.url !== "string") return undefined

  const url = await ConfigVariable.substitute({
    text: input.value.url,
    type: "virtual",
    dir: input.dir,
    source: input.source,
    env: input.env,
  })
  const headers = isRecord(input.value.headers)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(async ([key, value]) => [
              key,
              await ConfigVariable.substitute({
                text: value,
                type: "virtual",
                dir: input.dir,
                source: input.source,
                env: input.env,
              }),
            ]),
        ),
      )
    : undefined

  return { url, headers }
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPluginV1.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

type Info = ConfigV1.Info & {
  image_model?: string
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly replaceGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly patchProjectField: (path: string[], value: unknown) => Effect.Effect<void>
  readonly invalidate: () => Effect.Effect<void>
  readonly reload: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export const use = serviceUse(Service)

const skillPermissionOverlay = new Map<string, Record<string, ConfigPermissionV1.Action>>()

export function setSkillPermissionOverlay(dir: string, name: string, action: ConfigPermissionV1.Action) {
  skillPermissionOverlay.set(dir, { ...getSkillPermissionOverlay(dir), [name]: action })
}

export function getSkillPermissionOverlay(dir: string) {
  return { ...(skillPermissionOverlay.get(dir) ?? {}) }
}

export function clearSkillPermissionOverlay(dir: string) {
  skillPermissionOverlay.delete(dir)
}

function globalConfigFiles() {
  return ["opencode.jsonc", "opencode.json", "config.json"].map((file) => path.join(Global.Path.config, file))
}

export function globalConfigFile() {
  const candidates = globalConfigFiles()
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return candidates[0]
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    return replaceJsonc(input, patch, path)
  }

  return Object.entries(patch).reduce((result, [key, value]) => patchJsonc(result, value, [...path, key]), input)
}

function syncJsonc(input: string, current: unknown, next: unknown, path: string[] = []): string {
  if (isDeepStrictEqual(current, next)) return input
  if (!isRecord(current) || !isRecord(next)) return replaceJsonc(input, next, path)

  return Array.from(new Set([...Object.keys(current), ...Object.keys(next)])).reduce((result, key) => {
    if (!(key in next)) return replaceJsonc(result, undefined, [...path, key])
    if (!(key in current)) return replaceJsonc(result, next[key], [...path, key])
    return syncJsonc(result, current[key], next[key], [...path, key])
  }, input)
}

function reconcileResolved(input: unknown, resolved: unknown, raw: unknown): unknown {
  if (isDeepStrictEqual(input, resolved)) return raw
  if (Array.isArray(input)) {
    const resolvedItems = Array.isArray(resolved) ? resolved : []
    const rawItems = Array.isArray(raw) ? raw : []
    const used = new Set<number>()
    // Reserve exact source matches first so inserts, moves, and duplicates cannot shift raw secrets by index.
    const matches = input.map((value) => {
      const index = resolvedItems.findIndex((candidate, index) => !used.has(index) && isDeepStrictEqual(value, candidate))
      if (index === -1) return undefined
      used.add(index)
      return index
    })
    return input.map((value, index) => {
      const match = matches[index]
      if (match !== undefined) return rawItems[match]
      if (index >= resolvedItems.length || used.has(index)) return value
      used.add(index)
      return reconcileResolved(value, resolvedItems[index], rawItems[index])
    })
  }
  if (!isRecord(input)) return input

  const resolvedRecord = isRecord(resolved) ? resolved : {}
  const rawRecord = isRecord(raw) ? raw : {}
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, reconcileResolved(value, resolvedRecord[key], rawRecord[key])]),
  )
}

function reconcileProject(input: unknown, resolved: unknown, targetResolved: unknown, targetRaw: unknown): unknown {
  if (isDeepStrictEqual(input, resolved)) return targetRaw
  if (Array.isArray(input)) {
    const resolvedItems = Array.isArray(resolved) ? resolved : []
    const targetItems = Array.isArray(targetResolved) ? targetResolved : []
    const rawItems = Array.isArray(targetRaw) ? targetRaw : []
    // Only targetItems and rawItems share indices; resolvedItems is used solely to identify inherited values.
    const usedTarget = new Set<number>()
    const targetMatches = input.map((value) => {
      const index = targetItems.findIndex((candidate, index) => !usedTarget.has(index) && isDeepStrictEqual(value, candidate))
      if (index === -1) return undefined
      usedTarget.add(index)
      return index
    })
    const targetInResolved = new Set<number>()
    for (const value of targetItems) {
      const index = resolvedItems.findIndex(
        (candidate, index) => !targetInResolved.has(index) && isDeepStrictEqual(value, candidate),
      )
      if (index !== -1) targetInResolved.add(index)
    }
    const inherited = resolvedItems.filter((_, index) => !targetInResolved.has(index))
    const usedInherited = new Set<number>()
    const inheritedMatches = input.map((value, index) => {
      if (targetMatches[index] !== undefined) return undefined
      const match = inherited.findIndex(
        (candidate, index) => !usedInherited.has(index) && isDeepStrictEqual(value, candidate),
      )
      if (match === -1) return undefined
      usedInherited.add(match)
      return match
    })

    return input.flatMap((value, index) => {
      const targetMatch = targetMatches[index]
      if (targetMatch !== undefined) return rawItems[targetMatch] === undefined ? [] : [rawItems[targetMatch]]
      if (inheritedMatches[index] !== undefined) return []
      const targetIndex = targetItems.findIndex((_, index) => !usedTarget.has(index))
      if (targetIndex === -1) return [value]
      usedTarget.add(targetIndex)
      const next = reconcileResolved(value, targetItems[targetIndex], rawItems[targetIndex])
      return next === undefined ? [] : [next]
    })
  }
  if (!isRecord(input)) return input

  const resolvedRecord = isRecord(resolved) ? resolved : {}
  const targetResolvedRecord = isRecord(targetResolved) ? targetResolved : {}
  const rawRecord = isRecord(targetRaw) ? targetRaw : {}
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      reconcileProject(value, resolvedRecord[key], targetResolvedRecord[key], rawRecord[key]),
    ]),
  )
}

function replaceJsonc(input: string, value: unknown, path: string[]): string {
  const edits = modify(input, path, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
  })
  return applyEdits(input, edits)
}

function mergeGlobalPatch(existing: Info, patch: Info) {
  const merged = mergeDeep(writable(existing), patch)
  if ("agent" in patch) merged.agent = patch.agent
  if ("provider" in patch) merged.provider = patch.provider
  return merged
}

function writable(info: Info) {
  const { plugin_origins: _plugin_origins, ...next } = info
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

function applySkillPermissionOverlay(info: Info, dir: string) {
  const overlay = getSkillPermissionOverlay(dir)
  if (!Object.keys(overlay).length) return info
  const skill = info.permission?.skill
  return {
    ...info,
    permission: {
      ...info.permission,
      skill: {
        ...(typeof skill === "string" ? { "*": skill } : skill),
        ...overlay,
      },
    },
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service
    const http = yield* HttpClient.HttpClient
    const flock = yield* EffectFlock.Service

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const fetchRemoteJson = Effect.fnUntraced(function* <S extends Schema.Top>(
      url: string,
      headers: Record<string, string> | undefined,
      schema: S,
      loginOrigin: string,
    ) {
      const response = yield* HttpClient.filterStatusOk(withTransientReadRetry(http))
        .execute(
          HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.setHeaders(headers ?? {})),
        )
        .pipe(
          Effect.catch((error) => Effect.die(new Error(`failed to fetch remote config from ${url}: ${String(error)}`))),
        )
      const body = yield* response.text.pipe(
        Effect.catch((error) => Effect.die(new Error(`failed to read remote config from ${url}: ${String(error)}`))),
      )
      // An auth proxy can answer with an HTML login page at HTTP 200 (passes filterStatusOk); treat it as a re-auth error, not a decode failure.
      const contentType = (response.headers["content-type"] ?? "").toLowerCase()
      if (contentType.includes("html") || /^\s*<!doctype|^\s*<html/i.test(body)) {
        return yield* Effect.die(new RemoteAuthError({ url: loginOrigin, remote: url }))
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.catch((error) => Effect.die(new Error(`failed to decode remote config from ${url}: ${String(error)}`))),
      )
    })

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
      env?: Record<string, string>,
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options
            ? { text, type: "path", path: options.path, env }
            : { text, type: "virtual", ...options, env },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const data = ConfigParse.schema(ConfigV1.Info, normalizeLoadedConfig(parsed), source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://opencode.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string, env?: Record<string, string>) {
      yield* Effect.logInfo("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath }, env)
    })

    const loadRawFile = Effect.fnUntraced(function* (filepath: string) {
      if (!(yield* fs.isFile(filepath))) return {} as Info
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return ConfigParse.schema(ConfigV1.Info, normalizeLoadedConfig(ConfigParse.jsonc(text, filepath)), filepath)
    })

    const loadRawGlobal = Effect.fnUntraced(function* () {
      let result: Info = {}
      for (const file of globalConfigFiles().toReversed()) {
        result = mergeConfig(result, yield* loadRawFile(file))
      }
      return result
    })

    const loadResolvedGlobal = Effect.fnUntraced(function* () {
      let result: Info = {}
      for (const file of globalConfigFiles().toReversed()) {
        if (yield* fs.isFile(file)) result = mergeConfig(result, yield* loadFile(file))
      }
      return result
    })

    const loadGlobal = Effect.fnUntraced(function* (env?: Record<string, string>) {
      let result: Info = {}
      // Seed the default global config with the schema for editor completion, but avoid writing when the user
      // explicitly routes config through env-provided paths or content.
      if (!Flag.OPENCODE_CONFIG && !Flag.OPENCODE_CONFIG_DIR && !Flag.OPENCODE_CONFIG_CONTENT) {
        const file = globalConfigFile()
        if (!existsSync(file)) {
          yield* fs
            .writeWithDirs(file, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2))
            .pipe(Effect.catch(() => Effect.void))
        }
      }
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "config.json"), env))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.json"), env))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.jsonc"), env))

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://opencode.ai/config.json"
              result = mergeConfig(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.logError("failed to load global config, using defaults", { error: String(error) }),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      return yield* cachedGlobal
    })

    const writeGlobal = Effect.fnUntraced(function* (operation: "update" | "replace", config: Info) {
      return yield* Effect.gen(function* () {
        const raw = yield* loadRawGlobal()
        const resolved = yield* loadResolvedGlobal()
        const patch = reconcileResolved(writableGlobal(config), writableGlobal(resolved), writableGlobal(raw)) as Info
        const file = globalConfigFile()
        const before = (yield* readConfigFile(file)) ?? "{}"
        const parsed = ConfigParse.jsonc(before, file)
        const next = ConfigParse.schema(
          ConfigV1.Info,
          writableGlobal(operation === "update" ? mergeGlobalPatch(raw, patch) : patch),
          file,
        )
        const serialized = syncJsonc(before, parsed, next)
        const obsolete = globalConfigFiles().filter((candidate) => candidate !== file && existsSync(candidate))
        const changed = serialized !== before || obsolete.length > 0

        if (serialized !== before) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
        // Complete the target write before deleting sources so a write failure cannot lose their config.
        yield* Effect.forEach(obsolete, (candidate) => fs.remove(candidate, { force: true }).pipe(Effect.orDie))
        return { info: next, changed }
      }).pipe(
        Effect.ensuring(invalidate()),
        flock.withLock(`config-write:${Global.Path.config}`),
        Effect.orDie,
      )
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      yield* fs.ensureDir(dir)
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const authEnv: Record<string, string> = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "OPENCODE_CONFIG_CONTENT") return "local"
          if (containsPath(source, ctx)) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPluginV1.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          return mergePluginOrigins(source, next.plugin, kind)
        }

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            authEnv[value.key] = value.token
            const wellknownURL = `${url}/.well-known/opencode`
            yield* Effect.logDebug("fetching remote config", { url: wellknownURL })
            const wellknown = yield* fetchRemoteJson(wellknownURL, undefined, ConfigV1.WellKnown, url)
            const remote = yield* Effect.promise(() =>
              substituteWellKnownRemoteConfig({
                value: wellknown.remote_config,
                dir: url,
                source: wellknownURL,
                env: authEnv,
              }),
            )
            const fetchedConfig = remote
              ? yield* Effect.gen(function* () {
                  yield* Effect.logDebug("fetching remote config", { url: remote.url })
                  const data = yield* fetchRemoteJson(remote.url, remote.headers, Schema.Json, url)
                  if (isRecord(data) && isRecord(data.config)) return data.config
                  if (isRecord(data)) return data
                  return yield* Effect.die(
                    new Error(`failed to decode remote config from ${remote.url}: expected object`),
                  )
                })
              : {}
            const remoteConfig = mergeConfig(isRecord(wellknown.config) ? wellknown.config : {}, fetchedConfig)
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
            const source = wellknownURL
            const next = yield* loadConfig(
              JSON.stringify(remoteConfig),
              {
                dir: path.dirname(source),
                source,
              },
              authEnv,
            )
            yield* merge(source, next, "global")
            yield* Effect.logDebug("loaded remote config from well-known", { url })
          }
        }

        const global = Object.keys(authEnv).length ? yield* loadGlobal(authEnv) : yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        if (Flag.OPENCODE_CONFIG) {
          yield* merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG, authEnv))
          yield* Effect.logDebug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
        }

        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* merge(file, yield* loadFile(file, authEnv), "local")
          }
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.OPENCODE_CONFIG_DIR) {
          yield* Effect.logDebug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void>[] = []

        for (const dir of directories) {
          if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR) {
            for (const file of ["opencode.json", "opencode.jsonc"]) {
              const source = path.join(dir, file)
              yield* Effect.logDebug(`loading config from ${source}`)
              yield* merge(source, yield* loadFile(source, authEnv))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@opencode-ai/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.logWarning("background dependency install failed", { dir, error: String(exit.cause) })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
          // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* mergePluginOrigins(dir, list)
        }

        if (process.env.OPENCODE_CONFIG_CONTENT) {
          const source = "OPENCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* merge(source, next, "local")
          yield* Effect.logDebug("loaded custom config from OPENCODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["OPENCODE_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                dir: path.dirname(source),
                source,
              })
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) =>
              Effect.logDebug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              }),
            ),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          result = mergeConfigConcatArrays(
            result,
            yield* loadConfig(managed.text, {
              dir: path.dirname(managed.source),
              source: managed.source,
            }),
          )
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.OPENCODE_PERMISSION) {
          try {
            result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
          } catch (err) {
            yield* Effect.logWarning("OPENCODE_PERMISSION contains invalid JSON, skipping", { err })
          }
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermissionV1.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermissionV1.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) {
          try {
            result.username = os.userInfo().username || "user"
          } catch (err) {
            yield* Effect.logWarning("failed to read system username, using fallback", { err })
            result.username = "user"
          }
        }

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.OPENCODE_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }

        return {
          config: result,
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(FSUtil.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      return applySkillPermissionOverlay(
        yield* InstanceState.use(state, (s) => s.config),
        yield* InstanceState.directory,
      )
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      yield* Effect.gen(function* () {
        const jsonc = path.join(dir, "opencode.jsonc")
        const json = path.join(dir, "opencode.json")
        const file = existsSync(jsonc) ? jsonc : json
        const raw = yield* loadRawFile(file)
        const targetResolved = yield* loadFile(file)
        const resolved = yield* get()
        const patch = reconcileProject(writable(config), writable(resolved), writable(targetResolved), writable(raw))
        const before = (yield* readConfigFile(file)) ?? "{}"
        yield* fs.writeFileString(file, patchJsonc(before, patch)).pipe(Effect.orDie)
        yield* reload()
      }).pipe(flock.withLock(`config-write:${dir}`), Effect.orDie)
    })

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
    })

    const reload = Effect.fn("Config.reload")(function* () {
      yield* invalidate()
      yield* InstanceState.invalidate(state)
    })

    const patchProjectField = Effect.fn("Config.patchProjectField")(function* (pathToField: string[], value: unknown) {
      const file = path.join(yield* InstanceState.directory, "opencode.json")
      yield* fs
        .writeFileString(file, patchJsonc((yield* readConfigFile(file)) ?? "{}", value, pathToField))
        .pipe(Effect.orDie)
      yield* reload()
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      return yield* writeGlobal("update", config)
    })

    const replaceGlobal = Effect.fn("Config.replaceGlobal")(function* (config: Info) {
      return yield* writeGlobal("replace", config)
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      replaceGlobal,
      patchProjectField,
      invalidate,
      reload,
      directories,
      waitForDependencies,
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Auth.node, Account.node, Env.node, Npm.node, httpClient, EffectFlock.node],
})

export * as Config from "./config"
