# Axune — security notes

Axune drives programs that can change files and run commands. The threat model is therefore not
"a chat app" — it is remote control of a developer machine.

## Principles

- Never silently approve dangerous operations.
- Approval requests are surfaced clearly on mobile; the user can reject.
- The user can always stop a run. A `STOP ALL AGENTS` control comes later.
- Never store AI-provider passwords. Provider auth happens in the provider's own CLI.
- Pairing uses short-lived credentials.
- Source code stays local by default; complete repositories are not uploaded to Axune servers.
- Approval history is retained per session.
- Remote traffic (Phase 5) is designed for encrypted device-to-device communication via an
  authenticated relay, with no publicly exposed desktop port.

## Phase 1 caveat

The first LAN-only prototype is developer/trusted-user only. That is acceptable for the
prototype, but no architectural decision may make the above impossible later — in particular the
desktop WebSocket must never be reachable without pairing credentials.

## Git safety

Editing agents are isolated per branch and per worktree so they cannot overwrite each other.
Merging agent work is always an explicit user action.
