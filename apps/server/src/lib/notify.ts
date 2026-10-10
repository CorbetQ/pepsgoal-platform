import type postgres from 'postgres';
import { sql as rootSql } from '../db/client.js';

type Q = postgres.Sql | postgres.TransactionSql;
type Json = postgres.JSONValue;

export async function notify(q: Q, userId: string, type: string, text: string, data: Record<string, Json> = {}): Promise<void> {
  await q`insert into notifications (user_id, type, text, data) values (${userId}, ${type}, ${text.slice(0, 300)}, ${q.json(data)})`;
}

let officialIdCache: string | null = null;
export async function officialId(q: Q = rootSql): Promise<string | null> {
  if (officialIdCache) return officialIdCache;
  const [r] = await q<{ id: string }[]>`select id from users where role = 'official' and deleted_at is null limit 1`;
  officialIdCache = r?.id ?? null;
  return officialIdCache;
}

/** Message envoyé au nom du compte « PepsGoal Officiel » (nouveautés, modération). */
export async function officialMessage(q: Q, toUserId: string, text: string, tag: 'news' | 'mod' | 'info', auto = false): Promise<void> {
  const from = await officialId(q);
  if (!from) return;
  await q`insert into messages (sender_id, recipient_id, text, official, tag, auto) values (${from}, ${toUserId}, ${text.slice(0, 600)}, true, ${tag}, ${auto})`;
}

/** Décision de modération : notification + message officiel automatique. */
export async function modNotify(q: Q, userId: string, text: string): Promise<void> {
  await notify(q, userId, 'mod', text);
  await officialMessage(q, userId, text, 'mod', true);
}

export async function notifyAdmins(q: Q, text: string): Promise<void> {
  await q`insert into notifications (user_id, type, text) select id, 'mod', ${text} from users where role = 'admin' and deleted_at is null`;
}

export async function logMod(q: Q, adminId: string | null, action: string, targetUserId: string | null, detail = ''): Promise<void> {
  await q`insert into mod_actions (admin_id, action, target_user_id, detail) values (${adminId}, ${action}, ${targetUserId}, ${detail.slice(0, 200)})`;
}
