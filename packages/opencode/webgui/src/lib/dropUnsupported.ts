export const unsupportedSystemFileDropMessage =
  "无法从系统文件管理器获取文件路径。请从 VSCode Explorer 拖拽文件，或使用右键 Add to context。"

const uriListTypes = new Set(["application/vnd.code.uri-list", "text/uri-list"])

function hasUriListType(types: readonly string[] | undefined) {
  return (types ?? []).some((type) => uriListTypes.has(type))
}

export function isUnsupportedNativeSystemFileDrop(input: { types: readonly string[]; paths: readonly string[] }) {
  return input.paths.length === 0 && input.types.includes("Files") && !hasUriListType(input.types)
}

export function isUnsupportedForwardedSystemFileDrop(
  input: { dataTransfer?: { types?: readonly string[]; data?: Record<string, string> } } | undefined,
) {
  const types = input?.dataTransfer?.types ?? []
  const data = input?.dataTransfer?.data ?? {}
  return types.includes("Files") && !data["application/vnd.code.uri-list"] && !data["text/uri-list"]
}
