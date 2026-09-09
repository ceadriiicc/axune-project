import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentEvent } from '@axune/protocol';

import type { AgentAdapter, DetectionResult, RunHandle, RunRequest, RunningRun } from './AgentAdapter';
import { INJECTION_NOTICE, MAX_TURNS } from './safety';

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
 * **Verified: nothing about the provider yet.** Gemini CLI is not installed on
 * the machine this was written on, so every claim below about its command line
 * and its output is taken from documentation and must be treated as a
 * hypothesis. The parts that are tested are the parts that do not depend on it:
 * process lifecycle, stop, outcome mapping, and translation, all exercised
 * against a stub binary through `AXUNE_GEMINI_BIN`.
 *
 * **The first task on install is a breach attempt, not a hello-world.** Gemini
 * CLI ships web search and web fetch tools, which is the same egress exposure
 * that disqualified Codex: a fetch combined with any secret read is a complete
 * exfiltration path. The reason to expect a different outcome is that Gemini
 * documents a real tool allow-list, which Codex had no equivalent of - so the
 * question is whether `--allowed-tools` actually removes the capability or
 * merely discourages its use. Assume nothing until a prompt that explicitly
 * asks for a web search comes back unable to perform one.
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
        detail: `gemini not found on PATH: ${describeError(error)}`,
      };
    }
  }

  start(request: RunRequest, onEvent: (event: AgentEvent) => void): RunningRun {
    let seq = 0;
    let providerSessionId: string | null = null;
    let child: ChildProcessWithoutNullStreams | null = null;
    let stopping = false;

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
        child = spawn(this.binary, this.argsFor(request), {
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
            for (const event of this.translate(trimmed)) {
              if (event['__sessionId']) {
                providerSessionId = String(event['__sessionId']);
                continue;
              }
              emit(event);
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
        if (buffer.trim()) {
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
   * **Unverified.** Every flag here comes from documentation rather than from
   * running it. `--allowed-tools` is the load-bearing one: it is the mechanism
   * Codex lacked, and the entire reason Gemini is worth trying. It is passed a
   * positive list, never a deny list - with `Write` blocked, an agent here once
   * reached for PowerShell instead, and only an allow-list caught it.
   *
   * Deliberately absent: anything granting web access. `google_web_search` and
   * `web_fetch` are not on the list, and must be confirmed *unavailable* rather
   * than merely unlisted.
   *
   * **The prompt is not here, on purpose.** It arrives from the phone, so it is
   * the one genuinely untrusted string in a run, and on Windows a `.cmd` shim
   * must be spawned through a shell - where arguments are concatenated, not
   * escaped. A prompt containing a quote followed by another command would have
   * run it. It goes down stdin instead, so no user-controlled text ever reaches
   * a command line. Node's own deprecation warning about shell arguments is
   * what surfaced this.
   */
  private argsFor(request: RunRequest): string[] {
    return [
      '--output-format',
      'stream-json',
      '--allowed-tools',
      READ_ONLY_TOOLS.join(','),
      '--max-turns',
      String(MAX_TURNS),
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
        return text ? [{ type: 'message_delta', text }] : [];
      }

      case 'tool_call':
      case 'tool_use':
        return [
          {
            type: 'tool_started',
            toolCallId: String(record['id'] ?? record['call_id'] ?? `gemini-${type}`),
            toolName: String(record['name'] ?? record['tool'] ?? 'unknown'),
            input: safeStringify(record['args'] ?? record['input'] ?? {}),
          },
        ];

      case 'tool_result':
        return [
          {
            type: 'tool_finished',
            toolCallId: String(record['id'] ?? record['call_id'] ?? `gemini-${type}`),
            ok: record['error'] === undefined && record['is_error'] !== true,
            output: pickText(record) || safeStringify(record['result'] ?? ''),
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
 * What a Gemini read-only run may use.
 *
 * A positive list, and network tools are absent rather than excluded. Names are
 * taken from documentation and are unverified; if one is wrong the run will
 * fail loudly, which is the right direction to be wrong in.
 */
const READ_ONLY_TOOLS = [
  'read_file',
  'read_many_files',
  'list_directory',
  'glob',
  'search_file_content',
] as const;

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
