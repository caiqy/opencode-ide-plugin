import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
import { and, eq } from "drizzle-orm"
export * from "drizzle-orm"
import { LocalContext } from "../util"
import { lazy } from "../util/lazy"
import { Global } from "@opencode-ai/core/global"
import { Log } from "../util"
import { NamedError } from "@opencode-ai/core/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { ProjectTable } from "../project/project.sql"
import { ProjectID } from "../project/schema"
import { SessionTable } from "../session/session.sql"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return getChannelPath()
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

function hasGitAncestor(directory: string) {
  let current = path.resolve(directory)
  while (true) {
    if (existsSync(path.join(current, ".git"))) return true
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

function installLegacyNonGitCleanupTrigger(db: Client) {
  db.run(`
    CREATE TRIGGER IF NOT EXISTS project_drop_orphaned_global_after_session_update
    AFTER UPDATE OF project_id ON session
    WHEN OLD.project_id = 'global'
      AND NEW.project_id <> 'global'
      AND NOT EXISTS (SELECT 1 FROM session WHERE project_id = 'global')
    BEGIN
      DELETE FROM project WHERE id = 'global';
    END
  `)
}

function dropOrphanedGlobalProject(db: Client) {
  const legacy = db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.project_id, ProjectID.global)).get()
  if (legacy) return
  db.delete(ProjectTable).where(eq(ProjectTable.id, ProjectID.global)).run()
}

function migrateLegacyNonGitSessions(db: Client) {
  const rows = db
    .select({
      directory: SessionTable.directory,
      timeCreated: SessionTable.time_created,
      timeUpdated: SessionTable.time_updated,
    })
    .from(SessionTable)
    .where(eq(SessionTable.project_id, ProjectID.global))
    .all()

  const legacy = new Map<string, { timeCreated: number; timeUpdated: number }>()
  for (const row of rows) {
    const directory = row.directory.trim()
    if (!directory) continue
    if (hasGitAncestor(directory)) continue
    const current = legacy.get(directory)
    if (!current) {
      legacy.set(directory, {
        timeCreated: row.timeCreated,
        timeUpdated: row.timeUpdated,
      })
      continue
    }
    current.timeCreated = Math.min(current.timeCreated, row.timeCreated)
    current.timeUpdated = Math.max(current.timeUpdated, row.timeUpdated)
  }

  if (legacy.size === 0) return

  // Keep SQL migrations portable: Bun's bundled SQLite here cannot derive the
  // runtime non-git ProjectID hash in SQL, so startup migration only rebinds
  // sessions and relies on the DB trigger from 20260512170000 to drop an
  // orphaned global project row once nothing points at it anymore.
  db.transaction((tx) => {
    for (const [directory, time] of legacy) {
      const projectID = ProjectID.nonGit(directory)
      tx
        .insert(ProjectTable)
        .values({
          id: projectID,
          worktree: directory,
          vcs: null,
          name: null,
          icon_url: null,
          icon_url_override: null,
          icon_color: null,
          time_created: time.timeCreated,
          time_updated: time.timeUpdated,
          time_initialized: null,
          sandboxes: [],
          commands: null,
        })
        .onConflictDoUpdate({
          target: ProjectTable.id,
          set: {
            worktree: directory,
            time_updated: time.timeUpdated,
          },
        })
        .run()

      tx
        .update(SessionTable)
        .set({ project_id: projectID })
        .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, directory)))
        .run()
    }
  })

  dropOrphanedGlobalProject(db)
}

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries =
    typeof OPENCODE_MIGRATIONS !== "undefined"
      ? OPENCODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    if (Flag.OPENCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    migrate(db, entries)
  }

  installLegacyNonGitCleanupTrigger(db)
  migrateLegacyNonGitSessions(db)
  dropOrphanedGlobalProject(db)

  return db
})

export function close() {
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}
