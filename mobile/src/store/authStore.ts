import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(BASE_URL_KEY),
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
      await AsyncStorage.removeItem(TOKEN_KEY);
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
      AsyncStorage.setItem(TOKEN_KEY, data.token),
      AsyncStorage.setItem(BASE_URL_KEY, url),
    ]);
    api.defaults.baseURL = url;
    set({ token: data.token, user: data.user, serverUrl: url });
  },

  logout: async () => {
    await Promise.all([
      AsyncStorage.removeItem(TOKEN_KEY),
      AsyncStorage.removeItem(BASE_URL_KEY),
    ]);
    set({ token: null, user: null, serverUrl: null });
  },
}));
