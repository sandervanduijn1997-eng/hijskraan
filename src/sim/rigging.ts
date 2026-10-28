import type { LoadType } from '../missions/data/loads';

/**
 * Aanslaan als vaardigheid: hijsgereedschap kiezen (rondstroppen, kettingen, hijsbalk), aantal sprongen,
 * stroplengte en hijspunten. Hieruit volgen de stropshoek, de belasting per sprong en het ophangpunt
 * boven de last (en dus hoe scheef hij gaat hangen). Waarden zijn spelwaarden, gebaseerd op de
 * gangbare normen: rondstroppen EN 1492-2 (kleurcode per draagvermogen), kettingen klasse 8 (EN 818-4),
 * en de regel dat een 4-sprong als een 3-sprong mag worden belast.
 */

/**
 * Gereedschap: stroppen, kettingen en hijsbalk (meerdere sprongen), en hulpstukken met één ophangpunt:
 * plaatklem (kanaalplaten), vacuümheffer (glas en panelen) en steenvork (pallets).
 */
export type GearKind = 'round' | 'chain' | 'beam' | 'clamp' | 'vacuum' | 'fork';
/** Hulpstukken met één ophangpunt (geen sprongen of stroplengte). */
export const DEVICES: GearKind[] = ['clamp', 'vacuum', 'fork'];
export const isDevice = (k: GearKind): boolean => DEVICES.includes(k);
export type PointMode = 'center' | 'cog';

export interface GearOption {
  kind: GearKind;
  /** Werklast (WLL) per sprong (t); bij een hijsbalk de werklast van de balk. */
  wll: number;
  label: string;
  /** Kleur in de wereld (rondstrop-kleurcode, ketting staal, balk geel). */
  color: number;
}

/** Rondstroppen (kleurcode EN 1492-2). */
export const ROUND_SLINGS: GearOption[] = [
  { kind: 'round', wll: 1, label: 'Rondstrop violet 1 t', color: 0x7d4bb3 },
  { kind: 'round', wll: 2, label: 'Rondstrop groen 2 t', color: 0x2f9e44 },
  { kind: 'round', wll: 3, label: 'Rondstrop geel 3 t', color: 0xf2c400 },
  { kind: 'round', wll: 4, label: 'Rondstrop grijs 4 t', color: 0x8d949b },
  { kind: 'round', wll: 5, label: 'Rondstrop rood 5 t', color: 0xc8261d },
  { kind: 'round', wll: 6, label: 'Rondstrop bruin 6 t', color: 0x7a4a25 },
  { kind: 'round', wll: 8, label: 'Rondstrop blauw 8 t', color: 0x2f6db5 },
  { kind: 'round', wll: 10, label: 'Rondstrop oranje 10 t', color: 0xe67e22 },
  { kind: 'round', wll: 20, label: 'Rondstrop oranje 20 t', color: 0xe67e22 },
];

/** Kettingen klasse 8 (werklast per sprong bij verticale belasting). */
export const CHAINS: GearOption[] = [
  { kind: 'chain', wll: 3.15, label: 'Ketting 10 mm (3,15 t)', color: 0x5c6166 },
  { kind: 'chain', wll: 5.3, label: 'Ketting 13 mm (5,3 t)', color: 0x5c6166 },
  { kind: 'chain', wll: 8, label: 'Ketting 16 mm (8 t)', color: 0x5c6166 },
  { kind: 'chain', wll: 12.5, label: 'Ketting 20 mm (12,5 t)', color: 0x5c6166 },
  { kind: 'chain', wll: 20, label: 'Ketting 26 mm (20 t)', color: 0x5c6166 },
  { kind: 'chain', wll: 31.5, label: 'Ketting 32 mm (31,5 t)', color: 0x5c6166 },
];

