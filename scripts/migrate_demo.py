"""Construit src/data/demo-audit.json (contrat 1.1) à partir du jeu 1.0 du prototype."""
import json, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
d = json.load(open('src/data/demo-v1.0.json'))
d['schema_version'] = '1.1'
d['image_corporate'] = None
d['restitution']['contacts'] = [
    {"nom": "Prénom Nom", "role": "E-Com & Platform Senior Manager", "email": "prenom.nom@jakala.com"},
    {"nom": "Consultant·e Analytics", "role": "Lead Data Analytics", "email": "prenom.nom@jakala.com"}]
d['restitution']['sommaire'] = {"actif": True, "transitions": False}
d['cadrage'] = {
    "besoin": ["Fiabiliser la **mesure d'audience** avant la refonte du site", "Sécuriser la **conformité** du dispositif de consentement"],
    "objectifs": ["Dresser l'**état des lieux** du consentement et du dataLayer", "Prioriser les corrections en **Quick Wins** et chantiers"],
    "contraintes": ["Analyse **externe** : pas d'accès aux consoles Didomi et Matomo", "Restitution attendue sous **4 semaines**"],
    "livrables": ["Deck de restitution et **grille détaillée**", "Plan d'action priorisé (CSV / XLSX)"]}
d['outils'] = [
    {"id": "didomi", "libelle": "Didomi", "categorie": "CMP", "logo": None, "couleur": "#1A2B6D"},
    {"id": "gtm", "libelle": "GTM", "nom_complet": "Google Tag Manager", "categorie": "TMS", "logo": None, "couleur": "#246FDB"},
    {"id": "matomo", "libelle": "Matomo", "categorie": "Analytics", "logo": None, "couleur": "#3152A0"},
    {"id": "google-ads", "libelle": "Google Ads", "categorie": "Publicité", "logo": None, "couleur": "#1E8E3E"}]
for p in d['piliers']:
    p['outils'] = [{"Didomi": "didomi", "GTM": "gtm", "Matomo": "matomo"}[o] for o in p['outils']]
d['piliers'][0]['outils'].append('google-ads')
def normalize_inconnu(c):
    return str(c.get('statut', '')).strip().upper() in ('INCONNU', 'UNKNOWN')
oid = {"Didomi": "didomi", "GTM": "gtm", "Matomo": "matomo"}
for c in d['criteres']:
    c['outil_id'] = oid.get(c['outil'])
d['acces_requis'] = [
    {"id": "ACC-01", "outil_id": "gtm", "acces": "Lecture sur le conteneur GTM (rôle « Lecture »)", "motif": "Vérifier les utilisateurs et les droits du conteneur", "statut_demande": "demande", "interlocuteur": "Équipe digitale"},
    {"id": "ACC-02", "outil_id": "matomo", "acces": "Compte Matomo « view » + accès Administration › Confidentialité", "motif": "Contrôler la rétention et les exclusions", "statut_demande": "a_demander", "interlocuteur": "DSI"},
    {"id": "ACC-03", "outil_id": "didomi", "acces": "Accès lecture à la console Didomi", "motif": "Contrôler la configuration du Consent Mode", "statut_demande": "a_demander", "interlocuteur": "DPO"}]
for c in d['criteres']:
    if c['id_grille'] == 'GTM-03': c.update(statut='INCONNU', motif_non_evalue='acces', acces_requis_id='ACC-01')
    if c['id_grille'] == 'MAT-08': c.update(motif_non_evalue='acces', acces_requis_id='ACC-02')
    if normalize_inconnu(c) and not c.get('motif_non_evalue'): c['motif_non_evalue'] = 'technique'
d['criteres'].append({"id_grille": "CMP-10", "pilier_id": "consentement", "domaine": "CMP", "outil": "Didomi", "outil_id": "didomi", "category": "Architecture", "subject": "Configuration", "axe_score": "COMPLIANCE", "question": "L'intégration Consent Mode native est-elle activée dans la console ?", "element_controle": "Console Didomi", "statut": "INCONNU", "criticite": "MOYENNE", "commentaire": "Non vérifiable sans accès à la console.", "top_prio": False, "motif_non_evalue": "acces", "acces_requis_id": "ACC-03"})

URL = "https://www.client-demo.fr/"
def net(rows):
    return [dict(zip(["nom", "type", "statut", "domaine"], r)) for r in rows]
