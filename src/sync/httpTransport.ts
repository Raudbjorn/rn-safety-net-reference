import type { DrillRecord } from '../domain/drill';
import type { SendResult, Transport } from './types';

const DEFAULT_TIMEOUT_MS = 5_000;
const HTTP_STORED = 201;
const HTTP_DUPLICATE = 200;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * Maps HTTP outcomes onto the closed SendResult set.
 * Every failure to learn the outcome (network error, timeout, 5xx, 408, 429) is `unavailable`:
 * the drill might or might not have been stored, so the only safe move is to retry the SAME id.
 */
export function createHttpTransport(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Transport {
  return {
    async send(drill: DrillRecord): Promise<SendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${baseUrl}/v1/drills`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(drill),
          signal: controller.signal,
        });
        if (res.status === HTTP_STORED) return { kind: 'stored' };
        if (res.status === HTTP_DUPLICATE) return { kind: 'duplicate' };
        if (res.status === HTTP_REQUEST_TIMEOUT || res.status === HTTP_TOO_MANY_REQUESTS) {
          return { kind: 'unavailable' };
        }
        if (res.status >= 400 && res.status < 500) {
          return { kind: 'rejected', reason: `gateway refused the drill (HTTP ${res.status})` };
        }
        return { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
