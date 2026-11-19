/**
 * Écrivain XLSX (OOXML SpreadsheetML) minimal, sans dépendance autre que fflate.
 * Couvre : plusieurs feuilles, chaînes partagées, styles fixes (charte JAKALA), largeurs de colonnes,
 * volet figé, filtre automatique, fusions, listes de validation, nombres, booléens et dates.
 * Pur, sans DOM.
 */
import { zipSync, strToU8 } from 'fflate';

/** Styles disponibles (index des `cellXfs` dans styles.xml). */
export const STYLES = {
  default: 0, header: 1, text: 2, wrap: 3, num: 4, date: 5, title: 6, bold: 7, note: 8,
  ok: 9, partiel: 10, ko: 11, na: 12, label: 13, numBold: 14, subtitle: 15, center: 16,
} as const;
export type StyleName = keyof typeof STYLES;

export type CellValue = string | number | boolean | Date | null | undefined;
export type Cell = CellValue | { v: CellValue; s?: StyleName };
export interface Validation { sqref: string; list: string[] }
export interface SheetSpec {
  name: string;
  rows: Cell[][];
  /** Largeurs en caractères, par colonne (A, B, …). */
  cols?: number[];
  /** Nombre de lignes / colonnes figées en haut / à gauche. */
  freeze?: { rows?: number; cols?: number };
  /** true : filtre sur la plage de la première ligne à la dernière ; ou une plage explicite « A1:K20 ». */
  autoFilter?: boolean | string;
  merges?: string[];
  validations?: Validation[];
  /** Style appliqué aux cellules sans style explicite (défaut : text). */
  defaultStyle?: StyleName;
}
export interface WorkbookMeta { title?: string; creator?: string; created?: Date }

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const FONT = 'Raleway';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_STR = 32767;

/** Supprime les caractères interdits en XML 1.0 (contrôles hors tab/LF/CR, U+FFFE/FFFF, surrogates isolés). */
export const cleanXml = (s: string): string =>
  s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
/** Échappe une chaîne pour un nœud texte ou un attribut XML. */
export const escXml = (v: unknown): string =>
  cleanXml(String(v ?? '')).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export const cellRef = (row: number, col: number) => colLetter(col) + (row + 1);
/** Nom de feuille valide : 31 caractères, sans []:*?/\ ni apostrophe en début ou fin. */
export function sheetName(name: string): string {
  const s = cleanXml(name).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31);
  return s || 'Feuille';
}
/** Date JS → numéro de série Excel (heure locale). */
export const excelDate = (d: Date) => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;

