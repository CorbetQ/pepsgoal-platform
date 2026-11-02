/**
 * Images téléversées (photos de profil, publications, stories).
 * - Chaque fichier a un propriétaire (table media) : on ne peut rattacher à son contenu que ses propres images, et
 *   supprimer un contenu n'efface jamais l'image d'un autre compte.
 * - Les images sont décodées puis réencodées : métadonnées (EXIF, GPS, appareil) supprimées, dimensions bornées.
 * - Elles ne sont servies qu'avec une adresse signée et temporaire, remise par l'API à ceux qui peuvent voir le
 *   contenu (amis pour une story ou une publication réservée aux amis) : connaître l'adresse ne suffit plus.
 * - Quota par compte, espace disque minimal, et nettoyage des fichiers qui ne servent plus.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sql, type Sql, type Tx } from '../db/client.js';
import { env } from '../env.js';
import { badRequest, HttpError } from './errors.js';
import { attachmentPath } from './files.js';

export const MEDIA_NAME = /^[\w-]+\.(jpg|png|webp)$/;
const mediaDir = () => path.resolve(env.MEDIA_DIR);
const base = () => `${env.PUBLIC_URL}/media/`;
export const mediaFile = (name: string) => path.join(mediaDir(), name);

/** Nom du fichier d'une image de ce serveur (adresse signée ou non), sinon null. */
export function mediaName(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(base())) return null;
  const name = url.slice(base().length).split(/[?#]/)[0]!;
  return MEDIA_NAME.test(name) ? name : null;
}
const canonical = (name: string) => base() + name;

/* ---------------- adresses signées ---------------- */

const KEY = createHmac('sha256', env.JWT_SECRET).update('pepsgoal-media-v1').digest();
/** Validité de 6 à 12 heures, arrondie à la tranche de 6 heures : l'adresse reste la même (et en cache) pendant une tranche. */
const SLOT_S = 6 * 3600;
const sign = (name: string, exp: number) => createHmac('sha256', KEY).update(`${name}.${exp}`).digest('base64url').slice(0, 32);

/** Adresse signée d'une image de ce serveur ; toute autre valeur est renvoyée telle quelle. */
export function signMediaUrl<T>(url: T): T | string {
  const name = mediaName(url);
  if (!name) return url;
  const exp = (Math.floor(Date.now() / 1000 / SLOT_S) + 2) * SLOT_S;
  return `${canonical(name)}?e=${exp}&s=${sign(name, exp)}`;
}

/** Photo de profil signée (avatar au format de l'application). */
export function signAvatar(avatar: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const a = avatar ?? {};
  return a.photoUrl ? { ...a, photoUrl: signMediaUrl(a.photoUrl) } : a;
}

/** Secondes de validité restantes d'une signature, ou 0 si elle est invalide ou expirée. */
export function verifyMediaSignature(name: string, e: unknown, s: unknown): number {
  const exp = Number(e), now = Date.now() / 1000;
  if (!MEDIA_NAME.test(name) || !Number.isInteger(exp) || exp <= now || exp > now + 2 * SLOT_S + 60 || typeof s !== 'string') return 0;
  const want = Buffer.from(sign(name, exp)), got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? Math.floor(exp - now) : 0;
}

/* ---------------- rattachement à un contenu ---------------- */

/**
 * Image choisie pour un contenu (photo de profil, publication, story) : elle doit avoir été téléversée par ce compte.
 * Renvoie l'adresse canonique (sans signature) à enregistrer.
 */
export async function claimMedia(db: Sql | Tx, userId: string, url: string | null | undefined): Promise<string | null> {
  if (url == null || url === '') return null;
  const name = mediaName(url);
  if (!name) throw badRequest('Image non autorisée : téléverse-la d’abord.');
  const [own] = await db`update media set attached_at = coalesce(attached_at, now()) where name = ${name} and owner_id = ${userId} returning id`;
  if (!own) throw badRequest('Image non autorisée : téléverse-la d’abord.');
  return canonical(name);
}

/* ---------------- téléversement ---------------- */

// Traitement des images : un fichier à la fois par processus, sans cache, pixels bornés (bombes de décompression)
sharp.cache(false);
sharp.concurrency(1);
const MAX_PIXELS = 40_000_000, MAX_SIDE = 2560;
let busy = 0;
const waiting: (() => void)[] = [];
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (busy >= 2) await new Promise<void>(r => waiting.push(r));
  busy++;
  try { return await fn(); } finally { busy--; waiting.shift()?.(); }
}

