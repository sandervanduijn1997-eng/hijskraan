import type { Vec3 } from '../../utils/math';
import type { RigidBody } from '../load/rigidBody';
import { apexWorld, applyPositionalCorrection } from '../load/rigidBody';

/**
 * Hijskabel als ongelijkheidsconstraint: afstand(tip, ophangpunt) ≤ lengte.
 * De kabel kan slap hangen maar niet uitrekken. Spanning volgt uit de Lagrange-multiplier.
 */
export interface RopeState {
  /** Ophangpunt aan de kraan (giekkop/trolley), kinematisch. */
  tip: Vec3;
  /** Kabellengte in m (van tip tot haak). */
  length: number;
  minLength: number;
  maxLength: number;
  /** Gemeten kabelkracht (N), gemiddeld over de laatste vaste stap. */
  tension: number;
  /** Rek t.o.v. de ingestelde lengte na alle constraints (m). Positief = kabel wordt door obstakel tegengehouden. */
  stretch: number;
  slack: boolean;
}

export function createRope(tip: Vec3, length: number, minLength: number, maxLength: number): RopeState {
  return { tip: { ...tip }, length, minLength, maxLength, tension: 0, stretch: 0, slack: true };
}

/**
 * Los de kabelconstraint op voor één substap. Geeft de multiplier terug (voor de spanningsmeting).
 * `compliance` (m/N) modelleert de elasticiteit van kabel + giek.
 */
export function solveRope(body: RigidBody, tip: Vec3, length: number, dt: number, compliance: number): number {
  const a = apexWorld(body);
  const dx = a.x - tip.x;
  const dy = a.y - tip.y;
  const dz = a.z - tip.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d <= length || d < 1e-6) return 0;
  const nx = -dx / d;
  const ny = -dy / d;
  const nz = -dz / d;
  return applyPositionalCorrection(body, a.x, a.y, null, 0, 0, nx, ny, nz, d - length, compliance, dt);
}

/** Hoek van de kabel t.o.v. de verticaal (rad) in het xy-vlak en in z. */
export function ropeAngles(tip: Vec3, hook: Vec3): { swingX: number; swingZ: number; total: number } {
  const dy = tip.y - hook.y;
  const dx = hook.x - tip.x;
  const dz = hook.z - tip.z;
  const h = Math.max(0.05, dy);
  const swingX = Math.atan2(dx, h);
  const swingZ = Math.atan2(dz, h);
  return { swingX, swingZ, total: Math.atan2(Math.sqrt(dx * dx + dz * dz), h) };
}

/** Theoretische slingerperiode van een mathematische slinger (s). */
export const pendulumPeriod = (length: number, g: number): number => 2 * Math.PI * Math.sqrt(length / g);
