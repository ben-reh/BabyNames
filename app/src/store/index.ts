import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ConsultantName } from '../api/consultant';

interface SessionState {
  listId: string | null;
  deviceId: string | null;
  partnerRole: 'A' | 'B' | null;
  code: string | null;
  onboardingDone: boolean;
  defaultSex: 'M' | 'F' | 'U' | null;
  setSession: (s: { listId: string; deviceId: string; partnerRole: 'A' | 'B'; code: string }) => void;
  clearSession: () => void;
  setOnboardingDone: () => void;
  setDefaultSex: (sex: 'M' | 'F' | 'U') => void;
  setDeviceId: (deviceId: string, listId: string | null) => void;
}

interface FilterState {
  sex: 'M' | 'F' | 'U' | null;
  origins: string[];
  popularity: string[];
  setSex: (sex: 'M' | 'F' | 'U' | null) => void;
  setOrigins: (origins: string[]) => void;
  setPopularity: (popularity: string[]) => void;
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
      onboardingDone: false,
      defaultSex: null,
      setSession: (s) => set(s),
      clearSession: () => set({ listId: null, deviceId: null, partnerRole: null, code: null, onboardingDone: false, defaultSex: null }),
      setOnboardingDone: () => set({ onboardingDone: true }),
      setDefaultSex: (sex) => set({ defaultSex: sex }),
      setDeviceId: (deviceId, listId) => set({ deviceId, listId, partnerRole: listId ? 'A' : null, code: null, onboardingDone: true }),
    }),
    { name: 'session', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      sex: 'F',
      origins: [],
      popularity: [],
      setSex: (sex) => set({ sex }),
      setOrigins: (origins) => set({ origins }),
      setPopularity: (popularity) => set({ popularity }),
      resetFilters: () => set({ sex: null, origins: [], popularity: [] }),
    }),
    {
      name: 'filters',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ sex: state.sex }),
    },
  ),
);

export const useMatchBannerStore = create<MatchBannerState>()((set) => ({
  pendingMatch: null,
  showBanner: (name) => set({ pendingMatch: name }),
  dismissBanner: () => set({ pendingMatch: null }),
}));

interface SeenNamesState {
  seenNames: Record<string, true>;
  addSeen: (name: string) => void;
  clearSeen: () => void;
}

interface ListOrderState {
  orders: Record<string, string[]>;
  setOrder: (listId: string, names: string[]) => void;
}

export const useListOrderStore = create<ListOrderState>()(
  persist(
    (set) => ({
      orders: {},
      setOrder: (listId, names) => set((s) => ({ orders: { ...s.orders, [listId]: names } })),
    }),
    { name: 'list-order', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const useSeenNamesStore = create<SeenNamesState>()(
  persist(
    (set) => ({
      seenNames: {},
      addSeen: (name) => set((s) => ({ seenNames: { ...s.seenNames, [name]: true } })),
      clearSeen: () => set({ seenNames: {} }),
    }),
    { name: 'seen-names', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

// Auth store — not persisted; tokens live in expo-secure-store
interface AuthState {
  sub: string | null;
  email: string | null;
  migrationDone: boolean;
  setAuth: (sub: string, email: string) => void;
  setMigrationDone: () => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  sub: null,
  email: null,
  migrationDone: false,
  setAuth: (sub, email) => set({ sub, email }),
  setMigrationDone: () => set({ migrationDone: true }),
  clearAuth: () => set({ sub: null, email: null, migrationDone: false }),
}));

interface ConsultantSession {
  profileSummary: string;
  partnerSummary: string | null;
  names: ConsultantName[];
  generatedAt: number;
}

interface ConsultantStoreState {
  session: ConsultantSession | null;
  vibeText: string;
  sex: 'F' | 'U' | 'M';
  setSession: (session: Omit<ConsultantSession, 'generatedAt'>) => void;
  setVibeText: (text: string) => void;
  setSex: (sex: 'F' | 'U' | 'M') => void;
  clearSession: () => void;
}

export const useConsultantStore = create<ConsultantStoreState>()(
  persist(
    (set) => ({
      session: null,
      vibeText: '',
      sex: 'F',
      setSession: (s) => set({ session: { ...s, generatedAt: Date.now() } }),
      setVibeText: (text) => set({ vibeText: text }),
      setSex: (sex) => set({ sex }),
      clearSession: () => set({ session: null }),
    }),
    { name: 'consultant', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
