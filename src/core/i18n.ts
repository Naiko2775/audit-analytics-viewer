import { esc } from './util.ts';
import type { Localise, Puce } from './types.ts';

export type Lang = 'fr' | 'en';
const BASE: Record<Lang, Record<string, string>> = {
fr:{S0b:'Sommaire',cadrage:'Cadrage de la mission',besoin:'Besoin',objectifs:'Objectifs',contraintes:'Contraintes',livrables:'Livrables',
 acces_titre:'Accès requis pour les contrôles non réalisés',acces_outil:'Outil',acces_demande:'Accès demandé',acces_criteres:'Critères en attente',acces_statut:'Statut de la demande',acces_contact:'Interlocuteur',
 a_demander:'À demander',demande:'Demandé',obtenu:'Obtenu',refuse:'Refusé',acces_none:'Tous les contrôles prévus ont pu être réalisés.',
 etape:'Étape analysée',reconstituee:'Panneau reconstitué à partir des requêtes relevées',capture_reelle:'Capture réelle',INFO:'Info',
 logo_client:'Logo client',image_corporate:'Image corporate client',placeholder_hint:'Emplacement à compléter (mode édition › Paramètres)',
 fiches:'fiches',page:'p.',artefact:'Artefact HTML autonome',artefact_d:'Fichier unique, hors ligne, données incluses',
 parcours:'Parcours analysé',preuves_n:'preuves',annot_resume:'annotations',
 S0:'Couverture',S1:'Contexte & roadmap',S2:'Périmètre & objectifs',S3:'Scorecard',S3b:'Synthèse',S4:'Aperçu priorisé',S5:'Fiches constats',S6:'Matrice Impact × Effort',S7:'Next steps',S8:'Annexe – Grille détaillée',S9:'Contacts',
 default_title:'Restitution Audit Analytics',situation:'Situation actuelle',impact:'Impact',recommandations:'Recommandations',preuve:'Preuve',feedback:'Feedback client',fb_comment:'Commentaire…',fb_status:'Statut de correction',
 todo:'À faire',doing:'En cours',fixed:'Corrigé',tested:'Recetté',fiche:'Fiche',prev:'Précédente',next:'Suivante',masked:'Masqué de la restitution (conservé dans l’annexe)',
 criticite:'Criticité',effort:'Effort',type:'Type',quadrant:'Quadrant',outils:'Outil(s)',criteres_lies:'Critères liés',impact_score:'Impact',
 eff_S:'S (< 1 sem.)',eff_M:'M (1 à 3 sem.)',eff_L:'L (> 3 sem.)',weeks:'sem.',QuickWin:'Quick Win',LongueTraine:'Longue traîne',
 QW:'Quick Win',LT:'Longue traîne',DER:'En dernier',PEU:'Peu d’impact',
 Q_QW:'Tâches importantes, peu d’effort à fournir',Q_LT:'Tâches longue traîne avec impact, à prioriser',Q_DER:'Peu d’impact et d’efforts, à adresser en dernier',Q_PEU:'Peu d’impact, beaucoup d’efforts à consacrer',
 OK:'OK',PARTIEL:'Partiel',KO:'KO',NA:'Non concerné',INCONNU:'Inconnu',A_REVOIR:'À revoir',
 HAUTE:'Haute',MOYENNE:'Moyenne',FAIBLE:'Faible',AUCUNE:'Aucune',
 CONFIGURATION:'Configuration',DATA_QUALITY:'Data Quality',COMPLIANCE:'Conformité',
 bon:'Bon',moyen:'Moyen',faible:'Faible',na:'n/a',score_global:'Score général',by_pilier:'Par pilier',by_axe:'Par axe',
 cross:'Répartition statut × criticité',total:'Total',coverage:'Couverture',evalues:'évalués',informatif:'informatifs',top5:'Les 5 actions prioritaires',
 scores_note:'Scores calculés sur l’ensemble des critères évalués : les filtres ne les modifient pas.',hidden_note:'Scores masqués pour cette restitution.',
 en_cours:'En cours',ctx:'Contexte de la restitution',methode:'Méthode',mention_ext:'Analyse externe, sans accès aux outils : certains critères n’ont pas pu être vérifiés.',
 elements:'Éléments contrôlés',outils_l:'Outils',impact_axis:'Impact',effort_axis:'Effort',fort:'Fort',moyen_i:'Moyen',faible_i:'Faible',
 table_view:'Afficher la matrice sous forme de tableau',next_phase:'Phase suivante',merci:'Merci',search:'Rechercher un critère, un commentaire…',all:'Tous',
 axe:'Axe',top_prio:'Top prio',export_filtered:'Exporter le résultat (CSV)',col_pilier:'Pilier',col_outil:'Outil',col_sujet:'Sujet',col_critere:'Critère',col_statut:'Statut',col_crit:'Criticité',col_comment:'Commentaire',col_constat:'Constat lié',
 rows:'critères',reset:'Réinitialiser',filters:'Filtres',active:'actif(s)',pilier:'Pilier',statut:'Statut',outil:'Outil',
 edit:'Édition',present:'Présenter',export:'Exporter',import:'Importer',report:'Rapport d’import',params:'Paramètres',
 no_fiche:'Aucun constat ne correspond aux filtres.',add_bullet:'+ puce',visible:'Visible dans la restitution',auto:'Auto',calc:'calculé',
 no_proof:'Aucune preuve fournie',more:'autres constats : voir l’annexe',edit_mode:'Mode édition : les résultats techniques restent en lecture seule',
 manual:'manuel',reset_order:'Rétablir l’ordre calculé',drag_hint:'Glissez un point pour surcharger son impact et son effort.',
 objective:'Objectif'},
en:{S0b:'Agenda',cadrage:'Engagement framing',besoin:'Need',objectifs:'Objectives',contraintes:'Constraints',livrables:'Deliverables',
 acces_titre:'Access required for controls not performed',acces_outil:'Tool',acces_demande:'Requested access',acces_criteres:'Pending criteria',acces_statut:'Request status',acces_contact:'Contact',
 a_demander:'To request',demande:'Requested',obtenu:'Granted',refuse:'Refused',acces_none:'All planned controls could be performed.',
 etape:'Analysed step',reconstituee:'Panel rebuilt from the recorded requests',capture_reelle:'Real screenshot',INFO:'Info',
 logo_client:'Client logo',image_corporate:'Client corporate image',placeholder_hint:'Placeholder to fill in (edit mode › Settings)',
 fiches:'findings',page:'p.',artefact:'Standalone HTML artefact',artefact_d:'Single offline file, data included',
 parcours:'Analysed journey',preuves_n:'pieces of evidence',annot_resume:'annotations',
 S0:'Cover',S1:'Context & roadmap',S2:'Scope & objectives',S3:'Scorecard',S3b:'Summary',S4:'Prioritised overview',S5:'Findings',S6:'Impact × Effort matrix',S7:'Next steps',S8:'Appendix – Detailed grid',S9:'Contacts',
 default_title:'Analytics Audit Report',situation:'Current situation',impact:'Impact',recommandations:'Recommendations',preuve:'Evidence',feedback:'Client feedback',fb_comment:'Comment…',fb_status:'Fix status',
 todo:'To do',doing:'In progress',fixed:'Fixed',tested:'Verified',fiche:'Finding',prev:'Previous',next:'Next',masked:'Hidden from the report (kept in the appendix)',
 criticite:'Criticality',effort:'Effort',type:'Type',quadrant:'Quadrant',outils:'Tool(s)',criteres_lies:'Linked criteria',impact_score:'Impact',
 eff_S:'S (< 1 wk)',eff_M:'M (1–3 wks)',eff_L:'L (> 3 wks)',weeks:'wks',QuickWin:'Quick win',LongueTraine:'Long tail',
 QW:'Quick win',LT:'Long tail',DER:'Last',PEU:'Low impact',
 Q_QW:'High impact, little effort required',Q_LT:'Long-tail tasks with impact, to prioritise',Q_DER:'Low impact and effort, to address last',Q_PEU:'Low impact, significant effort required',
 OK:'OK',PARTIEL:'Partly',KO:'KO',NA:'Not concerned',INCONNU:'Unknown',A_REVOIR:'To review',
 HAUTE:'High',MOYENNE:'Medium',FAIBLE:'Low',AUCUNE:'None',
 CONFIGURATION:'Configuration',DATA_QUALITY:'Data Quality',COMPLIANCE:'Compliance',
 bon:'Good',moyen:'Average',faible:'Poor',na:'n/a',score_global:'Overall score',by_pilier:'By pillar',by_axe:'By axis',
 cross:'Status × criticality breakdown',total:'Total',coverage:'Coverage',evalues:'assessed',informatif:'informative',top5:'Top 5 priority actions',
 scores_note:'Scores are computed on all assessed criteria: filters do not change them.',hidden_note:'Scores are hidden for this report.',
 en_cours:'Current',ctx:'Report context',methode:'Method',mention_ext:'External analysis without tool access: some criteria could not be verified.',
 elements:'Controlled elements',outils_l:'Tools',impact_axis:'Impact',effort_axis:'Effort',fort:'High',moyen_i:'Medium',faible_i:'Low',
 table_view:'Show the matrix as a table',next_phase:'Next phase',merci:'Thank you',search:'Search a criterion, a comment…',all:'All',
 axe:'Axis',top_prio:'Top priority',export_filtered:'Export result (CSV)',col_pilier:'Pillar',col_outil:'Tool',col_sujet:'Subject',col_critere:'Criterion',col_statut:'Status',col_crit:'Criticality',col_comment:'Comment',col_constat:'Linked finding',
 rows:'criteria',reset:'Reset',filters:'Filters',active:'active',pilier:'Pillar',statut:'Status',outil:'Tool',
 edit:'Edit',present:'Present',export:'Export',import:'Import',report:'Import report',params:'Settings',
 no_fiche:'No finding matches the filters.',add_bullet:'+ bullet',visible:'Visible in the report',auto:'Auto',calc:'computed',
 no_proof:'No evidence provided',more:'more findings: see appendix',edit_mode:'Edit mode: technical results stay read-only',
 manual:'manual',reset_order:'Restore computed order',drag_hint:'Drag a point to override its impact and effort.',
 objective:'Objective'}
};

