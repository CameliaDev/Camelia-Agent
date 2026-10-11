/**
 * React bindings for the UI store.
 *
 * The store is injected rather than imported as a module singleton so tests and the
 * Tauri shell can each own one. `useUiStore` is the only hook components use to read
 * state — there is no second source of truth anywhere in the tree.
 * @module
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { UiState, UiStore } from './store.js';

const UiStoreContext = createContext<UiStore | null>(null);

export function UiProvider({ store, children }: { store: UiStore; children: ReactNode }): ReactNode {
  return <UiStoreContext.Provider value={store}>{children}</UiStoreContext.Provider>;
}

function useStoreApi(): UiStore {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error('useUiStore must be used inside <UiProvider>');
  return store;
}

export function useUiStore<T>(selector: (state: UiState) => T): T {
  return useStore(useStoreApi(), selector);
}

/** Whole-state read, for components that genuinely need several slices. */
export function useUiState(): UiState {
  return useStore(useStoreApi(), (state) => state);
}