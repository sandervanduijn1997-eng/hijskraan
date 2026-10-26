import { describe, expect, it } from 'vitest';
import { getMission } from '../../src/missions/data/index';
import { withOptionalAssembly } from '../../src/missions/data/towerAssembly';
import { Simulation } from '../../src/sim/simulation';

describe('torenmontage één keer', () => {
  it('missie 12 heeft de volledige montage', () => {
    expect(getMission('m12')!.assembly).toBeDefined();
  });

  it('missies 13–15 starten direct met de opdracht; de toren staat op werkhoogte', () => {
    for (const id of ['m13', 'm14', 'm15']) {
      const m = getMission(id)!;
      expect(m.assembly).toBeUndefined();
      expect(m.assemblyOptional).toBe(true);
      const sim = new Simulation({ mission: m });
      expect(sim.assembly).toBeNull();
      expect(sim.crane.setupProgress).toBe(1);
      expect(sim.tasks[0].def.type).toBe('deliver');
    }
  });

  it('zelf opbouwen kan nog en geeft bonus-XP', () => {
    const m = getMission('m13')!;
    const a = withOptionalAssembly(m);
    expect(a.assembly).toBeDefined();
    expect(a.reward.xp).toBeGreaterThan(m.reward.xp);
    expect(new Simulation({ mission: a }).assembly).not.toBeNull();
  });
});
