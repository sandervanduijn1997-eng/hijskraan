import { MISSIONS } from '../src/missions/data/index';
import { validateMission } from '../src/missions/validation/validateMission';
let flat = 0;
for (const m of MISSIONS) {
  const rotated = m.loads.filter((l) => l.z !== undefined && Math.abs(l.z) > 0.5);
  const v = validateMission(m);
  const errs = v.issues.filter((i) => i.severity === 'error');
  if (!rotated.length && !m.zones.some((z) => Math.abs(z.z ?? 0) > 0.5)) flat++;
  console.log(`${m.id} ${rotated.length ? rotated.map((l) => `${l.id}@(${l.x},${l.z})`).join(' ') : '— op één lijn'} ${errs.length ? 'FOUT: ' + errs.map((e) => e.message).join('; ') : ''}`);
}
console.log(`op één lijn: ${flat}`);
