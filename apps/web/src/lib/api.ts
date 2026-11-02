export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'DRIVER';
  token?: string;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('medibook_token');
}

export function setAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('medibook_token', token);
  }
}

export function getCurrentUser(): UserSession | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem('medibook_user');
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function setCurrentUser(user: UserSession | null) {
  if (typeof window === 'undefined') return;
  if (!user) {
    localStorage.removeItem('medibook_user');
    localStorage.removeItem('medibook_token');
  } else {
    localStorage.setItem('medibook_user', JSON.stringify(user));
  }
}

export async function fetchWithAuth<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `API request failed: ${res.status} ${res.statusText}`;
    try {
      const errorJson = await res.json();
      errorMsg = errorJson.message || errorJson.error || errorMsg;
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }

  return res.json();
}
