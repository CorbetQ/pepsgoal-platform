import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { ServerStatus } from '@pepsgoal/shared';
import { API_URL } from '../lib/config';

interface NetworkState {
  /** Connexion internet ET serveur PepsGoal joignable. */
  online: boolean;
  maintenance: ServerStatus['maintenance'];
  checkNow: () => void;
}

const Ctx = createContext<NetworkState>({ online: false, maintenance: null, checkNow: () => {} });
export const useNetwork = () => useContext(Ctx);

/**
 * Surveille la connexion de l'appareil (NetInfo) et vérifie que le serveur répond (`GET /v1/status`).
 * Hors ligne, l'app reste utilisable : seules la synchronisation et les fonctions sociales sont suspendues.
 */
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(true);
  const [server, setServer] = useState<{ ok: boolean; maintenance: ServerStatus['maintenance'] }>({ ok: false, maintenance: null });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const ping = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${API_URL}/v1/status`, { signal: ctrl.signal });
      const s = await r.json() as ServerStatus;
      setServer({ ok: r.ok && s.ok, maintenance: s.maintenance });
    } catch { setServer(prev => ({ ...prev, ok: false })); }
    finally { clearTimeout(t); }
  };

  useEffect(() => {
    const unsub = NetInfo.addEventListener(s => {
      const up = !!s.isConnected && s.isInternetReachable !== false;
      setConnected(up);
      if (up) void ping(); else setServer(prev => ({ ...prev, ok: false }));
    });
    void ping();
    timer.current = setInterval(() => void ping(), 30_000);
    return () => { unsub(); if (timer.current) clearInterval(timer.current); };
  }, []);

  return <Ctx.Provider value={{ online: connected && server.ok, maintenance: server.maintenance, checkNow: () => void ping() }}>{children}</Ctx.Provider>;
}
