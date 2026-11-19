/** Shell applicatif : topbar, filtres, navigation, présentation, exports, édition. */
import { CRITS, STATUTS } from '../core/rules.ts';
import { clamp, clone, esc, store } from '../core/util.ts';
import { getLang, setLang, t, tx, type Lang } from '../core/i18n.ts';
import { emptyOverrides } from '../core/model.ts';
import { validate, type Report } from '../core/validate.ts';
import type { Audit } from '../core/types.ts';
import { S, emptyFilters, rebuild } from './state.ts';
import * as X from './sections.ts';
import { proofView } from './proof.ts';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const A = () => S.M.audit, R = () => S.M.audit.restitution!;
const keyOv = () => 'aav:ov:' + S.RAW.id, keyFb = () => 'aav:fb:' + S.RAW.id;
let PRISTINE = '';

function loadStores() {
  S.OV = Object.assign(emptyOverrides(), store.get(keyOv(), {}));
  S.FB = store.get(keyFb(), {});
}
const saveOv = () => store.set(keyOv(), S.OV), saveFb = () => store.set(keyFb(), S.FB);
function log(quoi: string) { S.OV.journal.unshift({ d: new Date().toISOString(), qui: 'Consultant', quoi }); S.OV.journal = S.OV.journal.slice(0, 200); saveOv(); }
function setOv(id: string, patch: any) { S.OV.constats[id] = Object.assign({}, S.OV.constats[id], patch); saveOv(); }

