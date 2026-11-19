/** Jeu de performance (DAT-33) et budget du pipeline import + validation + calcul (DAT-18, exigence §11). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { makePerfAudit, encodePng, mulberry32 } from '../src/data/perf.ts';
import { parseJson, validate } from '../src/core/validate.ts';
import { buildModel, emptyOverrides, type Overrides } from '../src/core/model.ts';
import { normStatut } from '../src/core/rules.ts';
import { tx } from '../src/core/i18n.ts';

const BUDGET_PIPELINE_MS = 5000; // budget DAT proposé (Q14)
const BUDGET_RECALCUL_MS = 200;  // recalcul après édition (V1)
const BUDGET_POIDS = 15 * 1024 * 1024; // artefact < 15 Mo (§11)
const ms = (t: number) => `${t.toFixed(1)} ms`;
const log = (...a: unknown[]) => console.log('[perf]', ...a);

/** Pipeline DAT complet sur le texte JSON : parse → validate → buildModel. */
function pipeline(texte: string) {
  const t0 = performance.now();
  const p = parseJson(texte); const t1 = performance.now();
  assert.ok(p.ok, 'JSON du jeu de performance invalide');
  const r = validate((p as { value: any }).value); const t2 = performance.now();
  const M = buildModel((p as { value: any }).value); const t3 = performance.now();
  return { r, M, audit: (p as { value: any }).value, parse: t1 - t0, valid: t2 - t1, calc: t3 - t2, total: t3 - t0 };
}
/** Surcharge d'édition alternée : impact, effort, visibilité, ordre manuel. */
function surcharge(ids: string[], i: number): Overrides {
  const ov = emptyOverrides();
  const id = ids[i % ids.length];
  ov.constats[id] = { impact_score: (i % 3) + 1, effort: (['S', 'M', 'L'] as const)[i % 3], visible: i % 5 !== 0, titre_action: `Titre modifié ${i}` };
  if (i % 2) ov.ordre = [...ids].reverse();
  return ov;
}

/** Parcourt les chunks d'un PNG en contrôlant la signature et le CRC de chacun. */
const crcRef = (b: Uint8Array) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
function chunksPng(png: Uint8Array) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'signature PNG');
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array }[] = [];
  let o = 8;
  while (o < png.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    assert.ok(o + 12 + len <= png.length, `chunk ${type} tronqué`);
    assert.equal(dv.getUint32(o + 8 + len), crcRef(png.subarray(o + 4, o + 8 + len)), `CRC ${type}`);
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) }); o += 12 + len;
  }
  return out;
}
const octets = (s: string) => new TextEncoder().encode(s).length;

const audit = makePerfAudit();
const texte = JSON.stringify(audit);

test('générateur : déterministe (graine fixe) et graine différente → jeu différent', () => {
  assert.equal(JSON.stringify(makePerfAudit()), texte);
  assert.notEqual(JSON.stringify(makePerfAudit({ seed: 1 })), texte);
  const r = mulberry32(42), r2 = mulberry32(42);
  for (let i = 0; i < 10; i++) assert.equal(r(), r2());
});

test('jeu par défaut : volumétrie 150 / 30 / 60, 3 piliers, contrat 1.1 complet', () => {
  assert.equal(audit.schema_version, '1.1');
  assert.equal(audit.criteres.length, 150);
  assert.equal(audit.constats.length, 30);
  assert.equal(audit.piliers.length, 3);
  const preuves = audit.constats.flatMap(c => c.preuves || []);
  assert.equal(preuves.length, 60);
  assert.ok(preuves.some(p => p.panneau?.onglet === 'Network'));
  assert.ok(preuves.some(p => p.panneau?.onglet === 'Console'));
  assert.ok(preuves.some(p => p.contenu));
  assert.ok(preuves.some(p => p.fichier?.startsWith('data:image/png;base64,')));
  assert.ok(audit.cadrage && audit.outils?.length && audit.acces_requis?.length && audit.roadmap?.phases.length);
});

