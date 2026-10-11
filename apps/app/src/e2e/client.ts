import * as Crypto from 'expo-crypto';
import {
  decryptMessage, encryptMessage, newDeviceKeys, newPairKey, safetyCode, setRandomSource, unwrapPairKey, wrapPairKey,
  type E2EPayload
} from '@pepsgoal/shared';
import { api } from '../lib/api';
import { secure } from '../lib/secure';

/**
 * Chiffrement de bout en bout des messages privés, côté appareil (voir docs/E2E.md).
 * Les clés (secrète de l'appareil, clés de paire) sont rangées dans le trousseau de l'appareil (expo-secure-store)
 * et ne sont jamais envoyées en clair : le serveur ne relaie que des enveloppes chiffrées pour chaque appareil.
 */
setRandomSource(n => Crypto.getRandomBytes(n));

interface Device { deviceId: string; publicKey: string; secretKey: string }
interface PeerState {
  devices: { id: string; userId: string; publicKey: string }[];
  keys: { keyId: string; createdAt: string; missingDevices: string[]; envelope: { nonce: string; box: string; senderPublicKey: string } | null }[];
}
export interface Conversation {
  /** Clé utilisée pour écrire : la plus récente que cet appareil sait ouvrir. */
  current: { keyId: string; key: string } | null;
  /** Des clés existent mais aucune n'est encore arrivée sur cet appareil (nouvel appareil, reconnexion). */
  waiting: boolean;
  /** Code à comparer avec l'ami pour vérifier qu'aucune clé n'a été substituée. */
  safety: string;
}

const kDevice = (userId: string) => `pg.e2e.dev.${userId}`;
const kPair = (keyId: string) => `pg.e2e.pk.${keyId}`;
const kIndex = (userId: string) => `pg.e2e.idx.${userId}`;
const memo = new Map<string, string>();

async function readJson<T>(key: string): Promise<T | null> {
  const v = await secure.get(key);
  try { return v ? JSON.parse(v) as T : null; } catch { return null; }
}
async function rememberKey(userId: string, keyId: string, key: string) {
  memo.set(keyId, key);
  if ((await secure.get(kPair(keyId))) === key) return;
  await secure.set(kPair(keyId), key);
  const idx = (await readJson<string[]>(kIndex(userId))) ?? [];
  if (!idx.includes(keyId)) await secure.set(kIndex(userId), JSON.stringify([...idx, keyId]));
}
export async function pairKey(keyId: string): Promise<string | null> {
  if (memo.has(keyId)) return memo.get(keyId)!;
  const k = await secure.get(kPair(keyId));
  if (k) memo.set(keyId, k);
  return k;
}

/** Clé de cet appareil : créée et publiée (clé publique uniquement) à la première utilisation du compte. */
export async function ensureDevice(userId: string): Promise<Device> {
  const saved = await readJson<Device>(kDevice(userId));
  if (saved) return saved;
  const keys = newDeviceKeys();
  const { deviceId } = await api<{ deviceId: string }>('POST', '/v1/e2e/devices', { publicKey: keys.publicKey });
  const dev = { deviceId, ...keys };
  await secure.set(kDevice(userId), JSON.stringify(dev));
  return dev;
}

async function upload(peerId: string, keyId: string, key: string, me: Device, targets: { id: string; publicKey: string }[]) {
  if (!targets.length) return;
  await api('POST', `/v1/e2e/peers/${peerId}/keys`, {
    keyId, envelopes: targets.map(d => ({ deviceId: d.id, senderDeviceId: me.deviceId, ...wrapPairKey(key, d.publicKey, me.secretKey) }))
  });
}

/**
 * Prépare une conversation : ouvre les enveloppes destinées à cet appareil, re-chiffre les clés pour les appareils
 * qui ne les ont pas encore, et crée la toute première clé de la paire si besoin.
 */
export async function openConversation(userId: string, peerId: string): Promise<Conversation> {
  const me = await ensureDevice(userId);
  let st = await api<PeerState>('GET', `/v1/e2e/peers/${peerId}?deviceId=${me.deviceId}`);
  const byId = new Map(st.devices.map(d => [d.id, d]));
  for (const k of st.keys) {
    if (!k.envelope || (await pairKey(k.keyId))) continue;
    const key = unwrapPairKey(k.envelope, k.envelope.senderPublicKey, me.secretKey);
    if (key) await rememberKey(userId, k.keyId, key);
  }
  if (!st.keys.length) {
    const keyId = Crypto.randomUUID(), key = newPairKey();
    await upload(peerId, keyId, key, me, st.devices);
    await rememberKey(userId, keyId, key);
    st = await api<PeerState>('GET', `/v1/e2e/peers/${peerId}?deviceId=${me.deviceId}`);
  }
  let current: Conversation['current'] = null;
  for (const k of st.keys) {
    const key = await pairKey(k.keyId);
    if (!key) continue;
    current ??= { keyId: k.keyId, key };
    const missing = k.missingDevices.map(id => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
    await upload(peerId, k.keyId, key, me, missing).catch(() => undefined);
  }
  return { current, waiting: !current && st.keys.length > 0, safety: safetyCode(st.devices.map(d => d.publicKey)) };
}

/** Nouvelle version de clé quand aucune clé n'est arrivée ici (les anciens messages restent illisibles sur cet appareil). */
export async function resetConversationKey(userId: string, peerId: string): Promise<void> {
  const me = await ensureDevice(userId);
  const st = await api<PeerState>('GET', `/v1/e2e/peers/${peerId}?deviceId=${me.deviceId}`);
  const keyId = Crypto.randomUUID(), key = newPairKey();
  await upload(peerId, keyId, key, me, st.devices);
  await rememberKey(userId, keyId, key);
}

export const encrypt = (text: string, c: NonNullable<Conversation['current']>) => encryptMessage(text, c.key, c.keyId);
export async function decrypt(p: E2EPayload | null | undefined): Promise<string | null> {
  if (!p) return null;
  const key = await pairKey(p.keyId);
  return key ? decryptMessage(p, key) : null;
}

/** Après chaque synchronisation : transmet les clés que cet appareil détient aux appareils qui ne les ont pas. */
export async function shareMissingKeys(userId: string): Promise<void> {
  const me = await readJson<Device>(kDevice(userId));
  if (!me) return;
  const pending = await api<{ keyId: string; peerId: string; envelope: { nonce: string; box: string; senderPublicKey: string }; missingDevices: { id: string; publicKey: string }[] }[]>(
    'GET', `/v1/e2e/pending?deviceId=${me.deviceId}`);
  for (const p of pending) {
    const key = (await pairKey(p.keyId)) ?? unwrapPairKey(p.envelope, p.envelope.senderPublicKey, me.secretKey);
    if (!key) continue;
    await rememberKey(userId, p.keyId, key);
    await upload(p.peerId, p.keyId, key, me, p.missingDevices).catch(() => undefined);
  }
}

/** Déconnexion ou suppression du compte : les clés quittent l'appareil, le serveur oublie l'appareil. */
export async function forgetDevice(userId: string, notifyServer: boolean): Promise<void> {
  const dev = await readJson<Device>(kDevice(userId));
  if (dev && notifyServer) await api('DELETE', `/v1/e2e/devices/${dev.deviceId}`).catch(() => undefined);
  for (const keyId of (await readJson<string[]>(kIndex(userId))) ?? []) { await secure.remove(kPair(keyId)); memo.delete(keyId); }
  await secure.remove(kIndex(userId));
  await secure.remove(kDevice(userId));
}
