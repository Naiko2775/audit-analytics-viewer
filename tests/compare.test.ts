import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/core/model.ts';
import { cmpVersion, compareAudits, findPrevious } from '../src/core/compare.ts';
import { compareScreen, scoreDeltaBadge } from '../src/ui/compare.ts';
import type { Audit } from '../src/core/types.ts';

const demo: Audit = JSON.parse(readFileSync(new URL('../src/data/demo-audit.json', import.meta.url), 'utf8'));

/** Audit « après recette » fabriqué à partir du jeu de démo. */
function apresRecette(): Audit {
  const a: Audit = structuredClone(demo);
  a.id = 'AUD-DEMO-2027-01'; a.date = '2027-01'; a.version = '2'; a.audit_precedent_id = demo.id;
  const set = (id: string, statut: string) => { a.criteres.find(c => c.id_grille === id)!.statut = statut; };
  set('GTM-24', 'OK'); set('CMP-02', 'OK');   // KO → OK : C-CONS-01 résolu
  set('MAT-10', 'OK');                        // KO → OK : C-CONS-02 résolu
  set('DL-02', 'OK');                         // KO → OK, DL-03 reste KO : C-DL-01 persistant
  set('CMP-07', 'KO');                        // PARTIEL → KO : C-CONS-04 régresse
  set('CMP-09', 'OK');                        // INCONNU → OK : nouvellement évalué
  a.criteres = a.criteres.filter(c => c.id_grille !== 'DL-09'); // critère retiré
  a.criteres.push({ id_grille: 'DL-10', pilier_id: 'datalayer', axe_score: 'DATA_QUALITY', question: 'Les événements de formulaire sont-ils tracés ?', statut: 'KO', criticite: 'MOYENNE' });
  a.constats = a.constats.filter(c => c.id !== 'C-CONS-05'); // constat disparu
  a.constats.push({ id: 'C-DL-08', pilier_id: 'datalayer', titre_action: 'Tracer les soumissions de formulaire', criticite: 'MOYENNE', effort: 'S', criteres_lies: ['DL-10'] });
  return a;
}

test('scores : delta signé global, par pilier et par axe', () => {
  const cur = apresRecette(), cmp = compareAudits(demo, cur);
  const Mp = buildModel(demo), Mc = buildModel(cur);
  assert.equal(cmp.scores.global.prev, Mp.scores.global);
  assert.equal(cmp.scores.global.cur, Mc.scores.global);
  assert.equal(cmp.scores.global.delta, Mc.scores.global! - Mp.scores.global!);
  assert.ok(cmp.scores.global.delta! > 0, 'le score global progresse');
  const cons = cmp.scores.piliers.find(p => p.id === 'consentement')!;
  assert.equal(cons.delta, Mc.scores.pil.consentement! - Mp.scores.pil.consentement!);
  assert.ok(cons.delta! > 0);
  assert.deepEqual(cmp.scores.axes.map(a => a.id), ['CONFIGURATION', 'DATA_QUALITY', 'COMPLIANCE']);
  const comp = cmp.scores.axes.find(a => a.id === 'COMPLIANCE')!;
  assert.equal(comp.delta, Mc.scores.axes.COMPLIANCE! - Mp.scores.axes.COMPLIANCE!);
  // Seul avertissement attendu : un constat disparu et un nouveau (renommage possible).
  assert.equal(cmp.warnings.length, 1);
  assert.match(cmp.warnings[0], /correspondance/);
});

test('critères : améliorés, dégradés, nouvellement évalués, ajoutés, retirés', () => {
  const cmp = compareAudits(demo, apresRecette()), K = cmp.criteres;
  assert.deepEqual(K.ameliores.map(c => c.id_grille).sort(), ['CMP-02', 'DL-02', 'GTM-24', 'MAT-10']);
  assert.deepEqual(K.degrades.map(c => [c.id_grille, c.avant, c.apres]), [['CMP-07', 'PARTIEL', 'KO']]);
  assert.deepEqual(K.nouvellement_evalues.map(c => [c.id_grille, c.avant, c.apres]), [['CMP-09', 'INCONNU', 'OK']]);
  assert.deepEqual(K.nouveaux.map(c => c.id_grille), ['DL-10']);
  assert.deepEqual(K.retires.map(c => c.id_grille), ['DL-09']);
  assert.equal(K.inchanges, demo.criteres.length - 1 - 6);
  // Les statuts sont normalisés (« Non » → KO) : pas de faux changement.
  assert.ok(!K.ameliores.concat(K.degrades).some(c => c.id_grille === 'CMP-03'));
});

