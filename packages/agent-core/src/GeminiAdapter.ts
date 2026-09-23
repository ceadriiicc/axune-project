import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';

import type { AgentAdapter, DetectionResult, RunHandle, RunRequest, RunningRun } from './AgentAdapter';
import { INJECTION_NOTICE, MAX_TURNS, redactSecrets } from './safety';

const execFileAsync = promisify(execFile);

/**
 * Gemini CLI, as Axune's second agent.
 *
 * The point of a second adapter is not Gemini specifically - it is proving that
 * nothing above this file knows which provider is running. That claim was
 * untested with one implementation, and mapping Codex onto the interface
 * already found it wrong once: `AgentAdapter` documented `run()` while every
 * caller used `start()`.
 *
 * ## What is verified and what is not
 *
 * **Verified: the command line, against 0.60.0. Not the containment.** The
 * flags are now checked against the installed CLI rather than taken from
 * documentation, which matters because the documented version was wrong in
 * three ways at once - see `argsFor`. Process lifecycle, stop, outcome mapping
 * and translation are exercised against a stub through `AXUNE_GEMINI_BIN`.
 *
 * What a stub cannot tell you is whether the policy is obeyed, and that is the
 * only question that decides whether Gemini can be Axune's second agent.
 *
 * **The first task on a working account is a breach attempt, not a
 * hello-world.** Gemini CLI ships web search and web fetch, the same egress
 * exposure that disqualified Codex: a fetch combined with any secret read is a
 * complete exfiltration path. The reason to expect a different outcome is
 * `--admin-policy` - a per-spawn tier-5 layer that Codex had no equivalent of,
 * since Codex's only working lever was a machine-wide file. Assume nothing
 * until a prompt that explicitly asks for a web search comes back unable to
 * perform one. Until then `start()` refuses write runs outright, which is the
 * right direction to be wrong in.
 */
export class GeminiAdapter implements AgentAdapter {
  readonly agentId = 'gemini-cli' as const;

  /**
   * Overridable so the adapter can be driven against a stub that emits known
   * records. Without this the whole class would be untestable until someone
   * installs the real thing, which is how an adapter ships broken.
   */
  constructor(private readonly binary = process.env['AXUNE_GEMINI_BIN'] ?? 'gemini') {}

  async detect(): Promise<DetectionResult> {
    try {
      const { stdout } = await execFileAsync(this.binary, ['--version'], {
        timeout: 15_000,
        windowsHide: true,
        shell: needsShell(this.binary),
      });
      const version = stdout.trim() || null;
      return {
        installed: true,
        version,
        // Same honesty as Claude Code: there is no documented "am I logged in"
        // command, and claiming either answer would be a guess.
        authenticated: 'unknown',
        detail: `Found gemini ${version ?? '(version unknown)'}`,
      };
    } catch (error) {
      return {
        installed: false,
        version: null,
        authenticated: 'no',
        detail: `Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli (${describeError(error)})`,
      };
    }
  }

