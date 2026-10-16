import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Id, StoryBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { removeMedia } from '../lib/files.js';
import { areFriends, isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { notify } from '../lib/notify.js';
import { iso, toPublicUser, type Row } from '../lib/mappers.js';
import { env } from '../env.js';

const STORY_TTL_MS = 24 * 3600e3;
const params = (p: unknown) => z.object({ id: Id }).parse(p);

/** Stories : visibles uniquement par les amis pendant 24 heures, puis gardées un an dans l'archive de leur auteur. */
const ARCHIVE_DAYS = 365;
export default async function storyRoutes(app: FastifyInstance) {
  app.get('/v1/stories', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      with fr as (
        select case when requester_id = ${u.id} then addressee_id else requester_id end as id
        from friendships where status = 'accepted' and (requester_id = ${u.id} or addressee_id = ${u.id})
      )
      select s.*, a.username, a.display_name, a.avatar, a.role,
        exists (select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${u.id}) as seen,
        (select count(*)::int from story_views v where v.story_id = s.id) as view_count,
        (select count(*)::int from story_likes l where l.story_id = s.id) as like_count,
        exists (select 1 from story_likes l where l.story_id = s.id and l.user_id = ${u.id}) as liked
      from stories s join users a on a.id = s.author_id
      where s.expires_at > now() and a.deleted_at is null
        and (s.author_id = ${u.id} or (s.author_id in (select id from fr) and not (a.ban_permanent or coalesce(a.ban_until > now(), false))))
      order by s.created_at`;
    const byAuthor = new Map<string, Row[]>();
    for (const r of rows) byAuthor.set(r.author_id, [...(byAuthor.get(r.author_id) ?? []), r]);
    return [...byAuthor.values()].map(list => ({
      author: toPublicUser({ ...list[0]!, id: list[0]!.author_id }),
      unseen: list[0]!.author_id !== u.id && list.some(s => !s.seen),
      stories: list.map(s => ({
        id: s.id, kind: s.kind, mediaUrl: s.media_url, data: s.data, text: s.text, createdAt: iso(s.created_at), expiresAt: iso(s.expires_at),
        seen: s.seen, liked: s.liked, likeCount: s.author_id === u.id ? s.like_count : undefined, viewCount: s.author_id === u.id ? s.view_count : undefined
      }))
    }));
  });

  app.post('/v1/stories', { preHandler: requireSocial, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = StoryBody.parse(req.body);
    const u = me(req);
    if (body.kind === 'photo' && !body.mediaUrl.startsWith(`${env.PUBLIC_URL}/media/`)) throw badRequest('Image non autorisée.');
    const [s] = await sql<Row[]>`
      insert into stories (author_id, kind, media_url, data, text, expires_at)
      values (${u.id}, ${body.kind}, ${body.kind === 'photo' ? body.mediaUrl : null}, ${body.kind === 'photo' ? null : sql.json(body.data)}, ${body.text}, ${new Date(Date.now() + STORY_TTL_MS).toISOString()})
      returning id`;
    reply.status(201);
    return { id: s!.id };
  });

  app.post('/v1/stories/:id/view', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    await sql`insert into story_views (story_id, viewer_id) select ${id}, ${me(req).id} where exists (select 1 from stories where id = ${id} and expires_at > now()) on conflict do nothing`;
    return { ok: true };
  });

  app.get('/v1/stories/:id/views', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const [s] = await sql`select 1 from stories where id = ${id} and author_id = ${me(req).id}`;
    if (!s) throw notFound();
    const rows = await sql<Row[]>`select u.id, u.username, u.display_name, u.avatar, u.role,
        exists (select 1 from story_likes l where l.story_id = ${id} and l.user_id = u.id) as liked
      from story_views v join users u on u.id = v.viewer_id where v.story_id = ${id} and u.deleted_at is null order by v.seen_at`;
    return rows.map(r => ({ ...toPublicUser(r), liked: r.liked }));
  });

  /** Encourager une story d'ami (pendant ses 24 heures) ; l'auteur est prévenu une seule fois. */
  app.post('/v1/stories/:id/like', { preHandler: requireSocial, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    const [s] = await sql<Row[]>`select author_id from stories where id = ${id} and expires_at > now()`;
    if (!s) throw notFound('Story introuvable.');
    if (s.author_id === u.id) throw badRequest('Tu ne peux pas encourager ta propre story.');
    if (!(await areFriends(u.id, s.author_id)) || (await isBlocked(u.id, s.author_id))) throw forbidden('Story réservée aux amis.');
    await sql`insert into story_views (story_id, viewer_id) values (${id}, ${u.id}) on conflict do nothing`;
    const fresh = await sql`insert into story_likes (story_id, user_id) values (${id}, ${u.id}) on conflict do nothing returning story_id`;
    // Une seule notification par personne et par story, même après un retrait puis un nouvel encouragement
    const already = fresh.length && (await sql`select 1 from notifications where user_id = ${s.author_id} and type = 'story' and data->>'storyId' = ${id} and data->>'by' = ${u.id} limit 1`).length;
    if (fresh.length && !already) await notify(sql, s.author_id, 'story', `${u.displayName} a encouragé ta story 🔥`, { storyId: id, by: u.id });
    return { ok: true };
  });

  app.delete('/v1/stories/:id/like', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    await sql`delete from story_likes where story_id = ${id} and user_id = ${me(req).id}`;
    return { ok: true };
  });

  /** Mes stories, y compris expirées (archive personnelle, visible par moi seul) : un an, 200 au plus. */
  app.get('/v1/me/stories', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      select s.*, (select count(*)::int from story_views v where v.story_id = s.id) as view_count,
        (select count(*)::int from story_likes l where l.story_id = s.id) as like_count
      from stories s where s.author_id = ${u.id} and s.created_at > now() - make_interval(days => ${ARCHIVE_DAYS})
      order by s.created_at desc limit 200`;
    return rows.map(s => ({ id: s.id, kind: s.kind, mediaUrl: s.media_url, data: s.data, text: s.text, createdAt: iso(s.created_at), expiresAt: iso(s.expires_at), viewCount: s.view_count, likeCount: s.like_count }));
  });

  app.delete('/v1/stories/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const gone = await sql<Row[]>`delete from stories where id = ${id} and author_id = ${me(req).id} returning media_url`;
    await removeMedia(gone.map(g => g.media_url));
    return { ok: true };
  });
}
