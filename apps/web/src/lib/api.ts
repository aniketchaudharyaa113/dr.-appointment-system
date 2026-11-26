export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

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

export function setAuthToken(token: string | null) {
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('medibook_token', token);
    } else {
      localStorage.removeItem('medibook_token');
    }
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
    if (user.token) {
      localStorage.setItem('medibook_token', user.token);
    }
  }
  window.dispatchEvent(new Event('medibook-auth-change'));
}

let inFlightRefresh: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  inFlightRefresh = (async () => {
    try {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!refreshRes.ok) {
        setAuthToken(null);
        setCurrentUser(null);
        return null;
      }

      const refreshed = await refreshRes.json();
      const newToken = refreshed?.accessToken || null;
      if (newToken) {
        setAuthToken(newToken);
        const cur = getCurrentUser();
        if (cur) {
          setCurrentUser({ ...cur, token: newToken });
        }
      } else {
        setAuthToken(null);
        setCurrentUser(null);
      }
      return newToken;
    } catch {
      setAuthToken(null);
      setCurrentUser(null);
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

export async function fetchApi<T = any>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let res = await fetch(`${API_URL}${normalized}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (
    res.status === 401 &&
    !normalized.startsWith('/auth/login') &&
    !normalized.startsWith('/auth/register') &&
    !normalized.startsWith('/auth/refresh')
  ) {
    // Single-flight refresh queue
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) {
      headers.set('Authorization', `Bearer ${refreshedToken}`);
      const retryRes = await fetch(`${API_URL}${normalized}`, {
        ...options,
        credentials: 'include',
        headers,
      });
      if (retryRes.status === 204) {
        return undefined as T;
      }
      if (retryRes.ok) {
        const text = await retryRes.text();
        return text ? (JSON.parse(text) as T) : (undefined as T);
      }
      res = retryRes;
    } else {
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const currentPath = window.location.pathname + window.location.search;
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      }
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    let errorMsg = `Request failed (${res.status})`;
    try {
      const errorJson = await res.json();
      errorMsg = errorJson.message || errorJson.error || errorMsg;
    } catch {
      // ignore non-json
    }
    throw new Error(errorMsg);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const fetchWithAuth = fetchApi;

export function getIstDateOffset(offsetDays = 0): string {
  const target = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);
}

export function formatIstDateTime(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(dt);
}

export function formatIstTime(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}
