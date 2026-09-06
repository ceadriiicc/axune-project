import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@axune/protocol';

import type {
  AgentAdapter,
  DetectionResult,
  RunHandle,
  RunRequest,
  RunningRun,
} from './AgentAdapter';

const execFileAsync = promisify(execFile);

/** Tools that only read. Everything else is a write or a command in Phase 1 terms. */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite']);

/**
 * Hard deny list for read-only runs.
 *
 * This exists because `canUseTool` is NOT sufficient on its own: it fires only
 * when the permission flow falls through to a prompt, and the SDK auto-approves
 * what it considers safe before the gate is ever consulted. A first live run
 * confirmed it — `Bash` and two `Read`s executed without the gate seeing any of
 * them. So mutation is blocked at the tool level, and the gate is the second
 * layer rather than the only one.
 */
const MUTATING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * Shapes the agent's output for the surface it is actually being read on.
 *
 * Claude Code's default posture is an interactive terminal session: dense file
 * paths, commit hashes, and a closing offer to pick between next tasks. That is
 * right at a keyboard and wrong on a phone screen held away from the desk.
 *
 * Appended to the `claude_code` preset rather than replacing it, so the coding
 * ability is untouched and only the presentation changes. Every adapter gets
 * the same treatment, so Codex and Gemini do not each sound like a different
 * product.
 */
const PHONE_CONTEXT_PROMPT = `Your reply is being read on a phone screen, inside an app called Axune, by someone who is probably away from their computer.

- Lead with the answer. The first sentence should be the thing they asked for.
- Keep it short. A few short paragraphs, not a report.
- Plain prose. Avoid nested bullet lists, tables, and long code blocks — they are unreadable at this size.
- Mention file paths, commit hashes and function names only when they are the point, not as supporting detail.
- Do not end by offering a menu of next tasks or asking which one to do. If a next step genuinely matters, say it in one sentence.
- Never ask a question that assumes the reader can type a long reply.`;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly agentId = 'claude-code' as const;

  async detect(): Promise<DetectionResult> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version'], {
        timeout: 15_000,
        windowsHide: true,
      });
      const version = stdout.trim() || null;
      return {
        installed: true,
        version,
        // Claude Code exposes no documented "am I authenticated" command. Claiming
        // yes here would be a guess, and claiming no would be wrong most of the
        // time — the honest answer is that it cannot be known without a run.
        authenticated: 'unknown',
        detail: `Found claude ${version ?? '(version unknown)'}`,
      };
    } catch (error) {
      return {
        installed: false,
        version: null,
        authenticated: 'no',
        detail: `claude not found on PATH: ${describeError(error)}`,
      };
    }
  }

  /**
   * Starts a run and returns immediately with a handle, so the caller can stop
   * it while it is still going. Events arrive on `onEvent` in `seq` order.
   */
  start(request: RunRequest, onEvent: (event: AgentEvent) => void): RunningRun {
    const abort = new AbortController();
    let seq = 0;
    let providerSessionId: string | null = null;

    const emit = (body: AgentEventBody) => {
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

      try {
        const stream = query({
          prompt: request.prompt,
          options: {
            cwd: request.cwd,
            abortController: abort,
            systemPrompt: {
              type: 'preset',
              preset: 'claude_code',
              append: PHONE_CONTEXT_PROMPT,
            },
            // Leave permissions in a prompting mode on purpose. `canUseTool`
            // fires ONLY when the permission flow falls through to a prompt —
            // populating `allowedTools` or using a permissive permissionMode
            // silently bypasses the gate, which would make the approval system
            // look like it works while approving nothing.
            permissionMode: 'default',
            allowedTools: [],
            ...(request.readOnly ? { disallowedTools: MUTATING_TOOLS } : {}),
            // Load the target repository's own CLAUDE.md and settings, since the
            // agent is meant to work the way that project expects.
            settingSources: ['project'],
            ...(request.resumeSessionId ? { resume: request.resumeSessionId } : {}),
            // Real signature is (toolName, input, options) — three positional
            // arguments, not one request object. Published examples showing a
            // single `{toolName, toolInput, toolUseId}` argument are wrong, and
            // the mismatch silently produced undefined tool ids.
            canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
              const input = safeStringify(toolInput);

              // The SDK expects exactly {behavior:'allow'|'deny'}. Returning
              // {approved:boolean} is treated as a malformed response and the
              // tool call fails with an error rather than a decision — which is
              // how this bug first showed up.
              if (request.readOnly && !READ_ONLY_TOOLS.has(toolName)) {
                emit({
                  type: 'tool_finished',
                  toolCallId: toolName,
                  ok: false,
                  output: `Denied: ${toolName} would modify state, and this run is read-only.`,
                });
                return {
                  behavior: 'deny' as const,
                  message:
                    'This Axune run is read-only. Inspect and report instead of changing anything.',
                };
              }

              emit({
                type: 'tool_started',
                toolCallId: toolName,
                toolName,
                input,
              });
              return {
                behavior: 'allow' as const,
                updatedInput: toolInput,
              };
            },
          },
        });

        emit({ type: 'working', label: 'Claude Code is working' });

        for await (const message of stream as AsyncIterable<UnknownMessage>) {
          providerSessionId = pickSessionId(message) ?? providerSessionId;
          for (const event of translate(message)) {
            emit(event);
          }
        }
      } catch (error) {
        if (abort.signal.aborted) {
          outcome = 'stopped';
        } else {
          outcome = 'failed';
          emit({ type: 'error', message: describeError(error), recoverable: false });
        }
      }

      emit({ type: 'run_finished', outcome });
      return { runId: request.runId, providerSessionId, outcome };
    })();

    return {
      runId: request.runId,
      stop: async () => {
        abort.abort();
        await done.catch(() => undefined);
      },
      done,
    };
  }

  async run(request: RunRequest, onEvent: (event: AgentEvent) => void): Promise<RunHandle> {
    return this.start(request, onEvent).done;
  }
}

