---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
readiness: NEEDS WORK (léger) → READY (prototype) après corrections
previousReport: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-26.md
documentsIncluded:
  gdd: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md
  architecture: _bmad-output/planning-artifacts/game-architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux:
    - _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md
    - _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md
  annexes:
    - _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/mockups/
    - _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/.decision-log.md
    - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/epics.md
    - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md
language: fr
---

# Rapport de readiness d'implémentation (v2, après la spécification UX)

**Date :** 2026-10-26
**Projet :** papa-parade
**Objet :** deuxième passage, après la finalisation de la spécification UX. Le premier rapport (`implementation-readiness-report-2026-10-26.md`) reste la référence pour les corrections déjà appliquées. Celui-ci vérifie surtout l'alignement entre l'UX et les epics.

## Inventaire des documents

| Type | Fichier | Taille | Statut |
|---|---|---|---|
| GDD | `gdds/gdd-papa-parade-2026-10-26/gdd.md` (v2.1) | 37 Ko | Retenu |
| Architecture | `game-architecture.md` | 91 Ko | Retenu |
| Epics et stories | `epics.md` | 114 Ko | Retenu, fait foi |
| UX : identité visuelle | `ux-designs/ux-papa-parade-2026-10-26/DESIGN.md` | 32 Ko | **Nouveau**, retenu |
| UX : comportement et parcours | `ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md` | 53 Ko | **Nouveau**, retenu |
| UX : maquettes | `ux-designs/…/mockups/` (fridge, hud-level, pause, result) | 4 fichiers | Référence visuelle ; en cas de conflit, les deux fichiers UX ci-dessus priment |
| Annexes | `gdds/…/epics.md`, `gdds/…/decision-log.md`, `ux-designs/…/.decision-log.md` | — | Contexte |

**Problèmes à l'inventaire :** aucun. `_bmad-output/game-architecture.md` n'est qu'un pointeur (279 octets), donc il ne compte pas comme doublon.

## Analyse du GDD

Le GDD v2.1 a été relu en entier. Il intègre les corrections G1 (gestes sur le bébé), G2 (seuil unique de 0,4 s) et G3 (fenêtres en temps de jeu, appui trop tôt) issues du premier rapport. Le GDD ne numérote pas ses exigences ; la numérotation ci-dessous est celle de l'inventaire de `epics.md`, **revérifiée ligne à ligne contre le GDD v2.1**. Aucun écart de contenu n'a été trouvé.

#### Exigences fonctionnelles

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

#### Exigences non fonctionnelles

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

### Exigences supplémentaires

Elles sont inchangées depuis le premier rapport : règle d'or de production, dépendances (Blender + Blender MCP, Capacitor), Steam reporté, hors scope v1, questions ouvertes (modèle économique, ton du niveau Adulte) et les 7 hypothèses indexées du GDD. Les exigences tirées de l'architecture figurent dans `epics.md`, section « Exigences supplémentaires (architecture) ».

### Suivi des écarts du GDD (G1 à G8)

