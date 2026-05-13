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
  origins: string[];
  setSex: (sex: 'M' | 'F' | null) => void;
  setOrigins: (origins: string[]) => void;
  resetFilters: () => void;
}

interface MatchBannerState {
  pendingMatch: string | null;
  showBanner: (name: string) => void;
  dismissBanner: () => void;
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
  origins: [],
  setSex: (sex) => set({ sex }),
  setOrigins: (origins) => set({ origins }),
  resetFilters: () => set({ sex: null, origins: [] }),
}));

export const useMatchBannerStore = create<MatchBannerState>()((set) => ({
  pendingMatch: null,
  showBanner: (name) => set({ pendingMatch: name }),
  dismissBanner: () => set({ pendingMatch: null }),
}));
