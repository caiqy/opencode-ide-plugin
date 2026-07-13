# Binary File Mention Recovery

## Goal

Restore the behavior lost in `53ecc6ef0b`: mentioning an unsupported binary file keeps its path visible to the model without reading its contents or failing the session.

## Design

Adapt the original `2ea9557db4` behavior to the current `SessionPrompt` attachment pipeline. Sample the referenced file and reuse `classifyAttachment`. When it reports `binary`, emit a synthetic text part containing the referenced path and preserve the original file part. Do not invoke `Read` for that mention.

Keep explicit `Read` tool behavior unchanged: directly asking the tool to read unsupported binary content must still return `Cannot read binary file`.

## Verification

Restore focused coverage for:

- a prompt containing text plus a binary file mention;
- a prompt containing only a binary file mention.

Both cases must keep the path model-visible and produce no session error containing `Cannot read binary file`.

## Scope

No spreadsheet parsing, MIME expansion, UI changes, or changes to explicit `Read` calls.
