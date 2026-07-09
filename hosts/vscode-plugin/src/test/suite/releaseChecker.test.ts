import * as assert from "assert"
import {
  compareVersion,
  normalizeVersion,
  parseLatestRelease,
  pickVsixAsset,
  ReleaseChecker,
} from "../../update/ReleaseChecker"
import { testResponse } from "./fetchResponse"

suite("ReleaseChecker Test Suite", () => {
  test("normalizeVersion 会去掉 v 前缀", () => {
    assert.strictEqual(normalizeVersion("v26.4.1401"), "26.4.1401")
  })

  test("normalizeVersion 遇到非法版本字符串会抛错", () => {
    assert.throws(() => normalizeVersion("release-26.4.1401"), /Invalid version: release-26\.4\.1401/)
  })

  test("compareVersion 会按数字段比较", () => {
    assert.ok(compareVersion("26.4.1401", "26.4.1400") > 0)
    assert.ok(compareVersion("26.4.1400", "26.4.1401") < 0)
    assert.strictEqual(compareVersion("26.4.1401", "26.4.1401"), 0)
  })

  test("pickVsixAsset 在多平台 assets 中选择当前平台的 VSIX", () => {
    const asset = pickVsixAsset(
      [
        { name: "notes.txt", browser_download_url: "https://example.test/notes.txt" },
        {
          name: "opencode-vscode-linux-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/linux-x64.vsix",
        },
        {
          name: "opencode-vscode-win32-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/win32-x64.vsix",
        },
        {
          name: "opencode-vscode-darwin-arm64-26.4.1401.vsix",
          browser_download_url: "https://example.test/darwin-arm64.vsix",
        },
      ],
      { platform: "darwin", arch: "arm64" },
    )

    assert.strictEqual(asset?.browser_download_url, "https://example.test/darwin-arm64.vsix")
  })

  test("pickVsixAsset 在缺失目标平台资产时返回 null", () => {
    const asset = pickVsixAsset(
      [
        {
          name: "opencode-vscode-linux-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/linux-x64.vsix",
        },
        {
          name: "opencode-vscode-win32-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/win32-x64.vsix",
        },
      ],
      { platform: "darwin", arch: "arm64" },
    )

    assert.strictEqual(asset, null)
  })

  test("pickVsixAsset 在不支持的平台上返回 null", () => {
    const asset = pickVsixAsset(
      [
        {
          name: "opencode-vscode-linux-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/linux-x64.vsix",
        },
        {
          name: "opencode-vscode-win32-x64-26.4.1401.vsix",
          browser_download_url: "https://example.test/win32-x64.vsix",
        },
      ],
      { platform: "freebsd", arch: "x64" },
    )

    assert.strictEqual(asset, null)
  })

  test("parseLatestRelease 提取 version/releaseUrl/notes/publishedAt/vsixUrl", () => {
    const info = parseLatestRelease(
      {
        tag_name: "v26.4.1401",
        html_url: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
        body: "## changes",
        published_at: "2026-04-14T12:00:00Z",
        assets: [
          { name: "opencode-vscode-win32-x64-26.4.1401.vsix", browser_download_url: "https://example.test/a.vsix" },
        ],
      },
      { platform: "win32", arch: "x64" },
    )

    assert.deepStrictEqual(info, {
      version: "26.4.1401",
      releaseUrl: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
      notes: "## changes",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/a.vsix",
    })
  })

  test("parseLatestRelease 在无可安装 VSIX 时抛错", () => {
    assert.throws(
      () =>
        parseLatestRelease(
          {
            tag_name: "v26.4.1401",
            html_url: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
            assets: [
              {
                name: "opencode-vscode-linux-x64-26.4.1401.vsix",
                browser_download_url: "https://example.test/linux.vsix",
              },
              {
                name: "opencode-vscode-win32-x64-26.4.1401.vsix",
                browser_download_url: "https://example.test/win.vsix",
              },
            ],
          },
          { platform: "darwin", arch: "arm64" },
        ),
      /Latest release has no installable VSIX asset/,
    )
  })

  test("ReleaseChecker.getLatest 只在远端版本更新时返回 release", async () => {
    const calls: string[] = []
    const checker = new ReleaseChecker(
      { owner: "qtkj", name: "opencode-ui" },
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push(String(input))
        assert.strictEqual(init?.headers instanceof Object, true)
        return testResponse(
          JSON.stringify({
            tag_name: "v26.4.1401",
            html_url: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
            body: "## changes",
            published_at: "2026-04-14T12:00:00Z",
            assets: [
              { name: "opencode-vscode-win32-x64-26.4.1401.vsix", browser_download_url: "https://example.test/a.vsix" },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        )
      },
    )

    const latest = await checker.getLatest("26.4.1400")
    const current = await checker.getLatest("26.4.1401")

    assert.strictEqual(calls.length, 2)
    assert.strictEqual(calls[0], "https://api.github.com/repos/qtkj/opencode-ui/releases/latest")
    assert.deepStrictEqual(latest, {
      version: "26.4.1401",
      releaseUrl: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
      notes: "## changes",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/a.vsix",
    })
    assert.strictEqual(current, null)
  })

  test("ReleaseChecker.getLatest 在 GitHub 非 2xx 时抛错", async () => {
    const checker = new ReleaseChecker({ owner: "qtkj", name: "opencode-ui" }, async () =>
      testResponse("rate limited", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    )

    await assert.rejects(() => checker.getLatest("26.4.1400"), /GitHub release request failed: 503/)
  })
})
