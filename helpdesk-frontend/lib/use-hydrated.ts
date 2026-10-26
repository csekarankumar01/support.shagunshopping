import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while rendering on the server and during the browser's first (hydrating) render, true afterwards.
 * Because the first client render uses the server's answer, nothing mismatches; the page then updates itself.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
