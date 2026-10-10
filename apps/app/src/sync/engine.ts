import { resolveLww, type PullResponse, type PushResponse } from '@pepsgoal/shared';
import { api, ApiError } from '../lib/api';
import { store } from '../db/local';
import { newId } from '../db/repo';

export type SyncState = { status: 'idle' | 'syncing' | 'error' | 'offline'; lastSyncAt: string | null; pending: number; message?: string };
type Listener = (s: SyncState) => void;

let state: SyncState = { status: 'idle', lastSyncAt: null, pending: 0 };
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;

function emit(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach(l => l(state)); }
export function subscribeSync(fn: Listener) { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; }
export async function refreshPending() { emit({ pending: await store.pendingCount(), lastSyncAt: await store.meta('lastSyncAt') }); }

async function deviceId(): Promise<string> {
  let id = await store.meta('deviceId');
  if (!id) { id = newId(); await store.setMeta('deviceId', id); }
  return id;
}

/**
 * Synchronisation complète : 1) envoi de la file d'attente par lots de 100, 2) récupération des changements.
 * Sans danger si elle est interrompue : les opérations sont idempotentes et le curseur n'avance qu'après application.
 */
export function syncNow(): Promise<void> {
  running ??= (async () => {
    emit({ status: 'syncing', message: undefined });
    try {
      const device = await deviceId();
      for (;;) {
        const ops = await store.pending(100);
        if (!ops.length) break;
        const res = await api<PushResponse>('POST', '/v1/sync/push', { deviceId: device, ops });
        // Les opérations refusées (version plus ancienne, données invalides) sont retirées : le serveur fait foi
        await store.ack([...res.applied, ...res.rejected.map(r => r.opId)]);
        if (ops.length < 100) break;
      }
      let cursor = Number((await store.meta('cursor')) ?? 0);
      for (let guard = 0; guard < 50; guard++) {
        const r = await api<PullResponse>('GET', `/v1/sync/pull?cursor=${cursor}`);
        const localGoals = new Map((await store.goals()).map(g => [g.id, g]));
        for (const g of r.goals) {
          const mine = localGoals.get(g.id);
          // Une modification locale plus récente, encore dans la file, n'est pas écrasée
          if (!mine || resolveLww(mine.updatedAt, g.updatedAt).accept) await store.putGoal(g);
        }
        for (const c of r.checkins) await store.putCheckin(c);
        for (const gg of r.goalGroups) await store.putGroup(gg);
        if (r.settings) await store.putSettings(r.settings);
        for (const d of r.deleted) {
          if (d.entity === 'goal') await store.removeGoal(d.id);
          else if (d.entity === 'checkin') await store.removeCheckin(d.id);
          else if (d.entity === 'goalGroup') await store.removeGroup(d.id);
        }
        cursor = r.cursor;
        await store.setMeta('cursor', String(cursor));
        if (!r.hasMore) break;
      }
      const at = new Date().toISOString();
      await store.setMeta('lastSyncAt', at);
      emit({ status: 'idle', lastSyncAt: at, pending: await store.pendingCount() });
    } catch (e) {
      const offline = e instanceof ApiError && (e.status === 0 || e.status === 503);
      emit({ status: offline ? 'offline' : 'error', message: e instanceof Error ? e.message : String(e), pending: await store.pendingCount() });
    } finally {
      running = null;
    }
  })();
  return running;
}
