import { CRANES } from '../../cranes/config/cranes';
import { resolveCrane } from '../../cranes/models/craneSpec';
import { createCraneState } from '../../cranes/models/craneState';
import { computeGeometry } from '../../cranes/models/kinematics';
import { LOADS } from './loads';
import type { LoadSpawn, MissionDef, ObstacleDef } from './types';

/**
 * Missies rondom bespeelbaar: de oorspronkelijke missies lagen op één lijn door de kraan (laden en
 * lossen op x, z = 0). Hier wordt het ophaalpunt van elke last rond de draaias verplaatst naar een
 * vrije plek op dezelfde straal, zodat elke hijs een zwenkbeweging vraagt en de last onderweg
 * andere obstakels passeert. De straal (en dus het lastdiagram) blijft gelijk.
 */

/** Hoeken (graden) waarop een ophaalpunt mag komen, in volgorde van voorkeur. */
const ANGLES = [40, 55, 28, 70, 20, 85];

/** Straal vanaf de draaias en de bijbehorende lijn-x (voor validatie en planning). */
export function lineX(slewX: number, x: number, z = 0): number {
  const dx = x - slewX;
  const r = Math.hypot(dx, z);
  return slewX + (dx >= 0 ? r : -r);
}

export function slewCenterX(m: MissionDef): number {
  return m.crane.x + CRANES[m.craneOptions[0]].gameBalance.slewOffsetX;
}

/** Komt deze missie in aanmerking (geen montage, geen rijopdracht, geen pick-and-carry)? */
function eligible(m: MissionDef): boolean {
  if (m.assembly) return false;
  if (m.tasks.some((t) => t.type === 'drive')) return false;
  const gb = CRANES[m.craneOptions[0]].gameBalance;
  if (gb.driveWithLoadMaxPct >= 100 && gb.driveSpeed > 0) return false;
  return true;
}

