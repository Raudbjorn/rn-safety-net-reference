import { z } from 'zod';

import { DrillInputSchema, DrillRecordSchema, describeIssues, type Result } from '../domain/drill';
import type { KeyValueStore, Transport } from './types';

export const STORAGE_KEY = 'drill-queue-v1';

const QueueEntrySchema = z.object({
  drill: DrillRecordSchema,
  status: z.enum(['pending', 'synced', 'rejected']),
  attempts: z.number().int().nonnegative(),
  reason: z.string().optional(),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
const QueueSchema = z.array(QueueEntrySchema);

export interface FlushSummary {
  sent: number;
  synced: number;
  rejected: number;
  stoppedUnavailable: boolean;
}

/**
 * Offline-first drill queue.
 *  - REQ-DRILL-001: a drill is persisted before any network call is made.
 *  - REQ-DRILL-002: the id is assigned once, at record time, and never changes across retries.
 *  - REQ-DRILL-004: pending drills are sent in the order they were recorded.
 */
export class DrillQueue {
  private entries: QueueEntry[] = [];
  private loaded = false;
  private inFlight: Promise<FlushSummary> | null = null;
  /** Set when stored data was unreadable; the raw value is kept under `${STORAGE_KEY}.corrupt`. */
  lastLoadError: string | null = null;

  constructor(
    private readonly store: KeyValueStore,
    private readonly transport: Transport,
    private readonly newId: () => string,
  ) {}

  async load(): Promise<QueueEntry[]> {
    if (this.loaded) return this.snapshot();
    const raw = await this.store.getItem(STORAGE_KEY);
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const checked = QueueSchema.safeParse(parsed);
      if (checked.success) {
        this.entries = checked.data;
      } else {
        // Never silent, never destructive: keep the unreadable data and say so.
        this.lastLoadError = 'stored queue was unreadable; starting empty and keeping a copy';
        await this.store.setItem(`${STORAGE_KEY}.corrupt`, raw);
      }
    }
    this.loaded = true;
    return this.snapshot();
  }

  snapshot(): QueueEntry[] {
    return this.entries.map((e) => ({ ...e, drill: { ...e.drill } }));
  }

  /** REQ-DRILL-009: invalid input is refused and nothing is persisted. */
  async record(input: unknown): Promise<Result<QueueEntry, string>> {
    await this.load();
    const parsed = DrillInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: describeIssues(parsed.error) };

    const entry: QueueEntry = {
      drill: { ...parsed.data, id: this.newId() },
      status: 'pending',
      attempts: 0,
    };
    this.entries = [...this.entries, entry];
    await this.persist(); // REQ-DRILL-001: durable before any network attempt
    return { ok: true, value: { ...entry, drill: { ...entry.drill } } };
  }

  /** Concurrent callers share one flush, so a drill is never sent twice in parallel. */
  flush(): Promise<FlushSummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runFlush().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runFlush(): Promise<FlushSummary> {
    await this.load();
    const summary: FlushSummary = { sent: 0, synced: 0, rejected: 0, stoppedUnavailable: false };

    for (const entry of this.entries) {
      if (entry.status !== 'pending') continue;
      entry.attempts += 1;
      summary.sent += 1;

      const result = await this.transport.send(entry.drill);
      switch (result.kind) {
        case 'stored':
        case 'duplicate':
          entry.status = 'synced'; // REQ-DRILL-006: a duplicate answer means the first send DID land
          summary.synced += 1;
          break;
        case 'rejected':
          entry.status = 'rejected'; // REQ-DRILL-007: permanent, never retried automatically
          entry.reason = result.reason;
          summary.rejected += 1;
          break;
        case 'unavailable':
          summary.stoppedUnavailable = true; // REQ-DRILL-003: stays pending, order preserved
          break;
      }
      await this.persist();
      if (summary.stoppedUnavailable) break;
    }
    return summary;
  }

  private async persist(): Promise<void> {
    await this.store.setItem(STORAGE_KEY, JSON.stringify(this.entries));
  }
}
