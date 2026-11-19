import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { buildModel } from '../src/core/model.ts';
import { buildPlanXlsx, planXlsxFilename } from '../src/export/xlsx.ts';
import { buildXlsx, escXml, colLetter } from '../src/export/ooxml.ts';
import { getLang, tx } from '../src/core/i18n.ts';

const demo = JSON.parse(readFileSync(new URL('../src/data/demo-audit.json', import.meta.url), 'utf8'));
const M = buildModel(demo);
const unzip = (u8: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(u8)).map(([k, v]) => [k, strFromU8(v)]));
const sheetIndex = (files: Record<string, string>, name: string) => {
  const names = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  return names.indexOf(name) + 1;
};
const sst = (files: Record<string, string>) => [...files['xl/sharedStrings.xml'].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
const rowCount = (xml: string) => (xml.match(/<row /g) || []).length;

/** Contrôles de bonne formation : balises équilibrées, pas de « & » nu, pas de caractère de contrôle. */
function wellFormed(name: string, xml: string) {
  assert.ok(xml.startsWith('<?xml'), `${name} : prologue`);
  assert.equal((xml.match(/<row[ >]/g) || []).length, (xml.match(/<\/row>/g) || []).length, `${name} : <row> équilibrés`);
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(xml), `${name} : & non échappé`);
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(xml), `${name} : caractère de contrôle`);
  // Pile de balises
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, tag, self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), tag, `${name} : fermeture ${tag}`);
    else stack.push(tag);
  }
  assert.equal(stack.length, 0, `${name} : balises non fermées`);
}

const FB = { [M.constats[0].id]: { decision: 'KO', commentaire: 'À corriger <vite> & bien', statut_correction: 'doing', date: '2026-11-02T10:00:00Z', auteur: 'Client' } };
const bytes = buildPlanXlsx(M, FB, { date: new Date('2026-11-19T09:00:00Z') });
const files = unzip(bytes);

test('xlsx : archive OOXML complète et 4 feuilles', () => {
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/sharedStrings.xml'])
    assert.ok(files[p], p);
  for (const n of ['Synthèse', 'Plan d&apos;action', 'Grille détaillée', 'Accès requis']) assert.ok(files['xl/workbook.xml'].includes(`name="${n}"`), n);
  assert.ok(files['xl/worksheets/sheet4.xml']);
  assert.ok(!files['xl/worksheets/sheet5.xml'], 'pas de feuille Filtres pour un export complet');
  writeFileSync('/tmp/plan_action_demo.xlsx', bytes);
});

test('xlsx : XML bien formé dans toutes les parties', () => {
  Object.entries(files).forEach(([k, v]) => wellFormed(k, v));
});

test('xlsx : grille = nb critères + 1 ; plan = nb constats + 1', () => {
  const g = files[`xl/worksheets/sheet${sheetIndex(files, 'Grille détaillée')}.xml`];
  assert.equal(rowCount(g), M.crits.length + 1);
  const p = files[`xl/worksheets/sheet${sheetIndex(files, 'Plan d&apos;action')}.xml`];
  assert.equal(rowCount(p), M.constats.length + 1);
  assert.ok(p.includes('state="frozen"') && p.includes('<autoFilter ref="A1:'), 'volet figé + filtre');
  assert.ok(p.includes('<dataValidation type="list"'), 'liste de statut de correction');
  assert.ok(files['xl/workbook.xml'].includes('_xlnm._FilterDatabase'));
});

test('xlsx : contenus (titre de constat, libellés grille, feedback échappé, nombres)', () => {
  const s = sst(files);
  const titre = typeof M.constats[0].titre_action === 'string' ? M.constats[0].titre_action : M.constats[0].titre_action.fr!;
  assert.ok(s.includes(escXml(titre)), 'titre de constat');
  assert.ok(s.includes('Yes') && s.includes('No') && s.includes('High'), 'libellés EN de la grille');
  assert.ok(s.includes('À corriger &lt;vite&gt; &amp; bien'), 'commentaire feedback échappé');
  assert.ok(s.includes('En cours'));
  const p = files['xl/worksheets/sheet2.xml'];
  assert.match(p, /<c r="A2" s="\d+"><v>1<\/v><\/c>/, 'rang en numérique');
  assert.ok(files['xl/worksheets/sheet1.xml'].includes('<v>' + M.scores.global + '</v>'), 'score général');
});

test('xlsx : export filtré réduit la grille et ajoute la feuille Filtres appliqués', () => {
  const sub = M.crits.filter(k => k.statut === 'KO');
  assert.ok(sub.length > 0 && sub.length < M.crits.length);
  const f = unzip(buildPlanXlsx(M, {}, { criteres: sub, filtres: { Statut: 'KO' } }));
  const g = f[`xl/worksheets/sheet${sheetIndex(f, 'Grille détaillée')}.xml`];
  assert.equal(rowCount(g), sub.length + 1);
  assert.ok(f['xl/workbook.xml'].includes('name="Filtres appliqués"'));
});

