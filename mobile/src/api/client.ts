import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL_KEY = 'trek_server_url';
export const TOKEN_KEY = 'trek_token';

export const api = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const [url, token] = await Promise.all([
    AsyncStorage.getItem(BASE_URL_KEY),
    AsyncStorage.getItem(TOKEN_KEY),
  ]);
  if (url) config.baseURL = url;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
    return Promise.reject(error);
  }
);
