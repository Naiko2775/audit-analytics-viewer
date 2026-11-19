/**
 * Convertisseur de la grille de scoring « 230906_Scoring_Template.xlsx » vers audit.json 1.1
 * (DAT-30, avec DAT-07 normalisation, DAT-08 Subject → axe et domaine, DAT-10 défauts connus, DAT-11 Universal Analytics).
 *
 * Tolérance : onglets détectés par nom approché, ligne d'en-tête détectée (première ligne avec au moins 3 en-têtes connus,
 * dont Criteria), en-têtes EN/FR insensibles à la casse, aux accents et aux espaces, colonnes dans n'importe quel ordre,
 * cellules fusionnées (recopiées par le lecteur) et Category / Subject laissés vides (report de la valeur précédente).
 *
 * Choix par défaut des piliers (paramétrables via `opts.piliers`) :
 *  - « Consentement & conformité » : onglet Compliance (CMP) + tout critère dont le Subject vaut Compliance ;
 *  - « Qualité du dataLayer & TMS » : onglets Data Layer Quality et Google Tag Manager ;
 *  - « Configuration analytics » : onglets Google Analytics 4 et Universal Analytics (obsolète).
 * Règle d'affectation : un pilier qui déclare l'axe du critère (`axes`) l'emporte ; sinon le premier qui déclare son domaine.
 */
import type { Audit, Constat, Critere, Criticite, Localise, Outil, Pilier, Statut } from './types.ts';
import type { Issue } from './validate.ts';
import { normStatut } from './rules.ts';
import { readXlsx, type Cell, type Sheet } from './xlsx-read.ts';

export type DomainCode = 'DL' | 'GTM' | 'GA4' | 'CMP' | 'UA';
export type Axe = 'CONFIGURATION' | 'DATA_QUALITY' | 'COMPLIANCE';
export interface PilierRegle { id: string; libelle: Localise; pictogramme?: string; domaines: DomainCode[]; axes?: Axe[] }
export interface GridOptions {
  client?: string;
  date?: string;
  /** Regroupement des domaines en piliers ; défaut : DEFAULT_PILIERS. */
  piliers?: PilierRegle[];
  /** Onglet source : EN (onglets par domaine), FR (onglet « Réponses ») ou automatique (le plus renseigné). */
  source?: 'auto' | 'en' | 'fr';
  /** Universal Analytics : archivé avec obsolete: true (décision Q9, défaut) ou retiré. */
  ua?: 'archiver' | 'retirer';
  /** Inversion Impact / Suggested corrective action (DAT-10) : 'auto' détecte sur le contenu, true force l'échange. */
  inverserImpactAction?: boolean | 'auto';
  /** Corrections ponctuelles par id_grille (ex. table métier du décalage GTM 29 à 31, DAT-10). */
  corrections?: Record<string, { question?: string; element_controle?: string }>;
  /** Génère des constats brouillons pour les KO / PARTIEL de criticité HAUTE ou MOYENNE (défaut true). */
  constats?: boolean;
}
export interface GridReport { E: Issue[]; W: Issue[]; I: Issue[] }
export interface GridResult { audit: Audit | null; report: GridReport }

export const DEFAULT_PILIERS: PilierRegle[] = [
  { id: 'consentement', libelle: { fr: 'Consentement & conformité', en: 'Consent & compliance' }, pictogramme: 'shield', domaines: ['CMP'], axes: ['COMPLIANCE'] },
  { id: 'datalayer', libelle: { fr: 'Qualité du dataLayer & TMS', en: 'DataLayer & TMS quality' }, pictogramme: 'terminal', domaines: ['DL', 'GTM'] },
  { id: 'analytics', libelle: { fr: 'Configuration analytics', en: 'Analytics configuration' }, pictogramme: 'chart', domaines: ['GA4', 'UA'] },
];

/** Domaines de la grille (§2.1) → domaine agnostique (DAT-08), effectif de référence et outil par défaut. */
export const DOMAINES: Record<DomainCode, { libelle: string; domaine: string; ref: number; outil: string; axe: Axe }> = {
  DL: { libelle: 'Data Layer Quality', domaine: 'DataLayer', ref: 23, outil: 'gtm', axe: 'DATA_QUALITY' },
  GTM: { libelle: 'Google Tag Manager', domaine: 'TMS', ref: 32, outil: 'gtm', axe: 'CONFIGURATION' },
  GA4: { libelle: 'Google Analytics 4', domaine: 'Analytics', ref: 47, outil: 'ga4', axe: 'CONFIGURATION' },
  CMP: { libelle: 'Compliance OneTrust', domaine: 'CMP', ref: 4, outil: 'onetrust', axe: 'COMPLIANCE' },
  UA: { libelle: 'Universal Analytics', domaine: 'Analytics', ref: 23, outil: 'ua', axe: 'CONFIGURATION' },
};
const OUTILS: Record<string, Outil> = {
  gtm: { id: 'gtm', libelle: 'GTM', nom_complet: 'Google Tag Manager', categorie: 'TMS', logo: null, couleur: '#246FDB' },
  ga4: { id: 'ga4', libelle: 'GA4', nom_complet: 'Google Analytics 4', categorie: 'Analytics', logo: null, couleur: '#E37400' },
  ua: { id: 'ua', libelle: 'Universal Analytics', nom_complet: 'Google Universal Analytics', categorie: 'Analytics', logo: null, couleur: '#9AA0A6' },
  onetrust: { id: 'onetrust', libelle: 'OneTrust', categorie: 'CMP', logo: null, couleur: '#6CC04A' },
  didomi: { id: 'didomi', libelle: 'Didomi', categorie: 'CMP', logo: null, couleur: '#1A2B6D' },
  axeptio: { id: 'axeptio', libelle: 'Axeptio', categorie: 'CMP', logo: null },
  usercentrics: { id: 'usercentrics', libelle: 'Usercentrics', categorie: 'CMP', logo: null },
  matomo: { id: 'matomo', libelle: 'Matomo', categorie: 'Analytics', logo: null, couleur: '#3152A0' },
  piano: { id: 'piano', libelle: 'Piano Analytics', categorie: 'Analytics', logo: null },
  tealium: { id: 'tealium', libelle: 'Tealium', categorie: 'TMS', logo: null },
};

