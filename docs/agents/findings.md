# Findings

Durable facts, shared between Claude Code and Codex. Every entry carries a status —
**verified** (someone ran it; say what), **documented** (cite where), **unverified** (believed,
untested), **contested** (disagreement, or a claim that failed testing).

Correct an entry in place when it turns out wrong, and say it was corrected. Do not delete
history: a wrong belief we held is itself useful.

---

## Codex CLI, on this machine

Environment: Windows 11 (10.0.26200), `codex-cli 0.153.4`, installed via
`npm install -g @openai/codex`, authenticated with a ChatGPT subscription.

| # | Finding | Status |
|---|---|---|
| C1 | Bare `codex login` performs the ChatGPT sign-in. No API key is involved, so this satisfies constraint 1. `--with-api-key` and `--with-access-token` are alternatives, **not** requirements. | **verified** — `codex login status` reports "Logged in using ChatGPT"; `~/.codex/auth.json` written 2026-09-08 |
| C2 | ~~`--sandbox read-only` blocks all process creation on Windows.~~ **Corrected 2026-09-09 — this was wrong, and wrong in a way that nearly cost a design.** The blanket refusal was caused by `--ignore-user-config`, not by the sandbox. See C12. The original observation was real; the conclusion drawn from it was not, because every failing run happened to carry that flag. | **corrected** |
| C3 | `--sandbox` and `--approve-for-me` **cannot be combined**. The CLI refuses the pair outright. So there is currently no way to express "may execute, cannot write". | **verified** — `error: the argument '--sandbox <SANDBOX_MODE>' cannot be used with '--approve-for-me'` |
| C4 | `-c approval_policy="never" -c sandbox_mode="read-only"` does not help either: same blanket refusal. The write was correctly refused — but so was the read. | **verified** — live run, 2026-09-09 |
| C5 | `--approve-for-me` alone works: commands execute, files are read, answers are correct. It is currently **the only mode in which Codex functions on Windows**, and it implies workspace-write. | **verified** — live run read a real file and answered correctly |
| C6 | What `--approve-for-me` actually reviews, and whether it can approve something a person would refuse, is **not understood**. An approver Axune does not control is deciding what an agent may do. | **unverified** — open question Q1 |
| C7 | `--ignore-user-config` is **mandatory** for Axune runs, not an optimisation. See the safety note below. | **verified** |
| C8 | `codex exec resume <uuid> <prompt>` resumes a previous session; the `thread_id` from `thread.started` is the id to persist. | **documented** — `codex exec resume --help`; resume itself not yet exercised |
| C9 | Both Windows sandbox feature flags (`experimental_windows_sandbox`, `elevated_windows_sandbox`) read **"removed"** in 0.153.4. Whether any OS-level sandbox exists on Windows now is unknown. | **verified** (the flag states) / **unverified** (what it implies) |
| C10 | `codex-windows-sandbox-setup.exe` ships beside the binary, is validly signed by "OpenAI OpCo, LLC", exposes no `--help`, and **has never been run** — no such Windows service exists. It is the leading candidate explanation for C2: refusing all process creation is what failing closed looks like when the sandbox cannot be constructed. | **verified** (signature, absence) / **unverified** (that it fixes C2) |
| C11 | Codex reads `AGENTS.md` from the repository root. | **verified** — the string is present in `codex.exe` |

