import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Name, NamesFilters, PopularityRow, RankingRow } from './types';

export function useInfiniteNames(filters: NamesFilters) {
  return useInfiniteQuery({
    queryKey: ['names', filters],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit: filters.limit ?? 30 };
      if (filters.sex) params.sex = filters.sex;
      if (filters.origins?.length) params.origin = filters.origins.join(',');
      if (filters.listId) params.listId = filters.listId;
      if (filters.deviceId) params.deviceId = filters.deviceId;
      if (filters.min_rank) params.min_rank = filters.min_rank;
      if (filters.max_rank) params.max_rank = filters.max_rank;
      if (pageParam) params.cursor = pageParam as string;
      const { data } = await api.get<{ names: Name[]; cursor: string | null }>('/names', { params });
      return data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.cursor ?? null,
    staleTime: 5 * 60 * 1000,
  });
}

export function useName(name: string) {
  return useQuery({
    queryKey: ['name', name],
    queryFn: async () => {
      const { data } = await api.get<Name>(`/names/${encodeURIComponent(name)}`);
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useNamePopularity(name: string) {
  return useQuery({
    queryKey: ['name', name, 'popularity'],
    queryFn: async () => {
      const { data } = await api.get<{ name: string; data: PopularityRow[] }>(
        `/names/${encodeURIComponent(name)}/popularity`,
      );
      return data.data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useNameYearRank(name: string, sex: 'M' | 'F', year = 2025) {
  return useQuery({
    queryKey: ['name', name, 'rank', year, sex],
    queryFn: async () => {
      const { data } = await api.get<{ rank: number | null; count: number | null; year: number }>(
        `/names/${encodeURIComponent(name)}/rank`,
        { params: { year, sex } },
      );
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useNamesBatch(names: string[]) {
  return useQuery({
    queryKey: ['names', 'batch', names.slice().sort().join(',')],
    queryFn: async () => {
      const { data } = await api.get<{ names: Array<{ name: string; sex: string }> }>(
        '/names/batch',
        { params: { names: names.join(',') } },
      );
      return new Map(data.names.map((n) => [n.name, n.sex as 'M' | 'F']));
    },
    enabled: names.length > 0,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRankings(year: number, sex: 'M' | 'F') {
  return useInfiniteQuery({
    queryKey: ['rankings', year, sex],
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<{ rankings: RankingRow[]; offset: number; hasMore: boolean }>(
        '/names/rankings',
        { params: { year, sex, limit: 50, offset: pageParam } },
      );
      return data;
    },
    initialPageParam: 0 as number,
    getNextPageParam: (last) => (last.hasMore ? last.offset : undefined),
    staleTime: 10 * 60 * 1000,
  });
}

export function useNameSearch(q: string) {
  return useQuery({
    queryKey: ['names', 'search', q],
    queryFn: async () => {
      const { data } = await api.get<{ names: Name[] }>('/names/search', { params: { q } });
      return data.names;
    },
    enabled: q.length >= 2,
    staleTime: 60 * 1000,
  });
}
