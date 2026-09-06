import type { AgentEvent, AgentStatus, PairingPayload, ProjectSummary } from '@axune/protocol';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { AxuneClient, type ConnectionState } from './AxuneClient';
import { getSession, SESSIONS } from './fakeData';
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
}

export interface ActivityLine {
  id: string;
  label: string;
  ok: boolean | null;
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
  live: LiveRun | null;
  pair: (payload: PairingPayload) => void;
  disconnect: () => void;
  stopRun: () => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

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
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(SESSIONS[0]);
  const [paired, setPairedState] = useState(modeToPaired(SESSIONS[0].mode));

  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [live, setLive] = useState<LiveRun | null>(null);

  const clientRef = useRef<AxuneClient | null>(null);

  const applyEvent = useCallback((event: AgentEvent) => {
    setLive((current) => {
      const run = current?.runId === event.runId ? current : emptyRun(event.runId, '');
      switch (event.type) {
        case 'run_started':
          return { ...run, prompt: event.prompt, status: 'working' };
        case 'message_delta':
          return { ...run, text: run.text + event.text };
        case 'tool_started':
          return {
            ...run,
            activity: [
              ...run.activity,
              { id: `${event.seq}`, label: event.toolName, ok: null },
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
      ensureClient().pair(payload, 'iPhone');
    },
    [ensureClient],
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    setProject(null);
    setAgents([]);
    setLive(null);
  }, []);

  const stopRun = useCallback(() => {
    if (live) clientRef.current?.stopRun(live.runId);
  }, [live]);

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
        client.startRun(runId, randomId(), prompt);
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
      live,
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
      live,
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

/** react-native has no crypto.randomUUID; ids only need to be unique per device. */
function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
