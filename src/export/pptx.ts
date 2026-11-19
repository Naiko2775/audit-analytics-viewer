/**
 * Export PPTX à la charte JAKALA (EXP-16 à EXP-24, spec §5) : reprise de la structure BFM 2025,
 * une slide par section et par fiche, tout le texte en zones de texte natives éditables.
 * Pur (sans DOM obligatoire) : en navigateur, les SVG/WebP sont rasterisés en PNG via canvas.
 */
import PptxGenJS from 'pptxgenjs';
import { unzipSync, zipSync } from 'fflate';
import type { MConstat, Model } from '../core/model.ts';
import { AXES, band } from '../core/rules.ts';
import { fmtMonth, getLang, setLang, t, tx, type Lang } from '../core/i18n.ts';
import type { Annotation, LigneConsole, LigneReseau, Preuve, Puce } from '../core/types.ts';
import {
  ANN_ICON, C, FONT, H, MONO, PIL, W, bandColor, bulletRuns, critColor, estimateLines, fit, hatch, hex, initials, monogram,
  para, plain, prepImage, runs, statusColor, trunc, xmlClean, xmlSafe, type ImgData, type Run,
} from './pptx-helpers.ts';

export type SlideKind = 'S0' | 'S0b' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S9' | 'T';
const KINDS = new Set<string>(['S0', 'S0b', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S9', 'T']);
export interface SlideRef { kind: SlideKind; constatId?: string; part?: string; pages?: Record<string, number> }
export interface PptxOptions {
  lang: Lang; slides: SlideRef[];
  /** Alertes de génération (débordement probable, preuve non convertible…), à afficher dans le rapport d'export. */
  warnings?: string[];
}

type Slide = any;
const MX = 0.5, CW = W - 2 * MX, BY = 1.45, BB = 6.85;
/** Marges internes d'une zone de texte en points, dans l'ordre CSS (haut, droite, bas, gauche).
 *  pptxgenjs 3.12 lit le tableau `margin` des zones de texte dans l'ordre [gauche, droite, bas, haut]. */
const mg = (t: number, r: number, b: number, l: number) => [l, r, b, t];
const BASE = { fontFace: FONT, color: C.text, fontSize: 11 };
/** Séparateur « libellé : valeur » selon la typographie de la langue (espace avant les deux-points en français seulement). */
const sep = () => (getLang() === 'fr' ? ' : ' : ': ');
const clientOf = (M: Model) => String(M.audit.client ?? '').trim() || '—';

/* ===================== Plan du deck ===================== */
const R = (M: Model) => M.audit.restitution || {};
const s1On = (M: Model) => R(M).s1_active !== false && !!M.audit.roadmap;
const visibles = (M: Model) => M.constats.filter(c => c.visible);
/** Fiches visibles groupées par pilier, dans l'ordre des piliers puis du rang. */
export const ficheOrder = (M: Model) => { const l = visibles(M); return M.piliers.flatMap(p => l.filter(c => c.pilier_id === p.id)); };

/** Parties du sommaire (même logique que `parts()` de sections.ts). */
export function deckParts(M: Model) {
  const out: { key: string; label: string; sub?: string }[] = [];
  const list = ficheOrder(M);
  if (s1On(M)) out.push({ key: 'S1', label: t('S1'), sub: t('cadrage') });
  out.push({ key: 'S2', label: t('S2'), sub: M.piliers.map(p => tx(p.libelle)).join(' · ') });
  out.push({ key: 'S3', label: R(M).masquer_scores ? t('S3b') : t('S3'), sub: t('S4') });
  M.piliers.forEach(p => { const n = list.filter(c => c.pilier_id === p.id).length; if (n) out.push({ key: 'P:' + p.id, label: tx(p.libelle), sub: `${t('S5')} · ${n} ${t('fiches')}` }); });
  out.push({ key: 'S6', label: `${t('S6')} & ${t('S7')}` });
  return out;
}

/** Plan par défaut du deck, identique à `buildSlides()` de l'interface (couverture, sommaire, transitions, sections, fiches, contacts). */
export function deckPlan(M: Model): SlideRef[] {
  const out: (SlideRef & { _part?: string })[] = [{ kind: 'S0' }];
  const sm = R(M).sommaire || {}, withAgenda = sm.actif !== false, trans = !!sm.transitions;
  if (withAgenda) out.push({ kind: 'S0b' });
  const tr = (part: string) => { if (withAgenda && trans) out.push({ kind: 'T', part }); };
  if (s1On(M)) { tr('S1'); out.push({ kind: 'S1', _part: 'S1' }); }
  tr('S2'); out.push({ kind: 'S2', _part: 'S2' });
  tr('S3'); out.push({ kind: 'S3', _part: 'S3' }, { kind: 'S4' });
  const list = ficheOrder(M);
  M.piliers.forEach(p => {
    const it = list.filter(c => c.pilier_id === p.id); if (!it.length) return;
    tr('P:' + p.id);
    it.forEach((c, i) => out.push({ kind: 'S5', constatId: c.id, _part: i === 0 ? 'P:' + p.id : undefined }));
  });
  tr('S6'); out.push({ kind: 'S6', _part: 'S6' }, { kind: 'S7' }, { kind: 'S9' });
  const pages: Record<string, number> = {};
  out.forEach((s, i) => { if (s._part && !pages[s._part]) pages[s._part] = i + 1; });
  return out.map(({ _part, ...s }) => (s.kind === 'S0b' || s.kind === 'T' ? { ...s, pages } : s));
}

const fileSafe = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
export const pptxFileName = (M: Model) => {
  const d = fileSafe(String(M.audit.date || ''));
  return `Audit_Analytics_${fileSafe(String(M.audit.client || '')) || 'client'}${d ? '_' + d : ''}.pptx`;
};

/* ===================== Primitives ===================== */
function text(s: Slide, v: string | Run[], o: Record<string, any>) {
  s.addText(v, { ...BASE, margin: 2, valign: 'top', ...o });
}
function rect(s: Slide, x: number, y: number, w: number, h: number, fill?: string, line?: string, o: Record<string, any> = {}) {
  const { lw, ...rest } = o;
  s.addShape('rect', { x, y, w, h, fill: fill ? { color: fill } : { type: 'none' }, line: line ? { color: line, width: lw ?? 0.75 } : { type: 'none' }, ...rest });
}
function rrect(s: Slide, x: number, y: number, w: number, h: number, fill?: string, line?: string, r = 0.06) {
  s.addShape('roundRect', { x, y, w, h, rectRadius: r, fill: fill ? { color: fill } : { type: 'none' }, line: line ? { color: line, width: 0.75 } : { type: 'none' } });
}
/** Pastille numérotée (repère d'annotation, rang). */
function mark(s: Slide, cx: number, cy: number, n: number | string, fill: string, d = 0.24, fs = 8) {
  s.addText(String(n), { shape: 'ellipse', x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: fill }, line: { color: C.white, width: 0.75 }, fontFace: FONT, fontSize: fs, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
}
/** Badge texte (type Quick Win / Longue traîne, statut). */
function badge(s: Slide, x: number, y: number, w: number, h: number, label: string, fill: string, color: string, line?: string, fs = 7.5) {
  s.addText(label, { shape: 'roundRect', rectRadius: 0.05, x, y, w, h, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { type: 'none' }, fontFace: FONT, fontSize: fs, bold: true, color, align: 'center', valign: 'middle', margin: 0 });
}
function header(s: Slide, sur: string, titre: string) {
  titre = String(titre ?? '');
  text(s, String(sur ?? '').toUpperCase(), { x: MX, y: 0.3, w: 11.2, h: 0.3, fontSize: 11, bold: true, color: C.red, charSpacing: 1, margin: 0 });
  const L = titre.length, fs = L > 90 ? 16 : L > 70 ? 18 : L > 55 ? 21 : 24;
  s.addText(titre, { placeholder: 'title', fontFace: FONT, fontSize: fs, bold: true, color: C.navy, align: 'left', valign: 'top' });
}
const typeBadge = (c: MConstat) =>
  c.quadrant === 'QW' || c.quadrant === 'LT'
    ? c.type === 'QuickWin' ? { label: t('QuickWin'), fill: C.navy, color: C.white, line: undefined } : { label: t('LongueTraine'), fill: C.white, color: C.navy, line: C.navy }
    : { label: t(c.quadrant), fill: C.soft, color: C.grey, line: undefined };
const pilHex = (M: Model, id: string) => { const i = M.piliers.findIndex(p => p.id === id); return PIL[(i < 0 ? 0 : i) % 4]; };

/* ===================== Masters ===================== */
function defineMasters(pptx: any, client: string) {
  pptx.defineSlideMaster({
    title: 'JAKALA',
    background: { color: C.white },
    margin: [0.5, 0.5, 0.5, 0.5],
    objects: [
      { text: { text: 'J!', options: { x: 12.0, y: 0.25, w: 0.85, h: 0.55, fontFace: FONT, fontSize: 26, bold: true, color: C.red, align: 'right', valign: 'middle', margin: 0 } } },
      { line: { x: MX, y: 7.0, w: CW, h: 0, line: { color: C.line, width: 0.75 } } },
      { text: { text: xmlSafe(`JAKALA x ${client}`), options: { x: MX, y: 7.05, w: 8, h: 0.3, fontFace: FONT, fontSize: 9, color: C.grey, valign: 'middle', margin: 0 } } },
      { placeholder: { options: { name: 'title', type: 'title', x: MX, y: 0.6, w: 11.3, h: 0.72, fontFace: FONT, bold: true, color: C.navy, align: 'left', valign: 'top', margin: 0 }, text: '' } },
    ],
    slideNumber: { x: 12.23, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 9, color: C.grey, align: 'right' },
  });
  pptx.defineSlideMaster({ title: 'JAKALA_COVER', background: { color: C.navy }, objects: [] });
}

/* ===================== S0 Couverture ===================== */
function sS0(s: Slide, M: Model, img: Map<string, ImgData | null>, warn: string[]) {
  const a = M.audit, rx = 8.33, rw = W - rx;
  const corp = a.image_corporate ? img.get(a.image_corporate) : null;
  if (a.image_corporate && !corp) warn.push('Couverture : image corporate non insérable (data URL PNG, JPEG ou GIF attendue hors navigateur) : motif hachuré à la place.');
  if (corp) s.addImage({ data: corp.data, x: rx, y: 0, w: corp.w / 100, h: corp.h / 100, sizing: { type: 'cover', w: rw, h: H }, altText: t('image_corporate') });
  else {
    rect(s, rx, 0, rw, H, '120A84');
    hatch(rx, 0, rw, H, 0.3).forEach(g => s.addShape('line', { x: g.x1, y: g.y2, w: g.x2 - g.x1, h: g.y1 - g.y2, flipV: true, line: { color: '2A2399', width: 1 } }));
  }
  text(s, 'J!', { x: 0.7, y: 0.5, w: 1.2, h: 0.7, fontSize: 34, bold: true, color: C.red, margin: 0 });
  text(s, String(a.client || '').toUpperCase(), { x: 0.7, y: 2.0, w: 7.2, h: 0.4, fontSize: 14, bold: true, color: C.red, charSpacing: 2, margin: 0 });
  text(s, tx(a.titre) || t('default_title'), { x: 0.7, y: 2.45, w: 7.3, h: 1.6, fontSize: 36, bold: true, color: C.white, margin: 0 });
  text(s, fmtMonth(a.date), { x: 0.7, y: 4.1, w: 6, h: 0.4, fontSize: 16, color: C.white, margin: 0 });
  rect(s, 0.7, 4.65, 1.2, 0.07, C.red);
  const hx = 0.7, hy = 5.15, hw = 2.0, hh = 1.75;
  const logo = a.logo ? img.get(a.logo) : null;
  if (a.logo && !logo) warn.push('Couverture : logo client non insérable (data URL image attendue) : initiales à la place.');
  if (logo) {
    s.addShape('hexagon', { x: hx, y: hy, w: hw, h: hh, fill: { color: C.white }, line: { type: 'none' } });
    const f = fit(logo.w, logo.h, hx + 0.45, hy + 0.3, hw - 0.9, hh - 0.6);
    s.addImage({ data: logo.data, ...f, altText: a.client });
  } else s.addText(initials(a.client), { shape: 'hexagon', x: hx, y: hy, w: hw, h: hh, fill: { color: C.white }, line: { type: 'none' }, fontFace: FONT, fontSize: 28, bold: true, color: C.navy, align: 'center', valign: 'middle' });
}

/* ===================== S0b Sommaire / transitions ===================== */
function sS0b(s: Slide, M: Model, ref: SlideRef) {
  header(s, t('S0b'), clientOf(M));
  const ps = deckParts(M), n = ps.length, rh = Math.min(0.72, (BB - BY - 0.1) / Math.max(1, n));
  const cur = ref.kind === 'T' ? ref.part : undefined;
  ps.forEach((p, i) => {
    const y = BY + 0.1 + i * rh, on = cur === p.key, dim = !!cur && !on;
    if (on) { rect(s, MX, y, CW, rh - 0.06, C.soft); rect(s, MX, y, 0.08, rh - 0.06, C.red); }
    else rect(s, MX + 0.2, y + rh - 0.04, CW - 0.2, 0.01, C.line);
    text(s, String(i + 1).padStart(2, '0'), { x: MX + 0.25, y, w: 0.9, h: rh - 0.06, fontSize: 22, bold: true, color: dim ? C.grey : C.red, valign: 'middle' });
    const lab: Run[] = [{ text: p.label, options: { ...BASE, fontSize: 16, bold: true, color: dim ? C.grey : C.navy, breakLine: !!p.sub } }];
    if (p.sub) lab.push({ text: p.sub, options: { ...BASE, fontSize: 10.5, color: C.grey } });
    text(s, lab, { x: MX + 1.25, y, w: 9.2, h: rh - 0.06, valign: 'middle' });
    const pg = ref.pages?.[p.key];
    if (pg) text(s, `${t('page')} ${pg}`, { x: W - MX - 1.6, y, w: 1.45, h: rh - 0.06, fontSize: 12, bold: on, color: on ? C.navy : C.grey, align: 'right', valign: 'middle' });
  });
}

/* ===================== S1 Contexte & roadmap ===================== */
function sS1(s: Slide, M: Model, warn: string[]) {
  header(s, t('S1'), 'DIG · HACK · MAKE');
  const a = M.audit, r = R(M);
  let y = BY;
  if (r.intro) { text(s, runs(r.intro, { ...BASE, fontSize: 11 }), { x: MX, y, w: CW, h: 0.5 }); y += 0.55; }
  const cd: any = a.cadrage || {}, keys = ['besoin', 'objectifs', 'contraintes', 'livrables'], gap = 0.2, bw = (CW - 3 * gap) / 4, bh = 1.75;
  keys.forEach((k, i) => {
    const x = MX + i * (bw + gap), items: Puce[] = cd[k] || [];
    rect(s, x, y, bw, bh, C.soft);
    rect(s, x, y, 0.06, bh, C.red);
    text(s, t(k), { x: x + 0.15, y: y + 0.06, w: bw - 0.25, h: 0.3, fontSize: 12, bold: true, color: C.navy });
    if (estimateLines(items, bw - 0.3, 8.5) > 9) warn.push(`S1 : bloc « ${t(k)} » probablement trop long pour son cadre.`);
    if (items.length) text(s, bulletRuns(items, { ...BASE, fontSize: estimateLines(items, bw - 0.3, 9.5) > 7 ? 8.5 : 9.5 }, 2), { x: x + 0.12, y: y + 0.38, w: bw - 0.22, h: bh - 0.45 });
    else text(s, '—', { x: x + 0.15, y: y + 0.38, w: bw - 0.25, h: 0.3, color: C.grey });
  });
  // Gantt simplifié en formes natives
  const rm = a.roadmap; if (!rm) return;
  const mois = rm.mois || [], n = Math.max(1, mois.length), gy = y + bh + 0.25, lw = 3.0, mw = (CW - lw) / n;
  const phases = rm.phases || [], rows = phases.reduce((k, p) => k + 1 + (p.sous_taches || []).length, 0);
  const rh = Math.min(0.32, (BB - gy - 0.32) / Math.max(1, rows));
  mois.forEach((m, i) => {
    text(s, fmtMonth(m, true), { x: MX + lw + i * mw, y: gy, w: mw, h: 0.28, fontSize: 9.5, bold: true, color: C.grey, align: 'center', valign: 'middle' });
    rect(s, MX + lw + i * mw, gy + 0.3, 0.005, rows * rh, C.line);
  });
  const ix = (m: string) => Math.max(0, mois.indexOf(m));
  let ry = gy + 0.3;
  phases.forEach(ph => {
    const cur = ph.code === rm.phase_courante, col = cur ? C.red : C.navy;
    rect(s, MX, ry, CW, rh, cur ? 'FFF0F2' : C.soft);
    text(s, [
      { text: ph.code + '  ', options: { ...BASE, fontSize: 9.5, bold: true, color: col } },
      { text: tx(ph.libelle) + (cur ? ` · ${t('en_cours')}` : ''), options: { ...BASE, fontSize: 9.5, bold: cur, color: col } },
    ], { x: MX + 0.08, y: ry, w: CW - 0.1, h: rh, valign: 'middle', margin: 0 });
    ry += rh;
    (ph.sous_taches || []).forEach(st => {
      text(s, tx(st.libelle), { x: MX + 0.25, y: ry, w: lw - 0.3, h: rh, fontSize: 9, color: C.text, valign: 'middle', margin: 0 });
      const a0 = ix(st.debut), b0 = Math.max(a0, ix(st.fin));
      rrect(s, MX + lw + a0 * mw + 0.05, ry + rh * 0.22, (b0 - a0 + 1) * mw - 0.1, rh * 0.56, col, undefined, rh * 0.28);
      ry += rh;
    });
  });
}

/* ===================== S2 Périmètre & accès requis ===================== */
function toolChip(s: Slide, o: { libelle: string; couleur?: string; categorie?: string } | undefined, x: number, y: number, w: number) {
  if (!o) return;
  s.addText(monogram(o.libelle), { shape: 'ellipse', x, y, w: 0.3, h: 0.3, fill: { color: hex(o.couleur, C.navy) }, line: { type: 'none' }, fontFace: FONT, fontSize: 7, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
  const lab: Run[] = [{ text: o.libelle, options: { ...BASE, fontSize: 9, bold: true, color: C.text, breakLine: !!o.categorie } }];
  if (o.categorie) lab.push({ text: o.categorie, options: { ...BASE, fontSize: 7.5, color: C.grey } });
  text(s, lab, { x: x + 0.34, y: y - 0.04, w: w - 0.36, h: 0.38, valign: 'middle', margin: 0 });
}
const RQ: Record<string, { fg: string; bg: string }> = { a_demander: { fg: C.ko, bg: C.koBg }, demande: { fg: C.part, bg: C.partBg }, obtenu: { fg: C.ok, bg: C.okBg }, refuse: { fg: C.na, bg: C.naBg } };
function sS2(s: Slide, M: Model, warn: string[]) {
  const a = M.audit, ps = M.piliers;
  header(s, t('S2'), `${clientOf(M)} · ${ps.map(p => tx(p.libelle)).join(' / ')}`);
  const n = Math.max(1, Math.min(ps.length, 4)), gap = 0.25, cw = (CW - (n - 1) * gap) / n, ch = 2.75;
  ps.slice(0, 4).forEach((p, i) => {
    const x = MX + i * (cw + gap), col = PIL[i % 4];
    rect(s, x, BY, cw, ch, C.white, C.line);
    s.addText(tx(p.libelle), { shape: 'rect', x, y: BY, w: cw, h: 0.42, fill: { color: col }, line: { type: 'none' }, fontFace: FONT, fontSize: 13, bold: true, color: C.white, valign: 'middle', margin: mg(0, 8, 0, 10) });
    text(s, t('elements').toUpperCase(), { x: x + 0.12, y: BY + 0.5, w: cw - 0.24, h: 0.24, fontSize: 8, bold: true, color: C.grey, charSpacing: 1 });
    const els = (p.elements || []) as Puce[];
    if (els.length) text(s, bulletRuns(els, { ...BASE, fontSize: estimateLines(els, cw - 0.3, 9.5) > 6 ? 8.5 : 9.5 }, 1), { x: x + 0.1, y: BY + 0.74, w: cw - 0.2, h: 1.15 });
    text(s, t('outils_l').toUpperCase(), { x: x + 0.12, y: BY + 1.92, w: cw - 0.24, h: 0.24, fontSize: 8, bold: true, color: C.grey, charSpacing: 1 });
    const tools = (p.outils || []).map(o => M.omap[o]).filter(Boolean), tw = Math.min(1.6, (cw - 0.24) / Math.max(1, Math.min(tools.length, 3)));
    tools.slice(0, 6).forEach((o, k) => toolChip(s, o, x + 0.12 + (k % 3) * tw, BY + 2.2 + Math.floor(k / 3) * 0.3, tw));
    if (tools.length > 6) warn.push(`S2 : ${tools.length - 6} outil(s) non affiché(s) pour le pilier « ${tx(p.libelle)} ».`);
  });
  if (ps.length > 4) warn.push(`S2 : ${ps.length - 4} pilier(s) au-delà de 4 non affiché(s).`);
  let y = BY + ch + 0.12;
  if (a.methode === 'externe') { text(s, [{ text: '⚠ ', options: { ...BASE, fontSize: 9.5, bold: true, color: C.part } }, { text: t('mention_ext'), options: { ...BASE, fontSize: 9.5, color: C.part } }], { x: MX, y, w: CW, h: 0.28 }); y += 0.32; }
  text(s, t('acces_titre'), { x: MX, y, w: CW, h: 0.3, fontSize: 12, bold: true, color: C.navy });
  y += 0.32;
  const rows = M.acces;
  if (!rows.length) { text(s, '✓ ' + t('acces_none'), { x: MX, y, w: CW, h: 0.3, fontSize: 11, bold: true, color: C.ok }); return; }
  const max = Math.max(1, Math.floor((BB - y - 0.32) / 0.34)), shown = rows.slice(0, max);
  const cell = (v: any, o: Record<string, any> = {}) => ({ text: v, options: { fontFace: FONT, fontSize: 9, color: C.text, valign: 'middle', ...o } });
  const head = [t('acces_outil'), t('acces_demande'), t('acces_criteres'), t('acces_contact'), t('acces_statut')].map(h => cell(h, { bold: true, color: C.white, fill: { color: C.navy } }));
  const body = shown.map((r, i) => {
    const rq = RQ[r.statut_demande] || RQ.a_demander, zebra = i % 2 ? { fill: { color: 'F7F8FC' } } : {};
    const dem: Run[] = [{ text: r.acces, options: { fontFace: FONT, fontSize: 9, color: C.text, breakLine: !!r.motif } }];
    if (r.motif) dem.push({ text: r.motif, options: { fontFace: FONT, fontSize: 8, color: C.grey } });
    return [
      cell(r.outil?.libelle || r.outil_id, { bold: true, ...zebra }),
      cell(dem, zebra),
      cell(r.criteres.map(k => k.id_grille).join(', ') || '—', { fontFace: MONO, fontSize: 8, ...zebra }),
      cell(r.interlocuteur || '—', zebra),
      cell(t(r.statut_demande), { bold: true, color: rq.fg, fill: { color: rq.bg }, align: 'center' }),
    ];
  });
  s.addTable([head, ...body], { x: MX, y, w: CW, colW: [2.0, 4.3, 2.6, 1.9, 1.53], rowH: 0.3, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [0.03, 0.06, 0.03, 0.06] });
  if (rows.length > shown.length) {
    text(s, `+ ${rows.length - shown.length} ${getLang() === 'fr' ? 'autres demandes d’accès' : 'more access requests'}`, { x: MX, y: BB - 0.28, w: CW, h: 0.26, fontSize: 9, italic: true, color: C.grey });
    warn.push(`S2 : ${rows.length - shown.length} ligne(s) du tableau des accès non affichée(s).`);
  }
}

/* ===================== S3 Scorecard ===================== */
function actionRow(s: Slide, c: MConstat, x: number, y: number, w: number, h: number, fs = 9.5, rankFill = C.navy) {
  mark(s, x + 0.16, y + h / 2, c.rang, rankFill, 0.28, 8.5);
  const bw = 1.0, tb = typeBadge(c);
  text(s, trunc(plain(c.titre_action), 110), { x: x + 0.36, y, w: w - 0.42 - bw - 0.05, h, fontSize: fs, color: C.text, valign: 'middle', margin: mg(0, 2, 0, 2) });
  badge(s, x + w - bw, y + h / 2 - 0.2, bw, 0.19, tb.label, tb.fill, tb.color, tb.line, 7);
  text(s, `● ${t(c.criticite)}`, { x: x + w - bw, y: y + h / 2 + 0.01, w: bw, h: 0.19, fontSize: 7.5, bold: true, color: critColor[c.criticite] || C.grey, align: 'center', valign: 'middle', margin: 0 });
}
function top5(s: Slide, M: Model, x: number, y: number, w: number, h: number) {
  text(s, t('top5'), { x, y, w, h: 0.3, fontSize: 12, bold: true, color: C.navy });
  const l = visibles(M).slice(0, 5), rh = Math.min(0.5, (h - 0.35) / 5);
  l.forEach((c, i) => {
    actionRow(s, c, x, y + 0.36 + i * rh, w, rh - 0.04, 9.5, pilHex(M, c.pilier_id));
    if (i < l.length - 1) rect(s, x + 0.36, y + 0.36 + (i + 1) * rh - 0.02, w - 0.36, 0.005, C.line);
  });
}
function crossTable(s: Slide, M: Model, x: number, y: number, w: number) {
  const rows = ['OK', 'PARTIEL', 'KO'], cols = ['HAUTE', 'MOYENNE', 'FAIBLE'], X = M.cross;
  const cell = (v: any, o: Record<string, any> = {}) => ({ text: String(v), options: { fontFace: FONT, fontSize: 10, color: C.text, align: 'center', valign: 'middle', ...o } });
  const head = [cell(''), ...cols.map(k => cell(t(k), { bold: true, color: critColor[k] })), cell(t('total'), { bold: true, color: C.navy })];
  const body = rows.map(st => {
    const sc = statusColor[st];
    return [cell(t(st), { bold: true, color: sc.fg, fill: { color: sc.bg }, align: 'left' }), ...cols.map(k => cell(X[st][k])), cell(cols.reduce((a, k) => a + X[st][k], 0), { bold: true })];
  });
  const tot = [cell(t('total'), { bold: true, color: C.navy, align: 'left', fill: { color: C.soft } }), ...cols.map(k => cell(rows.reduce((a, st) => a + X[st][k], 0), { bold: true, fill: { color: C.soft } })),
    cell(rows.reduce((a, st) => a + cols.reduce((b, k) => b + X[st][k], 0), 0), { bold: true, color: C.navy, fill: { color: C.soft } })];
  const fw = w / 5;
  s.addTable([head, ...body, tot], { x, y, w, colW: [fw * 1.4, fw * 0.9, fw * 0.9, fw * 0.9, fw * 0.9], rowH: 0.32, border: { type: 'solid', pt: 0.5, color: C.line }, margin: [0.02, 0.06, 0.02, 0.06] });
}
function coverageRuns(M: Model): Run[] {
  const c = M.cov, items: [number, string][] = [[c.evalues, t('evalues')], [c.informatif, t('informatif')], [c.NA, t('NA')], [c.INCONNU, t('INCONNU')], [c.A_REVOIR, t('A_REVOIR')]];
  return items.flatMap(([n, l], i) => [{ text: String(n) + ' ', options: { ...BASE, fontSize: 9, bold: true, color: C.navy } }, { text: l + (i < items.length - 1 ? '   ' : ''), options: { ...BASE, fontSize: 9, color: C.grey } }]);
}
function ring(s: Slide, v: number | null, x: number, y: number, d: number, label: string) {
  const b = band(v), p = v == null ? 0 : Math.max(0, Math.min(1, v / 100));
  s.addShape('blockArc', { x, y, w: d, h: d, angleRange: [180, 0], arcThicknessRatio: 0.22, fill: { color: 'E4E7F0' }, line: { type: 'none' } });
  if (p > 0.005) s.addShape('blockArc', { x, y, w: d, h: d, angleRange: [180, p >= 0.999 ? 359.9 : 180 + 180 * p], arcThicknessRatio: 0.22, fill: { color: bandColor[b] }, line: { type: 'none' } });
  text(s, [{ text: v == null ? '–' : String(v), options: { ...BASE, fontSize: 34, bold: true, color: C.navy } }, { text: ' / 100', options: { ...BASE, fontSize: 11, color: C.grey } }],
    { x, y: y + d / 2 - 0.62, w: d, h: 0.6, align: 'center', valign: 'bottom', margin: 0 });
  text(s, [{ text: label + '  ', options: { ...BASE, fontSize: 11, bold: true, color: C.navy } }, { text: t(b), options: { ...BASE, fontSize: 10, bold: true, color: bandColor[b] } }],
    { x: x - 0.3, y: y + d / 2 + 0.05, w: d + 0.6, h: 0.3, align: 'center', margin: 0 });
}
function sS3(s: Slide, M: Model) {
  const r = R(M), SC = M.scores;
  if (r.masquer_scores) {
    header(s, t('S3b'), clientOf(M));
    rect(s, MX, BY, 5.9, 4.6, C.soft); rect(s, MX, BY, 0.06, 4.6, C.red);
    text(s, runs(r.resume_qualitatif, { ...BASE, fontSize: 14, color: C.navy }), { x: MX + 0.25, y: BY + 0.2, w: 5.45, h: 3.7, lineSpacingMultiple: 1.15 });
    text(s, t('hidden_note'), { x: MX + 0.25, y: BY + 4.05, w: 5.45, h: 0.35, fontSize: 9, italic: true, color: C.grey });
    top5(s, M, 6.9, BY, W - MX - 6.9, 4.6);
    return;
  }
  header(s, t('S3'), `${t('score_global')}${sep()}${SC.global ?? '–'} / 100`);
  ring(s, SC.global, 0.95, BY + 0.15, 3.0, t('score_global'));
  text(s, coverageRuns(M), { x: MX, y: BY + 2.15, w: 4.0, h: 0.5, align: 'center' });
  const byAxe = (r.jauges || 'pilier') === 'axe';
  const items: { label: string; v: number | null; col: string }[] = byAxe
    ? AXES.map(k => ({ label: t(k), v: SC.axes[k], col: C.navy }))
    : M.piliers.map((p, i) => ({ label: tx(p.libelle), v: SC.pil[p.id], col: PIL[i % 4] }));
  const gx = 4.9, gw = W - MX - gx;
  text(s, byAxe ? t('by_axe') : t('by_pilier'), { x: gx, y: BY, w: gw, h: 0.3, fontSize: 12, bold: true, color: C.navy });
  const rh = Math.min(0.6, 2.3 / Math.max(1, items.length));
  items.forEach((it, i) => {
    const y = BY + 0.4 + i * rh, b = band(it.v), tw = gw - 2.6 - 1.3;
    rect(s, gx, y + rh / 2 - 0.09, 0.18, 0.18, it.col);
    text(s, it.label, { x: gx + 0.25, y, w: 2.3, h: rh, fontSize: 11, bold: true, color: C.text, valign: 'middle' });
    rrect(s, gx + 2.6, y + rh / 2 - 0.09, tw, 0.18, 'E4E7F0', undefined, 0.09);
    if (it.v) rrect(s, gx + 2.6, y + rh / 2 - 0.09, Math.max(0.18, tw * it.v / 100), 0.18, bandColor[b], undefined, 0.09);
    text(s, [{ text: it.v == null ? '–' : String(it.v), options: { ...BASE, fontSize: 16, bold: true, color: C.navy } }, { text: '  ' + t(b), options: { ...BASE, fontSize: 9, bold: true, color: bandColor[b] } }],
      { x: gx + 2.7 + tw, y, w: 1.2, h: rh, valign: 'middle', margin: 0 });
  });
  const ty = 4.15;
  text(s, t('cross'), { x: MX, y: ty, w: 5.9, h: 0.3, fontSize: 12, bold: true, color: C.navy });
  crossTable(s, M, MX, ty + 0.36, 5.9);
  top5(s, M, 6.9, ty, W - MX - 6.9, BB - ty);
}

/* ===================== S4 Aperçu priorisé ===================== */
function sS4(s: Slide, M: Model, warn: string[]) {
  const l = visibles(M), ps = M.piliers, n = Math.max(1, ps.length), gap = 0.2, cw = (CW - (n - 1) * gap) / n, lim = 9;
  header(s, t('S4'), `${l.length} ${getLang() === 'fr' ? 'actions recommandées' : 'recommended actions'}`);
  const top = BY + 0.5, rh = Math.min(0.52, (BB - 0.35 - top) / lim);
  ps.forEach((p, i) => {
    const x = MX + i * (cw + gap), col = PIL[i % 4], items = l.filter(c => c.pilier_id === p.id);
    s.addText([{ text: tx(p.libelle), options: { bold: true } }, { text: `   ${items.length}`, options: { fontSize: 10 } }],
      { shape: 'rect', x, y: BY, w: cw, h: 0.42, fill: { color: col }, line: { type: 'none' }, fontFace: FONT, fontSize: 13, color: C.white, valign: 'middle', margin: mg(0, 8, 0, 10) });
    if (!items.length) text(s, t('no_fiche'), { x, y: top, w: cw, h: 0.3, fontSize: 9.5, italic: true, color: C.grey });
    items.slice(0, lim).forEach((c, k) => {
      const y = top + k * rh;
      actionRow(s, c, x, y, cw, rh - 0.05, n > 2 ? 8.5 : 9.5, col);
      rect(s, x + 0.36, y + rh - 0.03, cw - 0.36, 0.005, C.line);
    });
    if (items.length > lim) {
      text(s, `+ ${items.length - lim} ${t('more')}`, { x, y: top + lim * rh + 0.02, w: cw, h: 0.28, fontSize: 9, italic: true, color: C.grey });
      warn.push(`S4 : pilier « ${tx(p.libelle)} » limité à ${lim} actions (${items.length - lim} renvoyées vers l'annexe).`);
    }
  });
}

/* ===================== S5 Fiche constat ===================== */
export function annotationsOf(p: Preuve): Annotation[] {
  const a = (p.annotations || []) as any[];
  return a.map((x, i) => (typeof x === 'number' ? { num: i + 1, statut: 'INFO', texte: '', cible: { ligne: x } } : x));
}
const isImgPath = (f?: string) => !!f && (/^data:image\//.test(f) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f));
const hostOf = (u?: string) => { try { return new URL(u!).hostname.replace(/^www\./, '').toUpperCase(); } catch { return '[SITE CLIENT]'; } };

/** Rectangles natifs des annotations de type zone (coordonnées en % de la capture) + pastilles numérotées. */
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : NaN);
function zones(s: Slide, anns: Annotation[], f: { x: number; y: number; w: number; h: number }, warn: string[], cid: string) {
  anns.forEach(a => {
    const z = a.cible?.zone, sc = statusColor[a.statut] || statusColor.INFO;
    if (!z) return;
    let r = f;
    if (z !== 'page') {
      // coordonnées en % de la capture, ramenées dans [0, 100] ; zone illisible → ignorée et signalée
      const zx = pct(z.x), zy = pct(z.y), zw = Math.min(pct(z.w), 100 - zx), zh = Math.min(pct(z.h), 100 - zy);
      if (![zx, zy, zw, zh].every(Number.isFinite) || zw <= 0 || zh <= 0) { warn.push(`Fiche ${cid} : zone de l'annotation ${a.num} invalide (x, y, w, h en % attendus), non tracée.`); return; }
      r = { x: f.x + (f.w * zx) / 100, y: f.y + (f.h * zy) / 100, w: (f.w * zw) / 100, h: (f.h * zh) / 100 };
    }
    s.addShape('rect', { ...r, fill: { color: sc.fg, transparency: 88 }, line: { color: sc.fg, width: 2 } });
    mark(s, r.x + 0.02, r.y + 0.02, a.num, sc.fg);
  });
}
/** Panneau DevTools (Network / Console) ou contenu texte en tableau natif, lignes annotées surlignées. */
function panelTable(s: Slide, p: Preuve, anns: Annotation[], x: number, y: number, w: number, h: number, warn: string[], cid: string) {
  const pn = p.panneau, byLine: Record<number, Annotation> = {};
  anns.forEach(a => { if (a.cible?.ligne) byLine[a.cible.ligne] = a; });
  const tabs = ['Elements', 'Console', 'Sources', 'Network', 'Application'], on = pn ? pn.onglet : 'Console';
  rect(s, x, y, w, 0.26, 'F1F3F4', C.line);
  text(s, [...tabs.map(tb => ({ text: tb + '   ', options: { ...BASE, fontSize: 8, bold: tb === on, color: tb === on ? C.navy : C.grey, underline: tb === on ? { style: 'sng' } : undefined } })),
    ...(pn?.filtre ? [{ text: `${getLang() === 'fr' ? 'Filtre' : 'Filter'}${sep()}${pn.filtre}`, options: { ...BASE, fontFace: MONO, fontSize: 7.5, color: C.grey } }] : [])],
    { x: x + 0.05, y, w: w - 0.1, h: 0.26, valign: 'middle', margin: 0, fit: 'shrink' });
  const payload = pn?.payload ? 0.26 : 0;
  const rowH = 0.22, maxRows = Math.max(1, Math.floor((h - 0.3 - payload) / rowH) - (pn?.onglet === 'Network' ? 1 : 0));
  const mono = { fontFace: MONO, fontSize: 7.5, color: C.text, valign: 'middle' as const };
  // caractères tenant sur une ligne d'une colonne monospace (Consolas : 0,55 em), marges de cellule déduites
  const fitChars = (colW: number) => Math.max(4, Math.floor(((colW - 0.1) * 72) / (7.5 * 0.55)));
  const markCell = (a?: Annotation) => a ? { text: String(a.num), options: { ...mono, fontFace: FONT, bold: true, color: C.white, align: 'center', fill: { color: (statusColor[a.statut] || statusColor.INFO).fg } } } : { text: '', options: mono };
  const rowFill = (a?: Annotation, hl?: boolean) => (a ? { fill: { color: (statusColor[a.statut] || statusColor.INFO).bg }, bold: true } : hl ? { fill: { color: C.soft } } : {});
  let rows: any[][], colW: number[];
  let total: number;
  if (pn && pn.onglet === 'Network') {
    const L = pn.lignes as LigneReseau[]; total = L.length;
    const head = ['', 'Name', 'Type', 'Status', 'Domain'].map(v => ({ text: v, options: { ...mono, fontFace: FONT, bold: true, color: C.grey, fill: { color: 'F7F8FA' } } }));
    colW = [0.28, w - 0.28 - 0.7 - 0.55 - 1.75, 0.7, 0.55, 1.75];
    rows = [head, ...L.slice(0, maxRows).map((l, i) => {
      const a = byLine[i + 1], f = rowFill(a);
      return [markCell(a), ...[l.nom, l.type, l.statut, l.domaine].map((v, k) => ({ text: trunc(String(v ?? ''), fitChars(colW[k + 1])), options: { ...mono, ...f } }))];
    })];
  } else {
    const L: string[] = pn ? (pn.lignes as LigneConsole[]).map(l => l.texte) : String(p.contenu || '').split('\n');
    const hl = new Set(p.lignes_surlignees || []); total = L.length;
    colW = [0.28, w - 0.28];
    rows = L.slice(0, maxRows).map((l, i) => { const a = byLine[i + 1], f = rowFill(a, !pn && hl.has(i + 1)); return [markCell(a), { text: trunc(String(l ?? ''), fitChars(colW[1])) || ' ', options: { ...mono, ...f } }]; });
  }
  s.addTable(rows, { x, y: y + 0.26, w, colW, rowH, border: { type: 'solid', pt: 0.25, color: 'E3E5EA' }, margin: [0.01, 0.04, 0.01, 0.04] });
  const shown = rows.length - (pn?.onglet === 'Network' ? 1 : 0);
  if (total > shown) warn.push(`Fiche ${cid} : ${total - shown} ligne(s) du panneau de preuve non affichée(s).`);
  const lost = anns.filter(a => (a.cible?.ligne || 0) > shown).map(a => a.num);
  if (lost.length) warn.push(`Fiche ${cid} : annotation(s) ${lost.join(', ')} sur des lignes non affichées du panneau.`);
  if (payload) text(s, [{ text: 'Payload › ', options: { ...BASE, fontSize: 7.5, bold: true, color: C.grey } }, { text: trunc(pn!.payload!, fitChars(w - 0.7)), options: { ...BASE, fontFace: MONO, fontSize: 7.5, color: C.text } }],
    { x, y: y + h - payload, w, h: payload, valign: 'middle', fill: { color: 'F7F8FA' } });
}
function proofLegend(anns: Annotation[]): Run[] {
  const list = anns.filter(a => tx(a.texte));
  return list.flatMap((a, i) => {
    const sc = statusColor[a.statut] || statusColor.INFO, lab = a.statut === 'PARTIEL' ? t('PARTIEL') : a.statut === 'INFO' ? t('INFO') : a.statut;
    return para([
      { text: `${a.num}  `, options: { ...BASE, fontSize: 8.5, bold: true, color: sc.fg } },
      { text: `${ANN_ICON[a.statut] || ''} ${lab}  `, options: { ...BASE, fontSize: 8.5, bold: true, color: sc.fg } },
      ...runs(a.texte, { ...BASE, fontSize: 8.5 }),
    ], { paraSpaceAfter: 2 }, i === list.length - 1);
  });
}
function drawProof(s: Slide, c: MConstat, x: number, y: number, w: number, h: number, img: Map<string, ImgData | null>, warn: string[]) {
  const ps = c.preuves || [];
  if (!ps.length) { s.addText(t('no_proof'), { shape: 'roundRect', rectRadius: 0.08, x, y, w, h: 1.2, fill: { color: C.soft }, line: { type: 'none' }, fontFace: FONT, fontSize: 11, italic: true, color: C.grey, align: 'center', valign: 'middle' }); return; }
  const p = ps[0], anns = annotationsOf(p);
  const total = ps.filter(q => q.etape).length || ps.length;
  let top = y;
  if (p.etape || ps.length > 1) {
    const hr: Run[] = [];
    if (p.etape) hr.push({ text: `${t('etape')} ${p.etape.numero}/${total}${sep()}`, options: { ...BASE, fontSize: 9, bold: true, color: C.navy } }, ...runs(p.etape.libelle, { ...BASE, fontSize: 9 }));
    if (p.panneau) hr.push({ text: ` · DevTools › ${p.panneau.onglet}`, options: { ...BASE, fontSize: 9, color: C.grey } });
    if (ps.length > 1) hr.push({ text: `  (${t('parcours')}${sep()}${ps.length} ${getLang() === 'fr' ? 'étapes' : 'steps'})`, options: { ...BASE, fontSize: 8.5, italic: true, color: C.grey } });
    text(s, hr, { x, y: top, w, h: 0.42, margin: 0 });
    top += 0.45;
  }
  const leg = proofLegend(anns), nLeg = anns.filter(a => tx(a.texte)).length;
  const legH = nLeg ? Math.min(1.5, 0.24 * nLeg + 0.1) : 0, capH = tx(p.legende) ? 0.26 : 0;
  const ph = y + h - legH - capH - top - 0.05;
  const data = p.fichier && /^data:/.test(p.fichier) ? img.get(p.fichier) : null;
  if (p.fichier && /^data:image\//.test(p.fichier) && !data) warn.push(`Fiche ${c.id} : capture ${(/^data:image\/([\w.+-]+)/.exec(p.fichier)?.[1] || '').replace(/\+xml$/, '').toUpperCase()} non convertible hors navigateur (emplacement texte à la place).`);
  else if (p.fichier && !/^data:/.test(p.fichier) && isImgPath(p.fichier)) warn.push(`Fiche ${c.id} : capture « ${p.fichier} » non embarquée dans l'audit (chemin de fichier), emplacement texte à la place.`);
  const navigateur = p.gabarit === 'navigateur' || !!p.panneau;
  const placeholder = (bx: number, by: number, bw: number, bh: number) =>
    s.addText(`${t('preuve')}${sep()}${p.fichier && !/^data:/.test(p.fichier) ? trunc(p.fichier, 60) : plain(p.legende) || p.id}`, { x: bx, y: by, w: bw, h: bh, fill: { color: 'F7F8FA' }, fontFace: FONT, fontSize: 9, italic: true, color: C.grey, align: 'center', valign: 'middle' });
  if (navigateur) {
    rect(s, x, top, w, ph, C.white, 'C9CDD8');
    rect(s, x, top, w, 0.28, 'E9EBF2');
    ['FF5F57', 'FEBC2E', '28C840'].forEach((col, i) => s.addShape('ellipse', { x: x + 0.1 + i * 0.16, y: top + 0.09, w: 0.1, h: 0.1, fill: { color: col }, line: { type: 'none' } }));
    s.addText(p.page?.url || '', { shape: 'roundRect', rectRadius: 0.05, x: x + 0.6, y: top + 0.04, w: w - 0.7, h: 0.2, fill: { color: C.white }, line: { type: 'none' }, fontFace: FONT, fontSize: 7.5, color: C.grey, valign: 'middle', margin: mg(0, 4, 0, 6) });
    const bodyY = top + 0.28, bodyH = ph - 0.28, hasPanel = !!p.panneau || !!p.contenu;
    const pageH = hasPanel ? (data ? bodyH * 0.55 : Math.min(0.85, bodyH * 0.3)) : bodyH;
    if (data) {
      const f = fit(data.w, data.h, x + 0.02, bodyY + 0.02, w - 0.04, pageH - 0.04);
      s.addImage({ data: data.data, ...f, altText: tx(p.legende) });
      if (!p.annotations_incrustees) zones(s, anns, f, warn, c.id); // déjà dessinées dans la capture : pas de doublon
    } else if (p.page) {
      const pa = anns.find(a => a.cible?.zone === 'page'), sc = pa ? statusColor[pa.statut] || statusColor.INFO : null;
      rect(s, x + 0.02, bodyY + 0.02, w - 0.04, pageH - 0.04, 'FAFBFD', sc ? sc.fg : undefined, sc ? { lw: 2 } : {});
      text(s, [{ text: hostOf(p.page.url), options: { ...BASE, fontSize: 10, bold: true, color: C.navy, breakLine: true } }, { text: p.page.titre || '', options: { ...BASE, fontSize: 8.5, color: C.grey } }],
        { x: x + 0.35, y: bodyY + 0.06, w: w * 0.45, h: pageH - 0.12, valign: 'middle' });
      if (p.page.banniere_cmp) s.addText([{ text: getLang() === 'fr' ? 'Nous respectons votre vie privée' : 'We respect your privacy', options: { bold: true, breakLine: true } }, { text: getLang() === 'fr' ? 'Personnaliser · Tout accepter' : 'Customise · Accept all', options: { fontSize: 7, color: C.grey } }],
        { shape: 'roundRect', rectRadius: 0.04, x: x + w * 0.52, y: bodyY + 0.08, w: w * 0.44, h: Math.max(0.3, pageH - 0.16), fill: { color: C.white }, line: { color: 'C9CDD8', width: 0.75 }, fontFace: FONT, fontSize: 7.5, color: C.text, valign: 'middle', margin: mg(2, 4, 2, 6) });
      if (pa) mark(s, x + 0.16, bodyY + pageH - 0.18, pa.num, sc!.fg);
    } else if (p.fichier && isImgPath(p.fichier)) placeholder(x + 0.02, bodyY + 0.02, w - 0.04, pageH - 0.04);
    if (hasPanel) panelTable(s, p, anns, x + 0.02, bodyY + pageH, w - 0.04, bodyH - pageH - 0.02, warn, c.id);
  } else if (data) {
    const laptop = p.gabarit === 'laptop', bez = laptop ? 0.12 : 0.06, baseH = laptop ? 0.14 : 0;
    const f0 = fit(data.w, data.h, x + bez, top + bez, w - 2 * bez, ph - 2 * bez - baseH);
    if (laptop) { rrect(s, f0.x - bez, f0.y - bez, f0.w + 2 * bez, f0.h + 2 * bez, '2B2F3A', undefined, 0.08); s.addShape('trapezoid', { x: f0.x - bez - 0.3, y: f0.y + f0.h + bez, w: f0.w + 2 * bez + 0.6, h: baseH, fill: { color: 'B8BCC8' }, line: { type: 'none' }, flipV: true }); }
    else rrect(s, f0.x - bez, f0.y - bez, f0.w + 2 * bez, f0.h + 2 * bez, C.white, 'C9CDD8', 0.08);
    s.addImage({ data: data.data, ...f0, altText: tx(p.legende) });
    if (!p.annotations_incrustees) zones(s, anns, f0, warn, c.id);
  } else if (p.contenu) {
    const hl = new Set(p.lignes_surlignees || []), byLine: Record<number, Annotation> = {};
    anns.forEach(a => { if (a.cible?.ligne) byLine[a.cible.ligne] = a; });
    const lines = String(p.contenu).split('\n'), maxL = Math.max(3, Math.floor((ph - 0.2) / 0.17));
    const rs: Run[] = lines.slice(0, maxL).flatMap((l, i) => {
      const a = byLine[i + 1], on = !!a || hl.has(i + 1), last = i === Math.min(lines.length, maxL) - 1;
      const pre: Run[] = a ? [{ text: `(${a.num}) `, options: { fontFace: FONT, fontSize: 8, bold: true, color: (statusColor[a.statut] || statusColor.INFO).fg } }] : [];
      return para([...pre, { text: l || ' ', options: { fontFace: MONO, fontSize: 8, color: on ? C.navy : C.text, bold: on, highlight: on ? (a ? (statusColor[a.statut] || statusColor.INFO).bg : 'FFF2B3') : undefined } }], {}, last);
    });
    if (lines.length > maxL) warn.push(`Fiche ${c.id} : extrait de code tronqué (${lines.length - maxL} ligne(s)).`);
    const frame = p.gabarit === 'laptop' ? '2B2F3A' : 'C9CDD8';
    s.addText(rs, { x, y: top, w, h: ph, fill: { color: 'F7F8FA' }, line: { color: frame, width: p.gabarit === 'laptop' ? 3 : 0.75 }, valign: 'top', margin: mg(6, 8, 6, 8), fontFace: MONO });
  } else placeholder(x, top, w, ph);
  let ly = top + ph + 0.04;
  if (capH) { text(s, [{ text: tx(p.legende), options: { ...BASE, fontSize: 8.5, italic: true, color: C.grey } }, ...(p.origine === 'reconstituee' && navigateur ? [{ text: '  · ' + t('reconstituee'), options: { ...BASE, fontSize: 7.5, color: C.grey } }] : [])], { x, y: ly, w, h: capH, margin: 0 }); ly += capH; }
  if (legH) text(s, leg, { x, y: ly, w, h: legH, margin: mg(2, 0, 0, 0) });
}
function sS5(s: Slide, M: Model, id: string | undefined, img: Map<string, ImgData | null>, warn: string[]) {
  if (id && !M.cmap[id]) warn.push(`Fiche ${id} introuvable dans l'audit : première fiche affichée à la place.`);
  const c = (id && M.cmap[id]) || ficheOrder(M)[0];
  if (!c) { header(s, t('S5'), '—'); text(s, t('no_fiche'), { x: MX, y: BY, w: CW, h: 0.4, color: C.grey }); return; }
  header(s, tx(c.pilier.libelle), plain(c.titre_action));
  const L = String(plain(c.titre_action)).length; if (L > 80) warn.push(`Fiche ${c.id} : titre de ${L} caractères (> 80).`);
  const lx = MX, lw = 5.95, top = BY, bottom = 6.35, blocks = ['situation', 'impact', 'recommandations'] as const;
  const lines = blocks.map(b => estimateLines((c as any)[b], lw - 0.4, 10.5));
  const sum = lines.reduce((a, n) => a + n, 0), fs = sum > 30 ? 8.5 : sum > 22 ? 9.5 : 10.5;
  if (sum > 30) warn.push(`Fiche ${c.id} : contenu dense (${sum} lignes estimées), vérifier la lisibilité.`);
  blocks.forEach(b => { const n = ((c as any)[b] || []).length; if (n > 4) warn.push(`Fiche ${c.id} : ${t(b)} contient ${n} puces (4 max. recommandées).`); });
  const avail = bottom - top - blocks.length * 0.12, weights = lines.map(n => n + 1.6), wsum = weights.reduce((a, n) => a + n, 0);
  let y = top;
  blocks.forEach((b, i) => {
    const bh = Math.max(0.8, (avail * weights[i]) / wsum);
    rect(s, lx, y + 0.04, 0.06, 0.26, C.red);
    text(s, t(b), { x: lx + 0.14, y, w: lw - 0.14, h: 0.34, fontSize: 13, bold: true, color: C.navy, valign: 'middle' });
    const arr = (c as any)[b] as Puce[] | undefined;
    if (arr?.length) text(s, bulletRuns(arr, { ...BASE, fontSize: fs, codeColor: C.navy }, 2), { x: lx + 0.08, y: y + 0.36, w: lw - 0.1, h: bh - 0.38 });
    y += bh + 0.12;
  });
  drawProof(s, c, 6.75, BY, W - MX - 6.75, bottom - BY, img, warn);
  const tb = typeBadge(c);
  rect(s, MX, 6.47, CW, 0.005, C.line);
  text(s, [
    { text: t('criticite') + sep(), options: { ...BASE, fontSize: 9.5, color: C.grey } },
    { text: '● ' + t(c.criticite), options: { ...BASE, fontSize: 9.5, bold: true, color: critColor[c.criticite] || C.grey } },
    { text: '     ' + t('type') + sep(), options: { ...BASE, fontSize: 9.5, color: C.grey } },
    { text: tb.label, options: { ...BASE, fontSize: 9.5, bold: true, color: C.navy } },
    { text: `     ${t('effort')}${sep()}`, options: { ...BASE, fontSize: 9.5, color: C.grey } },
    { text: t('eff_' + c.effort), options: { ...BASE, fontSize: 9.5, bold: true, color: C.navy } },
    { text: `     ${t('criteres_lies')}${sep()}`, options: { ...BASE, fontSize: 9.5, color: C.grey } },
    { text: c.crits.map(k => `${k.id_grille} (${t(k.statut)})`).join(' · ') || '—', options: { ...BASE, fontFace: MONO, fontSize: 8.5, color: C.text } },
  ], { x: MX, y: 6.52, w: CW, h: 0.38, valign: 'middle', margin: 0 });
}

/* ===================== S6 Matrice Impact × Effort ===================== */
function sS6(s: Slide, M: Model) {
  header(s, t('S6'), getLang() === 'fr' ? 'Positionnement des actions' : 'Positioning of actions');
  const x0 = 1.4, x1 = 12.65, y0 = BY, y1 = 6.05, kx = (x1 - x0) / 790, ky = (y1 - y0) / 430;
  const X = (e: number) => x0 + ((e - 0.5) / 3) * (x1 - x0), Y = (i: number) => y0 + ((3.5 - i) / 3) * (y1 - y0);
  const xm = X(1.5), ym = Y(1.5);
  rect(s, x0, y0, xm - x0, ym - y0, 'E2F3E7'); rect(s, xm, y0, x1 - xm, ym - y0, 'FFF0F2');
  rect(s, x0, ym, xm - x0, y1 - ym, 'F3F5F9'); rect(s, xm, ym, x1 - xm, y1 - ym, 'F7F8FA');
  s.addShape('line', { x: x0, y: y1, w: x1 - x0, h: 0, line: { color: C.navy, width: 1.25, endArrowType: 'triangle' } });
  s.addShape('line', { x: x0, y: y0, w: 0, h: y1 - y0, line: { color: C.navy, width: 1.25, beginArrowType: 'triangle' } });
  const ql = (q: string, x: number, y: number, al: 'left' | 'right') =>
    text(s, [{ text: t(q), options: { ...BASE, fontSize: 11, bold: true, color: C.navy, breakLine: true } }, { text: t('Q_' + q), options: { ...BASE, fontSize: 8.5, color: C.grey } }], { x, y, w: 4.2, h: 0.48, align: al, margin: 0 });
  ql('QW', x0 + 0.1, y0 + 0.06, 'left'); ql('LT', x1 - 4.3, y0 + 0.06, 'right');
  ql('DER', x0 + 0.1, y1 - 0.55, 'left'); ql('PEU', x1 - 4.3, y1 - 0.55, 'right');
  ['S', 'M', 'L'].forEach((e, i) => text(s, e, { x: X(i + 1) - 0.3, y: y1 + 0.04, w: 0.6, h: 0.25, fontSize: 10, bold: true, color: C.navy, align: 'center', margin: 0 }));
  ([['faible_i', 1], ['moyen_i', 2], ['fort', 3]] as const).forEach(([k, i]) => text(s, t(k), { x: x0 - 0.95, y: Y(i) - 0.13, w: 0.88, h: 0.26, fontSize: 9, bold: true, color: C.navy, align: 'right', margin: 0 }));
  text(s, t('effort_axis') + ' →', { x: (x0 + x1) / 2 - 1.5, y: y1 + 0.28, w: 3, h: 0.26, fontSize: 10, bold: true, color: C.grey, align: 'center', margin: 0 });
  // zone tournée de 270° : largeur et hauteur exprimées avant rotation, centrées sur l'axe
  text(s, t('impact_axis') + ' →', { x: 0.42 - 0.8, y: (y0 + y1) / 2 - 0.15, w: 1.6, h: 0.3, fontSize: 10, bold: true, color: C.grey, align: 'center', rotate: 270, margin: 0 });
  const l = visibles(M), groups: Record<string, MConstat[]> = {}, EFFX: Record<string, number> = { S: 1, M: 2, L: 3 };
  l.forEach(c => { const k = (EFFX[c.effort] || 2) + '|' + Math.max(1, Math.min(3, Number(c.imp) || 1)); (groups[k] = groups[k] || []).push(c); });
  const lblW = 263 * kx - 0.45;
  Object.values(groups).forEach(g => {
    const sp = Math.min(26, 120 / g.length);
    g.forEach((c, i) => {
      const imp = Math.max(1, Math.min(3, Number(c.imp) || 1)); // surcharge hors bornes : point ramené sur la matrice
      const cx = X(EFFX[c.effort] || 2) - 115 * kx, cy = Y(imp) + ((i - (g.length - 1) / 2) * sp + 10) * ky;
      mark(s, cx, cy, c.rang, pilHex(M, c.pilier_id), 0.26, 8);
      const lbl = plain(tx(c.titre_court) || tx(c.titre_action)), ov = !!(c._ov.effort || c._ov.impact_score != null);
      text(s, trunc(lbl, 42) + (ov ? ' ✎' : ''), { x: cx + 0.17, y: cy - 0.12, w: lblW, h: 0.24, fontSize: 8.5, color: C.text, valign: 'middle', margin: 0 });
    });
  });
  let lx = MX;
  M.piliers.forEach((p, i) => {
    s.addShape('ellipse', { x: lx, y: 6.67, w: 0.16, h: 0.16, fill: { color: PIL[i % 4] }, line: { type: 'none' } });
    const lab = tx(p.libelle); text(s, lab, { x: lx + 0.22, y: 6.6, w: 3, h: 0.3, fontSize: 9.5, color: C.text, valign: 'middle', margin: 0 });
    lx += 0.4 + Math.min(3, 0.09 * lab.length + 0.3);
  });
}

/* ===================== S7 Next steps ===================== */
function sS7(s: Slide, M: Model, warn: string[]) {
  header(s, t('S7'), getLang() === 'fr' ? 'Prochaines étapes' : 'Next steps');
  const l = visibles(M), ps = M.piliers, n = Math.max(1, ps.length), fw = 1.9, pw = (CW - fw) / n;
  const head = [{ text: '', options: { fill: { color: C.white } } }, ...ps.map((p, i) => ({ text: tx(p.libelle), options: { fontFace: FONT, fontSize: 12, bold: true, color: C.white, fill: { color: PIL[i % 4] }, valign: 'middle' } }))];
  const rowItems: number[] = [];
  const row = (ty: 'QuickWin' | 'LongueTraine') => {
    rowItems.push(Math.max(1, ...ps.map(p => l.filter(c => c.pilier_id === p.id && c.type === ty).length)));
    const qw = ty === 'QuickWin';
    return [
      { text: t(ty), options: { fontFace: FONT, fontSize: 12, bold: true, color: qw ? C.white : C.navy, fill: { color: qw ? C.navy : C.soft }, valign: 'middle' } },
      ...ps.map(p => {
        const it = l.filter(c => c.pilier_id === p.id && c.type === ty);
        if (!it.length) return { text: '—', options: { fontFace: FONT, fontSize: 10, color: C.grey, valign: 'top' } };
        const fs = it.length > 6 ? 8.5 : 9.5;
        return { text: it.flatMap((c, k) => para([{ text: plain(c.titre_action), options: { fontFace: FONT, fontSize: fs, color: C.text } }], { bullet: { code: '25A0', indent: 10 }, paraSpaceAfter: 2 }, k === it.length - 1)), options: { valign: 'top' } };
      }),
    ];
  };
  const rows = [head, row('QuickWin'), row('LongueTraine')];
  const rh = rowItems.map(n => Math.max(0.6, n * 0.25 + 0.16));
  const tableBottom = BY + 0.42 + rh[0] + rh[1];
  if (tableBottom > BB) warn.push(`S7 : tableau Quick Wins / Longue traîne trop haut (${rowItems[0] + rowItems[1]} lignes) : il déborde de la slide.`);
  s.addTable(rows, { x: MX, y: BY, w: CW, colW: [fw, ...ps.map(() => pw)], rowH: [0.42, ...rh], border: { type: 'solid', pt: 0.75, color: C.line }, margin: [0.06, 0.08, 0.06, 0.08], fontFace: FONT });
  const r = R(M), rm = M.audit.roadmap;
  if (!r.conclusion) return;
  const ph = rm && rm.phases ? rm.phases[rm.phases.findIndex(p => p.code === rm.phase_courante) + 1] : null;
  const cy = Math.min(5.45, tableBottom + 0.35), ch = Math.min(1.3, BB - cy);
  if (tableBottom + 0.1 > cy) warn.push('S7 : la conclusion chevauche le tableau des actions.');
  const cr: Run[] = runs(r.conclusion, { ...BASE, fontSize: 12, color: C.navy });
  if (ph && s1On(M)) { cr[cr.length - 1].options.breakLine = true; cr.push({ text: `${t('next_phase')}${sep()}`, options: { ...BASE, fontSize: 9.5, color: C.grey } }, { text: `${ph.code} · ${tx(ph.libelle)}`, options: { ...BASE, fontSize: 9.5, bold: true, color: C.navy } }); }
  rect(s, MX, cy, CW, ch, C.soft); rect(s, MX, cy, 0.06, ch, C.red);
  text(s, cr, { x: MX + 0.25, y: cy + 0.08, w: CW - 0.4, h: ch - 0.16, valign: 'middle' });
}

/* ===================== S9 Contacts ===================== */
function sS9(s: Slide, M: Model, warn: string[]) {
  text(s, 'J!', { x: 0.7, y: 0.5, w: 1.2, h: 0.7, fontSize: 34, bold: true, color: C.red, margin: 0 });
  text(s, [{ text: t('merci'), options: { ...BASE, fontSize: 66, bold: true, color: C.white } }, { text: '.', options: { ...BASE, fontSize: 66, bold: true, color: C.red } }], { x: 0.7, y: 1.8, w: 8, h: 1.4, margin: 0 });
  rect(s, 0.7, 3.35, 1.2, 0.07, C.red);
  const cs = R(M).contacts || [], cw = 3.9;
  if (cs.length > 6) warn.push(`S9 : ${cs.length - 6} contact(s) au-delà de 6 non affiché(s).`);
  cs.slice(0, 6).forEach((c, i) => {
    const x = 0.7 + (i % 3) * (cw + 0.2), y = 4.0 + Math.floor(i / 3) * 1.2;
    const rs: Run[] = [{ text: c.nom, options: { ...BASE, fontSize: 14, bold: true, color: C.white, breakLine: true } }];
    if (tx(c.role)) rs.push({ text: tx(c.role), options: { ...BASE, fontSize: 10.5, color: 'C9C8E8', breakLine: !!c.email } });
    if (c.email) rs.push({ text: c.email, options: { ...BASE, fontSize: 10.5, color: C.white, hyperlink: { url: 'mailto:' + c.email } } });
    text(s, rs, { x, y, w: cw, h: 1.05 });
  });
  text(s, `JAKALA x ${clientOf(M)}`, { x: 0.7, y: 6.9, w: 8, h: 0.3, fontSize: 9, color: 'C9C8E8', margin: 0 });
}

/* ===================== Assemblage ===================== */
async function preload(M: Model, slides: SlideRef[]): Promise<Map<string, ImgData | null>> {
  const urls = new Set<string>();
  const a = M.audit;
  if (slides.some(r => r.kind === 'S0')) { if (a.logo) urls.add(a.logo); if (a.image_corporate) urls.add(a.image_corporate); }
  slides.forEach(r => {
    if (r.kind !== 'S5') return;
    const c = (r.constatId && M.cmap[r.constatId]) || ficheOrder(M)[0];
    const f = c?.preuves?.[0]?.fichier;
    if (f && /^data:image\//.test(f)) urls.add(f);
  });
  const out = new Map<string, ImgData | null>();
  await Promise.all([...urls].map(async u => out.set(u, await prepImage(u))));
  return out;
}

/** Numéros de page des parties du sommaire, déduits de la liste de slides réellement générée (sous-ensemble ou ordre personnalisé compris). */
export function pagesOf(M: Model, slides: SlideRef[]): Record<string, number> {
  const pages: Record<string, number> = {};
  const set = (k: string, i: number) => { if (!pages[k]) pages[k] = i + 1; };
  slides.forEach((r, i) => {
    if (r.kind === 'S1' || r.kind === 'S2' || r.kind === 'S3' || r.kind === 'S6') set(r.kind, i);
    else if (r.kind === 'S5') { const c = (r.constatId && M.cmap[r.constatId]) || ficheOrder(M)[0]; if (c) set('P:' + c.pilier_id, i); }
  });
  return pages;
}
/** Toute chaîne transmise à pptxgenjs passe par xmlClean (caractères interdits en XML retirés). */
function guard(s: Slide): Slide {
  const addText = s.addText.bind(s), addTable = s.addTable.bind(s), addImage = s.addImage.bind(s);
  s.addText = (v: any, o: any) => addText(xmlClean(v), xmlClean(o));
  s.addTable = (rows: any, o: any) => addTable(xmlClean(rows), o);
  s.addImage = (o: any) => addImage(xmlClean(o));
  return s;
}

async function buildDeck(M: Model, opts: PptxOptions): Promise<any> {
  const warn = opts.warnings || [];
  const slides = opts.slides?.length ? opts.slides : deckPlan(M);
  // Images préparées AVANT de changer de langue : la suite est synchrone, l'interface ne peut pas se rendre
  // dans la langue du deck pendant la génération.
  const img = await preload(M, slides);
  const pages = pagesOf(M, slides);
  const prev = getLang();
  setLang(opts.lang);
  try {
    const Ctor: any = (PptxGenJS as any).default || PptxGenJS;
    const pptx = new Ctor();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'JAKALA'; pptx.company = 'JAKALA';
    pptx.title = xmlSafe(`${tx(M.audit.titre) || t('default_title')} – ${clientOf(M)}`);
    pptx.subject = 'Audit Analytics';
    pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
    defineMasters(pptx, clientOf(M));
    for (const ref of slides) {
      if (!KINDS.has(ref.kind)) { warn.push(`Slide de type « ${String(ref.kind)} » inconnue : ignorée.`); continue; }
      const cover = ref.kind === 'S0' || ref.kind === 'S9';
      const s = guard(pptx.addSlide({ masterName: cover ? 'JAKALA_COVER' : 'JAKALA' }));
      switch (ref.kind) {
        case 'S0': sS0(s, M, img, warn); break;
        case 'S0b': case 'T': sS0b(s, M, ref.pages ? ref : { ...ref, pages }); break;
        case 'S1': sS1(s, M, warn); break;
        case 'S2': sS2(s, M, warn); break;
        case 'S3': sS3(s, M); break;
        case 'S4': sS4(s, M, warn); break;
        case 'S5': sS5(s, M, ref.constatId, img, warn); break;
        case 'S6': sS6(s, M); break;
        case 'S7': sS7(s, M, warn); break;
        case 'S9': sS9(s, M, warn); break;
      }
    }
    return pptx;
  } finally {
    setLang(prev);
  }
}

/** Recompresse (DEFLATE) une archive OOXML produite sans compression. */
export function recompress(raw: Uint8Array): Uint8Array {
  return zipSync(unzipSync(raw), { level: 6 });
}
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** Deck PPTX éditable à la charte JAKALA (navigateur). */
export async function buildPptx(M: Model, opts: PptxOptions): Promise<Blob> {
  const pptx = await buildDeck(M, opts);
  // pptxgenjs 3.12 : write({ compression }) sans outputType passe l'objet entier comme type à JSZip (« f.toLowerCase is
  // not a function ») et seule la sortie 'STREAM' (Buffer Node) est compressée. On récupère donc l'archive non compressée
  // en Uint8Array, puis on la recompresse avec fflate (ordre des entrées conservé : [Content_Types].xml en tête).
  const raw = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array;
  return new Blob([recompress(raw) as BlobPart], { type: PPTX_MIME });
}
/** Même deck en mémoire (Node, tests ou génération serveur). */
export async function buildPptxBuffer(M: Model, opts: PptxOptions): Promise<Uint8Array> {
  const pptx = await buildDeck(M, opts);
  // 'STREAM' = nodebuffer compressé (les autres outputType ignorent l'option de compression).
  const out = await pptx.write({ outputType: 'STREAM', compression: true });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}
