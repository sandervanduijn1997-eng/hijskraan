import { CRANES } from '../../cranes/config/cranes';
import type { CraneId } from '../../cranes/config/types';
import { allowedCapacityT } from '../../cranes/models/capacity';
import type { ResolvedCrane } from '../../cranes/models/craneSpec';
import { resolveCrane } from '../../cranes/models/craneSpec';
import type { CraneState } from '../../cranes/models/craneState';
import { createCraneState } from '../../cranes/models/craneState';
import { computeGeometry } from '../../cranes/models/kinematics';
import type { Collider } from '../../physics/collision/colliders';
import { groundFactorFor } from '../../physics/ground';
import { DEG } from '../../utils/math';
import { LOADS } from '../data/loads';
import type { MissionDef } from '../data/types';
import { buildColliders } from '../runtime/buildWorld';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface CraneFeasibility {
  craneId: CraneId;
  feasible: boolean;
  reasons: string[];
  /** Hoogste benodigde belasting (%) over alle hijsen, voor de planning. */
  peakPercent: number;
  /** Beste gevonden configuratie (opstelplaats, contragewicht, giek, hulpgiek). */
  config?: { baseX: number; cw: number; boom: number; jib: number };
}

export interface MissionValidation {
  missionId: string;
  issues: ValidationIssue[];
  feasibility: CraneFeasibility[];
}

interface LiftPoint {
  x: number;
  heightNeeded: number;
  massT: number;
  label: string;
  extraCwT: number;
  /** Straal waarop gecontroleerd wordt (standaard |x − draaias|). */
  atRadius?: number;
  /** Voor doorgangscontrole: hijs- en doelpositie en de hoogte van last + stroppen + haak + minimale kabel. */
  transit?: { from: number; to: number; stack: number };
}

const hookDims = (spec: ResolvedCrane) => {
  const w = 0.35 + 0.12 * Math.cbrt(spec.gb.hookMassKg / 100);
  return { w, h: w * 1.4 };
};

/** Alle bereikbare kraanstanden die de tip op straal u brengen (bemonsterd). */
function statesAtRadius(spec: ResolvedCrane, base: CraneState, u: number, slew: number, options: { boomIdx: number[]; jibIdx: number[] }): CraneState[] {
  const gb = spec.gb;
  const out: CraneState[] = [];
  const kind = spec.cfg.kind;
  const s0: CraneState = { ...base, slew, tilt: 0, setupProgress: 1 };
  if (kind === 'tower') {
    if (u >= (gb.trolleyMin ?? 0) && u <= (gb.jibLength ?? 0)) out.push({ ...s0, trolley: u });
    return out;
  }
  if (kind === 'knuckle') {
    for (let a1 = gb.boomAngleMinDeg; a1 <= gb.boomAngleMaxDeg; a1 += 2) {
      for (let a2 = gb.knuckleMinDeg ?? -170; a2 <= (gb.knuckleMaxDeg ?? 20); a2 += 2.5) {
        for (let t = 0; t <= (gb.knuckleTeleMax ?? 0) + 1e-6; t += 0.5) {
          const st = { ...s0, boomAngle: a1 * DEG, knuckle: a2 * DEG, knuckleTele: t };
          const g = computeGeometry(spec, st);
          if (Math.abs(g.tipU - u) < 0.35) out.push(st);
        }
      }
    }
    return out;
  }
  const lengths: { L: number; bi: number }[] =
    kind === 'lattice'
      ? options.boomIdx.map((bi) => ({ L: spec.boomOptions[bi], bi }))
      : Array.from({ length: 25 }, (_, i) => ({ L: gb.boomMin + ((gb.boomMax - gb.boomMin) * i) / 24, bi: 0 }));
  for (const { L, bi } of lengths) {
    for (const ji of kind === 'lattice' ? options.jibIdx : [0]) {
      for (let a = gb.boomAngleMinDeg; a <= gb.boomAngleMaxDeg; a += 0.25) {
        const st = { ...s0, boomLength: L, boomOptionIndex: bi, jibIndex: ji, boomAngle: a * DEG };
        const g = computeGeometry(spec, st);
        if (Math.abs(g.tipU - u) < 0.3) {
          out.push(st);
          break;
        }
      }
    }
  }
  return out;
}

