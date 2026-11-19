/** Moteur : modèle de restitution, scores, priorisation (§8). Pur, sans DOM. */
import type { Audit, Constat, Critere, Outil, Pilier, Restitution, AccesRequis } from './types.ts';
import { AXES, CRIT_W, EFF, PTS, QORDER, WORST, nEval, normStatut, quadrant, score } from './rules.ts';

export interface Overrides {
  constats: Record<string, Partial<Constat> & { impact_score?: number | null }>;
  ordre: string[] | null; audit: Partial<Audit>; restitution: Partial<Restitution>;
  journal: { d: string; qui: string; quoi: string }[];
}
export const emptyOverrides = (): Overrides => ({ constats: {}, ordre: null, audit: {}, restitution: {}, journal: [] });

const PIL_COLORS = ['var(--pil-0)', 'var(--pil-1)', 'var(--pil-2)', 'var(--pil-3)'];
export const PIL_HEX = ['#08006B', '#FF1A31', '#0F7F81', '#6D45A8'];

export type MPilier = Pilier & { _c: string; _hex: string };
export type MCritere = Critere & { statut: string; criticite: string; outil_ref?: Outil };
export type MConstat = Constat & {
  _ov: Overrides['constats'][string]; pilier: MPilier; crits: MCritere[]; compliance: boolean;
  impact_calc: number; imp: number; effort: string; quadrant: string; type: 'QuickWin' | 'LongueTraine';
  visible: boolean; statut: string; outils: string[]; rang: number;
};
export interface AccesLigne extends AccesRequis { outil?: Outil; criteres: MCritere[]; auto?: boolean }

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildModel(raw: Audit, ov: Overrides = emptyOverrides()) {
  const audit: Audit = Object.assign({}, raw, ov.audit);
  audit.restitution = Object.assign({ masquer_scores: false, jauges: 'pilier', s1_active: true, regle_score_general: 'criticite', sommaire: { actif: true, transitions: false } }, raw.restitution, ov.restitution);

  // Référentiel outils (1.1). Repli 1.0 : déduit des libellés `outil` des critères et des piliers.
  const outilsRef: Outil[] = (raw.outils || []).slice();
  const omap: Record<string, Outil> = Object.fromEntries(outilsRef.map(o => [o.id, o]));
  const byLabel: Record<string, Outil> = Object.fromEntries(outilsRef.map(o => [o.libelle.toLowerCase(), o]));
  const resolveOutil = (ref?: string | null): Outil | undefined => {
    if (!ref) return undefined;
    const o = omap[ref] || byLabel[ref.toLowerCase()];
    if (o) return o;
    const n: Outil = { id: slugify(ref), libelle: ref };
    omap[n.id] = n; byLabel[ref.toLowerCase()] = n; outilsRef.push(n);
    return n;
  };

  const piliers: MPilier[] = (raw.piliers || []).filter(p => p.actif !== false)
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0))
    .map((p, i) => Object.assign({}, p, { _c: PIL_COLORS[i % 4], _hex: PIL_HEX[i % 4], outils: (p.outils || []).map(o => resolveOutil(o)!.id) }));
  const pmap = Object.fromEntries(piliers.map(p => [p.id, p]));

  const crits: MCritere[] = (raw.criteres || []).map(c => {
    const outil_ref = resolveOutil(c.outil_id || c.outil);
    return Object.assign({}, c, { statut: normStatut(c.statut) || 'INCONNU', criticite: String(c.criticite || '').toUpperCase(), outil_ref, outil: outil_ref?.libelle ?? c.outil });
  });
  const kmap = Object.fromEntries(crits.map(c => [c.id_grille, c]));

  let constats: MConstat[] = (raw.constats || []).map(c0 => {
    const o = ov.constats[c0.id] || {};
    const c = Object.assign({}, c0, o) as MConstat;
    c._ov = o; c.pilier = pmap[c.pilier_id];
    c.criticite = String(c0.criticite || '').toUpperCase();
    c.crits = (c0.criteres_lies || []).map(id => kmap[id]).filter(Boolean);
    c.compliance = c.crits.some(k => k.axe_score === 'COMPLIANCE' || k.domaine === 'CMP');
    const base = c.crits.length ? Math.max(...c.crits.map(k => CRIT_W[k.criticite] || 0)) : CRIT_W[c.criticite] || 1;
    c.impact_calc = Math.min(3, Math.max(1, base) + (c.compliance ? 1 : 0));
    c.imp = o.impact_score ?? c.impact_calc;
    c.effort = o.effort || c0.effort || 'M';
    c.quadrant = quadrant(c.imp, c.effort);
    c.type = c.effort === 'S' ? 'QuickWin' : 'LongueTraine';
    c.visible = o.visible ?? c0.visible !== false;
    c.statut = c.crits.length ? c.crits.map(k => k.statut).sort((a, b) => WORST[a] - WORST[b])[0] : 'KO';
    c.outils = [...new Set(c.crits.map(k => k.outil).filter(Boolean) as string[])];
    return c;
  }).filter(c => c.pilier);
  constats.sort((a, b) => QORDER.indexOf(a.quadrant as any) - QORDER.indexOf(b.quadrant as any) || b.imp - a.imp
    || EFF[a.effort] - EFF[b.effort] || CRIT_W[b.criticite] - CRIT_W[a.criticite] || a.id.localeCompare(b.id));
  if (Array.isArray(ov.ordre)) {
    const pos = Object.fromEntries(ov.ordre.map((id, i) => [id, i]));
    constats.sort((a, b) => (pos[a.id] ?? 1e3) - (pos[b.id] ?? 1e3));
  }
  constats.forEach((c, i) => (c.rang = i + 1));
  const cmap = Object.fromEntries(constats.map(c => [c.id, c]));
  const linkOf: Record<string, MConstat[]> = {};
  constats.forEach(c => (c.criteres_lies || []).forEach(id => (linkOf[id] = linkOf[id] || []).push(c)));

  // Scores (§8.1 ; score général selon D2)
  const scored = crits.filter(c => !c.obsolete);
  const axes = Object.fromEntries(AXES.map(a => [a, score(scored.filter(c => c.axe_score === a))])) as Record<string, number | null>;
  const pil = Object.fromEntries(piliers.map(p => [p.id, score(scored.filter(c => c.pilier_id === p.id))])) as Record<string, number | null>;
  let global: number | null;
  if (audit.restitution.regle_score_general === 'nb_criteres') {
    let n = 0, s = 0;
    AXES.forEach(a => { const k = nEval(scored.filter(c => c.axe_score === a)); if (axes[a] != null) { s += axes[a]! * k; n += k; } });
    global = n ? Math.round(s / n) : null;
  } else global = score(scored);

  const cross: Record<string, Record<string, number>> = {};
  ['OK', 'PARTIEL', 'KO'].forEach(s => { cross[s] = {}; ['HAUTE', 'MOYENNE', 'FAIBLE'].forEach(k => (cross[s][k] = crits.filter(c => c.statut === s && c.criticite === k).length)); });
  const cov = {
    evalues: nEval(crits), informatif: crits.filter(c => c.statut in PTS && c.criticite === 'AUCUNE').length,
    NA: crits.filter(c => c.statut === 'NA').length, INCONNU: crits.filter(c => c.statut === 'INCONNU').length,
    A_REVOIR: crits.filter(c => c.statut === 'A_REVOIR').length, total: crits.length,
  };
  const outils = [...new Set(crits.map(c => c.outil).filter(Boolean) as string[])].sort();

  // Accès requis (§6.3, v0.2) : demandes déclarées + critères INCONNU faute d'accès sans demande rattachée.
  const acces: AccesLigne[] = (raw.acces_requis || []).map(a => ({ ...a, outil: omap[a.outil_id] || resolveOutil(a.outil_id), criteres: crits.filter(c => c.acces_requis_id === a.id) }));
  const orphans = crits.filter(c => c.statut === 'INCONNU' && c.motif_non_evalue === 'acces' && !(raw.acces_requis || []).some(a => a.id === c.acces_requis_id));
  const byTool: Record<string, MCritere[]> = {};
  orphans.forEach(c => { const k = c.outil_ref?.id || '?'; (byTool[k] = byTool[k] || []).push(c); });
  Object.entries(byTool).forEach(([k, list]) => acces.push({ id: 'AUTO-' + k, outil_id: k, outil: omap[k], acces: `Accès à ${omap[k]?.libelle ?? k}`, statut_demande: 'a_demander', criteres: list, auto: true }));

  return { audit, piliers, pmap, crits, kmap, constats, cmap, linkOf, scores: { global, axes, pil }, cross, cov, outils, outilsRef, omap, acces };
}
export type Model = ReturnType<typeof buildModel>;