/** Décode et réencode l'image (JPEG, PNG ou WebP) : orientation appliquée, métadonnées retirées, 2 560 px au plus. */
export function reencodeImage(input: Buffer): Promise<{ data: Buffer; ext: 'jpg' | 'png' | 'webp' }> {
  return oneAtATime(async () => {
    let img: sharp.Sharp, format: string | undefined;
    try {
      img = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false });
      ({ format } = await img.metadata());
    } catch { throw badRequest('Image illisible.'); }
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') throw badRequest('Format non pris en charge : JPEG, PNG ou WebP uniquement.');
    const out = img.rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
    try {
      if (format === 'jpeg') return { data: await out.jpeg({ quality: 85, mozjpeg: true }).toBuffer(), ext: 'jpg' };
      if (format === 'png') return { data: await out.png({ compressionLevel: 9 }).toBuffer(), ext: 'png' };
      return { data: await out.webp({ quality: 85 }).toBuffer(), ext: 'webp' };
    } catch { throw badRequest('Image illisible.'); }
  });
}

/**
 * Réserve la place d'un nouveau fichier : quota du compte (images et pièces jointes chiffrées) et espace disque libre.
 * À appeler dans la transaction qui enregistre le fichier (verrou par compte : pas de dépassement par envois simultanés).
 */
