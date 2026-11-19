/** Validation à l'import (§7.2, DAT-12 à DAT-16) : toutes les anomalies en une passe, classées par niveau. */
import { tx } from './i18n.ts';
import { ANNOT_STATUTS, CRIT_W, normStatut, STATUTS } from './rules.ts';

export type Niveau = 'E' | 'W' | 'I';
export interface Issue { code: string; objet: string; message: string }
export interface Stats {
  criteres: number; par_statut: Record<string, number>; constats: number; piliers_actifs: number;
  preuves: { total: number; resolues: number; manquantes: number; texte: number };
}
export interface Report { E: Issue[]; W: Issue[]; I: Issue[]; stats: Stats | null }

/** Libellés des règles, affichés dans le rapport. */
export const RULES: Record<string, string> = {
  JSON_SYNTAXE: 'Syntaxe JSON', SCHEMA: 'Schéma du contrat', VERSION: 'Version du contrat', DOUBLON: 'Identifiant dupliqué',
  STATUT: 'Statut normalisé (§7.1)', CRITICITE: 'Criticité normalisée (§7.1)', PILIER: 'Intégrité pilier', CRITERE_LIE: 'Intégrité critère lié',
  NB_PILIERS: '2 à 4 piliers actifs', IMPACT: 'Impact 1 à 3', EFFORT: 'Cohérence de l’effort',
  R72_ETAI: '§7.2 Constat HAUTE étayé', R72_ORPHELIN: '§7.2 Critère critique rattaché', R72_TITRE: '§7.2 Titre ≤ 80 caractères', R72_PUCES: '§7.2 Bloc ≤ 4 puces',
  PREUVE_RECO: 'Preuve systématique', PREUVE_MANQUANTE: 'Preuve référencée absente', PREUVE_ORPHELINE: 'Fichier non référencé', PREUVE_EXTERNE: 'Preuve hébergée hors artefact',
  PREUVE_LOURDE: 'Budget artefact (15 Mo)', PREUVE_OPTIM: 'Optimisation des preuves', ZIP: 'Contenu de l’archive',
  ANNOTATION: 'Annotations de preuve', CADRAGE: 'Cadrage S1', LOGO: 'Couverture S0', OUTIL: 'Référentiel outils', ACCES: 'Accès requis', MOTIF: 'Motif de non-évaluation',
  RESUME: 'Résumé',
};
const SUPPORTED = ['1.0', '1.1'];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isEmbedded = (f?: string) => !!f && /^data:/.test(f);
export const isRemote = (f?: string) => !!f && /^https?:\/\//.test(f);

export interface ValidateOptions {
  /** Chemins des fichiers disponibles (ZIP ou fichiers déposés), déjà normalisés. Absent : seules les preuves embarquées sont résolues. */
  assets?: Set<string>;
  /** Résolution d'un chemin de preuve vers une clé de `assets`. */
  resolve?: (ref: string) => string | null;
}

