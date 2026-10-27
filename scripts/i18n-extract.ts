import ts from 'typescript';

/**
 * Verzamel alle teksten die de speler kan zien (Nederlandse bron) uit de broncode, als sleutels voor
 * de woordenboeken. Sjabloonteksten worden patronen: `Last ${x} t` → "Last {0} t".
 * Overgeslagen: imports, CSS-klassen, test-id's, typen, vergelijkingen, case-labels, objectsleutels,
 * en alles wat er niet als tekst uitziet (id's als 'outriggers').
 */

const SKIP_PROPS = new Set(['class', 'className', 'data-testid', 'id', 'style', 'type', 'kind', 'key', 'value', 'href', 'src', 'file', 'dir', 'tag', 'carrier', 'environment', 'timeOfDay', 'weather', 'surface', 'mode', 'lang', 'speech', 'color', 'icon', 'action', 'level', 'loadId', 'zoneId', 'craneId', 'part', 'phase', 'severity', 'outcome', 'style', 'role', 'width', 'height', 'for', 'name', 'contact']);
// sommige 'name'-velden zijn wel zichtbaar (lastnamen, kranen, opdrachtgevers): die staan in data-bestanden
const DATA_FILES = /missions\/data\/|cranes\/config\//;
const SKIP_CALLS = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener', 'setAttribute', 'getAttribute', 'createElement', 'startsWith', 'endsWith', 'includes', 'split', 'join', 'replace', 'getItem', 'setItem', 'removeItem', 'has', 'get', 'set', 'delete', 'getChannelData', 'getContext', 'shot', 'ui', 'warning', 'registerDict', 'tex', 'cached', 'cachedGeo', 'simple', 'getObjectByName', 'toLocaleString', 'warn', 'log', 'debug', 'error', 'info', 'matchMedia', 'pressAction', 'onEdge', 'loop', 'h', 'pick', 'require', 'surface', 'decal']);

function looksLikeText(s: string, loose = false): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[a-zA-Zà-ÿ]{2}/.test(t)) return false;
  if (loose) return !/^(btn|tag|check|v |sel|muted|row|line|panel)/.test(t);
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false; // id's: 'outriggers', 'at60'
  if (/^[a-z0-9-]+(\s+[a-z0-9-]+)*$/.test(t) && !/[a-z]{3,}\s[a-z]{3,}\s/.test(t) && t.split(/\s+/).length <= 3) return false; // css-klassen
  if (/^(Key|Digit|Arrow|Shift|Numpad)/.test(t)) return false;
  if (/^(Equal|Minus|Space|Escape|Tab|Enter|Backspace|Control|Alt|Meta)\b/.test(t)) return false;
  if (/^rgba?\(|^hsla?\(|\d+px|sans-serif|monospace/.test(t)) return false;
  // technische sleutels, cachesleutels, css-transformaties en bestandsnamen
  if (/^__|translate\(|rotate\(|var\(--|\||assets\/|\.save|telemetry\.v|^tw-|worldUV|^\{0\}-(bed|cab)$/.test(t)) return false;
  if (/^[#./@]|^https?:|\.(png|jpe?g|hdr|m4a|json|ts)$/.test(t)) return false;
  if (/^[A-Z_0-9]+$/.test(t)) return false;
  if (/[{};]\s*$/.test(t) && /[:;]/.test(t)) return false; // css
  return true;
}

function templateKey(node: ts.TemplateExpression, sf: ts.SourceFile): string {
  let k = node.head.text;
  node.templateSpans.forEach((sp, i) => {
    k += `{${i}}` + sp.literal.text;
  });
  void sf;
  return k;
}

function skipByContext(node: ts.Node, file: string): boolean {
  let p = node.parent;
  // door haakjes, ternaries, ?? en || heen kijken
  while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind)))) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken) break;
    p = p.parent;
  }
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isElementAccessExpression(p)) return true;
  if (ts.isPropertyAssignment(p)) {
    if (p.name === node) return true;
    const name = p.name.getText();
    const bare = name.replace(/['"]/g, '');
    if (SKIP_PROPS.has(bare) && !(bare === 'name' && DATA_FILES.test(file))) return true;
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const callee = p.expression;
    const fn = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
    const args = p.arguments ?? ts.factory.createNodeArray();
    const idx = args.indexOf(node as ts.Expression);
    if (fn === 'h' && idx === 0) return true; // tagnaam
    if (fn === 'h' && idx >= 2) return false; // kinderen = tekst
    if (SKIP_CALLS.has(fn)) return true;
    if (fn === 'RegExp') return true;
  }
  return false;
}

/**
 * Zeker zichtbare tekst: een kind van h(…) of een waarde in een labeltabel (…_LABEL / …_LABELS).
 * Daar tellen ook korte woorden in kleine letters mee ('helder', 'eigen vloot').
 */
function visibleContext(node: ts.Node): boolean {
  let p: ts.Node | undefined = node.parent;
  let child: ts.Node = node;
  while (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)))) {
    if (ts.isConditionalExpression(p) && p.condition === child) return false;
    child = p;
    p = p.parent;
  }
  if (!p) return false;
  if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'h') return p.arguments.indexOf(child as ts.Expression) >= 2;
  if (ts.isPropertyAssignment(p) && p.initializer === child) {
    let o: ts.Node | undefined = p.parent;
    while (o && !ts.isVariableDeclaration(o)) o = o.parent;
    return !!o && ts.isVariableDeclaration(o) && /LABELS?$/.test(o.name.getText());
  }
  return false;
}

/** Bronbestanden (pad → inhoud) via Vite; werkt in de tests en in vite-node. */
function sourceFiles(): Record<string, string> {
  const raw = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (!k.includes('/i18n/')) out[k.replace(/^\.\.\//, '')] = v;
  return out;
}

export function extractStrings(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [rel, text] of Object.entries(sourceFiles())) {
    const file = rel;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const add = (k: string, loose = false) => {
      if (!looksLikeText(k, loose)) return;
      if (!out.has(k)) out.set(k, new Set());
      out.get(k)!.add(rel);
    };
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !skipByContext(node, rel)) add(node.text, visibleContext(node));
      else if (ts.isTemplateExpression(node) && !skipByContext(node, rel)) {
        add(templateKey(node, sf), visibleContext(node));
        // de ingevulde delen kunnen zelf tekst bevatten
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

