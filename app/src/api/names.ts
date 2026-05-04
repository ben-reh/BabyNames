import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Name, NamesFilters, PopularityRow } from './types';

export function useInfiniteNames(filters: NamesFilters) {
  return useInfiniteQuery({
    queryKey: ['names', filters],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit: filters.limit ?? 30 };
      if (filters.sex) params.sex = filters.sex;
      if (filters.origin) params.origin = filters.origin;
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