c1 = next(c for c in d['constats'] if c['id'] == 'C-CONS-01')
c1['preuves'] = [
  {"id": "P-01-a", "type": "reseau", "gabarit": "navigateur", "origine": "reconstituee",
   "etape": {"numero": 1, "libelle": "Arrivée sur la home, bannière affichée, aucun choix de consentement"},
   "page": {"url": URL, "titre": "Accueil", "banniere_cmp": True},
   "panneau": {"onglet": "Network", "filtre": "doubleclick|matomo|consent|collect",
     "lignes": net([["didomi-sdk.js", "script", "200", "sdk.privacy-center.org"],
                    ["consent?status=pending", "fetch", "200", "api.privacy-center.org"],
                    ["matomo.php?idsite=12&action_name=Accueil&cookie=0", "ping", "204", "stats.client-demo.fr"],
                    ["activityi;src=10089018;type=pagevi0;cat=page_view;gcs=G100", "gif", "200", "ad.doubleclick.net"],
                    ["gtm.js?id=GTM-XXXX", "script", "200", "www.googletagmanager.com"]]),
     "payload": "src=10089018 · cat=page_view · gcs=G100 · npa=0"},
   "annotations": [
     {"num": 1, "statut": "OK", "cible": {"zone": "page"}, "texte": "Bannière CMP affichée, consentement **en attente**"},
     {"num": 2, "statut": "OK", "cible": {"ligne": 3}, "texte": "Matomo en mode **exempté** : hit sans cookie, autorisé"},
     {"num": 3, "statut": "KO", "cible": {"ligne": 4}, "texte": "**DoubleClick** déclenché sans consentement (`gcs=G100`)"}],
   "annotations_incrustees": False, "legende": "Requêtes émises avant tout choix de consentement"},
  {"id": "P-01-b", "type": "reseau", "gabarit": "navigateur", "origine": "reconstituee",
   "etape": {"numero": 2, "libelle": "Clic sur « Tout refuser » puis navigation vers une fiche produit"},
   "page": {"url": URL + "produit/123", "titre": "Fiche produit", "banniere_cmp": False},
   "panneau": {"onglet": "Network", "filtre": "doubleclick|consent",
     "lignes": net([["consent?status=refused", "fetch", "200", "api.privacy-center.org"],
                    ["activityi;src=10089018;cat=page_view;gcs=G100", "gif", "200", "ad.doubleclick.net"]]),
     "payload": "gcs=G100 · refus enregistré côté CMP"},
   "annotations": [
     {"num": 1, "statut": "OK", "cible": {"ligne": 1}, "texte": "Refus transmis à la CMP"},
     {"num": 2, "statut": "KO", "cible": {"ligne": 2}, "texte": "DoubleClick **toujours déclenché** après refus"}],
   "annotations_incrustees": False, "legende": "Requêtes après refus du consentement"},
  {"id": "P-01-c", "type": "console", "gabarit": "navigateur", "origine": "reconstituee",
   "etape": {"numero": 3, "libelle": "Acceptation : contrôle du dataLayer dans la console"},
   "page": {"url": URL, "titre": "Accueil", "banniere_cmp": False},
   "panneau": {"onglet": "Console",
     "lignes": [{"texte": "> dataLayer.filter(e => e[0] === 'consent')"}, {"texte": "['consent', 'update', { ad_storage: 'granted',"},
                {"texte": "   analytics_storage: 'granted' }]"}, {"texte": "> Didomi.getUserStatus().purposes.consent.enabled"},
                {"texte": "['cookies', 'advertising_personalization', 'analytics']"}]},
   "annotations": [
     {"num": 1, "statut": "OK", "cible": {"ligne": 2}, "texte": "`consent update` poussé après acceptation"},
     {"num": 2, "statut": "OK", "cible": {"ligne": 5}, "texte": "Finalités cohérentes avec le choix utilisateur"}],
   "annotations_incrustees": False, "legende": "Mise à jour du consentement après acceptation"}]

# Autres preuves : conversion des numéros de ligne 1.0 en annotations 1.1
for c in d['constats']:
    for p in c.get('preuves', []):
        if isinstance(p.get('annotations'), list) and p['annotations'] and isinstance(p['annotations'][0], int):
            p['lignes_surlignees'] = p.pop('annotations')
            p['annotations'] = [{"num": 1, "statut": "KO", "cible": {"ligne": p['lignes_surlignees'][0]}, "texte": "Point en écart relevé lors de l'analyse"}]
        p.setdefault('origine', 'capture_reelle' if p.get('fichier') else 'reconstituee')
        if p['id'] == 'P-03':
            p['gabarit'] = 'navigateur'; p['page'] = {"url": URL, "titre": "Accueil"}
            p['annotations'] = [{"num": 1, "statut": "KO", "cible": {"zone": {"x": 57, "y": 85, "w": 41, "h": 13}}, "texte": "Aucun bouton **Tout refuser** au premier niveau"},
                                {"num": 2, "statut": "OK", "cible": {"zone": {"x": 2, "y": 66, "w": 50, "h": 20}}, "texte": "Bannière affichée **avant** tout dépôt de cookie"}]
import re
for c in d['constats']:
    for p in c.get('preuves', []):
        if p['id'] == 'P-03':  # repères désormais portés par les annotations, pas incrustés dans l'image
            p['fichier'] = re.sub(r"<text x='620' y='336'.*?</text>", "", re.sub(r"<rect x='370'[^>]*/>", "", p['fichier']))
json.dump(d, open('src/data/demo-audit.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(d['criteres']), 'critères')
