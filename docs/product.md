# Axune — product

## What it is

Axune is a developer-productivity product in two halves:

- **Axune Desktop** — runs on the user's real development machine, where the project files, Git
  repository, terminal and installed coding agents live.
- **Axune Mobile** — an iPhone app that pairs with the desktop and remotely drives those agents.

The user brings their own AI accounts. Axune sells orchestration, not inference.

## What makes it different

Not "Claude Code on your phone" — that already exists. Axune is **one mobile workspace where
multiple coding agents work on the same project.**

- **Paired Mode** — one prompt goes to several agents at once. Each investigates independently;
  Axune shows both results side by side.
- **Independent Mode** — each agent gets its own instruction and runs on its own.
- **Compare / Insights** — what both agents agree on, what each uniquely found, and a recommended
  next action.
- **Later: roles** — builder / reviewer, then planner / builder / reviewer with handoffs.

Initial agents: Claude Code and Codex. Gemini CLI later, through the same adapter abstraction.

## Build order

| Phase | Scope | State |
|---|---|---|
| 0 | Mobile UI from the mockup, fake data | **done** |
| 1 | Desktop + Claude Code over LAN, real repo, streaming, stop | next |
| 2 | Codex through the same adapter/event architecture | |
| 3 | Real Paired Mode — one prompt, two live runs | |
| 4 | Comparison / Insights built from the two real outputs | |
| 5 | Remote relay — works outside the local network | |
| 6 | Approvals, changed files, Git diff viewer | |
| 7 | Gemini CLI adapter | |
| 8 | Orchestration — builder/reviewer, planner/builder/reviewer, handoffs | |

## Definition of done for the first real version

1. Desktop launches.
2. User chooses a real Git repo.
3. Claude Code is detected.
4. iPhone launches Axune.
5. iPhone scans the desktop QR code.
6. Desktop and phone pair.
7. Mobile shows the project and Claude online.
8. User sends a read-only prompt.
9. Claude actually works against that repo.
10. Output streams back to the iPhone.
11. User can stop the run.
12. Reconnecting does not corrupt the session.

Codex and Paired Mode come only after that.

## Explicitly out of scope for now

Consumer chat surfaces, paid AI APIs, billing, enterprise/teams, voice control, budgets, a
marketing site, a large cloud backend, many providers, repo cloud sync, advanced analytics.
