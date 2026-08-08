import { useEffect, useSyncExternalStore } from 'react';
import {
  backendLifecycleStore,
  startBackendLifecycleMonitor,
  type BackendLifecycleState,
} from './backendLifecycleStore';

/**
 * React binding for the ONE backend lifecycle state. Starts the monitor
 * idempotently on first subscriber. Components must read connectivity ONLY
 * through this hook — never from their own fetch failures.
 */
export function useBackendLifecycle(): BackendLifecycleState {
  useEffect(() => startBackendLifecycleMonitor(), []);
  return useSyncExternalStore(
    backendLifecycleStore.subscribe,
    backendLifecycleStore.get,
    backendLifecycleStore.get
  );
}