| C12 | **Codex runs read-only correctly on Windows**, with commands executing and writes refused **by the operating system**. `--ignore-user-config` was the culprit in C2: it stops the sandbox being provisioned with read/write roots, so the sandbox fails closed and refuses every process. Replacing it with targeted `-c` overrides fixes it. | **verified** — live run 2026-09-09, read succeeded, `Set-Content` came back "Access to the path ... denied", no file created |
| C13 | The Windows sandbox is **already fully provisioned on this machine** and was never something to install by hand. Two local users (`CodexSandboxOffline`, `CodexSandboxOnline`), a `CodexSandboxUsers` group, DPAPI-protected credentials, per-run ACLs, and firewall rules blocking outbound **and loopback** for the offline user. `setup_marker.json` records version 5, created 2026-09-07T18:14Z. Codex invokes the setup helper itself on each run (`setup refresh ... payload_len=3744`). | **verified** — `Get-LocalUser`, `Get-NetFirewallRule`, `setup_marker.json`, `~/.codex/.sandbox/*.log` |
| C14 | `codex-windows-sandbox-setup.exe` is **not** a user-facing installer. Run bare it exits with `helper_request_args_failed: expected payload argument`. It is internal plumbing driven by an orchestrator, like `codex sandbox` needing `--sandbox-state-json`. It does not require elevation to start. | **verified** — run from an administrator PowerShell, 2026-09-09 |
| C15 | The firewall rules for `CodexSandboxOffline` block outbound and loopback traffic. If a Codex run can be made to execute as the offline user, **network egress is denied by the OS** rather than by tool policy — the control Axune enforces for Claude Code by switching `WebFetch`/`WebSearch` off. Which sandbox mode selects which user is not yet established. | **verified** (the rules) / **unverified** (how to select the offline user) |

### The invocation Axune should use - NOT YET SETTLED

**Superseded 2026-09-09. Do not use the flag set previously recorded here: it does not contain
Codex.** What is established:

    codex exec --json --sandbox read-only --ignore-rules -C <worktree> "<prompt>"

gives correct *filesystem* behaviour - reads succeed, writes are refused by the operating system
(C12, C18). It does **not** remove the computer-use, browser or web-search surface (C20). Both
halves are needed and only one is solved.

The previous version of this section claimed the tool surface was gone, on the strength of a run
in which it simply went unused. It carried a caveat saying a tempting prompt should confirm it.
That caveat was right: the tempting prompt was run, and the surface was fully available.
**Absence of use is not absence of capability.**

**Do not use `--ignore-user-config`** (C12). It does strip the tool surface, and it also strips
the sandbox's read/write root provisioning, so the run can then execute nothing at all. That is
the trap in this whole area: the two problems have opposite fixes.

`--ignore-rules` is retained (C16). It costs nothing and closes off a repository-controlled
policy file, although no project `.rules` discovery was observed at four plausible locations
(C23).

**The candidate answer is a dedicated `CODEX_HOME`** (C21): a profile directory whose *base*
config declares no plugins and no MCP servers, so there is nothing to override and nothing to
strip. `-c` overrides cannot subtract a declared plugin (C20) and `-p/--profile` only layers on
top of the base (C22), so a different base config is the only remaining lever. Untested end to
end - see Q7.

| C20 | **`-c features.computer_use=false`, `-c features.browser_use=false` and `-c 'mcp_servers={}'` do not disable those tools.** Under all five overrides plus `--sandbox read-only --ignore-rules`, a deliberately tempting prompt ran `web_search`, made four `cua_repl` computer-use calls, read the computer-use plugin's own docs off disk, and attempted to open a Chrome tab. An earlier run that looked clean had simply not tempted it. | **verified by breach attempt** - 2026-09-09 |
| C21 | `CODEX_HOME` isolates **both** configuration and authentication: a fresh directory reports "Not logged in" while the real one reports "Logged in using ChatGPT". So a dedicated Axune profile can present a minimal base config with no plugins and no MCP servers. It **refuses to sit under a temp directory** ("Refusing to create helper binaries under temporary dir"), so it needs a real path such as `%LOCALAPPDATA%/Axune/codex-home`. | **verified** - `codex login status` under both homes |
| C22 | `-p/--profile` **layers on top of** the base user config, so it can raise a setting but cannot remove a plugin or MCP server the base declares. With C20, no flag subtracts the tool surface - only a different base config can. | **documented** - `codex exec --help` |
| C23 | An invalid `.rules` file planted at `<repo>/.rules`, `<repo>/default.rules`, `<repo>/.codex/.rules` and `<repo>/.codex/default.rules` produced **no parse error and no observable effect**. Project-rule discovery does not use those paths in this configuration. A negative result: it does not prove the mechanism inert, only that those four paths are not it. | **verified** (those paths) / **unverified** (the mechanism) |
| C24 | The binary contains `execpolicy_amend`, `execpolicy_amendment`, `proposed_e...` and `approved_f...`, suggesting an agent can **propose amendments to its own execution policy**. If so that is a self-widening path, and it needs understanding before Codex is trusted with write access. | **unverified** - strings only |
| C25 | The `.rules` grammar is **Starlark**: an invalid file yields `starlark error: Parse error`, an empty file yields `{"matchedRules":[]}`. `program` is not a global, so the builtin vocabulary is unknown and nothing ships a `.rules` file to read one off. | **verified** (Starlark) / **unverified** (the vocabulary) |

