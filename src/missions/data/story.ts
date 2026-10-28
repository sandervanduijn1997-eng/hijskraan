import { CRANES } from '../../cranes/config/cranes';
import { LOADS } from './loads';
import type { EnvironmentId, MissionDef, ZoneDef } from './types';

/**
 * Opdrachtgevers, deadlines en verrassingen. Elke opdracht komt van een (fictieve) opdrachtgever met
 * een deadline; vanaf hoofdstuk 2 gebeurt er onderweg iets dat het plan verandert: een windvlaag,
 * een afzetplek die nog niet klaar is, of een opdrachtgever die de last ergens anders wil hebben.
 */

export interface ClientDef {
  name: string;
  /** Contactpersoon die de portofoon gebruikt (voornaam). */
  contact: string;
}

export type SurpriseDef =
  | { type: 'gust'; text: string; speed: number; duration: number }
  | { type: 'delay'; text: string; seconds: number }
  | { type: 'change'; text: string; fromZone: string; toZone: string }
  /** Werkstop (gasalarm, persoon in de gevarenzone): binnen 4 s alles stil, alleen zakken mag. */
  | { type: 'stop'; text: string; seconds: number; endText: string };

/** Fictieve opdrachtgevers per omgeving. */
const CLIENTS: Record<EnvironmentId, ClientDef[]> = {
  trainingYard: [{ name: 'Opleidingscentrum Hijstechniek', contact: 'Ria' }],
  constructionSite: [{ name: 'Bouwcombinatie Lindehof', contact: 'Sander' }, { name: 'Aannemer Van Ooyen', contact: 'Petra' }],
  cityCenter: [{ name: 'Gemeente Waalstad', contact: 'Mehmet' }, { name: 'Projectbureau Stadshart', contact: 'Ilse' }],
  highrise: [{ name: 'Torenbouw Kaaipoort', contact: 'Daan' }],
  factory: [{ name: 'Machinefabriek Oosterveld', contact: 'Jeroen' }],
  roughTerrain: [{ name: 'Grondwerken De Brink', contact: 'Hanna' }],
  riverBridge: [{ name: 'Waterschap Lage Waard', contact: 'Karim' }],
  port: [{ name: 'Havenbedrijf Kaaimond', contact: 'Esther' }],
  industrialPlant: [{ name: 'Procesindustrie Delta-Oost', contact: 'Ruud' }],
  windFarm: [{ name: 'Windpark Zeewind Noord', contact: 'Lotte' }],
};

export function clientFor(m: MissionDef): ClientDef {
  const pool = CLIENTS[m.environment];
  return pool[m.number % pool.length];
}

/** Zachte deadline (s): te laat kost een boete, geen mislukking. */
export const deadlineFor = (m: MissionDef): number => m.timeLimit ?? Math.round((m.parTime * 2) / 30) * 30;

