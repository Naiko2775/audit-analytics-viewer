import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { readXlsx, colIndex, decodeXml } from '../src/core/xlsx-read.ts';
import { convertGrid, headerKey, normEvaluation, normCriticite, axeFromSubject, sheetKind } from '../src/core/grid.ts';
import { validate } from '../src/core/validate.ts';
import { buildModel } from '../src/core/model.ts';
import { makeGrid, makeXlsx, SHARED_ACTION } from './fixtures/make-grid.ts';

test('xlsx-read : références, entités, chaînes partagées, inlineStr, rich text, fusions', () => {
  assert.equal(colIndex('A1'), 0); assert.equal(colIndex('Z9'), 25); assert.equal(colIndex('AB12'), 27);
  assert.equal(decodeXml('a &amp; b &lt;c&gt; &#233;&#x20AC; _x000D_'), 'a & b <c> é€ \r');
  const bytes = makeXlsx([
    { name: 'S & 1', rows: [['Titre fusionné'], [null, 'Rich **text**', 42, true, 'x < y']], merges: ['A1:C1'] },
    { name: 'Inline', rows: [['a', null, 'c']], inline: true },
  ]);
  const wb = readXlsx(bytes);
  assert.deepEqual(wb.sheets.map(s => s.name), ['S & 1', 'Inline']);
  assert.deepEqual(wb.sheets[0].rows[0], ['Titre fusionné', 'Titre fusionné', 'Titre fusionné']);
  assert.deepEqual(wb.sheets[0].rows[1], [null, 'Rich text', 42, true, 'x < y']);
  assert.deepEqual(wb.sheets[1].rows[0], ['a', null, 'c']);
  assert.throws(() => readXlsx(strToU8('pas un zip')));
  // Cellule t="str" (formule) et préfixes d'espace de noms
  const raw = zipSync({
    'xl/workbook.xml': strToU8('<x:workbook xmlns:x="m"><x:sheets><x:sheet name="F" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<x:worksheet><x:sheetData><x:row r="2"><x:c r="B2" t="str"><x:f>A1</x:f><x:v>calc</x:v></x:c><x:c r="D2"><x:v>1.5</x:v></x:c></x:row></x:sheetData></x:worksheet>'),
  });
  const f = readXlsx(raw).sheets[0];
  assert.equal(f.name, 'F');
  assert.deepEqual(f.rows[1], [null, 'calc', null, 1.5]);
});

test('référentiels : en-têtes, évaluations, criticités, axes, onglets', () => {
  assert.equal(headerKey('  SUBJECT '), 'subject');
  assert.equal(headerKey('Criteria + Controlled elements'), 'criteria');
  assert.equal(headerKey('Évaluation'), 'evaluation');
  assert.equal(headerKey('Suggested Corrective Action'), 'action');
  assert.equal(headerKey('Criticité'), 'criticality');
  assert.equal(headerKey('Éléments contrôlés'), 'element');
  ['oui', 'OUI', ' Oui ', 'Yes'].forEach(v => assert.equal(normEvaluation(v), 'OK'));
  assert.equal(normEvaluation('À revoir'), 'A_REVOIR'); assert.equal(normEvaluation('A revoir'), 'A_REVOIR');
  assert.equal(normEvaluation('Partiellement'), 'PARTIEL'); assert.equal(normEvaluation('Non concerné'), 'NA');
  assert.equal(normEvaluation('N/A ?'), null);
  assert.equal(normCriticite('No impact'), 'AUCUNE'); assert.equal(normCriticite('Haute'), 'HAUTE'); assert.equal(normCriticite('medium'), 'MOYENNE');
  for (const s of ['Administration', 'Configuration', 'Naming Convention', 'Product linking', 'Product configuration']) assert.equal(axeFromSubject(s), 'CONFIGURATION');
  assert.equal(axeFromSubject('Data Quality'), 'DATA_QUALITY'); assert.equal(axeFromSubject('Compliance'), 'COMPLIANCE');
  assert.deepEqual(sheetKind('Google Analytics 4'), { kind: 'domain', dom: 'GA4' });
  assert.deepEqual(sheetKind('Universal Analytics'), { kind: 'domain', dom: 'UA' });
  assert.deepEqual(sheetKind('Compliance OneTrust'), { kind: 'domain', dom: 'CMP' });
  assert.equal(sheetKind('0. Content').kind, 'content');
  assert.equal(sheetKind('Réponses').kind, 'fr');
  assert.equal(sheetKind('Tracking').kind, 'tracking');
});

