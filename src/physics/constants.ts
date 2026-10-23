/**
 * Fysische constanten en simulatie-instellingen.
 * Wereldcoördinaten: x = horizontaal (m, rechts positief), y = verticaal (m, omhoog positief),
 * z = diepte (m, naar de kijker positief). Massa in kg, tijd in s, kracht in N, hoeken in radialen.
 */
export const GRAVITY = 9.81; // m/s²
export const AIR_DENSITY = 1.225; // kg/m³

/** Vaste simulatiestap (s). De renderer interpoleert tussen stappen. */
export const FIXED_DT = 1 / 60;
/** Aantal XPBD-substappen per vaste stap. */
export const SUBSTEPS = 8;
/** Maximaal aantal vaste stappen per frame; overige tijd wordt gecontroleerd weggegooid (slow-motion i.p.v. teleport). */
export const MAX_STEPS_PER_FRAME = 6;
/** Maximale frame-delta die nog wordt verwerkt (s). */
export const MAX_FRAME_DELTA = 0.25;

/** Schaal tussen simulatie en scherm: pixels per meter (op zoom 1). */
export const PIXELS_PER_METER = 24;

export const KG_PER_TON = 1000;
