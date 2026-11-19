import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { buildModel, emptyOverrides } from '../src/core/model.ts';
import { getLang, setLang } from '../src/core/i18n.ts';
import { buildPptxBuffer, deckPlan, ficheOrder, pagesOf, pptxFileName } from '../src/export/pptx.ts';
import { fit, imageSize, parseDataUrl, prepImage, runs, bulletRuns, xmlSafe } from '../src/export/pptx-helpers.ts';

const demo = JSON.parse(readFileSync(new URL('../src/data/demo-audit.json', import.meta.url), 'utf8'));
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEElEQVR4nGNgYGD4z4AEAAkHAQBVfY3tAAAAAElFTkSuQmCC';
const slideFiles = (z: Record<string, Uint8Array>) =>
  Object.keys(z).filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/)![0] - +b.match(/\d+/)![0]);
const texts = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const allText = (xml: string) => unesc(texts(xml).join(''));

/** Contrôle de bonne formation XML minimal (sans dépendance) : caractères interdits, entités, appariement des balises. */
function xmlError(xml: string): string | null {
  const bad = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.exec(xml);
  if (bad) return `caractère interdit U+${bad[0].charCodeAt(0).toString(16)}`;
  const body = xml.replace(/^﻿?<\?xml[^>]*\?>/, '');
  const ENT = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g;
  const stack: string[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index);
    if (/</.test(between) || ENT.test(between)) return `texte mal échappé : ${between.slice(0, 60)}`;
    if (m[3] && ENT.test(m[3])) return `attribut mal échappé : ${m[3].slice(0, 60)}`;
    last = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) { const o = stack.pop(); if (o !== m[2]) return `balise </${m[2]}> fermant <${o}>`; }
    else if (!m[4]) stack.push(m[2]);
  }
  if (/</.test(body.slice(last))) return 'balise illisible en fin de document';
  return stack.length ? `balise <${stack.at(-1)}> non fermée` : null;
}
function assertPartsValid(z: Record<string, Uint8Array>) {
  for (const [k, v] of Object.entries(z)) {
    if (!/\.(xml|rels)$/.test(k)) continue;
    const err = xmlError(strFromU8(v));
    assert.equal(err, null, `${k} : ${err}`);
  }
}
/** Formes posées hors de la slide 16:9 (EMU) : tolérance d'un millimètre ; une forme tournée d'un quart de tour est mesurée après rotation. */
function outOfSlide(xml: string): string[] {
  const W = 12192000, H = 6858000, tol = 36000, out: string[] = [];
  for (const m of xml.matchAll(/<a:xfrm([^>]*)>\s*<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g)) {
    let [x, y, cx, cy] = m.slice(2).map(Number);
    const rot = Number(/rot="(-?\d+)"/.exec(m[1])?.[1] || 0) / 60000;
    if (Math.round(rot / 90) % 2) { const mx = x + cx / 2, my = y + cy / 2; [cx, cy] = [cy, cx]; x = mx - cx / 2; y = my - cy / 2; }
    if (x < -tol || y < -tol || x + cx > W + tol || y + cy > H + tol) out.push(m[0]);
  }
  return out;
}