test('grille EN complète : effectifs, normalisation, UA obsolète, constats, validation', () => {
  const { audit, report } = convertGrid(makeGrid({ withFr: true, frEvaluated: 10 }));
  assert.ok(audit, JSON.stringify(report.E));
  assert.equal(report.E.length, 0);
  assert.equal(audit.langue, 'en');
  assert.equal(audit.schema_version, '1.1');
  assert.equal(audit.client, 'Client Démo Grille');
  assert.equal(audit.date, '2026-10');
  const by = (p: string) => audit.criteres.filter(c => c.id_grille.startsWith(p + '-'));
  assert.equal(by('DL').length, 23); assert.equal(by('GTM').length, 32); assert.equal(by('GA4').length, 47);
  assert.equal(by('CMP').length, 4); assert.equal(by('UA').length, 23); assert.equal(by('TRK').length, 1);
  assert.ok(audit.criteres.find(c => c.id_grille === 'GTM-24') && audit.criteres.find(c => c.id_grille === 'CMP-02'));
  // Normalisation : tous les statuts et criticités sont dans les référentiels
  audit.criteres.forEach(c => {
    assert.ok(['OK', 'PARTIEL', 'KO', 'NA', 'INCONNU', 'A_REVOIR'].includes(c.statut), c.statut);
    assert.ok(['HAUTE', 'MOYENNE', 'FAIBLE', 'AUCUNE'].includes(c.criticite), c.criticite);
  });
  // Évaluation vide → INCONNU listé en information
  const dl5 = audit.criteres.find(c => c.id_grille === 'DL-05')!;
  assert.equal(dl5.statut, 'INCONNU');
  assert.ok(report.I.some(i => i.code === 'GRILLE_NON_EVALUE' && i.objet.startsWith('DL-05')));
  // Subject fusionné recopié ; Criteria + Controlled elements scindé ; domaine agnostique
  assert.equal(audit.criteres.find(c => c.id_grille === 'DL-03')!.subject, audit.criteres.find(c => c.id_grille === 'DL-02')!.subject);
  const ga = audit.criteres.find(c => c.id_grille === 'GA4-01')!;
  assert.equal(ga.element_controle, 'GA4 element 1'); assert.equal(ga.domaine, 'Analytics'); assert.equal(ga.outil_id, 'ga4');
  assert.equal(audit.criteres.find(c => c.id_grille === 'GTM-01')!.domaine, 'TMS');
  // UA archivé
  assert.ok(by('UA').every(c => c.obsolete === true));
  assert.ok(audit.criteres.filter(c => !c.id_grille.startsWith('UA-')).every(c => !c.obsolete));
  // Axe et piliers
  audit.criteres.filter(c => c.axe_score === 'COMPLIANCE').forEach(c => assert.equal(c.pilier_id, 'consentement'));
  assert.equal(audit.criteres.find(c => c.id_grille === 'GA4-01')!.pilier_id, 'analytics');
  assert.deepEqual(audit.piliers.map(p => p.id), ['consentement', 'datalayer', 'analytics']);
  assert.deepEqual(audit.outils!.map(o => o.id).sort(), ['ga4', 'gtm', 'onetrust', 'ua']);
  // Tracking : Top prio reporté
  assert.equal(audit.criteres.find(c => c.id_grille === 'DL-01')!.top_prio, true);
  assert.equal(audit.criteres.find(c => c.id_grille === 'TRK-01')!.statut, 'INCONNU');
  // Constats : tout KO / PARTIEL HAUTE ou MOYENNE non obsolète est rattaché ; regroupement par action identique
  const linked = new Set(audit.constats.flatMap(c => c.criteres_lies || []));
  const cible = audit.criteres.filter(c => !c.obsolete && ['KO', 'PARTIEL'].includes(c.statut) && ['HAUTE', 'MOYENNE'].includes(c.criticite));
  assert.ok(cible.length > 5);
  cible.forEach(c => assert.ok(linked.has(c.id_grille), c.id_grille));
  assert.ok(audit.criteres.filter(c => c.obsolete).every(c => !linked.has(c.id_grille)));
  audit.constats.forEach(c => {
    assert.ok(String(c.titre_action).length <= 80); assert.equal(c.effort, 'M'); assert.equal(c.visible, true);
    assert.ok((c.situation || []).length >= 1);
  });
  const grp = audit.constats.find(c => c.titre_action === SHARED_ACTION)!;
  assert.equal(grp.criteres_lies!.length, 2);
  assert.ok(grp.criteres_lies!.every(id => id.startsWith('GTM-')));
  assert.equal(audit.constats.filter(c => c.titre_action === SHARED_ACTION).length, 1);
  // DAT-10 : légende inversée signalée ; décalage GTM 29-31 signalé
  const leg = report.W.filter(w => w.code === 'GRILLE_LEGENDE');
  assert.equal(leg.length, 1); assert.ok(!leg[0].objet.endsWith('ligne 3'), 'la ligne d’en-tête n’est pas une légende');
  assert.ok(report.I.some(i => i.code === 'GRILLE_DECALAGE' && i.objet.startsWith('GTM-30')));
  assert.ok(report.I.some(i => i.code === 'GRILLE_SOURCE'));
  // Contrat : aucune erreur bloquante, moteur opérant
  const v = validate(audit);
  assert.deepEqual(v.E, []);
  const M = buildModel(audit as any);
  assert.ok(M);
});

