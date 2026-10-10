/**
 * Applique les migrations SQL du dossier `drizzle/` (sans drizzle-kit, absent de l'image de production).
 * Lancé automatiquement avant le serveur au démarrage du conteneur ; sans effet si la base est à jour.
 * Client dédié : le client principal (db/client.ts) n'est jamais enveloppé par drizzle.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant.'); process.exit(1); }

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle') });
  console.log('Migrations appliquées : base à jour.');
} finally {
  await client.end({ timeout: 5 });
}
