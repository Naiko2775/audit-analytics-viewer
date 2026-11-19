/** Comparaison de deux audits : évolution des scores, des critères et des constats (§4.1 ; DAT-39, DAT-40, EXP-39, EXP-40). Pur, sans DOM. */
import type { Audit, Critere, Localise } from './types.ts';
import { buildModel, emptyOverrides, type MCritere, type MConstat, type Model } from './model.ts';
import { AXES, PTS } from './rules.ts';

export interface AuditRef { id: string; date?: string; version?: string; client: string }
export interface ScoreDelta { prev: number | null; cur: number | null; delta: number | null }
export interface PilierDelta extends ScoreDelta { id: string; libelle: Localise }
export interface AxeDelta extends ScoreDelta { id: string }

/** Évolution d'un critère apparié entre les deux audits. */
export interface Change {
  id_grille: string; question: string; pilier_id: string; criticite: string;
  avant: string; apres: string;
  /** Criticité dans l'audit précédent, si elle a changé. */
  criticite_avant?: string;
  /** `question` : apparié par libellé normalisé faute d'identifiant commun (à vérifier). */
  appariement: 'id' | 'question';
  /** Identifiant dans l'audit précédent, s'il diffère (appariement par libellé). */
  id_grille_avant?: string;
}

export type EvolutionConstat = 'resolu' | 'ameliore' | 'stable' | 'regresse' | 'nouveau';
export interface ConstatChange {
  /** Identifiant dans l'audit courant (null si le constat n'y figure plus). */
  id: string | null;
  id_prev: string | null;
  titre: Localise; pilier_id: string; criticite: string;
  statut_avant: string | null; statut_apres: string | null;
  evolution: EvolutionConstat;
  /** `titre` : apparié par titre normalisé ; `correspondance` : via la table fournie ; `aucun` : nouveau, à rapprocher manuellement si besoin. */
  appariement: 'id' | 'correspondance' | 'titre' | 'aucun';
  /** Résolu parce qu'absent de l'audit courant (et non parce que ses critères passent). */
  absent?: boolean;
  /**
   * EXP-39 : constat sans correspondance alors que d'autres ont disparu (ou l'inverse) :
   * possible renommage, à rapprocher manuellement (table de correspondance).
   */
  a_rapprocher?: boolean;
  /** DAT-39 (MODIFIE) : constat persistant dont la criticité, le titre ou les critères liés ont changé. */
  modifie?: boolean;
  /** Criticité dans l'audit précédent, si elle a changé. */
  criticite_avant?: string;
}

export interface Comparison {
  prev: AuditRef; cur: AuditRef;
  scores: { global: ScoreDelta; piliers: PilierDelta[]; axes: AxeDelta[] };
  criteres: {
    ameliores: Change[]; degrades: Change[]; inchanges: number;
    /** Passés d'un état non évalué (INCONNU, À revoir, NA) à OK / Partiel / KO. */
    nouvellement_evalues: Change[];
    /** Passés d'un état évalué à un état non évalué, ou autres mouvements hors OK / Partiel / KO. */
    autres: Change[];
    nouveaux: Critere[]; retires: Critere[];
  };
  constats: { resolus: ConstatChange[]; persistants: ConstatChange[]; nouveaux: ConstatChange[] };
  cross: { prev: Record<string, Record<string, number>>; cur: Record<string, Record<string, number>> };
  /** Option « masquer les scores » de l'audit courant (EXP-40 : seule l'évolution des constats est alors affichée). */
  masquer_scores: boolean;
  warnings: string[];
}

export interface CompareOptions {
  /** Table de correspondance d'identifiants de constats (DAT-40) : prime sur l'égalité d'identifiant. */
  correspondances?: { ancien_id: string; nouvel_id: string }[];
}

/** Ordre d'amélioration : KO < PARTIEL < OK. */
export const RANK: Record<string, number> = { KO: 0, PARTIEL: 1, OK: 2 };
const PASS = new Set(['OK', 'NA']);

export const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const normLoc = (v: Localise | undefined): string[] =>
  (!v ? [] : typeof v === 'string' ? [norm(v)] : Object.values(v).map(norm)).filter(Boolean);

const ref = (a: Audit): AuditRef => ({ id: String(a.id ?? ''), date: a.date || undefined, version: a.version != null && a.version !== '' ? String(a.version) : undefined, client: String(a.client ?? '') });
const regleOf = (a: Audit) => (a.restitution?.regle_score_general === 'nb_criteres' ? 'nb_criteres' : 'criticite');
const delta = (p: number | null | undefined, c: number | null | undefined): ScoreDelta => {
  const prev = p ?? null, cur = c ?? null;
  return { prev, cur, delta: prev != null && cur != null ? cur - prev : null };
};