  start(request: RunRequest, onEvent: (event: AgentEvent) => void): RunningRun {
    let seq = 0;
    let providerSessionId: string | null = null;
    let child: ChildProcessWithoutNullStreams | null = null;
    let stopping = false;
    let policyDir: string | null = null;
    // `--max-turns` does not exist on this CLI - it is rejected exactly like an
    // invented flag, which is why no Gemini run could ever start. Its
    // replacement, `model.maxSessionTurns`, is a settings key rather than a
    // flag and defaults to unlimited, so a ceiling passed at spawn time is not
    // available at all. Axune counts and stops instead: enforcement it owns
    // beats a flag it hopes exists, which is the lesson from every containment
    // question this month.
    let turns = 0;

    const emit = (body: Record<string, unknown>) => {
      onEvent({
        seq: seq++,
        runId: request.runId,
        sessionId: request.sessionId,
        agentId: this.agentId,
        ts: Date.now(),
        ...body,
      } as AgentEvent);
    };

    const done = (async (): Promise<RunHandle> => {
      let outcome: RunHandle['outcome'] = 'completed';

      emit({
        type: 'run_started',
        prompt: request.prompt,
        mode: request.mode,
        branch: request.branch,
        worktreePath: null,
      });

      // Write runs are refused outright rather than run hopefully. Gemini's
      // containment is unverified, and the lesson from Codex is that an
      // unverified boundary is worth nothing: the read-only guarantee here once
      // looked correct and was completely false. Read-only until a breach
      // attempt says otherwise.
      if (!request.readOnly) {
        emit({
          type: 'error',
          message:
            'Gemini runs are read-only in Axune until its tool restrictions have been tested by attempting to break them. Ask it to investigate and report instead.',
          recoverable: false,
        });
        emit({ type: 'run_finished', outcome: 'failed' });
        return { runId: request.runId, providerSessionId: null, outcome: 'failed' };
      }

      try {
        emit({ type: 'working', label: 'Gemini is working' });

        // One policy file per run, in a directory only this process knows
        // about. Written here rather than shipped so there is nothing on disk
        // between runs, and so a bundler never has to resolve a path to it.
        policyDir = await mkdtemp(join(tmpdir(), 'axune-gemini-'));
        const policyPath = join(policyDir, 'axune-contain.toml');
        await writeFile(policyPath, CONTAINMENT_POLICY, 'utf8');

        child = spawn(this.binary, this.argsFor(request, policyPath), {
          cwd: request.cwd,
          windowsHide: true,
          // Only batch shims genuinely need a shell, and nothing
          // user-controlled is in argv, so this cannot carry an injection.
          shell: needsShell(this.binary),
        }) as ChildProcessWithoutNullStreams;

        // The prompt travels here rather than on the command line. Guarded,
        // because a provider that ignores stdin closes the pipe and an
        // unhandled EPIPE would end the run for a reason unrelated to it.
        child.stdin.on('error', () => undefined);
        try {
          child.stdin.end(`${request.prompt}\n\n${INJECTION_NOTICE}\n`);
        } catch {
          // Nothing to do: the exit code and stderr still describe the run.
        }

        const finished = new Promise<number | null>((resolve, reject) => {
          child!.once('error', reject);
          child!.once('close', (code) => resolve(code));
        });

        // stdout is newline-delimited JSON. Buffered because a record can be
        // split across chunks, which is the standard way a naive line reader
        // corrupts a stream under load.
        let buffer = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            // Killing the child does not un-buffer what it already sent. A
            // burst can carry hundreds of records in one chunk, so without
            // this the ceiling would fire and then emit every remaining call
            // anyway - a limit that reports itself and enforces nothing.
            if (stopping) break;
            for (const event of this.translate(trimmed)) {
              if (event['__sessionId']) {
                providerSessionId = String(event['__sessionId']);
                continue;
              }
              emit(event);

              // The ceiling, enforced here because the CLI offers no way to
              // pass one. A confused agent can loop a long time, and every
              // turn spends the user's own subscription allowance.
              if (stopping) break;
              if (event['type'] === 'tool_started' && ++turns > MAX_TURNS) {
                emit({
                  type: 'error',
                  message: `Stopped after ${MAX_TURNS} tool calls. Axune enforces this ceiling itself because the Gemini CLI has no flag for it.`,
                  recoverable: false,
                });
                stopping = true;
                child?.kill();
              }
            }
          }
        });

        // Read stderr too, and never assume failures arrive on stdout. Codex
        // taught this the hard way: a refused command and a refused patch both
        // appeared only as stderr log lines, with no event at all, so an
        // adapter watching one stream renders a run that silently did nothing.
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
          if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
        });

        const code = await finished;
        if (buffer.trim() && !stopping) {
          for (const event of this.translate(buffer.trim())) {
            if (!event['__sessionId']) emit(event);
          }
        }

        if (stopping) {
          outcome = 'stopped';
        } else if (code !== 0) {
          outcome = 'failed';
          emit({
            type: 'error',
            message: stderr.trim() || `gemini exited with code ${code}`,
            recoverable: false,
          });
        }
      } catch (error) {
        outcome = stopping ? 'stopped' : 'failed';
        if (!stopping) {
          emit({ type: 'error', message: describeError(error), recoverable: false });
        }
      }

      // The policy has done its job by now, and leaving it behind would put a
      // file on disk that looks authoritative and governs nothing.
      if (policyDir) {
        await rm(policyDir, { recursive: true, force: true }).catch(() => undefined);
      }

      emit({ type: 'run_finished', outcome });
      return { runId: request.runId, providerSessionId, outcome };
    })();

    return {
      runId: request.runId,
      stop: async () => {
        stopping = true;
        child?.kill();
        await done.catch(() => undefined);
      },
      done,
    };
  }

  /**
   * The command line for one run.
   *
   * **Every flag here is checked against `gemini --help` on 0.60.0**, which the
   * previous version was not, and it did not survive the check:
   *
   * - `--max-turns` **does not exist**. The CLI rejects it identically to a flag
   *   invented as a control, so no run could ever have started. Gone; the
   *   ceiling is counted in `start()` instead.
   * - `--allowed-tools` is deprecated *and* was never an allow-list. It marks
   *   tools "allowed to run without confirmation" - so passing it a read-only
   *   list auto-**approved** those tools and said nothing about the dangerous
   *   ones. The line believed to be the boundary was the inverse of one.
   * - `--prompt` is required for headless mode. Without it the CLI defaults to
   *   its interactive TUI, so a run would hang rather than fail.
   *
   * Containment now comes from `--admin-policy`, the tier-5 layer, which is the
   * mechanism Codex genuinely lacked: Codex's only working lever was a
   * machine-wide file, and this is a per-spawn flag Axune owns entirely.
   *
   * **Still unverified: whether any of it holds.** The flags parse - but that
   * is worth nothing here, and the control proves it: passing `--admin-policy`
   * a directory containing deliberately invalid TOML produces **no error at
   * all**, reaching the auth prompt identically to the valid policy. So either
   * the file is parsed lazily at the first tool call, or a bad one is silently
   * ignored, and from outside an account those are indistinguishable.
   *
   * That is the same shape as the workspace tier being non-functional: a policy
   * that quietly does not apply is worse than no policy, because the belief in
   * containment is what makes someone point an agent at a private repository.
   * So nothing here may be trusted until a run has been watched refusing
   * something. `google_web_search` and `web_fetch` must be confirmed
   * *unavailable* rather than merely denied on paper - the shipped
   * `read-only.toml` allows web search, which is exactly how a mode named
   * read-only leaks.
   *
   * **The prompt is not here, on purpose.** It arrives from the phone, so it is
   * the one genuinely untrusted string in a run, and on Windows a `.cmd` shim
   * must be spawned through a shell - where arguments are concatenated, not
   * escaped. A prompt containing a quote followed by another command would have
   * run it. It goes down stdin instead, so no user-controlled text ever reaches
   * a command line. Node's own deprecation warning about shell arguments is
   * what surfaced this.
   */
  private argsFor(request: RunRequest, policyPath: string): string[] {
    return [
      '--output-format',
      'stream-json',
      // Tier 5. Outranks user, workspace, extension and default policy, and is
      // the only tier that does: workspace policies are documented as
      // non-functional in 0.60.0 (issue #18186), so the obvious place to put a
      // per-project policy would load, report nothing, and not apply.
      '--admin-policy',
      policyPath,
      // Read-only mode, as a second line rather than the first. On its own it
      // is not enough - the shipped read-only policy *allows* google_web_search
      // - but it constrains anything the policy above fails to name.
      '--approval-mode',
      'plan',
      // Headless. Without this the CLI defaults to its interactive TUI and a
      // run would hang rather than fail. Empty because the prompt itself
      // arrives on stdin, and `--prompt` is documented as appended to stdin
      // rather than replacing it.
      '--prompt',
      '',
      // The workspace is untrusted on purpose: trusting it lets a repository's
      // own .gemini directory supply hooks and MCP servers, which is exactly
      // the injection path Axune exists to close. So `--skip-trust` is absent,
      // deliberately, and its absence is the safe direction.
      ...(request.resumeSessionId ? ['--resume', request.resumeSessionId] : []),
    ];
  }

  /**
   * One JSONL record into zero or more Axune events.
   *
   * An unrecognised record becomes a visible error rather than being dropped.
   * That is deliberate and was Codex's advice on its own event stream, since
   * confirmed twice: a translator that silently ignores what it does not
   * understand renders a run that appears to do nothing, and the phone spins
   * for ever. A noisy unknown is a bug report; a swallowed one is a mystery.
   */
  private translate(line: string): Record<string, unknown>[] {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [
        {
          type: 'error',
          message: `Unparseable output from gemini: ${line.slice(0, 200)}`,
          recoverable: true,
        },
      ];
    }

    const type = String(record['type'] ?? '');
    const sessionId = record['session_id'] ?? record['sessionId'];

    switch (type) {
      case 'session':
      case 'init':
        return sessionId ? [{ __sessionId: sessionId }] : [];

      case 'content':
      case 'assistant':
      case 'text': {
        const text = pickText(record);
        // Redacted like the Claude Code adapter's: an agent that has read a
        // secret will repeat it in prose if asked, and masking only the tool
        // result leaves the reply carrying it in full.
        return text ? [{ type: 'message_delta', text: redactSecrets(text) }] : [];
      }

      case 'tool_call':
      case 'tool_use':
        return [
          {
            type: 'tool_started',
            toolCallId: String(record['id'] ?? record['call_id'] ?? `gemini-${type}`),
            toolName: String(record['name'] ?? record['tool'] ?? 'unknown'),
            // Same reason as the Claude Code adapter: this reaches the phone
            // and the activity log, so an unmasked credential here is a
            // credential in two more places.
            input: redactSecrets(safeStringify(record['args'] ?? record['input'] ?? {})),
          },
        ];

      case 'tool_result':
        return [
          {
            type: 'tool_finished',
            toolCallId: String(record['id'] ?? record['call_id'] ?? `gemini-${type}`),
            ok: record['error'] === undefined && record['is_error'] !== true,
            // Tool results carry file contents, which is where a hardcoded key
            // in an ordinary source file would otherwise travel from.
            output: redactSecrets(pickText(record) || safeStringify(record['result'] ?? '')),
          },
        ];

      case 'error':
        return [
          {
            type: 'error',
            message: pickText(record) || safeStringify(record),
            recoverable: false,
          },
        ];

      // Terminal records are ignored: `run_finished` is emitted from the exit
      // code, which is the one signal that cannot be missing.
      case 'result':
      case 'done':
      case 'finished':
        return sessionId ? [{ __sessionId: sessionId }] : [];

      default:
        return [
          {
            type: 'error',
            message: `Unrecognised gemini record "${type || '(no type)'}" - Axune does not know how to render this yet: ${line.slice(0, 200)}`,
            recoverable: true,
          },
        ];
    }
  }
}