function stylesXml(): string {
  const font = (o: { b?: boolean; i?: boolean; sz?: number; color: string }) =>
    `<font>${o.b ? '<b/>' : ''}${o.i ? '<i/>' : ''}<sz val="${o.sz ?? 10}"/><color rgb="FF${o.color}"/><name val="${FONT}"/><family val="2"/></font>`;
  const fonts = [
    font({ color: '1C1C1C' }),                    // 0 texte
    font({ b: true, color: 'FFFFFF' }),           // 1 en-tête
    font({ b: true, sz: 16, color: '08006B' }),   // 2 titre
    font({ b: true, color: '1C1C1C' }),           // 3 gras
    font({ i: true, color: '5A5E6B' }),           // 4 note
    font({ b: true, sz: 12, color: '08006B' }),   // 5 sous-titre
  ];
  const solid = (hex: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    solid('08006B'), solid('E2F3E7'), solid('FCEFDF'), solid('FBE4E7'), solid('ECEDF1'), solid('EEF0FA')];
  const side = (n: string) => `<${n} style="thin"><color rgb="FFC9CCD6"/></${n}>`;
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
    `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`];
  // [numFmt, font, fill, border, align]
  type Xf = [number, number, number, number, string];
  const top = '<alignment vertical="top"/>', wrapTop = '<alignment vertical="top" wrapText="1"/>';
  const xfs: Record<StyleName, Xf> = {
    default: [0, 0, 0, 0, ''],
    header: [0, 1, 2, 1, '<alignment vertical="center" wrapText="1"/>'],
    text: [0, 0, 0, 1, top],
    wrap: [0, 0, 0, 1, wrapTop],
    num: [0, 0, 0, 1, '<alignment horizontal="center" vertical="top"/>'],
    date: [164, 0, 0, 1, top],
    title: [0, 2, 0, 0, ''],
    bold: [0, 3, 0, 0, ''],
    note: [0, 4, 0, 0, '<alignment wrapText="1" vertical="top"/>'],
    ok: [0, 0, 3, 1, top],
    partiel: [0, 0, 4, 1, top],
    ko: [0, 0, 5, 1, top],
    na: [0, 0, 6, 1, top],
    label: [0, 3, 7, 1, wrapTop],
    numBold: [0, 3, 0, 1, '<alignment horizontal="center" vertical="top"/>'],
    subtitle: [0, 5, 0, 0, ''],
    center: [0, 0, 0, 1, '<alignment horizontal="center" vertical="top"/>'],
  };
  const order = (Object.keys(STYLES) as StyleName[]).sort((a, b) => STYLES[a] - STYLES[b]);
  const cellXfs = order.map(k => {
    const [nf, f, fi, b, al] = xfs[k];
    return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${f ? ' applyFont="1"' : ''}${fi ? ' applyFill="1"' : ''}${b ? ' applyBorder="1"' : ''}${al ? ` applyAlignment="1">${al}</xf>` : '/>'}`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>`
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

class SharedStrings {
  list: string[] = []; idx = new Map<string, number>(); count = 0;
  add(s: string): number {
    this.count++;
    let i = this.idx.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.idx.set(s, i); }
    return i;
  }
  xml(): string {
    const si = this.list.map(s => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${escXml(s)}</t></si>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${NS}" count="${this.count}" uniqueCount="${this.list.length}">${si}</sst>`;
  }
}

function cellXml(ref: string, cell: Cell, def: StyleName, sst: SharedStrings): string {
  let v: CellValue, s: StyleName | undefined;
  if (cell !== null && typeof cell === 'object' && !(cell instanceof Date)) { v = cell.v; s = cell.s; } else v = cell as CellValue;
  if (v instanceof Date && !s) s = 'date';
  const st = STYLES[s ?? def], sa = st ? ` s="${st}"` : '';
  if (v === null || v === undefined || v === '') return st ? `<c r="${ref}"${sa}/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : `<c r="${ref}"${sa}/>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) return isNaN(v.getTime()) ? `<c r="${ref}"${sa}/>` : `<c r="${ref}"${sa}><v>${excelDate(v)}</v></c>`;
  let str = cleanXml(String(v)).replace(/\r\n?/g, '\n');
  if (str.length > MAX_STR) str = str.slice(0, MAX_STR - 1) + '…';
  return `<c r="${ref}"${sa} t="s"><v>${sst.add(str)}</v></c>`;
}

function sheetXml(sh: SheetSpec, sst: SharedStrings, selected: boolean): { xml: string; filterRef: string | null } {
  const nCols = Math.max(1, ...sh.rows.map(r => r.length), sh.cols?.length ?? 0);
  const nRows = Math.max(1, sh.rows.length);
  const dim = `A1:${cellRef(nRows - 1, nCols - 1)}`;
  const fr = sh.freeze?.rows ?? 0, fc = sh.freeze?.cols ?? 0;
  let view = `<sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}>`;
  if (fr || fc) {
    const tl = cellRef(fr, fc), pane = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight';
    view += `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/>`;
  }
  view += '</sheetView>';
  const cols = sh.cols?.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const def = sh.defaultStyle ?? 'text';
  const rows = sh.rows.map((r, ri) => {
    const cells = r.map((c, ci) => cellXml(cellRef(ri, ci), c, def, sst)).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const filterRef = sh.autoFilter === true ? (sh.rows.length > 0 ? `A1:${cellRef(nRows - 1, Math.max(0, (sh.rows[0]?.length || 1) - 1))}` : null)
    : typeof sh.autoFilter === 'string' ? sh.autoFilter : null;
  const af = filterRef ? `<autoFilter ref="${filterRef}"/>` : '';
  const mg = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const dv = sh.validations?.length ? `<dataValidations count="${sh.validations.length}">${sh.validations.map(v =>
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${v.sqref}"><formula1>${escXml('"' + v.list.map(x => x.replace(/[",]/g, ' ')).join(',') + '"')}</formula1></dataValidation>`).join('')}</dataValidations>` : '';
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`
    + `<dimension ref="${dim}"/><sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}`
    + `<sheetData>${rows}</sheetData>${af}${mg}${dv}`
    + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
  return { xml, filterRef };
}

/** Construit le classeur et renvoie les octets du fichier .xlsx. */
export function buildXlsx(sheets: SheetSpec[], meta: WorkbookMeta = {}): Uint8Array {
  if (!sheets.length) throw new Error('Le classeur doit contenir au moins une feuille.');
  const sst = new SharedStrings();
  const used = new Set<string>();
  const names = sheets.map(s => {
    let n = sheetName(s.name), k = 2;
    while (used.has(n.toLowerCase())) n = sheetName(s.name).slice(0, 28) + ' ' + k++;
    used.add(n.toLowerCase()); return n;
  });
  const files: Record<string, Uint8Array> = {};
  const defined: string[] = [];
  sheets.forEach((s, i) => {
    const { xml, filterRef } = sheetXml(s, sst, i === 0);
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
    if (filterRef) {
      const abs = filterRef.split(':').map(r => r.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')).join(':');
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${escXml(`'${names[i].replace(/'/g, "''")}'!${abs}`)}</definedName>`);
    }
  });
  const n = sheets.length;
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`
    + `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PR}">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`
    + `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${NS_R}">`
    + `<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>`
    + `<sheets>${names.map((nm, i) => `<sheet name="${escXml(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + (defined.length ? `<definedNames>${defined.join('')}</definedNames>` : '') + `</workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_PR}">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(stylesXml());
  files['xl/sharedStrings.xml'] = strToU8(sst.xml());
  const iso = (meta.created ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${escXml(meta.title ?? '')}</dc:title><dc:creator>${escXml(meta.creator ?? 'JAKALA')}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`);
  files['docProps/app.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Audit Analytics Viewer</Application></Properties>`);
  return zipSync(files, { level: 6 });
}
