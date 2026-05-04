import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SessionState {
  listId: string | null;
  deviceId: string | null;
  partnerRole: 'A' | 'B' | null;
  code: string | null;
  setSession: (s: { listId: string; deviceId: string; partnerRole: 'A' | 'B'; code: string }) => void;
  clearSession: () => void;
}

interface FilterState {
  sex: 'M' | 'F' | null;
  origin: string | null;
  setSex: (sex: 'M' | 'F' | null) => void;
  setOrigin: (origin: string | null) => void;
  resetFilters: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      listId: null,
      deviceId: null,
      partnerRole: null,
      code: null,
      setSession: (s) => set(s),
      clearSession: () => set({ listId: null, deviceId: null, partnerRole: null, code: null }),
    }),
    { name: 'session', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const useFilterStore = create<FilterState>()((set) => ({
  sex: null,
  origin: null,
  setSex: (sex) => set({ sex }),
  setOrigin: (origin) => set({ origin }),
  resetFilters: () => set({ sex: null, origin: null }),
}));
