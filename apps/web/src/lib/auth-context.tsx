'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  API_URL,
  fetchApi,
  getAuthToken,
  setAuthToken,
  setCurrentUser,
  refreshAccessToken,
  type UserSession,
} from './api';
import { disconnectAllSockets } from './socket-registry';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'DRIVER';
  doctorProfile?: any;
  driverProfile?: any;
  token?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (payload: Record<string, any>) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchUserProfile = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const profile = await fetchApi<AuthUser>('/auth/me');
      const token = getAuthToken() || undefined;
      const fullProfile = { ...profile, token };
      setUser(fullProfile);
      setCurrentUser({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        role: profile.role,
        token,
      });
      return fullProfile;
    } catch {
      setUser(null);
      setCurrentUser(null);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const token = await refreshAccessToken();
      if (token) {
        setAuthToken(token);
        await fetchUserProfile();
      } else {
        setUser(null);
        setCurrentUser(null);
      }
    } catch {
      setUser(null);
      setCurrentUser(null);
    }
  }, [fetchUserProfile]);

  const logout = useCallback(async () => {
    try {
      await fetchApi('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => {
        // Ignore network failure during logout
      });
    } finally {
      setAuthToken(null);
      setCurrentUser(null);
      setUser(null);
      disconnectAllSockets();
      queryClient.clear();
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/login';
      }
    }
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const res = await fetchApi<{
        user: { id: string; email: string; name: string; role: UserSession['role'] };
        accessToken: string;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setAuthToken(res.accessToken);
      const profile = await fetchUserProfile();
      if (!profile) {
        throw new Error('Failed to load user profile after login');
      }
      return profile;
    },
    [fetchUserProfile],
  );

  const register = useCallback(
    async (payload: Record<string, any>): Promise<AuthUser> => {
      const res = await fetchApi<{
        user: { id: string; email: string; name: string; role: UserSession['role'] };
        accessToken: string;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setAuthToken(res.accessToken);
      const profile = await fetchUserProfile();
      if (profile) return profile;

      const fallbackUser: AuthUser = {
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        role: res.user.role,
        token: res.accessToken,
      };
      setUser(fallbackUser);
      setCurrentUser(fallbackUser);
      return fallbackUser;
    },
    [fetchUserProfile],
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sessionRes = await fetch(`${API_URL}/auth/session`, {
          credentials: 'include',
        }).catch(() => null);
        if (sessionRes?.ok) {
          const sessionData = await sessionRes.json().catch(() => null);
          if (sessionData && sessionData.hasSession === false) {
            return;
          }
        }
        const token = await refreshAccessToken();
        if (token && mounted) {
          setAuthToken(token);
          await fetchUserProfile();
        }
      } catch {
        if (mounted) {
          setUser(null);
          setCurrentUser(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [fetchUserProfile]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      login,
      register,
      logout,
      refresh,
    }),
    [user, isLoading, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
