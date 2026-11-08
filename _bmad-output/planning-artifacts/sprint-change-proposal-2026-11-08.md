---
title: Sprint Change Proposal — GDD v2.4 (animation des personnages)
date: 2026-11-08
trigger: GDD v2.4 (commit 017c1b8), section « Animation des personnages » de la direction artistique
mode: incrémental
scope: modéré (8 stories ajoutées à E7, une story modifiée, ordre de livraison, mises à jour d'artefacts)
status: approuvé par Geo le 2026-11-08, appliqué
---

# Sprint Change Proposal — GDD v2.4

Document en français, comme le GDD, `epics.md` et l'architecture (dérogation à `document_output_language`, décision du 2026-10-26). Chaque proposition ci-dessous a été approuvée une à une par Geo le 2026-11-08 (mode incrémental).

## 1. Résumé du problème

**Déclencheur.** Constat de Geo en jouant (2026-11-08) : les personnages manquent de fluidité et de variété, et leur rendu pourrait être plus net. Le GDD est passé en v2.4 le même jour (commit `017c1b8`) avec une sous-section « Animation des personnages ». Le journal des décisions demande de reporter la v2.4 dans `epics.md` et `sprint-status.yaml` « par `gds-correct-course`, avec des stories E7 dans l'ordre de production ».

**Type.** Exigence nouvelle de feeling, issue du jeu. Aucune story ne l'a révélée.

**Demande de Geo.** Ajouter les stories d'animation à l'Epic 7, dans l'ordre de production du GDD : couche de vie, squelette v2, première vague, puis le reste.

**Constats (preuves dans le code) :**

| Constat | Mesure / cause |
|---|---|
| Papa pivote d'un bloc | Demi-tour à vitesse constante, `feedback.json › characters.turnRateDegPerSec` = 720 |
| Toutes les transitions se ressemblent | Un fondu unique de 140 ms (`characters.crossFadeMs`) pour tous les passages |
| Bras et jambes raides | 11 os pour papa, 9 pour le bébé : ni coude, ni genou, ni pied (contrat de la story 7.2) |
| Papa planté pendant les temps forts | `characterClips.ts` : `chore` et `pickingUp` jouent `idle` |
| L'infiltration est une marche au ralenti | La boucle `walk`, ralentie par `clipSpeeds` |
| Chaque réponse rejoue la même pose | Un seul clip par réponse (`respond_parry`, `respond_firm`, `respond_perfect`) |
| Rien ne bouge entre deux animations | Aucune couche procédurale par-dessus le mixer |

Papa mesure une quarantaine de pixels sur un téléphone en paysage, le bébé une vingtaine : la silhouette, les poses, le timing et les yeux comptent plus que les polygones.

## 2. Analyse d'impact

### Checklist

| # | Point | Statut | Note |
|---|---|---|---|
| 1.1 | Story déclencheuse | [x] | Aucune : constat de Geo en jouant, puis GDD v2.4 |
| 1.2 | Problème | [x] | Fluidité, variété et netteté des personnages |
| 1.3 | Preuves | [x] | Tableau ci-dessus |
| 2.1 | Epic en cours | [x] | E7 reste valable (7.1 à 7.3, 7.6 et 7.7 livrées) ; la 7.4 reçoit la danse de victoire et l'effondrement |
| 2.2 | Changements d'epic | [!] | +8 stories en E7 (7.8 à 7.15) |
| 2.3 | Epics futures | [x] | Maman, le chien et les enfants (E3, E6) suivront les mêmes principes dans les stories qui les créent. La 3.9 (replay) montrera les mêmes animations, puisqu'elles ne dépendent que de la sim |
| 2.4 | Epics obsolètes / nouvelles | [x] | Aucune |
| 2.5 | Ordre | [!] | Juste après 3.8, avant 3.9 (choix de Geo), avec un playtest de l'animation après 7.12 |
| 3.1 | Exigences | [!] | GDD à jour ; `epics.md` gagne FR79 |
| 3.2 | Architecture | [!] | Nouvelle sous-section « Animation des personnages », mouvement réduit, `feel.json › characters`, correspondance epics → architecture |
| 3.3 | UX | [!] | `EXPERIENCE.md` : deux lignes au tableau du mouvement réduit. `DESIGN.md` : rien (UI seulement) |
| 3.4 | Autres artefacts | [!] | Dans les stories (§4.8) |
| 4.1 | Ajustement direct | Viable | Effort élevé, risque moyen |
| 4.2 | Retour arrière | Non viable | Rien à défaire : la 7.2 reste la base |
| 4.3 | Revue du MVP | Non nécessaire | Les piliers tiennent |
| 4.4 | Voie retenue | [x] | Ajustement direct |

### Impact sur les epics

- **E7 (Production art et audio)** : +8 stories (7.8 à 7.15) ; la 7.4 gagne deux critères (danse de victoire, effondrement).
- **E3 `[V1]`** : 3.9 à 3.11 reculent derrière l'animation.
- **E5, E6, E8** : rien à réécrire.

### Conflits d'artefacts relevés

- **GDD** : « Personnages, rig et animations faits à la main » contre une couche de vie calculée en jeu. Lecture retenue par le coach (journal du 2026-11-08) : les animations restent faites à la main dans Blender, et la couche de vie s'y ajoute en jeu sans les remplacer.
- **GDD, accessibilité** : « arrête la couche de vie des personnages » ; **garde-fous** : « la respiration, l'élan, la mèche et les attentes s'arrêtent ». La liste des garde-fous fait foi : les fondus, le regard et la voûte restent (ils ne clignotent pas et portent un état).
- **Architecture** : aucune règle sur une couche procédurale, sur le choix reproductible des variantes, ni sur l'emplacement des réglages des personnages (`feedback.json › characters` aujourd'hui, hors du panneau de feeling).
- **Goldens** : une clé ajoutée à `feel.json` entre dans la copie figée des tests (`tests/support/testFeel.json`) et régénère les empreintes `feelHash` des journaux golden (précédent : `camera`, story 9.2). Option A retenue par Geo : les réglages vont dans `feel.json`, et seules ces empreintes bougent.
- **`EXPERIENCE.md`** : le tableau du mouvement réduit n'a ni la couche de vie ni les attentes.

