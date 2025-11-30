/**
 * Validation utilities for form inputs and data validation
 */

/**
 * Check if a string is a valid email address
 * @example isValidEmail("test@example.com") // => true
 * @example isValidEmail("invalid") // => false
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Check if a string is a valid URL
 * @example isValidUrl("https://example.com") // => true
 * @example isValidUrl("not a url") // => false
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Check if a string is a valid HTTP/HTTPS URL
 * @example isValidHttpUrl("https://example.com") // => true
 * @example isValidHttpUrl("ftp://example.com") // => false
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Check if a string is empty (null, undefined, or only whitespace)
 * @example isEmpty("") // => true
 * @example isEmpty("  ") // => true
 * @example isEmpty("hello") // => false
 */
export function isEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0
}

/**
 * Check if a string is not empty
 * @example isNotEmpty("hello") // => true
 * @example isNotEmpty("") // => false
 */
export function isNotEmpty(str: string | null | undefined): boolean {
  return !isEmpty(str)
}

/**
 * Check if a value is a number
 * @example isNumber(123) // => true
 * @example isNumber("123") // => false
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value)
}

/**
 * Check if a string contains only digits
 * @example isDigits("123") // => true
 * @example isDigits("12.3") // => false
 */
export function isDigits(str: string): boolean {
  return /^\d+$/.test(str)
}

/**
 * Check if a string is a valid integer
 * @example isInteger("123") // => true
 * @example isInteger("12.3") // => false
 */
export function isInteger(str: string): boolean {
  const num = Number(str)
  return Number.isInteger(num)
}

/**
 * Check if a string is a valid float
 * @example isFloat("12.3") // => true
 * @example isFloat("abc") // => false
 */
export function isFloat(str: string): boolean {
  const num = Number(str)
  return !isNaN(num) && isFinite(num)
}

/**
 * Check if a value is within a range (inclusive)
 * @example inRange(5, 1, 10) // => true
 * @example inRange(15, 1, 10) // => false
 */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

/**
 * Check if a string length is within a range (inclusive)
 * @example isLengthInRange("hello", 1, 10) // => true
 * @example isLengthInRange("hello", 1, 3) // => false
 */
export function isLengthInRange(str: string, min: number, max: number): boolean {
  const length = str.length
  return length >= min && length <= max
}

/**
 * Check if a string matches a pattern
 * @example matches("abc123", /^[a-z]+\d+$/) // => true
 */
export function matches(str: string, pattern: RegExp): boolean {
  return pattern.test(str)
}

/**
 * Check if a string starts with a prefix (case-insensitive)
 * @example startsWithIgnoreCase("Hello", "hel") // => true
 */
export function startsWithIgnoreCase(str: string, prefix: string): boolean {
  return str.toLowerCase().startsWith(prefix.toLowerCase())
}

/**
 * Check if a string ends with a suffix (case-insensitive)
 * @example endsWithIgnoreCase("Hello", "LLO") // => true
 */
export function endsWithIgnoreCase(str: string, suffix: string): boolean {
  return str.toLowerCase().endsWith(suffix.toLowerCase())
}

/**
 * Check if a string contains a substring (case-insensitive)
 * @example containsIgnoreCase("Hello World", "WORLD") // => true
 */
export function containsIgnoreCase(str: string, substring: string): boolean {
  return str.toLowerCase().includes(substring.toLowerCase())
}

/**
 * Validate a password meets minimum requirements
 * @example isStrongPassword("Abc123!@#") // => true
 * @example isStrongPassword("abc") // => false
 */
export function isStrongPassword(
  password: string,
  options: {
    minLength?: number
    requireUppercase?: boolean
    requireLowercase?: boolean
    requireDigits?: boolean
    requireSpecialChars?: boolean
  } = {},
): boolean {
  const {
    minLength = 8,
    requireUppercase = true,
    requireLowercase = true,
    requireDigits = true,
    requireSpecialChars = false,
  } = options

  if (password.length < minLength) return false
  if (requireUppercase && !/[A-Z]/.test(password)) return false
  if (requireLowercase && !/[a-z]/.test(password)) return false
  if (requireDigits && !/\d/.test(password)) return false
  if (requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false

  return true
}

/**
 * Sanitize a string by removing HTML tags
 * @example sanitizeHtml("<script>alert('xss')</script>") // => "alert('xss')"
 */
export function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "")
}

/**
 * Validate that all required fields in an object are present
 * @example hasRequiredFields({name: "John", age: 30}, ["name", "age"]) // => true
 * @example hasRequiredFields({name: "John"}, ["name", "age"]) // => false
 */
export function hasRequiredFields<T extends Record<string, unknown>>(obj: T, requiredFields: (keyof T)[]): boolean {
  return requiredFields.every((field) => obj[field] !== undefined && obj[field] !== null)
}
