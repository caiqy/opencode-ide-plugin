type Tags = Record<string, unknown>

export type Logger = {
  info(message?: unknown, extra?: Tags): Logger
  error(message?: unknown, extra?: Tags): Logger
  tag(key: string, value: unknown): Logger
  clone(): Logger
}

const state = {
  print: true,
}

export function init(options?: { print?: boolean }) {
  state.print = options?.print ?? state.print
}

export function create(tags: Tags = {}): Logger {
  const current = { ...tags }
  const logger: Logger = {
    info(message?: unknown, extra?: Tags) {
      write("info", current, message, extra)
      return logger
    },
    error(message?: unknown, extra?: Tags) {
      write("error", current, message, extra)
      return logger
    },
    tag(key: string, value: unknown) {
      current[key] = value
      return logger
    },
    clone() {
      return create(current)
    },
  }
  return logger
}

function write(level: "info" | "error", tags: Tags, message?: unknown, extra?: Tags) {
  if (!state.print) return
  const details = { ...tags, ...extra }
  const args = Object.keys(details).length ? [message, details] : [message]
  console[level](...args)
}

export const Log = { init, create }
