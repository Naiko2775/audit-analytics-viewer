/** Preuves annotées (§6.6 v0.2) : gabarit navigateur + panneau DevTools + repères OK / KO. */
import type { Annotation, LigneConsole, LigneReseau, Preuve } from '../core/types.ts';
import { esc, clamp } from '../core/util.ts';
import { md, t, tx } from '../core/i18n.ts';

type Mode = 'web' | 'slide' | 'zoom';
const ICON: Record<string, string> = { OK: '✓ OK', KO: '✗ KO', PARTIEL: '◐ Partiel', INFO: 'ℹ Info' };
const isImg = (f?: string) => !!f && (/^data:image\//.test(f) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f));

/** Annotations normalisées : le format 1.0 (numéros de ligne) devient des repères INFO sans texte. */
export function annotationsOf(p: Preuve): Annotation[] {
  const a = (p.annotations || []) as any[];
  return a.map((x, i) => (typeof x === 'number' ? { num: i + 1, statut: 'INFO', texte: '', cible: { ligne: x } } : x));
}
const mark = (a: Annotation) => `<span class="amark">${a.num}</span>`;

function pageView(p: Preuve, anns: Annotation[]): string {
  const pageAnn = anns.find(a => a.cible?.zone === 'page');
  if (p.fichier && isImg(p.fichier)) {
    const zones = anns.filter(a => a.cible?.zone && typeof a.cible.zone === 'object').map(a => {
      const z = a.cible.zone as { x: number; y: number; w: number; h: number };
      return `<div class="azone a-${a.statut}" style="left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%">${mark(a)}</div>`;
    }).join('');
    const src = /^data:/.test(p.fichier) || /^https?:/.test(p.fichier) ? p.fichier : '';
    return `<div class="br-shot">${src ? `<img src="${esc(src)}" alt="${esc(tx(p.legende))}">` : `<div class="ph">Capture : ${esc(p.fichier)}</div>`}${zones}</div>`;
  }
  if (!p.page) return '';
  const cmp = p.page.banniere_cmp ? `<div class="cmp"><b>Nous respectons votre vie privée</b>Nous utilisons des cookies…<div class="bt"><span>Personnaliser</span><span>Tout accepter</span></div></div>` : '';
  return `<div class="br-page ${pageAnn ? 'a-' + pageAnn.statut : ''}" ${pageAnn ? 'style="box-shadow:inset 0 0 0 3px var(--ac)"' : ''}><span class="site">${esc(hostOf(p.page.url))}</span><span class="ttl">${esc(p.page.titre || '')}</span>${cmp}${pageAnn ? `<span style="position:absolute;left:6px;bottom:6px">${mark(pageAnn)}</span>` : ''}</div>`;
}
const hostOf = (u?: string) => { try { return new URL(u!).hostname.replace(/^www\./, '').toUpperCase(); } catch { return '[SITE CLIENT]'; } };

function panel(p: Preuve, anns: Annotation[]): string {
  const pn = p.panneau;
  const byLine: Record<number, Annotation> = {};
  anns.forEach(a => { if (a.cible?.ligne) byLine[a.cible.ligne] = a; });
  if (!pn) {
    if (!p.contenu) return '';
    // Format 1.0 : bloc de code avec lignes surlignées
    const hl = new Set(p.lignes_surlignees || []);
    const rows = String(p.contenu).split('\n').map((l, i) => {
      const a = byLine[i + 1];
      return `<div class="con-row ${a ? 'ann a-' + a.statut : hl.has(i + 1) ? 'ann a-INFO' : ''}">${a ? mark(a) : ''}${esc(l) || '&nbsp;'}</div>`;
    }).join('');
    return `<div class="dev"><div class="dev-tabs"><span class="on">Console</span></div>${rows}</div>`;
  }
  const tabs = ['Elements', 'Console', 'Sources', 'Network', 'Application'].map(x => `<span class="${x === pn.onglet ? 'on' : ''}">${x}</span>`).join('');
  const head = `<div class="dev-tabs">${tabs}${pn.filtre ? `<span class="flt">Filtre : ${esc(pn.filtre)}</span>` : ''}</div>`;
  let rows: string;
  if (pn.onglet === 'Network') {
    rows = `<div class="net-row hd"><span>Name</span><span>Type</span><span>Status</span><span>Domain</span></div>` +
      (pn.lignes as LigneReseau[]).map((l, i) => {
        const a = byLine[i + 1];
        return `<div class="net-row ${a ? 'ann a-' + a.statut : ''}">${a ? mark(a) : ''}<span title="${esc(l.nom)}">${esc(l.nom)}</span><span>${esc(l.type)}</span><span>${esc(l.statut)}</span><span>${esc(l.domaine)}</span></div>`;
      }).join('');
  } else {
    rows = (pn.lignes as LigneConsole[]).map((l, i) => {
      const a = byLine[i + 1];
      return `<div class="con-row ${a ? 'ann a-' + a.statut : ''}">${a ? mark(a) : ''}${esc(l.texte)}</div>`;
    }).join('');
  }
  return `<div class="dev">${head}${rows}${pn.payload ? `<div class="payload">Payload › ${esc(pn.payload)}</div>` : ''}</div>`;
}

function legacyFrame(p: Preuve, inner: string, zoomAttr: string) {
  return p.gabarit === 'laptop'
    ? `<div class="laptop"${zoomAttr}><div class="lid"><div class="screen">${inner}</div></div><div class="base"></div></div>`
    : `<div class="frame"${zoomAttr}><div class="screen">${inner}</div></div>`;
}

export function proofSummary(p: Preuve) {
  const a = annotationsOf(p);
  return { ok: a.filter(x => x.statut === 'OK').length, ko: a.filter(x => x.statut === 'KO').length };
}

export function proofView(c: { id: string; preuves?: Preuve[] }, mode: Mode, idx = 0): string {
  const ps = c.preuves || [];
  if (!ps.length) return `<div class="noproof">${t('no_proof')}</div>`;
  const i = clamp(idx || 0, 0, ps.length - 1), p = ps[i];
  const anns = annotationsOf(p);
  const zoomAttr = mode === 'web' ? ` data-act="zoom" data-id="${esc(c.id)}" data-i="${i}" role="button" tabindex="0" aria-label="Agrandir la preuve"` : '';
  const navigateur = p.gabarit === 'navigateur' || !!p.panneau;
  let frame: string;
  if (navigateur) {
    const url = p.page?.url || '';
    frame = `<div class="browser"${zoomAttr}><div class="br-bar"><i></i><i></i><i></i><span class="br-url">${esc(url)}</span></div>${pageView(p, anns)}${panel(p, anns)}</div>`;
  } else {
    let inner: string;
    if (isImg(p.fichier) && /^data:/.test(p.fichier!)) inner = `<div class="br-shot"><img src="${esc(p.fichier)}" alt="${esc(tx(p.legende))}"></div>`;
    else if (p.contenu) { const hl = new Set(p.lignes_surlignees || []); inner = `<pre class="code">${String(p.contenu).split('\n').map((l, n) => (hl.has(n + 1) ? `<span class="hl">${esc(l)}</span>` : esc(l))).join('\n')}</pre>`; }
    else inner = `<div class="ph">Preuve : ${esc(p.fichier || p.id)}<br><small>(fichier livré dans le ZIP de preuves)</small></div>`;
    frame = legacyFrame(p, inner, zoomAttr);
  }
  const total = ps.filter(x => x.etape).length || ps.length;
  const head = p.etape ? `<div class="proof-head"><b>${t('etape')} ${p.etape.numero}/${total} :</b> ${md(p.etape.libelle)}${p.panneau ? ` · DevTools › ${esc(p.panneau.onglet)}` : ''}</div>` : '';
  const legend = anns.some(a => tx(a.texte)) ? `<ol class="ann-list">${anns.filter(a => tx(a.texte)).map(a => `<li class="a-${a.statut}">${mark(a)}<span class="st">${ICON[a.statut] || a.statut}</span><span>${md(a.texte)}</span></li>`).join('')}</ol>` : '';
  const steps = ps.length > 1 && mode !== 'zoom'
    ? `<div class="steps" role="group" aria-label="${t('parcours')}">${ps.map((x, k) => { const s = proofSummary(x); return `<button ${mode === 'web' ? `data-act="ptab" data-i="${k}"` : 'tabindex="-1"'} aria-pressed="${k === i}"><b>${x.etape ? `${x.etape.numero} · ` : `${k + 1} · `}${esc(String(tx(x.etape?.libelle) || tx(x.legende)).slice(0, 38))}${String(tx(x.etape?.libelle) || tx(x.legende)).length > 38 ? '…' : ''}</b><span class="sum">${s.ok ? `<span class="o">${s.ok} OK</span> ` : ''}${s.ko ? `<span class="k">${s.ko} KO</span>` : ''}</span></button>`; }).join('')}</div>`
    : '';
  const orig = p.origine === 'reconstituee' && navigateur ? `<span class="orig">${t('reconstituee')}</span>` : '';
  return `<figure class="proof">${head}${frame}<figcaption>${esc(tx(p.legende))}${orig}</figcaption>${legend}${steps}</figure>`;
}
