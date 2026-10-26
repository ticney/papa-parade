---
title: 'Game Architecture'
project: 'papa-parade'
date: '2026-10-26'
author: 'Geo'
version: '1.0'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9]
status: 'complete'
engine: 'Three.js r186 (three@0.186.1) + Vite 8.3 + TypeScript 7.0'
platform: 'web (navigateur) ; iOS et Android via Capacitor 8.5'
language: 'fr'

# Source Documents
gdd: '_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md'
epics: '_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/epics.md'
decision_log: '_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md'
brief: null
---

# Papa Parade — Architecture de jeu

## Statut du document

**Statut :** complet (workflow GDS Architecture, 9 étapes sur 9), validé le 2026-10-26.
Le document est rédigé en français, comme le GDD (dérogation à `document_output_language: English`, décidée par Geo le 2026-10-26). Les identifiants de code restent en anglais. Il est la source de vérité **technique** ; le GDD reste la source de vérité des **règles du jeu**.

## Résumé exécutif

L'architecture de **Papa Parade** repose sur Three.js r186, Vite 8.3 et TypeScript 7.0. Elle cible le navigateur d'abord, puis iOS et Android via Capacitor 8.5.

**Décisions clés :**
- La simulation est en TypeScript pur, déterministe, à pas fixe de 10 ms, découplée du rendu. Elle tourne dans Node, ce qui permet de jouer, tester et équilibrer sans humain.
- Les entrées sont jugées à leur horodatage exact, en temps de jeu : les ralentis étirent les fenêtres, le hitstop gèle la sim, et la calibration est corrigée en temps réel. La glissade de papa n'est que de la chorégraphie.
- Tout ce qui se règle est en données : `feel.json`, menaces, niveaux et table de retours, validés par Zod et réglables à chaud par Geo. La triple équivalence son, visuel et haptique est garantie par un test.

**Structure :** des couches (`sim`, `client`, `platform`, `content`, `shared`, `bots`, `debug`) puis des domaines, avec 18 systèmes centraux et des frontières vérifiées par Biome et des tests d'architecture.

**Patterns :** 7 patterns nouveaux et 4 patterns standard, plus 12 règles de cohérence.

**Prêt pour :** la création des stories, puis l'implémentation du prototype « Bébé à 4 pattes » (E1, E2, E3 partiel).

---

## Contexte du projet

### Vue d'ensemble

**Papa Parade** — action chaotique à timing, solo : un papa « pare » les dangers de son enfant comme dans un jeu de combat. Vue isométrique fixe, 3D low poly, une pièce par niveau, niveaux de 3 à 5 min. Verbe central : « lire, puis répondre juste » (parer, fermeté, esquiver, attendre, ne rien faire).

### Périmètre technique

**Plateforme principale :** navigateur (mobile et desktop), playtest par lien.
**Plateformes secondaires :** iOS et Android via Capacitor (haptique, paysage) ; Steam éventuellement plus tard via un wrapper.
**Entrées :** tactile, clavier, manette.
**Réseau :** aucun (solo, pas de backend de gameplay).
**Genre :** hybride Fighting / Party / Rhythm.
**Niveau du projet :** prototype de complexité moyenne ; jeu complet moyen à élevé.

### Systèmes centraux

| Système | Complexité | Référence GDD |
|---|---|---|
| Horloge de jeu : pas fixe, temps en ms, échelle de temps (hitstop, ralentis), pause et reprise exactes | Haute | Fenêtres de timing, Timing et latence |
| Entrées : tap, maintien, swipe, horodatage, buffer, calibration de latence, ciblage clavier/manette | Haute | Règles d'entrée, Contrôles et entrées |
| Menaces pilotées par les données : télégraphe → fenêtre → résolution (réussite, parfaite, gag) | Haute | Catalogue des menaces |
| IA du bébé : choix de cible, déplacement, regard verrouillé, babillage et silence | Moyenne | Micro-boucle, Silence comme télégraphe |
| Déplacement de papa et glissade freeflow (0,6 s max) | Moyenne | Glissade freeflow |
| Jauges : fatigue, bruit (puis envie pressante) ; instinct paternel | Moyenne | Besoins de papa, Jauge de bruit |
| Perturbations (téléphone) | Basse | Catalogue des menaces |
| Note de Maman : score, étoiles, mémoire des parties | Moyenne | Économie et ressources |
| Fin de niveau : porte, rush final, photo figée, replay | Moyenne à haute (le replay suppose un enregistrement) | Macro-boucle |
| Retours multimodaux : chaque événement émet son, équivalent visuel et haptique | Haute | Pilier 3, Audio et musique |
| Audio adaptatif (coupure, bascule au ralenti) | Moyenne | Audio et musique |
| Rendu iso Three.js : toon, contours, caméra dynamique (zoom au ralenti) | Moyenne | Style visuel |
| Physique légère Rapier (chutes, rebonds) | Moyenne | Physique légère |
| Contenu JSON et validation par schéma | Moyenne | Principe de production |
| Fichier de feeling unique, réglable sans toucher à la logique | Moyenne | E2 |
| Pilotage automatisé : bot joueur, headless, Playwright | Haute | Règle d'or, Indicateurs techniques |
| Persistance locale : calibration, étoiles, mémoire de Maman | Basse | — |
| Couche plateforme : Capacitor, cycle de vie (pause en arrière-plan), déverrouillage audio | Moyenne | Détails par plateforme |

### Exigences techniques

- 60 FPS stables sur appareils de référence (iPhone 12, Android 2021), mesurés sur un niveau complet de 5 min.
- Tap → retour visuel ≤ 50 ms.
- Fenêtres en ms, indépendantes du framerate ; tolérance cachée ±60 ms ; buffer d'entrée 100 ms.
- Calibration de latence audio et tactile au premier lancement.
- Chargement d'un niveau < 5 s en 4G.
- Tous les paramètres de feeling réglables hors logique ; tout le contenu en données éditables.
- Jeu lançable et jouable de bout en bout sans intervention humaine.
- Non spécifiés par le GDD : résolution et budget mémoire. Ils sont fixés dans la section « Performances » (DPR plafonné à 2 et adaptatif, ≤ 300 Mo).

### Facteurs de complexité

**Haute complexité :**
- Le temps : fenêtres en ms qui doivent rester justes avec hitstop, ralentis ×0,2/×0,3, pause, calibration et fenêtres réduites par la fatigue.
- La latence d'entrée sur le web mobile, en particulier l'audio sur iOS.
- La jouabilité automatisée de bout en bout.

**Concepts nouveaux (sans pattern standard) :**
- **L'absence d'action comme réponse :** « Attendre » et « Ne rien faire » s'évaluent sur ce que le joueur ne fait *pas*, et uniquement sur la menace visée.
- **Le silence comme télégraphe :** réagir à l'absence d'un signal, doublée en visuel et en haptique.
- **Un tap, plusieurs intentions :** déplacement, réponse à une menace ou interaction avec un objet. Hit-test en iso, puis glissade automatique avant la réponse.
- **Le replay des meilleurs moments** et la photo de fin figée.
- **La mémoire de Maman** d'une partie à l'autre.

### Risques techniques

1. La parade au tap sur mobile, hypothèse n°1 du prototype : latence et précision du hit-test.
2. La latence de Web Audio dans la WebView iOS.
3. Le déterminisme de Rapier face au replay et à la reprise exacte.
4. Tenir 60 FPS avec toon et contours sur mobile milieu de gamme, en WebView.
5. Ambiguïté du GDD : un relâchement entre 0,2 et 0,4 s n'est défini ni comme Parer ni comme Fermeté Tranché : ADR-010.
6. Les fenêtres en ms se mesurent-elles en temps de jeu (ralenti compris) ou en temps réel ? Tranché : en temps de jeu (ADR-002).

## Moteur et framework

### Moteur retenu

**Three.js r186 (`three@0.186.1`)** avec **Vite 8.3** et **TypeScript 7.0**. Versions vérifiées sur le registre npm le 2026-10-26.

