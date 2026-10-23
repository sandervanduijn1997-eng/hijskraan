/** Windinstelling van een missie of oefensessie. */
export interface WindDef {
  /** Gemiddelde windsnelheid (m/s). */
  base: number;
  /** Relatieve vlaagsterkte (0..1). */
  gust: number;
  /** Hoofdrichting in het xy-vlak: +1 = naar rechts, -1 = naar links. */
  direction: 1 | -1;
  /** Wisselende wind: richting en sterkte variëren langzaam. */
  variable?: boolean;
  /** Fractie dwarswind (z) t.o.v. de hoofdrichting. */
  cross?: number;
}

export const calmWind = (): WindDef => ({ base: 0, gust: 0, direction: 1 });

/** Gladde deterministische ruis als som van sinussen. */
function noise(t: number, seed: number): number {
  return (
    Math.sin(t * 0.37 + seed) * 0.5 +
    Math.sin(t * 0.91 + seed * 1.7) * 0.3 +
    Math.sin(t * 2.3 + seed * 2.9) * 0.2
  );
}

export interface WindSample {
  x: number;
  z: number;
  speed: number;
}

/** Windvector op tijdstip t (s). `scale` komt uit de moeilijkheidsgraad. */
export function sampleWind(def: WindDef, t: number, seed: number, scale = 1): WindSample {
  if (def.base <= 0 && def.gust <= 0) return { x: 0, z: 0, speed: 0 };
  let dir: number = def.direction;
  if (def.variable) dir *= Math.sin(t * 0.045 + seed) > -0.35 ? 1 : -1;
  const gustF = 1 + def.gust * noise(t, seed);
  const s = Math.max(0, def.base * gustF * scale);
  const x = s * dir;
  const z = s * (def.cross ?? 0.15) * noise(t * 0.7, seed + 3);
  return { x, z, speed: Math.sqrt(x * x + z * z) };
}
