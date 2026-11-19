/**
 * Générateur de classeurs XLSX de test (sans dépendance autre que fflate), pour le convertisseur de grille (DAT-30).
 *  - makeXlsx() : classeur générique (chaînes partagées ou inlineStr, cellules fusionnées) ;
 *  - makeGrid() : grille fictive au format 230906_Scoring_Template (5 domaines aux effectifs de référence, « 0. Content »,
 *    « Tracking », « Réponses » FR), avec les pièges attendus : titre au-dessus de l'en-tête, colonnes dans le désordre,
 *    ligne vide, évaluation vide, Subject fusionné, légendes Impact / Suggested corrective action inversées.
 *
 * Fichier d'exemple : node --experimental-strip-types tests/fixtures/make-grid.ts sortie.xlsx
 */
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';

export type V = string | number | boolean | null;
export interface SheetSpec { name: string; rows: V[][]; inline?: boolean; merges?: string[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export function makeXlsx(sheets: SheetSpec[]): Uint8Array {
  const shared: string[] = [], sIdx = new Map<string, number>();
  const ss = (t: string) => { if (!sIdx.has(t)) { sIdx.set(t, shared.length); shared.push(t); } return sIdx.get(t)!; };
  const files: Record<string, Uint8Array> = {};
  sheets.forEach((sh, k) => {
    const rows = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${col(c)}${r + 1}`;
        if (v == null || v === '') return '';
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
        if (sh.inline) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        return `<c r="${ref}" t="s" s="1"><v>${ss(v)}</v></c>`;
      }).join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    }).join('');
    const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    files[`xl/worksheets/sheet${k + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="12" width="20"/></cols><sheetData>${rows}</sheetData>${merges}</worksheet>`);
  });
  // Une entrée rich text (runs <r><t>) et une phonétique pour éprouver le lecteur.
  const si = shared.map(t => t === 'Rich **text**'
    ? `<si><r><t>Rich </t></r><r><rPr><b/></rPr><t>text</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si>`
    : `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('');
  files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${si}</sst>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, k) => `<sheet name="${esc(s.name)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  return zipSync(files);
}

// ───────────── Grille fictive 230906 ─────────────
export const DOMAIN_SHEETS = [
  { name: 'Data Layer Quality', code: 'DL', n: 23, subjects: ['Data Quality', 'Data Quality', 'Naming Convention', 'Compliance'] },
  { name: 'Google Tag Manager', code: 'GTM', n: 32, subjects: ['Administration', 'Configuration', 'Naming Convention', 'Compliance'] },
  { name: 'Google Analytics 4', code: 'GA4', n: 47, subjects: ['Administration', 'Configuration', 'Product linking', 'Product configuration', 'Data Quality'] },
  { name: 'Compliance OneTrust', code: 'CMP', n: 4, subjects: ['Compliance'] },
  { name: 'Universal Analytics', code: 'UA', n: 23, subjects: ['Configuration', 'Administration'] },
] as const;
const EVALS = ['Yes', 'No', 'Partly', 'Yes', 'Not concerned', ' yes ', 'NO', 'Partly', 'Yes', 'Unknown'];
const CRITS = ['High', 'Medium', 'Low', 'No impact', 'medium', 'HIGH'];
/** Ordres de colonnes volontairement différents d'un onglet à l'autre. */
const LAYOUTS: string[][] = [
  ['Category', 'Subject', 'Criteria', 'Controlled elements', 'Evaluation', 'Criticality', 'Comment', 'Impact', 'Suggested corrective action', 'Review', 'Top prio'],
  ['Criticality', 'Evaluation', 'Criteria', 'Subject', 'Category', 'Controlled elements', 'Suggested corrective action', 'Impact', 'Comment', 'Review'],
  ['  SUBJECT ', 'Catégorie', 'Criteria + Controlled elements', 'Évaluation', 'Criticité', 'Commentaire', 'Impact', 'Suggested Corrective Action'],
];

export const SHARED_ACTION = 'Harmoniser la convention de nommage des balises';
export interface GridSpec { counts?: Partial<Record<string, number>>; withFr?: boolean; frOnly?: boolean; frEvaluated?: number }
export interface Row { code: string; num: number; subject: string; category: string; question: string; element: string; evaluation: string; criticality: string; comment: string; impact: string; action: string; top: boolean }

export function gridRows(spec: GridSpec = {}): Row[] {
  const out: Row[] = [];
  let shared = 0;
  for (const d of DOMAIN_SHEETS) {
    const n = spec.counts?.[d.code] ?? d.n;
    for (let i = 1; i <= n; i++) {
      const evaluation = d.code === 'DL' && i === 5 ? '' : EVALS[(i + d.code.length) % EVALS.length];
      const ko = /no|partly/i.test(evaluation.trim()) && !/not/i.test(evaluation);
      const criticality = CRITS[(i + d.n) % CRITS.length];
      // Les deux premiers KO / PARTIEL GTM (hors Compliance, donc même pilier) de criticité haute ou moyenne partagent la même action : un seul constat attendu.
      const grouped = ko && d.code === 'GTM' && /high|medium/i.test(criticality) && d.subjects[i % d.subjects.length] !== 'Compliance' && shared++ < 2;
      const action = ko ? (grouped ? SHARED_ACTION : `Mettre en conformité ${d.code} point ${i}`) : '';
      out.push({
        code: d.code, num: i, subject: d.subjects[i % d.subjects.length], category: i % 3 ? 'Architecture' : 'Utilisateur',
        question: `${d.code} criterion ${i}: is the item correctly set up?`, element: `${d.code} element ${i}`,
        evaluation, criticality,
        comment: ko ? `Observed issue on ${d.code} ${i}` : '', impact: ko ? `Risque de données faussées (${d.code} ${i})` : '', action, top: d.code === 'GTM' && i === 1,
      });
    }
  }
  return out;
}

const domainSheet = (d: (typeof DOMAIN_SHEETS)[number], rows: Row[], k: number): SheetSpec => {
  const layout = LAYOUTS[k % LAYOUTS.length];
  const cell = (h: string, r: Row): V => {
    const n = h.trim().toLowerCase();
    if (n === 'category' || n === 'catégorie') return r.category;
    if (n === 'subject') return r.subject;
    if (n === 'criteria') return r.question;
    if (n === 'criteria + controlled elements') return `${r.question}\n${r.element}`;
    if (n === 'controlled elements') return r.element;
    if (n === 'evaluation' || n === 'évaluation') return r.evaluation || null;
    if (n === 'criticality' || n === 'criticité') return r.criticality;
    if (n === 'comment' || n === 'commentaire') return r.comment || null;
    if (n === 'impact') return r.impact || null;
    if (n === 'suggested corrective action') return r.action || null;
    if (n === 'top prio') return r.top ? 'x' : null;
    return null;
  };
  const out: V[][] = [[`${d.name} – Scoring`], [null], layout];
  const merges = [`A1:${String.fromCharCode(64 + layout.length)}1`];
  rows.forEach((r, i) => {
    if (i === 3) out.push([]); // ligne vide au milieu du tableau
    const line = layout.map(h => cell(h, r));
    // Subject fusionné verticalement sur les lignes 2 et 3 du premier onglet (cellule basse vide dans le XML).
    if (k === 0 && i === 2) line[layout.indexOf('Subject')] = null;
    out.push(line);
  });
  if (k === 0) merges.push(`B5:B6`); // Subject des 2e et 3e critères
  out.push([], ['Legend'], ['Impact', 'Suggested action to correct the identified issue'], ['Suggested corrective action', 'Suggested action to correct the identified issue']);
  return { name: d.name, rows: out, merges, inline: k === 2 };
};

const frSheet = (rows: Row[], evaluated: number): SheetSpec => {
  const FR: Record<string, string> = { 'Yes': 'Oui', ' yes ': 'oui', 'No': 'Non', 'NO': 'NON', 'Partly': 'Partiellement', 'Not concerned': 'Non concerné', 'Unknown': 'Inconnu', '': '' };
  const CR: Record<string, string> = { high: 'Haute', medium: 'Moyenne', low: 'Faible', 'no impact': 'Aucune' };
  const out: V[][] = [['Grille d’audit – Réponses'], ['N°', 'Critère', 'Élément contrôlé', 'Réponse', 'Criticité', 'Sujet', 'Commentaire', 'Impact', 'Action corrective']];
  let last = '', k = 0;
  for (const r of rows) {
    if (r.code !== last) { out.push([DOMAIN_SHEETS.find(d => d.code === r.code)!.name]); last = r.code; }
    k++;
    out.push([`${r.code}-${String(r.num).padStart(2, '0')}`, r.question.replace('criterion', 'critère'), r.element, k <= evaluated ? (FR[r.evaluation] ?? 'À revoir') : null, CR[r.criticality.toLowerCase()], r.subject, r.comment || null, r.impact || null, r.action || null]);
  }
  return { name: 'Réponses', rows: out };
};

export function makeGrid(spec: GridSpec = {}): Uint8Array {
  const rows = gridRows(spec);
  const content: SheetSpec = { name: '0. Content', rows: [['Scoring template'], [], ['Client', 'Client Démo Grille'], ['Date', 46310], [], ['Score', 'Configuration', 'Data Quality', 'Compliance'], ['', 0, 0, 0]] };
  const tracking: SheetSpec = { name: 'Tracking', rows: [['Tracking'], ['Criteria', 'Evaluation', 'Criticality', 'Top prio', 'Comment'],
    [rows.find(r => r.code === 'DL' && r.num === 1)!.question, 'Yes', 'High', 'x', null],
    ['Purchase event is sent with transaction_id', 'Unknown', 'High', 'x', 'Not verifiable without a test order']] };
  const sheets: SheetSpec[] = [content];
  if (!spec.frOnly) DOMAIN_SHEETS.forEach((d, k) => sheets.push(domainSheet(d, rows.filter(r => r.code === d.code), k)));
  if (!spec.frOnly) sheets.push(tracking);
  if (spec.withFr || spec.frOnly) sheets.push(frSheet(rows, spec.frEvaluated ?? rows.length));
  return makeXlsx(sheets);
}

if (process.argv[1]?.endsWith('make-grid.ts') && process.argv[2]) {
  writeFileSync(process.argv[2], makeGrid({ withFr: true, frEvaluated: 40 }));
  console.log(`Grille d'exemple écrite : ${process.argv[2]}`);
}
