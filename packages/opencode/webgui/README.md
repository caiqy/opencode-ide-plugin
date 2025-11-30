# WebGUI - Component Architecture

This document provides an overview of the WebGUI component architecture.

## Architecture Principles

The codebase follows these key principles:

1. **Single Responsibility Principle (SRP)** - Each file has one clear purpose
2. **Separation of Concerns** - Business logic separated from UI rendering
3. **Component Composition** - Large components broken into smaller, focused pieces
4. **Hook Extraction** - Complex state and logic extracted into custom hooks
5. **Reusable Utilities** - Common functionality centralized in shared utilities
6. **Type Safety** - Full TypeScript support throughout

## Directory Structure

```
src/
├── components/           # React components
│   ├── common/          # Reusable UI components (Button, Modal, Input, etc.)
│   ├── MessageInput/    # Message input editor (refactored from 1153 lines)
│   ├── MessageList/     # Message list and rendering (refactored from 782 lines)
│   ├── CompactHeader/   # Header with session management (refactored from 655 lines)
│   ├── SettingsPanel/   # Settings panel orchestrator (refactored from 296 lines)
│   ├── DiffModal/       # Diff viewer modal (refactored from 413 lines)
│   ├── parts/           # Message part renderers
│   │   └── ToolPart/    # Tool part renderer (refactored from 682 lines)
│   ├── settings/        # Settings tab components
│   │   └── ApiKeysTab/  # API key management (refactored from 524 lines)
│   └── mention/         # Mention-related components
│       └── MentionPlugin/ # Lexical mention plugin (refactored from 284 lines)
├── hooks/               # Shared custom hooks
├── utils/               # Utility functions
├── state/               # State management (Context/Zustand)
├── lib/                 # Third-party integrations
└── test/                # Test setup and utilities
```

## Refactored Components

### Critical Components (Phase 1)

#### MessageInput (1153 → ~200 lines)

Complex message input editor with Lexical, file attachments, mentions, and keyboard shortcuts.

**Structure:**

```
MessageInput/
  ├── index.tsx              # Main orchestrator
  ├── EditorConfig.ts        # Lexical configuration
  ├── EditorToolbar.tsx      # Model/agent/file buttons
  ├── EditorContent.tsx      # Main editor area
  ├── MessageActions.tsx     # Send/stop/compact buttons
  ├── RetryBanner.tsx        # Retry on error banner
  └── hooks/
      ├── useMessageInput.ts    # Message submission logic
      ├── useFileAttachment.ts  # File handling
      ├── useDragDrop.ts        # Drag and drop
      └── useEditorKeyboard.ts  # Keyboard shortcuts
```

**Key Features:**

- Lexical rich text editor
- File attachment support
- Drag and drop
- Model/agent selection
- Keyboard shortcuts (Cmd/Ctrl+Enter, Cmd/Ctrl+K)
- Auto-resize and compact mode

#### MessageList (782 → ~150 lines)

Renders message history with multiple part types, scrolling, and fork/revert functionality.

**Structure:**

```
MessageList/
  ├── index.tsx              # Main orchestrator
  ├── MessageRow.tsx         # Single message row
  ├── MessagePart.tsx        # Part renderer dispatcher
  ├── TextPart.tsx           # Text with mentions
  ├── ReasoningPart.tsx      # Thinking blocks
  ├── CollapsiblePart.tsx    # Reusable collapsible
  ├── EmptyState.tsx         # No messages state
  ├── RevertBanner.tsx       # Revert status banner
  ├── RevertSummary.tsx      # Inline revert summary
  ├── ActionButtons.tsx      # Fork/undo buttons
  └── hooks/
      ├── useMessageScroll.ts  # Scroll management
      └── useMessageActions.ts # Fork/revert logic
```

**Key Features:**

- Multiple message part types (text, tool, reasoning, retry, error)
- Fork and revert functionality
- Auto-scroll to bottom
- Empty state with shortcuts
- Collapsible sections

#### ToolPart (682 → ~163 lines)

Renders tool invocations with syntax highlighting and interactive features.

**Structure:**

```
parts/ToolPart/
  ├── index.tsx              # Main dispatcher
  ├── BashTool.tsx           # Bash command renderer
  ├── ReadTool.tsx           # File read renderer
  ├── WriteTool.tsx          # File write renderer
  ├── EditTool.tsx           # File edit renderer (with diffs)
  ├── TodoTool.tsx           # Todo list renderer
  ├── GenericOutput.tsx      # Generic tool output
  ├── ToolHeader.tsx         # Common tool header
  ├── PermissionBanner.tsx   # Permission handling
  ├── PatchInfo.tsx          # Patch information
  ├── ToolDetails.tsx        # Collapsible details
  ├── ErrorDisplay.tsx       # Error display
  ├── TimingInfo.tsx         # Timing information
  └── utils.tsx              # Shared utilities
```

