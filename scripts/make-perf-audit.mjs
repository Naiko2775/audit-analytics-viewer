#!/usr/bin/env node
/**
 * Écrit le jeu de performance (DAT-33) sur disque.
 * Usage : node --experimental-strip-types scripts/make-perf-audit.mjs [sortie.json] [criteres] [constats] [preuves] [piliers] [graine]
 * Défaut : perf-audit.json, 150 critères, 30 constats, 60 preuves, 3 piliers. Même graine → même fichier.
 */
import { writeFileSync } from 'node:fs';
import { makePerfAudit } from '../src/data/perf.ts';

const USAGE = 'Usage : node --experimental-strip-types scripts/make-perf-audit.mjs [sortie.json] [criteres] [constats] [preuves] [piliers] [graine]';
const args = process.argv.slice(2);
if (args.some(a => a === '-h' || a === '--help')) { console.log(USAGE); process.exit(0); }
const [out = 'perf-audit.json', criteres, constats, preuves, piliers, seed] = args;
const num = (v, nom) => {
  if (v == null || v === '' || v === '-') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) { console.error(`Argument « ${nom} » invalide : « ${v} » (entier positif attendu).\n${USAGE}`); process.exit(1); }
  return n;
};
const opts = { criteres: num(criteres, 'criteres'), constats: num(constats, 'constats'), preuves: num(preuves, 'preuves'), piliers: num(piliers, 'piliers'), seed: num(seed, 'graine') };
const t = performance.now();
const audit = makePerfAudit(opts);
const texte = JSON.stringify(audit, null, 1);
writeFileSync(out, texte);
const n = audit.constats.reduce((s, c) => s + (c.preuves || []).length, 0);
console.log(`${out} : ${audit.criteres.length} critères, ${audit.constats.length} constats, ${n} preuves, ${audit.piliers.length} piliers, ${(Buffer.byteLength(texte) / 1048576).toFixed(2)} Mo, généré en ${Math.round(performance.now() - t)} ms.`);
if (n < (opts.preuves ?? 60)) console.warn('Attention : sans constat, les preuves ne peuvent pas être rattachées.');
