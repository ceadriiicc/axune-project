import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import type { AgentEvent, AgentId } from '@axune/protocol';

/**
 * What left this machine.
 *
 * The activity log records tool *calls*. Nothing recorded that a file's
 * *contents* were sent to a provider, which left the plainest privacy question
 * a user can ask unanswerable: what did Axune send?
 *
 * This answers it, and deliberately answers it narrowly. It records **paths and
 * byte counts, never contents** - a ledger of what was sent, not a second copy
 * of it. Writing the contents down would create exactly the exposure it exists
 * to describe.
 *
 * It limits nothing. An agent has to read source code to be useful, so reading
 * cannot be prohibited; the honest alternative is to record it and let the
 * person decide whether they are comfortable.
 */
export class EgressLedger {
  /** Runs in flight, keyed by runId. */
  private readonly open = new Map<string, OpenRun>();
  /** Tool calls awaiting their result, so a path can be paired with a size. */
  private readonly pending = new Map<string, string>();
  private entries: EgressEntry[] = [];

  constructor(
    private readonly projectPath: string,
    private readonly file = defaultPath(),
    /** Runs kept on disk. Bounded like everything else here. */
    private readonly max = 200,
  ) {
    this.load();
  }

  /**
   * Feed every event of a run through here.
   *
   * Reads the provider's own tool stream rather than the permission gate,
   * because the gate is not a reliable record: Claude Code's `canUseTool` fires
   * only when permission falls through to a prompt, so tools it auto-approves
   * never reach it. A ledger built on the gate would under-report, which is the
   * worst failure mode a privacy record can have.
   */
  observe(runId: string, agentId: AgentId, event: AgentEvent): void {
    if (event.type === 'run_started') {
      this.open.set(runId, { runId, agentId, at: Date.now(), files: new Map(), reads: 0 });
      return;
    }

    if (event.type === 'tool_started') {
      const path = readPath(event.toolName, event.input);
      if (path) this.pending.set(event.toolCallId, path);
      return;
    }

    if (event.type === 'tool_finished') {
      const path = this.pending.get(event.toolCallId);
      this.pending.delete(event.toolCallId);
      if (!path || !event.ok) return;

      const run = this.open.get(runId);
      if (!run) return;
      // The result text is what actually entered the model's context, so its
      // length is the honest measure of how much was sent.
      const bytes = Buffer.byteLength(event.output ?? '', 'utf8');
      run.files.set(path, (run.files.get(path) ?? 0) + bytes);
      run.reads += 1;
    }
  }

  /**
   * Close a run and write its ledger. Returns a line worth showing a human, or
   * null when the run sent nothing - a run that read nothing should not leave a
   * privacy note claiming it did.
   */
  close(runId: string): string | null {
    const run = this.open.get(runId);
    this.open.delete(runId);
    if (!run || run.files.size === 0) return null;

    const files = [...run.files.entries()]
      .map(([path, bytes]) => ({ path: this.relativise(path), bytes }))
      .sort((a, b) => b.bytes - a.bytes);
    const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);

    this.entries.push({
      runId: run.runId,
      agentId: run.agentId,
      at: run.at,
      finishedAt: Date.now(),
      reads: run.reads,
      totalBytes,
      files,
    });
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
    this.save();

    const count = files.length;
    return `Sent ${count} ${count === 1 ? 'file' : 'files'}, ${formatBytes(totalBytes)}, to ${run.agentId}`;
  }

  /** The most recent runs, newest first. For a "what have you sent?" screen. */
  recent(limit = 20): EgressEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /** Forget the ledger. Part of a "forget everything" action. */
  clear(): void {
    this.entries = [];
    this.save();
  }

  /**
   * Paths are stored relative to the project where possible, so the ledger does
   * not itself become a record of someone's directory layout.
   */
  private relativise(path: string): string {
    try {
      const rel = relative(this.projectPath, path);
      return !rel || rel.startsWith('..') ? path : rel.split('\\').join('/');
    } catch {
      return path;
    }
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as EgressEntry[];
      this.entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      // No ledger yet, or an unreadable one. Starting empty is correct: the
      // record is append-only from here rather than silently half-restored.
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.entries), { mode: 0o600 });
    } catch {
      // Never fail a run over bookkeeping.
    }
  }
}

interface OpenRun {
  runId: string;
  agentId: AgentId;
  at: number;
  /** Path to bytes returned. A file read twice accumulates. */
  files: Map<string, number>;
  reads: number;
}

export interface EgressEntry {
  runId: string;
  agentId: AgentId;
  at: number;
  finishedAt: number;
  /** How many read calls succeeded, which can exceed the file count. */
  reads: number;
  totalBytes: number;
  files: { path: string; bytes: number }[];
}

/**
 * The file a tool read, if it read one.
 *
 * An allow-list of tools rather than a guess at any argument named like a path:
 * a ledger that quietly starts counting the wrong things is worse than one that
 * counts less. `Bash` is absent on purpose - a command's output is not
 * attributable to a file, and pretending otherwise would misreport.
 */
function readPath(toolName: string, input: string): string | null {
  if (!READING_TOOLS.has(toolName)) return null;
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const value = parsed['file_path'] ?? parsed['path'] ?? parsed['notebook_path'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

const READING_TOOLS = new Set(['Read', 'NotebookRead']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'egress.json');
}