/** Apparie deux listes : d'abord par clé exacte, puis par clé secondaire normalisée sur les restes. */
function pair<T>(a: T[], b: T[], key: (x: T) => string, alt: (x: T) => string[]) {
  const pairs: [T, T, 'id' | 'alt'][] = [];
  const bByKey = new Map<string, T>();
  b.forEach(x => { const k = key(x); if (k && !bByKey.has(k)) bByKey.set(k, x); });
  const usedB = new Set<T>(), restA: T[] = [];
  a.forEach(x => {
    const y = key(x) ? bByKey.get(key(x)) : undefined;
    if (y && !usedB.has(y)) { pairs.push([x, y, 'id']); usedB.add(y); } else restA.push(x);
  });
  const restB = b.filter(x => !usedB.has(x));
  const onlyA: T[] = [];
  restA.forEach(x => {
    const ks = alt(x).filter(Boolean);
    const y = ks.length ? restB.find(z => !usedB.has(z) && alt(z).some(k => ks.includes(k))) : undefined;
    if (y) { pairs.push([x, y, 'alt']); usedB.add(y); } else onlyA.push(x);
  });
  return { pairs, onlyA, onlyB: b.filter(x => !usedB.has(x)) };
}

const isEval = (s: string) => s in PTS;
/** Statut synthétique d'un constat : pire statut de ses critères liés. */
const constatResolu = (c: MConstat) => c.crits.length > 0 && c.crits.every(k => PASS.has(k.statut));

