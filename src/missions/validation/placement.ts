import type { RigidBody } from '../../physics/load/rigidBody';
import { bodyTilt, bodyYaw, localToWorld } from '../../physics/load/rigidBody';
import { DEG, RAD, wrapAngle } from '../../utils/math';
import type { ZoneDef } from '../data/types';

export interface PlacementCheck {
  valid: boolean;
  /** Genormaliseerde fout (0 = perfect, 1 = rand van de tolerantie). */
  error: number;
  dx: number;
  dy: number;
  dz: number;
  angleErrDeg: number;
  reasons: string[];
}

/** Midden van de onderkant van de last in wereldcoördinaten. */
export function loadBottomCenter(b: RigidBody): { x: number; y: number; z: number } {
  return localToWorld(b, b.boxOffset.x, b.boxOffset.y - b.halfH);
}

export const SURFACE_TOLERANCE = 0.15;

/**
 * Controleer of een last geldig in een doelzone staat.
 * Vereist: binnen de positie- en hoektolerantie, op de juiste hoogte (niet erdoor of eronder),
 * ondersteund door een geldig oppervlak en (bijna) stilstaand.
 */
export function checkPlacement(b: RigidBody, zone: ZoneDef, supported: boolean, maxSpeed = 0.06, heldMode = false): PlacementCheck {
  const reasons: string[] = [];
  const c = loadBottomCenter(b);
  const dx = c.x - zone.x;
  const dy = c.y - zone.y;
  const dz = c.z - (zone.z ?? 0);
  const target = (zone.angleDeg ?? 0) * DEG;
  // scheefstand: rol om z t.o.v. de doelhoek én stamp om x; gieren alleen als de zone het vraagt
  const tilt = bodyTilt(b);
  const yawErr = zone.yawTolDeg !== undefined ? Math.abs(wrapAngle(bodyYaw(b) - ((zone.yawDeg ?? 0) * DEG))) * RAD : 0;
  const angleErrDeg = Math.max(Math.abs(wrapAngle(tilt.roll - target)) * RAD, Math.abs(tilt.pitch) * RAD);
  const angleTol = zone.angleTolDeg ?? 6;
  const zTol = zone.zTolerance ?? 1.0;
  if (Math.abs(dx) > zone.tolerance) reasons.push('buiten de zone');
  if (Math.abs(dy) > (zone.yTolerance ?? SURFACE_TOLERANCE)) reasons.push(heldMode ? (dy < 0 ? 'te laag — iets hijsen' : 'te hoog — iets vieren') : dy < 0 ? 'te laag (onder het doelvlak)' : 'staat niet op het doelvlak');
  if (Math.abs(dz) > zTol) reasons.push('niet in lijn (diepte)');
  if (angleErrDeg > angleTol) reasons.push('scheef geplaatst');
  if (zone.yawTolDeg !== undefined && yawErr > zone.yawTolDeg) reasons.push('verdraaid — lijn de last uit');
  if (!supported) reasons.push(heldMode ? 'houd het deel aan de haak in positie' : 'niet ondersteund');
  const speed = Math.abs(b.vel.x) + Math.abs(b.vel.y) + Math.abs(b.vel.z) + b.angVel;
  if (speed > maxSpeed) reasons.push('nog in beweging');
  const err = Math.max(Math.abs(dx) / Math.max(0.01, zone.tolerance), (angleErrDeg / Math.max(0.1, angleTol)) * 0.6, Math.abs(dz) / zTol * 0.5);
  return { valid: reasons.length === 0, error: Math.min(1, err), dx, dy, dz, angleErrDeg, reasons };
}
