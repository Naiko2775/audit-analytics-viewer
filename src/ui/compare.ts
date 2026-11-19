/** Écran « Évolution » : comparaison de l'audit courant avec un audit de référence (§4.1 ; EXP-40, UI-57). Rendu en chaînes, comme sections.ts. */
import { esc } from '../core/util.ts';
import { fmtMonth, getLang, t, tx } from '../core/i18n.ts';
import type { AuditRef, Change, Comparison, ConstatChange, ScoreDelta } from '../core/compare.ts';
import type { Critere } from '../core/types.ts';

const L: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    sur: 'Évolution', titre: 'Comparaison avec l’audit précédent', ref: 'Audit de référence', choose: 'Choisir un audit…',
    none_t: 'Aucun audit de référence disponible',
    none_d: 'Pour visualiser l’évolution des scores après la recette, importez l’audit précédent du même client (écran Importer), puis revenez sur cet écran.',
    none_pick: 'Sélectionnez l’audit de référence pour afficher l’évolution.',
    import: 'Importer l’audit précédent', avant: 'Avant', apres: 'Après', version: 'version',
    scores: 'Évolution des scores', global: 'Score général', by_pilier: 'Par pilier', by_axe: 'Par axe',
    cross: 'Statut × criticité', crits: 'Évolution des critères', constats: 'Évolution des constats',
    ameliores: 'Critères améliorés', degrades: 'Critères dégradés', nouv_eval: 'Nouvellement évalués', autres: 'Autres changements',
    nouveaux_c: 'Critères ajoutés', retires_c: 'Critères retirés', inchanges: 'critères inchangés',
    resolus: 'Résolus', persistants: 'Persistants', nouveaux: 'Nouveaux', regresses: 'Régressés', tous: 'Tous',
    ev_resolu: 'Résolu', ev_ameliore: 'En progrès', ev_stable: 'Inchangé', ev_regresse: 'Régressé', ev_nouveau: 'Nouveau',
    absent: 'absent de l’audit courant', a_verifier: 'rapproché par libellé : à vérifier', corr: 'via table de correspondance',
    open: 'Ouvrir la fiche', empty: 'Aucun', warnings: 'Points d’attention', pts: 'pts', pt: 'pt',
    rapprocher: 'à rapprocher manuellement', modifie: 'modifié', crit_avant: 'criticité avant', id_avant: 'ancien identifiant',
    hidden: 'Scores masqués pour cette restitution : seule l’évolution des constats est affichée.',
    up: 'en hausse', down: 'en baisse', flat: 'stable', na: 'non calculable', vs: 'vs',
  },
  en: {
    sur: 'Progress', titre: 'Comparison with the previous audit', ref: 'Reference audit', choose: 'Choose an audit…',
    none_t: 'No reference audit available',
    none_d: 'To see how scores evolved after the fixes, import the previous audit of the same client (Import screen), then come back to this screen.',
    none_pick: 'Select the reference audit to display the progress.',
    import: 'Import the previous audit', avant: 'Before', apres: 'After', version: 'version',
    scores: 'Score progress', global: 'Overall score', by_pilier: 'By pillar', by_axe: 'By axis',
    cross: 'Status × criticality', crits: 'Criteria progress', constats: 'Findings progress',
    ameliores: 'Improved criteria', degrades: 'Degraded criteria', nouv_eval: 'Newly assessed', autres: 'Other changes',
    nouveaux_c: 'Added criteria', retires_c: 'Removed criteria', inchanges: 'unchanged criteria',
    resolus: 'Resolved', persistants: 'Persisting', nouveaux: 'New', regresses: 'Regressed', tous: 'All',
    ev_resolu: 'Resolved', ev_ameliore: 'Improving', ev_stable: 'Unchanged', ev_regresse: 'Regressed', ev_nouveau: 'New',
    absent: 'not in the current audit', a_verifier: 'matched by label: to check', corr: 'via mapping table',
    open: 'Open the finding', empty: 'None', warnings: 'Points of attention', pts: 'pts', pt: 'pt',
    rapprocher: 'to match manually', modifie: 'modified', crit_avant: 'previous criticality', id_avant: 'former identifier',
    hidden: 'Scores are hidden for this report: only the progress of findings is shown.',
    up: 'up', down: 'down', flat: 'stable', na: 'not computable', vs: 'vs',
  },
};
const l = (k: string) => L[getLang()]?.[k] ?? L.fr[k] ?? k;
const stPill = (s: string | null) => s ? `<span class="pill st-${esc(s)}">${esc(t(s))}</span>` : '<span class="cmp-dash">—</span>';
const crPill = (k: string) => `<span class="cr cr-${esc(k)}">${esc(t(k))}</span>`;
/** Date AAAA-MM(-JJ) mise en forme ; toute autre forme est affichée telle quelle (fmtMonth renverrait « Invalid Date »). */
const fmtDate = (d?: string) => (d && /^\d{4}-\d{1,2}(\b|-)/.test(d) ? fmtMonth(d) : '') || d || '';
const refLabel = (r: AuditRef) => `${esc(r.client)} · ${esc(r.date ? fmtDate(r.date) : r.id)}${r.version ? ` · ${l('version')} ${esc(r.version)}` : ''}`;

