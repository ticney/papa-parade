---
stepsCompleted: [1, 2, 3, 4, 5, 6]
status: complete
readiness: NEEDS WORK → READY (prototype) après corrections
documentsIncluded:
  gdd: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md
  architecture: _bmad-output/planning-artifacts/game-architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: null
  annexes:
    - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/epics.md
    - _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md
language: fr
---

# Rapport de readiness d'implémentation

**Date :** 2026-10-26
**Projet :** papa-parade

## Inventaire des documents

| Type | Fichier | Taille | Statut |
|---|---|---|---|
| GDD | `planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` (v2.0) | 36 Ko | Retenu |
| Architecture | `planning-artifacts/game-architecture.md` | 91 Ko | Retenu (déplacé depuis `_bmad-output/`, pointeur laissé à l'ancien emplacement) |
| Epics et stories | `planning-artifacts/epics.md` | 107 Ko | Retenu, fait foi |
| Epics de haut niveau (annexe du GDD) | `planning-artifacts/gdds/…/epics.md` | 5 Ko | Contexte ; bandeau « remplacé pour le détail » ajouté |
| Journal des décisions (annexe du GDD) | `planning-artifacts/gdds/…/decision-log.md` | 6 Ko | Contexte |
| UX | — | — | Absent (choix assumé pour le prototype) |

**Problèmes résolus à l'inventaire :**
- Deux fichiers `epics.md` : `planning-artifacts/epics.md` fait foi, et l'autre porte un bandeau.
- Architecture hors de `planning-artifacts` : elle a été déplacée ; `epics.md` référence le nouveau chemin.

## Analyse du GDD

Le GDD v2.0 ne numérote pas ses exigences. La numérotation ci-dessous (FR1–FR70, NFR1–NFR14) est celle établie dans `epics.md` à partir du GDD. Elle a été **revérifiée par une relecture indépendante, section par section, du GDD complet** (Résumé, Objectifs, Gameplay central, Mécaniques, Contrôles, Éléments spécifiques, Progression, Level design, DA et audio, Spécifications techniques, Epics, Indicateurs, Hors scope, Hypothèses). Les écarts trouvés par cette relecture sont listés plus bas.

### Exigences fonctionnelles (70)

**Réponses et timing**

- FR1 `[P]` : chaque menace suit le cycle télégraphe → délai → fenêtre de réponse → résultat (parfaite, réussie ou gag) ; un appui trop tôt ou trop tard déclenche le gag.
- FR2 `[P]` : **Parer** = tap sur la menace, fenêtre de 300 ms ; un relâchement avant 400 ms compte comme Parer (ADR-010).
- FR3 `[P]` (si le temps le permet) : **Fermeté** = maintien d'au moins 0,4 s sur la menace ; appui dans la fenêtre de 300 ms, maintien jusqu'à la fin de l'attaque.
- FR4 `[V1]` : **Esquiver** = swipe dans une direction, fenêtre de 250 ms, réservé aux menaces rouges.
- FR5 `[P2]` : **Attendre** = aucune action jusqu'au signal, puis tap dans les 300 ms qui suivent ; un appui avant le signal est un gag.
- FR6 `[V1]` : **Ne rien faire** = aucune action sur la menace visée pendant 1,5 à 3 s ; le joueur peut traiter d'autres menaces pendant ce temps.
- FR7 `[P]` : le timing est mesuré à l'appui. Délai télégraphe → fenêtre : 0,8 à 1,5 s selon la menace. Fenêtre parfaite : 100 ms, centrée. Tolérance cachée : ±60 ms. Buffer d'entrée : 100 ms.
- FR8 `[P]` : hitstop de 80 ms sur réponse réussie ; ralenti ×0,3 pendant 1,2 s sur réponse parfaite ; ralenti ×0,2 pendant 1,5 s sur la dernière menace d'une vague.
- FR9 `[P]` : glissade freeflow. Taper une menace fait glisser papa automatiquement jusqu'à elle, en 0,6 s au plus depuis n'importe quel point de la pièce.

**Contrôles**

- FR10 `[P]` : déplacement par tap au sol (tactile), ZQSD ou flèches (clavier), stick gauche (manette).
- FR11 `[P]` : au clavier et à la manette, la menace la plus urgente dans la direction visée est ciblée automatiquement ; Parer = Espace ou A.
- FR12 `[P]` : interaction contextuelle (boire un café, renifler, décrocher) par tap sur l'objet ou le bébé, Espace ou A.
- FR13 `[P]` : orientation paysage.
- FR14 `[P]` : pause possible à tout moment et automatique quand l'app passe en arrière-plan ; reprise au même instant après un décompte de 3 s.

**Papa, bébé et jauges**

- FR15 `[P]` : le bébé se déplace, choisit ses cibles parmi les menaces du niveau, et son regard se verrouille sur sa cible pendant le télégraphe.
- FR16 `[P]` : fatigue de 0 à 100, +0,5/s (×2 en portant le bébé). Au-dessus de 70 : fenêtres réduites de 20 % et micro-siestes télégraphiées toutes les 8 à 12 s (paupières qui tombent, son cotonneux), à parer pour se réveiller. Café : −40, au prix de 3 s d'action.
- FR17 `[V1]` : envie pressante de 0 à 100, +0,4/s ; à 100, déplacements ralentis de 30 % ; toilettes = 5 s hors de la pièce, remise à 0.
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

### Exigences non fonctionnelles (14)

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

### Exigences et contraintes supplémentaires

- **Production :** règle d'or (l'IA écrit et teste, Geo règle le feeling) ; le GDD est la source de vérité des règles pour l'IA.
- **Dépendances :** Blender + Blender MCP (blocage, meubles, exports) ; Capacitor (mobile) ; la parade au tap doit être validée avant la production des âges suivants.
- **Plateformes :** Steam éventuellement plus tard, via un wrapper (hors scope v1).
- **Hors scope v1 :** coop locale, multijoueur en ligne, narration scriptée longue, personnalisation du personnage.
- **Questions ouvertes :** modèle économique (avant E8) ; ton du dernier niveau.
- **Hypothèses du GDD** (7, toutes des valeurs de départ à valider au playtest) : public 25–40 ans, seuil de 2 étoiles, valeurs de timing et de jauges, rythme des vagues, un niveau par âge, appareils de référence, seuils des indicateurs.