| # | Écart | Statut |
|---|---|---|
| G1 | Intention du tap sur le bébé | ✅ Résolu : GDD v2.1 (Contrôles), FR12 |
| G2 | Seuil Parer / Fermeté | ✅ Résolu : seuil unique de 0,4 s dans le GDD v2.1 |
| G3 | Fenêtres en temps de jeu, `earlyPress` | ✅ Résolu : GDD v2.1 (Règles d'entrée, Fenêtres de timing) |
| G4 | Touches E / RT du souffle retenu | ✅ Résolu : story 4.9 |
| G5 | Variantes de réponse (cache-prise, jouet) | ⏳ Ouvert, mineur |
| G6 | « Glissade trop rapide » du désarmement | ⏳ Ouvert, à trancher avant la story 6.2 |
| G7 | Principe « une nouvelle réponse à la fois » | ⏳ Ouvert, à appliquer en E6 |
| G8 | Qui produit les rigs et les animations | ⏳ Ouvert, v1 (E7) |

### Évaluation de la complétude du GDD

Le GDD v2.1 est à jour par rapport à l'architecture. Aucun nouvel écart. Il reste suffisant pour le prototype ; les catalogues des âges 3 à 5 manquent toujours, ce qui bloque E6 mais pas le prototype.

## Validation de la couverture par les epics

### Matrice de couverture

La matrice est construite à partir des lignes « Exigences : » des 78 stories de `epics.md`, et non de la seule carte de couverture : une FR n'est comptée que si une story la cite. La carte de couverture de `epics.md` concorde avec cette matrice.

| FR | Phase | Exigence (extrait) | Stories | Statut |
|---|---|---|---|---|
| FR1 | `[P]` | chaque menace suit le cycle télégraphe → délai → fenêtre de réponse → résultat (parfaite… | 1.9, 1.10 | ✓ Couverte |
| FR2 | `[P]` | Parer = tap sur la menace, fenêtre de 300 ms ; un relâchement avant 400 ms compte comme… | 1.9, 1.10 | ✓ Couverte |
| FR3 | `[P]` (si le temps le permet) | Fermeté = maintien d'au moins 0,4 s sur la menace ; appui dans la fenêtre de 300 ms, mai… | 1.22 | ✓ Couverte |
| FR4 | `[V1]` | Esquiver = swipe dans une direction, fenêtre de 250 ms, réservé aux menaces rouges. | 5.1 | ✓ Couverte |
| FR5 | `[P2]` | Attendre = aucune action jusqu'au signal, puis tap dans les 300 ms qui suivent ; un appu… | 4.6 | ✓ Couverte |
| FR6 | `[P2]` | Ne rien faire = aucune action sur la menace visée pendant 1,5 à 3 s ; le joueur peut tra… | 4.9, 6.4 | ✓ Couverte |
| FR7 | `[P]` | le timing est mesuré à l'appui. Délai télégraphe → fenêtre : 0,8 à 1,5 s selon la menace… | 1.9 | ✓ Couverte |
| FR8 | `[P]` | hitstop de 80 ms sur réponse réussie ; ralenti ×0,3 pendant 1,2 s sur réponse parfaite ;… | 1.13, 1.17 | ✓ Couverte |
| FR9 | `[P]` | glissade freeflow. Taper une menace fait glisser papa automatiquement jusqu'à elle, en 0… | 1.10 | ✓ Couverte |
| FR10 | `[P]` | déplacement par tap au sol (tactile), ZQSD ou flèches (clavier), stick gauche (manette). | 1.6 | ✓ Couverte |
| FR11 | `[P]` | au clavier et à la manette, la menace la plus urgente dans la direction visée est ciblée… | 1.16 | ✓ Couverte |
| FR12 | `[P]` | interaction contextuelle par tap sur l'objet (boire un café, décrocher), Espace ou A. Le… | 1.16, 1.18 | ✓ Couverte (le tap pour trouver le bébé est en 1.20, pour le prendre en 4.1, le reniflage en 5.3 ; ces stories ne citent pas FR12) |
| FR13 | `[P]` | orientation paysage. | 1.4 | ✓ Couverte |
| FR14 | `[P]` | pause possible à tout moment et automatique quand l'app passe en arrière-plan ; reprise… | 1.4 | ✓ Couverte |
| FR15 | `[P]` | le bébé se déplace, choisit ses cibles parmi les menaces du niveau, et son regard se ver… | 1.7, 1.9 | ✓ Couverte |
| FR16 | `[P]` | fatigue de 0 à 100, +0,5/s (×2 en portant le bébé). Au-dessus de 70 : fenêtres réduites… | 1.18 | ✓ Couverte |
| FR17 | `[P2]` | envie pressante de 0 à 100, +0,4/s ; à 100, déplacements ralentis de 30 % ; toilettes =… | 4.3 | ✓ Couverte |
| FR18 | `[P]` | jauge de bruit (niveaux Sieste). Elle monte avec les cris (+2 %/s), les objets qui tombe… | 3.1 | ✓ Couverte |
| FR19 | `[P]` | silence-télégraphe. Quand le bébé est hors du champ de vision et que son babillage s'arr… | 1.20 | ✓ Couverte |
| FR20 | `[P]` | instinct paternel. Quand au moins 3 menaces sont actives et que le joueur a raté 2 répon… | 2.9 | ✓ Couverte |
| FR21 | `[P]` | physique légère ; les objets tombent, roulent, rebondissent et provoquent des accidents… | 1.14 | ✓ Couverte |
| FR22 | `[P2]` | bras-bébé. Porter le bébé neutralise ses menaces directes. Papa n'a plus qu'une main (Pa… | 4.1 | ✓ Couverte |
| FR23 | `[P2]` | combo de x1 à x8. Il gagne +1 par réponse réussie et +1 toutes les 10 s où papa porte le… | 4.2 | ✓ Couverte |
| FR24 | `[V1]` | états cachés du bébé (propre, nourri, reposé), devinés grâce à des indices : traînée ver… | 5.2, 5.3, 5.4 | ✓ Couverte |
| FR25 | `[P]` | prise électrique. Télégraphe : regard fixe, icône éclair, grésillement. Délai 1,2 s, Par… | 1.9, 1.10 | ⚠️ Partielle : la variante « poser un cache-prise » relève de la préparation (6.3) ; G5 |
| FR26 | `[P]` | escalier. Télégraphe : le bébé accélère, halo sur la marche. Délai 1,0 s, Parer (interce… | 1.15 | ✓ Couverte |
| FR27 | `[P]` | objet sur la table basse. Télégraphe : le bébé se hisse, icône de l'objet. Délai 1,5 s,… | 1.15 | ⚠️ Partielle : la variante « détourner avec un jouet » n'est pas dans 1.15 ; G5 |
| FR28 | `[P]` | silence suspect. Délai 2 s ; trouver le bébé, puis Parer. Gag : une bêtise surprise tiré… | 1.20 | ✓ Couverte |
| FR29 | `[P]` | téléphone qui sonne (perturbation). Décrocher : fatigue +10 et attention détournée 5 s.… | 1.19 | ✓ Couverte |
| FR30 | `[V1]` | chien (vole la purée, aboie avec bruit +10 %, fait tomber des objets ; Parer pour le dét… | 6.1 | ✓ Couverte |
| FR31 | `[P]` | les menaces s'empilent par vagues. Vague 1 : une à la fois. Vague 2 : deux simultanées.… | 1.17 | ✓ Couverte |
| FR32 | `[P]` | variante Sieste. Fin normale au chrono (3 min dans le prototype, 4 min en v1) ; fin anti… | 3.2 | ✓ Couverte |
| FR33 | `[V1]` | variante Retour (3 min, Maman rentre à la fin du chrono, sans fin anticipée). | 3.10 | ✓ Couverte |
| FR34 | `[P]` | note de Maman. Score = Rire (0–40) + État du bébé (0–30) + 30 − Soupir (0–15) − Hurlemen… | 1.21, 4.2, 5.2 | ✓ Couverte |
| FR35 | `[V1]` | séquence de fin. La porte s'ouvre → rush final (les 10 dernières secondes pour tout plan… | 3.5, 3.6, 3.7 | ✓ Couverte |
| FR36 | `[V1]` | les répliques de Maman se souviennent des parties précédentes (« *Encore* l'étagère ?! »). | 3.8 | ✓ Couverte |
| FR37 | `[V1]` | la dégaine de papa se dégrade visiblement pendant le niveau (purée sur la joue, cheveux… | 3.7 | ✓ Couverte |
| FR38 | `[V1]` | replay des meilleurs moments, façon match de sport. | 3.9 | ✓ Couverte |
| FR39 | `[V1]` | un niveau est réussi à partir de 1 étoile ; l'âge suivant se débloque à partir de 2 étoi… | 3.11 | ✓ Couverte |
| FR40 | `[P2]` | cycle du dodo. | 4.4, 4.5, 4.6, 4.8, 4.9, 4.10 | ✓ Couverte |
| FR41 | `[P2]` | faux sommeil, attaque retardée façon Elden Ring (Attendre). | 4.7 | ✓ Couverte |
| FR42 | `[V1]` | change de couche en boss. | 5.7 | ✓ Couverte |
| FR43 | `[V1]` | rhabillage façon puzzle (les pressions ne tombent jamais en face, le bras ressort par le… | 5.6 | ✓ Couverte |
| FR44 | `[V1]` | soins. Lavage de nez : le bébé esquive de la tête, fenêtre de 150 ms. Coupe d'ongles : p… | 5.8 | ✓ Couverte |
| FR45 | `[V1]` | désarmement. | 6.2 | ⚠️ La règle de la « glissade trop rapide » n'est pas implémentable telle quelle ; G6 |
| FR46 | `[V1]` | coolitude des objets (1 à 10 : cuillère 2, fourchette 4, jouet 5, télécommande 7, téléph… | 6.2 | ✓ Couverte |
| FR47 | `[V1]` | préparation entre deux vagues (cache-prises, barrières, objets en hauteur) ; pendant les… | 6.3 | ✓ Couverte |
| FR48 | `[V1]` | pleur sans raison, inparable (bercer et tenir, Fermeté pendant 5 s) ; couche de Schrödin… | 5.5 | ✓ Couverte |
| FR49 | `[V1]` | vomi en jet, première menace rouge, à esquiver. | 5.1 | ✓ Couverte |
| FR50 | `[V1]` | petite enfance. | 6.4, 6.5 | ✓ Couverte |
| FR51 | `[V1]` | âges Enfance (dangers à distance), Adolescence (duel verbal sous pression de temps) et A… | 6.6, 6.7, 6.8 | ✓ Couverte |
| FR52 | `[V1]` | un niveau par âge, chacun dans une pièce. Le premier niveau sert de tutoriel implicite :… | 6.9 | ✓ Couverte |
| FR53 | `[P]` | un verbe d'un mot s'affiche en gros sur chaque menace (SOULÈVE !, FERME !, ÉCHANGE !…). | 2.2 | ✓ Couverte |
| FR54 | `[P]` | code couleur doublé par une forme d'icône (bleu et cercle = parable ; rouge et triangle… | 2.2 | ✓ Couverte |
| FR55 | `[P]` | paliers de difficulté. Assistance : fenêtres +50 %, instinct actif. Normal. Papa expérim… | 2.8 | ✓ Couverte |
| FR56 | `[P]` | calibration de la latence au premier lancement (tap en rythme sur 8 temps, en deux phase… | 2.7 | ✓ Couverte |
| FR57 | `[P]` | retour haptique sur mobile : vibration courte à chaque télégraphe, vibration marquée sur… | 2.4 | ✓ Couverte |
| FR58 | `[P]` | un son distinct par télégraphe, un son culte par type de réponse (couinement de jouet, c… | 2.3 | ✓ Couverte |
| FR59 | `[P]` | chaque signal sonore a un équivalent visuel (ondes, bulles) et un équivalent haptique. | 1.8, 2.4 | ✓ Couverte |
| FR60 | `[P]` (base) et `[V1]` (complète) | musique adaptative, douce au calme, nerveuse quand une menace approche ; elle bascule en… | 2.6, 7.5 | ✓ Couverte |
| FR61 | `[P]` | effets de feeling. Hitstop, tremblement d'écran et particules ; sur réponse parfaite, ra… | 2.5 | ✓ Couverte |
| FR62 | `[V1]` | célébration démesurée sur la dernière réponse d'un niveau (chœur d'opéra, feu d'artifice… | 7.4 | ✓ Couverte |
| FR63 | `[P]` | l'audio se déverrouille au premier tap dans le navigateur. | 1.8 | ✓ Couverte |
| FR64 | `[P]` | menaces, niveaux et âges sont des données éditables hors code, que l'IA peut générer et… | 1.2, 1.5 | ✓ Couverte |
| FR65 | `[P]` | tous les paramètres de feeling se règlent sans toucher à la logique, dans un fichier uni… | 1.2, 2.1 | ✓ Couverte |
| FR66 | `[P]` | le jeu peut être lancé et joué de bout en bout sans intervention humaine. | 1.11, 1.12 | ✓ Couverte |
| FR67 | `[P]` | un build web est partageable par lien pour les playtests. | 1.23 | ✓ Couverte |
| FR68 | `[P]` | les cinq indicateurs de gameplay sont mesurables sur au moins 5 testeurs (critère de sor… | 3.3, 3.4 | ✓ Couverte |
| FR69 | `[V1]` | builds iOS et Android via Capacitor (haptique, audio, paysage) et préparation des fiches… | 8.1, 8.2, 8.3 | ✓ Couverte |
| FR70 | `[V1]` | production art et audio. Pièces entières dans Blender, utilisé comme éditeur de niveaux… | 7.1, 7.2, 7.3, 7.5 | ✓ Couverte |

### Exigences manquantes

Aucune : chacune des 70 FR est citée par au moins une story, et les 14 NFR aussi. Aucune FR n'apparaît dans les epics sans exister dans le GDD.

**Évolution depuis le premier rapport :**
- FR6 et FR17 : étiquettes corrigées en `[P2]`, l'incohérence est levée ;
- FR12 : l'intention du tap sur le bébé est tranchée (G1), l'incohérence est levée ;
- FR40 : les touches E et RT figurent dans la story 4.9, l'incohérence est levée ;
- **restent partielles :** FR25 et FR27 (G5, mineur) et FR45 (G6, à trancher avant la story 6.2).

### Statistiques de couverture

- FR du GDD : 70
- FR couvertes par au moins une story : 70
- Taux de couverture : 100 %
- Couverture complète : 67 ; partielle ou à préciser : 3
- NFR couvertes : 14 sur 14

## Évaluation de l'alignement UX

### Statut du document UX

**Trouvé :** deux fichiers, tous deux en `status: final`, et quatre maquettes.
- `DESIGN.md` porte l'identité visuelle : tokens, typographie, 30 composants.
- `EXPERIENCE.md` porte le comportement : architecture d'information, textes à l'écran, états par surface, entrées, juice, mouvement réduit, accessibilité et 3 parcours.

La spécification a été écrite **à partir de `epics.md` et du premier rapport**. Elle cite donc les stories, ce qui facilite l'alignement. En revanche, aucune story ne cite l'UX en retour.

> ⚠️ **Toutes les décisions marquées `[ASSUMPTION]`** (la grande majorité des textes, seuils, couleurs et parcours) **attendent la relecture de Geo**. Si on implémente avant cette relecture, les stories d'UI risquent d'être reprises.

### Suivi des constats UX du premier rapport

| # | Constat (v1) | Statut |
|---|---|---|
| U1 | Zones sûres en paysage | ✅ Story 1.4 ; l'UX le confirme (`hud-inset`, `screen-margin`) |
| U2 | Cibles tactiles, taille de texte | ✅ Stories 1.4 et 1.21 ; l'UX fixe 44 × 44 pt, un plancher de texte à 16 px et des verbes d'au moins 28 px |
| U3 | Disposition du HUD | ✅ Story 1.4 ; l'UX détaille les zones (une seule pastille de jauges, hiérarchie, fondu) |
| U4 | Écran de démarrage | ✅ Story 1.4 ; l'UX décrit le parcours complet du premier lancement |
| U5 | Système de design | ✅ Résolu par `DESIGN.md` |

### Alignement UX ↔ GDD

Il n'y a **aucune contradiction**. Les commandes (tap, maintien de 0,4 s, renifler en maintien de 1 s, swipe, maintien n'importe où), les verbes, le code couleur doublé d'une forme, l'absence de game over et de tutoriel textuel, et la note de Maman (4 lignes dont la somme redonne la formule du GDD) sont fidèles au GDD.

L'UX **ajoute** des éléments absents du GDD. Ce sont tous des choix `[ASSUMPTION]`, cohérents avec les piliers :
- le Frigo comme écran d'accueil ;
- un premier lancement qui mène directement à l'Âge 1, sans menu ;
- la carte d'échecs répétés, qui propose le mode Assistance ;
- les réglages « Réduire les animations » et « Grands verbes » ;
- les Crédits ;
- le tampon « PARADE PARFAITE » ;
- les glyphes de touches au clavier et à la manette ;
- la préparation à la localisation.

### Alignement UX ↔ Architecture

L'architecture soutient l'UX : UI en DOM vanilla avec `CSS2DRenderer`, classes `pp-*`, `tokens.css`, ≤ 50 ms entre le tap et le retour visuel, testabilité par Playwright, aucun `backdrop-filter`, pooling. Le mouvement réduit ne touche ni au hitstop ni aux ralentis, et préserve donc le déterminisme de la sim. Il reste six écarts, tous mineurs, sans remise en cause d'un ADR :

| # | Écart | Correction proposée |
|---|---|---|
| A1 | **Textes de l'UI :** l'UX place toutes les chaînes et les `aria-label` dans `content/strings.fr.json` ; ce fichier n'existe ni dans l'arborescence ni dans les schémas de l'architecture. | Ajouter `StringsSchema` et la vérification dans `content:check` (story 1.2), et l'utiliser dès 1.4. |
| A2 | **Sauvegarde :** l'architecture liste calibration, palier, volumes, haptique, étoiles et mémoire de Maman. L'UX y ajoute `reducedMotion`, `largeVerbs`, le compteur d'échecs consécutifs par niveau et le marqueur « âge déjà vu » (pour le label « Nouveau ! »). | Étendre `SaveSchema` dans les stories consommatrices (2.8, 3.11), avec migration. |
| A3 | **Calibration :** l'UX permet de sauter la phase audio (« Pas de son ? Passe au visuel ») ; P5 suppose que les deux phases ont été faites. Les séquences rythmiques (E4) lisent `audioOffsetMs`. | Définir une valeur de repli (par exemple `audioOffsetMs = visualOffsetMs`) et un indicateur `audioSkipped`, dans la story 2.7. |
| A4 | **Flux de l'app :** `appFsm` (boot → calibration → menu → niveau → résultat) ne contient ni l'écran de démarrage, ni Réglages, ni Crédits, ni « Oups ». Le premier lancement ne passe pas par le menu. | Compléter `appFsm` dans la story 1.4, puis 2.7 et 3.11. |
| A5 | **Entrées :** les touches sont liées par `KeyboardEvent.code` (ZQSD ou WASD selon la position physique) ; il faut `navigator.keyboard.getLayoutMap()`, la famille de manette pour les glyphes, la pause par Échap ou Start et `gamepaddisconnected`. Rien de cela n'est dans la chaîne d'entrées de l'architecture. | Ajouter aux stories 1.6, 1.16 et 1.4. |
| A6 | **Polices :** trois familles en woff2 auto-hébergées (Baloo 2, Anton, Nunito). L'architecture ne les mentionne pas, et la CSP de la story 1.23 doit les autoriser (`font-src 'self'`). | Ajouter à 1.4 (chargement) et 1.23 (CSP). |

### Alignement UX ↔ Epics (le cœur de cette passe)

| # | Constat | Impact | Stories visées |
|---|---|---|---|
| X1 | **La section « Exigences de design UX » de `epics.md` dit encore qu'il n'existe pas de document UX**, et aucune story ne référence `DESIGN.md` ni `EXPERIENCE.md`. Un agent de dev qui lit une story ne verra donc pas l'UX. | 🟠 Majeur, prototype | Inventaire, puis toutes les stories d'UI |
| X2 | **Panneau de pause absent.** La story 1.4 ne couvre que le bouton, `visibilitychange` et le décompte. Il manque : les actions (Reprendre · Recommencer · Réglages · Quitter vers le frigo, ce dernier en deux temps), les déclencheurs Échap, Start/Options et retour Android, la pause automatique à la déconnexion de la manette (avec son message), le HUD atténué sous le voile, le focus par défaut et la règle « les overlays ne s'empilent jamais ». | 🟠 Majeur, prototype | 1.4 (et 1.16 pour la déconnexion) |
| X3 | **Mouvement réduit et « Grands verbes »** : ce sont deux réglages nouveaux, et le mouvement réduit est un comportement transverse (tremblement, rotation de caméra, zoom à 50 %, particules −60 %, flash remplacé par une lueur, bulle à 1 Hz, panneaux en fondu, biberon statique). Aucune story ne les porte. La story 2.8 ne prévoit pas non plus les Crédits, la ligne Vibrations masquée sans haptique, les descriptions des paliers ni l'enregistrement instantané. | 🟠 Majeur, E2 | 2.8, 2.5, 1.20, 1.5 |
| X4 | **Écran de résultat.** Il faut aligner la story 1.21 sur l'UX : lignes positives « Rires » /40, « État du bébé » /30, « Sans soupir » /15, « Sans hurlement » /15 (et non des composantes négatives) ; actions selon le cas ; « Copier le journal » visible **seulement dans les builds de playtest** avec la confirmation « Journal copié ! » ; ordre photo → Maman → lignes et étoiles → REPLAY → actions. **La carte d'échecs répétés** (3 résultats ≤ 1★ de suite hors Assistance) n'est portée par aucune story. | 🟡 Moyen, prototype | 1.21, 3.3, 3.7, 3.9, 3.11 ; nouvelle AC pour la carte (3.11 ou 2.8) |
| X5 | **Parcours de premier lancement et Frigo.** L'UX prévoit : Démarrage → Calibration → Âge 1 au premier lancement, puis le Frigo au lancement suivant. La story 3.11 crée un « menu de sélection des niveaux » générique ; l'UX en fait le Frigo (polaroïds, aimants, emplacements « ? », chute « Nouveau ! », aimant vers Réglages). Rien ne dit ce qui remplace le Frigo dans le prototype, avant 3.11 (relancer le niveau, et masquer « Quitter vers le frigo » et « Frigo »). | 🟡 Moyen | 1.4, 1.21, 3.11, 6.9 |
| X6 | **Invites clavier et manette.** Le `glyph-chip` (un seul glyphe à côté du verbe ciblé, `getLayoutMap`, glyphes Xbox ou PlayStation, aucun sur tactile) et le binding par `KeyboardEvent.code` ne sont dans aucune story. Or le playtest au clavier, qui fournit le ratio tactile/clavier de NFR11, en dépend. | 🟡 Moyen, prototype | 1.6, 1.16 |
| X7 | **Calibration :** il manque le saut de la phase audio, la prise en compte d'Espace et de A, le redémarrage de la phase en arrière-plan, le fond `ink` et les textes (« Calé ! »). Voir aussi A3. | 🟡 Moyen, E2 | 2.7 |
| X8 | **Composants UX sans critère :** le tampon « PARADE PARFAITE » (900 ms au plus, sans bloquer l'entrée) ; le `hold-ring` (retour visuel du seuil de 400 ms, et du reniflage) ; la `sequence-bar` sous le chrono, avec le chrono en version compacte ; le biberon de chargement et ses phrases d'ambiance ; la forme de la `target-highlight` (contour et chevron, distincts du halo) ; l'animation du `tap-marker`. | 🟡 Moyen | 2.5, 1.22 et 5.3, 4.4, 5.7 et 6.2, 1.5, 1.10 et 1.16, 1.6 |
| X9 | **Détails du HUD :** jauges dans une seule pastille, dans l'ordre Bruit · Fatigue · Envie, 10 segments, opacité de 70 % au repos, passage en `gauge-warn` à partir de 70 % avec une pulsation, remplissage en `scaleX`. Le HUD est masqué pendant la séquence de fin. Budget d'UI : 40 nœuds DOM au plus pour le HUD, mises à jour regroupées une fois par frame. | 🟡 Moyen | 1.4, 1.17, 1.18, 3.1, 4.3, 1.23 |
| X10 | **Conflit de placement du combo :** la story 4.2 l'affiche « dans le HUD » ; l'UX en fait un badge ancré au monde au-dessus de papa, masqué à x1. | 🟡 Mineur, E4 | 4.2 |
| X11 | **Fondations de l'UI :** `tokens.css` doit refléter le frontmatter de `DESIGN.md` 1:1 (idéalement vérifié par un test), avec les polices auto-hébergées. Toutes les chaînes vont dans `strings.fr.json` (A1), chaque bouton porte un `aria-label` français, les menus sont navigables au clavier et à la manette avec un anneau de focus, et les mises en page tolèrent +30 % de longueur de texte. | 🟡 Moyen, prototype | 1.2, 1.4 |
| X12 | **Retour Android :** il met en pause pendant le jeu et revient d'un niveau dans les menus. | 🟢 Mineur, E8 | 8.1 |
| X13 | **Crédits :** lancés automatiquement à la première fin du niveau Adulte avec ≥ 1★. Leur contenu n'est pas défini. | 🟢 Mineur, v1 | 6.8 ou 6.9 |

### Incohérences internes de l'UX (à faire trancher par Geo)

- **Souffle retenu affiché deux fois :** le `breath-ring` autour de papa (Component Patterns), et une ressource « souffle » dans la `sequence-bar`. Il faut choisir l'un des deux, ou préciser le rôle de chacun.
- **Durée affichée par `hud-timer` :** l'UX indique 4 min pour la Sieste, mais le prototype (FR32) dure 3 min. Ce n'est pas bloquant si le chrono lit `durationMs` dans le niveau ; il faudra le préciser dans la story 1.17.

### Avertissements

- ⚠️ **L'UX est complète, mais elle n'a pas encore atteint les epics.** Sans correction de X1, les agents de dev implémenteront les stories sans connaître la spécification.
- ⚠️ **Les décisions `[ASSUMPTION]` ne sont pas encore validées.** Il est recommandé que Geo relise au moins la hiérarchie du HUD, le panneau de pause, l'écran de résultat et le parcours du premier lancement avant les stories 1.4 et 1.21.

## Revue de qualité des epics

La revue reprend les critères de `gds-create-epics-and-stories` sur les 78 stories (relues en entier). Elle porte surtout sur **l'impact de l'UX sur la structure** : les corrections Q1 à Q6 du premier rapport sont en place et n'ont pas été rouvertes.

### Structure des epics

Elle est inchangée : 8 epics orientés joueur, aucun epic technique, aucun epic qui dépend d'un epic ultérieur. La story 1.1 sert de story de démarrage (greenfield, `npm create vite`).

### 🔴 Violations critiques

**Aucune.**

### 🟠 Problèmes majeurs

| # | Problème | Exemple | Remédiation |
|---|---|---|---|
| Q7 | **La story 1.4 devient trop grosse si on y ajoute l'UX.** Elle cumule déjà la boucle client, le rendu iso, `timeMap`, la pause exacte, le portrait, l'écran de démarrage, les zones du HUD, les zones sûres et les cibles tactiles. Il faudrait encore y ajouter le panneau de pause (X2), `tokens.css` depuis `DESIGN.md`, les polices, `strings.fr.json`, `aria-label` et la navigation au focus (X11). | Un seul agent devrait livrer à la fois la boucle à pas fixe et un système d'UI complet. | **Scinder :** garder dans 1.4 la boucle, le rendu iso, `timeMap` et la pause exacte (sans UI), et créer une story **« Fondations de l'UI »** (tokens, polices, chaînes, écran de démarrage, overlay portrait, zones du HUD, panneau de pause, focus) insérée juste après. Cela demande une renumérotation de E1, comme pour Q1. |
| Q8 | **Aucune story ne porte le mouvement réduit ni « Grands verbes »** (X3). | La story 2.5 ajoute tremblement, zoom et particules sans variante réduite. | Ajouter une story **2.10 « Réglages d'accessibilité : mouvement réduit et grands verbes »**, qui reprend la table de correspondance de l'UX et s'appuie sur 2.5, 2.8, 1.20 et 1.5 (dépendances vers l'arrière seulement). |
| Q9 | **Les stories d'UI ne référencent pas l'UX** (X1). | 1.17, 1.18 et 3.1 disent « une jauge visible » sans en préciser la forme. | Réécrire la section « Exigences de design UX » de l'inventaire en **UX-DR numérotées**. Ajouter à chaque story d'UI une ligne `UX :` qui pointe vers les composants de `DESIGN.md` et `EXPERIENCE.md`, puis les critères listés en X2 à X12. |

### 🟡 Points mineurs

| # | Point | Remédiation |
|---|---|---|
| M11 | **Références vers l'avant dans E2 :** 2.7 rend « Recalibrer » « disponible dans les réglages », mais les réglages n'arrivent qu'en 2.8 ; 2.8 rend les réglages « accessibles depuis le menu », qui n'existe qu'en 3.11. | 2.7 expose seulement l'action ; c'est 2.8 qui ajoute la ligne « Recalibrer ». 2.8 se limite à « depuis la pause », et 3.11 ajoute l'accès par l'aimant du Frigo. |
| M12 | **Le tap sur le bébé** sert dès la story 1.20 (fin du silence), mais la commande `TapBaby` n'apparaît qu'en 4.1, et la priorité du hit-test (menace > objet > sol) ne cite pas le bébé. | 1.20 crée `TapBaby` et place le bébé dans la priorité du hit-test. 4.1 réutilise la commande. |
| M13 | **Conflit de placement du combo** (X10). | Dans 4.2, écrire « badge au-dessus de papa, masqué à x1 ». |
| M14 | **Le chrono** doit lire `durationMs` (3 min dans le prototype, 4 min en Sieste v1). | Le préciser dans la story 1.17. |

**Restent ouverts depuis le premier rapport :** M7 (Fermeté en E1, qui conditionne aussi le `hold-ring`), M9 (redétailler E5 à E8 après le playtest), M10/G6 (glissade trop rapide du désarmement).

### Liste de conformité par epic

| Critère | E1 | E2 | E3 | E4 | E5–E8 |
|---|---|---|---|---|---|
| Valeur joueur | ✓ | ✓ | ✓ | ✓ | ✓ |
| Autonomie | ✓ | ✓ | ✓ | ✓ | ✓ |
| Taille des stories | ⚠️ Q7 | ✓ | ✓ | ✓ | n/a |
| Pas de dépendance vers l'avant | ⚠️ M12 | ⚠️ M11 | ✓ | ✓ | ✓ |
| Données créées au besoin | ✓ | ✓ (A2) | ✓ (A2) | ✓ | ✓ |
| Critères clairs et testables | ⚠️ Q9 | ⚠️ Q8, Q9 | ⚠️ Q9 | ✓ (M13) | ⚠️ M9 |
| Traçabilité vers les FR et l'UX | ⚠️ UX non tracée | ⚠️ | ⚠️ | ⚠️ | ⚠️ |

## Synthèse et recommandations

### Statut global de readiness

**NEEDS WORK (léger) : l'UX est à réaligner avec les epics.** Le GDD, l'architecture et les epics restent alignés, avec une couverture de 100 % des FR et des NFR et aucune violation critique. La spécification UX est complète et ne contredit ni le GDD ni l'architecture. Mais **elle n'a pas encore été reportée dans les epics** : aucune story ne la référence, la section UX de l'inventaire la dit absente, et plusieurs surfaces du prototype n'ont pas de critères (panneau de pause, invites clavier, alignement de l'écran de résultat, fondations de l'UI).

Les stories **1.1 à 1.3** (projet, contenu, sim headless) ne touchent pas l'UI et **peuvent démarrer tout de suite**. Les stories d'UI à partir de 1.4 doivent attendre les corrections.

### Problèmes à traiter avant les stories d'UI

1. **X1 / Q9 : faire entrer l'UX dans les epics.** Réécrire la section « Exigences de design UX » en UX-DR numérotées, puis ajouter une ligne `UX :` et des critères à chaque story d'UI.
2. **Q7 / X2 / X11 : scinder la story 1.4** et créer une story « Fondations de l'UI » : `tokens.css` reflète `DESIGN.md`, polices, `strings.fr.json`, `aria-label`, focus, écran de démarrage, portrait, zones du HUD, **panneau de pause complet**.
3. **Q8 / X3 : créer la story 2.10** (mouvement réduit, « Grands verbes ») et compléter la 2.8 (Crédits, Vibrations masquée, descriptions des paliers, enregistrement instantané).
4. **X4 à X9 : ajouter les critères UX** aux stories 1.5, 1.6, 1.10, 1.16, 1.17, 1.18, 1.20, 1.21, 1.22, 2.5, 2.7, 3.1, 3.3, 3.7, 3.9, 3.11, 4.2, 4.3, 4.4, 5.3, 5.7, 6.2, 8.1.
5. **A1 à A6 : reporter dans l'architecture** les compléments de l'UX : `StringsSchema`, champs de `SaveSchema`, repli de calibration audio, états de `appFsm`, binding par `code` et déconnexion de la manette, polices et CSP.
6. **Relecture des `[ASSUMPTION]` par Geo**, au minimum : HUD, pause, résultat, premier lancement, et les deux incohérences internes (souffle retenu, durée du chrono).

### Prochaines étapes recommandées

1. Appliquer les corrections ci-dessus dans `epics.md` (renumérotation de E1 si la 1.4 est scindée) et dans `game-architecture.md`, puis mettre à jour la carte de couverture et ajouter une carte UX-DR → stories.
2. Relire les `[ASSUMPTION]` de l'UX (`gds-ux` en mode mise à jour si des décisions changent).
3. Lancer `gds-sprint-planning`, en rappelant que les stories 3.5 à 3.11 viennent après E4 ; puis `gds-create-story` sur la story 1.1.

### Note finale

Cette évaluation relève **28 nouveaux constats dans 4 catégories** :
- 6 écarts UX ↔ architecture (A1 à A6) ;
- 13 écarts UX ↔ epics (X1 à X13) et 2 incohérences internes à l'UX ;
- 3 problèmes majeurs de qualité (Q7 à Q9) ;
- 4 points mineurs (M11 à M14).

Aucun n'est critique. Les points ouverts du premier rapport restent non bloquants pour le prototype : G5 à G8, M7, M9, M10, ainsi que les catalogues des âges 3 à 5, le modèle économique et le ton du niveau Adulte. Geo peut traiter ces constats avant l'implémentation, ou démarrer les stories 1.1 à 1.3 en parallèle des corrections.

**Évaluateur :** workflow GDS Check Implementation Readiness (rôle : producteur et Scrum Master)
**Date :** 2026-10-26

## Corrections appliquées (2026-10-26, après le rapport)

Sur décision de Geo, toutes les corrections du rapport ont été appliquées. **Attention :** les numéros de stories cités plus haut dans ce rapport sont ceux d'**avant** la renumérotation.

**Renumérotation de E1** (Q7 : 23 → 24 stories) : l'ancienne 1.4 devient **1.4** « Boucle client, vue isométrique et pause exacte » (sans UI) et **1.5** « Fondations de l'UI : tokens, écran de démarrage, HUD et panneau de pause ». Les anciennes 1.5 à 1.23 deviennent **1.6 à 1.24**. Les références croisées ont été mises à jour dans `epics.md`, `project-context.md`, `DESIGN.md`, `EXPERIENCE.md` et la maquette `key-hud-level.html` ; les références d'UI à l'ancienne 1.4 pointent désormais vers 1.5. **Nouvelle story 2.10** (Q8). On passe ainsi de 78 à **80 stories**.

| Constat | Correction | Emplacement (nouvelle numérotation) |
|---|---|---|
| X1 / Q9 | Section « Exigences de design UX » réécrite en **UX-DR1 à UX-DR26** ; carte de couverture UX-DR → stories ; ligne `**UX :**` sur 37 stories ; vue d'ensemble et frontmatter mis à jour | Inventaire de `epics.md` |
| Q7 / X2 / X11 | Story 1.5 : `tokens.css` reflète `DESIGN.md` (avec un test), polices auto-hébergées, `t(key)` et `aria-label`, test à +30 % de longueur, états d'`appFsm`, démarrage, portrait, zones du HUD, budget du HUD, panneau de pause, décompte, focus | 1.4, 1.5 |
| X2 | Pause par Start/Options, pause à la déconnexion de la manette (avec message), navigation des menus à la manette, B jamais en pause | 1.17 |
| X2 / X12 | Retour Android | 8.1 |
| X3 / Q8 | Story 2.10 (mouvement réduit, grands verbes) ; réglages complétés (descriptions des paliers, 4 volumes, Vibrations masquée, Crédits, enregistrement instantané, accès depuis la pause) ; variantes réduites prévues par 2.5 | 2.5, 2.8, 2.10 |
| X4 | Lignes de score positives, étoiles posées une à une, actions selon le cas, journal réservé au playtest, « Journal copié ! », séquence du résultat, en-tête « Maman s'est réveillée ! », carte d'échecs répétés | 1.22, 3.2, 3.3, 3.6, 3.7, 3.9, 3.11 |
| X5 | Premier lancement → Âge 1 ; lancements suivants → Frigo ; Frigo complet (polaroïds, « ? », « Nouveau ! », aimant vers Réglages) ; « Quitter vers le frigo » en deux temps ; Crédits et action « Frigo » au niveau Adulte | 2.7, 3.11, 6.8, 6.9 |
| X6 | Binding par `KeyboardEvent.code` ; `glyph-chip` avec `getLayoutMap` et glyphes par famille de manette | 1.7, 1.17 |
| X7 / A3 | Calibration : fond `ink`, textes, Espace et A, saut de la phase audio (`audioOffsetMs = visualOffsetMs`, `audioSkipped`), redémarrage de la phase en arrière-plan | 2.7 ; architecture P5 |
| X8 | `epic-stamp`, `hold-ring` (Fermeté, renifler), `sequence-bar` et chrono compact, biberon de chargement, `target-highlight`, `threat-icon`, `tap-marker`, `verb-label` | 2.5, 1.23, 5.3, 4.4, 5.7, 6.2, 1.6, 1.11, 1.7, 2.2 |
| X9 | Pastille de jauges (ordre, segments, opacité, avertissement à 70 %), jauge Bruit seulement en Sieste, jauge Envie, HUD masqué pendant la fin de niveau | 1.19, 3.1, 4.3, 3.6, 3.10 |
| X10 / M13 | `combo-badge` au-dessus de papa, masqué à x1 | 4.2 |
| X13 | Crédits (entrée dans les réglages, lancement automatique au niveau Adulte) | 2.8, 6.8 |
| M11 | 2.7 expose `startRecalibration`, 2.8 la relie ; les réglages sont accessibles depuis la pause, et depuis le Frigo en 3.11 | 2.7, 2.8, 3.11 |
| M12 | Commande `TapBaby` créée en 1.21, priorité menace > bébé > objet > sol, réutilisée en 4.1 | 1.21, 4.1 ; architecture « Chaîne d'entrées » |
| M14 | Le chrono lit `durationMs` | 1.18 |
| A1 | `content/strings.fr.json`, `StringsSchema`, vérification par `content:check` | 1.2 ; architecture (arborescence, données, relations) |
| A2 | `SaveSchema` détaillé (`calibration`, `settings`, `progress`, `mamaMemory`) | Architecture « Persistance », « Configuration » |
| A4 | États d'`appFsm` (démarrage, Frigo, réglages, crédits, « Oups ») et écrans de l'UI | 1.5 ; architecture (arborescence, correspondance) |
| A5 | Clavier par `code`, `getLayoutMap`, famille de manette, `gamepaddisconnected`, déclencheurs de pause, `TapBaby` | Architecture « Chaîne d'entrées » |
| A6 | Polices dans `public/fonts/`, CSP `default-src 'self'` et `font-src 'self'` | 1.24 ; architecture « Sécurité » ; `project-context.md` |
| — | Mouvement réduit côté client uniquement (la sim n'est pas touchée) ; l'UX déclarée source de vérité de l'interface | Architecture « Retours multimodaux », « Statut du document » ; `project-context.md` |

**Vérifications après correction :**
- 80 stories, sans doublon ; 70 FR sur 70 et 14 NFR sur 14 citées par au moins une story ;
- 26 UX-DR sur 26 couvertes par au moins une story ;
- toutes les références vers une story ultérieure sont informatives (« arrive en story X », « s'ajoute en story X ») ; aucune story ne dépend d'une story ultérieure pour être terminée.

**Restent ouverts (non bloquants pour le prototype) :**
- les `[ASSUMPTION]` de l'UX, à relire par Geo, ainsi que les deux incohérences internes. Pour le souffle retenu, les stories utilisent le `breath-ring`, qui reste à confirmer. Pour le chrono, la durée est lue dans le niveau, ce qui règle le point côté stories ;
- M7 (Fermeté en E1), M9 (redétailler E5 à E8), M10 / G6, G5, G7, G8 ;
- le contenu des Crédits, les catalogues des âges 3 à 5, le modèle économique et le ton du niveau Adulte.

**Statut après corrections : PRÊT pour le sprint planning du prototype** (E1, E2, E3 `[P]`). E4 est prêt ; E5 à E8 restent à redétailler après le playtest.