/** Badge de delta réutilisable (S3) : « ▲ +12 pts », « ▼ −5 pts », « = 0 pt ». Chaîne vide si le delta n'est pas calculable. */
export function scoreDeltaBadge(delta: number | null, suffix = ''): string {
  if (delta == null || isNaN(delta)) return '';
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const sym = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
  const num = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0';
  const unit = Math.abs(delta) > 1 ? l('pts') : l('pt');
  const txt = `${num} ${unit}${suffix ? ` ${suffix}` : ''}`;
  return `<span class="cmp-delta cmp-${cls}" title="${esc(`${txt} (${l(cls)})`)}"><span aria-hidden="true">${sym}</span> ${esc(txt)}<span class="cmp-sr"> (${l(cls)})</span></span>`;
}

function bar(v: number | null, kind: 'prev' | 'cur') {
  const w = v == null ? 0 : Math.max(0, Math.min(100, v));
  return `<div class="cmp-bar cmp-bar-${kind}"><span class="cmp-bar-lbl">${l(kind === 'prev' ? 'avant' : 'apres')}</span><span class="cmp-track"><span class="cmp-fill" style="width:${w}%"></span></span><span class="cmp-val">${v == null ? '–' : v}</span></div>`;
}
function scoreRow(label: string, s: ScoreDelta, main = false) {
  const aria = `${label} : ${s.prev ?? l('na')} → ${s.cur ?? l('na')}`;
  return `<div class="cmp-score${main ? ' cmp-score-main' : ''}" role="group" aria-label="${esc(aria)}"><div class="cmp-score-h"><b>${esc(label)}</b>${scoreDeltaBadge(s.delta) || `<span class="cmp-delta cmp-flat">${l('na')}</span>`}</div>${bar(s.prev, 'prev')}${bar(s.cur, 'cur')}</div>`;
}

function crossTable(c: Comparison) {
  const rows = ['OK', 'PARTIEL', 'KO'], cols = ['HAUTE', 'MOYENNE', 'FAIBLE'];
  const cell = (s: string, k: string) => {
    const a = c.cross.prev[s]?.[k] ?? 0, b = c.cross.cur[s]?.[k] ?? 0, d = b - a;
    // Plus d'OK = mieux ; plus de KO/PARTIEL = moins bien.
    const good = s === 'OK' ? d > 0 : d < 0;
    return `<td><span class="cmp-x-prev">${a}</span><span class="cmp-x-arrow" aria-hidden="true">→</span><b>${b}</b>${d ? `<small class="cmp-x-d ${good ? 'cmp-up' : 'cmp-down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</small>` : ''}</td>`;
  };
  return `<div class="cmp-tablewrap"><table class="x cmp-x"><caption class="cmp-sr">${l('cross')} (${l('avant')} → ${l('apres')})</caption><tr><th class="l"></th>${cols.map(k => `<th>${crPill(k)}</th>`).join('')}</tr>${rows.map(s => `<tr><td class="l">${stPill(s)}</td>${cols.map(k => cell(s, k)).join('')}</tr>`).join('')}</table></div>`;
}

