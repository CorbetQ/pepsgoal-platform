import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

/** Pièces jointes chiffrées des messages : dans le dossier des médias, servies uniquement par /v1/attachments (voir app.ts). */
export const ATT_SUBDIR = 'att';
export const attachmentDir = () => path.join(path.resolve(env.MEDIA_DIR), ATT_SUBDIR);
export const attachmentPath = (id: string) => path.join(attachmentDir(), `${id}.bin`);
export async function ensureAttachmentDir(): Promise<void> { await mkdir(attachmentDir(), { recursive: true }); }
