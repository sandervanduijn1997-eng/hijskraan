import type { Collider, ColliderKind } from '../../physics/collision/colliders';
import type { ObstacleDef } from '../data/types';

/** Diepte (m, in z) per soort obstakel als de missie er zelf geen opgeeft. Echte 3D-objecten, niet oneindig. */
export const DEPTH_BY_KIND: Record<ColliderKind, number> = {
  ground: 200,
  building: 16,
  wall: 6,
  roof: 16,
  scaffold: 4,
  truck: 2.5,
  platform: 6,
  support: 1.2,
  pipe: 1,
  machine: 3,
  container: 2.44,
  fence: 6,
  ceiling: 60,
  tower: 4.4,
  ship: 14,
  barrier: 4,
  crane: 2.6,
};


const LANDABLE_DEFAULT = new Set(['platform', 'support', 'roof', 'truck', 'ship', 'container']);

export function obstacleZ(o: ObstacleDef): [number, number] {
  if (o.z0 !== undefined && o.z1 !== undefined) return [o.z0, o.z1];
  const d = DEPTH_BY_KIND[o.kind] ?? 6;
  return [o.z0 ?? -d / 2, o.z1 ?? d / 2];
}

export function obstacleToCollider(o: ObstacleDef): Collider {
  const [minZ, maxZ] = obstacleZ(o);
  return {
    id: o.id,
    kind: o.kind,
    minX: o.x,
    maxX: o.x + o.w,
    minY: o.y,
    maxY: o.y + o.h,
    minZ,
    maxZ,
    onHit: o.onHit ?? 'damage',
    landable: o.landable ?? LANDABLE_DEFAULT.has(o.kind),
    label: o.label,
  };
}

export function buildColliders(obstacles: readonly ObstacleDef[]): Collider[] {
  return obstacles.map(obstacleToCollider);
}