export function compareAudits(prev: Audit, cur: Audit, opts: CompareOptions = {}): Comparison {
  const Mc: Model = buildModel(cur);
  // Même lecture que buildModel : toute valeur autre que nb_criteres (absente, null…) vaut « criticite ».
  const regle = regleOf(cur), prevRegle = regleOf(prev);
  const warnings: string[] = [];
  // DAT-39 : paramètres de scoring différents → avertissement et recalcul de l'ancien audit avec les paramètres courants.
  const Mp: Model = buildModel(prev, { ...emptyOverrides(), restitution: { regle_score_general: regle } });
  if (prevRegle !== regle)
    warnings.push(`Règle de calcul du score général différente entre les deux audits : l’audit de référence a été recalculé avec la règle courante (${regle === 'nb_criteres' ? 'nombre de critères' : 'criticité'}).`);

  if (norm(prev.client) !== norm(cur.client)) warnings.push(`Les deux audits ne concernent pas le même client (« ${prev.client ?? '?'} » / « ${cur.client ?? '?'} »).`);
  if (prev.id === cur.id) warnings.push('Les deux audits portent le même identifiant : vérifiez qu’il s’agit bien de deux versions distinctes.');
  if (cur.audit_precedent_id && cur.audit_precedent_id !== prev.id)
    warnings.push(`L’audit courant déclare comme précédent « ${cur.audit_precedent_id} », et non « ${prev.id} ».`);
  if (prev.date && cur.date && prev.date > cur.date) warnings.push(`L’audit de référence (${prev.date}) est postérieur à l’audit courant (${cur.date}).`);

  /* ---------- Scores ---------- */
  const pilIds = [...Mc.piliers.map(p => p.id), ...Mp.piliers.map(p => p.id).filter(id => !Mc.pmap[id])];
  const piliers: PilierDelta[] = pilIds.map(id => ({ id, libelle: (Mc.pmap[id] || Mp.pmap[id]).libelle, ...delta(Mp.scores.pil[id], Mc.scores.pil[id]) }));
  const axes: AxeDelta[] = AXES.map(a => ({ id: a, ...delta(Mp.scores.axes[a], Mc.scores.axes[a]) }));

  /* ---------- Critères (DAT-40 : id_grille, puis question normalisée) ---------- */
  const live = (l: MCritere[]) => l.filter(c => !c.obsolete);
  const cp = pair(live(Mp.crits), live(Mc.crits), c => c.id_grille || '', c => [norm(c.question)]);
  const crit = { ameliores: [] as Change[], degrades: [] as Change[], inchanges: 0, nouvellement_evalues: [] as Change[], autres: [] as Change[] };
  cp.pairs.forEach(([a, b, how]) => {
    const ch: Change = { id_grille: b.id_grille, question: b.question, pilier_id: b.pilier_id, criticite: b.criticite, avant: a.statut, apres: b.statut, appariement: how === 'id' ? 'id' : 'question' };
    if (a.criticite !== b.criticite) ch.criticite_avant = a.criticite;
    if (a.id_grille !== b.id_grille) ch.id_grille_avant = a.id_grille;
    if (a.statut === b.statut) crit.inchanges++;
    else if (isEval(a.statut) && isEval(b.statut)) (RANK[b.statut] > RANK[a.statut] ? crit.ameliores : crit.degrades).push(ch);
    else if (!isEval(a.statut) && isEval(b.statut)) crit.nouvellement_evalues.push(ch);
    else crit.autres.push(ch);
  });
  const W: Record<string, number> = { HAUTE: 0, MOYENNE: 1, FAIBLE: 2, AUCUNE: 3 };
  const byCrit = (x: Change, y: Change) => (W[x.criticite] ?? 9) - (W[y.criticite] ?? 9) || String(x.id_grille ?? '').localeCompare(String(y.id_grille ?? ''));
  [crit.ameliores, crit.degrades, crit.nouvellement_evalues, crit.autres].forEach(l => l.sort(byCrit));
  const strip = (c: MCritere): Critere => { const { outil_ref, ...rest } = c as any; return rest; };
  const nTot = Math.max(live(Mp.crits).length, live(Mc.crits).length);
  if (nTot && cp.pairs.length / nTot < 0.5)
    warnings.push(`Grilles très différentes : seuls ${cp.pairs.length} critères sur ${nTot} ont pu être rapprochés.`);
  const nQ = cp.pairs.filter(p => p[2] === 'alt').length;
  if (nQ) warnings.push(`${nQ} critère(s) rapproché(s) par leur libellé faute d’identifiant commun : à vérifier.`);

  /* ---------- Constats (correspondances, puis id, puis titre normalisé) ---------- */
  // Constats écartés par buildModel (pilier inactif ou inconnu) : ni résolus, ni nouveaux (hors périmètre de la restitution).
  const prevIds = new Set(Mp.constats.map(c => c.id)), curIds = new Set(Mc.constats.map(c => c.id));
  const rawCur = new Set((cur.constats || []).map(c => c.id)), rawPrev = new Set((prev.constats || []).map(c => c.id));
  const curById = new Map(Mc.constats.map(c => [c.id, c]));
  // Seules les correspondances applicables (ancien présent, nouveau présent) réservent leur cible.
  const corr = new Map((opts.correspondances || []).filter(c => c && prevIds.has(c.ancien_id) && curIds.has(c.nouvel_id)).map(c => [c.ancien_id, c.nouvel_id]));
  const prevs = Mp.constats.slice(), curs = Mc.constats.slice();
  const matched: [MConstat, MConstat, ConstatChange['appariement']][] = [];
  const usedCur = new Set<MConstat>(), leftPrev: MConstat[] = [];
  const corrTargets = new Set(corr.values());
  prevs.forEach(p => {
    if (corr.has(p.id)) {
      const y = curById.get(corr.get(p.id)!);
      if (y && !usedCur.has(y)) { matched.push([p, y, 'correspondance']); usedCur.add(y); } else leftPrev.push(p);
      return;
    }
    const y = curById.get(p.id);
    if (y && !usedCur.has(y) && !corrTargets.has(y.id)) { matched.push([p, y, 'id']); usedCur.add(y); } else leftPrev.push(p);
  });
  const titles = (c: MConstat) => [...normLoc(c.titre_action), ...normLoc(c.titre_court)];
  const gone: MConstat[] = [];
  leftPrev.forEach(p => {
    const ks = titles(p);
    const y = ks.length ? curs.find(c => !usedCur.has(c) && !corrTargets.has(c.id) && titles(c).some(k => ks.includes(k))) : undefined;
    if (y) { matched.push([p, y, 'titre']); usedCur.add(y); } else gone.push(p);
  });
  // Un constat « disparu » encore présent dans le JSON courant (pilier désactivé) n'est pas résolu ; idem pour un « nouveau » déjà présent avant.
  const horsGone = gone.filter(p => rawCur.has(p.id)), goneReal = gone.filter(p => !rawCur.has(p.id));
  const unmatchedCur = curs.filter(c => !usedCur.has(c));
  const horsNew = unmatchedCur.filter(c => rawPrev.has(c.id)), newReal = unmatchedCur.filter(c => !rawPrev.has(c.id));
  if (horsGone.length + horsNew.length)
    warnings.push(`${horsGone.length + horsNew.length} constat(s) rattaché(s) à un pilier inactif dans l’un des deux audits : exclus de la comparaison (${[...horsGone, ...horsNew].map(c => c.id).join(', ')}).`);
  const rapprocher = goneReal.length > 0 && newReal.length > 0;
  const sameIds = (a?: string[], b?: string[]) => [...(a || [])].sort().join('|') === [...(b || [])].sort().join('|');

  const out = { resolus: [] as ConstatChange[], persistants: [] as ConstatChange[], nouveaux: [] as ConstatChange[] };
  matched.forEach(([p, c, how]) => {
    const resolu = constatResolu(c);
    const evo: EvolutionConstat = resolu ? 'resolu' : evolution(p.statut, c.statut);
    const item: ConstatChange = { id: c.id, id_prev: p.id, titre: c.titre_action, pilier_id: c.pilier_id, criticite: c.criticite, statut_avant: p.statut, statut_apres: c.statut, evolution: evo, appariement: how };
    if (p.criticite !== c.criticite) item.criticite_avant = p.criticite;
    if (p.criticite !== c.criticite || !sameIds(p.criteres_lies, c.criteres_lies) || titles(p).join('|') !== titles(c).join('|')) item.modifie = true;
    (resolu ? out.resolus : out.persistants).push(item);
  });
  goneReal.forEach(p => {
    const item: ConstatChange = { id: null, id_prev: p.id, titre: p.titre_action, pilier_id: p.pilier_id, criticite: p.criticite, statut_avant: p.statut, statut_apres: null, evolution: 'resolu', appariement: 'aucun', absent: true };
    if (rapprocher) item.a_rapprocher = true;
    out.resolus.push(item);
  });
  newReal.forEach(c => {
    const item: ConstatChange = { id: c.id, id_prev: null, titre: c.titre_action, pilier_id: c.pilier_id, criticite: c.criticite, statut_avant: null, statut_apres: c.statut, evolution: 'nouveau', appariement: 'aucun' };
    if (rapprocher) item.a_rapprocher = true;
    out.nouveaux.push(item);
  });
  const nT = matched.filter(m => m[2] === 'titre').length;
  if (nT) warnings.push(`${nT} constat(s) rapproché(s) par leur titre faute d’identifiant commun : à vérifier.`);
  if (rapprocher)
    warnings.push(`${goneReal.length} constat(s) absent(s) de l’audit courant et ${newReal.length} nouveau(x), signalés « à rapprocher manuellement » : si le skill a renommé des constats, fournissez une table de correspondance.`);
  const rangOf = (x: ConstatChange) => (x.id ? Mc.cmap[x.id]?.rang : Mp.cmap[x.id_prev!]?.rang) ?? 1e3;
  Object.values(out).forEach(l => l.sort((a, b) => rangOf(a) - rangOf(b)));

  return {
    prev: ref(prev), cur: ref(cur),
    scores: { global: delta(Mp.scores.global, Mc.scores.global), piliers, axes },
    criteres: { ...crit, nouveaux: cp.onlyB.map(strip), retires: cp.onlyA.map(strip) },
    constats: out,
    cross: { prev: Mp.cross, cur: Mc.cross },
    masquer_scores: !!Mc.audit.restitution!.masquer_scores,
    warnings,
  };
}

