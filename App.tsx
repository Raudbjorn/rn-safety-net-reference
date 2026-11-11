import { useNetInfo } from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';

import { asyncStorageStore } from './src/storage/asyncStorage';
import { createHttpTransport } from './src/sync/httpTransport';
import { DrillQueue } from './src/sync/queue';
import { DrillScreen } from './src/ui/DrillScreen';

// 10.0.2.2 is the Android emulator's alias for the host machine.
const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://10.0.2.2:3000';
const VESSEL_ID = 'vessel-demo-001';

export default function App() {
  const net = useNetInfo();
  const queue = useMemo(
    () => new DrillQueue(asyncStorageStore, createHttpTransport(GATEWAY_URL), randomUUID),
    [],
  );
  // `isInternetReachable` is null while unknown; only an explicit `false` means offline.
  const isOnline = net.isConnected === true && net.isInternetReachable !== false;

  return (
    <>
      <DrillScreen queue={queue} vesselId={VESSEL_ID} isOnline={isOnline} />
      <StatusBar style="auto" />
    </>
  );
}