export function validate(a: any, opts: ValidateOptions = {}): Report {
  const R: Report = { E: [], W: [], I: [], stats: null };
  const add = (n: Niveau, code: string, objet: string, message: string) => R[n].push({ code, objet, message });
  if (!isObj(a)) { add('E', 'SCHEMA', 'Fichier', 'Un objet JSON est attendu à la racine.'); return R; }

  // Schéma racine
  (['id', 'client', 'langue', 'piliers', 'criteres', 'constats'] as const).forEach(k => { if (a[k] == null) add('E', 'SCHEMA', 'Racine', `Champ obligatoire manquant : « ${k} ».`); });
  (['piliers', 'criteres', 'constats'] as const).forEach(k => { if (a[k] != null && !Array.isArray(a[k])) add('E', 'SCHEMA', 'Racine', `« ${k} » doit être une liste.`); });
  if (a.langue != null && !['fr', 'en'].includes(a.langue)) add('W', 'SCHEMA', 'Racine', `Langue « ${a.langue} » non prise en charge : fr retenu.`);
  if (R.E.length) return R;

  if (!a.schema_version) add('W', 'VERSION', 'Racine', 'schema_version absent : contrat 1.0 supposé.');
  else if (!SUPPORTED.includes(String(a.schema_version))) add('W', 'VERSION', 'Racine', `Version ${a.schema_version} non reconnue (prises en charge : ${SUPPORTED.join(', ')}).`);
  const v11 = String(a.schema_version) === '1.1';

  // Doublons (DAT-15)
  const dup = (list: any[], key: string, label: string) => {
    const seen = new Set<string>();
    list.forEach(x => { const id = x?.[key]; if (id == null) return; if (seen.has(id)) add('E', 'DOUBLON', `${label} ${id}`, `Identifiant « ${id} » présent plusieurs fois.`); seen.add(id); });
  };
  dup(a.piliers, 'id', 'Pilier'); dup(a.criteres, 'id_grille', 'Critère'); dup(a.constats, 'id', 'Constat');
  dup(a.constats.flatMap((c: any) => c.preuves || []), 'id', 'Preuve');

  const pids = new Set(a.piliers.map((p: any) => p.id));
  const act = a.piliers.filter((p: any) => p.actif !== false).length;
  if (act < 2 || act > 4) add('W', 'NB_PILIERS', 'Piliers', `${act} pilier(s) actif(s) : 2 à 4 attendus.`);

  // 1.1 — cadrage, couverture, outils, accès
  const oids = new Set((a.outils || []).map((o: any) => o.id));
  const accIds = new Set((a.acces_requis || []).map((x: any) => x.id));
  if (v11) {
    if (!a.cadrage) add('W', 'CADRAGE', 'Cadrage', 'Bloc absent : Besoin / Objectifs / Contraintes / Livrables seront vides.');
    else ['besoin', 'objectifs', 'contraintes', 'livrables'].forEach(k => { if (!(a.cadrage[k] || []).length) add('W', 'CADRAGE', 'Cadrage', `Bloc « ${k} » vide.`); });
    if (!a.logo) add('W', 'LOGO', 'Couverture', 'Logo client absent : emplacement réservé affiché (à compléter en mode édition).');
    if (!a.image_corporate) add('I', 'LOGO', 'Couverture', 'Image corporate absente : motif JAKALA utilisé.');
    (a.outils || []).forEach((o: any) => { if (!o.logo) add('I', 'OUTIL', `Outil ${o.libelle ?? o.id}`, 'Pas de logo fourni : pastille générée.'); });
    a.piliers.forEach((p: any) => (p.outils || []).forEach((o: string) => { if (oids.size && !oids.has(o)) add('W', 'OUTIL', `Pilier ${p.id}`, `Outil « ${o} » absent du référentiel outils.`); }));
    (a.acces_requis || []).forEach((x: any) => { if (oids.size && !oids.has(x.outil_id)) add('E', 'ACCES', `Accès ${x.id}`, `Outil « ${x.outil_id} » inconnu.`); });
  }

  // Critères
  const cids = new Set<string>(), linked = new Set<string>();
  const parStatut: Record<string, number> = Object.fromEntries(STATUTS.map(s => [s, 0]));
  a.criteres.forEach((c: any, i: number) => {
    const id = c.id_grille || '#' + (i + 1); cids.add(c.id_grille); const obj = `Critère ${id}`;
    if (!c.id_grille) add('E', 'SCHEMA', obj, 'id_grille manquant.');
    const st = normStatut(c.statut);
    if (!st) add('E', 'STATUT', obj, `Statut inconnu « ${c.statut} » (attendu : Yes/No/Partly/Not concerned/Unknown ou équivalents FR).`); else parStatut[st]++;
    if (!(String(c.criticite || '').toUpperCase() in CRIT_W)) add('E', 'CRITICITE', obj, `Criticité inconnue « ${c.criticite} » (HAUTE, MOYENNE, FAIBLE, AUCUNE).`);
    if (!c.pilier_id) add('W', 'PILIER', obj, 'pilier_id absent : critère exclu des scores par pilier.');
    else if (!pids.has(c.pilier_id)) add('E', 'PILIER', obj, `Pilier « ${c.pilier_id} » inconnu.`);
    if (c.acces_requis_id && !accIds.has(c.acces_requis_id)) add('W', 'ACCES', obj, `Accès requis « ${c.acces_requis_id} » inconnu.`);
    if (v11 && st === 'INCONNU' && !c.motif_non_evalue) add('W', 'MOTIF', obj, 'INCONNU sans motif_non_evalue : absent du tableau des accès requis.');
  });

  // Constats & preuves
  const preuves = { total: 0, resolues: 0, manquantes: 0, texte: 0 };
  const used = new Set<string>();
  a.constats.forEach((c: any) => {
    const obj = `Constat ${c.id}`;
    const H = String(c.criticite).toUpperCase() === 'HAUTE';
    (c.criteres_lies || []).forEach((id: string) => { linked.add(id); if (!cids.has(id)) add('W', 'CRITERE_LIE', obj, `Critère lié inconnu : ${id}.`); });
    if (!pids.has(c.pilier_id)) add('E', 'PILIER', obj, `Pilier « ${c.pilier_id} » inconnu.`);
    if (!(String(c.criticite || '').toUpperCase() in CRIT_W)) add('E', 'CRITICITE', obj, `Criticité inconnue « ${c.criticite} ».`);
    if (c.impact_score != null && !(Number.isInteger(c.impact_score) && c.impact_score >= 1 && c.impact_score <= 3)) add('E', 'IMPACT', obj, `impact_score ${c.impact_score} hors bornes (1 à 3).`);
    if (c.effort && !['S', 'M', 'L'].includes(c.effort)) add('E', 'EFFORT', obj, `Effort « ${c.effort} » invalide (S, M, L).`);
    else if (!c.effort) add('W', 'EFFORT', obj, 'Effort absent : M retenu par défaut.');
    const w = Number(c.effort_semaines);
    if (c.effort && c.effort_semaines != null && ((c.effort === 'S' && w >= 1) || (c.effort === 'M' && (w < 1 || w > 3)) || (c.effort === 'L' && w <= 3)))
      add('W', 'EFFORT', obj, `Effort ${c.effort} incohérent avec ${String(w).replace('.', ',')} semaine(s).`);
    const L = String(tx(c.titre_action) || '').length;
    if (!L) add('E', 'SCHEMA', obj, 'titre_action manquant.'); else if (L > 80) add('W', 'R72_TITRE', obj, `Titre de ${L} caractères (> 80).`);
    ['situation', 'impact', 'recommandations'].forEach(b => { const n = (c[b] || []).length; if (n > 4) add('W', 'R72_PUCES', obj, `Bloc « ${b} » de ${n} puces (> 4).`); });

    // Résolution des preuves (DAT-13)
    let resolved = 0;
    (c.preuves || []).forEach((p: any) => {
      preuves.total++;
      const po = `Preuve ${p.id} (${c.id})`;
      const f: string | undefined = p.fichier;
      if (p.contenu || p.panneau) { if (!f) { preuves.texte++; resolved++; } }
      if (f) {
        if (isEmbedded(f)) { preuves.resolues++; resolved++; }
        else if (isRemote(f)) { preuves.resolues++; resolved++; add('W', 'PREUVE_EXTERNE', po, 'Fichier hébergé en ligne : il ne s’affichera pas dans l’artefact hors ligne.'); }
        else {
          const key = opts.resolve ? opts.resolve(f) : null;
          if (key) { used.add(key); preuves.resolues++; resolved++; }
          else if (p.contenu || p.panneau) { add('I', 'PREUVE_MANQUANTE', po, `« ${f} » absent : le contenu texte est affiché à la place.`); }
          else { preuves.manquantes++; add(H ? 'E' : 'W', 'PREUVE_MANQUANTE', po, `Fichier « ${f} » introuvable${opts.assets ? ' dans les fichiers importés' : ' : importez le ZIP de preuves'}.`); }
        }
      } else if (!p.contenu && !p.panneau) { preuves.manquantes++; add('W', 'PREUVE_MANQUANTE', po, 'Ni fichier, ni contenu, ni panneau.'); }
      const anns = Array.isArray(p.annotations) ? p.annotations : [];
      anns.forEach((an: any) => {
        if (typeof an === 'number') return; // format 1.0
        if (!ANNOT_STATUTS.includes(an.statut)) add('E', 'ANNOTATION', po, `Statut d'annotation inconnu « ${an.statut} » (OK, KO, PARTIEL, INFO).`);
        const n = an.cible?.ligne;
        if (n != null && p.panneau && (n < 1 || n > p.panneau.lignes.length)) add('W', 'ANNOTATION', po, `Repère ${an.num} : ligne ${n} hors du panneau.`);
        const z = an.cible?.zone;
        if (z && typeof z === 'object' && [z.x, z.y, z.w, z.h].some((v: number) => !(v >= 0 && v <= 100))) add('W', 'ANNOTATION', po, `Repère ${an.num} hors cadre (coordonnées en %).`);
      });
      if (v11 && p.gabarit === 'navigateur' && !f && !p.panneau && !p.contenu) add('W', 'ANNOTATION', po, 'Gabarit navigateur sans capture ni panneau.');
      if (p.annotations_incrustees && anns.length) add('W', 'ANNOTATION', po, 'Annotations incrustées dans l’image ET déclarées : doublon visuel.');
    });
    const S = (c.situation || []).length > 0;
    if (H && !resolved && !S) add('E', 'R72_ETAI', obj, 'Criticité HAUTE sans preuve exploitable ni situation actuelle.');
    else if (H && !resolved) add('W', 'PREUVE_RECO', obj, 'Criticité HAUTE sans preuve : preuve recommandée.');
  });

  a.criteres.forEach((c: any) => {
    const s = normStatut(c.statut);
    if ((s === 'KO' || s === 'PARTIEL') && String(c.criticite).toUpperCase() === 'HAUTE' && !linked.has(c.id_grille))
      add('W', 'R72_ORPHELIN', `Critère ${c.id_grille}`, `${s} de criticité HAUTE rattaché à aucun constat.`);
  });
  // Logos (couverture, outils) : relatifs → doivent figurer parmi les fichiers importés
  const refs: [string, string | undefined][] = [['Couverture · logo', a.logo], ['Couverture · image corporate', a.image_corporate], ...(a.outils || []).map((o: any) => [`Outil ${o.libelle ?? o.id} · logo`, o.logo] as [string, string | undefined])];
  refs.forEach(([obj, f]) => {
    if (!f || isEmbedded(f) || isRemote(f)) return;
    const key = opts.resolve ? opts.resolve(f) : null;
    if (key) used.add(key); else add('W', 'LOGO', obj, `Fichier « ${f} » introuvable : emplacement réservé affiché.`);
  });
  if (opts.assets) opts.assets.forEach(k => { if (!used.has(k)) add('I', 'PREUVE_ORPHELINE', k, 'Fichier présent mais référencé par aucune preuve.'); });

  R.stats = { criteres: a.criteres.length, par_statut: parStatut, constats: a.constats.length, piliers_actifs: act, preuves };
  R.I.unshift({ code: 'RESUME', objet: 'Audit', message: `Contrat ${a.schema_version || '1.0'} · ${a.criteres.length} critères, ${a.constats.length} constats, ${act} piliers actifs, ${preuves.total} preuves.` });
  return R;
}

