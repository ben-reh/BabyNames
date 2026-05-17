import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Name } from './types';

interface RecommendationsFilters {
  deviceId: string;
  listId?: string;
  sex?: 'M' | 'F' | 'U';
  origins?: string[];
  popularity?: string[];
}

export function useInfiniteRecommendations(filters: RecommendationsFilters) {
  return useInfiniteQuery({
    queryKey: ['recommendations', filters.deviceId, filters.listId, filters.sex, filters.origins, filters.popularity],
    queryFn: async () => {
      const params: Record<string, string> = { deviceId: filters.deviceId };
      if (filters.listId) params.listId = filters.listId;
      if (filters.sex) params.sex = filters.sex;
      if (filters.origins?.length) params.origins = filters.origins.join(',');
      if (filters.popularity?.length) params.popularity = filters.popularity.join(',');
      const { data } = await api.get<{ names: Name[] }>('/recommendations', { params });
      return data;
    },
    initialPageParam: 0,
    getNextPageParam: (_, allPages) => allPages.length,
    staleTime: 5 * 60 * 1000, // 5 min — prevents background refetch on every swipe re-render
    refetchOnWindowFocus: false, // new pages via fetchNextPage only, not on app focus
  });
}
