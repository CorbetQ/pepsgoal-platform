import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://x:y@localhost:5432/z';
process.env.JWT_SECRET ??= 'x'.repeat(40);
const { parseUpdateLog, updateCommand } = await import('../src/lib/update.js');

// Mise à jour depuis Modération › Serveur : lecture du journal et commande lancée en SSH
describe('mise à jour du serveur', () => {
  it('suit les étapes et l’avancement de la construction Docker', () => {
    const p = parseUpdateLog('::step 1/4 Récupération du code\nAlready up to date.\n::step 2/4 Reconstruction de l\'API\n#9 [server build 3/6] RUN npm install\n');
    expect(p.running).toBe(true);
    expect(p.step).toBe(2);
    expect(p.label).toBe('Reconstruction de l\'API');
    expect(p.pct).toBeGreaterThan(25);
    expect(p.pct).toBeLessThan(50);
    expect(p.lines).toContain('Already up to date.');
  });

  it('termine à 100 % sur un succès et signale un échec', () => {
    expect(parseUpdateLog('::step 4/4 Vérification\n::done\n::exit 0\n')).toMatchObject({ done: true, ok: true, pct: 100 });
    expect(parseUpdateLog('::step 1/4 Récupération du code\nfatal: x\n::exit 1\n')).toMatchObject({ done: true, ok: false, exit: 1 });
  });

  it('lance le script détaché, avec l’option web', () => {
    const c = updateCommand(true, '/opt/pepsgoal/deploy/update.sh');
    expect(c).toContain('setsid nohup sh -c "sh $D/update.sh --web;');
    expect(c).toContain("D='/opt/pepsgoal/deploy'");
    expect(updateCommand(false, '/opt/pepsgoal/deploy/update.sh')).not.toContain('--web');
  });
});
