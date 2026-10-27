import { tr } from '../i18n/i18n';

/** Minimale DOM-helpers (geen framework). Tekst wordt bij het tonen vertaald (zie i18n). */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string; onclick?: (e: MouseEvent) => void };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else if (k === 'title' || k === 'placeholder' || k === 'aria-label') el.setAttribute(k, tr(String(v)));
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(typeof c === 'string' ? tr(c) : String(c)));
  }
  return el;
}

export function stars(n: number, max = 3): HTMLElement {
  const s = h('span', { class: 'stars' });
  for (let i = 0; i < max; i++) s.append(h('span', { class: i < n ? '' : 'off' }, '★'));
  return s;
}

export function kbd(label: string): HTMLElement {
  return h('span', { class: 'kbd' }, label);
}

/** Zet tekst alleen als die verandert (voorkomt onnodige reflows in de HUD-lus). */
export function setText(el: HTMLElement, t: string): void {
  const v = tr(t);
  if (el.textContent !== v) el.textContent = v;
}

export function setClass(el: HTMLElement, cls: string): void {
  if (el.className !== cls) el.className = cls;
}
