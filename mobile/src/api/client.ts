import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL_KEY = 'trek_server_url';
export const TOKEN_KEY = 'trek_token';

export const api = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const [url, token] = await Promise.all([
    SecureStore.getItemAsync(BASE_URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  if (url) config.baseURL = url;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      // authStore will react to token removal
    }
    return Promise.reject(error);
  }
);
