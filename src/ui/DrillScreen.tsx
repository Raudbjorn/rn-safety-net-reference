import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';

import { DRILL_TYPES, type DrillType } from '../domain/drill';
import type { DrillQueue, QueueEntry } from '../sync/queue';

interface Props {
  queue: DrillQueue;
  vesselId: string;
  /** From the connectivity layer. The screen never decides what "online" means. */
  isOnline: boolean;
}

export function summarise(entries: QueueEntry[]): string {
  const count = (s: QueueEntry['status']) => entries.filter((e) => e.status === s).length;
  return `Pending: ${count('pending')}, Synced: ${count('synced')}, Rejected: ${count('rejected')}`;
}

function label(entry: QueueEntry): string {
  const base = `${entry.drill.type} - ${entry.status}`;
  return entry.status === 'rejected' && entry.reason ? `${base} (${entry.reason})` : base;
}

export function DrillScreen({ queue, vesselId, isOnline }: Props) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(queue.snapshot()), [queue]);

  const sync = useCallback(async () => {
    await queue.flush();
    refresh();
  }, [queue, refresh]);

  useEffect(() => {
    void queue.load().then(setEntries);
  }, [queue]);

  // REQ-DRILL-004: when connectivity returns, send what is pending.
  useEffect(() => {
    if (isOnline) void sync();
  }, [isOnline, sync]);

  const record = async (type: DrillType) => {
    const result = await queue.record({ vesselId, type, performedAt: new Date().toISOString() });
    refresh();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (isOnline) await sync();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Drill logbook</Text>
      <Text testID="connectivity">{isOnline ? 'Online' : 'Offline'}</Text>
      <Text testID="summary">{summarise(entries)}</Text>
      {error ? <Text testID="error">{error}</Text> : null}

      {DRILL_TYPES.map((type) => (
        <Button key={type} testID={`record-${type}`} title={`Record ${type}`} onPress={() => void record(type)} />
      ))}
      <Button testID="sync-now" title="Sync now" onPress={() => void sync()} />

      <FlatList
        data={entries}
        keyExtractor={(e) => e.drill.id}
        renderItem={({ item, index }) => <Text testID={`entry-${index}`}>{label(item)}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, gap: 8 },
  title: { fontSize: 22, fontWeight: '600' },
});