/** Hijsbalken met verticale sprongen (werklast van de balk). */
export const BEAMS: GearOption[] = [
  { kind: 'beam', wll: 10, label: 'Hijsbalk 10 t', color: 0xf2b705 },
  { kind: 'beam', wll: 25, label: 'Hijsbalk 25 t', color: 0xf2b705 },
  { kind: 'beam', wll: 60, label: 'Hijsbalk 60 t', color: 0xf2b705 },
  { kind: 'beam', wll: 120, label: 'Hijsbalk 120 t', color: 0xf2b705 },
  { kind: 'beam', wll: 250, label: 'Hijsjuk 250 t', color: 0xf2b705 },
];

/** Plaatklemmen voor kanaalplaten (werklast van de klem). */
export const CLAMPS: GearOption[] = [
  { kind: 'clamp', wll: 5, label: 'Plaatklem 5 t', color: 0xd02a1e },
  { kind: 'clamp', wll: 8, label: 'Plaatklem 8 t', color: 0xd02a1e },
  { kind: 'clamp', wll: 12, label: 'Plaatklem 12 t', color: 0xd02a1e },
];

/** Vacuümheffers voor glas en gladde panelen. */
export const VACUUMS: GearOption[] = [
  { kind: 'vacuum', wll: 0.6, label: 'Vacuümheffer 600 kg', color: 0x2b2f33 },
  { kind: 'vacuum', wll: 1.2, label: 'Vacuümheffer 1,2 t', color: 0x2b2f33 },
  { kind: 'vacuum', wll: 2, label: 'Vacuümheffer 2 t', color: 0x2b2f33 },
];

/** Steenvorken voor pallets. */
export const FORKS: GearOption[] = [
  { kind: 'fork', wll: 1.5, label: 'Steenvork 1,5 t', color: 0xf2b705 },
  { kind: 'fork', wll: 3, label: 'Steenvork 3 t', color: 0xf2b705 },
];

/** Hoogte van het ophangpunt boven de last bij een hulpstuk (m). */
const DEVICE_HEIGHT: Partial<Record<GearKind, number>> = { clamp: 1.6, vacuum: 1.1, fork: 2.4 };

/** Past dit gereedschap bij deze last? */
export function gearFits(t: LoadType, kind: GearKind): boolean {
  if (t.style === 'glass') return kind === 'vacuum';
  if (kind === 'clamp') return t.style === 'slab';
  if (kind === 'vacuum') return t.style === 'panel';
  if (kind === 'fork') return t.style === 'pallet' || t.style === 'bricks';
  return true;
}

/** Last met scherpe randen: rondstroppen zonder kantbescherming worden doorgesneden. */
export const sharpEdges = (t: LoadType): boolean => t.sharpEdges ?? ['beam', 'truss', 'slab', 'concrete'].includes(t.style);

/** Windgrens van het gereedschap (m/s): een vacuümheffer verliest bij wind zijn grip. */
export const gearWindLimit = (kind: GearKind | undefined): number => (kind === 'vacuum' ? 9 : Infinity);

export const SLING_LENGTHS = [1.5, 2, 3, 4, 6, 8, 10, 12];

export interface RigChoice {
  gear: GearOption;
  legs: 2 | 4;
  length: number;
  points: PointMode;
  /** Kantbescherming onder de stroppen, stuurlijnen aan de last en een lastmeter in de haak. */
  edge?: boolean;
  taglines?: boolean;
  loadCell?: boolean;
}

/** Uitgewerkte aanslag: hijspunten in het lichaamsframe en de geometrie. */
export interface Rig {
  choice: RigChoice | null;
  /** Hijspunten op de bovenkant van de last (lichaamsframe, x/z; y = bovenkant). */
  points: { x: number; z: number }[];
  /** Ophangpunt (haak) t.o.v. de bovenkant van de last. */
  apexX: number;
  height: number;
  /** Stropshoek t.o.v. de verticaal (rad). */
  angle: number;
  /** Aantal sprongen dat volgens de norm draagt (4-sprong = 3). */
  bearingLegs: number;
  /** Werklast per sprong (of van de balk) (t). */
  wll: number;
  label: string;
  color: number;
}

