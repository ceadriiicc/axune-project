import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ActivityEvent, ActivityKind } from '@axune/protocol';

/**
 * One append-only record of what happened on this machine.
 *
 * Deliberately a single stream rather than a feature: "since you last checked"
 * is this list filtered by a device's last visit, and "recent activity" is the
 * same list in order. Two pipelines would mean two sources of truth for the
 * same facts, and they would disagree eventually.
 *
 * Persisted, because the whole value is surviving the gap when nobody is
 * looking — including a desktop restart.
 */
export class ActivityLog {
  private events: ActivityEvent[] = [];
  private readonly listeners = new Set<(event: ActivityEvent) => void>();

  constructor(
    private readonly file = defaultPath(),
    private readonly max = 300,
  ) {
    this.load();
  }

  record(kind: ActivityKind, summary: string, detail?: string): ActivityEvent {
    const event: ActivityEvent = {
      id: randomUUID(),
      at: Date.now(),
      kind,
      summary,
      ...(detail ? { detail } : {}),
    };

    this.events.push(event);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    this.save();

    for (const listener of this.listeners) listener(event);
    return event;
  }

  /** Everything, oldest first, capped so a phone is not handed a novel. */
  recent(limit = 40): ActivityEvent[] {
    return this.events.slice(-limit);
  }

  /** How many events are newer than a device's last visit. */
  countSince(since: number | undefined): number {
    if (!since) return 0;
    return this.events.filter((event) => event.at > since).length;
  }

  onEvent(listener: (event: ActivityEvent) => void): void {
    this.listeners.add(listener);
  }

  private load(): void {
    try {
      this.events = JSON.parse(readFileSync(this.file, 'utf8')) as ActivityEvent[];
    } catch {
      this.events = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.events), { mode: 0o600 });
    } catch {
      // History is a convenience; never fail a run over it.
    }
  }
}

function defaultPath(): string {
  const base =
    process.env.LOCALAPPDATA ?? process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');
  return join(base, 'Axune', 'activity.json');
}
