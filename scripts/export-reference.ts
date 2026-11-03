import { rmSync } from 'node:fs';
import { OUT_DIR, writeManifest } from './reference/common';
import { exportCareer } from './reference/career';
import { exportData } from './reference/data';
import { exportDataTables } from './reference/datatables';
import { exportMissions } from './reference/missions';
import type { MissionSummary } from './reference/missions';
import { exportSaves } from './reference/saves';
import { exportUnits } from './reference/units';

/**
 * Referentie-export voor de port naar Unreal (fase 0 van docs/UNREAL_PLAN.md).
 *
 *   npm run export:reference                 alles
 *   npm run export:reference -- data,units   alleen deze delen (ook: datatables, career, saves, missions)
 *   npm run export:reference -- missions m01,m05
 *
 * Schrijft naar reference/ met een manifest (hash per bestand). Twee exports van dezelfde broncode
 * geven hetzelfde manifest; dat is de controle dat de referentie deterministisch is.
 */
const parts = (process.argv[2] ?? 'data,datatables,units,career,saves,missions').split(',');
const only = process.argv[3]?.split(',');

rmSync(OUT_DIR, { recursive: true, force: true });
const files: string[] = [];
const t0 = Date.now();
if (parts.includes('data')) files.push(...exportData());
if (parts.includes('datatables')) files.push(...exportDataTables());
if (parts.includes('units')) files.push(...exportUnits());
if (parts.includes('career')) files.push(...exportCareer());
if (parts.includes('saves')) files.push(...exportSaves());
let summary: MissionSummary[] = [];
if (parts.includes('missions')) {
  const r = exportMissions(only);
  files.push(...r.files);
  summary = r.summary;
}
writeManifest(files, { parts, missions: only ?? 'all', summary });
console.log(`${files.length} bestanden in ${OUT_DIR} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