/** Hoogte van een hijsbalk boven de last (de stroppen hangen er verticaal onder). */
const BEAM_DROP = 1.2;

/**
 * Standaard aanslag (zoals vroeger): ophangpunt recht boven het zwaartepunt op de hoogte uit de lastdata.
 * Gebruikt op Oefenen, door tests en door de bot.
 */
export function standardRig(t: LoadType): Rig {
  const hx = t.width * 0.4;
  const hz = Math.min(t.depth, 6) * 0.4;
  const height = t.slingHeight;
  return {
    choice: null,
    points: [{ x: -hx, z: -hz }, { x: -hx, z: hz }, { x: hx, z: -hz }, { x: hx, z: hz }],
    // zoals vroeger: boven het geometrisch midden (excentrische lasten hangen dus licht scheef)
    apexX: 0,
    height,
    angle: Math.atan2(Math.hypot(hx, hz), height),
    bearingLegs: 3,
    wll: Infinity,
    label: 'Standaard aanslag',
    color: 0xe0b020,
  };
}

/**
 * Werk een keuze uit. Punten liggen in het lichaamsframe t.o.v. het geometrisch midden van de bovenkant;
 * bij "boven het zwaartepunt" verschuiven ze mee met het zwaartepunt, zodat de last recht hangt.
 */
export function buildRig(t: LoadType, c: RigChoice): Rig {
  const comX = t.comOffsetX ?? 0;
  const cx = c.points === 'cog' ? comX : 0;
  const hx = Math.min(t.width * 0.42, t.width / 2 - 0.05);
  const hz = Math.min(t.depth, 6) * 0.4;
  const points =
    c.legs === 2
      ? t.width >= t.depth
        ? [{ x: cx - hx, z: 0 }, { x: cx + hx, z: 0 }]
        : [{ x: cx, z: -hz }, { x: cx, z: hz }]
      : [{ x: cx - hx, z: -hz }, { x: cx - hx, z: hz }, { x: cx + hx, z: -hz }, { x: cx + hx, z: hz }];
  const spread = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.z)));
  let height: number;
  let angle: number;
  if (isDevice(c.gear.kind)) {
    // hulpstuk: één ophangpunt recht boven de last
    const h = DEVICE_HEIGHT[c.gear.kind] ?? 1.5;
    const cut = { x: cx, z: 0 };
    return {
      choice: c,
      points: [cut],
      apexX: cx,
      height: h,
      angle: 0,
      bearingLegs: 1,
      wll: c.gear.wll,
      label: c.gear.label,
      color: c.gear.color,
    };
  } else if (c.gear.kind === 'beam') {
    // balk boven de last, verticale sprongen: geen hoek; ophangpunt boven het midden van de balk
    height = c.length + BEAM_DROP;
    angle = 0;
  } else {
    height = c.length > spread ? Math.sqrt(c.length * c.length - spread * spread) : 0.05;
    angle = Math.atan2(spread, height);
  }
  return {
    choice: c,
    points,
    apexX: cx,
    height,
    angle,
    bearingLegs: c.gear.kind === 'beam' ? 1 : c.legs === 4 ? 3 : 2,
    // rondstroppen over een scherpe rand zonder kantbescherming: werklast gehalveerd (snijgevaar)
    wll: c.gear.kind === 'round' && sharpEdges(t) && !c.edge ? c.gear.wll / 2 : c.gear.wll,
    label: `${c.gear.label}${c.gear.kind === 'beam' ? '' : `, ${c.legs}-sprong`}, ${String(c.length).replace('.', ',')} m`,
    color: c.gear.color,
  };
}

/** Belasting per sprong (t) bij een kabelkracht (t): F = G / (n · cos α). Bij een balk: de hele last op de balk. */
export function legLoadT(rig: Rig, loadT: number): number {
  if (rig.choice && (rig.choice.gear.kind === 'beam' || isDevice(rig.choice.gear.kind))) return loadT;
  return loadT / (rig.bearingLegs * Math.max(0.05, Math.cos(rig.angle)));
}

