# Orchestrator

Tableau de bord local pour piloter les micro-services d'un poste de dev : Orchestrator découvre les dépôts d'un dossier racine, lance chaque service avec les variables d'environnement importées depuis IntelliJ / `.env`, affiche statut, logs et version, et change de branche git sur un ou plusieurs projets en un clic.

Next.js 16 · React 19 · TypeScript · Tailwind v4. Tout tourne en local, sans base de données.

## Installation

```bash
npm install
```

Prérequis : Windows 11, Node 22, `git` dans le `PATH`.

## Lancement

```bash
npm run dev                 # développement
npm run build && npm start  # production locale
```

Les deux commandes lient le serveur à `127.0.0.1` uniquement (jamais exposé sur le réseau) ; l'interface est sur <http://127.0.0.1:3000>. Les routes `/api/*` refusent (403) toute requête dont l'en-tête `Host` n'est pas `127.0.0.1`, `localhost` ou `[::1]` (protection contre le DNS rebinding), et les routes qui modifient l'état refusent une `Origin` étrangère. Aucun service n'est démarré automatiquement au lancement d'Orchestrator : on les démarre depuis l'interface.

Autres scripts : `npm test` (Vitest), `npm run lint`.

## Dossier racine

Orchestrator scanne les sous-dossiers directs du dossier racine. Un sous-dossier est retenu s'il contient un `.git` **et** :

- un `package.json` → **service** (démarrable) ;
- sinon un `version.md` → **base de données** (affichée avec sa version, non démarrable).

La racine par défaut est `C:\Repositories\AtoolDev\semaphore` ; elle se modifie depuis l'interface (ou `PUT /api/settings` avec `{ "root": "..." }`) et est conservée dans `data/state.json`. Le dossier racine est rescanné toutes les 2 s : un nouveau dépôt apparaît sans redémarrer.

## Commande de lancement et variables d'environnement

À la première découverte d'un service, Orchestrator importe sa configuration :

**Commande de lancement**, par ordre de priorité :

1. la configuration d'exécution IntelliJ **sélectionnée** (`.idea/workspace.xml`) ;
2. à défaut, la première configuration **non temporaire** ;
3. à défaut, `npm start` si `package.json` définit un script `start`.

Sans aucune de ces trois sources, le service n'a pas de commande (à saisir à la main dans ses paramètres).

**Variables d'environnement** : celles de la configuration IntelliJ retenue, puis le `.env` du dépôt, qui **l'emporte** en cas de conflit. Au lancement, le service reçoit l'environnement de votre session (celui dans lequel Orchestrator a été démarré : `PATH`, `JAVA_HOME`…) **sans** les variables propres à Next.js (`NODE_ENV`, `PORT`, `NODE_OPTIONS`, `__NEXT_*`, `NEXT_*`, `TURBOPACK*`), complété par les variables du projet, qui l'emportent — un projet peut donc définir lui-même `NODE_ENV`, `PORT` ou `NODE_OPTIONS`. Le `npm install` lancé après un changement de branche reçoit le même environnement de session nettoyé (sans les variables du projet), donc installe aussi les devDependencies.

L'import est lu **une seule fois** puis stocké dans Orchestrator : commande et variables sont modifiables par projet dans l'interface, et un « réimport » (avec choix de la configuration IntelliJ) relit les sources. **Orchestrator n'écrit jamais dans les dépôts** (`.env`, `.idea/`, etc.) ; les seules actions sur un dépôt sont celles que vous demandez explicitement : `git fetch/stash/checkout/pull` et `npm install` (voir changement de branche).

## Stockage

Tout l'état est dans le dossier `data/` (ignoré par git) :

| Fichier | Contenu |
| --- | --- |
| `data/state.json` | dossier racine, commandes et variables importées par projet, groupes. Écrit de façon atomique (fichier temporaire puis renommage). |
| `data/pids.json` | pid et heure de démarrage du processus de surveillance de chaque service en cours, pour nettoyer les orphelins. |

⚠ `data/state.json` contient les **variables d'environnement en clair** (mots de passe, jetons…). Ne le commitez ni ne le partagez.

## Crashs

Si un service s'arrête sans que vous l'ayez demandé, il est relancé automatiquement avec un délai croissant (1,5 s, 3 s, 6 s, puis 10 s au maximum). Après **5 crashs en 60 s**, la relance automatique s'arrête et le statut passe à `failed` jusqu'à un démarrage manuel. La fin des logs avant le crash est conservée dans l'interface.

## Changement de branche

Disponible sur un projet ou sur plusieurs à la fois ; chaque projet est traité indépendamment (l'échec de l'un n'arrête pas les autres). Pour chacun :

1. **Arbre modifié** (fichiers suivis) : la bascule est **bloquée**, sauf si vous choisissez « Stasher et basculer ». Orchestrator ne fait jamais de stash implicite ; le stash créé n'est **pas réappliqué** (à vous de faire `git stash pop`).
2. Si le projet tournait, il est arrêté avant la bascule.
3. `git fetch origin --prune` (un échec hors ligne est toléré), puis `checkout` de la branche locale, ou création d'une branche de suivi si elle n'existe que sur `origin`. Branche introuvable ⇒ échec.
4. `git pull --ff-only` (fast-forward uniquement ; hors ligne, avance sur la référence déjà récupérée).
5. `npm install` seulement si le `package-lock.json` a changé entre les deux branches.
6. Si le projet tournait, il est **relancé** — même si la bascule a échoué, pour ne pas laisser éteint un service qui tournait.

Le détail de chaque étape est écrit dans les logs du projet.

## Arrêt

Arrêter Orchestrator (Ctrl+C, fermeture de la console…) **arrête tous les services lancés**, arbre de processus complet. C'est vrai aussi s'il est tué brutalement (`taskkill /F`, plantage) : chaque service tourne sous un petit processus de surveillance (`lib/watchdog.mjs`) qui vérifie chaque seconde que le serveur Orchestrator est vivant et, sinon, tue l'arbre complet du service puis s'arrête (délai d'environ une seconde). En dernier recours, au démarrage suivant, Orchestrator tue aussi les surveillants encore enregistrés dans `data/pids.json` (uniquement si le pid correspond bien au processus enregistré, pour ne jamais tuer un pid réutilisé).
