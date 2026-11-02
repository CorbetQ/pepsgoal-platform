/**
 * Non-régression de l'audit de sécurité de l'API (2 novembre 2026, constats F01 à F16), sur une vraie base PostgreSQL.
 * Lancement : TEST_DATABASE_URL=postgres://…/base_vide npm test -w apps/server (base dédiée : elle est remplie de comptes
 * de test). Sans TEST_DATABASE_URL, ces tests sont ignorés.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB = process.env.TEST_DATABASE_URL;
const PUBLIC = 'http://api.test';
if (DB) {
  Object.assign(process.env, {
    DATABASE_URL: DB, NODE_ENV: 'test', JWT_SECRET: 'j'.repeat(48), PUBLIC_URL: PUBLIC, MEDIA_DIR: mkdtempSync(path.join(tmpdir(), 'pg-media-')),
    MEDIA_QUOTA_MB: '1', DISK_MIN_FREE_MB: '0', UPDATE_SSH_FINGERPRINT: ''
  });
}

describe.skipIf(!DB)('audit de sécurité', () => {
  type App = Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
  let app: App, sql: typeof import('../src/db/client.js')['sql'];
  const UA = { 'user-agent': 'vitest-a' };

  beforeAll(async () => {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = (await import('postgres')).default;
    const c = postgres(DB!, { max: 1, onnotice: () => {} });
    await migrate(drizzle(c), { migrationsFolder: path.resolve(__dirname, '../drizzle') });
    await c.end();
    ({ sql } = await import('../src/db/client.js'));
    app = await (await import('../src/app.js')).buildApp();
  });
  afterAll(async () => { await app?.close(); await sql?.end({ timeout: 2 }); });

  // Une adresse différente par requête : les limites de débit (par IP) ne gênent pas les tests
  let ip = 0;
  const remoteAddress = () => `198.51.100.${(ip = (ip + 1) % 250) + 1}`;
  const call = async (method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = UA) => {
    const r = await app.inject({ method: method as 'GET', url, remoteAddress: remoteAddress(), headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: r.statusCode, body: r.body ? (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() : null, headers: r.headers };
  };
  const register = async () => {
    const username = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const r = await call('POST', '/v1/auth/register', undefined, { username, displayName: 'Test', password: 'motdepasse123', acceptTerms: true });
    expect(r.status).toBe(201);
    return { id: r.body.user.id as string, username, access: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  };
  const befriend = async (a: { id: string; access: string }, b: { id: string; access: string }) => {
    const r = await call('POST', '/v1/friends/requests', a.access, { userId: b.id });
    expect((await call('POST', `/v1/friends/requests/${r.body.id}/accept`, b.access)).status).toBe(200);
  };
  const upload = async (token: string, img: Buffer) => {
    const boundary = 'x' + randomUUID();
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), img, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await app.inject({ method: 'POST', url: '/v1/media', remoteAddress: remoteAddress(), payload, headers: { ...UA, authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
  const jpegWithGps = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#f80' } })
    .withExif({ IFD0: { Make: 'TestCam', Model: 'Secret 3000' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '47/1 28/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 33/1 0/1' } })
    .jpeg().toBuffer();
  const now = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);
  const pushOps = (token: string, ops: object[]) => call('POST', '/v1/sync/push', token, { deviceId: 'd1', ops: ops.map(o => ({ opId: randomUUID(), clientUpdatedAt: now(), action: 'upsert', ...o })) });
  const goalData = (id: string, owner: string, extra: object = {}) => ({ id, ownerId: owner, type: 'routine', title: 'Courir', data: { mode: 'days', days: [1, 3, 5], perWeek: 3 }, createdAt: now(), updatedAt: now(), ...extra });

  it('F01 : un ancien jeton de renouvellement ne rouvre pas de session', async () => {
    const a = await register();
    const t1 = (await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh })).body.refreshToken;
    expect(t1).toBeTruthy();
    // Réponse perdue : reprise acceptée tout de suite, même appareil
    const t2 = await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh });
    expect(t2.status).toBe(200);
    // Autre appareil : refus, et la session est révoquée (le dernier jeton émis ne sert plus)
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh }, { 'user-agent': 'voleur' })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: t2.body.refreshToken })).status).toBe(401);
  });

  it('F01 : reprise refusée après le délai de grâce, et vol détecté si le successeur a servi', async () => {
    const a = await register();
    const t1 = (await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh })).body.refreshToken;
    await sql`update refresh_tokens set revoked_at = now() - interval '10 minutes' where user_id = ${a.id} and revoked_at is not null`;
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: t1 })).status).toBe(401);

    const b = await register();
    const s1 = (await call('POST', '/v1/auth/refresh', undefined, { refreshToken: b.refresh })).body.refreshToken;
    const s2 = (await call('POST', '/v1/auth/refresh', undefined, { refreshToken: s1 })).body.refreshToken;
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: b.refresh })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', undefined, { refreshToken: s2 })).status).toBe(401);
  });

  it('F01 : deux renouvellements simultanés ne créent pas deux sessions actives', async () => {
    const a = await register();
    const rs = await Promise.all([1, 2].map(() => call('POST', '/v1/auth/refresh', undefined, { refreshToken: a.refresh })));
    expect(rs.every(r => r.status === 200)).toBe(true);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from refresh_tokens where user_id = ${a.id} and revoked_at is null`;
    expect(n!.n).toBe(1);
  });

  it('F06 : déconnexion et changement de mot de passe invalident aussitôt le jeton d’accès', async () => {
    const a = await register();
    expect((await call('GET', '/v1/me', a.access)).status).toBe(200);
    await call('POST', '/v1/auth/logout', undefined, { refreshToken: a.refresh });
    expect((await call('GET', '/v1/me', a.access)).status).toBe(401);

    const b = await register();
    const login2 = await call('POST', '/v1/auth/login', undefined, { username: b.username, password: 'motdepasse123' });
    const p = await call('POST', '/v1/auth/password', b.access, { current: 'motdepasse123', next: 'nouveaumotdepasse' });
    expect(p.status).toBe(200);
    expect((await call('GET', '/v1/me', login2.body.accessToken)).status).toBe(401);
    expect((await call('GET', '/v1/me', p.body.accessToken)).status).toBe(200);
  });

  it('F02 et F07 : image réencodée sans métadonnées, servie seulement avec une adresse signée', async () => {
    const a = await register();
    const up = await upload(a.access, await jpegWithGps());
    expect(up.status).toBe(201);
    const url = new URL(up.body.url);
    expect(url.searchParams.get('s')).toBeTruthy();
    const ok = await app.inject({ method: 'GET', url: url.pathname + url.search });
    expect(ok.statusCode).toBe(200);
    const meta = await sharp(ok.rawPayload).metadata();
    expect(meta.exif).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: url.pathname })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${url.pathname}?e=${url.searchParams.get('e')}&s=${'A'.repeat(32)}` })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/media/..%2F..%2Fetc%2Fpasswd?e=1&s=x' })).statusCode).toBe(403);
    // Fichier non image avec une signature JPEG
    const fake = await upload(a.access, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pas une image')]));
    expect(fake.status).toBe(400);
  });

  it('F03 : impossible de rattacher (puis de supprimer) l’image d’un autre compte', async () => {
    const a = await register(), b = await register();
    const up = await upload(a.access, await jpegWithGps());
    const canonical = up.body.url.split('?')[0];
    expect((await call('POST', '/v1/stories', b.access, { kind: 'photo', mediaUrl: canonical })).status).toBe(400);
    expect((await call('PATCH', '/v1/me', b.access, { avatar: { kind: 'photo', color: 0, photoUrl: up.body.url } })).status).toBe(400);
    expect((await call('POST', '/v1/posts', b.access, { text: 'x', photoUrl: canonical, visibility: 'friends' })).status).toBe(400);
    // Le propriétaire peut l'utiliser (adresse signée acceptée, enregistrée sans signature)
    const s = await call('POST', '/v1/stories', a.access, { kind: 'photo', mediaUrl: up.body.url });
    expect(s.status).toBe(201);
    const [row] = await sql<{ media_url: string }[]>`select media_url from stories where id = ${s.body.id}`;
    expect(row!.media_url).toBe(canonical);
  });

  it('F08 : quota de stockage par compte', async () => {
    const a = await register();
    const noise = await sharp(Buffer.from(Array.from({ length: 900 * 900 * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: 900, height: 900, channels: 3 } }).png().toBuffer();
    const r = await upload(a.access, noise);
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('quota');
  });

  it('F04 : un blocage retire l’accès aux objectifs partagés, et la synchronisation le transmet', async () => {
    const a = await register(), b = await register();
    await befriend(a, b);
    const gid = randomUUID();
    expect((await pushOps(a.access, [{ entity: 'goal', id: gid, data: goalData(gid, a.id, { buddyId: b.id, buddyVerify: true }) }])).body.applied).toHaveLength(1);
    const before = await call('GET', '/v1/sync/pull?cursor=0', b.access);
    expect(before.body.goals.map((g: { id: string }) => g.id)).toContain(gid);
    const cid = randomUUID();
    await pushOps(a.access, [{ entity: 'checkin', id: cid, data: { goalId: gid, date: today(), kind: 'done', value: 1, createdAt: now(), updatedAt: now() } }]);

    expect((await call('POST', `/v1/users/${b.id}/block`, a.access)).status).toBe(200);
    const after = await call('GET', `/v1/sync/pull?cursor=${before.body.cursor}`, b.access);
    expect(after.body.goals.map((g: { id: string }) => g.id)).not.toContain(gid);
    expect(after.body.deleted).toContainEqual({ entity: 'goal', id: gid });
    expect((await call('GET', '/v1/sync/pull?cursor=0', b.access)).body.goals.map((g: { id: string }) => g.id)).not.toContain(gid);
    expect((await call('POST', `/v1/checkins/${cid}/confirm`, b.access)).status).toBeGreaterThanOrEqual(403);
  });

  it('F04 : un objectif social devenu personnel retire ses membres', async () => {
    const a = await register(), b = await register();
    await befriend(a, b);
    const gid = randomUUID();
    await pushOps(a.access, [{ entity: 'goal', id: gid, data: goalData(gid, a.id, { type: 'group', data: { target: 10, unit: 'km', endDate: '' }, memberIds: [b.id] }) }]);
    expect((await call('GET', '/v1/sync/pull?cursor=0', b.access)).body.goals.map((g: { id: string }) => g.id)).toContain(gid);
    await pushOps(a.access, [{ entity: 'goal', id: gid, data: goalData(gid, a.id) }]);
    const pull = await call('GET', '/v1/sync/pull?cursor=0', b.access);
    expect(pull.body.goals.map((g: { id: string }) => g.id)).not.toContain(gid);
    expect(pull.body.deleted).toContainEqual({ entity: 'goal', id: gid });
  });

  it('F15 : une validation approuvée puis modifiée attend une nouvelle approbation', async () => {
    const a = await register(), b = await register();
    await befriend(a, b);
    const gid = randomUUID(), cid = randomUUID();
    await pushOps(a.access, [{ entity: 'goal', id: gid, data: goalData(gid, a.id, { buddyId: b.id, buddyVerify: true }) }]);
    const ck = { goalId: gid, date: today(), kind: 'done', value: 1, createdAt: now(), updatedAt: now() };
    await pushOps(a.access, [{ entity: 'checkin', id: cid, data: ck }]);
    expect((await call('POST', `/v1/checkins/${cid}/confirm`, b.access)).status).toBe(200);
    // Renvoi identique : reste approuvée
    await pushOps(a.access, [{ entity: 'checkin', id: cid, data: ck }]);
    expect((await sql<{ pending: boolean }[]>`select pending from checkins where id = ${cid}`)[0]!.pending).toBe(false);
    await pushOps(a.access, [{ entity: 'checkin', id: cid, data: { ...ck, value: 5 } }]);
    expect((await sql<{ pending: boolean }[]>`select pending from checkins where id = ${cid}`)[0]!.pending).toBe(true);
  });

  it('F05 : seules les adresses des services push sont acceptées', async () => {
    const { isAllowedPushEndpoint, isInternalAddress } = await import('../src/lib/egress.js');
    const a = await register();
    const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
    for (const endpoint of ['https://evil.example/x', 'https://169.254.169.254/latest', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x']) {
      expect((await call('POST', '/v1/push/subscriptions', a.access, { endpoint, keys })).status).toBe(400);
    }
    expect((await call('POST', '/v1/push/subscriptions', a.access, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status).toBe(201);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/x')).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) expect(isInternalAddress(ip)).toBe(true);
    for (const ip of ['142.250.74.234', '8.8.8.8', '2a00:1450:4007:80e::200a', '::ffff:8.8.8.8']) expect(isInternalAddress(ip)).toBe(false);
    expect(isInternalAddress('::ffff:7f00:1')).toBe(true);
    // Résolution vers une adresse interne : connexion refusée
    const { safeLookup } = await import('../src/lib/egress.js');
    const err = await new Promise(r => safeLookup('localhost', {}, e => r(e)));
    expect(err).toMatchObject({ code: 'EADDRNOTALLOWED' });
  });

  it('F09 : un compte banni ne peut plus envoyer de notification', async () => {
    const a = await register(), b = await register();
    await befriend(a, b);
    expect((await call('POST', '/v1/notify', a.access, { to: b.id, text: 'Allez !' })).status).toBe(201);
    await sql`update users set ban_permanent = true where id = ${a.id}`;
    expect((await call('POST', '/v1/notify', a.access, { to: b.id, text: 'Allez !' })).status).toBe(403);
  });

  it('F10 : sans empreinte de clé d’hôte, la mise à jour SSH est refusée avant toute connexion', async () => {
    const { startUpdate } = await import('../src/lib/update.js');
    await expect(startUpdate('secret', false)).rejects.toMatchObject({ status: 503, code: 'ssh_unconfigured' });
    const { env } = await import('../src/env.js');
    env.UPDATE_SSH_FINGERPRINT = 'SHA256:court';
    await expect(startUpdate('secret', false)).rejects.toMatchObject({ status: 503, code: 'ssh_unconfigured' });
    // Serveur SSH dont la clé ne correspond pas à l'empreinte attendue : connexion coupée avant l'authentification
    const { Server, utils } = await import('ssh2');
    const hostKey = utils.generateKeyPairSync('ed25519').private;
    let authTried = false;
    const srv = new Server({ hostKeys: [hostKey] }, client => { client.on('authentication', ctx => { authTried = true; ctx.reject(); }); client.on('error', () => {}); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
    Object.assign(env, { UPDATE_SSH_HOST: '127.0.0.1', UPDATE_SSH_PORT: (srv.address() as { port: number }).port, UPDATE_SSH_FINGERPRINT: 'SHA256:' + 'A'.repeat(43) });
    await expect(startUpdate('secret', false)).rejects.toMatchObject({ code: 'ssh_host' });
    expect(authTried).toBe(false);
    srv.close();
    env.UPDATE_SSH_FINGERPRINT = '';
  });

  it('F12 : seule une personne autorisée peut marquer une story comme vue', async () => {
    const a = await register(), b = await register(), c = await register();
    await befriend(a, b);
    const s = await call('POST', '/v1/stories', a.access, { kind: 'status', data: { e: '🔥', t: 'go' } });
    const id = s.body?.id ?? (await sql<{ id: string }[]>`insert into stories (author_id, kind, text, expires_at) values (${a.id}, 'recap', '', now() + interval '1 day') returning id`)[0]!.id;
    expect((await call('POST', `/v1/stories/${id}/view`, c.access)).status).toBe(404);
    expect((await call('POST', `/v1/stories/${id}/view`, b.access)).status).toBe(200);
    const views = await call('GET', `/v1/stories/${id}/views`, a.access);
    expect(views.body.map((v: { id: string }) => v.id)).toEqual([b.id]);
  });

  it('F13 : le fil ne charge que les 20 derniers commentaires par publication', async () => {
    const a = await register();
    const p = await call('POST', '/v1/posts', a.access, { text: 'Bonjour', visibility: 'friends' });
    for (let i = 0; i < 25; i++) await sql`insert into comments (post_id, author_id, text) values (${p.body.id}, ${a.id}, ${`c${i}`})`;
    const feed = await call('GET', '/v1/feed', a.access);
    const post = feed.body.posts.find((x: { id: string }) => x.id === p.body.id);
    expect(post.comments).toHaveLength(20);
    expect(post.comments.at(-1).text).toBe('c24');
  });

  it('F14 : le classement d’un défi est réservé à ses participants', async () => {
    const a = await register(), b = await register();
    const [ch] = await sql<{ id: string }[]>`insert into challenges (title, starts_on, ends_on) values ('Défi', current_date, current_date + 7) returning id`;
    expect((await call('POST', `/v1/challenges/${ch!.id}/join`, a.access)).status).toBe(200);
    expect((await call('GET', `/v1/challenges/${ch!.id}`, a.access)).body.board).toHaveLength(1);
    expect((await call('GET', `/v1/challenges/${ch!.id}`, b.access)).body.board).toHaveLength(0);
  });

  it('F16 : pas de mention ni de notification depuis un compte bloqué dans un groupe', async () => {
    const a = await register(), b = await register(), c = await register();
    const [g] = await sql<{ id: string }[]>`insert into chat_groups (name, owner_id, members_changed_at) values ('G', ${a.id}, now() - interval '1 hour') returning id`;
    for (const u of [a, b, c]) await sql`insert into chat_group_members (group_id, user_id) values (${g!.id}, ${u.id})`;
    const keyId = randomUUID();
    await sql`insert into e2e_pair_keys (key_id, group_id, created_by) values (${keyId}, ${g!.id}, ${b.id})`;
    await sql`insert into blocks (blocker_id, blocked_id) values (${a.id}, ${b.id})`;
    const e2e = { v: 1, keyId, nonce: 'A'.repeat(32), ct: 'QUJD' };
    expect((await call('POST', `/v1/groups/${g!.id}/messages`, b.access, { e2e, mentions: [a.id, c.id] })).status).toBe(201);
    const notes = await sql<{ user_id: string }[]>`select user_id from notifications where type = 'mention' and data->>'groupId' = ${g!.id}`;
    expect(notes.map(n => n.user_id)).toEqual([c.id]);
  });

  it('F08 : images et pièces jointes inutilisées effacées par la tâche périodique', async () => {
    const { existsSync } = await import('node:fs');
    const { collectMedia, mediaFile } = await import('../src/lib/media.js');
    const a = await register();
    const unused = new URL((await upload(a.access, await jpegWithGps())).body.url).pathname.split('/').pop()!;
    const used = (await upload(a.access, await jpegWithGps())).body.url as string;
    const story = await call('POST', '/v1/stories', a.access, { kind: 'photo', mediaUrl: used });
    const usedName = new URL(used).pathname.split('/').pop()!;
    await sql`update media set created_at = now() - interval '2 days' where owner_id = ${a.id}`;
    const [att] = await sql<{ id: string }[]>`insert into attachments (owner_id, size, created_at) values (${a.id}, 10, now() - interval '2 days') returning id`;
    await collectMedia();
    expect(existsSync(mediaFile(unused))).toBe(false);
    expect(existsSync(mediaFile(usedName))).toBe(true);
    expect(await sql`select 1 from attachments where id = ${att!.id}`).toHaveLength(0);
    // Story supprimée par son autrice : son image part aussitôt
    await call('DELETE', `/v1/stories/${story.body.id}`, a.access);
    expect(existsSync(mediaFile(usedName))).toBe(false);
  });

  it('API : réponses jamais mises en cache', async () => {
    const a = await register();
    expect((await call('GET', '/v1/me', a.access)).headers['cache-control']).toBe('no-store');
  });
});
