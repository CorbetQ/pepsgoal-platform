import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CREATOR_MAX_ITEMS, CreatorPackBody, Id, StyleQuery } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { me, requireSocial } from '../lib/guards.js';
import { checkServerFiles, storeContentMedia } from '../lib/content-media.js';
import { toCreatorItem, toSale } from '../lib/content.js';
import { notifyAdmins } from '../lib/notify.js';
import { runStyle } from '../lib/style.js';
import type { Row } from '../lib/mappers.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
const pre = { preHandler: requireSocial };

/** Calculs « PepsGoal Style » en cours : deux à la fois au plus (le processeur du serveur est partagé). */
let styleRunning = 0;
const STYLE_MAX_PARALLEL = 2;

/** Slug unique d'un pack de créateur : jamais choisi par le créateur (pas de collision, pas de nom trompeur). */
const creatorSlug = () => `c-${randomBytes(6).toString('hex')}`;

/**
 * Boutique des créateurs (10.0) : chaque utilisateur peut publier ses packs de thème (photo comprise), fixer un prix
 * en flammes (0 à 5000) et touche 100 % de chaque achat. Toutes les images sont calculées ici, jamais sur le
 * téléphone : la création d'un pack demande donc une connexion. Voir docs/content-api.md.
 */
export default async function creatorRoutes(app: FastifyInstance) {
  // Photo du pack (déjà réduite par l'application) : rangée sous son empreinte, à citer ensuite dans `files`
  app.post('/v1/creator/media', { ...pre, config: { rateLimit: { max: 40, timeWindow: '1 hour' } } }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('Aucun fichier reçu.');
    const stored = await storeContentMedia(await file.toBuffer(), 'photo');
    if (!stored) throw badRequest('Format non pris en charge : JPEG, PNG ou WebP uniquement.');
    reply.status(201);
    return stored;
  });

  /**
   * « PepsGoal Style » : la photo envoyée est stylisée dans le style des fonds PepsGoal (stylize) et son ciel est
   * découpé pour y faire passer la météo (weather). Les deux sont désactivables. Réponse : les fichiers prêts à citer
   * dans un pack (`image`, `foreground` s'il y a un ciel), les couleurs proposées et la part de ciel.
   */
  app.post('/v1/style', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const q = StyleQuery.parse(req.query);
    const file = await req.file();
    if (!file) throw badRequest('Aucune photo reçue.');
    const buf = await file.toBuffer();
    if (styleRunning >= STYLE_MAX_PARALLEL) throw new HttpError(503, 'busy', 'PepsGoal Style est très demandé : réessaie dans quelques secondes.');
    styleRunning++;
    try {
      const r = await runStyle(buf, q).catch(e => { req.log.warn({ err: e }, 'style'); throw badRequest('Cette photo n’a pas pu être lue : essaie avec une autre (JPEG, PNG ou WebP).'); });
      const image = await storeContentMedia(r.image, r.stylized ? 'style' : 'photo');
      const foreground = r.foreground ? await storeContentMedia(r.foreground, 'premier-plan') : null;
      reply.status(201);
      return { image, foreground, colors: r.colors, skyRatio: r.skyRatio, width: r.width, height: r.height, stylized: r.stylized, weather: r.weather };
    } finally { styleRunning--; }
  });

  app.get('/v1/creator/items', pre, async req => {
    const rows = await sql<Row[]>`
      select c.*, coalesce((select sum(price) from content_purchases p where p.content_id = c.id), 0)::int as earned
      from content_items c where c.creator_id = ${me(req).id} and c.status <> 'retired' order by c.updated_at desc`;
    return rows.map(toCreatorItem);
  });

  // Nouveau pack : en attente de la modération (CREATOR_REVIEW, par défaut) ou publié tout de suite
  app.post('/v1/creator/items', { ...pre, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const u = me(req);
    const b = CreatorPackBody.parse(req.body);
    const bad = await checkServerFiles(b.files);
    if (bad) throw badRequest(bad);
    const [n] = await sql<Row[]>`select count(*)::int as n from content_items where creator_id = ${u.id} and status <> 'retired'`;
    if ((n?.n ?? 0) >= CREATOR_MAX_ITEMS) throw new HttpError(409, 'too_many', `Tu as déjà ${CREATOR_MAX_ITEMS} packs en boutique : retires-en un pour en publier un autre.`);
    const status = env.CREATOR_REVIEW ? 'pending' : 'published';
    const content = { ...b.content, author: u.displayName };
    const [r] = await sql<Row[]>`
      insert into content_items (type, slug, name, description, author, price, status, content, files, created_by, creator_id, published_at)
      values ('theme_pack', ${creatorSlug()}, ${b.name}, ${b.description}, ${u.displayName}, ${b.price}, ${status}, ${sql.json(content as never)},
        ${sql.json(b.files as never)}, ${u.id}, ${u.id}, ${status === 'published' ? sql`now()` : null})
      returning *, 0 as earned`;
    if (status === 'pending') await notifyAdmins(sql, `Pack à valider : « ${b.name} » de ${u.displayName}`, { subject: `Pack à valider : ${b.name}`, details: [['Créateur', `${u.displayName} (@${u.username})`], ['Prix', `${b.price} flammes`], ['Où', 'Modération › Boutique']] });
    return reply.status(201).send(toCreatorItem(r!));
  });

  // Modification : nouvelle version ; un pack déjà en vente repasse en modération si son contenu ou ses images changent
  app.put('/v1/creator/items/:id', pre, async req => {
    const u = me(req); const { id } = params(req.params);
    const b = CreatorPackBody.parse(req.body);
    const [cur] = await sql<Row[]>`select * from content_items where id = ${id} and creator_id = ${u.id} and status <> 'retired'`;
    if (!cur) throw notFound('Pack introuvable.');
    const bad = await checkServerFiles(b.files);
    if (bad) throw badRequest(bad);
    const changed = JSON.stringify(cur.files) !== JSON.stringify(b.files) || cur.name !== b.name || cur.description !== b.description;
    const status = env.CREATOR_REVIEW && (changed || cur.status === 'rejected') ? 'pending' : cur.status === 'rejected' ? 'published' : cur.status;
    const content = { ...b.content, author: u.displayName };
    const [r] = await sql<Row[]>`
      update content_items set name = ${b.name}, description = ${b.description}, price = ${b.price}, content = ${sql.json(content as never)},
        files = ${sql.json(b.files as never)}, author = ${u.displayName}, status = ${status}, review_note = '', version = version + 1, updated_at = now(),
        published_at = case when ${status} = 'published' then coalesce(published_at, now()) else published_at end
      where id = ${id}
      returning *, coalesce((select sum(price) from content_purchases p where p.content_id = ${id}), 0)::int as earned`;
    if (status === 'pending' && cur.status !== 'pending') await notifyAdmins(sql, `Pack modifié à valider : « ${b.name} » de ${u.displayName}`);
    return toCreatorItem(r!);
  });

  // Retrait de la boutique : ceux qui l'ont acheté le gardent (le catalogue annonce le retrait, leur copie reste)
  app.delete('/v1/creator/items/:id', pre, async req => {
    const u = me(req); const { id } = params(req.params);
    const [cur] = await sql<Row[]>`select id, published_at, sales from content_items where id = ${id} and creator_id = ${u.id}`;
    if (!cur) throw notFound('Pack introuvable.');
    if (cur.published_at == null && !cur.sales) { await sql`delete from content_items where id = ${id}`; return { ok: true, deleted: true }; }
    await sql`update content_items set status = 'retired', updated_at = now() where id = ${id}`;
    return { ok: true, retired: true };
  });

  /**
   * Ventes du créateur, les plus anciennes d'abord : l'application crédite chaque vente une seule fois (par son id)
   * et garde `cursor` pour la prochaine relève. Les achats gratuits sont listés aussi (prix 0).
   */
  app.get('/v1/creator/sales', pre, async req => {
    const q = z.object({ since: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    const rows = await sql<Row[]>`
      select p.id, p.content_id, p.price, p.created_at, c.name, b.display_name as buyer
      from content_purchases p join content_items c on c.id = p.content_id left join users b on b.id = p.buyer_id
      where p.seller_id = ${me(req).id} and (${q.since ?? null}::timestamptz is null or date_trunc('milliseconds', p.created_at) > ${q.since ?? null})
      order by p.created_at, p.id limit ${q.limit}`;
    const [t] = await sql<Row[]>`select coalesce(sum(price), 0)::int as total, count(*)::int as n from content_purchases where seller_id = ${me(req).id}`;
    const sales = rows.map(toSale);
    return { sales, cursor: sales.at(-1)?.createdAt ?? q.since ?? null, total: t?.total ?? 0, count: t?.n ?? 0 };
  });
}
