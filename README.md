# Axune

Your coding agents, in sync.

One mobile workspace where multiple coding agents (Claude Code, Codex, later Gemini CLI) work on
the same project — independently, in parallel on the same prompt (Paired Mode), or eventually in
roles (planner / builder / reviewer).

- **Axune Desktop** runs on the development machine: it holds the repo, the terminal, and the
  installed coding agents.
- **Axune Mobile** pairs with the desktop and drives those agents remotely.

Users bring their own AI accounts. Axune provides no model inference and never asks for provider
passwords.

## Repository layout

```
apps/
  mobile/       Expo + Expo Router iPhone app  (Phase 0 — built, fake data)
  desktop/      Electron companion             (Phase 1 — not started)
packages/
  shared/       Branding and cross-app constants
  protocol/     The shared agent event model every adapter emits
docs/
  product.md, architecture.md, security-notes.md
```

## Running the mobile app

```bash
npm run mobile
```

Then open it with Expo Go on the iPhone, or press `w` for the browser. Web is only used as a
quick visual check — the app targets iPhone.

Typecheck everything:

```bash
npm run typecheck
```

## Status

Phase 0 (mobile UI on fake data) is in place: Home, Sessions & Settings, Workspace, Insights.
Nothing talks to a real agent yet — see [docs/product.md](docs/product.md) for the phase order.
