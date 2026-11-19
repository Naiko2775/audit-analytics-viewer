/** Écrans S0 → S9 (+ S0b sommaire). Chaque écran rend { sur, titre, body } ou { full, body }. */
import { AXES, CORR, band } from '../core/rules.ts';
import { esc } from '../core/util.ts';
import { bullets, fmtMonth, getLang, md, t, tx } from '../core/i18n.ts';
import type { Outil, Puce } from '../core/types.ts';
import { proofView } from './proof.ts';
import { scoreDeltaBadge } from './compare.ts';
import { S } from './state.ts';

export type Mode = 'web' | 'slide';
export interface Sec { sur?: string; titre?: string; body: string; full?: boolean; key?: string; wide?: boolean }

export const LOGO = '<span class="jlogo" aria-label="JAKALA">J!</span>';
const A = () => S.M.audit, R = () => S.M.audit.restitution!;
export const s1On = () => R().s1_active !== false && !!A().roadmap;
export const stPill = (s: string) => `<span class="pill st-${s}">${t(s)}</span>`;
export const crPill = (k: string) => `<span class="cr cr-${k}">${t(k)}</span>`;
const tyBadge = (c: any) => (c.quadrant === 'QW' || c.quadrant === 'LT') ? `<span class="ty ty-${c.type}">${t(c.type)}</span>` : `<span class="ty ty-other">${t(c.quadrant)}</span>`;
const lead = () => getLang();