/* ===================== Shell ===================== */
function renderTop() {
  const nW = S.REPORT ? S.REPORT.W.length + S.REPORT.E.length : 0, L = getLang();
  $('#topbar').innerHTML = `<button class="tb-btn burger" data-act="burger" aria-label="Menu">☰</button><div class="brand">${X.LOGO}<span class="name">Audit Analytics Viewer</span><span class="client">· ${esc(A().client)}</span>${S.RAW.id.startsWith('AUD-DEMO') ? `<span class="demo-flag">DÉMO</span>` : ''}</div><span class="sp"></span>
  <button class="tb-btn" data-act="lang" aria-label="Langue / Language">${L === 'fr' ? 'FR · <span style="opacity:.6">EN</span>' : '<span style="opacity:.6">FR</span> · EN'}</button>
  <button class="tb-btn" data-act="report" title="${t('report')}">✓ <span class="lbl">${t('report')}</span>${nW ? ` <span class="badge">${nW}</span>` : ''}</button>
  <button class="tb-btn" data-act="edit" aria-pressed="${S.edit}">✎ <span class="lbl">${t('edit')}</span></button>
  ${S.edit ? `<button class="tb-btn" data-act="params">⚙ <span class="lbl">${t('params')}</span></button>` : ''}
  <details class="menu"><summary class="tb-btn">⬇ <span class="lbl">${t('export')}</span></summary><div class="menu-pop">
    <button data-act="artefact">${t('artefact')}<small>${t('artefact_d')}</small></button>
    <button data-act="pdf">PDF 16:9<small>Impression du rendu présentation (navigateur)</small></button>
    <button data-act="csv-all">Plan d’action (CSV)<small>Grille complète + priorité, effort, feedback</small></button>
    <button data-act="json">audit.json édité<small>Contrat 1.1 + surcharges + feedback</small></button>
    <button data-act="import">${t('import')} un audit.json<small>Validation §7.2 avant génération</small></button>
  </div></details>
  <button class="tb-btn primary" data-act="present">▶ <span class="lbl">${t('present')}</span></button>`;
}
function renderFilters() {
  const f: any = S.filters, sel = (k: string, opts: [string, string][], lab: string) => `<label>${lab} <select data-filter="${k}"><option value="">${t('all')}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${f[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const n = Object.values(S.filters).filter(Boolean).length;
  $('#filterbar').innerHTML = `<strong style="font-size:13px;color:var(--navy)">${t('filters')}</strong>` +
    sel('pilier', S.M.piliers.map(p => [p.id, tx(p.libelle)]), t('pilier')) + sel('outil', S.M.outils.map(o => [o, o]), t('outil')) +
    sel('criticite', CRITS.map(k => [k, t(k)]), t('criticite')) + sel('statut', STATUTS.map(s => [s, t(s)]), t('statut')) +
    sel('type', [['QuickWin', t('QuickWin')], ['LongueTraine', t('LongueTraine')]], t('type')) +
    (n ? `<span class="active">${n} ${t('active')}</span><button class="link-btn" data-act="reset-filters">${t('reset')}</button>` : '') +
    (S.edit ? `<span class="editflag">✎ ${t('edit_mode')}</span>` : '');
}
const curFiche = () => { const l = X.ficheList('web'); return S.M.cmap[S.fid!] ? S.fid : l[0] && l[0].id; };
function renderSide() {
  const list = X.ficheList('web');
  let h = '';
  X.SECTIONS.forEach(s => {
    if (s === 'S1' && !X.s1On() && !S.edit) return;
    if (s === 'S0b' && R().sommaire?.actif === false && !S.edit) return;
    const on = S.route === s;
    h += `<button class="nav-item ${on ? 'on' : ''} ${(s === 'S1' && !X.s1On()) || (s === 'S0b' && R().sommaire?.actif === false) ? 'off' : ''}" data-act="nav" data-to="${s}"><span class="num">${s}</span>${s === 'S3' && R().masquer_scores ? t('S3b') : t(s)}</button>`;
    if (s === 'S5') {
      h += '<ul class="nav-sub">';
      S.M.piliers.forEach(p => { const it = list.filter(c => c.pilier_id === p.id); if (!it.length) return; h += `<li class="grp">${esc(tx(p.libelle))}</li>` + it.map(c => `<li><button class="${S.route === 'S5' && curFiche() === c.id ? 'on' : ''} ${c.visible ? '' : 'masked'}" data-act="open" data-id="${esc(c.id)}"><span class="rk">${c.rang}</span>${esc(tx(c.titre_court) || tx(c.titre_action))}</button></li>`).join(''); });
      h += '</ul>';
    }
  });
  h += `<hr style="border:0;border-top:1px solid var(--line);margin:10px 0"><button class="nav-item ${S.route === 'deck' ? 'on' : ''}" data-act="nav" data-to="deck"><span class="num">▤</span>${getLang() === 'fr' ? 'Aperçu du deck' : 'Deck preview'}</button>`;
  $('#sidebar').innerHTML = h;
}
function webPage(sec: X.Sec | null) {
  if (!sec) return '';
  if (sec.full) return `<section class="page full">${sec.body}</section>`;
  return `<section class="page"><header class="band"><div style="flex:1;min-width:0"><div class="sur">${sec.sur}</div><h1>${sec.titre}</h1></div>${X.LOGO}</header><div class="page-body">${sec.body}</div></section>`;
}
function webSection(r: string): X.Sec | null {
  switch (r) {
    case 'S0': return X.S0('web'); case 'S0b': return X.S0b('web', undefined, slidePages()); case 'S1': return X.S1(); case 'S2': return X.S2('web');
    case 'S3': return X.S3('web'); case 'S4': return X.S4('web'); case 'S5': return X.S5('web', S.fid, S.ptab); case 'S6': return X.S6('web');
    case 'S7': return X.S7('web'); case 'S8': return X.S8('web'); case 'S9': return X.S9(); default: return X.S0('web');
  }
}
function renderMain(keepScroll?: boolean) {
  const y = window.scrollY; rebuild();
  if (S.route === 'deck') {
    const sl = buildSlides();
    $('#main').innerHTML = `<div class="deck-head"><h1 style="margin:0;color:var(--navy);font-size:22px">Aperçu du deck · ${sl.length} slides</h1><span><button class="btn" data-act="pdf2">⬇ PDF</button> <button class="btn solid" data-act="present">▶ ${t('present')}</button></span></div>` + sl.map((x, i) => `<div class="deck-item">${slideHtml(x, i + 1)}</div>`).join('');
    fitDeck(); if (!keepScroll) window.scrollTo(0, 0); return;
  }
  $('#main').innerHTML = webPage(webSection(S.route));
  window.scrollTo(0, keepScroll ? y : 0);
  if (S.route === 'S6') bindMatrix();
}
function fitDeck() { document.querySelectorAll<HTMLElement>('.deck-item').forEach(d => { const st = d.querySelector<HTMLElement>('.stage'); if (st) st.style.transform = `scale(${d.clientWidth / 1280})`; }); }
export function render(keepScroll?: boolean) {
  rebuild(); document.documentElement.lang = getLang();
  renderTop(); renderFilters(); renderSide(); renderMain(keepScroll);
}

/* ===================== Routage ===================== */
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1)); const [r, id] = h.split('/');
  S.route = X.SECTIONS.includes(r) || r === 'deck' ? r : 'S0'; S.fid = id || null; S.ptab = 0;
}
function go(r: string) { if (location.hash === '#' + r) { parseHash(); render(); } else location.hash = r; $('#sidebar').classList.remove('open'); }

/* ===================== Matrice : glisser-déposer (édition) ===================== */
function bindMatrix() {
  const svg = $<SVGSVGElement>('#matrix'); if (!svg || !S.edit) return;
  const pt = (e: PointerEvent) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM()!.inverse()); };
  let d: any = null;
  svg.addEventListener('pointerdown', e => { const g = (e.target as Element).closest('.pt') as SVGGElement; if (!g) return; d = { g, id: g.dataset.id, moved: false }; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (!d) return; const p = pt(e); d.p = p; d.moved = true; d.g.setAttribute('transform', `translate(${p.x} ${p.y})`); });
  svg.addEventListener('pointerup', () => {
    if (!d) return; const x = d; d = null;
    if (!x.moved) { go('S5/' + x.id); return; }
    const eff = ['S', 'M', 'L'][clamp(Math.round(X.mxE(x.p.x + 115)), 1, 3) - 1], imp = clamp(Math.round(X.mxI(x.p.y)), 1, 3);
    const c = S.M.cmap[x.id]; setOv(x.id, { effort: eff, impact_score: imp });
    log(`${x.id} : position matrice → impact ${imp}, effort ${eff} (avant : ${c.imp}/${c.effort})`);
    toast(`${x.id} : impact ${imp} · effort ${eff}`); render(true);
  });
}

/* ===================== Deck, présentation & PDF ===================== */
interface Slide { key: string; part?: string; sec: X.Sec }
function buildSlides(): Slide[] {
  const out: Slide[] = [{ key: 'S0', sec: X.S0('slide') }];
  const sm = R().sommaire || {}, withAgenda = sm.actif !== false, trans = !!sm.transitions;
  if (withAgenda) out.push({ key: 'S0b', sec: X.S0b('slide') });
  const tr = (part: string) => { if (withAgenda && trans) out.push({ key: 'T:' + part, sec: X.S0b('slide', part) }); };
  if (X.s1On()) { tr('S1'); out.push({ key: 'S1', part: 'S1', sec: X.S1() }); }
  tr('S2'); out.push({ key: 'S2', part: 'S2', sec: X.S2('slide') });
  tr('S3'); out.push({ key: 'S3', part: 'S3', sec: X.S3('slide') }, { key: 'S4', sec: X.S4('slide') });
  const list = X.ficheList('slide');
  S.M.piliers.forEach(p => { const it = list.filter(c => c.pilier_id === p.id); if (!it.length) return; tr('P:' + p.id); it.forEach((c, i) => out.push({ key: 'S5/' + c.id, part: i === 0 ? 'P:' + p.id : undefined, sec: X.S5('slide', c.id) })); });
  tr('S6'); out.push({ key: 'S6', part: 'S6', sec: X.S6('slide') }, { key: 'S7', sec: X.S7('slide') }, { key: 'S9', sec: X.S9() });
  // Numéros de page du sommaire
  const pages: Record<string, number> = {}; out.forEach((s, i) => { if (s.part && !pages[s.part]) pages[s.part] = i + 1; });
  out.forEach(s => { if (s.key === 'S0b' || s.key.startsWith('T:')) s.sec = X.S0b('slide', s.key.startsWith('T:') ? s.key.slice(2) : undefined, pages); });
  return out;
}
function slidePages() { const p: Record<string, number> = {}; buildSlides().forEach((s, i) => { if (s.part && !p[s.part]) p[s.part] = i + 1; }); return p; }
function slideHtml(s: Slide, n: number) {
  const sec = s.sec;
  if (sec.full) return `<div class="stage full is-slide">${sec.body}</div>`;
  return `<div class="stage is-slide"><header class="band"><div><div class="sur">${sec.sur}</div><h1>${sec.titre}</h1></div>${X.LOGO}</header><div class="slide-body">${sec.body}</div><footer class="sfoot"><span>JAKALA x <b>${esc(A().client)}</b></span><span>${n}</span></footer></div>`;
}
let PRES: any = null;
function startPres() {
  const sl = buildSlides(); const cur = S.route === 'S5' ? 'S5/' + curFiche() : S.route;
  let i = sl.findIndex(s => s.key === cur); if (i < 0) i = 0;
  const el = document.createElement('div'); el.id = 'pres'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', t('present'));
  el.innerHTML = `<div class="pres-stage"></div><div class="pres-hud"><button data-act="pp" aria-label="${t('prev')}">‹</button><span class="pres-count"></span><button data-act="pn" aria-label="${t('next')}">›</button><button data-act="px">✕ Échap</button></div>`;
  document.body.appendChild(el); PRES = { sl, i, el, fs: false };
  el.addEventListener('click', e => { if ((e.target as Element).closest('.pres-hud')) return; presGo(e.clientX < innerWidth / 3 ? -1 : 1); });
  showSlide();
  el.requestFullscreen?.().then(() => { if (PRES) PRES.fs = true; }).catch(() => {});
}
function showSlide() { const { sl, i, el } = PRES; el.querySelector('.pres-stage').innerHTML = slideHtml(sl[i], i + 1); el.querySelector('.pres-count').textContent = `${i + 1} / ${sl.length}`; fitPres(); }
function fitPres() { if (!PRES) return; const st = PRES.el.querySelector('.stage'); if (st) st.style.transform = `scale(${Math.min(innerWidth / 1280, innerHeight / 720)})`; }
function presGo(d: number) { if (!PRES) return; PRES.i = clamp(PRES.i + d, 0, PRES.sl.length - 1); showSlide(); }
function exitPres() {
  if (!PRES) return; const key = PRES.sl[PRES.i].key; PRES.el.remove(); const fs = PRES.fs; PRES = null;
  if (fs && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  go(key.startsWith('T:') ? 'S0b' : key);
}
function exportPdf() {
  const sl = buildSlides(), div = document.createElement('div'); div.id = 'print';
  div.innerHTML = sl.map((s, i) => slideHtml(s, i + 1)).join(''); document.body.appendChild(div); document.body.classList.add('printing');
  const done = () => { div.remove(); document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 80);
}

/* ===================== Exports ===================== */
function download(name: string, content: string, type: string) {
  const b = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const slug = () => String(A().client).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
const csv = (rows: unknown[][]) => '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n');
function planRows(crits: any[]) {
  const head = ['id_grille', 'pilier', 'domaine', 'outil', 'category', 'subject', 'axe_score', 'question', 'element_controle', 'statut', 'criticite', 'top_prio', 'commentaire', 'motif_non_evalue', 'acces_requis_id', 'constat_id', 'constat_titre', 'rang', 'impact', 'effort', 'type', 'visible', 'feedback_decision', 'feedback_commentaire', 'statut_correction'];
  const rows: unknown[][] = [head];
  crits.forEach(k => {
    const lk = S.M.linkOf[k.id_grille] || [null];
    lk.forEach((c: any) => { const fb = c ? S.FB[c.id] || {} : {}; rows.push([k.id_grille, tx(S.M.pmap[k.pilier_id]?.libelle), k.domaine, k.outil, k.category, k.subject, k.axe_score, k.question, k.element_controle, t(k.statut), t(k.criticite), k.top_prio ? 'oui' : '', k.commentaire, k.motif_non_evalue || '', k.acces_requis_id || '', c ? c.id : '', c ? tx(c.titre_action) : '', c ? c.rang : '', c ? c.imp : '', c ? c.effort : '', c ? t(c.type) : '', c ? (c.visible ? 'oui' : 'non') : '', fb.decision || '', fb.commentaire || '', c ? t(fb.statut_correction || 'todo') : '']); });
  });
  return rows;
}
function editedAudit(): any {
  const out: any = clone(S.RAW); Object.assign(out, S.OV.audit); out.restitution = clone(S.M.audit.restitution);
  out.constats = S.M.constats.map(c => { const o: any = clone(S.RAW.constats.find(x => x.id === c.id)); ['titre_action', 'situation', 'impact', 'recommandations'].forEach(k => { if ((c._ov as any)[k] !== undefined) o[k] = (c._ov as any)[k]; }); o.visible = c.visible; o.effort = c.effort; o.impact_score = c.imp; o.type = c.type; o.rang = c.rang; if (c._ov.impact_score != null || c._ov.effort) o.surcharge_matrice = true; if (Array.isArray(S.OV.ordre)) o.rang_manuel = true; return o; });
  out.feedback = Object.entries(S.FB).map(([id, f]) => Object.assign({ constat_id: id }, f));
  out.journal = S.OV.journal;
  return out;
}
/** Artefact single-file (EXP-05/09) : la page elle-même, données éditées incluses, en lecture seule. */
function exportArtefact() {
  const json = JSON.stringify(editedAudit()).replace(/</g, '\\u003c');
  const html = PRISTINE
    .replace(/(<script type="application\/json" id="audit-data">)[\s\S]*?(<\/script>)/, (_m, a, b) => `${a}${json}${b}`)
    .replace('<html lang="fr"', '<html lang="fr" data-artefact="1"');
  download(`restitution_${slug()}.html`, html, 'text/html;charset=utf-8');
  toast(`Artefact généré (${Math.round(html.length / 1024)} Ko)`);
}

/* ===================== Modales, panneau, toast ===================== */
function modal(title: string, body: string, foot?: string, cls?: string) {
  closeModal();
  const o = document.createElement('div'); o.className = 'overlay ' + (cls || ''); o.id = 'ovl';
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="x-btn" data-act="close" aria-label="Fermer">×</button></header><div class="mb">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div>`;
  o.addEventListener('click', e => { if (e.target === o) closeModal(); }); document.body.appendChild(o); o.querySelector<HTMLElement>('.x-btn')!.focus();
}
function closeModal() { $('#ovl')?.remove(); $('#drawer')?.remove(); }
const repHtml = (r: Report) => `<div class="rep">${r.I.map(i => `<p>${esc(i)}</p>`).join('')}<h3 class="e">Erreurs bloquantes (${r.E.length})</h3>${r.E.length ? `<ul class="e">${r.E.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Aucune.</p>'}<h3 class="w">Avertissements (${r.W.length})</h3>${r.W.length ? `<ul class="w">${r.W.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Aucun.</p>'}</div>`;
let PENDING: Audit | null = null;
function onFile(f: File) {
  const rd = new FileReader();
  rd.onload = () => {
    let obj: any = null; try { obj = JSON.parse(String(rd.result)); } catch { /* invalide */ }
    const r = obj ? validate(obj) : { E: ['JSON invalide : ' + f.name], W: [], I: [] };
    PENDING = r.E.length ? null : obj;
    modal(`${t('report')} – ${f.name}`, repHtml(r), `<button class="btn" data-act="close">Annuler</button><button class="btn solid" data-act="load" ${r.E.length ? 'disabled' : ''}>Générer la restitution</button>`);
  };
  rd.readAsText(f);
}
const toLines = (arr: any[] | undefined) => (arr || []).map(x => (typeof x === 'object' && x && 'texte' in x ? tx(x.texte) : tx(x))).join('\n');
function drawer() {
  closeModal(); const a = S.M.audit, r = a.restitution!, cd: any = a.cadrage || {};
  const d = document.createElement('aside'); d.className = 'drawer'; d.id = 'drawer'; d.setAttribute('aria-label', t('params'));
  const img = (k: string, label: string) => `<div class="fld">${label}<div style="display:flex;gap:8px;align-items:center;margin-top:4px">${(a as any)[k] ? `<img src="${esc((a as any)[k])}" alt="" style="height:40px;max-width:120px;object-fit:contain;border:1px solid var(--line);border-radius:4px">` : '<span class="muted" style="font-size:12px">Emplacement vide</span>'}<label class="btn" style="cursor:pointer">Choisir…<input type="file" accept="image/*" data-img="${k}" hidden></label>${(a as any)[k] ? `<button class="btn" data-act="img-clear" data-k="${k}">Retirer</button>` : ''}</div></div>`;
  d.innerHTML = `<h2>${t('params')} <button class="x-btn" data-act="close" aria-label="Fermer">×</button></h2>
  <label class="fld">Client<input data-param="audit.client" value="${esc(a.client)}"></label>
  <label class="fld">Titre<input data-param="audit.titre" value="${esc(tx(a.titre))}"></label>
  <label class="fld">Date<input type="month" data-param="audit.date" value="${esc(a.date)}"></label>
  ${img('logo', t('logo_client'))}${img('image_corporate', t('image_corporate'))}
  <label class="fld">Méthode<select data-param="audit.methode"><option value="externe" ${a.methode === 'externe' ? 'selected' : ''}>Analyse externe (sans accès)</option><option value="acces" ${a.methode !== 'externe' ? 'selected' : ''}>Accès aux outils</option></select></label>
  <label class="chk"><input type="checkbox" data-param="restitution.masquer_scores" ${r.masquer_scores ? 'checked' : ''}> Masquer les scores (résumé qualitatif)</label>
  <label class="chk"><input type="checkbox" data-param="restitution.s1_active" ${r.s1_active !== false ? 'checked' : ''}> Afficher S1 Contexte & roadmap</label>
  <label class="chk"><input type="checkbox" data-param="sommaire.actif" ${r.sommaire?.actif !== false ? 'checked' : ''}> Afficher le sommaire (S0b)</label>
  <label class="chk"><input type="checkbox" data-param="sommaire.transitions" ${r.sommaire?.transitions ? 'checked' : ''}> Slides de transition entre les parties</label>
  <label class="fld">Jauges secondaires<select data-param="restitution.jauges"><option value="pilier" ${r.jauges !== 'axe' ? 'selected' : ''}>Par pilier</option><option value="axe" ${r.jauges === 'axe' ? 'selected' : ''}>Par axe</option></select></label>
  <label class="fld">Règle du score général<select data-param="restitution.regle_score_general"><option value="criticite" ${r.regle_score_general !== 'nb_criteres' ? 'selected' : ''}>Pondérée criticité, tous critères (D2 recommandée)</option><option value="nb_criteres" ${r.regle_score_general === 'nb_criteres' ? 'selected' : ''}>Moyenne des axes pondérée par nb de critères (§8.1)</option></select></label>
  <h2 class="h" style="margin-top:18px">${t('cadrage')} (S1)</h2><p class="note" style="margin-top:0">Une puce par ligne.</p>
  ${['besoin', 'objectifs', 'contraintes', 'livrables'].map(k => `<label class="fld">${t(k)}<textarea data-cadrage="${k}" rows="3">${esc(toLines(cd[k]))}</textarea></label>`).join('')}
  <label class="fld">Introduction S1<textarea data-param="restitution.intro">${esc(tx(r.intro))}</textarea></label>
  <label class="fld">Objectif S2<textarea data-param="restitution.objectif">${esc(tx(r.objectif))}</textarea></label>
  <label class="fld">Résumé qualitatif S3<textarea data-param="restitution.resume_qualitatif">${esc(tx(r.resume_qualitatif))}</textarea></label>
  <label class="fld">Conclusion S7<textarea data-param="restitution.conclusion">${esc(tx(r.conclusion))}</textarea></label>
  <h2 class="h" style="margin-top:18px">Historique des modifications</h2>
  <ul class="journal">${S.OV.journal.length ? S.OV.journal.map(j => `<li><b>${new Date(j.d).toLocaleString('fr-FR')}</b> · ${esc(j.qui)} · ${esc(j.quoi)}</li>`).join('') : '<li class="muted">Aucune modification.</li>'}</ul>
  <p style="margin-top:16px"><button class="btn" data-act="reset-all">Réinitialiser toutes les modifications</button></p>
  <p class="note">Surcharges et feedback stockés dans ce navigateur (localStorage), exportables via « audit.json édité ». Les résultats techniques (statuts, criticités) ne sont pas modifiables.</p>`;
  document.body.appendChild(d);
}
function toast(msg: string) { const o = document.createElement('div'); o.className = 'toast'; o.setAttribute('role', 'status'); o.textContent = msg; document.body.appendChild(o); setTimeout(() => o.remove(), 2200); }

/* ===================== Édition : helpers ===================== */
function getBlock(id: string, b: string) { const o: any = S.OV.constats[id]; return clone(o && o[b] !== undefined ? o[b] : (S.RAW.constats.find(c => c.id === id) as any || {})[b] || []); }
function parseBullet(txt: string) {
  const lines = String(txt).split('\n'); const head: string[] = [], subs: string[] = [];
  lines.forEach(l => { if (/^\s*-\s+/.test(l)) subs.push(l.replace(/^\s*-\s+/, '')); else if (l.trim() || !head.length) head.push(l); });
  const texte = head.join(' ').trim(); return subs.length ? { texte, sous_puces: subs } : texte;
}
function refreshWarn(id: string) { rebuild(); const box = $('#fiche-warn'); if (!box) return; const w = X.ficheWarn(S.M.cmap[id]); box.innerHTML = w.length ? `<ul class="warns">${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; }
function setRestit(k: string, v: unknown) {
  if (k.startsWith('sommaire.')) { const sk = k.split('.')[1]; S.OV.restitution.sommaire = Object.assign({}, R().sommaire, { [sk]: v }); }
  else (S.OV.restitution as any)[k] = v;
}

