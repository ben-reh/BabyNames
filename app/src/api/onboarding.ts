import { useMutation } from '@tanstack/react-query';
import { api } from './client';

export type OnboardingAction = { name: string; action: 'add' | 'vibe' | 'skip' };

export function useOnboarding() {
  return useMutation({
    mutationFn: async ({
      deviceId,
      sex,
      actions,
    }: {
      deviceId: string;
      sex: 'F' | 'M' | null;
      actions: OnboardingAction[];
    }) => {
      await api.post('/onboarding', {
        deviceId,
        sex: sex ?? undefined,
        actions,
      });
    },
  });
}
