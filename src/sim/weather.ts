import type { CraneKind } from '../cranes/config/types';
import type { GroundType } from '../physics/ground';
import type { LoadType } from '../missions/data/loads';
import type { TimeOfDay, Weather } from '../missions/data/types';

/**
 * Weer en nacht als gameplay.
 * - Windstop: boven de toelaatbare windsnelheid mag er niet gehesen worden. Voor mobiele kranen
 *   geldt 14 m/s als bovengrens, verlaagd voor lasten met veel windvang (richtlijn EN 13000:
 *   9,8 m/s bij 1,2 m² windvang per ton, naar beneden geschaald met de wortel). Torenkranen: 20 m/s.
 * - Regen: onverharde grond wordt slapper (lagere draagkracht).
 * - Zicht: mist, regen en nacht beperken hoe ver je labels en details ziet.
 */

export const CRANE_WIND_LIMIT = (kind: CraneKind): number => (kind === 'tower' ? 20 : 14);

/** Toelaatbare windsnelheid (m/s) voor een last aan deze kraan. */
export function windLimitFor(t: LoadType, kind: CraneKind): number {
  const area = Math.max(t.width, t.depth) * t.height * t.dragCoeff;
  const perTon = area / Math.max(0.1, t.massKg / 1000);
  const limit = perTon <= 1.2 ? CRANE_WIND_LIMIT(kind) : 9.8 * Math.sqrt(1.2 / perTon) * (CRANE_WIND_LIMIT(kind) / 14);
  // ondergrens 7 m/s: daaronder werkt in de praktijk niemand meer met zulke lasten (spelwaarde)
  return Math.max(7, Math.min(CRANE_WIND_LIMIT(kind), Math.round(limit * 10) / 10));
}

const SOFT: GroundType[] = ['gravel', 'sand', 'grass', 'mud'];

/** Factor op de kwaliteit van de ondergrond door regen (alleen onverhard). */
export const rainGroundFactor = (weather: Weather, type: GroundType): number => (weather === 'rain' && SOFT.includes(type) ? 0.75 : 1);

/** Zicht (m): hoe ver je doelen en labels nog herkent. */
export function visibility(weather: Weather, time: TimeOfDay): number {
  let v = weather === 'fog' ? 70 : weather === 'rain' ? 260 : Infinity;
  if (time === 'night') v = Math.min(v, 140);
  return v;
}

export const WEATHER_LABEL: Record<Weather, string> = { clear: 'helder', cloudy: 'bewolkt', rain: 'regen', fog: 'mist' };
