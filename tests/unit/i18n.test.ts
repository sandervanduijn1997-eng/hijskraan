import { describe, expect, it } from 'vitest';
import { DE, EN } from '../../src/i18n/index';
import { setLang, tr } from '../../src/i18n/i18n';
import { extractStrings } from '../../scripts/i18n-extract';

const ph = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(',');

describe('vertalingen (Engels en Duits)', () => {
  const keys = [...extractStrings().keys()];

  it('elke zichtbare tekst heeft een Engelse en een Duitse vertaling', () => {
    const missEn = keys.filter((k) => EN[k] === undefined);
    const missDe = keys.filter((k) => DE[k] === undefined);
    expect(missEn, `ontbreekt in EN: ${missEn.slice(0, 10).join(' | ')}`).toEqual([]);
    expect(missDe, `ontbreekt in DE: ${missDe.slice(0, 10).join(' | ')}`).toEqual([]);
  });

  it('vertalingen gebruiken dezelfde invulvelden als de bron', () => {
    for (const d of [EN, DE]) for (const [k, v] of Object.entries(d)) expect(ph(v), k).toBe(ph(k));
  });

  it('dynamische teksten worden via patronen vertaald, ingevulde woorden ook', () => {
    setLang('en');
    expect(tr('Haak zakken, nog 4 meter.')).toBe('Lower the hook, 4 metres to go.');
    expect(tr('Annuleren')).toBe('Cancel');
    setLang('de');
    expect(tr('Te veel schade (18 %).')).toBe('Zu viel Schaden (18 %).');
    expect(tr('12,3 m')).toBe('12,3 m');
    setLang('nl');
    expect(tr('Annuleren')).toBe('Annuleren');
  });
});
