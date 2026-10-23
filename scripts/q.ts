import { MISSIONS } from '../src/missions/data/index';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { playMission } from '../tests/helpers/missionBot';
const m = MISSIONS.find((x) => x.id === (process.argv[2] ?? 'm12'))!;
let last = ''; let dmg = '';
const r = playMission(m, (DIFFICULTIES as any)[process.argv[3] ?? 'practice'], 2400, (l) => {
  const ph = l.split('[')[1]?.split(']')[0];
  const d = l.match(/dmg=([\d.]+)/)?.[1] ?? '';
  if (ph !== last || d !== dmg) { console.log(l.slice(0, 330)); last = ph; dmg = d; }
});
console.log(r.outcome, r.reason, r.time, r.damage);
