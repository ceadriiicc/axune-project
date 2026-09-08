import type {
  ActivityEvent,
  AgentBranch,
  AgentEvent,
  AgentStatus,
  ChangeSet,
  Capability,
  MachineSummary,
  PairingPayload,
  ProjectSummary,
} from '@axune/protocol';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AxuneClient, type ConnectionState } from './AxuneClient';
import {
  clearPairing,
  loadLastSeenAt,
  loadPairing,
  savePairing,
  saveLastSeenAt,
} from './pairingStore';
import { clearWorkspace, loadWorkspace, saveWorkspace } from './threadStore';

/**
 * All state the phone holds about the desktop it is driving.
 *
 * Everything here is built from agent events and transport messages — nothing
 * parses provider output, which is what lets a second agent slot in without
 * touching any screen.
 */
export interface LiveRun {
  runId: string;
  prompt: string;
  /** Streamed assistant text, accumulated from message_delta. */
  text: string;
  activity: ActivityLine[];
  status: 'working' | 'finished' | 'stopped' | 'failed';
  outcome: string | null;
  /** For elapsed time, and for spotting a run that has gone quiet. */
  startedAt: number | null;
  lastEventAt: number | null;
  /** True when this run was allowed to edit files. */
  write: boolean;
  /** What it produced, once finished. Null while running or for read runs. */
  changes: ChangeSet | null;
  /** Set once the user has kept or discarded the branch. */
  decision: 'keep' | 'discard' | null;
}

export interface ActivityLine {
  id: string;
  label: string;
  ok: boolean | null;
  /** The file or command, so "Read" can say what it read. */
  detail?: string;
  /**
   * The provider's id for this tool call, so finishing one updates the row it
   * started rather than adding another.
   */
  callId?: string;
}

/**
 * A conversation set aside so it can be returned to.
 *
 * Each thread carries the id the desktop keys the agent's own resumable
 * session off, so reopening one and asking a follow-up continues that
 * conversation rather than starting a new one.
 */
export interface Thread {
  id: string;
  runs: LiveRun[];
  startedAt: number;
}

/** A finished run, kept so Home and Sessions can show real history. */
export interface RunSummary {
  runId: string;
  prompt: string;
  startedAt: number;
  finishedAt: number;
  outcome: 'completed' | 'stopped' | 'failed';
  excerpt: string;
  filesRead: number;
  commands: number;
}

interface WorkspaceState {
  connectionState: ConnectionState;
  connectionDetail: string | null;
  project: ProjectSummary | null;
  agents: AgentStatus[];
  machine: MachineSummary | null;
  capability: Capability;
  lastSeenAt: number | null;

  /**
   * Every run in the current conversation, oldest first.
   *
   * A session is a thread, not a single question. The desktop resumes the
   * agent's own session between prompts, so discarding the previous exchange
   * would show the user less than the agent itself remembers.
   */
  conversation: LiveRun[];
  /** Conversations set aside, newest first. Starting a new one never destroys. */
  threads: Thread[];
  openThread: (id: string) => void;
  /** The run currently working, if any. */
  live: LiveRun | null;
  history: RunSummary[];

  activity: ActivityEvent[];
  newSinceLastVisit: number;
  markChecked: () => void;

