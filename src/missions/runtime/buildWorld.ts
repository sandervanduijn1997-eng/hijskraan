import type { Collider } from '../../physics/collision/colliders';
import type { ObstacleDef } from '../data/types';

export const FULL_DEPTH = 40;

const LANDABLE_DEFAULT = new Set(['platform', 'support', 'roof', 'truck', 'ship', 'container']);

export function obstacleToCollider(o: ObstacleDef): Collider {
  return {
    id: o.id,
    kind: o.kind,
    minX: o.x,
    maxX: o.x + o.w,
    minY: o.y,
    maxY: o.y + o.h,
    minZ: o.z0 ?? -FULL_DEPTH,
    maxZ: o.z1 ?? FULL_DEPTH,
    onHit: o.onHit ?? (o.kind === 'fence' || o.kind === 'barrier' ? 'damage' : 'damage'),
    landable: o.landable ?? LANDABLE_DEFAULT.has(o.kind),
    label: o.label,
  };
}

export function buildColliders(obstacles: readonly ObstacleDef[]): Collider[] {
  return obstacles.map(obstacleToCollider);
}
