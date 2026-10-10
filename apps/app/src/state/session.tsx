import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PublicUser } from '@pepsgoal/shared';
import { api, tokens } from '../lib/api';
import { SYNC_INTERVAL_MS } from '../lib/config';
import { store } from '../db/local';
import { newId } from '../db/repo';
import { refreshPending, subscribeSync, syncNow } from '../sync/engine';
import { useNetwork } from './network';

type Mode = 'loading' | 'signedOut' | 'guest' | 'account';
interface SessionUser extends PublicUser { banned?: boolean; warned?: boolean }
interface SessionState {
  mode: Mode;
  /** Identifiant local (profil sans compte) ou identifiant du compte. */
  userId: string | null;
  user: SessionUser | null;
  /** Augmente quand les données locales changent hors de l'écran (base prête, synchronisation terminée) : les écrans rechargent. */
  dataVersion: number;
  /** Fonctions sociales visibles : compte connecté, en ligne, pas de maintenance complète. */
  socialAvailable: boolean;
  login(username: string, password: string): Promise<void>;
  register(username: string, displayName: string, password: string): Promise<void>;
  continueAsGuest(): Promise<void>;
  logout(): Promise<{ ok: boolean; reason?: string }>;
  /** Supprime définitivement le compte sur le serveur puis efface les données de l'appareil. */
  deleteAccount(password: string): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
export function useSession(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider manquant');
  return s;
}

interface AuthResponse { user: SessionUser; accessToken: string; refreshToken: string }

export function SessionProvider({ children }: { children: ReactNode }) {
  const { online, maintenance } = useNetwork();
  const [mode, setMode] = useState<Mode>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const bump = useCallback(() => setDataVersion(v => v + 1), []);

  // Démarrage : la base locale d'abord, l'interface fonctionne avant toute réponse du réseau
  useEffect(() => {
    void (async () => {
      await store.init();
      const hasSession = await tokens.load();
      const savedUser = await store.meta('user');
      const guestId = await store.meta('guestId');
      if (hasSession && savedUser) { const u = JSON.parse(savedUser) as SessionUser; setUser(u); setUserId(u.id); setMode('account'); }
      else if (guestId) { setUserId(guestId); setMode('guest'); }
      else setMode('signedOut');
      await refreshPending();
      bump();
    })();
    tokens.onLost(() => { setMode('signedOut'); setUser(null); });
    // Après chaque synchronisation réussie, les écrans relisent la base locale (changements venus d'autres appareils)
    let prev = 'idle';
    const unsub = subscribeSync(s => { if (prev === 'syncing' && s.status === 'idle') bump(); prev = s.status; });
    return unsub;
  }, [bump]);

  // Synchronisation : au retour de la connexion, au retour au premier plan, puis toutes les minutes
  useEffect(() => {
    if (mode !== 'account' || !online) return;
    void syncNow();
    const t = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void syncNow(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [mode, online]);

  const signIn = useCallback(async (res: AuthResponse) => {
    const guestId = await store.meta('guestId');
    await tokens.save(res.accessToken, res.refreshToken);
    if (guestId) {
      // Le profil sans compte devient le compte : ses données sont conservées et envoyées au serveur
      await store.reassignOwner(guestId, res.user.id);
      for (const g of await store.goals()) await store.enqueue({ opId: newId(), entity: 'goal', action: 'upsert', id: g.id, data: g, clientUpdatedAt: g.updatedAt });
      for (const c of await store.checkins()) await store.enqueue({ opId: newId(), entity: 'checkin', action: 'upsert', id: c.id, data: c, clientUpdatedAt: c.updatedAt });
      await store.setMeta('guestId', '');
    }
    await store.setMeta('user', JSON.stringify(res.user));
    setUser(res.user); setUserId(res.user.id); setMode('account');
    bump();
    void syncNow();
  }, [bump]);

  const value = useMemo<SessionState>(() => ({
    mode, userId, user, dataVersion,
    socialAvailable: mode === 'account' && online && maintenance?.mode !== 'full',
    async login(username, password) { await signIn(await api<AuthResponse>('POST', '/v1/auth/login', { username: username.trim().toLowerCase(), password })); },
    async register(username, displayName, password) { await signIn(await api<AuthResponse>('POST', '/v1/auth/register', { username: username.trim().toLowerCase(), displayName, password, acceptTerms: true })); },
    async continueAsGuest() {
      let id = await store.meta('guestId');
      if (!id) { id = newId(); await store.setMeta('guestId', id); }
      setUserId(id); setMode('guest');
    },
    async logout() {
      if (mode === 'account') {
        await syncNow();
        if ((await store.pendingCount()) > 0) return { ok: false, reason: 'Des modifications ne sont pas encore synchronisées. Connecte-toi à internet puis réessaie.' };
        const r = await tokens.refreshToken();
        if (r) await api('POST', '/v1/auth/logout', { refreshToken: r }).catch(() => undefined);
        await tokens.clear();
        await store.wipe(); // les données restent sur le serveur ; rien ne reste sur un appareil partagé
      }
      setUser(null); setUserId(null); setMode('signedOut');
      return { ok: true };
    },
    async deleteAccount(password) {
      await api('DELETE', '/v1/me', { password });
      await tokens.clear();
      await store.wipe();
      setUser(null); setUserId(null); setMode('signedOut');
    }
  }), [mode, userId, user, dataVersion, online, maintenance, signIn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