export async function reserveStorage(tx: Tx, userId: string, bytes: number): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${userId}, 7))`;
  const [r] = await tx<{ used: string }[]>`select
    (select coalesce(sum(bytes), 0) from media where owner_id = ${userId}) + (select coalesce(sum(size), 0) from attachments where owner_id = ${userId}) as used`;
  if (Number(r?.used ?? 0) + bytes > env.MEDIA_QUOTA_MB * 1024 * 1024) {
    throw new HttpError(413, 'quota', `Espace de stockage plein (${env.MEDIA_QUOTA_MB} Mo) : supprime d’anciennes photos ou stories.`);
  }
  await mkdir(mediaDir(), { recursive: true });
  const fs = await statfs(mediaDir());
  if (fs.bavail * fs.bsize < env.DISK_MIN_FREE_MB * 1024 * 1024 + bytes) {
    throw new HttpError(507, 'storage', 'Le stockage du serveur est presque plein, réessaie plus tard.');
  }
}

/** Enregistre une image réencodée pour ce compte ; renvoie son adresse signée (aperçu immédiat). */
export async function storeImage(userId: string, input: Buffer): Promise<string> {
  const { data, ext } = await reencodeImage(input);
  const name = `${randomUUID()}.${ext}`;
  await sql.begin(async tx => {
    await reserveStorage(tx, userId, data.length);
    await tx`insert into media (owner_id, name, bytes) values (${userId}, ${name}, ${data.length})`;
  });
  try { await writeFile(mediaFile(name), data, { flag: 'wx' }); } catch (e) {
    await sql`delete from media where name = ${name}`;
    throw e;
  }
  return signMediaUrl(canonical(name)) as string;
}

/* ---------------- nettoyage ---------------- */

/** L'image sert encore : photo de profil, story (archive comprise), publication (gardée 7 jours après sa suppression, pour la modération). */
const stillUsed = (name: string) => sql`(
  exists (select 1 from users where avatar->>'photoUrl' = ${canonical(name)})
  or exists (select 1 from stories where media_url = ${canonical(name)})
  or exists (select 1 from posts where photo_url = ${canonical(name)} and (deleted_at is null or deleted_at > now() - interval '7 days')))`;

async function dropMedia(names: string[]): Promise<void> {
  for (const n of names) {
    const [gone] = await sql`delete from media where name = ${n} and not ${stillUsed(n)} returning name`;
    if (gone) await unlink(mediaFile(n)).catch(() => undefined);
  }
}

/** Contenu supprimé par son auteur : ses images qui ne servent plus ailleurs sont effacées (jamais celles d'un autre compte). */
export async function releaseMedia(userId: string, urls: unknown[]): Promise<void> {
  const names = urls.map(mediaName).filter((n): n is string => !!n);
  if (!names.length) return;
  const own = await sql<{ name: string }[]>`select name from media where owner_id = ${userId} and name = any(${names})`;
  await dropMedia(own.map(r => r.name));
}

/** Suppression d'un compte : ses images et ses pièces jointes chiffrées (les lignes partent ensuite en cascade). */
export async function removeUserFiles(userId: string): Promise<void> {
  const own = await sql<{ name: string }[]>`select name from media where owner_id = ${userId}`;
  const atts = await sql<{ id: string }[]>`select id from attachments where owner_id = ${userId}`;
  await Promise.all([...own.map(m => mediaFile(m.name)), ...atts.map(a => attachmentPath(a.id))].map(f => unlink(f).catch(() => undefined)));
}

/**
 * Tâche périodique : images téléversées mais jamais utilisées (24 heures), images qui ne servent plus, pièces jointes
 * jamais envoyées (24 heures) ou dont les messages ont disparu, fichiers sans propriétaire connu (7 jours), tailles
 * des images d'avant le quota.
 */
export async function collectMedia(): Promise<void> {
  const fresh = await sql<{ name: string }[]>`delete from media where attached_at is null and created_at < now() - interval '24 hours' returning name`;
  await Promise.all(fresh.map(m => unlink(mediaFile(m.name)).catch(() => undefined)));
  const unused = await sql<{ name: string }[]>`select name from media m where attached_at is not null and created_at < now() - interval '24 hours' and not (
      exists (select 1 from users where avatar->>'photoUrl' = ${base()} || m.name)
      or exists (select 1 from stories where media_url = ${base()} || m.name)
      or exists (select 1 from posts where photo_url = ${base()} || m.name and (deleted_at is null or deleted_at > now() - interval '7 days')))
    limit 1000`;
  await dropMedia(unused.map(m => m.name));
  const atts = await sql<{ id: string }[]>`delete from attachments a where created_at < now() - interval '24 hours'
    and not exists (select 1 from messages m where m.attachments @> array[a.id]) returning id`;
  await Promise.all(atts.map(a => unlink(attachmentPath(a.id)).catch(() => undefined)));
  // Tailles inconnues (images antérieures à la table media)
  for (const m of await sql<{ name: string }[]>`select name from media where bytes = 0 limit 1000`) {
    const st = await stat(mediaFile(m.name)).catch(() => null);
    if (st) await sql`update media set bytes = ${st.size} where name = ${m.name}`;
  }
  // Fichiers sans ligne dans media (téléversés avant le suivi et jamais utilisés)
  const files = (await readdir(mediaDir()).catch(() => [] as string[])).filter(f => MEDIA_NAME.test(f));
  for (let i = 0; i < files.length; i += 500) {
    const batch = files.slice(i, i + 500);
    const known = new Set((await sql<{ name: string }[]>`select name from media where name = any(${batch})`).map(r => r.name));
    for (const f of batch.filter(f => !known.has(f))) {
      const st = await stat(mediaFile(f)).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 7 * 864e5) await unlink(mediaFile(f)).catch(() => undefined);
    }
  }
}
