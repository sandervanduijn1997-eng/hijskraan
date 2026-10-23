import { practiceMission } from '../src/missions/data/challenges';
import { Simulation } from '../src/sim/simulation';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { emptyInput } from '../src/cranes/controllers/craneInput';
import { hoistTo, run, steerTip } from '../tests/helpers/autopilot';
import { bodyQuad } from '../src/physics/load/rigidBody';
const m = practiceMission({ craneId: 'at60', loadType: 'transformer', environment: 'trainingYard', windBase: 0, gravity: 9.81 });
const sim = new Simulation({ mission: m, craneId: 'at60', difficulty: DIFFICULTIES.normal, freePlay: true });
const load = sim.loads[0]; const sp = sim.slingPoint(load);
run(sim, 60, () => { const i = steerTip(sim, sp.x, sim.geom.tipHeight); hoistTo(sim, i, Math.abs(sim.geom.tip.x - sp.x) < 0.3 ? sp.y + 0.2 : sim.hookPoint().y); return i; }, () => sim.attachCandidate() === load && Math.abs(sim.geom.tip.x - sp.x) < 0.25);
console.log(sim.toggleRigging());
for (let k = 0; k < 40; k++) { run(sim, 0.5, () => { const i = emptyInput(); i.hoist = 1; return i; }); const b = load.cb.body; console.log((sim.time).toFixed(1), 'minCorner', Math.min(...bodyQuad(b).map(p=>p.y)).toFixed(3), 'touch', [...load.cb.touching].join(','), 'y', (b.pos.y - b.halfH).toFixed(3), 'ang', (b.angle*57.3).toFixed(2), 'sup', [...load.cb.supports].join(','), 'T', (sim.rope.tension/9810).toFixed(1), 'Tf', (sim.tensionF/9810).toFixed(1), 'fast', (sim.tensionFast/9810).toFixed(1), 'cap', sim.capacityT.toFixed(1), 'latched', sim.lmiLatched, 'rope', sim.rope.length.toFixed(3), JSON.stringify(sim.lastControl.blocked), 'vH', sim.crane.vel.hoist.toFixed(3), 'tilt', (sim.crane.tilt*57.3).toFixed(2), 'K', sim.stability?.tippingRatio.toFixed(2), 'tipY', sim.geom.tip.y.toFixed(3), 'stretch', sim.rope.stretch.toFixed(3)); }
