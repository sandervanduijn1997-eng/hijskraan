import * as fs from 'node:fs';
import { EN } from '../src/i18n/index';
import { extractStrings } from './i18n-extract';
/** Bronteksten zonder vertaling (voor het aanvullen van de woordenboeken). */
const miss = [...extractStrings().keys()].filter((k) => EN[k] === undefined);
fs.writeFileSync(process.argv[2], JSON.stringify(miss, null, 1));
console.log(miss.length);
