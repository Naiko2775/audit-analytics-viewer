/**
 * Lecteur XLSX minimal, sans DOM (Node et navigateur) : fflate pour l'archive, expressions régulières pour le XML.
 * Couvre ce dont le convertisseur de grille (DAT-30) a besoin : noms de feuilles, chaînes partagées (y compris rich text),
 * cellules t="s" | "inlineStr" | "str" | "b" | "e" | "d" et nombres. Les styles, formules et dates ne sont pas interprétés
 * (une date reste son numéro de série Excel). Les plages fusionnées sont recopiées dans chaque cellule de la plage.
 */
import { unzipSync, strFromU8 } from 'fflate';

export type Cell = string | number | boolean | null;
export interface Sheet { name: string; rows: Cell[][]; merges: string[] }
export interface Workbook { sheets: Sheet[] }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
/** Décode les entités XML et les échappements OOXML `_xHHHH_`. */
export function decodeXml(s: string): string {
  const cp = (n: number, raw: string) => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw);
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (raw, e: string) =>
      e[0] === '#' ? cp(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10), raw) : ENT[e])
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** « AB12 » → index de colonne 0-based (27). -1 si la référence est illisible. */
export function colIndex(ref: string): number {
  const m = /^\$?([A-Za-z]{1,3})/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
/** « AB12 » → [ligne 0-based, colonne 0-based]. */
export function cellRef(ref: string): [number, number] {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref || '');
  return m ? [parseInt(m[2], 10) - 1, colIndex(m[1])] : [-1, -1];
}

/** Retire les préfixes d'espace de noms des balises (`<x:row>` → `<row>`) ; les attributs (`r:id`) sont conservés. */
const stripNs = (xml: string) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXml(m[1] ?? m[2]) : null;
};
/** Texte d'un nœud contenant des <t> (texte simple ou runs rich text) ; la phonétique <rPh> est ignorée. */
const textOf = (xml: string) => {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  body.replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, (_, t) => { out += t ? decodeXml(t) : ''; return ''; });
  return out;
};

