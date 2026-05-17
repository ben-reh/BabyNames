import axios from 'axios';
import { logApiRequest } from '../utils/analytics';

export const API_BASE = 'https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach a timer to every request
api.interceptors.request.use((config) => {
  (config as any)._timer = logApiRequest(config.url ?? '', config.method ?? 'GET');
  return config;
});

// Log completed calls
api.interceptors.response.use(
  (response) => {
    (response.config as any)._timer?.done(response.status);
    return response;
  },
  (error) => {
    (error.config as any)?._timer?.error(error.response?.status, error.message);
    return Promise.reject(error);
  },
);
