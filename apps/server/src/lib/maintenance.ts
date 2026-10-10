import { sql } from '../db/client.js';

export interface Maintenance {
  id: string;
  mode: 'social' | 'full';
  startsAt: Date;
  endsAt: Date | null;
  message: string;
}

let cache: { at: number; value: Maintenance | null } | null = null;

/** Maintenance en cours (mise en cache 15 s pour ne pas interroger la base à chaque requête). */
export async function currentMaintenance(): Promise<Maintenance | null> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const [m] = await sql<Maintenance[]>`
    select id, mode, starts_at as "startsAt", ends_at as "endsAt", message from maintenance
    where ended_at is null and starts_at <= now() and (ends_at is null or ends_at > now())
    order by starts_at desc limit 1`;
  cache = { at: Date.now(), value: m ?? null };
  return cache.value;
}

export function invalidateMaintenanceCache(): void {
  cache = null;
}
