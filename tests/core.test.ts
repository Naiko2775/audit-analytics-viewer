import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/core/model.ts';
import { validate } from '../src/core/validate.ts';
import { score, quadrant } from '../src/core/rules.ts';
import { parseJson } from '../src/core/validate.ts';
import { bundleFrom, makeResolver, safePath } from '../src/core/evidence.ts';
import { zipSync, strToU8, unzipSync } from 'fflate';

const demo = JSON.parse(readFileSync(new URL('../src/data/demo-audit.json', import.meta.url), 'utf8'));

test('score pondéré par criticité', () => {
  assert.equal(score([{ statut: 'OK', criticite: 'HAUTE' }, { statut: 'KO', criticite: 'FAIBLE' }]), 75);
  assert.equal(score([{ statut: 'NA', criticite: 'HAUTE' }]), null);
  assert.equal(score([{ statut: 'PARTIEL', criticite: 'MOYENNE' }]), 50);
});
test('quadrants D4', () => {
  assert.equal(quadrant(3, 'S'), 'QW'); assert.equal(quadrant(2, 'L'), 'LT');
  assert.equal(quadrant(1, 'S'), 'DER'); assert.equal(quadrant(1, 'M'), 'PEU');
});
test('le jeu de démonstration 1.1 passe la validation sans erreur bloquante', () => {
  const r = validate(demo);
  assert.deepEqual(r.E, []);
});
test('modèle : constats classés, Quick Wins en tête', () => {
  const M = buildModel(demo);
  assert.equal(M.constats[0].quadrant, 'QW');
  assert.ok(M.scores.global! >= 0 && M.scores.global! <= 100);
  M.constats.forEach((c, i) => assert.equal(c.rang, i + 1));
});
test('accès requis : demandes déclarées et critères rattachés', () => {
  const M = buildModel(demo);
  const a = M.acces.find(x => x.id === 'ACC-01')!;
  assert.equal(a.outil?.libelle, 'GTM');
  assert.deepEqual(a.criteres.map(c => c.id_grille), ['GTM-03']);
});
test('accès requis : critère INCONNU faute d\'accès sans demande → ligne automatique', () => {
  const d = structuredClone(demo);
  d.criteres.push({ id_grille: 'X-1', pilier_id: 'datalayer', outil_id: 'matomo', question: '?', statut: 'Unknown', criticite: 'FAIBLE', motif_non_evalue: 'acces' });
  const M = buildModel(d);
  assert.ok(M.acces.some(x => x.auto && x.criteres.some(c => c.id_grille === 'X-1')));
});
test('validation : erreurs bloquantes', () => {
  assert.ok(validate({}).E.length > 0);
  const d = structuredClone(demo);
  d.constats[0].preuves[0].annotations[0].statut = 'BOF';
  assert.ok(validate(d).E.some(e => e.message.includes('BOF')));
});
test('compatibilité contrat 1.0 (outils en libellés, annotations numériques)', () => {
  const d = JSON.parse(readFileSync(new URL('../src/data/demo-v1.0.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(d).E, []);
  const M = buildModel(d);
  assert.ok(M.outilsRef.some(o => o.libelle === 'Didomi'));
});

/* ---------- Module d'import ---------- */
const codes = (l: { code: string }[]) => l.map(i => i.code);
test('JSON invalide : ligne et colonne de l\'erreur (DAT-12)', () => {
  const r = parseJson('{\n  "id": "A",\n  "client": oups\n}');
  assert.equal(r.ok, false);
  if (!r.ok) { assert.match(r.issue.objet, /ligne 3/); assert.equal(r.issue.code, 'JSON_SYNTAXE'); }
});
test('toutes les erreurs listées en une passe : doublons, impact hors bornes, pilier inconnu (DAT-15)', () => {
  const d = structuredClone(demo);
  d.criteres.push(structuredClone(d.criteres[0]));
  d.constats[1].impact_score = 5;
  d.constats[2].pilier_id = 'fantome';
  const r = validate(d);
  assert.ok(codes(r.E).includes('DOUBLON'));
  assert.ok(codes(r.E).includes('IMPACT'));
  assert.ok(codes(r.E).includes('PILIER'));
});
test('effort incohérent avec les semaines : avertissement', () => {
  const d = structuredClone(demo); d.constats[0].effort = 'S'; d.constats[0].effort_semaines = 4;
  assert.ok(validate(d).W.some(w => w.code === 'EFFORT' && w.objet.includes(d.constats[0].id)));
});
test('preuve référencée absente : erreur si HAUTE, avertissement sinon (DAT-13)', () => {
  const d = structuredClone(demo);
  const h = d.constats.find((c: any) => c.criticite === 'HAUTE'); h.preuves = [{ id: 'PX', fichier: 'preuves/absente.png' }];
  const f = d.constats.find((c: any) => c.criticite === 'FAIBLE' && c.preuves.length); f.preuves = [{ id: 'PY', fichier: 'preuves/absente2.png' }];
  const r = validate(d, { assets: new Set(), resolve: () => null });
  assert.ok(r.E.some(e => e.code === 'PREUVE_MANQUANTE' && e.objet.includes('PX')));
  assert.ok(r.W.some(e => e.code === 'PREUVE_MANQUANTE' && e.objet.includes('PY')));
  assert.equal(r.stats!.preuves.manquantes, 2);
});
test('constat HAUTE sans preuve ni situation : erreur §7.2', () => {
  const d = structuredClone(demo); const h = d.constats.find((c: any) => c.criticite === 'HAUTE'); h.preuves = []; h.situation = [];
  assert.ok(validate(d).E.some(e => e.code === 'R72_ETAI'));
});
test('chemins dangereux rejetés', () => {
  assert.equal(safePath('../etc/passwd'), null); assert.equal(safePath('/abs.png'), null); assert.equal(safePath('C:/x.png'), null);
  assert.equal(safePath('./preuves\\a.png'), 'preuves/a.png');
});
test('archive : dossier racine détecté, preuves résolues, rejets et orphelins signalés', () => {
  const d = structuredClone(demo);
  const c = d.constats[0]; c.preuves = [{ id: 'PZ', fichier: 'preuves/doubleclick_network.png', legende: 'x' }];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const zip = zipSync({ 'export_skill/audit.json': strToU8(JSON.stringify(d)), 'export_skill/preuves/doubleclick_network.png': png,
    'export_skill/preuves/inutile.png': png, 'export_skill/script.exe': png, '__MACOSX/._audit.json': png });
  const entries = Object.entries(unzipSync(zip)).map(([name, bytes]) => ({ name, bytes }));
  entries.push({ name: '../evil.png', bytes: png });
  const b = bundleFrom(entries);
  assert.equal(b.root, 'export_skill/');
  assert.ok(b.audit);
  assert.ok(b.issues.some(i => i.objet === '../evil.png'));
  assert.ok(b.issues.some(i => i.objet.endsWith('script.exe')));
  const resolve = makeResolver(b.assets);
  assert.equal(resolve('preuves/doubleclick_network.png'), 'preuves/doubleclick_network.png');
  assert.equal(resolve('doubleclick_network.png'), 'preuves/doubleclick_network.png');
  const r = validate(JSON.parse(b.audit!.text), { assets: new Set(b.assets.keys()), resolve });
  assert.ok(!r.E.some(e => e.objet.includes('PZ')));
  assert.ok(r.I.some(i => i.code === 'PREUVE_ORPHELINE' && i.objet === 'preuves/inutile.png'));
});
test('position d\'erreur JSON : virgule finale, guillemet manquant', () => {
  const a = parseJson('{"a": [1, 2,]}'); assert.ok(!a.ok && a.issue.objet === 'ligne 1, colonne 13');
  const b = parseJson('{\n "a": "x\n}'); assert.ok(!b.ok && /ligne 2/.test(b.issue.objet));
  assert.ok(parseJson(JSON.stringify(demo)).ok);
});
test('logo client relatif : résolu depuis l\'archive, non signalé orphelin', () => {
  const d = structuredClone(demo); d.logo = 'preuves/logo.png';
  const assets = new Set(['preuves/logo.png']);
  const r = validate(d, { assets, resolve: (f: string) => (assets.has(f) ? f : null) });
  assert.ok(!r.I.some(i => i.code === 'PREUVE_ORPHELINE'));
  const r2 = validate(d, { assets: new Set(), resolve: () => null });
  assert.ok(r2.W.some(w => w.code === 'LOGO' && w.message.includes('introuvable')));
});
