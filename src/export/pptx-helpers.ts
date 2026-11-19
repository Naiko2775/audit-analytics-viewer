/** Utilitaires de l'export PPTX : charte, texte riche (**gras**, `code`, liens) en runs natifs, images (data URL). Sans DOM obligatoire. */
import { tx } from '../core/i18n.ts';
import type { Localise, Puce } from '../core/types.ts';

/* ---------- Charte JAKALA (couleurs sans « # », format pptxgenjs) ---------- */
export const C = {
  navy: '08006B', red: 'FF1A31', text: '1C1C1C', grey: '5A5E6B', soft: 'EEF0FA', white: 'FFFFFF', line: 'D5D8E3',
  ok: '1E7A34', okBg: 'E2F3E7', part: 'A85300', partBg: 'FCEFDF', ko: 'C0182B', koBg: 'FBE4E7', na: '7D8697', naBg: 'ECEFF3',
  moyen: 'D97A00', faibleCrit: '4B6A92', hatch: '1D1680', dev: '1F2330', devText: 'E6E8EF',
};
export const PIL = ['08006B', 'FF1A31', '0F7F81', '6D45A8'];
export const FONT = 'Raleway';
export const MONO = 'Consolas';
export const W = 13.333, H = 7.5;

export const hex = (c: string | undefined, d = C.navy) => (c ? String(c).replace(/^#/, '').toUpperCase() : d);
export const statusColor: Record<string, { fg: string; bg: string }> = {
  OK: { fg: C.ok, bg: C.okBg }, KO: { fg: C.ko, bg: C.koBg }, PARTIEL: { fg: C.part, bg: C.partBg }, INFO: { fg: C.navy, bg: C.soft },
  NA: { fg: C.na, bg: C.naBg }, INCONNU: { fg: C.na, bg: C.naBg }, A_REVOIR: { fg: C.part, bg: C.partBg },
};
export const critColor: Record<string, string> = { HAUTE: C.ko, MOYENNE: C.part, FAIBLE: C.faibleCrit, AUCUNE: C.na };
export const bandColor: Record<string, string> = { bon: C.ok, moyen: C.moyen, faible: C.ko, na: C.na };
export const ANN_ICON: Record<string, string> = { OK: '✓', KO: '✗', PARTIEL: '◐', INFO: 'ℹ' };

/* ---------- Texte riche ---------- */
export interface Run { text: string; options: Record<string, any> }
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;

/** Markdown restreint (D5) → runs pptxgenjs : **gras**, `code` (monospace), [lien](url) (lien cliquable). */
export function runs(s: Localise | string | undefined | null, base: Record<string, any> = {}): Run[] {
  const str = typeof s === 'string' ? s : tx(s as Localise);
  const out: Run[] = [];
  for (const part of String(str ?? '').split(TOKEN)) {
    if (!part) continue;
    // gras : le contenu peut lui-même porter du `code` ou un lien (même rendu que md() côté web)
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(...runs(part.slice(2, -2), { ...base, bold: true }));
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) out.push({ text: part.slice(1, -1), options: { ...base, fontFace: MONO, color: base.codeColor || C.navy } });
    else {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
      if (m) out.push({ text: m[1], options: { ...base, hyperlink: { url: m[2] }, color: C.navy, underline: { style: 'sng' } } });
      else out.push({ text: part, options: { ...base } });
    }
  }
  if (!out.length) out.push({ text: '', options: { ...base } });
  out.forEach(r => delete r.options.codeColor);
  return out;
}

/* ---------- Sûreté XML ---------- */
/** Caractères interdits en XML 1.0 (contrôles C0 hors tab/LF/CR, U+FFFE/U+FFFF, surrogates isolés) :
 *  pptxgenjs les recopie tels quels, et PowerPoint propose alors de « réparer » le fichier. */
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlSafe = (s: string) => s.replace(XML_BAD, '');
/** Copie profonde des arguments passés à pptxgenjs, chaînes nettoyées (sauf `data`, le contenu base64 des images). */
export function xmlClean<T>(v: T): T {
  if (typeof v === 'string') return xmlSafe(v) as any;
  if (Array.isArray(v)) return v.map(xmlClean) as any;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = k === 'data' ? x : xmlClean(x);
    return o;
  }
  return v;
}
/** Texte sans balisage (libellés courts, tableaux). */
export const plain = (s: Localise | string | undefined | null) =>
  String((typeof s === 'string' ? s : tx(s as Localise)) ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');

/** Un paragraphe : la puce et le niveau portent sur le premier run (règle de regroupement de pptxgenjs), le saut de ligne sur le dernier. */
export function para(rs: Run[], p: { bullet?: any; indentLevel?: number; paraSpaceAfter?: number; align?: string } = {}, last = false): Run[] {
  const out = rs.map(r => ({ text: r.text, options: { ...r.options } }));
  if (p.bullet !== undefined) out[0].options.bullet = p.bullet;
  if (p.indentLevel) out[0].options.indentLevel = p.indentLevel;
  if (p.paraSpaceAfter != null) out[0].options.paraSpaceAfter = p.paraSpaceAfter;
  if (p.align) out.forEach(r => (r.options.align = p.align));
  if (!last) out[out.length - 1].options.breakLine = true;
  return out;
}
/** Liste de puces du contrat (avec sous-puces) → paragraphes à puces natives. */
export function bulletRuns(arr: Puce[] | undefined, base: Record<string, any>, space = 3): Run[] {
  const paras: { rs: Run[]; lvl: number }[] = [];
  for (const b of arr || []) {
    if (b && typeof b === 'object' && 'texte' in b) {
      paras.push({ rs: runs(b.texte, base), lvl: 0 });
      (b.sous_puces || []).forEach(s => paras.push({ rs: runs(s, { ...base, fontSize: (base.fontSize || 11) - 1 }), lvl: 1 }));
    } else paras.push({ rs: runs(b as Localise, base), lvl: 0 });
  }
  return paras.flatMap((p, i) => para(p.rs, { bullet: p.lvl ? { code: '2013', indent: 12 } : { code: '25A0', indent: 12 }, indentLevel: p.lvl, paraSpaceAfter: space }, i === paras.length - 1));
}
/** Nombre de lignes approximatif d'une liste de puces pour une largeur donnée (dimensionnement des blocs). */
export function estimateLines(arr: Puce[] | undefined, widthIn: number, fontSize = 11): number {
  const perLine = Math.max(10, Math.floor((widthIn * 72) / (fontSize * 0.52)));
  let n = 0;
  for (const b of arr || []) {
    const txts = b && typeof b === 'object' && 'texte' in b ? [b.texte, ...(b.sous_puces || [])] : [b as Localise];
    txts.forEach(x => (n += Math.max(1, Math.ceil(plain(x as Localise).length / perLine))));
  }
  return n;
}
export const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const monogram = (s: string) => s.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '?';
export const initials = (s: string) => String(s || '?').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();

/* ---------- Images (data URL) ---------- */
export interface ImgData { data: string; mime: string; w: number; h: number }

export function parseDataUrl(u: string | null | undefined): { mime: string; base64: string } | null {
  if (!u || !/^data:/i.test(u)) return null;
  const i = u.indexOf(',');
  if (i < 0) return null;
  const head = u.slice(5, i), body = u.slice(i + 1);
  const mime = (head.split(';')[0] || 'application/octet-stream').toLowerCase();
  if (/;base64/i.test(head)) return { mime, base64: body.replace(/\s/g, '') };
  let txt = body;
  try { txt = decodeURIComponent(body); } catch { /* déjà décodé */ }
  return { mime, base64: utf8ToB64(txt) };
}
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBytes(b64: string, max = Infinity): Uint8Array {
  const s = atob(max < Infinity ? b64.slice(0, Math.ceil(max / 3) * 4) : b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
/** Dimensions intrinsèques (PNG, JPEG, GIF, WebP, SVG) lues dans l'en-tête, sans DOM. */
export function imageSize(mime: string, base64: string): { w: number; h: number } | null {
  try {
    if (mime === 'image/svg+xml') {
      const s = new TextDecoder().decode(b64ToBytes(base64, 4096));
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
      const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(s), h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(s);
      if (w && h) return { w: +w[1], h: +h[1] };
      if (vb) return { w: +vb[1], h: +vb[2] };
      return null;
    }
    const b = b64ToBytes(base64, mime === 'image/jpeg' || mime === 'image/jpg' ? Infinity : 64);
    const u16 = (i: number) => (b[i] << 8) | b[i + 1], le16 = (i: number) => b[i] | (b[i + 1] << 8);
    if (mime === 'image/png') return { w: (u16(16) << 16) | u16(18), h: (u16(20) << 16) | u16(22) };
    if (mime === 'image/gif') return { w: le16(6), h: le16(8) };
    if (mime === 'image/webp') {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
      if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      return null;
    }
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
        i += 2 + u16(i + 2);
      }
    }
  } catch { /* en-tête illisible */ }
  return null;
}
const hasDom = () => typeof document !== 'undefined' && typeof Image !== 'undefined';

/** Rasterise une image via canvas (navigateur) : SVG et WebP deviennent du PNG, lisible par toutes les versions de PowerPoint. */
function rasterize(src: string, w0: number, h0: number): Promise<ImgData | null> {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || w0 || 1200, h = img.naturalHeight || h0 || 800;
        const k = Math.min(2, 1920 / w); // petites images vectorielles agrandies (×2 max), largeur plafonnée à 1 920 px
        const cv = document.createElement('canvas');
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        res({ data: cv.toDataURL('image/png'), mime: 'image/png', w: cv.width, h: cv.height });
      } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = src;
  });
}
/**
 * Prépare une image (data URL) pour pptxgenjs : base64, dimensions connues.
 * Navigateur : SVG et WebP sont convertis en PNG. Node (tests) : SVG non convertible → null (emplacement texte à la place).
 */
