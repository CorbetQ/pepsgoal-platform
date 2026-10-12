import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CommentBody, Id, PostBody, ReportBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { env } from '../env.js';
import { isBanned, me, requireSocial, requireUser, type AuthUser } from '../lib/guards.js';
import { iso, toPublicUser, type Row } from '../lib/mappers.js';
import { notify, notifyAdmins } from '../lib/notify.js';

const FREEZE_EVERY = 10;
/** Comptes bloqués dans un sens ou dans l'autre : leurs commentaires et encouragements sont masqués. */
const notBlocked = (meId: string, col: string) => sql`not exists (select 1 from blocks b where (b.blocker_id = ${meId} and b.blocked_id = ${sql(col)}) or (b.blocker_id = ${sql(col)} and b.blocked_id = ${meId}))`;
const params = (p: unknown) => z.object({ id: Id }).parse(p);

/** Une publication est visible si elle n'est ni supprimée ni bloquée, et selon sa visibilité. */
async function visiblePost(u: AuthUser, postId: string): Promise<Row> {
  const [p] = await sql<Row[]>`
    select p.*, a.ban_until, a.ban_permanent from posts p join users a on a.id = p.author_id
    where p.id = ${postId} and p.deleted_at is null and a.deleted_at is null
      and not exists (select 1 from blocks b where (b.blocker_id = ${u.id} and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = ${u.id}))`;
  if (!p) throw notFound('Publication introuvable.');
  const own = p.author_id === u.id;
  if (!own && u.role !== 'admin') {
    if (p.status !== 'visible' || isBanned({ banUntil: p.ban_until, banPermanent: p.ban_permanent })) throw notFound('Publication introuvable.');
    if (p.visibility === 'friends') {
      const [f] = await sql`select 1 from friendships where status = 'accepted' and ((requester_id = ${u.id} and addressee_id = ${p.author_id}) or (requester_id = ${p.author_id} and addressee_id = ${u.id}))`;
      if (!f) throw notFound('Publication introuvable.');
    }
  }
  return p;
}

