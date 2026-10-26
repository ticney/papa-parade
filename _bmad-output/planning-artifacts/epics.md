---
stepsCompleted: [1, 2, 3, 4]
status: complete
inputDocuments:
  - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md
  - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/epics.md
  - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md
  - _bmad-output/planning-artifacts/game-architecture.md
language: fr
---

# Papa Parade — Découpage en epics et stories

## Vue d'ensemble

Ce document découpe en epics et en stories implémentables les exigences du GDD v2.0 et de l'architecture (`planning-artifacts/game-architecture.md`). Il n'existe pas encore de document UX. Il est rédigé en français, comme le GDD et l'architecture ; les identifiants techniques restent en anglais.

**Phases :** `[P]` prototype « Bébé à 4 pattes » (E1, E2, E3 partiel) · `[P2]` deuxième prototype (cycle du dodo, E4) · `[V1]` version 1.

## Inventaire des exigences

### Exigences fonctionnelles

**Réponses et timing**

- FR1 `[P]` : chaque menace suit le cycle télégraphe → délai → fenêtre de réponse → résultat (parfaite, réussie ou gag) ; un appui trop tôt ou trop tard déclenche le gag.
- FR2 `[P]` : **Parer** = tap sur la menace, fenêtre de 300 ms ; un relâchement avant 400 ms compte comme Parer (ADR-010).
- FR3 `[P]` (si le temps le permet) : **Fermeté** = maintien d'au moins 0,4 s sur la menace ; appui dans la fenêtre de 300 ms, maintien jusqu'à la fin de l'attaque.
- FR4 `[V1]` : **Esquiver** = swipe dans une direction, fenêtre de 250 ms, réservé aux menaces rouges.
- FR5 `[P2]` : **Attendre** = aucune action jusqu'au signal, puis tap dans les 300 ms qui suivent ; un appui avant le signal est un gag.
- FR6 `[P2]` : **Ne rien faire** = aucune action sur la menace visée pendant 1,5 à 3 s ; le joueur peut traiter d'autres menaces pendant ce temps.
- FR7 `[P]` : le timing est mesuré à l'appui. Délai télégraphe → fenêtre : 0,8 à 1,5 s selon la menace. Fenêtre parfaite : 100 ms, centrée. Tolérance cachée : ±60 ms. Buffer d'entrée : 100 ms.
- FR8 `[P]` : hitstop de 80 ms sur réponse réussie ; ralenti ×0,3 pendant 1,2 s sur réponse parfaite ; ralenti ×0,2 pendant 1,5 s sur la dernière menace d'une vague.
- FR9 `[P]` : glissade freeflow. Taper une menace fait glisser papa automatiquement jusqu'à elle, en 0,6 s au plus depuis n'importe quel point de la pièce.

**Contrôles**

- FR10 `[P]` : déplacement par tap au sol (tactile), ZQSD ou flèches (clavier), stick gauche (manette).
- FR11 `[P]` : au clavier et à la manette, la menace la plus urgente dans la direction visée est ciblée automatiquement ; Parer = Espace ou A.
- FR12 `[P]` : interaction contextuelle par tap sur l'objet (boire un café, décrocher), Espace ou A. Le tap sur le bébé hors menace sert à le prendre ou à le trouver (silence suspect) ; **renifler = maintien de 1 s sur le bébé** `[V1]` (GDD v2.1).
- FR13 `[P]` : orientation paysage.
- FR14 `[P]` : pause possible à tout moment et automatique quand l'app passe en arrière-plan ; reprise au même instant après un décompte de 3 s.

**Papa, bébé et jauges**

- FR15 `[P]` : le bébé se déplace, choisit ses cibles parmi les menaces du niveau, et son regard se verrouille sur sa cible pendant le télégraphe.
- FR16 `[P]` : fatigue de 0 à 100, +0,5/s (×2 en portant le bébé). Au-dessus de 70 : fenêtres réduites de 20 % et micro-siestes télégraphiées toutes les 8 à 12 s (paupières qui tombent, son cotonneux), à parer pour se réveiller. Café : −40, au prix de 3 s d'action.
- FR17 `[P2]` : envie pressante de 0 à 100, +0,4/s ; à 100, déplacements ralentis de 30 % ; toilettes = 5 s hors de la pièce, remise à 0.
- FR18 `[P]` : jauge de bruit (niveaux Sieste). Elle monte avec les cris (+2 %/s), les objets qui tombent (+5 à +15 %), les lattes qui grincent (+3 %), le souffle relâché trop tôt (+5 %) et le reniflage (+3 %). Elle redescend de 1 %/s. À 100 %, Maman se réveille.
- FR19 `[P]` : silence-télégraphe. Quand le bébé est hors du champ de vision et que son babillage s'arrête plus de 2 s : la musique se coupe, une bulle « … » clignote au bord de l'écran, une vibration courte part.
- FR20 `[P]` : instinct paternel. Quand au moins 3 menaces sont actives et que le joueur a raté 2 réponses en moins de 10 s : ralenti ×0,8 et fenêtres +30 % pendant 4 s ; au plus une fois toutes les 30 s.
- FR21 `[P]` : physique légère ; les objets tombent, roulent, rebondissent et provoquent des accidents émergents.
- FR22 `[P2]` : bras-bébé. Porter le bébé neutralise ses menaces directes. Papa n'a plus qu'une main (Parer et Esquiver, pas Fermeté), sa fatigue monte deux fois plus vite, et de nouvelles menaces apparaissent (micro-siestes, pleurs).
- FR23 `[P2]` : combo de x1 à x8. Il gagne +1 par réponse réussie et +1 toutes les 10 s où papa porte le bébé sans incident. Il ne s'encaisse qu'à la dépose du bébé en lieu sûr (parc, lit, transat), au ralenti. Une menace ratée avant la dépose le remet à x1.
- FR24 `[V1]` : états cachés du bébé (propre, nourri, reposé), devinés grâce à des indices : traînée verte pour l'odeur, pleurs typés (faim, couche, dents, fatigue, sans raison), chacun avec sa signature sonore et visuelle et son remède (biberon, change, anneau de dentition, bercer). Un mauvais remède fait monter le pleur d'un cran et le bruit de 5 %. Renifler (1 s) révèle l'état de la couche.

**Menaces et perturbations**