let LANG: Lang = 'fr';
export const getLang = () => LANG;
export const setLang = (l: Lang) => { LANG = l; };
export const t = (k: string): string => BASE[LANG]?.[k] ?? BASE.fr[k] ?? k;
/** Valeur localisée {fr, en} → chaîne de la langue courante. */
export const tx = (v: Localise | undefined | null): string =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v[LANG] ?? v.fr ?? Object.values(v)[0] ?? '') : (v as string) ?? '';

/** Markdown restreint (§7, D5) : **gras**, `code`, [lien](https://…). */
export function md(s: Localise | undefined): string {
  let h = esc(tx(s) || '');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h;
}
export function bullets(arr: Puce[] | undefined): string {
  return '<ul>' + (arr || []).map(b => {
    if (b && typeof b === 'object' && 'texte' in b)
      return `<li>${md(b.texte)}${b.sous_puces?.length ? '<ul>' + b.sous_puces.map(s => `<li>${md(s)}</li>`).join('') + '</ul>' : ''}</li>`;
    return `<li>${md(b as Localise)}</li>`;
  }).join('') + '</ul>';
}
export function fmtMonth(ym: string | undefined, short?: boolean): string {
  if (!ym) return '';
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(LANG === 'fr' ? 'fr-FR' : 'en-GB', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}