### The safety finding that governs how Codex must be run

**An OS sandbox does not contain the tool surface.** A run explicitly passed
`--sandbox read-only` nonetheless called an MCP tool capable of clicking and typing on the
user's desktop, ran a web search against a private repository, and then **fabricated** an answer
describing an unrelated product that happens to share the name Axune.

`--sandbox` governs shell commands only. The `config.toml` written by Codex's desktop-app
onboarding enables computer-use, browser control with full CDP access, and a JS REPL piped to a
computer-use service; `computer_use`, `browser_use` and `browser_use_full_cdp_access` all
default to true. Adding `--ignore-user-config` removed the computer-use tool and the web search,
after which the same prompt honestly reported it could not read the file.

**verified** — two live runs, 2026-09-08. This is constraint 2 arriving from the opposite
direction: controls belong in the tool layer, and an OS sandbox is not a substitute for
controlling which tools exist at all.

### Contested

| Claim | Position |
|---|---|
| "Use Codex sandboxing as the enforcement boundary, run with `-C` against the isolated worktree." — Codex, 2026-09-09 | **Resolved in Codex's favour, 2026-09-09.** Initially refuted on the strength of C2; C12 showed C2 was measuring the wrong thing. The recommendation is correct and is now the plan. Codex was right on the mechanism while being unable to demonstrate it, and Claude was wrong while holding the evidence — worth remembering next time either of us is confident. |

---

## The Axune codebase

| # | Finding | Status |
|---|---|---|
| A1 | `AxuneServer` accepted `agentIds` from the phone and ignored it. Every run went to Claude Code, worktree branches were named `claude-code` whatever produced them, and the resumable session was filed under that id. A second agent could not have been reached even once its adapter existed. | **verified** — found by Codex, confirmed by grep, **fixed in `76f0d72`** |
| A2 | Worktree creation was hard-coded to `'claude-code'` at four call sites. | **verified** — found by Codex, **fixed in `76f0d72`** |
| A3 | `approval_requested` and `approval_resolved` exist as **events only**. There is no client message, so the phone can be told an approval is needed and has no way to answer. Approvals are unimplemented, not half-implemented. | **verified** — found by Codex, confirmed in `packages/protocol/src/events.ts` |
| A4 | The `AgentAdapter` interface declared `run(): Promise<RunHandle>` as its contract while every caller used `start(): RunningRun`. A faithful second adapter would have implemented the documented method and not worked. | **verified**, **fixed in `f86954e`** |
| A5 | Claude Code's `canUseTool` fires **only** when the permission flow falls through to a prompt. A permissive `allowedTools` or `permissionMode` bypasses the gate silently. Enforcement therefore needs two layers: `disallowedTools` plus an allow-list in the gate. | **verified** the hard way — a run marked read-only executed `Bash` and two `Read`s without the gate seeing any of them |
| A6 | With `Write` blocked, an agent attempted the write **through PowerShell instead**. Only the allow-list caught it. A deny-list would have missed it. | **verified** — live run |
| A7 | Codex has no `canUseTool` equivalent, so `safety.ts` cannot be reused for it as-is. The safety model is therefore **per-provider**, which the security notes did not previously acknowledge. | **verified** |

---

## Codex event stream

`codex exec --json` emits JSONL. Observed so far — **incomplete**, and an unhandled type means a
phone screen that silently shows nothing, so this needs finishing before the translator is
trusted (Q2).

Top level: `thread.started` (carries `thread_id`), `turn.started`, `item.started`,
`item.completed`, `turn.completed` (carries token usage).