- FR25 `[P]` : **prise électrique**. Télégraphe : regard fixe, icône éclair, grésillement. Délai 1,2 s, Parer (soulever ou poser un cache-prise). Gag : le bébé tire le chargeur, la lampe s'éteint, cheveux en pétard.
- FR26 `[P]` : **escalier**. Télégraphe : le bébé accélère, halo sur la marche. Délai 1,0 s, Parer (intercepter). Gag : plongeon-rattrapage raté, le bébé glisse sur les fesses jusqu'en bas, ravi.
- FR27 `[P]` : **objet sur la table basse**. Télégraphe : le bébé se hisse, icône de l'objet. Délai 1,5 s, Parer (retirer l'objet ou détourner avec un jouet). Gag : l'objet tombe, rebondit et casse quelque chose d'autre.
- FR28 `[P]` : **silence suspect**. Délai 2 s ; trouver le bébé, puis Parer. Gag : une bêtise surprise tirée au hasard.
- FR29 `[P]` : **téléphone qui sonne** (perturbation). Décrocher : fatigue +10 et attention détournée 5 s. Ignorer : bruit +2 %/s tant qu'il sonne.
- FR30 `[V1]` : **chien** (vole la purée, aboie avec bruit +10 %, fait tomber des objets ; Parer pour le détourner) et **casserole** (déborde après 30 s d'oubli ; Parer pour baisser le feu).
- FR31 `[P]` : les menaces s'empilent par vagues. Vague 1 : une à la fois. Vague 2 : deux simultanées. Vague 3 : trois simultanées et une perturbation.

**Fin de niveau et note**

- FR32 `[P]` : variante Sieste. Fin normale au chrono (3 min dans le prototype, 4 min en v1) ; fin anticipée quand le bruit atteint 100 % (Maman réveillée, −1 étoile).
- FR33 `[V1]` : variante Retour (3 min, Maman rentre à la fin du chrono, sans fin anticipée).
- FR34 `[P]` : note de Maman. Score = Rire (0–40) + État du bébé (0–30) + 30 − Soupir (0–15) − Hurlement (0–15), sur 100. Étoiles à 20, 40, 60, 75 et 90. Réveil anticipé : −1 étoile. Un gag coûte : des objets au sol (soupir), un presque-accident (hurlement), du bruit et un multiplicateur remis à x1. **Prototype :** comme les états cachés n'arrivent qu'en E5, le composant « État du bébé » prend une valeur fixe réglable dans `feel.json` (20/30 par défaut) ; E5 la remplace par le calcul réel (décision de Geo, 2026-10-26).
- FR35 `[V1]` : séquence de fin. La porte s'ouvre → rush final (les 10 dernières secondes pour tout planquer) → photo figée → réactions de Maman (rire, soupir, hurlement) → note → replay → rejouer ou passer à l'âge suivant.
- FR36 `[V1]` : les répliques de Maman se souviennent des parties précédentes (« *Encore* l'étagère ?! »).
- FR37 `[V1]` : la dégaine de papa se dégrade visiblement pendant le niveau (purée sur la joue, cheveux en pétard, t-shirt à l'envers) et nourrit le Rire.
- FR38 `[V1]` : replay des meilleurs moments, façon match de sport.
- FR39 `[V1]` : un niveau est réussi à partir de 1 étoile ; l'âge suivant se débloque à partir de 2 étoiles.

**Séquences variées, boss et feintes**

- FR40 `[P2]` : cycle du dodo.
  - Rester éveillé : parer ses propres micro-siestes ; s'endormir fait ronfler papa, réveille le bébé et ajoute +15 % de bruit.
  - Les 100 pas : 90 → 60 BPM, fenêtre de 180 ms par pas, avec un contretemps piège.
  - Duel du coucher : Attendre.
  - Dépose-bombe : au ralenti.
  - Sortie en infiltration : lattes à mémoriser, souffle retenu (maintien n'importe où, jauge de 6 s), fausses alertes (un soupir appelle Ne rien faire ; un vrai réveil impose de revenir bercer).
- FR41 `[P2]` : faux sommeil, attaque retardée façon Elden Ring (Attendre).
- FR42 `[V1]` : change de couche en boss.
  - Barre de vie de la couche.
  - Attaques : jet surprise (à esquiver), pied qui plonge dans la couche, retournement en pleine opération, lingette qui manque.
  - Une couche débordée enchaîne sur le rhabillage complet.
- FR43 `[V1]` : rhabillage façon puzzle (les pressions ne tombent jamais en face, le bras ressort par le col, le bébé se raidit) ; réponses Fermeté et Parer.
- FR44 `[V1]` : soins. Lavage de nez : le bébé esquive de la tête, fenêtre de 150 ms. Coupe d'ongles : précision entre deux coups de pied.
- FR45 `[V1]` : désarmement.
  - Jauge de calme de 0 à 100, qui démarre à 50. Une glissade trop rapide lui retire 30 ; sous 20, le bébé agite l'objet.
  - Contre principal : l'échange contre un objet plus cool.
  - Variante « truc dans la bouche » : Fermeté, puis Parer au desserrement.
- FR46 `[V1]` : coolitude des objets (1 à 10 : cuillère 2, fourchette 4, jouet 5, télécommande 7, téléphone 8, clés 10) ; un échange réussit si l'objet proposé est plus cool que l'objet tenu.
- FR47 `[V1]` : préparation entre deux vagues (cache-prises, barrières, objets en hauteur) ; pendant les vagues, le regard du bébé révèle une zone oubliée, à sécuriser en urgence.
- FR48 `[V1]` : pleur sans raison, inparable (bercer et tenir, Fermeté pendant 5 s) ; couche de Schrödinger (le dodo échoue si la couche était sale).
- FR49 `[V1]` : vomi en jet, première menace rouge, à esquiver.

**Âges et niveaux**

- FR50 `[V1]` : petite enfance.
  - Crises de colère (boss), coups et morsures (Parer, Esquiver).
  - Provocation : une Fermeté excessive fait recommencer l'enfant deux fois plus vite ; la bonne réponse est Parer en douceur ou Ne rien faire.
  - Jauge d'attention : −5/s quand papa s'occupe de lui-même, +10 par interaction ; à 0, l'enfant passe à l'interdit.
  - Aide invisible : si l'enfant repère papa, c'est la crise.
  - Fugue et escalade, avec plongeon-rattrapage.
- FR51 `[V1]` : âges Enfance (dangers à distance), Adolescence (duel verbal sous pression de temps) et Adulte (ne plus parer). Les mêmes contrôles changent de sens d'un âge à l'autre.
- FR52 `[V1]` : un niveau par âge, chacun dans une pièce. Le premier niveau sert de tutoriel implicite : une seule menace à la fois, verbes affichés, aucune explication textuelle.

**Lisibilité, accessibilité, feeling**

- FR53 `[P]` : un verbe d'un mot s'affiche en gros sur chaque menace (SOULÈVE !, FERME !, ÉCHANGE !…).
- FR54 `[P]` : code couleur doublé par une forme d'icône (bleu et cercle = parable ; rouge et triangle = esquive).
- FR55 `[P]` : paliers de difficulté. Assistance : fenêtres +50 %, instinct actif. Normal. Papa expérimenté : fenêtres −25 %, pas d'instinct.
- FR56 `[P]` : calibration de la latence au premier lancement (tap en rythme sur 8 temps, en deux phases audio et visuelle selon l'architecture) ; le décalage mesuré est appliqué aux fenêtres.
- FR57 `[P]` : retour haptique sur mobile : vibration courte à chaque télégraphe, vibration marquée sur réponse parfaite.
- FR58 `[P]` : un son distinct par télégraphe, un son culte par type de réponse (couinement de jouet, claquement de placard), un éclat de rire du bébé sur réponse parfaite et un babillage continu.
- FR59 `[P]` : chaque signal sonore a un équivalent visuel (ondes, bulles) et un équivalent haptique.
- FR60 `[P]` (base) et `[V1]` (complète) : musique adaptative, douce au calme, nerveuse quand une menace approche ; elle bascule en ralenti sur réponse parfaite et se coupe pendant un silence suspect.
- FR61 `[P]` : effets de feeling. Hitstop, tremblement d'écran et particules ; sur réponse parfaite, ralenti, zoom et rotation de caméra.
- FR62 `[V1]` : célébration démesurée sur la dernière réponse d'un niveau (chœur d'opéra, feu d'artifice) ; cadrages parodiques par séquence.
- FR63 `[P]` : l'audio se déverrouille au premier tap dans le navigateur.

**Production et outillage**

- FR64 `[P]` : menaces, niveaux et âges sont des données éditables hors code, que l'IA peut générer et valider.
- FR65 `[P]` : tous les paramètres de feeling se règlent sans toucher à la logique, dans un fichier unique.
- FR66 `[P]` : le jeu peut être lancé et joué de bout en bout sans intervention humaine.
- FR67 `[P]` : un build web est partageable par lien pour les playtests.
- FR68 `[P]` : les cinq indicateurs de gameplay sont mesurables sur au moins 5 testeurs (critère de sortie de E1).
- FR69 `[V1]` : builds iOS et Android via Capacitor (haptique, audio, paysage) et préparation des fiches stores.
- FR70 `[V1]` : production art et audio. Pièces entières dans Blender, utilisé comme éditeur de niveaux ; personnages papa, bébé, un enfant par âge, Maman et chien ; rendu toon avec contours ; musique adaptative par âge.

### Exigences non fonctionnelles

- NFR1 : 60 FPS stables sur mobile milieu de gamme (iPhone 12, Android de 2021), mesurés sur un niveau complet de 5 min.
- NFR2 : au plus 50 ms entre un tap et le retour visuel.
- NFR3 : chargement d'un niveau en moins de 5 s sur mobile en 4G.
- NFR4 : fenêtres de timing définies en millisecondes, indépendantes du framerate.
- NFR5 : reprise exacte après une pause, au même instant de jeu.
- NFR6 : prise en main immédiate, sans tutoriel long ni texte explicatif ; au moins 4 testeurs sur 5 identifient la bonne réponse à chaque menace dès la première rencontre.
- NFR7 : jouable sans le son, grâce aux équivalents visuels et haptiques de chaque signal.
- NFR8 : accessible aux daltoniens (forme d'icône en plus de la couleur).
- NFR9 : contenu tout public ; aucune blessure montrée, aucun game over ; un échec fait rire.
- NFR10 : sessions courtes (niveau de 3 à 5 min, séquence de 20 à 60 s).
- NFR11 : indicateurs de gameplay. Au moins 70 % des testeurs relancent une partie sans qu'on le leur demande. Au moins 4 sur 5 citent spontanément la parade parfaite comme un moment fort. Le taux de réussite sur mobile atteint au moins 80 % de celui au clavier. Au moins 4 sur 5 rient pendant un niveau.
- NFR12 : testabilité. La logique est testable dans Node sans rendu ; le contenu est validé automatiquement.
- NFR13 : compatibilité avec les navigateurs mobiles et desktop (Chromium, Safari/WebKit) et la WebView Capacitor.
- NFR14 : aucune donnée personnelle collectée ; aucun backend nécessaire.

### Exigences supplémentaires (architecture)

**Démarrage du projet : impacte la story 1 de l'Epic 1**
- Pas de starter communautaire. Le projet s'initialise à la racine de `papa-parade/` avec `npm create vite@latest . -- --template vanilla-ts`, puis les dépendances aux versions de l'architecture (three 0.186.1, Rapier deterministic-compat 0.21.0, zod 4.6.7, TypeScript 7.0.2, Vitest 5.0.5, Playwright 1.64.1, Biome 2.6.3, Tweakpane 4.0.5, tsx 4.23.15, gltfpack 1.3.0), et `git init`.
- `CLAUDE.md` (règle d'or, frontières entre couches, commandes, liens vers le GDD et l'architecture) et les tests d'architecture (`simPurity`, `layerBoundaries`) sont posés **avant** tout code de jeu.
- Alias d'import `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug` ; TypeScript strict avec `erasableSyntaxOnly`.

**Simulation et temps**
- Simulation en TypeScript pur dans `src/sim`, sans `three`, ni DOM, ni `@capacitor`, ni `Math.random`, `Date` ou `performance`. La règle est vérifiée par Biome et par des tests.
- Pas fixe de 10 ms, accumulateur borné à 10 pas par frame, rendu interpolé.
- Deux horloges (`realTime`, `simTime`). Fenêtres en temps de jeu ; `timeScale` porté par la sim ; hitstop via `freezeRealMs`, consommé par la boucle client.
- `World` en données sérialisables, systèmes dans un ordre fixe, FSM explicites (`enter…State`, `enteredAt`).
- PRNG à graine, journal de commandes, snapshots toutes les 5 s (World et Rapier), tests golden.

**Entrées**
- Pointer Events, clavier et Gamepad, horodatés avec `event.timeStamp`.
- `InputMapper` : hit-test avec priorité menace > objet > sol, et rayon tactile défini dans `feel.json`.
- La sim ne reçoit que des `SimCommand` horodatées en `simTime`.
- Correction de latence (`visualOffsetMs`), puis conversion par `timeMap`.
- `earlyPress = 'fail' | 'guard'` dans `feel.json`, `'fail'` par défaut ; seuil `holdMinMs` = 400.

**Contenu et feeling**
- Schémas Zod dans `src/content/schemas/` ; export JSON Schema ; `content:check` vérifie aussi les références croisées.
- `content/feel.json` reprend toutes les valeurs chiffrées du GDD ; un niveau peut le surcharger via `feelOverrides`.
- Panneau Tweakpane (dev et `?debug=1`) ; commande `SetFeel` journalisée ; enregistrement dans le fichier via le plugin Vite `feel-writer`, en dev uniquement.
- `content/feedback.json` (événement → audio, visuel, haptique, caméra) ; test de triple équivalence.

**Physique, navigation, assets**
- Rapier `rapier3d-deterministic-compat` derrière `PhysicsPort`, pour les props uniquement ; personnages cinématiques ; conséquences de gameplay tirées des contacts, au-delà d'un seuil d'impulsion.
- Grille de navigation de 0,25 m et A* avec lissage, cuits depuis `NAV_*`.
- Pipeline Blender 5.2 → `.glb` → gltfpack ; conventions `COL_`, `NAV_`, `ANCHOR_`, `PROP_`, `ZONE_` ; `assets:extract` produit `<level>.geometry.json`. La sim ne lit jamais de `.glb`.
- Le salon greybox est bloqué dans Blender via Blender MCP dès E1.

**Présentation**
- `WebGLRenderer`, `MeshToonMaterial`, contours inverted hull, DPR plafonné à 2 et adaptatif.
- UI en DOM vanilla, éléments ancrés au monde via `CSS2DRenderer`, écran « Tourne ton téléphone » en portrait.
- `AudioEngine` Web Audio : bus, buffers pré-décodés, stems, déverrouillage audio ; fichiers `.m4a`.
- `FeedbackDirector` ; P3 : son et haptique au jugement, animation à l'arrivée de papa.

**Automatisation et debug**
- CLI `sim` headless (graine, bots `perfect`, `human`, `random`, `idle`, nombre de parties, rapport JSON) ; `sim:replay` ; `playtest:metrics`.
- `?autoplay=<bot>&seed=&speed=` ; `window.__PP__` (`state`, `events`, `send`, `advance`, `freeze`, `setFeel`, `loadLevel`).
- Overlay de debug (F1 ou appui à 3 doigts) : performances, timeline de timing, inspecteur, navigation et colliders, pas à pas, triches.
- Logger à canaux et mémoire tampon jointe au journal de partie ; `Result<T, E>` pour l'I/O ; `invariant` et `clampInvariant(ctx, …)` émettent `InvariantViolated` ; handler global → écran « Oups ».

**Persistance, télémétrie, déploiement**
- `StoragePort` : localStorage (web) ou `@capacitor/preferences` (natif) ; sauvegarde versionnée avec migrations (calibration, réglages, palier, étoiles, mémoire de Maman).
- Journal de partie anonyme, copiable ou téléchargeable en fin de partie.
- Build statique (`base: './'`) ; `build:playtest` avec `VITE_DEBUG_ALLOWED=true` ; hébergeur choisi au premier déploiement ; en-têtes CSP.
- CI (avec le dépôt git) : typecheck → lint → content:check → test → e2e → build playtest.

**Performances**
- Budgets : ≤ 100 draw calls, ≤ 100 000 triangles, ombres « blob », ≤ 3 Mo par niveau, ≤ 300 Mo de mémoire.
- Test Playwright de performance : bot `human` sur un niveau complet, échec si le temps de frame p95 dépasse 20 ms.

### Exigences de design UX

Il n'y a pas de document UX. Les exigences d'interface du prototype (HUD, verbes affichés, icônes, bulle « … », écrans de chargement, menu, calibration, pause, résultat, « Oups », « Tourne ton téléphone ») sont couvertes par FR13, FR14, FR19, FR53 à FR56 et par les exigences supplémentaires. Une spécification UX (`gds-ux`) est recommandée avant la v1.

### Carte de couverture des FR

| FR | Epic | Résumé |
|---|---|---|
| FR1 | E1 | Cycle d'une menace |
| FR2 | E1 | Parer |
| FR3 | E1 | Fermeté (si le temps le permet) |
| FR4 | E5 | Esquiver (première menace rouge) |
| FR5 | E4 | Attendre |
| FR6 | E4 (introduite dans l'infiltration), E6 (provocations) | Ne rien faire |
| FR7 | E1 | Fenêtres, tolérance, buffer, délais |
| FR8 | E1 | Hitstop et ralentis |
| FR9 | E1 | Glissade freeflow |
| FR10 | E1 | Déplacement |
| FR11 | E1 | Ciblage clavier/manette |
| FR12 | E1 | Interactions contextuelles |
| FR13 | E1 | Paysage |
| FR14 | E1 | Pause et reprise exacte |
| FR15 | E1 | Bébé : déplacement, ciblage, regard |
| FR16 | E1 | Fatigue, café, micro-siestes |
| FR17 | E4 | Envie pressante |
| FR18 | E3 `[P]` | Jauge de bruit |
| FR19 | E1 | Silence-télégraphe |
| FR20 | E2 | Instinct paternel |
| FR21 | E1 | Physique légère |
| FR22 | E4 | Bras-bébé |
| FR23 | E4 | Combo à encaisser |
| FR24 | E5 | États cachés, pleurs typés, renifler |
| FR25 | E1 | Prise électrique |
| FR26 | E1 | Escalier |
| FR27 | E1 | Objet sur la table basse |
| FR28 | E1 | Silence suspect (menace) |
| FR29 | E1 | Téléphone |
| FR30 | E6 | Chien, casserole |
| FR31 | E1 | Vagues |
| FR32 | E3 `[P]` | Variante Sieste, fin anticipée |
| FR33 | E3 `[V1]` | Variante Retour |
| FR34 | E1 | Note de Maman |
| FR35 | E3 `[V1]` | Séquence de fin |
| FR36 | E3 `[V1]` | Mémoire de Maman |
| FR37 | E3 `[V1]` | Dégaine de papa |
| FR38 | E3 `[V1]` | Replay des meilleurs moments |
| FR39 | E3 `[V1]` | Réussite et déblocage |
| FR40 | E4 | Cycle du dodo |
| FR41 | E4 | Faux sommeil |
| FR42 | E5 | Change de couche (boss) |
| FR43 | E5 | Rhabillage |
| FR44 | E5 | Soins |
| FR45 | E6 | Désarmement |
| FR46 | E6 | Coolitude |
| FR47 | E6 | Préparation |
| FR48 | E5 | Pleur sans raison, couche de Schrödinger |
| FR49 | E5 | Vomi en jet |
| FR50 | E6 | Petite enfance |
| FR51 | E6 | Enfance, Adolescence, Adulte |
| FR52 | E6 | Un niveau par âge, tutoriel implicite |
| FR53 | E2 | Verbe affiché |
| FR54 | E2 | Couleur + forme |
| FR55 | E2 | Paliers de difficulté |
| FR56 | E2 | Calibration de latence |
| FR57 | E2 | Haptique |
| FR58 | E2 | Sons de télégraphe et de réponse, rire, babillage |
| FR59 | E2 | Équivalents visuels et haptiques |
| FR60 | E2 (base), E7 (complète) | Musique adaptative |
| FR61 | E2 | Effets de feeling |
| FR62 | E7 | Célébration finale, cadrages parodiques |
| FR63 | E1 | Déverrouillage audio |
| FR64 | E1 | Contenu en données |
| FR65 | E1 (fichier), E2 (panneau) | Fichier de feeling |
| FR66 | E1 | Jouable sans humain |
| FR67 | E1 | Build web par lien |
| FR68 | E3 `[P]` | Mesure des 5 indicateurs |
| FR69 | E8 | Capacitor iOS et Android |
| FR70 | E7 | Production art et audio |

Les NFR sont transverses. NFR2, NFR4, NFR5, NFR12 et NFR14 sont posées dès E1 ; NFR6 à NFR9 sont consolidées en E2 ; NFR1 et NFR3 sont mesurées en E1 (test de performance), puis tenues à chaque epic ; NFR11 est mesurée en fin de E3 `[P]` ; NFR13 est vérifiée en E1 (web) et en E8 (WebView).

## Liste des epics

**Séquence :** E1 → E2 → E3 `[P]` → **playtest** → E4 → E3 `[V1]` → E5 → E6, avec E7 et E8 en parallèle à partir de E4. **Attention au sprint planning :** le tri par numéro placerait les stories 3.5 à 3.11 avant E4 ; elles doivent être différées après E4. La numérotation est celle du GDD et de l'architecture.

### Epic 1 : Le salon jouable en cubes
Le joueur joue une partie complète de 3 minutes dans un salon isométrique en cubes. Il protège le bébé de trois menaces et du téléphone en parant au bon moment, gère sa fatigue avec le café, repère le silence suspect, et reçoit la note de Maman. La partie est jouable à la souris, au tactile, au clavier et à la manette, par lien web, et sans humain grâce aux bots. Les fondations techniques de l'architecture (sim pure, horloge, contenu, feeling, tests) arrivent dans les premières stories, au service d'une tranche verticale jouable au plus tôt.
**FR couvertes :** FR1, FR2, FR3, FR7, FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR16, FR19, FR21, FR25, FR26, FR27, FR28, FR29, FR31, FR34, FR63, FR64, FR65 (fichier), FR66, FR67.

### Epic 2 : Game feel et lisibilité
Chaque réponse se ressent (sons cultes, rire du bébé, haptique, tremblement, particules, zoom), chaque menace se comprend sans explication (verbe affiché, couleur et forme), le jeu reste juste sur chaque appareil (calibration) et reste drôle quand il déborde (instinct paternel, palier Assistance). Geo règle tout le feeling en jouant, grâce au panneau.
**FR couvertes :** FR20, FR53, FR54, FR55, FR56, FR57, FR58, FR59, FR60 (base), FR61, FR65 (panneau).

### Epic 3 : Bruit et Maman
`[P]` Le bruit devient la menace globale du salon (variante Sieste : Maman peut se réveiller avant la fin), et le prototype est prêt pour le playtest, avec un journal de partie et le calcul des 5 indicateurs.
`[V1]` La fin de niveau devient mémorable : la porte s'ouvre, rush final, photo figée, réactions de Maman qui se souvient des parties précédentes, dégaine de papa, replay des meilleurs moments. S'y ajoutent la variante Retour et le déblocage par étoiles.
**FR couvertes :** `[P]` FR18, FR32, FR68 · `[V1]` FR33, FR35, FR36, FR37, FR38, FR39.

### Epic 4 : Cycle du dodo (deuxième prototype)
Le joueur vit une séquence qui ne repose pas sur la parade. Il porte le bébé d'une main et gère ses propres besoins (fatigue doublée, envie pressante). Il enchaîne rester éveillé, les 100 pas en rythme, le duel du coucher, la dépose-bombe et la sortie en infiltration, déjoue le faux sommeil, et encaisse son combo à la dépose.
**FR couvertes :** FR5, FR6 (introduction), FR17, FR22, FR23, FR40, FR41.

### Epic 5 : Hygiène et état caché *(stories cadrées, à réviser après playtest)*
Le joueur devine l'état caché du bébé (odeur, pleurs typés, renifler) et y répond avec le bon remède. Il affronte le change de couche en boss, le rhabillage, les soins, et esquive sa première menace rouge, le vomi en jet. La note de Maman calcule enfin l'état réel du bébé.
**FR couvertes :** FR4, FR24, FR42, FR43, FR44, FR48, FR49.

### Epic 6 : Âges suivants *(stories cadrées, à réviser après playtest ; catalogues des âges 3 à 5 à écrire avant)*
Le joueur grandit avec l'enfant : petite enfance (crises, provocation, jauge d'attention, aide invisible, fugue), désarmement et coolitude, préparation entre les vagues, chien et casserole, puis Enfance, Adolescence et Adulte, jusqu'à apprendre à ne plus parer.
**FR couvertes :** FR6 (provocations), FR30, FR45, FR46, FR47, FR50, FR51, FR52.

### Epic 7 : Production art et audio *(stories cadrées)*
Le jeu quitte les cubes : pièces modélisées, personnages riggés et animés (papa, bébé, enfants, Maman, chien), rendu toon final, VFX, célébration démesurée, cadrages parodiques et musique adaptative par âge.
**FR couvertes :** FR60 (complète), FR62, FR70.

### Epic 8 : Distribution mobile *(stories cadrées ; modèle économique à trancher avant)*
Le joueur installe le jeu sur iOS ou Android, avec haptique native, audio fiable et orientation paysage, depuis les stores.
**FR couvertes :** FR69.

## Epic 1 : Le salon jouable en cubes

Le joueur joue une partie complète de 3 minutes dans un salon isométrique en cubes. Il protège le bébé de trois menaces et du téléphone en parant au bon moment, gère sa fatigue, repère le silence suspect, et reçoit la note de Maman. Tout est jouable par lien web et sans humain. Les fondations de l'architecture arrivent au service d'une tranche verticale jouable au plus tôt (stories 1.9 et 1.10).

### Story 1.1 : Initialiser le projet et ses garde-fous

**Exigences :** Exigences supplémentaires (démarrage du projet), NFR12

En tant qu'agent IA développeur,
je veux un projet initialisé avec les frontières de l'architecture déjà vérifiées automatiquement,
afin de ne jamais pouvoir mélanger la simulation et le rendu par erreur.

**Critères d'acceptation :**

**Étant donné** le dossier `papa-parade/`, qui contient `_bmad/`, `_bmad-output/` et `docs/`
**Quand** le projet est initialisé avec `npm create vite@latest . -- --template vanilla-ts` et les dépendances aux versions de l'architecture (three 0.186.1, `@dimforge/rapier3d-deterministic-compat` 0.21.0, zod 4.6.7, typescript 7.0.2, vitest 5.0.5, @playwright/test 1.64.1, @biomejs/biome 2.6.3, tweakpane 4.0.5, tsx 4.23.15)
**Alors** `npm run dev` affiche une page avec un canvas plein écran, sans erreur dans la console
**Et** les fichiers existants (`_bmad/`, `_bmad-output/`, `docs/`) sont intacts, et un dépôt git est initialisé avec un `.gitignore` (`node_modules`, `dist`)

**Étant donné** `tsconfig.json`
**Quand** on l'inspecte
**Alors** il est en mode `strict` avec `erasableSyntaxOnly`, et déclare les alias `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform` et `@debug`, résolus aussi par `vite.config.ts` et Vitest

**Étant donné** les dossiers vides `src/{shared,content,sim,bots,platform,client,debug}`, `content/`, `tools/` et `tests/{architecture,golden,e2e}`
**Quand** on lance `npm test`
**Alors** `tests/architecture/simPurity.test.ts` échoue si un fichier de `src/sim` (hors `*.test.ts`) contient `Math.random`, `Date`, `performance`, `window`, `document`, ou un import de `three` ou de `@capacitor/*`
**Et** `tests/architecture/layerBoundaries.test.ts` échoue si une règle du tableau « Frontières d'architecture » est violée (chaque règle a un cas de test avec un fichier fautif en fixture)

**Étant donné** `biome.json`
**Quand** on lance `npm run lint`
**Alors** Biome applique `noRestrictedImports` par dossier, selon les frontières de l'architecture, et interdit `console.*` hors de `src/shared/log.ts`

**Étant donné** `package.json`
**Quand** on liste les scripts
**Alors** `dev`, `build`, `typecheck`, `lint`, `test` et `e2e` existent et passent sur le projet vide

**Étant donné** `CLAUDE.md` à la racine
**Quand** un agent le lit
**Alors** il y trouve la règle d'or, le tableau des frontières, les commandes, les conventions de nommage essentielles, et les liens vers le GDD et `game-architecture.md`

**Étant donné** `src/shared/log.ts` et `src/shared/result.ts`
**Quand** du code les utilise
**Alors** `log.<niveau>(canal, message, data?)` filtre par niveau (`error`, `warn`, `info`, `debug`), écrit dans la console en dev et conserve les 200 dernières entrées `info` et plus dans une mémoire tampon lisible (`log.buffer()`)
**Et** `Result<T, E>` est le type de retour des fonctions d'I/O (tests unitaires des deux modules)

**Étant donné** `.github/workflows/ci.yml`
**Quand** du code est poussé vers un dépôt distant (l'hébergement du dépôt est choisi par Geo)
**Alors** la CI exécute `typecheck` → `lint` → `content:check` → `test` → `e2e` (chromium et webkit) et échoue au premier échec
**Et** tant qu'aucun dépôt distant n'existe, le même pipeline tourne en local via `npm run ci`

### Story 1.2 : Pipeline de contenu et fichier de feeling

**Exigences :** FR64, FR65

En tant que Geo, game designer,
je veux toutes les valeurs de feeling du GDD dans un seul fichier validé,
afin de les régler sans jamais toucher à la logique.

**Critères d'acceptation :**

**Étant donné** `src/content/schemas/feel.ts` (`FeelSchema` en Zod)
**Quand** `content/feel.json` est chargé
**Alors** il contient toutes les valeurs de départ du GDD :
- timing : délais de télégraphe par défaut ; fenêtre standard 300 ms ; parfaite 100 ms ; tolérance 60 ms ; buffer 100 ms ; hitstop 80 ms ; ralentis ×0,3 / 1,2 s et ×0,2 / 1,5 s ;
- entrées : `holdMinMs` 400 ; `earlyPress` `"fail"` ;
- déplacement et jauges : glissade de 600 ms au plus ; fatigue (0,5/s, ×2, seuil 70, −20 %, micro-sieste 8–12 s, café −40 / 3000 ms) ;
- assistance et difficulté : instinct (×0,8, +30 %, 4 s, recharge 30 s, déclenchement à 3 menaces et 2 ratés en 10 s) ; paliers (Assistance +50 %, Normal, Papa expérimenté −25 %) ;
- note de Maman : bornes, seuils d'étoiles, et `babyStateFixedPoints` = 20 ;
- tactile : rayon tactile en px.

**Et** chaque clé porte un suffixe d'unité (`Ms`, `Pct`, `PerSec`…)

**Étant donné** `src/content/loadContent.ts`
**Quand** un fichier de contenu ne respecte pas son schéma
**Alors** `loadContent` renvoie un `Result` en erreur, avec le chemin du fichier et le chemin JSON fautif
**Et** en dev, l'erreur s'affiche à l'écran

**Étant donné** `npm run content:check`
**Quand** il s'exécute
**Alors** il valide tout `content/**` et sort en code ≠ 0 au moindre fichier invalide

**Étant donné** `npm run content:schemas`
**Quand** il s'exécute
**Alors** `content/_schemas/*.json` est régénéré (JSON Schema via `z.toJSONSchema`), et `feel.json` le référence par `$schema` pour l'autocomplétion

**Étant donné** `src/content/feelMerge.ts`
**Quand** un niveau déclare `feelOverrides`
**Alors** le `Feel` effectif est la fusion profonde de `feel.json` et des surcharges, testée unitairement

### Story 1.3 : Cœur de simulation déterministe en headless

**Exigences :** NFR4, NFR12

En tant qu'agent IA développeur,
je veux une simulation pure qui avance par pas de 10 ms et se rejoue à l'identique,
afin que tout le gameplay soit testable dans Node, sans navigateur.

**Critères d'acceptation :**

**Étant donné** `createSim({ content, seed })` dans `src/sim/index.ts`
**Quand** on appelle `step()` 100 fois
**Alors** `world.time.sim` vaut exactement 1000 (ms entières)
**Et** `World` ne contient que des données sérialisables : `JSON.stringify` puis `JSON.parse` redonne un objet égal

**Étant donné** `src/sim/step.ts`
**Quand** un pas s'exécute
**Alors** les systèmes tournent dans l'ordre fixe de l'architecture, et chacun ne peut qu'écrire dans `World` et pousser dans `ctx.events`

**Étant donné** `src/shared/rng.ts` (sfc32, état dans `World`)
**Quand** deux sims sont créées avec la même graine et reçoivent les mêmes commandes
**Alors** leurs `World` et leurs séquences d'événements sont identiques après 10 000 pas

**Étant donné** `src/sim/commands.ts` et `src/sim/events.ts`
**Quand** on enfile une commande horodatée avec `enqueue(cmd)`
**Alors** elle est appliquée au premier pas dont le temps de jeu est supérieur ou égal à `cmd.t`, et elle est ajoutée au journal

**Étant donné** `src/sim/time/`
**Quand** `timeScale` vaut 0,3
**Alors** chaque pas vaut toujours 10 ms de temps de jeu, et `sim.timeScale` expose la valeur à la boucle
**Et** quand un gel est demandé, `sim.freezeRealMs` expose la durée restante

**Étant donné** `snapshot()` et `restore()`
**Quand** on restaure un snapshot puis qu'on rejoue les commandes du journal
**Alors** l'état final est identique à celui de la partie d'origine

**Étant donné** `tests/golden/golden.test.ts`
**Quand** un journal de référence de `tests/golden/journals/` est rejoué
**Alors** le hash de l'état final et la liste des types d'événements correspondent à la référence enregistrée
**Et** une option `--update` permet de régénérer la référence volontairement

**Étant donné** `src/shared/invariant.ts`
**Quand** `clampInvariant(ctx, v, min, max, name)` reçoit une valeur hors bornes
**Alors** il lève une erreur en test et en dev ; en prod, il borne la valeur et émet `InvariantViolated`

### Story 1.4 : Boucle client, vue isométrique et pause exacte

**Exigences :** FR13, FR14, NFR5, NFR6 (HUD lisible, zones sûres)

En tant que joueur,
je veux voir le monde en vue isométrique fluide, et que le jeu se mette en pause sans rien perdre,
afin de pouvoir être interrompu à tout moment.

**Critères d'acceptation :**

**Étant donné** `src/client/loop.ts`
**Quand** le jeu tourne
**Alors** la boucle `requestAnimationFrame` accumule le temps réel multiplié par `sim.timeScale`, exécute au plus 10 pas de 10 ms par frame, et rend avec un facteur d'interpolation
**Et** elle ne fait avancer aucun pas tant que `sim.freezeRealMs` > 0 (gel consommé en temps réel)

**Étant donné** `src/client/render/` (`WebGLRenderer`, caméra orthographique isométrique fixe, sol plat provisoire)
**Quand** la fenêtre est redimensionnée
**Alors** le cadrage garde toute la pièce visible en paysage, et le DPR vaut `min(devicePixelRatio, 2)`

**Étant donné** `src/client/timeMap.ts`
**Quand** un horodatage réel compris dans les 2 dernières secondes est converti
**Alors** il donne le temps de jeu interpolé, ralentis et gels compris (tests unitaires sur des historiques construits)

**Étant donné** une partie en cours
**Quand** l'onglet passe en arrière-plan (`visibilitychange`) ou que le joueur touche le bouton pause
**Alors** aucun pas n'est exécuté, et le client émet `PauseRequested` (les systèmes du client qui produisent du son ou des vibrations s'y abonnent)
**Et** au retour, un décompte de 3 s en temps réel s'affiche, puis la partie reprend au même temps de jeu, à 10 ms près

**Étant donné** un téléphone tenu en portrait
**Quand** le jeu est affiché
**Alors** un écran « Tourne ton téléphone » recouvre le jeu, et la partie reste en pause tant que l'orientation est portrait

**Étant donné** le premier affichage du jeu
**Quand** il est prêt
**Alors** un écran de démarrage « Touche pour commencer » attend un tap, un clic ou une touche ; ce premier geste est celui qui servira à déverrouiller l'audio (story 1.8) et à lancer la calibration (story 2.7)

**Étant donné** `src/client/ui/styles/tokens.css` et la couche HUD en DOM
**Quand** le HUD s'affiche en paysage
**Alors** il respecte des zones fixes :
- en haut à gauche, les jauges ;
- en haut au centre, le chrono ;
- en haut à droite, le bouton pause ;
- le tiers inférieur reste libre (zone des pouces), et aucun élément de HUD ne recouvre la pièce au-delà de 12 % de la hauteur.

**Et** toutes les marges intègrent `env(safe-area-inset-*)` (viewport `viewport-fit=cover`), si bien qu'aucun élément n'est masqué par l'encoche d'un iPhone en paysage (vérifié par un test Playwright avec un viewport d'iPhone 12 en paysage)
**Et** le bouton pause, comme tout bouton d'UI, a une cible tactile d'au moins 44 × 44 pt

### Story 1.5 : Salon greybox depuis Blender

**Exigences :** FR64 (pipeline Blender de l'architecture)

En tant que Geo,
je veux que le salon soit bloqué dans Blender et chargé tel quel par le jeu,
afin que Blender soit mon éditeur de niveaux dès le prototype.

**Critères d'acceptation :**

**Étant donné** `assets-src/blender/salon_crawler.blend`, bloqué en cubes par l'IA via Blender MCP
**Quand** on l'inspecte
**Alors** il contient les collections `level`, `colliders`, `nav`, `anchors`, `props`, et des objets nommés selon les conventions : `COL_*`, `NAV_floor`, `NAV_block_*`, `ANCHOR_papa_spawn`, `ANCHOR_baby_spawn`, `ANCHOR_outlet_01`, `ANCHOR_stairs_top`, `ANCHOR_coffee_table`, `ANCHOR_phone`, `ANCHOR_coffee_machine`, `ANCHOR_door`, `ZONE_hidden_behind_sofa`, `PROP_*`

**Étant donné** `tools/blender/export_level.py`
**Quand** il est exécuté (via Blender MCP ou `blender -b -P`)
**Alors** il exporte `public/assets/levels/salon_crawler.glb` (mètres, Y vers le haut)
**Et** il échoue avec un message clair si un nom ne respecte pas les conventions ou si une ancre obligatoire manque

**Étant donné** `npm run assets:extract`
**Quand** il lit le `.glb`
**Alors** il produit `content/levels/salon_crawler.geometry.json`, validé par `LevelGeometrySchema` : colliders, grille de navigation de 0,25 m, ancres, zones, props
**Et** `npm run assets:optimize` passe le `.glb` à gltfpack

**Étant donné** le client
**Quand** le niveau `salon_crawler` est chargé
**Alors** le salon s'affiche en vue isométrique, avec un matériau toon provisoire et des ombres « blob »
**Et** un écran de chargement reste visible jusqu'à ce que tous les assets soient prêts

**Étant donné** un échec de chargement du `.glb` ou de la géométrie (réseau coupé, fichier absent)
**Quand** `loadLevelAssets` renvoie un `Result` en erreur
**Alors** l'écran « Oups » s'affiche, sur un ton léger, avec un bouton « Réessayer », et l'erreur est loguée en `warn` avec l'identifiant du niveau

**Étant donné** le handler global (`error`, `unhandledrejection`) installé par `boot.ts`
**Quand** une exception non capturée survient
**Alors** elle est loguée en `error`, et l'écran « Oups » propose de relancer le niveau (test e2e qui déclenche une exception via le paramètre de dev `?throwAfterMs=…`)

### Story 1.6 : Déplacer papa

**Exigences :** FR10

En tant que joueur,
je veux déplacer papa dans le salon d'un tap au sol, au clavier ou au stick,
afin d'aller où je veux sans réfléchir aux contrôles.

**Critères d'acceptation :**

**Étant donné** papa (cube) à son ancre de départ
**Quand** je tape le sol à un point marchable
**Alors** le client envoie `TapFloor{x, z, t}`, et la sim calcule un chemin A* sur la grille de navigation et déplace papa jusqu'au point en contournant les `NAV_block_*`
**Et** un repère visuel apparaît au point tapé dans la frame suivant le `pointerdown`

**Étant donné** un tap sur une zone non marchable
**Quand** il est traité
**Alors** papa va au point marchable le plus proche

**Étant donné** le clavier (ZQSD et flèches) ou le stick gauche d'une manette (API Gamepad)
**Quand** je maintiens une direction
**Alors** papa se déplace en continu dans cette direction (`Move{dir, t}` / `MoveStop{t}`), à la vitesse définie dans `feel.json`, et s'arrête contre les obstacles

**Étant donné** `src/sim/nav/`
**Quand** les tests s'exécutent
**Alors** A* et le lissage de chemin sont couverts : chemin direct, contournement, destination inaccessible

### Story 1.7 : Le bébé vit dans le salon

**Exigences :** FR15

En tant que joueur,
je veux voir le bébé (une sphère) explorer le salon en babillant,
afin de sentir qu'il est vivant et imprévisible.

**Critères d'acceptation :**

**Étant donné** le bébé à son ancre de départ
**Quand** la partie tourne sans menace planifiée
**Alors** sa FSM alterne `wander` et `babble` (transitions via `enterBabyState`, événement `BabyStateChanged`), et il se déplace à 4 pattes sur la grille à la vitesse de `feel.json`
**Et** ses destinations sont tirées par le PRNG du monde (même graine, même trajet)

**Étant donné** la vue du bébé (sphère avec un indicateur de regard)
**Quand** il se déplace
**Alors** sa position est interpolée et son regard suit la direction de marche

**Étant donné** `world.baby.babbling`
**Quand** le bébé est en `wander` ou en `babble`
**Alors** `babbling` vaut `true` (le son de babillage arrive en story 1.8)

### Story 1.8 : Retours de base

**Exigences :** FR59 (base), FR63, NFR7

En tant que joueur,
je veux entendre le bébé et sentir les événements du jeu, même sans le son,
afin que chaque signal me parvienne d'une façon ou d'une autre.

**Critères d'acceptation :**

**Étant donné** `src/client/audio/` (`AudioEngine`, avec les bus `music`, `sfx`, `voice` et `ui`)
**Quand** le joueur fait son premier geste sur l'écran de démarrage (story 1.4)
**Alors** l'`AudioContext` (`latencyHint: 'interactive'`) est déverrouillé
**Et** sur `PauseRequested`, l'`AudioContext` est suspendu, puis repris à la fin du décompte
**Et** les buffers `.m4a` du niveau sont décodés à l'avance pendant le chargement

**Étant donné** `world.baby.babbling` vaut `true`
**Quand** le jeu tourne
**Alors** une boucle de babillage provisoire est audible sur le bus `voice`, et une boucle musicale calme sur le bus `music`

**Étant donné** `content/feedback.json` (`FeedbackTableSchema`) et `src/client/feedback/feedbackDirector.ts`
**Quand** la sim émet un événement listé dans la table
**Alors** le director joue les indices `audio`, `visual` et `haptic`, et `camera` si l'entrée en a un
**Et** `tests/architecture/feedbackEquivalence.test.ts` échoue si une entrée a un `audio` sans `visual` ou sans `haptic`

**Étant donné** `src/platform/web/webHaptics.ts`
**Quand** un indice haptique est joué sur un navigateur sans `navigator.vibrate` (Safari iOS)
**Alors** l'appel ne fait rien, sans erreur, et `platform.capabilities.haptics` vaut `false`

### Story 1.9 : Première menace jugée en headless, la prise électrique

**Exigences :** FR1, FR2, FR7, FR15, FR25, NFR9

En tant qu'agent IA développeur,
je veux que la prise électrique soit planifiée, télégraphiée et jugée entièrement dans la simulation,
afin de valider en tests, sans navigateur, le cœur du verbe « lire, puis répondre juste ».

**Critères d'acceptation :**

**Étant donné** `content/threats/outlet.json` (`ThreatDefSchema` : `response: "parry"`, `telegraphDelayMs: 1200`, fenêtre standard, gag `outlet_hair`, clés de retour) et un niveau de test (`LevelSchema` minimal) qui planifie cette menace
**Quand** le director minimal la cible
**Alors** le bébé verrouille son regard (`targetLocked`, `BabyStateChanged`), la menace passe en `telegraph` (`ThreatTelegraphed`), et le bébé s'approche de `ANCHOR_outlet_01`
**Et** la fenêtre s'ouvre 1200 ms (temps de jeu) après le télégraphe (`WindowOpened`)

**Étant donné** la fenêtre ouverte
**Quand** la sim reçoit `PressThreat{threatId, t}` puis `Release{t}` dans la fenêtre
**Alors** `judgePress` qualifie l'appui en `perfect` (±50 ms autour du centre) ou en `success` (fenêtre ± tolérance), la sim émet `ResponseResolved{quality, offsetMs}`, et papa reçoit une glissade `papa.glide = {to, arriveAt}` (arrivée en 600 ms au plus, P3)

**Étant donné** un appui trop tôt (avant la fenêtre moins le buffer) avec `earlyPress = "fail"`, ou l'absence de réponse jusqu'à la fin de la fenêtre et de la tolérance
**Quand** il est jugé
**Alors** la menace passe en `gag` (`GagTriggered`, `ResponseResolved{quality: "fail", reason: "early" | "late"}`) ; le gag est un événement, jamais une blessure
**Et** avec `earlyPress = "guard"`, l'appui précoce déclenche la glissade sans jugement, et seul un nouvel appui dans la fenêtre compte

**Étant donné** `src/sim/timing/`
**Quand** les tests s'exécutent
**Alors** `effectiveWindow` (base × palier × fatigue × instinct, puis ± tolérance, avec des modificateurs à 1 tant que leurs systèmes n'existent pas) et `judgePress` sont couverts par des cas limites au milliseconde près
**Et** chaque fichier de `content/threats/` génère automatiquement les tests « parfait », « réussi », « trop tôt » et « trop tard »

### Story 1.10 : Parer la prise électrique au tap

**Exigences :** FR1, FR2, FR9, FR25, NFR2

En tant que joueur,
je veux voir le bébé foncer vers la prise, lire le danger et le parer d'un tap au bon moment,
afin de vivre le verbe central du jeu : lire, puis répondre juste.

**Critères d'acceptation :**

**Étant donné** la menace de la story 1.9 en `telegraph`
**Quand** le client traite `ThreatTelegraphed`
**Alors** une icône éclair et un halo apparaissent sur la prise, et le son de télégraphe est joué via `feedback.json`

**Étant donné** un `pointerdown` à portée de la menace (rayon tactile de `feel.json`)
**Quand** `inputMapper` le traite
**Alors** le hit-test donne la priorité à la menace sur le sol, et envoie `PressThreat` horodaté avec `event.timeStamp`, converti par `timeMap`
**Et** la menace est surlignée, et papa amorce sa glissade dès la frame suivante

**Étant donné** une `ResponseResolved` réussie
**Quand** le `FeedbackDirector` la traite
**Alors** le son et la vibration de réponse partent tout de suite ; l'animation « soulever le bébé » est mise en file et se joue à l'arrivée de papa (P3), sans contredire le résultat déjà jugé

**Étant donné** un gag
**Quand** il est présenté
**Alors** la lampe s'éteint et les cheveux de papa se dressent (provisoire en cubes)

**Étant donné** `tests/e2e/tapLatency.spec.ts` (chromium et webkit)
**Quand** il simule un `pointerdown` sur la menace
**Alors** l'écart entre `performance.mark('press')` (dans le gestionnaire) et `performance.mark('highlightRendered')` (après le rendu de la frame qui affiche la surbrillance) est au plus de 50 ms

### Story 1.11 : Bots et simulation en masse

**Exigences :** FR66

En tant qu'agent IA développeur,
je veux des joueurs automatiques et une CLI qui jouent des centaines de parties en headless,
afin de valider chaque changement et d'équilibrer sans humain.

**Critères d'acceptation :**

**Étant donné** `src/bots/` (`perfectBot`, `humanBot` avec temps de réaction et gigue gaussienne tirés de `feel.json` ou d'options, `randomBot`, `idleBot`)
**Quand** un bot reçoit le `World` en lecture seule
**Alors** il ne produit que des `SimCommand`, comme le client

**Étant donné** `npm run sim -- --level <id> --seed 42 --bot perfect --runs 100 --out report.json`
**Quand** il s'exécute (via `tsx`)
**Alors** il joue 100 parties en headless et écrit un rapport JSON : score moyen, distribution des qualités de réponse par menace, gags
**Et** un identifiant de niveau ou de bot inconnu donne un message d'erreur clair et un code de sortie ≠ 0

**Étant donné** `npm run sim:replay -- journal.json`
**Quand** il rejoue un journal
**Alors** il reproduit le même état final (hash identique)

**Étant donné** le bot `perfect` sur le niveau de test
**Quand** il joue 100 parties
**Alors** toutes les réponses à la prise électrique sont `perfect` (test Vitest)

### Story 1.12 : Autoplay et API de test dans le navigateur

**Exigences :** FR66, NFR13

En tant qu'agent IA développeur,
je veux faire jouer un bot dans le vrai navigateur et inspecter le jeu depuis Playwright,
afin de vérifier le jeu complet, rendu compris, sans intervention humaine.

**Critères d'acceptation :**

**Étant donné** l'URL `?autoplay=human&seed=42&speed=4`
**Quand** le jeu se charge
**Alors** le bot joue à la place du joueur, à 4× la vitesse réelle (le bot est chargé par import dynamique)

**Étant donné** `window.__PP__`, disponible en dev et avec `?debug=1`
**Quand** Playwright l'utilise
**Alors** `state()`, `events()`, `send()`, `advance(n)`, `freeze()`, `setFeel()` et `loadLevel()` fonctionnent

**Étant donné** `tests/e2e/autoplay.spec.ts` (chromium et webkit)
**Quand** il charge le jeu avec `?autoplay=perfect`
**Alors** il vérifie qu'au moins une `ResponseResolved` réussie est émise, sans erreur de console, et prend une capture d'écran figée (`freeze`) comparée à une référence

### Story 1.13 : Hitstop et ralentis

**Exigences :** FR8

En tant que joueur,
je veux que le jeu marque un temps d'arrêt quand je réussis, et passe au ralenti façon film d'action sur une réponse parfaite,
afin de ressentir chaque réussite.

**Critères d'acceptation :**

**Étant donné** une `ResponseResolved` en `success`
**Quand** elle est émise
**Alors** la sim demande un gel de `hitstopMs` (80 ms en temps réel) ; aucun pas n'avance pendant le gel, mais le rendu continue

**Étant donné** une `ResponseResolved` en `perfect`
**Quand** elle est émise
**Alors** `timeScale` passe à 0,3 pendant 1200 ms de temps de jeu, puis revient à 1 avec une transition définie dans `feel.json`
**Et** la glissade de papa se fait au ralenti

**Étant donné** deux effets de temps qui se chevauchent
**Quand** ils sont actifs en même temps
**Alors** la règle est déterministe et testée : le facteur le plus lent l'emporte, et la durée la plus longue est conservée

**Étant donné** un ralenti en cours
**Quand** une nouvelle fenêtre s'ouvre
**Alors** ses durées sont mesurées en temps de jeu, donc plus longues en temps réel (ADR-002)

### Story 1.14 : Physique légère des objets

**Exigences :** FR21

En tant que joueur,
je veux voir les objets tomber, rouler, rebondir et provoquer des accidents en chaîne,
afin que le chaos crée du spectacle.

**Critères d'acceptation :**

**Étant donné** `src/sim/physics/rapierPhysics.ts` (seul fichier qui importe Rapier, derrière `PhysicsPort`)
**Quand** la sim est créée
**Alors** Rapier (deterministic-compat) s'initialise une fois, dans Node comme dans le navigateur, avec les colliders `COL_*` et les props `PROP_*` de `geometry.json`

**Étant donné** un prop qui reçoit une impulsion (commande de test ou événement de gameplay)
**Quand** il tombe et heurte le sol ou un autre prop
**Alors** la sim émet `PropImpact{propId, impulse}` au-delà du seuil défini dans `feel.json`, et `PropBroken` si le prop est cassable et que l'impulsion dépasse son seuil
**Et** `world.mess.propsOnFloor` est mis à jour

**Étant donné** `snapshot()` et `restore()`
**Quand** des props sont en mouvement
**Alors** le snapshot inclut l'état Rapier, et le replay reproduit des positions identiques sur la même machine (test golden avec chute de props)

**Étant donné** la vue des props
**Quand** ils bougent
**Alors** ils sont rendus depuis des pools de vues (`ViewRegistry`), avec interpolation

### Story 1.15 : Escalier et objet sur la table basse

**Exigences :** FR26, FR27

En tant que joueur,
je veux deux nouvelles menaces aux télégraphes bien distincts,
afin de devoir lire avant d'agir et choisir quoi traiter.

**Critères d'acceptation :**

**Étant donné** `content/threats/stairs.json` (Parer, 1000 ms)
**Quand** elle se déclenche
**Alors** le bébé accélère vers `ANCHOR_stairs_top` et un halo apparaît sur la marche, avec son son de télégraphe
**Et** si elle est réussie, papa intercepte le bébé ; en cas d'échec, le gag fait glisser le bébé sur les fesses jusqu'en bas, ravi, et compte un presque-accident (`NearMiss`)

**Étant donné** `content/threats/coffee_table_object.json` (Parer, 1500 ms)
**Quand** elle se déclenche
**Alors** le bébé se hisse à `ANCHOR_coffee_table`, et une icône de l'objet apparaît
**Et** si elle est réussie, papa retire l'objet ; en cas d'échec, une impulsion Rapier fait tomber le prop, qui peut casser un autre prop (`PropBroken`)

**Étant donné** les trois menaces actives dans un niveau de test
**Quand** les tests générés depuis les JSON s'exécutent
**Alors** les quatre cas (parfait, réussi, trop tôt, trop tard) passent pour chaque menace, sans code propre à une menace hors de `gags.ts`

### Story 1.16 : Ciblage automatique au clavier et à la manette

**Exigences :** FR11, FR12

En tant que joueur au clavier ou à la manette,
je veux parer la menace la plus urgente dans la direction que je vise,
afin de jouer aussi bien qu'au tactile.

**Critères d'acceptation :**

**Étant donné** au moins une menace en `telegraph` ou en `windowOpen`
**Quand** j'appuie sur Espace (clavier) ou A (manette) en visant une direction (ZQSD, flèches ou stick)
**Alors** `autoTarget` choisit la menace dont la fenêtre se ferme le plus tôt dans un cône de `autoTargetConeDeg` (60° par défaut, dans `feel.json`) autour de la direction visée (sans direction : la plus urgente globalement), puis envoie `PressThreat` horodaté à l'appui

**Étant donné** la menace actuellement ciblée
**Quand** je vise
**Alors** elle est surlignée en continu, pour que je sache laquelle sera parée

**Étant donné** aucune menace active
**Quand** j'appuie sur Espace ou A près d'un objet interactif
**Alors** l'interaction contextuelle de l'objet le plus proche est déclenchée (`TapObject`)

**Étant donné** l'API Gamepad
**Quand** une manette est branchée en cours de partie
**Alors** elle est prise en compte sans recharger la page

### Story 1.17 : Vagues de menaces et chrono du niveau

**Exigences :** FR8, FR31, NFR10

En tant que joueur,
je veux que les menaces s'empilent par vagues pendant 3 minutes,
afin de passer du calme au chaos.

**Critères d'acceptation :**

**Étant donné** `content/levels/salon_crawler.json` (`LevelSchema`), avec `durationMs: 180000`, `variant: "nap"` et trois vagues
**Quand** la partie se déroule
**Alors** la vague 1 (dès 0 s) n'active qu'une menace à la fois, la vague 2 (dès 60 s) jusqu'à deux simultanées, et la vague 3 (dès 120 s) jusqu'à trois, plus une perturbation
**Et** le `WaveDirector` choisit les menaces et les délais avec le PRNG, dans les bornes du JSON du niveau

**Étant donné** `content:check`
**Quand** un niveau référence une `ThreatDef` ou une ancre inexistante
**Alors** la vérification échoue en nommant la référence fautive

**Étant donné** le HUD
**Quand** la partie tourne
**Alors** un chrono visible, dans la zone HUD du haut au centre (story 1.4), décompte le temps restant ; à 0, la sim passe le flux en `ended` (`LevelEnded{reason: "timer"}`)

**Étant donné** la dernière menace d'une vague, résolue avec succès
**Quand** elle est jugée
**Alors** `timeScale` passe à 0,2 pendant 1500 ms, selon la règle de chevauchement de la story 1.13

**Étant donné** `npm run sim -- --bot idle`
**Quand** la partie se termine
**Alors** le rapport montre des menaces dans chaque vague, et jamais plus de menaces simultanées que la vague ne l'autorise

### Story 1.18 : Fatigue, café et micro-siestes

**Exigences :** FR12, FR16

En tant que joueur,
je veux voir papa s'épuiser au point de piquer du nez, et pouvoir me relancer au café,
afin de gérer mon propre rythme au milieu du chaos.

**Critères d'acceptation :**

**Étant donné** `src/sim/gauges/fatigue.ts`
**Quand** le temps passe
**Alors** la fatigue monte de 0,5/s, bornée entre 0 et 100, et s'affiche dans une jauge de la zone HUD en haut à gauche (story 1.4) (le multiplicateur ×2 du bras-bébé est lu depuis `feel.json`, mais ne s'applique qu'à partir de E4)

**Étant donné** une fatigue supérieure à 70
**Quand** une fenêtre est calculée
**Alors** elle est réduite de 20 %
**Et** `fatigue.ts` crée toutes les 8 à 12 s (PRNG) une instance de `content/threats/papa_microsleep.json` (cible : papa ; paupières qui tombent, son cotonneux), à parer pour se réveiller ; en cas d'échec, gag de papa endormi quelques secondes

**Étant donné** `ANCHOR_coffee_machine`
**Quand** je tape la machine à café (ou Espace / A à proximité)
**Alors** papa y va, est occupé 3000 ms (aucune réponse possible pendant ce temps), puis la fatigue baisse de 40

**Étant donné** le bot `idle`
**Quand** il joue 3 minutes
**Alors** les micro-siestes apparaissent après le franchissement du seuil, à l'intervalle prévu (vérifié par un test en headless)

### Story 1.19 : Le téléphone qui sonne

**Exigences :** FR29

En tant que joueur,
je veux qu'un téléphone sonne au pire moment et me force à choisir,
afin de décider quoi traiter dans le chaos.

**Critères d'acceptation :**

**Étant donné** `content/disruptions/phone.json` et la vague 3
**Quand** le téléphone se déclenche
**Alors** il sonne (son, ondes visuelles autour de `ANCHOR_phone`, vibration) jusqu'à ce qu'on décroche ou pendant la durée maximale du JSON

**Étant donné** le téléphone qui sonne
**Quand** je le tape (décrocher)
**Alors** papa y va et reste occupé 5000 ms (attention détournée : aucune réponse possible pendant ce temps), et la fatigue monte de 10

**Étant donné** le téléphone qui sonne
**Quand** je l'ignore
**Alors** il continue de sonner, et la sim émet `PhoneRinging` à chaque seconde (la jauge de bruit de E3 s'y branchera à +2 %/s, sans modifier cette story)

### Story 1.20 : Le silence suspect

**Exigences :** FR19, FR28

En tant que joueur,
je veux comprendre qu'il se passe quelque chose quand le bébé disparaît et se tait,
afin de partir le chercher avant la bêtise.

**Critères d'acceptation :**

**Étant donné** `content/threats/silence_mischief.json` et `ZONE_hidden_behind_sofa`
**Quand** le director choisit une bêtise silencieuse
**Alors** le bébé passe en `mischiefSilent`, va dans la zone cachée, et `babbling` passe à `false` (le babillage s'arrête)
**Et** après `silenceAlertMs` (2000 ms) dans la zone, la sim émet `SilenceStarted`

**Étant donné** `SilenceStarted`
**Quand** le `FeedbackDirector` le traite
**Alors** la musique se coupe, une bulle « … » clignote au bord de l'écran, du côté de la zone, et une vibration courte part

**Étant donné** le silence en cours
**Quand** papa entre dans la zone ou que je tape le bébé
**Alors** la sim émet `SilenceEnded`, la menace passe en `windowOpen` et se pare comme une autre ; la musique et le babillage reprennent
**Et** si personne ne vient avant l'échéance du JSON, une bêtise surprise est tirée au hasard dans la liste des gags (gag, bazar)

### Story 1.21 : Note de Maman et écran de fin

**Exigences :** FR34

En tant que joueur,
je veux recevoir une note de Maman sur 5 étoiles à la fin de la partie,
afin d'avoir envie de rejouer pour faire mieux.

**Critères d'acceptation :**

**Étant donné** `src/sim/scoring/mamaScore.ts`
**Quand** le niveau se termine
**Alors** le score vaut Rire + État du bébé + 30 − Soupir − Hurlement, borné entre 0 et 100, avec :
- Rire (0–40) : nourri par les réponses parfaites, selon les poids de `feel.json` (la dégaine arrive en E3 `[V1]`, les combos en E4) ;
- État du bébé : la valeur fixe `babyStateFixedPoints` (20) ;
- Soupir (0–15) : les objets au sol et les objets cassés ;
- Hurlement (0–15) : les presque-accidents.

**Et** les étoiles sont attribuées aux seuils 20 / 40 / 60 / 75 / 90, testés aux bornes

**Étant donné** l'écran de résultat (DOM)
**Quand** il s'affiche
**Alors** il montre le détail des quatre composantes, les étoiles et les boutons « Rejouer » et « Copier le journal » (le journal arrive en E3, le bouton est masqué jusque-là)

**Étant donné** l'écran de résultat sur un téléphone en paysage
**Quand** il s'affiche
**Alors** chaque bouton a une cible tactile d'au moins 44 × 44 pt, et le texte reste lisible sans zoom (taille minimale définie dans `tokens.css`)

**Étant donné** « Rejouer »
**Quand** je le touche
**Alors** une nouvelle partie démarre avec une nouvelle graine, sans recharger la page

### Story 1.22 : Fermeté (optionnelle)

**Exigences :** FR3

En tant que joueur,
je veux qu'un maintien sur une menace signifie « tenir ferme »,
afin d'avoir une seconde réponse que le même geste distingue.

**Critères d'acceptation :**

**Étant donné** une `ThreatDef` avec `response: "firm"` et `holdUntilMs`
**Quand** j'appuie dans la fenêtre et que je maintiens au moins `holdMinMs` (400 ms), jusqu'à `holdUntilMs`
**Alors** la réponse est jugée réussie (qualité calculée sur l'appui)

**Étant donné** la même menace
**Quand** je relâche avant 400 ms (donc un Parer), ou entre 400 ms et `holdUntilMs`
**Alors** c'est un gag, avec `reason` valant `wrongResponse` ou `released`

**Étant donné** une menace qui demande Parer
**Quand** je maintiens au-delà de 400 ms
**Alors** c'est un gag, avec `reason: "wrongResponse"`

**Étant donné** une menace de test `firm` dans un niveau de test
**Quand** les tests générés s'exécutent
**Alors** les cas parfait, réussi, relâché tôt, trop tôt et trop tard passent

### Story 1.23 : Build de playtest partageable et budget de performance

**Exigences :** FR67, NFR1, NFR2, NFR3, NFR14

En tant que Geo,
je veux envoyer un lien à des testeurs et savoir que le jeu tient 60 FPS,
afin de lancer les playtests du prototype.

**Critères d'acceptation :**

**Étant donné** `npm run build:playtest` (`VITE_DEBUG_ALLOWED=true`, `base: './'`)
**Quand** le build est servi par un serveur statique quelconque
**Alors** le jeu se charge et se joue de bout en bout, et `?debug=1` affiche au moins un compteur de FPS et de temps de frame

**Étant donné** `npm run build` (prod)
**Quand** on inspecte le bundle
**Alors** il ne contient ni `window.__PP__`, ni le code de debug, ni Tweakpane

**Étant donné** l'hébergeur statique choisi par Geo (Cloudflare Pages ou Netlify)
**Quand** le build de playtest est déployé
**Alors** il est accessible en HTTPS par lien, avec des en-têtes CSP (`script-src 'self' 'wasm-unsafe-eval'`)
**Et** la procédure de déploiement est documentée dans `CLAUDE.md`

**Étant donné** `tests/e2e/perf.spec.ts`
**Quand** le bot `human` joue un niveau complet
**Alors** le test échoue si le temps de frame p95 dépasse 20 ms, si les draw calls dépassent 100 ou si les triangles dépassent 100 000 (`renderer.info`)
**Et** le poids total des assets du niveau (glb + audio) est au plus de 3 Mo, vérifié par un test sur `dist/`

**Étant donné** le build de playtest déployé, et un iPhone 12 ainsi qu'un Android de 2021
**Quand** Geo (ou un agent qui pilote l'appareil) joue un niveau complet avec `?debug=1`
**Alors** le FPS p95 et la latence tap → visuel (filmée à 240 fps, au moins 10 taps) sont relevés dans `docs/playtest/device-measurements.md`
**Et** le playtest ne démarre que si ces mesures respectent NFR1 (60 FPS stables) et NFR2 (au plus 50 ms) ; sinon, l'écart est noté et une story de correction est créée

## Epic 2 : Game feel et lisibilité

Chaque réponse se ressent, chaque menace se comprend sans explication, le jeu reste juste sur chaque appareil et drôle quand il déborde. Geo règle tout le feeling en jouant.

### Story 2.1 : Overlay de debug, timeline de timing et panneau de feeling

**Exigences :** FR65

En tant que Geo,
je veux voir l'écart en ms de chacun de mes appuis et régler les valeurs de feeling en jouant,
afin de régler le feeling sans toucher au code.

**Critères d'acceptation :**

**Étant donné** l'overlay de debug (dev, ou `?debug=1` sur un build de playtest), ouvert avec F1 ou un appui à 3 doigts
**Quand** il s'affiche
**Alors** il montre les FPS, le temps de frame (rendu et sim), les draw calls, un inspecteur d'état du `World` en lecture seule, et peut afficher la grille de navigation, les colliders, les ancres, les zones et le rayon tactile des menaces
**Et** il propose pause, pas à pas, `timeScale` forcé, et des triches : lancer une menace, régler une jauge, sauter à la fin

**Étant donné** la timeline de timing
**Quand** je réponds à une menace
**Alors** elle affiche l'appui (corrigé de la latence) face à la fenêtre standard, la fenêtre parfaite et la tolérance, avec l'écart signé en ms et la qualité obtenue, pour les 10 dernières réponses

**Étant donné** le panneau Tweakpane, généré depuis `FeelSchema` (dossiers par section, bornes issues du schéma)
**Quand** je modifie une valeur
**Alors** le client envoie `SetFeel{patch, t}`, appliqué au pas suivant et journalisé ; le replay du journal reproduit le changement au même instant
**Et** le bouton « Enregistrer », présent en dev uniquement, envoie un POST au plugin Vite `feel-writer`, qui fusionne les valeurs dans `content/feel.json` (formaté, validé par le schéma) et refuse tout autre chemin

### Story 2.2 : Verbe affiché et icônes couleur + forme

**Exigences :** FR53, FR54, NFR6, NFR8

En tant que joueur qui découvre le jeu,
je veux voir en gros ce que je dois faire sur chaque menace,
afin de comprendre sans tutoriel, même daltonien.

**Critères d'acceptation :**

**Étant donné** une menace en `telegraph`
**Quand** elle s'affiche
**Alors** son verbe (`verb` du JSON, par exemple « SOULÈVE ! ») apparaît en gros au-dessus de la menace (`CSS2DRenderer`), lisible sur un écran de téléphone en paysage
**Et** son icône a la couleur et la forme de son type de réponse : bleu et cercle pour les menaces parables ; rouge et triangle pour l'esquive (le style est prêt, utilisé à partir de E5)

**Étant donné** plusieurs menaces actives
**Quand** leurs verbes se chevaucheraient
**Alors** ils sont décalés pour rester lisibles, et la menace la plus urgente est au premier plan

**Étant donné** `content:check`
**Quand** une `ThreatDef` n'a pas de `verb`, d'`iconShape` ou de `color`
**Alors** la vérification échoue

### Story 2.3 : Sons cultes, rire du bébé et télégraphes distincts

**Exigences :** FR58

En tant que joueur,
je veux un son reconnaissable pour chaque danger et chaque réussite,
afin d'entendre ce qui se passe avant même de le voir.

**Critères d'acceptation :**

**Étant donné** les trois menaces, le silence suspect, la micro-sieste et le téléphone
**Quand** chacun passe en `telegraph`
**Alors** il joue un son de télégraphe distinct (`tel_*.m4a`), référencé dans `feedback.json`

**Étant donné** une `ResponseResolved` en `success` ou en `perfect`
**Quand** elle est émise
**Alors** le son culte du type de réponse est joué (`resp_parry_*` : couinement de jouet ; `resp_firm_*` si la Fermeté existe)
**Et** sur `perfect`, un éclat de rire du bébé (`baby_laugh_perfect`) s'y ajoute

**Étant donné** un gag
**Quand** il se déclenche
**Alors** le son de gag de la menace est joué (`gag_*`)

**Étant donné** un son joué au jugement
**Quand** on mesure la latence dans un test
**Alors** il est déclenché dans le même tour de boucle que le traitement de la `ResponseResolved` (sans attente de l'arrivée de papa)

### Story 2.4 : Équivalents visuels et haptiques complets

**Exigences :** FR57, FR59, NFR7

En tant que joueur qui joue sans le son,
je veux que chaque signal sonore ait un équivalent visuel et une vibration,
afin de ne rien rater.

**Critères d'acceptation :**

**Étant donné** chaque entrée de `feedback.json` qui a un `audio`
**Quand** le test de triple équivalence s'exécute
**Alors** elle a aussi un `visual` (ondes, bulles, flash, icône) et un `haptic` (`light`, `medium` ou `heavy`)

**Étant donné** un télégraphe
**Quand** il démarre
**Alors** une vibration courte (`light`) part sur les appareils qui la supportent, et des ondes visuelles partent de la source du son

**Étant donné** une réponse parfaite
**Quand** elle est jugée
**Alors** une vibration marquée (`heavy`) part, et un flash visuel l'accompagne

**Étant donné** le jeu avec le son coupé
**Quand** un testeur joue (`tests/e2e/mute.spec.ts`, avec le bot `perfect` et l'audio coupé)
**Alors** chaque événement de la table produit bien son indice visuel (vérifié via les classes DOM ou les objets de scène exposés par `window.__PP__`)

### Story 2.5 : Effets de feeling à l'écran

**Exigences :** FR61

En tant que joueur,
je veux que l'image réagisse à mes réussites et aux catastrophes,
afin de ressentir chaque réponse, même avec des cubes.

**Critères d'acceptation :**

**Étant donné** une réponse réussie
**Quand** le hitstop démarre
**Alors** un tremblement d'écran court et des particules partent du point de réponse (intensités dans `feel.json`)

**Étant donné** une réponse parfaite
**Quand** le ralenti démarre
**Alors** la caméra zoome et pivote légèrement vers l'action, puis revient au cadrage isométrique à la fin du ralenti (paramètres dans `feel.json`)

**Étant donné** un gag
**Quand** il se déclenche
**Alors** un effet comique (particules « pouf », secousse) accompagne l'animation provisoire

**Étant donné** les budgets de performance
**Quand** le bot `human` joue un niveau complet avec tous les effets
**Alors** `perf.spec.ts` reste dans les budgets (particules en pool, aucune allocation par frame)

### Story 2.6 : Musique adaptative de base

**Exigences :** FR60 (base)

En tant que joueur,
je veux que la musique suive la tension du moment,
afin de sentir la menace approcher et le ralenti s'installer.

**Critères d'acceptation :**

**Étant donné** deux stems synchronisés (`music_crawler_calm`, `music_crawler_tense`) qui démarrent ensemble
**Quand** aucune menace n'est en `telegraph` ni en `windowOpen`
**Alors** seul le stem calme est audible

**Étant donné** une menace qui passe en `telegraph`
**Quand** la tension monte
**Alors** le stem nerveux monte en fondu (durée dans `feel.json`), puis redescend quand plus aucune menace n'est active

**Étant donné** un ralenti en cours
**Quand** `timeScale` est inférieur à 1
**Alors** la musique bascule en effet « ralenti » (filtre passe-bas et baisse du `playbackRate`, réglables), puis revient à la fin du ralenti

**Étant donné** `SilenceStarted`
**Quand** il est émis
**Alors** la musique se coupe (comportement de la story 1.20 conservé), et reprend sur `SilenceEnded`

### Story 2.7 : Calibration de la latence

**Exigences :** FR56

En tant que joueur sur un nouvel appareil,
je veux un court réglage au premier lancement,
afin que mes réponses soient jugées justes malgré la latence de mon écran et de mon audio.

**Critères d'acceptation :**

**Étant donné** le premier lancement (aucune calibration dans la sauvegarde)
**Quand** le jeu démarre
**Alors** l'écran de calibration propose une phase audio (8 bips à 100 BPM, taper en rythme), puis une phase visuelle (8 flashs)

**Étant donné** les écarts mesurés d'une phase
**Quand** la phase se termine
**Alors** le décalage retenu est la médiane, après rejet des valeurs à plus de 150 ms de la médiane, bornée entre −50 et 250 ms
**Et** si moins de 5 taps sont valides, la phase est reproposée

**Étant donné** `StoragePort` (web : localStorage) et `src/client/save/saveStore.ts` (`SaveSchema` v1, avec migrations)
**Quand** la calibration est terminée
**Alors** `save.calibration = { visualOffsetMs, audioOffsetMs, measuredAt, device }` est enregistrée, et une sauvegarde invalide est mise de côté puis remplacée par les valeurs par défaut, avec un `warn`

**Étant donné** une calibration enregistrée
**Quand** je joue
**Alors** chaque appui est corrigé de `visualOffsetMs` avant d'être converti en temps de jeu, et l'option « Recalibrer » est disponible dans les réglages

### Story 2.8 : Paliers de difficulté et réglages

**Exigences :** FR55

En tant que joueur,
je veux choisir un palier Assistance, Normal ou Papa expérimenté,
afin que le jeu reste drôle quel que soit mon niveau.

**Critères d'acceptation :**

**Étant donné** l'écran de réglages (accessible depuis le menu et la pause)
**Quand** je choisis un palier
**Alors** il est enregistré dans la sauvegarde et appliqué à la partie suivante

**Étant donné** le palier Assistance, Normal ou Papa expérimenté
**Quand** une fenêtre est calculée
**Alors** elle est multipliée par 1,5, 1 ou 0,75 (valeurs dans `feel.json`), avant les autres modificateurs, selon l'ordre de l'architecture

**Étant donné** le palier Papa expérimenté
**Quand** les conditions de l'instinct paternel sont réunies
**Alors** il ne se déclenche pas

**Étant donné** les réglages
**Quand** je les ouvre
**Alors** j'y trouve aussi le volume par bus, l'activation de l'haptique et « Recalibrer »

### Story 2.9 : Instinct paternel

**Exigences :** FR20

En tant que joueur débordé,
je veux qu'un coup de pouce discret m'aide quand tout s'effondre,
afin que le chaos reste drôle et jamais frustrant.

**Critères d'acceptation :**

**Étant donné** au moins 3 menaces actives et 2 réponses ratées en moins de 10 s
**Quand** la condition est remplie et que l'instinct n'a pas servi depuis 30 s
**Alors** la sim émet `InstinctTriggered`, `timeScale` passe à 0,8 et les fenêtres sont élargies de 30 % pendant 4000 ms

**Étant donné** l'instinct actif
**Quand** il se termine
**Alors** la sim émet `InstinctEnded`, et l'instinct ne peut pas se redéclencher avant 30 s

**Étant donné** `InstinctTriggered`
**Quand** le `FeedbackDirector` le traite
**Alors** il joue un indice audio, visuel et haptique dédié (vignettage léger, son « cœur qui bat »)

**Étant donné** les tests de la sim
**Quand** ils s'exécutent
**Alors** le déclenchement, la recharge et la combinaison avec un ralenti parfait (règle de chevauchement de la story 1.13) sont couverts

## Epic 3 : Bruit et Maman

`[P]` Le bruit devient la menace globale du salon, et le prototype est prêt pour le playtest (stories 3.1 à 3.4). `[V1]` La fin de niveau devient mémorable (stories 3.5 à 3.11).

> **Ordre de livraison :** les stories 3.5 à 3.11 `[V1]` se livrent **après E4**, et non après 3.4. Le sprint planning doit les marquer comme différées (`sprint-status.yaml`), malgré leur numérotation.

### Story 3.1 : Jauge de bruit `[P]`

**Exigences :** FR18

En tant que joueur,
je veux voir monter le bruit à chaque chute et chaque sonnerie,
afin de sentir que le chaos risque de réveiller Maman.

**Critères d'acceptation :**

**Étant donné** `src/sim/gauges/noise.ts` et la table `feel.noise.sources`
**Quand** un événement bruyant survient
**Alors** la jauge (0–100) monte selon la table :
- `PropImpact` : +5 à +15 %, selon l'impulsion ;
- `PhoneRinging` : +2 % par seconde de sonnerie ;
- `BabyCrying` : +2 %/s, quand un gag déclare `gagCryMs` ;
- les sources des epics suivants (lattes, souffle, reniflage) sont déjà prévues dans la table, sans émetteur pour l'instant.

**Et** elle redescend de 1 %/s, bornée entre 0 et 100

**Étant donné** le HUD
**Quand** la jauge change
**Alors** une jauge de bruit visible l'affiche avec un code couleur progressif, et la sim émet `NoiseChanged` (indice visuel et haptique au-delà de 80 %)

**Étant donné** les stories 1.14 et 1.19, déjà livrées
**Quand** la jauge est branchée
**Alors** aucun code de ces stories n'est modifié : la jauge réagit uniquement à leurs événements

### Story 3.2 : Variante Sieste et réveil de Maman `[P]`

**Exigences :** FR32

En tant que joueur,
je veux que Maman se réveille si je fais trop de bruit,
afin que le bruit soit un vrai enjeu jusqu'à la dernière seconde.

**Critères d'acceptation :**

**Étant donné** un niveau `variant: "nap"` (le salon du prototype, 3 min)
**Quand** la jauge de bruit atteint 100 %
**Alors** la sim émet `MamaWoke`, puis `LevelEnded{reason: "mamaWoke"}`, et la note perd une étoile (sans descendre sous 0)

**Étant donné** la fin normale au chrono
**Quand** le temps est écoulé
**Alors** `LevelEnded{reason: "timer"}` est émis sans pénalité

**Étant donné** l'écran de résultat
**Quand** Maman a été réveillée
**Alors** la raison s'affiche avec un indice dédié (son de porte qui claque, visuel, vibration), et l'étoile perdue est visible

**Étant donné** le bot `random`
**Quand** il joue 100 parties en headless
**Alors** le rapport distingue les fins `timer` et `mamaWoke`

### Story 3.3 : Journal de partie exportable `[P]`

**Exigences :** FR68, NFR14

En tant que testeur,
je veux copier ou télécharger le journal de ma partie en un geste,
afin que Geo puisse analyser mon playtest sans que je donne d'information personnelle.

**Critères d'acceptation :**

**Étant donné** une partie terminée
**Quand** l'écran de résultat s'affiche
**Alors** le bouton « Copier / Télécharger le journal » produit un JSON validé par `JournalSchema`, qui contient :
- le rejeu : graine, version du contenu, hash de `feel.json`, commandes, changements de feeling ;
- le résumé : réponses par menace et par qualité, appareil d'entrée dominant (tactile, clavier ou manette), fin, score, étoiles, numéro de la partie dans la session (relances sans rechargement) ;
- le diagnostic : les 200 dernières entrées de log `info` et plus.

**Et** le journal ne contient aucune donnée personnelle (ni identifiant, ni user-agent complet : seulement le type d'appareil et la plateforme)

**Étant donné** un journal exporté
**Quand** on le passe à `npm run sim:replay`
**Alors** l'état final est identique à celui de la partie d'origine

### Story 3.4 : Indicateurs de playtest `[P]`

**Exigences :** FR68, NFR11

En tant que Geo,
je veux calculer automatiquement ce qui peut l'être parmi les 5 indicateurs, et noter le reste simplement,
afin de décider si le prototype valide le concept.

**Critères d'acceptation :**

**Étant donné** un dossier de journaux de playtest
**Quand** je lance `npm run playtest:metrics -- <dossier>`
**Alors** j'obtiens, par testeur et au global :
- le taux de relance sans rechargement ;
- le taux de réussite par menace à la première rencontre ;
- le taux de réponses réussies au tactile comparé au clavier, avec le ratio cible ≥ 80 %.

**Et** chaque valeur est comparée à son seuil NFR11, avec un statut OK ou KO

**Étant donné** `docs/playtest/observation-sheet.md`
**Quand** je fais passer un playtest
**Alors** la fiche me permet de noter les indicateurs observés : citation spontanée de la parade parfaite, rires pendant le niveau, identification de la bonne réponse sans explication
**Et** `playtest:metrics` fusionne ces notes dans le rapport final à partir d'un CSV `docs/playtest/observations.csv`, aux colonnes `testerId, sessionId, threatId, identifiedWithoutHelp (O/N), perfectCitedSpontaneously (O/N), laughs (nombre), comment`, avec un exemple fourni et une validation des colonnes (erreur explicite si une colonne manque)

### Story 3.5 : Porte qui s'ouvre et rush final `[V1]`

**Exigences :** FR35

En tant que joueur,
je veux entendre la porte s'ouvrir et avoir 10 secondes pour tout planquer,
afin de finir chaque niveau en apothéose de panique.

**Critères d'acceptation :**

**Étant donné** un niveau à 10 s de la fin
**Quand** le chrono atteint `durationMs − finalRushMs` (10 000 ms, dans `feel.json`)
**Alors** la sim passe le flux en `finalRush`, émet `FinalRushStarted`, et la porte (`ANCHOR_door`) s'anime avec son son de clé, un visuel et une vibration

**Étant donné** le rush final
**Quand** papa tape un objet au sol
**Alors** il le ramasse et le range (commande `TapObject`), ce qui réduit le Soupir de Maman selon `feel.json`

**Étant donné** le rush final
**Quand** il se termine
**Alors** le flux passe en `photo`

### Story 3.6 : Photo de fin figée `[V1]`

**Exigences :** FR35

En tant que joueur,
je veux une photo figée de l'état du salon à l'arrivée de Maman,
afin de rire de la scène, et de mes catastrophes.

**Critères d'acceptation :**

**Étant donné** le flux en `photo`
**Quand** il démarre
**Alors** la sim prend un snapshot final ; le client le rend sans simulation, avec une caméra et un filtre « photo » (cadre, flash, son d'appareil), et cette caméra est réglable dans `feel.json`

**Étant donné** des presque-accidents figés sur la photo (bébé en hauteur)
**Quand** le score est calculé
**Alors** ils sont comptés dans le Hurlement, conformément au GDD

### Story 3.7 : Réactions de Maman et dégaine de papa `[V1]`

**Exigences :** FR35, FR37

En tant que joueur,
je veux voir Maman rire, soupirer ou hurler, et papa de plus en plus débraillé,
afin que la note raconte ma partie.

**Critères d'acceptation :**

**Étant donné** `World.papa.look` (purée sur la joue, cheveux en pétard, t-shirt à l'envers)
**Quand** certains gags se produisent (déclarés dans les `ThreatDef` via `lookChange`)
**Alors** la dégaine de papa se dégrade visiblement pendant le niveau, et chaque élément nourrit le Rire selon `feel.json`

**Étant donné** la fin de la photo
**Quand** les réactions s'affichent
**Alors** Maman réagit dans l'ordre Rire, Soupir, Hurlement ; chaque réaction a son animation provisoire, son son et sa valeur, puis la note et les étoiles s'affichent

### Story 3.8 : Mémoire de Maman `[V1]`

**Exigences :** FR36

En tant que joueur qui rejoue,
je veux que Maman se souvienne de mes catastrophes passées,
afin de rire de ses « *Encore* l'étagère ?! ».

**Critères d'acceptation :**

**Étant donné** `save.mamaMemory.counts`
**Quand** un niveau se termine
**Alors** les tags des gags et des presque-accidents de la partie y sont ajoutés (avec une migration de sauvegarde v1 → v2 si nécessaire)

**Étant donné** `content/mama-lines.json` (`MamaLinesSchema` : `when.tag`, `minPrevious`, `reaction`, `text`)
**Quand** les réactions s'affichent
**Alors** la réplique la plus spécifique dont la condition est satisfaite est choisie, avec un départage par le PRNG ; sans condition satisfaite, une réplique générique de la réaction est choisie

**Étant donné** `content:check`
**Quand** une réplique référence un tag inexistant
**Alors** la vérification échoue

### Story 3.9 : Replay des meilleurs moments `[V1]`

**Exigences :** FR38

En tant que joueur,
je veux revoir mes meilleurs moments façon match de sport,
afin de savourer mes parades et mes désastres.

**Critères d'acceptation :**

**Étant donné** `src/client/endOfLevel/highlights.ts`
**Quand** la partie se déroule
**Alors** chaque événement est noté selon le barème de P7 (parfait 3, gag avec au moins 2 objets 2, presque-accident 2, dernière menace de vague 1), et les 3 meilleurs moments, espacés d'au moins 5 s, sont retenus

**Étant donné** un moment retenu à l'instant `t`
**Quand** le replay le joue
**Alors** une sim de replay séparée restaure le snapshot qui précède `t − 2 s`, rejoue le journal jusqu'à `t + 1,5 s`, et le rendu utilise une caméra de replay avec le bandeau « REPLAY »
**Et** la sim de la partie n'est pas modifiée

**Étant donné** le replay
**Quand** je tape l'écran
**Alors** le moment en cours est passé ; un second tap passe tout le replay

### Story 3.10 : Variante Retour `[V1]`

**Exigences :** FR33

En tant que joueur,
je veux des niveaux où Maman est sortie et rentre à la fin du chrono,
afin de varier l'enjeu selon l'âge.

**Critères d'acceptation :**

**Étant donné** un niveau `variant: "return"`
**Quand** il se déroule
**Alors** la jauge de bruit n'est pas affichée et ne peut pas terminer le niveau ; le chrono mène à la même fin (porte, rush final, photo, note)

**Étant donné** `LevelSchema`
**Quand** un niveau « return » déclare une durée
**Alors** la valeur par défaut est de 180 000 ms, surchargeable par le niveau

### Story 3.11 : Réussite et déblocage par étoiles `[V1]`

**Exigences :** FR39

En tant que joueur,
je veux débloquer l'âge suivant quand je fais assez bien,
afin d'avoir un objectif de progression.

**Critères d'acceptation :**

**Étant donné** une partie terminée
**Quand** elle obtient au moins 1 étoile
**Alors** le niveau est marqué réussi ; la meilleure note par niveau est enregistrée dans la sauvegarde

**Étant donné** au moins 2 étoiles (seuil dans `feel.json`)
**Quand** l'écran de résultat s'affiche
**Alors** l'âge suivant est annoncé comme débloqué, et un menu de sélection des niveaux (créé par cette story, enrichi en 6.9) l'affiche comme jouable

**Étant donné** l'écran de résultat
**Quand** je le quitte
**Alors** je peux rejouer ou passer à l'âge suivant (s'il est débloqué et existe)

## Epic 4 : Cycle du dodo (deuxième prototype)

Le joueur vit une séquence qui ne repose pas sur la parade. Il porte le bébé d'une main, gère ses propres besoins, enchaîne les cinq étapes du dodo, déjoue le faux sommeil et encaisse son combo à la dépose. Avant la story 4.10, chaque séquence se lance depuis l'overlay de debug, dans le salon.

### Story 4.1 : Porter le bébé (bras-bébé)

**Exigences :** FR22

En tant que joueur,
je veux prendre le bébé dans les bras pour le mettre à l'abri, au prix d'une main en moins,
afin de décider à chaque instant quand porter et quand déposer.

**Critères d'acceptation :**

**Étant donné** le salon greybox, auquel on ajoute via Blender MCP une `ZONE_safe_playpen` (le parc), puis qu'on réexporte
**Quand** `assets:extract` s'exécute
**Alors** la zone apparaît dans `geometry.json`

**Étant donné** papa près du bébé
**Quand** je tape le bébé hors de toute menace (`TapBaby`)
**Alors** papa le prend : le bébé passe en `carried`, et ses menaces directes en cours sont annulées sans gag (`ThreatCancelled{reason: "carried"}`)

**Étant donné** le bébé porté
**Quand** une menace demande Fermeté
**Alors** elle ne peut pas être réussie (`wrongResponse` si je tente un maintien), et le verbe affiché l'indique (« POSE-LE D'ABORD ! »)
**Et** Parer reste possible ; la fatigue monte ×2 (`carriedMultiplier`) ; des micro-siestes et une menace « pleurs dans les bras » (`content/threats/arms_cry.json`, Parer = bercer) peuvent apparaître

**Étant donné** le bébé porté
**Quand** je tape le sol ou une `ZONE_safe_*`
**Alors** papa dépose le bébé (`BabyPutDown{safe: boolean}`), et le bébé reprend sa FSM normale

### Story 4.2 : Combo à encaisser

**Exigences :** FR23, FR34 (coût d'un gag)

En tant que joueur,
je veux faire grimper un multiplicateur que je n'encaisse qu'en déposant le bébé en lieu sûr,
afin de prendre des risques pour un gros score.

**Critères d'acceptation :**

**Étant donné** `src/sim/scoring/combo.ts`
**Quand** une réponse est réussie, ou que 10 s passent sans incident bébé dans les bras
**Alors** le multiplicateur gagne +1, borné entre x1 et x8 (valeurs dans `feel.json`), et s'affiche dans le HUD

**Étant donné** un multiplicateur supérieur à x1
**Quand** papa dépose le bébé dans une `ZONE_safe_*`
**Alors** une dépose au ralenti encaisse les points (multiplicateur × points de base accumulés) dans le Rire de Maman, avec un indice audio, visuel et haptique, puis le multiplicateur revient à x1

**Étant donné** une menace ratée avant la dépose
**Quand** le gag se déclenche
**Alors** le multiplicateur retombe à x1, sans rien encaisser

### Story 4.3 : Envie pressante

**Exigences :** FR17

En tant que joueur,
je veux que papa doive un jour aller aux toilettes,
afin de devoir choisir le moment où je laisse le bébé seul.

**Critères d'acceptation :**

**Étant donné** `src/sim/gauges/bladder.ts`
**Quand** le temps passe
**Alors** la jauge monte de 0,4/s (0–100), s'affiche dans le HUD, et à 100 les déplacements de papa sont ralentis de 30 %

**Étant donné** `ANCHOR_toilet`, ajoutée au salon greybox via Blender MCP par cette story
**Quand** je tape la porte des toilettes
**Alors** papa quitte la pièce pendant 5000 ms (aucune réponse possible, le bébé reste seul), et la jauge revient à 0

**Étant donné** le bébé porté
**Quand** je tente d'aller aux toilettes
**Alors** je dois d'abord le déposer (verbe affiché)

### Story 4.4 : Cadre des séquences spéciales et « Rester éveillé »

**Exigences :** FR40

En tant que joueur,
je veux que le jeu bascule dans une séquence courte aux règles propres, en commençant par lutter contre le sommeil, bébé dans les bras,
afin de varier le gameplay au-delà de la parade.

**Critères d'acceptation :**

**Étant donné** `content/sequences/` (`SequenceDefSchema` : étapes, durée, conditions de réussite et d'échec, cadrage) et le flux `sequence` dans `levelFlow`
**Quand** une séquence démarre
**Alors** la sim émet `SequenceStarted{id}` ; le director normal est suspendu, puis reprend à `SequenceEnded{id, outcome}`
**Et** le client applique le cadrage de caméra et la musique de la séquence

**Étant donné** la séquence `stay_awake` (bébé dans les bras)
**Quand** elle se déroule
**Alors** des micro-siestes de papa arrivent selon une cadence propre à la séquence, à parer
**Et** une micro-sieste ratée fait ronfler papa et réveille le bébé, avec bruit +15 % et échec de la séquence

**Étant donné** l'overlay de debug
**Quand** je choisis une séquence
**Alors** elle se lance immédiatement dans le salon (avant la story 4.10)

### Story 4.5 : Les 100 pas en rythme

**Exigences :** FR40

En tant que joueur,
je veux bercer le bébé en marchant au rythme d'une berceuse qui ralentit,
afin de vivre un moment de rythme façon Rhythm Heaven.

**Critères d'acceptation :**

**Étant donné** la séquence `lullaby_walk` (BPM de 90 à 60, fenêtre de 180 ms par pas, contretemps pièges, tout dans le JSON)
**Quand** elle se déroule
**Alors** la sim génère les temps en temps de jeu (P1 généralisé : un temps = une fenêtre), et le client planifie la berceuse dans l'`AudioContext` à partir de ces mêmes instants, corrigés de `audioOffsetMs`

**Étant donné** un temps
**Quand** je tape dans sa fenêtre
**Alors** le pas est réussi (son, visuel, vibration) ; un tap sur un contretemps piège, ou un temps raté, réveille un peu le bébé, selon la tolérance de la séquence

**Étant donné** un ralenti ou une pause pendant la séquence
**Quand** le jeu reprend
**Alors** la musique et les temps restent synchronisés (test : écart au plus de 10 ms entre le temps de jeu et la position audio)

### Story 4.6 : Duel du coucher (réponse Attendre)

**Exigences :** FR5, FR40

En tant que joueur,
je veux rester immobile face au lit et partir à l'instant exact où le bébé ferme les yeux,
afin de vivre un duel de patience façon Ghost of Tsushima.

**Critères d'acceptation :**

**Étant donné** la réponse générique `wait` (P2) dans la sim
**Quand** une menace `wait` entre en `windowOpen`
**Alors** un signal `WaitSignalGiven` est tiré par le PRNG entre `minDelayMs` et `maxDelayMs`, et la fenêtre de 300 ms ne s'ouvre qu'à ce signal

**Étant donné** la séquence `bedtime_duel`
**Quand** j'appuie avant que le bébé ferme les yeux
**Alors** c'est un échec : le bébé rouvre les yeux, et la séquence recule d'une étape

**Étant donné** le signal (les yeux qui se ferment, avec indice visuel, sonore et haptique)
**Quand** j'appuie dans la fenêtre
**Alors** papa part, réussite parfaite ou simple selon le centrage

**Étant donné** les tests générés
**Quand** ils s'exécutent pour une `ThreatDef` `wait`
**Alors** les cas parfait, réussi, avant le signal et trop tard passent

### Story 4.7 : Faux sommeil

**Exigences :** FR41

En tant que joueur,
je veux qu'un bébé faussement endormi me punisse si je me relâche trop tôt,
afin d'apprendre à lire avant d'agir.

**Critères d'acceptation :**

**Étant donné** `content/threats/fake_sleep.json` (`response: "wait"`, avec un faux signal)
**Quand** le bébé semble s'endormir
**Alors** un œil s'entrouvre (télégraphe de feinte) avant le vrai signal

**Étant donné** la feinte
**Quand** j'appuie sur le faux signal
**Alors** c'est un gag (le bébé se relève, bruit), avec `reason: "early"`

**Étant donné** le vrai signal
**Quand** j'appuie dans la fenêtre
**Alors** la réponse est réussie, comme pour toute menace `wait`

### Story 4.8 : Dépose-bombe

**Exigences :** FR40

En tant que joueur,
je veux poser le bébé endormi sur le matelas comme on désamorce une bombe,
afin de vivre le ralenti épique du moment le plus tendu de la soirée.

**Critères d'acceptation :**

**Étant donné** la séquence `bomb_drop` (musique de thriller, sueur au front, ralenti)
**Quand** elle démarre au-dessus d'une `ZONE_safe_*` (le parc du salon avant la story 4.10, le berceau ensuite)
**Alors** je dois maintenir (Fermeté) pendant toute la descente, dont la durée est dans le JSON, en relâchant au bon moment de la pose finale

**Étant donné** un relâchement trop tôt ou trop tard
**Quand** il est jugé
**Alors** le bébé se réveille (gag), et la séquence recule

**Étant donné** la Fermeté de la story 1.22
**Quand** cette story démarre
**Alors** si la story 1.22 n'a pas été livrée en E1, celle-ci l'implémente d'abord (mêmes critères que 1.22)

### Story 4.9 : Sortie en infiltration (réponse Ne rien faire)

**Exigences :** FR6, FR40

En tant que joueur,
je veux quitter la chambre sans faire grincer le parquet, en retenant mon souffle et en ignorant les fausses alertes,
afin de vivre une infiltration façon Metal Gear.

**Critères d'acceptation :**

**Étant donné** des `ZONE_creak_*`, ajoutées au salon greybox via Blender MCP par cette story
**Quand** papa marche dessus
**Alors** une latte grince (son, visuel, vibration), et le bruit monte de 3 % (source déjà prévue en 3.1)

**Étant donné** la commande `HoldAnywhere` (tactile : maintien n'importe où ; clavier : maintien de E ; manette : maintien de RT ; uniquement pendant l'infiltration)
**Quand** je retiens mon souffle
**Alors** une jauge de souffle de 6000 ms se vide ; à vide, ou en cas de relâchement trop tôt pendant un passage critique, le bruit monte de 5 %

**Étant donné** la réponse générique `nothing` (P2)
**Quand** le bébé émet une fausse alerte (soupir, `content/threats/false_alarm_sigh.json`)
**Alors** je réussis en n'agissant pas sur lui pendant la durée prévue ; toute commande qui le vise est un gag (`reason: "acted"`), alors que les autres actions restent permises

**Étant donné** un vrai réveil (télégraphe distinct de la fausse alerte)
**Quand** il survient
**Alors** je dois revenir bercer le bébé (Parer), sinon la séquence échoue

### Story 4.10 : Niveau « Chambre de nuit » et playtest du deuxième prototype

**Exigences :** FR40

En tant que joueur,
je veux enchaîner le cycle complet du dodo dans une chambre de nuit,
afin de vivre la soirée de bout en bout.

**Critères d'acceptation :**

**Étant donné** `assets-src/blender/chambre_night.blend`, bloqué en greybox via Blender MCP (berceau `ZONE_safe_crib`, `ZONE_creak_*`, porte, toilettes, ancres)
**Quand** il est exporté et extrait
**Alors** `content/levels/chambre_night.json` (variante `nap`) enchaîne `stay_awake` → `lullaby_walk` → `bedtime_duel` → `bomb_drop` → `stealth_exit`, avec des menaces de base entre les séquences

**Étant donné** le niveau
**Quand** le bot `perfect` le joue en headless
**Alors** il termine le cycle avec un statut de réussite ; le bot `idle` échoue, avec des fins cohérentes (réveil de Maman ou séquences ratées)

**Étant donné** `playtest:metrics`
**Quand** des journaux de « Chambre de nuit » sont analysés
**Alors** il ajoute le taux de réussite par séquence et par étape, pour valider qu'une séquence sans parade est amusante

## Epic 5 : Hygiène et état caché

*Stories cadrées, à réviser après le playtest du prototype.* Le joueur devine l'état caché du bébé et y répond avec le bon remède. Il affronte le change de couche en boss, le rhabillage et les soins, et esquive sa première menace rouge.

### Story 5.1 : Esquiver et vomi en jet

**Exigences :** FR4, FR49

En tant que joueur,
je veux esquiver d'un swipe la première menace qu'on ne peut pas parer,
afin d'apprendre qu'il ne faut pas tout parer.

**Critères d'acceptation :**

**Étant donné** la commande `Swipe{dir, t}` (tactile : swipe ; clavier : Maj + direction ; manette : B + direction) et la réponse `dodge`, avec une fenêtre de 250 ms
**Quand** `content/threats/projectile_vomit.json` (rouge, triangle) se déclenche
**Alors** un swipe dans la fenêtre esquive ; un tap ou un maintien est un gag (`wrongResponse`)
**Et** les tests générés couvrent les cas parfait, réussi, trop tôt, trop tard et mauvaise réponse

### Story 5.2 : États cachés du bébé et note réelle

**Exigences :** FR24, FR34

En tant que joueur,
je veux que la propreté, la faim et la fatigue du bébé évoluent sans que je les voie directement,
afin de devoir les deviner, et que Maman les juge.

**Critères d'acceptation :**

**Étant donné** `World.baby.needs` (`clean`, `fed`, `rested`), avec des évolutions définies dans `feel.json`
**Quand** le niveau se termine
**Alors** le composant « État du bébé » de la note vaut 10 points par état satisfait, et remplace `babyStateFixedPoints` (qui reste disponible pour les niveaux qui le déclarent)

### Story 5.3 : Odeur et renifler

**Exigences :** FR24

En tant que joueur,
je veux voir une traînée verte et pouvoir renifler la couche,
afin de vérifier mon hypothèse avant d'agir.

**Critères d'acceptation :**

**Étant donné** une couche sale
**Quand** le bébé se déplace
**Alors** une traînée verte le suit (avec un équivalent haptique quand papa est proche)

**Étant donné** papa près du bébé
**Quand** je le renifle (tap maintenu sur le bébé, 1000 ms)
**Alors** l'état de la couche est révélé, et le bruit monte de 3 %

### Story 5.4 : Pleurs typés et remèdes

**Exigences :** FR24

En tant que joueur,
je veux reconnaître pourquoi le bébé pleure et lui donner le bon remède,
afin de diagnostiquer au lieu de paniquer.

**Critères d'acceptation :**

**Étant donné** `content/cries/` (faim, couche, dents, fatigue, chacun avec sa signature sonore et visuelle et son remède : biberon, change, anneau, bercer)
**Quand** un pleur démarre
**Alors** il fait monter le bruit (+2 %/s), et seul le bon remède l'arrête

**Étant donné** un mauvais remède
**Quand** il est appliqué
**Alors** le pleur monte d'un cran, et le bruit de 5 %

### Story 5.5 : Pleur sans raison et couche de Schrödinger

**Exigences :** FR48

En tant que joueur,
je veux des situations sans bonne solution évidente,
afin de vivre la vraie vie de parent.

**Critères d'acceptation :**

**Étant donné** le pleur sans raison
**Quand** il démarre
**Alors** aucun remède ne l'arrête : seul bercer et tenir (Fermeté pendant 5000 ms) en vient à bout

**Étant donné** une dépose au lit (E4) avec une couche sale non vérifiée
**Quand** le dodo se termine
**Alors** il échoue (couche de Schrödinger), et le cycle est à refaire

### Story 5.6 : Rhabillage

**Exigences :** FR43

En tant que joueur,
je veux remettre un body à pressions à un bébé qui se raidit comme une planche,
afin de résoudre un puzzle d'escape game absurde.

**Critères d'acceptation :**

**Étant donné** la séquence `dressing_puzzle` (pressions qui ne tombent jamais en face, bras qui ressort par le col, raidissement)
**Quand** elle se déroule
**Alors** elle se résout uniquement avec Fermeté et Parer, et ses étapes sont définies en données

### Story 5.7 : Change de couche en boss

**Exigences :** FR42

En tant que joueur,
je veux affronter le change comme un combat de boss, avec une barre de vie… de la couche,
afin de rire d'une galère que tout parent connaît.

**Critères d'acceptation :**

**Étant donné** la séquence `diaper_boss` (attaques en JSON : jet surprise à esquiver, pied dans la couche, retournement, lingette qui manque)
**Quand** elle se déroule
**Alors** chaque attaque est une menace P1 enchaînée (Parer, Esquiver ou Fermeté), et la barre de vie de la couche baisse à chaque réussite

**Étant donné** une couche débordée
**Quand** le change se termine
**Alors** il enchaîne directement sur le rhabillage (story 5.6)

### Story 5.8 : Soins : lavage de nez et coupe d'ongles

**Exigences :** FR44

En tant que joueur,
je veux affronter le lavage de nez et la coupe d'ongles,
afin de surmonter les deux soins les plus redoutés.

**Critères d'acceptation :**

**Étant donné** la séquence `nose_wash`
**Quand** le bébé esquive de la tête
**Alors** la fenêtre est de 150 ms (surcharge propre à la menace)

**Étant donné** la séquence `nail_clip`
**Quand** elle se déroule
**Alors** il faut viser entre deux coups de pied (Attendre, puis Parer)

## Epic 6 : Âges suivants

*Stories cadrées, à réviser après playtest.* **Prérequis :** les catalogues des menaces des âges Enfance, Adolescence et Adulte doivent être écrits dans le GDD avant cet epic. Le ton du niveau Adulte reste à trancher (question ouverte du GDD).

### Story 6.1 : Chien et casserole

**Exigences :** FR30

En tant que joueur,
je veux qu'un chien et une casserole ajoutent du chaos,
afin de traiter des perturbations en plus du bébé.

**Critères d'acceptation :**

**Étant donné** `content/disruptions/dog.json` et `pot.json`
**Quand** elles se déclenchent
**Alors** le chien vole la purée, aboie (+10 % de bruit) et fait tomber des objets jusqu'à ce qu'on le détourne (Parer)
**Et** la casserole déborde après 30 000 ms d'oubli (bruit, bazar), et Parer baisse le feu

### Story 6.2 : Coolitude et désarmement

**Exigences :** FR45, FR46

En tant que joueur,
je veux retirer une fourchette au bébé sans geste brusque, en l'échangeant contre un objet plus cool,
afin de vivre une négociation de prise d'otage.

**Critères d'acceptation :**

**Étant donné** `content/objects/` (`coolness` de 1 à 10) et la jauge de calme (de 0 à 100, départ à 50)
**Quand** papa glisse trop vite vers le bébé
**Alors** le calme baisse de 30 ; sous 20, le bébé agite l'objet

**Étant donné** papa qui tient un objet
**Quand** je le propose au bébé
**Alors** l'échange réussit seulement si l'objet proposé est plus cool que l'objet tenu
**Et** la variante « truc dans la bouche » se résout par Fermeté, puis Parer au desserrement

### Story 6.3 : Préparation entre les vagues

**Exigences :** FR47

En tant que joueur,
je veux sécuriser la pièce entre deux vagues,
afin d'anticiper au lieu de seulement réagir.

**Critères d'acceptation :**

**Étant donné** le flux `prep` entre deux vagues (durée dans le niveau)
**Quand** il est actif
**Alors** je peux poser des cache-prises et des barrières, et monter des objets en hauteur ; les menaces correspondantes sont neutralisées pour la suite

**Étant donné** une vague
**Quand** le regard du bébé se pose sur une zone oubliée
**Alors** elle est révélée et doit être sécurisée en urgence

### Story 6.4 : Petite enfance : jauge d'attention et provocation

**Exigences :** FR6, FR50

En tant que joueur,
je veux un enfant de 3 ans qui teste mes réactions,
afin d'apprendre que la retenue est parfois la bonne réponse.

**Critères d'acceptation :**

**Étant donné** la jauge d'attention (−5/s quand papa s'occupe de lui-même, +10 par interaction)
**Quand** elle atteint 0
**Alors** l'enfant passe à l'interdit

**Étant donné** une provocation (réponse `nothing` ou Parer en douceur)
**Quand** je réponds par une Fermeté excessive
**Alors** l'enfant recommence deux fois plus vite

### Story 6.5 : Petite enfance : crises, coups, aide invisible et fugue

**Exigences :** FR50

En tant que joueur,
je veux affronter les crises de colère, les coups, la fugue et l'aide invisible,
afin de vivre la parade la plus littérale du jeu.

**Critères d'acceptation :**

**Étant donné** le contenu de l'âge (crise de colère en boss, coups et morsures, aide invisible, fugue et escalade avec plongeon-rattrapage au ralenti)
**Quand** le niveau se déroule
**Alors** chaque situation se ramène aux cinq réponses et est définie en données
**Et** si l'enfant repère papa pendant l'aide invisible, c'est la crise

### Story 6.6 : Niveau Enfance

**Exigences :** FR51

En tant que joueur,
je veux protéger un enfant de 5 à 11 ans de dangers à distance,
afin d'apprendre à anticiper et à sécuriser de loin.

**Critères d'acceptation :**

**Étant donné** le catalogue Enfance écrit dans le GDD
**Quand** le niveau est implémenté
**Alors** ses menaces sont des `ThreatDef` avec des télégraphes à distance, et la réponse « Attendre à distance » est couverte

### Story 6.7 : Niveau Adolescence

**Exigences :** FR51

En tant que joueur,
je veux tenir un duel verbal sous pression de temps,
afin de doser calme et fermeté face à un ado.

**Critères d'acceptation :**

**Étant donné** le catalogue Adolescence
**Quand** le niveau est implémenté
**Alors** les répliques sont des menaces à Parer ou à tenir en Fermeté, en duel chronométré, définies en données

### Story 6.8 : Niveau Adulte

**Exigences :** FR51

En tant que joueur,
je veux un dernier niveau où la bonne réponse est de ne plus parer,
afin de passer l'examen final du fil de la retenue.

**Critères d'acceptation :**

**Étant donné** le catalogue Adulte et le ton tranché par Geo
**Quand** le niveau est implémenté
**Alors** la réponse dominante est `nothing`, et l'action est le plus souvent pénalisée

### Story 6.9 : Sélection des âges et tutoriel implicite

**Exigences :** FR52, NFR6

En tant que joueur,
je veux choisir un âge débloqué, et découvrir le premier niveau sans un mot d'explication,
afin de progresser d'âge en âge.

**Critères d'acceptation :**

**Étant donné** un niveau par âge
**Quand** j'ouvre le menu
**Alors** les âges débloqués (au moins 2 étoiles sur le précédent) sont jouables, et les autres sont verrouillés

**Étant donné** le premier niveau
**Quand** il démarre
**Alors** la vague 1 ne présente qu'une menace à la fois, avec son verbe affiché, et aucune explication textuelle

## Epic 7 : Production art et audio

*Stories cadrées.* Le jeu quitte les cubes.

### Story 7.1 : Pièces modélisées dans Blender

**Exigences :** FR70

En tant que joueur,
je veux des pièces modélisées dans le style final,
afin que le monde soit lisible et charmant.

**Critères d'acceptation :**

**Étant donné** le pipeline de la story 1.5
**Quand** une pièce finale remplace une greybox
**Alors** les conventions de nommage, la géométrie extraite et les tests de niveau restent valides, sans changement de code de la sim
**Et** le budget de performance (`perf.spec.ts`) est respecté

### Story 7.2 : Personnages riggés et animés

**Exigences :** FR70

En tant que joueur,
je veux voir papa, le bébé, les enfants, Maman et le chien animés avec du squash and stretch,
afin que les gags et les réussites soient expressifs.

**Critères d'acceptation :**

**Étant donné** des `.glb` riggés dans `public/assets/characters/`
**Quand** les vues les chargent
**Alors** un `AnimationMixer` par vue joue les animations déclenchées par les événements et états de la sim, et la dégaine de papa (`World.papa.look`) change son apparence

### Story 7.3 : Rendu toon final et effets

**Exigences :** FR70

En tant que joueur,
je veux un rendu cartoon cohérent, avec contours et palette vive,
afin que le style tienne sur tous les écrans.

**Critères d'acceptation :**

**Étant donné** `src/client/render/materials/`
**Quand** le rendu final est en place
**Alors** les dangers ont une teinte d'alerte réservée, et les budgets de performance tiennent sur les appareils de référence
**Et** WebGPU est réévalué (ADR-008), avec une décision documentée dans l'architecture

### Story 7.4 : Célébration finale et cadrages parodiques

**Exigences :** FR62

En tant que joueur,
je veux une célébration démesurée sur la dernière réponse, et des cadrages de film pour chaque séquence,
afin de vivre le contraste épique / banal.

**Critères d'acceptation :**

**Étant donné** la dernière réponse réussie d'un niveau
**Quand** elle est jugée
**Alors** une célébration (chœur d'opéra, feu d'artifice) se joue, avec ses équivalents visuels et haptiques

**Étant donné** chaque séquence spéciale
**Quand** elle se joue
**Alors** elle applique la grammaire visuelle de sa référence (action, infiltration, prise d'otage, désamorçage), définie dans son JSON

### Story 7.5 : Musique adaptative par âge et bibliothèque sonore

**Exigences :** FR60, FR70

En tant que joueur,
je veux une musique propre à chaque âge, qui suit l'action,
afin que chaque âge ait son identité.

**Critères d'acceptation :**

**Étant donné** `content/music/` (stems et règles par âge)
**Quand** un niveau se joue
**Alors** la musique adaptative de la story 2.6 utilise les stems de l'âge, et chaque son de la bibliothèque respecte la convention `<catégorie>_<nom>.m4a`

## Epic 8 : Distribution mobile

*Stories cadrées.* **Prérequis :** le modèle économique est tranché avant cet epic.

### Story 8.1 : Builds iOS et Android via Capacitor

**Exigences :** FR69, NFR13

En tant que joueur mobile,
je veux installer le jeu sur mon téléphone, avec une haptique native et une sauvegarde fiable,
afin de jouer partout, même hors ligne.

**Critères d'acceptation :**

**Étant donné** `capacitor.config.ts` et `src/platform/native/` (`@capacitor/haptics`, `@capacitor/app`, `@capacitor/preferences`)
**Quand** l'app tourne sur iOS ou Android
**Alors** l'orientation est verrouillée en paysage, l'haptique native remplace `navigator.vibrate`, et la pause automatique passe par `appStateChange`
**Et** la sauvegarde utilise `@capacitor/preferences`, via le même `StoragePort`

### Story 8.2 : Audio et latence sur appareils réels

**Exigences :** FR69, NFR1, NFR2

En tant que joueur mobile,
je veux que le son et le timing soient aussi justes que sur le web,
afin que les réponses soient jugées équitablement.

**Critères d'acceptation :**

**Étant donné** les appareils de référence
**Quand** la calibration et un niveau complet sont joués dans la WebView
**Alors** les budgets NFR1 et NFR2 sont tenus ; sinon, un plugin audio natif est évalué et la décision est documentée

### Story 8.3 : Fiches stores et builds de release

**Exigences :** FR69, NFR14

En tant que Geo,
je veux publier le jeu sur l'App Store et sur Google Play,
afin que les joueurs le trouvent.

**Critères d'acceptation :**

**Étant donné** les builds de release
**Quand** ils sont soumis
**Alors** TestFlight et la Play Console reçoivent des builds signés, et les fiches stores (textes, captures, classification tout public, politique de confidentialité « aucune donnée collectée ») sont prêtes
