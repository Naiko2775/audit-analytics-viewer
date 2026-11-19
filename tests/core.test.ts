import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel } from '../src/core/model.ts';
import { validate } from '../src/core/validate.ts';
import { score, quadrant } from '../src/core/rules.ts';

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
  assert.ok(validate(d).E.some(e => e.includes('BOF')));
});
test('compatibilité contrat 1.0 (outils en libellés, annotations numériques)', () => {
  const d = JSON.parse(readFileSync(new URL('../src/data/demo-v1.0.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(d).E, []);
  const M = buildModel(d);
  assert.ok(M.outilsRef.some(o => o.libelle === 'Didomi'));
});
