import { describe, it, expect } from "vitest"
import {
  formatK,
  formatKM,
  formatCost,
  formatTimestamp,
  formatMessageDateTime,
  formatFileSize,
  formatDate,
  formatDateTime,
  formatRelativeDateTimeLabel,
  formatRelativeTime,
  formatDuration,
  truncate,
  capitalize,
  toTitleCase,
  formatPercentage,
} from "./formatting"

describe("formatK", () => {
  it("formats numbers less than 1000", () => {
    expect(formatK(0)).toBe("0")
    expect(formatK(500)).toBe("500")
    expect(formatK(999)).toBe("999")
  })

  it("formats thousands with K suffix", () => {
    expect(formatK(1000)).toBe("1K")
    expect(formatK(1500)).toBe("2K")
    expect(formatK(999999)).toBe("1000K")
  })

  it("formats millions with M suffix", () => {
    expect(formatK(1000000)).toBe("1M")
    expect(formatK(1500000)).toBe("1.5M")
    expect(formatK(2000000)).toBe("2M")
  })
})

describe("formatKM", () => {
  it("formats thousands with decimals", () => {
    expect(formatKM(1500)).toBe("1.5K")
    expect(formatKM(2000)).toBe("2K")
    expect(formatKM(2500)).toBe("2.5K")
  })

  it("formats millions with decimals", () => {
    expect(formatKM(1500000)).toBe("1.5M")
    expect(formatKM(2000000)).toBe("2M")
  })
})

describe("formatCost", () => {
  it("formats as currency with 2 decimals", () => {
    expect(formatCost(0)).toBe("$0.00")
    expect(formatCost(12.5)).toBe("$12.50")
    expect(formatCost(100)).toBe("$100.00")
    expect(formatCost(99.99)).toBe("$99.99")
  })
})

describe("formatTimestamp", () => {
  it("formats timestamp as YYYY-MM-DD HH:MM", () => {
    const timestamp = new Date("2023-12-31T23:59:00").getTime()
    const result = formatTimestamp(timestamp)
    expect(result).toMatch(/2023-12-31 23:59/)
  })
})

describe("formatMessageDateTime", () => {
  it("formats the local month, day, and minute", () => {
    const timestamp = new Date(2026, 7, 20, 21, 8).getTime()
    expect(formatMessageDateTime(timestamp)).toBe("8月20日 21:08")
  })

  it("returns an empty label for an invalid timestamp", () => {
    expect(formatMessageDateTime(Number.NaN)).toBe("")
  })
})

describe("formatRelativeDateTimeLabel", () => {
  const now = new Date(2026, 4, 5, 14, 23, 18).getTime()

  it("formats today as 今天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 5, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("今天 09:08:07")
  })

  it("formats yesterday as 昨天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 4, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("昨天 09:08:07")
  })

  it("formats day before yesterday as 前天 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 3, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("前天 09:08:07")
  })

  it("formats yesterday across month boundary as 昨天 HH:mm:ss", () => {
    const monthBoundaryNow = new Date(2026, 4, 1, 9, 8, 7).getTime()
    const timestamp = new Date(2026, 3, 30, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, monthBoundaryNow)).toBe("昨天 09:08:07")
  })

  it("formats day before yesterday across year boundary as 前天 HH:mm:ss", () => {
    const yearBoundaryNow = new Date(2026, 0, 1, 9, 8, 7).getTime()
    const timestamp = new Date(2025, 11, 30, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, yearBoundaryNow)).toBe("前天 09:08:07")
  })

  it("formats older dates as YYYY年MM月DD日 HH:mm:ss", () => {
    const timestamp = new Date(2026, 4, 1, 9, 8, 7).getTime()
    expect(formatRelativeDateTimeLabel(timestamp, now)).toBe("2026年05月01日 09:08:07")
  })
})

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(0)).toBe("0B")
    expect(formatFileSize(500)).toBe("500B")
    expect(formatFileSize(1023)).toBe("1023B")
  })

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0KB")
    expect(formatFileSize(1536)).toBe("1.5KB")
    expect(formatFileSize(10240)).toBe("10.0KB")
  })

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.0MB")
    expect(formatFileSize(1572864)).toBe("1.5MB")
    expect(formatFileSize(10485760)).toBe("10.0MB")
  })
})

describe("formatDate", () => {
  it("formats Date object", () => {
    const date = new Date("2023-12-31")
    const result = formatDate(date)
    expect(result).toContain("2023")
    expect(result).toContain("12")
    expect(result).toContain("31")
  })

  it("formats timestamp", () => {
    const timestamp = new Date("2023-12-31").getTime()
    const result = formatDate(timestamp)
    expect(result).toContain("2023")
    expect(result).toContain("12")
    expect(result).toContain("31")
  })

  it("formats date string", () => {
    const result = formatDate("2023-12-31")
    expect(result).toContain("2023")
    expect(result).toContain("12")
    expect(result).toContain("31")
  })
})

