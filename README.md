# Jour — planning millimétré, replanifiable à la voix

5 fichiers, zéro serveur, zéro compte. Tout est stocké sur le téléphone. Google Agenda est lu pour les cours et un agenda « Planning » reçoit les blocs générés.

## 1. Héberger (GitHub Pages, gratuit, 5 min)

1. Crée un repo GitHub (public ou privé, les deux marchent), par exemple `jour`.
2. Mets-y les 5 fichiers à la racine : `index.html`, `planner.js`, `sw.js`, `manifest.webmanifest`, `icon.png`.
3. Settings → Pages → Source : « Deploy from a branch », branche `main`, dossier `/ (root)` → Save.
4. Une minute plus tard l'app est sur `https://TONPSEUDO.github.io/jour/` (garde le `/` final, il compte pour Google).

## 2. Accès à Google Agenda (une seule fois, 10 min)

1. https://console.cloud.google.com → nouveau projet (nom libre).
2. « APIs et services » → « Bibliothèque » → **Google Calendar API** → Activer.
3. « Écran de consentement OAuth » → type **Externe** → remplis nom + e-mail → enregistrer. Dans « Utilisateurs test », ajoute ton adresse Gmail (en mode test, seuls les testeurs peuvent se connecter, c'est ce qu'on veut).
4. « Identifiants » → « Créer des identifiants » → **ID client OAuth** → type **Application Web** :
   - Origines JavaScript autorisées : `https://TONPSEUDO.github.io`
   - URI de redirection autorisés : `https://TONPSEUDO.github.io/jour/`
5. Copie le **Client ID** (finit par `.apps.googleusercontent.com`).

## 3. Sur l'iPhone

1. Ouvre `https://TONPSEUDO.github.io/jour/` dans Safari.
2. Réglages → colle le Client ID → « Connecter Google » → choisis ton compte → autorise.
3. Coche les agendas où sont tes cours. Clique « Créer un agenda Planning » (ou choisis-en un existant si tu veux).
4. Partager → « Sur l'écran d'accueil ». Lance l'app depuis l'icône.
   - Si la connexion Google refuse de revenir dans l'app installée (ça dépend de la version d'iOS), utilise l'app depuis Safari directement : tout marche pareil.
5. Le jeton Google dure 1 h. Après, la pastille passe à « Reconnecter Google » : un tap, et ça repart. Le planning se calcule même sans connexion, c'est seulement la lecture des cours et l'écriture dans l'agenda qui attendent.

## 4. Utilisation

Barre du bas : écris ou dicte avec le micro du clavier, puis valide la phrase comprise.

| Tu dis | Effet |
|---|---|
| `dentiste demain de 14h à 16h` | bloc fixe, tout le reste se replace autour |
| `un pote vient jusqu'à 22h` | bloc fixe de maintenant à 22h |
| `réunion GeoMind samedi 10h 11h30` | bloc fixe samedi |
| `révision marketing 3h avant vendredi` | tâche à deadline, répartie sur les jours restants |
| `rendu projet 2h30 pour le 3 novembre` | idem |
| `pas fait poker` / `pas fait` | le bloc (poker ou le dernier commencé) est marqué sauté ; s'il est en cours, il s'arrête maintenant |
| `fait` / `fini` | bloc en cours marqué fait |
| `coucher 1h` | coucher décalé à 1h, aujourd'hui seulement |
| `libre 2h ce soir` | 2h de temps libre aujourd'hui |
| `pas de poker demain` | poker retiré demain |
| `replanifie` | recalcul |

Toucher un bloc dans « Jour » : Fait / Sauté. Les blocs passés sans réponse apparaissent avec un `?` et comptent « non renseigné » dans le bilan.

## 5. Règles du moteur

- Fenêtre = lever → coucher moins 30 min. Le coucher est dur ; il ne bouge que si tu le dis pour la journée.
- Cours, routines (repas) et imprévus sont soustraits. Les événements « journée entière » et « disponible » de l'agenda sont ignorés.
- Ordre de remplissage : tâches à deadline (au plus 60 % de la journée sauf urgence) → Libre (placé le soir, réduit à 1h si la journée est courte) → quotidiens (Poker) → remplissage (GeoMind, blocs de 45 min à 2h, max 5h/jour) → les restes ≥ 30 min deviennent du Libre.
- Un bloc Poker/GeoMind sauté n'est pas rattrapé (pas de dette). Une tâche à deadline sautée est redistribuée.
- Après minuit et avant le lever, tu es encore « hier ».

Tout se règle dans Réglages (lever, coucher, routines, projets, quotas, tâches). « Exporter » fait une sauvegarde JSON.

## Fichiers

- `planner.js` : moteur + parseur, sans dépendance. Testable sous Node (`node test.js`).
- `index.html` : interface, stockage local, Google Calendar.
- `sw.js`, `manifest.webmanifest`, `icon.png` : installation PWA / hors ligne.