/** Benutting van het gereedschap (1 = op de werklast). */
export const rigUtilisation = (rig: Rig, loadT: number): number => (Number.isFinite(rig.wll) ? legLoadT(rig, loadT) / rig.wll : 0);

/** Maximale stropshoek t.o.v. de verticaal (60°: daarboven niet toegestaan). */
export const MAX_SLING_ANGLE = (60 * Math.PI) / 180;

/** Verwachte scheefstand (rad) als het ophangpunt niet boven het zwaartepunt ligt. */
export function expectedTilt(t: LoadType, rig: Rig): number {
  const comX = t.comOffsetX ?? 0;
  return Math.atan2(rig.apexX - comX, rig.height + t.height / 2);
}

/**
 * Breukgrens als veelvoud van de werklast (spelwaarde, ver onder de echte veiligheidsfactor 7 voor
 * rondstroppen en 4 voor kettingen, zodat overbelasting merkbaar gevolgen heeft).
 */
export const BREAK_FACTOR: Record<GearKind, number> = { round: 1.6, chain: 2, beam: 1.8, clamp: 2, vacuum: 1.4, fork: 2 };

/** Opties die passen bij een last (geen overbodig lange stroppen of te kleine balken in de lijst). */
export function gearFor(kind: GearKind): GearOption[] {
  return { round: ROUND_SLINGS, chain: CHAINS, beam: BEAMS, clamp: CLAMPS, vacuum: VACUUMS, fork: FORKS }[kind];
}

/** Een goede keuze voor een last (voor de bot, tests en als voorstel): lichtste gereedschap dat past. */
export function suggestRig(t: LoadType): RigChoice {
  const loadT = t.massKg / 1000;
  const legs: 2 | 4 = t.width / Math.max(0.1, t.depth) > 4 ? 2 : 4;
  // eerst het hulpstuk dat bij de last hoort (klem, vacuüm), anders stroppen, kettingen, balk
  const base: GearKind[] = ['round', 'chain', 'beam'];
  const kinds: GearKind[] = [...DEVICES.filter((k) => k !== 'fork' && gearFits(t, k)), ...base].filter((k) => gearFits(t, k));
  for (const kind of kinds) {
    for (const gear of gearFor(kind)) {
      for (const length of SLING_LENGTHS) {
        const c: RigChoice = { gear, legs, length, points: 'cog', edge: sharpEdges(t) };
        const r = buildRig(t, c);
        if (r.angle <= (45 * Math.PI) / 180 && rigUtilisation(r, loadT) <= 0.9) return c;
      }
    }
  }
  return { gear: BEAMS[BEAMS.length - 1], legs: 4, length: 4, points: 'cog' };
}

/** Problemen met een keuze (leeg = in orde). */
export function rigProblems(t: LoadType, rig: Rig): string[] {
  const out: string[] = [];
  const loadT = t.massKg / 1000;
  const k = rig.choice?.gear.kind;
  if (k && !gearFits(t, k)) out.push(t.style === 'glass' ? 'glas alleen met een vacuümheffer' : 'dit gereedschap past niet bij deze last');
  if (k === 'round' && sharpEdges(t) && !rig.choice?.edge) out.push('scherpe randen zonder kantbescherming: werklast gehalveerd, de strop kan doorsnijden');
  if (rig.angle > MAX_SLING_ANGLE) out.push(`stropshoek ${Math.round((rig.angle * 180) / Math.PI)}° — te plat, neem langere stroppen (max. 60°)`);
  const u = rigUtilisation(rig, loadT);
  if (u > 1) out.push(`gereedschap overbelast: ${legLoadT(rig, loadT).toFixed(1).replace('.', ',')} t per sprong bij ${String(rig.wll).replace('.', ',')} t werklast`);
  const tilt = Math.abs(expectedTilt(t, rig));
  if (tilt > (3 * Math.PI) / 180) out.push(`last gaat ${Math.round((tilt * 180) / Math.PI)}° scheef hangen — hijspunten niet boven het zwaartepunt`);
  return out;
}
