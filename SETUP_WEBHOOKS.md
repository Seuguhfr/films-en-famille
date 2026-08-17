# Guide de Synchronisation : Radarr, Jellyfin & Films en Famille

Ce guide vous explique comment configurer les webhooks pour synchroniser automatiquement vos ajouts de films, vos suppressions, et vos visionnages Jellyfin avec **Films en Famille**.

---

## 1. Clé secrète Cloudflare (Optionnel mais Recommandé)

Pour sécuriser vos webhooks :
1. Rendez-vous sur le **[Dashboard Cloudflare](https://dash.cloudflare.com/)** &rarr; **Workers & Pages** &rarr; **films-en-famille** &rarr; **Settings** &rarr; **Environment variables**.
2. Ajoutez la variable suivante (pour **Production** et **Preview**) :
   - `WEBHOOK_SECRET` = `votre_mot_de_passe_secret` (ex: `famille_secret_2026`)

---

## 2. Configuration dans Radarr (Ajout & Suppression de films)

Chaque fois qu'un film est ajouté ou supprimé dans Radarr ou Overseerr/Jellyseerr, il est instantanément répercuté sur votre site.

1. Dans **Radarr**, allez dans **Settings** &rarr; **Connect** &rarr; Cliquez sur le bouton **+** &rarr; Choisissez **Webhook**.
2. Remplissez les champs :
   - **Name** : `Films en Famille`
   - **On Grab** : ✅
   - **On Movie Added** : ✅
   - **On Movie Delete** : ✅
   - **On Movie File Delete** : ✅
   - **URL** : `https://<VOTRE-DOMAINE>/api/webhooks/radarr?secret=VOTRE_SECRET`
     *(Exemple : `https://v2.filmsfamiliaux.pages.dev/api/webhooks/radarr?secret=famille_secret_2026`)*
   - **Method** : `POST`
3. Cliquez sur **Test**, puis **Save**.

---

## 3. Configuration dans Jellyfin (Visionnage automatique)

Quand le compte `famille` finit de regarder un film sur la TV, il est automatiquement marqué comme **"Vu"** sur Films en Famille.

1. Dans **Jellyfin**, allez dans **Tableau de bord** &rarr; **Plugins** &rarr; **Catalogue** &rarr; Installez le plugin **Webhook** (si ce n'est pas déjà fait), puis redémarrez Jellyfin.
2. Allez dans **Tableau de bord** &rarr; **Plugins** &rarr; **Webhook** &rarr; **Add Webhook** / **Generic / Custom Webhook** :
   - **Webhook Name** : `Films en Famille Watched`
   - **Webhook URL** : `https://<VOTRE-DOMAINE>/api/webhooks/jellyfin?secret=VOTRE_SECRET`
   - **Notification Type** : Cochez **Playback Stop** et **Item Marked As Played**.
   - **User Filter** : Sélectionnez l'utilisateur **`famille`** (ou laissez le script filtrer automatiquement).
3. Cliquez sur **Save**.

---

## 4. Import initial de votre catalogue Radarr existant

Pour importer tous les films déjà présents dans votre Radarr vers votre base Cloudflare D1 en 1 seule commande :

Ouvrez votre terminal et lancez :

```bash
# Exemple direct avec variables :
python3 scripts/sync_radarr.py \
  --radarr-url "http://localhost:7878" \
  --radarr-key "VOTRE_CLE_API_RADARR" \
  --webapp-url "https://<VOTRE-DOMAINE>" \
  --secret "VOTRE_SECRET"
```

*(Ou lancez simplement `python3 scripts/sync_radarr.py` sans arguments, le script vous demandera interactivement votre clé API et l'URL du site).*