test('grille FR seule (onglet « Réponses ») : langue fr, domaines par sections et ID', () => {
  const { audit, report } = convertGrid(makeGrid({ frOnly: true, frEvaluated: 100 }), { client: 'ACME', date: '2026-11' });
  assert.ok(audit, JSON.stringify(report.E));
  assert.equal(audit.langue, 'fr'); assert.equal(audit.client, 'ACME'); assert.equal(audit.date, '2026-11');
  assert.equal(audit.criteres.length, 23 + 32 + 47 + 4 + 23);
  assert.equal(audit.criteres.filter(c => c.statut === 'INCONNU').length >= 129 - 100, true);
  assert.equal(audit.criteres.find(c => c.id_grille === 'CMP-02')!.domaine, 'CMP');
  assert.ok(audit.constats.some(c => /^Mettre en conformité|^Harmoniser/.test(String(c.titre_action))));
  assert.deepEqual(validate(audit).E, []);
});

test('options : piliers personnalisés, UA retiré, inversion forcée, corrections, constats désactivés', () => {
  const bytes = makeGrid();
  const { audit } = convertGrid(bytes, {
    ua: 'retirer', inverserImpactAction: true, corrections: { 'GTM-29': { question: 'Q corrigée', element_controle: 'E corrigé' } },
    piliers: [
      { id: 'tag', libelle: 'Tags & conformité', domaines: ['GTM', 'CMP', 'DL'] },
      { id: 'ga', libelle: 'GA4', domaines: ['GA4', 'UA'] },
    ],
  });
  assert.ok(audit);
  assert.ok(!audit.criteres.some(c => c.id_grille.startsWith('UA-')));
  assert.deepEqual(audit.piliers.map(p => p.id), ['tag', 'ga']);
  const g29 = audit.criteres.find(c => c.id_grille === 'GTM-29')!;
  assert.equal(g29.question, 'Q corrigée'); assert.equal(g29.element_controle, 'E corrigé');
  const c = audit.constats[0];
  assert.ok(String(c.impact?.[0] ?? '').startsWith('Mettre'), 'impact ← action après inversion');
  assert.ok(String(c.recommandations?.[0] ?? '').startsWith('Risque'));
  assert.deepEqual(validate(audit).E, []);
  assert.equal(convertGrid(bytes, { constats: false }).audit!.constats.length, 0);
});

