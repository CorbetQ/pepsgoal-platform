import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import type { Row } from './mappers.js';

/**
 * Statistiques du serveur pour l'onglet « Serveur » de la modération : santé du processus, trafic depuis le démarrage,
 * volumes en base et activité récente. Uniquement des compteurs : aucun contenu ni donnée personnelle.
 */
const startedAt = Date.now();
const traffic = { requests: 0, errors: 0, clientErrors: 0, totalMs: 0, perMinute: new Map<number, number>() };

export const SERVER_VERSION = (() => {
  try { return String(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version); } catch { return 'inconnue'; }
})();

/** Appelé à chaque réponse (voir app.ts). */
export function recordResponse(status: number, ms: number): void {
  traffic.requests++;
  traffic.totalMs += Number.isFinite(ms) ? ms : 0;
  if (status >= 500) traffic.errors++;
  else if (status >= 400) traffic.clientErrors++;
  const min = Math.floor(Date.now() / 60e3);
  traffic.perMinute.set(min, (traffic.perMinute.get(min) ?? 0) + 1);
  // Une heure d'historique suffit
  if (traffic.perMinute.size > 70) for (const k of traffic.perMinute.keys()) if (k < min - 60) traffic.perMinute.delete(k);
}

/** Taille d'un dossier (médias publics, pièces jointes chiffrées), sans suivre les liens. */
async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0, files = 0;
  const walk = async (d: string, depth: number) => {
    if (depth > 3) return;
    const entries = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.isFile()) { files++; bytes += (await stat(p).catch(() => null))?.size ?? 0; }
    }
  };
  await walk(path.resolve(env.MEDIA_DIR), 0);
  return { bytes, files };
}

const one = async (q: Promise<Row[]>, fallback: Row = {}): Promise<Row> => { try { return (await q)[0] ?? fallback; } catch { return fallback; } };

export async function serverStats() {
  const min = Math.floor(Date.now() / 60e3);
  let lastHour = 0;
  const perMinute = Array.from({ length: 60 }, (_, i) => { const n = traffic.perMinute.get(min - 59 + i) ?? 0; lastHour += n; return n; });
  const mem = process.memoryUsage();

  const counts = await one(sql<Row[]>`select
    (select count(*)::int from users where role = 'user' and deleted_at is null) as users,
    (select count(*)::int from users where role = 'user' and deleted_at is null and created_at > now() - interval '1 day') as users_1d,
    (select count(*)::int from users where role = 'user' and deleted_at is null and created_at > now() - interval '7 days') as users_7d,
    (select count(*)::int from users where role = 'user' and deleted_at is null and created_at > now() - interval '30 days') as users_30d,
    (select count(distinct t.user_id)::int from refresh_tokens t join users u on u.id = t.user_id where u.role = 'user' and t.created_at > now() - interval '1 day') as active_1d,
    (select count(distinct t.user_id)::int from refresh_tokens t join users u on u.id = t.user_id where u.role = 'user' and t.created_at > now() - interval '7 days') as active_7d,
    (select count(*)::int from goals where deleted_at is null) as goals,
    (select count(*)::int from checkins where deleted_at is null) as checkins,
    (select count(*)::int from checkins where deleted_at is null and created_at > now() - interval '1 day') as checkins_1d,
    (select count(*)::int from posts where deleted_at is null) as posts,
    (select count(*)::int from posts where deleted_at is null and created_at > now() - interval '1 day') as posts_1d,
    (select count(*)::int from comments where deleted_at is null) as comments,
    (select count(*)::int from stories where expires_at > now()) as stories_live,
    (select count(*)::int from stories) as stories,
    (select count(*)::int from messages) as messages,
    (select count(*)::int from messages where created_at > now() - interval '1 day') as messages_1d,
    (select count(*)::int from chat_groups) as groups,
    (select count(*)::int from friendships where status = 'accepted') as friendships,
    (select count(*)::int from push_subscriptions) as push_subs,
    (select count(*)::int from e2e_devices) as devices,
    (select count(*)::int from attachments) as attachments,
    (select count(*)::int from notifications where created_at > now() - interval '1 day') as notifs_1d`);
  const db = await one(sql<Row[]>`select pg_database_size(current_database())::bigint as bytes, version() as version`);
  // Inscriptions et messages des 14 derniers jours (courbes de l'onglet)
  const days = await sql<Row[]>`
    select d::date::text as day,
      (select count(*)::int from users where role = 'user' and created_at::date = d::date) as signups,
      (select count(*)::int from messages where created_at::date = d::date) as messages,
      (select count(*)::int from checkins where deleted_at is null and created_at::date = d::date) as checkins
    from generate_series(current_date - 13, current_date, interval '1 day') d order by d`.catch(() => []);
  const media = await dirSize(env.MEDIA_DIR);

  return {
    server: {
      version: SERVER_VERSION, node: process.version, platform: `${os.type()} ${os.release()} (${os.arch()})`,
      startedAt: new Date(startedAt).toISOString(), uptimeSec: Math.round(process.uptime()),
      cpus: os.cpus().length, load: os.loadavg().map(x => Math.round(x * 100) / 100),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, systemFree: os.freemem(), systemTotal: os.totalmem() }
    },
    traffic: {
      requests: traffic.requests, serverErrors: traffic.errors, clientErrors: traffic.clientErrors,
      avgMs: traffic.requests ? Math.round(traffic.totalMs / traffic.requests * 10) / 10 : 0, lastHour, perMinute
    },
    database: { bytes: Number(db.bytes ?? 0), version: String(db.version ?? '').split(' on ')[0] ?? '' },
    storage: media,
    counts,
    days: days.map(d => ({ day: d.day, signups: d.signups, messages: d.messages, checkins: d.checkins }))
  };
}
