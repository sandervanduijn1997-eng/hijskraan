import { getMission } from '../src/missions/data/index';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { playMission } from '../tests/helpers/missionBot';
const r = playMission(getMission(process.argv[2])!, (DIFFICULTIES as any)[process.argv[3] ?? 'practice'], Number(process.argv[4] ?? 300), (l) => console.log(l));
console.log(JSON.stringify(r));
