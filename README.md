# Orchestrateur Node.js Custom (Internal Tool)

Cet outil est un orchestrateur de processus Node.js ultra-léger et **sans dépendances externes**, conçu pour les besoins internes de l'entreprise. Il permet de gérer, surveiller et redémarrer simultanément plusieurs projets (Backend, Frontend, Services) depuis une interface unique.

## 🚀 Fonctionnalités Clés

- **Zéro Dépendance** : Utilise exclusivement les API natives de Node.js (child_process, http, fs, etc.).
- **Dashboard CLI Live** : Un tableau de bord en temps réel dans le terminal (Statut, CPU, RAM, Git, Uptime).
- **Interface Web (Port 4444)** : Un dashboard graphique accessible via navigateur pour piloter les services à distance.
- **Monitoring Git** : Surveillance automatique des branches, des fichiers non-commités et du retard/avance sur le serveur distant.
- **Monitoring Ressources** : Affichage de la consommation CPU et RAM en temps réel pour chaque processus.
- **Gestion des Environnements** : Support natif des fichiers `.env` par projet (chargement automatique depuis le dossier du projet ou via des fichiers locaux `[nom].env`).
- **Auto-Healing** : Redémarrage automatique des services en cas de crash (avec délai de sécurité).
- **Commandes Interactives** : Redémarrage manuel via saisie du nom dans le terminal ou via les boutons de l'interface Web.

## 🛠 Installation & Utilisation

### Prérequis
- Node.js v18 ou supérieur installé sur le système.

### Lancement
Pour démarrer l'orchestrateur et tous les services configurés :
```bash
node orchestrator.js
```

### Accès au Dashboard Web
Une fois lancé, ouvrez votre navigateur sur :
[http://localhost:4444](http://localhost:4444)

## ⚙️ Configuration (`apps.config.js`)

Le fichier `apps.config.js` définit la liste des applications à orchestrer :

```javascript
module.exports = [
  {
    name: "mon-projet",
    script: "app.js",
    cwd: "C:/Chemin/Vers/Le/Projet",
    args: "--port 3000", // Optionnel
    env: { NODE_ENV: "production" } // Variables additionnelles
  }
];
```

## 🔒 Sécurité & Environnement

- **Fichiers .env** : L'orchestrateur cherche un fichier `.env` dans le dossier `cwd` du projet. Si non trouvé, il cherche un fichier `[nom-du-projet].env` dans son propre dossier racine.
- **GitIgnore** : Tous les fichiers `.env` et configurations sensibles sont automatiquement ignorés par Git pour garantir la sécurité des accès.

## ⌨️ Commandes Terminal (Stdin)

Pendant que l'orchestrateur tourne, vous pouvez taper directement :
- `[nom-du-projet]` : Redémarre instantanément le projet concerné.
- `list` : Rafraîchit l'affichage du dashboard CLI.
- `git` : Force une mise à jour de l'état Git de tous les dépôts.
- `Ctrl+C` : Arrête proprement l'orchestrateur et tous les processus enfants (envoi d'un signal SIGTERM).

---
*Outil développé pour un usage interne exclusif.*