  sendPrompt: (prompt: string, write?: boolean) => void;
  resolveChanges: (runId: string, decision: 'keep' | 'discard') => void;
  /** Branches agents left behind, so kept work does not become invisible. */
  branches: AgentBranch[];
  deleteBranch: (branch: string) => void;
  newConversation: () => void;
  pair: (payload: PairingPayload) => void;
  disconnect: () => void;
  stopRun: () => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

/** Shown on the desktop as the name of the trusted device. */
const DEVICE_NAME = 'iPhone';

const emptyRun = (runId: string, prompt: string): LiveRun => ({
  runId,
  prompt,
  text: '',
  activity: [],
  status: 'working',
  outcome: null,
  startedAt: Date.now(),
  lastEventAt: Date.now(),
  write: false,
  changes: null,
  decision: null,
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [machine, setMachine] = useState<MachineSummary | null>(null);
  const [capability, setCapability] = useState<Capability>('read-only');
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);

  const [conversation, setConversation] = useState<LiveRun[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [branches, setBranches] = useState<AgentBranch[]>([]);
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);

  const clientRef = useRef<AxuneClient | null>(null);
  /**
   * One conversation id for the whole thread, NOT one per prompt. The desktop
   * keys the agent's resumable session off this, so a fresh id each time would
   * silently start a new conversation every message.
   */
  const conversationIdRef = useRef<string>(randomId());
  /**
   * Nothing is written to disk until what is on disk has been read.
   * Without this the first render's empty state races the load and erases
   * every stored conversation on launch.
   */
  const hydrated = useRef(false);
  /** Activity ids already applied, so an at-least-once stream stays idempotent. */
  const seenActivityIds = useRef<Set<string>>(new Set());

  const applyEvent = useCallback((event: AgentEvent) => {
    setConversation((current) => {
      const index = current.findIndex((entry) => entry.runId === event.runId);
      const previous = index >= 0 ? current[index]! : emptyRun(event.runId, '');
      const updated = reduceRun({ ...previous, lastEventAt: Date.now() }, event);

      if (updated.status !== 'working' && previous.status === 'working') {
        setHistory((past) => [summarise(updated), ...past.filter((e) => e.runId !== updated.runId)]);
      }

      if (index >= 0) {
        const next = [...current];
        next[index] = updated;
        return next;
      }
      return [...current, updated];
    });
  }, []);

  const ensureClient = useCallback((): AxuneClient => {
    if (clientRef.current) return clientRef.current;
    clientRef.current = new AxuneClient({
      onState: (state, detail) => {
        setConnectionState(state);
        setConnectionDetail(detail ?? null);
      },
      onEvent: applyEvent,
      onPaired: (proj, agentList) => {
        setProject(proj);
        setAgents(agentList);
        setLastSeenAt(Date.now());
        // Persist the credential so a reload, or tomorrow morning, does not
        // mean scanning another QR code.
        const credential = clientRef.current?.credential;
        if (credential) {
          void savePairing({
            url: credential.url,
            sessionToken: credential.sessionToken,
            projectName: proj.name,
            pairedAt: Date.now(),
          });
        }
      },
      onProject: (proj) => {
        setProject(proj);
        setLastSeenAt(Date.now());
      },
      onMachine: (info, cap) => {
        setMachine(info);
        setCapability(cap);
        setLastSeenAt(Date.now());
      },
      onAgents: setAgents,
      onActivity: (events, sinceLastVisit) => {
        // A snapshot is authoritative: it replaces the list, so it also
        // replaces what counts as already seen.
        seenActivityIds.current = new Set(events.map((entry) => entry.id));
        setActivity(events);
        setNewSinceLastVisit(sinceLastVisit);
      },
      onActivityEvent: (event) => {
        // Delivery is not exactly-once. A reconnect can overlap a snapshot, and
        // two live sockets deliver every broadcast twice - which is how React
        // ended up rendering a list with two children sharing a key. Treat the
        // stream as at-least-once and make applying it idempotent, rather than
        // trying to guarantee delivery upstream.
        //
        // The guard covers the counter as well as the list: a duplicate that
        // bumped "since you last checked" would misreport how much happened
        // while the user was away.
        if (seenActivityIds.current.has(event.id)) return;
        seenActivityIds.current.add(event.id);
        setActivity((past) => [...past.slice(-80), event]);
        setNewSinceLastVisit((count) => count + 1);
      },
      onBranches: setBranches,
      onChanges: (runId, result) =>
        setConversation((current) =>
          current.map((run) => (run.runId === runId ? { ...run, changes: result } : run)),
        ),
      onGap: (_runId, missed) => setConnectionDetail(`caught up — replayed ${missed} events`),
    });
    return clientRef.current;
  }, [applyEvent]);

  const pair = useCallback(
    (payload: PairingPayload) => {
      setConversation([]);
      const client = ensureClient();
      void loadLastSeenAt().then((at) => {
        client.setLastSeenAt(at);
        client.pair(payload, DEVICE_NAME);
      });
    },
    [ensureClient],
  );

  /**
   * The user has now seen what changed, so the next visit measures from here.
   * Deliberately not called on connect — that would clear the summary before it
   * had a chance to be read.
   */
  const markChecked = useCallback(() => {
    setNewSinceLastVisit(0);
    void saveLastSeenAt(Date.now());
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    setProject(null);
    setAgents([]);
    setConversation([]);
    setThreads([]);
    setHistory([]);
    void clearPairing();
    // Transcripts quote the repository, so forgetting the desktop forgets what
    // its agents said about it too. Leaving them behind would be the wrong
    // default for a control that reads as "disconnect and clear".
    void clearWorkspace();
  }, []);

  /**
   * Start a fresh thread. Deliberately archives rather than discards: a control
   * that silently destroys what you were reading is a trap, and the previous
   * conversation is often the thing you wanted to keep.
   */
  const newConversation = useCallback(() => {
    setConversation((current) => {
      if (current.length > 0) {
        const id = conversationIdRef.current;
        setThreads((past) => [
          { id, runs: current, startedAt: current[0]?.startedAt ?? Date.now() },
          ...past.filter((thread) => thread.id !== id),
        ]);
      }
      return [];
    });
    conversationIdRef.current = randomId();
  }, []);

  /**
   * Reopen an archived conversation. Restores the agent's session id too, so a
   * follow-up continues where it left off instead of starting over.
   */
  const openThread = useCallback(
    (id: string) => {
      const thread = threads.find((entry) => entry.id === id);
      if (!thread) return;
      setConversation((current) => {
        if (current.length > 0) {
          const currentId = conversationIdRef.current;
          setThreads((past) => [
            { id: currentId, runs: current, startedAt: current[0]?.startedAt ?? Date.now() },
            ...past.filter((entry) => entry.id !== currentId && entry.id !== id),
          ]);
        } else {
          setThreads((past) => past.filter((entry) => entry.id !== id));
        }
        return thread.runs;
      });
      conversationIdRef.current = id;
    },
    [threads],
  );

  const live = useMemo(
    () => conversation.find((run) => run.status === 'working') ?? null,
    [conversation],
  );

  const stopRun = useCallback(() => {
    if (live) clientRef.current?.stopRun(live.runId);
  }, [live]);

  const sendPrompt = useCallback((prompt: string, write = false) => {
    const client = clientRef.current;
    if (!client?.isConnected) return;

    const runId = randomId();
    // Show the prompt immediately rather than waiting for run_started to come
    // back over the wire — a phone should never look like it dropped a tap.
    setConversation((current) => [...current, { ...emptyRun(runId, prompt), write }]);
    client.startRun(runId, conversationIdRef.current, prompt, write);
  }, []);

  /**
   * Keep the branch or throw it away. Applied optimistically so the buttons
   * respond immediately; the desktop is the one that actually deletes.
   */
  const deleteBranch = useCallback((branch: string) => {
    clientRef.current?.deleteBranch(branch);
    setBranches((current) => current.filter((entry) => entry.name !== branch));
  }, []);

  const resolveChanges = useCallback((runId: string, decision: 'keep' | 'discard') => {
    clientRef.current?.resolveChanges(runId, decision);
    setConversation((current) =>
      current.map((run) => (run.runId === runId ? { ...run, decision } : run)),
    );
  }, []);

  // Restore conversations written by a previous launch. Runs before anything
  // is saved, so an empty first render cannot wipe the file.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadWorkspace();
      if (cancelled) {
        hydrated.current = true;
        return;
      }
      if (stored) {
        setConversation(stored.conversation);
        setThreads(stored.threads);
        setHistory(stored.history);
        if (stored.conversationId) conversationIdRef.current = stored.conversationId;
      }
      hydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on a delay rather than on every token: a streaming run changes
  // `conversation` many times a second, and each save serialises the lot and
  // writes it synchronously. The delay is long enough that a run in full flow
  // saves a handful of times, not hundreds.
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      void saveWorkspace({
        conversation,
        conversationId: conversationIdRef.current,
        threads,
        history,
        projectName: project?.name ?? null,
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [conversation, threads, history, project]);

  // Reconnect silently on launch if this device has paired before. Failure is
  // quiet: the phone simply offers to pair, as an unpaired install would.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, seenAt] = await Promise.all([loadPairing(), loadLastSeenAt()]);
      if (cancelled || !stored) return;
      const client = ensureClient();
      client.setLastSeenAt(seenAt);
      client.reconnectWithSession(stored.url, stored.sessionToken);
    })();
    return () => {
      cancelled = true;
    };
  }, [ensureClient]);

  const value = useMemo(
    () => ({
      connectionState,
      connectionDetail,
      project,
      agents,
      machine,
      capability,
      lastSeenAt,
      conversation,
      threads,
      openThread,
      live,
      history,
      activity,
      newSinceLastVisit,
      markChecked,
      sendPrompt,
      resolveChanges,
      branches,
      deleteBranch,
      newConversation,
      pair,
      disconnect,
      stopRun,
    }),
    [
      connectionState,
      connectionDetail,
      project,
      agents,
      machine,
      capability,
      lastSeenAt,
      conversation,
      threads,
      openThread,
      live,
      history,
      activity,
      newSinceLastVisit,
      markChecked,
      sendPrompt,
      resolveChanges,
      branches,
      deleteBranch,
      newConversation,
      pair,
      disconnect,
      stopRun,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}

/** One run's state, advanced by one event. Pure, so it is easy to reason about. */
function reduceRun(run: LiveRun, event: AgentEvent): LiveRun {
  switch (event.type) {
    case 'run_started':
      return { ...run, prompt: event.prompt || run.prompt, status: 'working', startedAt: Date.now() };
    case 'message_delta':
      return { ...run, text: run.text + event.text };
    case 'tool_started':
      return {
        ...run,
        activity: [
          ...run.activity,
          {
            id: `${event.seq}`,
            callId: event.toolCallId,
            label: event.toolName,
            ok: null,
            detail: shortDetail(event.input),
          },
        ],
      };
    case 'tool_finished': {
      // Resolve the row this call started rather than appending another. The
      // list previously grew two entries per tool - "Read" then "done" - which
      // is how a handful of file reads became a screen of noise.
      const index = run.activity.findIndex(
        (line) => line.callId === event.toolCallId && line.ok === null,
      );
      if (index < 0) {
        // A finish with no start: worth showing rather than dropping, since it
        // means the desktop refused something before the call was announced.
        return {
          ...run,
          activity: [
            ...run.activity,
            { id: `${event.seq}`, label: event.ok ? 'done' : 'denied', ok: event.ok },
          ],
        };
      }
      const activity = [...run.activity];
      activity[index] = { ...activity[index]!, ok: event.ok };
      return { ...run, activity };
    }
    case 'run_finished':
      return {
        ...run,
        status:
          event.outcome === 'completed'
            ? 'finished'
            : event.outcome === 'stopped'
              ? 'stopped'
              : 'failed',
        outcome: event.outcome,
      };
    case 'error':
      return { ...run, status: 'failed', outcome: event.message };
    default:
      return run;
  }
}

function summarise(run: LiveRun): RunSummary {
  return {
    runId: run.runId,
    prompt: run.prompt,
    startedAt: run.startedAt ?? Date.now(),
    finishedAt: Date.now(),
    outcome: run.status === 'finished' ? 'completed' : run.status === 'stopped' ? 'stopped' : 'failed',
    excerpt: firstLine(run.text),
    filesRead: run.activity.filter((a) => a.label === 'Read').length,
    commands: run.activity.filter((a) => a.label === 'Bash').length,
  };
}

/** Pull a filename or command out of a tool input for a one-line label. */
function shortDetail(input: string): string | undefined {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const value = parsed['file_path'] ?? parsed['pattern'] ?? parsed['command'];
    if (typeof value !== 'string') return undefined;
    const tail = value.split(/[\\/]/).pop() ?? value;
    return tail.length > 42 ? `${tail.slice(0, 42)}…` : tail;
  } catch {
    return undefined;
  }
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.replace(/[*`#]/g, '').slice(0, 120);
}

/** react-native has no crypto.randomUUID; ids only need to be unique per device. */
function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
