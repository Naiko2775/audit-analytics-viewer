/** Module d'import (UI-59, DAT-12 à DAT-17) : fichiers → contrôles → rapport → génération de la restitution. */
import { unzipSync } from 'fflate';
import { bundleFrom, dataUrl, makeResolver, mimeOf, type Asset, type Bundle } from '../core/evidence.ts';
import { RULES, parseJson, validate, type Issue, type Report } from '../core/validate.ts';
import { clone, esc } from '../core/util.ts';
import { tx } from '../core/i18n.ts';
import type { Audit } from '../core/types.ts';
import { listAudits, type Stored } from './storage.ts';

export const BUDGET = 12 * 1024 * 1024, MAX_W = 1920, MAX_PROOF = 400 * 1024;
export interface ImportResult {
  files: string[]; bundle: Bundle | null; report: Report; audit: Audit | null;
  optim: { n: number; before: number; after: number }; weight: number;
}
export const IMP = {
  phase: 'idle' as 'idle' | 'busy' | 'report', step: '', result: null as ImportResult | null, ack: false,
  recent: [] as Omit<Stored, 'audit'>[],
};
export async function refreshRecent() { IMP.recent = await listAudits(); }

const ko = (n: number) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`;

async function readEntries(files: File[], onStep: (s: string) => void) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  for (const f of files) {
    onStep(`Lecture de ${f.name}…`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      try {
        const z = unzipSync(bytes);
        Object.entries(z).forEach(([name, b]) => entries.push({ name, bytes: b }));
      } catch (e: any) { throw new Error(`Archive « ${f.name} » illisible : ${e?.message || e}`); }
    } else entries.push({ name: (f as any).webkitRelativePath || f.name, bytes });
  }
  return entries;
}

/** Réduit une image à 1 920 px et la ré-encode en WebP qualité 80 si elle est trop lourde (décision D11). */
async function optimise(a: Asset): Promise<{ asset: Asset; w?: number; h?: number; changed: boolean }> {
  if (!/^image\/(png|jpeg|webp)$/.test(a.mime) || typeof createImageBitmap === 'undefined') return { asset: a, changed: false };
  try {
    const bmp = await createImageBitmap(new Blob([a.bytes as BlobPart], { type: a.mime }));
    const { width: w, height: h } = bmp;
    if (w <= MAX_W && a.bytes.length <= MAX_PROOF) { bmp.close(); return { asset: a, w, h, changed: false }; }
    const k = Math.min(1, MAX_W / w), cw = Math.round(w * k), chh = Math.round(h * k);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cw, chh); bmp.close();
    const blob: Blob | null = await new Promise(r => cv.toBlob(r, 'image/webp', 0.8));
    if (!blob || blob.size >= a.bytes.length) return { asset: a, w, h, changed: false };
    return { asset: { path: a.path, bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/webp' }, w: cw, h: chh, changed: true };
  } catch { return { asset: a, changed: false }; }
}

/** Remplace les chemins relatifs (preuves, logos) par les fichiers embarqués : l'audit devient autonome. */
async function embed(src: Audit, bundle: Bundle, onStep: (s: string) => void) {
  const a: any = clone(src);
  const resolve = makeResolver(bundle.assets);
  const optim = { n: 0, before: 0, after: 0 };
  const cache = new Map<string, { url: string; w?: number; h?: number; text?: string; size: number }>();
  const weights: { objet: string; size: number }[] = [];
  const load = async (ref: string) => {
    const key = resolve(ref); if (!key) return null;
    if (cache.has(key)) return cache.get(key)!;
    const asset = bundle.assets.get(key)!;
    let out;
    if (asset.mime.startsWith('text/') || asset.mime === 'application/json') out = { url: '', text: new TextDecoder().decode(asset.bytes), size: asset.bytes.length };
    else {
      const o = await optimise(asset);
      if (o.changed) { optim.n++; optim.before += asset.bytes.length; optim.after += o.asset.bytes.length; }
      out = { url: dataUrl(o.asset), w: o.w, h: o.h, size: o.asset.bytes.length };
    }
    cache.set(key, out); return out;
  };
  const isRel = (f?: string) => !!f && !/^(data:|https?:)/.test(f);
  for (const k of ['logo', 'image_corporate'] as const) if (isRel(a[k])) { const r = await load(a[k]); if (r?.url) a[k] = r.url; }
  for (const o of a.outils || []) if (isRel(o.logo)) { const r = await load(o.logo); if (r?.url) o.logo = r.url; }
  let i = 0; const all = a.constats.flatMap((c: any) => (c.preuves || []).map((p: any) => ({ c, p })));
  for (const { c, p } of all) {
    i++;
    if (!isRel(p.fichier)) continue;
    onStep(`Preuves : ${i} / ${all.length}…`);
    const r = await load(p.fichier); if (!r) continue;
    p.fichier_source = p.fichier;
    if (r.text != null) { if (!p.contenu && !p.panneau) p.contenu = r.text; delete p.fichier; }
    else { p.fichier = r.url; if (r.w) p.dimensions = { largeur: r.w, hauteur: r.h }; p.poids = r.size; weights.push({ objet: `Preuve ${p.id} (${c.id})`, size: r.size }); }
  }
  return { audit: a as Audit, optim, weights };
}

export async function processFiles(files: File[], onStep: (s: string) => void): Promise<ImportResult> {
  const names = files.map(f => f.name);
  const empty = (issue: Issue): ImportResult => ({ files: names, bundle: null, report: { E: [issue], W: [], I: [], stats: null }, audit: null, optim: { n: 0, before: 0, after: 0 }, weight: 0 });
  let entries;
  try { entries = await readEntries(files, onStep); } catch (e: any) { return empty({ code: 'ZIP', objet: 'Archive', message: e.message }); }
  const bundle = bundleFrom(entries);
  if (!bundle.audit) {
    const r = empty({ code: 'SCHEMA', objet: 'Fichiers', message: 'Aucun audit.json trouvé parmi les fichiers déposés.' });
    r.bundle = bundle; r.report.W.push(...bundle.issues); return r;
  }
  onStep('Contrôle du fichier…');
  const parsed = parseJson(bundle.audit.text);
  if (!parsed.ok) { const r = empty(parsed.issue); r.bundle = bundle; return r; }
  const resolve = makeResolver(bundle.assets);
  const report = validate(parsed.value, { assets: bundle.assets.size ? new Set(bundle.assets.keys()) : undefined, resolve });
  const zipBlocking = bundle.issues.filter(i => /refusé/.test(i.message));
  report.E.push(...zipBlocking); report.W.push(...bundle.issues.filter(i => !zipBlocking.includes(i)));
  if (report.E.some(e => e.code === 'SCHEMA')) return { files: names, bundle, report, audit: null, optim: { n: 0, before: 0, after: 0 }, weight: 0 };

  onStep('Intégration des preuves…');
  const { audit, optim, weights } = await embed(parsed.value as Audit, bundle, onStep);
  if (optim.n) report.I.push({ code: 'PREUVE_OPTIM', objet: `${optim.n} image(s)`, message: `Redimensionnées (≤ ${MAX_W} px) et ré-encodées en WebP : ${ko(optim.before)} → ${ko(optim.after)}.` });
  const weight = JSON.stringify(audit).length;
  if (weight > BUDGET) {
    const top = weights.sort((a, b) => b.size - a.size).slice(0, 5).map(w => `${w.objet} (${ko(w.size)})`).join(', ');
    report.W.push({ code: 'PREUVE_LOURDE', objet: 'Artefact', message: `Données de ${ko(weight)} : au-delà du budget de ${ko(BUDGET)} (artefact < 15 Mo). Preuves les plus lourdes : ${top}.` });
  }
  return { files: names, bundle, report, audit, optim, weight };
}

/* ---------- Écran ---------- */
const LV: Record<string, [string, string]> = { E: ['Erreurs bloquantes', 'e'], W: ['Avertissements', 'w'], I: ['Informations', 'i'] };
function issueList(list: Issue[], lv: string, open: boolean) {
  if (!list.length) return '';
  const groups: Record<string, Issue[]> = {};
  list.forEach(i => (groups[i.code] = groups[i.code] || []).push(i));
  return `<details class="ir ir-${LV[lv][1]}" ${open ? 'open' : ''}><summary><b>${LV[lv][0]}</b> <span class="cnt">${list.length}</span></summary>${Object.entries(groups).map(([code, items]) =>
    `<div class="ir-g"><div class="ir-rule"><code>${esc(code)}</code> ${esc(RULES[code] || code)} <span class="muted">· ${items.length}</span></div><ul>${items.map(i => `<li><span class="ir-obj">${esc(i.objet)}</span> ${esc(i.message)}</li>`).join('')}</ul></div>`).join('')}</details>`;
}
export function reportHtml(r: Report) {
  return issueList(r.E, 'E', true) + issueList(r.W, 'W', r.E.length === 0) + issueList(r.I, 'I', false);
}
function statsHtml(res: ImportResult) {
  const s = res.report.stats, a: any = res.audit;
  if (!s || !a) return '';
  const st = s.par_statut, p = s.preuves;
  return `<div class="imp-sum">
    <div class="imp-id"><span class="k">Audit</span><b>${esc(a.client)}</b><span>${esc(tx(a.titre) || 'Restitution Audit Analytics')} · ${esc(a.date || '')} · v${esc(a.version || '1')}</span><span class="muted">${esc(a.id)} · contrat ${esc(a.schema_version || '1.0')} · ${esc(a.langue || 'fr').toUpperCase()}</span></div>
    <div class="imp-k"><b>${s.criteres}</b><span>critères</span><small>${st.OK} OK · ${st.PARTIEL} partiels · ${st.KO} KO · ${st.NA} NA · ${st.INCONNU} inconnus${st.A_REVOIR ? ` · ${st.A_REVOIR} à revoir` : ''}</small></div>
    <div class="imp-k"><b>${s.constats}</b><span>constats</span><small>${s.piliers_actifs} piliers actifs</small></div>
    <div class="imp-k ${p.manquantes ? 'bad' : ''}"><b>${p.resolues + p.texte}/${p.total}</b><span>preuves résolues</span><small>${p.manquantes ? `${p.manquantes} manquante(s)` : 'aucune manquante'}${res.bundle?.assets.size ? ` · ${res.bundle.assets.size} fichier(s) importé(s)` : ''}</small></div>
    <div class="imp-k"><b>${ko(res.weight)}</b><span>poids des données</span><small>${res.weight > BUDGET ? 'au-delà du budget artefact' : 'compatible artefact < 15 Mo'}</small></div>
  </div>`;
}
export function importScreen(demoKey: string, currentKey: string | null) {
  const res = IMP.result;
  const steps = ['Fichiers', 'Contrôles', 'Génération'], cur = IMP.phase === 'report' ? 1 : 0;
  const stepper = `<ol class="imp-steps">${steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'on' : ''}"><span>${i + 1}</span>${s}</li>`).join('')}</ol>`;
  const drop = `<div class="dz ${IMP.phase === 'busy' ? 'busy' : ''}" id="dz" data-act="pick" role="button" tabindex="0" aria-label="Choisir les fichiers de l'audit">
      ${IMP.phase === 'busy' ? `<div class="spin" aria-hidden="true"></div><b>${esc(IMP.step || 'Traitement…')}</b>` :
      `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
      <b>Déposez les fichiers de l'audit ici</b><span>ou <u>parcourez votre poste</u></span>
      <small>Archive <code>.zip</code> produite par le skill (audit.json + dossier <code>preuves/</code>), ou <code>audit.json</code> seul, ou le JSON avec ses captures (sélection multiple).</small>`}
    </div>`;
  let body = '';
  if (IMP.phase === 'report' && res) {
    const nE = res.report.E.length, nW = res.report.W.length;
    const can = !nE && res.audit && (!nW || IMP.ack);
    body = `${statsHtml(res)}
      <p class="imp-files muted">Fichiers analysés : ${res.files.map(esc).join(', ')}${res.bundle?.audit ? ` · audit lu : <code>${esc(res.bundle.audit.name)}</code>` : ''}</p>
      ${nE ? `<div class="imp-verdict bad">✗ ${nE} erreur(s) bloquante(s) : corrigez le fichier source puis ré-importez-le.</div>` : nW ? `<div class="imp-verdict warn">⚠ Aucune erreur bloquante, ${nW} avertissement(s) à examiner.</div>` : `<div class="imp-verdict ok">✓ Fichier conforme : prêt pour la génération.</div>`}
      <div class="imp-report">${reportHtml(res.report)}</div>
      <div class="imp-actions">
        <button class="btn" data-act="imp-reset">Recommencer</button>
        ${!nE && nW ? `<label class="chk"><input type="checkbox" data-imp="ack" ${IMP.ack ? 'checked' : ''}> J'ai pris connaissance des ${nW} avertissements</label>` : ''}
        <button class="btn solid big" data-act="imp-generate" ${can ? '' : 'disabled'}>Générer la restitution ›</button>
      </div>`;
  } else {
    body = drop;
  }
  const rec = IMP.recent.length ? `<section class="imp-recent"><h2 class="h">Audits importés dans ce navigateur</h2><table class="acc"><thead><tr><th>Client</th><th>Audit</th><th>Importé le</th><th>Taille</th><th></th></tr></thead><tbody>${IMP.recent.map(r => `<tr class="${r.key === currentKey ? 'cur' : ''}"><td><b>${esc(r.client)}</b>${r.key === currentKey ? ' <span class="rq rq-obtenu">affiché</span>' : ''}</td><td>${esc(r.titre || r.id)}<br><small class="muted">${esc(r.id)} · ${esc(r.date || '')} · ${esc(r.source)}</small></td><td>${new Date(r.imported_at).toLocaleString('fr-FR')}</td><td>${ko(r.size)}</td><td style="white-space:nowrap"><button class="btn" data-act="imp-open" data-k="${esc(r.key)}">Ouvrir</button> <button class="btn" data-act="imp-del" data-k="${esc(r.key)}" aria-label="Supprimer ${esc(r.client)}">✕</button></td></tr>`).join('')}</tbody></table></section>` : '';
  return {
    sur: 'Import', titre: 'Importer un audit',
    body: `${stepper}${body}${IMP.phase !== 'report' ? `<p class="imp-alt">Pas de fichier sous la main ? <button class="link-btn" data-act="imp-open" data-k="${esc(demoKey)}">Ouvrir l'audit de démonstration</button> · <a class="link-btn" href="#" data-act="imp-template">télécharger un audit.json d'exemple</a></p>` : ''}${rec}
      <p class="note">Les fichiers sont traités dans votre navigateur : rien n'est envoyé sur un serveur. Les audits importés sont conservés localement (IndexedDB) jusqu'à leur suppression.</p>`,
  };
}
export { mimeOf };
