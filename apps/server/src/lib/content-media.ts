import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

/*
 * Médias des contenus (packs, fonds) : rangés sous leur empreinte dans media/content/<sha256>.<ext>, servis
 * publiquement (adresse impossible à deviner sans l'empreinte). Partagé par l'administration, les créateurs et
 * « PepsGoal Style ».
 */

export const MEDIA_KINDS: { ext: string; mime: 'image/jpeg' | 'image/png' | 'image/webp'; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' }
];

export interface StoredFile { name: string; url: string; sha256: string; size: number; mime: 'image/jpeg' | 'image/png' | 'image/webp' }

export const contentDir = () => path.join(path.resolve(env.MEDIA_DIR), 'content');

/** Range un média reconnu (JPEG, PNG, WebP) ; null si le format n'est pas pris en charge. [base] : début du nom. */
export async function storeContentMedia(buf: Buffer, base?: string): Promise<StoredFile | null> {
  const kind = MEDIA_KINDS.find(m => m.test(buf));
  if (!kind) return null;
  const sha256 = createHash('sha256').update(buf).digest('hex');
  await mkdir(contentDir(), { recursive: true });
  await writeFile(path.join(contentDir(), `${sha256}.${kind.ext}`), buf);
  return { name: `${base ?? sha256.slice(0, 16)}.${kind.ext}`, url: `${env.PUBLIC_URL}/media/content/${sha256}.${kind.ext}`, sha256, size: buf.length, mime: kind.mime };
}

/**
 * Les fichiers cités par un créateur sont-ils bien des médias de ce serveur (même empreinte, même taille sur le
 * disque) ? Un créateur ne peut pas faire télécharger aux autres une adresse extérieure. Renvoie le premier problème.
 */
export async function checkServerFiles(files: { url: string; sha256: string; size: number }[]): Promise<string | null> {
  for (const f of files) {
    const prefix = `${env.PUBLIC_URL}/media/content/`;
    const m = f.url.startsWith(prefix) ? /^([0-9a-f]{64})\.(jpg|png|webp)$/.exec(f.url.slice(prefix.length)) : null;
    if (!m || m[1] !== f.sha256) return 'Fichier refusé : il doit être envoyé à PepsGoal depuis l’application.';
    const s = await stat(path.join(contentDir(), `${m[1]}.${m[2]}`)).catch(() => null);
    if (!s || s.size !== f.size) return 'Fichier introuvable sur le serveur : envoie-le à nouveau.';
  }
  return null;
}
