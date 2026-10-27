import type { ScoreBreakdown, ScoreMetrics } from '../missions/runtime/scoring';
import { SCORE_WEIGHTS } from '../missions/runtime/scoring';
import type { Recording, TimelineMarker } from './recorder';

/**
 * Nabespreking: het moment waarop het misging (uit de tijdlijn) en één concrete tip, gekozen op het
 * onderdeel dat de meeste punten kostte. Geen lijst met algemene adviezen, maar één ding om te oefenen.
 */

export interface Debrief {
  /** Het moment om in de herhaling te bekijken (s) en wat er toen gebeurde. */
  moment: TimelineMarker | null;
  tip: string;
}

/** Eerste ernstige gebeurtenis; bij een mislukking de laatste kritieke voor het einde (de oorzaak). */
export function keyMoment(rec: Recording, failed: boolean): TimelineMarker | null {
  const bad = rec.markers.filter((m) => m.bad && m.kind !== 'fail');
  if (failed) {
    const fail = rec.markers.find((m) => m.kind === 'fail') ?? null;
    if (!fail) return bad[0] ?? null;
    // de oorzaak ligt meestal kort vóór het einde
    const before = bad.filter((m) => m.t <= fail.t && fail.t - m.t < 20);
    return before[0] ?? fail;
  }
  return bad[0] ?? null;
}

const TIPS: Record<keyof typeof SCORE_WEIGHTS, (m: ScoreMetrics) => string> = {
  safety: (m) =>
    m.safetyViolations > 0
      ? 'Veiligheid kostte de meeste punten. Loop vóór de hijs je lijstje af: stempels volledig uit, begrenzer ingesteld, matten eronder, niemand onder de last.'
      : 'Je reed te lang tegen de grens van het lastdiagram. Kies een kortere straal of meer contragewicht, zodat je onder de 90 % blijft.',
  precision: () => 'De plaatsing was niet nauwkeurig. Stop een halve meter boven de plek, laat de last uitslingeren en zak het laatste stuk met precisie (Shift).',
  time: () => 'Je deed er lang over. Combineer bewegingen: zwenk en schuif tegelijk uit zodra de last hoog genoeg hangt, en rem op tijd af in plaats van te corrigeren.',
  sway: (m) => `De last slingerde tot ${m.maxSwayDeg.toFixed(0)}°. Begin en stop elke beweging geleidelijk, en volg de slinger kort mee met de giek om hem te dempen.`,
  collisions: (m) =>
    (m.collisions > 1 ? `Je raakte ${m.collisions}× iets.` : 'Je raakte iets.') +
    ' Hijs eerst ruim boven alles wat in de weg staat en zwenk pas daarna; let in de herhaling op het moment van de eerste botsing.',
  damage: () => 'De last liep schade op. Zet rustiger neer: de laatste 30 cm met precisie en volle toets, niet met korte rukken.',
  config: () => 'De configuratie was niet ideaal. Kijk in de planning naar het lastdiagram: kies de kleinste opstelling die de last nog met marge haalt.',
  efficiency: () => 'Er ging veel brandstof in zitten. Laat de motor niet hoog draaien als je wacht, en maak minder correctiebewegingen.',
};

/** Eén concrete tip voor de volgende poging. */
export function concreteTip(score: ScoreBreakdown | null, metrics: ScoreMetrics, failReason: string): string {
  if (failReason) {
    const r = failReason.toLowerCase();
    if (r.includes('gekanteld') || r.includes('stabiliteit')) return 'De kraan kantelde. Houd de stabiliteitsmarge in de gaten: met last nooit verder uitschuiven of zakken met de giek zonder naar het lastdiagram te kijken.';
    if (r.includes('strop')) return 'Een strop brak. Reken vóór het aanslaan: last ÷ (aantal dragende sprongen × cos stropshoek) moet onder de werklast blijven. Langere stroppen maken de hoek kleiner.';
    if (r.includes('stempel') && r.includes('zakte')) return 'Een stempel zakte weg. Op zachte grond horen er (grote) kraanmatten onder; kies ze in de planning of leg ze met M met de vijzels omhoog.';
    if (r.includes('personen')) return 'Je draaide een last boven mensen. Wacht tot de route vrij is, of kies een route om de werkplek heen.';
    if (r.includes('schade') || r.includes('botsing')) return TIPS.collisions(metrics);
    if (r.includes('tijd')) return TIPS.time(metrics);
  }
  if (!score) return TIPS.safety(metrics);
  // onderdeel met het grootste puntenverlies (gewogen)
  let worst: keyof typeof SCORE_WEIGHTS = 'safety';
  let lost = -1;
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
    const l = (100 - score[k]) * SCORE_WEIGHTS[k];
    if (l > lost) {
      lost = l;
      worst = k;
    }
  }
  if (lost < 1) return 'Bijna foutloos. Probeer het nu op Realistisch, of sneller met dezelfde nauwkeurigheid.';
  return TIPS[worst](metrics);
}

export function makeDebrief(rec: Recording, score: ScoreBreakdown | null, metrics: ScoreMetrics, failReason: string): Debrief {
  return { moment: keyMoment(rec, !!failReason), tip: concreteTip(score, metrics, failReason) };
}
