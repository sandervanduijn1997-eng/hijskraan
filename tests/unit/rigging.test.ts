import { describe, expect, it } from 'vitest';
import { getLoad } from '../../src/missions/data/loads';
import { BEAMS, CHAINS, MAX_SLING_ANGLE, ROUND_SLINGS, buildRig, expectedTilt, legLoadT, rigProblems, standardRig, suggestRig } from '../../src/sim/rigging';
import { Simulation } from '../../src/sim/simulation';
import { getMission } from '../../src/missions/data/index';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import type { MissionDef } from '../../src/missions/data/types';
import { bodyTilt } from '../../src/physics/load/rigidBody';

describe('aanslaan: geometrie en belasting', () => {
  const pallet = getLoad('pallet500');
  it('kortere stroppen geven een plattere hoek en meer belasting per sprong', () => {
    const long = buildRig(pallet, { gear: ROUND_SLINGS[0], legs: 4, length: 3, points: 'center' });
    const short = buildRig(pallet, { gear: ROUND_SLINGS[0], legs: 4, length: 0.8, points: 'center' });
    expect(short.angle).toBeGreaterThan(long.angle);
    expect(legLoadT(short, 1)).toBeGreaterThan(legLoadT(long, 1));
    // 4-sprong draagt als 3: bij een verticale belasting 1/3 per sprong
    expect(legLoadT(long, 3) / Math.cos(long.angle)).toBeGreaterThan(0.99);
  });

  it('te korte stroppen en te licht gereedschap worden gemeld', () => {
    const beam = getLoad('steelBeam9');
    const flat = buildRig(beam, { gear: CHAINS[2], legs: 2, length: 4, points: 'center' });
    expect(flat.angle).toBeGreaterThan(MAX_SLING_ANGLE);
    expect(rigProblems(beam, flat).some((p) => p.includes('stropshoek'))).toBe(true);
    const weak = buildRig(getLoad('machine'), { gear: ROUND_SLINGS[0], legs: 4, length: 4, points: 'cog' });
    expect(rigProblems(getLoad('machine'), weak).some((p) => p.includes('overbelast'))).toBe(true);
  });

  it('hijspunten boven het zwaartepunt houden een excentrische last recht', () => {
    const m = getLoad('machine');
    const center = buildRig(m, { gear: CHAINS[2], legs: 4, length: 3, points: 'center' });
    const cog = buildRig(m, { gear: CHAINS[2], legs: 4, length: 3, points: 'cog' });
    expect(Math.abs(expectedTilt(m, cog))).toBeLessThan(1e-9);
    expect(Math.abs(expectedTilt(m, center))).toBeGreaterThan(0.04);
  });

  it('een hijsbalk geeft verticale sprongen', () => {
    const r = buildRig(getLoad('steelBeam9'), { gear: BEAMS[0], legs: 2, length: 2, points: 'cog' });
    expect(r.angle).toBe(0);
  });

  it('het voorstel is altijd een geldige aanslag', () => {
    for (const id of ['pallet500', 'steelBeam6', 'steelBeam9', 'machine', 'siteContainer', 'shipEngine']) {
      const t = getLoad(id);
      expect(rigProblems(t, buildRig(t, suggestRig(t)))).toEqual([]);
    }
  });

  it('standaard aanslag blijft gelijk aan het oude ophangpunt', () => {
    const r = standardRig(pallet);
    expect(r.apexX).toBe(0);
    expect(r.height).toBe(pallet.slingHeight);
  });
});

describe('aanslaan in de simulatie', () => {
  const m01 = getMission('m01')!;
  const inp = (hoist: number) => ({ ...emptyInput(), hoist });
  const toCandidate = (sim: Simulation) => {
    for (let i = 0; i < 4000 && !sim.attachCandidate(); i++) sim.step(inp(-1));
    expect(sim.attachCandidate()).not.toBeNull();
  };

  it('vraagt om een keuze en hangt de last aan de gekozen aanslag', () => {
    const sim = new Simulation({ mission: m01, manualRigging: true });
    toCandidate(sim);
    expect(sim.toggleRigging()).toBe('choose');
    const msg = sim.attachWith({ gear: ROUND_SLINGS[1], legs: 4, length: 3, points: 'cog' });
    expect(msg).toContain('aangeslagen');
    expect(sim.rig?.choice?.gear.wll).toBe(2);
  });

  it('een te zwakke strop breekt bij het hijsen en de missie mislukt', () => {
    const sim = new Simulation({ mission: m01, manualRigging: true });
    toCandidate(sim);
    // 0,5 t op een 2-sprong met 1 t stroppen op 0,8 m: ~ 60° → per sprong ~0,5 t, maar dan met een te lichte "strop"
    sim.attachWith({ gear: { kind: 'round', wll: 0.1, label: 'test 0,1 t', color: 0 }, legs: 2, length: 1.5, points: 'cog' });
    for (let i = 0; i < 2400 && sim.outcome === 'running'; i++) sim.step(inp(1));
    expect(sim.outcome).toBe('failed');
    expect(sim.failReason).toContain('strop brak');
    expect(sim.attached).toBeNull();
  });

  it('hijspunten in het midden laten een excentrische last scheef hangen', () => {
    const t = getLoad('machine');
    const mission: MissionDef = { ...m01, loads: [{ ...m01.loads[0], type: 'machine' }] };
    const tilts: number[] = [];
    for (const points of ['center', 'cog'] as const) {
      const sim = new Simulation({ mission, manualRigging: true, craneId: m01.craneOptions[0] });
      toCandidate(sim);
      sim.attachWith({ gear: CHAINS[2], legs: 4, length: 3, points });
      for (let i = 0; i < 1800; i++) sim.step(inp(i < 900 ? 1 : 0));
      tilts.push(Math.abs(bodyTilt(sim.attached!.cb.body).roll));
    }
    expect(tilts[0]).toBeGreaterThan(Math.abs(expectedTilt(t, buildRig(t, { gear: CHAINS[2], legs: 4, length: 3, points: 'center' }))) * 0.5);
    expect(tilts[1]).toBeLessThan(tilts[0] * 0.3);
  });
});
