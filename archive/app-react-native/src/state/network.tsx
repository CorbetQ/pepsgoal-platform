import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { ServerStatus } from '@pepsgoal/shared';
import { API_URL } from '../lib/config';

interface NetworkState {
  /** Connexion internet ET serveur PepsGoal joignable. Sinon l'app passe en mode hors ligne. */
  online: boolean;
  /** Vérification en cours (premier contact au démarrage). */
  checking: boolean;
  maintenance: ServerStatus['maintenance'];
  checkNow: () => void;
}

const Ctx = createContext<NetworkState>({ online: false, checking: true, maintenance: null, checkNow: () => {} });
export const useNetwork = () => useContext(Ctx);

/** Intervalles entre deux essais quand le serveur ne répond pas : 5 s, 10 s, 20 s, 40 s, puis 1 min. */
const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
/** Vérification de routine quand tout va bien. */
const HEALTHY_MS = 60_000;

let reportFailure: (() => void) | null = null;
/** Appelé par le client API quand une requête n'aboutit pas : l'app passe aussitôt hors ligne et relance les essais. */
export function reportServerUnreachable() { reportFailure?.(); }

/**
 * Surveille la connexion de l'appareil (NetInfo) et la disponibilité du serveur (`GET /v1/status`, délai 5 s).
 * Hors ligne, l'app reste utilisable : seules la synchronisation, les fonctions sociales et le changement de compte
 * sont suspendus. Les essais reprennent à intervalle croissant, et immédiatement au retour au premier plan
 * ou au retour du réseau.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(true);
  const [server, setServer] = useState<{ ok: boolean; maintenance: ServerStatus['maintenance'] }>({ ok: false, maintenance: null });
  const [checking, setChecking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const inFlight = useRef(false);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void ping(), ms);
  }, []);

  const ping = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${API_URL}/v1/status`, { signal: ctrl.signal, cache: 'no-store' });
      const s = await r.json() as ServerStatus;
      if (!r.ok || !s.ok) throw new Error('indisponible');
      failures.current = 0;
      setServer({ ok: true, maintenance: s.maintenance });
      schedule(HEALTHY_MS);
    } catch {
      setServer(prev => ({ ...prev, ok: false }));
      schedule(RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!);
      failures.current++;
    } finally {
      clearTimeout(t); inFlight.current = false; setChecking(false);
    }
  }, [schedule]);

  useEffect(() => {
    reportFailure = () => { setServer(prev => ({ ...prev, ok: false })); failures.current = 0; schedule(RETRY_MS[0]!); };
    const unsubNet = NetInfo.addEventListener(s => {
      const up = !!s.isConnected && s.isInternetReachable !== false;
      setConnected(up);
      if (up) { failures.current = 0; void ping(); } else setServer(prev => ({ ...prev, ok: false }));
    });
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { failures.current = 0; void ping(); } });
    void ping();
    return () => { reportFailure = null; unsubNet(); sub.remove(); if (timer.current) clearTimeout(timer.current); };
  }, [ping, schedule]);

  const checkNow = useCallback(() => { failures.current = 0; void ping(); }, [ping]);
  return <Ctx.Provider value={{ online: connected && server.ok, checking, maintenance: server.maintenance, checkNow }}>{children}</Ctx.Provider>;
}