function changeList(title: string, list: Change[], kind: string) {
  const items = list.map(ch => `<li><span class="chip" title="${esc(ch.question)}">${esc(ch.id_grille)}</span><span class="cmp-q">${esc(ch.question)}${ch.appariement === 'question' ? ` <small class="cmp-warn-i">${l('a_verifier')}${ch.id_grille_avant ? ` · ${l('id_avant')} ${esc(ch.id_grille_avant)}` : ''}</small>` : ''}${ch.criticite_avant ? ` <small>${l('crit_avant')} : ${esc(t(ch.criticite_avant))}</small>` : ''}</span><span class="cmp-st">${stPill(ch.avant)}<span aria-hidden="true">→</span>${stPill(ch.apres)}</span>${crPill(ch.criticite)}</li>`).join('');
  return `<details class="cmp-list cmp-list-${kind}"${list.length ? ' open' : ''}><summary><b>${esc(title)}</b><span class="cmp-n">${list.length}</span></summary>${list.length ? `<ul>${items}</ul>` : `<p class="cmp-empty">${l('empty')}</p>`}</details>`;
}
function critList(title: string, list: Critere[], kind: string) {
  const items = list.map(k => `<li><span class="chip">${esc(k.id_grille)}</span><span class="cmp-q">${esc(k.question)}</span><span class="cmp-st">${stPill(k.statut)}</span>${crPill(k.criticite)}</li>`).join('');
  return `<details class="cmp-list cmp-list-${kind}"${list.length ? ' open' : ''}><summary><b>${esc(title)}</b><span class="cmp-n">${list.length}</span></summary>${list.length ? `<ul>${items}</ul>` : `<p class="cmp-empty">${l('empty')}</p>`}</details>`;
}

function constatRow(c: ConstatChange) {
  const note = [c.absent ? l('absent') : '', c.a_rapprocher ? l('rapprocher') : '', c.appariement === 'titre' ? l('a_verifier') : '', c.appariement === 'correspondance' ? l('corr') : '',
    c.modifie ? l('modifie') : '', c.criticite_avant ? `${l('crit_avant')} : ${t(c.criticite_avant)}` : ''].filter(Boolean).join(' · ');
  const open = c.id ? `<button type="button" class="cmp-open" data-act="open" data-id="${esc(c.id)}">${l('open')}</button>` : '';
  return `<li class="cmp-c${c.a_rapprocher ? ' cmp-c-match' : ''}" data-evo="${esc(c.evolution)}"><span class="cmp-evo cmp-evo-${c.evolution}">${l('ev_' + c.evolution)}</span><span class="cmp-q"><span class="cmp-tt">${esc(tx(c.titre))}</span><small>${esc(c.id || c.id_prev || '')}${note ? ` · ${esc(note)}` : ''}</small></span><span class="cmp-st">${stPill(c.statut_avant)}<span aria-hidden="true">→</span>${stPill(c.statut_apres)}</span>${crPill(c.criticite)}${open}</li>`;
}
function constatsBlock(c: Comparison) {
  const groups: [string, ConstatChange[]][] = [['resolus', c.constats.resolus], ['persistants', c.constats.persistants], ['nouveaux', c.constats.nouveaux]];
  const nReg = c.constats.persistants.filter(x => x.evolution === 'regresse').length;
  // Filtre sans JavaScript : boutons radio + :has() (EXP-40, filtre « Régressé »).
  const f = (v: string, lbl: string, n: number, on = false) => `<label class="cmp-f"><input type="radio" name="cmp-f" value="${v}"${on ? ' checked' : ''}><span>${esc(lbl)} <small>${n}</small></span></label>`;
  const total = groups.reduce((a, g) => a + g[1].length, 0);
  const filters = `<div class="cmp-filters" role="radiogroup" aria-label="${l('constats')}">${f('all', l('tous'), total, true)}${f('resolu', l('resolus'), c.constats.resolus.length)}${f('persistant', l('persistants'), c.constats.persistants.length)}${f('regresse', l('regresses'), nReg)}${f('nouveau', l('nouveaux'), c.constats.nouveaux.length)}</div>`;
  const body = groups.map(([k, list]) => `<section class="cmp-cg cmp-cg-${k}"><h3>${l(k)} <span class="cmp-n">${list.length}</span></h3>${list.length ? `<ul>${list.map(constatRow).join('')}</ul>` : `<p class="cmp-empty">${l('empty')}</p>`}</section>`).join('');
  return `<div class="cmp-constats">${filters}${body}</div>`;
}

