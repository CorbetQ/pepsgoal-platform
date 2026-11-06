import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CatalogQuery, ContentCreateBody, ContentRejectBody, ContentStatus, ContentType, ContentUpdateBody, Id, validateContent } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { me, requireAdmin, requireSocial } from '../lib/guards.js';
import { storeContentMedia } from '../lib/content-media.js';
import { logMod, notify } from '../lib/notify.js';
import { catalogBody, etagMatches, etagOf, toAdminContent, toContent } from '../lib/content.js';
import type { Row } from '../lib/mappers.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
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
      select id, type, slug, version, name, description, author, price, content, files, creator_id, sales, updated_at, published_at from content_items
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

  /* ---------- achats (10.0) ---------- */

  /**
   * Achat ou obtention d'un contenu. Le porte-monnaie de flammes vit dans l'application : le serveur vérifie un
   * plafond (flammes gagnées + ventes − achats en ligne ≥ prix), enregistre l'achat une seule fois et 100 % du prix
   * revient au créateur (relevé par GET /v1/creator/sales). Rejouer la requête renvoie l'achat déjà fait.
   */
  app.post('/v1/content/:id/purchase', { preHandler: requireSocial, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const u = me(req);
    const out = await sql.begin(async tx => {
      const [it] = await tx<Row[]>`select id, name, price, creator_id, status from content_items where id = ${id} for update`;
      if (!it || it.status !== 'published') throw notFound('Ce contenu n’est plus disponible.');
      if (it.creator_id === u.id) throw new HttpError(409, 'own_item', 'C’est ton propre pack : il est déjà à toi.');
      const [had] = await tx<Row[]>`select id, price, created_at from content_purchases where content_id = ${id} and buyer_id = ${u.id}`;
      if (had) return { purchase: had, fresh: false, item: it };
      const price = it.price as number;
      if (price > 0) {
        const [b] = await tx<Row[]>`
          select (select coalesce(sum(points), 0) from checkins where user_id = ${u.id} and deleted_at is null and pending = false)::int
               + (select coalesce(sum(price), 0) from content_purchases where seller_id = ${u.id})::int
               - (select coalesce(sum(price), 0) from content_purchases where buyer_id = ${u.id})::int as balance`;
        if ((b?.balance ?? 0) < price) throw new HttpError(402, 'insufficient', 'Pas assez de flammes pour ce pack.');
      }
      const [p] = await tx<Row[]>`
        insert into content_purchases (content_id, buyer_id, seller_id, price) values (${id}, ${u.id}, ${it.creator_id ?? null}, ${price})
        returning id, price, created_at`;
      await tx`update content_items set sales = sales + 1 where id = ${id}`;
      return { purchase: p!, fresh: true, item: it };
    });
    if (out.fresh && out.item.creator_id) {
      const price = out.purchase.price as number;
      await notify(sql, out.item.creator_id, 'shop', price > 0
        ? `🛍️ ${u.displayName} a acheté ton pack « ${out.item.name} » : +${price} flammes pour toi !`
        : `🎁 ${u.displayName} a obtenu ton pack « ${out.item.name} ».`, { contentId: id });
    }
    reply.status(out.fresh ? 201 : 200);
    return { id: out.purchase.id, contentId: id, price: out.purchase.price, createdAt: new Date(out.purchase.created_at).toISOString(), fresh: out.fresh };
  });

  // Contenus achetés ou obtenus par le compte : la collection se retrouve sur un nouvel appareil
  app.get('/v1/me/content-purchases', { preHandler: requireSocial }, async req => {
    const rows = await sql<Row[]>`select content_id, price, created_at from content_purchases where buyer_id = ${me(req).id} order by created_at`;
    return rows.map(r => ({ contentId: r.content_id as string, price: r.price as number, createdAt: new Date(r.created_at).toISOString() }));
  });

  /* ---------- administration ---------- */

  app.get('/v1/admin/content', pre, async req => {
    const q = z.object({ type: ContentType.optional(), status: ContentStatus.optional() }).parse(req.query);
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
    const stored = await storeContentMedia(await file.toBuffer());
    if (!stored) throw badRequest('Format non pris en charge : JPEG, PNG ou WebP uniquement.');
    reply.status(201);
    return stored;
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
      update content_items set status = 'published', review_note = '', published_at = coalesce(published_at, now()), updated_at = now() where id = ${id} returning *`;
    // Pack d'un créateur validé : il est prévenu, son pack est en vente
    if (cur.creator_id && cur.status !== 'published') {
      await notify(sql, cur.creator_id, 'shop', `🎨 Ton pack « ${cur.name} » est en vente dans la boutique PepsGoal !`, { contentId: id });
      await logMod(sql, me(req).id, 'content_publish', cur.creator_id, cur.name);
    }
    return toAdminContent(r!);
  });

  // Refus d'un pack de créateur : motif gardé et transmis au créateur, qui peut corriger puis republier
  app.post('/v1/admin/content/:id/reject', pre, async req => {
    const { id } = params(req.params);
    const { reason } = ContentRejectBody.parse(req.body);
    const [r] = await sql<Row[]>`update content_items set status = 'rejected', review_note = ${reason}, updated_at = now() where id = ${id} returning *`;
    if (!r) throw notFound('Contenu introuvable.');
    if (r.creator_id) {
      await notify(sql, r.creator_id, 'shop', `Ton pack « ${r.name} » n’a pas été accepté : ${reason}`, { contentId: id });
      await logMod(sql, me(req).id, 'content_reject', r.creator_id, `${r.name} : ${reason}`);
    }
    return toAdminContent(r);
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