### Écarts relevés par la relecture indépendante

| # | Élément du GDD | Constat |
|---|---|---|
| G1 | Contrôles : « Renifler : tap sur le bébé » | Il entre en conflit avec deux autres usages du tap sur le bébé : la prise dans les bras (story 4.1, `TapBaby`) et la fin du silence suspect (story 1.18). La story 5.3 propose un tap maintenu, ce qui diverge du GDD. **L'intention d'un tap sur le bébé n'est pas définie.** |
| G2 | Règles d'entrée : « relâchement avant 0,2 s = Parer ; maintien au-delà de 0,4 s = Fermeté » | L'architecture (ADR-010) et `epics.md` fixent le seuil unique à 400 ms. **Le GDD n'a pas été mis à jour**, et les deux sources de vérité divergent. |
| G3 | Fenêtres « en millisecondes » ; « trop tôt, le gag se déclenche » | L'architecture précise que les fenêtres se mesurent en temps de jeu et ajoute le paramètre `earlyPress` (`fail` ou `guard`). Ce sont des compléments plutôt que des contradictions, **non reportés dans le GDD ni dans le decision log**. |
| G4 | Contrôles : « Retenir son souffle : E (maintien) au clavier, RT à la manette » | La story 4.9 définit `HoldAnywhere` pour le tactile, mais **ne mentionne pas les touches E et RT**. |
| G5 | Prise électrique : « soulever *ou* poser un cache-prise » ; table basse : « retirer l'objet *ou* détourner avec un jouet » | Les stories 1.9 et 1.13 n'implémentent qu'une variante de chaque. Le cache-prise relève de la préparation (6.3). Écart mineur, à noter. |
| G6 | Désarmement : « une glissade trop rapide vers le bébé retire 30 points » | La glissade est automatique (≤ 0,6 s). **Aucune mécanique ne permet au joueur de choisir une approche lente.** C'est une ambiguïté de design, à trancher avant la story 6.2. |
| G7 | Courbe de difficulté entre les âges : « une nouvelle réponse à la fois, d'abord isolée, puis mélangée » | C'est un principe de level design, non porté par une FR. Il doit guider les stories cadrées de E6. |
| G8 | Assets : « personnages, rig et animations faits à la main » | La story 7.2 ne précise pas qui produit le rig et les animations. Le GDD suggère une production humaine, hors du périmètre de l'IA. |

### Évaluation de la complétude du GDD

- **Points forts :** le GDD est riche et chiffré (fenêtres, jauges, note), relié à des piliers (avec une traçabilité mécaniques → piliers), et son scope prototype est explicite. Les hypothèses sont indexées, les questions ouvertes isolées.
- **Points faibles :**
  - les exigences ne sont pas numérotées, d'où une traçabilité qui dépend de `epics.md` ;
  - les catalogues des âges 3 à 5 manquent (bloquant pour E6, non bloquant pour le prototype) ;
  - les écarts G1 et G2 portent sur les contrôles du prototype ou de E4/E5 ;
  - les décisions prises en architecture n'ont pas été répercutées (G2, G3).
- **Verdict intermédiaire :** le GDD est suffisant pour le prototype. G2 et G3 sont à reporter dans le GDD ; G1 est à trancher avant E4.

## Validation de la couverture par les epics

### Matrice de couverture

La matrice est construite à partir des lignes « Exigences : » de chacune des 76 stories, et non de la seule carte de couverture : une FR n'est comptée que si une story la cite.