test('xlsx : version anglaise et langue courante restaurée', () => {
  const before = getLang();
  const f = unzip(buildPlanXlsx(M, {}, { lang: 'en' }));
  for (const n of ['Summary', 'Action plan', 'Detailed grid', 'Required access']) assert.ok(f['xl/workbook.xml'].includes(`name="${n}"`), n);
  assert.ok(sst(f).includes('To do'));
  assert.equal(getLang(), before);
});

test('ooxml : échappement, caractères de contrôle, colonnes, types', () => {
  assert.equal(escXml('a & <b> "c"\x01\x1F'), 'a &amp; &lt;b&gt; &quot;c&quot;');
  assert.equal(colLetter(0), 'A'); assert.equal(colLetter(25), 'Z'); assert.equal(colLetter(26), 'AA'); assert.equal(colLetter(701), 'ZZ');
  const f = unzip(buildXlsx([{ name: 'T[1]:x', rows: [['x\x07y', 3.5, true, new Date(Date.UTC(2026, 0, 1)), null]] }]));
  wellFormed('sheet', f['xl/worksheets/sheet1.xml']);
  assert.ok(f['xl/workbook.xml'].includes('name="T 1  x"'));
  assert.ok(f['xl/worksheets/sheet1.xml'].includes('<v>3.5</v>') && f['xl/worksheets/sheet1.xml'].includes('t="b"'));
  assert.ok(sst(f).includes('xy'));
  assert.equal(planXlsxFilename(M), 'plan_action_' + String(M.audit.client).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.xlsx');
});

/* ---------- Tests renforcés : lecture des cellules ---------- */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** Feuille → tableau de lignes { colonne → valeur } (chaînes partagées résolues, nombres en number). */
function readSheet(f: Record<string, string>, name: string) {
  const strings = [...f['xl/sharedStrings.xml'].matchAll(/<si><t[^>]*>([^<]*)<\/t><\/si>/g)].map(m => unesc(m[1]));
  const idx = sheetIndex(f, name.replace(/'/g, '&apos;'));
  assert.ok(idx > 0, `feuille ${name}`);
  const xml = f[`xl/worksheets/sheet${idx}.xml`];
  const rows: Record<string, { v: string | number | boolean | null; s?: string }>[] = [];
  for (const rm of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)) {
    const row: Record<string, any> = {};
    for (const cm of rm[2].matchAll(/<c r="([A-Z]+)\d+"((?: [a-z]+="[^"]*")*)(?:\/>|><v>([^<]*)<\/v><\/c>)/g)) {
      const attrs = Object.fromEntries([...cm[2].matchAll(/ ([a-z]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
      const raw = cm[3];
      row[cm[1]] = { s: attrs.s, v: raw === undefined ? null : attrs.t === 's' ? strings[+raw] : attrs.t === 'b' ? raw === '1' : Number(raw) };
    }
    rows[+rm[1] - 1] = row;
  }
  return { xml, rows, col: (label: string) => { const e = Object.entries(rows[0]).find(([, c]) => c.v === label); assert.ok(e, `colonne ${label}`); return e![0]; } };
}
const val = (r: Record<string, any> | undefined, c: string) => r?.[c]?.v ?? null;

test('xlsx renforcé : aucune valeur « undefined », « null » ou « NaN » écrite', () => {
  for (const s of sst(files)) assert.ok(!/\b(undefined|null|NaN)\b/.test(s), s);
});

test('xlsx renforcé : xmllint valide chaque partie (si disponible)', t => {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { t.skip('xmllint absent'); return; }
  for (const [k, v] of Object.entries(files)) {
    const p = join(tmpdir(), 'xlsx-part-' + k.replace(/[^\w.]/g, '_'));
    writeFileSync(p, v);
    execFileSync('xmllint', ['--noout', p]);
  }
});

test('xlsx renforcé : synthèse cohérente avec le modèle (scores, statut × criticité)', () => {
  const s = readSheet(files, 'Synthèse');
  const flat = s.rows.flatMap(r => Object.values(r || {}).map(c => c.v));
  assert.ok(flat.includes(M.scores.global));
  const ko = s.rows.find(r => val(r, 'A') === 'KO')!;
  assert.deepEqual([val(ko, 'B'), val(ko, 'C'), val(ko, 'D')], [M.cross.KO.HAUTE, M.cross.KO.MOYENNE, M.cross.KO.FAIBLE]);
  assert.equal(val(ko, 'E'), M.cross.KO.HAUTE + M.cross.KO.MOYENNE + M.cross.KO.FAIBLE);
  const tot = s.rows.find(r => val(r, 'A') === 'Total des critères')!;
  assert.equal(val(tot, 'B'), M.crits.length);
});

test('xlsx renforcé : plan d’action (rang, constats masqués inclus, feedback, date, validation)', () => {
  const masked = JSON.parse(JSON.stringify(demo));
  masked.constats[0].visible = false;
  const M2 = buildModel(masked);
  const c0 = M2.constats[0];
  const fb = { [c0.id]: { decision: 'OK', commentaire: 'RAS', statut_correction: 'tested', date: '2026-11-02T10:00:00Z', auteur: 'Client' } };
  const f = unzip(buildPlanXlsx(M2, fb));
  const p = readSheet(f, 'Plan d\'action');
  assert.equal(p.rows.length, M2.constats.length + 1);
  const ids = p.rows.slice(1).map(r => val(r, p.col('ID constat')));
  assert.deepEqual(ids, M2.constats.map(c => c.id), 'ordre de rang');
  const hid = p.rows.find(r => val(r, p.col('ID constat')) === masked.constats[0].id)!;
  assert.equal(val(hid, p.col('Visible')), 'Non', 'constat masqué présent et signalé');
  const r1 = p.rows[1];
  assert.equal(val(r1, p.col('Rang')), 1);
  assert.equal(val(r1, p.col('Feedback')), 'OK');
  assert.equal(val(r1, p.col('Statut de correction')), 'Recetté');
  assert.equal(val(r1, p.col('Auteur feedback')), 'Client');
  assert.equal(typeof val(r1, p.col('Date feedback')), 'number', 'date Excel numérique');
  assert.equal(typeof val(r1, p.col('Impact (1-3)')), 'number');
  const corr = p.col('Statut de correction');
  assert.match(p.xml, new RegExp(`sqref="${corr}2:${corr}${M2.constats.length + 1}"><formula1>&quot;À faire,En cours,Corrigé,Recetté&quot;</formula1>`));
  assert.ok(p.xml.indexOf('<sheetData>') < p.xml.indexOf('<autoFilter') && p.xml.indexOf('<autoFilter') < p.xml.indexOf('<dataValidations'), 'ordre des éléments OOXML');
});

test('xlsx renforcé : grille, critère lié à deux constats (feedback répété avec ID, EXP-37)', () => {
  const d = JSON.parse(JSON.stringify(demo));
  const kid = d.constats[0].criteres_lies[0];
  d.constats[1].criteres_lies = [...(d.constats[1].criteres_lies || []), kid];
  const M2 = buildModel(d);
  const [a, b] = M2.linkOf[kid].slice().sort((x, y) => x.rang - y.rang);
  const fb = { [b.id]: { decision: 'KO', commentaire: 'Encore présent', auteur: 'Dev', date: '2026-11-03T08:00:00Z', statut_correction: 'doing' } };
  const g = readSheet(unzip(buildPlanXlsx(M2, fb)), 'Grille détaillée');
  assert.equal(g.rows.length, M2.crits.length + 1);
  for (const r of g.rows) assert.ok(Object.keys(r).length <= Object.keys(g.rows[0]).length, 'pas de cellule hors en-tête');
  const row = g.rows.find(r => val(r, g.col('ID')) === kid)!;
  assert.equal(val(row, g.col('Constat lié')), `${a.id} · ${tx(a.titre_action)}\n${b.id} · ${tx(b.titre_action)}`);
  assert.equal(val(row, g.col('Rang')), a.rang, 'rang du constat le mieux classé');
  assert.equal(val(row, g.col('Feedback')), `${a.id} : —\n${b.id} : KO`, 'alignement conservé');
  assert.equal(val(row, g.col('Commentaire feedback')), `${a.id} : —\n${b.id} : Encore présent`);
  assert.equal(val(row, g.col('Auteur feedback')), `${a.id} : —\n${b.id} : Dev`);
  assert.equal(typeof val(row, g.col('Date feedback')), 'number');
  assert.equal(val(row, g.col('Statut de correction')), `${a.id} : À faire\n${b.id} : En cours`);
  const ev = g.col('Evaluation');
  const k0 = M2.kmap[kid];
  assert.equal(val(row, ev), ({ OK: 'Yes', KO: 'No', PARTIEL: 'Partly' } as any)[k0.statut] ?? val(row, ev));
});

test('xlsx renforcé : libellés de grille dans la langue de l’export (option Q7)', () => {
  const g = readSheet(unzip(buildPlanXlsx(M, {}, { libellesGrille: 'langue' })), 'Grille détaillée');
  const ev = g.col('Evaluation'), cr = g.col('Criticality');
  const vals = new Set(g.rows.slice(1).map(r => val(r, ev)));
  assert.ok(!vals.has('Yes') && !vals.has('No'));
  assert.ok([...vals].every(v => ['OK', 'Partiel', 'KO', 'Non concerné', 'Inconnu', 'À revoir'].includes(String(v))), [...vals].join());
  assert.ok(g.rows.slice(1).every(r => ['Haute', 'Moyenne', 'Faible', 'Aucune'].includes(String(val(r, cr)))));
});

test('xlsx renforcé : export filtré (ordre conservé, plan restreint, feuille Filtres complète)', () => {
  const sub = M.crits.filter(k => k.statut === 'KO').reverse();
  const f = unzip(buildPlanXlsx(M, {}, { criteres: sub, filtres: { Recherche: 'gtm & <ga4>', Statut: 'KO' }, date: new Date('2026-11-19T09:00:00Z') }));
  const g = readSheet(f, 'Grille détaillée');
  assert.deepEqual(g.rows.slice(1).map(r => val(r, g.col('ID'))), sub.map(k => k.id_grille), 'ordre de tri en cours');
  const p = readSheet(f, 'Plan d\'action');
  const keep = new Set(sub.map(k => k.id_grille));
  const expected = M.constats.filter(c => (c.criteres_lies || []).some(id => keep.has(id))).map(c => c.id);
  assert.deepEqual(p.rows.slice(1).map(r => val(r, p.col('ID constat'))), expected);
  const fl = readSheet(f, 'Filtres appliqués');
  const kv = Object.fromEntries(fl.rows.slice(1).map(r => [val(r, 'A'), val(r, 'B')]));
  assert.equal(kv['Recherche'], 'gtm & <ga4>');
  assert.equal(kv['Critères exportés'], `${sub.length} sur ${M.crits.length}`);
  assert.equal(kv['Constats exportés'], `${expected.length} sur ${M.constats.length}`);
  assert.equal(kv['Version'], String(M.audit.version ?? ''));
  assert.equal(kv["Date de l'audit"], String(M.audit.date ?? ''));
  assert.equal(typeof kv["Date d'export"], 'number');
  Object.entries(f).forEach(([k, v]) => wellFormed(k, v));
});

test('xlsx renforcé : scores masqués', () => {
  const d = JSON.parse(JSON.stringify(demo));
  d.restitution = { ...(d.restitution || {}), masquer_scores: true };
  const s = readSheet(unzip(buildPlanXlsx(buildModel(d), {})), 'Synthèse');
  const flat = s.rows.flatMap(r => Object.values(r || {}).map(c => c.v));
  assert.ok(flat.includes('Scores masqués pour cette restitution.'));
  assert.ok(!flat.includes('Score général'));
});

test('xlsx renforcé : audit minimal (contrat 1.0, sans client, constats ni accès) sans erreur', () => {
  const Mv = buildModel({ id: 'vide', piliers: [], criteres: [], constats: [] } as any);
  const f = unzip(buildPlanXlsx(Mv, null as any, { criteres: [] }));
  Object.entries(f).forEach(([k, v]) => wellFormed(k, v));
  for (const s of sst(f)) assert.ok(!/\b(undefined|null|NaN)\b/.test(s), s);
  assert.equal(rowCount(f['xl/worksheets/sheet3.xml']), 1);
  assert.ok(!f['xl/worksheets/sheet2.xml'].includes('<dataValidations'));
  assert.equal(planXlsxFilename(Mv), 'plan_action_audit.xlsx');
  // Contrat 1.0 : pas de référentiel outils ni d'accès déclarés, critère INCONNU faute d'accès → accès déduit.
  const d10 = { id: 'a10', client: 'Test 1.0', piliers: [{ id: 'P1', libelle: 'Pilier', outils: ['GTM'] }],
    criteres: [{ id_grille: 'C1', pilier_id: 'P1', outil: 'GTM', question: 'Q ?', statut: 'Unknown', criticite: 'haute', motif_non_evalue: 'acces' }],
    constats: [{ id: 'F1', pilier_id: 'P1', titre_action: 'Faire', criticite: 'HAUTE', criteres_lies: ['C1', 'ABSENT'] }] };
  const f10 = unzip(buildPlanXlsx(buildModel(d10 as any), {}));
  const a = readSheet(f10, 'Accès requis');
  assert.equal(val(a.rows[1], a.col('Origine')), 'Déduit des critères inconnus');
  const g = readSheet(f10, 'Grille détaillée');
  assert.equal(val(g.rows[1], g.col('Evaluation')), 'Unknown');
  assert.equal(val(g.rows[1], g.col('Accès requis')), 'Accès à GTM');
});