## 3. Voie recommandée

**Ajustement direct : 8 stories dans E7, dans l'ordre de production du GDD.**

- **(1) Couche de vie** (7.8) : aucun nouvel asset, l'effet se voit dès la première partie. Elle porte aussi la netteté (liseré clair, contour plus épais), de même nature (client seul).
- **(2) Squelette v2** (7.9, puis 7.10 pour les visages, qui ont besoin des sourcils).
- **(3) Première vague** (7.11, 7.12) : treize animations, en deux stories de taille comparable à la 7.2. La 7.12 apporte l'indicateur « Papa se lit sans sa bulle ».
- **Playtest de l'animation** : mesure de l'indicateur et des poses répétitives avant d'investir dans le reste.
- **(4) Le reste** (7.13 à 7.15), à réviser après ce playtest.
- **Effort** : élevé, surtout dans Blender (une trentaine de clips repris en 7.9, treize animations en première vague, une vingtaine ensuite).
- **Risques** : captures e2e macOS à régénérer à chaque story ; coût du skinning (perf.spec) ; une animation qui ressemblerait à un télégraphe ou trahirait une information cachée (règles et tests dédiés) ; empreintes `feelHash` des goldens à chaque clé de feel ajoutée.
- **Hors de ces stories** : Maman, le chien et les enfants (leurs propres stories, mêmes principes) ; le cadrage resserré du grand salon, laissé à Geo par le GDD, qui ne demande aucune story : `feel.json › camera.frameWidthM` vaut 9,1, Geo peut essayer 7,5 dans le panneau de feeling.

### Ordre de livraison proposé

… → 3.7 → 3.8 → **7.8 → 7.9 → 7.10 → 7.11 → 7.12 → playtest de l'animation (`npm run ci`, puis le lien) → 7.13 → 7.14 → 7.15** → 3.9 → 3.10 → 3.11 → E5 → E6. Les stories 7.4 et 7.5 restent dans le bloc `epic-7`.

## 4. Propositions détaillées

### 4.1 `epics.md` — Vue d'ensemble et inventaire des exigences

**Vue d'ensemble (ligne 18).**
Avant : « … complétées par la v2.3 (`planning-artifacts/sprint-change-proposal-2026-11-03.md`), de l'architecture … Il compte 9 epics et 98 stories. »
Après : « … complétées par la v2.3 (`planning-artifacts/sprint-change-proposal-2026-11-03.md`) et la v2.4 (`planning-artifacts/sprint-change-proposal-2026-11-08.md`, animation des personnages), de l'architecture … Il compte 9 epics et 106 stories. »

**Nouvelle exigence, après FR78 :**