test('constats : résolus, persistants (avec régression), nouveaux', () => {
  const cmp = compareAudits(demo, apresRecette()), C = cmp.constats;
  const res = Object.fromEntries(C.resolus.map(c => [c.id_prev, c]));
  assert.deepEqual(Object.keys(res).sort(), ['C-CONS-01', 'C-CONS-02', 'C-CONS-05']);
  assert.equal(res['C-CONS-05'].absent, true); assert.equal(res['C-CONS-05'].id, null);
  assert.equal(res['C-CONS-01'].statut_apres, 'OK');
  const per = Object.fromEntries(C.persistants.map(c => [c.id, c]));
  assert.equal(per['C-CONS-04'].evolution, 'regresse');
  assert.equal(per['C-DL-01'].statut_avant, 'KO'); assert.equal(per['C-DL-01'].statut_apres, 'KO');
  assert.equal(C.persistants.length, demo.constats.length - 3);
  assert.deepEqual(C.nouveaux.map(c => c.id), ['C-DL-08']);
});

test('statut × criticité avant / après', () => {
  const cmp = compareAudits(demo, apresRecette());
  assert.equal(cmp.cross.cur.OK.HAUTE - cmp.cross.prev.OK.HAUTE, 4);
  assert.equal(cmp.cross.prev.KO.HAUTE - cmp.cross.cur.KO.HAUTE, 4);
  assert.equal(cmp.cross.cur.KO.MOYENNE - cmp.cross.prev.KO.MOYENNE, 2); // CMP-07 + DL-10
});

test('appariement : par question puis par titre si l’identifiant change, table de correspondance prioritaire', () => {
  const cur = apresRecette();
  cur.criteres.find(c => c.id_grille === 'MAT-05')!.id_grille = 'MAT-05b';
  const c1 = cur.constats.find(c => c.id === 'C-DL-07')!; c1.id = 'C-DL-07-v2';
  const c2 = cur.constats.find(c => c.id === 'C-DL-06')!; c2.id = 'X-06'; c2.titre_action = 'Titre réécrit'; c2.titre_court = 'Court réécrit';
  let cmp = compareAudits(demo, cur);
  assert.ok(!cmp.criteres.nouveaux.some(c => c.id_grille === 'MAT-05b'));
  assert.ok(cmp.constats.persistants.some(c => c.id === 'C-DL-07-v2' && c.appariement === 'titre'));
  assert.ok(cmp.constats.nouveaux.some(c => c.id === 'X-06'));
  assert.ok(cmp.warnings.some(w => w.includes('libellé')) && cmp.warnings.some(w => w.includes('titre')));
  cmp = compareAudits(demo, cur, { correspondances: [{ ancien_id: 'C-DL-06', nouvel_id: 'X-06' }] });
  assert.ok(cmp.constats.persistants.some(c => c.id === 'X-06' && c.id_prev === 'C-DL-06' && c.appariement === 'correspondance'));
  assert.ok(!cmp.constats.nouveaux.some(c => c.id === 'X-06'));
});

test('avertissements : autre client, précédent déclaré différent, règle de score différente', () => {
  const cur = apresRecette(); cur.client = 'Autre client'; cur.audit_precedent_id = 'AUD-X';
  cur.restitution = { ...cur.restitution, regle_score_general: 'nb_criteres' };
  const cmp = compareAudits(demo, cur);
  assert.ok(cmp.warnings.some(w => w.includes('même client')));
  assert.ok(cmp.warnings.some(w => w.includes('AUD-X')));
  assert.ok(cmp.warnings.some(w => w.includes('recalculé')));
  assert.equal(cmp.scores.global.prev, buildModel(demo, { constats: {}, ordre: null, audit: {}, restitution: { regle_score_general: 'nb_criteres' }, journal: [] }).scores.global);
});

