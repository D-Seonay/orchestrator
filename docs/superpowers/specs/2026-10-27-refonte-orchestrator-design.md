# Refonte d'Orchestrator — lanceur local pour les micro-services Semaphore

*Date : 2026-10-27 — statut : brouillon à valider*

## Intention

Aujourd'hui, pour travailler sur Semaphore, Mathéo démarre 4–5 micro-services
dans autant de fenêtres IntelliJ, uniquement parce que c'est là que vivent les
variables d'environnement (configs de lancement dans `.idea/workspace.xml`) et
les logs. Orchestrator doit remplacer ce rituel : un seul tableau de bord local
qui voit tous les dépôts clonés, les lance avec les bonnes variables, montre
leurs logs, leur branche et leur version, et permet de changer de branche sur un
ou plusieurs projets à la fois.

C'est une **refonte totale** du dépôt `D-Seonay/orchestrator` (checkout local :
`C:\Repositories\AtoolDev\my-dashboard-v2`), pas un nouveau projet à côté.

## Objectifs

1. **Découverte automatique.** On configure un dossier racine (par défaut
   `C:\Repositories\AtoolDev\semaphore`). Chaque sous-dossier contenant un dépôt
   git apparaît comme projet. Un dépôt cloné plus tard apparaît sans aucune
   édition de config (rescan au démarrage + surveillance du dossier ou bouton
   « rafraîchir »). Un dossier supprimé disparaît (ses réglages stockés sont
   conservés au cas où il serait recloné).
2. **Lancement sans IntelliJ.** Pour chaque projet, l'outil déduit comment le
   lancer, en priorité depuis la config de lancement IntelliJ existante, sinon
   depuis `package.json` :
   - IntelliJ `NodeJSConfigurationType` → `node [node-parameters] <path-to-js-file> [application-parameters]` dans `working-dir` ;
   - IntelliJ `js.build_tools.npm` → `npm run <script>` ;
   - à défaut, le script `start` du `package.json`.
   Attention : `purchase` et `stock` ont `start = node app.js --prod --port 80`,
   ce qui n'est pas ce qu'on lance en dev — d'où la priorité donnée à IntelliJ.
   La commande déduite est modifiable dans l'outil.
3. **Variables d'environnement.** À la première découverte d'un projet, l'outil
   importe les variables des configs IntelliJ (`<env name=… value=…>`) et du
   `.env` du projet (le `.env` l'emporte en cas de conflit — *appel de Claude*). Ensuite, les variables sont stockées et éditées **dans
   Orchestrator uniquement**. Un bouton « réimporter » permet de reprendre ce
   qu'il y a dans IntelliJ/.env.
4. **Logs.** Logs en direct par projet (stdout + stderr), avec un historique
   suffisant pour remonter une stack trace, recherche/filtre texte, et
   possibilité de voir plusieurs projets.
5. **Statut et version.** Pour chaque projet : en cours / arrêté / planté,
   version du `package.json`, branche courante, dernier commit (hash court +
   message), fichiers modifiés non commités. Version de la base affichée
   séparément, lue dans `semaphore-sgbd/version.md`.
6. **Démarrer / arrêter** un projet, une sélection, ou un groupe enregistré
   (ex. « mes 5 services habituels »).
7. **Changer de branche** sur un projet ou plusieurs à la fois (comportement
   ci-dessous).

## Cycle de vie des services — décidé par Mathéo

- **Liés à Orchestrator** : quand le serveur Orchestrator s'arrête (fermeture,
  kill, crash), tous les services qu'il a lancés sont tués avec lui (arbre de
  process complet). Pas de réattachement au redémarrage ; logs en mémoire.
- **Pas de démarrage automatique** au lancement d'Orchestrator (*appel de
  Claude* : on lance ce dont on a besoin, individuellement ou par groupe).
