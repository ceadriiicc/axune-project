import type {
  ActivityEvent,
  AgentEvent,
  AgentStatus,
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
import { getSession, SESSIONS } from './fakeData';
import {
  clearPairing,
  loadLastSeenAt,
  loadPairing,
  savePairing,
  saveLastSeenAt,
} from './pairingStore';
import type { Session, SessionMode } from './types';

/**
 * Holds both the demo sessions and, once paired, a live run from the desktop.
 *
 * The fake sessions stay for now so the app is still explorable with no desktop
 * running. `live` is what a paired phone actually shows, and it is built purely
 * from agent events — the app never parses provider output.
 */
export interface LiveRun {
  runId: string;
  prompt: string;
  /** Streamed assistant text, accumulated from message_delta. */
  text: string;
  /** Tool activity, newest last. */
  activity: ActivityLine[];
  status: 'idle' | 'working' | 'finished' | 'stopped' | 'failed';
  outcome: string | null;
  /** True while replayed events are being applied after a reconnect. */
  caughtUp: boolean;
  /** For elapsed time, and for spotting a run that has gone quiet. */
  startedAt: number | null;
  lastEventAt: number | null;
}

/** A run that actually happened, kept so Home and Sessions can show real history. */
export interface RunSummary {
  runId: string;
  prompt: string;
  startedAt: number;
  finishedAt: number;
  outcome: 'completed' | 'stopped' | 'failed';
  /** First line of the answer, for the list row. */
  excerpt: string;
  filesRead: number;
  commands: number;
}

export interface ActivityLine {
  id: string;
  label: string;
  ok: boolean | null;
  /** The file or command, so "Read" can say what it read. */
  detail?: string;
}

interface WorkspaceState {
  session: Session;
  paired: boolean;
  loadSession: (id: string) => void;
  setPaired: (paired: boolean) => void;
  sendPrompt: (prompt: string) => void;

  // Live connection
  connectionState: ConnectionState;
  connectionDetail: string | null;
  project: ProjectSummary | null;
  agents: AgentStatus[];
  machine: MachineSummary | null;
  capability: Capability;
  lastSeenAt: number | null;
  /** Everything the desktop recorded, oldest first. */
  activity: ActivityEvent[];
  /** How many of those are newer than this device's previous visit. */
  newSinceLastVisit: number;
  /** Call when the user has actually seen Home, to reset the "since" mark. */
  markChecked: () => void;
  live: LiveRun | null;
  history: RunSummary[];
  newConversation: () => void;
  pair: (payload: PairingPayload) => void;
  disconnect: () => void;
  stopRun: () => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

/** Shown on the desktop as the name of the trusted device. */
const DEVICE_NAME = 'iPhone';

function modeToPaired(mode: SessionMode): boolean {
  return mode === 'paired';
}

const emptyRun = (runId: string, prompt: string): LiveRun => ({
  runId,
  prompt,
  text: '',
  activity: [],
  status: 'working',
  outcome: null,
  caughtUp: true,
  startedAt: Date.now(),
  lastEventAt: Date.now(),
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(SESSIONS[0]);
  const [paired, setPairedState] = useState(modeToPaired(SESSIONS[0].mode));

  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [machine, setMachine] = useState<MachineSummary | null>(null);
  const [capability, setCapability] = useState<Capability>('read-only');
  /** When the desktop was last heard from, so a disconnected Home can say so. */
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);

  const clientRef = useRef<AxuneClient | null>(null);
  /**
   * One conversation id for the whole live session, NOT one per prompt.
   * The desktop keys Claude Code's resumable session off this, so a fresh id
   * each time would silently start a new conversation every message — the exact
   * bug this was meant to fix.
   */
  const conversationIdRef = useRef<string>(randomId());

  const applyEvent = useCallback((event: AgentEvent) => {
    setLive((current) => {
      const base = current?.runId === event.runId ? current : emptyRun(event.runId, '');
      const run = { ...base, lastEventAt: Date.now() };
      switch (event.type) {
        case 'run_started':
          return { ...run, prompt: event.prompt, status: 'working', startedAt: Date.now() };
        case 'message_delta':
          return { ...run, text: run.text + event.text };
        case 'tool_started':
          return {
            ...run,
            activity: [
              ...run.activity,
              {
                id: `${event.seq}`,
                label: event.toolName,
                ok: null,
                detail: shortDetail(event.input),
              },
            ],
          };
        case 'tool_finished':
          return {
            ...run,
            activity: [
              ...run.activity,
              { id: `${event.seq}`, label: event.ok ? 'done' : 'denied', ok: event.ok },
            ],
          };
        case 'run_finished':
          setHistory((past) => [
            {
              runId: run.runId,
              prompt: run.prompt,
              startedAt: run.startedAt ?? Date.now(),
              finishedAt: Date.now(),
              outcome: event.outcome,
              excerpt: firstLine(run.text),
              filesRead: run.activity.filter((a) => a.label === 'Read').length,
              commands: run.activity.filter((a) => a.label === 'Bash').length,
            },
            ...past.filter((entry) => entry.runId !== run.runId),
          ]);
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
    });
  }, []);

  const ensureClient = useCallback((): AxuneClient => {
    if (clientRef.current) return clientRef.current;
    clientRef.current = new AxuneClient({
      onState: (state, detail) => {
        setConnectionState(state);
        setConnectionDetail(detail ?? null);
      },
      onEvent: (event) => applyEvent(event),
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
      onAgents: (agentList) => setAgents(agentList),
      onActivity: (events, sinceLastVisit) => {
        setActivity(events);
        setNewSinceLastVisit(sinceLastVisit);
      },
      onActivityEvent: (event) => {
        setActivity((past) => [...past.slice(-80), event]);
        setNewSinceLastVisit((count) => count + 1);
      },
      onGap: (_runId, missed) => {
        setConnectionDetail(`caught up — replayed ${missed} events`);
      },
    });
    return clientRef.current;
  }, [applyEvent]);

  const pair = useCallback(
    (payload: PairingPayload) => {
      setLive(null);
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
    setLive(null);
    void clearPairing();
  }, []);

  /** Start a fresh conversation, so the agent does not carry the last one over. */
  const newConversation = useCallback(() => {
    conversationIdRef.current = randomId();
    setLive(null);
  }, []);

  const stopRun = useCallback(() => {
    if (live) clientRef.current?.stopRun(live.runId);
  }, [live]);

  // Reconnect silently on launch if this device has paired before. Failure is
  // quiet on purpose: the phone simply shows the demo sessions and offers to
  // pair, which is what an unpaired install does anyway.
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

  const loadSession = useCallback((id: string) => {
    const next = getSession(id);
    if (!next) return;
    setSession(next);
    setPairedState(modeToPaired(next.mode));
  }, []);

  const setPaired = useCallback((value: boolean) => setPairedState(value), []);

  const sendPrompt = useCallback(
    (prompt: string) => {
      const client = clientRef.current;
      // Connected: this is a real run. Not connected: fall back to the demo data
      // so the app still does something sensible with no desktop running.
      if (client?.isConnected) {
        const runId = randomId();
        setLive(emptyRun(runId, prompt));
        client.startRun(runId, conversationIdRef.current, prompt);
        return;
      }
      setSession((current) => ({ ...current, prompt }));
    },
    [],
  );

  const value = useMemo(
    () => ({
      session,
      paired,
      loadSession,
      setPaired,
      sendPrompt,
      connectionState,
      connectionDetail,
      project,
      agents,
      machine,
      capability,
      lastSeenAt,
      activity,
      newSinceLastVisit,
      markChecked,
      live,
      history,
      newConversation,
      pair,
      disconnect,
      stopRun,
    }),
    [
      session,
      paired,
      loadSession,
      setPaired,
      sendPrompt,
      connectionState,
      connectionDetail,
      project,
      agents,
      machine,
      capability,
      lastSeenAt,
      activity,
      newSinceLastVisit,
      markChecked,
      live,
      history,
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

/** Pull a filename or command out of a tool input for a one-line label. */
function shortDetail(input: string): string | undefined {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const path = parsed['file_path'] ?? parsed['pattern'] ?? parsed['command'];
    if (typeof path !== 'string') return undefined;
    const tail = path.split(/[\/]/).pop() ?? path;
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
