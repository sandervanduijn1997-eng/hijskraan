import { MISSIONS } from '../src/missions/data/index';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { playMission } from '../tests/helpers/missionBot';
const diff = (DIFFICULTIES as any)[process.argv[2] ?? 'practice'];
const only = process.argv[3]?.split(',');
let ok = 0;
for (const m of MISSIONS) {
  if (only && !only.includes(m.id)) continue;
  const t0 = Date.now();
  const r = playMission(m, diff);
  if (r.outcome === 'success') ok++;
  const lim = r.timeLimit ? ` / limiet ${r.timeLimit}s` : '';
  console.log(`${r.id} ${r.title.padEnd(34)} ${r.outcome.padEnd(8)} ${'★'.repeat(r.stars).padEnd(3)} t=${r.time}s${lim} dmg=${r.damage} bots=${r.collisions} sway=${r.maxSway}° ${r.outcome !== 'success' ? '← ' + r.reason : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`geslaagd: ${ok}`);
