# WebGUI Session Event Type Fix

## Goal

Align the local `ServerEvent` type with the current server payload for `session.created` and `session.updated`.

## Design

Change only those two union members from `properties.session` to `properties.info`. Runtime parsing and consumers already use `info`; no runtime behavior changes.

Verify the contract with a type-level fixture and the WebGUI type checker.
