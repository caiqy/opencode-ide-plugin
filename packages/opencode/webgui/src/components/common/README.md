# Common UI Components

This directory contains reusable UI components following the existing design system defined in `src/index.css`.

## Components

### Button

A flexible button component with multiple variants and sizes.

**Props:**

- `variant?: "primary" | "secondary" | "ghost" | "danger"` - Visual style (default: "primary")
- `size?: "xs" | "sm" | "md" | "lg"` - Button size (default: "md")
- `loading?: boolean` - Show loading spinner (default: false)
- All standard HTML button attributes

**Example:**

```tsx
import { Button } from '@/components/common'

<Button variant="primary" size="md" onClick={handleClick}>
  Click me
</Button>

<Button variant="danger" loading={isSubmitting}>
  Delete
</Button>
```

---

### IconButton

A button designed specifically for icons with consistent sizing.

**Props:**

- `size?: "sm" | "md" | "lg"` - Button size (default: "md")
- `icon: ReactNode` - Icon content
- `aria-label: string` - Required accessibility label
- All standard HTML button attributes

**Example:**

```tsx
import { IconButton } from "@/components/common"

;<IconButton size="md" icon={<svg>...</svg>} aria-label="Close dialog" onClick={handleClose} />
```

---

### Card

A container component with optional header, body, and footer sections.

**Props:**

- `hoverable?: boolean` - Add hover effect (default: false)
- `padding?: "none" | "sm" | "md" | "lg"` - Internal padding (default: "md")
- All standard HTML div attributes

**Subcomponents:**

- `CardHeader` - Header section with bottom border
- `CardBody` - Main content area
- `CardFooter` - Footer section with top border and gray background

**Example:**

```tsx
import { Card, CardHeader, CardBody, CardFooter } from "@/components/common"

;<Card hoverable padding="md">
  <CardHeader>
    <h3>Title</h3>
  </CardHeader>
  <CardBody>
    <p>Content goes here</p>
  </CardBody>
  <CardFooter>
    <button>Action</button>
  </CardFooter>
</Card>
```

---

### Modal

A modal dialog with backdrop and keyboard support.

**Props:**

- `isOpen: boolean` - Control visibility
- `onClose: () => void` - Close handler
- `size?: "sm" | "md" | "lg" | "xl"` - Modal width (default: "md")
- `closeOnEscape?: boolean` - Allow ESC to close (default: true)
- `closeOnBackdropClick?: boolean` - Allow backdrop click to close (default: true)

**Subcomponents:**

- `ModalHeader` - Header with optional close button
- `ModalBody` - Main content area
- `ModalFooter` - Footer with flex layout for action buttons

**Example:**

```tsx
import { Modal, ModalHeader, ModalBody, ModalFooter, Button } from "@/components/common"

;<Modal isOpen={isOpen} onClose={handleClose} size="md">
  <ModalHeader onClose={handleClose}>
    <h3>Confirm Action</h3>
  </ModalHeader>
  <ModalBody>
    <p>Are you sure you want to proceed?</p>
  </ModalBody>
  <ModalFooter>
    <Button variant="secondary" onClick={handleClose}>
      Cancel
    </Button>
    <Button variant="danger" onClick={handleConfirm}>
      Confirm
    </Button>
  </ModalFooter>
</Modal>
```

---

### Input

A text input component with label, error, and icon support.

**Props:**

- `label?: string` - Input label text
- `error?: string` - Error message (adds red styling)
- `helperText?: string` - Helper text below input
- `inputSize?: "sm" | "md" | "lg"` - Input size (default: "md")
- `leftIcon?: ReactNode` - Icon on the left
- `rightIcon?: ReactNode` - Icon on the right
- All standard HTML input attributes

**Example:**

```tsx
import { Input } from "@/components/common"

;<Input
  label="Email"
  type="email"
  placeholder="Enter your email"
  error={errors.email}
  helperText="We'll never share your email"
  leftIcon={<EmailIcon />}
/>
```

---

### Select

A select dropdown component with label and error support.

**Props:**

- `label?: string` - Select label text
- `error?: string` - Error message (adds red styling)
- `helperText?: string` - Helper text below select
- `selectSize?: "sm" | "md" | "lg"` - Select size (default: "md")
- `options: SelectOption[]` - Array of option objects
- `placeholder?: string` - Placeholder option
- `leftIcon?: ReactNode` - Icon on the left
- All standard HTML select attributes

**SelectOption Type:**

```tsx
interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}
```

**Example:**

```tsx
import { Select } from '@/components/common'

const options = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2', disabled: true },
  { value: 'option3', label: 'Option 3' },
]

<Select
  label="Choose an option"
  options={options}
  placeholder="Select one..."
  error={errors.selection}
/>
```

---

## Design System

All components use CSS utility classes defined in `src/index.css`:

- `modern-button` - Base button styles with variants
- `modern-icon-button` - Icon button styles
- `modern-card` - Card container styles
- `modern-input` - Input field styles
- Modern color scheme with dark mode support
- Consistent spacing and transitions

## Usage Notes

1. **Import from barrel export:**

   ```tsx
   import { Button, Card, Input } from "@/components/common"
   ```

2. **All components support className override:**

   ```tsx
   <Button className="custom-class">Button</Button>
   ```

3. **Dark mode is handled automatically** through Tailwind's dark variant

4. **Accessibility is built-in:**
   - Proper ARIA attributes
   - Keyboard navigation support
   - Focus management
   - Screen reader support

5. **TypeScript support:**
   - Full type definitions exported
   - IntelliSense support
   - Type-safe props