- FR79 `[V1]` : **animation des personnages (v2.4).** Le corps de papa raconte son état sans la bulle d'activité (tâche, café, téléphone, infiltration, fatigue, bébé dans les bras). Une couche de vie s'ajoute aux animations : fondus par transition, demi-tour amorti, élan, respiration, regard, mèche, posture de fatigue. Squelette v2 (une vingtaine d'os, 32 au plus, triangles inchangés) ; quatre expressions par personnage, portées par les yeux et les sourcils ; un panel d'animations variées (une première vague de treize, puis le reste) ; des personnages détachés du décor (liseré clair, contour 1,5 fois plus épais). Une animation ne change jamais une position, une durée ni une fenêtre, ne retarde jamais une réponse (NFR2), ne ressemble à aucun télégraphe et ne trahit aucune information cachée. Une partie rejouée montre les mêmes animations. Mesurée par l'indicateur « Papa se lit sans sa bulle ».

**Carte de couverture des FR**, après FR78 : `| FR79 | E7 | Animation des personnages (v2.4) |`.

### 4.2 `epics.md` — Liste des epics et séquence

**Séquence (ligne 399).**
Avant : « … → **E9** → E3 `[V1]` (3.7 à 3.11) → E5 → E6, avec E7 et E8 en parallèle à partir de E4 (révisée le 2026-11-03). »
Après : « … → **E9** → E3 `[V1]` (3.7, 3.8) → **animation v2.4** (7.8 à 7.12 → **playtest de l'animation** → 7.13 à 7.15) → E3 `[V1]` (3.9 à 3.11) → E5 → E6, avec les autres stories d'E7 et E8 en parallèle à partir de E4 (révisée le 2026-11-08). »

**Epic 7 dans la liste.**
- Titre : « *(stories cadrées)* » → « *(7.4 et 7.5 cadrées ; 7.13 à 7.15 à réviser après le playtest de l'animation)* ».
- Ligne ajoutée à la description : « `[Animation v2.4]` Papa et le bébé bougent en continu et se détachent du décor, plient coudes et genoux, ont quatre expressions chacun et piochent dans un panel d'animations variées : le corps raconte l'état sans la bulle. Maman, le chien et les enfants suivront les mêmes principes dans les stories qui les créent. »
- « **FR couvertes :** FR60 (complète), FR62, FR70. » → « **FR couvertes :** FR60 (complète), FR62, FR70, FR79. »

**En-tête de la section Epic 7 (ligne 2605).**
Avant : « *Stories cadrées.* Le jeu quitte les cubes. »
Après : « *Stories 7.4 et 7.5 cadrées.* Le jeu quitte les cubes. Les stories 7.8 à 7.15 (v2.4) suivent l'ordre de production de la section « Animation des personnages » du GDD : couche de vie, squelette v2, première vague, puis le reste. Elles se livrent après la story 3.8 (`sprint-status.yaml`). »

### 4.3 `epics.md` — Nouvelles stories d'E7

Placées après la story 7.7, dans l'ordre des numéros.

#### Story 7.8 : Couche de vie et personnages détachés du décor

**Exigences :** FR79, NFR2
**UX :** UX-DR18

En tant que joueur,
je veux que papa et le bébé bougent en continu, avec du poids et de l'élan, et qu'ils se détachent du décor,
afin qu'ils aient l'air vivants et se lisent d'un coup d'œil sur un téléphone.

**Critères d'acceptation :**

**Étant donné** un changement de clip (se mettre en route, s'arrêter, revenir d'une pose ponctuelle)
**Quand** la vue passe d'un clip à l'autre
**Alors** le fondu démarre et finit en douceur, avec une durée par passage (0,1 s, 0,2 s et 0,15 s au départ), à la place du fondu unique de `feedback.json › characters.crossFadeMs`

**Étant donné** papa ou le bébé qui change de direction
**Quand** il se tourne
**Alors** il pivote en 0,25 s environ, démarre et freine en douceur, et dépasse sa cible de 5 à 10° avant de s'y poser, à la place de la vitesse constante de `turnRateDegPerSec` ; seule la vue tourne

**Étant donné** papa qui accélère, freine ou tourne
**Quand** sa vitesse dessinée change
**Alors** son buste penche jusqu'à 10° dans le sens de l'accélération ou du freinage, et jusqu'à 8° vers l'intérieur du virage

**Étant donné** papa et le bébé, quoi qu'ils fassent
**Quand** le temps de jeu avance
**Alors** ils respirent par-dessus leur clip, sur un cycle de 3 s, qui passe à 1,5 s quand la jauge de catastrophe dépasse 70 % ; la respiration de papa s'arrête tant qu'il retient son souffle (sortie en infiltration, story 4.9)

**Étant donné** le bébé dessiné à l'écran, ni hors cadre ni caché
**Quand** papa n'est pas en train de répondre
**Alors** la tête de papa le suit, jusqu'à 60° de chaque côté ; sinon, elle suit la menace télégraphiée visible dont l'anneau-chrono est le plus avancé ; sinon, elle revient droit devant. Elle ne suit jamais le silence suspect, et un test vérifie que le regard ne lit ni `windowOpenAt`, ni `feintAt`, ni la tolérance cachée (comme le D9 de la story 7.2)

**Étant donné** la fatigue de papa
**Quand** elle monte
**Alors** il se voûte, jusqu'à 15° à fatigue 100, en plus des parties de la dégaine (purée, cheveux en pétard, t-shirt à l'envers) ; ses paupières ne tombent qu'en micro-sieste

**Étant donné** papa et le bébé à l'écran
**Quand** une pièce est rendue
**Alors** un liseré clair suit leur pourtour, et leur contour est 1,5 fois plus épais que celui des meubles ; les personnages ont leurs propres matériaux toon (aujourd'hui, ils partagent par couleur le cache de la pièce) ; un 4ᵉ ton d'ombrage s'essaie par un réglage désactivé par défaut, que Geo tranche en jouant

**Étant donné** chaque valeur de cette story
**Quand** Geo veut la régler
**Alors** elle vit dans `feel.json › characters` (client seul, comme `camera`) et se règle à chaud dans le panneau de feeling ; `crossFadeMs` et `turnRateDegPerSec` quittent `feedback.json`

**Étant donné** le mouvement réduit
**Quand** un niveau se joue
**Alors** la respiration et l'élan s'arrêtent, et le demi-tour ne dépasse plus sa cible `[ASSUMPTION]` ; les fondus, le regard, la voûte et les poses qui portent un état restent (lignes ajoutées au tableau du mouvement réduit d'`EXPERIENCE.md`)

**Étant donné** la couche de vie
**Quand** une partie se joue, est rejouée, figée en photo de fin ou capturée par un test
**Alors** elle ne change aucune position, aucune durée ni aucune fenêtre ; aucun état final ni aucun événement des goldens ne bouge : seules leurs empreintes `feelHash` sont régénérées (`npm run golden:update`, la story le dit), puisque `feel.json › characters` entre dans la copie figée du feel (`tests/support/testFeel.json`) ; elle ne lit que l'horloge de la sim (D6 de la story 7.2), donc la même partie montre les mêmes mouvements ; un tap garde son retour visuel en 50 ms au plus ; `perf.spec.ts` tient ; les références de captures macOS sont régénérées délibérément, et la story le dit

*Hors de cette story : la mèche arrive avec le squelette v2 (7.9), et la marche traînante au-dessus de 70 de fatigue avec la 7.14.*

#### Story 7.9 : Squelette v2 et animations reprises

**Exigences :** FR79, FR70

En tant que joueur,
je veux que papa et le bébé plient les coudes et les genoux, et que leurs gestes aient de l'anticipation et du rebond,
afin que leurs mouvements soient souples et expressifs.

**Critères d'acceptation :**

**Étant donné** `assets-src/blender/characters/{papa,baby}.blend`
**Quand** leur squelette passe en v2
**Alors** chaque personnage a une vingtaine d'os, 32 au plus (`CHARACTER_BONES_MAX` ne change pas). Papa gagne les coudes, les genoux, les pieds, le cou, le bassin, une mèche et deux sourcils. Le bébé gagne les coudes, les genoux, les mains, les pieds et deux sourcils. Le nombre de triangles d'un personnage ne dépasse pas celui d'aujourd'hui

**Étant donné** chaque clip du contrat actuel (boucles et ponctuels de papa et du bébé)
**Quand** il est repris sur le squelette v2
**Alors** il garde son nom, donc `characterClips.ts` ne change pas, et il gagne de l'anticipation, du dépassement et des trajectoires en arc ; les silhouettes de jeu du D8 de la story 7.2 tiennent (hauteur de papa, bébé porté au point visé par le tap, bébé jamais plus haut que le canapé, pieds au sol)

**Étant donné** les os pilotés par le code (paupières, sourcils, mèche)
**Quand** le `.glb` est exporté
**Alors** aucun clip n'a de piste sur eux ; `characterArt.ts` et `tests/architecture/characterAssets.test.ts` vérifient les nouveaux os et cette règle sur les fichiers committés ; les sourcils restent neutres jusqu'à la story 7.10

**Étant donné** papa qui bouge
**Quand** ses gestes changent
**Alors** sa mèche les suit avec un temps de retard (réglé dans `feel.json › characters`), et elle s'arrête en mouvement réduit ; elle ne se confond pas avec les cheveux en pétard du gag de la prise

**Étant donné** les nouveaux fichiers
**Quand** `npm run dist:check` et `perf.spec.ts` tournent
**Alors** chaque `.glb` reste sous `CHARACTER_GLB_MAX_BYTES`, la charge de chaque niveau tient NFR15, et le budget de frame tient malgré le skinning plus lourd

**Étant donné** les clips repris
**Quand** la story est livrée
**Alors** des captures avant / après de chaque personnage, dans `7-9-screenshots/`, permettent à Geo de juger à l'œil ; Geo peut modifier les `.blend` et relancer les deux commandes d'export, comme pour la story 7.2 ; aucun état final ni événement des goldens ne bouge (une clé ajoutée au feel ne régénère que leurs empreintes `feelHash`), et les références de captures macOS sont régénérées délibérément

#### Story 7.10 : Visages : sourcils et expressions

**Exigences :** FR79

En tant que joueur,
je veux lire sur le visage de papa et du bébé ce qu'ils ressentent,
afin que chaque moment du jeu ait sa réaction, même à la taille d'un téléphone.

**Critères d'acceptation :**

**Étant donné** les sourcils et les paupières du squelette v2 (story 7.9)
**Quand** un moment visible du jeu arrive
**Alors** chaque personnage prend l'une de ses quatre expressions :

| Expression | Papa | Bébé |
|---|---|---|
| Surprise / joie | surpris quand une menace est télégraphiée | ravi quand il rit, quand papa le prend ou après un gag |
| Fermeté / bouderie | sourcils froncés pendant une Fermeté | boudeur juste après une Fermeté |
| Fatigue / concentration | épuisé au-dessus de 70 de fatigue (sourcils affaissés, paupières ouvertes) | concentré pendant une bêtise déjà télégraphiée |
| Fierté / sommeil | fier après une réponse parfaite | ensommeillé dans le cycle du dodo |

**Étant donné** deux moments qui se chevauchent
**Quand** les deux veulent une expression
**Alors** le plus récent l'emporte ; un état qui dure (fatigue au-dessus de 70, cycle du dodo) revient quand le moment ponctuel est fini ; la durée de chaque moment est réglée dans `feel.json › characters`

**Étant donné** les paupières de papa
**Quand** il n'est pas en micro-sieste
**Alors** aucune expression ne les baisse, pour que seule la micro-sieste les fasse tomber : ses expressions passent par les sourcils

**Étant donné** le bébé
**Quand** une menace se prépare
**Alors** il ne prend son air concentré qu'après le télégraphe de cette menace, jamais en `targetLocked` avant ; un test vérifie que le choix de l'expression ne lit ni `windowOpenAt`, ni `feintAt`, ni `realWakePct` (comme le D9 de la story 7.2)

**Étant donné** le duel du coucher, la sortie en infiltration et les feintes (faux sommeil, fausses alertes)
**Quand** ils se jouent
**Alors** aucune expression ne s'ajoute à leurs signaux : le bébé n'y paraît pas ensommeillé, et papa n'y réagit pas différemment à un vrai signal et à une feinte

**Étant donné** le mouvement réduit
**Quand** une expression change
**Alors** elle reste, car elle porte un état

**Étant donné** les quatre expressions de chaque personnage
**Quand** la story est livrée
**Alors** des captures à la taille réelle, sur un téléphone en paysage dans `7-10-screenshots/`, permettent à Geo de juger qu'elles se distinguent ; aucun état final ni événement des goldens ne bouge (une clé ajoutée au feel ne régénère que leurs empreintes `feelHash`)

#### Story 7.11 : Première vague (1/2) : déplacement et attentes de papa

**Exigences :** FR79, NFR2

En tant que joueur,
je veux que papa se mette en route, freine, marche sur la pointe des pieds et s'occupe quand il attend,
afin qu'il ait l'air d'un vrai papa et pas d'un pion.

**Critères d'acceptation :**

**Étant donné** papa à l'arrêt, puis en mouvement (et l'inverse)
**Quand** la sim le met en route ou l'arrête
**Alors** il joue un démarrage avec élan, ou un freinage, qui s'ajoute à l'élan de la couche de vie (story 7.8) ; sa position reste celle de la sim

**Étant donné** la sortie en infiltration (story 4.9)
**Quand** papa se déplace
**Alors** il marche sur la pointe des pieds au lieu de la marche ralentie d'aujourd'hui ; tant qu'il retient son souffle, ses joues sont gonflées (un nœud caché, montré par la vue comme les parties de la dégaine)

**Étant donné** papa immobile, les mains libres
**Quand** 4 s passent sans qu'il bouge
**Alors** il joue l'une de ses trois attentes (se gratter la tête, se masser la nuque, s'étirer le dos), puis une autre toutes les 5 à 8 s, jamais deux fois la même de suite ; la cadence est réglée dans `feel.json › characters`

**Étant donné** une attente, un démarrage ou un freinage en cours
**Quand** le joueur tape, ou que l'état de papa change
**Alors** l'animation est coupée dans la frame où la commande est acceptée, et le retour visuel reste à 50 ms au plus

**Étant donné** le duel du coucher, la sortie en infiltration, les feintes, le bébé dans les bras ou le mouvement réduit
**Quand** papa est immobile
**Alors** il ne joue aucune attente et garde sa boucle

**Étant donné** la même partie, rejouée ou figée en photo de fin
**Quand** papa attend
**Alors** les mêmes attentes jouent aux mêmes instants : la cadence et le choix ne dépendent que de la graine du niveau et du temps de jeu, jamais de `Math.random` ni du temps réel ; aucun état final ni événement des goldens ne bouge (une clé ajoutée au feel ne régénère que leurs empreintes `feelHash`)

**Étant donné** les nouveaux clips
**Quand** la story est livrée
**Alors** des tests unitaires vérifient la cadence (première attente à 4 s, écarts de 5 à 8 s, jamais deux fois la même, même résultat pour la même partie) ; un test e2e vérifie qu'un papa immobile joue une attente et qu'un tap la coupe ; aucune attente ne ressemble à un télégraphe (pas de bâillement, paupières ouvertes), et Geo en juge sur les captures de `7-11-screenshots/`

#### Story 7.12 : Première vague (2/2) : tâches, réponses, réactions et bébé

**Exigences :** FR79, FR68

En tant que joueur,
je veux que papa remue la casserole, ramasse les débris, pare de plus d'une façon et souffle quand il s'en sort de justesse, et que le bébé s'assoie, tape des mains et rie de plus d'une façon,
afin que la partie ne répète plus les mêmes gestes.

**Critères d'acceptation :**

**Étant donné** papa à la tâche « cuisine » (story 9.5)
**Quand** il est au poste
**Alors** il remue la casserole au lieu d'attendre ; la tâche « lave-vaisselle » garde son attente jusqu'à la story 7.14

**Étant donné** papa qui ramasse un débris (`pickingUp`)
**Quand** la sim le fait ramasser
**Alors** il joue un geste de ramassage, au rythme de la durée de la sim, qui ne change pas

**Étant donné** une réponse Parer
**Quand** elle se joue
**Alors** papa joue l'une de ses deux variantes, jamais deux fois la même de suite ; les deux gardent la silhouette de Parer ; le choix ne dépend que de la graine du niveau et de la sim, pas de `Math.random`

**Étant donné** une réussite (pas une parfaite) dans le dernier quart de la fenêtre, tolérance cachée comprise (`offsetMs` et `responseWindow` de `ResponseResolved`)
**Quand** elle est jugée
**Alors** papa pousse un soupir de soulagement, qui ne l'occupe pas : un tap le coupe ; le quart est réglé dans `feel.json › characters`

**Étant donné** le bébé arrêté depuis un moment réglé dans `feel.json › characters`
**Quand** la sim le garde sur place
**Alors** il s'assoit, puis il repart à quatre pattes dès que la sim le remet en mouvement, sans que sa position prenne de retard : il ne s'assoit jamais en mouvement

**Étant donné** le bébé assis ou au repos
**Quand** il attend
**Alors** il tape des mains, à une cadence réglée comme les attentes de papa (story 7.11)

**Étant donné** le bébé qui rit
**Quand** il rit plusieurs fois
**Alors** il joue l'un de ses deux rires, jamais deux fois le même de suite

**Étant donné** le duel du coucher, la sortie en infiltration, les feintes ou le mouvement réduit
**Quand** le bébé est au repos
**Alors** il ne s'assoit pas, ne tape pas des mains et garde sa boucle ; aucune de ses animations ne ressemble à un télégraphe (il ne se hisse pas, ne fixe pas un point, n'accélère pas)

**Étant donné** un build de dev ou de playtest ouvert avec `?bubble=off` (ignoré par la production, comme `?level`)
**Quand** un niveau se joue
**Alors** la bulle d'activité de papa n'est pas dessinée, et tout le reste ne change pas, pour les extraits de l'indicateur « Papa se lit sans sa bulle »

**Étant donné** les observations de Geo pendant ces extraits (tâche, café, téléphone, infiltration, fatigue, bébé dans les bras)
**Quand** `npm run playtest:metrics` tourne
**Alors** il calcule l'indicateur « Papa se lit sans sa bulle » : au moins 4 testeurs sur 5 nomment ce que fait papa, et aucun ne trouve spontanément une pose répétitive ; les seuils sont dans `content/playtest.json`, et les colonnes dans `observations.example.csv` et `observation-sheet.md`

**Étant donné** les nouveaux clips
**Quand** la story est livrée
**Alors** aucun état final ni événement des goldens ne bouge (une clé ajoutée au feel ne régénère que leurs empreintes `feelHash`) ; Geo juge les animations sur les captures de `7-12-screenshots/`

*Règles communes aux stories 7.13 à 7.15, à réviser après le playtest de l'animation :* aucune animation ne ressemble à un télégraphe ni ne trahit une information cachée ; aucune variante ni attente pendant le duel du coucher, la sortie en infiltration et les feintes ; jamais deux fois la même variante de suite ; le choix ne dépend que de la graine du niveau et de la sim ; un tap coupe toute réaction ; en mouvement réduit, les attentes s'arrêtent ; aucun état final ni événement des goldens ne bouge (une clé ajoutée au feel ne régénère que leurs empreintes `feelHash`) ; Geo juge sur les captures de la story.

#### Story 7.13 : Variantes de réponses et pose de combo

**Exigences :** FR79

En tant que joueur,
je veux que papa ne réponde jamais deux fois de la même façon, et qu'il s'emballe quand le combo monte,
afin que les réussites restent drôles du début à la fin.

**Critères d'acceptation :**

**Étant donné** une réponse Parer, Fermeté ou parfaite
**Quand** elle se joue
**Alors** papa joue l'une de ses deux ou trois variantes, qui gardent toutes la silhouette de la réponse ; Attendre et Ne rien faire n'ont pas de variante

**Étant donné** une menace qui a son propre geste (fermer le placard bas, plaquer la main sur la prise)
**Quand** papa y répond
**Alors** il joue ce geste ; la menace le nomme dans son JSON, et un test vérifie que chaque geste nommé existe dans le `.glb`

**Étant donné** le combo
**Quand** il atteint x3, puis x6
**Alors** la pose de réponse s'emballe d'un cran à chaque palier ; les deux paliers sont réglés dans `feel.json › characters`

#### Story 7.14 : Allures, tâches et réactions de papa

**Exigences :** FR79

En tant que joueur,
je veux que l'allure de papa trahisse la panique et la fatigue, qu'il fasse vraiment les tâches et qu'il réagisse à ses gags,
afin que son corps raconte la partie.

**Critères d'acceptation :**

**Étant donné** la jauge de catastrophe au-dessus de 70 %, ou la fatigue au-dessus de 70
**Quand** papa se déplace
**Alors** il court, paniqué, ou il traîne les pieds, à la vitesse de la sim : seule l'allure change ; si les deux valent, la course paniquée l'emporte `[ASSUMPTION]`

**Étant donné** la tâche « lave-vaisselle », puis la tâche « cuisine »
**Quand** papa est au poste
**Alors** il vide le lave-vaisselle au lieu d'attendre, et il goûte la purée en variante de la cuisine `[ASSUMPTION]` ; le télégraphe d'un temps fort ou un tap coupe le geste

**Étant donné** un gag, une fois sa séquelle finie
**Quand** papa est libre
**Alors** il fait un facepalm ou un regard caméra, qui ne l'occupe pas

#### Story 7.15 : Reste du panel du bébé

**Exigences :** FR79

En tant que joueur,
je veux un bébé qui joue, boude, applaudit et s'endort pour de vrai,
afin qu'il ait une personnalité et pas seulement des bêtises.

**Critères d'acceptation :**

**Étant donné** le bébé au repos
**Quand** il attend
**Alors** il tape des mains, joue avec ses orteils ou suce son pouce, jamais deux fois la même attente de suite

**Étant donné** un rire, une Fermeté, une réponse parfaite
**Quand** ils arrivent
**Alors** il joue son troisième rire, une moue boudeuse, ou il applaudit

**Étant donné** le cycle du dodo, hors du duel du coucher, de la sortie en infiltration et des feintes
**Quand** le bébé est porté ou au repos
**Alors** il bâille et se frotte les yeux

**Étant donné** une menace du bébé
**Quand** elle a été télégraphée, et seulement après
**Alors** il peut pointer l'objet de la menace ; il ne pointe jamais un objet hors cadre, ni pendant un silence suspect

### 4.4 `epics.md` — Story existante modifiée

**Story 7.4 (célébration finale et cadrages parodiques).** « **Exigences :** FR62 » → « **Exigences :** FR62, FR79 ». Deux critères ajoutés à la fin :

**Étant donné** un niveau qui finit sans que Maman soit rentrée plus tôt
**Quand** la célébration finale se joue
**Alors** papa y danse sa danse de victoire, qui fait partie de la célébration

**Étant donné** « Maman est rentrée plus tôt ! » (jauge de catastrophe à 100 %)
**Quand** la porte s'ouvre
**Alors** papa s'effondre, en gag et sans blessure (NFR9)

Lecture retenue : « effondrement quand Maman rentre » (GDD) vaut pour le niveau perdu seulement, sinon il entrerait en concurrence avec la danse de victoire à la fin d'un niveau réussi.

### 4.5 `sprint-status.yaml`

En-tête, sous « ORDRE DE LIVRAISON » :

```yaml
# - Animation v2.4 (sprint-change-proposal-2026-11-08.md) : 7.8 à 7.12, un playtest de l'animation,
#   puis 7.13 à 7.15, se livrent après 3.8 et avant 3.9. Les clés 7-x restent rattachées à epic-7.
```

Entre `3-8-memoire-de-maman: done` et `3-9-replay-des-meilleurs-moments: backlog` :

```yaml
  # Animation v2.4 (2026-11-08) — après 3.8, avant 3.9. Ordre de production du GDD :
  # couche de vie, squelette v2, première vague, puis le reste.
  7-8-couche-de-vie-et-personnages-detaches-du-decor: backlog
  7-9-squelette-v2-et-animations-reprises: backlog
  7-10-visages-sourcils-et-expressions: backlog
  7-11-premiere-vague-deplacement-et-attentes-de-papa: backlog
  7-12-premiere-vague-taches-reponses-reactions-et-bebe: backlog
  # Playtest de l'animation (indicateur « Papa se lit sans sa bulle ») : npm run ci, puis le lien.
  7-13-variantes-de-reponses-et-pose-de-combo: backlog
  7-14-allures-taches-et-reactions-de-papa: backlog
  7-15-reste-du-panel-du-bebe: backlog
```

`last_updated` passe à `2026-11-08` (commentaire et champ). `epic-7` reste `in-progress`.

### 4.6 Architecture (`game-architecture.md`)

**Retours multimodaux › Mouvement réduit (ligne 253)**, phrase ajoutée : « Animation des personnages (v2.4, 2026-11-08) : la respiration, l'élan, la mèche et les attentes s'arrêtent, et le demi-tour ne dépasse plus sa cible ; les clips, les poses qui portent un état, la voûte de fatigue, le regard et les expressions restent. »

**Contenu et feeling (ligne 264)** : « … et depuis v2.3 (2026-11-03) `catastrophe`, `director` (`fairnessMarginMs`) et `camera` (zone morte, rattrapage) » + « , et depuis v2.4 (2026-11-08) `characters` (couche de vie, cadence des attentes, expressions, netteté ; client seul) ».

**Nouvelle sous-section, après « Gestion des assets » :**

> ### Animation des personnages (v2.4)
>
> - **Client seul.** La couche de vie, les variantes, les attentes et les expressions vivent dans `src/client/render/views/`. La sim n'en sait rien, et aucune ne change une position, une durée ni une fenêtre.
> - **Ordre dans une frame :** l'état choisit la boucle et les événements les ponctuels (D5 de la story 7.2) ; le mixer avance du `dt` de la sim ; la couche de vie ajoute ses rotations (bassin, buste, cou, tête : élan, respiration, voûte, regard) ; les os pilotés par le code (paupières, sourcils, mèche) sont écrits en dernier. Aucun clip n'a de piste sur un os piloté par le code.
> - **Fondus et demi-tour :** une durée de fondu par passage (mise en route, arrêt, retour d'un ponctuel), sur une courbe douce. Le demi-tour est un ressort sous-amorti sur le cap dessiné. Ils remplacent `feedback.json › characters.crossFadeMs` et `turnRateDegPerSec`.
> - **Reproductible :**
>   - Tout avance sur l'horloge de la sim (D6 de la story 7.2).
>   - Les ressorts (demi-tour, élan, mèche) s'intègrent au pas fixe de la sim (`STEP_MS`), pas à la frame : la photo de fin, le replay et les captures ne dépendent pas du framerate.
>   - Le choix d'une variante ou d'une attente est une fonction pure de la graine du niveau, d'instants de la sim et de compteurs que le `World` porte déjà (réponses jugées, combo). Jamais `Math.random`, ni le temps réel, ni `world.rng` : le client ne tire pas dans le PRNG de la sim.
>   - « Jamais deux fois la même de suite » tient aussi dans un replay qui repart d'un snapshot (story 3.9) : la vue ne garde pas en mémoire la variante précédente, elle la recalcule à partir des mêmes entrées.
> - **Interruption :** une commande acceptée ou un changement d'état de papa coupe une attente, une réaction ou un démarrage dans la même frame. Le fondu de mise en route est le plus long admis, et NFR2 tient.
> - **Information cachée (extension du D9 de la story 7.2) :** ces modules ne lisent que papa, le bébé, les événements et ce que l'écran montre (anneau-chrono, bulles).
>   - Le regard suit le bébé dessiné et non caché, sinon la menace télégraphiée visible dont l'anneau est le plus avancé ; jamais le silence suspect.
>   - Pendant le duel du coucher, la sortie en infiltration et les feintes, aucune variante, aucune attente ni aucune expression ne s'ajoute aux signaux.
>   - Un test scanne ces modules à la recherche de `windowOpenAt`, `feintAt`, `realWakePct` et de la tolérance cachée.
> - **Contrat des personnages :** os v2 (32 au plus : `CHARACTER_BONES_MAX` ne change pas), os pilotés par le code, nœuds cachés (joues gonflées), clips et variantes. `characterArt.ts` et `tests/architecture/characterAssets.test.ts` les vérifient. Le budget de triangles ne change pas.
> - **Netteté :** les personnages ont leurs propres matériaux toon (liseré clair) et un contour 1,5 fois plus épais que celui des meubles, sans draw call de plus. Le 4ᵉ ton d'ombrage est un réglage.
> - **Réglages :** `feel.json › characters`, client seul comme `camera`, donc dans le panneau de feeling (FR65). Une clé ajoutée entre dans la copie figée des tests et régénère les empreintes `feelHash` des goldens. `feedback.json › characters` garde les tables liées aux assets (`squash`, `clipSpeeds`, `papaClipFacing`, `busyProps`).

**Correspondance epics → architecture**, après la ligne « E7 Personnages riggés et animés » :

| E7 (v2.4) | Couche de vie, netteté (7.8) | `src/client/render/views/`, `materials/`, `feel.characters` | Animation des personnages |
| E7 (v2.4) | Squelette v2, visages, panel (7.9 à 7.15) | `assets-src/blender/characters/`, `public/assets/characters/`, `characterClips.ts`, `characterArt.ts` | Contrat des personnages, D9 étendu |

### 4.7 UX (`EXPERIENCE.md`)

Tableau du mouvement réduit, deux lignes après « Characters' squash and stretch » :

| Characters' life layer (v2.4): breathing, lean, forelock | Removed, and the damped turn no longer overshoots `[ASSUMPTION]`. The fades, the gaze, the fatigue stoop, the expressions and any pose that carries a state stay |
| Characters' idle variants (v2.4) | Removed: Papa and the baby hold their loop |

`DESIGN.md` ne change pas (il ne couvre que l'UI).

### 4.8 Autres artefacts (à faire dans les stories, pas maintenant)

`content/feel.json` (`characters`), `tests/support/testFeel.json`, schémas Zod et `content/_schemas/`, `content/feedback.json` (`crossFadeMs` et `turnRateDegPerSec` retirés), `src/shared/constants.ts` si un budget bouge, `tools/assets/characterArt.ts` et `tests/architecture/characterAssets.test.ts`, `assets-src/blender/characters/*.blend` et `public/assets/characters/*.glb`, les empreintes `feelHash` des goldens, les références de captures macOS, `content/playtest.json`, `docs/playtest/observations.example.csv` et `observation-sheet.md`, `tools/playtest/` (`playtest:metrics`), `deferred-work.md`. Chaque story le dit.

## 5. Passage de relais

**Portée : modérée.** Le cap du jeu ne change pas. Huit stories s'ajoutent à une epic existante, une story gagne deux critères, l'ordre de livraison change, et trois documents de planification sont mis à jour.

| Rôle | Responsabilité |
|---|---|
| Link Freeman (cette session, `gds-correct-course`) | Après l'accord de Geo : applique §4.1 à 4.5 à `epics.md` et `sprint-status.yaml`, §4.6 à l'architecture et §4.7 à `EXPERIENCE.md` ; commit sur `main` (fichiers sous `_bmad-output/` uniquement) |
| Link Freeman (`gds-create-story`, `gds-dev-story`, `gds-code-review`) | Crée et développe 7.8 à 7.15 dans l'ordre du §3, une branche et un worktree par story |
| Geo | Approuve la proposition ; juge les animations sur les captures de chaque story ; règle `feel.json › characters` en jouant ; essaie le cadrage resserré (`camera.frameWidthM`) ; joue le playtest de l'animation après 7.12 |

**Critères de réussite :**

- Après 7.8 : papa et le bébé bougent en continu, sans qu'aucun état final ni événement des goldens ne bouge ; `perf.spec.ts` tient.
- Après 7.12, au playtest de l'animation : l'indicateur « Papa se lit sans sa bulle » tient (au moins 4 testeurs sur 5 nomment ce que fait papa sur des extraits sans bulle, et aucun ne trouve spontanément une pose répétitive) ; NFR1 et NFR2 tiennent.
- Après 7.15 : aucune animation ne ressemble à un télégraphe, aucune ne trahit une information cachée, et une partie rejouée montre les mêmes animations.
