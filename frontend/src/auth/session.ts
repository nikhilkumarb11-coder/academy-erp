import type { Session } from '../data/types';

const key = (slug: string) => `erp:${slug}:session`;

export function readSession(slug: string): Session | null {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.token && session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function writeSession(slug: string, session: Session) {
  localStorage.setItem(key(slug), JSON.stringify(session));
}

export function clearSession(slug: string) {
  localStorage.removeItem(key(slug));
}
