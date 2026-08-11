import path from "path"

export function abbreviateHome(input: string, home: string) {
  if (!home) return input
  const pathApi = input.startsWith("/") && home.startsWith("/") ? path.posix : path
  const relative = pathApi.relative(home, input)
  if (relative === "") return "~"
  if (relative === ".." || relative.startsWith(".." + pathApi.sep) || pathApi.isAbsolute(relative)) return input
  return "~" + pathApi.sep + relative
}
