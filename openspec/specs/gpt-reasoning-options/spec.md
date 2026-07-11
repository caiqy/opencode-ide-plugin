# gpt-reasoning-options Specification

## Purpose
TBD - created by archiving change fix-gpt-reasoning. Update Purpose after archive.
## Requirements
### Requirement: GPT-5.4 reasoning options match the concrete model
The system SHALL offer `none`, `low`, `medium`, `high`, and `xhigh` for GPT-5.4, GPT-5.4 mini, and GPT-5.4 nano. It SHALL offer only `medium`, `high`, and `xhigh` for GPT-5.4 Pro.

#### Scenario: Standard and smaller GPT-5.4 models
- **WHEN** the system generates variants for GPT-5.4, GPT-5.4 mini, or GPT-5.4 nano
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, and `xhigh`

#### Scenario: GPT-5.4 Pro
- **WHEN** the system generates variants for GPT-5.4 Pro
- **THEN** the reasoning levels are exactly `medium`, `high`, and `xhigh`

### Requirement: GPT-5.5 reasoning options match the concrete model
The system SHALL offer `none`, `low`, `medium`, `high`, and `xhigh` for GPT-5.5. It SHALL offer only `medium`, `high`, and `xhigh` for GPT-5.5 Pro.

#### Scenario: GPT-5.5
- **WHEN** the system generates variants for GPT-5.5
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, and `xhigh`

#### Scenario: GPT-5.5 Pro
- **WHEN** the system generates variants for GPT-5.5 Pro
- **THEN** the reasoning levels are exactly `medium`, `high`, and `xhigh`

### Requirement: GPT-5.6 reasoning options match the family member
The system SHALL offer `none`, `low`, `medium`, `high`, `xhigh`, and `max` for GPT-5.6 Sol, Terra, and Luna. It SHALL additionally offer `ultra` for Sol and Terra but MUST NOT offer `ultra` for Luna. The `gpt-5.6` alias SHALL use the same options as Sol.

#### Scenario: Sol and its alias
- **WHEN** the system generates variants for `gpt-5.6` or GPT-5.6 Sol
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`

#### Scenario: Terra
- **WHEN** the system generates variants for GPT-5.6 Terra
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`

#### Scenario: Luna
- **WHEN** the system generates variants for GPT-5.6 Luna
- **THEN** the reasoning levels are exactly `none`, `low`, `medium`, `high`, `xhigh`, and `max`

### Requirement: Ultra maps to OpenAI max effort
The system SHALL set the OpenAI request effort of the `ultra` variant to `max` and MUST NOT send `ultra` as an OpenAI API wire value.

#### Scenario: Selecting ultra
- **WHEN** a user selects `ultra` for a GPT-5.6 model that supports the option
- **THEN** the OpenAI request contains `reasoning.effort: "max"`

### Requirement: OpenAI requests allow max effort
The system SHALL accept and preserve the `max` reasoning effort produced by a GPT-5.6 variant.

#### Scenario: Selecting max
- **WHEN** a user selects `max` for a GPT-5.6 model
- **THEN** the OpenAI request contains `reasoning.effort: "max"`

### Requirement: WebGUI displays a bilingual ultra label
The WebGUI SHALL display the `ultra` reasoning option as `极高 ultra`.

#### Scenario: Rendering the ultra option
- **WHEN** the reasoning selector renders an `ultra` variant
- **THEN** the user sees the Chinese label `极高` and the English value `ultra`

### Requirement: GPT models do not offer minimal
The system MUST NOT generate a `minimal` variant for any GPT model and the WebGUI MUST NOT retain its global Chinese translation for `minimal`. The generic LLM effort schema and non-GPT provider variants MAY retain the literal.

#### Scenario: Generating variants for a GPT model
- **WHEN** the system generates variants for any GPT model
- **THEN** the variants do not contain `minimal`

#### Scenario: Rendering generic reasoning labels
- **WHEN** the WebGUI renders reasoning variants
- **THEN** it does not apply the removed Chinese `minimal` translation and a remaining non-GPT `minimal` option uses the normal fallback label

#### Scenario: Loading a removed saved selection
- **WHEN** a saved GPT selection still names the removed `minimal` variant
- **THEN** it contributes no variant-specific request options and the normal base options remain in effect