export default async function feedRoutes(app: FastifyInstance) {
  app.get('/v1/feed', { preHandler: requireUser }, async req => {
    const { tab, before } = z.object({ tab: z.enum(['friends', 'public']).default('friends'), before: z.string().datetime().optional() }).parse(req.query);
    const u = me(req);
    const cursor = before ?? new Date(Date.now() + 60_000).toISOString();
    const posts = await sql<Row[]>`
      with fr as (
        select case when requester_id = ${u.id} then addressee_id else requester_id end as id
        from friendships where status = 'accepted' and (requester_id = ${u.id} or addressee_id = ${u.id})
      )
      select p.*, a.username, a.display_name, a.avatar, a.role,
        (select count(*)::int from post_likes l where l.post_id = p.id) as like_count,
        exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = ${u.id}) as liked
      from posts p join users a on a.id = p.author_id
      where p.deleted_at is null and a.deleted_at is null and p.created_at < ${cursor}
        and (p.status = 'visible' or p.author_id = ${u.id})
        and (p.author_id = ${u.id} or not (a.ban_permanent or coalesce(a.ban_until > now(), false)))
        and not exists (select 1 from blocks b where (b.blocker_id = ${u.id} and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = ${u.id}))
        and ${tab === 'public'
          ? sql`p.visibility = 'public'`
          : sql`(p.author_id = ${u.id} or p.author_id in (select id from fr))`}
      order by p.created_at desc limit 20`;
    const ids = posts.map(p => p.id);
    const comments = ids.length ? await sql<Row[]>`
      select c.*, a.username, a.display_name, a.avatar, a.role from comments c join users a on a.id = c.author_id
      where c.post_id = any(${ids}) and c.deleted_at is null and a.deleted_at is null and ${notBlocked(u.id, 'c.author_id')} order by c.created_at` : [];
    // Qui a encouragé chaque publication (affiché sous la publication, comme dans l'application)
    const likers = ids.length ? await sql<Row[]>`
      select l.post_id, a.id, a.username, a.display_name, a.avatar, a.role from post_likes l join users a on a.id = l.user_id
      where l.post_id = any(${ids}) and a.deleted_at is null and ${notBlocked(u.id, 'l.user_id')} order by l.created_at` : [];
    return {
      posts: posts.map(p => ({
        id: p.id, author: toPublicUser({ ...p, id: p.author_id }), text: p.text, photoUrl: p.photo_url, visibility: p.visibility, goalId: p.goal_id, kind: p.kind,
        status: p.status, commentsLocked: p.comments_locked, createdAt: iso(p.created_at), likeCount: p.like_count, liked: p.liked,
        likers: likers.filter(l => l.post_id === p.id).slice(0, 100).map(toPublicUser),
        comments: comments.filter(c => c.post_id === p.id).slice(-20).map(c => ({ id: c.id, author: toPublicUser({ ...c, id: c.author_id }), text: c.text, createdAt: iso(c.created_at) }))
      })),
      nextBefore: posts.length === 20 ? iso(posts[posts.length - 1]!.created_at) : null
    };
  });

  app.post('/v1/posts', { preHandler: requireSocial, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = PostBody.parse(req.body);
    const u = me(req);
    if (body.goalId) {
      const [g] = await sql`select 1 from goals where id = ${body.goalId} and owner_id = ${u.id} and deleted_at is null`;
      if (!g) body.goalId = null;
    }
    // Seules les images téléversées sur ce serveur sont acceptées
    if (body.photoUrl && !body.photoUrl.startsWith(`${env.PUBLIC_URL}/media/`)) throw badRequest('Photo invalide : téléverse-la d’abord.');
    // Compte sous avertissement : la publication attend la validation de la modération
    const status = u.warnedAt ? 'pending' : 'visible';
    const [p] = await sql<Row[]>`insert into posts (author_id, text, photo_url, visibility, goal_id, status, kind) values (${u.id}, ${body.text}, ${body.photoUrl}, ${body.visibility}, ${body.goalId}, ${status}, ${body.kind}) returning id`;
    if (status === 'pending') await notifyAdmins(sql, `Nouvelle publication de ${u.displayName} à valider.`, {
      subject: `Publication à valider : ${u.displayName}`,
      details: [['Auteur', `${u.displayName} (@${u.username}), sous avertissement`], ['Visibilité', body.visibility === 'public' ? 'public' : 'amis'], ['Photo', body.photoUrl ? 'oui' : 'non']],
      excerpt: body.text.slice(0, 500) || undefined
    });
    reply.status(201);
    return { id: p!.id, status };
  });

  app.delete('/v1/posts/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const r = await sql`update posts set deleted_at = now() where id = ${id} and author_id = ${me(req).id} returning id`;
    if (!r.length) throw notFound();
    return { ok: true };
  });

  app.post('/v1/posts/:id/like', { preHandler: requireSocial }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    const p = await visiblePost(u, id);
    await sql.begin(async tx => {
      const fresh = await tx`insert into post_likes (post_id, user_id) values (${id}, ${u.id}) on conflict do nothing returning post_id`;
      if (!fresh.length || p.author_id === u.id) return;
      await notify(tx, p.author_id, 'like', `${u.displayName} a encouragé ta publication.`, { postId: id });
      // Gel de série tous les 10 encouragements reçus (un seul crédit par personne et par publication)
      const credit = await tx`insert into cheer_credits (post_id, user_id, author_id) values (${id}, ${u.id}, ${p.author_id}) on conflict do nothing returning post_id`;
      if (!credit.length) return;
      const [row] = await tx<{ n: number }[]>`select count(*)::int as n from cheer_credits where author_id = ${p.author_id}`;
      if (row && row.n % FREEZE_EVERY === 0) {
        await tx`update users set freezes = freezes + 1 where id = ${p.author_id}`;
        await notify(tx, p.author_id, 'freeze', `Tu as reçu ${FREEZE_EVERY} encouragements de plus : un gel de série t'est offert !`);
      }
    });
    return { ok: true };
  });

  app.delete('/v1/posts/:id/like', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    await sql`delete from post_likes where post_id = ${id} and user_id = ${me(req).id}`;
    return { ok: true };
  });

  app.post('/v1/posts/:id/comments', { preHandler: requireSocial, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const { text } = CommentBody.parse(req.body);
    const u = me(req);
    if (u.commentsRestricted) throw forbidden('La modération a restreint tes commentaires.', 'comments_restricted');
    const p = await visiblePost(u, id);
    if (p.comments_locked) throw forbidden('Les commentaires sont fermés sur cette publication.', 'comments_locked');
    const [c] = await sql<Row[]>`insert into comments (post_id, author_id, text) values (${id}, ${u.id}, ${text}) returning id`;
    if (p.author_id !== u.id) await notify(sql, p.author_id, 'comment', `${u.displayName} a commenté ta publication : « ${text.slice(0, 60)} »`, { postId: id });
    reply.status(201);
    return { id: c!.id };
  });

  app.delete('/v1/comments/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    // L'auteur du commentaire ou l'auteur de la publication peut le supprimer
    await sql`update comments set deleted_at = now() where id = ${id}
      and (author_id = ${u.id} or post_id in (select id from posts where author_id = ${u.id}))`;
    return { ok: true };
  });

  app.post('/v1/posts/:id/report', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const { id } = params(req.params);
    const { reason } = ReportBody.parse(req.body);
    const u = me(req);
    const p = await visiblePost(u, id);
    const r = await sql`insert into reports (post_id, reporter_id, reason) values (${id}, ${u.id}, ${reason}) on conflict do nothing returning id`;
    if (r.length) {
      const [a] = await sql<Row[]>`select username, display_name from users where id = ${p.author_id}`;
      const [n] = await sql<{ n: number }[]>`select count(*)::int as n from reports where post_id = ${id}`;
      const REASONS: Record<string, string> = { spam: 'Spam', hate: 'Propos haineux', harass: 'Harcèlement', other: 'Autre' };
      await notifyAdmins(sql, 'Une publication a été signalée.', {
        subject: `Signalement (${REASONS[reason]}) : publication de ${a?.display_name ?? 'compte supprimé'}`,
        details: [['Motif', REASONS[reason]!], ['Auteur', a ? `${a.display_name} (@${a.username})` : '—'], ['Signalé par', `${u.displayName} (@${u.username})`], ['Signalements sur cette publication', String(n?.n ?? 1)], ['Photo', p.photo_url ? 'oui' : 'non']],
        excerpt: String(p.text || '').slice(0, 500) || undefined
      });
    }
    return { ok: true };
  });
}