/** Évolution du statut synthétique d'un constat persistant (pire statut de ses critères). */
function evolution(a: string, b: string): EvolutionConstat {
  if (a === b || !(a in RANK) || !(b in RANK)) return 'stable';
  return RANK[b] > RANK[a] ? 'ameliore' : 'regresse';
}

export interface Candidate { key: string; id: string; client: string; date?: string; version?: string }
/** Compare deux versions segment par segment (« 1.10 » > « 1.9 », « v2 » = « 2 »). null si l'une n'est pas lisible. */
export function cmpVersion(a?: string | number | null, b?: string | number | null): number | null {
  const parse = (v: unknown) => { const m = String(v ?? '').trim().replace(/^v/i, '').match(/^\d+(?:[.,]\d+)*/); return m ? m[0].split(/[.,]/).map(Number) : null; };
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}

/**
 * Audit de référence parmi les audits disponibles : priorité à `audit_precedent_id`,
 * sinon même client et date antérieure la plus récente (à date égale ou absente, version antérieure).
 */
export function findPrevious(cur: Audit, candidates: Candidate[]): string | null {
  const others = candidates.filter(c => c.id !== cur.id);
  if (cur.audit_precedent_id) {
    const hit = others.find(c => c.id === cur.audit_precedent_id);
    if (hit) return hit.key;
  }
  const earlier = (c: Candidate) => {
    if (c.date && cur.date && c.date !== cur.date) return c.date < cur.date;
    return (cmpVersion(c.version, cur.version) ?? 0) < 0;
  };
  const same = others.filter(c => norm(c.client) === norm(cur.client) && earlier(c));
  same.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (cmpVersion(b.version, a.version) ?? 0));
  return same[0]?.key ?? null;
}
