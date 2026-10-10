#!/usr/bin/env bun

// 版本规则 YY.M.DDNN：YY=年份后两位，M=不补零月份，DDNN=日期*100+当天序号（跨天归零）。
// 唯一实现：本地发版用 `bun run release:version --write` 算并写入版本号，
// CI preflight 用 `bun run release:version --verify <tag>` 校验 tag，禁止手写版本号。

const TZ = "Asia/Shanghai"
const PACKAGES = ["packages/opencode/webgui/package.json", "hosts/vscode-plugin/package.json"]

const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .format(new Date())
  .split("-")
  .map(Number)
const yy = year % 100

const sequence = (version: string) => {
  const parts = version.split(".").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined
  if (parts[0] !== yy || parts[1] !== month || Math.floor(parts[2] / 100) !== day) return undefined
  return parts[2] % 100
}

const format = (seq: number) => `${yy}.${month}.${day * 100 + seq}`
const readVersion = async (file: string) => (await Bun.file(file).json()).version as string

const args = process.argv.slice(2)
const target = args[0] === "--verify" ? (args[1] ?? "").replace(/^v/, "") : undefined

if (target !== undefined) {
  if (sequence(target) === undefined) {
    console.error(`❌ ${target || "(空版本号)"} 不符合 YY.M.DDNN：${TZ} 今天应为 ${format(0)}~${format(99)}`)
    process.exit(1)
  }
  console.log(`version=${target}`)
  process.exit(0)
}

const next = format((sequence(await readVersion(PACKAGES[0])) ?? -1) + 1)

if (args.includes("--write")) {
  for (const file of PACKAGES) {
    const raw = await Bun.file(file).text()
    const updated = raw.replace(`"version": "${(JSON.parse(raw) as { version: string }).version}"`, `"version": "${next}"`)
    if (updated === raw) throw new Error(`写入失败：${file}`)
    await Bun.write(file, updated)
  }
  const lock = await Bun.file("bun.lock").text()
  const updatedLock = lock.replace(
    /("packages\/opencode\/webgui": \{\n\s+"name": "webgui",\n\s+"version": ")[^"]+(")/,
    `$1${next}$2`,
  )
  if (updatedLock === lock) throw new Error("写入失败：bun.lock")
  await Bun.write("bun.lock", updatedLock)
  const written = await Promise.all(PACKAGES.map(readVersion))
  if (written.some((version) => version !== next)) throw new Error(`写入后版本不一致：${written.join(", ")}`)
}

console.log(`version=${next}`)
console.log(`tag=v${next}`)
