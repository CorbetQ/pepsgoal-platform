import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit contenir au moins 32 caractères'),
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  MEDIA_DIR: z.string().default('./media'),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),
  MIN_APP_VERSION: z.string().default('1.1.0'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  // false derrière PgBouncer en mode « transaction » (pas de requêtes préparées nommées)
  DB_PREPARE: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  // E-mails de modération (signalements, publications à valider, débannissements). Sans SMTP_HOST : désactivés.
  MOD_EMAIL: z.string().email().or(z.literal('')).default('quentin-corbet@outlook.fr'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_MAX_PER_HOUR: z.coerce.number().int().min(1).default(30),
  APP_URL: z.string().url().default('https://app.pepsgoal.fr'),
  // Notifications push : clés générées et gardées en base si absentes
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:quentin-corbet@outlook.fr'),
  // Mise à jour du serveur depuis Modération › Serveur (version web) : SSH root vers la machine hôte
  UPDATE_SSH_HOST: z.string().default('host.docker.internal'),
  UPDATE_SSH_PORT: z.coerce.number().int().default(22),
  // Empreinte SHA256 de la clé d'hôte SSH (« ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub ») ; vide : réseau Docker interne
  UPDATE_SSH_FINGERPRINT: z.string().optional(),
  UPDATE_SCRIPT: z.string().default('/opt/pepsgoal/deploy/update.sh'),
  UPDATE_LOG: z.string().default('/app/update-logs/update.log')
}).superRefine((e, ctx) => {
  if (e.NODE_ENV === 'production' && (!e.ADMIN_BOOTSTRAP_PASSWORD || e.ADMIN_BOOTSTRAP_PASSWORD.length < 12)) {
    ctx.addIssue({ code:'custom', path:['ADMIN_BOOTSTRAP_PASSWORD'], message:'Obligatoire en production (12 caractères minimum).' });
  }
});

export const env = Env.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
