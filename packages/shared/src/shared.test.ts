import { describe, expect, it } from 'vitest';
import { addDays, bestStreak, globalStreak, parseGoalData, resolveLww, ymd } from './index.js';
import { decryptMessage, E2EPayload, encryptMessage, fromB64, fromUtf8, newDeviceKeys, newPairKey, safetyCode, toB64, unwrapPairKey, utf8, wrapPairKey } from './e2e.js';

describe('séries', () => {
  const now = new Date(2026, 9, 10, 12);
  const day = (n: number) => ymd(addDays(now, -n));

  it('compte les jours consécutifs, aujourd’hui en attente ne casse pas la série', () => {
    expect(globalStreak(new Set([day(1), day(2), day(3)]), new Set(), now)).toEqual({ n: 3, lit: false });
    expect(globalStreak(new Set([day(0), day(1)]), new Set(), now)).toEqual({ n: 2, lit: true });
  });

  it('un gel comble un jour manqué', () => {
    expect(globalStreak(new Set([day(1), day(3)]), new Set([day(2)]), now).n).toBe(3);
  });

  it('calcule la meilleure série', () => {
    expect(bestStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06'])).toBe(3);
  });
});

describe('conflits', () => {
  const t = Date.parse('2026-10-10T10:00:00Z');
  it('la version la plus récente gagne', () => {
    expect(resolveLww('2026-10-10T09:00:00.000Z', '2026-10-10T09:30:00.000Z', t).accept).toBe(true);
    expect(resolveLww('2026-10-10T09:45:00.000Z', '2026-10-10T09:30:00.000Z', t).accept).toBe(false);
  });
  it('une horloge en avance est ramenée à maintenant + 5 min', () => {
    const r = resolveLww(null, '2030-01-01T00:00:00.000Z', t);
    expect(Date.parse(r.effectiveUpdatedAt)).toBe(t + 5 * 60_000);
  });
});

describe('validation des objectifs', () => {
  it('accepte une routine valide et refuse une heure invalide', () => {
    expect(parseGoalData('routine', { mode: 'days', days: [0, 2, 4], perWeek: 3 })).toBeTruthy();
    expect(() => parseGoalData('timed', { mode: 'before', time: '25:00', days: [0] })).toThrow();
  });
});

describe('chiffrement de bout en bout', () => {
  const alice = newDeviceKeys(), bob = newDeviceKeys(), eve = newDeviceKeys();
  const keyId = '9b2f6c1e-4a3d-4f5b-8c7d-1e2f3a4b5c6d';

  it('enveloppe : seul le destinataire ouvre la clé de paire', () => {
    const k = newPairKey();
    const env = wrapPairKey(k, bob.publicKey, alice.secretKey);
    expect(unwrapPairKey(env, alice.publicKey, bob.secretKey)).toBe(k);
    expect(unwrapPairKey(env, alice.publicKey, eve.secretKey)).toBeNull();
    expect(unwrapPairKey({ ...env, box: env.box.replace(/^./, c => (c === 'A' ? 'B' : 'A')) }, alice.publicKey, bob.secretKey)).toBeNull();
  });

  it('message : aller-retour, accents et emojis, refus si altéré ou mauvaise clé', () => {
    const k = newPairKey();
    const text = 'Bravo pour ta série de 12 jours 🔥 — à demain, Léa !';
    const p = encryptMessage(text, k, keyId);
    expect(E2EPayload.parse(p)).toEqual(p);
    expect(p.ct).not.toContain('Bravo');
    expect(decryptMessage(p, k)).toBe(text);
    expect(decryptMessage(p, newPairKey())).toBeNull();
    const bytes = fromB64(p.ct); bytes[0] = bytes[0]! ^ 1;
    expect(decryptMessage({ ...p, ct: toB64(bytes) }, k)).toBeNull();
  });

  it('encodages identiques à Buffer', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'é😀𝄞', 'x'.repeat(500)]) {
      expect(fromUtf8(utf8(s))).toBe(s);
      expect(toB64(utf8(s))).toBe(Buffer.from(s, 'utf8').toString('base64'));
    }
  });

  it('code de sécurité : même résultat quel que soit l’ordre', () => {
    expect(safetyCode([alice.publicKey, bob.publicKey])).toBe(safetyCode([bob.publicKey, alice.publicKey]));
    expect(safetyCode([alice.publicKey, bob.publicKey])).not.toBe(safetyCode([alice.publicKey, eve.publicKey]));
    expect(safetyCode([alice.publicKey])).toMatch(/^\d{5}( \d{5}){5}$/);
  });
});