describe("formatDateTime", () => {
  it("formats Date object with time", () => {
    const date = new Date("2023-12-31T23:59:59")
    const result = formatDateTime(date)
    expect(result).toContain("2023")
    // Time format varies by locale, just check it contains a time-like pattern
    expect(result.length).toBeGreaterThan(10)
  })
})

describe("formatRelativeTime", () => {
  const now = Date.now()

  it('returns "just now" for recent times', () => {
    expect(formatRelativeTime(now - 30000)).toBe("just now")
  })

  it("formats minutes ago", () => {
    expect(formatRelativeTime(now - 60000)).toBe("1 minute ago")
    expect(formatRelativeTime(now - 120000)).toBe("2 minutes ago")
  })

  it("formats hours ago", () => {
    expect(formatRelativeTime(now - 3600000)).toBe("1 hour ago")
    expect(formatRelativeTime(now - 7200000)).toBe("2 hours ago")
  })

  it("formats days ago", () => {
    expect(formatRelativeTime(now - 86400000)).toBe("1 day ago")
    expect(formatRelativeTime(now - 172800000)).toBe("2 days ago")
  })

  it("formats future times", () => {
    // Use a slightly larger offset to avoid timing issues
    const result1 = formatRelativeTime(now + 3610000) // 1 hour + 10 seconds
    const result2 = formatRelativeTime(now + 86500000) // 1 day + 100 seconds
    expect(result1).toContain("in")
    expect(result1).toContain("hour")
    expect(result2).toContain("in")
    expect(result2).toContain("day")
  })
})

describe("formatDuration", () => {
  it("秒数使用中文单位并四舍五入", () => {
    expect(formatDuration(0)).toBe("0 秒")
    expect(formatDuration(23_400)).toBe("23 秒")
    expect(formatDuration(23_600)).toBe("24 秒")
  })

  it("分钟显示补零后的秒数", () => {
    expect(formatDuration(60_000)).toBe("1 分 00 秒")
    expect(formatDuration(65_000)).toBe("1 分 05 秒")
    expect(formatDuration(3_599_000)).toBe("59 分 59 秒")
  })

  it("小时显示补零后的分秒", () => {
    expect(formatDuration(3_600_000)).toBe("1 小时 00 分 00 秒")
    expect(formatDuration(3_665_000)).toBe("1 小时 01 分 05 秒")
    expect(formatDuration(7_265_000)).toBe("2 小时 01 分 05 秒")
  })

  it("负数返回空字符串", () => {
    expect(formatDuration(-1)).toBe("")
  })
})

describe("truncate", () => {
  it("returns string as-is if shorter than maxLength", () => {
    expect(truncate("Hello", 10)).toBe("Hello")
  })

  it("truncates long strings with ellipsis", () => {
    expect(truncate("Hello World", 8)).toBe("Hello...")
    expect(truncate("This is a long string", 10)).toBe("This is...")
  })

  it("handles exact length", () => {
    expect(truncate("12345", 5)).toBe("12345")
  })
})

describe("capitalize", () => {
  it("capitalizes first letter", () => {
    expect(capitalize("hello")).toBe("Hello")
    expect(capitalize("world")).toBe("World")
  })

  it("handles already capitalized strings", () => {
    expect(capitalize("Hello")).toBe("Hello")
  })

  it("handles empty string", () => {
    expect(capitalize("")).toBe("")
  })

  it("does not affect rest of string", () => {
    expect(capitalize("hELLO")).toBe("HELLO")
  })
})

describe("toTitleCase", () => {
  it("converts to title case", () => {
    expect(toTitleCase("hello world")).toBe("Hello World")
    expect(toTitleCase("the quick brown fox")).toBe("The Quick Brown Fox")
  })

  it("handles already title cased strings", () => {
    expect(toTitleCase("Hello World")).toBe("Hello World")
  })

  it("handles single word", () => {
    expect(toTitleCase("hello")).toBe("Hello")
  })
})

describe("formatPercentage", () => {
  it("formats percentage with default 1 decimal", () => {
    expect(formatPercentage(0.756)).toBe("75.6%")
    expect(formatPercentage(0.5)).toBe("50.0%")
    expect(formatPercentage(1)).toBe("100.0%")
  })

  it("formats percentage with custom decimals", () => {
    expect(formatPercentage(0.756, 0)).toBe("76%")
    expect(formatPercentage(0.756, 2)).toBe("75.60%")
  })

  it("handles zero", () => {
    expect(formatPercentage(0)).toBe("0.0%")
  })
})
