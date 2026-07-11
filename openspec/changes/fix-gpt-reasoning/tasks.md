## 1. Provider reasoning matrix

- [x] 1.1 Add failing tests for exact GPT-5.4/5.5/5.6 variant sets, aliases, snapshots, negative ID matches, and the preserved non-GPT fallback
- [x] 1.2 Update provider variant generation and remove `minimal` through GPT-specific branches without changing the shared non-GPT fallback

## 2. OpenAI wire mapping

- [ ] 2.1 Add failing tests for preserving `max` and mapping `ultra` to `max` in each affected provider body shape
- [ ] 2.2 Allow the OpenAI protocol to send `max` while ensuring it never sends an `ultra` wire value

## 3. WebGUI labels and verification

- [ ] 3.1 Add `极高 ultra`, fallback `Minimal`, and stale saved-selection tests; remove the obsolete Chinese `minimal` label tests
- [ ] 3.2 Run the relevant package tests, typechecks, and WebGUI build to verify model options and request behavior
