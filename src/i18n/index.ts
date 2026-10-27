import de1 from './de1';
import de2 from './de2';
import de3 from './de3';
import de4 from './de4';
import de5 from './de5';
import de6 from './de6';
import en1 from './en1';
import en2 from './en2';
import en3 from './en3';
import en4 from './en4';
import en5 from './en5';
import en6 from './en6';
import { registerDict } from './i18n';

/** Woordenboeken Engels en Duits (sleutel = Nederlandse brontekst). */
export const EN: Record<string, string> = { ...en1, ...en2, ...en3, ...en4, ...en5, ...en6 };
export const DE: Record<string, string> = { ...de1, ...de2, ...de3, ...de4, ...de5, ...de6 };

registerDict('en', EN);
registerDict('de', DE);
