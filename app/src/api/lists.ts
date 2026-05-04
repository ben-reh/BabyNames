import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { ListSession } from './types';

export function useList(listId: string | null) {
  return useQuery({
    queryKey: ['list', listId],
    queryFn: async () => {
      const { data } = await api.get<ListSession>(`/lists/${listId}`);
      return data;
    },
    enabled: !!listId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useCreateList() {
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const { data } = await api.post<{ listId: string; code: string }>('/lists', { deviceId });
      return data;
    },
  });
}

export function useJoinList() {
  return useMutation({
    mutationFn: async ({ code, deviceId }: { code: string; deviceId: string }) => {
      const { data } = await api.post<{ listId: string; role: 'A' | 'B' }>('/lists/join', { code, deviceId });
      return data;
    },
  });
}

export function useAddName(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, name }: { deviceId: string; name: string }) => {
      await api.post(`/lists/${listId}/names`, { deviceId, name });
    },
    onMutate: async ({ name }) => {
      await qc.cancelQueries({ queryKey: ['list', listId] });
      const prev = qc.getQueryData<ListSession>(['list', listId]);
      if (prev) {
        qc.setQueryData<ListSession>(['list', listId], (old) => {
          if (!old) return old;
          const isA = old.partnerA !== null;
          return {
            ...old,
            partnerA: isA ? { ...old.partnerA, names: [...old.partnerA.names, name] } : old.partnerA,
          };
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['list', listId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['list', listId] }),
  });
}

export function useRemoveName(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, name }: { deviceId: string; name: string }) => {
      await api.delete(`/lists/${listId}/names/${encodeURIComponent(name)}`, { data: { deviceId } });
    },
    onMutate: async ({ name }) => {
      await qc.cancelQueries({ queryKey: ['list', listId] });
      const prev = qc.getQueryData<ListSession>(['list', listId]);
      if (prev) {
        qc.setQueryData<ListSession>(['list', listId], (old) => {
          if (!old) return old;
          return {
            ...old,
            partnerA: { ...old.partnerA, names: old.partnerA.names.filter((n) => n !== name) },
          };
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['list', listId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['list', listId] }),
  });
}
