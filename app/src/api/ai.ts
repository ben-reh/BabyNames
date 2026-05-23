import { useMutation } from '@tanstack/react-query';
import { api } from './client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NameResult {
  name: string;
  sex: 'M' | 'F';
  rank: number | null;
  origin: string | null;
  year_peak: number | null;
  vibe_names: string[];
}

export interface ChatResponse {
  reply: string;
  names: NameResult[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  context: {
    listId: string | null;
    sex: string | null;
  };
}

export function useChat() {
  return useMutation({
    mutationFn: async (req: ChatRequest): Promise<ChatResponse> => {
      const { data } = await api.post<ChatResponse>('/ai/chat', req, { timeout: 55000 });
      return data;
    },
  });
}
