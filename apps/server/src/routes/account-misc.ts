import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppealBody, NotifyBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import { areFriends, isBanned, isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { iso, type Row } from '../lib/mappers.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { currentMaintenance } from '../lib/maintenance.js';
import { env } from '../env.js';

// Signatures de fichiers acceptées : on ne se fie jamais au type annoncé par le client
const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' }
];

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
   * Notification vers une autre personne (défi de groupe, duel, binôme, rappel d'un ami) :
   * uniquement entre amis ou membres d'un même objectif, et jamais si l'un a bloqué l'autre.
   */
  app.post('/v1/notify', { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
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
    await notify(sql, b.to, b.type, b.text, b.goalId ? { goalId: b.goalId, from: u.id } : { from: u.id });
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
    await notifyAdmins(sql, `Nouvelle demande de débannissement de ${u.displayName}.`);
    reply.status(201);
    return { ok: true };
  });

  /** Téléversement d'une image (photo de profil ou story) : 8 Mo max, JPEG, PNG ou WebP. */
  app.post('/v1/media', { preHandler: requireSocial, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu.');
    const buf = await file.toBuffer();
    const kind = MAGIC.find(m => m.test(buf));
    if (!kind) throw badRequest('Format non pris en charge : JPEG, PNG ou WebP uniquement.');
    const dir = path.resolve(env.MEDIA_DIR);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${kind.ext}`;
    await writeFile(path.join(dir, name), buf);
    reply.status(201);
    return { url: `${env.PUBLIC_URL}/media/${name}` };
  });
}
