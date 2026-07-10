type Target = {
  os: "linux" | "darwin" | "win32"
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}

type Install = {
  os: Target["os"]
  arch: Target["arch"]
}

const all: Target[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

export function targets(argv: string[], platform = process.platform, arch = process.arch) {
  const single = argv.includes("--single")
  const baseline = argv.includes("--baseline")
  const include = argv.find((item) => item.startsWith("--include-target="))?.slice("--include-target=".length)
  const exclude = new Set(
    argv
      .filter((item) => item.startsWith("--exclude-os="))
      .flatMap((item) => item.slice("--exclude-os=".length).split(","))
      .map((item) => item.trim())
      .filter(Boolean),
  )
  const list = all.filter((item) => !exclude.has(item.os))
  if (include) {
    const [targetOs, targetArch] = include.split("-")
    return list.filter((item) => {
      if (item.os !== targetOs || item.arch !== targetArch) return false
      if (item.avx2 === false) return false
      if (item.abi !== undefined) return false
      return true
    })
  }
  if (!single) return list
  return list.filter((item) => {
    if (item.os !== platform || item.arch !== arch) return false
    if (item.avx2 === false) return baseline
    if (item.abi !== undefined) return false
    return true
  })
}

export function installs(list: Target[]) {
  return list.reduce((acc, item) => {
    if (acc.some((value) => value.os === item.os && value.arch === item.arch)) {
      return acc
    }
    acc.push({ os: item.os, arch: item.arch })
    return acc
  }, [] as Install[])
}
