/**
 * Chiffrement de bout en bout des messages privés (voir docs/E2E.md).
 *
 * - Chaque appareil possède une paire de clés X25519 ; la clé secrète ne quitte jamais l'appareil.
 * - Chaque paire d'amis partage une clé symétrique de 32 octets (« clé de paire »), tirée au hasard.
 *   Elle circule uniquement dans des enveloppes `crypto_box` (X25519 + XSalsa20-Poly1305), une par appareil destinataire.
 * - Les messages sont chiffrés avec `crypto_secretbox` (XSalsa20-Poly1305) et la clé de paire.
 * Le serveur ne stocke que des clés publiques, des enveloppes et des messages chiffrés : il ne peut lire aucun message.
 *
 * Primitives : tweetnacl (implémentation auditée de NaCl). Sur React Native, appeler `setRandomSource` au démarrage.
 */
import nacl from 'tweetnacl';
import { z } from 'zod';

export const E2E_VERSION = 1;

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const b64field = (max: number) => z.string().max(max).regex(B64, 'base64 attendu');

/** Message chiffré tel qu'il circule et est stocké sur le serveur. */
export const E2EPayload = z.object({
  v: z.literal(E2E_VERSION),
  keyId: z.string().uuid(),
  nonce: b64field(44),
  ct: b64field(4400)
});
export type E2EPayload = z.infer<typeof E2EPayload>;

/** Enveloppe d'une clé de paire pour un appareil. */
export const E2EEnvelope = z.object({ deviceId: z.string().uuid(), senderDeviceId: z.string().uuid(), nonce: b64field(44), box: b64field(100) });
export type E2EEnvelope = z.infer<typeof E2EEnvelope>;
export const E2EKeyUpload = z.object({ keyId: z.string().uuid(), envelopes: z.array(E2EEnvelope).min(1).max(40) });
export const E2EDeviceBody = z.object({ publicKey: b64field(44) });
/** Coffre de clés (copie chiffrée avec une clé dérivée du mot de passe) */
export const E2EVaultKey = z.object({ keyId: z.string().uuid(), nonce: b64field(44), box: b64field(100) });
export const E2EVaultBody = z.object({
  /**
   * create : nouveau coffre (409 s'il existe déjà) ; reset : coffre remplacé (clés perdues) ;
   * rewrap : nouveau mot de passe, la clé du coffre est seulement rechiffrée ; absent : format 1.2.0.
   */
  mode: z.enum(['create', 'reset', 'rewrap']).optional(),
  salt: b64field(44), iterations: z.number().int().min(100_000).max(5_000_000), check: b64field(120),
  /** Clé du coffre chiffrée avec la clé dérivée du mot de passe (nonce + boîte). */
  wrappedKey: b64field(140).optional(),
  /** Témoin chiffré avec la clé du coffre. */
  kcv: b64field(120).optional(),
  keys: z.array(E2EVaultKey).max(2000).optional()
}).refine(b => !b.mode || (b.wrappedKey && b.kcv), { message: 'Clé du coffre manquante.' });
export const E2EVaultKeysBody = z.object({ keys: z.array(E2EVaultKey).min(1).max(500) });

/** Longueur maximale du texte d'un message (en caractères). */
export const MESSAGE_MAX = 500;

/* ---------- encodages, sans dépendre de Buffer / TextEncoder (absents de certains moteurs mobiles) ---------- */
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    s += ABC[(n >> 18) & 63]! + ABC[(n >> 12) & 63]! + (i + 1 < u.length ? ABC[(n >> 6) & 63]! : '=') + (i + 2 < u.length ? ABC[n & 63]! : '=');
  }
  return s;
}
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0, acc = 0, j = 0;
  for (const c of clean) {
    const v = ABC.indexOf(c);
    if (v < 0) throw new Error('base64 invalide');
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 255; }
  }
  return out;
}
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { c = Math.min(c, 0x10ffff); out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return Uint8Array.from(out);
}
export function fromUtf8(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length;) {
    const a = u[i++]!;
    let c: number;
    if (a < 0x80) c = a;
    else if (a < 0xe0) c = ((a & 31) << 6) | (u[i++]! & 63);
    else if (a < 0xf0) c = ((a & 15) << 12) | ((u[i++]! & 63) << 6) | (u[i++]! & 63);
    else c = ((a & 7) << 18) | ((u[i++]! & 63) << 12) | ((u[i++]! & 63) << 6) | (u[i++]! & 63);
    s += String.fromCodePoint(c);
  }
  return s;
}

/** Source d'aléa cryptographique (React Native : expo-crypto `getRandomBytes`). */
export function setRandomSource(fill: (n: number) => Uint8Array) {
  nacl.setPRNG((x, n) => { const b = fill(n); for (let i = 0; i < n; i++) x[i] = b[i]!; });
}

export interface DeviceKeys { publicKey: string; secretKey: string }
export function newDeviceKeys(): DeviceKeys {
  const k = nacl.box.keyPair();
  return { publicKey: toB64(k.publicKey), secretKey: toB64(k.secretKey) };
}
/** Nouvelle clé de paire (32 octets aléatoires), encodée en base64. */
export function newPairKey(): string { return toB64(nacl.randomBytes(nacl.secretbox.keyLength)); }

/** Chiffre une clé de paire pour un appareil destinataire. */
export function wrapPairKey(pairKey: string, recipientPublicKey: string, senderSecretKey: string): { nonce: string; box: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  return { nonce: toB64(nonce), box: toB64(nacl.box(fromB64(pairKey), nonce, fromB64(recipientPublicKey), fromB64(senderSecretKey))) };
}
/** Ouvre une enveloppe ; null si elle a été altérée ou ne nous est pas destinée. */
export function unwrapPairKey(env: { nonce: string; box: string }, senderPublicKey: string, mySecretKey: string): string | null {
  try {
    const k = nacl.box.open(fromB64(env.box), fromB64(env.nonce), fromB64(senderPublicKey), fromB64(mySecretKey));
    return k && k.length === nacl.secretbox.keyLength ? toB64(k) : null;
  } catch { return null; }
}

export function encryptMessage(text: string, pairKey: string, keyId: string): E2EPayload {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return { v: E2E_VERSION, keyId, nonce: toB64(nonce), ct: toB64(nacl.secretbox(utf8(text), nonce, fromB64(pairKey))) };
}
/** Déchiffre un message ; null si la clé est mauvaise ou le message altéré. */
export function decryptMessage(p: E2EPayload, pairKey: string): string | null {
  try {
    const m = nacl.secretbox.open(fromB64(p.ct), fromB64(p.nonce), fromB64(pairKey));
    return m ? fromUtf8(m) : null;
  } catch { return null; }
}

/**
 * Code de sécurité d'une conversation : identique chez les deux amis si personne n'a substitué de clé.
 * Calculé sur les clés publiques de tous les appareils des deux comptes (ordre indépendant).
 */
export function safetyCode(publicKeys: string[]): string {
  const sorted = [...publicKeys].sort().join('|');
  const h = nacl.hash(utf8(sorted));
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) groups.push((((h[i * 3]! << 16) | (h[i * 3 + 1]! << 8) | h[i * 3 + 2]!) % 100000).toString().padStart(5, '0'));
  return groups.join(' ');
}
