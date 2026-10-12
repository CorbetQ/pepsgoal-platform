import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import type { Row } from './mappers.js';

/** Pièces jointes chiffrées des messages : dans le dossier des médias, mais jamais servies publiquement (voir app.ts). */
export const ATT_SUBDIR = 'att';
export const attachmentDir = () => path.join(path.resolve(env.MEDIA_DIR), ATT_SUBDIR);
export const attachmentPath = (id: string) => path.join(attachmentDir(), `${id}.bin`);
export async function ensureAttachmentDir(): Promise<void> { await mkdir(attachmentDir(), { recursive: true }); }

/** Nom du fichier d'une image publique de ce serveur (`${PUBLIC_URL}/media/xxx.jpg` → `xxx.jpg`), sinon null. */
function mediaName(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(`${env.PUBLIC_URL}/media/`)) return null;
  const name = url.slice(`${env.PUBLIC_URL}/media/`.length);
  return /^[\w-]+\.(jpg|png|webp)$/.test(name) ? name : null;
}

/**
 * Suppression d'un compte : efface ses fichiers du disque (photo de profil, photos des publications et des stories,
 * pièces jointes chiffrées). Les lignes de la base disparaissent ensuite en cascade avec le compte.
 */
export async function removeUserFiles(userId: string): Promise<void> {
  const [u] = await sql<Row[]>`select avatar from users where id = ${userId}`;
  const posts = await sql<Row[]>`select photo_url from posts where author_id = ${userId} and photo_url is not null`;
  const stories = await sql<Row[]>`select media_url from stories where author_id = ${userId} and media_url is not null`;
  const atts = await sql<Row[]>`select id from attachments where owner_id = ${userId}`;
  const media = [u?.avatar?.photoUrl, ...posts.map(p => p.photo_url), ...stories.map(s => s.media_url)].map(mediaName).filter((n): n is string => !!n);
  const files = [...media.map(n => path.join(path.resolve(env.MEDIA_DIR), n)), ...atts.map(a => attachmentPath(a.id))];
  await Promise.all(files.map(f => unlink(f).catch(() => undefined)));
}
