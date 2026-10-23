import type { ObstacleDef, ZoneDef } from './types';

/** Kleine hulpfuncties om missiedata compact en leesbaar te houden. */

export const box = (id: string, kind: ObstacleDef['kind'], x: number, y: number, w: number, h: number, extra: Partial<ObstacleDef> = {}): ObstacleDef => ({
  id,
  kind,
  x,
  y,
  w,
  h,
  ...extra,
});

export const zone = (id: string, label: string, x: number, y: number, tolerance: number, extra: Partial<ZoneDef> = {}): ZoneDef => ({
  id,
  label,
  x,
  y,
  tolerance,
  ...extra,
});

/** Vrachtwagen met laadvloer (landbaar) en cabine. `x` = achterkant laadvloer, cabine rechts. */
export function truck(id: string, x: number, bedLength = 8, bedHeight = 1.3, cabRight = true): ObstacleDef[] {
  const cabX = cabRight ? x + bedLength : x - 2.6;
  return [
    box(`${id}-bed`, 'truck', x, 0, bedLength, bedHeight, { z0: -1.25, z1: 1.25, landable: true, label: 'laadvloer', style: 'truckBed' }),
    box(`${id}-cab`, 'truck', cabX, 0, 2.6, 3.2, { z0: -1.25, z1: 1.25, landable: false, label: 'cabine', style: cabRight ? 'truckCab' : 'truckCabL' }),
  ];
}

/** Gebouw (landbaar dak). */
export const building = (id: string, x: number, w: number, h: number, style = 'concrete', label = 'gebouw'): ObstacleDef =>
  box(id, 'building', x, 0, w, h, { landable: true, label, style });

/** Fabrieksplafond (dakconstructie) over een bereik. */
export const ceiling = (x0: number, x1: number, y: number): ObstacleDef => box('ceiling', 'ceiling', x0, y, x1 - x0, 1.2, { label: 'hallendak', style: 'ceiling', landable: false });

/** Afzetting / hek. */
export const fence = (id: string, x: number, h = 1.4): ObstacleDef => box(id, 'fence', x, 0, 0.2, h, { label: 'afzetting', style: 'fence' });