test('findPrevious : audit_precedent_id prioritaire, sinon même client et date antérieure la plus récente', () => {
  const cur = apresRecette();
  const cands = [
    { key: 'k-cur', id: cur.id, client: cur.client, date: cur.date },
    { key: 'k-old', id: 'AUD-OLD', client: 'Client Démo', date: '2025-03' },
    { key: 'k-demo', id: demo.id, client: 'Client Démo', date: demo.date },
    { key: 'k-other', id: 'AUD-Z', client: 'Autre', date: '2026-12' },
    { key: 'k-futur', id: 'AUD-F', client: 'client demo', date: '2027-06' },
  ];
  assert.equal(findPrevious(cur, cands), 'k-demo');
  cur.audit_precedent_id = 'AUD-OLD';
  assert.equal(findPrevious(cur, cands), 'k-old');
  cur.audit_precedent_id = 'INTROUVABLE';
  assert.equal(findPrevious(cur, cands), 'k-demo');
  cur.audit_precedent_id = null;
  assert.equal(findPrevious(cur, cands.filter(c => c.key !== 'k-demo')), 'k-old');
  assert.equal(findPrevious(cur, [cands[0], cands[3]]), null);
  // Même date : départage par version.
  assert.equal(findPrevious({ ...cur, date: '2026-10', version: '2' }, [{ key: 'v1', id: 'A1', client: 'Client Démo', date: '2026-10', version: '1' }]), 'v1');
});

test('rendu : badge de delta et écran de comparaison', () => {
  assert.match(scoreDeltaBadge(12), /▲.*\+12 pts/);
  assert.match(scoreDeltaBadge(-5), /cmp-down.*−5 pts/);
  assert.match(scoreDeltaBadge(0), /cmp-flat/);
  assert.equal(scoreDeltaBadge(null), '');
  const cmp = compareAudits(demo, apresRecette());
  const s = compareScreen(cmp, [{ key: 'k-demo', label: 'Démo 10/2026' }], 'k-demo');
  assert.match(s.body, /data-cmp="ref"/);
  assert.match(s.body, /<option value="k-demo" selected>/);
  assert.match(s.body, /data-act="open" data-id="C-DL-08"/);
  assert.match(s.body, /data-evo="regresse"/);
  assert.ok(!s.body.includes('data-id="null"'));
  const vide = compareScreen(null, [], null);
  assert.match(vide.body, /Aucun audit de référence/);
  assert.match(vide.body, /data-to="import"/);
});

/* ---------- Relecture : cas limites et exigences complémentaires ---------- */

test('EXP-39 : constats disparus et nouveaux simultanés signalés « à rapprocher manuellement »', () => {
  const cmp = compareAudits(demo, apresRecette());
  const gone = cmp.constats.resolus.find(c => c.id_prev === 'C-CONS-05')!;
  const neu = cmp.constats.nouveaux.find(c => c.id === 'C-DL-08')!;
  assert.equal(gone.a_rapprocher, true); assert.equal(neu.a_rapprocher, true);
  // Constat seulement nouveau (rien n'a disparu) : pas de signalement.
  const cur = apresRecette(); cur.constats.push(structuredClone(demo.constats.find(c => c.id === 'C-CONS-05')!));
  const cmp2 = compareAudits(demo, cur);
  assert.ok(cmp2.constats.nouveaux.every(c => !c.a_rapprocher));
  assert.ok(!cmp2.warnings.some(w => w.includes('rapprocher')));
  const s = compareScreen(cmp, [], null);
  assert.match(s.body, /à rapprocher manuellement/);
});

