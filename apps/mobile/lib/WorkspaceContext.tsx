import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { fakeAgentReply, getSession, SESSIONS } from './fakeData';
import type { AgentTurn, Session, SessionMode } from './types';

interface WorkspaceState {
  session: Session;
  paired: boolean;
  loadSession: (id: string) => void;
  setPaired: (paired: boolean) => void;
  sendPrompt: (prompt: string) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

function modeToPaired(mode: SessionMode): boolean {
  return mode === 'paired';
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(SESSIONS[0]);
  const [paired, setPairedState] = useState(modeToPaired(SESSIONS[0].mode));

  const loadSession = useCallback((id: string) => {
    const next = getSession(id);
    if (!next) return;
    setSession(next);
    setPairedState(modeToPaired(next.mode));
  }, []);

  const setPaired = useCallback((value: boolean) => {
    setPairedState(value);
  }, []);

  const sendPrompt = useCallback((prompt: string) => {
    setSession((current) => {
      const turns: AgentTurn[] = current.turns.map((turn) => ({
        ...turn,
        answer: fakeAgentReply(turn.agentId, prompt),
      }));
      return { ...current, prompt, turns };
    });
  }, []);

  const value = useMemo(
    () => ({ session, paired, loadSession, setPaired, sendPrompt }),
    [session, paired, loadSession, setPaired, sendPrompt],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
