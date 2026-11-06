import { describe, expect, it } from 'vitest';
import { CatalogQuery, ContentCreateBody, ContentUpdateBody, ThemePackSchema, validateContent } from '@pepsgoal/shared';
import { catalogBody, etagMatches, etagOf, toCatalogItem, toContent } from '../src/lib/content.js';

// Contenus téléchargeables : format des packs, validation des corps d'administration, catalogue et ETag (sans base)
const pack = {
  schemaVersion: 1, type: 'theme_pack', name: 'Lagon', emoji: '🏝️', dark: false,
  colors: { bg: '#fff7f0', ink: '#2A1420', surface: '#FFFFFF', surface2: '#FFEDE1', edge: '#F2DED1', accent: ['#FFB000', '#FF4A12', '#FF3D96'], deco: ['#FFE2CC'] },
  wallpaper: { kind: 'gradient', colors: ['#7FD8FF', '#F7E3B5'] }
};
const file = { name: 'fond.jpg', url: 'https://api.pepsgoal.fr/media/content/fond.jpg', sha256: 'a'.repeat(64), size: 1234, mime: 'image/jpeg' };

describe('format des packs de thème', () => {
  it('accepte un pack exporté par l’application et normalise les couleurs', () => {
    const r = ThemePackSchema.parse({ ...pack, id: 'perso-abc', futur: { x: 1 } });
    expect(r.colors.bg).toBe('#FFF7F0');
    expect((r as Record<string, unknown>).futur).toEqual({ x: 1 });
  });

  it('refuse une version future, une couleur invalide ou un accent incomplet', () => {
    expect(ThemePackSchema.safeParse({ ...pack, schemaVersion: 2 }).success).toBe(false);
    expect(ThemePackSchema.safeParse({ ...pack, colors: { ...pack.colors, ink: 'noir' } }).success).toBe(false);
    expect(ThemePackSchema.safeParse({ ...pack, colors: { ...pack.colors, accent: ['#FFFFFF'] } }).success).toBe(false);
    expect(ThemePackSchema.safeParse({ ...pack, wallpaper: { kind: 'free', key: 'custom' } }).success).toBe(false);
    expect(ThemePackSchema.safeParse({ ...pack, fx: 'laser' }).success).toBe(false);
  });

  it('exige le fichier cité par un fond « image »', () => {
    const img = { ...pack, wallpaper: { kind: 'image', file: 'fond.jpg' } };
    expect(validateContent('theme_pack', img, []).ok).toBe(false);
    expect(validateContent('theme_pack', img, [file]).ok).toBe(true);
    expect(validateContent('theme_pack', { ...pack, wallpaper: { kind: 'image' } }, [file]).ok).toBe(false);
    expect(validateContent('background', { schemaVersion: 1, type: 'background', file: 'fond.jpg' }, [file]).ok).toBe(true);
    expect(validateContent('theme_pack', pack, [file, file]).ok).toBe(false);
  });
});

describe('corps d’administration', () => {
  it('crée un brouillon gratuit par défaut et valide le contenu selon son type', () => {
    const b = ContentCreateBody.parse({ type: 'theme_pack', slug: 'lagon', name: 'Lagon', content: pack });
    expect(b.status).toBe('draft'); expect(b.price).toBe(0); expect(b.files).toEqual([]);
    expect(ContentCreateBody.safeParse({ type: 'theme_pack', slug: 'lagon', name: 'Lagon', content: { ...pack, colors: {} } }).success).toBe(false);
    expect(ContentCreateBody.safeParse({ type: 'theme_pack', slug: 'Lagon !', name: 'Lagon', content: pack }).success).toBe(false);
    expect(ContentCreateBody.safeParse({ type: 'theme_pack', slug: 'lagon', name: 'Lagon', price: -5, content: pack }).success).toBe(false);
    expect(ContentCreateBody.safeParse({ type: 'video', slug: 'lagon', name: 'Lagon', content: pack }).success).toBe(false);
  });

  it('refuse un fichier sans sha256 valide et une modification vide', () => {
    expect(ContentCreateBody.safeParse({ type: 'background', slug: 'fond', name: 'Fond', content: { schemaVersion: 1, type: 'background', file: 'fond.jpg' }, files: [{ ...file, sha256: 'xyz' }] }).success).toBe(false);
    expect(ContentUpdateBody.safeParse({}).success).toBe(false);
    expect(ContentUpdateBody.safeParse({ price: 150 }).success).toBe(true);
  });

  it('borne la pagination du catalogue', () => {
    expect(CatalogQuery.parse({})).toMatchObject({ limit: 100, offset: 0 });
    expect(CatalogQuery.safeParse({ limit: '500' }).success).toBe(false);
    expect(CatalogQuery.safeParse({ since: 'hier' }).success).toBe(false);
    expect(CatalogQuery.parse({ since: '2026-11-01T10:00:00.000Z', limit: '20' }).limit).toBe(20);
  });
});