// ───────────── Normalisation de texte et d'en-têtes ─────────────
export const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, ' ').replace(/[^a-z0-9#+]+/g, ' ').trim();
const str = (v: Cell | undefined) => (v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim());

type Key = 'id' | 'category' | 'subject' | 'criteria' | 'element' | 'evaluation' | 'criticality' | 'comment' | 'impact' | 'action' | 'review' | 'toppr' | 'domain' | 'tool' | 'axe';
const HEADERS: [Key, string[]][] = [
  ['id', ['id', '#', 'n', 'no', 'n#', 'num', 'numero', 'nr', 'ref', 'reference', 'id grille', 'criteria id', 'id critere']],
  ['category', ['category', 'categorie', 'categories', 'categ']],
  ['subject', ['subject', 'sujet', 'theme', 'thematique', 'topic']],
  ['element', ['controlled elements', 'controlled element', 'elements controles', 'element controle', 'elements a controler', 'element a controler', 'elements verifies', 'checked elements', 'controle']],
  ['criteria', ['criteria', 'criterion', 'criterias', 'critere', 'criteres', 'question', 'questions', 'point de controle']],
  ['evaluation', ['evaluation', 'evaluations', 'answer', 'answers', 'reponse', 'reponses', 'status', 'statut', 'result', 'resultat', 'assessment', 'conforme']],
  ['criticality', ['criticality', 'criticity', 'criticite', 'severity', 'severite', 'gravite']],
  ['comment', ['comment', 'comments', 'commentaire', 'commentaires', 'observation', 'observations', 'remarque', 'remarques', 'notes']],
  ['impact', ['impact', 'impacts', 'business impact', 'impact metier']],
  ['action', ['suggested corrective action', 'suggested corrective actions', 'corrective action', 'corrective actions', 'suggested action', 'action corrective', 'actions correctives', 'action corrective suggeree', 'action corrective proposee', 'recommendation', 'recommendations', 'recommandation', 'recommandations']],
  ['review', ['review', 'reviews', 'revue', 'relecture', 'reviewer']],
  ['toppr', ['top prio', 'top priority', 'top priorite', 'top', 'prioritaire', 'priorite haute']],
  ['domain', ['domain', 'domaine', 'perimetre', 'scope', 'onglet']],
  ['tool', ['tool', 'tools', 'outil', 'outils', 'solution', 'solutions', 'product', 'produit']],
  ['axe', ['axe', 'axis', 'axe score', 'axe de score', 'scoring axis']],
];
const ALIAS_LIST = HEADERS.flatMap(([k, al]) => al.map(a => [k, a] as [Key, string])).sort((a, b) => b[1].length - a[1].length);
/** En-tête → clé connue (égalité, puis préfixe de mot, alias les plus longs d'abord). */
export function headerKey(v: unknown): Key | null { return headerMatch(v)?.[0] ?? null; }
/** [clé, rang] : le rang (0 = exact sur l'alias principal) départage deux colonnes candidates à la même clé. */
function headerMatch(v: unknown): [Key, number] | null {
  const h = norm(v);
  if (!h || h.length > 60) return null;
  const rank = (k: Key, a: string, pre: number) => [k, pre + HEADERS.find(x => x[0] === k)![1].indexOf(a)] as [Key, number];
  for (const [k, a] of ALIAS_LIST) if (h === a) return rank(k, a, 0);
  for (const [k, a] of ALIAS_LIST) if (a.length >= 4 && (h.startsWith(a + ' ') || h.startsWith(a + '+'))) return rank(k, a, 100);
  return null;
}
type ColMap = Partial<Record<Key, number>>;
function detectHeader(rows: Cell[][], from = 0, max = 40): { row: number; cols: ColMap } | null {
  for (let r = from; r < Math.min(rows.length, from + max); r++) {
    const cols: ColMap = {}, best: Partial<Record<Key, number>> = {};
    (rows[r] || []).forEach((v, c) => {
      const m = headerMatch(v);
      if (m && (best[m[0]] == null || m[1] < best[m[0]]!)) { cols[m[0]] = c; best[m[0]] = m[1]; }
    });
    // En-tête « Criteria + Controlled elements » fusionné sur deux colonnes : la seconde porte l'élément contrôlé.
    const row = rows[r] || [];
    if (cols.criteria != null && cols.element == null && /element|controle/.test(norm(row[cols.criteria])) && norm(row[cols.criteria + 1]) === norm(row[cols.criteria])) cols.element = cols.criteria + 1;
    if (Object.keys(cols).length >= 3 && cols.criteria != null) return { row: r, cols };
  }
  return null;
}

// ───────────── Domaines et onglets ─────────────
/** Nom d'onglet (ou libellé de section / de colonne) → domaine de la grille. */
export function detectDomain(v: unknown): DomainCode | null {
  const n = norm(v);
  if (!n) return null;
  if (/\buniversal\b|\bua\b|\bga ?3\b|\buniversal analytics\b/.test(n)) return 'UA';
  if (/data ?layer|\bdl\b|\bdlq\b/.test(n)) return 'DL';
  if (/\bgtm\b|tag ?manager|\btms\b|tag management|tealium|commanders act/.test(n)) return 'GTM';
  if (/\bga ?4\b|analytics 4|google analytics|\bmatomo\b|\bpiano\b|\banalytics\b/.test(n)) return 'GA4';
  if (/compliance|onetrust|one trust|consent|consentement|\bcmp\b|didomi|axeptio|usercentrics|conformite|\brgpd\b|\bgdpr\b|privacy/.test(n)) return 'CMP';
  return null;
}
type SheetKind = { kind: 'domain'; dom: DomainCode } | { kind: 'fr' } | { kind: 'tracking' } | { kind: 'content' } | { kind: 'other' };
export function sheetKind(name: string): SheetKind {
  const n = norm(name);
  if (/\breponses?\b|\bresponses?\b|\banswers?\b|\bfr\b|francais/.test(n)) return { kind: 'fr' };
  if (/^\d*\s*(content|contents|sommaire|synthese|summary|scores?|dashboard)\b/.test(n) || /\bcontent\b/.test(n)) return { kind: 'content' };
  if (/\btracking\b|plan de marquage/.test(n)) return { kind: 'tracking' };
  const d = detectDomain(name);
  return d ? { kind: 'domain', dom: d } : { kind: 'other' };
}
const toolFromText = (v: unknown): string | null => {
  const n = norm(v);
  for (const id of ['didomi', 'onetrust', 'axeptio', 'usercentrics', 'matomo', 'piano', 'tealium']) if (n.replace(/ /g, '').includes(id)) return id;
  if (/\bgtm\b|tag manager/.test(n)) return 'gtm';
  if (/\bga ?4\b|analytics 4/.test(n)) return 'ga4';
  if (/universal|\bua\b/.test(n)) return 'ua';
  return null;
};
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'outil';

// ───────────── Référentiels (DAT-07, DAT-08) ─────────────
const STATUT_EXTRA: Record<string, Statut> = {
  'yes': 'OK', 'y': 'OK', 'ok': 'OK', 'oui': 'OK', 'conforme': 'OK', 'compliant': 'OK', 'done': 'OK',
  'no': 'KO', 'n': 'KO', 'ko': 'KO', 'non': 'KO', 'non conforme': 'KO', 'not compliant': 'KO',
  'partly': 'PARTIEL', 'partial': 'PARTIEL', 'partially': 'PARTIEL', 'partiel': 'PARTIEL', 'partielle': 'PARTIEL', 'partiellement': 'PARTIEL',
  'not concerned': 'NA', 'not applicable': 'NA', 'non concerne': 'NA', 'non applicable': 'NA', 'na': 'NA', 'sans objet': 'NA', 'hors perimetre': 'NA',
  'unknown': 'INCONNU', 'inconnu': 'INCONNU', 'non evalue': 'INCONNU', 'not evaluated': 'INCONNU', 'not checked': 'INCONNU', 'non verifiable': 'INCONNU',
  'a revoir': 'A_REVOIR', 'to review': 'A_REVOIR', 'to be reviewed': 'A_REVOIR', 'review': 'A_REVOIR', 'a verifier': 'A_REVOIR',
};
/** Évaluation EN/FR → statut normalisé ; null si non reconnue (le critère passe alors à INCONNU avec avertissement). */
export function normEvaluation(v: unknown): Statut | null {
  const raw = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (/^n\s*\/\s*a\.?$/i.test(raw)) return 'NA'; // « N/A » exact (« N/A ? » reste non reconnu, DAT-07)
  return normStatut(raw) || STATUT_EXTRA[norm(raw)] || null;
}
const CRIT_ALIAS: Record<string, Criticite> = {
  'high': 'HAUTE', 'haute': 'HAUTE', 'haut': 'HAUTE', 'elevee': 'HAUTE', 'eleve': 'HAUTE', 'critical': 'HAUTE', 'critique': 'HAUTE', 'forte': 'HAUTE', '3': 'HAUTE',
  'medium': 'MOYENNE', 'moyenne': 'MOYENNE', 'moyen': 'MOYENNE', 'moderate': 'MOYENNE', 'moderee': 'MOYENNE', '2': 'MOYENNE',
  'low': 'FAIBLE', 'faible': 'FAIBLE', 'basse': 'FAIBLE', 'bas': 'FAIBLE', 'minor': 'FAIBLE', 'mineure': 'FAIBLE', '1': 'FAIBLE',
  'no impact': 'AUCUNE', 'none': 'AUCUNE', 'aucune': 'AUCUNE', 'aucun': 'AUCUNE', 'aucun impact': 'AUCUNE', 'sans impact': 'AUCUNE', 'no': 'AUCUNE', '0': 'AUCUNE',
};
export const normCriticite = (v: unknown): Criticite | null => {
  const n = norm(v);
  if (!n) return null;
  if (['HAUTE', 'MOYENNE', 'FAIBLE', 'AUCUNE'].includes(n.toUpperCase())) return n.toUpperCase() as Criticite;
  return CRIT_ALIAS[n] || null;
};
/** Subject → axe de score (§7.1, DAT-08). */
export function axeFromSubject(v: unknown): Axe | null {
  const n = norm(v);
  if (!n) return null;
  if (/compliance|conformite|rgpd|gdpr|privacy|consent/.test(n)) return 'COMPLIANCE';
  if (/data ?quality|qualite|quality/.test(n)) return 'DATA_QUALITY';
  if (/administration|configuration|naming|nommage|nomenclature|product|produit|linking|liaison|parametrage|setup/.test(n)) return 'CONFIGURATION';
  return null;
}
const normAxe = (v: unknown): Axe | null => {
  const n = norm(v).replace(/ /g, '_').toUpperCase();
  return n === 'CONFIGURATION' || n === 'DATA_QUALITY' || n === 'COMPLIANCE' ? n : axeFromSubject(v);
};
const truthy = (v: unknown) => /^(x|yes|oui|y|o|1|true|vrai|top|top prio|✓|✔|★|\*)$/.test(norm(v) || String(v ?? '').trim().toLowerCase());

// ───────────── Lecture des lignes ─────────────
interface Raw {
  dom: DomainCode; sheet: string; row: number; ord: number; idRaw: string; category: string; subject: string; question: string; element: string;
  evaluation: string; criticality: string; comment: string; impact: string; action: string; review: string; top: boolean; tool: string; axe: string;
}
interface Parsed { raws: Raw[]; cols: ColMap; sheet: string }

const looksAction = (s: string) => /^(mettre|configurer|ajouter|corriger|supprimer|creer|definir|activer|desactiver|verifier|implementer|deployer|renommer|remplacer|documenter|installer|utiliser|paramet|harmoniser|add|set|create|implement|configure|remove|fix|define|enable|disable|use|rename|replace|update|check|ensure|deploy|review|install|document|move)\b/.test(norm(s));

const JUNK = /^(total|totaux|sous total|subtotal|score|scores|moyenne|average)( [a-z0-9 ]{0,20})?$/;

function parseRows(sheet: Sheet, fixedDom: DomainCode | null, rep: GridReport): Parsed | null {
  const h = detectHeader(sheet.rows);
  if (!h) return null;
  const { cols } = h;
  const g = (row: Cell[], k: Key) => (cols[k] == null ? '' : str(row[cols[k]!]));
  const raws: Raw[] = [];
  const weak: Raw[] = []; // lignes sans identifiant, évaluation ni criticité : conservées seulement si suivies d'un vrai critère
  const ord: Partial<Record<DomainCode, number>> = {};
  let dom = fixedDom, category = '', subject = '';
  for (let r = h.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const cells = row.map(str).filter(Boolean);
    if (!cells.length) continue; // ligne vide
    if (cells.length <= 2 && /^(legend|legende|caption)\b/.test(norm(cells[0]))) break; // légende sous le tableau
    if (detectHeader([row], 0, 1)) continue; // en-tête répété
    const question = g(row, 'criteria');
    // Ligne de section (une seule valeur, fusionnée ou hors de la colonne Criteria) : peut changer de domaine dans l'onglet « Réponses ».
    if (new Set(cells).size === 1) {
      const d = detectDomain(cells[0]);
      const onlyQuestion = cells.length === 1 && !!question && !d;
      if (!onlyQuestion) { if (d && !fixedDom) dom = d; continue; }
    }
    if (!question) { if (cells.length > 1) rep.I.push({ code: 'GRILLE_LIGNE', objet: `${sheet.name} ligne ${r + 1}`, message: 'Ligne sans libellé de critère : ignorée.' }); continue; }
    if (question.length < 30 && JUNK.test(norm(question))) { rep.I.push({ code: 'GRILLE_LIGNE', objet: `${sheet.name} ligne ${r + 1}`, message: `« ${question} » : ligne de total ou de score, ignorée.` }); continue; }
    const idRaw = g(row, 'id'), evaluation = g(row, 'evaluation'), criticality = g(row, 'criticality');
    category = g(row, 'category') || category; subject = g(row, 'subject') || subject;
    let rowDom = dom;
    // Priorité : colonne Domaine, préfixe de l'ID, ligne de section, puis colonne Outil (un critère DataLayer peut citer GTM).
    if (!fixedDom) rowDom = detectDomain(g(row, 'domain')) || detectDomain(idRaw.replace(/[-_ .]*\d+$/, '')) || dom || detectDomain(g(row, 'tool'));
    if (!rowDom) { rep.W.push({ code: 'GRILLE_DOMAINE', objet: `${sheet.name} ligne ${r + 1}`, message: `Domaine non déterminé pour « ${question.slice(0, 60)} » : ligne ignorée.` }); continue; }
    const raw: Raw = {
      dom: rowDom, sheet: sheet.name, row: r + 1, ord: 0, idRaw, category, subject, question, element: g(row, 'element'),
      evaluation, criticality, comment: g(row, 'comment'), impact: g(row, 'impact'), action: g(row, 'action'), review: g(row, 'review'),
      top: truthy(g(row, 'toppr')), tool: g(row, 'tool'), axe: g(row, 'axe'),
    };
    if (!idRaw && !evaluation && !criticality) { weak.push(raw); continue; }
    // Un critère réel suit : les lignes faibles intermédiaires sont des critères non renseignés (numérotation préservée).
    for (const w of weak) {
      w.ord = ord[w.dom] = (ord[w.dom] || 0) + 1; raws.push(w);
      rep.I.push({ code: 'GRILLE_LIGNE', objet: `${sheet.name} ligne ${w.row}`, message: `« ${w.question.slice(0, 60)} » : ni identifiant, ni évaluation, ni criticité. Conservé en INCONNU.` });
    }
    weak.length = 0;
    raw.ord = ord[rowDom] = (ord[rowDom] || 0) + 1;
    raws.push(raw);
  }
  for (const w of weak) rep.I.push({ code: 'GRILLE_LIGNE', objet: `${sheet.name} ligne ${w.row}`, message: `« ${w.question.slice(0, 60)} » : ligne sous le tableau sans identifiant, évaluation ni criticité. Ignorée.` });
  return { raws, cols, sheet: sheet.name };
}

/** DAT-10 : détecte l'inversion des légendes Impact / Suggested corrective action (définitions dans une zone de légende). */
function legendInversion(sheets: Sheet[]): string | null {
  for (const s of sheets) for (let r = 0; r < s.rows.length; r++) {
    const row = s.rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const k = headerKey(row[c]);
      if (k !== 'impact' && k !== 'action') continue;
      const next = row.slice(c + 1).find(v => str(v));
      if (next == null || (headerMatch(next)?.[1] ?? 100) < 100 || str(next).length < 20) continue; // ligne d'en-tête, pas de légende
      const def = norm(next);
      if (k === 'impact' && /\b(action|correct|fix|recommend|recommand|corrig|to do|a mettre en place)/.test(def)) return `${s.name} ligne ${r + 1}`;
      if (k === 'action' && /\b(impact|consequence|risque|risk|business|effet)\b/.test(def) && !/\b(action|correct)/.test(def)) return `${s.name} ligne ${r + 1}`;
    }
  }
  return null;
}

const trunc = (s: string, n = 80) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const firstLine = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
const bullets = (s: string) => s ? [s.replace(/\s*\n\s*/g, ' ').trim()] : [];

/** Convertit une grille XLSX en audit.json 1.1 et produit un rapport de conversion (codes GRILLE_*). */
export function convertGrid(bytes: Uint8Array, opts: GridOptions = {}): GridResult {
  const rep: GridReport = { E: [], W: [], I: [] };
  const add = (n: 'E' | 'W' | 'I', code: string, objet: string, message: string) => rep[n].push({ code, objet, message });
  let sheets: Sheet[];
  try { sheets = readXlsx(bytes).sheets; } catch (e: any) { add('E', 'GRILLE_FICHIER', 'Fichier', e?.message || 'Classeur illisible.'); return { audit: null, report: rep }; }

  // 1. Lecture des onglets
  const en: Parsed[] = [], fr: Parsed[] = [], tracking: Parsed[] = [];
  let contentSheet: Sheet | null = null;
  for (const s of sheets) {
    const k = sheetKind(s.name);
    if (k.kind === 'content') { contentSheet = contentSheet || s; continue; }
    if (k.kind === 'other' && !detectHeader(s.rows)) { add('I', 'GRILLE_ONGLET', s.name, 'Onglet non reconnu : ignoré.'); continue; }
    const p = parseRows(s, k.kind === 'domain' ? k.dom : k.kind === 'tracking' ? 'DL' : null, rep);
    if (!p) { add('W', 'GRILLE_ENTETE', s.name, 'Aucune ligne d’en-tête reconnue (Criteria, Evaluation, Criticality…) : onglet ignoré.'); continue; }
    if (p.cols.evaluation == null) add('W', 'GRILLE_ENTETE', s.name, 'Colonne Evaluation introuvable : critères convertis en INCONNU.');
    if (p.cols.criticality == null) add('W', 'GRILLE_ENTETE', s.name, 'Colonne Criticality introuvable : criticité MOYENNE retenue.');
    (k.kind === 'fr' ? fr : k.kind === 'tracking' ? tracking : en).push(p);
    if (k.kind === 'other') add('I', 'GRILLE_ONGLET', s.name, 'Nom d’onglet non reconnu, mais tableau de critères détecté : domaine lu ligne par ligne.');
  }
  if (contentSheet) add('I', 'GRILLE_SYNTHESE', contentSheet.name, 'Onglet de synthèse lu pour le client et la date uniquement : les scores sont recalculés par le moteur (§8).');

  const evaluated = (ps: Parsed[]) => ps.reduce((n, p) => n + p.raws.filter(r => r.evaluation).length, 0);
  const nEn = en.reduce((n, p) => n + p.raws.length, 0), nFr = fr.reduce((n, p) => n + p.raws.length, 0);
  let langue: 'en' | 'fr' = 'en';
  let src = en;
  if (opts.source === 'fr' || (opts.source !== 'en' && nFr && (!nEn || evaluated(fr) > evaluated(en)))) { src = fr; langue = 'fr'; }
  if (opts.source === 'en' && !nEn && nFr) { src = fr; langue = 'fr'; add('W', 'GRILLE_SOURCE', 'Classeur', 'Onglets EN demandés mais absents ou vides : onglet « Réponses » utilisé.'); }
  if (opts.source === 'fr' && !nFr) { src = en; langue = 'en'; add('W', 'GRILLE_SOURCE', 'Classeur', 'Onglet « Réponses » demandé mais absent ou vide : onglets EN utilisés.'); }
  if (nEn && nFr) add('I', 'GRILLE_SOURCE', 'Classeur', langue === 'fr'
    ? `Onglet « Réponses » (FR) retenu : ${evaluated(fr)} critères évalués contre ${evaluated(en)} dans les onglets EN.`
    : `Onglets EN retenus : ${evaluated(en)} critères évalués contre ${evaluated(fr)} dans l’onglet « Réponses ».`);
  const raws = src.flatMap(p => p.raws);
  if (!raws.length) {
    add('E', 'GRILLE_VIDE', 'Classeur', sheets.length ? 'Aucun critère trouvé : onglets Data Layer, GTM, GA4, Compliance ou Réponses attendus, avec une ligne d’en-tête (Criteria, Evaluation, Criticality).' : 'Classeur sans feuille.');
    return { audit: null, report: rep };
  }

  // 2. DAT-10 : inversion Impact / Suggested corrective action
  const legend = legendInversion(sheets);
  if (legend) add('W', 'GRILLE_LEGENDE', legend, 'Légendes « Impact » et « Suggested corrective action » inversées (défaut connu de la grille 230906) : la sémantique des colonnes est retenue, pas celle de la légende.');
  let swap = opts.inverserImpactAction === true;
  if (opts.inverserImpactAction === 'auto' || opts.inverserImpactAction == null) {
    const imp = raws.filter(r => r.impact), act = raws.filter(r => r.action);
    const impA = imp.filter(r => looksAction(r.impact)).length, actA = act.filter(r => looksAction(r.action)).length;
    if (imp.length >= 3 && act.length >= 3 && impA / imp.length >= 0.6 && actA / act.length < 0.3) swap = true;
  }
  if (swap) add('W', 'GRILLE_INVERSION', 'Colonnes Impact / Suggested corrective action', 'Contenus inversés (la colonne Impact contient des actions) : colonnes échangées à la conversion (DAT-10).');

  // 3. Critères
  const criteres: Critere[] = [];
  const ids = new Set<string>();
  const rules = opts.piliers?.length ? opts.piliers : DEFAULT_PILIERS;
  const uncovered = new Set<DomainCode>();
  /** Un pilier qui déclare l'axe l'emporte, sauf pour les critères obsolètes (UA), rattachés par domaine. */
  const pillarOf = (dom: DomainCode, axe: Axe, obsolete = false) => {
    const id = ((obsolete ? undefined : rules.find(p => p.axes?.includes(axe))) || rules.find(p => p.domaines.includes(dom)))?.id;
    if (!id && !uncovered.has(dom)) { uncovered.add(dom); add('W', 'GRILLE_PILIER', DOMAINES[dom].libelle, `Aucun pilier ne couvre ce domaine : critères rattachés au pilier « ${rules[0].id} ».`); }
    return id || rules[0].id;
  };
  const counts: Partial<Record<DomainCode, number>> = {};
  const usedTools = new Map<string, Outil>();
  const qIndex = new Map<string, Critere>();
  const cmpTool = toolFromText(sheets.map(s => s.name).find(n => detectDomain(n) === 'CMP')) || 'onetrust';
  const raw2: Map<string, Raw> = new Map();

  for (const r of raws) {
    if (r.dom === 'UA' && opts.ua === 'retirer') continue;
    const P = r.dom;
    let id = '';
    // ID explicite numérique (« 24 », « GTM-24 », « GTM 024 ») → préfixe canonique du domaine ; sinon numéro d'ordre dans l'onglet.
    const idTxt = r.idRaw.trim();
    const m = /^([A-Za-z][A-Za-z0-9]*?)?[\s\-_.]*0*(\d+)$/.exec(idTxt);
    if (m) id = `${P}-${m[2].padStart(2, '0')}`;
    else if (/^[A-Za-z0-9][\w.-]{0,15}$/.test(idTxt)) id = `${P}-${idTxt.toUpperCase().replace(new RegExp(`^${P}[-_.]?`), '')}`;
    else {
      id = `${P}-${String(r.ord).padStart(2, '0')}`;
      if (idTxt) add('I', 'GRILLE_LIGNE', `${r.sheet} ligne ${r.row}`, `Identifiant « ${idTxt.slice(0, 40)} » inexploitable : « ${id} » retenu.`);
    }
    if (ids.has(id)) { let k = 2; while (ids.has(`${id}-${k}`)) k++; add('W', 'GRILLE_DOUBLON', `${r.sheet} ligne ${r.row}`, `Identifiant « ${id} » déjà utilisé : « ${id}-${k} » retenu.`); id = `${id}-${k}`; }
    ids.add(id);
    const obj = `${id} (${r.sheet} ligne ${r.row})`;

    let statut: Statut = 'INCONNU';
    if (!r.evaluation) add('I', 'GRILLE_NON_EVALUE', obj, 'Critère sans évaluation : INCONNU.');
    else { const s = normEvaluation(r.evaluation); if (s) statut = s; else add('W', 'GRILLE_STATUT', obj, `Évaluation non reconnue « ${r.evaluation} » : INCONNU retenu.`); }
    let criticite = normCriticite(r.criticality);
    if (!criticite) { criticite = 'MOYENNE'; if (statut !== 'NA') add('W', 'GRILLE_CRITICITE', obj, r.criticality ? `Criticité non reconnue « ${r.criticality} » : MOYENNE retenue.` : 'Criticité absente : MOYENNE retenue.'); }

    const derived = axeFromSubject(r.subject);
    let axe: Axe = derived || DOMAINES[P].axe;
    if (!derived && r.subject) add('I', 'GRILLE_AXE', obj, `Subject « ${r.subject} » non reconnu : axe ${axe} déduit du domaine.`);
    const explicit = r.axe ? normAxe(r.axe) : null;
    if (explicit && explicit !== axe) { add('I', 'GRILLE_AXE', obj, `Axe explicite ${explicit} retenu (Subject → ${axe}).`); axe = explicit; }

    const toolId = toolFromText(r.tool) || (P === 'CMP' ? cmpTool : DOMAINES[P].outil);
    const tool = OUTILS[toolId] || { id: slug(r.tool), libelle: r.tool, logo: null };
    if (!OUTILS[toolId] && r.tool) add('I', 'GRILLE_OUTIL', obj, `Outil « ${r.tool} » non référencé : accepté tel quel.`);
    usedTools.set(tool.id, tool);

    let question = r.question, element = r.element;
    if (!element && question.includes('\n')) { const [q, ...rest] = question.split('\n').map(x => x.trim()).filter(Boolean); question = q; element = rest.join(' '); }
    question = question.replace(/\s*\n\s*/g, ' ');
    const fix = opts.corrections?.[id];
    if (fix) { if (fix.question) question = fix.question; if (fix.element_controle) element = fix.element_controle; add('I', 'GRILLE_CORRECTION', obj, 'Correction métier appliquée (question / élément contrôlé).'); }
    else if (P === 'GTM' && /^GTM-(29|30|31)$/.test(id)) add('I', 'GRILLE_DECALAGE', obj, 'Défaut connu de la grille 230906 : question et élément contrôlé possiblement décalés (critères GTM 29 à 31). À vérifier, ou fournir opts.corrections.');

    const c: Critere = {
      id_grille: id, pilier_id: pillarOf(P, axe, P === 'UA'), domaine: DOMAINES[P].domaine, outil: tool.libelle, outil_id: tool.id,
      ...(r.category ? { category: r.category } : {}), ...(r.subject ? { subject: r.subject } : {}), axe_score: axe,
      question, ...(element ? { element_controle: element.replace(/\s*\n\s*/g, ' ') } : {}),
      statut, criticite, ...(r.comment ? { commentaire: r.comment } : {}), top_prio: r.top,
      ...(P === 'UA' ? { obsolete: true } : {}),
    };
    criteres.push(c);
    raw2.set(id, swap ? { ...r, impact: r.action, action: r.impact } : r);
    counts[P] = (counts[P] || 0) + 1;
    qIndex.set(`${P}|${norm(question)}`, c); qIndex.set(`*|${norm(question)}`, c);
  }
  const nUaOut = opts.ua === 'retirer' ? raws.filter(r => r.dom === 'UA').length : 0;
  if (nUaOut) add('I', 'GRILLE_UA', 'Universal Analytics', `${nUaOut} critère(s) Universal Analytics non convertis (retrait pur, décision Q9).`);
  if (criteres.some(c => c.obsolete)) add('I', 'GRILLE_UA', 'Universal Analytics', `${counts.UA} critère(s) Universal Analytics archivé(s) (obsolete: true) : exclus des scores (DAT-11, décision Q9).`);
  (Object.keys(DOMAINES) as DomainCode[]).forEach(d => {
    const n = counts[d] || 0;
    if (n && n !== DOMAINES[d].ref) add('I', 'GRILLE_EFFECTIF', DOMAINES[d].libelle, `${n} critère(s) lus pour ${DOMAINES[d].ref} dans la grille de référence.`);
  });

  // 4. Onglet « Tracking » : Top prio et Unknown, rapprochés des critères par libellé ; sinon ajoutés en DataLayer.
  for (const p of tracking) for (const r of p.raws) {
    const hit = qIndex.get(`${r.dom}|${norm(r.question)}`) || qIndex.get(`*|${norm(r.question)}`);
    if (hit) {
      if (r.top) hit.top_prio = true;
      if (hit.statut === 'INCONNU' && r.evaluation && normEvaluation(r.evaluation)) hit.statut = normEvaluation(r.evaluation)!;
      continue;
    }
    let n = 1; while (ids.has(`TRK-${String(n).padStart(2, '0')}`)) n++;
    const id = `TRK-${String(n).padStart(2, '0')}`; ids.add(id);
    const statut = normEvaluation(r.evaluation) || 'INCONNU';
    const axe = axeFromSubject(r.subject) || 'DATA_QUALITY';
    const tool = OUTILS.gtm; usedTools.set(tool.id, tool);
    criteres.push({ id_grille: id, pilier_id: pillarOf('DL', axe), domaine: 'DataLayer', outil: tool.libelle, outil_id: tool.id, ...(r.subject ? { subject: r.subject } : {}), axe_score: axe, question: r.question.replace(/\s*\n\s*/g, ' '), ...(r.element ? { element_controle: r.element } : {}), statut, criticite: normCriticite(r.criticality) || 'MOYENNE', ...(r.comment ? { commentaire: r.comment } : {}), top_prio: r.top });
    raw2.set(id, r);
    add('I', 'GRILLE_TRACKING', `${id} (${p.sheet} ligne ${r.row})`, 'Élément de l’onglet Tracking sans critère correspondant : ajouté au domaine DataLayer.');
  }

  // 5. Piliers
  const piliers: Pilier[] = rules.map((r, i) => {
    const cs = criteres.filter(c => c.pilier_id === r.id);
    const live = cs.filter(c => !c.obsolete);
    const outils = [...new Set((live.length ? live : cs).map(c => c.outil_id!).filter(Boolean))];
    const elements = [...new Set(cs.filter(c => !c.obsolete).map(c => c.subject).filter(Boolean) as string[])].slice(0, 6);
    return { id: r.id, libelle: r.libelle, ...(r.pictogramme ? { pictogramme: r.pictogramme } : {}), outils, ordre: i + 1, actif: cs.some(c => !c.obsolete), elements };
  }).filter(p => criteres.some(c => c.pilier_id === p.id));

  // 6. Constats brouillons : KO / PARTIEL de criticité HAUTE ou MOYENNE, regroupés par action corrective identique.
  const constats: Constat[] = [];
  if (opts.constats !== false) {
    const groups = new Map<string, Critere[]>();
    for (const c of criteres) {
      if (c.obsolete || !(c.statut === 'KO' || c.statut === 'PARTIEL') || !(c.criticite === 'HAUTE' || c.criticite === 'MOYENNE')) continue;
      const r = raw2.get(c.id_grille)!;
      const key = `${c.pilier_id}|${r.action ? 'a:' + norm(r.action) : 'c:' + c.id_grille}`;
      (groups.get(key) || groups.set(key, []).get(key)!).push(c);
    }
    const W = { HAUTE: 3, MOYENNE: 2 } as Record<string, number>;
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
    let n = 0;
    for (const cs of groups.values()) {
      const rs = cs.map(c => raw2.get(c.id_grille)!);
      const action = rs.find(r => r.action)?.action || '';
      const crit = cs.reduce((m, c) => (W[c.criticite] > W[m] ? c.criticite : m), cs[0].criticite);
      const first = cs[0];
      const titre = action ? trunc(firstLine(action)) : trunc(`${langue === 'fr' ? 'Corriger : ' : 'Fix: '}${first.question}`);
      const lib = (s: string) => langue === 'fr' ? (s === 'KO' ? 'non conforme' : 'partiellement conforme') : (s === 'KO' ? 'not compliant' : 'partly compliant');
      let situation = uniq(rs.flatMap(r => bullets(r.comment)));
      if (!situation.length) situation = cs.map(c => langue === 'fr' ? `Critère ${c.id_grille} « ${c.question} » : ${lib(c.statut)}.` : `Criterion ${c.id_grille} "${c.question}": ${lib(c.statut)}.`);
      const impact = uniq(rs.flatMap(r => bullets(r.impact)));
      const recommandations = uniq(rs.flatMap(r => bullets(r.action)));
      if ([situation, impact, recommandations].some(b => b.length > 4)) add('I', 'GRILLE_CONSTAT', `Constat ${cs.map(c => c.id_grille).join(', ')}`, 'Plus de 4 puces : blocs tronqués à 4.');
      n++;
      constats.push({
        id: `C-${String(n).padStart(2, '0')}`, pilier_id: first.pilier_id, titre_action: titre,
        situation: situation.slice(0, 4), impact: impact.slice(0, 4), recommandations: recommandations.slice(0, 4),
        criticite: crit, effort: 'M', criteres_lies: cs.map(c => c.id_grille), visible: true,
      });
    }
    if (constats.length) add('I', 'GRILLE_CONSTAT', 'Constats', `${constats.length} constat(s) brouillon(s) générés à partir des critères KO / PARTIEL de criticité HAUTE ou MOYENNE : à relire (titre, effort, preuves).`);
  }

  // 7. Client et date : options, sinon onglet de synthèse
  const meta = (re: RegExp) => {
    if (!contentSheet) return '';
    for (const row of contentSheet.rows) for (let c = 0; c < (row || []).length; c++)
      if (re.test(norm(row[c])) && norm(row[c]).length < 30) { const v = row.slice(c + 1).map(str).find(Boolean); if (v) return v; }
    return '';
  };
  const client = opts.client || meta(/^(client|company|customer|entreprise|societe|site|website|annonceur)\b/) || 'Client';
  let date = opts.date || '';
  if (!date) {
    const d = meta(/^(date|audit date|date de l audit|date d audit)\b/);
    const num = Number(d);
    if (d && Number.isFinite(num) && num > 20000 && num < 80000) date = new Date(Math.round((num - 25569) * 86400000)).toISOString().slice(0, 7);
    else if (/^\d{4}-\d{2}/.test(d)) date = d.slice(0, 7);
    else if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(d)) { const [, m, y] = d.split(/[/.-]/); date = `${y}-${m.padStart(2, '0')}`; }
    else if (/^\d{1,2}[/.-]\d{4}$/.test(d)) { const [m, y] = d.split(/[/.-]/); date = `${y}-${m.padStart(2, '0')}`; }
    else { date = new Date().toISOString().slice(0, 7); add('I', 'GRILLE_DATE', 'Date', d ? `Date « ${d} » non interprétée : mois courant retenu (${date}).` : `Date absente : mois courant retenu (${date}).`); }
  }
  const outils = [...usedTools.values()];

  const audit: Audit = {
    schema_version: '1.1',
    id: `AUD-GRILLE-${slug(client).toUpperCase()}-${date}`,
    client, logo: null, image_corporate: null,
    titre: langue === 'fr' ? 'Restitution Audit Analytics' : 'Analytics Audit Report',
    langue, date, version: '1', methode: 'acces', auteurs: ['JAKALA'], audit_precedent_id: null,
    restitution: { masquer_scores: false, jauges: 'pilier', s1_active: false, regle_score_general: 'criticite', sommaire: { actif: true, transitions: false } },
    cadrage: { besoin: [], objectifs: [], contraintes: [], livrables: [] },
    outils, acces_requis: [], piliers, criteres, constats,
  };
  const st = criteres.reduce((m, c) => (m[c.statut] = (m[c.statut] || 0) + 1, m), {} as Record<string, number>);
  rep.I.unshift({ code: 'GRILLE_RESUME', objet: 'Conversion', message: `Grille ${langue.toUpperCase()} : ${criteres.length} critères (${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}), ${piliers.length} piliers, ${constats.length} constats brouillons.` });
  return { audit, report: rep };
}