test('DAT-39 : constat persistant modifié (criticité, critères liés) signalé', () => {
  const cur = apresRecette();
  const c = cur.constats.find(x => x.id === 'C-DL-01')!; c.criticite = 'FAIBLE';
  const cmp = compareAudits(demo, cur);
  const p = cmp.constats.persistants.find(x => x.id === 'C-DL-01')!;
  assert.equal(p.modifie, true); assert.equal(p.criticite_avant, String(demo.constats.find(x => x.id === 'C-DL-01')!.criticite).toUpperCase());
  assert.equal(p.criticite, 'FAIBLE');
  assert.ok(!cmp.constats.persistants.find(x => x.id === 'C-DL-02')!.modifie, 'constat inchangé non marqué');
});

test('DAT-40 : une correspondance inapplicable ne bloque pas l’appariement par identifiant', () => {
  const cmp = compareAudits(demo, apresRecette(), { correspondances: [{ ancien_id: 'INEXISTANT', nouvel_id: 'C-DL-02' }, { ancien_id: 'C-DL-03', nouvel_id: 'ABSENT' }] });
  const p = cmp.constats.persistants.find(x => x.id === 'C-DL-02')!;
  assert.equal(p.appariement, 'id');
  assert.equal(cmp.constats.persistants.find(x => x.id === 'C-DL-03')!.appariement, 'id');
  assert.ok(!cmp.constats.nouveaux.some(x => x.id === 'C-DL-02'));
});

test('appariement par titre : un titre vide ou non alphanumérique n’apparie rien', () => {
  const prev: Audit = structuredClone(demo), cur = apresRecette();
  prev.constats.find(c => c.id === 'C-DL-06')!.titre_action = '—';
  prev.constats.find(c => c.id === 'C-DL-06')!.titre_court = undefined;
  const c2 = cur.constats.find(c => c.id === 'C-DL-06')!; c2.id = 'X-06'; c2.titre_action = '…'; c2.titre_court = undefined;
  const cmp = compareAudits(prev, cur);
  assert.ok(cmp.constats.nouveaux.some(c => c.id === 'X-06'));
  assert.ok(!cmp.constats.persistants.some(c => c.id === 'X-06'));
});

test('pilier désactivé dans l’audit courant : ses constats ne sont pas comptés comme résolus', () => {
  const cur = apresRecette();
  cur.piliers.find(p => p.id === 'datalayer')!.actif = false;
  const cmp = compareAudits(demo, cur);
  assert.ok(!cmp.constats.resolus.some(c => c.id_prev === 'C-DL-02'));
  assert.ok(!cmp.constats.nouveaux.some(c => c.pilier_id === 'datalayer' && c.id !== 'C-DL-08'));
  assert.ok(cmp.warnings.some(w => w.includes('pilier inactif')));
  const pil = cmp.scores.piliers.find(p => p.id === 'datalayer')!;
  assert.equal(pil.cur, null); assert.equal(pil.delta, null);
});

test('règle de score : valeur absente ou null équivalente à « criticite », pas de faux avertissement', () => {
  const prev: Audit = structuredClone(demo), cur = apresRecette();
  delete prev.restitution!.regle_score_general;
  (cur.restitution as any).regle_score_general = null;
  const cmp = compareAudits(prev, cur);
  assert.ok(!cmp.warnings.some(w => w.includes('recalculé')));
  assert.equal(cmp.scores.global.prev, buildModel(demo).scores.global);
});

test('données minimales (contrat 1.0) : audits sans critères ni constats', () => {
  const a: Audit = { id: 'A', client: 'C', piliers: [], criteres: [], constats: [] } as any;
  const b: Audit = { id: 'B', client: 'C', piliers: [], criteres: [], constats: [] } as any;
  const cmp = compareAudits(a, b);
  assert.equal(cmp.scores.global.delta, null);
  assert.equal(cmp.criteres.inchanges, 0);
  assert.equal(cmp.constats.resolus.length + cmp.constats.persistants.length + cmp.constats.nouveaux.length, 0);
  const s = compareScreen(cmp, [], null);
  assert.match(s.body, /non calculable/);
  assert.match(s.titre, /– → – \/ 100/);
  // Champs absents tolérés (audit mal formé) : pas d'exception.
  assert.doesNotThrow(() => compareAudits({ id: 'X' } as any, { id: 'Y' } as any));
});

