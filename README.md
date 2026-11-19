# Audit Analytics Viewer


Production : https://audit-analytics-viewer.vercel.app (déploiement automatique à chaque push sur `main`).
Restitution web des audits analytics JAKALA, à partir d'un `audit.json` (contrat **1.1**, specs fonctionnelles v0.2).
Le build produit **un seul fichier HTML** (`dist/index.html`) : c'est à la fois l'application déployée et la base de l'artefact autonome envoyé au client (menu *Exporter › Artefact HTML autonome*).

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests du moteur (scores, quadrants, accès requis, validation)
npm run build      # dist/index.html, single-file
AUDIT_FILE=chemin/audit.json npm run build   # build avec un autre audit embarqué
```

## Importer un audit

Écran **Importer** (`#import`) : déposer les fichiers, lire le rapport de contrôle, puis générer la restitution.

Formats acceptés :
- une **archive `.zip`** produite par le skill : `audit.json` et un dossier `preuves/`. Le dossier racine éventuel est détecté automatiquement ;
- un **`audit.json` seul**, si les preuves sont embarquées ou en texte ;
- **plusieurs fichiers** déposés ensemble : le JSON et ses captures.

Les preuves et les logos sont référencés par chemin relatif, par exemple `"fichier": "preuves/doubleclick_network.png"`. La résolution essaie successivement le chemin exact, le suffixe, puis le nom de fichier s'il est unique. Formats admis : PNG, JPG, WebP, GIF, SVG, texte.

Les contrôles sont faits en une seule passe et regroupés par règle (`src/core/validate.ts`, constante `RULES`) :

| Niveau | Exemples |
|---|---|
| **Erreur bloquante** | Syntaxe JSON (avec ligne et colonne), champ obligatoire manquant, identifiant dupliqué, statut ou criticité inconnu, pilier inconnu, `impact_score` hors 1 à 3, constat HAUTE sans preuve ni situation (§7.2), preuve absente sur un constat HAUTE, archive > 200 Mo |
| **Avertissement** | Critère KO HAUTE non rattaché, titre > 80 caractères, bloc > 4 puces, effort incohérent avec le nombre de semaines, preuve absente (autres criticités), entrée de ZIP rejetée (`../`, format), budget de l'artefact dépassé |
| **Information** | Fichier non référencé, images optimisées, logo d'outil manquant |

La génération reste désactivée tant qu'il y a des erreurs bloquantes. S'il n'y a que des avertissements, elle demande une confirmation.

À l'intégration, les images de plus de 1 920 px ou de plus de 400 Ko sont réduites et ré-encodées en WebP qualité 80 (décision D11). Les fichiers deviennent des `data:` URL : l'audit est alors autonome et l'artefact exporté fonctionne hors ligne.

Tout le traitement se fait dans le navigateur : rien n'est envoyé sur un serveur. Les audits importés sont conservés dans IndexedDB et listés sur l'écran d'import, et le dernier ouvert est rechargé au démarrage.

## Tests

- `npm test` lance les tests unitaires du moteur et de l'import (Node, sans navigateur).
- `tests/e2e/import.e2e.mjs` est le test de bout en bout du parcours d'import, dans Chrome headless piloté par le protocole DevTools : JSON invalide, ZIP avec preuves manquantes et entrées dangereuses, confirmation des avertissements, génération, persistance après rechargement.
  ```bash
  npm run build && python3 -m http.server 4173 --bind 127.0.0.1 --directory dist &
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/aav-e2e about:blank &
  node tests/e2e/import.e2e.mjs 9333 /tmp/aav-e2e <archive.zip> <json_casse.json>
  ```

## Structure

| Dossier | Rôle |
|---|---|
| `src/core/` | Contrat (`types.ts`), règles et scores (`rules.ts`), moteur (`model.ts`), validation à l'import (`validate.ts`), archive et résolution des preuves (`evidence.ts`), libellés FR/EN (`i18n.ts`). Sans DOM, testé. |
| `src/ui/` | Écrans S0 → S9 et S0b (`sections.ts`), preuves annotées (`proof.ts`), module d'import (`importer.ts`), stockage local (`storage.ts`), shell, présentation, exports et édition (`app.ts`). |
| `src/data/` | Jeu de démonstration fictif (1.1) et jeu 1.0 du prototype (tests de compatibilité). |
| `scripts/migrate_demo.py` | Régénère le jeu de démonstration 1.1 à partir du jeu 1.0. |

## Nouveautés v0.2 couvertes

- Charte JAKALA (navy `#08006B`, rouge `#FF1A31`).
- S0 : emplacements logo client et image corporate (chargés via *Édition › Paramètres*).
- S0b : sommaire calculé, avec numéros de page du deck et slides de transition en option.
- S1 : blocs Besoin / Objectifs / Contraintes / Livrables au-dessus du Gantt.
- S2 : logos des solutions par pilier ; tableau des accès requis, alimenté par `acces_requis` et par les critères `INCONNU` dont le motif est `acces`.
- S5 : gabarit navigateur avec panneau DevTools (Network / Console) et repères OK / KO / Partiel / Info, en plusieurs étapes. Les repères sont des données : ils restent modifiables et traduisibles.

## Exports et modules V1

- **PowerPoint (.pptx)** (`src/export/pptx.ts`, chargé à la demande) : deck à la charte JAKALA dans le même ordre que l'aperçu (couverture, sommaire, transitions en option, S1 à S9, une slide par fiche). Textes, tableaux, Gantt, matrice et repères de preuve sont des éléments natifs, donc modifiables. Les alertes de mise en page sont affichées après l'export.
- **Plan d'action (XLSX)** (`src/export/xlsx.ts`, écrivain OOXML sans dépendance) : feuilles Synthèse, Plan d'action, Grille détaillée (colonnes de la grille 230906 + priorité, effort, feedback, statut de correction) et Accès requis. Depuis S8, l'export filtré ajoute une feuille « Filtres appliqués ».
- **Import de la grille Excel** (`src/core/grid.ts`, `src/core/xlsx-read.ts`) : déposer `230906_Scoring_Template.xlsx` sur l'écran d'import pour obtenir un `audit.json` 1.1 avec des constats brouillons à relire. Le convertisseur a été écrit **d'après la spec §2.1**, sans le vrai fichier : il est à valider sur la vraie grille.
- **Évolution** (`src/core/compare.ts`, `src/ui/compare.ts`) : comparaison avec l'audit de référence (`audit_precedent_id`, sinon le précédent du même client). Elle montre l'écart de score global, par pilier et par axe, les critères améliorés ou dégradés et les constats résolus, persistants ou régressés. Badge d'évolution en S3.
- **Performance** (`src/data/perf.ts`, `npm run perf`) : jeu de 150 critères, 30 constats et 60 preuves ; `parseJson`, `validate` et `buildModel` en quelques millisecondes.

## Limites connues (MVP-α)

- Les audits importés, les surcharges et le feedback sont stockés dans le navigateur (IndexedDB et localStorage). La persistance serveur est prévue en V2.
- Le PPTX et le XLSX n'ont pas été recettés dans PowerPoint ni dans Excel (A3, EXP-23) : ils ont seulement été vérifiés par analyse XML et par aperçu Quick Look. Il n'y a pas de master PPTX officiel (Q2), et le double hexagone S4 (Q6) n'est pas fait.
- Le lien partageable sécurisé et le feedback client persistant (V2) sont reportés.
- Les logos des éditeurs ne sont pas embarqués : une pastille monogramme les remplace en attendant l'arbitrage sur les droits (§13.2).