function selector(choices: { key: string; label: string }[], selectedKey: string | null) {
  return `<label class="cmp-ref"><span>${l('ref')}</span><select data-cmp="ref"><option value=""${selectedKey ? '' : ' selected'}>${l('choose')}</option>${choices.map(ch => `<option value="${esc(ch.key)}"${ch.key === selectedKey ? ' selected' : ''}>${esc(ch.label)}</option>`).join('')}</select></label>`;
}

/**
 * Écran de comparaison. `cmp` null : aucun audit de référence choisi ou disponible.
 * `opts.masquerScores` (par défaut `cmp.masquer_scores`) : EXP-40, seule l'évolution des constats est affichée
 * (à passer depuis l'état d'édition si l'option a été surchargée).
 */
export function compareScreen(cmp: Comparison | null, choices: { key: string; label: string }[], selectedKey: string | null, opts: { masquerScores?: boolean } = {}): { sur: string; titre: string; body: string } {
  const head = choices.length ? `<div class="cmp-top">${selector(choices, selectedKey)}</div>` : '';
  if (!cmp) {
    const empty = choices.length
      ? `<div class="cmp-none"><p>${l('none_pick')}</p></div>`
      : `<div class="cmp-none"><h2>${l('none_t')}</h2><p>${l('none_d')}</p><button type="button" class="cmp-btn" data-act="nav" data-to="import">${l('import')}</button></div>`;
    return { sur: l('sur'), titre: l('titre'), body: `<div class="cmp">${head}${empty}</div>` };
  }
  const band = `<div class="cmp-band"><div class="cmp-aud cmp-aud-prev"><small>${l('avant')}</small><b>${refLabel(cmp.prev)}</b><code>${esc(cmp.prev.id)}</code></div><span class="cmp-arrow" aria-hidden="true">→</span><div class="cmp-aud cmp-aud-cur"><small>${l('apres')}</small><b>${refLabel(cmp.cur)}</b><code>${esc(cmp.cur.id)}</code></div></div>`;
  const warn = cmp.warnings.length ? `<div class="cmp-warns" role="note"><b>${l('warnings')}</b><ul>${cmp.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
  const scores = `<section class="cmp-sec"><h2 class="h">${l('scores')}</h2><div class="cmp-scores">${scoreRow(l('global'), cmp.scores.global, true)}<div class="cmp-sub"><h3>${l('by_pilier')}</h3>${cmp.scores.piliers.map(p => scoreRow(tx(p.libelle), p)).join('')}</div><div class="cmp-sub"><h3>${l('by_axe')}</h3>${cmp.scores.axes.map(a => scoreRow(t(a.id), a)).join('')}</div></div></section>`;
  const K = cmp.criteres;
  const crits = `<section class="cmp-sec"><h2 class="h">${l('crits')} <small class="cmp-muted">· ${K.inchanges} ${l('inchanges')}</small></h2><div class="cmp-grid">${changeList(l('ameliores'), K.ameliores, 'up')}${changeList(l('degrades'), K.degrades, 'down')}${changeList(l('nouv_eval'), K.nouvellement_evalues, 'new')}${K.autres.length ? changeList(l('autres'), K.autres, 'other') : ''}${critList(l('nouveaux_c'), K.nouveaux, 'add')}${critList(l('retires_c'), K.retires, 'del')}</div></section>`;
  const cross = `<section class="cmp-sec"><h2 class="h">${l('cross')}</h2>${crossTable(cmp)}</section>`;
  const constats = `<section class="cmp-sec"><h2 class="h">${l('constats')}</h2>${constatsBlock(cmp)}</section>`;
  if (opts.masquerScores ?? cmp.masquer_scores)
    return { sur: l('sur'), titre: esc(l('constats')), body: `<div class="cmp">${head}${band}${warn}<p class="cmp-note">${l('hidden')}</p>${constats}</div>` };
  const titre = `${l('global')} : ${cmp.scores.global.prev ?? '–'} → ${cmp.scores.global.cur ?? '–'} / 100`;
  return { sur: l('sur'), titre: esc(titre), body: `<div class="cmp">${head}${band}${warn}${scores}<div class="cmp-2">${cross}</div>${constats}${crits}</div>` };
}
