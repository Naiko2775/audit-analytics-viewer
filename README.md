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

## Structure

| Dossier | Rôle |
|---|---|
| `src/core/` | Contrat (`types.ts`), règles et scores (`rules.ts`), moteur (`model.ts`), validation à l'import (`validate.ts`), libellés FR/EN (`i18n.ts`). Sans DOM, testé. |
| `src/ui/` | Écrans S0 → S9 et S0b (`sections.ts`), preuves annotées (`proof.ts`), shell, présentation, exports et édition (`app.ts`). |
| `src/data/` | Jeu de démonstration fictif (1.1) et jeu 1.0 du prototype (tests de compatibilité). |
| `scripts/migrate_demo.py` | Régénère le jeu de démonstration 1.1 à partir du jeu 1.0. |

## Nouveautés v0.2 couvertes

- Charte JAKALA (navy `#08006B`, rouge `#FF1A31`).
- S0 : emplacements logo client et image corporate (chargés via *Édition › Paramètres*).
- S0b : sommaire calculé, avec numéros de page du deck et slides de transition en option.
- S1 : blocs Besoin / Objectifs / Contraintes / Livrables au-dessus du Gantt.
- S2 : logos des solutions par pilier ; tableau des accès requis, alimenté par `acces_requis` et par les critères `INCONNU` dont le motif est `acces`.
- S5 : gabarit navigateur avec panneau DevTools (Network / Console) et repères OK / KO / Partiel / Info, en plusieurs étapes. Les repères sont des données : ils restent modifiables et traduisibles.

## Limites connues (MVP-α)

- Les surcharges et le feedback sont stockés dans le navigateur (localStorage). La persistance serveur est prévue en V2.
- L'export PPTX et l'export XLSX ne sont pas encore développés (prévus en V1).
- Les logos des éditeurs ne sont pas embarqués : une pastille monogramme les remplace en attendant l'arbitrage sur les droits (§13.2).