**Justification :** c'est la stack que les LLM maîtrisent le mieux. Tout est du code, sans éditeur obligatoire, ce qui sert la règle d'or (l'IA écrit et teste, Geo règle le feeling). Elle est native web, donc le playtest se fait par lien, et elle s'emballe telle quelle dans Capacitor. Elle laisse un contrôle total de la boucle, du temps et des entrées, indispensable pour des fenêtres en ms et ≤ 50 ms tap → visuel. Enfin, elle permet une logique en TypeScript pur, exécutable dans Node. Alternatives écartées : Babylon.js (plus lourd, moins maîtrisé par les LLM) et Godot 4 en export web (logique non testable dans Node, export web lourd, contraire à la règle d'or).

### Initialisation du projet

```bash
# À la racine de papa-parade/ (à côté de _bmad/ et docs/) — choisir « Ignore files and continue »
npm create vite@latest . -- --template vanilla-ts
npm install three @dimforge/rapier3d-deterministic-compat zod
npm install -D typescript@7.0.2 @types/three @types/node vitest @playwright/test @biomejs/biome tweakpane tsx
npx playwright install chromium webkit
git init
```

Aucun starter communautaire : les starters Three.js imposent des structures (React Three Fiber, par exemple) qui gêneraient la séparation simulation / rendu. La première story d'implémentation est l'initialisation du projet avec cette commande.

### Architecture fournie par la stack

| Composant | Solution | Notes |
|---|---|---|
| Rendu 3D | Three.js r186 | Choix WebGL / WebGPU tranché en décisions |
| Chargement d'assets | `GLTFLoader` (.glb) | Compression meshopt ou Draco possible |
| Physique | Rapier 0.21 (WASM), `@dimforge/rapier3d-deterministic-compat` 0.21.0 | Build déterministe (ADR-005) |
| Build et serveur de dev | Vite 8.3 | HMR, build statique déployable partout |
| Typage | TypeScript 7.0 (compilateur natif) | Vite transpile ; `tsc` ne sert qu'au typecheck |
| Tests de logique | Vitest 5.0 | Exécution dans Node |
| Tests de bout en bout | Playwright 1.64 | Chromium et WebKit (proxy Safari iOS) |
| Mobile | Capacitor 8.5 (`@capacitor/core`, `/ios`, `/android`, `/haptics`, `/app`) | Haptique, cycle de vie, paysage |

### Décisions d'architecture restantes

À trancher explicitement, car la stack ne les fournit pas :

1. Boucle de jeu, horloge et échelle de temps (pas fixe, hitstop, ralentis, pause exacte).
2. Séparation simulation / rendu et frontière entre les deux.
3. Modèle d'entités et d'état de la simulation.
4. Entrées : horodatage, classification tap / maintien / swipe, buffer, calibration, ciblage.
5. Place de Rapier : physique cosmétique ou gameplay ; déterminisme et replay.
6. Audio : moteur, latence, musique adaptative, équivalents visuels et haptiques.
7. Format du contenu (menaces, niveaux) et validation par schéma.
8. Fichier de feeling : format, chargement, réglage à chaud.
9. Scènes et états du jeu (menu, calibration, niveau, fin de niveau, replay).
10. UI et HUD (DOM ou WebGL).
11. Rendu : WebGL ou WebGPU, toon et contours, budget de performance.
12. Persistance locale.
13. Mode headless, bot joueur et télémétrie de playtest.
14. Déploiement web et mobile.

## Décisions d'architecture

### Synthèse des décisions

| Catégorie | Décision | Version | Epics | Justification |
|---|---|---|---|---|
| Boucle de jeu | Simulation TS pure à pas fixe de 10 ms (100 Hz), rendu interpolé | — | E1→E8 | Déterministe, ms entières lisibles dans les tests, assez fin pour une fenêtre parfaite de 100 ms |
| Modèle de temps | Deux horloges : `realTime` et `simTime` (× échelle de temps). Fenêtres en temps de jeu ; hitstop = gel en temps réel ; calibration corrigée en temps réel | — | E1, E2, E4 | Le ralenti étire le monde entier, fenêtres comprises ; cohérent avec l'instinct paternel |
| Jugement des entrées | Horodatage exact de l'événement (`event.timeStamp`) converti en `simTime`, indépendant du pas | — | E1, E2 | Fenêtres indépendantes du framerate, conformément au GDD |
| Modèle d'état | `World` en données pures sérialisables, systèmes ordonnés, machines à états explicites | — | Toutes | Pause exacte, snapshot, photo de fin, tests ; lisible pour l'IA |
| Déterminisme et replay | PRNG à graine, journal de commandes, snapshots périodiques ; interdits dans la sim : `Math.random`, `Date`, `performance.now` | — | E1, E3 | Reprise exacte, replay, tests golden, reproduction des bugs |
| Physique | Rapier dans la sim, `@dimforge/rapier3d-deterministic-compat`, derrière `PhysicsPort`, objets seulement | 0.21.0 | E1, E5, E6 | Accidents émergents réels, snapshot natif, tourne dans Node |
| Tap / maintien | Relâché < 400 ms = Parer, ≥ 400 ms = Fermeté (seuils dans `feel.json`) | — | E1, E5, E6 | Comble le trou 0,2–0,4 s du GDD en faveur de l'indulgence |
| Tap et glissade | Réponse jugée à l'appui ; la glissade (≤ 0,6 s) est de la chorégraphie ; retour visuel dès l'appui | — | E1 | ≤ 50 ms tap → visuel, fenêtres de 300 ms compatibles avec 0,6 s de glissade |
| Retours multimodaux | Événements de domaine → `FeedbackDirector` piloté par `feedback.json` ; test de triple équivalence son, visuel, haptique | — | E1, E2, E7 | Pilier 3 garanti par un test ; Geo règle les retours hors code |
| Contenu | JSON validé par schémas Zod (types inférés, validation au chargement et en CI, export JSON Schema) | zod 4.6.7 | Toutes | Source unique pour les types et la validation ; l'IA génère et valide |
| Feeling | `feel.json` unique, surcharges par niveau ; panneau Tweakpane en dev, réglage à chaud, sauvegarde via un plugin Vite | tweakpane 4.0.5 | E1, E2 | Règle d'or : Geo règle sans toucher à la logique |
| Rendu | `WebGLRenderer`, `MeshToonMaterial` (rampe 3 tons), contours inverted hull, pas de post-process lourd, DPR plafonné et adaptatif | three 0.186.1 | E1, E7 | Fiable en WebView mobile, 60 FPS ; WebGPU réévalué en E7 |
| Audio | Web Audio maison : bus musique / sfx / voix / UI, buffers pré-décodés, stems synchronisés, déverrouillage au premier tap | API native | E1, E2, E4 | Maîtrise de la latence et de la synchro ; Howler n'est plus maintenu |
| UI et HUD | DOM superposé en vanilla TS + CSS ; éléments ancrés au monde via `CSS2DRenderer` | addon three | E1, E2, E3 | Lisible par Playwright, facile à écrire pour l'IA, sans framework |
| Pipeline d'assets | Blender 5.2 LTS (greybox dès E1, via Blender MCP) → `.glb` avec convention `COL_` / `NAV_` / `ANCHOR_` ; optimisation gltfpack | Blender 5.2.3, gltfpack 1.3.0 | E1, E7 | Le pipeline est validé tôt ; les niveaux JSON référencent les ancres par nom |
| Chargement | Par niveau : préchargement complet avant le début du niveau | — | E1, E6 | Aucun accroc en jeu ; < 5 s en 4G |
| IA du bébé | `WaveDirector` (JSON du niveau) + FSM du bébé | — | E1, E4, E6 | Rythme des vagues contrôlé par les données |
| Navigation | Grille 2D + A* sur le plan du sol, cuite depuis les `NAV_` du `.glb` | — | E1 | Simple et suffisant pour une pièce |
| Automatisation | CLI Node `sim` (headless, graine, bots) + `?autoplay=` dans le navigateur + `window.__PP__` pour Playwright | vitest 5.0.5, @playwright/test 1.64.1 | Toutes | Jouable de bout en bout sans humain ; équilibrage en masse |
| Persistance | `StoragePort` : localStorage (web), `@capacitor/preferences` (natif) ; JSON versionné avec migrations | @capacitor/preferences 8.0.1 | E2, E3 | Petit volume ; repli sûr si les données sont corrompues |
| Hébergement | Build statique (Cloudflare Pages ou Netlify, choisi au premier déploiement) | vite 8.3.5 | E1 | Playtest par lien, zéro backend |
| Télémétrie | Journal de partie JSON anonyme, téléchargeable ou copiable par le testeur | — | E1 | Mesure des 5 indicateurs de E1 sans donnée personnelle |
| Mobile | Capacitor (`core`, `ios`, `android`, `haptics`, `app`) | 8.5.3 | E8 (haptique dès E2) | Décision du decision log |
| Différé | Modèle économique (avant E8) ; WebGPU (E7) | — | E7, E8 | Hors scope du prototype |

Versions vérifiées sur le registre npm le 2026-10-26.

### Boucle de jeu et modèle de temps

**Approche :** pas fixe à accumulateur, découplé du rendu.

- La boucle `requestAnimationFrame` du client mesure le temps réel écoulé et l'ajoute à un accumulateur. Elle exécute `sim.step()` autant de fois que nécessaire, par pas de `STEP_MS = 10` en temps de jeu, avec au plus 10 pas par frame (spirale de la mort évitée). Elle rend ensuite avec un facteur d'interpolation `alpha`.
- **Échelle de temps :** `timeScale` est un état de la sim (ralenti parfait ×0,3, dernière menace ×0,2, instinct ×0,8). Chaque pas de sim vaut toujours 10 ms de `simTime` ; c'est le nombre de pas exécutés par seconde réelle qui varie. Avec `timeScale = 0,3`, il y a 30 pas par seconde réelle.
- **Hitstop :** c'est un gel. La sim décide du hitstop et expose `freezeRealMs` (80 ms, depuis `feel.json`). La boucle client consomme ce gel en temps réel : aucun pas n'est exécuté et le rendu continue, avec tremblement et particules. En headless, le gel est sans effet, car aucun temps de jeu ne s'écoule pendant un gel. La sim ne lit jamais le temps réel.
- **Pause :** la boucle arrête d'exécuter des pas. Au retour, un décompte de 3 s en temps réel précède la reprise. L'état de la sim n'a pas bougé, d'où une reprise exacte.
- **Correspondance des temps :** le client tient un historique circulaire de paires `(realTime, simTime)` mis à jour à chaque pas. Une entrée horodatée en temps réel est d'abord corrigée de la latence calibrée, puis convertie en `simTime` par interpolation dans cet historique.

### Chaîne d'entrées

1. **Capture** : Pointer Events sur le canvas, clavier, et API Gamepad interrogée à chaque frame. Chaque entrée est horodatée avec `event.timeStamp`, qui partage la base de temps de `performance.now()`.
2. **Mapping** (client, `InputMapper`) : la position écran est projetée sur le plan du sol par la caméra. Le hit-test donne la priorité aux menaces, puis aux objets interactifs, puis au sol, avec un rayon tactile généreux en px écran fixé dans `feel.json`. Au clavier et à la manette, la menace la plus urgente dans la direction visée est ciblée automatiquement.
3. **Commandes** : le client envoie à la sim des commandes typées et horodatées en `simTime` : `PressThreat{threatId, t}`, `Release{t}`, `TapFloor{x, z, t}`, `TapObject{objectId, t}`, `Swipe{dir, t}`. La sim ne voit jamais d'événement brut. Les bots produisent directement ces commandes.
4. **Jugement** (sim) : la réponse est jugée sur `t` de l'appui. Le type de réponse se décide au relâchement, ou à 400 ms de maintien : en dessous de `holdMinMs` (400), c'est Parer ; au-delà, Fermeté. Le buffer d'entrée (100 ms) accepte un appui légèrement antérieur à l'ouverture de la fenêtre. « Attendre » et « Ne rien faire » sont jugés par les machines à états des menaces, sur l'absence de commande visant la menace pendant la période requise.
5. **Fenêtre effective** = base × palier de difficulté × modificateur de fatigue × modificateur d'instinct, puis ± tolérance cachée. Cet ordre est fixe ; il est défini et testé dans `sim/timing`.

### Modèle d'état

**Approche :** des données pures et des systèmes, sans bibliothèque ECS.

- `World` est un objet sérialisable : ni classes, ni fonctions, ni références Three.js. Il contient `time`, `rng`, `papa`, `baby`, `threats[]`, `props[]`, `gauges`, `director`, `score` et `flow`.
- Les systèmes sont des fonctions `(world, ctx) => void`, exécutées dans un ordre fixe à chaque pas : commandes → timing → director → IA du bébé → menaces → déplacement de papa → physique → jauges → instinct → score → flux. Ils émettent des événements dans `ctx.events`.
- Les menaces, le bébé et le flux du niveau sont des machines à états explicites : un `state` en chaîne littérale et un `enteredAt` en `simTime`.
- La physique Rapier vit à côté du `World`, dans `PhysicsPort`. Son snapshot binaire (`world.takeSnapshot()`) est joint au snapshot du `World`.

### Déterminisme, journal et replay

- La sim tire tout son hasard d'un PRNG à graine (mulberry32 ou sfc32) stocké dans `World`.
- **Journal de partie :** la graine, la version du contenu, le hash de `feel.json` et la liste horodatée des commandes. Rejouer le journal reproduit la partie à l'identique sur la même plateforme.
- **Snapshots :** un snapshot du `World` et de Rapier toutes les 5 s de `simTime`. Le replay des meilleurs moments repart du snapshot qui précède le moment, puis rejoue les commandes. La photo de fin est le snapshot final, rendu sans simulation.
- **Tests golden :** un journal de référence est rejoué dans Vitest, et l'on compare le hash de l'état final et la séquence d'événements.

### Physique

- `@dimforge/rapier3d-deterministic-compat` 0.21.0, initialisé une fois (WASM embarqué en base64, compatible Node et WebView).
- Rapier ne gère que les objets libres (props), qui tombent, roulent et rebondissent. Papa et le bébé sont des personnages cinématiques posés sur la grille du sol, sans corps dynamique.
- Les colliders des meubles proviennent des nœuds `COL_` du `.glb`, extraits au build vers le JSON du niveau. La sim n'a donc jamais besoin de charger le `.glb`.
- Les conséquences de gameplay (bruit, bazar, casse) sont tirées des événements de contact Rapier, filtrés par seuil d'impulsion.

### Retours multimodaux

- La sim émet des événements de domaine typés, comme `ThreatTelegraphed`, `WindowOpened`, `ResponseResolved{quality: perfect | success | fail}`, `GagTriggered`, `SilenceStarted`, `NoiseChanged` ou `MamaWoke`.
- Le client relaie ces événements au `FeedbackDirector`, qui consulte `content/feedback.json` : à chaque événement correspondent des `audio`, `visual`, `haptic` et `camera` (facultatif).
- **Règle vérifiée par un test :** toute entrée qui a un `audio` a aussi un `visual` et un `haptic`.
- Les effets qui changent le temps (hitstop, ralentis) ne passent pas par le `FeedbackDirector`. Ils sont décidés dans la sim, à partir de `feel.json`.

### Contenu et feeling

- Le contenu vit dans `content/`, en JSON, avec un schéma Zod par type : `threats/`, `levels/`, `disruptions/`, `feedback.json`, `mama-lines.json`, `feel.json`.
- Les schémas se trouvent dans `src/content/schemas/` et produisent à la fois les types TS (`z.infer`) et des fichiers JSON Schema (`z.toJSONSchema`), générés dans `content/_schemas/` pour l'autocomplétion.
- **Validation :** `npm run content:check` en CI, et au chargement en dev (erreur affichée à l'écran).
- `feel.json` contient toutes les valeurs chiffrées du GDD : fenêtres, tolérance, buffer, hitstop, ralentis, seuils tap / maintien, glissade, jauges, instinct, paliers de difficulté, note de Maman. Un niveau peut surcharger des clés via `feelOverrides`.
- **Panneau de feeling :** Tweakpane 4, généré à partir du schéma de `feel.json`. Il est disponible avec l'overlay de debug (en dev et avec `?debug=1`). Les valeurs s'appliquent à chaud à la sim en cours via la commande `SetFeel` (P6). Le bouton « Enregistrer » n'existe qu'en dev : il envoie un POST au plugin Vite `feel-writer`, qui écrit `content/feel.json`. Le panneau est absent des builds stores.

### Gestion des assets

- **Stratégie de chargement :** par niveau, avec préchargement complet (modèles `.glb`, buffers audio décodés) derrière un écran de chargement, puis aucun chargement pendant le jeu.
- **Pipeline :** fichier `.blend` → script d'export (exécuté via Blender MCP ou `blender -b -P tools/blender/export.py`) → `.glb` → gltfpack (meshopt) → `public/assets/`. Une étape `assets:extract` lit les nœuds `COL_`, `NAV_` et `ANCHOR_` et produit les données de niveau dont la sim a besoin.
- **Prototype :** le salon est bloqué en cubes dans Blender par l'IA via Blender MCP, dès E1.

### IA du bébé et navigation

- Le `WaveDirector` lit les vagues du niveau (menaces activables, simultanéité maximale, perturbations, délais) et choisit la prochaine cible du bébé avec le PRNG.
- La FSM du bébé : `wander` → `babble` → `targetLocked` (télégraphe) → `approach` → `act` ; `mischiefSilent` (silence suspect) ; `carried` (prévu pour E4) ; `gagRecovery`.
- **Navigation :** une grille 2D de 0,25 m, cuite depuis les `NAV_`, et un A* avec lissage. La glissade de papa suit le chemin A* à une vitesse calculée pour arriver en `glideMaxMs` (0,6 s) au plus.

### Automatisation

- **`npm run sim -- --level salon_crawler --seed 42 --bot perfect --runs 1000`** exécute la sim headless dans Node et produit un rapport JSON : score, étoiles, taux de réussite par menace, distribution des jauges.
- **Bots :** `perfect`, `human` (gigue gaussienne et temps de réaction réglables), `random`, `idle`. Ils produisent des commandes, comme le client.
- **Dans le navigateur :** `?autoplay=human&seed=42&speed=4` pour jouer seul, et `window.__PP__`, disponible en dev et en test, pour lire l'état, lire les événements, injecter des commandes, avancer de N pas et figer le temps (captures Playwright stables).

### Persistance

- `StoragePort` avec `get`, `set` et `remove` asynchrones, en JSON. Une implémentation web (localStorage) et une native (`@capacitor/preferences`).
- Une sauvegarde unique `save.v{n}` : calibration, réglages, palier, étoiles par niveau, mémoire de Maman. Les migrations vont de `v{n-1}` à `v{n}`. Une donnée invalide est mise de côté et remplacée par les valeurs par défaut.

### Télémétrie de playtest

- Le journal de partie (voir Déterminisme) est enrichi d'un résumé : réponses par type et par qualité, appareil (tactile, clavier, manette), relances.
- En fin de partie, un bouton « Copier / Télécharger le journal » est proposé. Aucune donnée personnelle, aucun envoi réseau. Le CLI `sim` sait relire ces journaux pour calculer les 5 indicateurs de E1.

### Architecture Decision Records

- **ADR-001 — Simulation TS pure, découplée du rendu.** *Contexte :* la règle d'or impose une logique testable et jouable sans humain. *Décision :* `src/sim` n'importe ni `three`, ni le DOM, ni `@capacitor/*`. *Conséquences :* la sim tourne dans Node (tests, bots, équilibrage) ; le client n'est qu'un adaptateur.
- **ADR-002 — Pas fixe 10 ms, deux horloges, fenêtres en temps de jeu.** *Contexte :* des fenêtres en ms indépendantes du framerate, avec ralentis, hitstop et pause exacte. *Décision :* voir « Boucle de jeu et modèle de temps ». *Conséquences :* le ralenti est généreux pour le joueur ; la calibration se convertit via l'historique `(realTime, simTime)`.
- **ADR-003 — Jugement à l'horodatage de l'appui.** *Contexte :* une glissade de 0,6 s face à une fenêtre de 300 ms, et ≤ 50 ms tap → visuel. *Décision :* la réponse est jugée sur `event.timeStamp` corrigé ; la glissade est cosmétique. *Conséquences :* le résultat est connu avant l'arrivée de papa ; le rendu doit enchaîner glissade et animation sans contredire le résultat.
- **ADR-004 — Déterminisme et journal de commandes.** *Décision :* PRNG à graine, Rapier deterministic, commandes journalisées, snapshots toutes les 5 s. *Conséquences :* replay, tests golden et reproduction des bugs sont gratuits ; tout accès à `Math.random`, `Date` ou `performance.now` dans `src/sim` est interdit par lint.
- **ADR-005 — Rapier dans la sim, objets seulement.** *Décision :* `rapier3d-deterministic-compat` derrière `PhysicsPort` ; personnages cinématiques. *Conséquences :* des accidents émergents qui comptent pour le score ; un coût CPU un peu plus élevé que la build optimisée, acceptable pour une dizaine d'objets.
- **ADR-006 — Retours pilotés par les données, avec triple équivalence testée.** *Décision :* `feedback.json` est lu par le `FeedbackDirector`. *Conséquences :* le pilier 3 est garanti par un test, et Geo règle les retours hors code.
- **ADR-007 — Contenu et feeling en JSON, validés par Zod, réglables à chaud.** *Conséquences :* une source unique pour les types et la validation ; le panneau dev écrit `feel.json`.
- **ADR-008 — WebGL, toon et contours inverted hull, UI en DOM.** *Conséquences :* priorité aux 60 FPS sur mobile et à la testabilité ; WebGPU réévalué en E7.
- **ADR-009 — Blender greybox dès E1, conventions de nommage, données extraites au build.** *Conséquences :* la sim ne lit jamais de `.glb` ; le pipeline est validé dès le prototype.
- **ADR-010 — Relâché < 400 ms = Parer.** *Contexte :* le GDD ne définit pas la zone 0,2–0,4 s. *Décision :* un seuil unique `holdMinMs` = 400 ; `tapMaxMs` est conservé pour d'éventuels usages futurs. *Conséquences :* plus indulgent sur mobile ; à valider au playtest.

## Préoccupations transverses

Ces patterns s'appliquent à **tous** les systèmes. Toute implémentation doit les suivre.

### Gestion des erreurs

**Stratégie :** hybride, selon la nature de l'erreur.

| Nature | Traitement | Visible du joueur |
|---|---|---|
| Contenu invalide (JSON non conforme au schéma) | Échec immédiat : refus du build en CI (`content:check`), écran d'erreur détaillé en dev | Jamais en prod : le build est refusé avant |
| I/O (chargement d'asset, stockage, déverrouillage audio, haptique) | Retour d'un `Result<T, E>` ; l'appelant choisit un repli | Non, sauf échec de chargement d'un niveau : écran « Oups » et bouton Réessayer |
| Invariant de la sim violé (jauge hors bornes, état de FSM inconnu) | `invariant()` / `clampInvariant(ctx, …)` lèvent une erreur en dev et en test ; en prod, la valeur est bornée, la sim émet `InvariantViolated` (logué en `warn` par le client) et la partie continue | Jamais : on ne plante pas en plein niveau |
| Erreur inattendue (exception non capturée) | Handler global (`error`, `unhandledrejection`) : log `error` + écran « Oups » + relance du niveau | Oui, sur un ton léger |

**Règles :**
- Pas de `try/catch` dans `src/sim`. La sim est pure : si elle lève une erreur, c'est un bug à corriger.
- Pas d'échec silencieux : tout repli émet au moins un `warn`.
- `Result` est un type maison minimal (`{ ok: true, value } | { ok: false, error }`), sans bibliothèque.

**Exemple :**

```ts
// src/shared/result.ts
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

// src/client/assets/loadLevelAssets.ts — I/O : Result
export async function loadLevelAssets(id: LevelId): Promise<Result<LevelAssets>> {
  const res = await fetchGlb(`assets/levels/${id}.glb`);
  if (!res.ok) {
    log.warn('assets', 'glb load failed', { id, error: res.error });
    return res;
  }
  return { ok: true, value: buildLevelAssets(res.value) };
}

// src/sim/gauges/noise.ts — invariant dans la sim
world.gauges.noise = clampInvariant(ctx, world.gauges.noise + delta, 0, 100, 'gauges.noise');
// clampInvariant : lève une erreur en dev/test ; en prod, borne la valeur et émet l'événement
// InvariantViolated{name, value}, que le client logue en warn (la sim ne logue jamais)
```

### Logs

**Format :** objets structurés, `log.<niveau>(canal, message, data?)`.
**Destinations :** la console en dev ; une mémoire tampon circulaire des 200 dernières entrées `info` et plus, jointe au journal de partie exporté.

**Niveaux :**
- `error` : quelque chose a cassé (handler global, échec de chargement d'un niveau).
- `warn` : un imprévu géré (repli audio, invariant borné en prod, sauvegarde corrompue).
- `info` : les jalons (niveau chargé, calibration terminée, fin de partie).
- `debug` : le diagnostic détaillé, actif seulement en dev ou avec `?debug=1`.

**Canaux :** `boot`, `assets`, `audio`, `input`, `render`, `feedback`, `storage`, `platform`, `debug`, `content`.

**Règles :**
- **La sim ne logue pas.** Elle émet des événements de domaine, et le client peut les loguer sur le canal `sim`.
- Pas de log dans les chemins chauds (boucle de rendu, pas de sim) au-dessus du niveau `debug`, et jamais de concaténation de chaînes coûteuse sans garde `log.enabled('debug')`.
- Jamais de `console.*` direct hors de `src/shared/log.ts` (règle de lint).

**Exemple :**

```ts
import { log } from '@shared/log';
log.info('boot', 'level ready', { levelId: 'salon', loadMs: 2140 });
if (log.enabled('debug')) log.debug('input', 'press mapped', { target: hit.kind, id: hit.id });
```

### Configuration

**Approche :** quatre couches, chacune avec un seul propriétaire.

| Couche | Emplacement | Exemples | Qui la modifie |
|---|---|---|---|
| Constantes | `src/shared/constants.ts` | `STEP_MS = 10`, `MAX_STEPS_PER_FRAME = 10`, `SNAPSHOT_EVERY_MS = 5000` | L'IA, rarement |
| Équilibrage et feeling | `content/feel.json` + `feelOverrides` par niveau | Fenêtres, tolérance, hitstop, ralentis, jauges, paliers, note de Maman | Geo (panneau dev) |
| Réglages du joueur | Sauvegarde (`StoragePort`) | Calibration, palier, volumes, haptique activée | Le joueur |
| Plateforme | `import.meta.env` + détection des capacités | `VITE_TARGET = web \| ios \| android`, `VITE_DEBUG_ALLOWED`, présence du tactile et de l'haptique | Le build |

**Règle :** aucune valeur chiffrée du GDD en dur dans le code. Si une valeur relève du feeling, elle va dans `feel.json`.

### Système d'événements

**Pattern :** deux niveaux typés.

1. **Événements de domaine (sim).** Une union discriminée `SimEvent`. Les systèmes les poussent dans `ctx.events` pendant le pas ; le client lit le tableau **après** chaque pas, puis le vide. C'est synchrone et déterministe, et ces événements sont inclus dans les tests golden.
2. **Événements client.** Un petit émetteur typé (`Emitter<ClientEvents>`) pour l'UI et l'app : `PauseRequested`, `SettingsChanged`, `CalibrationDone`. Il ne doit jamais être utilisé dans `src/sim`.

**Nommage :** PascalCase au passé, avec le sujet en tête : `ThreatTelegraphed`, `WindowOpened`, `ResponseResolved`, `GagTriggered`, `SilenceStarted`, `NoiseChanged`, `MamaWoke`, `LevelEnded`. Le champ discriminant s'appelle `type`, et chaque événement porte `t` (en `simTime`).

**Exemple :**

```ts
// src/sim/events.ts
export type SimEvent =
  | { type: 'ThreatTelegraphed'; t: number; threatId: ThreatInstanceId; kind: ThreatKind }
  | { type: 'ResponseResolved'; t: number; threatId: ThreatInstanceId; response: ResponseKind; quality: 'perfect' | 'success' | 'fail'; reason?: 'early' | 'late' | 'wrongResponse' | 'released' | 'acted'; offsetMs: number }
  | { type: 'InvariantViolated'; t: number; name: string; value: number }
  | { type: 'SilenceStarted'; t: number }
  | { type: 'NoiseChanged'; t: number; value: number; delta: number };

// src/sim/systems/threats.ts
ctx.events.push({ type: 'ThreatTelegraphed', t: world.time.sim, threatId: th.id, kind: th.kind });

// src/client/loop.ts
for (const ev of sim.drainEvents()) feedbackDirector.handle(ev);
```

### Outils de debug

**Outils disponibles (overlay de debug) :**
- FPS, temps de frame (rendu et sim), nombre de draw calls.
- **Timeline de timing :** pour chaque réponse, l'appui (corrigé de la latence) affiché face à la fenêtre standard, la fenêtre parfaite et la tolérance, avec l'écart en ms. C'est l'outil principal pour régler le feeling.
- Inspecteur d'état du `World` (arbre en lecture seule, valeur des jauges, états des FSM).
- Visualisation de la grille de navigation, des colliders, des ancres et du rayon tactile des menaces.
- Contrôle du temps : pause, pas à pas (un pas de sim), forçage de `timeScale`.
- Triches : lancer une menace donnée, régler une jauge, sauter à la fin du niveau, changer la graine.
- Panneau de feeling (Tweakpane), avec la sauvegarde dans `feel.json` (dev uniquement).

**Activation :**
- Toujours en `npm run dev`.
- Sur les builds de playtest : `?debug=1` (le build est fait avec `VITE_DEBUG_ALLOWED=true`). La touche **F1** ou un **appui à 3 doigts** affiche ou masque l'overlay.
- Sur les builds stores : le code de debug est retiré du bundle (`if (import.meta.env.VITE_DEBUG_ALLOWED)` + tree-shaking). L'écriture de `feel.json` n'existe que via le serveur Vite de dev.

## Structure du projet

### Organisation

**Pattern :** des couches au premier niveau (`sim`, `client`, `platform`, `content`, `shared`, `bots`, `debug`), puis des domaines du jeu à l'intérieur (`threats`, `baby`, `papa`, `gauges`, `scoring`…). Il n'y a qu'un seul package npm, avec des alias d'import, et Biome vérifie les frontières entre couches.

**Justification :** la frontière sim / rendu est la décision la plus structurante (ADR-001). La rendre visible dans l'arborescence et la vérifier par lint évite qu'un agent importe `three` dans la sim. Un package unique reste simple pour Vite, Vitest et Capacitor.

### Arborescence

```
papa-parade/
├── _bmad/                         # BMad (existant)
├── _bmad-output/                  # GDD, epics, architecture, stories (existant)
├── docs/                          # GDD v1 PDF (existant)
├── CLAUDE.md                      # Mémoire projet pour l'IA : règles d'or, frontières, commandes, liens vers GDD et architecture
├── package.json
├── tsconfig.json                  # strict, erasableSyntaxOnly, alias @sim, @client…
├── vite.config.ts                 # alias, plugin feel-writer (dev), base relative
├── vitest.config.ts
├── playwright.config.ts           # projets chromium + webkit, viewport paysage mobile
├── biome.json                     # lint + format, overrides de frontières par dossier
├── capacitor.config.ts            # (E8) appId, paysage
├── index.html                     # canvas + racine UI DOM
├── src/
│   ├── main.ts                    # Entrée navigateur : appelle client/boot
│   ├── shared/                    # Zéro dépendance, importable partout
│   │   ├── constants.ts           # STEP_MS, MAX_STEPS_PER_FRAME, SNAPSHOT_EVERY_MS…
│   │   ├── result.ts              # Result<T, E>
│   │   ├── invariant.ts           # invariant(), clampInvariant()
│   │   ├── log.ts                 # Logger à canaux + mémoire tampon
│   │   ├── emitter.ts             # Émetteur typé (client uniquement)
│   │   ├── rng.ts                 # PRNG à graine (sfc32), état sérialisable
│   │   ├── ids.ts                 # Types brandés : ThreatInstanceId, PropId, LevelId…
│   │   └── math/                  # vec2.ts, vec3.ts, geometry.ts, easing.ts
│   ├── content/                   # Schémas Zod + chargement validé (Node et navigateur)
│   │   ├── schemas/               # feel.ts, threat.ts, level.ts, levelGeometry.ts, disruption.ts, feedback.ts, mamaLines.ts, save.ts
│   │   ├── contentBundle.ts       # Type ContentBundle (tout le contenu validé d'un niveau)
│   │   ├── loadContent.ts         # Lecture + validation → Result<ContentBundle>
│   │   └── feelMerge.ts           # feel.json + feelOverrides du niveau → Feel effectif
│   ├── sim/                       # PUR : ni three, ni DOM, ni Capacitor, ni hasard ou horloge globale
│   │   ├── index.ts               # API publique : createSim(), Sim (seul point d'entrée importable)
│   │   ├── world.ts               # Type World + createWorld()
│   │   ├── step.ts                # Ordre des systèmes d'un pas
│   │   ├── commands.ts            # Union SimCommand
│   │   ├── events.ts              # Union SimEvent
│   │   ├── snapshot.ts            # Sérialisation World + snapshot Rapier
│   │   ├── journal.ts             # Journal de partie : enregistrement, relecture
│   │   ├── time/                  # clock.ts, timeScale.ts, hitstop.ts
│   │   ├── timing/                # effectiveWindow.ts, judge.ts, classifyPress.ts
│   │   ├── threats/               # threatFsm.ts, threatSystem.ts, gags.ts
│   │   ├── director/              # waveDirector.ts
│   │   ├── baby/                  # babyFsm.ts, babySystem.ts, babble.ts (silence)
│   │   ├── papa/                  # papaSystem.ts, glide.ts, coffee.ts
│   │   ├── nav/                   # navGrid.ts, astar.ts, smoothPath.ts
│   │   ├── physics/               # physicsPort.ts, rapierPhysics.ts (seul importeur de Rapier), propsSystem.ts
│   │   ├── gauges/                # fatigue.ts, noise.ts
│   │   ├── disruptions/           # phone.ts
│   │   ├── assist/                # paternalInstinct.ts
│   │   ├── scoring/               # mamaScore.ts, stars.ts, mamaMemory.ts
│   │   ├── flow/                  # levelFlow.ts : intro → vagues → porte → rush final → photo → résultat
│   │   └── sequences/             # (E4+) lullabyWalk.ts, bedtimeDuel.ts, diaperBoss.ts… : séquences spéciales
│   ├── bots/                      # Joueurs automatiques : lisent World, produisent des SimCommand
│   │   ├── bot.ts                 # Interface Bot
│   │   └── perfectBot.ts, humanBot.ts, randomBot.ts, idleBot.ts
│   ├── platform/                  # Adaptateurs web / natif derrière une interface unique
│   │   ├── platform.ts            # Interface Platform : storage, haptics, lifecycle, capabilities
│   │   ├── createPlatform.ts      # Choix web / natif selon VITE_TARGET
│   │   ├── web/                   # webStorage.ts, webHaptics.ts (navigator.vibrate), webLifecycle.ts
│   │   └── native/                # capStorage.ts, capHaptics.ts, capLifecycle.ts
│   ├── client/                    # Navigateur : boucle, rendu, audio, entrées, UI
│   │   ├── boot.ts                # Assemble platform, contenu, sim, rendu, audio, UI
│   │   ├── loop.ts                # rAF, accumulateur, interpolation, drain des SimEvent
│   │   ├── timeMap.ts             # Historique (realTime, simTime) et conversion
│   │   ├── app/                   # appFsm.ts : boot → calibration → menu → niveau → résultat ; pauseController.ts
│   │   ├── input/                 # pointerInput.ts, keyboardInput.ts, gamepadInput.ts, inputMapper.ts, hitTest.ts, autoTarget.ts, calibration.ts
│   │   ├── render/                # renderer.ts, isoCamera.ts, cameraFx.ts, levelScene.ts, interpolate.ts
│   │   │   ├── views/             # papaView.ts, babyView.ts, threatView.ts, propView.ts
│   │   │   ├── materials/         # toonMaterial.ts, outlineHull.ts, palette.ts
│   │   │   └── vfx/               # particles.ts, screenShake.ts
│   │   ├── audio/                 # audioEngine.ts, buses.ts, adaptiveMusic.ts, audioUnlock.ts
│   │   ├── feedback/              # feedbackDirector.ts, visualCues.ts, hapticCues.ts
│   │   ├── ui/
│   │   │   ├── hud/               # gaugesHud.ts, timerHud.ts, pauseButton.ts
│   │   │   ├── world/             # verbLabel.ts, threatIcon.ts, silenceBubble.ts (CSS2DRenderer)
│   │   │   ├── screens/           # loadingScreen.ts, menuScreen.ts, calibrationScreen.ts, pauseScreen.ts, resultScreen.ts, oopsScreen.ts
│   │   │   └── styles/            # ui.css, tokens.css
│   │   ├── endOfLevel/            # photo.ts, highlights.ts (replay des meilleurs moments)
│   │   ├── save/                  # saveStore.ts, migrations.ts
│   │   ├── telemetry/             # sessionLog.ts, exportLog.ts
│   │   └── assets/                # loadLevelAssets.ts, gltf.ts, audioAssets.ts
│   └── debug/                     # Dev et ?debug=1 uniquement, chargé par import() dynamique
│       ├── overlay.ts, perfPanel.ts, timingTimeline.ts, stateInspector.ts
│       ├── navDebugView.ts, feelPanel.ts, cheats.ts
│       └── testApi.ts             # window.__PP__ pour Playwright et l'IA
├── content/                       # Données éditables hors code (JSON)
│   ├── feel.json
│   ├── feedback.json
│   ├── mama-lines.json
│   ├── threats/                   # outlet.json, stairs.json, coffee_table_object.json, silence_mischief.json
│   ├── disruptions/               # phone.json (E6 : dog.json, pot.json)
│   ├── levels/                    # salon_crawler.json (rédigé) + salon_crawler.geometry.json (généré depuis le .glb)
│   ├── sequences/                 # (E4+) définitions des séquences spéciales
│   ├── cries/                     # (E5) pleurs typés et remèdes
│   ├── objects/                   # (E6) objets et valeur de coolitude
│   ├── children/                  # (E6) paramètres de l'enfant par âge
│   ├── music/                     # (E7) stems et règles de musique adaptative
│   └── _schemas/                  # JSON Schema générés (ne pas éditer)
├── assets-src/                    # Sources non servies
│   ├── blender/                   # salon_crawler.blend
│   └── audio/                     # Sources .wav
├── public/
│   └── assets/
│       ├── levels/                # salon_crawler.glb (optimisé gltfpack)
│       ├── characters/            # (E7) papa.glb, baby.glb, mama.glb, dog.glb
│       └── audio/                 # sfx/, music/, voice/ (.m4a AAC)
├── tools/                         # Scripts Node et Blender (jamais embarqués dans le jeu)
│   ├── blender/                   # export_level.py (export glTF + vérif des conventions)
│   ├── assets/                    # extractLevelGeometry.ts (.glb → *.geometry.json), optimizeGlb.ts
│   ├── content/                   # checkContent.ts, emitSchemas.ts
│   ├── sim/                       # runSim.ts (CLI headless), playtestMetrics.ts (5 indicateurs E1)
│   └── vite/                      # feelWriterPlugin.ts
├── tests/
│   ├── architecture/              # simPurity.test.ts, layerBoundaries.test.ts, feedbackEquivalence.test.ts
│   ├── golden/                    # journals/*.json + golden.test.ts
│   └── e2e/                       # boot.spec.ts, autoplay.spec.ts, pauseResume.spec.ts, visual.spec.ts
├── ios/  android/                 # (E8) générés par Capacitor
└── dist/                          # Build (ignoré par git)
```

Les tests unitaires sont colocalisés : `src/sim/timing/judge.test.ts` est à côté de `judge.ts`.

### Correspondance systèmes → emplacements

| Système | Emplacement | Responsabilité |
|---|---|---|
| Horloge, échelle de temps, hitstop | `src/sim/time/` | `simTime`, `timeScale`, gel en temps réel |
| Correspondance temps réel → temps de jeu | `src/client/timeMap.ts` | Conversion des horodatages d'entrée |
| Boucle | `src/client/loop.ts` | Accumulateur, pas fixes, interpolation, drain des événements |
| Fenêtres et jugement | `src/sim/timing/` | Fenêtre effective, jugement, classification Parer / Fermeté |
| Menaces | `src/sim/threats/` | FSM télégraphe → fenêtre → résolution, gags |
| Vagues | `src/sim/director/` | Planification des menaces et des perturbations |
| Bébé | `src/sim/baby/` | FSM, regard, babillage, silence suspect |
| Papa, glissade, café | `src/sim/papa/` | Déplacement, glissade freeflow, interactions |
| Navigation | `src/sim/nav/` | Grille 2D, A*, lissage |
| Physique | `src/sim/physics/` | `PhysicsPort`, Rapier, contacts → bruit et bazar |
| Jauges | `src/sim/gauges/` | Fatigue, bruit (envie pressante en E-suivantes) |
| Perturbations | `src/sim/disruptions/` | Téléphone |
| Instinct paternel | `src/sim/assist/` | Déclenchement, effets, recharge |
| Note de Maman | `src/sim/scoring/` | Score, étoiles, mémoire des parties |
| Flux du niveau | `src/sim/flow/` | Vagues, porte, rush final, photo, résultat |
| Snapshot, journal | `src/sim/snapshot.ts`, `src/sim/journal.ts` | Pause exacte, replay, tests golden |
| Flux de l'app | `src/client/app/` | Boot, calibration, menu, niveau, résultat, pause |
| Entrées | `src/client/input/` | Capture, hit-test, ciblage auto, calibration → `SimCommand` |
| Rendu | `src/client/render/` | Scène iso, vues, toon, contours, caméra, VFX |
| Audio | `src/client/audio/` | Moteur Web Audio, bus, musique adaptative |
| Retours multimodaux | `src/client/feedback/` | `SimEvent` → son + visuel + haptique + caméra |
| UI et HUD | `src/client/ui/` | DOM : HUD, éléments ancrés au monde, écrans |
| Photo et replay | `src/client/endOfLevel/` | Rendu du snapshot final, meilleurs moments |
| Sauvegarde | `src/client/save/` + `src/platform/*/…Storage.ts` | Sauvegarde versionnée, migrations |
| Télémétrie | `src/client/telemetry/` | Journal de partie exportable |
| Plateforme | `src/platform/` | Web / Capacitor : stockage, haptique, cycle de vie |
| Contenu | `src/content/` + `content/` | Schémas, chargement, validation, fusion du feeling |
| Bots | `src/bots/` | Joueurs automatiques |
| Debug | `src/debug/` | Overlay, timeline, panneau de feeling, triches, `window.__PP__` |
| Outils | `tools/` | Export Blender, extraction de géométrie, CLI sim, vérification du contenu |

### Conventions de nommage

#### Fichiers
- **TypeScript :** `camelCase.ts`, nommé d'après l'export principal (`waveDirector.ts` exporte `createWaveDirector`).
- **Tests :** unitaires `*.test.ts` colocalisés ; e2e `tests/e2e/*.spec.ts`.
- **Dossiers :** minuscules, un mot si possible (`threats`, `endOfLevel`).
- **Contenu JSON :** le nom de fichier est l'identifiant (`content/threats/outlet.json` ↔ `"id": "outlet"`). Les fichiers transverses sont en kebab-case (`mama-lines.json`). Les fichiers générés portent le suffixe `.geometry.json`.
- **CSS :** classes en kebab-case préfixées `pp-` (`pp-hud-gauge`).

#### Éléments de code

| Élément | Convention | Exemple |
|---|---|---|
| Types, interfaces | PascalCase, sans préfixe `I` | `World`, `ThreatInstance`, `Feel` |
| Fonctions, variables | camelCase | `judgePress`, `effectiveWindowMs` |
| Fabriques | `create` + nom | `createSim`, `createWaveDirector` |
| Booléens | `is`, `has` ou `can` | `isCarried`, `hasPerfect` |
| Constantes | UPPER_SNAKE (dans `constants.ts`) | `STEP_MS` |
| États de FSM | union de littéraux en camelCase, jamais d'`enum` | `'telegraph' \| 'windowOpen' \| 'resolved'` |
| Événements de domaine | PascalCase au passé | `ThreatTelegraphed`, `ResponseResolved` |
| Commandes | PascalCase à l'impératif | `PressThreat`, `Release`, `TapFloor` |
| Durées | suffixe d'unité obligatoire | `windowMs`, `glideMaxMs`, `delayMs` |
| Instants | `t` ou suffixe `At` en temps de jeu, `AtReal` en temps réel | `enteredAt`, `pressedAtReal` |
| Autres unités | suffixe d'unité | `noisePct`, `speedMps`, `fatiguePerSec` |
| Identifiants de contenu | lower_snake_case | `outlet`, `coffee_table_object`, `salon_crawler` |
| Clés JSON | camelCase | `"telegraphDelayMs": 1200` |

TypeScript est en mode `erasableSyntaxOnly` : ni `enum`, ni `namespace`, ni propriétés de paramètres de constructeur. Les scripts Node (`tools/`) passent par `tsx`, qui résout les alias de `tsconfig.json` (`tsx tools/sim/runSim.ts`). Vitest et Vite résolvent ces mêmes alias via `vite.config.ts`.

#### Assets de jeu

**Blender (`.blend` → `.glb`) :**
- Collections : `level` (visuel), `colliders`, `nav`, `anchors`, `props`.
- `COL_<nom>` : collider statique (boîte ou convexe), invisible en jeu. Exemple : `COL_sofa`.
- `NAV_floor` : la surface marchable ; `NAV_block_<nom>` : une zone non marchable. Exemple : `NAV_block_coffee_table`.
- `ANCHOR_<anchorId>` : un point nommé référencé par le JSON du niveau. Exemple : `ANCHOR_outlet_01`, `ANCHOR_stairs_top`, `ANCHOR_door`, `ANCHOR_papa_spawn`.
- `PROP_<propKind>_<nn>` : un objet dynamique Rapier. Exemple : `PROP_mug_01`.
- `ZONE_<kind>_<nom>` : un volume de gameplay. `ZONE_hidden_<nom>` marque une zone hors du champ de vision (silence suspect), `ZONE_safe_<nom>` une zone de dépose en lieu sûr (E4), `ZONE_creak_<nom>` une latte qui grince (E4). Exemple : `ZONE_hidden_behind_sofa`.
- Les maillages visuels n'ont pas de préfixe. Les noms sont en lower_snake_case après le préfixe. Unités : mètres, Y vers le haut à l'export glTF.

**Audio (`public/assets/audio/`) :** `<catégorie>_<nom>.m4a`. Catégories : `tel` (télégraphe), `resp` (réponse), `gag`, `baby`, `papa`, `env`, `ui`, `music`. Exemples : `tel_outlet_crackle.m4a`, `resp_parry_toy_squeak.m4a`, `baby_laugh_perfect.m4a`, `music_crawler_calm.m4a`.

### Frontières d'architecture

| Couche | Peut importer | Ne doit jamais importer |
|---|---|---|
| `shared` | rien (bibliothèque standard uniquement) | toutes les autres couches |
| `content` | `shared`, `zod` | `sim`, `client`, `platform`, `debug`, `three` |
| `sim` | `shared`, `content` (types et bundle validé passés en paramètre), Rapier (dans `physics/rapierPhysics.ts` uniquement) | `three`, `@capacitor/*`, `client`, `platform`, `debug`, `bots` ; globals `window`, `document`, `performance`, `Date`, `setTimeout`, `requestAnimationFrame`, `localStorage` ; `Math.random` |
| `bots` | `sim` (API publique), `shared` | `client`, `platform`, `three` |
| `platform` | `shared`, `@capacitor/*` | `sim`, `client`, `three` |
| `client` | `sim` (via `@sim` = `src/sim/index.ts` uniquement), `content`, `shared`, `platform` (interface), `three` | `debug` (sauf `boot.ts`, en import dynamique gardé), `bots` (sauf l'autoplay, en import dynamique) |
| `debug` | tout | — (personne ne l'importe statiquement) |
| `tools` | tout, Node uniquement | — (jamais importé par `src/`) |

**Vérifications automatiques :**
- `biome.json` : `noRestrictedImports` par dossier (overrides).
- `tests/architecture/layerBoundaries.test.ts` : un scan des imports qui échoue si une règle du tableau est violée.
- `tests/architecture/simPurity.test.ts` : un scan de `src/sim` (hors fichiers de test) à la recherche de `Math.random`, `Date`, `performance`, `window`, `document`, `three` et `@capacitor`.

## Patterns d'implémentation

Ces patterns garantissent que tous les agents IA implémentent de façon cohérente.

### Patterns nouveaux

#### P1 — Cycle de vie d'une menace (« frame data »)

**Objectif :** toute menace, du prototype à l'âge adulte, est une **donnée** exécutée par une FSM générique. Ajouter une menace, c'est ajouter un JSON (et éventuellement un gag), pas une classe.

**Composants :**
- `content/threats/<id>.json`, validé par `ThreatDefSchema` : la définition.
- `ThreatInstance`, dans `World.threats[]` : l'état courant (`state`, `enteredAt`, `anchorId`, `targetedBy`, `press`).
- `threatSystem.ts` : il fait avancer les FSM à chaque pas et émet les événements.
- `judge.ts` : la fonction pure qui juge une réponse par rapport à une fenêtre.
- `gags.ts` : il applique les conséquences d'un échec (bruit, bazar, presque-accident, dégaine de papa).

**États et transitions :**

```
idle ──(director cible la menace)──▶ targeted ──(bébé à portée)──▶ telegraph
telegraph ──(t ≥ enteredAt + telegraphDelayMs)──▶ windowOpen
windowOpen ──(réponse jugée success | perfect)──▶ resolved
windowOpen ──(fenêtre expirée sans bonne réponse)──▶ gag
telegraph ──(appui trop tôt et earlyPress = 'fail')──▶ gag
resolved | gag ──(cooldownMs écoulé)──▶ idle
```

**Définition (exemple) :**

```json
{
  "id": "outlet",
  "response": "parry",
  "telegraphDelayMs": 1200,
  "windowMs": null,
  "verb": "SOULÈVE !",
  "iconShape": "circle",
  "color": "parryBlue",
  "gag": "outlet_hair",
  "feedback": { "telegraph": "tel_outlet", "success": "resp_parry", "gag": "gag_outlet" },
  "cooldownMs": 6000
}
```

`windowMs: null` signifie « valeur standard de `feel.json` ». Une valeur chiffrée la surcharge pour cette menace.

**Jugement (pur, testé de façon exhaustive) :**

```ts
// src/sim/timing/judge.ts
export type Judgement = { quality: 'perfect' | 'success' | 'early' | 'late'; offsetMs: number };

export function judgePress(pressT: number, windowOpenAt: number, w: EffectiveWindow): Judgement {
  const center = windowOpenAt + w.windowMs / 2;
  const offsetMs = pressT - center;
  if (Math.abs(offsetMs) <= w.perfectMs / 2) return { quality: 'perfect', offsetMs };
  const half = w.windowMs / 2 + w.toleranceMs;
  if (offsetMs < -half - w.bufferMs) return { quality: 'early', offsetMs };
  if (offsetMs > half) return { quality: 'late', offsetMs };
  return { quality: 'success', offsetMs };
}
```

**Cas limites (couverts par des tests) :**
- **Appui trop tôt :** le comportement suit `feel.earlyPress`. Avec `'fail'` (par défaut), c'est un gag. Avec `'guard'`, papa glisse et se met en garde sans jugement, et il faut un nouvel appui dans la fenêtre.
- **Fermeté :** l'appui doit tomber dans la fenêtre et le maintien durer jusqu'à `holdUntilMs` (fin de l'attaque). Un relâchement avant cette échéance est un gag. Le type de réponse (Parer ou Fermeté) se décide au relâchement ou à `holdMinMs`.
- **Mauvaise réponse dans la fenêtre** (par exemple Parer sur une menace qui demande Fermeté) : c'est un gag.
- **Plusieurs menaces actives :** chaque commande vise **une** `threatId`. Le hit-test et le ciblage automatique la choisissent côté client, et la sim ne devine jamais la cible.
- **Papa occupé** (glissade en cours vers une autre menace) : la nouvelle commande est acceptée et jugée sur son horodatage, et la chorégraphie s'enchaîne (P3).
- **Menaces générées par un système :** une menace n'est pas toujours planifiée par le director. Exemple : la micro-sieste de papa, `content/threats/papa_microsleep.json` (`target: "papa"`, `response: "parry"`). Au-dessus du seuil de fatigue (70), `fatigue.ts` crée une instance toutes les 8 à 12 s (PRNG), avec le télégraphe « paupières qui tombent, son cotonneux ». Elle suit la même FSM et le même jugement que toute autre menace.

#### P2 — L'absence comme réponse (« Attendre » et « Ne rien faire »)

**Objectif :** juger ce que le joueur ne fait **pas**, sans faux positifs dus à d'autres actions.

- **« Ne rien faire »** (`response: "nothing"`) : à l'entrée en `windowOpen`, une échéance `resolveAt = t + nothingMs` est fixée (1,5 à 3 s, depuis la définition ou `feel.json`). Toute commande dont la `threatId` vise cette menace avant l'échéance déclenche un gag. Les commandes visant d'autres menaces, le sol ou des objets sont ignorées. Si l'échéance est atteinte sans commande, la réponse est réussie.
- **« Attendre »** (`response: "wait"`) : la menace émet `WaitSignalGiven` à un instant tiré par le PRNG dans `[minDelayMs, maxDelayMs]`, et la fenêtre (300 ms) ne s'ouvre qu'à ce signal. Un appui sur la menace avant le signal est un gag (« trop tôt »), quel que soit `earlyPress`.
- La qualité `perfect` existe aussi pour « Attendre » (centrée sur la fenêtre après le signal). Elle n'existe pas pour « Ne rien faire ».

```ts
// src/sim/threats/threatSystem.ts (extrait)
if (th.def.response === 'nothing' && th.state === 'windowOpen') {
  if (cmdsTargeting(th.id).length > 0) return toGag(th, 'acted');
  if (world.time.sim >= th.resolveAt) return toResolved(th, { quality: 'success', offsetMs: 0 });
}
```

#### P3 — Jugement à l'appui, chorégraphie ensuite

**Objectif :** concilier une fenêtre de 300 ms, une glissade de 0,6 s et un retour visuel en moins de 50 ms.

**Flux des données :**

```
[client] pointerdown (timeStamp) ──▶ inputMapper ──▶ PressThreat{threatId, t}
   │                                                       │
   └─▶ retour visuel immédiat (≤ 1 frame) :                ▼
       surbrillance, papa amorce la glissade     [sim] judgePress → ResponseResolved{quality}
                                                           │  + papa.glide = {to, arriveAt}
                                                           │  + timeScale si parfait
                                                           ▼
[client] feedbackDirector : son de réponse et haptique joués TOUT DE SUITE ;
         l'animation de réponse est mise en file ; papaView la joue à l'arrivée (arriveAt)
```

**Règles :**
- Le **résultat** ne dépend jamais de l'arrivée de papa. L'arrivée ne déclenche que la présentation.
- Le son de réponse et l'haptique partent au jugement (latence minimale). La pose finale (bébé soulevé, cache-prise posé) se joue à l'arrivée.
- Un ralenti parfait démarre au jugement : la glissade se fait au ralenti, comme un plan de film d'action.
- La glissade dure `min(glideMaxMs, distance / glideSpeed)`, sur le chemin A*. Si un gag survient sur une autre menace pendant la glissade, il se joue en parallèle.

#### P4 — Le silence comme télégraphe

**Objectif :** traiter l'**absence** d'un signal comme une alerte multimodale.

- **Dans la sim :** `baby.babbling` est vrai par défaut. La FSM du bébé passe en `mischiefSilent` quand le director choisit une bêtise silencieuse. Le bébé se rend alors dans une `ZONE_hidden_*` et `babbling` passe à `false`.
- Quand `babbling` est faux **et** que le bébé est dans une zone cachée depuis `silenceAlertMs` (2 s, dans `feel.json`), la sim émet `SilenceStarted`. Elle émet `SilenceEnded` quand papa a trouvé le bébé (papa dans la zone ou tap sur le bébé) ; la menace « silence suspect » passe alors en `windowOpen`.
- **Dans le client :** `feedback.json` associe `SilenceStarted` à la coupure de la musique, au retrait du babillage, à l'affichage de la bulle « … » clignotante au bord de l'écran (du côté de la zone) et à une vibration courte.
- **Babillage audio :** le client joue le babillage en boucle tant que `baby.babbling` est vrai. Son arrêt **est** le signal sonore : il faut donc que ce babillage reste audible et continu.

#### P5 — Calibration et correspondance des temps

**Objectif :** des fenêtres justes malgré la latence propre à chaque appareil.

- **Écran de calibration** (premier lancement, puis refaisable dans les réglages) :
  - phase audio : 8 bips à 100 BPM, et le joueur tape en rythme ;
  - phase visuelle : 8 flashs, et le joueur tape en rythme.
- Chaque phase donne la médiane des écarts, bornée à `[-50, 250]` ms, après rejet des valeurs aberrantes (au-delà de ±150 ms de la médiane).
- `save.calibration = { visualOffsetMs, audioOffsetMs, measuredAt, device }`.
- **Application au jugement :** `pressedAtReal − visualOffsetMs`, converti en temps de jeu par `timeMap`. Les séquences rythmiques (E4) utilisent `audioOffsetMs`.

```ts
// src/client/input/inputMapper.ts (extrait)
const correctedReal = ev.timeStamp - calibration.visualOffsetMs;
const t = timeMap.realToSim(correctedReal);   // interpolation dans l'historique (realTime, simTime)
sim.enqueue({ type: 'PressThreat', threatId: hit.id, t });
```

- `timeMap` conserve les 2 dernières secondes de paires `(realTime, simTime)`. Un instant antérieur à cet historique est borné au plus ancien point, avec un `warn`.

#### P6 — Réglage à chaud du feeling, sans casser le déterminisme

**Objectif :** Geo règle pendant qu'il joue, et le journal reste rejouable.

- Le panneau de feeling n'écrit jamais directement dans la sim. Il envoie une commande `SetFeel{patch, t}`, appliquée au pas suivant et **journalisée** comme toute autre commande.
- Le replay et les tests golden rejouent donc les mêmes changements de feeling au même instant.
- **« Enregistrer »** fusionne les valeurs courantes dans `content/feel.json` (plugin Vite), sans toucher aux `feelOverrides` des niveaux.

#### P7 — Moments forts, replay et mémoire de Maman

**Objectif :** une fin de niveau mémorable, sans enregistrer de vidéo.

- **Détection :** `highlights.ts` (client) note chaque `SimEvent` à fort score : réponse parfaite (3), gag avec bazar ≥ 2 objets (2), presque-accident (2), dernière menace d'une vague (1). En fin de niveau, il retient les 3 meilleurs moments, espacés d'au moins 5 s.
- **Replay :** pour un moment à l'instant `t`, on restaure le snapshot qui précède `t − 2 s` (World + Rapier) dans une **sim de replay séparée**, on rejoue les commandes du journal jusqu'à `t + 1,5 s`, et on rend le tout avec une caméra de replay (cadrage serré, bandeau « REPLAY »).
- **Photo de fin :** le snapshot final, rendu sans simulation, avec une caméra et un filtre « photo ».
- **Mémoire de Maman :** `save.mamaMemory = { counts: { [tagId]: number } }`, incrémenté à chaque fin de niveau à partir des tags des gags et des presque-accidents. `mama-lines.json` liste des répliques conditionnelles. La plus spécifique dont la condition est satisfaite l'emporte, avec un tirage par le PRNG en cas d'égalité.

```json
{ "id": "shelf_again", "when": { "tag": "shelf_climb", "minPrevious": 1 }, "reaction": "scream", "text": "*Encore* l'étagère ?!" }
```

### Patterns de communication

**Pattern :** dans la sim, les systèmes ne s'appellent pas entre eux. Ils lisent et écrivent le `World` et émettent des `SimEvent`, dans l'ordre fixe de `step.ts`. Dans le client, les dépendances sont **injectées explicitement** par `boot.ts`, la racine de composition. Il n'y a ni singleton ni service locator ; seule exception, `log`.

**Exemple :**

```ts
// src/sim/step.ts
const SYSTEMS: readonly System[] = [
  applyCommands, advanceTime, runDirector, runBaby, runThreats,
  runPapa, runPhysics, runGauges, runInstinct, runScoring, runFlow,
];
export function step(world: World, ctx: StepContext): void {
  for (const system of SYSTEMS) system(world, ctx);
}

// src/client/boot.ts — racine de composition
const platform = createPlatform(import.meta.env.VITE_TARGET);
const content = unwrap(await loadContent('salon_crawler'));
const sim = await createSim({ content, seed });
const audio = createAudioEngine({ assets: audioAssets });
const feedback = createFeedbackDirector({ table: content.feedback, audio, haptics: platform.haptics, ui });
startLoop({ sim, renderer, feedback, timeMap });
```

### Patterns d'entités

**Création :** des fonctions de fabrique pures dans la sim, et des pools de vues dans le client.

- Sim : `createThreatInstance(def, anchor, id)`. L'identifiant vient de `world.nextId++`, jamais d'un UUID ni d'un compteur global. Les instances sont des objets de données.
- Client : chaque vue (`threatView`, `propView`) est créée par un `ViewRegistry` qui réconcilie les vues avec les entités du `World` à chaque frame. Il crée, met à jour ou recycle depuis un pool. Pas de `new Mesh` dans la boucle de rendu sans pool.

**Exemple :**

```ts
// src/sim/threats/threatSystem.ts
export function createThreatInstance(def: ThreatDef, anchor: Anchor, id: ThreatInstanceId): ThreatInstance {
  return { id, defId: def.id, anchorId: anchor.id, state: 'idle', enteredAt: 0, press: null, resolveAt: null };
}

// src/client/render/views/viewRegistry.ts
registry.sync(world.threats, (th) => th.id, {
  create: (th) => threatViewPool.acquire(th.defId),
  update: (view, th, alpha) => view.update(th, alpha),
  release: (view) => threatViewPool.release(view),
});
```

### Patterns d'état

**Pattern :** des machines à états explicites, en données : `state` est une union de littéraux, `enteredAt` est en temps de jeu, et les transitions passent par une seule fonction qui émet l'événement correspondant.

**Exemple :**

```ts
// src/sim/baby/babyFsm.ts
export type BabyState = 'wander' | 'babble' | 'targetLocked' | 'approach' | 'act' | 'mischiefSilent' | 'carried' | 'gagRecovery';

export function enterBabyState(world: World, ctx: StepContext, next: BabyState): void {
  const prev = world.baby.state;
  if (prev === next) return;
  world.baby.state = next;
  world.baby.enteredAt = world.time.sim;
  ctx.events.push({ type: 'BabyStateChanged', t: world.time.sim, from: prev, to: next });
}
```

**Règles :** on ne change jamais `state` directement : on passe par `enter…State`. On ne teste pas « depuis combien de temps » avec un compteur de frames, mais avec `world.time.sim - enteredAt`. Le flux de l'app (`appFsm`) suit le même pattern côté client.

### Patterns de données

**Accès :** le contenu est chargé **une fois** par `loadContent()` (validation Zod), puis passé explicitement. La sim reçoit un `ContentBundle` à `createSim()` et un `Feel` effectif dans `ctx.feel`. Aucun module n'importe un JSON de `content/` directement, sauf `loadContent`.

**Exemple :**

```ts
// src/sim/gauges/fatigue.ts
export function runFatigue(world: World, ctx: StepContext): void {
  const f = ctx.feel.fatigue;   // { perSec, carriedMultiplier, threshold, windowPenaltyPct, … }
  const rate = f.perSec * (world.papa.carrying ? f.carriedMultiplier : 1);
  world.gauges.fatigue = clampInvariant(ctx, world.gauges.fatigue + rate * (STEP_MS / 1000), 0, 100, 'gauges.fatigue');
}
```

### Règles de cohérence

| Pattern | Convention | Vérification |
|---|---|---|
| Pureté de la sim | Ni `three`, ni DOM, ni `@capacitor`, ni `Math.random`, ni `Date`, ni `performance` dans `src/sim` | Biome + `simPurity.test.ts` |
| Frontières entre couches | Tableau « Frontières d'architecture » | Biome + `layerBoundaries.test.ts` |
| Valeurs du GDD | Jamais en dur, toujours dans `feel.json` ou le contenu | Revue + grep des nombres dans `src/sim` lors du code review |
| Unités | Suffixe obligatoire (`Ms`, `Pct`, `PerSec`, `Mps`) | Revue de code |
| Temps | `simTime` dans la sim ; `AtReal` pour le temps réel côté client | Types brandés `SimMs` / `RealMs` |
| Hasard | Uniquement `world.rng` | `simPurity.test.ts` |
| Transitions d'état | Via `enter…State()`, avec événement émis | Revue + tests de FSM |
| Retours multimodaux | Tout `audio` a un `visual` et un `haptic` | `feedbackEquivalence.test.ts` |
| Contenu | Tout JSON est validé par son schéma | `npm run content:check` en CI |
| Commandes | La sim ne reçoit que des `SimCommand` horodatées ; tout changement d'état externe passe par une commande, y compris `SetFeel` | Types + tests golden |
| Événements | PascalCase au passé, champ `type`, champ `t` | Types (union discriminée) |
| Tests | Toute fonction de `sim/timing` et toute FSM a ses tests unitaires ; toute menace a un test « parfait, réussi, trop tôt, trop tard » généré depuis son JSON | Vitest + couverture de `src/sim` ≥ 90 % |

## Correspondance epics → architecture

| Epic | Fonctionnalité | Emplacement principal | Patterns / ADR |
|---|---|---|---|
| **E1** | Initialisation du projet (Vite, TS 7, Biome, Vitest, Playwright, git, CLAUDE.md) | racine, `tools/`, `tests/architecture/` | Structure, frontières |
| E1 | Boucle, horloge, pas fixe, pause et reprise exactes | `src/client/loop.ts`, `src/sim/time/`, `src/client/app/pauseController.ts` | ADR-002 |
| E1 | Déplacement (tap au sol, clavier, manette) | `src/client/input/`, `src/sim/papa/`, `src/sim/nav/` | Chaîne d'entrées |
| E1 | Bébé (sphère) qui choisit ses cibles | `src/sim/baby/`, `src/sim/director/` | FSM, WaveDirector |
| E1 | 3 menaces (prise, escalier, table basse) : télégraphe, fenêtre, gag | `content/threats/`, `src/sim/threats/`, `src/sim/timing/` | P1, ADR-010 |
| E1 | Téléphone (décrocher ou ignorer) | `content/disruptions/phone.json`, `src/sim/disruptions/phone.ts` | P1 (commande `TapObject`) |
| E1 | Silence suspect | `src/sim/baby/babble.ts`, `ZONE_hidden_*`, `feedback.json` | P4 |
| E1 | Tap sur une menace → glissade → réponse ; ralenti parfait | `src/client/input/inputMapper.ts`, `src/sim/papa/glide.ts`, `src/client/render/views/papaView.ts` | P3, ADR-003 |
| E1 | Fatigue, café, micro-siestes | `src/sim/gauges/fatigue.ts`, `src/sim/papa/coffee.ts`, `content/threats/papa_microsleep.json` | P1 (menace générée par une jauge) |
| E1 | Physique légère (objets qui tombent) | `src/sim/physics/` | ADR-005 |
| E1 | Fin au chrono (3 min), note de Maman sur 5 étoiles | `src/sim/flow/levelFlow.ts`, `src/sim/scoring/` | FSM du flux |
| E1 | Menaces et niveau en données | `content/`, `src/content/schemas/` | ADR-007 |
| E1 | Salon greybox Blender → `.glb` → géométrie extraite | `assets-src/blender/`, `tools/blender/`, `tools/assets/` | ADR-009 |
| E1 | Build web partageable, journal de playtest | `vite.config.ts`, `src/client/telemetry/`, `tools/sim/playtestMetrics.ts` | Déploiement |
| E1 | Jouable sans humain | `src/bots/`, `tools/sim/runSim.ts`, `src/debug/testApi.ts`, `tests/e2e/` | Automatisation |
| **E2** | Fichier de feeling unique + panneau | `content/feel.json`, `src/debug/feelPanel.ts`, `tools/vite/feelWriterPlugin.ts` | P6 |
| E2 | Sons cultes, rire du bébé sur réponse parfaite | `public/assets/audio/`, `src/client/audio/`, `feedback.json` | ADR-006 |
| E2 | Verbe affiché, code couleur + forme | `src/client/ui/world/verbLabel.ts`, `threatIcon.ts` ; `verb`, `iconShape`, `color` dans les ThreatDef | P1 |
| E2 | Haptique, équivalents visuels | `src/platform/*/…Haptics.ts`, `src/client/feedback/` | ADR-006 (test de triple équivalence) |
| E2 | Calibration de la latence | `src/client/input/calibration.ts`, `src/client/ui/screens/calibrationScreen.ts` | P5 |
| E2 | Instinct paternel, mode assistance | `src/sim/assist/paternalInstinct.ts`, `feel.difficultyTiers` | Fenêtre effective |
| **E3 (prototype)** | Jauge de bruit, variante Sieste (réveil anticipé : −1 étoile) | `src/sim/gauges/noise.ts`, `level.variant = 'nap'`, `src/sim/flow/` | Événement `MamaWoke` |
| E3 (v1) | Porte, rush final, photo figée | `src/sim/flow/levelFlow.ts`, `src/client/endOfLevel/photo.ts` | P7 |
| E3 (v1) | Réactions de Maman, étoiles, dégaine de papa | `src/sim/scoring/`, `World.papa.look` | — |
| E3 (v1) | Replay des meilleurs moments | `src/client/endOfLevel/highlights.ts`, `src/sim/snapshot.ts`, `src/sim/journal.ts` | P7, ADR-004 |
| E3 (v1) | Mémoire de Maman, répliques | `src/sim/scoring/mamaMemory.ts`, `content/mama-lines.json`, sauvegarde | P7 |
| E3 (v1) | Variante Retour | `level.variant = 'return'` | — |
| **E4** | Bras-bébé (une main, fatigue doublée) | `World.papa.carrying`, `babyFsm` (`carried`), `classifyPress.ts` (Fermeté interdite) | FSM |
| E4 | 100 pas en rythme (90 → 60 BPM, fenêtre de 180 ms) | `src/sim/sequences/lullabyWalk.ts`, `content/sequences/`, `audioOffsetMs` | P1 généralisé : un « temps » = une fenêtre ; audio planifié depuis le `simTime` |
| E4 | Duel du coucher, faux sommeil | ThreatDef `response: 'wait'` | P2 |
| E4 | Dépose-bombe, sortie en infiltration (lattes, souffle retenu, fausses alertes) | `src/sim/sequences/`, `ZONE_creak_*`, commande `HoldAnywhere` | P1, P2 |
| E4 | Combo à encaisser | `src/sim/scoring/combo.ts`, `ZONE_safe_*` | — |
| **E5** | États cachés (propre, nourri, reposé), odeur, renifler, couche de Schrödinger | `World.baby.needs`, `src/sim/baby/needs.ts` | Données + systèmes |
| E5 | Pleurs typés et remèdes | `content/cries/`, `src/sim/baby/cries.ts` | P1 (menace dont la réponse est un objet remède) |
| E5 | Change de couche (boss), rhabillage, soins | `src/sim/sequences/` + `content/sequences/` | P1 enchaîné (séquence = liste d'attaques) |
| E5 | Vomi en jet (Esquiver) | ThreatDef `response: 'dodge'`, commande `Swipe` | P1 |
| **E6** | Âges suivants (jauge d'attention, provocation, aide invisible, fugue) | `content/levels/`, `src/sim/gauges/attention.ts`, `babyFsm` par âge (`content/children/`) | P1, P2 |
| E6 | Désarmement, coolitude, préparation entre les vagues | `content/objects/` (`coolness`), `src/sim/flow/` (état `prep`) | Données |
| E6 | Chien, casserole | `content/disruptions/` | P1 |
| **E7** | Personnages riggés et animés | `public/assets/characters/`, `AnimationMixer` dans les vues | Patterns d'entités (pools de vues) |
| E7 | Rendu toon final, palette, VFX, célébration | `src/client/render/materials/`, `vfx/` | ADR-008 (réévaluer WebGPU) |
| E7 | Musique adaptative par âge | `src/client/audio/adaptiveMusic.ts`, `content/music/` | — |
| **E8** | Capacitor iOS et Android | `capacitor.config.ts`, `src/platform/native/`, `ios/`, `android/` | Déploiement |

## Architecture des données

| Donnée | Fichier ou emplacement | Schéma | Produit par | Lu par |
|---|---|---|---|---|
| Feeling | `content/feel.json` | `FeelSchema` | Geo (panneau), l'IA | sim (`ctx.feel`), client (rayon tactile, caméra) |
| Définitions des menaces | `content/threats/<id>.json` | `ThreatDefSchema` | L'IA, Geo | sim |
| Perturbations | `content/disruptions/<id>.json` | `DisruptionDefSchema` | L'IA | sim |
| Niveau (gameplay) | `content/levels/<id>.json` | `LevelSchema` | L'IA | sim, client |
| Niveau (géométrie) | `content/levels/<id>.geometry.json` | `LevelGeometrySchema` | `tools/assets/extractLevelGeometry.ts` (généré) | sim (colliders, nav, ancres, zones) |
| Table de retours | `content/feedback.json` | `FeedbackTableSchema` | L'IA, Geo | client |
| Répliques de Maman | `content/mama-lines.json` | `MamaLinesSchema` | L'IA, Geo | sim (sélection), client (affichage) |
| Sauvegarde | `StoragePort`, clé `papa-parade.save` | `SaveSchema` (versionné) | client | client, sim (mémoire de Maman passée à `createSim`) |
| Journal de partie | export manuel en JSON | `JournalSchema` | client | sim (replay), `tools/sim/` |

**Relations :**
- `Level.waves[].threats[]` référence `ThreatDef.id` et `Anchor.id`.
- `Anchor.id` provient des `ANCHOR_*` de la géométrie.
- `ThreatDef.feedback.*` et `DisruptionDef.feedback.*` référencent des clés de `feedback.json`.
- `ThreatDef.gag` référence un identifiant de gag.
- `content:check` vérifie **toutes** ces références croisées, en plus des schémas.

**Exemple de niveau (extrait) :**

```json
{
  "id": "salon_crawler",
  "age": "crawler",
  "variant": "nap",
  "durationMs": 180000,
  "geometry": "salon_crawler.geometry.json",
  "papaSpawn": "papa_spawn",
  "babySpawn": "baby_spawn",
  "waves": [
    { "fromMs": 0,      "maxSimultaneous": 1, "threats": [{ "def": "outlet", "anchor": "outlet_01" }, { "def": "stairs", "anchor": "stairs_top" }] },
    { "fromMs": 60000,  "maxSimultaneous": 2, "threats": [{ "def": "coffee_table_object", "anchor": "coffee_table" }, { "def": "silence_mischief", "anchor": "behind_sofa" }] },
    { "fromMs": 120000, "maxSimultaneous": 3, "disruptions": [{ "def": "phone", "atMs": 125000 }] }
  ],
  "feelOverrides": {}
}
```

## Contrats d'API (internes)

Il n'y a pas d'API réseau. Les contrats sont internes et typés :

```ts
// src/sim/index.ts — seule API publique de la sim
export async function createSim(opts: { content: ContentBundle; seed: number; mamaMemory?: MamaMemory; journal?: Journal }): Promise<Sim>;
export interface Sim {
  enqueue(cmd: SimCommand): void;         // commande horodatée en simTime
  step(): void;                           // un pas de STEP_MS
  drainEvents(): readonly SimEvent[];     // événements du/des derniers pas
  readonly world: Readonly<World>;        // lecture seule (rendu, bots, debug)
  readonly timeScale: number;             // lu par la boucle
  readonly freezeRealMs: number;          // hitstop restant, consommé par la boucle
  snapshot(): SimSnapshot;
  restore(s: SimSnapshot): void;
  journal(): Journal;
}

// src/debug/testApi.ts — window.__PP__ (dev, ?debug=1, Playwright)
interface PPTestApi {
  state(): Readonly<World>;
  events(since?: number): readonly SimEvent[];
  send(cmd: SimCommand): void;
  advance(steps: number): void;            // avance N pas, temps figé ensuite
  freeze(on: boolean): void;               // fige la boucle pour des captures stables
  setFeel(patch: Partial<Feel>): void;     // via la commande SetFeel
  loadLevel(id: LevelId, seed: number): Promise<void>;
}

// src/platform/platform.ts
interface Platform {
  storage: StoragePort;                                         // get / set / remove : Promise<Result<…>>
  haptics: { pulse(kind: 'light' | 'medium' | 'heavy'): void }; // no-op si non supporté
  lifecycle: { onPause(cb: () => void): void; onResume(cb: () => void): void };
  capabilities: { touch: boolean; haptics: boolean; target: 'web' | 'ios' | 'android' };
}
```

**CLI :**
- `npm run sim -- --level <id> --seed <n> --bot <perfect|human|random|idle> --runs <n> [--out report.json]` : simulation headless avec bots.
- `npm run sim:replay -- <journal.json>` : rejoue un journal de partie.
- `npm run playtest:metrics -- <dossier de journaux>` : calcule les 5 indicateurs de E1.

## Architecture de sécurité

- **Aucun backend, aucun compte, aucune donnée personnelle.** La sauvegarde reste locale. Les journaux de playtest sont anonymes et partagés manuellement par le testeur.
- **Build stores :** le code de debug est retiré (`VITE_DEBUG_ALLOWED=false`) ; pas de `window.__PP__`, pas de triches, pas de panneau.
- **Hébergement web :** en-têtes `Content-Security-Policy` stricts (`script-src 'self' 'wasm-unsafe-eval'` pour Rapier), HTTPS obligatoire.
- **Blender MCP :** il exécute le code Python généré par l'IA sans garde-fou. Il ne doit être utilisé que sur des fichiers `.blend` du projet, versionnés dans git, pour pouvoir revenir en arrière. On n'ouvre jamais de fichier `.blend` tiers avec l'add-on actif.
- **Plugin `feel-writer` :** il n'existe que dans le serveur de dev Vite, n'écrit que dans `content/feel.json`, et refuse tout autre chemin.

## Performances

**Budgets (appareils de référence : iPhone 12, Android 2021) :**

| Poste | Budget |
|---|---|
| Frame | ≤ 16,6 ms ; sim ≤ 2 ms par frame (jusqu'à 10 pas), rendu ≤ 10 ms |
| Draw calls | ≤ 100 (instanciation des props identiques, fusion des meubles statiques à l'export) |
| Triangles à l'écran | ≤ 100 000 |
| Textures | une palette partagée de 256 px ou des couleurs par sommet ; pas de texture > 1024 px |
| Ombres | ombres « blob » (disques) sous les personnages et les props ; pas de shadow map en E1 |
| Contours | inverted hull uniquement sur les personnages, les menaces actives et les props saillants |
| DPR | `min(devicePixelRatio, 2)` ; la résolution descend par paliers (2 → 1,5 → 1) si le temps de frame moyen dépasse 18 ms pendant 2 s |
| Poids d'un niveau | ≤ 3 Mo compressés (glb + audio du niveau), donc < 5 s en 4G |
| Mémoire | ≤ 300 Mo de heap JS + GPU sur mobile |
| Latence tap → visuel | ≤ 50 ms : retour dès `pointerdown` (surbrillance + amorce de glissade dans la frame suivante), pas de travail lourd dans les gestionnaires d'événements |

**Pratiques :**
- Aucune allocation dans la boucle chaude (pools, vecteurs temporaires réutilisés).
- Matériaux partagés.
- Géométries fusionnées à l'export.
- `renderer.info` affiché dans l'overlay de debug.
- Un test Playwright de performance (`tests/e2e/perf.spec.ts`) fait jouer le bot `human` pendant un niveau complet de 5 min et échoue si le temps de frame p95 dépasse 20 ms sur la machine de CI. Les mesures sur appareils réels sont manuelles, avec `?debug=1`.

## Architecture de déploiement

| Cible | Build | Distribution |
|---|---|---|
| Dev | `npm run dev` (Vite, HMR, debug et panneau de feeling) | local, et réseau local pour tester sur téléphone (`--host`) |
| Playtest web | `npm run build:playtest` (`VITE_DEBUG_ALLOWED=true`) | hébergeur statique (Cloudflare Pages ou Netlify, choisi au premier déploiement) ; une URL par version |
| Production web | `npm run build` (`VITE_DEBUG_ALLOWED=false`) | même hébergeur |
| iOS / Android (E8) | `npm run build && npx cap sync` puis Xcode / Android Studio | TestFlight / Play Console |

- **Base relative** (`base: './'`) pour que le même build serve sous n'importe quel chemin et dans Capacitor.
- **Orientation paysage :** en natif, elle est verrouillée par la configuration Capacitor. Sur le web, un écran « Tourne ton téléphone » s'affiche en portrait.
- **CI** (à créer avec le dépôt git, GitHub Actions recommandé) : `typecheck` → `lint` → `content:check` → `test` (Vitest, golden, architecture) → `e2e` (Playwright chromium + webkit) → build playtest.

## Validation de l'architecture

### Synthèse

| Vérification | Résultat | Notes |
|---|---|---|
| Compatibilité des décisions | OK | 2 conflits corrigés (`clampInvariant` vs « la sim ne logue pas » ; hitstop vs sim sans temps réel). Incompatibilité TS 7 / typescript-eslint résolue par Biome |
| Couverture du GDD | OK | Micro-siestes de papa ajoutées (P1, menace générée par un système). Tous les systèmes du Contexte ont un emplacement et un pattern |
| Complétude des patterns | OK | Création d'entités, communication, état, erreurs, accès aux données, événements : définis avec exemples ; 7 patterns nouveaux |
| Correspondance des epics | OK | E1 à E8 rattachés ligne par ligne ; prototype « Bébé à 4 pattes » (E1, E2, E3 partiel) entièrement couvert |
| Complétude du document | OK | Aucun placeholder ; versions vérifiées le 2026-10-26 ; sections données, API, sécurité, performances et déploiement ajoutées |

### Couverture

- **Systèmes couverts :** 18 sur 18 (tableau « Systèmes centraux »).
- **Décisions prises :** 24 (synthèse) et 10 ADR.
- **Patterns définis :** 7 nouveaux (P1 à P7) et 4 standard (communication, entités, état, données), plus 12 règles de cohérence vérifiées.

### Problèmes résolus

1. `clampInvariant(ctx, …)` émet `InvariantViolated` au lieu de loguer.
2. Hitstop : la sim expose `freezeRealMs`, la boucle client le consomme ; sans effet en headless.
3. Package Rapier harmonisé (`rapier3d-deterministic-compat`).
4. Chemins d'exemples alignés sur l'arborescence ; identifiant de niveau `salon_crawler`.
5. Scripts Node exécutés via `tsx` (résolution des alias).
6. Panneau de feeling : disponible avec l'overlay (dev, `?debug=1`) ; enregistrement en dev uniquement.
7. `ResponseResolved.reason` ajouté (`early`, `late`, `wrongResponse`, `released`, `acted`).
8. Risques 5 et 6 rattachés à ADR-010 et ADR-002 ; DPR et mémoire fixés dans « Performances ».
9. Micro-sieste de papa modélisée (`papa_microsleep`, générée par `fatigue.ts`).
10. Dossiers des epics suivantes (E4+) et convention `ZONE_creak_*` ajoutés à la structure.

### Points différés (avec justification)

- Modèle économique : avant E8 (GDD).
- Choix de l'hébergeur (Cloudflare Pages ou Netlify) : au premier déploiement de playtest, sans impact sur le code (build statique, base relative).
- WebGPU : réévalué en E7.
- CI : à créer avec le dépôt git (pipeline défini dans « Déploiement »).

### Date de validation

2026-10-26

## Environnement de développement

### Prérequis

| Outil | Version | Usage |
|---|---|---|
| macOS + Homebrew | — | Poste de Geo |
| Node.js | 25.8.1 (≥ 22.12 requis par Vite 8) | Build, tests, CLI `sim` |
| npm | fourni avec Node | Dépendances |
| git | 2.53 | Versionnement (dépôt à initialiser) |
| Blender | 5.2.3 LTS (≥ 5.1 requis par le MCP officiel) | Éditeur de niveaux, export glTF |
| Navigateurs Playwright | chromium + webkit (installés par `npx playwright install`) | Tests e2e |
| Xcode / Android Studio | versions courantes au moment de E8 | Builds natifs (E8 seulement) |

**Dépendances npm** (versions vérifiées le 2026-10-26) :
- runtime : `three@0.186.1`, `@dimforge/rapier3d-deterministic-compat@0.21.0`, `zod@4.6.7` ;
- dev : `typescript@7.0.2`, `vite@8.3.5`, `vitest@5.0.5`, `@playwright/test@1.64.1`, `@biomejs/biome@2.6.3`, `tweakpane@4.0.5`, `tsx@4.23.15`, `@types/three@0.186.0`, `gltfpack@1.3.0` ;
- E8 : `@capacitor/core|cli|ios|android@8.5.3`, `@capacitor/haptics@8.0.2`, `@capacitor/app@8.1.2`, `@capacitor/preferences@8.0.1`.

### Outillage IA (serveurs MCP)

Ces serveurs MCP ont été retenus pendant l'architecture pour l'assistance au développement :

| Serveur MCP | Rôle | Installation |
|---|---|---|
| **Blender MCP officiel** (Blender Lab, v1.0.x) | Blocage des pièces, meubles, vérification des conventions `COL_` / `NAV_` / `ANCHOR_` / `PROP_` / `ZONE_`, export glTF | Add-on MCP pour Blender ≥ 5.1 (blender.org/lab) + connecteur Claude ; **déjà connecté** sur le poste de Geo |
| **Context7** (`@upstash/context7-mcp` 4.4.4) | Documentation à jour de Three.js, Rapier, Vite, Vitest, Playwright, Zod, Capacitor | `claude mcp add context7 -- npx -y @upstash/context7-mcp@4.4.4` |
| **Playwright MCP** (`@playwright/mcp` 0.0.83) | Pilotage interactif du jeu dans un navigateur (en complément du navigateur intégré de l'app) | `claude mcp add playwright -- npx -y @playwright/mcp@0.0.83` |

**Précaution Blender MCP :** il exécute du code Python généré sans garde-fou. On ne l'utilise que sur les fichiers `.blend` du projet, versionnés dans git (voir « Architecture de sécurité »).

### Commandes d'installation

```bash
# Depuis papa-parade/ (à la racine, à côté de _bmad/ et docs/)
git init
npm create vite@latest . -- --template vanilla-ts   # choisir « Ignore files and continue »
npm install three@0.186.1 @dimforge/rapier3d-deterministic-compat@0.21.0 zod@4.6.7
npm install -D typescript@7.0.2 @types/three@0.186.0 @types/node vitest@5.0.5 @playwright/test@1.64.1 @biomejs/biome@2.6.3 tweakpane@4.0.5 tsx@4.23.15 gltfpack@1.3.0
npx playwright install chromium webkit
npx biome init
claude mcp add context7 -- npx -y @upstash/context7-mcp@4.4.4
claude mcp add playwright -- npx -y @playwright/mcp@0.0.83
```

**Scripts `package.json` à créer dans la première story :**
- Développement : `dev` (avec `--host`), `build`, `build:playtest`, `preview`.
- Qualité : `typecheck` (`tsc --noEmit`), `lint` (`biome check`), `content:check`, `content:schemas`.
- Tests : `test` (Vitest), `e2e` (Playwright).
- Assets et sim : `assets:extract`, `sim`, `sim:replay`, `playtest:metrics`.

### Premières étapes

1. Initialiser le projet avec les commandes ci-dessus, créer `CLAUDE.md` (règle d'or, frontières, commandes, liens vers le GDD et ce document) et poser les tests d'architecture (`simPurity`, `layerBoundaries`) **avant** tout code de jeu.
2. Écrire les schémas Zod et un premier `feel.json` qui reprend toutes les valeurs de départ du GDD, puis `content:check`.
3. Configurer les serveurs MCP (Context7, Playwright). Blender MCP est déjà en place.
4. Bloquer le salon greybox dans Blender via Blender MCP, l'exporter, extraire la géométrie (`assets:extract`).
5. Implémenter la tranche verticale : boucle, horloge, une menace (prise électrique) jugée de bout en bout, bot `perfect` + test golden, puis rendu cubes et retour visuel au tap.

---

_Généré par le workflow BMAD GDS Game Architecture v1.0_
_Date : 2026-10-26_
_Pour : Geo_
