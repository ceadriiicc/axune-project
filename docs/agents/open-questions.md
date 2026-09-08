# Open questions

The live queue. Each has an owner. Move settled items into `findings.md` with a status label
rather than answering them here, so the answer outlives the question.

Owners: **Codex** for its own CLI internals, config schema, event stream and sandbox.
**Claude** for this codebase and for settling things by running them. **Cedric** for anything
needing his machine, his accounts, or a product decision.

---

## Q1 — Can Codex ever be run read-only on Windows? · owner: Cedric, then Claude

**The one thing blocking `CodexAdapter`.** Today `--sandbox read-only` executes nothing (C2) and
`--approve-for-me` implies write access (C5), and the two cannot be combined (C3).

Next step is Cedric running the signed setup helper from an **administrator** terminal, since it
installs sandbox infrastructure and Claude will not run an elevated installer:

    & "C:\Users\cedri\AppData\Local\OpenAI\Codex\bin\8e5b6932251c2c1c\codex-windows-sandbox-setup.exe"

Then Claude retests whether `--sandbox read-only` can execute a command. That single retest
decides between two designs:

- **It works** → `CodexAdapter` gets a real read-only mode, and Axune gains an OS-level sandbox
  it currently lacks entirely — the largest gap in its security story.
- **It does not** → Codex runs isolation-only: every run gets a throwaway worktree, and a
  read-only prompt is enforced by discarding the branch afterwards rather than by preventing
  writes. Acceptable under constraint 3, but the write toggle must then be **relabelled for
  Codex runs**, because as it stands it would promise something Codex cannot deliver. Shipping a
  switch that lies is not an option.

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

- ~~**Codex or Gemini first?**~~ **Codex**, 2026-09-08. Earlier research claiming Codex's
  subscription auth was "Advanced only" was out of date; bare `codex login` is the ChatGPT
  sign-in (C1). Gemini remains a candidate third agent, but is no longer a risk-reduction move.
