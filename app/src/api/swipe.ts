import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { api } from './client';
import type { Name } from './types';

export function useRecordSwipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, name, liked, sex_context }: { deviceId: string; name: string; liked: boolean; sex_context?: string | null }) => {
      await api.post('/swipe', { deviceId, name, liked, sex_context: sex_context ?? null });
    },
    onMutate: async ({ deviceId, name, liked, sex_context }) => {
      await queryClient.cancelQueries({ queryKey: ['recommendations', deviceId] });
      const snapshots = queryClient.getQueriesData<InfiniteData<{ names: Name[] }>>({ queryKey: ['recommendations', deviceId] });
      queryClient.setQueriesData<InfiniteData<{ names: Name[] }>>(
        { queryKey: ['recommendations', deviceId] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({ ...page, names: page.names.filter((n) => n.name !== name) })),
          };
        },
      );
      const ctx = sex_context === 'F' || sex_context === 'M' || sex_context === 'U' ? sex_context : undefined;
      const swipeKey = ['swipes', deviceId, liked, ctx] as const;
      const prevSwipeHistory = queryClient.getQueryData<string[]>(swipeKey);
      queryClient.setQueryData<string[]>(swipeKey, (old) => (old ? [...old, name] : [name]));
      return { snapshots, prevSwipeHistory, swipeKey };
    },
    onError: (_e, _v, ctx) => {
      for (const [queryKey, data] of ctx?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      if (ctx?.prevSwipeHistory !== undefined) {
        queryClient.setQueryData(ctx.swipeKey, ctx.prevSwipeHistory);
      }
    },
    onSettled: (_, __, { deviceId }) => {
      queryClient.invalidateQueries({ queryKey: ['swipes', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['recommendations', deviceId] });
    },
  });
}

export function useSwipedNames(deviceId: string | null, liked: boolean, sex?: 'F' | 'M' | 'U') {
  return useQuery({
    queryKey: ['swipes', deviceId, liked, sex],
    queryFn: async () => {
      const params: Record<string, unknown> = { deviceId, liked };
      if (sex) params.sex = sex;
      const { data } = await api.get<{ names: string[] }>('/swipes', { params });
      return data.names;
    },
    enabled: !!deviceId,
    staleTime: 30 * 1000,
  });
}
