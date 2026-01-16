import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createFlowStore, type FlowState, type FlowStore } from '../core/store';

const FlowContext = createContext<FlowStore | null>(null);

export interface FlowProviderProps {
  children: ReactNode;
  initialState?: Partial<FlowState>;
}

export function FlowProvider({ children, initialState }: FlowProviderProps) {
  const storeRef = useRef<FlowStore | undefined>(undefined);

  if (!storeRef.current) {
    storeRef.current = createFlowStore(initialState);
  }

  return (
    <FlowContext.Provider value={storeRef.current}>{children}</FlowContext.Provider>
  );
}

export function useFlowStore<T>(selector: (state: FlowState) => T): T {
  const store = useContext(FlowContext);
  if (!store) {
    throw new Error('useFlowStore must be used within a FlowProvider');
  }
  return useStore(store, selector);
}

export function useFlowStoreApi() {
  const store = useContext(FlowContext);
  if (!store) {
    throw new Error('useFlowStoreApi must be used within a FlowProvider');
  }
  return store;
}