/** Een vrije plek naast een afzetvak op de grond (voor een gewijzigde opdracht), of null. */
function alternateZone(m: MissionDef, zn: ZoneDef): ZoneDef | null {
  if (zn.y > 0.05) return null;
  const task = m.tasks.find((t) => t.type === 'deliver' && t.zoneId === zn.id);
  if (!task || task.type !== 'deliver') return null;
  const t = LOADS[m.loads.find((l) => l.id === task.loadId)!.type];
  const hw = t.width / 2 + zn.tolerance;
  const hd = t.depth / 2 + zn.tolerance;
  const z0 = zn.z ?? 0;
  for (const [dx, dz] of [[0, 4], [0, -4], [3.5, 0], [-3.5, 0], [3, 3], [-3, -3], [3, -3], [-3, 3]]) {
    const x = zn.x + dx;
    const z = z0 + dz;
    if (Math.abs(x - m.crane.x) < 7 && Math.abs(z) < 4) continue;
    if (x - hw < m.bounds.minX + 2 || x + hw > m.bounds.maxX - 2) continue;
    const blocked =
      m.obstacles.some((o) => o.kind !== 'ceiling' && o.y < t.height + 0.5 && x + hw + 0.5 > o.x && x - hw - 0.5 < o.x + o.w && z + hd + 0.5 > (o.z0 ?? -40) && z - hd - 0.5 < (o.z1 ?? 40)) ||
      m.loads.some((l) => {
        const lt = LOADS[l.type];
        return Math.abs(l.x - x) < lt.width / 2 + hw + 0.8 && Math.abs((l.z ?? 0) - z) < lt.depth / 2 + hd + 0.8;
      }) ||
      m.zones.some((o) => o !== zn && Math.hypot(o.x - x, (o.z ?? 0) - z) < o.tolerance + Math.hypot(hw, hd) + 1) ||
      (m.ground ?? []).some((g) => x >= g.x0 && x < g.x1 && g.quality < 0.5);
    if (blocked) continue;
    return { ...zn, id: `${zn.id}-b`, label: `${zn.label} (gewijzigd)`, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
  }
  return null;
}

/**
 * Wisselend weer: buiten, vanaf hoofdstuk 2, krijgen missies met helder of bewolkt weer soms regen,
 * mist of een nachtdienst. Elk weertype vraagt een andere aanpak (zie sim/weather).
 */
function withWeather(m: MissionDef): MissionDef {
  if (m.chapter < 2 || m.lesson || INDOOR.includes(m.environment) || (m.weather !== 'clear' && m.weather !== 'cloudy')) return m;
  if (m.number % 6 === 3) return { ...m, weather: 'rain' };
  if (m.number % 7 === 5) return { ...m, weather: 'fog', timeOfDay: m.timeOfDay === 'night' ? 'night' : 'overcast' };
  if (m.number % 9 === 4) return { ...m, timeOfDay: 'night' };
  return m;
}

const INDOOR: EnvironmentId[] = ['factory'];

/** Opdrachtgever, deadline, weer en (vanaf hoofdstuk 2) één verrassing per missie. */
export function withStory(m0: MissionDef): MissionDef {
  const m = withWeather(m0);
  const client = clientFor(m);
  const out: MissionDef = { ...m, client, deadline: deadlineFor(m) };
  // een missie met een eigen verrassing (of uitdrukkelijk geen: null) houdt die
  if (m.chapter < 2 || m.lesson || m.assembly || m.tandem || m.surprise !== undefined) return out;
  const c = client.contact;
  const firstDeliver = m.tasks.find((t) => t.type === 'deliver');
  const kind = m.number % 3;
  // pick-and-carry en rijopdrachten: de kraan rijdt langs één lijn, een verplaatste plek past daar niet bij
  const gb = CRANES[m.craneOptions[0]].gameBalance;
  const carry = (gb.driveWithLoadMaxPct >= 100 && gb.driveSpeed > 0) || m.tasks.some((t) => t.type === 'drive');
  if (kind === 2 && !carry && firstDeliver && firstDeliver.type === 'deliver') {
    const zn = m.zones.find((z) => z.id === firstDeliver.zoneId)!;
    const alt = alternateZone(m, zn);
    if (alt)
      return {
        ...out,
        zones: [...m.zones, alt],
        surprise: { type: 'change', text: `${c} hier, van ${client.name}: wijziging! Hij moet niet daar, maar op de nieuwe plek ernaast.`, fromZone: zn.id, toZone: alt.id },
      };
  }
  if (kind === 1 && firstDeliver)
    return { ...out, surprise: { type: 'delay', text: `Wacht even met neerzetten — de plek is nog niet vrij. Hou hem vast, ik zeg het wel.`, seconds: 25 } };
  return { ...out, surprise: { type: 'gust', text: 'Let op: er komt een flinke windvlaag aan.', speed: Math.min(11, m.wind.base + 5), duration: 18 } };
}
