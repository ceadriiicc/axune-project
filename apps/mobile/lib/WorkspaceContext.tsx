import type {
  ActivityEvent,
  AgentBranch,
  AgentEvent,
  AgentId,
  AgentStatus,
  ChangeSet,
  Capability,
  MachineSummary,
  PairingPayload,
  ProjectSummary,
  UsageDay,
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
import { reduceRun, type ActivityLine, type LiveRun } from './runReducer';
import {
  clearPairing,
  loadLastSeenAt,
  loadPairing,
  savePairing,
  saveLastSeenAt,
} from './pairingStore';
import { phoneRandom } from './random';
import { clearWorkspace, loadWorkspace, saveWorkspace } from './threadStore';

// Re-exported so the many screens importing these from here keep working; the
// definitions live in runReducer because that is where they are acted on.
export { reduceRun, type ActivityLine, type LiveRun };

/**
 * All state the phone holds about the desktop it is driving.
 *
 * Everything here is built from agent events and transport messages — nothing
 * parses provider output, which is what lets a second agent slot in without
 * touching any screen.
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
  /**
   * Today's totals as counted by the desktop, or null before the first push.
   *
   * Never summed here. This phone sees only the runs it was connected for, and
   * its own stored history is capped by size - a total from either would look
   * precise and under-report. The desktop sees every run and bounds its ledger
   * by age instead.
   */
  usageDay: UsageDay | null;
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

const emptyRun = (runId: string, prompt: string, agentId: AgentId = 'claude-code'): LiveRun => ({
  runId,
  prompt,
  text: '',
  activity: [],
  error: null,
  // Defaulted only for the moment between asking and the first event arriving.
  // Every event that follows carries the real id and overwrites it, so this is
  // a placeholder rather than an assumption about which agent ran.
  agentId,
  status: 'working',
  outcome: null,
  startedAt: Date.now(),
  lastEventAt: Date.now(),
  write: false,
  changes: null,
  usage: null,
  decision: null,
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [machine, setMachine] = useState<MachineSummary | null>(null);
  const [capability, setCapability] = useState<Capability>('read-only');
  const [usageDay, setUsageDay] = useState<UsageDay | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);

  const [conversation, setConversation] = useState<LiveRun[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [branches, setBranches] = useState<AgentBranch[]>([]);
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);

  const clientRef = useRef<AxuneClient | null>(null);
  /** Read inside callbacks created once, which must not close over a stale project. */
  const projectRef = useRef<ProjectSummary | null>(null);
  /**
   * One conversation id for the whole thread, NOT one per prompt. The desktop
   * keys the agent's resumable session off this, so a fresh id each time would
   * silently start a new conversation every message.
   */
  const conversationIdRef = useRef<string>(randomId());
  /**
   * The agent list, readable from a callback that must not re-create itself.
   * `sendPrompt` has an empty dependency array on purpose - it is handed to
   * every screen - so it cannot close over `agents` directly without going
   * stale the first time the desktop reports a change.
   */
  const agentsRef = useRef<AgentStatus[]>([]);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);
  /**
   * The current conversation, readable without being inside a state updater.
   *
   * `newConversation` used to archive by calling `setThreads` from inside
   * `setConversation`'s updater. React makes no promise about when a state
   * update raised from inside another updater is applied, and the symptom was
   * exactly that: a conversation was archived but did not appear under
   * "Previous conversations" until the next interaction, so starting two new
   * sessions in a row looked like the first one had been lost.
   */
  const conversationRef = useRef<LiveRun[]>([]);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  /**
   * Nothing is written to disk until what is on disk has been read.
   * Without this the first render's empty state races the load and erases
   * every stored conversation on launch.
   */
  const hydrated = useRef(false);
  /** Activity ids already applied, so an at-least-once stream stays idempotent. */
  const seenActivityIds = useRef<Set<string>>(new Set());

  const applyEvent = useCallback((event: AgentEvent, replayed = false) => {
    // When this happened, rather than when the phone heard about it.
    //
    // `replayed` was already being passed by the client and ignored here, so
    // every event in a reconnect replay was stamped with the moment it arrived.
    // A run that ended an hour ago came back looking like it had just started,
    // and the stall timer - which measures silence since `lastEventAt` - saw a
    // freshly active run it should have been warning about.
    //
    // Live events keep phone time on purpose: the desktop's clock can be
    // minutes off this one, and for something happening now that skew is a
    // bigger error than the transit delay it would correct.
    const at = replayed && event.ts ? event.ts : Date.now();

    setConversation((current) => {
      const index = current.findIndex((entry) => entry.runId === event.runId);
      const previous = index >= 0 ? current[index]! : emptyRun(event.runId, '', event.agentId);
      // agentId comes from the event rather than from whatever the run was
      // created with: the desktop is the authority on which agent answered,
      // and a run started optimistically here should be corrected by it.
      const updated = reduceRun(
        { ...previous, lastEventAt: at, agentId: event.agentId },
        event,
        at,
      );

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
        // Persist the address that actually worked, on a resume as well as a
        // first pairing. Without this the stored pairing keeps pointing at
        // wherever the desktop used to live, and every move costs the fallback
        // walk again instead of only once.
        if (state === 'connected') {
          const credential = clientRef.current?.credential;
          const name = projectRef.current?.name;
          if (credential && name) {
            void savePairing({
              url: credential.url,
              urls: credential.urls,
              sessionToken: credential.sessionToken,
              publicKey: credential.publicKey,
              projectName: name,
              pairedAt: Date.now(),
            });
          }
        }
      },
      onEvent: applyEvent,
      onPaired: (proj, agentList) => {
        projectRef.current = proj;
        setProject(proj);
        setAgents(agentList);
        setLastSeenAt(Date.now());
        // Persist the credential so a reload, or tomorrow morning, does not
        // mean scanning another QR code.
        const credential = clientRef.current?.credential;
        if (credential) {
          void savePairing({
            url: credential.url,
            urls: credential.urls,
            sessionToken: credential.sessionToken,
            publicKey: credential.publicKey,
            projectName: proj.name,
            pairedAt: Date.now(),
          });
        }
      },
      onProject: (proj) => {
        projectRef.current = proj;
        setProject(proj);
        setLastSeenAt(Date.now());
      },
      onMachine: (info, cap) => {
        setMachine(info);
        setCapability(cap);
        setLastSeenAt(Date.now());
      },
      onAgents: setAgents,
      onUsageDay: setUsageDay,
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
    }, phoneRandom);
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
    // Both updates raised from here, side by side, rather than one from inside
    // the other. React batches these into a single render, so the archived
    // conversation is in `threads` by the time the empty state draws.
    const current = conversationRef.current;
    if (current.length > 0) {
      const id = conversationIdRef.current;
      setThreads((past) => [
        { id, runs: current, startedAt: current[0]?.startedAt ?? Date.now() },
        ...past.filter((thread) => thread.id !== id),
      ]);
    }
    setConversation([]);
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

      // Same correction as `newConversation`: raised alongside rather than from
      // inside the other updater, so swapping conversations lands in one render
      // instead of leaving the list a step behind.
      const current = conversationRef.current;
      if (current.length > 0) {
        const currentId = conversationIdRef.current;
        setThreads((past) => [
          { id: currentId, runs: current, startedAt: current[0]?.startedAt ?? Date.now() },
          ...past.filter((entry) => entry.id !== currentId && entry.id !== id),
        ]);
      } else {
        setThreads((past) => past.filter((entry) => entry.id !== id));
      }
      setConversation(thread.runs);
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

    // Whichever agent the desktop reports installed, rather than an assumption
    // that it is Claude. A machine with only Codex on it could not be asked
    // anything at all before this: the id was hardcoded two layers down.
    const agentId = agentsRef.current.find((agent) => agent.installed)?.agentId ?? 'claude-code';

    const runId = randomId();
    // Show the prompt immediately rather than waiting for run_started to come
    // back over the wire — a phone should never look like it dropped a tap.
    setConversation((current) => [...current, { ...emptyRun(runId, prompt, agentId), write }]);
    client.startRun(runId, conversationIdRef.current, prompt, write, agentId);
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
      // Prefer the stored candidate list; a pairing from an earlier version has
      // only the single address it happened to work on.
      client.reconnectWithSession(
        stored.urls?.length ? stored.urls : [stored.url],
        stored.sessionToken,
        stored.publicKey,
      );
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
      usageDay,
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
      usageDay,
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

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.replace(/[*`#]/g, '').slice(0, 120);
}

/** react-native has no crypto.randomUUID; ids only need to be unique per device. */
function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
