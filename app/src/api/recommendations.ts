import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Name } from './types';

interface RecommendationsFilters {
  deviceId: string;
  sex?: 'M' | 'F' | 'U';
  origins?: string[];
  popularity?: string[];
}

export function useInfiniteRecommendations(filters: RecommendationsFilters) {
  return useInfiniteQuery({
    queryKey: ['recommendations', filters.deviceId, filters.sex, filters.origins, filters.popularity],
    queryFn: async () => {
      const params: Record<string, string> = { deviceId: filters.deviceId };
      if (filters.sex) params.sex = filters.sex;
      if (filters.origins?.length) params.origins = filters.origins.join(',');
      if (filters.popularity?.length) params.popularity = filters.popularity.join(',');
      const { data } = await api.get<{ names: Name[] }>('/recommendations', { params });
      return data;
    },
    initialPageParam: 0,
    getNextPageParam: (_, allPages) => allPages.length,
    staleTime: 0,
  });
}
