import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { E2EKeyUpload, GroupCreateBody, GroupMembersBody, GroupPatchBody, Id, MessageBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, conflict, forbidden, notFound, unknownDevice } from '../lib/errors.js';
import { attachmentPath, ensureAttachmentDir } from '../lib/files.js';
import { areFriends, isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { iso, toPublicUser, type Row } from '../lib/mappers.js';
import { notify } from '../lib/notify.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
const MAX_MEMBERS = 31;
/** Taille maximale d'une pièce jointe chiffrée (photo compressée ou message vocal de 2 minutes). */
const ATTACHMENT_MAX = 6 * 1024 * 1024;

/** Le compte fait partie du groupe (sinon 404 : on ne révèle pas l'existence du groupe). */
async function groupOf(groupId: string, userId: string): Promise<Row> {
  const [g] = await sql<Row[]>`select g.* from chat_groups g join chat_group_members m on m.group_id = g.id and m.user_id = ${userId} where g.id = ${groupId}`;
  if (!g) throw notFound('Groupe introuvable.');
  return g;
}

/** Les pièces jointes citées par un message doivent appartenir à son expéditeur. */
async function checkAttachments(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from attachments where id = any(${ids}) and owner_id = ${userId}`;
  if ((r?.n ?? 0) !== new Set(ids).size) throw badRequest('Pièce jointe inconnue.');
}

/**
 * Groupes de discussion (chiffrés de bout en bout, une clé par groupe) et pièces jointes chiffrées des messages.
 * Le serveur ne voit ni le contenu des messages ni celui des fichiers : uniquement qui écrit à quel groupe, et quand.
 */
export default async function groupRoutes(app: FastifyInstance) {
  /* ---------------- pièces jointes ---------------- */

  /** Fichier chiffré sur l'appareil (photo ou message vocal) : stocké tel quel, jamais servi publiquement. */
  app.post('/v1/attachments', { preHandler: requireSocial, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu.');
    const buf = await file.toBuffer();
    if (!buf.length || buf.length > ATTACHMENT_MAX) throw badRequest('Fichier trop volumineux (6 Mo maximum).');
    const u = me(req);
    const [a] = await sql<Row[]>`insert into attachments (owner_id, size) values (${u.id}, ${buf.length}) returning id`;
    await ensureAttachmentDir();
    await writeFile(attachmentPath(a!.id), buf);
    reply.status(201);
    return { id: a!.id, size: buf.length };
  });

  /** Téléchargement réservé à l'expéditeur et aux participants de la conversation qui cite la pièce jointe. */
  app.get('/v1/attachments/:id', { preHandler: requireUser }, async (req, reply) => {
    const { id } = params(req.params);
    const u = me(req);
    const [ok] = await sql`select 1 from attachments a where a.id = ${id} and (a.owner_id = ${u.id} or exists (
      select 1 from messages m where ${id} = any(m.attachments) and (m.recipient_id = ${u.id} or m.sender_id = ${u.id}
        or (m.group_id is not null and exists (select 1 from chat_group_members gm where gm.group_id = m.group_id and gm.user_id = ${u.id})))))`;
    if (!ok) throw notFound('Pièce jointe introuvable.');
    const file = attachmentPath(id);
    const st = await stat(file).catch(() => null);
    if (!st) throw notFound('Pièce jointe introuvable.');
    reply.header('Content-Type', 'application/octet-stream').header('Content-Length', st.size).header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(file));
  });

  /* ---------------- groupes ---------------- */

  app.get('/v1/groups', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      select g.id, g.name, g.emoji, g.owner_id, g.created_at, me.last_read_at,
        (select coalesce(json_agg(json_build_object('id', x.id, 'username', x.username, 'display_name', x.display_name, 'avatar', x.avatar, 'role', x.role) order by m.joined_at), '[]')
           from chat_group_members m join users x on x.id = m.user_id where m.group_id = g.id and x.deleted_at is null) as members,
        (select json_build_object('senderId', m.sender_id, 'e2e', m.e2e, 'createdAt', m.created_at) from messages m where m.group_id = g.id order by m.created_at desc limit 1) as last,
        (select count(*)::int from messages m where m.group_id = g.id and m.created_at > me.last_read_at and m.sender_id <> ${u.id}
           and not exists (select 1 from blocks b where b.blocker_id = ${u.id} and b.blocked_id = m.sender_id)) as unread
      from chat_groups g join chat_group_members me on me.group_id = g.id and me.user_id = ${u.id}
      order by coalesce((select max(created_at) from messages m where m.group_id = g.id), g.created_at) desc`;
    return rows.map(g => ({
      id: g.id, name: g.name, emoji: g.emoji, ownerId: g.owner_id, createdAt: iso(g.created_at), unread: g.unread,
      members: (g.members as Row[]).map(toPublicUser),
      last: g.last ? { senderId: g.last.senderId, e2e: g.last.e2e, createdAt: iso(new Date(g.last.createdAt)) } : null
    }));
  });

  /** Création : les membres doivent être des amis du créateur (et aucun blocage entre eux). */
  app.post('/v1/groups', { preHandler: requireSocial, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = GroupCreateBody.parse(req.body);
    const u = me(req);
    const ids = [...new Set(body.members.filter(id => id !== u.id))];
    if (!ids.length) throw badRequest('Ajoute au moins un ami.');
    for (const id of ids) if (!(await areFriends(u.id, id)) || (await isBlocked(u.id, id))) throw forbidden('Tu ne peux ajouter que tes amis.');
    const g = await sql.begin(async tx => {
      const [g] = await tx<Row[]>`insert into chat_groups (name, emoji, owner_id) values (${body.name}, ${body.emoji}, ${u.id}) returning id, created_at`;
      for (const id of [u.id, ...ids]) await tx`insert into chat_group_members (group_id, user_id) values (${g!.id}, ${id})`;
      for (const id of ids) await notify(tx, id, 'group', `${u.displayName} t’a ajouté au groupe « ${body.name} ».`, { groupId: g!.id });
      return g!;
    });
    reply.status(201);
    return { id: g.id, createdAt: iso(g.created_at) };
  });

  /** Renommer le groupe ou changer son émoji : créateur uniquement. */
  app.patch('/v1/groups/:id', { preHandler: requireSocial }, async req => {
    const { id } = params(req.params);
    const body = GroupPatchBody.parse(req.body);
    const u = me(req);
    const g = await groupOf(id, u.id);
    if (g.owner_id !== u.id) throw forbidden('Seul le créateur du groupe peut le modifier.');
    await sql`update chat_groups set name = ${body.name ?? g.name}, emoji = ${body.emoji ?? g.emoji} where id = ${id}`;
    return { ok: true };
  });

  /** Supprimer le groupe et tous ses messages : créateur uniquement. */
  app.delete('/v1/groups/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    const g = await groupOf(id, u.id);
    if (g.owner_id !== u.id) throw forbidden('Seul le créateur du groupe peut le supprimer.');
    await sql`delete from chat_groups where id = ${id}`;
    return { ok: true };
  });

  /** Ajouter des amis au groupe : créateur uniquement. Ils reçoivent la clé actuelle via les enveloppes en attente. */
  app.post('/v1/groups/:id/members', { preHandler: requireSocial }, async req => {
    const { id } = params(req.params);
    const { userIds } = GroupMembersBody.parse(req.body);
    const u = me(req);
    const g = await groupOf(id, u.id);
    if (g.owner_id !== u.id) throw forbidden('Seul le créateur du groupe peut ajouter des membres.');
    const [c] = await sql<{ n: number }[]>`select count(*)::int as n from chat_group_members where group_id = ${id}`;
    if ((c?.n ?? 0) + userIds.length > MAX_MEMBERS) throw conflict(`Un groupe compte au plus ${MAX_MEMBERS} membres.`);
    for (const x of userIds) if (!(await areFriends(u.id, x)) || (await isBlocked(u.id, x))) throw forbidden('Tu ne peux ajouter que tes amis.');
    await sql.begin(async tx => {
      for (const x of userIds) {
        const r = await tx`insert into chat_group_members (group_id, user_id) values (${id}, ${x}) on conflict do nothing returning user_id`;
        if (r.length) await notify(tx, x, 'group', `${u.displayName} t’a ajouté au groupe « ${g.name} ».`, { groupId: id });
      }
    });
    return { ok: true };
  });

  /**
   * Retirer un membre (créateur) ou quitter le groupe (soi-même).
   * Les messages suivants utiliseront une nouvelle version de clé, que l'ancien membre ne reçoit pas.
   */
  app.delete('/v1/groups/:id/members/:userId', { preHandler: requireUser }, async req => {
    const { id, userId } = z.object({ id: Id, userId: Id }).parse(req.params);
    const u = me(req);
    const g = await groupOf(id, u.id);
    if (userId !== u.id && g.owner_id !== u.id) throw forbidden('Seul le créateur du groupe peut retirer un membre.');
    await sql.begin(async tx => {
      await tx`delete from chat_group_members where group_id = ${id} and user_id = ${userId}`;
      await tx`delete from e2e_envelopes where key_id in (select key_id from e2e_pair_keys where group_id = ${id})
        and device_id in (select d.id from e2e_devices d where d.user_id = ${userId})`;
      const left = await tx<Row[]>`select user_id from chat_group_members where group_id = ${id} order by joined_at`;
      if (!left.length) { await tx`delete from chat_groups where id = ${id}`; return; }
      // Le créateur s'en va : le membre le plus ancien reprend le groupe
      const owner = g.owner_id === userId ? left[0]!.user_id : g.owner_id;
      await tx`update chat_groups set members_changed_at = now(), owner_id = ${owner} where id = ${id}`;
      if (userId !== u.id) await notify(tx, userId, 'group', `Tu as été retiré du groupe « ${g.name} ».`, { groupId: id });
    });
    return { ok: true };
  });

  /** Messages du groupe (50 par page) ; ceux des comptes que j'ai bloqués sont masqués. Marque le groupe comme lu. */
  app.get('/v1/groups/:id/messages', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const { before } = z.object({ before: z.string().datetime().optional() }).parse(req.query);
    const u = me(req);
    await groupOf(id, u.id);
    const [mine] = await sql<Row[]>`select last_read_at from chat_group_members where group_id = ${id} and user_id = ${u.id}`;
    const rows = await sql<Row[]>`
      select m.id, m.sender_id, m.e2e, m.attachments, m.created_at from messages m
      where m.group_id = ${id} and m.created_at < ${before ?? new Date(Date.now() + 60_000).toISOString()}
        and not exists (select 1 from blocks b where b.blocker_id = ${u.id} and b.blocked_id = m.sender_id)
      order by m.created_at desc limit 50`;
    await sql`update chat_group_members set last_read_at = now() where group_id = ${id} and user_id = ${u.id}`;
    const readAt = mine ? new Date(mine.last_read_at) : new Date(0);
    return rows.reverse().map(m => ({ id: m.id, senderId: m.sender_id, mine: m.sender_id === u.id, read: new Date(m.created_at) <= readAt, e2e: m.e2e, attachments: m.attachments, createdAt: iso(m.created_at) }));
  });

  app.post('/v1/groups/:id/messages', { preHandler: requireSocial, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const { e2e, attachments } = MessageBody.parse(req.body);
    const u = me(req);
    const g = await groupOf(id, u.id);
    // La clé doit appartenir au groupe et être postérieure au dernier départ d'un membre
    const [k] = await sql<Row[]>`select created_at from e2e_pair_keys where key_id = ${e2e.keyId} and group_id = ${id}`;
    if (!k) throw forbidden('Clé de chiffrement inconnue pour ce groupe.');
    if (new Date(k.created_at) < new Date(g.members_changed_at)) throw conflict('Un membre a quitté le groupe : une nouvelle clé est nécessaire.', 'key_rotation');
    await checkAttachments(u.id, attachments);
    const [m] = await sql<Row[]>`insert into messages (sender_id, group_id, e2e, attachments) values (${u.id}, ${id}, ${sql.json(e2e)}, ${attachments}) returning id, created_at`;
    await sql`update chat_group_members set last_read_at = now() where group_id = ${id} and user_id = ${u.id}`;
    reply.status(201);
    return { id: m!.id, createdAt: iso(m!.created_at) };
  });

  /* ---------------- clés de groupe (même mécanisme que les paires d'amis, voir e2e.ts) ---------------- */

  app.get('/v1/e2e/groups/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const { deviceId } = z.object({ deviceId: Id }).parse(req.query);
    const u = me(req);
    const g = await groupOf(id, u.id);
    const [d] = await sql`update e2e_devices set last_seen_at = now() where id = ${deviceId} and user_id = ${u.id} returning id`;
    if (!d) throw unknownDevice();
    const devices = await sql<Row[]>`select d.id, d.user_id, d.public_key from e2e_devices d join chat_group_members m on m.user_id = d.user_id and m.group_id = ${id} order by d.created_at`;
    const keys = await sql<Row[]>`
      select k.key_id, k.created_by, k.created_at, e.nonce, e.box, e.sender_public_key,
        coalesce((select array_agg(d.id) from e2e_devices d join chat_group_members m on m.user_id = d.user_id and m.group_id = ${id}
          where not exists (select 1 from e2e_envelopes x where x.key_id = k.key_id and x.device_id = d.id)), '{}') as missing
      from e2e_pair_keys k
      left join e2e_envelopes e on e.key_id = k.key_id and e.device_id = ${deviceId}
      where k.group_id = ${id}
      order by k.created_at desc limit 20`;
    return {
      devices: devices.map(x => ({ id: x.id, userId: x.user_id, publicKey: x.public_key })),
      rotate: !keys.length || new Date(keys[0]!.created_at) < new Date(g.members_changed_at),
      keys: keys.map(k => ({
        keyId: k.key_id, createdBy: k.created_by, createdAt: iso(k.created_at), missingDevices: k.missing as string[],
        envelope: k.box ? { nonce: k.nonce, box: k.box, senderPublicKey: k.sender_public_key } : null
      }))
    };
  });

  app.post('/v1/e2e/groups/:id/keys', { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const { keyId, envelopes } = E2EKeyUpload.parse(req.body);
    const u = me(req);
    await groupOf(id, u.id);
    const devices = await sql<Row[]>`select d.id, d.user_id, d.public_key from e2e_devices d join chat_group_members m on m.user_id = d.user_id and m.group_id = ${id}`;
    const byId = new Map(devices.map(d => [d.id as string, d]));
    for (const e of envelopes) {
      if (!byId.has(e.deviceId)) throw badRequest('Appareil destinataire hors du groupe.');
      if (byId.get(e.senderDeviceId)?.user_id !== u.id) throw unknownDevice();
    }
    let created = false;
    await sql.begin(async tx => {
      const [k] = await tx<Row[]>`select group_id from e2e_pair_keys where key_id = ${keyId}`;
      if (k && k.group_id !== id) throw forbidden('Cette clé appartient à une autre conversation.');
      if (!k) { await tx`insert into e2e_pair_keys (key_id, group_id, created_by) values (${keyId}, ${id}, ${u.id})`; created = true; }
      for (const e of envelopes) {
        await tx`insert into e2e_envelopes (key_id, device_id, sender_public_key, nonce, box)
          values (${keyId}, ${e.deviceId}, ${byId.get(e.senderDeviceId)!.public_key}, ${e.nonce}, ${e.box})
          on conflict (key_id, device_id) do nothing`;
      }
    });
    reply.status(created ? 201 : 200);
    return { ok: true, created };
  });
}
