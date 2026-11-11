import { DrillQueue, STORAGE_KEY } from '../../src/sync/queue';
import type { KeyValueStore, SendResult, Transport } from '../../src/sync/types';
import type { DrillRecord } from '../../src/domain/drill';

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

const input = (type = 'fire') => ({ vesselId: 'vessel-1', type, performedAt: '2026-11-11T10:00:00.000Z' });

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

/** A transport that replays a script of outcomes and records every drill it was handed. */
class ScriptedTransport implements Transport {
  sent: DrillRecord[] = [];
  constructor(
    private outcomes: SendResult[],
    private onSend?: (d: DrillRecord) => void,
  ) {}
  async send(drill: DrillRecord): Promise<SendResult> {
    this.sent.push(drill);
    this.onSend?.(drill);
    return this.outcomes.shift() ?? { kind: 'stored' };
  }
}

const ids = (...list: string[]) => () => list.shift() ?? ID_3;

describe('DrillQueue', () => {
  it('[REQ-DRILL-001] has persisted the drill before the first network call', async () => {
    const store = new MemoryStore();
    let persistedAtSend = false;
    const transport = new ScriptedTransport([{ kind: 'stored' }], (d) => {
      persistedAtSend = (store.data.get(STORAGE_KEY) ?? '').includes(d.id);
    });
    const queue = new DrillQueue(store, transport, ids(ID_1));

    await queue.record(input());
    await queue.flush();

    expect(persistedAtSend).toBe(true);
  });

  it('[REQ-DRILL-001] a pending drill survives an app restart', async () => {
    const store = new MemoryStore();
    const first = new DrillQueue(store, new ScriptedTransport([]), ids(ID_1));
    await first.record(input());

    const afterRestart = new DrillQueue(store, new ScriptedTransport([]), ids(ID_2));
    const entries = await afterRestart.load();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('pending');
    expect(entries[0]?.drill.id).toBe(ID_1);
  });

  it('[REQ-DRILL-001] unreadable stored data is kept, reported, and does not crash the app', async () => {
    const store = new MemoryStore();
    store.data.set(STORAGE_KEY, '{not json');
    const queue = new DrillQueue(store, new ScriptedTransport([]), ids(ID_1));

    const entries = await queue.load();

    expect(entries).toEqual([]);
    expect(queue.lastLoadError).not.toBeNull();
    expect(store.data.get(`${STORAGE_KEY}.corrupt`)).toBe('{not json');
  });

  it('[REQ-DRILL-002] sends the same id on every retry', async () => {
    const transport = new ScriptedTransport([{ kind: 'unavailable' }, { kind: 'unavailable' }, { kind: 'stored' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1, ID_2));

    await queue.record(input());
    await queue.flush();
    await queue.flush();
    await queue.flush();

    expect(transport.sent.map((d) => d.id)).toEqual([ID_1, ID_1, ID_1]);
  });

  it('[REQ-DRILL-003] stays pending, not synchronised, while the network is unavailable', async () => {
    const queue = new DrillQueue(new MemoryStore(), new ScriptedTransport([{ kind: 'unavailable' }]), ids(ID_1));

    await queue.record(input());
    const summary = await queue.flush();

    expect(summary.stoppedUnavailable).toBe(true);
    expect(queue.snapshot()[0]?.status).toBe('pending');
  });

  it('[REQ-DRILL-004] sends pending drills in recorded order and stops at the first unavailable', async () => {
    const transport = new ScriptedTransport([{ kind: 'stored' }, { kind: 'unavailable' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1, ID_2, ID_3));
    await queue.record(input('fire'));
    await queue.record(input('abandon-ship'));
    await queue.record(input('man-overboard'));

    await queue.flush();

    expect(transport.sent.map((d) => d.id)).toEqual([ID_1, ID_2]); // third never attempted: order kept
    expect(queue.snapshot().map((e) => e.status)).toEqual(['synced', 'pending', 'pending']);
  });

  it('[REQ-DRILL-004] concurrent flushes share one pass, so nothing is sent twice in parallel', async () => {
    const transport = new ScriptedTransport([{ kind: 'stored' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1));
    await queue.record(input());

    await Promise.all([queue.flush(), queue.flush(), queue.flush()]);

    expect(transport.sent).toHaveLength(1);
  });

  it('[REQ-DRILL-006] a lost reply followed by a retry ends synchronised, with one id', async () => {
    // First attempt: the gateway stored it but the reply never arrived -> the app sees "unavailable".
    // Second attempt: the gateway recognises the id and answers "duplicate".
    const transport = new ScriptedTransport([{ kind: 'unavailable' }, { kind: 'duplicate' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1));
    await queue.record(input());

    await queue.flush();
    expect(queue.snapshot()[0]?.status).toBe('pending');
    await queue.flush();

    expect(queue.snapshot()[0]?.status).toBe('synced');
    expect(new Set(transport.sent.map((d) => d.id)).size).toBe(1);
  });

  it('[REQ-DRILL-007] marks a permanent refusal rejected, keeps the reason, and never retries it', async () => {
    const transport = new ScriptedTransport([{ kind: 'rejected', reason: 'gateway refused the drill (HTTP 422)' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1));
    await queue.record(input());

    await queue.flush();
    await queue.flush();

    const [entry] = queue.snapshot();
    expect(entry?.status).toBe('rejected');
    expect(entry?.reason).toContain('422');
    expect(transport.sent).toHaveLength(1);
  });

  it('[REQ-DRILL-009] refuses a malformed drill and persists nothing', async () => {
    const store = new MemoryStore();
    const queue = new DrillQueue(store, new ScriptedTransport([]), ids(ID_1));

    const result = await queue.record({ vesselId: '', type: 'not-a-drill', performedAt: 'yesterday' });

    expect(result.ok).toBe(false);
    expect(store.data.has(STORAGE_KEY)).toBe(false);
    expect(queue.snapshot()).toEqual([]);
  });
});

// RAU-5 / RAU-6: manual retry of a rejected drill. `retryRejected(id)` returns a Result (an error
// value, never an exception). Decisions fixed in RAU-5 and tested under REQ-DRILL-010: the retry
// clears the stored rejection reason, keeps the attempts count, and never sends by itself (the drill
// leaves the device through the normal flush).
describe('DrillQueue.retryRejected', () => {
  const REFUSAL: SendResult = { kind: 'rejected', reason: 'gateway refused the drill (HTTP 422)' };

  it('[REQ-DRILL-010] a retried drill returns to pending under the same id, in its original position', async () => {
    const transport = new ScriptedTransport([{ kind: 'stored' }, REFUSAL, { kind: 'stored' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1, ID_2, ID_3));
    await queue.record(input('fire'));
    await queue.record(input('abandon-ship'));
    await queue.record(input('man-overboard'));
    await queue.flush();
    expect(queue.snapshot().map((e) => e.status)).toEqual(['synced', 'rejected', 'synced']);

    const result = await queue.retryRejected(ID_2);

    expect(result.ok).toBe(true);
    expect(queue.snapshot().map((e) => e.drill.id)).toEqual([ID_1, ID_2, ID_3]);
    expect(queue.snapshot().map((e) => e.status)).toEqual(['synced', 'pending', 'synced']);
  });

  it('[REQ-DRILL-010] the return to pending is persisted before any network call', async () => {
    const store = new MemoryStore();
    const transport = new ScriptedTransport([REFUSAL]);
    const queue = new DrillQueue(store, transport, ids(ID_1));
    await queue.record(input());
    await queue.flush();
    expect(transport.sent).toHaveLength(1);

    await queue.retryRejected(ID_1);

    // Read back through a fresh queue on the same store: what an app restart would find.
    const afterRestart = new DrillQueue(store, new ScriptedTransport([]), ids(ID_2));
    const entries = await afterRestart.load();
    expect(entries.map((e) => [e.drill.id, e.status])).toEqual([[ID_1, 'pending']]);
    expect(transport.sent).toHaveLength(1); // the retry itself sent nothing
  });

  it('[REQ-DRILL-010] a retry clears the stored rejection reason', async () => {
    const queue = new DrillQueue(new MemoryStore(), new ScriptedTransport([REFUSAL]), ids(ID_1));
    await queue.record(input());
    await queue.flush();
    expect(queue.snapshot()[0]?.reason).toContain('422');

    await queue.retryRejected(ID_1);

    expect(queue.snapshot()[0]?.reason).toBeUndefined();
  });

  it('[REQ-DRILL-010] a retry keeps the attempts count', async () => {
    const queue = new DrillQueue(new MemoryStore(), new ScriptedTransport([REFUSAL]), ids(ID_1));
    await queue.record(input());
    await queue.flush();
    expect(queue.snapshot()[0]?.attempts).toBe(1);

    await queue.retryRejected(ID_1);

    expect(queue.snapshot()[0]?.attempts).toBe(1);
  });

  it('[REQ-DRILL-010] a retried drill is sent by the next flush under the same id and ends synchronised', async () => {
    const transport = new ScriptedTransport([REFUSAL, { kind: 'stored' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1, ID_2));
    await queue.record(input());
    await queue.flush();

    await queue.retryRejected(ID_1);
    await queue.flush();

    expect(transport.sent.map((d) => d.id)).toEqual([ID_1, ID_1]);
    expect(queue.snapshot()[0]?.status).toBe('synced');
  });

  it('[REQ-DRILL-010] a retried drill is sent ahead of drills recorded after it', async () => {
    // First flush: ID_1 is refused, ID_2 hits an unavailable network, ID_3 is never attempted.
    const transport = new ScriptedTransport([REFUSAL, { kind: 'unavailable' }]);
    const queue = new DrillQueue(new MemoryStore(), transport, ids(ID_1, ID_2, ID_3));
    await queue.record(input('fire'));
    await queue.record(input('abandon-ship'));
    await queue.record(input('man-overboard'));
    await queue.flush();
    expect(queue.snapshot().map((e) => e.status)).toEqual(['rejected', 'pending', 'pending']);
    const sentBeforeRetry = transport.sent.length;

    await queue.retryRejected(ID_1);
    await queue.flush();

    // Original position in the recorded order, so REQ-DRILL-004 still holds after a retry.
    expect(transport.sent.slice(sentBeforeRetry).map((d) => d.id)).toEqual([ID_1, ID_2, ID_3]);
  });

  it('[REQ-DRILL-011] refuses a retry for an unknown id and changes nothing', async () => {
    const store = new MemoryStore();
    const transport = new ScriptedTransport([REFUSAL]);
    const queue = new DrillQueue(store, transport, ids(ID_1));
    await queue.record(input());
    await queue.flush();
    const entriesBefore = queue.snapshot();
    const storedBefore = store.data.get(STORAGE_KEY);

    const result = await queue.retryRejected(ID_2);

    expect(result.ok).toBe(false);
    expect(queue.snapshot()).toEqual(entriesBefore); // the rejected drill it did not name is untouched
    expect(store.data.get(STORAGE_KEY)).toBe(storedBefore);
    expect(transport.sent).toHaveLength(1);
  });

  it('[REQ-DRILL-011] refuses a retry for a pending drill and changes nothing', async () => {
    const store = new MemoryStore();
    const transport = new ScriptedTransport([{ kind: 'unavailable' }]);
    const queue = new DrillQueue(store, transport, ids(ID_1));
    await queue.record(input());
    await queue.flush();
    const entriesBefore = queue.snapshot();
    const storedBefore = store.data.get(STORAGE_KEY);
    expect(entriesBefore[0]?.status).toBe('pending');

    const result = await queue.retryRejected(ID_1);

    expect(result.ok).toBe(false);
    expect(queue.snapshot()).toEqual(entriesBefore);
    expect(store.data.get(STORAGE_KEY)).toBe(storedBefore);
    expect(transport.sent).toHaveLength(1);
  });

  it('[REQ-DRILL-011] refuses a retry for a synchronised drill and changes nothing', async () => {
    const store = new MemoryStore();
    const transport = new ScriptedTransport([{ kind: 'stored' }]);
    const queue = new DrillQueue(store, transport, ids(ID_1));
    await queue.record(input());
    await queue.flush();
    const entriesBefore = queue.snapshot();
    const storedBefore = store.data.get(STORAGE_KEY);
    expect(entriesBefore[0]?.status).toBe('synced');

    const result = await queue.retryRejected(ID_1);

    expect(result.ok).toBe(false);
    expect(queue.snapshot()).toEqual(entriesBefore);
    expect(store.data.get(STORAGE_KEY)).toBe(storedBefore);
    expect(transport.sent).toHaveLength(1);
  });
});
