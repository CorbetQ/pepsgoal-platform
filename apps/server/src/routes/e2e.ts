import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { E2EDeviceBody, E2EKeyUpload, E2EVaultBody, E2EVaultKeysBody, Id } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { areFriends, isBlocked, me, requireUser } from '../lib/guards.js';
import { iso, type Row } from '../lib/mappers.js';

/** Appareils conservés par compte : au-delà, les plus anciens (inactifs) sont retirés. */
const MAX_DEVICES = 10;
const pair = (a: string, b: string) => (a < b ? [a, b] as const : [b, a] as const);
const DeviceQuery = z.object({ deviceId: Id });

/**
 * Échange des clés du chiffrement de bout en bout (docs/E2E.md).
 * Le serveur ne voit que des clés publiques et des enveloppes chiffrées : il relaie, il ne peut rien déchiffrer.
 */
export default async function e2eRoutes(app: FastifyInstance) {
  async function myDevice(userId: string, deviceId: string) {
    const [d] = await sql<Row[]>`update e2e_devices set last_seen_at = now() where id = ${deviceId} and user_id = ${userId} returning id`;
    if (!d) throw notFound('Appareil inconnu : reconnecte-toi.');
  }
  async function friendOrThrow(userId: string, peerId: string) {
    if (userId === peerId || !(await areFriends(userId, peerId)) || (await isBlocked(userId, peerId))) throw forbidden('Vous devez être amis pour échanger des messages.');
  }

  /** Enregistre la clé publique d'un nouvel appareil (à la connexion). */
  app.post('/v1/e2e/devices', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { publicKey } = E2EDeviceBody.parse(req.body);
    const u = me(req);
    const [d] = await sql<Row[]>`insert into e2e_devices (user_id, public_key) values (${u.id}, ${publicKey}) returning id`;
    await sql`delete from e2e_devices where user_id = ${u.id} and id not in (
      select id from e2e_devices where user_id = ${u.id} order by last_seen_at desc limit ${MAX_DEVICES})`;
    reply.status(201);
    return { deviceId: d!.id };
  });

  /**
   * Coffre de clés : copie des clés de conversation du compte, chiffrées sur l'appareil avec une clé dérivée du mot de passe.
   * Le serveur ne stocke ni cette clé ni le moyen de la recalculer (le sel seul ne suffit pas).
   */
  app.get('/v1/e2e/vault', { preHandler: requireUser }, async req => {
    const u = me(req);
    const [v] = await sql<Row[]>`select salt, iterations, "check", updated_at from e2e_vaults where user_id = ${u.id}`;
    if (!v) return { vault: null, keys: [] };
    const keys = await sql<Row[]>`select key_id, nonce, box from e2e_vault_keys where user_id = ${u.id} order by created_at`;
    return { vault: { salt: v.salt, iterations: v.iterations, check: v.check, updatedAt: iso(v.updated_at) }, keys: keys.map(k => ({ keyId: k.key_id, nonce: k.nonce, box: k.box })) };
  });

  /** Création du coffre, ou remplacement complet après un changement de mot de passe (toutes les clés rechiffrées). */
  app.put('/v1/e2e/vault', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async req => {
    const b = E2EVaultBody.parse(req.body);
    const u = me(req);
    await sql.begin(async tx => {
      await tx`insert into e2e_vaults (user_id, salt, iterations, "check") values (${u.id}, ${b.salt}, ${b.iterations}, ${b.check})
        on conflict (user_id) do update set salt = excluded.salt, iterations = excluded.iterations, "check" = excluded."check", updated_at = now()`;
      if (b.keys) {
        await tx`delete from e2e_vault_keys where user_id = ${u.id}`;
        for (const k of b.keys) await tx`insert into e2e_vault_keys (user_id, key_id, nonce, box) values (${u.id}, ${k.keyId}, ${k.nonce}, ${k.box}) on conflict do nothing`;
      }
    });
    return { ok: true };
  });

  /** Ajout de clés au coffre (nouvelle conversation, nouvelle version de clé de groupe). */
  app.post('/v1/e2e/vault/keys', { preHandler: requireUser, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => {
    const { keys } = E2EVaultKeysBody.parse(req.body);
    const u = me(req);
    const [v] = await sql`select 1 from e2e_vaults where user_id = ${u.id}`;
    if (!v) throw notFound('Coffre de clés absent.');
    for (const k of keys) await sql`insert into e2e_vault_keys (user_id, key_id, nonce, box) values (${u.id}, ${k.keyId}, ${k.nonce}, ${k.box}) on conflict do nothing`;
    return { ok: true, count: keys.length };
  });

  /** Déconnexion : l'appareil oublie sa clé, le serveur oublie l'appareil et ses enveloppes. */
  app.delete('/v1/e2e/devices/:id', { preHandler: requireUser }, async req => {
    const { id } = z.object({ id: Id }).parse(req.params);
    await sql`delete from e2e_devices where id = ${id} and user_id = ${me(req).id}`;
    return { ok: true };
  });

  /** État des clés d'une conversation pour cet appareil : appareils des deux amis, versions de clé, enveloppes manquantes. */
  app.get('/v1/e2e/peers/:id', { preHandler: requireUser }, async req => {
    const { id: peerId } = z.object({ id: Id }).parse(req.params);
    const { deviceId } = DeviceQuery.parse(req.query);
    const u = me(req);
    await myDevice(u.id, deviceId);
    await friendOrThrow(u.id, peerId);
    const [a, b] = pair(u.id, peerId);
    const devices = await sql<Row[]>`select id, user_id, public_key from e2e_devices where user_id in (${u.id}, ${peerId}) order by created_at`;
    const keys = await sql<Row[]>`
      select k.key_id, k.created_by, k.created_at, e.nonce, e.box, e.sender_public_key,
        coalesce((select array_agg(d.id) from e2e_devices d where d.user_id in (${u.id}, ${peerId})
          and not exists (select 1 from e2e_envelopes x where x.key_id = k.key_id and x.device_id = d.id)), '{}') as missing
      from e2e_pair_keys k
      left join e2e_envelopes e on e.key_id = k.key_id and e.device_id = ${deviceId}
      where k.user_a = ${a} and k.user_b = ${b}
      order by k.created_at desc limit 20`;
    return {
      devices: devices.map(d => ({ id: d.id, userId: d.user_id, publicKey: d.public_key })),
      keys: keys.map(k => ({
        keyId: k.key_id, createdBy: k.created_by, createdAt: iso(k.created_at), missingDevices: k.missing as string[],
        envelope: k.box ? { nonce: k.nonce, box: k.box, senderPublicKey: k.sender_public_key } : null
      }))
    };
  });

  /**
   * Crée une version de clé pour la paire (si elle n'existe pas) et dépose des enveloppes.
   * Sert aussi à « re-chiffrer » une clé existante pour un appareil arrivé depuis (nouvel appareil, reconnexion).
   */
  app.post('/v1/e2e/peers/:id/keys', { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: peerId } = z.object({ id: Id }).parse(req.params);
    const { keyId, envelopes } = E2EKeyUpload.parse(req.body);
    const u = me(req);
    await friendOrThrow(u.id, peerId);
    const [a, b] = pair(u.id, peerId);
    const devices = await sql<Row[]>`select id, user_id, public_key from e2e_devices where user_id in (${u.id}, ${peerId})`;
    const byId = new Map(devices.map(d => [d.id as string, d]));
    for (const e of envelopes) {
      if (!byId.has(e.deviceId)) throw badRequest('Appareil destinataire inconnu.');
      if (byId.get(e.senderDeviceId)?.user_id !== u.id) throw forbidden('L’appareil expéditeur doit être le tien.');
    }
    let created = false;
    await sql.begin(async tx => {
      const [k] = await tx<Row[]>`select user_a, user_b from e2e_pair_keys where key_id = ${keyId}`;
      if (k && (k.user_a !== a || k.user_b !== b)) throw forbidden('Cette clé appartient à une autre conversation.');
      if (!k) { await tx`insert into e2e_pair_keys (key_id, user_a, user_b, created_by) values (${keyId}, ${a}, ${b}, ${u.id})`; created = true; }
      for (const e of envelopes) {
        await tx`insert into e2e_envelopes (key_id, device_id, sender_public_key, nonce, box)
          values (${keyId}, ${e.deviceId}, ${byId.get(e.senderDeviceId)!.public_key}, ${e.nonce}, ${e.box})
          on conflict (key_id, device_id) do nothing`;
      }
    });
    reply.status(created ? 201 : 200);
    return { ok: true, created };
  });

  /**
   * Clés que cet appareil détient et qu'un autre appareil (le mien ou celui d'un ami) n'a pas encore :
   * l'app les re-chiffre en arrière-plan après chaque synchronisation.
   */
  app.get('/v1/e2e/pending', { preHandler: requireUser }, async req => {
    const { deviceId } = DeviceQuery.parse(req.query);
    const u = me(req);
    await myDevice(u.id, deviceId);
    const rows = await sql<Row[]>`
      select k.key_id, case when k.user_a = ${u.id} then k.user_b else k.user_a end as peer_id,
        e.nonce, e.box, e.sender_public_key,
        array_agg(json_build_object('id', d.id, 'publicKey', d.public_key)) as missing
      from e2e_pair_keys k
      join e2e_envelopes e on e.key_id = k.key_id and e.device_id = ${deviceId}
      join e2e_devices d on d.user_id in (k.user_a, k.user_b)
        and not exists (select 1 from e2e_envelopes x where x.key_id = k.key_id and x.device_id = d.id)
      where (k.user_a = ${u.id} or k.user_b = ${u.id})
      group by k.key_id, k.user_a, k.user_b, e.nonce, e.box, e.sender_public_key
      limit 50`;
    // Groupes : appareils des membres actuels qui n'ont pas encore la clé (nouveau membre, nouvel appareil)
    const groups = await sql<Row[]>`
      select k.key_id, k.group_id, e.nonce, e.box, e.sender_public_key,
        array_agg(json_build_object('id', d.id, 'publicKey', d.public_key)) as missing
      from e2e_pair_keys k
      join chat_group_members me on me.group_id = k.group_id and me.user_id = ${u.id}
      join e2e_envelopes e on e.key_id = k.key_id and e.device_id = ${deviceId}
      join chat_group_members m on m.group_id = k.group_id
      join e2e_devices d on d.user_id = m.user_id
        and not exists (select 1 from e2e_envelopes x where x.key_id = k.key_id and x.device_id = d.id)
      where k.group_id is not null
      group by k.key_id, k.group_id, e.nonce, e.box, e.sender_public_key
      limit 50`;
    return [
      ...rows.map(r => ({ keyId: r.key_id, peerId: r.peer_id, groupId: null, envelope: { nonce: r.nonce, box: r.box, senderPublicKey: r.sender_public_key }, missingDevices: r.missing as { id: string; publicKey: string }[] })),
      ...groups.map(r => ({ keyId: r.key_id, peerId: null, groupId: r.group_id, envelope: { nonce: r.nonce, box: r.box, senderPublicKey: r.sender_public_key }, missingDevices: r.missing as { id: string; publicKey: string }[] }))
    ];
  });
}
