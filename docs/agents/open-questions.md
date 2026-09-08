# Open questions

The live queue. Each has an owner. Move settled items into `findings.md` with a status label
rather than answering them here, so the answer outlives the question.

Owners: **Codex** for its own CLI internals, config schema, event stream and sandbox.
**Claude** for this codebase and for settling things by running them. **Cedric** for anything
needing his machine, his accounts, or a product decision.

---

## Q1a — Which sandbox user does a run execute as, and can we demand the offline one? · owner: Codex

`CodexSandboxOffline` has outbound **and loopback** traffic blocked by firewall rule; the online
user does not (C15). If Axune can pin a run to the offline user, network egress is denied by the
OS — the control Axune enforces for Claude Code by switching `WebFetch`/`WebSearch` off, only
enforced a layer lower. What selects between the two, and can it be forced per run?

## Q1b — Confirm the tool surface is gone, not merely unused · owner: Claude

C12's run showed no `web_search` and no `mcp_tool_call`, but the prompt did not invite either.
Re-probe with a question that actively tempts a web search, and confirm the `-c` overrides
suppress it rather than the model simply not bothering.

## Q2 — The complete `codex exec --json` event and item schema · owner: Codex · **partly answered**

Codex answered in `findings.md` and honestly declined to mark it verified: its own task sandbox
denied it write access to its state directory, so it could not run the probe. What it did settle
is that the CLI publishes no schema, so this can only be established by exercising each terminal
case. Its guidance stands and should shape the adapter: **retain an unknown JSONL record as
diagnostic data and emit an Axune `error`, never drop it silently.**

Claude has since verified the sharpest part (C17): a rejected command and a rejected patch both
appeared **only on stderr**, with no `item` event at all. So the translator must read stderr as
well as stdout, or a refused tool call will look like a run that did nothing.

Still needed: errors, cancellation, reasoning, file edits, and plan/todo items, exercised in a
writable test environment.

Needed before the translator can be trusted. See the observed-so-far list in `findings.md`.
Specifically: the full set of top-level `type` values and `item.type` values, what an error or
an interruption looks like, and whether tool failures appear in the JSONL at all or only as
stderr log lines from `codex_core::tools::router` — the latter is what was observed, and it
would change how the adapter reads failures.

## Q3 — What does `--approve-for-me` actually approve? · owner: Codex · **answered, now moot**

Codex established from the local help that it is workspace-write auto-approval by an
unidentified reviewer, and correctly concluded it cannot serve as an Axune safety control. C12
then removed the need for it entirely (C19), so Axune will not use it. Left recorded so nobody
reaches for it later without reading why.

It is currently the only mode in which Codex runs at all, so this is a hole in the safety story
until answered (C6). What performs the review, does it invoke a model, and can it approve
something a person would refuse? If it can, Axune needs its own boundary above it.

## Q4 — Format and precedence of execpolicy `.rules` files · owner: Codex · **partly answered, acted on**

Codex found `codex execpolicy check --rules <PATH> <COMMAND>...`, verified since as C16, and made
the point that decided the design: **a repository-controlled `.rules` file is editable by the
very worktree the agent can change**, so it can never be Axune's boundary. `--ignore-rules` is
now part of the standard invocation.

Still open: the rule grammar, its expressiveness, discovery locations and user-versus-project
precedence. Nothing ships a `.rules` file to read one off. The test that would settle it is a
breach attempt — write a deliberately permissive project `.rules`, then confirm a denied command
stays denied both with and without `--ignore-rules`.

Axune enforces a command allow-list in-process for Claude Code and would rather push that down
into Codex's own enforcement than reimplement it. Can a project-level `.rules` file express an
allow-list Codex honours, and does it survive `--ignore-user-config`?

## Q5 — Does loading a repository's `AGENTS.md` widen the injection surface? · owner: Claude

Codex reads `AGENTS.md` automatically and Claude Code loads project settings deliberately. For
work *on* Axune that is wanted. But when Axune runs an agent against **a user's** repository,
that repository's own `AGENTS.md` becomes untrusted input that instructs the agent — precisely
what constraint 2 exists to neutralise. Decide whether Axune's runs should suppress project
instruction files, and if so, at what cost to usefulness.

## Q6 — Should approvals become real, and in which order? · owner: Cedric

`approval_requested` has no client message to answer it (A3). Worktree isolation makes this a
refinement rather than a hole for Claude Code. For Codex it may matter sooner, because
`--approve-for-me` means something outside Axune is already making approval decisions (Q3).

---

## Settled

- ~~**Q1: can Codex run read-only on Windows?**~~ **Yes**, settled 2026-09-09. It always could;
  the blanket refusal came from `--ignore-user-config`, which strips the sandbox's read/write
  root provisioning and makes it fail closed. The working invocation is in `findings.md` under
  "The invocation Axune should use". Writes are refused by the operating system, which is
  stronger containment than Claude Code has here. `CodexAdapter` is no longer blocked.

- ~~**Codex or Gemini first?**~~ **Codex**, 2026-09-08. Earlier research claiming Codex's
  subscription auth was "Advanced only" was out of date; bare `codex login` is the ChatGPT
  sign-in (C1). Gemini remains a candidate third agent, but is no longer a risk-reduction move.