test('deckPlan : structure du deck par défaut', () => {
  const M = buildModel(demo);
  const plan = deckPlan(M);
  const fiches = ficheOrder(M);
  assert.equal(plan[0].kind, 'S0');
  assert.equal(plan[1].kind, 'S0b');
  assert.equal(plan.at(-1)!.kind, 'S9');
  assert.deepEqual(plan.slice(-3).map(s => s.kind), ['S6', 'S7', 'S9']);
  assert.equal(plan.filter(s => s.kind === 'S5').length, fiches.length);
  assert.deepEqual(plan.filter(s => s.kind === 'S5').map(s => s.constatId), fiches.map(c => c.id));
  // fiches groupées par pilier dans l'ordre des piliers, rang croissant dans chaque pilier
  const pil = fiches.map(c => M.piliers.findIndex(p => p.id === c.pilier_id));
  assert.deepEqual(pil, [...pil].sort((a, b) => a - b));
  M.piliers.forEach(p => { const r = fiches.filter(c => c.pilier_id === p.id).map(c => c.rang); assert.deepEqual(r, [...r].sort((a, b) => a - b)); });
  assert.ok(plan.some(s => s.kind === 'S1'), 'S1 présente (roadmap fournie)');
  assert.ok(!plan.some(s => s.kind === 'T'), 'pas de transition par défaut');
  // numéros de page du sommaire : chaque partie pointe sur sa slide
  const pages = plan[1].pages!;
  assert.equal(plan[pages.S1 - 1].kind, 'S1');
  assert.equal(plan[pages.S2 - 1].kind, 'S2');
  assert.equal(plan[pages.S3 - 1].kind, 'S3');
  assert.equal(plan[pages.S6 - 1].kind, 'S6');
  M.piliers.forEach(p => assert.equal(plan[pages['P:' + p.id] - 1].constatId, fiches.find(c => c.pilier_id === p.id)!.id));
  assert.deepEqual(pagesOf(M, plan), pages, 'pagesOf() redonne les pages de deckPlan()');
});

test('deckPlan : transitions, S1 masquée, sans roadmap, sans sommaire, fiches masquées', () => {
  const M = buildModel({ ...demo, restitution: { ...demo.restitution, s1_active: false, sommaire: { actif: true, transitions: true } } });
  const plan = deckPlan(M);
  assert.ok(!plan.some(s => s.kind === 'S1'));
  const T = plan.filter(s => s.kind === 'T');
  assert.equal(T.length, 3 + M.piliers.filter(p => ficheOrder(M).some(c => c.pilier_id === p.id)).length);
  T.forEach(s => { const i = plan.indexOf(s); assert.ok(s.part && s.pages); assert.equal(s.pages![s.part!], i + 2, 'la transition précède la partie'); });
  const noRm = clone(demo); delete noRm.roadmap;
  assert.ok(!deckPlan(buildModel(noRm)).some(s => s.kind === 'S1'), 'pas de S1 sans roadmap');
  const noAgenda = deckPlan(buildModel({ ...demo, restitution: { ...demo.restitution, sommaire: { actif: false, transitions: true } } }));
  assert.ok(!noAgenda.some(s => s.kind === 'S0b' || s.kind === 'T'), 'sommaire désactivé : ni sommaire ni transitions');
  const before = ficheOrder(buildModel(demo)).length;
  const hidden = buildModel(demo, { ...emptyOverrides(), constats: { [ficheOrder(M)[0].id]: { visible: false } } });
  assert.equal(deckPlan(hidden).filter(s => s.kind === 'S5').length, before - 1, 'fiches visible=false exclues');
});

test('parseur markdown → runs pptx', () => {
  const r = runs('Le tag **DoubleClick** a l’ID `DC-1` [doc](https://exemple.fr/a?x=1&y=2)', { fontSize: 10 });
  assert.deepEqual(r.map(x => x.text), ['Le tag ', 'DoubleClick', ' a l’ID ', 'DC-1', ' ', 'doc']);
  assert.equal(r[1].options.bold, true);
  assert.equal(r[3].options.fontFace, 'Consolas');
  assert.equal(r[5].options.hyperlink.url, 'https://exemple.fr/a?x=1&y=2');
  // gras contenant du code : le code reste en gras et en monospace, sans accents graves résiduels
  const n = runs('**bloquer `gtag` avant**', { codeColor: '000000' });
  assert.deepEqual(n.map(x => x.text), ['bloquer ', 'gtag', ' avant']);
  assert.ok(n.every(x => x.options.bold));
  assert.equal(n[1].options.fontFace, 'Consolas');
  assert.ok(n.every(x => !('codeColor' in x.options)));
  // contenu localisé, vide, balisage incomplet
  setLang('en'); assert.equal(runs({ fr: 'a', en: 'b' })[0].text, 'b'); setLang('fr');
  assert.deepEqual(runs(undefined).map(x => x.text), ['']);
  assert.deepEqual(runs('a ** b').map(x => x.text), ['a ** b']);
  const b = bulletRuns(['a', { texte: 'b', sous_puces: ['c'] }], {});
  assert.equal(b.filter(x => x.options.bullet).length, 3);
  assert.equal(b[2].options.indentLevel, 1);
  assert.ok(!b.at(-1)!.options.breakLine);
  assert.equal(xmlSafe('a\u0001b\u000Bc\td\ne\uD800'), 'abc\td\ne');
});

