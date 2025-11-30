# Component Usage Examples

This document provides practical examples of how to use the common components, hooks, and utilities in the WebGUI application.

## Table of Contents

- [Common Components](#common-components)
  - [Button](#button)
  - [IconButton](#iconbutton)
  - [Card](#card)
  - [Modal](#modal)
  - [Input](#input)
  - [Select](#select)
- [Custom Hooks](#custom-hooks)
  - [useKeyboard](#usekeyboard)
  - [useDebounce](#usedebounce)
  - [useLocalStorage](#uselocalstorage)
  - [useClickOutside](#useclickoutside)
- [Utilities](#utilities)
  - [classNames (cn)](#classnames-cn)
  - [Formatting](#formatting)
  - [Validation](#validation)
  - [Path Utilities](#path-utilities)

---

## Common Components

### Button

The `Button` component provides a flexible button with multiple variants and sizes.

#### Basic Usage

```tsx
import { Button } from "@/components/common"

function MyComponent() {
  return <Button onClick={() => console.log("clicked")}>Click Me</Button>
}
```

#### Variants

```tsx
<Button variant="primary">Primary Button</Button>
<Button variant="secondary">Secondary Button</Button>
<Button variant="ghost">Ghost Button</Button>
<Button variant="danger">Danger Button</Button>
```

#### Sizes

```tsx
<Button size="xs">Extra Small</Button>
<Button size="sm">Small</Button>
<Button size="md">Medium (default)</Button>
<Button size="lg">Large</Button>
```

#### Loading State

```tsx
function SaveButton() {
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveData()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Button loading={isSaving} onClick={handleSave}>
      Save Changes
    </Button>
  )
}
```

#### Disabled State

```tsx
<Button disabled>Disabled Button</Button>
```

---

### IconButton

The `IconButton` component is designed for icon-only buttons with consistent sizing.

#### Basic Usage

```tsx
import { IconButton } from "@/components/common"

function CloseButton({ onClose }: { onClose: () => void }) {
  return <IconButton icon={<XMarkIcon />} aria-label="Close dialog" onClick={onClose} />
}
```

#### Different Sizes

```tsx
<IconButton
  size="sm"
  icon={<TrashIcon />}
  aria-label="Delete"
  onClick={handleDelete}
/>

<IconButton
  size="md"
  icon={<EditIcon />}
  aria-label="Edit"
  onClick={handleEdit}
/>

<IconButton
  size="lg"
  icon={<SettingsIcon />}
  aria-label="Settings"
  onClick={handleSettings}
/>
```

---

### Card

The `Card` component provides a container with optional header, body, and footer sections.

#### Basic Usage

```tsx
import { Card, CardHeader, CardBody, CardFooter } from "@/components/common"

function UserProfile() {
  return (
    <Card>
      <CardHeader>
        <h3>User Profile</h3>
      </CardHeader>
      <CardBody>
        <p>Name: John Doe</p>
        <p>Email: john@example.com</p>
      </CardBody>
      <CardFooter>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Save</Button>
      </CardFooter>
    </Card>
  )
}
```

#### Hoverable Card

```tsx
<Card hoverable onClick={handleCardClick}>
  <CardBody>
    <p>Click me!</p>
  </CardBody>
</Card>
```

#### Custom Padding

```tsx
<Card padding="none">
  <div className="p-6">Custom content with manual padding</div>
</Card>

<Card padding="lg">
  <p>Large padding card</p>
</Card>
```

---

### Modal

The `Modal` component provides a dialog with backdrop and keyboard support.

#### Basic Confirmation Modal

```tsx
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from "@/components/common"

function DeleteConfirmation({ isOpen, onClose, onConfirm }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>
        <h3>Confirm Deletion</h3>
      </ModalHeader>
      <ModalBody>
        <p>Are you sure you want to delete this item? This action cannot be undone.</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Delete
        </Button>
      </ModalFooter>
    </Modal>
  )
}
```

#### Modal with Form

```tsx
function EditUserModal({ isOpen, onClose, user }: Props) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async () => {
    setIsSaving(true)
    try {
      await updateUser({ name, email })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>
        <h3>Edit User</h3>
      </ModalHeader>
      <ModalBody>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={isSaving}>
          Save Changes
        </Button>
      </ModalFooter>
    </Modal>
  )
}
```

#### Custom Modal Behavior

```tsx
// Don't close on backdrop click
<Modal isOpen={isOpen} onClose={onClose} closeOnBackdropClick={false} closeOnEscape={false}>
  {/* Modal content */}
</Modal>
```

---

### Input

The `Input` component provides a text input with label, error, and icon support.

#### Basic Input

```tsx
import { Input } from "@/components/common"

function LoginForm() {
  const [email, setEmail] = useState("")

  return (
    <Input
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="Enter your email"
    />
  )
}
```

#### Input with Error

```tsx
function Form() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")

  const handleBlur = () => {
    if (!email.includes("@")) {
      setError("Please enter a valid email address")
    } else {
      setError("")
    }
  }

  return (
    <Input
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      onBlur={handleBlur}
      error={error}
      helperText="We'll never share your email with anyone"
    />
  )
}
```

#### Input with Icons

```tsx
<Input
  label="Search"
  placeholder="Search..."
  leftIcon={<SearchIcon />}
/>

<Input
  label="Password"
  type="password"
  rightIcon={<EyeIcon />}
/>
```

#### Input Sizes

```tsx
<Input inputSize="sm" placeholder="Small input" />
<Input inputSize="md" placeholder="Medium input (default)" />
<Input inputSize="lg" placeholder="Large input" />
```

---

### Select

The `Select` component provides a dropdown with label and error support.

#### Basic Select

```tsx
import { Select } from "@/components/common"

function CountrySelector() {
  const [country, setCountry] = useState("")

  const countries = [
    { value: "us", label: "United States" },
    { value: "uk", label: "United Kingdom" },
    { value: "ca", label: "Canada" },
  ]

  return (
    <Select
      label="Country"
      options={countries}
      value={country}
      onChange={(e) => setCountry(e.target.value)}
      placeholder="Select a country..."
    />
  )
}
```

#### Select with Error

```tsx
function Form() {
  const [role, setRole] = useState("")
  const [error, setError] = useState("")

  const roles = [
    { value: "admin", label: "Administrator" },
    { value: "user", label: "User" },
    { value: "guest", label: "Guest", disabled: true },
  ]

  return (
    <Select
      label="Role"
      options={roles}
      value={role}
      onChange={(e) => setRole(e.target.value)}
      error={error}
      helperText="Select the user's role"
    />
  )
}
```

---

## Custom Hooks

### useKeyboard

The `useKeyboard` hook manages keyboard shortcuts.

#### Basic Keyboard Shortcuts

```tsx
import { useKeyboard } from "@/hooks"

function Editor() {
  useKeyboard({
    handlers: [
      {
        key: "s",
        modKey: true, // Cmd/Ctrl
        handler: () => save(),
      },
      {
        key: "Escape",
        handler: () => closeModal(),
      },
    ],
  })

  return <div>Editor content</div>
}
```

#### Simple Single Shortcut

```tsx
import { useKeyboardShortcut } from "@/hooks"

function Component() {
  useKeyboardShortcut("s", () => save(), { modKey: true })
}
```

#### Multiple Modifiers

```tsx
useKeyboard({
  handlers: [
    {
      key: "s",
      modKey: true,
      shiftKey: true,
      handler: () => saveAs(),
    },
  ],
})
```

---

### useDebounce

The `useDebounce` hook delays value updates.

#### Debounced Search

```tsx
import { useDebounce } from "@/hooks"
import { useState, useEffect } from "react"

function SearchComponent() {
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedQuery = useDebounce(searchQuery, 500)

  useEffect(() => {
    if (debouncedQuery) {
      performSearch(debouncedQuery)
    }
  }, [debouncedQuery])

  return <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
}
```

#### Debounced Callback

```tsx
import { useDebouncedCallback } from "@/hooks"

function AutoSave() {
  const handleSave = useDebouncedCallback((content: string) => {
    saveToServer(content)
  }, 1000)

  return <textarea onChange={(e) => handleSave(e.target.value)} />
}
```

---

### useLocalStorage

The `useLocalStorage` hook manages localStorage with React state.

#### Basic Usage

```tsx
import { useLocalStorage } from "@/hooks"

function ThemeToggle() {
  const [theme, setTheme] = useLocalStorage("theme", "light")

  return <Button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Toggle Theme ({theme})</Button>
}
```

#### With Error Handling

```tsx
function Settings() {
  const [settings, setSettings] = useLocalStorage(
    "app-settings",
    { notifications: true, language: "en" },
    {
      onError: (error) => {
        console.error("Failed to save settings:", error)
        showToast("Failed to save settings")
      },
    },
  )

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={settings.notifications}
          onChange={(e) =>
            setSettings({
              ...settings,
              notifications: e.target.checked,
            })
          }
        />
        Enable Notifications
      </label>
    </div>
  )
}
```

#### Sync Across Tabs

```tsx
function SyncedCounter() {
  const [count, setCount] = useLocalStorage("counter", 0, {
    syncAcrossTabs: true, // Sync state across browser tabs
  })

  return (
    <div>
      <p>Count: {count}</p>
      <Button onClick={() => setCount(count + 1)}>Increment</Button>
    </div>
  )
}
```

---

### useClickOutside

The `useClickOutside` hook detects clicks outside an element.

#### Close Dropdown on Outside Click

```tsx
import { useClickOutside } from "@/hooks"
import { useRef, useState } from "react"

function Dropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useClickOutside(dropdownRef, () => {
    setIsOpen(false)
  })

  return (
    <div>
      <Button onClick={() => setIsOpen(!isOpen)}>Toggle Dropdown</Button>
      {isOpen && (
        <div ref={dropdownRef} className="dropdown-menu">
          <button>Option 1</button>
          <button>Option 2</button>
        </div>
      )}
    </div>
  )
}
```

#### With Escape Key

```tsx
import { useClickOutsideWithEscape } from "@/hooks"

function Modal() {
  const modalRef = useRef<HTMLDivElement>(null)

  useClickOutsideWithEscape(modalRef, () => {
    closeModal()
  })

  return <div ref={modalRef}>Modal content</div>
}
```

---

## Utilities

### classNames (cn)

The `cn` utility conditionally joins class names.

#### Basic Usage

```tsx
import { cn } from "@/utils"

function Component({ isActive, isDisabled }: Props) {
  return <div className={cn("base-class", isActive && "active-class", isDisabled && "disabled-class")}>Content</div>
}
```

#### With Objects

```tsx
<div
  className={cn("base", {
    "text-red-500": hasError,
    "text-green-500": isSuccess,
    "font-bold": isImportant,
  })}
>
  Text
</div>
```

#### With Arrays

```tsx
const baseClasses = ['flex', 'items-center', 'gap-2']
const conditionalClasses = isLarge ? ['text-lg', 'p-4'] : ['text-sm', 'p-2']

<div className={cn(baseClasses, conditionalClasses)}>
  Content
</div>
```

---

### Formatting

#### Number Formatting

```tsx
import { formatK, formatKM, formatCost, formatPercentage } from "@/utils"

function Stats({ tokens, cost, accuracy }: Props) {
  return (
    <div>
      <p>Tokens: {formatK(tokens)}</p>
      <p>Cost: {formatCost(cost)}</p>
      <p>Accuracy: {formatPercentage(accuracy)}</p>
    </div>
  )
}
```

#### Date Formatting

```tsx
import { formatDate, formatDateTime, formatRelativeTime, formatDuration } from "@/utils"

function Timestamps({ createdAt, duration }: Props) {
  return (
    <div>
      <p>Created: {formatDateTime(createdAt)}</p>
      <p>Time ago: {formatRelativeTime(createdAt)}</p>
      <p>Duration: {formatDuration(duration)}</p>
    </div>
  )
}
```

#### File Size Formatting

```tsx
import { formatFileSize } from "@/utils"

function FileInfo({ file }: Props) {
  return <p>Size: {formatFileSize(file.size)}</p>
}
```

#### Text Formatting

```tsx
import { truncate, capitalize, toTitleCase } from "@/utils"

function TextDisplay({ text }: Props) {
  return (
    <div>
      <p>Short: {truncate(text, 50)}</p>
      <p>Title: {toTitleCase(text)}</p>
      <p>Capitalized: {capitalize(text)}</p>
    </div>
  )
}
```

---

### Validation

#### Email and URL Validation

```tsx
import { isValidEmail, isValidUrl, isValidHttpUrl } from "@/utils"

function ContactForm() {
  const [email, setEmail] = useState("")
  const [website, setWebsite] = useState("")
  const [errors, setErrors] = useState({})

  const handleSubmit = () => {
    const newErrors = {}

    if (!isValidEmail(email)) {
      newErrors.email = "Invalid email address"
    }

    if (website && !isValidHttpUrl(website)) {
      newErrors.website = "Invalid website URL"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Submit form
  }

  return (
    <form onSubmit={handleSubmit}>
      <Input label="Email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
      <Input label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} error={errors.website} />
      <Button type="submit">Submit</Button>
    </form>
  )
}
```

#### String Validation

```tsx
import { isEmpty, isNotEmpty, isLengthInRange, matches } from "@/utils"

function validateUsername(username: string): string | null {
  if (isEmpty(username)) {
    return "Username is required"
  }

  if (!isLengthInRange(username, 3, 20)) {
    return "Username must be between 3 and 20 characters"
  }

  if (!matches(username, /^[a-zA-Z0-9_]+$/)) {
    return "Username can only contain letters, numbers, and underscores"
  }

  return null
}
```

#### Password Validation

```tsx
import { isStrongPassword } from "@/utils"

function PasswordInput({ password, onChange }: Props) {
  const isStrong = isStrongPassword(password, {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireDigits: true,
    requireSpecialChars: true,
  })

  return (
    <div>
      <Input type="password" label="Password" value={password} onChange={onChange} />
      {!isStrong && password && (
        <p className="text-red-500 text-sm">
          Password must be at least 8 characters with uppercase, lowercase, digits, and special characters
        </p>
      )}
    </div>
  )
}
```

---

### Path Utilities

#### Path Manipulation

```tsx
import { normalizePath, toDisplayPath, dirname, basename, extname, join } from "@/utils"

function FileExplorer({ filePath, projectRoot }: Props) {
  const displayPath = toDisplayPath(filePath, projectRoot)
  const fileName = basename(filePath)
  const directory = dirname(filePath)
  const extension = extname(filePath)

  return (
    <div>
      <p>File: {fileName}</p>
      <p>Directory: {directory}</p>
      <p>Type: {extension}</p>
      <p>Path: {displayPath}</p>
    </div>
  )
}
```

#### Joining Paths

```tsx
import { join } from "@/utils"

function buildPath(base: string, ...segments: string[]) {
  return join(base, ...segments)
}

// Example
const configPath = buildPath("src", "config", "settings.json")
// => "src/config/settings.json"
```

---

## Complete Example: User Management Form

Here's a complete example combining multiple components, hooks, and utilities:

```tsx
import { useState } from "react"
import { Modal, ModalHeader, ModalBody, ModalFooter, Button, Input, Select } from "@/components/common"
import { useKeyboard, useLocalStorage } from "@/hooks"
import { isValidEmail, isEmpty } from "@/utils"

interface User {
  name: string
  email: string
  role: string
}

function UserManagementForm() {
  const [isOpen, setIsOpen] = useState(false)
  const [users, setUsers] = useLocalStorage<User[]>("users", [])
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  // Keyboard shortcut to open modal
  useKeyboard({
    handlers: [
      {
        key: "n",
        modKey: true,
        handler: () => setIsOpen(true),
      },
    ],
  })

  const roleOptions = [
    { value: "admin", label: "Administrator" },
    { value: "user", label: "User" },
    { value: "viewer", label: "Viewer" },
  ]

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (isEmpty(name)) {
      newErrors.name = "Name is required"
    }

    if (isEmpty(email)) {
      newErrors.email = "Email is required"
    } else if (!isValidEmail(email)) {
      newErrors.email = "Invalid email address"
    }

    if (isEmpty(role)) {
      newErrors.role = "Role is required"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsSaving(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setUsers([...users, { name, email, role }])

      // Reset form
      setName("")
      setEmail("")
      setRole("")
      setIsOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    if (!isSaving) {
      setIsOpen(false)
      setErrors({})
    }
  }

  return (
    <div>
      <Button variant="primary" onClick={() => setIsOpen(true)}>
        Add User (Cmd+N)
      </Button>

      <Modal isOpen={isOpen} onClose={handleClose} size="lg" closeOnBackdropClick={!isSaving} closeOnEscape={!isSaving}>
        <ModalHeader onClose={handleClose}>
          <h3 className="text-lg font-semibold">Add New User</h3>
        </ModalHeader>

        <ModalBody>
          <div className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              placeholder="Enter user's name"
              disabled={isSaving}
            />

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              placeholder="Enter user's email"
              disabled={isSaving}
            />

            <Select
              label="Role"
              options={roleOptions}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              error={errors.role}
              placeholder="Select a role..."
              disabled={isSaving}
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={isSaving}>
            Add User
          </Button>
        </ModalFooter>
      </Modal>

      {/* Display users */}
      <div className="mt-4 space-y-2">
        {users.map((user, index) => (
          <div key={index} className="p-4 border rounded">
            <p className="font-semibold">{user.name}</p>
            <p className="text-sm text-gray-600">{user.email}</p>
            <p className="text-xs text-gray-500">{user.role}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Best Practices

1. **Always use TypeScript** - Components and utilities are fully typed
2. **Import from barrel exports** - Use `@/components/common`, `@/hooks`, `@/utils`
3. **Handle errors gracefully** - Use error states and validation
4. **Provide accessibility** - Use aria-labels, proper keyboard navigation
5. **Use loading states** - Show feedback during async operations
6. **Leverage hooks** - Use custom hooks for common patterns
7. **Keep components focused** - One component, one responsibility
8. **Test thoroughly** - Run tests after making changes

---

For more detailed documentation, see:

- [Component README](src/components/common/README.md)
- [Utilities README](src/utils/README.md)
- [Main Architecture README](README.md)
