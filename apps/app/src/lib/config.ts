/** Adresse de l'API, injectée au build (voir eas.json). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
export const APP_VERSION = '1.1.0';
/** Site public : pages légales exigées par les stores. */
export const SITE_URL = 'https://pepsgoal.fr';
export const LEGAL_URLS = { cgu: `${SITE_URL}/cgu`, mentions: `${SITE_URL}/mentions-legales`, privacy: `${SITE_URL}/confidentialite` };
/** Intervalle de synchronisation automatique quand l'app est ouverte et en ligne. */
export const SYNC_INTERVAL_MS = 60_000;
