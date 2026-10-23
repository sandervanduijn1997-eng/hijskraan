import { describe, expect, it } from 'vitest';
import { PhysicsWorld, defaultPhysicsParams } from '../../src/physics/world';
import { createBoxBody, apexWorld } from '../../src/physics/load/rigidBody';
import { createRope, pendulumPeriod } from '../../src/physics/cable/rope';
import { FIXED_DT, GRAVITY, SUBSTEPS } from '../../src/physics/constants';
import type { Collider } from '../../src/physics/collision/colliders';

function hangingSetup(mass: number, ropeLen: number, offsetX = 0, damping = 0) {
  const params = defaultPhysicsParams();
  params.swayDamping = damping;
  params.linearDamping = 0;
  const world = new PhysicsWorld(params);
  const tip = { x: 0, y: 20, z: 0 };
  // body zodanig dat het ophangpunt op afstand ropeLen onder (en offsetX naast) de tip ligt
  const apexH = 1;
  const h = 1;
  const dy = Math.sqrt(ropeLen * ropeLen - offsetX * offsetX);
  const body = createBoxBody({ mass, width: 1, height: h, depth: 1, x: offsetX, y: 20 - dy - h - apexH, apexHeight: apexH });
  const cb = world.addBody('load', body);
  world.ropeBody = cb;
  const rope = createRope(tip, ropeLen, 1, 50);
  return { world, body, rope, tip };
}

describe('kabel en slinger', () => {
  it('statische spanning is gelijk aan het gewicht', () => {
    const { world, rope, tip } = hangingSetup(2000, 10);
    for (let i = 0; i < 120; i++) world.step(FIXED_DT, SUBSTEPS, rope, { ...tip });
    expect(rope.tension).toBeGreaterThan(2000 * GRAVITY * 0.97);
    expect(rope.tension).toBeLessThan(2000 * GRAVITY * 1.03);
    expect(rope.slack).toBe(false);
  });

  it('slingerperiode komt overeen met 2π√(L/g)', () => {
    const L = 10;
    const { world, body, rope, tip } = hangingSetup(1000, L, 1.0);
    const crossings: number[] = [];
    let prevX = apexWorld(body).x;
    let t = 0;
    for (let i = 0; i < 60 * 30; i++) {
      world.step(FIXED_DT, SUBSTEPS, rope, { ...tip });
      t += FIXED_DT;
      const x = apexWorld(body).x;
      if (prevX < 0 && x >= 0) crossings.push(t);
      prevX = x;
    }
    expect(crossings.length).toBeGreaterThan(3);
    const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
    // fysieke slinger met verdeelde massa is iets langer dan de mathematische
    const ideal = pendulumPeriod(L, GRAVITY);
    expect(period).toBeGreaterThan(ideal * 0.97);
    expect(period).toBeLessThan(ideal * 1.12);
  });

  it('kabel rekt niet uit', () => {
    const { world, body, rope, tip } = hangingSetup(50000, 15, 3);
    let maxD = 0;
    for (let i = 0; i < 600; i++) {
      world.step(FIXED_DT, SUBSTEPS, rope, { ...tip });
      const a = apexWorld(body);
      maxD = Math.max(maxD, Math.hypot(a.x - tip.x, a.y - tip.y, a.z - tip.z));
    }
    expect(maxD).toBeLessThan(15.05);
  });

  it('slingering dempt uit bij demping', () => {
    const { world, body, rope, tip } = hangingSetup(1000, 8, 1.5, 0.5);
    for (let i = 0; i < 60 * 20; i++) world.step(FIXED_DT, SUBSTEPS, rope, { ...tip });
    expect(Math.abs(apexWorld(body).x)).toBeLessThan(0.15);
  });
});

describe('contacten', () => {
  it('last komt tot rust op de grond zonder doorzakken', () => {
    const world = new PhysicsWorld();
    const body = createBoxBody({ mass: 1000, width: 2, height: 1, depth: 1, x: 0, y: 2, apexHeight: 1 });
    const cb = world.addBody('l', body);
    const rope = createRope({ x: 0, y: 30, z: 0 }, 10, 1, 50);
    for (let i = 0; i < 240; i++) world.step(FIXED_DT, SUBSTEPS, rope, { x: 0, y: 30, z: 0 });
    expect(body.pos.y).toBeGreaterThan(0.49);
    expect(body.pos.y).toBeLessThan(0.52);
    expect(Math.abs(body.angle)).toBeLessThan(0.01);
    expect(cb.supports.has('ground')).toBe(true);
  });

  it('last kan niet door een muur', () => {
    const world = new PhysicsWorld();
    const wall: Collider = { id: 'w', kind: 'wall', minX: 3, maxX: 3.3, minY: 0, maxY: 6, minZ: -50, maxZ: 50, onHit: 'damage', landable: false };
    world.setColliders([wall]);
    const body = createBoxBody({ mass: 800, width: 1, height: 1, depth: 1, x: 0, y: 1, apexHeight: 0.5 });
    body.vel.x = 6;
    world.addBody('l', body);
    const rope = createRope({ x: 0, y: 30, z: 0 }, 40, 1, 50);
    let hit = false;
    for (let i = 0; i < 120; i++) {
      world.step(FIXED_DT, SUBSTEPS, rope, { x: 0, y: 30, z: 0 });
      if (world.impacts.some((e) => e.otherId === 'w')) hit = true;
      expect(body.pos.x + 0.5).toBeLessThanOrEqual(3.02);
    }
    expect(hit).toBe(true);
  });

  it('balk rust op twee steunpunten', () => {
    const world = new PhysicsWorld();
    const s1: Collider = { id: 's1', kind: 'support', minX: -3.2, maxX: -2.8, minY: 0, maxY: 3, minZ: -5, maxZ: 5, onHit: 'none', landable: true };
    const s2: Collider = { ...s1, id: 's2', minX: 2.8, maxX: 3.2 };
    world.setColliders([s1, s2]);
    const body = createBoxBody({ mass: 3000, width: 8, height: 0.5, depth: 0.4, x: 0, y: 3.3, apexHeight: 2 });
    const cb = world.addBody('beam', body);
    const rope = createRope({ x: 0, y: 30, z: 0 }, 40, 1, 50);
    for (let i = 0; i < 300; i++) world.step(FIXED_DT, SUBSTEPS, rope, { x: 0, y: 30, z: 0 });
    expect(body.pos.y - 0.25).toBeGreaterThan(2.97);
    expect(cb.supports.has('s1') || cb.body.sleeping).toBe(true);
    expect(Math.abs(body.angle)).toBeLessThan(0.02);
  });
});
