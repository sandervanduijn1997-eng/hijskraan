import { practiceMission } from '../src/missions/data/challenges';
import { Simulation } from '../src/sim/simulation';
import { emptyInput } from '../src/cranes/controllers/craneInput';
const m = practiceMission({ craneId: 'kb22', loadType: 'pallet500', environment: 'trainingYard', windBase: 0, gravity: 9.81 });
const sim = new Simulation({ mission: m, craneId: 'kb22', freePlay: true });
console.log('hook', sim.hookBody?.body.pos, 'tip', sim.geom.tip, 'rope', sim.rope.length, 'support', sim.support.mode);
for (let i = 0; i < 60; i += 1) { sim.step(emptyInput()); if (i % 6 === 0) console.log(i, 'T', (sim.rope.tension/9810).toFixed(2), 'K', sim.stability?.tippingRatio.toFixed(2), 'tilt', sim.crane.tilt.toFixed(3), 'boomT', sim.geom.boomMassT.toFixed(2), 'cog', sim.geom.boomCogRadius.toFixed(2), 'e', sim.stability?.tippingDistance.toFixed(2), 'stab', (sim.stability!.stabilizingMoment/9810).toFixed(1), 'over', (sim.stability!.overturningMoment/9810).toFixed(1), sim.world.impacts.map(e=>e.otherId+'@'+e.speed.toFixed(1)).join(',')); }
