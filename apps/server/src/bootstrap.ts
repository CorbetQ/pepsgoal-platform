import { sql } from './db/client.js';
import { env } from './env.js';
import { hashPassword } from './lib/auth.js';

/** Crée au premier démarrage le compte « PepsGoal Officiel » (sans mot de passe) et le compte admin. */
export async function bootstrap(log: { warn: (msg: string) => void; info: (msg: string) => void }): Promise<void> {
  const [official] = await sql`select 1 from users where role = 'official'`;
  if (!official) {
    await sql`insert into users (username, display_name, role, bio) values ('pepsgoal', 'PepsGoal Officiel', 'official', 'Le compte officiel de PepsGoal : nouveautés et messages de la modération.')`;
    log.info('Compte PepsGoal Officiel créé.');
  }
  const [admin] = await sql`select 1 from users where role = 'admin'`;
  if (!admin) {
    const password = env.ADMIN_BOOTSTRAP_PASSWORD || 'password';
    await sql`insert into users (username, display_name, role, password_hash) values ('admin', 'Modération PepsGoal', 'admin', ${await hashPassword(password)})`;
    if (!env.ADMIN_BOOTSTRAP_PASSWORD) log.warn('Compte admin créé avec le mot de passe de développement « password » : à changer immédiatement (POST /v1/auth/password).');
    else log.info('Compte admin créé avec ADMIN_BOOTSTRAP_PASSWORD.');
  }
}

/** Tâches périodiques : stories expirées, anciennes notifications, jetons et opérations de synchronisation périmés. */
export async function housekeeping(): Promise<void> {
  await sql`delete from stories where expires_at < now() - interval '1 day'`;
  await sql`delete from notifications where read_at is not null and created_at < now() - interval '90 days'`;
  await sql`delete from refresh_tokens where expires_at < now() or revoked_at < now() - interval '7 days'`;
  await sql`delete from sync_ops where applied_at < now() - interval '30 days'`;
}
