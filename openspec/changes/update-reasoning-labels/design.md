## Context

`VariantSelector` iterates over server-provided `variants` and uses a local formatter for Chinese labels. The component already recognizes `minimal`, but list items do not show the original English values.

## Goals / Non-Goals

**Goals:**

- Show both Chinese labels and original English names in the reasoning effort popup.
- Keep server-provided levels such as `minimal` visible and selectable, passing their values through unchanged.
- Preserve the trigger button's compact Chinese display.

**Non-Goals:**

- Do not create or reorder reasoning levels not supplied by the server.
- Do not change variant persistence, submission, or default selection behavior.
- Do not introduce an internationalization framework.

## Decisions

- Reuse `formatVariantName` for Chinese labels and render the original `variant` beside each popup item. This keeps the English name aligned with the submitted value without adding configuration or data structures.
- Display the default item as `默认 / Default` and regular levels as `Chinese label / original English value`. Unknown levels retain the existing formatting fallback and remain selectable.
- Show English names only in the popup. Keep the trigger unchanged to avoid consuming message toolbar space.

## Risks / Trade-offs

- [Long unknown variants may widen the list] -> Keep a minimum width and allow content to expand naturally without fixed truncation.
- [Unknown variants may repeat the same text twice] -> Accept repetition to preserve the original server value without another mapping.