**Key Features:**

- Tool-specific renderers for different tool types
- Syntax highlighting for code
- Diff viewer for edit operations
- Collapsible tool details
- Permission approval handling
- Error display with timing

#### CompactHeader (655 → ~173 lines)

Header with session management, usage display, and action buttons.

**Structure:**

```
CompactHeader/
  ├── index.tsx              # Main component
  ├── StatusIndicator.tsx    # Connection status dot
  ├── ActionButtons.tsx      # Theme/settings/new session
  ├── UsageDisplay.tsx       # Usage metrics
  ├── SessionDropdown.tsx    # Session dropdown menu
  ├── SessionList.tsx        # Session list rendering
  ├── SessionItem.tsx        # Individual session item
  ├── utils.ts               # Formatting utilities
  └── hooks/
      ├── useSessionDropdown.ts  # Dropdown state & keyboard
      └── useSessionActions.ts   # Edit/delete operations
```

**Key Features:**

- Session dropdown with search
- Keyboard navigation (↑/↓/Enter/Escape)
- Usage metrics display
- Theme toggle
- Connection status indicator

### Medium Components (Phase 2)

#### ApiKeysTab (524 → ~149 lines)

API key management with OAuth support.

**Structure:**

```
settings/ApiKeysTab/
  ├── index.tsx              # Main component
  ├── ProviderCard.tsx       # Individual provider config
  ├── KeyInput.tsx           # Secure key input
  ├── OAuthSection.tsx       # OAuth login UI
  ├── ManualCodeInput.tsx    # Manual code entry
  ├── ProviderDropdown.tsx   # Add provider dropdown
  ├── EmptyState.tsx         # No providers state
  ├── utils.ts               # Utilities
  └── hooks/
      ├── useApiKeys.ts          # API key management
      ├── useOAuthFlow.ts        # OAuth authentication
      └── useProviderManagement.ts # Add/delete providers
```

#### DiffModal (413 → ~148 lines)

Modal for viewing file diffs with navigation.

**Structure:**

```
DiffModal/
  ├── index.tsx              # Modal wrapper
  ├── DiffViewer.tsx         # Diff display
  ├── DiffNavigation.tsx     # File tabs navigation
  ├── DiffHeader.tsx         # Header with view mode
  ├── utils.ts               # Diff computation
  └── hooks/
      └── useDiffData.ts     # Diff data management
```

#### SettingsPanel (296 → ~197 lines)

Settings panel with tab navigation.

**Structure:**

```
SettingsPanel/
  ├── index.tsx              # Main component
  ├── TabBar.tsx             # Tab navigation
  ├── SettingsHeader.tsx     # Header with close button
  ├── SettingsFooter.tsx     # Save/cancel buttons
  └── hooks/
      ├── useSettingsForm.ts      # Form state
      └── useUnsavedChanges.ts    # Change detection
```

#### MentionPlugin (284 → ~109 lines)

Lexical plugin for @ mentions.

**Structure:**

```
mention/MentionPlugin/
  ├── index.tsx              # Main plugin
  ├── MentionDetector.tsx    # @ detection logic
  ├── MentionHandler.tsx     # Mention creation
  └── utils.ts               # Helper functions
```

## Common UI Components (Phase 3)

Reusable UI components following the existing design system.

### Available Components

- **Button** - Multiple variants (primary, secondary, ghost, danger) and sizes
- **IconButton** - Icon-only buttons with accessibility
- **Card** - Container with header/body/footer sections
- **Modal** - Modal dialog with keyboard support
- **Input** - Text input with label, error, and icon support
- **Select** - Dropdown with label and error support

See [components/common/README.md](src/components/common/README.md) for detailed documentation.

## Custom Hooks (Phase 3)

Reusable hooks for common functionality.

### Available Hooks

- **useKeyboard** - Keyboard shortcut handling
- **useKeyboardShortcut** - Simple single-shortcut version
- **useDebounce** - Value debouncing
- **useDebouncedCallback** - Callback debouncing
- **useDebouncedCallbackAdvanced** - Advanced debounce with cancel/flush
- **useLocalStorage** - localStorage management with sync
- **useLocalStorageValue** - Simple one-time read
- **useLocalStorageKey** - Check if key exists
- **useClickOutside** - Click-outside detection
- **useClickOutsideMultiple** - Multiple refs support
- **useClickOutsideWithEscape** - Combined click-outside + Escape key