export function validateMission(m: MissionDef): MissionValidation {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', message });
  const warn = (message: string) => issues.push({ severity: 'warning', message });

  // --- structuur
  if (!m.id || !m.title || !m.briefing || !m.hint) err('Ontbrekende basisvelden');
  if (m.craneOptions.length === 0) err('Geen kraanopties');
  for (const c of m.craneOptions) if (!CRANES[c]) err(`Onbekende kraan ${c}`);
  const loadIds = new Set<string>();
  for (const l of m.loads) {
    if (loadIds.has(l.id)) err(`Dubbele last-id ${l.id}`);
    loadIds.add(l.id);
    if (!LOADS[l.type]) err(`Onbekend lasttype ${l.type}`);
  }
  const zoneIds = new Set(m.zones.map((z) => z.id));
  if (zoneIds.size !== m.zones.length) err('Dubbele zone-id');
  if (m.tasks.length === 0) err('Geen taken');
  for (const t of m.tasks) {
    if (t.type === 'deliver') {
      if (!loadIds.has(t.loadId)) err(`Taak verwijst naar onbekende last ${t.loadId}`);
      if (!zoneIds.has(t.zoneId)) err(`Taak verwijst naar onbekende zone ${t.zoneId}`);
    }
  }
  if (m.reward.money <= 0 || m.reward.xp <= 0) err('Beloning ontbreekt');
  if (m.parTime <= 0) err('Richttijd ontbreekt');
  if (m.crane.x < m.bounds.minX || m.crane.x > m.bounds.maxX) err('Kraan buiten de wereldgrenzen');
  if (issues.some((i) => i.severity === 'error')) return { missionId: m.id, issues, feasibility: [] };

  const colliders = buildColliders(m.obstacles);
  const ceilingY = Math.min(Infinity, ...m.obstacles.filter((o) => o.kind === 'ceiling').map((o) => o.y));
  const surfaceAt = (x: number, y: number, halfW: number): boolean => {
    if (Math.abs(y) < 0.02) return true;
    return colliders.some((c) => c.landable && Math.abs(c.maxY - y) < 0.05 && x + halfW > c.minX && x - halfW < c.maxX);
  };
  const overlaps = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cs: readonly Collider[]): Collider | null => {
    for (const c of cs) {
      if (x0 < c.maxX - 0.02 && x1 > c.minX + 0.02 && y0 < c.maxY - 0.02 && y1 > c.minY + 0.02 && z0 < c.maxZ && z1 > c.minZ) return c;
    }
    return null;
  };

  // --- lasten en zones
  for (const l of m.loads) {
    const t = LOADS[l.type];
    const z = l.z ?? 0;
    const hit = overlaps(l.x - t.width / 2, l.x + t.width / 2, l.y, l.y + t.height, z - t.depth / 2, z + t.depth / 2, colliders);
    if (hit) err(`Last ${l.id} overlapt bij de start met ${hit.id}`);
    for (const cid of m.craneOptions) {
      const cfg = CRANES[cid];
      const half = cfg.visual.carrierLength / 2;
      const onDeck = Math.abs(cfg.visual.carrierHeight - l.y) < 0.05;
      if (!onDeck && l.x + t.width / 2 > m.crane.x - half && l.x - t.width / 2 < m.crane.x + half && l.y < cfg.visual.carrierHeight && Math.abs(z) - t.depth / 2 < 1.3)
        err(`Last ${l.id} overlapt bij de start met de onderwagen van ${cid}`);
    }
    // landbaar dek van de eigen kraan telt ook als ondergrond
    const ownDeck = m.craneOptions.some((cid) => {
      const cfg = CRANES[cid];
      const half = cfg.visual.carrierLength / 2;
      return Math.abs(cfg.visual.carrierHeight - l.y) < 0.05 && l.x > m.crane.x - half && l.x < m.crane.x + half;
    });
    if (!surfaceAt(l.x, l.y, t.width / 2) && !ownDeck) err(`Last ${l.id} staat niet op een ondergrond`);
  }
  for (const zn of m.zones) {
    const task = m.tasks.find((t) => t.type === 'deliver' && t.zoneId === zn.id);
    const lt = task && task.type === 'deliver' ? LOADS[m.loads.find((l) => l.id === task.loadId)!.type] : null;
    const stacked = m.tasks.some((t) => t.type === 'deliver' && t.zoneId === zn.id) && m.zones.some((o) => o !== zn && Math.abs(o.x - zn.x) < 0.5 && o.y < zn.y);
    const ownDeck = m.craneOptions.some((cid) => Math.abs(CRANES[cid].visual.carrierHeight - zn.y) < 0.05);
    if (!surfaceAt(zn.x, zn.y, lt ? lt.width / 2 : 0.1) && !stacked && !ownDeck) err(`Zone ${zn.id} ligt niet op een oppervlak`);
    if (lt) {
      const hit = overlaps(zn.x - lt.width / 2 + zn.tolerance * 0, zn.x + lt.width / 2, zn.y + 0.01, zn.y + lt.height, -lt.depth / 2, lt.depth / 2, colliders);
      if (hit) err(`Last past niet in zone ${zn.id}: overlapt met ${hit.id}`);
    }
  }

  // --- haalbaarheid per kraan
  const feasibility: CraneFeasibility[] = [];
  for (const cid of m.craneOptions) {
    const spec = resolveCrane(CRANES[cid], []);
    const reasons: string[] = [];
    const hd = hookDims(spec);
    const lifts: LiftPoint[] = [];
    let extraCw = 0;
    for (const t of m.tasks) {
      if (t.type !== 'deliver') continue;
      const ls = m.loads.find((l) => l.id === t.loadId)!;
      const lt = LOADS[ls.type];
      const zn = m.zones.find((z) => z.id === t.zoneId)!;
      const above = lt.height + lt.slingHeight + hd.h + spec.gb.ropeMin + 0.3;
      const massT = (lt.massKg + spec.gb.hookMassKg) / 1000;
      lifts.push({ x: ls.x + (lt.comOffsetX ?? 0) * 0, heightNeeded: ls.y + above, massT, label: `${ls.id} oppakken`, extraCwT: extraCw });
      lifts.push({ x: zn.x, heightNeeded: zn.y + above, massT, label: `${ls.id} neerzetten`, extraCwT: extraCw, transit: { from: ls.x, to: zn.x, stack: above } });
      if (t.effect?.type === 'addCounterweight') extraCw += t.effect.massT;
    }
    const plan = m.planning ?? {};
    const cwIdx = plan.chooseCounterweight ? spec.counterweights.map((_, i) => i) : [Math.min(m.crane.counterweightIndex ?? spec.counterweights.length - 1, spec.counterweights.length - 1)];
    const boomIdx = plan.chooseBoom ? spec.boomOptions.map((_, i) => i) : [m.crane.boomOptionIndex ?? 0];
    const jibIdx = plan.chooseBoom || plan.chooseJib ? spec.jibOptions.map((_, i) => i) : [m.crane.jibIndex ?? 0];

    const driveTask = m.tasks.find((t) => t.type === 'drive');
    let bases: number[] = [m.crane.x];
    if (driveTask && driveTask.type === 'drive') bases = [(driveTask.x0 + driveTask.x1) / 2];
    else if (m.requirements.minGroundFactor && spec.gb.driveSpeed > 0) {
      bases = [];
      for (let x = m.bounds.minX + 8; x <= m.bounds.maxX - 8; x += 0.5) {
        const a = (spec.gb.footprintOutriggers ?? spec.gb.footprintRetracted).a;
        const sx = x + spec.gb.slewOffsetX;
        if (groundFactorFor(m.ground ?? [], [sx - a, sx + a], 0, m.groundFallback) >= m.requirements.minGroundFactor) bases.push(x);
      }
    }

    const carrierFree = (x: number): boolean => {
      const half = spec.cfg.visual.carrierLength / 2;
      const h = spec.cfg.visual.carrierHeight + 1.2;
      if (x - half < m.bounds.minX || x + half > m.bounds.maxX) return false;
      return !colliders.some((c) => c.minY <= h && c.minZ < 1.6 && c.maxZ > -1.6 && x + half > c.minX && x - half < c.maxX);
    };
    const perLiftBase = spec.gb.driveWithLoadMaxPct >= 100 && spec.gb.driveSpeed > 0;
    if (perLiftBase) {
      bases = [];
      for (let x = m.bounds.minX; x <= m.bounds.maxX; x += 0.5) if (carrierFree(x)) bases.push(x);
    }
    let best: { ok: boolean; peak: number; why: string[]; config?: CraneFeasibility['config'] } = { ok: false, peak: Infinity, why: ['geen opstelplaats gevonden'] };
    let bestFail = Infinity;
    if (perLiftBase) {
      // pick-and-carry: elke hijs mag vanaf een andere positie (rijden met last)
      const why: string[] = [];
      let peak = 0;
      // doorgang: rijdend met last moet de last over obstakels tussen hijs- en doelpositie
      const carryChecks: LiftPoint[] = [...lifts];
      for (const lp of lifts) {
        if (!lp.transit) continue;
        const a0 = Math.min(lp.transit.from, lp.transit.to);
        const a1 = Math.max(lp.transit.from, lp.transit.to);
        for (const c of colliders) {
          if (c.kind === 'ceiling' || c.minZ > 1 || c.maxZ < -1) continue;
          const x0 = Math.max(a0 + 0.5, c.minX);
          const x1 = Math.min(a1 - 0.5, c.maxX);
          if (x0 > x1) continue;
          carryChecks.push({ x: (x0 + x1) / 2, heightNeeded: c.maxY + lp.transit.stack, massT: lp.massT, label: `${lp.label.replace(' neerzetten', '')} over ${c.label ?? c.id}`, extraCwT: 0 });
        }
      }
      for (const lp of carryChecks) {
        let bestPct = Infinity;
        let reach = false;
        for (const bx of bases) {
          const base = createCraneState(spec, { ...m.crane, x: bx, outriggersDeployed: false, preassembled: true });
          const slewX = bx + spec.gb.slewOffsetX;
          const u = Math.abs(lp.x - slewX);
          if (u > spec.gb.boomMax + 2) continue;
          for (const st of statesAtRadius(spec, base, u, lp.x >= slewX ? 0 : Math.PI, { boomIdx, jibIdx })) {
            const g = computeGeometry(spec, st);
            if (g.tipHeight < lp.heightNeeded) continue;
            if (g.tipHeight > ceilingY - 0.6) continue;
            reach = true;
            bestPct = Math.min(bestPct, (lp.massT / Math.max(1e-6, allowedCapacityT(spec, st))) * 100);
          }
        }
        if (!reach) why.push(`${lp.label}: niet bereikbaar vanaf een vrije rijpositie`);
        else if (bestPct > 100) why.push(`${lp.label}: te zwaar (${bestPct.toFixed(0)} %)`);
        else peak = Math.max(peak, bestPct);
      }
      best = { ok: why.length === 0, peak, why, config: { baseX: m.crane.x, cw: cwIdx[cwIdx.length - 1], boom: boomIdx[0], jib: jibIdx[0] } };
      bases = [];
    }
    const combos: { ci: number; bi: number; ji: number }[] = [];
    for (const ci of cwIdx) for (const bi of boomIdx) for (const ji of jibIdx) combos.push({ ci, bi, ji });
    for (const bx of bases) {
      // per configuratie (contragewicht, giek, hulpgiek): alle hijsen moeten haalbaar zijn
      for (const { ci, bi, ji } of combos) {
        const base = createCraneState(spec, { ...m.crane, x: bx, counterweightIndex: ci, boomOptionIndex: bi, jibIndex: ji, outriggersDeployed: true, preassembled: true });
        const why: string[] = [];
        let peak = 0;
        const slewX = bx + spec.gb.slewOffsetX;
        // doorgang: de last moet over obstakels tussen hijs- en doelpositie (of tussen elk eindpunt en de draaias)
        const checks: LiftPoint[] = [...lifts];
        for (const lp of lifts) {
          if (!lp.transit) continue;
          const { from, to, stack } = lp.transit;
          // zelfde kant: de straal verandert onderweg (in het vlak). Tegenovergestelde kant: er wordt op vaste
          // straal gezwenkt, dus obstakels tussen draaias en eindpunt worden op de straal van dat eindpunt gepasseerd.
          const same = Math.sign(from - slewX) === Math.sign(to - slewX);
          const spans: [number, number, number | undefined][] = same
            ? [[Math.min(from, to), Math.max(from, to), undefined]]
            : [
                [Math.min(from, slewX), Math.max(from, slewX), Math.abs(from - slewX)],
                [Math.min(to, slewX), Math.max(to, slewX), Math.abs(to - slewX)],
              ];
          for (const c of colliders) {
            if (c.kind === 'ceiling' || c.minZ > 1 || c.maxZ < -1) continue;
            for (const [a, b, r] of spans) {
              const x0 = Math.max(a + 0.5, c.minX);
              const x1 = Math.min(b - 0.5, c.maxX);
              if (x0 > x1) continue;
              for (const x of [x0, x1]) checks.push({ x, atRadius: r, heightNeeded: c.maxY + stack, massT: lp.massT, label: `${lp.label.replace(' neerzetten', '')} over ${c.label ?? c.id}`, extraCwT: lp.extraCwT });
            }
          }
        }
        for (const lp of checks) {
          const u = lp.atRadius ?? Math.abs(lp.x - slewX);
          const slew = lp.x >= slewX ? 0 : Math.PI;
          const states = statesAtRadius(spec, { ...base, extraCounterweightT: lp.extraCwT }, u, slew, { boomIdx: [bi], jibIdx: [ji] });
          let bestPct = Infinity;
          let reachOk = false;
          for (const st of states) {
            const g = computeGeometry(spec, st);
            if (g.tipHeight < lp.heightNeeded || g.tipHeight > ceilingY - 0.6) continue;
            reachOk = true;
            const cap = allowedCapacityT(spec, st);
            const pct = (lp.massT / Math.max(1e-6, cap)) * 100;
            if (pct < bestPct) bestPct = pct;
          }
          if (!reachOk) why.push(`${lp.label}: niet bereikbaar (straal ${u.toFixed(1)} m, hoogte ${lp.heightNeeded.toFixed(1)} m)`);
          else if (bestPct > 100) why.push(`${lp.label}: te zwaar (${bestPct.toFixed(0)} % op ${u.toFixed(1)} m)`);
          else peak = Math.max(peak, bestPct);
        }
        if (why.length === 0) {
          // voorkeur: binnen het hijsplan, en dan de laagste belasting
          const lim = m.requirements.maxLoadPercent ?? 100;
          const better = !best.ok || (peak <= lim && best.peak > lim) || ((peak <= lim) === (best.peak <= lim) && peak < best.peak);
          if (better) best = { ok: true, peak, why: [], config: { baseX: bx, cw: ci, boom: bi, jib: ji } };
        } else if (!best.ok && why.length < bestFail) {
          bestFail = why.length;
          best = { ok: false, peak: Infinity, why };
        }
      }
    }
    if (!best.ok) reasons.push(...best.why);
    if (m.requirements.maxLoadPercent && best.ok && best.peak > m.requirements.maxLoadPercent) {
      reasons.push(`hijsplan vereist ≤ ${m.requirements.maxLoadPercent} %, beste configuratie ${best.peak.toFixed(0)} %`);
    }
    feasibility.push({ craneId: cid, feasible: reasons.length === 0, reasons, peakPercent: best.ok ? best.peak : Infinity, config: best.config });
  }
  if (!feasibility[0]?.feasible) err(`Standaardkraan ${m.craneOptions[0]} kan de missie niet uitvoeren: ${feasibility[0]?.reasons.join('; ')}`);
  for (const f of feasibility.slice(1)) if (!f.feasible) warn(`Alternatieve kraan ${f.craneId} is ongeschikt: ${f.reasons.join('; ')}`);
  return { missionId: m.id, issues, feasibility };
}