test('fichiers invalides : rapport d’erreur, pas d’audit', () => {
  const r1 = convertGrid(strToU8('nope'));
  assert.equal(r1.audit, null); assert.equal(r1.report.E[0].code, 'GRILLE_FICHIER');
  const r2 = convertGrid(makeXlsx([{ name: 'Feuil1', rows: [['rien'], ['à', 'lire']] }]));
  assert.equal(r2.audit, null); assert.equal(r2.report.E[0].code, 'GRILLE_VIDE');
  // Évaluation non reconnue → INCONNU avec avertissement citant la valeur
  const r3 = convertGrid(makeXlsx([
    { name: 'GTM', rows: [['Criteria', 'Evaluation', 'Criticality'], ['Is GTM installed?', 'N/A ?', 'High'], ['Is it published?', 'Yes', 'Low']] },
    { name: 'Compliance', rows: [['Criteria', 'Evaluation', 'Criticality', 'Subject'], ['Banner shown?', 'No', 'High', 'Compliance']] },
  ]));
  assert.ok(r3.audit);
  assert.equal(r3.audit.criteres[0].statut, 'INCONNU');
  assert.ok(r3.report.W.some(w => w.code === 'GRILLE_STATUT' && w.message.includes('N/A ?')));
  assert.deepEqual(validate(r3.audit).E, []);
});

test('xlsx-read : partie principale via _rels/.rels, cibles « ../ », feuille graphique ignorée, entités invalides, ligne lointaine', () => {
  const raw = zipSync({
    '_rels/.rels': strToU8('<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/book/wb.xml"/></Relationships>'),
    'book/wb.xml': strToU8('<workbook><sheets><sheet name="Graphe" sheetId="1" r:id="c1"/><sheet name="Données" sheetId="2" r:id="s1"/></sheets></workbook>'),
    'book/_rels/wb.xml.rels': strToU8('<Relationships>'
      + '<Relationship Id="c1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="../xl/chartsheets/sheet1.xml"/>'
      + '<Relationship Id="s1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../xl/worksheets/data.xml"/>'
      + '<Relationship Id="ss" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="strings.xml"/>'
      + '<Relationship Id="ext" Type="http://x/hyperlink" Target="https://exemple.test" TargetMode="External"/></Relationships>'),
    'book/strings.xml': strToU8('<sst><si><t>Partagée</t></si><si><t>_x005F_x0041_ &#xFFFFFFF; &#65;</t></si></sst>'),
    'xl/chartsheets/sheet1.xml': strToU8('<chartsheet/>'),
    'xl/worksheets/data.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="1048576" s="3" customFormat="1"/></sheetData></worksheet>'),
  });
  const wb = readXlsx(raw);
  assert.deepEqual(wb.sheets.map(s => s.name), ['Données']);
  assert.deepEqual(wb.sheets[0].rows, [['Partagée', '_x0041_ &#xFFFFFFF; A']]);
  assert.throws(() => readXlsx(zipSync({ 'word/document.xml': strToU8('<w/>') })), /classeur Excel/);
});

