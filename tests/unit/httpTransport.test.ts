import { createHttpTransport } from '../../src/sync/httpTransport';
import type { DrillRecord } from '../../src/domain/drill';

const drill: DrillRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  vesselId: 'vessel-1',
  type: 'fire',
  performedAt: '2026-11-11T10:00:00.000Z',
};

const respondingWith = (status: number): typeof fetch => (async () => new Response('{}', { status })) as typeof fetch;

describe('createHttpTransport: HTTP outcomes map onto the closed result set', () => {
  it.each([
    [201, { kind: 'stored' }],
    [200, { kind: 'duplicate' }],
  ])('[REQ-DRILL-006] HTTP %i means the gateway has exactly one record', async (status, expected) => {
    expect(await createHttpTransport('http://gw', respondingWith(status)).send(drill)).toEqual(expected);
  });

  it.each([400, 409, 422])('[REQ-DRILL-007] HTTP %i is a permanent refusal', async (status) => {
    const result = await createHttpTransport('http://gw', respondingWith(status)).send(drill);
    expect(result.kind).toBe('rejected');
  });

  it.each([408, 429, 500, 502, 503])('[REQ-DRILL-003] HTTP %i is "try again", never a refusal', async (status) => {
    expect(await createHttpTransport('http://gw', respondingWith(status)).send(drill)).toEqual({ kind: 'unavailable' });
  });

  it('[REQ-DRILL-003] a network error is unavailable, not an exception', async () => {
    const failing = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    expect(await createHttpTransport('http://gw', failing).send(drill)).toEqual({ kind: 'unavailable' });
  });

  it('[REQ-DRILL-003] a request that never answers times out as unavailable', async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    expect(await createHttpTransport('http://gw', hanging, 20).send(drill)).toEqual({ kind: 'unavailable' });
  });
});