test('EXP-40 : option « masquer les scores » : seule l’évolution des constats est affichée', () => {
  const cur = apresRecette(); cur.restitution = { ...cur.restitution, masquer_scores: true };
  const cmp = compareAudits(demo, cur);
  assert.equal(cmp.masquer_scores, true);
  const s = compareScreen(cmp, [], null);
  assert.ok(!s.body.includes('cmp-score'), 'pas de barres de score');
  assert.ok(!s.body.includes('cmp-x'), 'pas de tableau statut × criticité');
  assert.ok(!/\d+ \/ 100/.test(s.titre));
  assert.match(s.body, /data-evo="regresse"/);
  // Surcharge explicite (option modifiée en mode édition).
  assert.match(compareScreen(compareAudits(demo, apresRecette()), [], null, { masquerScores: true }).body, /Scores masqués/);
});

test('filtre « Régressé » : seuls les constats régressés portent data-evo="regresse", avec statut avant et après', () => {
  const s = compareScreen(compareAudits(demo, apresRecette()), [], null).body;
  const reg = [...s.matchAll(/<li class="cmp-c[^"]*" data-evo="regresse">(.*?)<\/li>/g)];
  assert.equal(reg.length, 1);
  assert.match(reg[0][1], /st-PARTIEL.*→.*st-KO/);
  assert.match(s, /value="regresse"/);
});

test('échappement HTML : client, titres, identifiants et libellés de choix', () => {
  const prev: Audit = structuredClone(demo); prev.client = '<img src=x onerror=alert(1)>';
  const cur = apresRecette(); cur.client = prev.client; cur.version = '2"><b>';
  cur.constats.find(c => c.id === 'C-DL-08')!.titre_action = '<script>x</script>';
  const s = compareScreen(compareAudits(prev, cur), [{ key: 'k"><x', label: '<i>lbl</i>' }], 'k"><x');
  assert.ok(!s.body.includes('<img') && !s.body.includes('<script>') && !s.body.includes('<i>lbl') && !s.body.includes('2"><b>') && !s.body.includes('k"><x'));
  assert.match(s.body, /version 2&quot;&gt;&lt;b&gt;/);
  assert.match(s.body, /&lt;script&gt;/);
  assert.match(s.body, /<option value="k&quot;&gt;&lt;x" selected>/);
});

test('dates non standard : affichées telles quelles, sans « Invalid Date »', () => {
  const prev: Audit = structuredClone(demo); prev.date = 'octobre 2026';
  const s = compareScreen(compareAudits(prev, apresRecette()), [], null);
  assert.ok(!s.body.includes('Invalid Date'));
  assert.match(s.body, /octobre 2026/);
});

test('versions : comparaison par segments (1.10 > 1.9) dans findPrevious', () => {
  assert.ok(cmpVersion('1.10', '1.9')! > 0); assert.equal(cmpVersion('v2', '2'), 0); assert.equal(cmpVersion('x', '1'), null);
  const cur = { ...apresRecette(), date: '2026-10', version: '1.10', audit_precedent_id: null };
  const cands = [
    { key: 'a', id: 'A', client: 'Client Démo', date: '2026-10', version: '1.2' },
    { key: 'b', id: 'B', client: 'Client Démo', date: '2026-10', version: '1.9' },
    { key: 'c', id: 'C', client: 'Client Démo', date: '2026-10', version: '1.11' },
  ];
  assert.equal(findPrevious(cur, cands), 'b');
});

test('badge de delta : singulier, suffixe UI-57, libellé texte', () => {
  assert.match(scoreDeltaBadge(1), /\+1 pt</);
  assert.match(scoreDeltaBadge(12, 'vs audit du 12/2025'), /\+12 pts vs audit du 12\/2025/);
  assert.match(scoreDeltaBadge(-3), /en baisse/);
  assert.equal(scoreDeltaBadge(NaN), '');
});
