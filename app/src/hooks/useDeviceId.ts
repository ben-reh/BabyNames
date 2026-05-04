import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'device_id';

export function useDeviceId() {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((stored) => {
      if (stored) {
        setDeviceId(stored);
      } else {
        const id = Crypto.randomUUID();
        AsyncStorage.setItem(KEY, id);
        setDeviceId(id);
      }
    });
  }, []);

  return deviceId;
}
