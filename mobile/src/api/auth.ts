import { api } from './client';
import type { User } from '@/types';

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const { data } = await api.post('/api/auth/login', { email, password });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await api.get('/api/auth/me');
  return data;
}
