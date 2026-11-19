/**
 * Export XLSX « Plan d'action » (EXP-25 à EXP-28 ; spec §5 et S8).
 * Grille complète au format 230906_Scoring_Template, enrichie de la priorisation et du feedback.
 * Pur, sans DOM : renvoie les octets du fichier.
 */
import type { Model, MCritere, MConstat } from '../core/model.ts';
import { AXES, CORR } from '../core/rules.ts';
import { getLang, setLang, t, tx, type Lang } from '../core/i18n.ts';
import { buildXlsx, colLetter, XLSX_MIME, type Cell, type SheetSpec, type StyleName } from './ooxml.ts';

export { XLSX_MIME };

export interface PlanXlsxOptions {
  /** Sous-ensemble ordonné des critères (export filtré S8). Par défaut : tous les critères du modèle. */
  criteres?: MCritere[];
  /** Langue des libellés. Par défaut : langue de l'audit, sinon fr. */
  lang?: Lang;
  /** Filtres appliqués (libellé → valeur) : ajoute une feuille « Filtres appliqués » (EXP-27). */
  filtres?: Record<string, string>;
  /** Date d'export (tests). */
  date?: Date;
  /**
   * Libellés des colonnes Evaluation et Criticality de la grille : 'grille' (défaut) = libellés anglais du modèle 230906
   * (Yes/No/Partly…) ; 'langue' = statuts normalisés traduits dans la langue de l'export (recommandation Q7, AC EXP-26).
   */
  libellesGrille?: 'grille' | 'langue';
}

const L: Record<Lang, Record<string, string>> = {
  fr: {
    synthese: 'Synthèse', plan: "Plan d'action", grille: 'Grille détaillée', acces: 'Accès requis', filtres: 'Filtres appliqués',
    titre_doc: "Plan d'action", client: 'Client', titre: 'Titre', date: "Date de l'audit", version: 'Version', export: "Date d'export",
    methode: 'Méthode', ext: 'Externe (sans accès)', acc: 'Avec accès aux outils',
    scores: 'Scores', masques: 'Scores masqués pour cette restitution.', constats: 'Constats', nb_constats: 'Constats',
    nb_visibles: 'dont visibles dans la restitution', nb_qw: 'Quick Wins',
    statut: 'Statut', total: 'Total', cov: 'Couverture', evalues: 'Critères évalués', informatif: 'Critères informatifs (criticité aucune)',
    na: 'Non concernés', inconnu: 'Inconnus', a_revoir: 'À revoir', total_crit: 'Total des critères',
    rang: 'Rang', id_constat: 'ID constat', pilier: 'Pilier', action: 'Action', criticite: 'Criticité', statut_crit: 'Statut des critères',
    impact: 'Impact (1-3)', effort: 'Effort', semaines: 'Semaines', type: 'Type', quadrant: 'Quadrant', criteres: 'Critères liés',
    outils: 'Outils', visible: 'Visible', fb: 'Feedback', fb_comment: 'Commentaire feedback', corr: 'Statut de correction',
    fb_date: 'Date feedback', fb_auteur: 'Auteur feedback', oui: 'Oui', non: 'Non',
    domaine: 'Domaine', outil: 'Outil', category: 'Category', subject: 'Subject', criteria: 'Criteria', controlled: 'Controlled elements',
    evaluation: 'Evaluation', criticality: 'Criticality', comment: 'Comment', top: 'Top prio', id: 'ID', axe: 'Axe',
    constat: 'Constat lié', motif: 'Motif non évalué', acces_req: 'Accès requis',
    m_acces: 'Accès manquant', m_hors: 'Hors périmètre', m_tech: 'Technique',
    a_outil: 'Outil', a_acces: 'Accès demandé', a_motif: 'Motif', a_crit: 'Critères en attente', a_nb: 'Nb critères',
    a_contact: 'Interlocuteur', a_statut: 'Statut de la demande', a_origine: 'Origine', a_decl: 'Déclaré', a_auto: 'Déduit des critères inconnus',
    a_none: 'Tous les contrôles prévus ont pu être réalisés.',
    f_filtre: 'Filtre', f_valeur: 'Valeur', f_lignes: 'Critères exportés', f_constats: 'Constats exportés', f_sur: 'sur',
    f_aucun: 'Aucun filtre', f_note_l: 'Remarque', f_note: 'La synthèse et les scores portent sur l’ensemble des critères : les filtres ne les modifient pas. Le plan d’action ne reprend que les constats liés aux critères exportés.',
  },
  en: {
    synthese: 'Summary', plan: 'Action plan', grille: 'Detailed grid', acces: 'Required access', filtres: 'Applied filters',
    titre_doc: 'Action plan', client: 'Client', titre: 'Title', date: 'Audit date', version: 'Version', export: 'Export date',
    methode: 'Method', ext: 'External (no access)', acc: 'With tool access',
    scores: 'Scores', masques: 'Scores are hidden for this report.', constats: 'Findings', nb_constats: 'Findings',
    nb_visibles: 'of which visible in the report', nb_qw: 'Quick wins',
    statut: 'Status', total: 'Total', cov: 'Coverage', evalues: 'Assessed criteria', informatif: 'Informative criteria (no impact)',
    na: 'Not concerned', inconnu: 'Unknown', a_revoir: 'To review', total_crit: 'Total criteria',
    rang: 'Rank', id_constat: 'Finding ID', pilier: 'Pillar', action: 'Action', criticite: 'Criticality', statut_crit: 'Criteria status',
    impact: 'Impact (1-3)', effort: 'Effort', semaines: 'Weeks', type: 'Type', quadrant: 'Quadrant', criteres: 'Linked criteria',
    outils: 'Tools', visible: 'Visible', fb: 'Feedback', fb_comment: 'Feedback comment', corr: 'Fix status',
    fb_date: 'Feedback date', fb_auteur: 'Feedback author', oui: 'Yes', non: 'No',
    domaine: 'Domain', outil: 'Tool', category: 'Category', subject: 'Subject', criteria: 'Criteria', controlled: 'Controlled elements',
    evaluation: 'Evaluation', criticality: 'Criticality', comment: 'Comment', top: 'Top prio', id: 'ID', axe: 'Axis',
    constat: 'Linked finding', motif: 'Reason not assessed', acces_req: 'Required access',
    m_acces: 'Missing access', m_hors: 'Out of scope', m_tech: 'Technical',
    a_outil: 'Tool', a_acces: 'Requested access', a_motif: 'Reason', a_crit: 'Pending criteria', a_nb: 'Nb criteria',
    a_contact: 'Contact', a_statut: 'Request status', a_origine: 'Origin', a_decl: 'Declared', a_auto: 'Inferred from unknown criteria',
    a_none: 'All planned controls could be performed.',
    f_filtre: 'Filter', f_valeur: 'Value', f_lignes: 'Exported criteria', f_constats: 'Exported findings', f_sur: 'of',
    f_aucun: 'No filter', f_note_l: 'Note', f_note: 'The summary and scores cover all criteria: filters do not change them. The action plan only lists findings linked to the exported criteria.',
  },
};

