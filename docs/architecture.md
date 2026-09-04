# Axune — architecture

```
Axune Mobile  ──(LAN now, encrypted relay later)──>  Axune Desktop  ──>  Claude Code / Codex / Gemini
                                                            └──> selected Git repository
```

## Stack

- **Mobile** — React Native, Expo, Expo Router, TypeScript strict. iPhone-first.
- **Desktop** — Electron + React + TypeScript + Node. Chosen for straightforward access to child
  processes, terminal streams, filesystem, Git, WebSockets and process detection. Not to be
  rewritten in Tauri/Rust prematurely.

## Hard rule: provider knowledge stays on the desktop

Every provider integration lives behind an adapter on the desktop:

- `ClaudeCodeAdapter`
- `CodexAdapter`
- `GeminiAdapter` (later)

Mobile must never parse Claude-specific or Codex-specific terminal output. Adapters translate
their provider into one shared event model — see [`packages/protocol`](../packages/protocol/src/events.ts).
This shared protocol is a core architecture decision, not an implementation detail.

Event types: `run_started`, `working`, `waiting`, `message_delta`, `tool_started`,
`tool_finished`, `command_started`, `command_output`, `file_changed`, `approval_requested`,
`approval_resolved`, `run_finished`, `error`.

## Desktop modules

| Module | Responsibility |
|---|---|
| Agent Adapter Layer | Provider integration; emits the shared event model |
| Process Manager | Starts/stops agents, captures structured output |
| Project Manager | Selected repositories and project metadata |
| Git / Worktree Manager | Branches, diffs, isolated agent workspaces |
| Session Manager | Sessions, selected agents, messages, status |
| Pairing Manager | Pairs iPhone and desktop |
| Security Manager | Permissions, approvals, device trust, stopping agents |
| Relay Client | Remote connectivity (Phase 5) |

## Git isolation

Two agents must never freely edit the same working tree at the same time.

- **Investigation-only tasks** — agents may inspect the same repository.
- **Modification tasks** — each editing agent gets its own branch and its own Git worktree, e.g.
  `axune/<project>-claude-worktree`, `axune/<project>-codex-worktree`.
- **Reviewer agents** inspect another agent's branch or diff without modifying it.
- **Merging is always explicit** — Axune never silently combines work.

Phase 1 only runs read-only prompts, but the architecture assumes this from day one.

## Authentication

Axune never asks for OpenAI, Anthropic or Google passwords. The desktop detects the officially
installed clients and, when authentication is missing, sends the user through that tool's own
login flow (Codex signs in with the user's ChatGPT account). Axune drives the already
authenticated local client. Provider docs must be re-checked when implementing each adapter —
these tools change.

## Connectivity

Phase 1 is LAN-only: desktop selects a project and shows a QR code, the phone scans it and pairs
with short-lived credentials. Phase 5 adds an authenticated relay, with the desktop making an
outbound connection rather than exposing a public port.

## Packages

- `packages/shared` — branding/product constants, so the product can be renamed later.
- `packages/protocol` — the shared agent event model.
- `packages/agent-core`, `packages/git-core` — to be added when Phase 1/2 adapters and worktree
  handling land; deliberately not stubbed out yet.