export function picto(n: string | undefined, color?: string) {
  const s = `fill="none" stroke="${color || 'currentColor'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  if (n === 'shield') return `<svg viewBox="0 0 24 24" ${s} aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>`;
  if (n === 'terminal') return `<svg viewBox="0 0 24 24" ${s} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/></svg>`;
  if (n === 'user' || n === 'ux') return `<svg viewBox="0 0 24 24" ${s} aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><circle cx="12" cy="9" r="2.2"/><path d="M8.5 14c.8-1.6 2-2.2 3.5-2.2s2.7.6 3.5 2.2M9 20h6M12 16v4"/></svg>`;
  return `<svg viewBox="0 0 24 24" ${s} aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>`;
}
/** Logo d'une solution : image fournie, sinon pastille monogramme (pas de logo éditeur embarqué par défaut, cf. §13.2). */
export function toolLogo(o: Outil | undefined, withName = true) {
  if (!o) return '';
  const mono = o.libelle.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '?';
  const img = o.logo ? `<img src="${esc(o.logo)}" alt="${esc(o.libelle)}">` : `<span class="tlogo" style="background:${esc(o.couleur || 'var(--navy)')}" aria-hidden="true">${esc(mono)}</span>`;
  return `<span class="tool" title="${esc(o.nom_complet || o.libelle)}">${img}${withName ? `<span>${esc(o.libelle)}${o.categorie ? `<small>${esc(o.categorie)}</small>` : ''}</span>` : ''}</span>`;
}
export function gauge(v: number | null, label: string) {
  const b = band(v), c = Math.PI * 40, p = v == null ? 0 : v / 100;
  return `<figure class="gauge g-${b}"><svg viewBox="0 0 100 62" role="img" aria-label="${esc(label)} : ${v == null ? t('na') : v + ' / 100'} (${t(b)})"><path d="M10 52 A40 40 0 0 1 90 52" class="g-track"/><path d="M10 52 A40 40 0 0 1 90 52" class="g-val" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/><text x="50" y="48" class="g-num">${v == null ? '–' : v}</text><text x="50" y="60" class="g-den">/ 100</text></svg><figcaption><b>${esc(label)}</b><span class="lvl lvl-${b}">${t(b)}</span></figcaption></figure>`;
}

/* ---------- Filtres et listes ---------- */
export function fConstat(c: any) {
  const f = S.filters;
  return (!f.pilier || c.pilier_id === f.pilier) && (!f.outil || c.outils.includes(f.outil)) && (!f.criticite || c.criticite === f.criticite) && (!f.statut || c.statut === f.statut) && (!f.type || c.type === f.type);
}
export function fCrit(k: any) {
  const f = S.filters;
  return (!f.pilier || k.pilier_id === f.pilier) && (!f.outil || k.outil === f.outil) && (!f.criticite || k.criticite === f.criticite) && (!f.statut || k.statut === f.statut) && (!f.type || (S.M.linkOf[k.id_grille] || []).some(c => c.type === f.type));
}
export const shown = (mode: string, ignoreFilters?: boolean) => S.M.constats.filter(c => (c.visible || (mode === 'web' && S.edit)) && (ignoreFilters || mode !== 'web' || fConstat(c)));
export const ficheList = (mode: string) => { const l = shown(mode); return S.M.piliers.flatMap(p => l.filter(c => c.pilier_id === p.id)); };

/* ---------- S0 Couverture : emplacements logo client + image corporate (v0.2) ---------- */
export function S0(mode: Mode = 'web'): Sec {
  const a = A(), web = mode === 'web' && !S.artefact;
  const ini = String(a.client || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const hex = a.logo ? `<div class="hex"><img src="${esc(a.logo)}" alt="${esc(a.client)}"></div>`
    : web ? `<div class="hex ph"><span>${t('logo_client')}<small>${t('placeholder_hint')}</small></span></div>` : `<div class="hex">${esc(ini)}</div>`;
  const corp = a.image_corporate ? `<div class="cover-corp"><img src="${esc(a.image_corporate)}" alt=""></div>`
    : `<div class="cover-corp ph">${web ? `<div class="ph-lbl">${t('image_corporate')}<small>${t('placeholder_hint')}</small></div>` : ''}</div>`;
  return { full: true, body: `${corp}<div class="cover-in has-corp">${LOGO}<div class="cover-kicker">${esc(a.client)}</div><h1>${esc(tx(a.titre) || t('default_title'))}</h1><div class="cover-date">${esc(fmtMonth(a.date))}</div>${hex}<div class="cover-accent"></div></div>` };
}

/* ---------- S0b Sommaire (v0.2) ---------- */
export interface Part { key: string; label: string; sub?: string; route: string; page?: number }
export function parts(): Part[] {
  const out: Part[] = [];
  const list = ficheList('slide');
  if (s1On()) out.push({ key: 'S1', label: t('S1'), sub: t('cadrage'), route: 'S1' });
  out.push({ key: 'S2', label: t('S2'), sub: S.M.piliers.map(p => tx(p.libelle)).join(' · '), route: 'S2' });
  out.push({ key: 'S3', label: R().masquer_scores ? t('S3b') : t('S3'), sub: t('S4'), route: 'S3' });
  S.M.piliers.forEach(p => { const n = list.filter(c => c.pilier_id === p.id).length; if (n) out.push({ key: 'P:' + p.id, label: tx(p.libelle), sub: `${t('S5')} · ${n} ${t('fiches')}`, route: 'S5/' + list.find(c => c.pilier_id === p.id)!.id }); });
  out.push({ key: 'S6', label: `${t('S6')} & ${t('S7')}`, route: 'S6' });
  return out;
}
export function S0b(mode: Mode = 'web', current?: string, pages?: Record<string, number>): Sec {
  const ps = parts();
  const li = ps.map((p, i) => `<li class="${mode === 'web' ? 'clk' : ''} ${current === p.key ? 'cur' : ''}" ${mode === 'web' ? `data-act="nav" data-to="${esc(p.route)}"` : ''}><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="l">${esc(p.label)}${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span><span class="p">${pages && pages[p.key] ? `${t('page')} ${pages[p.key]}` : ''}</span></li>`).join('');
  return { sur: t('S0b'), titre: esc(A().client), body: `<ol class="agenda">${li}</ol>` };
}

/* ---------- S1 Contexte & roadmap : cadrage 4 blocs + Gantt ---------- */
function cadrage(): string {
  const cd: any = A().cadrage || {};
  return `<div class="cadrage">${['besoin', 'objectifs', 'contraintes', 'livrables'].map(k => {
    const items: Puce[] = cd[k] || [];
    return `<section><h3>${t(k)}</h3>${items.length ? bullets(items) : `<div class="empty">—</div>`}</section>`;
  }).join('')}</div>`;
}
export function S1(): Sec {
  const rm = A().roadmap || { phases: [], mois: [] as string[] }, mois = rm.mois || [], n = mois.length, ix = (m: string) => Math.max(0, mois.indexOf(m));
  let g = `<div class="gantt" style="grid-template-columns:240px repeat(${n},1fr)"><div class="g-head" style="text-align:left">&nbsp;</div>${mois.map(m => `<div class="g-head">${esc(fmtMonth(m, true))}</div>`).join('')}`;
  rm.phases.forEach(ph => {
    const cur = ph.code === (rm as any).phase_courante;
    g += `<div class="g-phase ${cur ? 'current' : ''}" style="grid-column:1/-1"><span class="code-chip">${esc(ph.code)}</span>${esc(tx(ph.libelle))}${cur ? ` · ${t('en_cours')}` : ''}</div>`;
    (ph.sous_taches || []).forEach(st => {
      const a = ix(st.debut), b = ix(st.fin);
      g += `<div class="g-lbl">${esc(tx(st.libelle))}</div>`;
      for (let i = 0; i < n; i++) { if (i === a) g += `<div class="g-bar ${cur ? 'current' : ''}" style="grid-column:${a + 2}/${b + 3}" title="${esc(st.debut)} → ${esc(st.fin)}"></div>`; else if (i < a || i > b) g += '<div class="g-cell"></div>'; }
    });
  });
  g += '</div>';
  return { sur: t('S1'), titre: 'DIG · HACK · MAKE', body: `${R().intro ? `<p class="lead">${md(R().intro)}</p>` : ''}${cadrage()}${g}` };
}

/* ---------- S2 Périmètre : logos des solutions + accès requis ---------- */
function coverage() { const c = S.M.cov; return `<div class="cov"><span><b>${c.evalues}</b> ${t('evalues')}</span><span><b>${c.informatif}</b> ${t('informatif')}</span><span><b>${c.NA}</b> ${t('NA')}</span><span><b>${c.INCONNU}</b> ${t('INCONNU')}</span><span><b>${c.A_REVOIR}</b> ${t('A_REVOIR')}</span></div>`; }
function accesTable(mode: Mode) {
  const rows = S.M.acces;
  if (!rows.length) return `<div class="acc-box card"><h2 class="h">${t('acces_titre')}</h2><p class="acc-ok">✓ ${t('acces_none')}</p></div>`;
  return `<div class="acc-box"><h2 class="h">${t('acces_titre')}</h2><table class="acc"><thead><tr><th>${t('acces_outil')}</th><th>${t('acces_demande')}</th><th>${t('acces_criteres')}</th><th>${t('acces_contact')}</th><th>${t('acces_statut')}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${toolLogo(r.outil)}</td><td>${esc(r.acces)}${r.motif ? `<br><small class="muted">${esc(r.motif)}</small>` : ''}</td><td>${r.criteres.map(k => `<span class="chip" title="${esc(k.question)}">${esc(k.id_grille)}</span>`).join(' ') || '—'}</td><td>${esc(r.interlocuteur || '—')}</td><td><span class="rq rq-${r.statut_demande}">${t(r.statut_demande)}</span></td></tr>`).join('')}</tbody></table></div>`;
}
export function S2(mode: Mode = 'web'): Sec {
  const a = A(), ps = S.M.piliers;
  const cards = `<div class="pcards" style="grid-template-columns:repeat(${Math.min(ps.length, 4)},1fr)">${ps.map(p => `<article class="pcard"><header style="background:${p._c}">${picto(p.pictogramme, '#fff')}<b>${esc(tx(p.libelle))}</b></header><div class="bd"><h2 class="h">${t('elements')}</h2><ul>${(p.elements || []).map(e => `<li>${md(e)}</li>`).join('')}</ul><h2 class="h">${t('outils_l')}</h2><div class="tools">${(p.outils || []).map(o => toolLogo(S.M.omap[o])).join('')}</div></div></article>`).join('')}</div>`;
  const ctx = mode === 'slide' ? '' : `<div class="ctx"><div class="card"><h2 class="h">${t('ctx')}</h2><ul style="margin:0;padding-left:18px">${(a.methode_detail || []).map(m => `<li>${md(m)}</li>`).join('')}</ul>${a.methode === 'externe' ? `<div class="alert-ext">⚠ ${t('mention_ext')}</div>` : ''}</div><div class="card"><h2 class="h">${t('coverage')}</h2>${coverage()}</div></div>`;
  return { sur: t('S2'), titre: esc(a.client) + ' · ' + ps.map(p => esc(tx(p.libelle))).join(' / '), body: cards + accesTable(mode) + ctx + (R().objectif && mode === 'web' ? `<div class="objective">${md(R().objectif)}</div>` : '') };
}

/* ---------- S3 Scorecard ---------- */
function crossTable() {
  const rows = ['OK', 'PARTIEL', 'KO'], cols = ['HAUTE', 'MOYENNE', 'FAIBLE'], X = S.M.cross;
  let h = `<table class="x"><caption class="sr">${t('cross')}</caption><tr><th class="l"></th>${cols.map(k => `<th>${crPill(k)}</th>`).join('')}<th>${t('total')}</th></tr>`;
  rows.forEach(s => { const tot = cols.reduce((a, k) => a + X[s][k], 0); h += `<tr><td class="l">${stPill(s)}</td>${cols.map(k => `<td>${X[s][k]}</td>`).join('')}<td><b>${tot}</b></td></tr>`; });
  h += `<tr class="tot"><td class="l">${t('total')}</td>${cols.map(k => `<td>${rows.reduce((a, s) => a + X[s][k], 0)}</td>`).join('')}<td>${rows.reduce((a, s) => a + cols.reduce((b, k) => b + X[s][k], 0), 0)}</td></tr></table>`;
  return h;
}
function top5(mode: Mode) {
  const l = shown(mode === 'web' ? 'slide' : mode, true).filter(c => c.visible).slice(0, 5);
  return `<ol class="top5">${l.map(c => `<li ${mode === 'web' ? `data-act="open" data-id="${esc(c.id)}"` : ''}><span class="tt">${esc(tx(c.titre_action))}</span>${crPill(c.criticite)}${tyBadge(c)}</li>`).join('')}</ol>`;
}
export function S3(mode: Mode): Sec {
  const r = R();
  if (r.masquer_scores) return { sur: t('S3b'), titre: esc(A().client), body: `<div class="grid2"><div><p class="lead">${md(r.resume_qualitatif)}</p><p class="note">${t('hidden_note')}</p></div><div><h2 class="h">${t('top5')}</h2>${top5(mode)}</div></div>` };
  const view = S.s3view || r.jauges || 'pilier', SC = S.M.scores;
  const sec = view === 'axe' ? AXES.map(a => gauge(SC.axes[a], t(a))) : S.M.piliers.map(p => gauge(SC.pil[p.id], tx(p.libelle)));
  const seg = mode === 'web' ? `<div class="seg" role="group"><button data-act="s3view" data-v="pilier" aria-pressed="${view === 'pilier'}">${t('by_pilier')}</button><button data-act="s3view" data-v="axe" aria-pressed="${view === 'axe'}">${t('by_axe')}</button></div>` : '';
  const cmp = mode === 'web' ? S.cmp.data : null;
  const delta = cmp ? ` ${scoreDeltaBadge(cmp.scores.global.delta, ` vs ${esc(cmp.prev.date || cmp.prev.id)}`)}` : '';
  return { sur: t('S3'), titre: `${t('score_global')} : ${SC.global ?? '–'} / 100${delta}`, body: `<div class="scorewrap"><div class="gmain">${gauge(SC.global, t('score_global'))}<div style="margin-top:14px">${coverage()}</div></div><div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2 class="h" style="margin:0">${view === 'axe' ? t('by_axe') : t('by_pilier')}</h2>${seg}</div><div class="gauges2">${sec.join('')}</div></div></div><div class="grid2" style="margin-top:20px"><div><h2 class="h">${t('cross')}</h2>${crossTable()}</div><div><h2 class="h">${t('top5')}</h2>${top5(mode)}</div></div>${mode === 'web' ? `<p class="note">${t('scores_note')}</p>` : ''}` };
}

/* ---------- S4 Aperçu priorisé ---------- */
export function S4(mode: Mode): Sec {
  const l = shown(mode), ed = mode === 'web' && S.edit, lim = mode === 'slide' ? 9 : 1e3;
  const cols = S.M.piliers.map(p => {
    const items = l.filter(c => c.pilier_id === p.id);
    const li = items.slice(0, lim).map((c, i) => `<li class="${mode === 'web' ? 'clk' : ''} ${c.visible ? '' : 'masked'}" ${mode === 'web' ? `data-act="open" data-id="${esc(c.id)}"` : ''}>${ed ? `<span class="mv"><button data-act="mv" data-d="-1" data-id="${esc(c.id)}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>▲</button><button data-act="mv" data-d="1" data-id="${esc(c.id)}" aria-label="Descendre" ${i === items.length - 1 ? 'disabled' : ''}>▼</button></span>` : ''}<span class="rk">${c.rang}</span><span class="tt">${esc(tx(c.titre_action))}${c.visible ? '' : ` <small class="muted">(${t('masked').split(' (')[0]})</small>`}</span><span class="meta">${tyBadge(c)}${crPill(c.criticite)}</span></li>`).join('');
    const more = items.length > lim ? `<div class="more">+ ${items.length - lim} ${t('more')}</div>` : '';
    return `<section class="prio-col"><h3 style="background:${p._c}">${picto(p.pictogramme, '#fff')}${esc(tx(p.libelle))}</h3><ul class="prio-list">${li || `<li class="muted">${t('no_fiche')}</li>`}</ul>${more}</section>`;
  });
  const tools = ed && Array.isArray(S.OV.ordre) ? `<p><button class="btn" data-act="reset-order">${t('reset_order')}</button> <span class="ovr">✎ ${t('manual')}</span></p>` : '';
  return { sur: t('S4'), titre: `${l.filter(c => c.visible).length} ${lead() === 'fr' ? 'actions recommandées' : 'recommended actions'}`, body: tools + `<div class="prio" style="grid-template-columns:repeat(${S.M.piliers.length},1fr)">${cols.join('')}</div>` };
}

/* ---------- S5 Fiche constat ---------- */
function blk(c: any, b: string, mode: Mode) {
  const ed = mode === 'web' && S.edit, arr = c[b] || [];
  if (!ed) return `<section class="blk"><h3>${t(b)}</h3>${bullets(arr)}</section>`;
  const toText = (x: any) => (x && typeof x === 'object' && x.texte !== undefined) ? [x.texte, ...(x.sous_puces || []).map((s: string) => '- ' + s)].join('\n') : String(x);
  return `<section class="blk"><h3>${t(b)}${arr.length > 4 ? ' ⚠' : ''}</h3><div class="ed">${arr.map((x: any, i: number) => `<div class="ed-row"><textarea data-edit="bullet" data-id="${esc(c.id)}" data-b="${b}" data-i="${i}" rows="2" aria-label="${t(b)} ${i + 1}">${esc(toText(x))}</textarea><button data-act="del-b" data-id="${esc(c.id)}" data-b="${b}" data-i="${i}" aria-label="Supprimer">✕</button></div>`).join('')}<button class="add-b" data-act="add-b" data-id="${esc(c.id)}" data-b="${b}">${t('add_bullet')}</button></div></section>`;
}
export function ficheWarn(c: any) {
  const w: string[] = [], L = String(tx(c.titre_action) || '').length;
  if (L > 80) w.push(`Titre de ${L} caractères (> 80)`); else if (L > 60) w.push(`Titre de ${L} caractères (60 recommandés)`);
  ['situation', 'impact', 'recommandations'].forEach(b => { const n = (c[b] || []).length; if (n > 4) w.push(`${t(b)} : ${n} puces (4 max. pour la lisibilité slide)`); });
  if (c.criticite === 'HAUTE' && !(c.preuves || []).length) w.push('Constat de criticité Haute sans preuve');
  return w;
}
export function S5(mode: Mode, id?: string | null, ptab = 0): Sec {
  const list = ficheList(mode);
  const c: any = (id && S.M.cmap[id]) || list[0];
  if (!c) return { sur: t('S5'), titre: '—', body: `<p class="muted">${t('no_fiche')}</p>` };
  const idx = list.indexOf(c), ed = mode === 'web' && S.edit, o = c._ov, FB = S.FB;
  const fr = lead() === 'fr';
  const meta = `<dl class="metas"><dt>${t('criticite')}</dt><dd>${crPill(c.criticite)}</dd>
    <dt>${t('impact_score')}</dt><dd>${ed ? `<select data-edit="impact" data-id="${esc(c.id)}"><option value="">${t('auto')} (${t('calc')} : ${c.impact_calc})</option>${[1, 2, 3].map(v => `<option ${o.impact_score === v ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `${c.imp} / 3`}${o.impact_score != null ? ` <span class="ovr">✎ ${t('manual')}</span>` : ''}</dd>
    <dt>${t('effort')}</dt><dd>${ed ? `<select data-edit="effort" data-id="${esc(c.id)}">${['S', 'M', 'L'].map(v => `<option value="${v}" ${c.effort === v ? 'selected' : ''}>${t('eff_' + v)}</option>`).join('')}</select>` : t('eff_' + c.effort)}${c.effort_semaines && !ed ? ` · ${String(c.effort_semaines).replace('.', fr ? ',' : '.')} ${t('weeks')}` : ''}</dd>
    <dt>${t('type')}</dt><dd>${tyBadge(c)} <span class="muted" style="font-size:12px">${t('Q_' + c.quadrant)}</span></dd>
    <dt>${t('outils')}</dt><dd><div class="tools">${[...new Set(c.crits.map((k: any) => k.outil_ref?.id))].map(i => toolLogo(S.M.omap[i as string])).join('')}</div></dd>
    <dt>${t('criteres_lies')}</dt><dd>${c.crits.map((k: any) => `<span class="chip" title="${esc(k.question)}">${esc(k.id_grille)} ${stPill(k.statut)}</span>`).join('')}</dd></dl>`;
  const fb = FB[c.id] || {};
  const fbHtml = mode === 'web' ? `<section class="feedback" aria-label="${t('feedback')}"><h3>${t('feedback')}</h3><div class="fb-row"><button class="fb-btn ok" data-act="fb" data-id="${esc(c.id)}" data-v="OK" aria-pressed="${fb.decision === 'OK'}">✓ OK</button><button class="fb-btn ko" data-act="fb" data-id="${esc(c.id)}" data-v="KO" aria-pressed="${fb.decision === 'KO'}">✗ KO</button><label style="margin-left:auto;font-size:13px">${t('fb_status')} <select data-fb="statut_correction" data-id="${esc(c.id)}">${CORR.map(s => `<option value="${s}" ${(fb.statut_correction || 'todo') === s ? 'selected' : ''}>${t(s)}</option>`).join('')}</select></label></div><textarea data-fb="commentaire" data-id="${esc(c.id)}" placeholder="${t('fb_comment')}">${esc(fb.commentaire || '')}</textarea>${fb.date ? `<small class="muted">${esc(fb.auteur || '')} · ${new Date(fb.date).toLocaleString(fr ? 'fr-FR' : 'en-GB')}</small>` : ''}</section>` : '';
  const warns = ed ? ficheWarn(c) : [];
  const top = (mode === 'web' && !c.visible ? `<div class="maskbar">👁‍🗨 ${t('masked')}</div>` : '') + (ed ? `<label class="chk"><input type="checkbox" data-act="vis" data-id="${esc(c.id)}" ${c.visible ? 'checked' : ''}> ${t('visible')}</label><div id="fiche-warn">${warns.length ? `<ul class="warns">${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>` : '');
  const nav = mode === 'web' ? `<div class="fiche-nav"><button data-act="open" data-id="${idx > 0 ? esc(list[idx - 1].id) : ''}" ${idx > 0 ? '' : 'disabled'}>‹ ${t('prev')}</button><span class="counter">${idx >= 0 ? `${t('fiche')} ${idx + 1} / ${list.length}` : ''}</span><button data-act="open" data-id="${idx >= 0 && idx < list.length - 1 ? esc(list[idx + 1].id) : ''}" ${idx >= 0 && idx < list.length - 1 ? '' : 'disabled'}>${t('next')} ›</button></div>` : '';
  const titre = ed ? `<input data-edit="titre" data-id="${esc(c.id)}" value="${esc(tx(c.titre_action))}" aria-label="Titre-action">` : esc(tx(c.titre_action));
  const wide = (c.preuves || []).some((p: any) => p.gabarit === 'navigateur' || p.panneau);
  const side = mode === 'slide' ? `${proofView(c, 'slide', 0)}` : `${proofView(c, 'web', ptab)}${meta}`;
  const slideMeta = mode === 'slide' ? `<p style="margin:10px 0 0;font-size:12.5px">${crPill(c.criticite)} ${tyBadge(c)} <span class="muted">· ${t('criteres_lies')} : ${c.crits.map((k: any) => esc(k.id_grille)).join(' · ')}</span></p>` : '';
  return { sur: esc(tx(c.pilier.libelle)), titre, key: 'S5/' + c.id, wide, body: `${top}<div class="fiche ${wide ? 'wide' : ''}"><div>${blk(c, 'situation', mode)}${blk(c, 'impact', mode)}${blk(c, 'recommandations', mode)}${slideMeta}</div><div>${side}</div></div>${fbHtml}${nav}` };
}

/* ---------- S6 Matrice ---------- */
export const MX = { x0: 90, x1: 880, y0: 20, y1: 450 };
const EFFX: Record<string, number> = { S: 1, M: 2, L: 3 };
export const mxX = (e: number) => MX.x0 + ((e - 0.5) / 3) * (MX.x1 - MX.x0), mxY = (i: number) => MX.y0 + ((3.5 - i) / 3) * (MX.y1 - MX.y0);
export const mxE = (x: number) => ((x - MX.x0) / (MX.x1 - MX.x0)) * 3 + 0.5, mxI = (y: number) => 3.5 - ((y - MX.y0) / (MX.y1 - MX.y0)) * 3;
export function S6(mode: Mode): Sec {
  const l = shown(mode).filter(c => c.visible || S.edit), ed = mode === 'web' && S.edit;
  const xm = mxX(1.5), ym = mxY(1.5);
  let s = `<svg id="matrix" viewBox="0 0 900 500" role="img" aria-label="${t('S6')}">`;
  s += `<rect class="q" x="${MX.x0}" y="${MX.y0}" width="${xm - MX.x0}" height="${ym - MX.y0}" fill="#e2f3e7"/><rect class="q" x="${xm}" y="${MX.y0}" width="${MX.x1 - xm}" height="${ym - MX.y0}" fill="#fff0f2"/><rect class="q" x="${MX.x0}" y="${ym}" width="${xm - MX.x0}" height="${MX.y1 - ym}" fill="#f3f5f9"/><rect class="q" x="${xm}" y="${ym}" width="${MX.x1 - xm}" height="${MX.y1 - ym}" fill="#f7f8fa"/>`;
  s += `<line x1="${MX.x0}" y1="${MX.y1}" x2="${MX.x1}" y2="${MX.y1}" stroke="#08006B"/><line x1="${MX.x0}" y1="${MX.y0}" x2="${MX.x0}" y2="${MX.y1}" stroke="#08006B"/>`;
  ([['QW', MX.x0 + 8, MX.y0 + 18, 'start'], ['LT', MX.x1 - 8, MX.y0 + 18, 'end'], ['DER', MX.x0 + 8, MX.y1 - 22, 'start'], ['PEU', MX.x1 - 8, MX.y1 - 22, 'end']] as const).forEach(([q, x, y, a]) => { s += `<text class="qlbl" x="${x}" y="${y}" text-anchor="${a}">${t(q)}</text><text class="qsub" x="${x}" y="${y + 15}" text-anchor="${a}">${esc(t('Q_' + q))}</text>`; });
  ['S', 'M', 'L'].forEach((e, i) => { s += `<text class="ax" x="${mxX(i + 1)}" y="${MX.y1 + 20}" text-anchor="middle">${e}</text>`; });
  ([['faible_i', 1], ['moyen_i', 2], ['fort', 3]] as const).forEach(([k, i]) => { s += `<text class="ax" x="${MX.x0 - 10}" y="${mxY(i)}" text-anchor="end" dominant-baseline="central">${t(k)}</text>`; });
  s += `<text class="axt" x="${(MX.x0 + MX.x1) / 2}" y="${MX.y1 + 42}" text-anchor="middle">${t('effort_axis')} →</text><text class="axt" transform="translate(22 ${(MX.y0 + MX.y1) / 2}) rotate(-90)" text-anchor="middle">${t('impact_axis')} →</text>`;
  const groups: Record<string, any[]> = {}; l.forEach(c => { (groups[c.effort + '|' + c.imp] = groups[c.effort + '|' + c.imp] || []).push(c); });
  Object.values(groups).forEach(g => {
    const sp = Math.min(26, 120 / g.length);
    g.forEach((c, i) => {
      const x = mxX(EFFX[c.effort]) - 115, y = mxY(c.imp) + (i - (g.length - 1) / 2) * sp + 10;
      const lbl = String(tx(c.titre_court) || tx(c.titre_action)); const short = lbl.length > 32 ? lbl.slice(0, 31) + '…' : lbl;
      const ov = c._ov.effort || c._ov.impact_score != null;
      const sit = (c.situation || [])[0]; const sitTxt = String(tx(sit && (sit.texte || sit)) || '').replace(/\*\*|`/g, '');
      s += `<g class="pt" data-id="${esc(c.id)}" ${mode === 'web' && !ed ? `data-act="open"` : ''} transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" ${c.visible ? '' : 'opacity=".45"'}><circle r="10" fill="${c.pilier._hex}"/><text class="n">${c.rang}</text><text class="l" x="15">${esc(short)}${ov ? ' ✎' : ''}</text>${mode === 'web' ? `<title>${esc(tx(c.titre_action))} — ${esc(sitTxt)}</title>` : ''}</g>`;
    });
  });
  s += '</svg>';
  const legend = `<div class="legend">${S.M.piliers.map(p => `<span><i style="background:${p._c}"></i>${esc(tx(p.libelle))}</span>`).join('')}</div>`;
  const alt = mode === 'web' ? `<details class="alt"><summary>${t('table_view')}</summary><table class="x" style="margin-top:8px"><tr><th class="l">#</th><th class="l">${t('S5')}</th><th>${t('impact_score')}</th><th>${t('effort')}</th><th>${t('quadrant')}</th></tr>${l.map(c => `<tr><td class="l">${c.rang}</td><td class="l">${esc(tx(c.titre_action))}</td><td>${c.imp}</td><td>${c.effort}</td><td>${t(c.quadrant)}</td></tr>`).join('')}</table></details>` : '';
  return { sur: t('S6'), titre: lead() === 'fr' ? 'Positionnement des actions' : 'Positioning of actions', body: `${ed ? `<p class="note">✎ ${t('drag_hint')}</p>` : ''}<div class="mx ${ed ? 'editing' : ''}">${s}</div>${legend}${alt}` };
}

/* ---------- S7 Next steps ---------- */
export function S7(mode: Mode): Sec {
  const l = shown(mode).filter(c => c.visible);
  const row = (ty: string) => `<tr><th class="rh ${ty === 'QuickWin' ? 'qw' : ''}">${t(ty)}</th>${S.M.piliers.map(p => { const it = l.filter(c => c.pilier_id === p.id && c.type === ty); return `<td>${it.length ? `<ul>${it.map(c => `<li ${mode === 'web' ? `data-act="open" data-id="${esc(c.id)}"` : ''}>${esc(tx(c.titre_action))}</li>`).join('')}</ul>` : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`;
  const rm: any = A().roadmap, ph = rm && rm.phases ? rm.phases[rm.phases.findIndex((p: any) => p.code === rm.phase_courante) + 1] : null;
  return { sur: t('S7'), titre: lead() === 'fr' ? 'Prochaines étapes' : 'Next steps', body: `<table class="ns"><tr><th class="rh"></th>${S.M.piliers.map(p => `<th style="background:${p._c}">${esc(tx(p.libelle))}</th>`).join('')}</tr>${row('QuickWin')}${row('LongueTraine')}</table>${R().conclusion ? `<div class="conclusion">${md(R().conclusion)}${ph && s1On() ? `<br><small class="muted">${t('next_phase')} : <b>${esc(ph.code)}</b> · ${esc(tx(ph.libelle))}</small>` : ''}</div>` : ''}` };
}

/* ---------- S8 Annexe ---------- */
export function s8Rows() {
  const s = S.s8, q = s.q.trim().toLowerCase();
  const W: Record<string, number> = { KO: 0, PARTIEL: 1, A_REVOIR: 2, INCONNU: 3, OK: 4, NA: 5 }, CW: Record<string, number> = { HAUTE: 3, MOYENNE: 2, FAIBLE: 1, AUCUNE: 0 };
  const rows = S.M.crits.filter(k => fCrit(k) && (!s.axe || k.axe_score === s.axe) && (!s.top || k.top_prio) && (!q || [k.id_grille, k.question, k.element_controle, k.commentaire, k.outil, k.subject].join(' ').toLowerCase().includes(q)));
  const key = s.sort, val = (k: any) => key === 'statut' ? W[k.statut] : key === 'criticite' ? -CW[k.criticite] : key === 'pilier' ? (S.M.pmap[k.pilier_id]?.ordre || 0) : String(k[key] ?? '');
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * s.dir; });
  return rows;
}
export function s8Table() {
  const rows = s8Rows(), th = (k: string, l: string) => `<th><button data-act="sort" data-k="${k}">${l}${S.s8.sort === k ? (S.s8.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
  return `<p class="note" style="margin:0 0 6px">${rows.length} / ${S.M.crits.length} ${t('rows')}</p><div class="tblwrap"><table class="grid"><thead><tr>${th('id_grille', 'ID')}${th('pilier', t('col_pilier'))}${th('outil', t('col_outil'))}${th('subject', t('col_sujet'))}${th('question', t('col_critere'))}${th('statut', t('col_statut'))}${th('criticite', t('col_crit'))}<th>${t('col_comment')}</th><th>${t('col_constat')}</th></tr></thead><tbody>${rows.map(k => { const grey = k.statut === 'NA' || k.statut === 'INCONNU'; const lk = S.M.linkOf[k.id_grille] || []; return `<tr class="${grey ? 'grey' : ''}"><td class="mono">${esc(k.id_grille)}${k.top_prio ? ' <span class="star" title="Top prio">★</span>' : ''}</td><td>${esc(tx(S.M.pmap[k.pilier_id]?.libelle) || '—')}</td><td>${esc(k.outil)}</td><td>${esc(k.subject)}<small>${t(k.axe_score || '')}</small></td><td><span class="q">${esc(k.question)}</span><small>${esc(k.element_controle)}</small>${k.motif_non_evalue === 'acces' ? `<small>🔒 ${t('acces_demande')} : ${esc(k.acces_requis_id || '—')}</small>` : ''}</td><td>${stPill(k.statut)}</td><td>${crPill(k.criticite)}</td><td>${esc(k.commentaire)}</td><td>${lk.map(c => `<button class="link-btn" data-act="open" data-id="${esc(c.id)}">${esc(c.id)}</button>`).join(' ')}</td></tr>`; }).join('')}</tbody></table></div>`;
}
export function S8(mode: Mode): Sec | null {
  if (mode !== 'web') return null;
  const s = S.s8;
  const bar = `<div class="s8bar"><input type="search" data-s8="q" value="${esc(s.q)}" placeholder="${t('search')}" aria-label="${t('search')}"><label>${t('axe')} <select data-s8="axe"><option value="">${t('all')}</option>${AXES.map(a => `<option value="${a}" ${s.axe === a ? 'selected' : ''}>${t(a)}</option>`).join('')}</select></label><label class="chk" style="margin:0"><input type="checkbox" data-s8="top" ${s.top ? 'checked' : ''}> ${t('top_prio')} ★</label><span style="flex:1"></span><button class="btn" data-act="csv-s8">⬇ CSV</button> <button class="btn" data-act="xlsx-s8">⬇ XLSX</button></div>`;
  return { sur: t('S8'), titre: `${S.M.crits.length} ${t('rows')}`, body: bar + `<div id="s8-table">${s8Table()}</div>` };
}

/* ---------- S9 Contacts ---------- */
export function S9(): Sec {
  const cs = R().contacts || [];
  return { full: true, body: `<div class="cover-in">${LOGO}<p class="merci">${t('merci')}<span>.</span></p><div class="contacts">${cs.map(c => `<div class="contact"><b>${esc(c.nom)}</b><span>${esc(tx(c.role))}</span><span>${esc(c.email)}</span></div>`).join('')}</div><div class="cover-accent"></div></div>` };
}
export const SECTIONS = ['S0', 'S0b', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
