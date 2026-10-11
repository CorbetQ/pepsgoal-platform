import { randomUUID } from 'node:crypto';
import { decryptMessage, encryptMessage, newDeviceKeys, newPairKey, unwrapPairKey, wrapPairKey } from '@pepsgoal/shared';
// Scénario de bout en bout contre un serveur de développement vierge (mot de passe admin « password »).
// Usage : API_URL=http://localhost:8080 [ADMIN_PASSWORD=…] node test/e2e.mjs
const B = process.env.API_URL ?? 'http://localhost:8080';
const suffix = Date.now().toString(36).slice(-4);
let fails = 0; const ok = (cond, label, extra = '') => { console.log((cond ? 'OK  ' : 'ECHEC ') + label + (extra ? ' -- ' + extra : '')); if (!cond) fails++; };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
for (let i = 0; i < 60; i++) { try { const r = await fetch(B + '/v1/status'); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
const st = await call('GET', '/v1/status'); ok(st.status === 200 && st.data.ok, 'statut public');

// comptes
const reg = await call('POST', '/v1/auth/register', { username: 'alice' + suffix, displayName: 'Alice Test', password: 'motdepasse1', acceptTerms: true });
ok(reg.status === 201 && reg.data.accessToken, 'inscription alice', JSON.stringify(reg.data).slice(0, 200));
const bob = await call('POST', '/v1/auth/register', { username: 'bob' + suffix, displayName: 'Bob Test', password: 'motdepasse2', acceptTerms: true });
const dup = await call('POST', '/v1/auth/register', { username: 'alice' + suffix, displayName: 'Xavier', password: 'motdepasse1', acceptTerms: true });
ok(dup.status === 409, 'nom deja pris refuse');
const badLogin = await call('POST', '/v1/auth/login', { username: 'alice' + suffix, password: 'faux' });
ok(badLogin.status === 401, 'mauvais mot de passe refuse');
const A = reg.data.accessToken, Bt = bob.data.accessToken, aId = reg.data.user.id, bId = bob.data.user.id;
const conv0 = await call('GET', '/v1/conversations', null, A);
ok(conv0.data?.[0]?.peer.role === 'official', 'message de bienvenue du compte officiel');
const ref = await call('POST', '/v1/auth/refresh', { refreshToken: reg.data.refreshToken });
ok(ref.status === 200 && ref.data.refreshToken, 'renouvellement de session');
const reuse = await call('POST', '/v1/auth/refresh', { refreshToken: reg.data.refreshToken });
ok(reuse.status === 401, 'jeton reutilise refuse (rotation)');

// synchronisation
const now = new Date().toISOString(), gid = randomUUID(), cid = randomUUID(), today = new Date().toISOString().slice(0, 10);
const goal = { type: 'routine', title: 'Courir', icon: '🏃', data: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3 }, createdAt: now, updatedAt: now };
const ops = [
  { opId: randomUUID(), entity: 'goal', action: 'upsert', id: gid, data: goal, clientUpdatedAt: now },
  { opId: randomUUID(), entity: 'checkin', action: 'upsert', id: cid, data: { goalId: gid, date: today, kind: 'done', value: 1, points: 500, createdAt: now, updatedAt: now }, clientUpdatedAt: now },
  { opId: randomUUID(), entity: 'settings', action: 'upsert', id: 'settings', data: { theme: 'dark', accent: 3 }, clientUpdatedAt: now }
];
const push = await call('POST', '/v1/sync/push', { deviceId: 'test', ops }, A);
ok(push.status === 200 && push.data.applied.length === 3, 'envoi de la file', JSON.stringify(push.data).slice(0, 300));
const p2 = await call('POST', '/v1/sync/push', { deviceId: 'test', ops }, A);
ok(p2.data.applied.length === 3 && p2.data.rejected.length === 0, 'renvoi idempotent');
const pull = await call('GET', '/v1/sync/pull?cursor=0', null, A);
ok(pull.data.goals?.length === 1 && pull.data.checkins?.length === 1 && pull.data.settings?.theme === 'dark', 'recuperation des changements', JSON.stringify(pull.data).slice(0, 200));
ok(pull.data.checkins?.[0]?.points <= 210, 'points plafonnes par le serveur', String(pull.data.checkins?.[0]?.points));
const old = new Date(Date.now() - 3600e3).toISOString();
const stale = await call('POST', '/v1/sync/push', { deviceId: 't', ops: [{ opId: randomUUID(), entity: 'goal', action: 'upsert', id: gid, data: { ...goal, title: 'Ancien' }, clientUpdatedAt: old }] }, A);
ok(stale.data.rejected[0]?.reason === 'stale', 'conflit : version plus ancienne rejetee');
const steal = await call('POST', '/v1/sync/push', { deviceId: 't', ops: [{ opId: randomUUID(), entity: 'goal', action: 'upsert', id: gid, data: goal, clientUpdatedAt: new Date().toISOString() }] }, Bt);
ok(steal.data.rejected[0]?.reason === 'forbidden', "impossible de modifier l'objectif d'un autre");
const bobPull = await call('GET', '/v1/sync/pull?cursor=0', null, Bt);
ok(bobPull.data.goals.length === 0, 'les objectifs restent prives');
const cur = pull.data.cursor;
await call('POST', '/v1/sync/push', { deviceId: 't', ops: [{ opId: randomUUID(), entity: 'checkin', action: 'delete', id: cid, clientUpdatedAt: new Date().toISOString() }] }, A);
const pull2 = await call('GET', '/v1/sync/pull?cursor=' + cur, null, A);
ok(pull2.data.deleted?.some(d => d.id === cid), 'suppression transmise aux autres appareils');

// social
const fr = await call('POST', '/v1/friends/requests', { userId: bId }, A);
ok(fr.status === 201, "demande d'ami", JSON.stringify(fr.data));
const lst = await call('GET', '/v1/friends', null, Bt);
const acc = await call('POST', `/v1/friends/requests/${lst.data.incoming[0]?.friendshipId}/accept`, {}, Bt);
ok(acc.status === 200, 'demande acceptee');
const post = await call('POST', '/v1/posts', { text: 'Premiere sortie !', visibility: 'friends', goalId: gid }, A);
ok(post.status === 201 && post.data.status === 'visible', 'publication', JSON.stringify(post.data));
await call('POST', `/v1/posts/${post.data.id}/like`, {}, Bt);
await call('POST', `/v1/posts/${post.data.id}/comments`, { text: 'Bravo !' }, Bt);
const feedB = await call('GET', '/v1/feed?tab=friends', null, Bt);
ok(feedB.data.posts?.[0]?.likeCount === 1 && feedB.data.posts?.[0]?.comments.length === 1, 'feed : encouragement et commentaire', JSON.stringify(feedB.data).slice(0, 200));
// messagerie chiffrée de bout en bout : clés d'appareil, clé de paire, enveloppes
const kA = newDeviceKeys(), kB = newDeviceKeys();
const devA = (await call('POST', '/v1/e2e/devices', { publicKey: kA.publicKey }, A)).data.deviceId;
const devB = (await call('POST', '/v1/e2e/devices', { publicKey: kB.publicKey }, Bt)).data.deviceId;
const pk = newPairKey(), keyId = randomUUID();
const upKey = await call('POST', `/v1/e2e/peers/${bId}/keys`, { keyId, envelopes: [
  { deviceId: devA, senderDeviceId: devA, ...wrapPairKey(pk, kA.publicKey, kA.secretKey) },
  { deviceId: devB, senderDeviceId: devA, ...wrapPairKey(pk, kB.publicKey, kA.secretKey) }] }, A);
const stB = await call('GET', `/v1/e2e/peers/${aId}?deviceId=${devB}`, null, Bt);
const envB = stB.data.keys?.[0]?.envelope;
ok(upKey.status === 201 && envB && unwrapPairKey(envB, envB.senderPublicKey, kB.secretKey) === pk, 'chiffrement : cle de paire transmise a l’ami par enveloppe', JSON.stringify(stB.data).slice(0, 200));
const plain = await call('POST', `/v1/conversations/${aId}`, { text: 'Salut Alice' }, Bt);
ok(plain.status === 400, 'chiffrement : message en clair refuse');
const msg = await call('POST', `/v1/conversations/${aId}`, { e2e: encryptMessage('Salut Alice 🔥', pk, keyId) }, Bt);
const convA = await call('GET', `/v1/conversations/${bId}`, null, A);
const lastA = convA.data?.find(m => m.e2e);
ok(msg.status === 201 && lastA && lastA.text === null && decryptMessage(lastA.e2e, pk) === 'Salut Alice 🔥', 'messagerie chiffree entre amis', JSON.stringify(convA.data).slice(0, 200));
const listA = await call('GET', '/v1/conversations', null, A);
ok(listA.data.some(c => c.lastE2e && c.lastText === null), 'liste des conversations : apercu chiffre');
const badKey = await call('POST', `/v1/conversations/${aId}`, { e2e: encryptMessage('x', pk, randomUUID()) }, Bt);
ok(badKey.status === 403, 'chiffrement : cle inconnue refusee');
const devA2keys = newDeviceKeys();
const devA2 = (await call('POST', '/v1/e2e/devices', { publicKey: devA2keys.publicKey }, A)).data.deviceId;
const pend = await call('GET', `/v1/e2e/pending?deviceId=${devA}`, null, A);
const miss = pend.data.find(x => x.keyId === keyId)?.missingDevices.find(d => d.id === devA2);
await call('POST', `/v1/e2e/peers/${bId}/keys`, { keyId, envelopes: [{ deviceId: devA2, senderDeviceId: devA, ...wrapPairKey(pk, miss?.publicKey ?? kA.publicKey, kA.secretKey) }] }, A);
const stA2 = await call('GET', `/v1/e2e/peers/${bId}?deviceId=${devA2}`, null, A);
const envA2 = stA2.data.keys?.[0]?.envelope;
ok(miss && envA2 && unwrapPairKey(envA2, envA2.senderPublicKey, devA2keys.secretKey) === pk, 'chiffrement : nouvel appareil recoit la cle par re-chiffrement');
const story = await call('POST', '/v1/stories', { kind: 'recap', data: { title: 'Ma semaine', n: 5, pts: 50, best: 3, reg: 70, persona: 'Metronome', e: 'x' }, text: 'Belle semaine' }, A);
const storiesB = await call('GET', '/v1/stories', null, Bt);
ok(story.status === 201 && storiesB.data.length === 1 && storiesB.data[0].unseen, 'story visible par un ami', JSON.stringify(story.data));
const rep = await call('POST', `/v1/posts/${post.data.id}/report`, { reason: 'spam' }, Bt);
ok(rep.status === 200, 'signalement');
const bad = await call('POST', '/v1/sync/push', { deviceId: 't', ops: [{ opId: randomUUID(), entity: 'goal', action: 'upsert', id: randomUUID(), data: { ...goal, type: 'timed', data: { mode: 'before', time: '"><script>', days: [0] } }, clientUpdatedAt: new Date().toISOString() }] }, A);
ok(bad.data.rejected[0]?.reason === 'invalid', 'donnees invalides refusees');

// moderation
const adm = await call('POST', '/v1/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD ?? 'password' });
const AD = adm.data.accessToken;
ok(adm.status === 200, 'connexion admin (mot de passe de developpement)');
const notAdmin = await call('GET', '/v1/admin/overview', null, A);
ok(notAdmin.status === 403, 'moderation interdite aux utilisateurs');
const ov = await call('GET', '/v1/admin/overview', null, AD);
ok(ov.data.open_reports === 1, 'vue d’ensemble : 1 signalement', JSON.stringify(ov.data));
await call('POST', `/v1/admin/users/${aId}/warn`, { reason: 'Test' }, AD);
const post2 = await call('POST', '/v1/posts', { text: 'Apres avertissement', visibility: 'public' }, A);
ok(post2.data.status === 'pending', 'publication en attente apres avertissement');
const feedB2 = await call('GET', '/v1/feed?tab=public', null, Bt);
ok(!feedB2.data.posts.some(p => p.id === post2.data.id), 'invisible tant qu’elle n’est pas validee');
const appr = await call('POST', `/v1/admin/posts/${post2.data.id}/approve`, {}, AD);
ok(appr.status === 200, 'publication validee');
const ban = await call('POST', `/v1/admin/users/${bId}/ban`, { days: 7, reason: 'Spam' }, AD);
const bobPost = await call('POST', '/v1/posts', { text: 'test', visibility: 'public' }, Bt);
ok(ban.status === 200 && bobPost.status === 403, 'compte banni : publication refusee');
const bobSync = await call('GET', '/v1/sync/pull?cursor=0', null, Bt);
ok(bobSync.status === 200, 'compte banni : ses objectifs restent synchronises');
const appeal = await call('POST', '/v1/appeals', { text: 'Je ne recommencerai pas, promis.' }, Bt);
const appeals = await call('GET', '/v1/admin/appeals', null, AD);
const accept = await call('POST', `/v1/admin/appeals/${appeals.data[0]?.id}/accept`, { answer: 'OK' }, AD);
const bobPost2 = await call('POST', '/v1/posts', { text: 'De retour', visibility: 'public' }, Bt);
ok(appeal.status === 201 && accept.status === 200 && bobPost2.status === 201, 'contestation acceptee : acces retabli');
const convB = await call('GET', '/v1/conversations', null, Bt);
ok(convB.data[0]?.peer.role === 'official' && convB.data[0]?.unread >= 2, 'messages de moderation du compte officiel', JSON.stringify(convB.data[0]));
const maint = await call('POST', '/v1/admin/maintenance', { mode: 'social', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: null, message: 'Test', notify: false }, AD);
const duringM = await call('POST', '/v1/posts', { text: 'pendant', visibility: 'public' }, Bt);
const st2 = await call('GET', '/v1/status');
ok(maint.status === 201 && duringM.status === 503 && st2.data.maintenance?.mode === 'social', 'maintenance sociale : ecriture bloquee, statut publie');
await call('POST', '/v1/admin/maintenance/end', {}, AD);
const ann = await call('POST', '/v1/admin/announcements', { text: 'Nouveau : les stories !', tag: 'news', toUserId: null }, AD);
ok(ann.data.sent >= 2, 'annonce envoyee a tous les comptes', JSON.stringify(ann.data));
const carol = await call('POST', '/v1/auth/register', { username: 'carol' + suffix, displayName: 'Carol', password: 'motdepasse3', acceptTerms: true });
const convC = await call('GET', `/v1/conversations/${convB.data[0]?.peer.id}`, null, carol.data.accessToken);
const carolKey = await call('POST', `/v1/e2e/peers/${aId}/keys`, { keyId: randomUUID(), envelopes: [{ deviceId: devA, senderDeviceId: devA, nonce: 'AAAA', box: 'AAAA' }] }, carol.data.accessToken);
ok(carolKey.status === 403, 'chiffrement : impossible de deposer une cle sans etre ami');
ok(convC.data.some(m => m.text.includes('stories')), 'nouveaux inscrits : recoivent les dernieres nouveautes');
const delMe = await call('DELETE', '/v1/me', { password: 'motdepasse3' }, carol.data.accessToken);
const carolLogin = await call('POST', '/v1/auth/login', { username: 'carol' + suffix, password: 'motdepasse3' });
ok(delMe.status === 200 && carolLogin.status === 401, 'suppression de compte');
console.log(fails ? `\n${fails} echec(s)` : '\nTOUS LES SCENARIOS PASSENT');
process.exit(fails ? 1 : 0);
