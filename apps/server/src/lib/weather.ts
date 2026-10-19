/**
 * Météo (carte « Aujourd'hui » et thème Météo) : relais vers Open-Meteo (https://open-meteo.com, sans clé, données
 * sous licence CC BY 4.0). Le serveur interroge Open-Meteo à la place des applications : les adresses IP des
 * utilisateurs ne lui sont pas transmises, et les réponses sont mises en cache (10 minutes, 24 heures pour les villes).
 */
const cache = new Map<string, { at: number; data: unknown }>();
const MAX_ENTRIES = 2000;

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'PepsGoal (+https://pepsgoal.fr)' } });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await load();
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface Place { name: string; admin1: string; country: string; cc: string; lat: number; lon: number; tz: string }

export function searchPlaces(q: string): Promise<Place[]> {
  const query = q.trim().slice(0, 60);
  return cached(`q:${query.toLowerCase()}`, 24 * 3600e3, async () => {
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=fr&format=json`);
    return ((j.results ?? []) as any[]).map(r => ({
      name: String(r.name ?? ''), admin1: String(r.admin1 ?? ''), country: String(r.country ?? ''), cc: String(r.country_code ?? ''),
      lat: Number(r.latitude), lon: Number(r.longitude), tz: String(r.timezone ?? '')
    })).filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  });
}

export function forecast(lat: number, lon: number) {
  const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;
  return cached(`f:${la},${lo}`, 10 * 60e3, async () => {
    const j = await getJson('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
      latitude: String(la), longitude: String(lo), timezone: 'auto', forecast_days: '4', wind_speed_unit: 'kmh',
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,cloud_cover',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    }));
    const c = j.current ?? {}, d = j.daily ?? {};
    return {
      tz: String(j.timezone ?? ''), utcOffset: Number(j.utc_offset_seconds ?? 0),
      current: { time: c.time, temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, isDay: !!c.is_day, precip: c.precipitation, code: c.weather_code, wind: c.wind_speed_10m, clouds: c.cloud_cover },
      daily: ((d.time ?? []) as string[]).map((day, i) => ({
        day, code: d.weather_code?.[i], max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i],
        pop: d.precipitation_probability_max?.[i] ?? null, sunrise: d.sunrise?.[i], sunset: d.sunset?.[i]
      })),
      fetchedAt: new Date().toISOString()
    };
  });
}
