import { useSyncExternalStore } from 'react';
import { getLogEntries, subscribeLogEntries } from '@/lib/debugLog';
import type { LogEntry } from '@/lib/debugLog';

export function useDebugLog(): LogEntry[] {
  return useSyncExternalStore(subscribeLogEntries, getLogEntries);
}
