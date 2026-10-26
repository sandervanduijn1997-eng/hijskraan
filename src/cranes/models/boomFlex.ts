/**
 * Statische doorbuiging van een uitkragende giek (spelwaarde): ≈ 1 % van de gieklengte × (L / 30 m)
 * bij een last op de grens van het lastdiagram, minder bij een steile giek.
 */
export const BOOM_FLEX = 0.01;

export function staticDeflection(boomLength: number, tensionT: number, chartT: number, boomAngle: number): number {
  const L = Math.max(5, boomLength);
  return BOOM_FLEX * L * (L / 30) * Math.min(1.6, Math.max(0, tensionT) / Math.max(0.5, chartT)) * Math.cos(boomAngle * 0.5);
}

/** Eigenfrequentie (Hz) van de giek: lange gieken zijn traag. */
export const boomFrequency = (boomLength: number): number => Math.min(3, Math.max(0.35, 1.8 * (30 / Math.max(5, boomLength))));