/** Position (index) de la première erreur de syntaxe JSON ; -1 si aucune détectée. Les moteurs récents ne la donnent plus. */
export function jsonErrorIndex(src: string): number {
  let i = 0;
  const ws = () => { while (i < src.length && ' \t\n\r'.includes(src[i])) i++; };
  const fail = () => { throw i; };
  const str = () => {
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '"') { i++; return; }
      if (c === '\\') { i++; if (!'"\\/bfnrtu'.includes(src[i] ?? '')) fail(); if (src[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 1, i + 5))) fail(); i += 4; } }
      else if (c < ' ') fail();
      i++;
    }
    fail();
  };
  const val = (): void => {
    ws(); const c = src[i];
    if (c === '{') { i++; ws(); if (src[i] === '}') { i++; return; } for (;;) { ws(); if (src[i] !== '"') fail(); str(); ws(); if (src[i] !== ':') fail(); i++; val(); ws(); if (src[i] === ',') { i++; continue; } if (src[i] === '}') { i++; return; } fail(); } }
    if (c === '[') { i++; ws(); if (src[i] === ']') { i++; return; } for (;;) { val(); ws(); if (src[i] === ',') { i++; continue; } if (src[i] === ']') { i++; return; } fail(); } }
    if (c === '"') return str();
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|^(true|false|null)/.exec(src.slice(i, i + 400));
    if (!m) fail(); i += m![0].length;
  };
  try { val(); ws(); if (i < src.length) fail(); return -1; } catch (e) { return typeof e === 'number' ? e : -1; }
}

/** Parse JSON avec position (ligne, colonne) de l'erreur (DAT-12). */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; issue: Issue } {
  const src = text.replace(/^\uFEFF/, '');
  try { return { ok: true, value: JSON.parse(src) }; }
  catch (e: any) {
    const pos = jsonErrorIndex(src);
    let where = 'position inconnue', extrait = '';
    if (pos >= 0) {
      const before = src.slice(0, pos), line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
      where = `ligne ${line}, colonne ${col}`;
      extrait = src.split('\n')[line - 1].trim().slice(0, 80);
    }
    const msg = String(e?.message || e).split(',')[0].replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '').replace(/ at line \d+ column \d+.*$/, '');
    return { ok: false, issue: { code: 'JSON_SYNTAXE', objet: where, message: `JSON invalide (${where}) : ${msg}${extrait ? ` — « ${extrait} »` : ''}` } };
  }
}