- **Crash** : le projet affiche clairement qu'il a planté avec le message
  d'erreur (dernières lignes stderr / code de sortie), puis est **relancé
  automatiquement avec une limite**. Limite (*appel de Claude*, reprise de
  l'existant) : au-delà de 5 crashs en 60 s, plus de relance ; le projet reste
  « planté » avec son message jusqu'à une relance manuelle.
- Les services lancés en dehors d'Orchestrator (ex. depuis IntelliJ) ne sont
  pas détectés ; un port déjà pris se verra simplement dans les logs du crash.

## Changement de branche — comportement décidé

Proposé par Claude, accepté par Mathéo (« tu ferais quoi toi ? ») :

- **Modifs non commitées** : le projet n'est pas touché. Il est signalé
  (« 3 fichiers modifiés ») avec deux actions explicites : annuler, ou
  `git stash` puis basculer. Jamais de stash/reset implicite. Le stash n'est
  **pas** réappliqué sur la nouvelle branche ; le projet affiche le nombre de
  stashs existants pour que rien ne paraisse perdu (*appel de Claude*).
- **Projet propre** : `git fetch`, checkout de la branche, `pull --ff-only` ;
  si le pull ne peut pas avancer (commits locaux non poussés), le projet est
  ⚠️, jamais de commit de merge (*appel de Claude*). Si
  `package-lock.json` a changé entre avant et après, `npm install`.
- **Projet en cours d'exécution** : redémarré automatiquement après le
  changement, pour que ce qui tourne corresponde à la branche affichée.
- **Plusieurs projets** : chacun indépendamment ; un échec n'arrête pas les
  autres ; récapitulatif final par projet (✅ / ⚠️ bloqué + raison).
- Branche inexistante sur un projet → ce projet est ⚠️ avec la raison, les
  autres continuent.

## Non-objectifs

- Lister ou cloner les dépôts du groupe GitLab — l'outil ne voit que ce qui est
  cloné localement.
- Déploiement, CI, docker-compose, gestion de la base SQL (`semaphore-sgbd` est
  affiché pour sa version mais n'a pas de bouton « démarrer »).
- Usage multi-utilisateur ou distant : outil perso, sur `localhost`.

## Anti-objectifs (échec même si « ça marche »)

- **Écrire quoi que ce soit dans les dépôts** : ni `.env`, ni `.idea/`, ni
  fichier de config. Les seules écritures dans un dépôt sont les opérations git
  demandées explicitement (checkout/pull/stash) et `npm install`.
- Perdre des modifications locales lors d'un changement de branche.
- Exposer les secrets (`DB_PASSWORD`, clés MinIO…) : le stockage
  d'Orchestrator est hors de tout dépôt cloné et ignoré par git dans le dépôt
  Orchestrator ; le serveur écoute sur `127.0.0.1` seulement.
- Devoir rouvrir IntelliJ pour lancer un service.

## Contraintes

- Windows 11 ; projets Node (Sails, NestJS, Angular, ts-node). Arrêt d'un
  projet = arbre de process complet (`taskkill /T` comme aujourd'hui).
- Plusieurs configs IntelliJ par projet (`app.js`, `test`, `start`,
  `debug`…) : on prend la config sélectionnée dans IntelliJ
  (`<component name="RunManager" selected="…">`), sinon la première non
  temporaire ; l'utilisateur peut en choisir une autre.
- Les valeurs `$PROJECT_DIR$` des configs IntelliJ sont résolues vers le
  chemin du dépôt.

## Choix de construction

- **Décidé par Mathéo** : refonte totale du dépôt orchestrator ; stockage des
  variables dans Orchestrator sans toucher aux projets.
- **Appel de Claude** : rester sur la stack actuelle (Next.js + TypeScript +
  Tailwind, temps réel via SSE, Vitest) — Mathéo la connaît et le cœur de
  gestion de process (spawn, kill d'arbre Windows, lecture git) peut être
  repris de `lib/orchestrator.ts`. Le mode CLI et le support Docker actuels ne
  sont pas repris sauf demande.
- **Appel de Claude** : le fichier `apps.config.json` est remplacé par un
  fichier d'état unique `data/state.json` (dossier racine, réglages par projet :
  commande, variables, groupes), écrit de façon atomique, ignoré par git.

## Laissé au builder

- Mise en page exacte de l'interface (tableau vs cartes, panneau de logs).
- Mécanisme de surveillance du dossier racine (fs.watch vs rescan périodique).
- Taille du tampon de logs et format d'affichage.
- Ordre de priorité si un même nom de variable diffère entre deux configs
  IntelliJ d'un même projet (on suit la config choisie).
