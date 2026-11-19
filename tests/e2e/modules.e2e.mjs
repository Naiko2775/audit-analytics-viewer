// Test de bout en bout des modules V1 (Chrome headless via CDP) : grille Excel, évolution, exports PPTX / XLSX.
// Arguments : <port CDP> <dossier de sortie> <grille.xlsx> <audit_avant.json> <audit_apres.json>
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
const [,, port, out, grid, before, after] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async name => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const setFiles = async paths => { const doc = await cmd('DOM.getDocument'); const q = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' }); await cmd('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: paths }); };
const waitFor = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await sleep(200); } return false; };
const dl = `${out}/downloads`;
const newFile = async (re, ms = 30000) => { for (let t = 0; t < ms; t += 300) { const f = readdirSync(dl).find(n => re.test(n) && !n.endsWith('.crdownload')); if (f) return `${f} (${Math.round(statSync(`${dl}/${f}`).size / 1024)} Ko)`; await sleep(300); } return null; };
await cmd('Runtime.enable');
await cmd('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1250, deviceScaleFactor: 1, mobile: false });
const importOne = async (file, gen = true) => {
  await ev(`location.hash='#import'`); await sleep(400);
  await ev(`document.querySelector('[data-act=imp-reset]')?.click()`); await sleep(200);
  await setFiles([file]); await waitFor(`!!document.querySelector('.imp-verdict')`);
  const verdict = await ev(`document.querySelector('.imp-verdict').innerText`);
  if (!gen) return verdict;
  await ev(`document.querySelector('[data-imp=ack]')?.click()`); await sleep(200);
  await ev(`document.querySelector('[data-act=imp-generate]').click()`); await waitFor(`location.hash==='#S0'`); await sleep(800);
  return verdict;
};
await cmd('Page.navigate', { url: 'http://127.0.0.1:4173/#import' }); await sleep(1500);
const log = {};
// 1) Grille Excel
log.grille_verdict = await importOne(grid, false);
log.grille_stats = await ev(`document.querySelector('.imp-sum')?.innerText.replace(/\\n+/g,' | ')`);
await ev(`document.querySelectorAll('.ir').forEach(d=>d.open=true)`);
log.grille_regles = await ev(`[...document.querySelectorAll('.ir-rule')].map(r=>r.innerText).join(' ; ').slice(0,700)`);
await shot('mod_1_grille');
await ev(`document.querySelector('[data-imp=ack]')?.click()`); await sleep(200);
await ev(`document.querySelector('[data-act=imp-generate]').click()`); await waitFor(`location.hash==='#S0'`); await sleep(600);
log.grille_generee = await ev(`document.querySelector('.brand').innerText.replace(/\\n/g,' ') + ' | fiches=' + document.querySelectorAll('.nav-sub button').length`);
// 2) Évolution : avant puis après
log.avant = await importOne(before); log.apres = await importOne(after);
await ev(`location.hash='#S3'`); await sleep(1500);
log.s3_titre = await ev(`document.querySelector('.band h1').innerText`);
await shot('mod_2_s3_delta');
await ev(`location.hash='#evolution'`); await sleep(800);
log.evolution = await ev(`document.querySelector('.page-body').innerText.replace(/\\n+/g,' | ').slice(0,900)`);
await shot('mod_3_evolution');
// 3) Exports
await ev(`document.querySelector('details.menu').open=true; document.querySelector('[data-act=pptx]').click()`);
log.pptx = await newFile(/\.pptx$/);
log.pptx_modal = await ev(`document.querySelector('.modal h2')?.innerText || ''`);
await ev(`document.querySelector('[data-act=close]')?.click()`);
await ev(`document.querySelector('details.menu').open=true; document.querySelector('[data-act=xlsx-all]').click()`);
log.xlsx = await newFile(/\.xlsx$/);
await ev(`location.hash='#S8'`); await sleep(500);
await ev(`(()=>{const s=document.querySelector('[data-s8=axe]'); s.value='COMPLIANCE'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`); await sleep(300);
const before2 = readdirSync(dl).length;
await ev(`document.querySelector('[data-act=xlsx-s8]').click()`); await sleep(1500);
log.xlsx_filtre = readdirSync(dl).length > before2 ? readdirSync(dl).filter(n => /filtr/i.test(n)).join(', ') || readdirSync(dl).join(', ') : null;
log.erreurs_js = errors;
console.log(JSON.stringify(log, null, 1));
ws.close(); process.exit(0);
