## MODIFIED Requirements

### Requirement: Preserve WebGUI behavior through upstream sync

After merging upstream opencode updates, the system SHALL keep the IDE-hosted WebGUI usable across core session, message, provider, project, permission, question, and tool-result workflows.

#### Scenario: Core WebGUI session workflow still works

- **WHEN** the merged build runs the WebGUI and connects to the opencode server
- **THEN** users can load project/path data, list sessions, create, switch, update, or delete a session, submit prompts, receive streamed message updates, and observe idle/status transitions without API shape errors

#### Scenario: Permission and question flows still work

- **WHEN** the server issues a permission or question request for a session
- **THEN** the WebGUI displays the pending request and can reply or reject through the expected API route

#### Scenario: Provider and model selection still works

- **WHEN** users load or change provider, model, agent, or variant selection
- **THEN** the WebGUI restores available selections, falls back from unavailable selections, and persists the final selection without breaking prompt submission

#### Scenario: Reasoning variant labels remain understandable

- **WHEN** a reasoning model provides variant selection including `minimal`
- **THEN** the WebGUI shows every available variant in the reasoning effort list, displays the original English name to the right of its Chinese label, and still submits the original variant value
