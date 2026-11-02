import path from 'node:path';
import { createReadStream, mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOrigins, env } from './env.js';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import syncRoutes from './routes/sync.js';
import friendRoutes from './routes/friends.js';
import feedRoutes from './routes/feed.js';
import storyRoutes from './routes/stories.js';
import messageRoutes from './routes/messages.js';
import miscRoutes from './routes/account-misc.js';
import adminRoutes from './routes/admin.js';
import e2eRoutes from './routes/e2e.js';
import groupRoutes from './routes/groups.js';
import pushRoutes from './routes/push.js';
import weatherRoutes from './routes/weather.js';
import challengeRoutes from './routes/challenges.js';
import leagueRoutes from './routes/leagues.js';
import { mediaFile, verifyMediaSignature } from './lib/media.js';
import { recordResponse } from './lib/metrics.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] }, trustProxy: env.TRUST_PROXY.split(',').map(s => s.trim()).filter(Boolean) });

  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  // Les applications mobiles n'envoient pas d'en-tête Origin : seules les origines web sont filtrées
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)), credentials: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  mkdirSync(path.resolve(env.MEDIA_DIR), { recursive: true });
  /**
   * Images (photos de profil, publications, stories) : uniquement avec une adresse signée et temporaire, remise par
   * l'API à ceux qui ont le droit de voir le contenu. Les pièces jointes chiffrées passent par /v1/attachments.
   */
  const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  app.get('/media/:name', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const { e, s } = req.query as { e?: string; s?: string };
    const ttl = verifyMediaSignature(name, e, s);
    if (!ttl) return reply.status(403).send({ error: 'forbidden', message: 'Lien d’image expiré ou invalide.' });
    const file = mediaFile(name), st = await stat(file).catch(() => null);
    if (!st?.isFile()) return reply.status(404).send({ error: 'not_found', message: 'Image introuvable.' });
    reply.header('Content-Type', TYPES[name.split('.').pop()!]!).header('Content-Length', st.size).header('Cache-Control', `private, max-age=${ttl}`);
    return reply.send(createReadStream(file));
  });

  // Réponses de l'API (données du compte, jetons de session) : jamais gardées par un cache intermédiaire ou le navigateur
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/v1/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });

  // Compteurs de trafic (onglet Serveur de la modération)
  app.addHook('onResponse', async (_req, reply) => { recordResponse(reply.statusCode, reply.elapsedTime); });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid', message: 'Données invalides.', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    const status = (err as FastifyError).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Trop de requêtes, réessaie dans un instant.' });
    if (status && status < 500) return reply.status(status).send({ error: 'invalid', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'server', message: 'Erreur interne, réessaie plus tard.' });
  });

  for (const routes of [authRoutes, meRoutes, syncRoutes, friendRoutes, feedRoutes, storyRoutes, messageRoutes, groupRoutes, pushRoutes, weatherRoutes, challengeRoutes, leagueRoutes, e2eRoutes, miscRoutes, adminRoutes]) {
    await app.register(routes);
  }
  return app;
}
