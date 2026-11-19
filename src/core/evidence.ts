/** Fichiers importés (ZIP ou dépôt multiple) : contrôle de sécurité et résolution des preuves (DAT-13). Sans DOM. */
import type { Issue } from './validate.ts';

export interface Asset { path: string; bytes: Uint8Array; mime: string }
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', txt: 'text/plain', log: 'text/plain', json: 'application/json', har: 'application/json' };
export const MAX_ENTRIES = 1000, MAX_TOTAL = 200 * 1024 * 1024;
const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/;

export const extOf = (p: string) => (p.split('.').pop() || '').toLowerCase();
export const mimeOf = (p: string) => MIME[extOf(p)] || '';
/** Normalise un chemin : séparateurs, préfixe ./ ; null si dangereux (../, absolu, lecteur Windows). */
export function safePath(p: string): string | null {
  const s = p.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!s || s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.split('/').some(seg => seg === '..')) return null;
  return s.replace(/\/+/g, '/');
}

export interface Bundle { audit: { name: string; text: string } | null; assets: Map<string, Asset>; issues: Issue[]; root: string }

/** Trie les entrées brutes : audit.json, preuves admises, rejets signalés. */
export function bundleFrom(entries: { name: string; bytes: Uint8Array }[]): Bundle {
  const issues: Issue[] = [];
  const kept: { path: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith('/') || IGNORED.test(e.name)) continue;
    const p = safePath(e.name);
    if (!p) { issues.push({ code: 'ZIP', objet: e.name, message: 'Entrée rejetée : chemin relatif « ../ » ou absolu interdit.' }); continue; }
    if (!mimeOf(p)) { issues.push({ code: 'ZIP', objet: p, message: 'Entrée ignorée : format non admis (PNG, JPG, WebP, GIF, SVG, texte, JSON).' }); continue; }
    total += e.bytes.length;
    kept.push({ path: p, bytes: e.bytes });
  }
  if (kept.length > MAX_ENTRIES) issues.push({ code: 'ZIP', objet: 'Archive', message: `${kept.length} fichiers : au-delà de ${MAX_ENTRIES}, l'import est refusé.` });
  if (total > MAX_TOTAL) issues.push({ code: 'ZIP', objet: 'Archive', message: `Contenu de ${Math.round(total / 1048576)} Mo : au-delà de ${MAX_TOTAL / 1048576} Mo, l'import est refusé.` });

  // audit.json : priorité au nom exact, au niveau le moins profond ; sinon unique .json non-HAR.
  const jsons = kept.filter(k => extOf(k.path) === 'json').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const main = jsons.find(j => /(^|\/)audit[^/]*\.json$/i.test(j.path)) || (jsons.length === 1 ? jsons[0] : null);
  if (!main && jsons.length > 1) issues.push({ code: 'ZIP', objet: 'Archive', message: `Plusieurs JSON (${jsons.map(j => j.path).join(', ')}) : nommez le fichier principal « audit.json ».` });
  const root = main && main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
  const assets = new Map<string, Asset>();
  kept.filter(k => k !== main).forEach(k => {
    const rel = root && k.path.startsWith(root) ? k.path.slice(root.length) : k.path;
    assets.set(rel, { path: rel, bytes: k.bytes, mime: mimeOf(rel) });
  });
  const text = main ? new TextDecoder().decode(main.bytes) : null;
  return { audit: main && text != null ? { name: main.path, text } : null, assets, issues, root };
}

/** Résout une référence de preuve vers une clé d'asset : chemin exact, puis suffixe, puis nom de fichier unique. */
export function makeResolver(assets: Map<string, Asset>) {
  const keys = [...assets.keys()];
  return (ref: string): string | null => {
    const p = safePath(ref); if (!p) return null;
    if (assets.has(p)) return p;
    const lower = p.toLowerCase();
    const bySuffix = keys.filter(k => k.toLowerCase() === lower || k.toLowerCase().endsWith('/' + lower) || lower.endsWith('/' + k.toLowerCase()));
    if (bySuffix.length === 1) return bySuffix[0];
    const base = lower.split('/').pop()!;
    const byName = keys.filter(k => k.toLowerCase().split('/').pop() === base);
    return byName.length === 1 ? byName[0] : null;
  };
}

export const toBase64 = (b: Uint8Array) => {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return btoa(s);
};
export const dataUrl = (a: Asset) => `data:${a.mime};base64,${toBase64(a.bytes)}`;
