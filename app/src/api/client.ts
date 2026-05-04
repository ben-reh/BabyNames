import axios from 'axios';

export const API_BASE = 'https://2e5o06c9e6.execute-api.us-east-1.amazonaws.com/prod';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});
