import { MISSIONS } from '../src/missions/data/index';
import { validateMission } from '../src/missions/validation/validateMission';
let errors = 0;
for (const m of MISSIONS) {
  const v = validateMission(m);
  const f = v.feasibility.map((x) => `${x.craneId}:${x.feasible ? x.peakPercent.toFixed(0) + '%' : 'X'}`).join(' ');
  console.log(`${m.id} ${m.title.padEnd(34)} ${f}`);
  for (const i of v.issues) { console.log(`   ${i.severity.toUpperCase()}: ${i.message}`); if (i.severity === 'error') errors++; }
}
console.log(`errors: ${errors}`);
