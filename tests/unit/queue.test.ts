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
