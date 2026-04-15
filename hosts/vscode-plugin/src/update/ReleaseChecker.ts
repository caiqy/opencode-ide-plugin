import { compareVersion, normalizeVersion } from "./version"

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

type LatestReleaseResponse = {
  tag_name: string
  html_url: string
  body?: string
  published_at?: string
  assets?: ReleaseAsset[]
}

type RuntimeTarget = {
  platform: NodeJS.Platform | string
  arch: string
}

export type ReleaseInfo = {
  version: string
  releaseUrl: string
  notes?: string
  publishedAt?: string
  vsixUrl: string
}

function getVsixTarget(runtime: RuntimeTarget): string | null {
  const supported = new Set(["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"])
  const target = `${runtime.platform}-${runtime.arch}`
  return supported.has(target) ? target : null
}

export function pickVsixAsset(assets: ReleaseAsset[], runtime: RuntimeTarget = process): ReleaseAsset | null {
  const vsix = assets.filter((item) => item.name.endsWith(".vsix"))
  const target = getVsixTarget(runtime)

  if (!target) {
    return null
  }

  return vsix.find((item) => item.name.startsWith(`opencode-vscode-${target}-`)) ?? null
}

export function parseLatestRelease(input: LatestReleaseResponse, runtime: RuntimeTarget = process): ReleaseInfo {
  const version = normalizeVersion(input.tag_name)
  const asset = pickVsixAsset(input.assets ?? [], runtime)

  if (!asset) {
    throw new Error("Latest release has no installable VSIX asset")
  }

  return {
    version,
    releaseUrl: input.html_url,
    notes: input.body,
    publishedAt: input.published_at,
    vsixUrl: asset.browser_download_url,
  }
}

export class ReleaseChecker {
  constructor(
    private readonly repo: { owner: string; name: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getLatest(currentVersion: string): Promise<ReleaseInfo | null> {
    const response = await this.fetcher(
      `https://api.github.com/repos/${this.repo.owner}/${this.repo.name}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github+json" },
      },
    )

    if (!response.ok) {
      throw new Error(`GitHub release request failed: ${response.status}`)
    }

    const json = (await response.json()) as LatestReleaseResponse
    const latest = parseLatestRelease(json)
    return compareVersion(latest.version, currentVersion) > 0 ? latest : null
  }
}

export { compareVersion, normalizeVersion }
