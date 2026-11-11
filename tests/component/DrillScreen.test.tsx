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