Item types: `agent_message`, `command_execution` (with `command`, `aggregated_output`,
`exit_code`), `mcp_tool_call`, `web_search`.

Not yet seen and expected to exist: errors, interruptions, reasoning, file edits, todo/plan
items. **unverified**

Note for whoever writes the translator: a failed command did **not** arrive as an event at all —
it appeared only as a stderr log line from `codex_core::tools::router`. If that is the general
pattern, tool failures must be read from stderr, not just the JSONL stream. **unverified**

---

## Open questions answered by Codex · 2026-09-09

### Q2 — `codex exec --json` schema

**unverified — not complete; do not treat the observed list as a closed schema.** The local
`codex exec --help` documents only that `--json` prints JSONL; it does not publish event or item
schemas. The live observations already recorded above establish these top-level events:
`thread.started`, `turn.started`, `item.started`, `item.completed`, and `turn.completed`; and
these item types: `agent_message`, `command_execution`, `mcp_tool_call`, and `web_search`.
`thread.started.thread_id` is the resumable id; a completed command has at least `command`,
`aggregated_output`, and `exit_code`.

The missing cases remain errors, cancellation/interruption, reasoning, file edits, plan/todo
items, and failed tools. A controlled probe in this task could not run because the task sandbox
denies Codex write access to its own state directory; it therefore cannot upgrade this to
verified. An adapter must retain an unknown JSONL record as diagnostic data and emit an Axune
`error`/safe fallback rather than silently dropping it. Do not ship a translator that claims to
cover every event until a separate, writable test environment exercises each terminal case.

### Q3 — `--approve-for-me`

**documented** — local `codex --help` (0.153.4) says `--approve-for-me` “Route approval requests
through automatic review using the workspace-write sandbox.” It is not a read-only option; the
same help explicitly names the workspace-write sandbox.

**unverified** — neither the local help nor the official OpenAI documentation consulted for this
investigation identifies the automatic reviewer, says whether it invokes a model, specifies its
policy, or establishes that it makes the same decisions a person would make. The prior live run
proves it allows commands to execute (C5), but does not reveal that decision mechanism.

**verified** — it cannot be combined with `--sandbox` (C3), so Axune cannot use it as a
user-mediated approval bridge or as a way to obtain executable read-only runs on this Windows
installation. Treat it as an opaque workspace-write auto-approval mode, not an Axune safety
control. *(Claude, 2026-09-09: written before C12 landed. Axune no longer needs it at all - see
C19. The reasoning here is still correct and is why it will not be reached for later.)* Its use is incompatible with the current requirement that enforcement be owned by an
OS/tool boundary Axune can explain and test.

### Q4 — execpolicy `.rules`

**documented** — local `codex execpolicy check --help` exposes
`codex execpolicy check --rules <PATH> <COMMAND>...`, accepts multiple rule files, and returns
JSON. This establishes that `.rules` files are a real command-policy input, not merely an
undocumented convention.

**documented** — local `codex exec --help` says `--ignore-rules` disables both user and project
execpolicy `.rules` files. Therefore `--ignore-user-config` alone does not document that project
rules are suppressed; Axune must pass `--ignore-rules` as well whenever it must exclude
repository-controlled policy.

*Claude, 2026-09-09:* verified and adopted - this was the most valuable line in the answer, and
it closed a surface I had left open. The grammar remains unknown, since no `.rules` files ship
with the install and there is nothing to read one off. The breach attempt Codex asks for - a
deliberately permissive project `.rules`, then a denied command - is still outstanding, so
`--ignore-rules` is currently the safe default rather than a measured choice.

**unverified** — the rule-language grammar, allow-list expressiveness, discovery locations and
precedence between user and project files have not been established. No project-level policy
should be relied on for Axune's security boundary until `execpolicy check` has been exercised
against a minimal allow and deny policy in a writable, isolated test directory, followed by a
live `codex exec` run that attempts a denied command. In particular, a repository-controlled
`.rules` file is not trustworthy as Axune's own policy: it is editable by the very worktree the
agent can change.
