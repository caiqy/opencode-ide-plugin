export function sessionLoading(
  id: string | undefined,
  message: Record<string, unknown[] | undefined>,
  syncing: boolean,
  settled: boolean,
) {
  if (!id) return false
  if (message[id] !== undefined) return false
  if (syncing) return true
  return !settled
}

export function composerLocked(blocked: boolean, loading: boolean) {
  return blocked || loading
}
