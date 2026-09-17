import React, { createContext, useContext, useState } from 'react';

export type DemoState = 'normal' | 'reconnecting' | 'offline' | 'empty';

interface DemoScenarioValue {
  state: DemoState;
  setState: (state: DemoState) => void;
}

const Context = createContext<DemoScenarioValue | null>(null);

/** Demo-only state switcher for judging transient and first-use experiences. */
export function DemoScenarioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>('normal');
  return <Context.Provider value={{ state, setState }}>{children}</Context.Provider>;
}

export function useDemoScenario() {
  return useContext(Context) ?? { state: 'normal' as DemoState, setState: () => undefined };
}
