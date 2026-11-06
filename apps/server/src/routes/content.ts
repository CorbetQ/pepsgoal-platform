import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CatalogQuery, ContentCreateBody, ContentType, ContentUpdateBody, Id, validateContent } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { me, requireAdmin } from '../lib/guards.js';
import { catalogBody, etagMatches, etagOf, toAdminContent, toContent } from '../lib/content.js';
import type { Row } from '../lib/mappers.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
const MEDIA_KINDS: { ext: string; mime: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', mime: 'image/webp', test: b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' }
];
const pre = { preHandler: requireAdmin };

/** Réponse conditionnelle : 304 si l'application a déjà cette version (If-None-Match), sinon le corps et son ETag. */
function conditional(req: FastifyRequest, reply: FastifyReply, body: unknown, maxAge: number) {
  const etag = etagOf(body);
  reply.header('ETag', etag).header('Cache-Control', `public, max-age=${maxAge}`).header('Vary', 'Accept-Encoding');
  if (etagMatches(req.headers['if-none-match'], etag)) return reply.status(304).send();
  return body;
}

/** Erreur 409 lisible quand le couple (type, slug) existe déjà. */
function uniqueSlug(e: unknown): never {
  if ((e as { code?: string })?.code === '23505') throw new HttpError(409, 'slug_taken', 'Ce slug est déjà utilisé pour ce type de contenu.');
  throw e;
}

/**
 * Contenus téléchargeables (packs de thème, fonds, autocollants, icônes). Lecture publique, sans compte : le
 * catalogue léger (ETag, `since`, pagination) puis le contenu complet. Écriture réservée à la modération.
 * Voir docs/content-api.md.
 */
