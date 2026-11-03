import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRANES } from '../../src/cranes/config/cranes';
import { UPGRADES } from '../../src/cranes/config/upgrades';
import { DE, EN } from '../../src/i18n/index';
import { CHALLENGES, challengeMission } from '../../src/missions/data/challenges';
import { CHAPTERS, MISSIONS } from '../../src/missions/data/index';
import { LOADS } from '../../src/missions/data/loads';
import { DIFFICULTIES } from '../../src/sim/difficulty';
import { toPlain, writeRef } from './common';

/**
 * Speldata als DataTables voor Unreal (E6 in docs/UNREAL_PLAN.md). Elk bestand is een JSON-array in het
 * importformaat van UDataTable: `Name` is de rijnaam, de overige sleutels zijn de velden van de rijstruct
 * (Plugins/CraneSim/Source/CraneSimData/Public/CraneSimDataRows.h in hijskraan-unreal).
 *
 * De getypte kolommen zijn er voor UI en Blueprints. Wat de simulatie leest staat in `Definition`: het
 * volledige object als JSON-tekst, precies zoals in data/*.json, zodat Unreal het met dezelfde parser
 * inleest als de referentietests (bit voor bit, ook getallen die een float-kolom zou afronden).
 */

type Row = { Name: string } & Record<string, unknown>;

const definition = (v: unknown): string => JSON.stringify(toPlain(v));

/** FNV-1a (32 bit) van de UTF-8-bytes, als rijnaam voor teksten (de Nederlandse tekst zelf is te lang en FName negeert hoofdletters). */
function textRowName(nl: string): string {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(nl, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return 'T' + h.toString(16).padStart(8, '0');
}

/** Rijnamen zijn FNames: uniek zonder op hoofdletters te letten. */
function table(name: string, rows: Row[]): string {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const key = r.Name.toLowerCase();
    if (seen.has(key)) throw new Error(`${name}: rijnaam '${r.Name}' botst met '${seen.get(key)}'`);
    seen.set(key, r.Name);
  }
  return writeRef(`datatables/${name}`, rows);
}

export function exportDataTables(): string[] {
  const nlKeys: Record<string, string> = JSON.parse(readFileSync(join(process.cwd(), 'i18n', 'keys.nl.json'), 'utf8'));
  const textKeys = [...new Set([...Object.keys(nlKeys), ...Object.keys(EN), ...Object.keys(DE)])].sort();
  for (const [lang, dict] of [['en', EN], ['de', DE]] as const)
    for (const [k, v] of Object.entries(dict)) if (v === '') throw new Error(`lege ${lang}-vertaling voor '${k}'`);

  return [
    table('DT_Cranes', Object.values(CRANES).map((c) => ({
      Name: c.id,
      DisplayName: c.name,
      CraneClass: c.craneClass,
      ClassLabel: c.classLabel,
      Kind: c.kind,
      Carrier: c.carrier,
      Description: c.description,
      BuyPrice: c.economy.buyPrice,
      RentPerMission: c.economy.rentPerMission,
      RequiredLicense: c.economy.requiredLicense ?? '',
      Definition: definition(c),
    }))),
    table('DT_Loads', Object.values(LOADS).map((l) => ({
      Name: l.id,
      DisplayName: l.name,
      MassKg: l.massKg,
      Width: l.width,
      Height: l.height,
      Depth: l.depth,
      Style: l.style,
      Color: l.color,
      Definition: definition(l),
    }))),
    table('DT_Chapters', CHAPTERS.map((c) => ({
      Name: `chapter${String(c.number).padStart(2, '0')}`,
      Number: c.number,
      Title: c.title,
      Subtitle: c.subtitle,
      RequiresLicense: c.requiresLicense ?? '',
      Stage: c.stage,
    }))),
    table('DT_Missions', MISSIONS.map((m, i) => ({
      Name: m.id,
      Order: i,
      Number: m.number,
      Chapter: m.chapter,
      Title: m.title,
      Briefing: m.briefing,
      Hint: m.hint,
      Environment: m.environment,
      Weather: m.weather,
      TimeOfDay: m.timeOfDay,
      RewardMoney: m.reward.money,
      RewardXp: m.reward.xp,
      ParTime: m.parTime,
      Definition: definition(m),
    }))),
    // rate() is code per kind (CraneSim/Career.h: rateChallenge), geen data
    table('DT_Challenges', CHALLENGES.map((c, i) => ({
      Name: c.id,
      Order: i,
      Kind: c.kind,
      Title: c.title,
      Description: c.description,
      BaseMissionId: c.baseMissionId,
      Definition: definition(challengeMission(c)),
    }))),
    table('DT_Upgrades', Object.values(UPGRADES).map((u) => ({
      Name: u.id,
      DisplayName: u.name,
      Description: u.description,
      BasePrice: u.basePrice,
      PriceFactor: u.priceFactor,
    }))),
    table('DT_Difficulties', Object.values(DIFFICULTIES).map((d) => ({
      Name: d.id,
      Label: d.label,
      Description: d.description,
      Definition: definition(d),
    }))),
    // Nederlands is de brontaal; een lege vertaling betekent "valt terug op het Nederlands"
    table('DT_Texts', textKeys.map((nl) => ({
      Name: textRowName(nl),
      Nl: nl,
      En: EN[nl] ?? '',
      De: DE[nl] ?? '',
      Source: nlKeys[nl] ?? '',
    }))),
  ];
}
