import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
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

export async function buildApp() {
  const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization'] }, trustProxy: true });

  await app.register(helmet, { crossOriginResourcePolicy: { policy: 'cross-origin' } });
  // Les applications mobiles n'envoient pas d'en-tête Origin : seules les origines web sont filtrées
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)), credentials: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  const mediaDir = path.resolve(env.MEDIA_DIR);
  mkdirSync(mediaDir, { recursive: true });
  await app.register(fastifyStatic, { root: mediaDir, prefix: '/media/', decorateReply: false, maxAge: '30d', immutable: true });

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

  for (const routes of [authRoutes, meRoutes, syncRoutes, friendRoutes, feedRoutes, storyRoutes, messageRoutes, e2eRoutes, miscRoutes, adminRoutes]) {
    await app.register(routes);
  }
  return app;
}