test('jeu par défaut : conforme à validate() sans erreur bloquante', () => {
  const r = validate(audit);
  assert.deepEqual(r.E, []);
  assert.equal(r.stats?.preuves.manquantes, 0);
  assert.equal(r.stats?.preuves.total, 60);
  // Seuls avertissements admis : logo client absent (voulu) et critères HAUTE en écart non rattachés (réaliste).
  const codes = new Set(r.W.map(w => w.code));
  assert.deepEqual([...codes].filter(c => !['LOGO', 'R72_ORPHELIN'].includes(c)), [], r.W.map(w => `${w.code} ${w.objet} : ${w.message}`).join('\n'));
  assert.ok(!r.I.some(i => i.code === 'PREUVE_MANQUANTE'));
  log(`avertissements : ${r.W.length} (${[...new Set(r.W.map(w => w.code))].join(', ')})`);
});

test('jeu par défaut : contenu conforme au contrat (statuts, accès, constats, bilingue, échappement)', () => {
  // Tous les alias de statut du §7.1 sont présents et normalisables
  const bruts = new Set(audit.criteres.map(c => c.statut));
  for (const s of ['OK', 'Yes', 'KO', 'No', 'Partly', 'PARTIEL', 'Not concerned', 'Unknown', 'A_REVOIR']) assert.ok(bruts.has(s), `statut ${s} absent du jeu`);
  assert.ok(audit.criteres.every(c => normStatut(c.statut)));
  // INCONNU : motif toujours renseigné ; acces_requis_id toujours résolu
  const acc = new Set(audit.acces_requis!.map(a => a.id));
  const inconnus = audit.criteres.filter(c => normStatut(c.statut) === 'INCONNU');
  assert.ok(inconnus.length > 0 && inconnus.every(c => c.motif_non_evalue));
  assert.ok(audit.criteres.every(c => !c.acces_requis_id || acc.has(c.acces_requis_id)));
  const outils = new Set(audit.outils!.map(o => o.id));
  assert.ok(audit.criteres.every(c => outils.has(c.outil_id!)) && audit.acces_requis!.every(a => outils.has(a.outil_id)));
  // Constats : critères liés existants, du même pilier, en écart ; effort cohérent ; ≤ 4 puces ; titre ≤ 80 car.
  const kmap = Object.fromEntries(audit.criteres.map(c => [c.id_grille, c]));
  for (const c of audit.constats) {
    assert.ok(c.criteres_lies!.length >= 1 && c.criteres_lies!.length <= 3, `${c.id} : 1 à 3 critères liés`);
    for (const id of c.criteres_lies!) { const k = kmap[id]; assert.ok(k && k.pilier_id === c.pilier_id && ['KO', 'PARTIEL'].includes(normStatut(k.statut)!), `${c.id} → ${id}`); }
    const w = c.effort_semaines!;
    assert.ok(c.effort === 'S' ? w < 1 : c.effort === 'M' ? w >= 1 && w <= 3 : w > 3, `${c.id} : effort ${c.effort} / ${w} sem.`);
    for (const b of [c.situation, c.impact, c.recommandations]) assert.ok((b || []).length <= 4);
    assert.ok(String(tx(c.titre_action)).length <= 80);
  }
  // Modèle : demandes déclarées ET lignes AUTO (INCONNU faute d'accès sans demande) ; critères obsolètes présents
  const M = buildModel(audit);
  assert.ok(M.acces.some(a => !a.auto && a.criteres.length) && M.acces.some(a => a.auto));
  assert.ok(audit.criteres.some(c => c.obsolete));
  assert.ok(M.scores.global != null && Object.values(M.scores.pil).every(v => v != null));
  // Contenus bilingues (Localise) et témoin d'échappement
  assert.ok(audit.constats.some(c => typeof c.titre_court === 'object') && audit.constats.some(c => typeof c.titre_court === 'string'));
  assert.ok(audit.criteres.some(c => /<script>/.test(c.commentaire!) && /&/.test(c.commentaire!) && /"/.test(c.commentaire!)));
  // Répartition des preuves : 4 gabarits, ≈ 15 chacun ; numéros d'étape consécutifs par constat ; repères dans les bornes
  const preuves = audit.constats.flatMap(c => c.preuves || []);
  const nb = (f: (p: typeof preuves[number]) => boolean) => preuves.filter(f).length;
  assert.equal(nb(p => p.panneau?.onglet === 'Network'), 15);
  assert.equal(nb(p => p.panneau?.onglet === 'Console'), 15);
  assert.equal(nb(p => !!p.contenu), 15);
  assert.equal(nb(p => !!p.fichier), 15);
  for (const c of audit.constats) (c.preuves || []).forEach((p, i) => { if (p.etape) assert.equal(p.etape.numero, i + 1); });
  for (const p of preuves) for (const a of p.annotations || []) if (p.panneau && a.cible.ligne != null) assert.ok(a.cible.ligne >= 1 && a.cible.ligne <= p.panneau.lignes.length);
});

test('options invalides : NaN, négatif, décimal, image 0 × 0 → jeu sain, sans exception', () => {
  const a = makePerfAudit({ criteres: NaN, constats: 2.7, preuves: -4, piliers: 99 });
  assert.equal(a.criteres.length, 150); // NaN → défaut
  assert.equal(a.constats.length, 2);   // 2,7 → 2 (plantait avant : constats[k % 2,7] indéfini)
  assert.equal(a.constats.flatMap(c => c.preuves || []).length, 0); // négatif → 0
  assert.equal(a.piliers.length, 6);    // borné au référentiel
  assert.deepEqual(validate(a).E, []);
  const vide = makePerfAudit({ criteres: 0, constats: 0, preuves: 0 });
  assert.deepEqual(validate(vide).E, []);
  buildModel(vide);
  const mini = makePerfAudit({ criteres: 8, constats: 4, preuves: 4, image: { w: 0, h: 0 } });
  const f = mini.constats.flatMap(c => c.preuves || []).find(p => p.fichier)!.fichier!;
  const ihdr = chunksPng(Uint8Array.from(atob(f.split(',')[1]), ch => ch.charCodeAt(0)))[0];
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset);
  assert.ok(dv.getUint32(0) >= 1 && dv.getUint32(4) >= 1, 'PNG de dimension nulle');
});

test('captures PNG générées : signature, IHDR, CRC et IDAT décompressable', () => {
  const png = encodePng(4, 3, new Uint8Array(4 * 3 * 3).fill(128));
  const ch = chunksPng(png);
  assert.deepEqual(ch.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  const dv = new DataView(ch[0].data.buffer, ch[0].data.byteOffset);
  assert.equal(dv.getUint32(0), 4); assert.equal(dv.getUint32(4), 3);
  const raw = unzlibSync(ch[1].data);
  assert.equal(raw.length, 3 * (4 * 3 + 1));
  assert.equal(raw[0], 0); assert.equal(raw[1], 128); // filtre 0 puis pixel
  // Chaque capture du jeu se décode entièrement : CRC, 640 × 400 RGB 8 bits, IDAT à la bonne taille
  const caps = audit.constats.flatMap(c => c.preuves || []).filter(p => p.fichier);
  assert.ok(caps.length > 0);
  for (const p of caps) {
    assert.match(p.fichier!, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
    const ck = chunksPng(Uint8Array.from(atob(p.fichier!.split(',')[1]), x => x.charCodeAt(0)));
    const h = new DataView(ck[0].data.buffer, ck[0].data.byteOffset);
    assert.equal(ck[0].type, 'IHDR');
    assert.deepEqual([h.getUint32(0), h.getUint32(4), ck[0].data[8], ck[0].data[9]], [640, 400, 8, 2]);
    assert.equal(unzlibSync(ck.find(c => c.type === 'IDAT')!.data).length, 400 * (640 * 3 + 1));
  }
});

test('poids : JSON du jeu par défaut < 15 Mo', () => {
  const n = octets(texte);
  log(`poids JSON : ${(n / 1048576).toFixed(2)} Mo`);
  assert.ok(n < BUDGET_POIDS, `${n} octets ≥ 15 Mo`);
  assert.ok(n > 1024 * 1024, 'jeu trop léger pour représenter des « preuves lourdes » (DAT-33)');
});

test('DAT-18 : parse + validate + buildModel ≤ 5 s (cible < 500 ms)', () => {
  pipeline(texte); // chauffe du JIT
  const runs = Array.from({ length: 5 }, () => pipeline(texte));
  const med = [...runs].sort((a, b) => a.total - b.total)[2];
  log(`pipeline 150/30/60 (médiane de 5) : parse ${ms(med.parse)}, validate ${ms(med.valid)}, buildModel ${ms(med.calc)}, total ${ms(med.total)}`);
  assert.deepEqual(med.r.E, []);
  assert.equal(med.M.constats.length, 30);
  assert.ok(Math.max(...runs.map(r => r.total)) <= BUDGET_PIPELINE_MS, 'budget DAT de 5 s dépassé');
  if (med.total >= 500) log(`ATTENTION : médiane ${ms(med.total)} au-dessus de la cible de 500 ms`);
});

test('DAT-18 : 50 recalculs buildModel avec surcharge, moyenne < 200 ms', () => {
  const ids = audit.constats.map(c => c.id);
  buildModel(audit, surcharge(ids, 0));
  const durees: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    const M = buildModel(audit, surcharge(ids, i));
    durees.push(performance.now() - t);
    const id = ids[i % ids.length], c = M.cmap[id];
    // la surcharge est bien prise en compte : impact, effort, visibilité, titre, ordre manuel
    assert.equal(c.imp, (i % 3) + 1);
    assert.equal(c.effort, (['S', 'M', 'L'] as const)[i % 3]);
    assert.equal(c.visible, i % 5 !== 0);
    assert.equal(c.titre_action, `Titre modifié ${i}`);
    if (i % 2) assert.equal(M.constats[0].id, ids[ids.length - 1]);
    assert.deepEqual(M.constats.map(k => k.rang), M.constats.map((_, r) => r + 1));
  }
  const moy = durees.reduce((s, d) => s + d, 0) / durees.length;
  log(`recalcul : moyenne ${ms(moy)}, max ${ms(Math.max(...durees))} sur 50 itérations`);
  assert.ok(moy < BUDGET_RECALCUL_MS, `moyenne ${ms(moy)} ≥ 200 ms`);
});

test('tenue en charge : jeu ×4 (600 critères, 120 constats, 240 preuves, 4 piliers)', () => {
  const t0 = performance.now();
  const gros = makePerfAudit({ criteres: 600, constats: 120, preuves: 240, piliers: 4 });
  const tGen = performance.now() - t0;
  const s = JSON.stringify(gros);
  const r = pipeline(s);
  const ids = gros.constats.map(c => c.id);
  const t1 = performance.now();
  for (let i = 0; i < 10; i++) buildModel(gros, surcharge(ids, i));
  const recalc = (performance.now() - t1) / 10;
  log(`×4 : génération ${ms(tGen)}, poids ${(octets(s) / 1048576).toFixed(2)} Mo, parse ${ms(r.parse)}, validate ${ms(r.valid)}, buildModel ${ms(r.calc)}, total ${ms(r.total)}, recalcul moyen ${ms(recalc)}`);
  assert.deepEqual(r.r.E, []);
  assert.equal(r.M.crits.length, 600);
  assert.equal(r.M.constats.length, 120);
  assert.equal(r.r.stats?.preuves.total, 240);
  assert.equal(r.r.stats?.preuves.manquantes, 0);
  assert.ok(r.total <= BUDGET_PIPELINE_MS, 'pipeline ×4 au-delà de 5 s');
  assert.ok(recalc < BUDGET_RECALCUL_MS, 'recalcul ×4 au-delà de 200 ms');
});