/* ===================== Actions (délégation) ===================== */
const ACT: Record<string, (el: HTMLElement, e: Event) => void> = {
  nav: el => go(el.dataset.to!),
  open: el => { if (el.dataset.id) go('S5/' + el.dataset.id); },
  burger: () => $('#sidebar').classList.toggle('open'),
  lang: () => { setLang(getLang() === 'fr' ? 'en' : 'fr'); store.set('aav:lang', getLang()); render(true); },
  edit: () => { S.edit = !S.edit; render(true); toast(S.edit ? t('edit_mode') : 'Mode lecture'); },
  params: () => drawer(),
  present: () => startPres(),
  pp: () => presGo(-1), pn: () => presGo(1), px: () => exitPres(),
  pdf: el => { (el.closest('details') as HTMLDetailsElement).open = false; exportPdf(); },
  pdf2: () => exportPdf(),
  artefact: el => { (el.closest('details') as HTMLDetailsElement).open = false; exportArtefact(); },
  'csv-all': el => { (el.closest('details') as HTMLDetailsElement).open = false; download(`plan_action_${slug()}.csv`, csv(planRows(S.M.crits)), 'text/csv;charset=utf-8'); },
  'csv-s8': () => download(`grille_filtree_${slug()}.csv`, csv(planRows(X.s8Rows())), 'text/csv;charset=utf-8'),
  json: el => { (el.closest('details') as HTMLDetailsElement).open = false; download(`audit_${slug()}_edite.json`, JSON.stringify(editedAudit(), null, 2), 'application/json'); },
  import: el => { (el.closest('details') as HTMLDetailsElement).open = false; const f = $<HTMLInputElement>('#file'); f.value = ''; f.click(); },
  report: () => modal(t('report') + ' – audit chargé', repHtml(S.REPORT!)),
  close: () => closeModal(),
  load: () => { if (!PENDING) return; S.RAW = PENDING; PENDING = null; S.REPORT = validate(S.RAW); loadStores(); closeModal(); S.filters = emptyFilters(); go('S0'); render(); toast('Audit chargé'); },
  'reset-filters': () => { S.filters = emptyFilters(); render(true); },
  s3view: el => { S.s3view = el.dataset.v!; renderMain(true); },
  sort: el => { const k = el.dataset.k!; if (S.s8.sort === k) S.s8.dir *= -1; else { S.s8.sort = k; S.s8.dir = 1; } $('#s8-table').innerHTML = X.s8Table(); },
  zoom: el => { const c = S.M.cmap[el.dataset.id!]; modal(tx((c.preuves![+el.dataset.i!] || {}).legende) || t('preuve'), `<div style="max-width:1100px;margin:auto">${proofView(c, 'zoom', +el.dataset.i!)}</div>`, '', 'zoom'); },
  ptab: el => { S.ptab = +el.dataset.i!; renderMain(true); },
  fb: el => { const id = el.dataset.id!, cur = S.FB[id] || {}; S.FB[id] = Object.assign({}, cur, { decision: cur.decision === el.dataset.v ? null : el.dataset.v, date: new Date().toISOString(), auteur: 'Consultant' }); saveFb(); renderMain(true); },
  vis: el => { const id = el.dataset.id!, on = (el as HTMLInputElement).checked; setOv(id, { visible: on }); log(`${id} : ${on ? 'affiché' : 'masqué'}`); render(true); },
  'add-b': el => { const { id, b } = el.dataset as any, arr = getBlock(id, b); arr.push(''); setOv(id, { [b]: arr }); log(`${id} : puce ajoutée (${b})`); renderMain(true); const ta = document.querySelectorAll<HTMLElement>(`textarea[data-id="${id}"][data-b="${b}"]`); ta[ta.length - 1]?.focus(); },
  'del-b': el => { const { id, b, i } = el.dataset as any, arr = getBlock(id, b); arr.splice(+i, 1); setOv(id, { [b]: arr }); log(`${id} : puce supprimée (${b})`); renderMain(true); },
  mv: (el, e) => {
    e.stopPropagation(); const id = el.dataset.id!, d = +el.dataset.d!, ids = S.M.constats.map(c => c.id), c = S.M.cmap[id];
    const same = S.M.constats.filter(x => x.pilier_id === c.pilier_id && (x.visible || S.edit)).map(x => x.id), k = same.indexOf(id), other = same[k + d]; if (!other) return;
    const a = ids.indexOf(id), b = ids.indexOf(other); [ids[a], ids[b]] = [ids[b], ids[a]]; S.OV.ordre = ids; saveOv(); log(`${id} : rang manuel ${d < 0 ? '↑' : '↓'}`); render(true);
  },
  'reset-order': () => { S.OV.ordre = null; saveOv(); log('Ordre calculé rétabli'); render(true); },
  'img-clear': el => { (S.OV.audit as any)[el.dataset.k!] = null; saveOv(); log(`${el.dataset.k} retiré`); drawer(); render(true); },
  'reset-all': () => { S.OV = emptyOverrides(); S.FB = {}; store.del(keyOv()); store.del(keyFb()); closeModal(); render(); toast('Modifications réinitialisées'); },
};