export function spreadAround(m: MissionDef): MissionDef {
  if (!eligible(m)) return m;
  const cx = slewCenterX(m);
  const cfg = CRANES[m.craneOptions[0]];
  const fp = cfg.gameBalance.footprintOutriggers ?? cfg.gameBalance.footprintRetracted;
  const keepOut = Math.hypot(fp.a, fp.b) + 1.5;
  const deliverIds = new Set(m.tasks.flatMap((t) => (t.type === 'deliver' ? [t.loadId] : [])));
  const placed: { x: number; z: number; hw: number; hd: number }[] = [];
  // lasten die blijven staan tellen ook mee als bezet
  for (const l of m.loads) {
    const t = LOADS[l.type];
    placed.push({ x: l.x, z: l.z ?? 0, hw: t.width / 2, hd: t.depth / 2 });
  }
  const sign = m.number % 2 === 0 ? 1 : -1;
  // hangt de haak bij de start al boven een last (zo ontworpen), dan blijft die last staan en draait het afzetvak
  const spec = resolveCrane(cfg, []);
  const tip = computeGeometry(spec, createCraneState(spec, m.crane)).tip;
  const hookAbove = (l: LoadSpawn) => Math.abs(l.x - tip.x) < 0.8 && Math.abs((l.z ?? 0) - tip.z) < 0.8;
  let moved = 0;
  let obstacles = m.obstacles;
  const loads: LoadSpawn[] = m.loads.map((l, li) => {
    if (!deliverIds.has(l.id) || l.attached || l.z !== undefined || l.id.startsWith('tw-') || hookAbove(l)) return l;
    if (l.y > 0.05) {
      const g = moveWithSupport(m, l, li);
      if (g) {
        obstacles = obstacles.map((o) => (o.id === g.support.id ? g.support : o));
        placed[li] = g.footprint;
        moved++;
        return g.load;
      }
      return l;
    }
    const t = LOADS[l.type];
    const hw = t.width / 2;
    const hd = t.depth / 2;
    const dx = l.x - cx;
    if (Math.abs(dx) < keepOut) return l;
    for (const deg of ANGLES) {
      for (const s of [sign, -sign]) {
        const a = (s * deg * Math.PI) / 180;
        const x = cx + dx * Math.cos(a);
        const z = dx * Math.sin(a);
        if (Math.hypot(x - cx, z) < keepOut) continue;
        if (x - hw < m.bounds.minX + 2 || x + hw > m.bounds.maxX - 2 || Math.abs(z) > 30) continue;
        const r = Math.hypot(hw, hd);
        const blocked =
          m.obstacles.some((o) => o.kind !== 'ceiling' && o.y < t.height + 0.5 && x + hw + 0.6 > o.x && x - hw - 0.6 < o.x + o.w && z + hd + 0.6 > (o.z0 ?? -40) && z - hd - 0.6 < (o.z1 ?? 40)) ||
          m.zones.some((zn) => Math.hypot(zn.x - x, (zn.z ?? 0) - z) < zn.tolerance + r + 2) ||
          placed.some((p, pi) => pi !== li && Math.abs(p.x - x) < p.hw + hw + 0.8 && Math.abs(p.z - z) < p.hd + hd + 0.8);
        if (blocked) continue;
        placed[li] = { x, z, hw, hd };
        moved++;
        return { ...l, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
      }
    }
    return l;
  });
  // lukt het niet met de ophaalpunten (lasten op een wagen of tussen obstakels), dan een afzetvak op de grond
  let zones = m.zones;
  if (moved === 0) {
    zones = m.zones.map((zn) => {
      if (moved > 0 || zn.y > 0.05 || zn.z !== undefined) return zn;
      const task = m.tasks.find((t) => t.type === 'deliver' && t.zoneId === zn.id);
      if (!task || task.type !== 'deliver') return zn;
      if (m.zones.some((o) => o !== zn && Math.abs(o.x - zn.x) < 0.5)) return zn;
      const t = LOADS[m.loads.find((l) => l.id === task.loadId)!.type];
      const hw = t.width / 2 + zn.tolerance;
      const hd = t.depth / 2 + zn.tolerance;
      const dx = zn.x - cx;
      if (Math.abs(dx) < keepOut) return zn;
      for (const deg of ANGLES) {
        for (const sg of [sign, -sign]) {
          const a = (sg * deg * Math.PI) / 180;
          const x = cx + dx * Math.cos(a);
          const z = dx * Math.sin(a);
          if (Math.hypot(x - cx, z) < keepOut || Math.abs(z) > 30) continue;
          if (x - hw < m.bounds.minX + 2 || x + hw > m.bounds.maxX - 2) continue;
          const blocked =
            m.obstacles.some((o) => o.kind !== 'ceiling' && o.y < t.height + 0.5 && x + hw + 0.6 > o.x && x - hw - 0.6 < o.x + o.w && z + hd + 0.6 > (o.z0 ?? -40) && z - hd - 0.6 < (o.z1 ?? 40)) ||
            placed.some((p) => Math.abs(p.x - x) < p.hw + hw + 1 && Math.abs(p.z - z) < p.hd + hd + 1) ||
            (m.ground ?? []).some((g) => x >= g.x0 && x < g.x1 && g.quality < 0.5);
          if (blocked) continue;
          moved++;
          return { ...zn, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
        }
      }
      return zn;
    });
  }
  if (moved === 0) return m;
  // zwenken kost tijd: richttijd iets ruimer
  return { ...m, loads, zones, obstacles, parTime: m.parTime + 15 * moved };

  /**
   * Een last op een wagen of bok verplaatst samen met die ondersteuning (die alleen deze last draagt).
   * Een ondersteuning zonder diepte krijgt een eindige diepte rond de last.
   */
  function moveWithSupport(mm: MissionDef, l: LoadSpawn, li: number): { load: LoadSpawn; support: ObstacleDef; footprint: { x: number; z: number; hw: number; hd: number } } | null {
    const t = LOADS[l.type];
    const sup = mm.obstacles.find((o) => o.kind !== 'ceiling' && Math.abs(o.y + o.h - l.y) < 0.06 && l.x > o.x && l.x < o.x + o.w);
    if (!sup || !['truck', 'platform', 'support'].includes(sup.kind)) return null;
    if (mm.zones.some((zn) => zn.x > sup.x - 0.5 && zn.x < sup.x + sup.w + 0.5 && Math.abs(zn.y - l.y) < 2)) return null;
    if (mm.loads.some((o) => o !== l && o.x > sup.x && o.x < sup.x + sup.w)) return null;
    const depth = sup.z0 !== undefined ? [sup.z0, sup.z1 ?? 40] : [-Math.max(3, t.depth / 2 + 1.5), Math.max(3, t.depth / 2 + 1.5)];
    const dx = l.x - cx;
    if (Math.abs(dx) < keepOut) return null;
    for (const deg of ANGLES) {
      for (const sg of [sign, -sign]) {
        const a = (sg * deg * Math.PI) / 180;
        const x = cx + dx * Math.cos(a);
        const z = dx * Math.sin(a);
        const ox = sup.x + (x - l.x);
        const oz0 = depth[0] + z;
        const oz1 = depth[1] + z;
        if (Math.abs(z) > 30 || ox < mm.bounds.minX + 2 || ox + sup.w > mm.bounds.maxX - 2) continue;
        // ondersteuning niet in de kraan, andere obstakels, zones of lasten
        const nearCrane = Math.max(Math.abs(ox + sup.w / 2 - cx) - sup.w / 2, 0) ** 2 + Math.max(Math.abs((oz0 + oz1) / 2) - (oz1 - oz0) / 2, 0) ** 2 < keepOut * keepOut;
        if (nearCrane) continue;
        const blocked =
          mm.obstacles.some((o) => o !== sup && o.kind !== 'ceiling' && ox + sup.w + 0.6 > o.x && ox - 0.6 < o.x + o.w && oz1 + 0.6 > (o.z0 ?? -40) && oz0 - 0.6 < (o.z1 ?? 40) && o.y < sup.y + sup.h + t.height) ||
          mm.zones.some((zn) => zn.x > ox - zn.tolerance - 2 && zn.x < ox + sup.w + zn.tolerance + 2 && (zn.z ?? 0) > oz0 - 2 && (zn.z ?? 0) < oz1 + 2) ||
          placed.some((p, pi) => pi !== li && p.x + p.hw > ox - 0.8 && p.x - p.hw < ox + sup.w + 0.8 && p.z + p.hd > oz0 - 0.8 && p.z - p.hd < oz1 + 0.8);
        if (blocked) continue;
        const r2 = (v: number) => Math.round(v * 100) / 100;
        return {
          load: { ...l, x: r2(x), z: r2(z) },
          support: { ...sup, x: r2(ox), z0: r2(oz0), z1: r2(oz1) },
          footprint: { x: ox + sup.w / 2, z: (oz0 + oz1) / 2, hw: sup.w / 2, hd: (oz1 - oz0) / 2 },
        };
      }
    }
    return null;
  }
}
