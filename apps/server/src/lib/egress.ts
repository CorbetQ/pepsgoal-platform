/**
 * Requêtes sortantes vers une adresse fournie par un utilisateur (abonnements Web Push) : seuls les services push des
 * navigateurs sont joignables, en HTTPS sur le port 443, et jamais une adresse interne, même si le nom de domaine
 * se met à pointer vers une (vérification faite à la connexion, adresse par adresse).
 */
import { lookup } from 'node:dns';
import { Agent } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Services push des navigateurs : Chrome, Edge, Opera, Samsung (FCM), Firefox (Mozilla), Safari (Apple), Edge (Windows). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];

const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net, bits, 'ipv4');
// IPv4 dans IPv6 (::ffff:a.b.c.d) : traité à part (BlockList appliquerait cette règle à toutes les adresses IPv4)
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) blocked.addSubnet(net, bits, 'ipv6');

/** Vrai pour une adresse privée, locale, réservée ou de transition (IPv4 dans IPv6 compris). */
export function isInternalAddress(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return true;
  const mapped = v === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1] : undefined;
  if (mapped) return isInternalAddress(mapped);
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

/** Adresse d'abonnement acceptée : HTTPS, port 443, nom d'un service push connu (jamais une adresse IP ni d'identifiants). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, ''))) return false;
  return PUSH_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/** Résolution DNS qui refuse toute adresse interne : appliquée à chaque connexion, elle déjoue les changements de résolution. */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!list.length || list.some(a => isInternalAddress(a.address))) {
      return callback(Object.assign(new Error(`Adresse interne refusée pour ${hostname}`), { code: 'EADDRNOTALLOWED' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

/** Agent HTTPS des envois push : résolution filtrée, connexions réutilisées, délai court. */
export const pushAgent = new Agent({ lookup: safeLookup, keepAlive: true, maxSockets: 16, timeout: 10_000 });
