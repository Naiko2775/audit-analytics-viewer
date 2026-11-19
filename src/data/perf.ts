/**
 * Jeu de performance synthétique (DAT-33, au service de DAT-18 et de l'exigence §11).
 * Générateur déterministe : même graine → même audit, octet pour octet. Pur, sans DOM (Node et navigateur).
 * Par défaut : 150 critères, 30 constats, 60 preuves (Network, Console, texte, captures PNG), 3 piliers, contrat 1.1 complet.
 */
import { zlibSync } from 'fflate';
import type { AccesRequis, Audit, Constat, Critere, Effort, Outil, Pilier, Preuve, Puce } from '../core/types.ts';
import { toBase64 } from '../core/evidence.ts';

export interface PerfOptions {
  criteres?: number; constats?: number; preuves?: number; piliers?: number;
  /** Graine du générateur pseudo-aléatoire (défaut 20261119). */
  seed?: number;
  /** Taille des captures PNG générées, en pixels (défaut 640 × 400). */
  image?: { w: number; h: number };
}
export const PERF_DEFAUTS = Object.freeze({ criteres: 150, constats: 30, preuves: 60, piliers: 3, seed: 20261119, image: Object.freeze({ w: 640, h: 400 }) });
/** Borne une option numérique : entier ≥ min (et ≤ max), sinon valeur par défaut (NaN, négatif, non numérique). */
const entier = (v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : d;

/** PRNG mulberry32 : rapide, reproductible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- PNG minimal (RGB 8 bits, filtre 0, zlib via fflate) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** Encode un tampon RGB (w × h × 3) en PNG valide. */
export function encodePng(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}

/** Capture factice « page web » : bandeau navy, blocs de contenu, bruit léger pour simuler une capture réelle (peu compressible). */
function fakeCapture(w: number, h: number, rnd: () => number, accent: [number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 3);
  const blocks = Array.from({ length: 6 }, () => ({ x: Math.floor(rnd() * w * 0.7), y: Math.floor(h * 0.15 + rnd() * h * 0.7), w: Math.floor(w * (0.1 + rnd() * 0.25)), h: Math.floor(h * (0.05 + rnd() * 0.15)), g: 180 + Math.floor(rnd() * 60) }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 246, g = 247, b = 251;
    if (y < h * 0.08) { r = 8; g = 0; b = 107; }
    else if (y < h * 0.11) { [r, g, b] = accent; }
    else for (const k of blocks) if (x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h) { r = g = b = k.g; break; }
    const n = Math.floor(rnd() * 24) - 12; // bruit de capture
    const i = (y * w + x) * 3;
    px[i] = Math.max(0, Math.min(255, r + n)); px[i + 1] = Math.max(0, Math.min(255, g + n)); px[i + 2] = Math.max(0, Math.min(255, b + n));
  }
  return px;
}

/* ---------- Référentiels ---------- */
const OUTILS: Outil[] = [
  { id: 'didomi', libelle: 'Didomi', categorie: 'CMP', logo: null, couleur: '#1A2B6D' },
  { id: 'gtm', libelle: 'GTM', nom_complet: 'Google Tag Manager', categorie: 'TMS', logo: null, couleur: '#246FDB' },
  { id: 'ga4', libelle: 'GA4', nom_complet: 'Google Analytics 4', categorie: 'Web analytics', logo: null, couleur: '#E37400' },
  { id: 'matomo', libelle: 'Matomo', categorie: 'Web analytics', logo: null, couleur: '#3152A0' },
  { id: 'google-ads', libelle: 'Google Ads', categorie: 'Média', logo: null, couleur: '#4285F4' },
  { id: 'meta', libelle: 'Meta Pixel', categorie: 'Média', logo: null, couleur: '#0866FF' },
  { id: 'bigquery', libelle: 'BigQuery', categorie: 'Data', logo: null, couleur: '#669DF6' },
  { id: 'piano', libelle: 'Piano Analytics', categorie: 'Web analytics', logo: null, couleur: '#2C2C54' },
];
const PILIERS_BASE = [
  { id: 'consentement', libelle: 'Consentement & conformité', pictogramme: 'shield', outils: ['didomi', 'gtm', 'google-ads'], domaine: 'CMP', axe: 'COMPLIANCE' },
  { id: 'datalayer', libelle: 'DataLayer & plan de marquage', pictogramme: 'layers', outils: ['gtm', 'ga4', 'meta'], domaine: 'DL', axe: 'DATA_QUALITY' },
  { id: 'configuration', libelle: 'Configuration des outils', pictogramme: 'settings', outils: ['ga4', 'matomo', 'bigquery'], domaine: 'CONF', axe: 'CONFIGURATION' },
  { id: 'media', libelle: 'Média & conversions', pictogramme: 'target', outils: ['google-ads', 'meta', 'piano'], domaine: 'MED', axe: 'DATA_QUALITY' },
  { id: 'gouvernance', libelle: 'Gouvernance & documentation', pictogramme: 'book', outils: ['gtm', 'bigquery'], domaine: 'GOV', axe: 'CONFIGURATION' },
  { id: 'performance', libelle: 'Performance & qualité', pictogramme: 'gauge', outils: ['ga4', 'piano'], domaine: 'PERF', axe: 'DATA_QUALITY' },
] as const;
const SUJETS = ['le déclenchement des tags', 'la collecte des événements', 'les paramètres de campagne', 'la déduplication des conversions', 'les exclusions de trafic interne', 'la durée de rétention', 'le tunnel e-commerce', 'les identifiants utilisateur', 'les vues de page virtuelles', 'le mode consentement'];
const STATUTS = ['OK', 'Yes', 'KO', 'No', 'Partly', 'PARTIEL', 'Not concerned', 'Unknown', 'A_REVOIR'];
const POIDS_STATUT = [0.22, 0.1, 0.18, 0.08, 0.12, 0.08, 0.07, 0.1, 0.05];
const CRITS = ['HAUTE', 'MOYENNE', 'FAIBLE', 'AUCUNE'];
const POIDS_CRIT = [0.3, 0.4, 0.25, 0.05];
const pick = <T>(rnd: () => number, list: readonly T[], poids?: number[]): T => {
  if (!poids) return list[Math.floor(rnd() * list.length)];
  let r = rnd(); for (let i = 0; i < list.length; i++) { r -= poids[i]; if (r < 0) return list[i]; } return list[list.length - 1];
};
const pad = (n: number, w = 3) => String(n).padStart(w, '0');

/** Génère un audit 1.1 complet, conforme à validate() sans erreur bloquante. */
export function makePerfAudit(opts: PerfOptions = {}): Audit {
  // Options assainies : un nombre décimal, négatif ou NaN (ex. argument de ligne de commande erroné) ne doit ni planter ni vider le jeu.
  const nC = entier(opts.criteres, PERF_DEFAUTS.criteres), nK = entier(opts.constats, PERF_DEFAUTS.constats);
  const nP = entier(opts.preuves, PERF_DEFAUTS.preuves), nPil = entier(opts.piliers, PERF_DEFAUTS.piliers, 1, PILIERS_BASE.length);
  // PNG : largeur et hauteur ≥ 1 obligatoires (une image 0 × 0 est invalide) ; plafond pour éviter un tampon démesuré.
  const img = { w: entier(opts.image?.w, PERF_DEFAUTS.image.w, 1, 4096), h: entier(opts.image?.h, PERF_DEFAUTS.image.h, 1, 4096) };
  const rnd = mulberry32(entier(opts.seed, PERF_DEFAUTS.seed, 0, 0xffffffff));

  const pils = PILIERS_BASE.slice(0, nPil);
  const piliers: Pilier[] = pils.map((p, i) => ({
    id: p.id, libelle: p.libelle, pictogramme: p.pictogramme, outils: [...p.outils], ordre: i + 1, actif: true,
    elements: [`Contrôle de ${p.libelle.toLowerCase()}`, 'Revue des configurations', 'Tests en navigation réelle'],
  }));
  const outilsUtil = new Set<string>(pils.flatMap(p => p.outils));
  const outils = OUTILS.filter(o => outilsUtil.has(o.id));
  const acces_requis: AccesRequis[] = outils.slice(0, 3).map((o, i) => ({
    id: `ACC-${pad(i + 1, 2)}`, outil_id: o.id, acces: `Accès en lecture à ${o.nom_complet ?? o.libelle}`, motif: 'Contrôler la configuration côté console',
    statut_demande: (['a_demander', 'demande', 'obtenu'] as const)[i % 3], interlocuteur: ['DSI', 'Équipe digitale', 'DPO'][i % 3],
  }));

  // Critères
  const criteres: Critere[] = [];
  for (let i = 0; i < nC; i++) {
    const p = pils[i % nPil];
    const outil_id: string = p.outils[Math.floor(i / nPil) % p.outils.length];
    const statut = pick(rnd, STATUTS, POIDS_STATUT);
    const c: Critere = {
      id_grille: `${p.domaine}-${pad(i + 1)}`, pilier_id: p.id, domaine: p.domaine, outil_id,
      category: pick(rnd, ['Utilisateur', 'Technique', 'Métier']), subject: pick(rnd, ['Compliance', 'Collecte', 'Paramétrage']),
      axe_score: rnd() < 0.6 ? p.axe : pick(rnd, ['CONFIGURATION', 'DATA_QUALITY', 'COMPLIANCE'] as const),
      question: `Le contrôle n° ${i + 1} sur ${pick(rnd, SUJETS)} est-il conforme ?`, element_controle: `Élément ${i + 1}`,
      statut, criticite: pick(rnd, CRITS, POIDS_CRIT),
      // Témoin d'échappement HTML/XML (un critère sur 10) : <, >, &, guillemets doivent ressortir intacts dans l'interface et les exports.
      commentaire: i % 10 === 4 ? `Paramètre « cd_${i} » attendu : 0 < valeur & valeur > "seuil" ; balise <script> non exécutée.` : `Observation synthétique n° ${i + 1}, générée pour la mesure de performance.`,
      top_prio: rnd() < 0.1, obsolete: i % 50 === 49, // quelques critères obsolètes, exclus des scores
    };
    if (statut === 'Unknown') {
      const acc = acces_requis.find(a => a.outil_id === outil_id);
      c.motif_non_evalue = acc || rnd() < 0.5 ? 'acces' : 'technique';
      c.acces_requis_id = c.motif_non_evalue === 'acces' && acc ? acc.id : null;
    }
    criteres.push(c);
  }

  // Constats : critères liés pris dans le pilier, de préférence en écart
  const ecart = (c: Critere) => ['KO', 'No', 'Partly', 'PARTIEL'].includes(c.statut);
  const parPilier: Record<string, Critere[]> = {};
  criteres.forEach(c => (parPilier[c.pilier_id] = parPilier[c.pilier_id] || []).push(c));
  const curseur: Record<string, number> = {};
  const constats: Constat[] = [];
  for (let j = 0; j < nK; j++) {
    const p = pils[j % nPil];
    const pool = (parPilier[p.id] || []).filter(ecart);
    const lies: string[] = [];
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n && pool.length; k++) {
      const c = pool[(curseur[p.id] = (curseur[p.id] ?? -1) + 1) % pool.length];
      if (!lies.includes(c.id_grille)) lies.push(c.id_grille);
    }
    const effort: Effort = pick(rnd, ['S', 'M', 'L'] as const, [0.4, 0.35, 0.25]);
    const sem = effort === 'S' ? 0.5 : effort === 'M' ? 1 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 5);
    const sujet = pick(rnd, SUJETS);
    const situation: Puce[] = [`Écart constaté sur **${sujet}** (constat n° ${j + 1})`, `Critères concernés : ${lies.length ? lies.map(x => '`' + x + '`').join(', ') : 'aucun'}`];
    constats.push({
      id: `C-${pad(j + 1)}`, pilier_id: p.id, titre_action: `Corriger ${sujet} (lot ${j + 1})`,
      // Contenus bilingues (Localise) une fiche sur deux, pour exercer tx() sur les deux formes du contrat.
      titre_court: j % 2 ? { fr: `Corriger ${sujet}`, en: `Fix item ${j + 1}` } : `Corriger ${sujet}`,
      situation, impact: ['Données **incomplètes** dans les rapports', 'Risque de décision sur des chiffres biaisés'],
      recommandations: ['Mettre à jour la configuration dans l\'outil concerné', { texte: 'Vérifier ensuite :', sous_puces: ['en mode Preview', 'dans les rapports temps réel'] }, 'Documenter la règle dans le plan de marquage'],
      criticite: pick(rnd, ['HAUTE', 'MOYENNE', 'FAIBLE'], [0.4, 0.4, 0.2]), effort, effort_semaines: sem, criteres_lies: lies, visible: true, preuves: [],
    });
  }

  // Preuves : répartition circulaire sur les constats, 4 gabarits alternés
  for (let k = 0; k < nP && nK; k++) {
    const c = constats[k % nK];
    const id = `P-${pad(k + 1)}`;
    const etape = { numero: (c.preuves!.length + 1), libelle: `Étape ${c.preuves!.length + 1} du parcours de test` };
    const page = { url: `https://www.client-perf.fr/page-${k + 1}`, titre: `Page ${k + 1}`, banniere_cmp: k % 2 === 0 };
    let p: Preuve;
    switch (k % 4) {
      case 0: {
        const lignes = Array.from({ length: 6 + (k % 5) }, (_, i) => ({ nom: `collect?v=2&en=evt_${i}&tid=G-PERF${k}`, type: pick(rnd, ['fetch', 'script', 'gif', 'ping']), statut: pick(rnd, ['200', '204', '302']), domaine: pick(rnd, ['www.google-analytics.com', 'ad.doubleclick.net', 'stats.client-perf.fr', 'connect.facebook.net']) }));
        p = { id, type: 'reseau', gabarit: 'navigateur', origine: 'reconstituee', etape, page, panneau: { onglet: 'Network', filtre: 'collect|doubleclick', lignes, payload: `en=page_view · gcs=G10${k % 2} · tid=G-PERF${k}` },
          annotations: [{ num: 1, statut: 'OK', cible: { zone: 'page' }, texte: 'Page chargée, bannière **visible**' }, { num: 2, statut: 'KO', cible: { ligne: 2 }, texte: 'Hit émis **avant** consentement' }, { num: 3, statut: 'PARTIEL', cible: { ligne: lignes.length }, texte: 'Paramètre incomplet' }],
          annotations_incrustees: false, legende: `Requêtes réseau observées (${id})` };
        break;
      }
      case 1: {
        const lignes = Array.from({ length: 5 }, (_, i) => ({ texte: i % 2 ? `['event', 'evt_${i}', { value: ${i * 10} }]` : `> dataLayer.filter(e => e.event === 'evt_${i}')` }));
        p = { id, type: 'console', gabarit: 'navigateur', origine: 'reconstituee', etape, page, panneau: { onglet: 'Console', lignes },
          annotations: [{ num: 1, statut: 'INFO', cible: { ligne: 1 }, texte: 'Commande saisie dans la console' }, { num: 2, statut: 'KO', cible: { ligne: 2 }, texte: 'Valeur **absente** du push' }],
          annotations_incrustees: false, legende: `Contrôle du dataLayer (${id})` };
        break;
      }
      case 2: {
        const contenu = Array.from({ length: 12 }, (_, i) => `  "champ_${i}": "${i % 3 ? 'valeur' : ''}",`).join('\n');
        p = { id, type: 'code', gabarit: 'cadre', origine: 'reconstituee', legende: { fr: `Extrait du dataLayer (${id})`, en: `dataLayer excerpt (${id})` }, contenu: `{\n${contenu}\n}`, lignes_surlignees: [2, 5],
          annotations: [{ num: 1, statut: 'KO', cible: { ligne: 2 }, texte: 'Champ vide' }] };
        break;
      }
      default: {
        const png = encodePng(img.w, img.h, fakeCapture(img.w, img.h, rnd, k % 8 === 3 ? [255, 26, 49] : [15, 127, 129]));
        p = { id, type: 'capture', gabarit: 'navigateur', origine: 'capture_reelle', etape, page, fichier: `data:image/png;base64,${toBase64(png)}`,
          annotations: [{ num: 1, statut: 'KO', cible: { zone: { x: 10, y: 20, w: 30, h: 15 } }, texte: 'Zone en **écart**' }, { num: 2, statut: 'OK', cible: { zone: { x: 55, y: 40, w: 25, h: 20 } }, texte: 'Élément conforme' }],
          annotations_incrustees: false, legende: `Capture d'écran (${id})` };
      }
    }
    c.preuves!.push(p);
  }

  return {
    schema_version: '1.1', id: `AUD-PERF-${nC}-${nK}-${nP}`, client: 'Client Perf (fictif)', logo: null, image_corporate: null,
    titre: 'Audit analytics — jeu de performance', langue: 'fr', date: '2026-11-19', version: '1.0', methode: 'externe',
    methode_detail: ['Jeu synthétique généré (DAT-33)', 'Graine fixe : résultat reproductible'], auteurs: ['Générateur de performance'], audit_precedent_id: null,
    restitution: {
      masquer_scores: false, jauges: 'pilier', s1_active: true, regle_score_general: 'criticite',
      intro: 'Jeu **synthétique** destiné à mesurer le budget de performance du pipeline.', objectif: 'Mesurer import, validation et calcul.',
      resume_qualitatif: 'Résultats générés : sans valeur d\'analyse.', conclusion: 'Fin du jeu de performance.',
      contacts: [{ nom: 'Prénom Nom', role: 'Lead Data Analytics', email: 'prenom.nom@example.com' }], sommaire: { actif: true, transitions: false },
    },
    cadrage: {
      besoin: ['Mesurer le **temps de traitement** d\'un audit volumineux'], objectifs: ['Tenir le budget de **5 s** pour import, validation et calcul'],
      contraintes: ['Jeu **déterministe**, sans donnée réelle'], livrables: ['Mesures consignées dans le rapport de recette'],
    },
    outils, acces_requis,
    roadmap: {
      mois: ['2026-11', '2026-12', '2027-01', '2027-02'], phase_courante: 'DIG',
      phases: [
        { code: 'DIG', libelle: 'Diagnostic', sous_taches: [{ libelle: 'Audit', debut: '2026-11', fin: '2026-12' }] },
        { code: 'HACK', libelle: 'Remédiation', sous_taches: [{ libelle: 'Quick Wins', debut: '2026-12', fin: '2027-01' }] },
        { code: 'MAKE', libelle: 'Évolution', sous_taches: [{ libelle: 'Plan de marquage cible', debut: '2027-01', fin: '2027-02' }] },
      ],
    },
    piliers, criteres, constats,
  };
}