test('images : data URL, dimensions, formats insérables', async () => {
  const svg = parseDataUrl('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"></svg>')!;
  assert.equal(svg.mime, 'image/svg+xml');
  assert.deepEqual(imageSize(svg.mime, svg.base64), { w: 640, h: 400 });
  assert.deepEqual(imageSize('image/png', PNG.split(',')[1]), { w: 2, h: 3 });
  const p = await prepImage(PNG);
  assert.deepEqual([p!.mime, p!.w, p!.h], ['image/png', 2, 3]);
  assert.equal((await prepImage(PNG.replace('image/png', 'image/jpg')))!.mime, 'image/jpeg', 'image/jpg normalisé');
  assert.equal(await prepImage('data:image/webp;base64,UklGRg=='), null, 'WebP non inséré tel quel hors navigateur');
  assert.equal(await prepImage('data:image/svg+xml;utf8,<svg/>'), null);
  assert.equal(await prepImage('captures/x.png'), null);
  assert.equal(await prepImage('data:text/plain;base64,QQ=='), null);
  const f = fit(0, 0, 1, 1, 4, 2);
  assert.ok([f.x, f.y, f.w, f.h].every(Number.isFinite), 'fit() sans dimensions connues');
});

test('buildPptxBuffer : deck complet du jeu de démonstration', async () => {
  const M = buildModel(demo);
  const plan = deckPlan(M);
  const before = getLang();
  const warnings: string[] = [];
  const pending = buildPptxBuffer(M, { lang: 'en', slides: plan, warnings });
  assert.equal(getLang(), before, 'la langue de l’interface ne change pas pendant le chargement des images');
  await pending;
  const buf = await buildPptxBuffer(M, { lang: 'fr', slides: plan, warnings });
  assert.equal(getLang(), before, 'la langue d’origine est restaurée');
  const z = unzipSync(buf);
  assertPartsValid(z);
  const files = slideFiles(z);
  assert.equal(files.length, plan.length, 'une slide par entrée du plan');
  const xml = files.map(f => strFromU8(z[f]));
  // aucune slide vide : chacune porte du texte natif, et aucune forme ne sort de la slide
  xml.forEach((x, i) => assert.ok(texts(x).join('').trim().length > 0, `slide ${i + 1} vide`));
  xml.forEach((x, i) => assert.deepEqual(outOfSlide(x), [], `slide ${i + 1} : forme hors cadre`));
  // chaque fiche : titre, blocs, pied de fiche, dans sa propre slide
  plan.forEach((r, i) => {
    if (r.kind !== 'S5') return;
    const c = M.cmap[r.constatId!], tt = texts(xml[i]);
    assert.ok(allText(xml[i]).includes(String(c.titre_action).replace(/\*\*|`/g, '')), `titre de la fiche ${c.id}`);
    assert.ok(tt.includes('Situation actuelle') && tt.includes('Impact') && tt.includes('Recommandations'), `blocs de ${c.id}`);
    assert.ok(tt.some(x => x.trim() === 'Critères liés :'), `pied de fiche de ${c.id}`);
    assert.ok(xml[i].includes('<a:buChar'), `puces natives dans ${c.id}`);
  });
  const i5 = plan.findIndex(s => s.kind === 'S5');
  // preuve Network en tableau natif avec la ligne DoubleClick annotée ; titre placé dans le placeholder du layout
  assert.ok(xml[i5].includes('<a:tbl>'), 'panneau DevTools en tableau natif');
  assert.ok(xml[i5].includes('ad.doubleclick.net'));
  assert.ok(xml[i5].includes('type="title"'), 'titre dans le placeholder du master');
  // lien Markdown → hyperlien cliquable (EXP-21)
  const rels = Object.keys(z).filter(k => /^ppt\/slides\/_rels\//.test(k)).map(k => strFromU8(z[k])).join('');
  assert.ok(rels.includes('https://support.google.com/tagmanager/answer/10718549'));
  // pied de page et numéro dans le master
  const layouts = Object.keys(z).filter(k => /slideLayouts\/slideLayout\d+\.xml$/.test(k)).map(k => strFromU8(z[k])).join('');
  assert.ok(layouts.includes('JAKALA x Client Démo'), 'pied « JAKALA x client » dans le master');
  assert.ok(layouts.includes('type="sldNum"'), 'numéro de page dans le master');
  // sommaire avec numéros de page, scorecard, matrice, next steps, contacts
  assert.ok(texts(xml[1]).includes('SOMMAIRE'));
  assert.ok(texts(xml[1]).includes(`p. ${plan[1].pages!.S2}`));
  assert.ok(xml.some(x => texts(x).includes('Accès requis pour les contrôles non réalisés')));
  assert.ok(xml.some(x => texts(x).includes('Répartition statut × criticité')));
  assert.ok(xml.some(x => texts(x).includes('Quick Win')));
  assert.ok(texts(xml.at(-1)!).includes('Merci'));
  assert.ok(allText(xml.at(-1)!).includes('prenom.nom@jakala.com'));
  // les slides ne sont pas des images : chacune contient des zones de texte natives (EXP-23)
  xml.forEach(x => assert.ok((x.match(/<p:sp>/g) || []).length > 0));
  // alerte attendue : capture SVG de C-CONS-03 non convertible hors navigateur
  assert.ok(warnings.some(w => /C-CONS-03.*SVG/.test(w)), warnings.join(' | '));
});

test('buildPptxBuffer : libellés de structure en anglais (EXP-24)', async () => {
  setLang('fr');
  const M = buildModel(demo);
  const plan = deckPlan(M);
  const buf = await buildPptxBuffer(M, { lang: 'en', slides: plan });
  const z = unzipSync(buf), files = slideFiles(z);
  const i5 = plan.findIndex(s => s.kind === 'S5');
  const x = strFromU8(z[files[i5]]);
  assert.ok(texts(x).includes('Current situation'));
  assert.ok(texts(x).includes('Recommendations'));
  assert.ok(texts(x).some(s => s.trim() === 'Linked criteria:'), 'typographie anglaise (pas d’espace avant « : »)');
  assert.ok(!allText(x).includes('Filtre'), 'aucun libellé français dans le panneau');
  assert.ok(texts(strFromU8(z[files[1]])).includes('AGENDA'));
  assert.ok(texts(strFromU8(z[files.at(-2)!])).includes('Next steps'.toUpperCase()));
  assert.equal(getLang(), 'fr');
});

test('buildPptxBuffer : scores masqués, sous-ensemble de slides, pages recalculées', async () => {
  setLang('fr');
  const M = buildModel({ ...demo, restitution: { ...demo.restitution, masquer_scores: true } });
  const buf = await buildPptxBuffer(M, { lang: 'fr', slides: [{ kind: 'S3' }, { kind: 'S6' }, { kind: 'S7' }] });
  const z = unzipSync(buf), files = slideFiles(z);
  assert.equal(files.length, 3);
  const s3 = texts(strFromU8(z[files[0]]));
  assert.ok(s3.includes('SYNTHÈSE'));
  assert.ok(s3.includes('Les 5 actions prioritaires'));
  assert.ok(!s3.some(x => /\/ 100/.test(x)), 'aucun score affiché');
  // sommaire sans `pages` fournies : numéros déduits de la liste effectivement générée
  const z2 = unzipSync(await buildPptxBuffer(M, { lang: 'fr', slides: [{ kind: 'S0b' }, { kind: 'S2' }, { kind: 'S6' }] }));
  const agenda = texts(strFromU8(z2[slideFiles(z2)[0]]));
  assert.ok(agenda.includes('p. 2') && agenda.includes('p. 3'), agenda.join(' | '));
});

test('robustesse : caractères spéciaux et caractères de contrôle → XML valide', async () => {
  const evil = 'A & B <b> "q" \'s\' \u0001\u0008\u000B￾ fin';
  const d = clone(demo);
  d.client = 'Dupont & Fils <SA>\u0002';
  d.titre = { fr: evil };
  d.restitution.conclusion = '**Fin** & ' + evil;
  d.restitution.contacts = [{ nom: evil, role: evil, email: 'a&b@x.fr' }];
  d.constats[0].titre_action = 'Titre ' + evil;
  d.constats[0].situation = ['**gras `code`** ' + evil, '[lien](https://x.fr/?a=1&b=2)'];
  d.constats[0].preuves[0].panneau.lignes.push({ nom: 'collect?v=2&tid=G-1&cid=<x>\u0007', type: 'xhr', statut: '200', domaine: 'a&b' });
  d.acces_requis = d.acces_requis.map((a: any) => ({ ...a, motif: evil, interlocuteur: evil }));
  const M = buildModel(d);
  const z = unzipSync(await buildPptxBuffer(M, { lang: 'fr', slides: deckPlan(M) }));
  assertPartsValid(z);
  const layouts = Object.keys(z).filter(k => /slideLayout\d+\.xml$/.test(k)).map(k => strFromU8(z[k])).join('');
  assert.ok(layouts.includes('JAKALA x Dupont &amp; Fils &lt;SA&gt;'));
  assert.equal(pptxFileName(M), 'Audit_Analytics_Dupont_Fils_SA_2026-10.pptx');
});

test('robustesse : contrat 1.0, audit minimal, preuves image et zones invalides', async () => {
  // Contrat 1.0 : pas de référentiel outils, d'accès, de cadrage ni de roadmap ; annotations = numéros de ligne
  const v10 = clone(demo);
  delete v10.schema_version; delete v10.outils; delete v10.acces_requis; delete v10.cadrage; delete v10.roadmap;
  delete v10.logo; delete v10.image_corporate; delete v10.restitution;
  v10.piliers.forEach((p: any) => { delete p.elements; p.outils = ['Google Tag Manager', 'Matomo']; });
  v10.constats.forEach((c: any) => (c.preuves || []).forEach((p: any) => { p.annotations = (p.annotations || []).map((a: any) => a.cible?.ligne).filter(Boolean); }));
  // une preuve PNG avec une zone valide et une zone invalide
  v10.constats[1].preuves = [{ id: 'P-IMG', gabarit: 'cadre', fichier: PNG, annotations: [
    { num: 1, statut: 'KO', texte: 'zone ok', cible: { zone: { x: 10, y: 10, w: 50, h: 120 } } },
    { num: 2, statut: 'OK', texte: 'zone ko', cible: { zone: { x: 'a', y: null } } },
  ] }];
  const M = buildModel(v10);
  const plan = deckPlan(M), warnings: string[] = [];
  const z = unzipSync(await buildPptxBuffer(M, { lang: 'fr', slides: plan, warnings }));
  assertPartsValid(z);
  const files = slideFiles(z), xml = files.map(f => strFromU8(z[f]));
  assert.equal(files.length, plan.length);
  xml.forEach((x, i) => assert.ok(texts(x).join('').trim().length > 0, `slide ${i + 1} vide`));
  xml.forEach((x, i) => assert.deepEqual(outOfSlide(x), [], `slide ${i + 1} : forme hors cadre`));
  const iImg = plan.findIndex(s => s.constatId === v10.constats[1].id);
  assert.ok(xml[iImg].includes('<p:pic>'), 'capture PNG insérée');
  assert.ok(Object.keys(z).some(k => /^ppt\/media\/.*\.png$/.test(k)));
  assert.ok(warnings.some(w => /annotation 2 invalide/.test(w)), warnings.join(' | '));
  assert.ok(texts(xml[0]).includes('CD'), 'initiales du client sans logo');

  // Audit minimal : aucun constat, aucun contact, aucune conclusion
  const min = clone(v10); min.constats = [];
  const Mm = buildModel(min), pm = deckPlan(Mm);
  assert.ok(!pm.some(s => s.kind === 'S5'));
  const zm = unzipSync(await buildPptxBuffer(Mm, { lang: 'en', slides: pm }));
  assertPartsValid(zm);
  slideFiles(zm).forEach((f, i) => assert.ok(texts(strFromU8(zm[f])).join('').trim(), `slide ${i + 1} vide`));
});

test('alertes : S4 limité à 9 actions par pilier, fiche inconnue, type de slide inconnu', async () => {
  const d = clone(demo);
  const base = d.constats.find((c: any) => c.pilier_id === 'consentement');
  for (let i = 0; i < 12; i++) d.constats.push({ ...clone(base), id: `X-${i}`, titre_action: `Action supplémentaire ${i}` });
  const M = buildModel(d), warnings: string[] = [];
  const n = M.constats.filter(c => c.visible && c.pilier_id === 'consentement').length;
  const z = unzipSync(await buildPptxBuffer(M, { lang: 'fr', warnings, slides: [{ kind: 'S4' }, { kind: 'S5', constatId: 'NOPE' }, { kind: 'S8' as any }] }));
  const files = slideFiles(z);
  assert.equal(files.length, 2, 'type inconnu ignoré, pas de slide vide');
  assert.ok(texts(strFromU8(z[files[0]])).includes(`+ ${n - 9} autres constats : voir l’annexe`));
  assert.ok(warnings.some(w => /limité à 9 actions/.test(w)));
  assert.ok(warnings.some(w => /NOPE introuvable/.test(w)));
  assert.ok(warnings.some(w => /S8/.test(w)));
});

test('performance : 150 critères et 30 fiches en moins de 30 s (EXP-17)', async () => {
  const d = clone(demo);
  const crits = d.criteres, cons = d.constats;
  for (let i = 0; d.criteres.length < 150; i++) d.criteres.push({ ...crits[i % crits.length], id_grille: `${crits[i % crits.length].id_grille}-B${i}` });
  for (let i = 0; d.constats.length < 30; i++) d.constats.push({ ...clone(cons[i % cons.length]), id: `${cons[i % cons.length].id}-B${i}` });
  d.constats.forEach((c: any) => (c.visible = true));
  const M = buildModel(d), plan = deckPlan(M);
  const t0 = Date.now();
  const z = unzipSync(await buildPptxBuffer(M, { lang: 'fr', slides: plan }));
  assert.ok(Date.now() - t0 < 30000);
  assert.equal(slideFiles(z).length, plan.length);
  assert.equal(plan.filter(s => s.kind === 'S5').length, 30);
});

test('chemin navigateur : sortie uint8array recompressée valide (régression « f.toLowerCase »)', async () => {
  const { recompress } = await import('../src/export/pptx.ts');
  const { zipSync, unzipSync, strToU8 } = await import('fflate');
  const stored = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/presentation.xml': strToU8('<p>'.repeat(500)) }, { level: 0 });
  const z = recompress(stored);
  assert.ok(z.length < stored.length);
  assert.deepEqual(Object.keys(unzipSync(z))[0], '[Content_Types].xml');
});
