import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DrillRecord } from '../../src/domain/drill';
import { DrillQueue } from '../../src/sync/queue';
import type { KeyValueStore, SendResult, Transport } from '../../src/sync/types';
import { DrillScreen } from '../../src/ui/DrillScreen';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function makeQueue(outcome: () => SendResult) {
  let n = 0;
  const transport: Transport = { send: async (_d: DrillRecord) => outcome() };
  const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  return new DrillQueue(new MemoryStore(), transport, newId);
}

describe('DrillScreen', () => {
  it('[REQ-DRILL-003] offline: a recorded drill shows as pending, not synchronised', async () => {
    const queue = makeQueue(() => ({ kind: 'unavailable' }));
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={false} />);

    await fireEvent.press(screen.getByTestId('record-fire'));

    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 1, Synced: 0, Rejected: 0'));
    expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - pending');
  });

  it('[REQ-DRILL-004] sends what is pending as soon as connectivity returns', async () => {
    const queue = makeQueue(() => ({ kind: 'stored' }));
    const view = await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={false} />);
    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 1, Synced: 0, Rejected: 0'));

    await view.rerender(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);

    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 1, Rejected: 0'));
  });

  it('[REQ-DRILL-008] rejected drills are shown distinctly, with the reason', async () => {
    const queue = makeQueue(() => ({ kind: 'rejected', reason: 'gateway refused the drill (HTTP 422)' }));
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);

    await fireEvent.press(screen.getByTestId('record-fire'));

    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - rejected (gateway refused the drill (HTTP 422))'));
    expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 0, Rejected: 1');
  });
});

// RAU-5 / RAU-6: manual retry of a rejected drill. The screen is expected to put a control with
// testID `retry-<index>` on rejected entries only, where <index> is the entry's `entry-<index>`.
// Decisions fixed in RAU-5: online, the screen starts a sync right after a retry; offline, the drill
// waits like any other pending drill.
describe('DrillScreen retry of a rejected drill', () => {
  const REFUSAL: SendResult = { kind: 'rejected', reason: 'gateway refused the drill (HTTP 422)' };
  const REJECTED_LABEL = 'fire - rejected (gateway refused the drill (HTTP 422))';

  /** Replays outcomes in order and counts sends; once the script runs out the gateway is unreachable. */
  function scriptedGateway(...outcomes: SendResult[]) {
    const gateway = {
      sends: 0,
      next: (): SendResult => {
        gateway.sends += 1;
        return outcomes.shift() ?? { kind: 'unavailable' };
      },
    };
    return gateway;
  }

  it('[REQ-DRILL-012] a rejected drill offers a retry action', async () => {
    const queue = makeQueue(() => REFUSAL);
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);

    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent(REJECTED_LABEL));

    expect(screen.getByTestId('retry-0')).toBeOnTheScreen();
  });

  it('[REQ-DRILL-012] only the rejected drill offers a retry action; synchronised and pending drills offer none', async () => {
    const gateway = scriptedGateway({ kind: 'stored' }, REFUSAL, { kind: 'unavailable' });
    const queue = makeQueue(gateway.next);
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);

    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 1, Rejected: 0'));
    await fireEvent.press(screen.getByTestId('record-abandon-ship'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 1, Rejected: 1'));
    await fireEvent.press(screen.getByTestId('record-man-overboard'));
    await waitFor(() => expect(gateway.sends).toBe(3));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 1, Synced: 1, Rejected: 1'));
    expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - synced');
    expect(screen.getByTestId('entry-2')).toHaveTextContent('man-overboard - pending');

    // The positive assertion comes first on purpose: with no retry control anywhere, the two
    // "offers none" assertions below would hold trivially and prove nothing.
    expect(screen.getByTestId('retry-1')).toBeOnTheScreen();
    expect(screen.queryByTestId('retry-0')).toBeNull();
    expect(screen.queryByTestId('retry-2')).toBeNull();
  });

  it('[REQ-DRILL-012] [REQ-DRILL-010] online: retrying a rejected drill ends synchronised', async () => {
    const gateway = scriptedGateway(REFUSAL, { kind: 'stored' });
    const queue = makeQueue(gateway.next);
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);
    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent(REJECTED_LABEL));

    await fireEvent.press(screen.getByTestId('retry-0'));

    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 1, Rejected: 0'));
    expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - synced');
  });

  it('[REQ-DRILL-012] [REQ-DRILL-010] offline: a retried drill waits as pending and nothing is sent', async () => {
    const gateway = scriptedGateway(REFUSAL, { kind: 'stored' });
    const queue = makeQueue(gateway.next);
    const view = await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);
    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent(REJECTED_LABEL));
    await view.rerender(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={false} />);

    await fireEvent.press(screen.getByTestId('retry-0'));

    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - pending'));
    expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 1, Synced: 0, Rejected: 0');
    expect(gateway.sends).toBe(1); // only the original, refused attempt
  });

  it('[REQ-DRILL-012] the retry action is withdrawn once the drill is pending again', async () => {
    const queue = makeQueue(() => REFUSAL);
    const view = await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);
    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent(REJECTED_LABEL));
    await view.rerender(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={false} />);

    await fireEvent.press(screen.getByTestId('retry-0'));

    await waitFor(() => expect(screen.getByTestId('entry-0')).toHaveTextContent('fire - pending'));
    expect(screen.queryByTestId('retry-0')).toBeNull();
  });

  // RAU-9 (review finding F2). Every press test above has one entry and presses `retry-0`, so a
  // control wired to the first entry, or to the first rejected entry, would pass them all.
  it('[REQ-DRILL-012] with two rejected drills, the second retry action retries that drill and only that drill', async () => {
    const sentTypes: string[] = [];
    const outcomes: SendResult[] = [REFUSAL, REFUSAL, { kind: 'stored' }];
    const transport: Transport = {
      send: async (d: DrillRecord) => {
        sentTypes.push(d.type);
        return outcomes.shift() ?? { kind: 'unavailable' };
      },
    };
    let n = 0;
    const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const queue = new DrillQueue(new MemoryStore(), transport, newId);
    await render(<DrillScreen queue={queue} vesselId="vessel-1" isOnline={true} />);
    await fireEvent.press(screen.getByTestId('record-fire'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 0, Rejected: 1'));
    await fireEvent.press(screen.getByTestId('record-abandon-ship'));
    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 0, Rejected: 2'));

    await fireEvent.press(screen.getByTestId('retry-1'));

    await waitFor(() => expect(screen.getByTestId('summary')).toHaveTextContent('Pending: 0, Synced: 1, Rejected: 1'));
    expect(sentTypes).toEqual(['fire', 'abandon-ship', 'abandon-ship']); // the third send is the retried drill
    expect(screen.getByTestId('entry-1')).toHaveTextContent('abandon-ship - synced');
    expect(screen.getByTestId('entry-0')).toHaveTextContent(REJECTED_LABEL); // the other drill is untouched
    expect(screen.getByTestId('retry-0')).toBeOnTheScreen();
    expect(screen.queryByTestId('retry-1')).toBeNull();
  });
});
