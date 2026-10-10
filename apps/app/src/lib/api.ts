import { API_URL } from './config';
import { secure } from './secure';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const K_ACCESS = 'pg.access', K_REFRESH = 'pg.refresh';
let access: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export const tokens = {
  async load() { access = await secure.get(K_ACCESS); return !!(await secure.get(K_REFRESH)); },
  async save(a: string, r: string) { access = a; await secure.set(K_ACCESS, a); await secure.set(K_REFRESH, r); },
  async clear() { access = null; await secure.remove(K_ACCESS); await secure.remove(K_REFRESH); },
  refreshToken: () => secure.get(K_REFRESH),
  onLost(fn: () => void) { onSessionLost = fn; }
};

/** Renouvelle le jeton d'accès (une seule requête à la fois, même si plusieurs appels échouent ensemble). */
async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const r = await secure.get(K_REFRESH);
    if (!r) return false;
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: r }) });
      if (res.status === 401) { await tokens.clear(); onSessionLost?.(); return false; }
      if (!res.ok) return false;
      const d = await res.json() as { accessToken: string; refreshToken: string };
      await tokens.save(d.accessToken, d.refreshToken);
      return true;
    } catch { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

/** Appel JSON à l'API ; délai maximal de 15 s pour ne jamais bloquer l'interface hors connexion. */
export async function api<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method, signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(access ? { authorization: `Bearer ${access}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'offline', 'Connexion impossible au serveur PepsGoal.');
  } finally { clearTimeout(timer); }
  if (res.status === 401 && retry && (await refresh())) return api<T>(method, path, body, false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? 'error', (data as any).message ?? 'Erreur inattendue.');
  return data as T;
}
