import webpush from 'web-push';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import type { Row } from './mappers.js';

/**
 * Notifications push (Web Push, standard des navigateurs : Chrome, Edge, Firefox, Safari).
 * Les clés VAPID viennent de l'environnement (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) ou sont générées au premier
 * démarrage et gardées en base : rien à configurer. Le contenu d'une notification ne contient jamais de message privé.
 */
let keys: { publicKey: string; privateKey: string } | null = null;

export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (keys) return keys;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) keys = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  else {
    const rows = await sql<Row[]>`select key, value from app_settings where key in ('vapid_public', 'vapid_private')`;
    const get = (k: string) => rows.find(r => r.key === k)?.value as string | undefined;
    if (get('vapid_public') && get('vapid_private')) keys = { publicKey: get('vapid_public')!, privateKey: get('vapid_private')! };
    else {
      const k = webpush.generateVAPIDKeys();
      await sql`insert into app_settings (key, value) values ('vapid_public', ${k.publicKey}), ('vapid_private', ${k.privateKey}) on conflict (key) do nothing`;
      const again = await sql<Row[]>`select key, value from app_settings where key in ('vapid_public', 'vapid_private')`;
      keys = { publicKey: again.find(r => r.key === 'vapid_public')!.value, privateKey: again.find(r => r.key === 'vapid_private')!.value };
    }
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  return keys;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Regroupe les notifications d'un même sujet (une conversation, les rappels…). */
  tag?: string;
  /** Écran à ouvrir au toucher (vue de l'application). */
  view?: string;
}

/** Envoie la notification à tous les navigateurs abonnés du compte ; les abonnements expirés sont supprimés. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await sql<Row[]>`select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}`;
  if (!subs.length) return 0;
  await vapidKeys();
  const body = JSON.stringify({ title: payload.title.slice(0, 80), body: payload.body.slice(0, 240), tag: payload.tag ?? 'pepsgoal', view: payload.view ?? 'today' });
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 12 * 3600, urgency: 'normal' });
      sent++;
      await sql`update push_subscriptions set last_ok_at = now() where id = ${s.id}`;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sql`delete from push_subscriptions where id = ${s.id}`;
      else console.warn('[push] envoi impossible :', status ?? (e instanceof Error ? e.message : e));
    }
  }));
  return sent;
}

/** Envoi différé, sans jamais bloquer ni faire échouer la requête en cours. */
export function pushLater(userId: string, payload: PushPayload): void {
  setImmediate(() => { pushToUser(userId, payload).catch(err => console.warn('[push]', err)); });
}

/* ---------- rappels du matin et du soir, envoyés par le serveur (l'application peut être fermée) ---------- */
export function localNow(tz: string): { day: string; hm: string } {
  try {
    const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const v = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return { day: `${v('year')}-${v('month')}-${v('day')}`, hm: `${v('hour')}:${v('minute')}` };
  } catch { return localNow('Europe/Paris'); }
}
const addMinutes = (hm: string, n: number) => { const [h, m] = hm.split(':').map(Number); const t = Math.min(23 * 60 + 59, h! * 60 + m! + n); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export async function sendReminders(): Promise<void> {
  const users = await sql<Row[]>`
    select u.id, u.settings, (select tz from push_subscriptions p where p.user_id = u.id order by p.created_at desc limit 1) as tz
    from users u where u.deleted_at is null and exists (select 1 from push_subscriptions p where p.user_id = u.id)`;
  for (const u of users) {
    const s = u.settings ?? {}, { day, hm } = localNow(u.tz || 'Europe/Paris');
    for (const kind of ['morning', 'evening'] as const) {
      const r = s[kind];
      // Fenêtre de deux heures après l'heure choisie (pas de rappel tardif après une interruption)
      if (!r?.on || !r.time || hm < r.time || hm > addMinutes(r.time, 120)) continue;
      const goals = await sql<Row[]>`select type from goals where owner_id = ${u.id} and deleted_at is null and not archived and completed_at is null and failed_at is null`;
      if (!goals.length) continue;
      let body: string;
      if (kind === 'morning') body = `Ton programme du jour t’attend : ${goals.length} objectif${goals.length > 1 ? 's' : ''} en cours. Allume ta flamme 🔥`;
      else {
        const [c] = await sql<{ n: number }[]>`select count(*)::int as n from checkins where user_id = ${u.id} and date = ${day} and deleted_at is null`;
        if ((c?.n ?? 0) > 0) continue;   // déjà validé aujourd'hui : pas de rappel du soir
        body = 'Tu n’as encore rien validé aujourd’hui : il est encore temps de garder ta série 🔥';
      }
      const fresh = await sql`insert into reminder_pushes (user_id, day, kind) values (${u.id}, ${day}, ${kind}) on conflict do nothing returning kind`;
      if (fresh.length) await pushToUser(u.id, { title: kind === 'morning' ? 'Rappel du matin' : 'Rappel du soir', body, tag: 'reminder', view: 'today' });
    }
  }
  await sql`delete from reminder_pushes where created_at < now() - interval '3 days'`;
}