/** Libellés de la grille 230906 (toujours en anglais, comme le modèle d'origine). */
export const GRID_EVAL: Record<string, string> = { OK: 'Yes', KO: 'No', PARTIEL: 'Partly', NA: 'Not concerned', INCONNU: 'Unknown', A_REVOIR: 'To review' };
export const GRID_CRIT: Record<string, string> = { HAUTE: 'High', MOYENNE: 'Medium', FAIBLE: 'Low', AUCUNE: 'No impact' };
const ST_STYLE: Record<string, StyleName> = { OK: 'ok', PARTIEL: 'partiel', KO: 'ko', NA: 'na', INCONNU: 'na', A_REVOIR: 'na' };

const st = (statut: string, label: string): Cell => ({ v: label, s: ST_STYLE[statut] ?? 'text' });
const H = (labels: string[]): Cell[] => labels.map(v => ({ v, s: 'header' as StyleName }));
const parseDate = (s: unknown): Date | null => { if (!s) return null; const d = new Date(String(s)); return isNaN(d.getTime()) ? null : d; };
const str = (v: unknown): string => (v == null ? '' : String(v));

/** Nom de fichier conseillé : plan_action_<client>.xlsx (ou grille_filtree_… pour l'export filtré). */
export function planXlsxFilename(M: Model, filtre = false): string {
  const slug = String(M.audit.client || 'audit').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${filtre ? 'grille_filtree' : 'plan_action'}_${slug || 'audit'}.xlsx`;
}

export function buildPlanXlsx(M: Model, FB: Record<string, any>, opts: PlanXlsxOptions = {}): Uint8Array {
  const prev = getLang();
  const lang: Lang = opts.lang ?? (M.audit.langue === 'en' ? 'en' : 'fr');
  setLang(lang);
  try { return build(M, FB || {}, opts, L[lang]); } finally { setLang(prev); }
}

function build(M: Model, FB: Record<string, any>, opts: PlanXlsxOptions, l: Record<string, string>): Uint8Array {
  const A = M.audit, now = opts.date ?? new Date(), client = str(A.client);
  const filtered = !!(opts.criteres || opts.filtres);
  const crits = opts.criteres ?? M.crits;
  // Export filtré : le plan ne reprend que les constats liés aux critères exportés (périmètre transmis à une équipe).
  const keep = new Set(crits.map(k => k.id_grille));
  const constats = opts.criteres ? M.constats.filter(c => (c.criteres_lies || []).some(id => keep.has(id))) : M.constats;
  const gridLang = opts.libellesGrille === 'langue';
  const evalLabel = (s: string) => (gridLang ? t(s) : GRID_EVAL[s] ?? s);
  const critLabel = (c: string) => (gridLang ? t(c) : GRID_CRIT[c] ?? c);
  const corrLabels = CORR.map(c => t(c));
  const yn = (b: boolean) => (b ? l.oui : l.non);
  const fbOf = (c: MConstat): Record<string, any> => (FB[c.id] && typeof FB[c.id] === 'object' ? FB[c.id] : {});
  const titre = tx(A.titre) || t('default_title');

  /* ---------- 1. Synthèse ---------- */
  const syn: Cell[][] = [];
  syn.push([{ v: client ? `${l.titre_doc} · ${client}` : l.titre_doc, s: 'title' }]);
  syn.push([]);
  const kv = (k: string, v: Cell) => syn.push([{ v: k, s: 'label' }, v]);
  kv(l.client, client); kv(l.titre, titre); kv(l.date, str(A.date)); kv(l.version, str(A.version));
  if (A.methode) kv(l.methode, A.methode === 'externe' ? l.ext : l.acc);
  kv(l.export, now);
  syn.push([]);
  syn.push([{ v: l.scores, s: 'subtitle' }]);
  if (A.restitution?.masquer_scores) syn.push([{ v: l.masques, s: 'note' }]);
  else {
    const sc = (x: number | null, b = false): Cell => (x == null ? { v: t('na'), s: 'center' } : { v: x, s: b ? 'numBold' : 'num' });
    syn.push([{ v: t('score_global'), s: 'label' }, sc(M.scores.global, true)]);
    syn.push([{ v: t('by_pilier'), s: 'bold' }]);
    M.piliers.forEach(p => syn.push([{ v: tx(p.libelle), s: 'text' }, sc(M.scores.pil[p.id] ?? null)]));
    syn.push([{ v: t('by_axe'), s: 'bold' }]);
    AXES.forEach(a => syn.push([{ v: t(a), s: 'text' }, sc(M.scores.axes[a] ?? null)]));
  }
  syn.push([]);
  syn.push([{ v: t('cross'), s: 'subtitle' }]);
  const CR = ['HAUTE', 'MOYENNE', 'FAIBLE'];
  syn.push(H([l.statut, ...CR.map(k => t(k)), l.total]));
  ['OK', 'PARTIEL', 'KO'].forEach(s => {
    const row = CR.map(k => M.cross[s]?.[k] ?? 0);
    syn.push([st(s, t(s)), ...row.map(n => ({ v: n, s: 'num' as StyleName })), { v: row.reduce((a, b) => a + b, 0), s: 'numBold' }]);
  });
  syn.push([{ v: l.total, s: 'label' }, ...CR.map(k => ({ v: ['OK', 'PARTIEL', 'KO'].reduce((a, s) => a + (M.cross[s]?.[k] ?? 0), 0), s: 'numBold' as StyleName })),
    { v: ['OK', 'PARTIEL', 'KO'].reduce((a, s) => a + CR.reduce((b, k) => b + (M.cross[s]?.[k] ?? 0), 0), 0), s: 'numBold' }]);
  syn.push([]);
  syn.push([{ v: l.cov, s: 'subtitle' }]);
  const cv = (k: string, n: number) => syn.push([{ v: k, s: 'text' }, { v: n, s: 'num' }]);
  cv(l.evalues, M.cov.evalues); cv(l.informatif, M.cov.informatif); cv(l.na, M.cov.NA); cv(l.inconnu, M.cov.INCONNU);
  cv(l.a_revoir, M.cov.A_REVOIR); syn.push([{ v: l.total_crit, s: 'label' }, { v: M.cov.total, s: 'numBold' }]);
  syn.push([]);
  syn.push([{ v: l.constats, s: 'subtitle' }]);
  cv(l.nb_constats, M.constats.length); cv(l.nb_visibles, M.constats.filter(c => c.visible).length);
  cv(l.nb_qw, M.constats.filter(c => c.quadrant === 'QW').length);
  const synthese: SheetSpec = { name: l.synthese, rows: syn, cols: [42, 16, 12, 12, 12], defaultStyle: 'default' };

  /* ---------- 2. Plan d'action ---------- */
  const planHead = [l.rang, l.id_constat, l.pilier, l.action, l.criticite, l.statut_crit, l.impact, l.effort, l.semaines, l.type, l.quadrant,
    l.criteres, l.outils, l.visible, l.fb, l.fb_comment, l.corr, l.fb_date, l.fb_auteur];
  const plan: Cell[][] = [H(planHead)];
  constats.forEach(c => {
    const fb = fbOf(c);
    plan.push([
      { v: c.rang, s: 'num' }, c.id, tx(c.pilier?.libelle), { v: tx(c.titre_action), s: 'wrap' }, t(c.criticite), st(c.statut, t(c.statut)),
      { v: c.imp, s: 'num' }, { v: c.effort, s: 'center' }, c.effort_semaines != null ? { v: Number(c.effort_semaines), s: 'num' } : null,
      t(c.type), t(c.quadrant), { v: (c.criteres_lies || []).join(', '), s: 'wrap' }, { v: c.outils.join(', '), s: 'wrap' }, yn(c.visible),
      fb.decision ? st(fb.decision, str(fb.decision)) : null, { v: str(fb.commentaire), s: 'wrap' }, t(fb.statut_correction || 'todo'),
      parseDate(fb.date), str(fb.auteur),
    ]);
  });
  const corrPlan = colLetter(planHead.indexOf(l.corr));
  const planSheet: SheetSpec = {
    name: l.plan, rows: plan, cols: [7, 11, 18, 60, 11, 13, 9, 8, 10, 14, 15, 22, 22, 8, 10, 36, 16, 17, 16],
    freeze: { rows: 1 }, autoFilter: true,
    validations: constats.length ? [{ sqref: `${corrPlan}2:${corrPlan}${constats.length + 1}`, list: corrLabels }] : [],
  };

  /* ---------- 3. Grille détaillée ---------- */
  const accesOf = (k: MCritere) => M.acces.find(a => a.criteres.some(x => x.id_grille === k.id_grille)) || M.acces.find(a => a.id === k.acces_requis_id);
  const motif: Record<string, string> = { acces: l.m_acces, hors_perimetre: l.m_hors, technique: l.m_tech };
  const gridHead = [l.domaine, l.outil, l.category, l.subject, l.criteria, l.controlled, l.evaluation, l.criticality, l.comment, l.top,
    l.id, l.pilier, l.axe, l.constat, l.rang, l.effort, l.type, l.fb, l.fb_comment, l.fb_auteur, l.fb_date, l.corr, l.motif, l.acces_req];
  const grid: Cell[][] = [H(gridHead)];
  crits.forEach(k => {
    const lk = (M.linkOf[k.id_grille] || []).slice().sort((a, b) => a.rang - b.rang);
    const c0 = lk[0];
    const join = (f: (c: MConstat) => string) => lk.map(f).filter(Boolean).join('\n');
    // Feedback répété sur chaque critère lié (EXP-37) ; préfixé par l'ID du constat s'il y en a plusieurs, pour garder l'alignement.
    const per = (f: (c: MConstat) => string): string => {
      if (lk.length < 2) return lk.length ? f(lk[0]) : '';
      const vals = lk.map(f);
      return vals.some(Boolean) ? lk.map((c, i) => `${c.id} : ${vals[i] || '—'}`).join('\n') : '';
    };
    const fbDates = lk.map(c => parseDate(fbOf(c).date)).filter((d): d is Date => !!d);
    const ac = accesOf(k);
    grid.push([
      str(k.domaine), str(k.outil), str(k.category), str(k.subject), { v: str(k.question), s: 'wrap' }, { v: str(k.element_controle), s: 'wrap' },
      st(k.statut, evalLabel(k.statut)), critLabel(k.criticite), { v: str(k.commentaire), s: 'wrap' },
      { v: k.top_prio ? l.oui : '', s: 'center' },
      k.id_grille, tx(M.pmap[k.pilier_id]?.libelle), k.axe_score ? t(k.axe_score) : '',
      { v: join(c => `${c.id} · ${tx(c.titre_action)}`), s: 'wrap' },
      c0 ? { v: c0.rang, s: 'num' } : null, c0 ? { v: c0.effort, s: 'center' } : null, c0 ? t(c0.type) : '',
      lk.length ? { v: per(c => str(fbOf(c).decision)), s: 'center' } : null,
      { v: per(c => str(fbOf(c).commentaire)), s: 'wrap' },
      { v: per(c => str(fbOf(c).auteur)), s: 'wrap' },
      lk.length < 2 ? fbDates[0] ?? null : fbDates.length ? new Date(Math.max(...fbDates.map(d => d.getTime()))) : null,
      lk.length < 2 ? (lk.length ? t(fbOf(lk[0]).statut_correction || 'todo') : '') : lk.map(c => `${c.id} : ${t(fbOf(c).statut_correction || 'todo')}`).join('\n'),
      k.motif_non_evalue ? motif[k.motif_non_evalue] ?? k.motif_non_evalue : '',
      { v: ac ? `${ac.auto ? '' : ac.id + ' · '}${ac.acces}` : str(k.acces_requis_id), s: 'wrap' },
    ]);
  });
  const corrGrid = colLetter(gridHead.indexOf(l.corr));
  const gridSheet: SheetSpec = {
    name: l.grille, rows: grid, cols: [12, 14, 16, 16, 50, 26, 13, 12, 40, 8, 10, 16, 14, 40, 7, 8, 14, 10, 36, 16, 17, 16, 16, 30],
    freeze: { rows: 1 }, autoFilter: true,
    validations: crits.length ? [{ sqref: `${corrGrid}2:${corrGrid}${crits.length + 1}`, list: corrLabels }] : [],
  };

  /* ---------- 4. Accès requis ---------- */
  const accHead = [l.id, l.a_outil, l.a_acces, l.a_motif, l.a_crit, l.a_nb, l.a_contact, l.a_statut, l.a_origine];
  const acc: Cell[][] = [H(accHead)];
  M.acces.forEach(a => acc.push([
    a.auto ? '' : a.id, a.outil?.libelle ?? a.outil_id, { v: a.acces, s: 'wrap' }, { v: a.motif ?? '', s: 'wrap' },
    { v: a.criteres.map(k => k.id_grille).join(', '), s: 'wrap' }, { v: a.criteres.length, s: 'num' }, a.interlocuteur ?? '',
    st(a.statut_demande === 'obtenu' ? 'OK' : a.statut_demande === 'refuse' ? 'KO' : 'PARTIEL', t(a.statut_demande)),
    a.auto ? l.a_auto : l.a_decl,
  ]));
  if (!M.acces.length) acc.push([{ v: l.a_none, s: 'note' }]);
  const accSheet: SheetSpec = { name: l.acces, rows: acc, cols: [10, 16, 44, 40, 24, 10, 20, 18, 26], freeze: { rows: 1 }, autoFilter: M.acces.length > 0 };

  const sheets = [synthese, planSheet, gridSheet, accSheet];

  /* ---------- 5. Filtres appliqués (export filtré) ---------- */
  if (filtered) {
    const fl: Cell[][] = [H([l.f_filtre, l.f_valeur])];
    const entries = Object.entries(opts.filtres || {});
    entries.forEach(([k, v]) => fl.push([{ v: k, s: 'label' }, { v: str(v), s: 'wrap' }]));
    if (!entries.length) fl.push([{ v: l.f_filtre, s: 'label' }, l.f_aucun]);
    fl.push([{ v: l.f_lignes, s: 'label' }, `${crits.length} ${l.f_sur} ${M.crits.length}`]);
    fl.push([{ v: l.f_constats, s: 'label' }, `${constats.length} ${l.f_sur} ${M.constats.length}`]);
    fl.push([{ v: l.export, s: 'label' }, now]);
    fl.push([{ v: l.date, s: 'label' }, str(A.date)]);
    fl.push([{ v: l.version, s: 'label' }, str(A.version)]);
    fl.push([{ v: l.f_note_l, s: 'label' }, { v: l.f_note, s: 'wrap' }]);
    sheets.push({ name: l.filtres, rows: fl, cols: [28, 70] });
  }

  return buildXlsx(sheets, { title: client ? `${l.titre_doc} · ${client}` : l.titre_doc, creator: 'JAKALA', created: now });
}
