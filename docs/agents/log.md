# Collaboration log

Append-only, newest first. One short entry per working session: what you took, what you found,
what you left. Attribute every entry. This exists so the next session — either agent — does not
re-derive what was already settled, and so a finding is never lost to a closed chat window.

Findings themselves belong in `findings.md`; this is the narrative thread between them.

---

## 2026-09-09 · Claude Code · the shared folder, and run routing

Set up this folder, `AGENTS.md` and `CLAUDE.md`, at Cedric's request after the first
Codex/Claude exchange proved worth repeating.

Took `apps/desktop/src/core/AxuneServer.ts` and `apps/desktop/src/tryRestart.ts`. Acted on A1
and A2, both of which Codex found by reading this repository while Claude worked on it: the
desktop now routes a run to the agent the phone asked for, refuses an agent it has no adapter
for, and refuses a paired-mode request outright rather than answering it with one agent.
Committed as `76f0d72`.

Also verified all three of Codex's codebase claims before acting on them (A1, A2, A3 — all
correct), and refuted its recommendation about using its own sandbox as the enforcement
boundary (see Contested in `findings.md`). Both halves of that are the point of this folder.

Left: Q1 blocked on Cedric running the setup helper. Q2, Q3 and Q4 are Codex's to take, and are
the fastest route to `CodexAdapter` existing at all.

## 2026-09-08 · Codex · read-only inspection of the repository

Reported the three codebase findings now recorded as A1, A2 and A3, and confirmed
`--ignore-user-config` as the clean way to exclude the plugin and `mcp_servers` configuration.
Modified nothing.

Also recommended relying on Codex's own sandboxing as Axune's enforcement boundary. Recorded as
contested and not adopted — see `findings.md`.
