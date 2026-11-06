import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Boutique des créateurs et « PepsGoal Style » (10.0), contre un serveur de développement vierge.
// Usage : API_URL=http://localhost:8080 PHOTO=chemin/vers/photo.jpg [ADMIN_PASSWORD=…] node test/e2e-creator.mjs
const B = process.env.API_URL ?? 'http://localhost:8080';
const suffix = Date.now().toString(36).slice(-4);
let fails = 0; const ok = (cond, label, extra = '') => { console.log((cond ? 'OK  ' : 'ECHEC ') + label + (extra ? ' -- ' + extra : '')); if (!cond) fails++; };
async function call(method, path, body, token) {
  const r = await fetch(B + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function upload(path, bytes, token, name = 'photo.jpg') {
  const fd = new FormData(); fd.append('file', new Blob([bytes], { type: 'image/jpeg' }), name);
  const r = await fetch(B + path, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
for (let i = 0; i < 60; i++) { try { const r = await fetch(B + '/v1/status'); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }

const reg = async (n) => (await call('POST', '/v1/auth/register', { username: n + suffix, displayName: n[0].toUpperCase() + n.slice(1), password: 'motdepasse1', acceptTerms: true })).data;
const alice = await reg('alice'), bob = await reg('bob');
const A = alice.accessToken, Bt = bob.accessToken;
const adm = await call('POST', '/v1/auth/login', { username: 'admin', password: process.env.ADMIN_PASSWORD ?? 'password' });
const AD = adm.data?.accessToken;
ok(!!A && !!Bt && !!AD, 'comptes créateur, acheteur et admin');

// PepsGoal Style
const photo = readFileSync(process.env.PHOTO);
const st = await upload('/v1/style?stylize=1&weather=1&strength=0.8', photo, A);
ok(st.status === 201 && st.data.image?.url && st.data.stylized, 'stylisation PepsGoal', JSON.stringify(st.data).slice(0, 300));
ok(st.data.foreground?.mime === 'image/webp' && st.data.weather && st.data.skyRatio > 0.04, 'ciel découpé : premier plan WebP', String(st.data.skyRatio));
const img = await fetch(st.data.image.url); ok(img.ok && (await img.arrayBuffer()).byteLength === st.data.image.size, 'image servie publiquement, taille exacte');
const plain = await upload('/v1/style?stylize=0&weather=0', photo, A);
ok(plain.status === 201 && !plain.data.stylized && !plain.data.foreground, 'stylisation et météo désactivables');
const noAuth = await upload('/v1/style', photo, '');
ok(noAuth.status === 401, 'style réservé aux comptes');
const junk = await upload('/v1/style', Buffer.from('pas une image'), A);
ok(junk.status === 400, 'fichier illisible refusé');

// Publication
const files = [{ ...st.data.image, name: 'fond.jpg' }, { ...st.data.foreground, name: 'premier-plan.webp' }];
const pack = {
  schemaVersion: 1, type: 'theme_pack', id: 'perso-abc', name: 'Collines', emoji: '⛰️', dark: false,
  colors: { bg: '#FFF7F0', ink: '#2A1420', surface: '#FFFFFF', surface2: '#FFEDE1', edge: '#F2DED1', accent: ['#FFB000', '#FF4A12', '#FF3D96'], deco: st.data.colors.slice(0, 4) },
  wallpaper: { kind: 'image', file: 'fond.jpg', foreground: 'premier-plan.webp', weather: true, styled: true }
};
const foreign = await call('POST', '/v1/creator/items', { name: 'Collines', price: 50, content: pack, files: [{ ...files[0], url: 'https://exemple.com/x.jpg' }, files[1]] }, A);
ok(foreign.status === 400, 'fichier extérieur refusé');
const missing = await call('POST', '/v1/creator/items', { name: 'Collines', price: 50, content: pack, files: [files[0]] }, A);
ok(missing.status === 400, 'premier plan cité mais absent refusé');
const pub = await call('POST', '/v1/creator/items', { name: 'Collines', description: 'Mes collines au soleil', price: 50, content: pack, files }, A);
ok(pub.status === 201 && pub.data.status === 'pending' && pub.data.creatorId === alice.user.id, 'pack publié, en attente de modération', JSON.stringify(pub.data).slice(0, 200));
const id = pub.data.id;
let cat = await call('GET', '/v1/content/catalog');
ok(!cat.data.items.some(i => i.id === id), 'absent de la vitrine avant validation');
const pend = await call('GET', '/v1/admin/content?status=pending', null, AD);
ok(pend.data?.some(i => i.id === id), 'visible par la modération');
const rej = await call('POST', `/v1/admin/content/${id}/reject`, { reason: 'Photo floue' }, AD);
ok(rej.status === 200 && rej.data.status === 'rejected', 'refus avec motif');
const mine = await call('GET', '/v1/creator/items', null, A);
ok(mine.data?.[0]?.reviewNote === 'Photo floue', 'le créateur lit le motif');
const fix = await call('PUT', `/v1/creator/items/${id}`, { name: 'Collines', description: 'Mes collines au soleil', price: 50, content: pack, files }, A);
ok(fix.data?.status === 'pending' && fix.data.version === 2, 'corrigé : repasse en modération');
const val = await call('POST', `/v1/admin/content/${id}/publish`, null, AD);
ok(val.data?.status === 'published', 'validé par la modération');
cat = await call('GET', '/v1/content/catalog');
const item = cat.data.items.find(i => i.id === id);
ok(item && item.creatorId === alice.user.id && item.price === 50 && item.preview === st.data.image.url && item.author === 'Alice', 'en vitrine avec créateur, prix et aperçu', JSON.stringify(item).slice(0, 300));
const detail = await call('GET', `/v1/content/${id}`);
ok(detail.data?.content?.wallpaper?.foreground === 'premier-plan.webp' && detail.data.content.id === id, 'contenu complet avec premier plan');
const notif = await call('GET', '/v1/notifications', null, A);
ok(JSON.stringify(notif.data).includes('est en vente'), 'créateur prévenu de la mise en vente');

// Achat
const own = await call('POST', `/v1/content/${id}/purchase`, null, A);
ok(own.status === 409, 'impossible d’acheter son propre pack');
const poor = await call('POST', `/v1/content/${id}/purchase`, null, Bt);
ok(poor.status === 402, 'flammes insuffisantes refusées');
const now = new Date().toISOString(), gid = randomUUID(), today = new Date().toISOString().slice(0, 10);
const sp = await call('POST', '/v1/sync/push', { deviceId: 't', ops: [
  { opId: randomUUID(), entity: 'goal', action: 'upsert', id: gid, data: { type: 'routine', title: 'Courir', icon: '🏃', data: { mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3 }, createdAt: now, updatedAt: now }, clientUpdatedAt: now },
  { opId: randomUUID(), entity: 'checkin', action: 'upsert', id: randomUUID(), data: { goalId: gid, date: today, kind: 'done', value: 1, points: 200, createdAt: now, updatedAt: now }, clientUpdatedAt: now }
] }, Bt);
ok(sp.data?.applied?.length === 2, 'flammes gagnées par l’acheteur', JSON.stringify(sp.data).slice(0, 200));
const buy = await call('POST', `/v1/content/${id}/purchase`, null, Bt);
ok(buy.status === 201 && buy.data.price === 50 && buy.data.fresh, 'achat enregistré', JSON.stringify(buy.data));
const again = await call('POST', `/v1/content/${id}/purchase`, null, Bt);
ok(again.status === 200 && again.data.id === buy.data.id && !again.data.fresh, 'achat rejoué : idempotent');
const bought = await call('GET', '/v1/me/content-purchases', null, Bt);
ok(bought.data?.length === 1 && bought.data[0].contentId === id, 'collection retrouvée sur un autre appareil');
const sales = await call('GET', '/v1/creator/sales', null, A);
ok(sales.data?.sales?.length === 1 && sales.data.sales[0].price === 50 && sales.data.total === 50 && sales.data.sales[0].buyer === 'Bob', '100 % du prix au créateur', JSON.stringify(sales.data));
const later = await call('GET', `/v1/creator/sales?since=${encodeURIComponent(sales.data.cursor)}`, null, A);
ok(later.data?.sales?.length === 0 && later.data.total === 50, 'relève suivante : rien de nouveau');
const an = await call('GET', '/v1/notifications', null, A);
ok(JSON.stringify(an.data).includes('+50 flammes'), 'créateur prévenu de la vente');
const mine2 = await call('GET', '/v1/creator/items', null, A);
ok(mine2.data?.[0]?.sales === 1 && mine2.data[0].earned === 50, 'ventes et gains du pack');

// Retrait
const del = await call('DELETE', `/v1/creator/items/${id}`, null, A);
ok(del.data?.retired, 'retiré (déjà vendu : gardé pour l’acheteur)');
cat = await call('GET', '/v1/content/catalog');
ok(!cat.data.items.some(i => i.id === id), 'plus en vitrine');
const steal = await call('DELETE', `/v1/creator/items/${id}`, null, Bt);
ok(steal.status === 404, 'un autre compte ne peut pas retirer le pack');

console.log(fails ? `\n${fails} échec(s)` : '\nTout est bon.');
process.exit(fails ? 1 : 0);
