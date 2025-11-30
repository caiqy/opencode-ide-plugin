# Utility Functions

This directory contains shared utility functions used throughout the application. These utilities provide consistent, reusable functionality for common operations.

## Available Utilities

### `classNames.ts` - ClassName Management

The `cn()` function provides flexible className concatenation with support for conditional classes.

```typescript
import { cn } from "../utils/classNames"

// Basic usage
cn("foo", "bar") // => 'foo bar'

// Conditional classes
cn("base", condition && "active") // => 'base active' or 'base'
cn("base", { active: isActive, disabled: isDisabled }) // => 'base active' or 'base disabled'

// Filters out falsy values
cn("foo", undefined, null, false, "bar") // => 'foo bar'

// Arrays and nested structures
cn(["foo", "bar"], condition && "baz") // => 'foo bar baz'
```

**Use Cases:**

- Dynamic className generation based on state
- Combining multiple conditional classes
- Cleaner alternative to template literals with conditionals

---

### `formatting.ts` - Data Formatting

Comprehensive formatting utilities for numbers, dates, file sizes, and text.

#### Number Formatting

```typescript
import { formatK, formatKM, formatCost, formatPercentage } from "../utils/formatting"

formatK(1500) // => "2K"
formatK(1500000) // => "1.5M"
formatKM(1500) // => "1.5K" (shows decimals for K)
formatCost(12.5) // => "$12.50"
formatPercentage(0.756, 1) // => "75.6%"
```

#### Date & Time Formatting

```typescript
import { formatDate, formatDateTime, formatTimestamp, formatRelativeTime, formatDuration } from "../utils/formatting"

formatDate(new Date()) // => "12/31/2023"
formatDateTime(new Date()) // => "12/31/2023, 11:59:59 PM"
formatTimestamp(1234567890000) // => "2009-02-13 23:31"
formatRelativeTime(Date.now() - 3600000) // => "1 hour ago"
formatDuration(65000) // => "1m 5s"
```

#### File Size Formatting

```typescript
import { formatFileSize } from "../utils/formatting"

formatFileSize(1024) // => "1.0KB"
formatFileSize(1536) // => "1.5KB"
formatFileSize(1048576) // => "1.0MB"
```

#### Text Formatting

```typescript
import { truncate, capitalize, toTitleCase } from "../utils/formatting"

truncate("Hello World", 8) // => "Hello..."
capitalize("hello") // => "Hello"
toTitleCase("hello world") // => "Hello World"
```

---

### `validation.ts` - Input Validation

Validation utilities for form inputs and data validation.

#### String Validation

```typescript
import { isEmpty, isNotEmpty, isValidEmail, isValidUrl, isValidHttpUrl } from "../utils/validation"

isEmpty("") // => true
isEmpty("  ") // => true
isNotEmpty("hello") // => true
isValidEmail("test@example.com") // => true
isValidUrl("https://example.com") // => true
isValidHttpUrl("https://example.com") // => true
isValidHttpUrl("ftp://example.com") // => false
```

#### Number Validation

```typescript
import { isNumber, isDigits, isInteger, isFloat, inRange } from "../utils/validation"

isNumber(123) // => true
isDigits("123") // => true
isInteger("123") // => true
isFloat("12.3") // => true
inRange(5, 1, 10) // => true
```

#### String Checks

```typescript
import {
  isLengthInRange,
  matches,
  startsWithIgnoreCase,
  endsWithIgnoreCase,
  containsIgnoreCase,
} from "../utils/validation"

isLengthInRange("hello", 1, 10) // => true
matches("abc123", /^[a-z]+\d+$/) // => true
startsWithIgnoreCase("Hello", "hel") // => true
endsWithIgnoreCase("Hello", "LLO") // => true
containsIgnoreCase("Hello World", "WORLD") // => true
```

#### Password Validation

```typescript
import { isStrongPassword } from "../utils/validation"

isStrongPassword("Abc123!@#") // => true
isStrongPassword("abc", {
  minLength: 3,
  requireUppercase: false,
  requireDigits: false,
}) // => true
```

#### Security & Sanitization

```typescript
import { sanitizeHtml, hasRequiredFields } from "../utils/validation"

sanitizeHtml("<script>alert('xss')</script>") // => "alert('xss')"
hasRequiredFields({ name: "John", age: 30 }, ["name", "age"]) // => true
```

---

### `path.ts` - Path Utilities

Path manipulation utilities for file paths.

```typescript
import { normalizePath, toProjectRelative, toDisplayPath, dirname, basename, extname, join } from "../utils/path"

// Normalize paths (convert backslashes, remove trailing slash)
normalizePath("C:\\Users\\test\\") // => "C:/Users/test"

// Convert to project-relative paths
toProjectRelative("/home/user/project/src/file.ts", "/home/user/project")
// => "src/file.ts"

// Get display-friendly paths
toDisplayPath("/home/user/project/src/file.ts", "/home/user/project")
// => "src/file.ts"

// Path components
dirname("/home/user/file.txt") // => "/home/user"
basename("/home/user/file.txt") // => "file.txt"
extname("file.txt") // => ".txt"

// Join path segments
join("src", "components", "Button.tsx") // => "src/components/Button.tsx"
```

---

## Migration Notes

### Backwards Compatibility

Some utilities maintain backwards compatibility by re-exporting from their new location:

- `lib/path.ts` - Now re-exports from `utils/path.ts` (deprecated but kept for compatibility)
- `lib/fileUtils.ts` - Re-exports `formatFileSize` from `utils/formatting.ts`
- `components/CompactHeader/utils.ts` - Re-exports formatting utilities

### Recommended Migration

When updating code, prefer importing directly from the utils directory:

```typescript
// Old (deprecated, no longer works)
import { normalizePath } from "../lib/path"

// New (recommended)
import { normalizePath } from "../utils/path"

// Or use barrel export
import { normalizePath, formatFileSize, cn } from "../utils"
```

---

## Best Practices

1. **Type Safety**: All utilities are fully typed. Use TypeScript's type checking to catch errors early.

2. **Tree Shaking**: Import only what you need to keep bundle size small:

   ```typescript
   // Good - only imports formatDate
   import { formatDate } from "../utils/formatting"

   // Less optimal - imports entire formatting module
   import * as formatting from "../utils/formatting"
   ```

3. **Consistent Usage**: Use these utilities consistently across the codebase instead of creating one-off implementations.

4. **Error Handling**: Most utilities handle edge cases (null, undefined, empty strings), but always validate critical inputs.

5. **Performance**: These utilities are optimized for common use cases. For performance-critical code with millions of iterations, consider specialized implementations.

---

## Adding New Utilities

When adding new utilities:

1. Choose the appropriate category file (classNames, formatting, validation, path)
2. Add comprehensive JSDoc comments with examples
3. Export the function from the category file
4. Add the export to `index.ts` if it should be publicly available
5. Add documentation to this README
6. Add tests if creating new test infrastructure

---

## Examples in the Codebase

See these files for real-world usage examples:

- `CodeBlock.tsx` - Uses `cn()` for conditional classes
- `ModelSelector.tsx` - Uses `formatDate()` for date formatting
- `CompactHeader/utils.ts` - Uses formatting utilities for numbers and costs
- `MessageInput/hooks/useDragDrop.ts` - Uses path utilities
- `MessageList/CollapsiblePart.tsx` - Uses `cn()` for dynamic styling
