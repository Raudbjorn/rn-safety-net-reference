import type { DrillRecord } from '../domain/drill';

/** The smallest storage surface the queue needs; AsyncStorage satisfies it, tests use a Map. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Outcome of one send attempt. A closed set, so every caller must handle every case.
 *  - stored / duplicate: the gateway has exactly one record for this id -> synchronised
 *  - rejected: permanent, retrying cannot help -> surface it, do not retry
 *  - unavailable: network, timeout, 5xx, 408/429 -> keep pending, retry later
 */
export type SendResult =
  | { kind: 'stored' }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'unavailable' };

export interface Transport {
  send(drill: DrillRecord): Promise<SendResult>;
}
