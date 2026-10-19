import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { requireUser } from '../lib/guards.js';
import { forecast, searchPlaces } from '../lib/weather.js';

const unavailable = () => new HttpError(502, 'weather_unavailable', 'Météo indisponible pour le moment, réessaie dans un instant.');

/** Météo de la ville choisie dans les réglages (relais Open-Meteo, voir lib/weather.ts). */
export default async function weatherRoutes(app: FastifyInstance) {
  app.get('/v1/weather/places', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
    try { return await searchPlaces(q); } catch (e) { req.log.warn(e); throw unavailable(); }
  });

  app.get('/v1/weather', { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const { lat, lon } = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }).parse(req.query);
    try { return await forecast(lat, lon); } catch (e) { req.log.warn(e); throw unavailable(); }
  });
}
