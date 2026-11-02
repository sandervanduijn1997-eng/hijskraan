import type { CraneInput } from '../../src/cranes/controllers/craneInput';
import { emptyInput } from '../../src/cranes/controllers/craneInput';
import { CHALLENGES, challengeMission } from '../../src/missions/data/challenges';
import { MISSIONS } from '../../src/missions/data/index';
import type { MissionDef } from '../../src/missions/data/types';
import { validateMission } from '../../src/missions/validation/validateMission';
import type { DifficultyId } from '../../src/sim/difficulty';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import type { Recording } from '../../src/sim/recorder';
import type { SimOptions } from '../../src/sim/simulation';
import { Simulation, replayStep } from '../../src/sim/simulation';
import { Bot } from '../../tests/helpers/missionBot';
import { sha256, toPlain, writeRef } from './common';

/**
 * Missiesporen: de missiebot speelt elke missie, de opname (invoer + handelingen) gaat mee, plus elke
 * seconde een controlepunt met de volledige toestand. De C++-port speelt dezelfde opname af en vergelijkt.
 *
 * Over een hele missie lopen kleine verschillen (andere sin/cos-implementatie) op door slingeren en
 * contacten. Vergelijk daarom: controlepunten in het begin strikt, verderop op drift, en de afloop
 * (geslaagd, sterren, waar de lasten staan) als eindoordeel.
 *
 * Elke opname wordt hier al opnieuw afgespeeld in een verse Simulation; de controlepunten moeten exact
 * gelijk zijn. Dat bewijst dat opname + opties genoeg zijn om de missie te reproduceren.
 */

const CHECKPOINT_STEPS = 60;
const MAX_SECONDS = 1800;
/** Een paar missies ook op Realistisch (minder slingerdemping, kantelen aan). */
const REALISTIC = ['m01', 'm05', 'm09'];

/** Vaste kolomvolgorde voor de compacte invoer: [stap, ...INPUT_KEYS]. */
export const INPUT_KEYS: (keyof CraneInput)[] = Object.keys(emptyInput()) as (keyof CraneInput)[];

interface Run {
  key: string;
  mission: MissionDef;
  difficulty: DifficultyId;
  challengeId?: string;
}

function checkpoint(sim: Simulation): unknown {
  return toPlain(
    structuredClone({
      step: sim.stepCount,
      time: sim.time,
      crane: sim.crane,
      tip: sim.geom.tip,
      hook: sim.hookPoint(),
      rope: sim.rope,
      tensionF: sim.tensionF,
      tensionFast: sim.tensionFast,
      loadPct: sim.loadPct,
      lmiPct: sim.lmiPct,
      capacityT: sim.capacityT,
      stability: sim.stability,
      swayDeg: sim.swayDeg,
      padPressure: sim.padPressure,
      groundFactor: sim.groundFactor,
      wind: sim.wind,
      attached: sim.attached?.id ?? null,
      loads: sim.loads.map((l) => ({ id: l.id, status: l.status, damage: l.damage, massKg: l.massKg, pos: l.cb.body.pos, q: l.cb.body.q, vel: l.cb.body.vel, omega: l.cb.body.omega })),
      metrics: sim.metrics,
      outcome: sim.outcome,
    }),
  );
}

function options(m: MissionDef, difficulty: DifficultyId): { opt: SimOptions; config: { baseX: number } | undefined } {
  const v = validateMission(m);
  const f = v.feasibility.find((x) => x.feasible) ?? v.feasibility[0];
  const cfg = f?.config;
  return { opt: { mission: m, craneId: f?.craneId, difficulty: DIFFICULTIES[difficulty], counterweightIndex: cfg?.cw, boomOptionIndex: cfg?.boom, jibIndex: cfg?.jib }, config: cfg };
}