function bind() {
  window.addEventListener('hashchange', () => { parseHash(); render(); });
  window.addEventListener('resize', () => { if (S.route === 'deck') fitDeck(); fitPres(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && PRES && PRES.fs) exitPres(); });
  document.addEventListener('click', e => {
    document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach(d => { if (!d.contains(e.target as Node)) d.open = false; });
    const el = (e.target as Element).closest<HTMLElement>('[data-act]'); if (!el || (el as HTMLButtonElement).disabled) return;
    if (PRES && !el.closest('#pres')) return;
    const f = ACT[el.dataset.act!]; if (f) { if (el.tagName === 'BUTTON') e.preventDefault(); f(el, e); }
  });
  document.addEventListener('keydown', e => {
    if (PRES) {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); presGo(1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); presGo(-1); }
      else if (e.key === 'Home') { PRES.i = 0; showSlide(); } else if (e.key === 'End') { PRES.i = PRES.sl.length - 1; showSlide(); }
      else if (e.key === 'Escape') exitPres();
      return;
    }
    if (e.key === 'Escape') closeModal();
    const tg = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && tg.matches('[data-act][role="button"]')) { e.preventDefault(); tg.click(); }
  });
  document.addEventListener('input', e => {
    const el = e.target as HTMLInputElement, ds = el.dataset;
    if (ds.edit === 'titre') setOv(ds.id!, { titre_action: el.value });
    else if (ds.edit === 'bullet') { const arr = getBlock(ds.id!, ds.b!); arr[+ds.i!] = parseBullet(el.value); setOv(ds.id!, { [ds.b!]: arr }); }
    else if (ds.fb) { const cur = S.FB[ds.id!] || {}; S.FB[ds.id!] = Object.assign({}, cur, { [ds.fb]: el.value, date: new Date().toISOString(), auteur: 'Consultant' }); saveFb(); }
    else if (ds.s8 === 'q') { S.s8.q = el.value; $('#s8-table').innerHTML = X.s8Table(); }
    else if (ds.cadrage) { const cd: any = Object.assign({ besoin: [], objectifs: [], contraintes: [], livrables: [] }, A().cadrage); cd[ds.cadrage] = el.value.split('\n').map(s => s.trim()).filter(Boolean); S.OV.audit.cadrage = cd; saveOv(); }
    else if (ds.param && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'month' || !el.type)) { const [g, k] = ds.param.split('.'); if (g === 'audit') (S.OV.audit as any)[k] = el.value; else setRestit(k, el.value); saveOv(); }
  });
  document.addEventListener('change', e => {
    const el = e.target as HTMLInputElement, ds = el.dataset;
    if (ds.filter !== undefined) { (S.filters as any)[ds.filter] = el.value; render(true); }
    else if (ds.edit === 'titre' || ds.edit === 'bullet') { log(`${ds.id} : ${ds.edit === 'titre' ? 'titre-action modifié' : 'puce modifiée (' + ds.b + ')'}`); refreshWarn(ds.id!); renderSide(); }
    else if (ds.edit === 'effort') { setOv(ds.id!, { effort: el.value }); log(`${ds.id} : effort → ${el.value}`); render(true); }
    else if (ds.edit === 'impact') { setOv(ds.id!, { impact_score: el.value ? +el.value : null }); log(`${ds.id} : impact → ${el.value || 'auto'}`); render(true); }
    else if (ds.s8 === 'axe') { S.s8.axe = el.value; $('#s8-table').innerHTML = X.s8Table(); }
    else if (ds.s8 === 'top') { S.s8.top = el.checked; $('#s8-table').innerHTML = X.s8Table(); }
    else if (ds.cadrage) { log(`Cadrage : bloc ${ds.cadrage} modifié`); renderMain(true); }
    else if (ds.img && el.files?.[0]) {
      const f = el.files[0]; if (f.size > 1.5e6) { toast('Image trop lourde (> 1,5 Mo)'); return; }
      const rd = new FileReader(); rd.onload = () => { (S.OV.audit as any)[ds.img!] = String(rd.result); saveOv(); log(`${ds.img} ajouté`); drawer(); render(true); }; rd.readAsDataURL(f);
    }
    else if (ds.param) { const [g, k] = ds.param.split('.'); const v = el.type === 'checkbox' ? el.checked : el.value; if (g === 'audit') (S.OV.audit as any)[k] = v; else setRestit(g === 'sommaire' ? 'sommaire.' + k : k, v); saveOv(); log(`Paramètre ${k} modifié`); if (k === 'jauges') S.s3view = null; rebuild(); renderTop(); renderFilters(); renderSide(); renderMain(true); }
    else if (el.id === 'file' && el.files?.[0]) onFile(el.files[0]);
  });
}

export function start(raw: Audit) {
  PRISTINE = '<!doctype html>\n' + document.documentElement.outerHTML;
  S.artefact = document.documentElement.dataset.artefact === '1';
  if (S.artefact) document.documentElement.classList.add('artefact');
  S.RAW = raw;
  setLang(store.get<Lang>('aav:lang', (raw.langue as Lang) || 'fr'));
  loadStores(); S.REPORT = validate(raw); parseHash(); bind(); render();
}
