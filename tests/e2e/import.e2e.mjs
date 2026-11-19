// Test de bout en bout du module d'import (Chrome DevTools Protocol, sans dépendance).
// Usage : voir README › Tests. Arguments : <port CDP> <dossier de sortie> <archive.zip> <json_casse.json>
const [,, port, out, ...files] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = {};
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async name => { const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); (await import('node:fs')).writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const setFiles = async paths => { const doc = await cmd('DOM.getDocument'); const q = await cmd('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#file' }); await cmd('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: paths }); };
const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await sleep(200); } return false; };
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1250, deviceScaleFactor: 1, mobile: false });
await cmd('Page.navigate', { url: `http://127.0.0.1:4173/#import` }); await sleep(1500);
const log = [];
// 1) JSON cassé
await setFiles([files[1]]); await waitFor(`!!document.querySelector('.imp-verdict')`);
log.push(['json_casse', await ev(`document.querySelector('.ir-e')?.innerText.slice(0,300)`), await ev(`document.querySelector('[data-act=imp-generate]').disabled`)]);
await shot('imp_1_casse');
await ev(`document.querySelector('[data-act=imp-reset]').click()`); await sleep(300);
// 2) ZIP complet
await setFiles([files[0]]); await waitFor(`!!document.querySelector('.imp-verdict')`, 30000);
log.push(['zip_verdict', await ev(`document.querySelector('.imp-verdict').innerText`)]);
log.push(['zip_stats', await ev(`document.querySelector('.imp-sum').innerText.replace(/\\n+/g,' | ')`)]);
await ev(`document.querySelectorAll('.ir').forEach(d=>d.open=true)`);
log.push(['zip_report', await ev(`[...document.querySelectorAll('.ir-g')].map(g=>g.innerText.replace(/\\n+/g,' / ')).join('\\n')`)]);
await shot('imp_2_rapport');
log.push(['btn_avant_ack', await ev(`document.querySelector('[data-act=imp-generate]').disabled`)]);
await ev(`(()=>{const c=document.querySelector('[data-imp=ack]'); if(c){c.click();}})()`); await sleep(300);
log.push(['btn_apres_ack', await ev(`document.querySelector('[data-act=imp-generate]').disabled`)]);
await ev(`document.querySelector('[data-act=imp-generate]').click()`); await waitFor(`location.hash==='#S0'`);
await sleep(800);
log.push(['apres_generation', await ev(`location.hash + ' | ' + document.querySelector('.brand').innerText.replace(/\\n/g,' ') + ' | toast=' + (document.querySelector('.toast')?.innerText||'')`)]);
log.push(['logo_embarque', await ev(`(document.querySelector('.hex img')?.src||'').slice(0,30)`)]);
await shot('imp_3_couverture');
await ev(`location.hash='#S5/C-CONS-03'`); await sleep(800); await shot('imp_4_fiche');
log.push(['preuve_img', await ev(`(document.querySelector('.br-shot img')?.src||'').slice(0,25)`)]);
await ev(`location.hash='#S5/C-DL-03'`); await sleep(500);
log.push(['preuve_txt', await ev(`document.querySelector('.dev')?.innerText.slice(0,80)`)]);
// 3) Rechargement : l'audit importé est restauré
await cmd('Page.reload'); await sleep(2000);
log.push(['apres_reload', await ev(`document.querySelector('.brand').innerText.replace(/\\n/g,' ')`)]);
await ev(`location.hash='#import'`); await sleep(600); await shot('imp_5_recents');
log.push(['recents', await ev(`document.querySelector('.imp-recent')?.innerText.replace(/\\n+/g,' | ').slice(0,300)`)]);
console.log(JSON.stringify(log, null, 1));
ws.close(); process.exit(0);