/** Résout la cible d'une relation OOXML (relative au dossier de la partie source, ou absolue). */
function resolveTarget(baseDir: string, t: string): string {
  const parts = (t.startsWith('/') ? t.slice(1) : (baseDir ? baseDir + '/' : '') + t).split('/');
  const out: string[] = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
interface Rel { target: string; type: string }
function readRels(files: Record<string, Uint8Array>, part: string): Record<string, Rel> {
  const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/')) : '';
  const base = part.slice(part.lastIndexOf('/') + 1);
  const relPath = (dir ? dir + '/' : '') + '_rels/' + base + '.rels';
  const out: Record<string, Rel> = {};
  if (!files[relPath]) return out;
  stripNs(strFromU8(files[relPath])).replace(/<Relationship\b([^>]*)\/?>/g, (_, a: string) => {
    const id = attr(a, 'Id'), t = attr(a, 'Target');
    if (id && t && attr(a, 'TargetMode') !== 'External') out[id] = { target: resolveTarget(dir, t), type: attr(a, 'Type') || '' };
    return '';
  });
  return out;
}
/** Partie principale du classeur : déclarée dans _rels/.rels, sinon xl/workbook.xml. */
function workbookPart(files: Record<string, Uint8Array>): string {
  const root = readRels(files, '');
  const main = Object.values(root).find(r => /\/officeDocument$/.test(r.type) && files[r.target]);
  return main ? main.target : 'xl/workbook.xml';
}

function sheetPaths(files: Record<string, Uint8Array>, wbPart: string, rels: Record<string, Rel>): { name: string; path: string }[] {
  const wb = files[wbPart] ? stripNs(strFromU8(files[wbPart])) : '';
  const out: { name: string; path: string }[] = [];
  let i = 0;
  wb.replace(/<sheet\b([^>]*)\/?>/g, (_, a: string) => {
    i++;
    const name = attr(a, 'name') ?? `Feuille${i}`;
    const rid = attr(a, 'r:id') ?? attr(a, 'id');
    const rel = rid ? rels[rid] : undefined;
    // Feuilles graphiques, macros ou boîtes de dialogue : pas de cellules à lire.
    if (rel && (/chartsheet|dialogsheet|macrosheet/i.test(rel.type) || /\/(chartsheets|dialogsheets|macrosheets)\//.test(rel.target))) return '';
    let path = rel?.target;
    if (!path || !files[path]) path = `xl/worksheets/sheet${i}.xml`;
    if (files[path]) out.push({ name, path });
    return '';
  });
  if (!out.length) // classeur sans workbook.xml exploitable : feuilles dans l'ordre des fichiers
    Object.keys(files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .forEach((path, k) => out.push({ name: `Feuille${k + 1}`, path }));
  return out;
}

function readShared(files: Record<string, Uint8Array>, rels: Record<string, Rel>): string[] {
  const viaRel = Object.values(rels).find(r => /\/sharedStrings$/.test(r.type) && files[r.target])?.target;
  const p = viaRel || Object.keys(files).find(k => /^xl\/sharedStrings\.xml$/i.test(k));
  if (!p) return [];
  const xml = stripNs(strFromU8(files[p]));
  const out: string[] = [];
  xml.replace(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, (_, body) => { out.push(body ? textOf(body) : ''); return ''; });
  return out;
}

function readSheet(xml: string, shared: string[]): { rows: Cell[][]; merges: string[] } {
  xml = stripNs(xml);
  const rows: Cell[][] = [];
  let rIdx = -1;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = attr(rm[1], 'r');
    rIdx = rAttr ? parseInt(rAttr, 10) - 1 : rIdx + 1;
    const row: Cell[] = [];
    let cIdx = -1;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    const body = rm[2] || '';
    while ((cm = cellRe.exec(body))) {
      const a = cm[1], inner = cm[2] || '';
      const ref = attr(a, 'r');
      cIdx = ref ? colIndex(ref) : cIdx + 1;
      if (cIdx < 0) continue;
      const t = attr(a, 't') || 'n';
      const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      const v = vm ? decodeXml(vm[1]) : null;
      let val: Cell = null;
      if (t === 's') val = v == null ? null : (shared[parseInt(v, 10)] ?? null);
      else if (t === 'inlineStr') { const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner); val = is ? textOf(is[1]) : v; }
      else if (t === 'b') val = v == null ? null : v.trim() === '1' || v.trim().toLowerCase() === 'true';
      else if (t === 'str' || t === 'e' || t === 'd') val = v;
      else if (v != null && v.trim() !== '') { const n = Number(v); val = Number.isFinite(n) ? n : v; }
      if (typeof val === 'string' && val === '') val = null;
      row[cIdx] = val;
    }
    if (rIdx < 0 || !row.some(v => v != null)) continue; // ligne sans valeur (mise en forme seule) : non matérialisée
    for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = null;
    rows[rIdx] = row;
  }

  // Plages fusionnées : la valeur de la cellule haut-gauche est recopiée dans toute la plage.
  const merges: string[] = [];
  xml.replace(/<mergeCell\b([^>]*)\/?>/g, (_, a: string) => { const ref = attr(a, 'ref'); if (ref) merges.push(ref); return ''; });
  for (const m of merges) {
    const [a, b] = m.split(':');
    const [r1, c1] = cellRef(a), [r2, c2] = cellRef(b || a);
    if (r1 < 0 || c1 < 0 || r2 < r1 || c2 < c1 || (r2 - r1 + 1) * (c2 - c1 + 1) > 20000) continue;
    const v = rows[r1]?.[c1] ?? null;
    if (v == null) continue;
    for (let r = r1; r <= r2; r++) {
      const row = rows[r] || (rows[r] = []);
      for (let c = c1; c <= c2; c++) { while (row.length < c) row.push(null); if (row[c] == null) row[c] = v; }
    }
  }
  for (let k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
  return { rows, merges };
}

/** Lit un classeur XLSX. Lève une erreur si l'archive n'est pas un classeur Excel lisible. */
export function readXlsx(bytes: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('Fichier illisible : ce n’est pas une archive XLSX valide.'); }
  if (!Object.keys(files).some(p => p.startsWith('xl/'))) throw new Error('Archive sans dossier « xl/ » : ce n’est pas un classeur Excel.');
  const wbPart = workbookPart(files);
  const rels = readRels(files, wbPart);
  const shared = readShared(files, rels);
  return {
    sheets: sheetPaths(files, wbPart, rels).map(({ name, path }) => ({ name, ...readSheet(strFromU8(files[path]), shared) })),
  };
}
