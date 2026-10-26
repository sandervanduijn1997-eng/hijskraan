import { DEG, clamp } from '../../utils/math';
import type { ResolvedCrane } from './craneSpec';

export type Axis = 'luff' | 'slew' | 'hoist' | 'tele' | 'trolley' | 'knuckle' | 'knuckleTele' | 'drive';
export const AXES: Axis[] = ['luff', 'slew', 'hoist', 'tele', 'trolley', 'knuckle', 'knuckleTele', 'drive'];

/** Volledige, serialiseerbare toestand van een kraan. Hoeken in radialen, afstanden in meter. */
export interface CraneState {
  baseX: number;
  /** Diepte-positie (z) van de kraan; de onderwagen staat altijd evenwijdig aan x. */
  baseZ: number;
  slew: number;
  boomAngle: number;
  boomLength: number;
  boomOptionIndex: number;
  jibIndex: number;
  trolley: number;
  knuckle: number;
  knuckleTele: number;
  ropeLength: number;
  /** Per stempel: uitschuiflengte (0..1) en vijzel (0..1). Volgorde: links-voor, rechts-voor, links-achter, rechts-achter. */
  outriggerBeam: number[];
  outriggerJack: number[];
  counterweightIndex: number;
  /** Tijdens de missie gemonteerd extra contragewicht (t). */
  extraCounterweightT: number;
  /** Opbouwvoortgang 0..1 (zelfopbouw / giekmontage). 1 = gereed. */
  setupProgress: number;
  /** Kanteling (rad) en kantelsnelheid. */
  tilt: number;
  tiltVel: number;
  tipped: boolean;
  /** Actuele actuatorsnelheden in eenheden/s (voor hellingen, geluid en effecten). */
  vel: Record<Axis, number>;
  wheelRot: number;
  /** Motorbelasting 0..1. */
  engine: number;
  /** Motortoerental (tpm; 0 bij elektrische kranen) en hydraulische systeemdruk (bar). */
  rpm: number;
  hydPressure: number;
  /** Resterende tijd (s) dat het werktoerental (handgas) blijft staan. */
  rpmHold: number;
  /** Doorbuiging van de giekpunt loodrecht op de giek (m, positief = omlaag) en de snelheid daarvan. */
  boomDeflect: number;
  boomDeflectVel: number;
  /** Zijde van de kraanmatten onder de stempels (m), 0 = geen. */
  matSide: number;
  /** Hoe ver elke stempel in de grond is weggezakt (m). */
  padSink: number[];
  fuelUsed: number;
}

export interface CraneStartConfig {
  x: number;
  /** Diepte-positie (z), standaard 0. */
  z?: number;
  slewDeg?: number;
  boomAngleDeg?: number;
  boomLength?: number;
  boomOptionIndex?: number;
  jibIndex?: number;
  trolley?: number;
  knuckleDeg?: number;
  knuckleTele?: number;
  ropeLength?: number;
  outriggersDeployed?: boolean;
  counterweightIndex?: number;
  /** Voor zelfopbouw/giekmontage: start al opgebouwd? */
  preassembled?: boolean;
}

export function zeroVel(): Record<Axis, number> {
  return { luff: 0, slew: 0, hoist: 0, tele: 0, trolley: 0, knuckle: 0, knuckleTele: 0, drive: 0 };
}

export function createCraneState(spec: ResolvedCrane, start: CraneStartConfig): CraneState {
  const gb = spec.gb;
  const n = gb.outriggerCount;
  const deployed = start.outriggersDeployed ?? false;
  const cwMax = spec.counterweights.length - 1;
  const needsSetup = gb.setupType === 'selfErect' || gb.setupType === 'boomAssembly' || gb.setupType === 'towerAssembly';
  const boomOptionIndex = clamp(start.boomOptionIndex ?? 0, 0, Math.max(0, spec.boomOptions.length - 1));
  const boomLength =
    spec.cfg.kind === 'lattice'
      ? spec.boomOptions[boomOptionIndex] ?? gb.boomMin
      : clamp(start.boomLength ?? gb.boomMin, gb.boomMin, gb.boomMax);
  return {
    baseX: start.x,
    baseZ: start.z ?? 0,
    slew: (start.slewDeg ?? 0) * DEG,
    boomAngle: clamp((start.boomAngleDeg ?? 45) * DEG, gb.boomAngleMinDeg * DEG, gb.boomAngleMaxDeg * DEG),
    boomLength,
    boomOptionIndex,
    jibIndex: clamp(start.jibIndex ?? 0, 0, spec.jibOptions.length - 1),
    trolley: clamp(start.trolley ?? (gb.jibLength ?? 10) * 0.4, gb.trolleyMin ?? 0, gb.jibLength ?? 0),
    knuckle: clamp((start.knuckleDeg ?? -90) * DEG, (gb.knuckleMinDeg ?? -170) * DEG, (gb.knuckleMaxDeg ?? 20) * DEG),
    knuckleTele: clamp(start.knuckleTele ?? 0, 0, gb.knuckleTeleMax ?? 0),
    ropeLength: clamp(start.ropeLength ?? 6, gb.ropeMin, gb.ropeMax),
    outriggerBeam: Array.from({ length: n }, () => (deployed ? 1 : 0)),
    outriggerJack: Array.from({ length: n }, () => (deployed ? 1 : 0)),
    counterweightIndex: clamp(start.counterweightIndex ?? cwMax, 0, cwMax),
    extraCounterweightT: 0,
    setupProgress: needsSetup && !start.preassembled ? 0 : 1,
    tilt: 0,
    tiltVel: 0,
    tipped: false,
    vel: zeroVel(),
    wheelRot: 0,
    engine: 0,
    rpm: spec.cfg.kind === 'tower' ? 0 : 750,
    hydPressure: 0,
    rpmHold: 0,
    boomDeflect: 0,
    boomDeflectVel: 0,
    matSide: 0,
    padSink: [0, 0, 0, 0],
    fuelUsed: 0,
  };
}

export const cloneCraneState = (s: CraneState): CraneState => ({
  ...s,
  outriggerBeam: [...s.outriggerBeam],
  outriggerJack: [...s.outriggerJack],
  padSink: [...s.padSink],
  vel: { ...s.vel },
});
