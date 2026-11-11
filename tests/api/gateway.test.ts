import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { createGateway } from '../../server/gateway';
import { DrillQueue } from '../../src/sync/queue';
import { createHttpTransport } from '../../src/sync/httpTransport';
import type { KeyValueStore } from '../../src/sync/types';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const drill = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  vesselId: 'vessel-1',
  type: 'fire',
  performedAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

describe('gateway', () => {
  let base = '';
  let close: () => Promise<void>;
  let store: ReturnType<typeof createGateway>['store'];
  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  before(async () => {
    const gateway = createGateway({ faultsEnabled: true });
    store = gateway.store;
    const server = gateway.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  after(() => close());

  it('[REQ-DRILL-005] creates the record once and answers duplicate on resubmission', async () => {
    const first = await post('/v1/drills', drill(ID_A));
    const second = await post('/v1/drills', drill(ID_A));
    const third = await post('/v1/drills', drill(ID_A));

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(third.status, 200);
    assert.equal([...store.values()].filter((d) => d.id === ID_A).length, 1);
  });

  it('[REQ-DRILL-005] refuses a different payload under an existing id instead of overwriting', async () => {
    const res = await post('/v1/drills', drill(ID_A, { type: 'abandon-ship' }));
    assert.equal(res.status, 409);
    assert.equal(store.get(ID_A)?.type, 'fire');
  });

  it('[REQ-DRILL-007] refuses invalid drills with a 4xx the app treats as permanent', async () => {
    const res = await post('/v1/drills', drill('not-a-uuid', { vesselId: '' }));
    assert.equal(res.status, 422);
    assert.equal(store.has('not-a-uuid'), false);
  });

  it('[REQ-DRILL-007] malformed JSON is a 400, not a crash', async () => {
    const res = await fetch(`${base}/v1/drills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(res.status, 400);
  });

  it('[REQ-DRILL-006] stored-but-reply-lost then retry leaves exactly one record (real app transport)', async () => {
    assert.equal((await post('/__fault/drop-next-reply')).status, 204);

    // The gateway stores the drill, then kills the connection: the client sees a network error.
    const mem = new Map<string, string>();
    const store_: KeyValueStore = {
      getItem: async (k) => mem.get(k) ?? null,
      setItem: async (k, v) => void mem.set(k, v),
    };
    const queue = new DrillQueue(store_, createHttpTransport(base, fetch, 2_000), () => ID_B);
    await queue.record({ vesselId: 'vessel-1', type: 'fire', performedAt: '2026-11-11T10:00:00.000Z' });

    await queue.flush();
    assert.equal(queue.snapshot()[0]?.status, 'pending', 'client cannot know it landed');
    assert.equal(store.has(ID_B), true, 'but the gateway did store it');

    await queue.flush(); // retry with the same id -> "duplicate" -> synchronised
    assert.equal(queue.snapshot()[0]?.status, 'synced');
    assert.equal([...store.values()].filter((d) => d.id === ID_B).length, 1);
  });
});
