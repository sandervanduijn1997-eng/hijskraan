import { MISSIONS } from '../src/missions/data/index';
import { getLoad } from '../src/missions/data/loads';
import { Simulation } from '../src/sim/simulation';
import { emptyInput } from '../src/cranes/controllers/craneInput';
// Statische audit: strenge regels, krappe marges, startopstelling
for (const m of MISSIONS) {
  const notes: string[] = [];
  const sim = new Simulation({ mission: m });
  for (let i = 0; i < 30; i++) sim.step(emptyInput());
  if (m.requirements.noCollision) notes.push('noCollision (elke aanraking = mislukt)');
  for (const o of m.obstacles) if (o.onHit === 'fail') notes.push(`onHit fail: ${o.id}`);
  for (const t of m.tasks) {
    if (t.type !== 'deliver') continue;
    const ls = m.loads.find((l) => l.id === t.loadId)!;
    const lt = getLoad(ls.type);
    const z = m.zones.find((zz) => zz.id === t.zoneId)!;
    // vrije ruimte links/rechts van de last in de zone (obstakels die de zonehoogte overlappen)
    let left = Infinity, right = Infinity;
    for (const o of m.obstacles) {
      if (o.kind === 'ceiling') continue;
      const top = o.y + o.h;
      if (top <= z.y + 0.05 || o.y >= z.y + lt.height) continue;
      if (o.x + o.w <= z.x - lt.width / 2 + 0.01) left = Math.min(left, z.x - lt.width / 2 - (o.x + o.w));
      if (o.x >= z.x + lt.width / 2 - 0.01) right = Math.min(right, o.x - (z.x + lt.width / 2));
    }
    const gap = Math.min(left, right);
    if (gap < 0.4) notes.push(`${t.loadId}: krappe ruimte ${gap.toFixed(2)} m naast de last in ${z.id}`);
    if (z.tolerance < 0.25) notes.push(`${t.loadId}: tolerantie ${z.tolerance} m`);
    if ((z.angleTolDeg ?? 6) < 2.5) notes.push(`${t.loadId}: hoektolerantie ${z.angleTolDeg}°`);
    if (z.zTolerance !== undefined && z.zTolerance < 0.4) notes.push(`${t.loadId}: dieptetolerantie ${z.zTolerance} m`);
  }
  if (m.timeLimit && m.timeLimit < m.parTime * 1.6) notes.push(`tijdslimiet ${m.timeLimit}s vs richttijd ${m.parTime}s`);
  if (m.requirements.maxSwayDeg && m.requirements.maxSwayDeg < 3) notes.push(`max slinger ${m.requirements.maxSwayDeg}°`);
  // start: haak boven eerste last?
  const firstDeliver = m.tasks.find((t) => t.type === 'deliver');
  if (firstDeliver && firstDeliver.type === 'deliver' && !m.loads.some((l) => l.attached)) {
    const ld = sim.loads.find((l) => l.id === firstDeliver.loadId)!;
    const d = Math.abs(sim.geom.tip.x - sim.slingPoint(ld).x);
    if (d > 3 && m.tasks[0].type === 'deliver') notes.push(`haak start ${d.toFixed(1)} m naast de eerste last`);
  }
  if (sim.warnings.top(3).length) notes.push('waarschuwing bij start: ' + sim.warnings.top(3).map((w) => w.id).join(','));
  if (sim.metrics.collisions || sim.metrics.damage) notes.push(`botsing/schade bij start`);
  console.log(`${m.id.padEnd(4)} ${m.title.padEnd(34)} ${notes.join(' | ') || 'ok'}`);
}
