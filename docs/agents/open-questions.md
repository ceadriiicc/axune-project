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

## Q2 — The complete `codex exec --json` event and item schema · owner: Codex

Needed before the translator can be trusted. See the observed-so-far list in `findings.md`.
Specifically: the full set of top-level `type` values and `item.type` values, what an error or
an interruption looks like, and whether tool failures appear in the JSONL at all or only as
stderr log lines from `codex_core::tools::router` — the latter is what was observed, and it
would change how the adapter reads failures.

## Q3 — What does `--approve-for-me` actually approve? · owner: Codex

It is currently the only mode in which Codex runs at all, so this is a hole in the safety story
until answered (C6). What performs the review, does it invoke a model, and can it approve
something a person would refuse? If it can, Axune needs its own boundary above it.

## Q4 — Format and precedence of execpolicy `.rules` files · owner: Codex

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
