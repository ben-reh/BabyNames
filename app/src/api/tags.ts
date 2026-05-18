import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface TagDef {
  id: string;
  label: string;
  color: string;
}

export const TAG_COLOR_OPTIONS = ['#E8608A', '#5B8DEF', '#4CAF72', '#FF9800', '#9C27B0', '#00BCD4'];

export const PREDEFINED_TAGS: TagDef[] = [
  { id: 'favorite', label: 'Favorite', color: '#E8608A' },
  { id: 'family-name', label: 'Family Name', color: '#5B8DEF' },
  { id: 'middle-name', label: 'Middle Name', color: '#4CAF72' },
];

export function useTagDefs(deviceId: string | null) {
  return useQuery({
    queryKey: ['tags', deviceId],
    queryFn: async () => {
      const { data } = await api.get<{ tags: TagDef[] }>('/tags', { params: { deviceId } });
      return data.tags;
    },
    enabled: !!deviceId,
    staleTime: 60 * 1000,
  });
}

export function useTagAssignments(deviceId: string | null) {
  return useQuery({
    queryKey: ['tag-assignments', deviceId],
    queryFn: async () => {
      const { data } = await api.get<{ assignments: Record<string, string[]> }>('/tags/assignments', {
        params: { deviceId },
      });
      return data.assignments;
    },
    enabled: !!deviceId,
    staleTime: 30 * 1000,
  });
}

export function useCreateTag(deviceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ label, color }: { label: string; color: string }) => {
      const { data } = await api.post<TagDef>('/tags', { deviceId, label, color });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags', deviceId] }),
  });
}

export function useDeleteTag(deviceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      await api.delete(`/tags/${encodeURIComponent(tagId)}`, { params: { deviceId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags', deviceId] });
      qc.invalidateQueries({ queryKey: ['tag-assignments', deviceId] });
    },
  });
}

export function usePartnerTags(listId: string | null, deviceId: string | null) {
  return useQuery({
    queryKey: ['partner-tags', listId, deviceId],
    queryFn: async () => {
      const { data } = await api.get<{ customDefs: TagDef[]; assignments: Record<string, string[]> }>(
        `/lists/${listId}/partner-tags`,
        { params: { deviceId } },
      );
      return data;
    },
    enabled: !!listId && !!deviceId,
    staleTime: 30 * 1000,
  });
}

export function useSetNameTags(deviceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, tagIds }: { name: string; tagIds: string[] }) => {
      await api.put(`/names/${encodeURIComponent(name)}/tags`, { deviceId, tagIds });
    },
    onMutate: async ({ name, tagIds }) => {
      await qc.cancelQueries({ queryKey: ['tag-assignments', deviceId] });
      const prev = qc.getQueryData<Record<string, string[]>>(['tag-assignments', deviceId]);
      qc.setQueryData<Record<string, string[]>>(['tag-assignments', deviceId], (old) => ({
        ...(old ?? {}),
        [name]: tagIds,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tag-assignments', deviceId], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tag-assignments', deviceId] }),
  });
}
