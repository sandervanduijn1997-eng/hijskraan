import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Gedeelde hulpmiddelen voor de referentie-export (fase 0 van docs/UNREAL_PLAN.md).
 *
 * Getallen gaan als kortste exacte double door JSON (JSON.stringify), zodat een C++-lezer bit voor bit
 * dezelfde waarde krijgt. Wat JSON niet kan (Infinity, NaN) wordt als string gecodeerd; functies en
 * onbekende klassen zijn een fout, want die zou JSON.stringify stilletjes weglaten.
 */

export const REFERENCE_SCHEMA = 1;

export const OUT_DIR = join(process.cwd(), 'reference');

/** Zet een waarde om naar puur JSON-data; gooit bij iets wat niet als data te exporteren is. */
export function toPlain(v: unknown, path = '$'): unknown {
  if (v === null) return null;
  switch (typeof v) {
    case 'number':
      if (Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
      return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
    case 'string':
    case 'boolean':
      return v;
    case 'undefined':
      return undefined;
    case 'function':
      throw new Error(`functie in data op ${path}`);
    case 'object': {
      if (Array.isArray(v)) return v.map((x, i) => toPlain(x, `${path}[${i}]`) ?? null);
      if (v instanceof Set) return [...v].map((x, i) => toPlain(x, `${path}{${i}}`));
      if (v instanceof Map) throw new Error(`Map in data op ${path}`);
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`klasse ${proto?.constructor?.name} in data op ${path}`);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object)) {
        const x = toPlain((v as Record<string, unknown>)[k], `${path}.${k}`);
        if (x !== undefined) out[k] = x;
      }
      return out;
    }
    default:
      throw new Error(`onverwacht type ${typeof v} op ${path}`);
  }
}

/** Schrijf data als JSON (optioneel gzip) onder reference/. Geeft het relatieve pad terug. */
export function writeRef(rel: string, data: unknown, gzip = false): string {
  const file = join(OUT_DIR, rel + (gzip ? '.json.gz' : '.json'));
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(toPlain(data));
  writeFileSync(file, gzip ? gzipSync(json, { level: 9 }) : json + '\n');
  return relative(OUT_DIR, file).replace(/\\/g, '/');
}

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');

/** Hash over alle bronbestanden onder src/ (regeleinden genormaliseerd): legt vast uit welke code de referentie komt. */
export function sourceHash(root = join(process.cwd(), 'src')): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.ts')) files.push(p);
    }
  };
  walk(root);
  const h = createHash('sha256');
  for (const f of files) h.update(relative(root, f).replace(/\\/g, '/')).update('\0').update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).update('\0');
  return h.digest('hex');
}

/**
 * Manifest: per bestand de hash van de JSON-inhoud (bij .gz ná uitpakken, want de gzip-kop verschilt
 * per platform), zodat een nieuwe export aantoonbaar gelijk is aan de vorige.
 */
export function writeManifest(files: string[], extra: Record<string, unknown>): void {
  const entries = files.sort().map((f) => {
    const raw = readFileSync(join(OUT_DIR, f));
    const json = f.endsWith('.gz') ? gunzipSync(raw) : raw;
    return { file: f, bytes: json.length, sha256: sha256(json) };
  });
  writeRef('manifest', { schema: REFERENCE_SCHEMA, sourceHash: sourceHash(), ...extra, files: entries });
}
