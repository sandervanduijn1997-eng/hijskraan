import { MISSIONS } from '../src/missions/data/index';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { playMission } from '../tests/helpers/missionBot';
const m = MISSIONS.find((x) => x.id === (process.argv[2] ?? 'm36'))!;
let k = 0;
const r = playMission(m, (DIFFICULTIES as any)[process.argv[3] ?? 'practice'], 700, (l) => {
  if (l.includes('neerzetten') && k++ % 10 === 0 && k < 300) console.log(l.slice(0, 300));
});
console.log(r.outcome, r.reason);
