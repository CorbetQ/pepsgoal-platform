import { createHash } from 'node:crypto';
import type { Row } from './mappers.js';

/*
 * Contenus téléchargeables : mise en forme du catalogue et du contenu complet, ETag. Fonctions pures (testées sans
 * base de données) ; les routes sont dans routes/content.ts.
 */

const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string).toISOString());

/** Entrée légère du catalogue : de quoi afficher la vitrine et savoir s'il faut retélécharger (version, taille). */
export function toCatalogItem(r: Row) {
  const files = (r.files ?? []) as { size?: number }[];
  return {
    id: r.id as string, type: r.type as string, slug: r.slug as string, version: r.version as number,
    name: r.name as string, description: r.description as string, author: r.author as string, price: r.price as number,
    size: files.reduce((s, f) => s + (f.size ?? 0), 0),
    updatedAt: iso(r.updated_at), publishedAt: iso(r.published_at)
  };
}

/**
 * Contenu complet diffusé à l'application. Pour un pack de thème, l'identifiant du pack est celui du contenu (les
 * applications s'en servent comme clé d'ambiance et de possession).
 */
export function toContent(r: Row) {
  const content = { ...(r.content ?? {}) } as Record<string, unknown>;
  if (r.type === 'theme_pack') content.id = r.id;
  return { ...toCatalogItem(r), status: r.status as string, content, files: r.files ?? [] };
}

/** Vue d'administration : tout, y compris le statut et les dates de création. */
export function toAdminContent(r: Row) {
  return { ...toContent(r), createdAt: iso(r.created_at), createdBy: r.created_by ?? null };
}

/** ETag fort calculé sur le corps : identique tant que la réponse ne change pas. */
export function etagOf(body: unknown): string {
  return '"' + createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27) + '"';
}

/** If-None-Match correspond-il à l'ETag ? (liste séparée par des virgules, « * », préfixe faible W/ toléré) */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const values = (Array.isArray(header) ? header.join(',') : header).split(',').map(s => s.trim().replace(/^W\//, ''));
  return values.includes('*') || values.includes(etag);
}

/** Corps de la réponse du catalogue (les dates en ISO 8601, `cursor` à renvoyer comme `since` au prochain appel). */
export function catalogBody(items: Row[], removed: Row[], opts: { offset: number; limit: number; hasMore: boolean }) {
  const all = [...items, ...removed];
  const cursor = all.reduce<string | null>((m, r) => { const t = iso(r.updated_at); return t && (!m || t > m) ? t : m; }, null);
  return {
    schemaVersion: 1,
    items: items.map(toCatalogItem),
    removed: removed.map(r => r.id as string),
    cursor,
    next: opts.hasMore ? opts.offset + opts.limit : null
  };
}
