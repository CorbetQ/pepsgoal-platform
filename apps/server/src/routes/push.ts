import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { me, requireUser } from '../lib/guards.js';
import { pushToUser, vapidKeys } from '../lib/push.js';

const SubscriptionBody = z.object({
  // Adresse du service push du navigateur (FCM, Mozilla, Apple, Microsoft) : toujours en HTTPS
  endpoint: z.string().url().max(1000).refine(u => u.startsWith('https://'), 'Adresse de notification invalide.'),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  tz: z.string().max(64).default('Europe/Paris')
});

/** Notifications push : un abonnement par navigateur (Paramètres › Rappels et notifications). */
export default async function pushRoutes(app: FastifyInstance) {
  app.get('/v1/push/key', async () => ({ publicKey: (await vapidKeys()).publicKey }));

  app.post('/v1/push/subscriptions', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = SubscriptionBody.parse(req.body);
    let tz = b.tz;
    try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); } catch { tz = 'Europe/Paris'; }
    // Un navigateur ne reçoit que les notifications du compte connecté en dernier
    await sql`insert into push_subscriptions (user_id, endpoint, p256dh, auth, tz) values (${me(req).id}, ${b.endpoint}, ${b.keys.p256dh}, ${b.keys.auth}, ${tz})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz`;
    reply.status(201);
    return { ok: true };
  });

  app.delete('/v1/push/subscriptions', { preHandler: requireUser }, async req => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
    await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${me(req).id}`;
    return { ok: true };
  });

  /** Notification d'essai sur tous les navigateurs abonnés du compte. */
  app.post('/v1/push/test', { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async req => {
    const sent = await pushToUser(me(req).id, { title: 'PepsGoal', body: 'Les notifications fonctionnent sur cet appareil 🔥', tag: 'test' });
    return { sent };
  });
}