/**
 * `Omit` does not distribute over a union — applying it directly to AgentEvent
 * collapses the union to its common keys and every event body stops
 * typechecking. This distributes first, so each variant keeps its own fields.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type AgentEventBody = DistributiveOmit<AgentEvent, 'seq' | 'runId' | 'sessionId' | 'agentId' | 'ts'>;

/**
 * The SDK's message shapes are normalised defensively rather than assumed.
 * Documentation and observed output have differed before, and an adapter that
 * throws on an unexpected shape would take the whole run down.
 */
type UnknownMessage = Record<string, unknown>;

function pickSessionId(message: UnknownMessage): string | null {
  const id = message['session_id'];
  return typeof id === 'string' ? id : null;
}

function translate(message: UnknownMessage): AgentEventBody[] {
  const type = message['type'];
  const events: AgentEventBody[] = [];

  if (type === 'assistant') {
    for (const block of contentBlocks(message)) {
      const blockType = block['type'];
      if (blockType === 'text' && typeof block['text'] === 'string' && block['text'].length > 0) {
        events.push({ type: 'message_delta', text: block['text'] });
      } else if (blockType === 'tool_use') {
        events.push({
          type: 'tool_started',
          toolCallId: String(block['id'] ?? ''),
          toolName: String(block['name'] ?? 'unknown'),
          input: safeStringify(block['input']),
        });
      }
    }
    return events;
  }

  if (type === 'user') {
    for (const block of contentBlocks(message)) {
      if (block['type'] === 'tool_result') {
        events.push({
          type: 'tool_finished',
          toolCallId: String(block['tool_use_id'] ?? ''),
          ok: block['is_error'] !== true,
          output: extractText(block['content']),
        });
      }
    }
    return events;
  }

  if (type === 'result') {
    const subtype = String(message['subtype'] ?? '');
    if (subtype && subtype !== 'success') {
      events.push({ type: 'error', message: `Run ended: ${subtype}`, recoverable: true });
    }
    return events;
  }

  return events;
}

/** Content may sit at `message.content` or nested under `message.message.content`. */
function contentBlocks(message: UnknownMessage): UnknownMessage[] {
  const direct = message['content'];
  if (Array.isArray(direct)) return direct as UnknownMessage[];

  const nested = message['message'];
  if (nested && typeof nested === 'object') {
    const inner = (nested as UnknownMessage)['content'];
    if (Array.isArray(inner)) return inner as UnknownMessage[];
  }
  return [];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && typeof (block as UnknownMessage)['text'] === 'string'
          ? String((block as UnknownMessage)['text'])
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null) ?? '';
  } catch {
    return '[unserialisable]';
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
