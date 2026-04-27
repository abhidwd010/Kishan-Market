// lib/store.ts — Zustand store for auth + global UI state
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type User = {
  id: string;
  role: 'farmer' | 'buyer' | 'admin';
  name: string;
  phone: string;
  state: string;
  district: string;
  premium_tier: string;
  rating: number | string;
  verified: boolean;
};

interface AuthState {
  user: User | null;
  accessToken: string | null;
  setAuth: (u: User, t: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: (user, accessToken) => set({ user, accessToken }),
      logout: () => set({ user: null, accessToken: null }),
    }),
    { name: 'km-auth' }
  )
);
