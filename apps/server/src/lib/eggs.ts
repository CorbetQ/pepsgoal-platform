import { sql } from '../db/client.js';
import type { Row } from './mappers.js';
import { officialMessage } from './notify.js';
import { localNow } from './push.js';

/**
 * Poisson d'avril : le 1er avril (heure de Paris), PepsGoal Officiel envoie « test cedric » à chaque compte, une seule fois.
 * Appelé avec les rappels (toutes les 5 minutes) : les inscrits de la journée le reçoivent aussi.
 */
export async function aprilFools(): Promise<number> {
  const { day } = localNow('Europe/Paris');
  if (!day.endsWith('-04-01')) return 0;
  const users = await sql<Row[]>`
    select id from users u where role = 'user' and deleted_at is null
      and not exists (select 1 from reminder_pushes r where r.user_id = u.id and r.day = ${day} and r.kind = 'april')`;
  let sent = 0;
  for (const u of users) {
    const fresh = await sql`insert into reminder_pushes (user_id, day, kind) values (${u.id}, ${day}, 'april') on conflict do nothing returning kind`;
    if (fresh.length) { await officialMessage(sql, u.id, 'test cedric', 'info'); sent++; }
  }
  return sent;
}
