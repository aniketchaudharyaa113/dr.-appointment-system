export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'DRIVER';
  token?: string;
}

let inMemoryAccessToken: string | null = null;
let inMemoryCurrentUser: UserSession | null = null;

export function getAuthToken(): string | null {
  return inMemoryAccessToken;
}

export function setAuthToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getCurrentUser(): UserSession | null {
  return inMemoryCurrentUser;
}

export function setCurrentUser(user: UserSession | null) {
  inMemoryCurrentUser = user;
  if (user?.token) {
    inMemoryAccessToken = user.token;
  } else if (!user) {
    inMemoryAccessToken = null;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('medibook-auth-change'));
  }
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

function formatApiErrorDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;

  const entries = Object.entries(details as Record<string, unknown>);
  const messages: string[] = [];

  for (const [field, value] of entries) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim()) continue;
      const trimmed = item.trim();
      const includesField = trimmed.toLowerCase().includes(field.toLowerCase());
      messages.push(includesField ? trimmed : `${field}: ${trimmed}`);
    }
  }

  return messages.length > 0 ? messages.join(' • ') : null;
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
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/login') && !window.location.pathname.startsWith('/login')) {
        const currentPath = window.location.pathname + window.location.search;
        window.location.href = `/auth/login?redirect=${encodeURIComponent(currentPath)}`;
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
      const detailMsg = formatApiErrorDetails(errorJson?.details);
      errorMsg = detailMsg || errorJson?.message || errorJson?.error || errorMsg;
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
