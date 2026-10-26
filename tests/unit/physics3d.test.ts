import { describe, expect, it } from 'vitest';
import { PhysicsWorld, defaultPhysicsParams } from '../../src/physics/world';
import { bodyBounds, bodyTilt, bodyYaw, createBoxBody, qFromAxisAngle } from '../../src/physics/load/rigidBody';
import { createRope } from '../../src/physics/cable/rope';
import { FIXED_DT, SUBSTEPS } from '../../src/physics/constants';
import type { Collider } from '../../src/physics/collision/colliders';

const box = (id: string, minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Collider => ({ id, kind: 'building', minX, maxX, minY, maxY, minZ, maxZ, onHit: 'damage', landable: true });

function steps(world: PhysicsWorld, n: number, rope = createRope({ x: 0, y: 100, z: 0 }, 1, 1, 1), tip = { x: 0, y: 100, z: 0 }) {
  for (let i = 0; i < n; i++) world.step(FIXED_DT, SUBSTEPS, rope, { ...tip });
}

describe('3D-lastfysica', () => {
  it('een rustende last kruipt niet weg en valt in slaap', () => {
    const world = new PhysicsWorld(defaultPhysicsParams());
    world.setColliders([box('bed', -4, 4, 0, 1.3, -1.25, 1.25)]);
    const b = createBoxBody({ mass: 500, width: 1.2, height: 1, depth: 1, x: 2, y: 1.3, apexHeight: 1 });
    world.addBody('p', b);
    steps(world, 60 * 60);
    expect(Math.abs(b.pos.x - 2)).toBeLessThan(0.01);
    expect(Math.abs(b.pos.z)).toBeLessThan(0.01);
    expect(b.sleeping).toBe(true);
  });

  it('een last die over een rand in z hangt, kantelt zijwaarts (om de x-as) en valt eraf', () => {
    const world = new PhysicsWorld(defaultPhysicsParams());
    world.setColliders([box('richel', -3, 3, 0, 2, -3, 0)]);
    // zwaartepunt 0,3 m voorbij de rand van de richel (in z)
    const b = createBoxBody({ mass: 800, width: 1.2, height: 0.8, depth: 1.0, x: 0, y: 2, z: 0.3, apexHeight: 1 });
    world.addBody('p', b);
    steps(world, 60 * 4);
    expect(Math.abs(bodyTilt(b).pitch)).toBeGreaterThan(0.5);
    expect(b.pos.y).toBeLessThan(1.5);
  });

  it('een uit het lood gehangen last zwaait in 3D en blijft in z bewegen (niet alleen in het xy-vlak)', () => {
    const params = defaultPhysicsParams();
    params.swayDamping = 0;
    const world = new PhysicsWorld(params);
    const b = createBoxBody({ mass: 1000, width: 1, height: 1, depth: 1, x: 0, y: 8.5, z: 1.5, apexHeight: 0.5 });
    const cb = world.addBody('l', b);
    world.ropeBody = cb;
    const rope = createRope({ x: 0, y: 20, z: 0 }, 10, 1, 50);
    let minZ = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      world.step(FIXED_DT, SUBSTEPS, rope, { x: 0, y: 20, z: 0 });
      minZ = Math.min(minZ, b.pos.z);
    }
    expect(minZ).toBeLessThan(-1);
  });

  it('kabeltorsie: een verdraaide last draait terug naar de neutrale stand; stuurlijnen dempen het gieren', () => {
    const params = defaultPhysicsParams();
    params.swayDamping = 0.3;
    const world = new PhysicsWorld(params);
    const b = createBoxBody({ mass: 3000, width: 6, height: 0.5, depth: 0.5, x: 0, y: 8, apexHeight: 1.5 });
    const cb = world.addBody('l', b);
    world.ropeBody = cb;
    const rope = createRope({ x: 0, y: 20, z: 0 }, 10.5, 1, 50);
    steps(world, 30, rope, { x: 0, y: 20, z: 0 });
    // de ligger 30° om de verticaal verdraaien (zoals na een zijdelings stoten)
    b.q = qFromAxisAngle(0, 1, 0, (30 * Math.PI) / 180);
    b.prevQ = { ...b.q };
    const yaw0 = Math.abs(bodyYaw(b));
    steps(world, 60 * 60, rope, { x: 0, y: 20, z: 0 });
    expect(yaw0).toBeGreaterThan(0.4);
    expect(Math.abs(bodyYaw(b))).toBeLessThan(yaw0 * 0.6);
  });

  it('schuin tegen de hoek van een obstakel: de last botst in 3D en gaat er niet doorheen', () => {
    const world = new PhysicsWorld(defaultPhysicsParams());
    world.setColliders([box('hoek', 2, 6, 0, 6, 2, 6)]);
    const b = createBoxBody({ mass: 1000, width: 1, height: 1, depth: 1, x: 0, y: 2, z: 0, apexHeight: 0.5 });
    world.addBody('l', b);
    // diagonaal (x en z tegelijk) tegen de hoek aan schuiven, zonder zwaartekracht
    world.params.gravity = 0;
    b.vel.x = 2;
    b.vel.z = 2;
    steps(world, 60 * 3);
    const bb = bodyBounds(b);
    const inside = bb.maxX > 2.05 && bb.maxZ > 2.05 && bb.minY < 6;
    expect(inside).toBe(false);
  });
});
