import type { CraneConfig } from '../config/types';

/**
 * Maatvoering van een bovendraaiende torenkraan tijdens de montage met een hulpkraan.
 *
 * Volgorde zoals op de bouwplaats: fundering met voetsectie staat er al → mastsecties tot montagehoogte →
 * draaikrans met cabine → torenkop (A-bok) → tegengiek met trekstangen → eerste ballastblok →
 * giek met trekstangen → resterende ballast. Daarna klimt de kraan zelf naar werkhoogte.
 */

/** Hoogte van draaikrans + cabineplatform boven de mast (m). */
export const TOWER_SLEW_UNIT_H = 2;
/** Hoogte van de torenkop (A-bok) boven het giekvlak (m). */
export const TOWER_HEAD_H = 7;
/** Totaal aantal mastsecties op werkhoogte. */
export const TOWER_MAST_SECTIONS = 8;
/** Aantal mastsecties op montagehoogte (de rest klimt de kraan zelf in). */
export const TOWER_ERECTION_SECTIONS = 3;
/** Afstand van de draaias tot het aanzetpunt van giek en tegengiek (m). */
export const TOWER_ROOT_OFFSET = 1.6;
/** Ballastblokken op de tegengiek: maat langs de tegengiek en tussenruimte (m). */
export const TOWER_BALLAST_W = 1.1;
export const TOWER_BALLAST_H = 2.4;
export const TOWER_BALLAST_PITCH = 1.4;
/** Dikte van tegengiek en giek (m). */
export const TOWER_COUNTERJIB_H = 1.2;
export const TOWER_JIB_H = 1.5;

export const towerSectionHeight = (cfg: CraneConfig): number => ((cfg.gameBalance.towerHeight ?? 30) - TOWER_SLEW_UNIT_H) / TOWER_MAST_SECTIONS;

export interface ErectionLayout {
  x: number;
  z: number;
  /** Richting van de giek langs x (+1 of −1); de tegengiek wijst de andere kant op. */
  jibDir: 1 | -1;
  baseH: number;
  secH: number;
  /** Bovenkant van de mast met n secties. */
  mastTop(n: number): number;
  /** Hoogte van het giekvlak (bovenkant draaikrans) op montagehoogte. */
  deckY: number;
  counterJib: { x0: number; x1: number; y0: number; y1: number; length: number };
  jib: { x0: number; x1: number; y0: number; y1: number; length: number };
  /** Middens van de ballastplaatsen op de tegengiek, buitenste eerst. */
  ballastSlots: number[];
}

export function erectionLayout(cfg: CraneConfig, x: number, z: number, erectSlewDeg: number): ErectionLayout {
  const gb = cfg.gameBalance;
  const baseH = cfg.visual.carrierHeight;
  const secH = towerSectionHeight(cfg);
  const jibDir: 1 | -1 = Math.cos((erectSlewDeg * Math.PI) / 180) >= 0 ? 1 : -1;
  const mastTop = (n: number) => baseH + n * secH;
  const deckY = mastTop(TOWER_ERECTION_SECTIONS) + TOWER_SLEW_UNIT_H;
  const CJ = gb.counterJibLength ?? 8;
  const J = gb.jibLength ?? 30;
  const span = (dir: number, len: number, h: number) => {
    const a = x + dir * TOWER_ROOT_OFFSET;
    const b = x + dir * len;
    return { x0: Math.min(a, b), x1: Math.max(a, b), y0: deckY - h / 2, y1: deckY + h / 2, length: len - TOWER_ROOT_OFFSET };
  };
  const cjDir = -jibDir;
  const slots: number[] = [];
  const nSlots = Math.max(1, Math.floor((CJ - TOWER_ROOT_OFFSET - 1) / TOWER_BALLAST_PITCH));
  for (let i = 0; i < nSlots; i++) slots.push(x + cjDir * (CJ - 0.7 - i * TOWER_BALLAST_PITCH));
  return {
    x,
    z,
    jibDir,
    baseH,
    secH,
    mastTop,
    deckY,
    counterJib: span(cjDir, CJ, TOWER_COUNTERJIB_H),
    jib: span(jibDir, J, TOWER_JIB_H),
    ballastSlots: slots,
  };
}

/** Wat er van de torenkraan al gemonteerd is. */
export interface TowerBuild {
  sections: number;
  slewingUnit: boolean;
  towerHead: boolean;
  counterJib: boolean;
  jib: boolean;
  /** Geplaatste ballastblokken (wereld-x van het midden en massa). */
  ballast: { x: number; massT: number }[];
}

export const emptyTowerBuild = (preinstalled: number): TowerBuild => ({
  sections: preinstalled,
  slewingUnit: false,
  towerHead: false,
  counterJib: false,
  jib: false,
  ballast: [],
});

export const towerBuildComplete = (b: TowerBuild): boolean =>
  b.sections >= TOWER_ERECTION_SECTIONS && b.slewingUnit && b.towerHead && b.counterJib && b.jib;

/** Ballast die de torenkraan nodig heeft (t). */
export const towerBallastT = (cfg: CraneConfig): number => cfg.gameBalance.counterweights.reduce((m, c) => Math.max(m, c.massT), 0);
