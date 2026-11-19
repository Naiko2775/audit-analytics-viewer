/** Référentiels et règles de calcul (§7.1, §8 ; décisions D2 à D4). */
import type { Statut } from './types.ts';

const ALIAS: Record<string, Statut> = {
  OK: 'OK', YES: 'OK', OUI: 'OK', PARTIEL: 'PARTIEL', PARTLY: 'PARTIEL', PARTIELLEMENT: 'PARTIEL',
  KO: 'KO', NO: 'KO', NON: 'KO', NA: 'NA', 'NOT CONCERNED': 'NA', 'NON CONCERNÉ': 'NA', 'NON CONCERNE': 'NA',
  INCONNU: 'INCONNU', UNKNOWN: 'INCONNU', A_REVOIR: 'A_REVOIR', 'À REVOIR': 'A_REVOIR', 'A REVOIR': 'A_REVOIR',
};
export const normStatut = (s: unknown): Statut | null => ALIAS[String(s ?? '').trim().toUpperCase()] || null;
export const CRIT_W: Record<string, number> = { HAUTE: 3, MOYENNE: 2, FAIBLE: 1, AUCUNE: 0 };
export const PTS: Record<string, number> = { OK: 1, PARTIEL: 0.5, KO: 0 };
export const EFF: Record<string, number> = { S: 1, M: 2, L: 3 };
export const QORDER = ['QW', 'LT', 'DER', 'PEU'] as const;
export const STATUTS: Statut[] = ['OK', 'PARTIEL', 'KO', 'NA', 'INCONNU', 'A_REVOIR'];
export const CRITS = ['HAUTE', 'MOYENNE', 'FAIBLE', 'AUCUNE'];
export const AXES = ['CONFIGURATION', 'DATA_QUALITY', 'COMPLIANCE'] as const;
export const WORST: Record<string, number> = { KO: 0, PARTIEL: 1, A_REVOIR: 2, INCONNU: 3, OK: 4, NA: 5 };
export const CORR = ['todo', 'doing', 'fixed', 'tested'];
export const ANNOT_STATUTS = ['OK', 'KO', 'PARTIEL', 'INFO'];

interface Scorable { statut: string; criticite: string }
/** Score pondéré par la criticité (OK = 1, PARTIEL = 0,5, KO = 0), sur 100. null si rien d'évaluable. */
export function score(list: Scorable[]): number | null {
  let num = 0, den = 0;
  for (const c of list) {
    if (!(c.statut in PTS)) continue;
    const w = CRIT_W[c.criticite] || 0; if (!w) continue;
    num += PTS[c.statut] * w; den += w;
  }
  return den ? Math.round((100 * num) / den) : null;
}
export const nEval = (list: Scorable[]) => list.filter(c => c.statut in PTS && CRIT_W[c.criticite] > 0).length;
export const band = (s: number | null) => (s == null ? 'na' : s > 60 ? 'bon' : s >= 30 ? 'moyen' : 'faible');
/** D4 : impact fort si ≥ 2, effort faible si S. */
export const quadrant = (imp: number, effort: string) => {
  const fort = imp >= 2, faible = effort === 'S';
  return fort ? (faible ? 'QW' : 'LT') : faible ? 'DER' : 'PEU';
};
