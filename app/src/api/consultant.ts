import { useMutation } from '@tanstack/react-query';
import { api } from './client';

export interface ConsultantName {
  name: string;
  gender: string;
  origin: string;
  description: string;
}

export interface ConsultantSessionResponse {
  profileSummary: string;
  partnerSummary: string | null;
  names: ConsultantName[];
}

interface ConsultantSessionRequest {
  deviceId: string;
  listId?: string;
  vibeText?: string;
}

interface ConsultantFeedbackRequest {
  deviceId: string;
  likes: string[];
  passes: string[];
}

export function useConsultantSession() {
  return useMutation({
    mutationFn: async (req: ConsultantSessionRequest) => {
      const { data } = await api.post<ConsultantSessionResponse>('/consultant/session', req);
      return data;
    },
  });
}

export function useConsultantFeedback() {
  return useMutation({
    mutationFn: async (req: ConsultantFeedbackRequest) => {
      await api.post('/consultant/feedback', req);
    },
  });
}