| FR | Phase | Exigence (extrait) | Stories | Statut |
|---|---|---|---|---|
| FR1 | `[P]` | chaque menace suit le cycle télégraphe → délai → fenêtre de réponse → résultat (parfaite, … | 1.9 | ✓ Couverte |
| FR2 | `[P]` | Parer = tap sur la menace, fenêtre de 300 ms ; un relâchement avant 400 ms compte comme Pa… | 1.9 | ✓ Couverte |
| FR3 | `[P]` (si le temps le permet) | Fermeté = maintien d'au moins 0,4 s sur la menace ; appui dans la fenêtre de 300 ms, maint… | 1.20 | ✓ Couverte |
| FR4 | `[V1]` | Esquiver = swipe dans une direction, fenêtre de 250 ms, réservé aux menaces rouges | 5.1 | ✓ Couverte |
| FR5 | `[P2]` | Attendre = aucune action jusqu'au signal, puis tap dans les 300 ms qui suivent ; un appui … | 4.6 | ✓ Couverte |
| FR6 | `[V1]` | Ne rien faire = aucune action sur la menace visée pendant 1,5 à 3 s ; le joueur peut trait… | 4.9, 6.4 | ⚠️ Phase : l'étiquette `[V1]` est à corriger en `[P2]` (introduite en 4.9) |
| FR7 | `[P]` | le timing est mesuré à l'appui | 1.9 | ✓ Couverte |
| FR8 | `[P]` | hitstop de 80 ms sur réponse réussie ; ralenti ×0,3 pendant 1,2 s sur réponse parfaite ; r… | 1.11, 1.15 | ✓ Couverte |
| FR9 | `[P]` | glissade freeflow | 1.9 | ✓ Couverte |
| FR10 | `[P]` | déplacement par tap au sol (tactile), ZQSD ou flèches (clavier), stick gauche (manette) | 1.6 | ✓ Couverte |
| FR11 | `[P]` | au clavier et à la manette, la menace la plus urgente dans la direction visée est ciblée a… | 1.14 | ✓ Couverte |
| FR12 | `[P]` | interaction contextuelle (boire un café, renifler, décrocher) par tap sur l'objet ou le bé… | 1.14, 1.16 | ⚠️ « Renifler » est en V1 (5.3) alors que FR12 est étiquetée `[P]` ; conflit d'intention sur le tap du bébé (G1) |
| FR13 | `[P]` | orientation paysage | 1.4 | ✓ Couverte |
| FR14 | `[P]` | pause possible à tout moment et automatique quand l'app passe en arrière-plan ; reprise au… | 1.4 | ✓ Couverte |
| FR15 | `[P]` | le bébé se déplace, choisit ses cibles parmi les menaces du niveau, et son regard se verro… | 1.7, 1.9 | ✓ Couverte |
| FR16 | `[P]` | fatigue de 0 à 100, +0,5/s (×2 en portant le bébé) | 1.16 | ✓ Couverte |
| FR17 | `[V1]` | envie pressante de 0 à 100, +0,4/s ; à 100, déplacements ralentis de 30 % ; toilettes = 5 … | 4.3 | ⚠️ Phase : l'étiquette `[V1]` est à corriger en `[P2]` (story 4.3) |
| FR18 | `[P]` | jauge de bruit (niveaux Sieste) | 3.1 | ✓ Couverte |
| FR19 | `[P]` | silence-télégraphe | 1.18 | ✓ Couverte |
| FR20 | `[P]` | instinct paternel | 2.9 | ✓ Couverte |
| FR21 | `[P]` | physique légère ; les objets tombent, roulent, rebondissent et provoquent des accidents ém… | 1.12 | ✓ Couverte |
| FR22 | `[P2]` | bras-bébé | 4.1 | ✓ Couverte |
| FR23 | `[P2]` | combo de x1 à x8 | 4.2 | ✓ Couverte |
| FR24 | `[V1]` | états cachés du bébé (propre, nourri, reposé), devinés grâce à des indices : traînée verte… | 5.2, 5.3, 5.4 | ✓ Couverte |
| FR25 | `[P]` | prise électrique | 1.9 | ⚠️ Partielle : la variante « poser un cache-prise » relève de la préparation (6.3) |
| FR26 | `[P]` | escalier | 1.13 | ✓ Couverte |
| FR27 | `[P]` | objet sur la table basse | 1.13 | ⚠️ Partielle : la variante « détourner avec un jouet » n'est pas dans 1.13 |
| FR28 | `[P]` | silence suspect | 1.18 | ✓ Couverte |
| FR29 | `[P]` | téléphone qui sonne (perturbation) | 1.17 | ✓ Couverte |
| FR30 | `[V1]` | chien (vole la purée, aboie avec bruit +10 %, fait tomber des objets ; Parer pour le détou… | 6.1 | ✓ Couverte |
| FR31 | `[P]` | les menaces s'empilent par vagues | 1.15 | ✓ Couverte |
| FR32 | `[P]` | variante Sieste | 3.2 | ✓ Couverte |
| FR33 | `[V1]` | variante Retour (3 min, Maman rentre à la fin du chrono, sans fin anticipée) | 3.10 | ✓ Couverte |
| FR34 | `[P]` | note de Maman | 1.19, 4.2, 5.2 | ✓ Couverte |
| FR35 | `[V1]` | séquence de fin | 3.5, 3.6, 3.7 | ✓ Couverte |
| FR36 | `[V1]` | les répliques de Maman se souviennent des parties précédentes (« *Encore* l'étagère ?! ») | 3.8 | ✓ Couverte |
| FR37 | `[V1]` | la dégaine de papa se dégrade visiblement pendant le niveau (purée sur la joue, cheveux en… | 3.7 | ✓ Couverte |
| FR38 | `[V1]` | replay des meilleurs moments, façon match de sport | 3.9 | ✓ Couverte |
| FR39 | `[V1]` | un niveau est réussi à partir de 1 étoile ; l'âge suivant se débloque à partir de 2 étoile… | 3.11 | ✓ Couverte |
| FR40 | `[P2]` | cycle du dodo | 4.4, 4.5, 4.6, 4.8, 4.9, 4.10 | ⚠️ Les touches E et RT du souffle retenu sont absentes de 4.9 (G4) |
| FR41 | `[P2]` | faux sommeil, attaque retardée façon Elden Ring (Attendre) | 4.7 | ✓ Couverte |
| FR42 | `[V1]` | change de couche en boss | 5.7 | ✓ Couverte |
| FR43 | `[V1]` | rhabillage façon puzzle (les pressions ne tombent jamais en face, le bras ressort par le c… | 5.6 | ✓ Couverte |
| FR44 | `[V1]` | soins | 5.8 | ✓ Couverte |
| FR45 | `[V1]` | désarmement | 6.2 | ⚠️ La règle de la « glissade trop rapide » n'est pas implémentable telle quelle (G6) |
| FR46 | `[V1]` | coolitude des objets (1 à 10 : cuillère 2, fourchette 4, jouet 5, télécommande 7, téléphon… | 6.2 | ✓ Couverte |
| FR47 | `[V1]` | préparation entre deux vagues (cache-prises, barrières, objets en hauteur) ; pendant les v… | 6.3 | ✓ Couverte |
| FR48 | `[V1]` | pleur sans raison, inparable (bercer et tenir, Fermeté pendant 5 s) ; couche de Schrödinge… | 5.5 | ✓ Couverte |
| FR49 | `[V1]` | vomi en jet, première menace rouge, à esquiver | 5.1 | ✓ Couverte |
| FR50 | `[V1]` | petite enfance | 6.4, 6.5 | ✓ Couverte |
| FR51 | `[V1]` | âges Enfance (dangers à distance), Adolescence (duel verbal sous pression de temps) et Adu… | 6.6, 6.7, 6.8 | ✓ Couverte |
| FR52 | `[V1]` | un niveau par âge, chacun dans une pièce | 6.9 | ✓ Couverte |
| FR53 | `[P]` | un verbe d'un mot s'affiche en gros sur chaque menace (SOULÈVE !, FERME !, ÉCHANGE !…) | 2.2 | ✓ Couverte |
| FR54 | `[P]` | code couleur doublé par une forme d'icône (bleu et cercle = parable ; rouge et triangle = … | 2.2 | ✓ Couverte |
| FR55 | `[P]` | paliers de difficulté | 2.8 | ✓ Couverte |
| FR56 | `[P]` | calibration de la latence au premier lancement (tap en rythme sur 8 temps, en deux phases … | 2.7 | ✓ Couverte |
| FR57 | `[P]` | retour haptique sur mobile : vibration courte à chaque télégraphe, vibration marquée sur r… | 2.4 | ✓ Couverte |
| FR58 | `[P]` | un son distinct par télégraphe, un son culte par type de réponse (couinement de jouet, cla… | 2.3 | ✓ Couverte |
| FR59 | `[P]` | chaque signal sonore a un équivalent visuel (ondes, bulles) et un équivalent haptique | 1.8, 2.4 | ✓ Couverte |
| FR60 | `[P]` (base) et `[V1]` (complète) | musique adaptative, douce au calme, nerveuse quand une menace approche ; elle bascule en r… | 2.6, 7.5 | ✓ Couverte |
| FR61 | `[P]` | effets de feeling | 2.5 | ✓ Couverte |
| FR62 | `[V1]` | célébration démesurée sur la dernière réponse d'un niveau (chœur d'opéra, feu d'artifice) … | 7.4 | ✓ Couverte |
| FR63 | `[P]` | l'audio se déverrouille au premier tap dans le navigateur | 1.8 | ✓ Couverte |
| FR64 | `[P]` | menaces, niveaux et âges sont des données éditables hors code, que l'IA peut générer et va… | 1.2, 1.5 | ✓ Couverte |
| FR65 | `[P]` | tous les paramètres de feeling se règlent sans toucher à la logique, dans un fichier uniqu… | 1.2, 2.1 | ✓ Couverte |
| FR66 | `[P]` | le jeu peut être lancé et joué de bout en bout sans intervention humaine | 1.10 | ✓ Couverte |
| FR67 | `[P]` | un build web est partageable par lien pour les playtests | 1.21 | ✓ Couverte |
| FR68 | `[P]` | les cinq indicateurs de gameplay sont mesurables sur au moins 5 testeurs (critère de sorti… | 3.3, 3.4 | ✓ Couverte |
| FR69 | `[V1]` | builds iOS et Android via Capacitor (haptique, audio, paysage) et préparation des fiches s… | 8.1, 8.2, 8.3 | ✓ Couverte |
| FR70 | `[V1]` | production art et audio | 7.1, 7.2, 7.3, 7.5 | ✓ Couverte |

### Exigences manquantes

Aucune : chacune des 70 FR est citée par au moins une story.

Aucune FR n'apparaît dans les epics sans exister dans le GDD. Les seuls ajouts sont des éléments d'architecture, sourcés.

**Couverture partielle ou à préciser (7 points) :** FR6, FR12, FR17, FR25, FR27, FR40 et FR45 (détails dans la colonne Statut).
- Les points sur FR6 et FR17 sont des **incohérences d'étiquetage** dans `epics.md` : la carte de couverture a été corrigée, mais les étiquettes de phase de l'inventaire ne l'ont pas été.
- Le point sur FR12 rejoint l'écart G1 (intention d'un tap sur le bébé).

### Statistiques de couverture

- FR du GDD : 70
- FR couvertes par au moins une story : 70
- Taux de couverture : 100 %
- Couverture complète : 63 ; partielle ou à préciser : 7
- NFR couvertes : 14 sur 14

## Évaluation de l'alignement UX

### Statut du document UX

**Non trouvé.** Aucun fichier `*ux*` dans `planning-artifacts/`.

### Une UI est-elle impliquée ?

Oui, nettement. Le GDD et les stories impliquent :
- un HUD : jauges de fatigue, de bruit et d'envie pressante, chrono, combo, bouton pause ;
- des éléments ancrés au monde : verbes, icônes, bulle « … » au bord de l'écran ;
- des écrans : chargement, menu, sélection des âges, calibration, pause et décompte, réglages, résultat (composantes de la note, étoiles, journal), réactions de Maman, replay, « Oups », « Tourne ton téléphone ».

### Ce que l'architecture couvre déjà

- La technologie de l'UI : DOM vanilla, `CSS2DRenderer`, classes `pp-*`, `tokens.css` prévu.
- La latence (≤ 50 ms) et la testabilité par Playwright.
- Le flux de l'app (`appFsm` : boot → calibration → menu → niveau → résultat).
- Les équivalents multimodaux, garantis par un test.

### Problèmes d'alignement

| # | Constat | Impact |
|---|---|---|
| U1 | **Zones sûres (encoches) en paysage non traitées.** Aucune story n'impose `env(safe-area-inset-*)` pour le HUD et la bulle « … ». Sur un iPhone en paysage, l'encoche peut masquer une jauge ou la bulle. | Prototype (playtest mobile) |
| U2 | **Tailles de cible tactile et lisibilité non spécifiées.** Le bouton pause, les boutons de l'écran de résultat et la taille minimale des verbes sur petit écran ne sont pas définis. Le rayon tactile des menaces existe (dans `feel.json`), mais pas celui des éléments d'UI. | Prototype ; NFR6 (comprendre sans explication) |
| U3 | **Pas de disposition du HUD.** L'emplacement des jauges et du chrono, par rapport aux zones des pouces et à l'action, n'est pas décrit. Il risque d'être décidé au hasard par l'agent de la story 1.15 ou 1.16. | Prototype (cohérence entre stories) |
| U4 | **Parcours du premier lancement.** L'ordre déverrouillage audio → calibration → premier niveau est implicite, mais aucune story ne décrit l'écran de démarrage qui obtient le premier tap. | Prototype |
| U5 | Pas de système de design (couleurs d'UI, typo, tokens) au-delà de la teinte d'alerte et du bleu/rouge. | v1 (E7) ; acceptable en cubes |

### Avertissements

- ⚠️ **Le document UX manque alors que l'UI est impliquée.** Pour un prototype « en cubes », c'est acceptable à condition de traiter U1 à U4 directement dans les stories concernées : ajouter des critères aux stories 1.4 (zones sûres, écran de démarrage), 1.15 et 1.16 (disposition du HUD) et 1.19 (cibles tactiles).
- ⚠️ **Lancer `gds-ux` avant la v1 (E3 `[V1]`, E7)** pour les écrans de fin, la sélection des âges et le système de design.

## Revue de qualité des epics

Revue menée avec les critères de `gds-create-epics-and-stories` : valeur joueur, indépendance, dépendances, taille, critères d'acceptation, création des données au plus tard. *Les stories ont été écrites dans cette même session : la revue a donc cherché activement à les prendre en défaut.*

### Structure des epics

| Epic | Valeur joueur | Autonome | Remarque |
|---|---|---|---|
| E1 Le salon jouable en cubes | ✓ | ✓ | Fondations intégrées comme premières stories (greenfield) |
| E2 Game feel et lisibilité | ✓ | ✓ (E1) | — |
| E3 Bruit et Maman | ✓ | ✓ (E1, E2) | Mélange `[P]` et `[V1]` ; voir Q5 |
| E4 Cycle du dodo | ✓ | ✓ (E1–E3 `[P]`) | — |
| E5 Hygiène et état caché | ✓ | ✓ (E1–E4) | Stories cadrées |
| E6 Âges suivants | ✓ | ✓ | Bloqué par les catalogues des âges 3 à 5 (GDD) |
| E7 Production art et audio | ✓ | ✓ | Parallèle à partir de E4 |
| E8 Distribution mobile | ✓ | ✓ | Bloqué par le modèle économique |

Aucun epic technique ; aucun epic ne requiert un epic ultérieur.

### 🔴 Violations critiques

**Aucune.** Il n'y a pas d'epic technique sans valeur joueur. Il n'y a pas de dépendance vers l'avant : les 5 dépendances détectées à la validation de `epics.md` avaient été corrigées, et cette revue n'en trouve pas d'autre. Toutes les stories du prototype restent réalisables.

### 🟠 Problèmes majeurs

| # | Problème | Exemple | Remédiation |
|---|---|---|---|
| Q1 | **Stories trop grosses pour un seul agent** | **1.9** cumule le schéma `ThreatDef`, la FSM des menaces, le jugement, la fenêtre effective, un director minimal, le regard du bébé, le hit-test, la glissade P3, le gag, les retours, le test de latence et les tests générés. **1.3** (cœur de la sim, journal, snapshot, golden), **1.10** (4 bots, CLI, autoplay, `__PP__`, e2e, replay) et **2.1** (overlay, timeline, panneau, plugin) sont aussi lourdes. | Scinder **1.9** en « 1.9 Menace jugée en headless (sim + tests générés) » et « 1.10 Parer au tap (hit-test, glissade, retour ≤ 50 ms) ». Scinder **1.10** actuelle en « bots + CLI » et « autoplay + `__PP__` + e2e ». Accepter 1.3 et 2.1 en l'état, avec une vigilance au moment de `gds-create-story`. |
| Q2 | **NFR1 et NFR2 jamais mesurées sur un vrai appareil avant E8.** La story 1.21 mesure le temps de frame sur la machine de CI, et la 1.9 la latence en headless. Or le playtest du prototype se fait sur mobile web. | 8.2 est la seule story qui mesure sur les appareils de référence. | Ajouter à **1.21** un critère : une mesure manuelle avec `?debug=1` sur iPhone 12 et sur un Android de 2021 (FPS p95, latence tap → visuel filmée en 240 fps), consignée dans `docs/playtest/`, comme condition préalable au playtest. |
| Q3 | **Le cadre de gestion des erreurs n'est attribué à aucune story.** L'architecture définit `Result`, le handler global, l'écran « Oups » et `log.ts` avec sa mémoire tampon, mais seuls `clampInvariant` (1.3) et les erreurs de contenu (1.2) sont couverts. La story 3.3 suppose pourtant que la mémoire tampon de logs existe. | Échec de chargement du `.glb` : aucun critère ne dit ce que voit le joueur. | Ajouter à **1.1** la création de `log.ts` (canaux, niveaux, mémoire tampon de 200 entrées) et de `Result`. Ajouter à **1.5** l'échec de chargement (écran « Oups » et bouton Réessayer) et le handler global. |
| Q4 | **Aucune story ne crée la CI.** L'architecture définit le pipeline (typecheck → lint → content:check → test → e2e → build), mais il n'est pas planifié. | La règle d'or (« l'IA vérifie sans humain ») perd son filet de sécurité. | Ajouter à **1.1** (ou en 1.21) un critère : un workflow CI (GitHub Actions) exécute le pipeline à chaque push dès qu'un dépôt distant existe. Le choix de l'hébergement du dépôt revient à Geo. |
| Q5 | **L'ordre des numéros ne suit pas l'ordre de livraison prévu.** La séquence décidée est E3 `[P]` → playtest → E4 → E3 `[V1]`, mais le sprint planning trie par numéro : les stories 3.5 à 3.11 passeraient avant 4.1. | Un agent de dev enchaînerait la porte et le replay au lieu du cycle du dodo. | Au sprint planning, marquer 3.5 à 3.11 comme différées après E4 (statut ou commentaire dans `sprint-status.yaml`), ou les renuméroter après E4. |
| Q6 | **UX : les points U1 à U4 ne sont portés par aucune story** (zones sûres, cibles tactiles, disposition du HUD, écran de démarrage). | La story 1.15 place le chrono et la story 1.16 la jauge sans règle commune. | Ajouter les critères correspondants aux stories 1.4, 1.15, 1.16 et 1.19 (voir la section UX). |

### 🟡 Points mineurs

| # | Point | Remédiation |
|---|---|---|
| M1 | Stories orientées développeur (1.1, 1.2, 1.3, 1.10). C'est acceptable en greenfield et justifié par la règle d'or, car la testabilité est un objectif du projet. | Aucune. |
| M2 | `feel.json` (1.2) contient d'emblée des sections dont les systèmes arrivent plus tard (instinct, paliers, note) ; la table de bruit (3.1) prévoit des sources sans émetteur. | Accepté (c'est de la configuration, et le critère de sortie de E1 l'exige), mais chaque story consommatrice est propriétaire de sa section du schéma et peut la faire évoluer. |
| M3 | FR6 et FR17 gardent l'étiquette `[V1]` dans l'inventaire de `epics.md`, alors qu'elles sont livrées en E4 `[P2]`. | Corriger les étiquettes. |
| M4 | La story 4.9 ne mentionne pas les touches E (clavier) et RT (manette) du souffle retenu (G4). | Ajouter un critère. |
| M5 | La story 1.14 code en dur un cône de ±60° (valeur hors GDD). | Le passer en clé de `feel.json`. |
| M6 | La story 3.4 ne précise pas le format CSV de la fiche d'observation. | Définir les colonnes dans la story (testeur, menace, identifiée O/N, rires, citation de la parade). |
| M7 | La taille de la story 4.8 varie selon la livraison ou non de 1.20. | Décider au sprint planning si 1.20 est livrée en E1. |
| M8 | Le renifler (5.3, tap maintenu) diverge du GDD (tap) ; le tap sur le bébé a plusieurs intentions (G1). | Confirmer « tap = prendre / trouver ; maintien = renifler » et le reporter dans le GDD avant E4. |
| M9 | E5 à E8 ont des critères minces, par choix. | Les redétailler (`gds-correct-course` ou une nouvelle passe de `gds-create-epics-and-stories`) après le playtest, avant leur sprint. |
| M10 | La règle de la « glissade trop rapide » du désarmement (G6) n'est pas implémentable telle quelle. | Trancher la mécanique avant la story 6.2. |

### Liste de conformité par epic

| Critère | E1 | E2 | E3 | E4 | E5–E8 |
|---|---|---|---|---|---|
| Valeur joueur | ✓ | ✓ | ✓ | ✓ | ✓ |
| Autonomie | ✓ | ✓ | ✓ | ✓ | ✓ |
| Taille des stories | ⚠️ Q1 | ⚠️ 2.1 | ✓ | ✓ | n/a (cadrées) |
| Pas de dépendance vers l'avant | ✓ | ✓ | ✓ | ✓ | ✓ |
| Données créées au besoin | ✓ (M2) | ✓ | ✓ (M2) | ✓ | ✓ |
| Critères clairs et testables | ⚠️ Q2, Q3 | ✓ | ✓ (M6) | ✓ (M4) | ⚠️ M9 |
| Traçabilité vers les FR | ✓ | ✓ | ✓ | ✓ | ✓ |
| Story de démarrage (greenfield) | ✓ 1.1 | — | — | — | — |

## Synthèse et recommandations

### Statut global de readiness

**À RETRAVAILLER (léger) : NEEDS WORK.** Il n'y a aucune violation critique, et la couverture des FR est de 100 %. Mais 6 problèmes majeurs touchent directement le prototype : taille des stories, mesures sur appareil réel, gestion des erreurs, CI, ordre de livraison, UX minimale. Tous se corrigent par des modifications de `epics.md`, sans changement d'architecture. Une fois corrigés, le prototype (E1, E2, E3 `[P]`) est **prêt pour le sprint planning**. E5 à E8 restent volontairement à redétailler après le playtest.

### Problèmes à traiter avant l'implémentation

1. **Q1 Scinder la story 1.9** (et la 1.10 actuelle) pour que chaque story tienne dans le contexte d'un seul agent. C'est la tranche verticale de l'hypothèse n°1 : on ne peut pas se permettre de la rater.
2. **Q2 Mesurer 60 FPS et ≤ 50 ms sur les appareils de référence** avant le playtest (critère à ajouter à la story 1.21).
3. **Q3 et Q4 Attribuer le cadre d'erreurs** (`log.ts`, `Result`, handler global, « Oups ») **et la CI** à des stories de E1.
4. **Q6 (U1 à U4) Ajouter les critères UX minimaux** : zones sûres en paysage, cibles tactiles, disposition du HUD, écran de démarrage.
5. **Q5 Fixer l'ordre de livraison** de E3 `[V1]` (après E4) dans le sprint planning.
6. **G2 et G3 Reporter dans le GDD et le decision log** les décisions de l'architecture : seuil unique de 400 ms, fenêtres en temps de jeu, `earlyPress`. Le GDD est la source de vérité des règles pour l'IA, et il est aujourd'hui en retard sur l'architecture.

### Prochaines étapes recommandées

1. Appliquer les corrections Q1 à Q6 et M3 à M6 dans `epics.md` (renumérotation de E1 si la 1.9 est scindée), puis mettre à jour la carte de couverture.
2. Mettre à jour le GDD (G2, G3, et G1 « tap = prendre / trouver ; maintien = renifler ») et ajouter une entrée au `decision-log.md`.
3. Lancer `gds-sprint-planning` en indiquant que 3.5 à 3.11 viennent après E4, puis `gds-create-story` sur la story 1.1.
4. Avant le playtest : `gds-playtest-plan` (facultatif), qui s'appuie sur la fiche d'observation de la story 3.4.
5. Avant la v1 : `gds-ux`, les catalogues des âges 3 à 5, la mécanique de désarmement (G6) et le modèle économique.

### Note finale

Cette évaluation relève **29 constats dans 4 catégories** :
- 8 écarts du GDD (G1 à G8) ;
- 5 constats UX (U1 à U5) ;
- 6 problèmes majeurs de qualité (Q1 à Q6) ;
- 10 points mineurs (M1 à M10).

Aucun n'est critique. Il est recommandé de traiter les problèmes majeurs avant d'implémenter. Geo peut aussi choisir de démarrer la story 1.1 tout de suite, puisque les corrections ne la touchent qu'à la marge (Q3, Q4).

**Évaluateur :** workflow GDS Check Implementation Readiness (rôle : producteur et Scrum Master)
**Date :** 2026-10-26

## Corrections appliquées (2026-10-26, après le rapport)

Sur décision de Geo, les corrections suivantes ont été appliquées. **Attention :** les numéros de stories cités plus haut dans ce rapport sont ceux d'**avant** la renumérotation.

**Renumérotation de E1** (Q1, 21 → 23 stories ; 78 stories au total) :
- l'ancienne 1.9 devient **1.9** « Première menace jugée en headless » et **1.10** « Parer la prise électrique au tap » ;
- l'ancienne 1.10 devient **1.11** « Bots et simulation en masse » et **1.12** « Autoplay et API de test dans le navigateur » ;
- les anciennes 1.11 à 1.21 deviennent **1.13 à 1.23** ; toutes les références croisées de `epics.md` ont été mises à jour.

| Constat | Correction | Emplacement |
|---|---|---|
| Q1 | Scission des stories 1.9 et 1.10 | E1 |
| Q2 | Mesure sur appareils réels (FPS p95, latence filmée à 240 fps), condition préalable au playtest | 1.23 |
| Q3 | `log.ts` (mémoire tampon de 200 entrées) et `Result` | 1.1 |
| Q3 | Écran « Oups » sur échec de chargement, handler global | 1.5 |
| Q4 | Pipeline CI (`.github/workflows/ci.yml`, `npm run ci` en local) | 1.1 |
| Q5 | Note d'ordre de livraison : 3.5 à 3.11 après E4 | Liste des epics, en-tête de E3 |
| Q6 / U1 | Zones sûres `env(safe-area-inset-*)`, test d'iPhone 12 en paysage | 1.4 |
| Q6 / U2 | Cibles tactiles ≥ 44 × 44 pt, taille de texte minimale | 1.4, 1.21 |
| Q6 / U3 | Zones fixes du HUD | 1.4, utilisées par 1.17 et 1.18 |
| Q6 / U4 | Écran de démarrage « Touche pour commencer » (déverrouillage audio, calibration) | 1.4, 1.8 |
| M3 | FR6 et FR17 réétiquetées `[P2]` | Inventaire |
| M4 | Souffle retenu : E (clavier) et RT (manette) | 4.9 |
| M5 | Cône de ciblage passé en `feel.autoTargetConeDeg` | 1.16 |
| M6 | Colonnes du CSV d'observation définies | 3.4 |
| G1 (M8) | Tap sur le bébé = prendre / trouver ; maintien de 1 s = renifler | GDD v2.1, FR12, decision log |
| G2 | Seuil unique de 0,4 s Parer / Fermeté | GDD v2.1, decision log |
| G3 | Fenêtres en temps de jeu ; appui trop tôt = gag par défaut, mode « en garde » réglable | GDD v2.1, decision log |

**Vérifications après correction :**
- 78 stories ; 70 FR sur 70 et 14 NFR sur 14 citées par au moins une story ;
- aucune dépendance vers l'avant (les seules références à des stories ultérieures sont informatives) ;
- `window.__PP__` n'est utilisé qu'à partir de la story 1.12 ;
- numéros de version inchangés.

**Restent ouverts (non bloquants pour le prototype) :**
- M7 : livrer ou non la Fermeté en E1, à décider au sprint planning ;
- M9 : redétailler E5 à E8 après le playtest ;
- M10 / G6 : mécanique de la « glissade trop rapide » ;
- G5 : variantes de réponse (cache-prise, jouet) ;
- G7 : principe de progression à appliquer en E6 ;
- G8 : qui produit les rigs et les animations ;
- U5 : système de design (v1, `gds-ux`) ;
- catalogues des âges 3 à 5, modèle économique, ton du niveau Adulte.

**Statut après corrections : PRÊT pour le sprint planning du prototype** (E1, E2, E3 `[P]`). E4 est prêt ; E5 à E8 restent à redétailler après le playtest.
