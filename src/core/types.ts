/** Contrat audit.json — version 1.1 (Specs fonctionnelles v0.2, §7). */
export type Localise = string | { fr?: string; en?: string };
export type Puce = Localise | { texte: Localise; sous_puces?: Localise[] };
export type Statut = 'OK' | 'PARTIEL' | 'KO' | 'NA' | 'INCONNU' | 'A_REVOIR';
export type Criticite = 'HAUTE' | 'MOYENNE' | 'FAIBLE' | 'AUCUNE';
export type Effort = 'S' | 'M' | 'L';
export type StatutAnnotation = 'OK' | 'KO' | 'PARTIEL' | 'INFO';

export interface Outil { id: string; libelle: string; nom_complet?: string; categorie?: string; logo?: string | null; couleur?: string }
export interface AccesRequis {
  id: string; outil_id: string; acces: string; motif?: string;
  statut_demande: 'a_demander' | 'demande' | 'obtenu' | 'refuse'; interlocuteur?: string;
}
export interface Cadrage { besoin: Puce[]; objectifs: Puce[]; contraintes: Puce[]; livrables: Puce[] }
export interface Pilier {
  id: string; libelle: Localise; pictogramme?: string; outils: string[]; ordre?: number; actif?: boolean; elements?: Localise[];
}
export interface Critere {
  id_grille: string; pilier_id: string; domaine?: string; outil?: string; outil_id?: string; category?: string; subject?: string;
  axe_score?: 'CONFIGURATION' | 'DATA_QUALITY' | 'COMPLIANCE'; question: string; element_controle?: string;
  statut: string; criticite: string; commentaire?: string; top_prio?: boolean; obsolete?: boolean;
  motif_non_evalue?: 'acces' | 'hors_perimetre' | 'technique' | null; acces_requis_id?: string | null;
}
export interface Annotation {
  num: number; statut: StatutAnnotation; texte: Localise;
  /** `ligne` (1-based) vise une ligne du panneau ; `zone` = "page" ou un rectangle en % de la capture. */
  cible: { ligne?: number; zone?: 'page' | { x: number; y: number; w: number; h: number } };
}
export interface LigneReseau { nom: string; type?: string; statut?: string; domaine?: string }
export interface LigneConsole { texte: string }
export interface Preuve {
  id: string; type?: string; gabarit?: 'navigateur' | 'laptop' | 'cadre'; legende?: Localise;
  origine?: 'capture_reelle' | 'reconstituee';
  etape?: { numero: number; libelle: Localise };
  page?: { url?: string; titre?: string; banniere_cmp?: boolean };
  panneau?: { onglet: 'Network' | 'Console' | 'Application' | 'Elements'; filtre?: string; lignes: (LigneReseau | LigneConsole)[]; payload?: string };
  fichier?: string; contenu?: string; lignes_surlignees?: number[];
  annotations?: Annotation[]; annotations_incrustees?: boolean;
}
export interface Constat {
  id: string; pilier_id: string; titre_action: Localise; titre_court?: Localise;
  situation?: Puce[]; impact?: Puce[]; recommandations?: Puce[];
  criticite: string; effort?: Effort; effort_semaines?: number; criteres_lies?: string[]; visible?: boolean; preuves?: Preuve[];
}
export interface Restitution {
  masquer_scores?: boolean; jauges?: 'pilier' | 'axe'; s1_active?: boolean; regle_score_general?: 'criticite' | 'nb_criteres';
  intro?: Localise; objectif?: Localise; resume_qualitatif?: Localise; conclusion?: Localise;
  contacts?: { nom: string; role?: Localise; email?: string }[];
  sommaire?: { actif?: boolean; transitions?: boolean };
}
export interface Audit {
  schema_version?: string; id: string; client: string; logo?: string | null; image_corporate?: string | null;
  titre?: Localise; langue?: 'fr' | 'en'; date?: string; version?: string; methode?: 'externe' | 'acces';
  methode_detail?: Localise[]; auteurs?: string[]; audit_precedent_id?: string | null;
  restitution?: Restitution; cadrage?: Cadrage; outils?: Outil[]; acces_requis?: AccesRequis[];
  roadmap?: { mois: string[]; phase_courante?: string; phases: { code: string; libelle: Localise; sous_taches?: { libelle: Localise; debut: string; fin: string }[] }[] };
  piliers: Pilier[]; criteres: Critere[]; constats: Constat[];
}