/** Speel met de bot (zelfde lus als playMission) en verzamel controlepunten. */
function play(opt: SimOptions, config: { baseX: number } | undefined): { sim: Simulation; checkpoints: unknown[] } {
  const sim = new Simulation(opt);
  const gen = new Bot(sim).run(config);
  const checkpoints = [checkpoint(sim)];
  for (let k = 0; k < MAX_SECONDS * 60 && sim.outcome === 'running'; k++) {
    if (sim.time < sim.workStopUntil) sim.step(emptyInput());
    else sim.step(gen.next().value ?? emptyInput());
    sim.drainEvents();
    if (sim.stepCount % CHECKPOINT_STEPS === 0) checkpoints.push(checkpoint(sim));
  }
  checkpoints.push(checkpoint(sim));
  return { sim, checkpoints };
}

/** Speel de opname opnieuw af en geef de controlepunten. */
function replay(opt: SimOptions, rec: Recording): unknown[] {
  const sim = new Simulation(opt);
  const checkpoints = [checkpoint(sim)];
  while (sim.stepCount < rec.steps) {
    replayStep(sim, rec);
    sim.drainEvents();
    if (sim.stepCount % CHECKPOINT_STEPS === 0) checkpoints.push(checkpoint(sim));
  }
  checkpoints.push(checkpoint(sim));
  return checkpoints;
}

export interface MissionSummary {
  key: string;
  outcome: string;
  reason: string;
  time: number;
  stars: number;
  steps: number;
  file: string;
}

export function exportMissions(only?: string[]): { files: string[]; summary: MissionSummary[] } {
  const runs: Run[] = [];
  for (const m of MISSIONS) runs.push({ key: `normal/${m.id}`, mission: m, difficulty: 'normal' });
  for (const id of REALISTIC) runs.push({ key: `realistic/${id}`, mission: MISSIONS.find((m) => m.id === id)!, difficulty: 'realistic' });
  for (const c of CHALLENGES) runs.push({ key: `challenge/${c.id}`, mission: challengeMission(c), difficulty: 'normal', challengeId: c.id });

  const files: string[] = [];
  const summary: MissionSummary[] = [];
  for (const run of runs) {
    if (only && !only.some((o) => run.key.endsWith('/' + o))) continue;
    const t0 = Date.now();
    const { opt, config } = options(run.mission, run.difficulty);
    const { sim, checkpoints } = play(opt, config);
    const rec = sim.recorder.rec;
    const again = replay(opt, rec);
    if (sha256(JSON.stringify(again)) !== sha256(JSON.stringify(checkpoints))) throw new Error(`${run.key}: opnieuw afspelen wijkt af van de opname`);
    const challenge = run.challengeId ? CHALLENGES.find((c) => c.id === run.challengeId)! : null;
    const file = writeRef(
      `missions/${run.key}`,
      {
        key: run.key,
        missionId: run.mission.id,
        difficulty: run.difficulty,
        // de missie zelf staat in data/missions.json (uitdagingen in data/challenges.json)
        options: { craneId: sim.missionSpec.cfg.id, counterweightIndex: opt.counterweightIndex, boomOptionIndex: opt.boomOptionIndex, jibIndex: opt.jibIndex },
        checkpointSteps: CHECKPOINT_STEPS,
        recording: {
          steps: rec.steps,
          inputKeys: INPUT_KEYS,
          inputs: rec.inputs.map((e) => [e.step, ...INPUT_KEYS.map((k) => e.input[k])]),
          actions: rec.actions,
        },
        checkpoints,
        final: {
          outcome: sim.outcome,
          failReason: sim.failReason,
          score: sim.score,
          metrics: sim.metrics,
          challengeRate: challenge && sim.outcome === 'success' ? challenge.rate(sim.metrics) : null,
        },
      },
      true,
    );
    files.push(file);
    const s: MissionSummary = { key: run.key, outcome: sim.outcome, reason: sim.failReason, time: Math.round(sim.time), stars: sim.score?.stars ?? 0, steps: rec.steps, file };
    summary.push(s);
    console.log(`${run.key.padEnd(22)} ${s.outcome.padEnd(8)} ${'★'.repeat(s.stars).padEnd(3)} t=${s.time}s ${s.outcome !== 'success' ? '← ' + (s.reason || 'vastgelopen') : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return { files, summary };
}
