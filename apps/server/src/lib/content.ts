import { createHash } from 'node:crypto';
import type { Row } from './mappers.js';

/*
 * Contenus téléchargeables : mise en forme du catalogue et du contenu complet, ETag. Fonctions pures (testées sans
 * base de données) ; les routes sont dans routes/content.ts.
 */

const iso = (d: unknown): string | null => (d == null ? null : new Date(d as string).toISOString());

/** Entrée légère du catalogue : de quoi afficher la vitrine et savoir s'il faut retélécharger (version, taille). */
export function toCatalogItem(r: Row) {
  const files = (r.files ?? []) as { name?: string; url?: string; size?: number }[];
  return {
    id: r.id as string, type: r.type as string, slug: r.slug as string, version: r.version as number,
    name: r.name as string, description: r.description as string, author: r.author as string, price: r.price as number,
    size: files.reduce((s, f) => s + (f.size ?? 0), 0),
    updatedAt: iso(r.updated_at), publishedAt: iso(r.published_at),
    // 10.0 : créateur (null : contenu officiel), ventes et image d'aperçu affichables avant le téléchargement
    creatorId: (r.creator_id as string | null | undefined) ?? null,
    sales: (r.sales as number | undefined) ?? 0,
    preview: previewUrl(r.type as string, r.content as Record<string, unknown> | undefined, files)
  };
}

/** Adresse de l'image principale (fond du pack ou fond seul), pour la vitrine. */
export function previewUrl(type: string, content: Record<string, unknown> | undefined, files: { name?: string; url?: string }[]): string | null {
  if (!content) return null;
  const name = type === 'theme_pack' ? (content.wallpaper as { kind?: string; file?: string } | undefined)?.file : type === 'background' ? content.file as string | undefined : undefined;
  return (name && files.find(f => f.name === name)?.url) || null;
}

/** Vue du créateur : son pack, son statut, le motif d'un refus et ce qu'il lui a rapporté. */
export function toCreatorItem(r: Row) {
  return { ...toContent(r), reviewNote: (r.review_note as string) ?? '', earned: Number(r.earned ?? 0), createdAt: iso(r.created_at) };
}

/** Vente vue par le créateur : de quoi créditer son porte-monnaie une seule fois (id) et le prévenir. */
export function toSale(r: Row) {
  return { id: r.id as string, contentId: r.content_id as string, name: (r.name as string) ?? '', price: r.price as number, buyer: (r.buyer as string) ?? '', createdAt: iso(r.created_at) };
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
  return { ...toContent(r), createdAt: iso(r.created_at), createdBy: r.created_by ?? null, reviewNote: r.review_note ?? '' };
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
