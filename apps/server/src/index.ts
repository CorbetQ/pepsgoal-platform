import { buildApp } from './app.js';
import { bootstrap, housekeeping } from './bootstrap.js';
import { sql } from './db/client.js';
import { env } from './env.js';
import { aprilFools } from './lib/eggs.js';
import { sendReminders, vapidKeys } from './lib/push.js';

const app = await buildApp();
await bootstrap(app.log);
await app.listen({ port: env.PORT, host: '0.0.0.0' });

const timer = setInterval(() => { housekeeping().catch(err => app.log.error(err)); }, 3600e3);
await vapidKeys().catch(err => app.log.error(err));
// Rappels du matin et du soir et début des objectifs Période (notifications push), vérifiés chaque minute selon l'heure locale de chaque compte
let remindersBusy = false;
const reminders = setInterval(() => {
  if (remindersBusy) return;   // un passage encore en cours : pas de chevauchement (ni de doublon)
  remindersBusy = true;
  Promise.allSettled([sendReminders(), aprilFools()])
    .then(r => r.forEach(x => { if (x.status === 'rejected') app.log.error(x.reason); }))
    .finally(() => { remindersBusy = false; });
}, 60e3);
void aprilFools().catch(err => app.log.error(err));

async function shutdown(signal: string) {
  app.log.info(`${signal} reçu, arrêt en cours…`);
  clearInterval(timer); clearInterval(reminders);
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