/** Formats insérés tels quels : ceux que toutes les versions de PowerPoint lisent (et que pptxgenjs déclare). */
const NATIVE = new Set(['image/png', 'image/jpeg', 'image/gif']);
export async function prepImage(u: string | null | undefined): Promise<ImgData | null> {
  const p = parseDataUrl(u);
  if (!p || !p.mime.startsWith('image/')) return null;
  const mime = p.mime === 'image/jpg' || p.mime === 'image/pjpeg' ? 'image/jpeg' : p.mime;
  const sz = imageSize(mime, p.base64);
  const data = `data:${mime};base64,${p.base64}`;
  // SVG, WebP, AVIF, BMP… : PNG via canvas en navigateur ; hors navigateur, non insérable (emplacement texte + alerte).
  if (!NATIVE.has(mime)) return hasDom() ? rasterize(data, sz?.w || 0, sz?.h || 0) : null;
  return { data, mime, w: sz?.w || 1600, h: sz?.h || 1000 };
}
/** Rectangle « contain » d'une image dans une boîte. */
export function fit(iw: number, ih: number, x: number, y: number, w: number, h: number) {
  if (!(iw > 0 && ih > 0)) { iw = w; ih = h; }
  const k = Math.min(w / iw, h / ih), fw = iw * k, fh = ih * k;
  return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
}
/** Segments de hachures diagonales découpés dans un rectangle (motif de l'emplacement image corporate). */
export function hatch(x: number, y: number, w: number, h: number, step = 0.28) {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  // droites y - y0 = -(x - x0) + c ; on balaie c le long de la diagonale
  for (let c = step; c < w + h; c += step) {
    // point de départ sur le bord gauche ou bas, arrivée sur le bord haut ou droit (pente 45°, montante)
    const sx = Math.max(0, c - h), sy = Math.min(h, c);
    const ex = Math.min(w, c), ey = Math.max(0, c - w);
    segs.push({ x1: x + sx, y1: y + sy, x2: x + ex, y2: y + ey });
  }
  return segs;
}
