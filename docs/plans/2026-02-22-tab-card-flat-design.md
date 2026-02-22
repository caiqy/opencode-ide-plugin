# Tab Card Flat Redesign

**Date:** 2026-02-22
**Status:** Approved for Implementation

## Overview

Revert previous card-like modifications (borders, rounded corners) and restore a pure flat design. The goal is to enhance the visual distinction between active and inactive tabs solely through background lightness and the restoration of the blue bottom border, maintaining the zero-gap compact layout.

## Goals

- **Remove all borders** except the functional `border-b-2`.
- **Remove rounded corners** (`rounded-t-md`).
- **Enhance active tab visibility** with a brighter background in dark mode (`dark:bg-gray-800`).
- **Restore the blue bottom border** for the active tab (`border-b-blue-500`).
- **Maintain inactive tab distinction** with a very light/semi-transparent background (`bg-gray-100/50 dark:bg-gray-900/50`).
- Ensure the fade gradient matches the new background colors exactly to prevent visual artifacts.

## Technical Details

### 1. Tab Container Styles

- **Active State:**
  - Background: `bg-white dark:bg-gray-800`
  - Border: `border-b-2 border-b-blue-500`
  - Text: `text-gray-900 dark:text-gray-100`
- **Inactive State:**
  - Background: `bg-gray-100/50 dark:bg-gray-900/50`
  - Hover Background: `hover:bg-gray-200/50 dark:hover:bg-gray-800/50`
  - Border: `border-b-2 border-b-transparent`
  - Text: `text-gray-600 dark:text-gray-400`

### 2. Fade Gradient Styles

- **Active State:**
  - `from-white dark:from-gray-800`
- **Inactive State:**
  - `from-gray-100/50 dark:from-gray-900/50 group-hover:from-gray-200/50 dark:group-hover:from-gray-800/50`

### 3. Constraints Maintained

- Width logic remains `min-w-[72px] max-w-[180px] flex-[1_1_150px]` (using `TAB_WIDTH_CLASS`).
- Close button remains visible (`opacity-60 hover:opacity-100`) on inactive tabs.
- No `gap` between tabs.

## Testing Strategy

- Ensure TDD approach: Update tests to assert absence of `rounded`, presence of new `bg-*` and `border-b-blue-500` classes, and matching fade gradient classes before implementation.
