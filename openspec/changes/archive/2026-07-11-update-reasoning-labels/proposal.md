## Why

New GPT models add the `minimal` reasoning level, and the WebGUI needs to present the complete set of reasoning options supplied by the server. The current popup shows only Chinese labels, making it difficult to match them with the English levels used in model documentation.

## What Changes

- Support and display the `minimal` level in the reasoning effort list.
- Display each original English level name to the right of its Chinese label.
- Preserve selection values, default behavior, and persistence behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webgui-upstream-compatibility`: Model variant selection must cover new GPT reasoning levels and present both Chinese labels and original English names in the list.

## Impact

This affects the WebGUI reasoning effort selector and its component tests. It does not change APIs, data structures, dependencies, or the IDE bridge.