/**
 * What a Gemini read-only run may use, as a policy rather than a flag.
 *
 * `--allowed-tools`, which this replaces, was never an allow-list: the CLI
 * documents it as tools "allowed to run **without confirmation**", so passing a
 * read-only list to it auto-*approved* those tools and said nothing at all
 * about the dangerous ones. It is also deprecated in favour of this engine.
 *
 * Deny-by-default, then allow back by name. Scoping by resource beats
 * enumerating what is forbidden, because a wildcard deny cannot fall out of
 * date when a new tool ships whereas an exclusion list must be kept complete by
 * someone who remembers to.
 *
 * `denyMessage` is not decoration. A refusal that says what and why costs
 * nothing and saves the run; the forty seconds an agent once spent being
 * refused by an unexplained boundary is the reason that rule exists.
 *
 * Embedded as a string and written per run rather than shipped as a file, so
 * there is no path to resolve through a bundler and nothing on disk between
 * runs for anything else to edit.
 *
 * **Unverified.** Every claim about what this achieves needs a run that tries
 * to break it. The tool names come from the shipped `read-only.toml`.
 */
const CONTAINMENT_POLICY = `# Written by Axune for one run. Not user-editable by design.
[[rule]]
toolName = "*"
decision = "deny"
priority = 100
denyMessage = "Axune runs this agent read-only. This tool is not on the allow-list."

[[rule]]
toolName = ["read_file", "read_many_files", "list_directory", "glob", "grep_search"]
decision = "allow"
priority = 200

[[rule]]
toolName = ["google_web_search", "web_fetch"]
decision = "deny"
priority = 900
denyMessage = "Axune denies network egress. Your code does not leave this machine."

[[rule]]
toolName = ["run_shell_command", "write_file", "replace", "save_memory"]
decision = "deny"
priority = 900
denyMessage = "Axune denies writes and shell execution in a read-only run."
`;

/**
 * Does spawning this binary require a shell?
 *
 * Windows cannot execute a `.cmd` or `.bat` shim directly, and npm installs
 * global CLIs as exactly that. Narrowed to those cases rather than switched on
 * for the whole platform: a shell concatenates arguments instead of escaping
 * them, so the fewer commands that go through one, the fewer chances to get it
 * wrong.
 */
function needsShell(binary: string): boolean {
  const isShim = /[.](cmd|bat)$/i.test(binary);
  const bareNameOnWindows = process.platform === 'win32' && !/[/\\]/.test(binary);
  return isShim || bareNameOnWindows;
}

function pickText(record: Record<string, unknown>): string {
  for (const key of ['text', 'content', 'message', 'delta']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