test('grille tolérante : en-tête fusionné, ligne non renseignée, totaux, N/A, ID explicites, sections FR', () => {
  const H = ['ID', 'Subject', 'Criteria + Controlled elements', null, 'Evaluation', 'Criticality', 'Comment'];
  const bytes = makeXlsx([
    { name: 'GTM', merges: ['C1:D1'], rows: [
      H, // D1 vide : recopiée depuis C1 par la fusion
      [1, 'Administration', 'Container published?', 'Versions tab', 'Yes', 'High', null],
      [null, 'Administration', 'Workspace clean?', 'Workspaces', null, null, null], // non renseigné : conservé
      [3, 'Naming Convention', 'Tags named?', 'Tag list', 'N/A', 'Low', null],
      ['1.4', 'Configuration', 'Triggers ok?', 'Triggers', 'No', 'High', 'Trigger <All pages> & co'],
      ['https://doc.example/x y', 'Configuration', 'Variables ok?', 'Variables', 'Partly', 'Medium', null],
      ['Total', null, 'Total', null, '3', null, null],
      [null, null, 'Note : grille relue par l’équipe', 'x', null, null, null],
    ] },
    { name: 'Réponses', rows: [
      ['N°', 'Critère', 'Réponse', 'Criticité', 'Outil', 'Sujet'],
      ['Data Layer Quality'],
      [null, 'dataLayer présent avant GTM', 'Oui', 'Haute', 'GTM', 'Data Quality'],
      [null, 'Variables nommées', 'Non', 'Haute', 'GTM', 'Naming Convention'],
      ['Universal Analytics'],
      [null, 'IP anonymisée', 'Non', 'Haute', 'Google Analytics', 'Compliance'],
    ] },
  ]);
  const { audit, report } = convertGrid(bytes, { source: 'en', date: '2026-01' });
  assert.ok(audit, JSON.stringify(report.E));
  const ids = audit.criteres.map(c => c.id_grille);
  assert.deepEqual(ids, ['GTM-01', 'GTM-02', 'GTM-03', 'GTM-1.4', 'GTM-05'], 'ligne non renseignée conservée, total et note finale ignorés');
  const [c1, c2, c3, c4] = audit.criteres;
  assert.equal(c1.question, 'Container published?'); assert.equal(c1.element_controle, 'Versions tab', 'colonne fusionnée = élément contrôlé');
  assert.equal(c2.statut, 'INCONNU'); assert.equal(c2.criticite, 'MOYENNE');
  assert.equal(c3.statut, 'NA');
  assert.equal(c4.commentaire, 'Trigger <All pages> & co', 'texte brut conservé, sans échappement HTML');
  assert.ok(report.I.some(i => i.code === 'GRILLE_LIGNE' && /Total/.test(i.message)));
  assert.ok(report.I.some(i => i.code === 'GRILLE_LIGNE' && /inexploitable/.test(i.message)));

  // Onglet FR : la section prime sur la colonne Outil (un critère DataLayer cite GTM) ; UA Compliance reste dans le pilier analytics.
  const fr = convertGrid(bytes, { source: 'fr', date: '10/2026' }).audit!;
  assert.equal(fr.langue, 'fr');
  assert.deepEqual(fr.criteres.map(c => c.id_grille), ['DL-01', 'DL-02', 'UA-01']);
  const ua = fr.criteres[2];
  assert.equal(ua.obsolete, true); assert.equal(ua.axe_score, 'COMPLIANCE'); assert.equal(ua.pilier_id, 'analytics');
  assert.ok(fr.outils!.some(o => o.id === 'ua'));
  assert.ok(!fr.constats.some(c => c.criteres_lies!.includes('UA-01')));
  assert.equal(fr.constats.find(c => c.criteres_lies!.includes('DL-02'))!.titre_action, 'Corriger : Variables nommées');
  assert.deepEqual(validate(fr).E, []);
});

test('options : source EN absente, pilier manquant, UA retiré signalé, date non interprétée', () => {
  const frOnly = makeGrid({ frOnly: true, counts: { DL: 3, GTM: 3, GA4: 3, CMP: 2, UA: 2 } });
  const r1 = convertGrid(frOnly, { source: 'en' });
  assert.ok(r1.audit); assert.equal(r1.audit.langue, 'fr');
  assert.ok(r1.report.W.some(w => w.code === 'GRILLE_SOURCE'));
  assert.ok(r1.report.I.some(i => i.code === 'GRILLE_EFFECTIF'));
  const r2 = convertGrid(frOnly, { ua: 'retirer', piliers: [{ id: 'tag', libelle: 'Tags', domaines: ['DL', 'GTM'] }, { id: 'ga', libelle: 'GA4', domaines: ['GA4'] }] });
  assert.ok(r2.report.W.some(w => w.code === 'GRILLE_PILIER' && w.objet === 'Compliance OneTrust'));
  assert.ok(r2.report.I.some(i => i.code === 'GRILLE_UA' && /retrait/.test(i.message)));
  assert.ok(r2.audit!.criteres.filter(c => c.domaine === 'CMP').every(c => c.pilier_id === 'tag'));
  const r3 = convertGrid(makeXlsx([{ name: '0. Content', rows: [['Client', 'Démo'], ['Date', 'automne']] }, { name: 'GA4', rows: [['Criteria', 'Evaluation', 'Criticality'], ['Stream ok?', 'Yes', 'High']] }]));
  assert.equal(r3.audit!.client, 'Démo');
  assert.ok(r3.report.I.some(i => i.code === 'GRILLE_DATE' && i.message.includes('automne')));
  assert.equal(normEvaluation('N/A'), 'NA'); assert.equal(normEvaluation('n/a'), 'NA'); assert.equal(normEvaluation('N/A ?'), null);
});
