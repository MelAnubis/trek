import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { api, TOKEN_KEY, BASE_URL_KEY } from '@/api/client';
import type { User } from '@/types';

interface AuthState {
  token: string | null;
  user: User | null;
  serverUrl: string | null;
  isLoading: boolean;
  error: string | null;

  init: () => Promise<void>;
  login: (serverUrl: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  serverUrl: null,
  isLoading: true,
  error: null,

  init: async () => {
    try {
      const [token, serverUrl] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(BASE_URL_KEY),
      ]);
      if (token && serverUrl) {
        api.defaults.baseURL = serverUrl;
        const { data: user } = await api.get('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        set({ token, user, serverUrl, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      set({ token: null, user: null, isLoading: false });
    }
  },

  login: async (serverUrl, email, password) => {
    set({ error: null });
    const url = serverUrl.replace(/\/$/, '');
    const { data } = await api.post('/api/auth/login', { email, password }, {
      baseURL: url,
    });
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, data.token),
      SecureStore.setItemAsync(BASE_URL_KEY, url),
    ]);
    api.defaults.baseURL = url;
    set({ token: data.token, user: data.user, serverUrl: url });
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(BASE_URL_KEY),
    ]);
    set({ token: null, user: null, serverUrl: null });
  },
}));
