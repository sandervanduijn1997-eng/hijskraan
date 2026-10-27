/**
 * Vertalingen (Nederlands is de brontaal). Teksten staan in de code in het Nederlands; bij het tonen
 * (DOM-helper, HUD, labels, portofoon, spraak) worden ze via `tr` vertaald. Woordenboeken gebruiken
 * de Nederlandse tekst als sleutel; variabele delen staan als {0}, {1}, … in sleutel en vertaling.
 * Ingevulde waarden worden zelf ook vertaald (bijv. een opstellingsnaam in een zin).
 */
export type Lang = 'nl' | 'en' | 'de';

export const LANGS: { id: Lang; label: string; speech: string }[] = [
  { id: 'nl', label: 'Nederlands', speech: 'nl-NL' },
  { id: 'en', label: 'English', speech: 'en-GB' },
  { id: 'de', label: 'Deutsch', speech: 'de-DE' },
];

type Dict = Record<string, string>;

interface Compiled {
  exact: Map<string, string>;
  patterns: { re: RegExp; out: string }[];
}

const dicts: Partial<Record<Lang, Dict>> = {};
const compiled: Partial<Record<Lang, Compiled>> = {};
let current: Lang = 'nl';
const cache = new Map<string, string>();

export function registerDict(lang: Lang, d: Dict): void {
  dicts[lang] = d;
  delete compiled[lang];
  cache.clear();
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  cache.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export const lang = (): Lang => current;
export const speechLang = (): string => LANGS.find((l) => l.id === current)!.speech;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(l: Lang): Compiled {
  const d = dicts[l] ?? {};
  const exact = new Map<string, string>();
  const patterns: { re: RegExp; out: string; lit: number }[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (!/\{\d+\}/.test(k)) {
      exact.set(k, v);
      continue;
    }
    const parts = k.split(/(\{\d+\})/);
    let src = '^';
    const order: number[] = [];
    let lit = 0;
    for (const p of parts) {
      const m = /^\{(\d+)\}$/.exec(p);
      if (m) {
        order.push(Number(m[1]));
        src += '([\\s\\S]*?)';
      } else {
        src += esc(p);
        lit += p.length;
      }
    }
    // de vertaling verwijst naar dezelfde {n}; de groepen komen in volgorde van de sleutel
    let out = v;
    order.forEach((n, gi) => (out = out.split(`{${n}}`).join(`\u0000${gi}\u0000`)));
    patterns.push({ re: new RegExp(src + '$'), out, lit });
  }
  // meest specifieke patronen eerst (meeste vaste tekst)
  patterns.sort((a, b) => b.lit - a.lit);
  return { exact, patterns };
}

/** Vertaal een (Nederlandse) tekst naar de huidige taal; onbekende teksten blijven ongewijzigd. */
export function tr(s: string): string {
  if (current === 'nl' || !s || !/[a-zA-Zà-ÿ]{2}/.test(s)) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const c = (compiled[current] ??= compile(current));
  let out = c.exact.get(s);
  if (out === undefined) {
    // voorloop- en naloopspaties en tekens (✓, emoji) behouden
    const m = /^(\s*[^\p{L}\d]*\s*)([\s\S]*?)(\s*[✓…:]?\s*)$/u.exec(s);
    const core = m ? m[2] : s;
    const ex = c.exact.get(core);
    if (ex !== undefined && m) out = m[1] + ex + m[3];
    else {
      for (const p of c.patterns) {
        const r = p.re.exec(s);
        if (!r) continue;
        out = p.out.replace(/\u0000(\d+)\u0000/g, (_, gi) => tr(r[Number(gi) + 1]));
        break;
      }
    }
  }
  if (out === undefined) {
    // samengestelde tekst zonder vaste zin: de delen tussen scheidingstekens los vertalen
    const parts = s.split(/( · | — | – | → |: |, |\. |\n)/);
    if (parts.length > 1) {
      const t = parts.map((p, i) => (i % 2 === 1 ? p : tr(p))).join('');
      if (t !== s) out = t;
    }
  }
  const res = out ?? s;
  if (cache.size > 4000) cache.clear();
  cache.set(s, res);
  return res;
}
