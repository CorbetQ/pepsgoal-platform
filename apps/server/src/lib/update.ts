/**
 * Mise à jour du serveur depuis Modération › Serveur (version web) : connexion SSH en root à la machine hôte avec le
 * mot de passe saisi par l'admin (jamais gardé), lancement de deploy/update.sh en arrière-plan, puis suivi de son
 * journal (deploy/logs/update.log, monté en lecture seule dans le conteneur) : la progression reste lisible pendant que
 * l'API redémarre. L'application Android lance la même commande directement en SSH.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'ssh2';
import { env } from '../env.js';
import { HttpError } from './errors.js';

/** Commande lancée en root : script détaché (il survit au redémarrage de l'API et à la coupure SSH), journal remis à zéro. */
export function updateCommand(web: boolean, script = env.UPDATE_SCRIPT): string {
  const d = path.posix.dirname(script);
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return [
    `D=${q(d)}; L="$D/logs/update.log"; P="$D/logs/update.pid"; mkdir -p "$D/logs"`,
    `if [ -f "$P" ] && kill -0 "$(cat "$P")" 2>/dev/null; then echo "::busy"; else`,
    `: > "$L"; chmod 644 "$L"`,
    `setsid nohup sh -c "sh $D/${path.posix.basename(script)}${web ? ' --web' : ''}; echo \\"::exit \\$?\\"" >> "$L" 2>&1 < /dev/null &`,
    `echo $! > "$P"; echo "::started"; fi`
  ].join('\n');
}

export interface UpdateProgress {
  running: boolean;
  done: boolean;
  ok: boolean;
  exit: number | null;
  step: number;
  total: number;
  label: string;
  pct: number;
  lines: string[];
  at: string | null;
}

/** Lit le journal : étapes « ::step n/total », avancement de la construction Docker (« [server 3/7] ») et fin « ::exit ». */
export function parseUpdateLog(text: string): Omit<UpdateProgress, 'at'> {
  let step = 0, total = 0, label = '', sub = 0, exit: number | null = null;
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
    if (!l) continue;
    let m = /^::step (\d+)\/(\d+) (.*)$/.exec(l);
    if (m) { step = Number(m[1]); total = Number(m[2]); label = m[3] ?? ''; sub = 0; continue; }
    m = /^::exit (\d+)/.exec(l);
    if (m) { exit = Number(m[1]); continue; }
    if (l === '::done' || l === '::started' || l === '::busy') continue;
    const b = /\[[\w-]+(?: [\w-]+)? (\d+)\/(\d+)\]/.exec(l);
    if (b && Number(b[2]) > 0) sub = Math.max(sub, (Number(b[1]) - 1) / Number(b[2]));
    lines.push(l.length > 300 ? l.slice(0, 300) + '…' : l);
  }
  const done = exit !== null;
  const pct = done ? (exit === 0 ? 100 : Math.round(total ? ((step - 1) / total) * 100 : 0)) : total ? Math.min(99, Math.round(((step - 1 + Math.min(sub, 0.95)) / total) * 100)) : 0;
  return { running: !done && step > 0, done, ok: exit === 0, exit, step, total, label, pct, lines: lines.slice(-40) };
}

export async function readUpdateProgress(): Promise<UpdateProgress | null> {
  try {
    const [text, st] = await Promise.all([readFile(env.UPDATE_LOG, 'utf8'), stat(env.UPDATE_LOG)]);
    return { ...parseUpdateLog(text), at: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** Empreinte d'une clé d'hôte au format OpenSSH (SHA256:… en base64 sans « = »). */
export const fingerprint = (key: Buffer) => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

/** Se connecte en root et lance la mise à jour. Renvoie « started » ou « busy » (une mise à jour tourne déjà). */
export function startUpdate(password: string, web: boolean): Promise<'started' | 'busy'> {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let out = '', settled = false;
    const fail = (e: HttpError) => { if (!settled) { settled = true; c.end(); reject(e); } };
    c.on('ready', () => {
      c.exec(updateCommand(web), (err, ch) => {
        if (err) return fail(new HttpError(422, 'ssh', 'Commande refusée par le serveur SSH.'));
        ch.on('data', (d: Buffer) => { out += d.toString(); });
        ch.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        ch.on('close', () => {
          if (settled) return;
          settled = true; c.end();
          if (out.includes('::busy')) resolve('busy');
          else if (out.includes('::started')) resolve('started');
          else reject(new HttpError(422, 'ssh', `Lancement impossible : ${out.trim().slice(0, 200) || 'aucune réponse'}.`));
        });
      });
    });
    c.on('error', (e: Error & { level?: string }) => {
      if (e.level === 'client-authentication') fail(new HttpError(403, 'ssh_auth', 'Mot de passe root refusé (ou connexion root par mot de passe désactivée sur le serveur).'));
      else if (/host denied|verification failed/i.test(e.message)) fail(new HttpError(422, 'ssh_host', 'Clé d’hôte SSH différente de UPDATE_SSH_FINGERPRINT : connexion refusée.'));
      else fail(new HttpError(422, 'ssh', `Connexion SSH impossible : ${e.message}`));
    });
    c.connect({
      host: env.UPDATE_SSH_HOST,
      port: env.UPDATE_SSH_PORT,
      username: 'root',
      password,
      readyTimeout: 15_000,
      tryKeyboard: false,
      hostVerifier: (key: Buffer) => !env.UPDATE_SSH_FINGERPRINT || fingerprint(key) === env.UPDATE_SSH_FINGERPRINT.trim()
    });
  });
}
