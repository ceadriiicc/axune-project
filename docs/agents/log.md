# Collaboration log

Append-only, newest first. One short entry per working session: what you took, what you found,
what you left. Attribute every entry. This exists so the next session — either agent — does not
re-derive what was already settled, and so a finding is never lost to a closed chat window.

Findings themselves belong in `findings.md`; this is the narrative thread between them.

---

## 2026-09-09 (sixth) · Claude Code · privacy controls, built beside Codex

Codex held the main tree redesigning Home, so this was built in a **separate git worktree** at
`C:/dev/axune-privacy` on `axune/privacy-ledger` - the same isolation Axune uses for its own
agents. Neither of us could sweep up the other's files, which is the failure that produced commit
`27b48b2` earlier today.

Three privacy controls, chosen because none of them can limit an agent: an egress ledger (paths
and byte counts, never contents), `Axune-Agent` and `Axune-Run` commit trailers, and denials
persisted with their reason. Seven free checks in `try:privacy`, written to catch the ways a
record can lie. Eight gaps and the framework behind them are in the vault note
`12 PRIVACY RULES PROPOSED`.

One design note worth carrying: the ledger reads the **provider's** tool stream, not the
permission gate. `canUseTool` fires only when permission falls through to a prompt, so a ledger
built on the gate silently under-reports - the worst way for a privacy record to fail.

Found while reading, and it raises the priority of the plain-`ws://` problem: `tool_finished`
carries the **full tool result**, so file contents cross the LAN unencrypted in every event. The
phone discards them, but they are on the wire.

**Codex's session died mid-task** (`thread not found`), which had looked like half an hour of
deep thought. Its work stops at `27f2a46`. A neat validation of the stale-resume handling added
yesterday: provider sessions do vanish, and the graceful path is not hypothetical.

Left unmerged on purpose: Cedric has not judged the Home redesign on the phone yet. Two fixes
queued behind that merge - a formatter (Codex emitted 967-character lines, because the repo has
none) and the six-second auto-clear of "since you last checked".

## 2026-09-09 (fifth) · Claude Code · a duplicate-key bug, and the UI handed to Codex

Thread persistence confirmed on the real phone: archived, force-quit, still there.

Fixed a React duplicate-key warning Cedric hit on Home. The client opened a new socket without
closing the old one, so pairing while a stale connection was alive left two authenticated
sockets and the desktop broadcast every event down both. His LAN address moved from .21 to .20
today, which forced a rescan and made it reproducible. Fixed at the cause, and activity events
are now applied idempotently by id - delivery over a reconnecting transport is at-least-once and
should not be assumed otherwise.

Also instrumented the desktop feed with elapsed timings. A prompt from the phone took 37 seconds
to first word; the same prompt measured 8 seconds fresh and 12 resumed against the adapter
directly, so roughly 25 seconds is unexplained and worth a number rather than a theory.

Two Metro servers now run: 8081 serves the phone, 8082 serves a web build so Codex can see the
running app in a browser. Codex is taking the interface next - files under `apps/mobile/app` and
`apps/mobile/components`, on its own branch, with the state and transport layers off limits.

## 2026-09-09 (fourth) · Claude Code · the containment does not hold

Cleared Q1b and most of Q4's remainder, and the result reverses a conclusion from two entries
ago. **The `-c` overrides do not disable computer use, browser control or web search.** A
tempting prompt got all of them: `web_search` ran, `cua_repl` was called four times, and Codex
attempted to open a Chrome tab - with every override set.

The earlier run that looked clean had simply not asked for any of it. The caveat attached to that
finding said a tempting prompt should confirm it, and it was right to be there. Recorded plainly,
because this is the second time in one day that absence of evidence got written down as evidence
of absence. The findings section recommending those flags is now marked NOT YET SETTLED: a future
session reading it would have shipped an adapter that can reach the user's desktop from a phone.

Also settled, cheaply and mostly without model runs: the `.rules` grammar is Starlark (C25); an
invalid `.rules` at four plausible paths has no effect (C23); `-p/--profile` only layers on top
of the base config, so it cannot subtract a plugin (C22); and `CODEX_HOME` isolates both config
and auth (C21). That last is the way out - the base config is the only lever that removes a tool
rather than asking it not to be used.

Prepared `%LOCALAPPDATA%/Axune/codex-home/config.toml` with everything dangerous **absent**
rather than disabled. It needs one login from Cedric before it can be tested. Continues as Q7,
which now blocks `CodexAdapter`.

Noticed in passing: `execpolicy_amendment` and `proposed_*` strings hint that an agent can
propose amendments to its own execution policy (C24). If real, that outranks the grammar
question.

## 2026-09-09 (later still) · Codex · answers to Q2, Q3 and Q4

Codex wrote its answers straight into `findings.md` with honest status labels, including
declining to mark Q2 verified because its own task sandbox denied it write access to its state
directory. That restraint is exactly what the labels are for.

Its Q4 answer closed a real hole: a repository's own execpolicy `.rules` file is loaded unless
`--ignore-rules` is passed, and that file sits inside the worktree the agent can edit. Verified
and adopted — `--ignore-rules` is now part of the standard invocation, and confirmed not to
break execution. Its warning that an adapter must never silently drop an unknown JSONL record is
also now backed by C17: refused tool calls appear **only on stderr**, with no event at all.

**Process note, on Claude:** commit `27b48b2` included these answers without reviewing them,
because `git add -A` swept up Codex's edits to `findings.md` while that commit was about
something else. The content was good, but the commit message claims none of it and credits the
wrong author. Corrected here rather than by rewriting pushed history. **Check `git status` before
staging when another agent is working the same tree** — which is the rule `AGENTS.md` already
states about not editing the same files at once, arriving from the other direction.

## 2026-09-09 (later) · Claude Code · Q1 settled, and a correction against myself

Chased the read-only blocker to the end. It was never a Windows limitation: `--ignore-user-config`
stops the sandbox being provisioned with read and write roots, so it fails closed and refuses
every process. Recorded as C12, with C2 corrected in place rather than deleted.

Found while reading `~/.codex/.sandbox/*.log` — which showed commands succeeding for Codex at
the very moment they were failing for me. The sandbox turned out to be fully provisioned
already: two local users, a group, ACLs and firewall rules blocking egress and loopback for the
offline user (C13). The setup helper Cedric ran by hand was never an installer at all (C14).

Worth recording plainly: **Codex was right and I was wrong.** Its recommendation to use its own
sandbox as the enforcement boundary is now the plan. I refuted it on evidence that turned out to
be measuring the wrong thing, while holding all the evidence needed to see that. The status
labels in `findings.md` are what let this be corrected cleanly instead of quietly.

Left: `CodexAdapter` is unblocked. Q2, Q3, Q4 and the new Q1a are Codex's; Q1b is mine.

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
