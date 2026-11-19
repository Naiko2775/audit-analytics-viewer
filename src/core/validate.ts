/** Validation à l'import (§7.2) : erreurs bloquantes, avertissements, informations. */
import { tx } from './i18n.ts';
import { ANNOT_STATUTS, CRIT_W, normStatut } from './rules.ts';

export interface Report { E: string[]; W: string[]; I: string[] }
const SUPPORTED = ['1.0', '1.1'];

export function validate(a: any): Report {
  const E: string[] = [], W: string[] = [], I: string[] = [];
  if (!a || typeof a !== 'object' || Array.isArray(a)) { E.push('Fichier illisible : un objet JSON est attendu.'); return { E, W, I }; }
  ['id', 'client', 'langue', 'piliers', 'criteres', 'constats'].forEach(k => { if (a[k] == null) E.push(`Champ racine manquant : ${k}`); });
  if (E.length) return { E, W, I };
  if (!a.schema_version) W.push('schema_version absent : contrat 1.0 supposé.');
  else if (!SUPPORTED.includes(String(a.schema_version))) W.push(`schema_version ${a.schema_version} non reconnue (versions prises en charge : ${SUPPORTED.join(', ')}).`);
  const v11 = String(a.schema_version) === '1.1';

  const pids = new Set(a.piliers.map((p: any) => p.id));
  const act = a.piliers.filter((p: any) => p.actif !== false).length;
  if (act < 2 || act > 4) W.push(`${act} pilier(s) actif(s) : 2 à 4 attendus.`);

  // 1.1 — référentiel outils et accès requis
  const oids = new Set((a.outils || []).map((o: any) => o.id));
  const accIds = new Set((a.acces_requis || []).map((x: any) => x.id));
  if (v11) {
    if (!a.cadrage) W.push('Bloc cadrage absent : les quatre blocs de S1 (Besoin / Objectifs / Contraintes / Livrables) seront vides.');
    else ['besoin', 'objectifs', 'contraintes', 'livrables'].forEach(k => { if (!(a.cadrage[k] || []).length) W.push(`Cadrage : bloc « ${k} » vide.`); });
    if (!a.logo) W.push('Logo client absent : un emplacement réservé sera affiché sur la couverture.');
    (a.outils || []).forEach((o: any) => { if (!o.logo) I.push(`Outil ${o.libelle} : pas de logo fourni, pastille générée.`); });
    a.piliers.forEach((p: any) => (p.outils || []).forEach((o: string) => { if (oids.size && !oids.has(o)) W.push(`Pilier ${p.id} : outil « ${o} » absent du référentiel outils.`); }));
    (a.acces_requis || []).forEach((x: any) => { if (oids.size && !oids.has(x.outil_id)) E.push(`Accès ${x.id} : outil « ${x.outil_id} » inconnu.`); });
  }

  const cids = new Set<string>(), linked = new Set<string>();
  a.criteres.forEach((c: any, i: number) => {
    const id = c.id_grille || '#' + (i + 1); cids.add(c.id_grille);
    const st = normStatut(c.statut);
    if (!st) E.push(`Critère ${id} : statut inconnu « ${c.statut} ».`);
    if (!(String(c.criticite || '').toUpperCase() in CRIT_W)) E.push(`Critère ${id} : criticité inconnue « ${c.criticite} ».`);
    if (!c.pilier_id) W.push(`Critère ${id} : pilier_id absent.`);
    else if (!pids.has(c.pilier_id)) E.push(`Critère ${id} : pilier « ${c.pilier_id} » inconnu.`);
    if (c.acces_requis_id && !accIds.has(c.acces_requis_id)) W.push(`Critère ${id} : accès requis « ${c.acces_requis_id} » inconnu.`);
    if (v11 && st === 'INCONNU' && !c.motif_non_evalue) W.push(`Critère ${id} INCONNU sans motif_non_evalue : il n'apparaîtra pas dans le tableau des accès requis.`);
  });

  a.constats.forEach((c: any) => {
    (c.criteres_lies || []).forEach((id: string) => { linked.add(id); if (!cids.has(id)) W.push(`Constat ${c.id} : critère lié inconnu ${id}.`); });
    if (!pids.has(c.pilier_id)) E.push(`Constat ${c.id} : pilier « ${c.pilier_id} » inconnu.`);
    const H = String(c.criticite).toUpperCase() === 'HAUTE', P = (c.preuves || []).length > 0, S = (c.situation || []).length > 0;
    if (H && !P && !S) E.push(`Constat ${c.id} (HAUTE) : ni preuve ni situation actuelle.`);
    else if (H && !P) W.push(`Constat ${c.id} (HAUTE) : aucune preuve fournie.`);
    const L = String(tx(c.titre_action) || '').length; if (L > 80) W.push(`Constat ${c.id} : titre de ${L} caractères (> 80).`);
    ['situation', 'impact', 'recommandations'].forEach(b => { const n = (c[b] || []).length; if (n > 4) W.push(`Constat ${c.id} : bloc « ${b} » de ${n} puces (> 4).`); });
    if (!c.effort) W.push(`Constat ${c.id} : effort absent, M retenu par défaut.`);
    (c.preuves || []).forEach((p: any) => {
      const anns = Array.isArray(p.annotations) ? p.annotations : [];
      anns.forEach((an: any) => {
        if (typeof an === 'number') return; // format 1.0 : numéros de ligne
        if (!ANNOT_STATUTS.includes(an.statut)) E.push(`Preuve ${p.id} : statut d'annotation inconnu « ${an.statut} ».`);
        const n = an.cible?.ligne;
        if (n != null && p.panneau && (n < 1 || n > p.panneau.lignes.length)) W.push(`Preuve ${p.id} : annotation ${an.num} vise la ligne ${n} hors du panneau.`);
        const z = an.cible?.zone;
        if (z && typeof z === 'object' && [z.x, z.y, z.w, z.h].some((v: number) => v < 0 || v > 100)) W.push(`Preuve ${p.id} : annotation ${an.num} hors cadre (coordonnées en %).`);
      });
      if (v11 && p.gabarit === 'navigateur' && !p.fichier && !p.panneau && !p.contenu) W.push(`Preuve ${p.id} : gabarit navigateur sans capture ni panneau.`);
      if (p.annotations_incrustees && anns.length) W.push(`Preuve ${p.id} : annotations déjà incrustées dans l'image ET déclarées : risque de doublon visuel.`);
    });
  });
  a.criteres.forEach((c: any) => {
    const s = normStatut(c.statut);
    if ((s === 'KO' || s === 'PARTIEL') && String(c.criticite).toUpperCase() === 'HAUTE' && !linked.has(c.id_grille))
      W.push(`Critère ${c.id_grille} ${s} de criticité HAUTE rattaché à aucun constat.`);
  });
  I.unshift(`Contrat ${a.schema_version || '1.0'} · ${a.criteres.length} critères, ${a.constats.length} constats, ${act} piliers actifs.`);
  return { E, W, I };
}