export default async function contentRoutes(app: FastifyInstance) {
  app.get('/v1/content/catalog', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = CatalogQuery.parse(req.query);
    const since = q.since ? new Date(q.since) : null;
    const type = q.type ?? null;
    const rows = await sql<Row[]>`
      select id, type, slug, version, name, description, author, price, files, updated_at, published_at from content_items
      where status = 'published' and (${type}::text is null or type = ${type}) and (${since}::timestamptz is null or updated_at > ${since})
      order by updated_at, id limit ${q.limit + 1} offset ${q.offset}`;
    // Retraits annoncés seulement aux appareils qui ont déjà un catalogue (`since`), sur la première page
    const removed = since && q.offset === 0 ? await sql<Row[]>`
      select id, updated_at from content_items
      where status = 'retired' and published_at is not null and updated_at > ${since} and (${type}::text is null or type = ${type})
      order by updated_at limit 500` : [];
    const body = catalogBody(rows.slice(0, q.limit), removed, { offset: q.offset, limit: q.limit, hasMore: rows.length > q.limit });
    return conditional(req, reply, body, 300);
  });

  app.get('/v1/content/:id', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const [r] = await sql<Row[]>`select * from content_items where id = ${id} and status = 'published'`;
    if (!r) throw notFound('Ce contenu n’est plus disponible.');
    return conditional(req, reply, toContent(r), 3600);
  });

  /* ---------- administration ---------- */

  app.get('/v1/admin/content', pre, async req => {
    const q = z.object({ type: ContentType.optional(), status: z.enum(['draft', 'published', 'retired']).optional() }).parse(req.query);
    const rows = await sql<Row[]>`
      select * from content_items
      where (${q.type ?? null}::text is null or type = ${q.type ?? null}) and (${q.status ?? null}::text is null or status = ${q.status ?? null})
      order by updated_at desc limit 500`;
    return rows.map(toAdminContent);
  });

  // Média d'un contenu : rangé sous son empreinte (media/content/<sha256>.<ext>), à citer ensuite dans `files`
  app.post('/v1/admin/content/media', { ...pre, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu.');
    const buf = await file.toBuffer();
    const kind = MEDIA_KINDS.find(m => m.test(buf));
    if (!kind) throw badRequest('Format non pris en charge : JPEG, PNG ou WebP uniquement.');
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const dir = path.join(path.resolve(env.MEDIA_DIR), 'content');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${sha256}.${kind.ext}`), buf);
    reply.status(201);
    return { name: `${sha256.slice(0, 16)}.${kind.ext}`, url: `${env.PUBLIC_URL}/media/content/${sha256}.${kind.ext}`, sha256, size: buf.length, mime: kind.mime };
  });

  app.get('/v1/admin/content/:id', pre, async req => {
    const { id } = params(req.params);
    const [r] = await sql<Row[]>`select * from content_items where id = ${id}`;
    if (!r) throw notFound('Contenu introuvable.');
    return toAdminContent(r);
  });

  app.post('/v1/admin/content', pre, async (req, reply) => {
    const b = ContentCreateBody.parse(req.body);
    const v = validateContent(b.type, b.content, b.files);
    if (!v.ok) throw badRequest(v.issues.join(' · '));
    const [r] = await sql<Row[]>`
      insert into content_items (type, slug, name, description, author, price, status, content, files, created_by, published_at)
      values (${b.type}, ${b.slug}, ${b.name}, ${b.description}, ${b.author}, ${b.price}, ${b.status}, ${sql.json(v.content as never)},
        ${sql.json(b.files as never)}, ${me(req).id}, ${b.status === 'published' ? sql`now()` : null})
      returning *`.catch(uniqueSlug);
    return reply.status(201).send(toAdminContent(r!));
  });

  // Modification : la version augmente, l'application retélécharge le contenu à sa prochaine relève
  app.put('/v1/admin/content/:id', pre, async req => {
    const { id } = params(req.params);
    const b = ContentUpdateBody.parse(req.body);
    const [cur] = await sql<Row[]>`select * from content_items where id = ${id}`;
    if (!cur) throw notFound('Contenu introuvable.');
    const content = b.content ?? cur.content; const files = b.files ?? cur.files;
    const v = validateContent(cur.type, content, files);
    if (!v.ok) throw badRequest(v.issues.join(' · '));
    const [r] = await sql<Row[]>`
      update content_items set slug = ${b.slug ?? cur.slug}, name = ${b.name ?? cur.name}, description = ${b.description ?? cur.description},
        author = ${b.author ?? cur.author}, price = ${b.price ?? cur.price}, content = ${sql.json(v.content as never)}, files = ${sql.json(files as never)},
        version = version + 1, updated_at = now()
      where id = ${id} returning *`.catch(uniqueSlug);
    return toAdminContent(r!);
  });

  app.post('/v1/admin/content/:id/publish', pre, async req => {
    const { id } = params(req.params);
    const [cur] = await sql<Row[]>`select * from content_items where id = ${id}`;
    if (!cur) throw notFound('Contenu introuvable.');
    const v = validateContent(cur.type, cur.content, cur.files);
    if (!v.ok) throw badRequest(v.issues.join(' · '));
    const [r] = await sql<Row[]>`
      update content_items set status = 'published', published_at = coalesce(published_at, now()), updated_at = now() where id = ${id} returning *`;
    return toAdminContent(r!);
  });

  app.post('/v1/admin/content/:id/retire', pre, async req => {
    const { id } = params(req.params);
    const [r] = await sql<Row[]>`update content_items set status = 'retired', updated_at = now() where id = ${id} returning *`;
    if (!r) throw notFound('Contenu introuvable.');
    return toAdminContent(r);
  });

  // Jamais publié : suppression définitive. Déjà publié : retiré (les appareils sont prévenus par le catalogue).
  app.delete('/v1/admin/content/:id', pre, async req => {
    const { id } = params(req.params);
    const [cur] = await sql<Row[]>`select id, published_at from content_items where id = ${id}`;
    if (!cur) throw notFound('Contenu introuvable.');
    if (cur.published_at == null) { await sql`delete from content_items where id = ${id}`; return { ok: true, deleted: true }; }
    await sql`update content_items set status = 'retired', updated_at = now() where id = ${id}`;
    return { ok: true, retired: true };
  });
}
