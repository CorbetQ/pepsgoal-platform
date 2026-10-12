import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env.js';

/**
 * E-mails de modération (signalement, publication à valider, demande de débannissement) envoyés à MOD_EMAIL.
 * Sans configuration SMTP, rien n'est envoyé : l'événement est seulement écrit dans les journaux.
 * Les envois ne bloquent jamais la requête de l'utilisateur et sont plafonnés (MAIL_MAX_PER_HOUR).
 */
let transport: Transporter | null = null;
const sentAt: number[] = [];

function transporter(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });
  return transport;
}

export function mailConfigured(): boolean { return !!transporter() && !!env.MOD_EMAIL; }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ModMail {
  /** Objet, sans préfixe (« [PepsGoal] » est ajouté). */
  subject: string;
  /** Lignes « libellé : valeur » affichées dans l'e-mail. */
  details?: [string, string][];
  /** Contenu concerné (extrait), affiché en citation. */
  excerpt?: string;
}

export function sendModMail(m: ModMail): void {
  const t = transporter();
  if (!t || !env.MOD_EMAIL) return;
  const now = Date.now();
  while (sentAt.length && sentAt[0]! < now - 3600_000) sentAt.shift();
  if (sentAt.length >= env.MAIL_MAX_PER_HOUR) { console.warn(`[mail] plafond atteint (${env.MAIL_MAX_PER_HOUR}/h) : « ${m.subject} » non envoyé`); return; }
  sentAt.push(now);
  const link = `${env.APP_URL}/`;
  const details = m.details ?? [];
  const text = [
    m.subject, '',
    ...details.map(([k, v]) => `${k} : ${v}`),
    ...(m.excerpt ? ['', 'Contenu :', `« ${m.excerpt} »`] : []),
    '', `À traiter dans PepsGoal › Modération : ${link}`
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#10102A">
<h2 style="margin:0 0 12px;font-size:18px">${esc(m.subject)}</h2>
${details.length ? `<table style="border-collapse:collapse">${details.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td style="padding:2px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>` : ''}
${m.excerpt ? `<blockquote style="margin:14px 0;padding:10px 14px;border-left:4px solid #FF4A12;background:#FFF4EE">${esc(m.excerpt)}</blockquote>` : ''}
<p style="margin-top:16px"><a href="${esc(link)}" style="color:#FF4A12;font-weight:700">Ouvrir la modération PepsGoal</a></p>
<p style="color:#888;font-size:12px">E-mail automatique du serveur PepsGoal. Il ne contient jamais de message privé.</p></div>`;
  t.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to: env.MOD_EMAIL, subject: `[PepsGoal] ${m.subject}`, text, html })
    .catch(err => console.error(`[mail] échec de l'envoi « ${m.subject} » :`, err instanceof Error ? err.message : err));
}
