import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractStrings } from './i18n-extract';
/** Schrijf alle Nederlandse brontekstsleutels naar i18n/keys.nl.json (voor de vertaler). */
const m = extractStrings();
const keys = [...m.keys()].sort();
const dir = path.resolve(__dirname, '..', 'i18n');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'keys.nl.json'), JSON.stringify(Object.fromEntries(keys.map((k) => [k, [...m.get(k)!].join(', ')])), null, 1));
console.log(`${keys.length} teksten`);
