import { interp1 } from '../../utils/math';

/**
 * Lastdiagram als tabel: rijen = gieklengtes (of configuraties), kolommen = werkstralen.
 * Waarden in ton; `null` = niet toegestaan.
 */
export interface LoadChart {
  boomLengths: number[];
  radii: number[];
  capacity: (number | null)[][];
}

/**
 * Bilineaire interpolatie in het lastdiagram. Buiten het bereik van de stralen → 0 (niet toegestaan).
 * Tussen gieklengtes wordt conservatief (minimum van de buren) of lineair geïnterpoleerd.
 */
export function chartCapacity(chart: LoadChart, boomLength: number, radius: number, conservative = true): number {
  const { boomLengths, radii, capacity } = chart;
  if (radius > radii[radii.length - 1] + 1e-6) return 0;
  const rowAt = (i: number): number => {
    const row = capacity[i];
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = 0; j < radii.length; j++) {
      const c = row[j];
      if (c !== null && c !== undefined) {
        xs.push(radii[j]);
        ys.push(c);
      }
    }
    if (xs.length === 0) return 0;
    if (radius > xs[xs.length - 1] + 1e-6) return 0;
    return interp1(xs, ys, radius);
  };
  if (boomLengths.length === 1 || boomLength <= boomLengths[0]) return rowAt(0);
  const n = boomLengths.length - 1;
  if (boomLength >= boomLengths[n]) return rowAt(n);
  for (let i = 0; i < n; i++) {
    if (boomLength <= boomLengths[i + 1]) {
      const a = rowAt(i);
      const b = rowAt(i + 1);
      if (conservative) return Math.min(a, b);
      const t = (boomLength - boomLengths[i]) / (boomLengths[i + 1] - boomLengths[i]);
      return a + (b - a) * t;
    }
  }
  return rowAt(n);
}

/** Belastingpercentage: werkelijke last / toegestane last × 100. */
export function loadPercent(actualT: number, allowedT: number): number {
  if (allowedT <= 0) return actualT > 0.01 ? 999 : 0;
  return (actualT / allowedT) * 100;
}