describe('catalogue et requêtes conditionnelles', () => {
  const row = (id: string, updated: string) => ({ id, type: 'theme_pack', slug: id, version: 2, name: 'N', description: '', author: 'PepsGoal', price: 150,
    files: [file], content: { ...pack, id: 'autre' }, status: 'published', updated_at: new Date(updated), published_at: new Date(updated) });

  it('donne un manifeste léger, le curseur et la page suivante', () => {
    const b = catalogBody([row('a', '2026-11-01T10:00:00Z'), row('b', '2026-11-02T10:00:00Z')], [{ id: 'c', updated_at: new Date('2026-11-03T10:00:00Z') }], { offset: 0, limit: 2, hasMore: true });
    expect(b.items).toHaveLength(2);
    expect(b.items[0]).not.toHaveProperty('content');
    expect(b.items[0]!.size).toBe(1234);
    expect(b.removed).toEqual(['c']);
    expect(b.cursor).toBe('2026-11-03T10:00:00.000Z');
    expect(b.next).toBe(2);
    expect(catalogBody([], [], { offset: 0, limit: 100, hasMore: false })).toMatchObject({ cursor: null, next: null });
  });

  it('diffuse l’identifiant du contenu comme identifiant du pack', () => {
    const c = toContent(row('9b0c1d2e-3f4a-4b5c-8d7e-1f2a3b4c5d6e', '2026-11-01T10:00:00Z'));
    expect(c.content.id).toBe('9b0c1d2e-3f4a-4b5c-8d7e-1f2a3b4c5d6e');
    expect(c.files).toHaveLength(1);
    expect(toCatalogItem(row('x', '2026-11-01T10:00:00Z')).version).toBe(2);
  });

  it('calcule un ETag stable et reconnaît If-None-Match', () => {
    const e = etagOf({ a: 1 });
    expect(etagOf({ a: 1 })).toBe(e);
    expect(etagOf({ a: 2 })).not.toBe(e);
    expect(etagMatches(e, e)).toBe(true);
    expect(etagMatches(`"x", W/${e}`, e)).toBe(true);
    expect(etagMatches('*', e)).toBe(true);
    expect(etagMatches(undefined, e)).toBe(false);
    expect(etagMatches('"x"', e)).toBe(false);
  });
});

describe('routes des contenus (sans base : refus avant toute requête SQL)', async () => {
  process.env.DATABASE_URL ??= 'postgres://x:y@localhost:5432/z';
  process.env.JWT_SECRET ??= 'x'.repeat(40);
  process.env.MEDIA_DIR ??= (await import('node:os')).tmpdir() + '/pepsgoal-test-media';
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();

  it('s’enregistrent avec les routes existantes et valident leurs paramètres', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/content/catalog?limit=500' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/v1/content/pas-un-uuid' })).statusCode).toBe(400);
  });

  it('réservent l’écriture à la modération', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/admin/content', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/v1/admin/content/9b0c1d2e-3f4a-4b5c-8d7e-1f2a3b4c5d6e', payload: { price: 1 } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/v1/admin/content/9b0c1d2e-3f4a-4b5c-8d7e-1f2a3b4c5d6e' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/content/9b0c1d2e-3f4a-4b5c-8d7e-1f2a3b4c5d6e/publish' })).statusCode).toBe(401);
    await app.close();
  });
});
