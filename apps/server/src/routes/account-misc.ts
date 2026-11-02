import type { FastifyInstance } from 'fastify';
import { AppealBody, NotifyBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { areFriends, isBanned, isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { iso, type Row } from '../lib/mappers.js';
import { storeImage } from '../lib/media.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { currentMaintenance } from '../lib/maintenance.js';
import { env } from '../env.js';

export default async function miscRoutes(app: FastifyInstance) {
  /** Statut public : l'application l'interroge pour savoir si le serveur est joignable et s'il y a une maintenance. */
  app.get('/v1/status', async () => {
    const m = await currentMaintenance();
    return { ok: true, serverTime: new Date().toISOString(), maintenance: m ? { mode: m.mode, endsAt: iso(m.endsAt), message: m.message } : null, minAppVersion: env.MIN_APP_VERSION };
  });

  app.get('/v1/notifications', { preHandler: requireUser }, async req => {
    const rows = await sql<Row[]>`select id, type, text, data, created_at, read_at from notifications where user_id = ${me(req).id} order by created_at desc limit 100`;
    return rows.map(n => ({ id: n.id, type: n.type, text: n.text, data: n.data, createdAt: iso(n.created_at), read: !!n.read_at }));
  });

  app.post('/v1/notifications/read-all', { preHandler: requireUser }, async req => {
    await sql`update notifications set read_at = now() where user_id = ${me(req).id} and read_at is null`;
    return { ok: true };
  });

  /**
   * Notification vers une autre personne (défi de groupe, duel, binôme, rappel d'un ami) : action sociale, refusée
   * à un compte banni et pendant une maintenance ; uniquement entre amis ou membres d'un même objectif, jamais si
   * l'un a bloqué l'autre. L'objectif cité doit être partagé entre les deux comptes.
   */
  app.post('/v1/notify', { preHandler: requireSocial, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = NotifyBody.parse(req.body);
    const u = me(req);
    if (b.to === u.id) return { ok: true };
    const [shared] = await sql`
      select 1 from goals g where g.deleted_at is null and (
        (g.owner_id = ${u.id} and (g.buddy_id = ${b.to} or exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${b.to})))
        or (g.owner_id = ${b.to} and (g.buddy_id = ${u.id} or exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${u.id})))
        or (exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${u.id}) and exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${b.to}))
      ) limit 1`;
    if ((!shared && !(await areFriends(u.id, b.to))) || (await isBlocked(u.id, b.to))) throw forbidden('Notification impossible vers ce compte.');
    const [target] = await sql`select 1 from users where id = ${b.to} and deleted_at is null and role <> 'official'`;
    if (!target) throw forbidden('Notification impossible vers ce compte.');
    const goalId = b.goalId && (await sql`select 1 from goals g where g.id = ${b.goalId} and g.deleted_at is null
      and ${u.id} in (select g.owner_id union select g.buddy_id union select user_id from goal_members where goal_id = g.id)
      and ${b.to} in (select g.owner_id union select g.buddy_id union select user_id from goal_members where goal_id = g.id)`).length ? b.goalId : null;
    // Texte sans caractères de contrôle ni retours à la ligne en série
    const text = b.text.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').replace(/\n{3,}/g, '\n\n');
    await notify(sql, b.to, b.type, text, goalId ? { goalId, from: u.id } : { from: u.id });
    reply.status(201);
    return { ok: true };
  });

  /** Demande de débannissement (une seule en attente à la fois). */
  app.post('/v1/appeals', { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { text } = AppealBody.parse(req.body);
    const u = me(req);
    if (!isBanned(u)) throw forbidden("Ton compte n'est pas suspendu.");
    const [pending] = await sql`select 1 from appeals where user_id = ${u.id} and status = 'pending'`;
    if (pending) throw conflict('Une demande est déjà en cours d’examen.');
    await sql`insert into appeals (user_id, text) values (${u.id}, ${text})`;
    await notifyAdmins(sql, `Nouvelle demande de débannissement de ${u.displayName}.`, {
      subject: `Demande de débannissement : ${u.displayName}`,
      details: [['Compte', `${u.displayName} (@${u.username})`], ['Suspension', u.banPermanent ? 'définitive' : u.banUntil ? `jusqu’au ${new Date(u.banUntil).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : '—']],
      excerpt: text
    });
    reply.status(201);
    return { ok: true };
  });

  /**
   * Téléversement d'une image (photo de profil, publication, story) : 8 Mo max, JPEG, PNG ou WebP. L'image est
   * réencodée (métadonnées supprimées), comptée dans le quota du compte, et effacée si elle n'est jamais utilisée.
   */
  app.post('/v1/media', { preHandler: requireSocial, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu.');
    const url = await storeImage(me(req).id, await file.toBuffer());
    reply.status(201);
    return { url };
  });
}