## Utility Functions (Phase 3)

Centralized utilities for consistent behavior.

### Available Utilities

- **classNames (cn)** - ClassName concatenation with conditionals
- **formatting** - Number, date, file size, and text formatting
- **validation** - Email, URL, password, and input validation
- **path** - Path normalization and manipulation

See [utils/README.md](src/utils/README.md) for detailed documentation.

## Testing (Phase 4)

### Test Infrastructure

- **Framework:** Vitest + React Testing Library
- **Coverage:** 211 tests covering components, hooks, and utilities
- **Commands:**
  - `bun run test` - Run tests in watch mode
  - `bun run test:ui` - Open Vitest UI
  - `bun run test:run` - Run tests once
  - `bun run test:coverage` - Generate coverage report

### Test Files

```
src/
├── test/
│   ├── setup.ts           # Test configuration
│   └── test-utils.tsx     # Testing utilities
├── components/common/
│   ├── Button.test.tsx    # Button component tests
│   ├── IconButton.test.tsx
│   ├── Modal.test.tsx
│   ├── Input.test.tsx
│   ├── Select.test.tsx
│   └── Card.test.tsx
├── hooks/
│   ├── useDebounce.test.ts
│   ├── useLocalStorage.test.ts
│   ├── useClickOutside.test.ts
│   └── useKeyboard.test.ts
└── utils/
    ├── classNames.test.ts
    ├── formatting.test.ts
    └── validation.test.ts
```

## Import Patterns

### Barrel Exports

Use barrel exports for cleaner imports:

```typescript
// Common components
import { Button, Modal, Input } from "@/components/common"

// Utilities
import { cn, formatDate, isValidEmail } from "@/utils"

// Hooks
import { useDebounce, useLocalStorage } from "@/hooks"
```

### Component Imports

Components maintain their original import paths:

```typescript
// Before refactoring
import MessageInput from "@/components/MessageInput"

// After refactoring (same path!)
import MessageInput from "@/components/MessageInput"
```

## File Size Targets

All refactored components meet these targets:

- **Main component files:** < 200 lines ✅
- **Hook files:** < 150 lines ✅
- **Utility files:** < 100 lines ✅
- **UI components:** < 80 lines ✅

## Benefits of Refactoring

1. **Maintainability** - Smaller files are easier to understand and modify
2. **Reusability** - Common components and hooks reduce duplication
3. **Testability** - Isolated components and hooks are easier to test
4. **Type Safety** - Full TypeScript support with IntelliSense
5. **Consistency** - Shared utilities ensure consistent behavior
6. **Accessibility** - Common components have built-in accessibility
7. **Performance** - Smaller components can be optimized more easily
8. **Developer Experience** - Clear structure makes onboarding easier

## Contributing

### Adding New Components

1. Follow the SRP - one file, one purpose
2. Extract hooks for complex logic
3. Separate business logic from UI
4. Keep files under size targets
5. Add TypeScript types
6. Document props and usage
7. Add tests if test infrastructure exists

### Modifying Existing Components

1. Read the component and its sub-components
2. Understand the hook dependencies
3. Maintain the existing structure
4. Keep changes focused
5. Test thoroughly after changes
6. Update documentation if needed

## Migration Guide

### From Old Structure

If you're working with code that references old monolithic components:

1. **Imports remain the same** - No need to update import paths
2. **Props unchanged** - Component APIs are stable
3. **Behavior identical** - Only structure changed, not functionality

### Using New Common Components

Replace custom implementations with common components:

```typescript
// Before
<button className="modern-button button-primary">
  Click me
</button>

// After
import { Button } from '@/components/common'
<Button variant="primary">Click me</Button>
```

### Using New Hooks

Replace custom implementations with shared hooks:

```typescript
// Before
useEffect(() => {
  const handler = (e: MouseEvent) => {
    if (!ref.current?.contains(e.target)) {
      close()
    }
  }
  document.addEventListener("mousedown", handler)
  return () => document.removeEventListener("mousedown", handler)
}, [])

// After
import { useClickOutside } from "@/hooks"
useClickOutside(ref, close)
```

## Related Documentation

- [Common Components](src/components/common/README.md)
- [Utilities](src/utils/README.md)
- [Refactoring Plan](REFACTOR.md)

## Support

For questions or issues with the component architecture:

1. Review this documentation
2. Check component-specific README files
3. Review the REFACTOR.md file for implementation details
4. Look at existing component implementations for patterns
