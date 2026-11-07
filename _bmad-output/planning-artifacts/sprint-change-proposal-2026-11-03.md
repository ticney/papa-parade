---
title: Sprint Change Proposal — GDD v2.3 (premier playtest de Geo)
date: 2026-11-03
trigger: GDD v2.3 (commit ff2d0b7) + éléments de la GDD v2.2 jamais découpés en stories
mode: batch
scope: modéré (réorganisation du backlog, nouvelle epic, mises à jour d'artefacts)
status: approuvé par Geo le 2026-11-03, appliqué
---

# Sprint Change Proposal — GDD v2.3

Document en français, comme le GDD, `epics.md` et l'architecture (dérogation à `document_output_language`, décision du 2026-10-26).

## 1. Résumé du problème

**Déclencheur.** Premier playtest de Geo sur le prototype (salon, 2026-11-03), puis la mise à jour du GDD en v2.3.

**Type.** Exigences nouvelles issues du playtest, plus un écart de planification : les ajouts de la v2.2 (2026-10-29) n'ont jamais été découpés en stories.

**Constats (preuves) :**

| Constat de Geo | Mesure / cause |
|---|---|
| Score toujours à 1 étoile ; Rires, Sans soupir, Sans hurlement à 0, la 4ᵉ ligne toujours à 20 | `computeMamaScore` : Rire = parfaites seulement ; « État du bébé » fixé à 20 (`feel.mama.babyStateFixedPoints`) ; Soupir et Hurlement saturent à 3 objets au sol ou 5 ratés. Total 20 = seuil de la 1ʳᵉ étoile |
| Impossible de savoir quand taper ; parfaites obscures | Aucun repère du délai (0,8–1,5 s) avant une fenêtre parfaite de 100 ms. L'anneau-chrono, spécifié en v2.2, n'existe ni dans `epics.md` ni dans `sprint-status.yaml` |
| Bébé derrière le canapé en concurrence avec une autre menace : perdant à coup sûr | `salon_crawler` vague 2 : `maxSimultaneous: 2`, écart 1–3 s ; le directeur ignore l'occupation de papa pendant la recherche du silence suspect |
| On ne comprend pas que papa boit un café ou téléphone | Clips `drink` / `on_phone` et accessoires minuscules en vue iso ; aucun signal d'occupation ; les taps sont ignorés en silence (`inputMapper`) |
| Il manque des activités ; la pièce est trop petite | Demande de diversité : bêtises, tâches de papa, grand salon avec cuisine ouverte |
| — | Le bot `human` fait 84 points / 4 étoiles sur le salon (75 % de parfaites) quand Geo fait 20 / 1 : les indicateurs simulés trompent |

## 2. Analyse d'impact

### Checklist

| # | Point | Statut | Note |
|---|---|---|---|
| 1.1 | Story déclencheuse | [x] | Aucune : playtest du prototype (E1–E4, 3.5, 3.6 livrés) |
| 1.2 | Problème | [x] | Lisibilité du timing, injustice du directeur, note bloquée, occupation illisible, contenu |
| 1.3 | Preuves | [x] | Tableau ci-dessus ; rapports `npm run sim` (human / perfect, salon et chambre, 5 parties) |
| 2.1 | Epic en cours | [x] | E3 `[V1]` (3.7–3.11) reste valable ; il passe après le rattrapage et E9 |
| 2.2 | Changements d'epic | [!] | Stories ajoutées à E2 et E3 ; nouvelle epic E9 |
| 2.3 | Epics futures | [!] | E5 : « État du bébé » devient « Calme du bébé » jusqu'à E5. E6 : la casserole passe dans E9. E7 : 7.5 (bibliothèque sonore) pèse sur le budget du grand salon |
| 2.4 | Epics obsolètes / nouvelles | [x] | Aucune obsolète ; E9 « Grand salon et maison » |
| 2.5 | Ordre | [!] | Rattrapage → playtest → E9 → E3 `[V1]` restant → E5 |
| 3.1 | Exigences (FR/NFR) | [!] | FR19, FR30, FR31, FR33, FR34, NFR9 modifiées ; FR71–FR78, NFR15 nouvelles |
| 3.2 | Architecture | [!] | Vue fixe, directeur, `LevelEnded`, jauges, séquences de tâches, budget, caméra et hit-test |
| 3.3 | UX | [!] | Anneau-chrono, bulle hors cadre, bulle d'activité, 5 lignes de résultat, jauge de catastrophe, caméra |
| 3.4 | Autres artefacts | [!] | `content/feel.json` (mama), `content/strings.fr.json`, `dist:check` (budget), specs e2e du HUD et du résultat, goldens |
| 4.1 | Ajustement direct | Viable | 16 stories (8 au rattrapage, 8 en E9) ; effort moyen puis élevé, risque faible |
| 4.2 | Retour arrière | Non viable | Rien à défaire : tout s'ajoute |
| 4.3 | Revue du MVP | Non nécessaire | Le pitch et les piliers tiennent ; le pilier 1 est précisé |
| 4.4 | Voie retenue | [x] | Ajustement direct + nouvelle epic |

### Impact sur les epics

- **E2 (Game feel et lisibilité)** : +3 stories (2.11 anneau-chrono, 2.12 bulle d'activité, 2.13 poses exagérées).
- **E3 (Bruit et Maman)** : +5 stories de rattrapage (3.12 note sur cinq lignes, 3.13 équité de trajet, 3.14 joueur simulé humain réaliste, 3.15 séquelles, 3.16 jauge de catastrophe). 3.7–3.11 inchangées, déplacées après E9.
- **E9 (nouvelle, Grand salon et maison, troisième prototype)** : 8 stories.
- **E5** : la story 5.2 (« états cachés et note réelle ») remplace « Calme du bébé » par propre / nourri / reposé, sur 20 points au lieu de 30.
- **E6** : la casserole sur le feu sort de la story 6.1 (chien et casserole) et passe en 9.5.
- **E7** : 7.5 (bibliothèque sonore) doit tenir dans NFR15.

### Conflits d'artefacts relevés

- **Architecture** : L50 « Vue isométrique fixe » ; L273 directeur sans règle d'espacement ; L735 « Papa occupé … la nouvelle commande est acceptée » ; ADR-003 rend la glissade cosmétique alors que l'équité la traite comme une contrainte ; L405–411 `LevelEnded` sans raison `mamaHome` ; L496 flux sans sortie anticipée ; L1090 « ≤ 3 Mo par niveau » ; L220 hit-test à travers une caméra désormais mobile.
- **UX** : D518 / E87 / E227 / E323 / E562 « 4 lignes » ; D523 / E207 « 3 jauges au plus », bande ≤ 12 % ; E127 « Maman jamais pendant le jeu » ; E136 mots interdits ; D464 tiers bas libre ; D492 règles de formes et couleurs ; combo-badge déjà au-dessus de papa ; aucun motif de tap refusé ; E453 « la caméra garde toute la pièce visible ».
- **Epics** : NFR9 « aucun game over » ; FR33 « sans fin anticipée » ; FR34 formule à 4 lignes ; UX-DR13 4 lignes ; story 7.6 « charge sous 3 Mio ».

## 3. Voie recommandée

**Ajustement direct + nouvelle epic E9.**

- Le rattrapage (8 stories, E2 et E3) corrige ce que le playtest a montré, dans le salon actuel, sans nouvel asset de pièce. Un playtest suit avant E9, pour mesurer l'effet de l'anneau et de la note sans mélanger avec le grand salon.
- E9 porte l'agrandissement voulu par Geo. Elle dépend du rattrapage : la bulle hors cadre réutilise l'anneau-chrono, les tâches réutilisent la bulle d'activité et la ligne Maison.
- **Effort** : rattrapage moyen (8 stories, dont 2 de sim profondes : 3.15, 3.16) ; E9 élevé (pièce Blender, caméra, nouveau cadre de séquence).
- **Risques** : la jauge de catastrophe et les séquelles touchent la fin de niveau (goldens à régénérer, à dire dans la story) ; la caméra qui suit touche le hit-test tactile et toutes les captures e2e ; le budget du grand salon dépend de l'audio.
- **Calendrier** : le playtest du rattrapage arrive avant toute nouvelle pièce ; E5 recule d'une epic.

### Ordre de livraison proposé

1. **3.12** Note de Maman sur cinq lignes — la plus petite, effet immédiat sur la frustration.
2. **2.11** Anneau-chrono — la cause principale.
3. **3.13** Équité de trajet.
4. **2.12** Bulle d'activité et tap refusé visible.
5. **2.13** Poses exagérées du café et du téléphone.
6. **3.14** Joueur simulé humain réaliste — après 2.11, car l'anneau change ce qu'un humain peut faire.
7. **3.15** Séquelles des gags.
8. **3.16** Jauge de catastrophe et « Maman est rentrée plus tôt ! ».
9. **Playtest** du salon actuel (build de playtest, journaux, `playtest:metrics`).
10. **E9** (9.1 → 9.8).
11. **E3 `[V1]`** restant (3.7–3.11), puis E5.

## 4. Propositions détaillées

### 4.1 `epics.md` — Inventaire des exigences

**FR19 (silence-télégraphe)** — ajout en fin de ligne :

> NOUVEAU : … une vibration courte part. Dans une grande pièce filmée par une caméra qui suit, la bulle « … » reste sans flèche ni direction : trouver le bébé reste le défi (v2.3).

**FR30 (perturbations)** — la casserole :

> ANCIEN : casserole … (perturbation d'escalade, E6)
> NOUVEAU : casserole sur le feu : conséquence d'une cuisson de la tâche « cuisine » laissée seule plus de 30 s (E9, FR76).

**FR31 (vagues)** — ajout :

> NOUVEAU : … Vague 3 : trois simultanées et une perturbation. « Simultanées » veut dire actives en même temps, avec des fenêtres décalées selon la règle d'équité de trajet (FR75).

**FR33 (variante Retour)** :

> ANCIEN : variante Retour (3 min, Maman rentre à la fin du chrono, sans fin anticipée)
> NOUVEAU : variante Retour (3 min, Maman rentre à la fin du chrono). Seule fin anticipée : la jauge de catastrophe pleine (FR73).

**FR34 (note de Maman)** — remplacée :

> NOUVEAU : FR34 `[P]` : note de Maman. Score = Rire (0–35) + Calme du bébé (0–20) + Maison (0–15) + 30 − Soupir (0–15) − Hurlement (0–15), sur 100. Rire : 1 point par parfaite, 0,5 par réussite, plus les combos encaissés. Calme du bébé : jusqu'à E5, la part du niveau passée sous 50 % de la jauge de bruit (Sieste) ou sans pleurs (Retour) ; E5 la remplace par propre, nourri, reposé. Maison : tâches de la maison finies (0 dans un niveau sans tâche). Soupir : 2,5 par objet au sol, 4 par objet cassé, 1,5 par bêtise surprise. Hurlement : 1,5 par presque-accident. Étoiles à 20, 40, 60, 75 et 90. Réveil anticipé : −1 étoile. Catastrophe : 0 étoile (FR73). Toutes les valeurs sont dans `feel.json` (décision de Geo, 2026-11-03).

**Nouvelles FR (après FR70)** :

- **FR71 `[P]` : anneau-chrono.** Un anneau entoure l'icône de chaque menace à réponse Parer, Fermeté ou Esquiver ; il se remplit en temps de jeu du télégraphe à la fin de la fenêtre affichée. Le dernier arc (la fenêtre de réponse) s'allume et s'épaissit ; une encoche marque la fenêtre parfaite. Il reflète les fenêtres réelles (fatigue, instinct, palier) ; la tolérance cachée n'est pas dessinée. Pas d'anneau sur Attendre, Ne rien faire, ni les feintes. Vibration courte quand le dernier arc s'allume.
- **FR72 `[P]` : séquelles des gags.** Chaque gag laisse une séquelle (catalogue des menaces du GDD). Une séquelle qui occupe papa dure 2 s au plus, glissade comprise (micro-sieste : 3 s) ; elles ne se cumulent pas ; les séquelles de décor se cumulent.
- **FR73 `[P]` : jauge de catastrophe.** 0–100 %, visible pendant le jeu sous la forme du visage de Maman. Hausses : presque-accident +35 %, bazar +20 %, micro-sieste ratée +15 %, temps fort de tâche raté +10 % ; −0,5 %/s ; −5 % par parfaite ; multipliée par palier. Au-dessus de 70 % : musique tendue, visage en alerte, vibration. À 100 % : « Maman est rentrée plus tôt ! », la porte s'ouvre sans rush final, photo, 0 étoile.
- **FR74 `[P]` : bulle d'activité de papa.** Pendant chaque occupation (café, téléphone, toilettes, tâche, séquelle), une bulle au-dessus de papa montre le pictogramme de l'action et un anneau qui se vide jusqu'à ce qu'il puisse répondre. Poses exagérées ; début et fin marqués (écrasement ; « ding », pop, vibration). Un tap sur une menace pendant une occupation est refusé de façon visible et audible.
- **FR75 `[P]` : équité de trajet.** Deux fenêtres de réponse ne s'ouvrent jamais à moins de « glissade max du niveau + 0,3 s » l'une de l'autre. Tant que papa cherche puis soulève le bébé du silence suspect, aucune autre fenêtre ne s'ouvre avant qu'il puisse l'atteindre une fois libre. Un silence suspect actif compte pour deux menaces simultanées. Les séquelles et les occupations choisies (café, téléphone, tâche) ne sont pas protégées.
- **FR76 `[P3]` : tâches de la maison.** Tâches facultatives à un poste (cuisine, lave-vaisselle), jouées en temps forts de Parer (anneau-chrono, fenêtre 300 ms), interruptibles à tout moment avec progression gardée, en attente pendant la fenêtre d'une menace. Une tâche finie remplit la ligne Maison. Un temps fort raté est un petit gag.
- **FR77 `[P3]` : grand salon et caméra qui suit.** Un grand salon avec cuisine ouverte (environ 13–14 × 7 m) remplace le salon. La caméra suit papa avec une zone morte, sans rotation (sauf la rotation courte d'une parfaite). Une menace hors cadre est signalée par une bulle d'info au bord de l'écran (icône, anneau-chrono, flèche), qu'on peut taper. Glissade plafonnée à 0,9 s dans cette pièce.
- **FR78 `[P3]` : nouvelles bêtises.** Bêtises du grand salon tirées de la liste candidate du GDD (nappe, placard bas, lave-vaisselle ouvert, poubelle, plante verte, tasse de papa), triées par Geo, avec les réponses existantes.

**NFR9** :

> ANCIEN : contenu tout public ; aucune blessure montrée, aucun game over ; un échec fait rire.
> NOUVEAU : contenu tout public ; aucune blessure montrée, aucun game over sec : un niveau ne se termine jamais au premier raté, et une fin anticipée (« Maman est rentrée plus tôt ! ») est un gag, sans les mots « perdu », « échec » ou « game over ». Un échec fait rire.

**NFR15 (nouvelle)** :

> NFR15 : poids d'un niveau (glb + audio du niveau) ≤ 3 Mo, sauf le grand salon (E9) : ≤ 5 Mo, avec un chargement de moins de 5 s en 4G. Les budgets de rendu (≤ 100 draw calls, ≤ 100 000 triangles) ne changent pas. [ASSUMPTION: 5 Mo à confirmer avec l'audio réel de E9.]

**Nouveaux UX-DR (après UX-DR26)** :

- **UX-DR27 : anneau-chrono.** 5 px autour de l'icône de menace, à l'extérieur du `hold-ring` (2 px d'écart). Progression `paper` sur `ring-track`, contour `ink` de 2 px ; dernier arc `alert`, épaissi à 8 px ; encoche parfaite : un trait `ink` de 2 px. Jamais aux couleurs `parry` / `dodge`. Pendant un maintien (Fermeté), le `hold-ring` se remplit à l'intérieur et l'anneau-chrono se vide jusqu'à la fin de l'attaque.
- **UX-DR28 : bulle d'activité et tap refusé.** Bulle `paper` au-dessus de papa avec pictogramme `ink` ; anneau qui se vide (visuel du `hold-ring`, sens antihoraire). Si le combo-badge est affiché, il se décale à droite de la bulle. Tap refusé : la bulle tremble 150 ms et un son « occupé » ; pas de `tap-marker`.
- **UX-DR29 : jauge de catastrophe.** Le visage de Maman dans la zone haute, à côté du chrono (elle n'occupe pas une 4ᵉ pastille de jauge) ; 4 états d'inquiétude ; alerte au-dessus de 70 % (pulsation sous 3 Hz, vibration). Ce visage n'est pas la note : E127 reste vrai pour le score. Fin anticipée : bandeau « Maman est rentrée plus tôt ! » sur le résultat, sur le modèle de « Maman s'est réveillée ! ».
- **UX-DR30 : bulle d'info hors cadre.** Bulle collée aux bords gauche, droit ou haut, jamais dans le tiers bas (une menace en bas s'affiche au bas d'un bord latéral, au-dessus de la zone des pouces) ; icône de la menace, anneau-chrono, flèche. Tapable (même cible que la menace). 3 au plus (une par menace active). Le silence suspect garde sa `silence-bubble` sans flèche.

**UX-DR13 (résultat)** — cinq lignes : « Rires » /35, « Calme du bébé » /20, « Maison » /15, « Sans soupir » /15, « Sans hurlement » /15. Accents à définir dans DESIGN.md pour « Calme du bébé » et « Maison ».

**Cartes de couverture** : FR71, FR74 → E2 ; FR72, FR73, FR75 → E3 ; FR76, FR77, FR78 → E9 ; FR34 → E1, E3 (3.12) ; UX-DR27 → 2.11 ; UX-DR28 → 2.12 ; UX-DR29 → 3.16 ; UX-DR30 → 9.3 ; UX-DR13 → 1.22, 3.12.

### 4.2 `epics.md` — Liste des epics et séquence

> ANCIEN : E1 → E2 → E3 `[P]` → **playtest** → E4 → E3 `[V1]` → E5 → E6, avec E7 et E8 en parallèle à partir de E4.
> NOUVEAU : E1 → E2 → E3 `[P]` → **playtest** → E4 → E3 `[V1]` (3.5, 3.6) → **rattrapage v2.3** (2.11–2.13, 3.12–3.16) → **playtest** → **E9** → E3 `[V1]` (3.7–3.11) → E5 → E6, avec E7 et E8 en parallèle à partir de E4.

Ajouts aux résumés : E2 « + anneau-chrono, bulle d'activité de papa (v2.3) », FR couvertes + FR71, FR74 ; E3 « + note sur cinq lignes, équité de trajet, joueur simulé humain réaliste, séquelles, jauge de catastrophe (rattrapage v2.3) », FR couvertes + FR34 (révisée), FR72, FR73, FR75 ; nouvelle entrée E9 (texte en 4.5). Vue d'ensemble : « 9 epics et 98 stories » (le décompte de 80 était déjà dépassé : 82 stories avant la v2.3), « UX-DR1 à UX-DR30 ».

### 4.3 `epics.md` — Nouvelles stories d'E2

#### Story 2.11 : Anneau-chrono autour des menaces `[P]`

**Exigences :** FR71, FR53
**UX :** UX-DR27, UX-DR10

En tant que joueur,
je veux voir combien de temps il me reste et quand taper,
afin de pouvoir réussir une parade parfaite exprès.

**Critères d'acceptation :**

**Étant donné** une menace à réponse Parer, Fermeté ou Esquiver qui passe en `telegraph`
**Quand** le temps de jeu avance
**Alors** un anneau se remplit autour de son icône, de 0 au télégraphe à plein à la fin de la fenêtre affichée (délai + fenêtre effective), sans dessiner la tolérance cachée
**Et** le dernier arc correspond à la fenêtre effective (palier, fatigue, instinct) et s'allume au moment où elle s'ouvre, avec une vibration courte
**Et** une encoche marque la fenêtre parfaite

**Étant donné** un ralenti, un hitstop ou la pause
**Quand** l'anneau est affiché
**Alors** il ralentit, se fige ou s'arrête avec le temps de jeu

**Étant donné** une menace Attendre, Ne rien faire ou une feinte (faux sommeil)
**Quand** elle est active
**Alors** aucun anneau n'est dessiné

**Étant donné** un silence suspect
**Quand** la bulle « … » apparaît
**Alors** un anneau à côté de la bulle mesure les `findMaxMs` ; une fois le bébé trouvé, l'anneau habituel de la parade prend le relais

**Étant donné** le bot `perfect` et la timeline de debug (2.1)
**Quand** il pare
**Alors** chaque appui tombe dans l'encoche : un test e2e lit la progression de l'anneau (`data-pp-*`) au moment du jugement et vérifie qu'elle est dans l'arc final

#### Story 2.12 : Bulle d'activité de papa et tap refusé visible `[P]`

**Exigences :** FR74
**UX :** UX-DR28

En tant que joueur,
je veux voir que papa est occupé et pour combien de temps,
afin de comprendre pourquoi il ne répond pas et de choisir quand boire un café ou décrocher.

**Critères d'acceptation :**

**Étant donné** papa dans un état occupé (`drink`, `onPhone`, `onToilet`, séquelle qui l'occupe, plus tard une tâche)
**Quand** l'état commence
**Alors** une bulle au-dessus de lui montre le pictogramme de l'action (tasse, combiné, porte, étoiles de vertige) avec un petit écrasement
**Et** un anneau autour de la bulle se vide jusqu'à `busyUntil`, en temps de jeu

**Étant donné** la fin de l'occupation
**Quand** papa redevient libre
**Alors** un « ding », un pop de la bulle et une vibration courte le signalent (triple équivalence, ADR-006)

**Étant donné** papa occupé par une activité non interruptible
**Quand** le joueur tape une menace
**Alors** la commande est refusée comme aujourd'hui, mais la bulle tremble et un son « occupé » joue ; aucun `tap-marker`

**Étant donné** le combo-badge affiché
**Quand** la bulle apparaît
**Alors** le badge se décale à côté de la bulle, sans chevauchement

#### Story 2.13 : Poses exagérées du café et du téléphone `[P]`

**Exigences :** FR74
**UX :** UX-DR28

En tant que joueur,
je veux reconnaître d'un coup d'œil ce que fait papa, même sans la bulle,
afin que l'occupation se lise sur un petit écran.

**Critères d'acceptation :**

**Étant donné** `papa.glb`
**Quand** les clips `drink` et `on_phone` sont refaits dans Blender
**Alors** le mug et le combiné sont agrandis (au moins ×2), le téléphone a une bulle « bla bla » gribouillée et papa tourne le dos au bébé, le café a de la vapeur, un « slurp » et des yeux qui s'écarquillent à la fin

**Étant donné** le mouvement réduit
**Quand** papa boit ou téléphone
**Alors** la pose reste (elle porte un état), seuls les effets secondaires (vapeur, gribouillis animés) sont figés

**Étant donné** `npm run dist:check`
**Quand** le personnage est reconstruit
**Alors** le budget du niveau tient toujours

### 4.4 `epics.md` — Nouvelles stories d'E3 (rattrapage)

#### Story 3.12 : Note de Maman sur cinq lignes `[P]`

**Exigences :** FR34 (révisée)
**UX :** UX-DR13 (révisé)

En tant que joueur,
je veux que ma note bouge avec ce que je fais,
afin d'avoir envie de faire mieux à la partie suivante.

**Critères d'acceptation :**

**Étant donné** `feel.json › mama`
**Quand** la note est calculée
**Alors** Score = Rire + Calme du bébé + Maison + 30 − Soupir − Hurlement, avec les maxima 35 / 20 / 15 / 15 / 15 et les pentes de FR34 (parfaite 1, réussite 0,5, objet au sol 2,5, objet cassé 4, bêtise 1,5, presque-accident 1,5), toutes dans `feel.json`
**Et** le schéma vérifie que Rire + Calme + Maison + base = 100 et que base = Soupir max + Hurlement max

**Étant donné** un niveau Sieste
**Quand** il se termine
**Alors** Calme du bébé = part du temps de jeu passée sous `feel.mama.calmNoiseThresholdPct` (50 %) de la jauge de bruit × 20, arrondie ; dans un niveau sans jauge de bruit, la part du temps sans pleurs du bébé

**Étant donné** un niveau sans tâche de la maison
**Quand** il se termine
**Alors** Maison vaut 0 et la ligne s'affiche « 0 / 15 » (pas de ligne masquée)

**Étant donné** l'écran de résultat
**Quand** les lignes comptent
**Alors** il y en a cinq, dans l'ordre Rires, Calme du bébé, Maison, Sans soupir, Sans hurlement, et leurs totaux s'additionnent au score

**Étant donné** `npm run sim -- --bot human` sur le salon et les journaux de Geo du 2026-11-03 rejoués
**Quand** la note est recalculée
**Alors** une partie de Geo ne tombe plus mécaniquement à 20 points ; les goldens sont régénérés (`npm run golden:update`, dit dans la story)

#### Story 3.13 : Équité de trajet du directeur `[P]`

**Exigences :** FR75, FR31 (révisée)

En tant que joueur,
je veux que chaque situation ait une bonne réponse,
afin de ne jamais perdre une menace parce que deux tombaient en même temps à deux endroits.

**Critères d'acceptation :**

**Étant donné** le `WaveDirector`
**Quand** il programme une menace
**Alors** sa fenêtre ne s'ouvre jamais à moins de `glideMaxMs + feel.director.fairnessMarginMs` (300) d'une autre fenêtre ouverte ou programmée ; sinon son délai est allongé, ou elle attend

**Étant donné** un silence suspect actif
**Quand** papa n'a pas encore trouvé puis soulevé le bébé
**Alors** aucune autre fenêtre ne s'ouvre avant `fin de la parade du silence + temps de glissade vers la menace + marge`
**Et** le silence compte pour deux menaces dans `maxSimultaneous` (il ne peut donc pas apparaître en vague 1)

**Étant donné** une séquelle qui occupe papa, ou un café, un téléphone
**Quand** une menace est programmée
**Alors** la règle ne la décale pas (ces occupations ne sont pas protégées)

**Étant donné** le bot `perfect` sur 200 graines du salon
**Quand** les parties sont simulées
**Alors** aucune réponse n'échoue pour cause de fenêtres impossibles à tenir (0 raté), y compris avec le silence derrière le canapé

#### Story 3.14 : Joueur simulé humain réaliste `[P]`

**Exigences :** FR66
**Indicateur :** « le joueur simulé humain joue comme un humain » (GDD v2.3)

En tant que Geo,
je veux que le bot `human` obtienne des notes proches des miennes,
afin que les indicateurs simulés disent la vérité avant un playtest.

**Critères d'acceptation :**

**Étant donné** `content/bots.json › human`
**Quand** le bot répond
**Alors** il a un temps de réaction (moyenne et écart-type), une erreur de lecture du moment d'appui qui dépend de ce qui est affiché (plus grande sans anneau-chrono, plus petite avec), une probabilité de ne pas voir une menace quand il est occupé ailleurs, tous réglables

**Étant donné** les journaux de Geo du playtest du 2026-11-03, exportés depuis l'écran de résultat et rangés dans `docs/playtest/geo/`
**Quand** `npm run sim -- --bot human` joue le salon sans anneau (réglage de comparaison)
**Alors** son score moyen est à moins d'une étoile de la médiane de ces journaux, et son taux de parfaites ne la dépasse pas de plus de 10 points

**Étant donné** le rapport de `npm run sim`
**Quand** il est écrit
**Alors** il garde les champs existants (pas de rupture de `playtest:metrics`)

#### Story 3.15 : Séquelles des gags `[P]`

**Exigences :** FR72
**UX :** UX-DR28 (étoiles de vertige)

En tant que joueur,
je veux qu'un raté complique la suite,
afin que rater ait un prix pendant la partie et pas seulement sur la note.

**Critères d'acceptation :**

**Étant donné** le catalogue des menaces du GDD (prise : papa électrisé 1,5 s et pénombre 6 s ; escalier : bébé en bas, 2 s pour le remonter ; table basse : débris au sol, ramassage 1 s, +3 % de bruit quand on marche dessus ; silence : bazar visible jusqu'à la photo ; micro-sieste : 3 s endormi)
**Quand** le gag se déclenche
**Alors** la séquelle s'applique, ses durées dans le JSON de la menace

**Étant donné** une séquelle qui occupe papa
**Quand** une autre arrive
**Alors** elle remplace la première sans l'allonger ; les séquelles de décor se cumulent ; aucune ne dépasse 2 s glissade comprise, sauf la micro-sieste

**Étant donné** la pénombre
**Quand** la pièce s'assombrit
**Alors** icônes, halos et anneaux restent pleinement lisibles

**Étant donné** les bots `perfect`, `human` et `idle`
**Quand** ils jouent le salon
**Alors** `perfect` n'a aucune séquelle, `idle` en accumule ; les goldens sont régénérés (dit dans la story)

#### Story 3.16 : Jauge de catastrophe et « Maman est rentrée plus tôt ! » `[P]`

**Exigences :** FR73, NFR9 (révisée), FR33 (révisée)
**UX :** UX-DR29

En tant que joueur,
je veux sentir monter la catastrophe et pouvoir perdre un niveau dans un dernier gag,
afin que chaque menace ait un vrai enjeu.

**Critères d'acceptation :**

**Étant donné** `feel.json › catastrophe`
**Quand** un gag a lieu
**Alors** la jauge monte de la valeur de sa catégorie (presque-accident 35, bazar 20, micro-sieste 15, temps fort de tâche 10), multipliée par le palier, baisse de 0,5 %/s et de 5 % par parfaite

**Étant donné** la jauge au-dessus de 70 %
**Quand** elle franchit le seuil
**Alors** le visage de Maman passe en alerte, la musique se tend, une vibration et un son partent

**Étant donné** la jauge à 100 %
**Quand** elle est atteinte
**Alors** `LevelEnded` part avec la raison `mamaHome`, sans rush final ; la photo est prise ; le résultat montre « Maman est rentrée plus tôt ! » et 0 étoile, sans les mots « perdu », « échec », « game over »
**Et** pendant le rush final, la jauge est figée ; si bruit et catastrophe sont pleins au même pas, la catastrophe l'emporte

**Étant donné** le palier Normal et les bots
**Quand** 200 parties du salon sont simulées
**Alors** `human` perd le niveau dans 10 à 30 % des parties, `perfect` jamais, `idle` toujours avant la fin du chrono (seuils du GDD) ; les journaux exportés gardent la raison de fin, `sim:replay` la rejoue

### 4.5 `epics.md` — Nouvelle Epic 9 : Grand salon et maison `[P3]`

**Résumé (Liste des epics)** : Le salon devient un grand salon avec cuisine ouverte. La caméra suit papa et signale les menaces hors cadre. Papa a des tâches de la maison qui se jouent en parades et remplissent la ligne Maison, et le bébé a de nouvelles bêtises. **FR couvertes :** FR76, FR77, FR78, NFR15. Dépend du rattrapage v2.3 (2.11, 2.12, 3.12, 3.13).

#### Story 9.1 : Grand salon avec cuisine ouverte dans Blender `[P3]`

**Exigences :** FR77, NFR15

En tant que joueur,
je veux une pièce plus grande avec un coin cuisine,
afin que le salon soit moins chargé et que papa ait des choses à faire.

**Critères d'acceptation :**

**Étant donné** Blender (pipeline de 1.6 et 7.1)
**Quand** la pièce `salon_kitchen` est modélisée
**Alors** elle mesure environ 13–14 × 7 m avec un coin salon (canapé, table basse, escalier, prise), un coin repas (table et nappe) et une cuisine ouverte (plaque, lave-vaisselle, placards bas, poubelle), avec ses colliders, ses ancres (menaces, postes, objets) et sa géométrie de navigation

**Étant donné** `npm run dist:check` et `perf.spec.ts`
**Quand** le niveau est construit
**Alors** il tient NFR15 (≤ 5 Mo) et les budgets de rendu (≤ 100 draw calls, ≤ 100 000 triangles, p95 ≤ 20 ms)

**Étant donné** `content:check`
**Quand** le niveau est validé
**Alors** chaque ancre citée par le JSON existe dans la géométrie

#### Story 9.2 : Caméra qui suit papa `[P3]`

**Exigences :** FR77

En tant que joueur,
je veux une caméra qui suit papa dans le grand salon,
afin que les personnages restent aussi grands qu'aujourd'hui.

**Critères d'acceptation :**

**Étant donné** un niveau qui déclare `camera: "follow"` (la chambre garde `fixed`)
**Quand** papa se déplace ou glisse
**Alors** la caméra le suit avec une zone morte et un rattrapage sans à-coup, réglés dans `feel.json › camera`, sans jamais tourner (sauf la rotation courte d'une parfaite, qui revient à l'angle de départ) et sans sortir des bornes de la pièce

**Étant donné** un ralenti ou un cadrage serré
**Quand** une menace est jugée
**Alors** la caméra cadre la menace jugée

**Étant donné** un tap sur l'écran
**Quand** la caméra a bougé
**Alors** le hit-test (menace > objet > sol) vise le bon point du monde ; les specs e2e de tap passent sur une caméra déplacée

**Étant donné** le mouvement réduit
**Quand** la caméra suit
**Alors** le rattrapage est plus lent et sans rebond (ligne ajoutée au tableau du mouvement réduit)

**Étant donné** la glissade dans le grand salon
**Quand** papa traverse la pièce
**Alors** elle plafonne à `glideMaxMs` du niveau (900 ms)

#### Story 9.3 : Bulle d'info hors cadre `[P3]`

**Exigences :** FR77, FR19
**UX :** UX-DR30

En tant que joueur,
je veux savoir qu'une bêtise se prépare hors de l'écran, et où,
afin de pouvoir y aller à temps.

**Critères d'acceptation :**

**Étant donné** une menace active hors du cadre
**Quand** elle passe en `telegraph`
**Alors** une bulle au bord gauche, droit ou haut de l'écran, du côté de la menace et jamais dans le tiers bas, montre son icône, son anneau-chrono et une flèche vers elle ; elle disparaît quand la menace entre dans le cadre

**Étant donné** la bulle
**Quand** le joueur la tape (ou cible la menace au clavier ou à la manette)
**Alors** c'est la même commande qu'un tap sur la menace

**Étant donné** un silence suspect hors cadre
**Quand** il commence
**Alors** seule la `silence-bubble` « … » apparaît, sans flèche ; la bulle avec flèche n'apparaît qu'une fois le bébé trouvé

**Étant donné** trois menaces actives hors cadre
**Quand** elles sont du même côté
**Alors** leurs bulles s'empilent sans se chevaucher ; le budget DOM du HUD (UX-DR26) tient

#### Story 9.4 : Cadre des tâches de la maison `[P3]`

**Exigences :** FR76, FR34
**UX :** UX-DR27, UX-DR28

En tant que joueur,
je veux des tâches facultatives qui se jouent en parades,
afin d'avoir quelque chose à faire entre deux menaces, au risque de tourner le dos au bébé.

**Critères d'acceptation :**

**Étant donné** un poste déclaré par le niveau (`content/chores/<id>.json` : temps forts, espacement, gag de raté, points Maison)
**Quand** le joueur tape le poste
**Alors** papa glisse et commence ; chaque temps fort a son anneau-chrono et une fenêtre de 300 ms, jugé comme une parade (parfaite, réussie, ratée)

**Étant donné** une tâche en cours
**Quand** le joueur tape une menace ou le sol
**Alors** papa part, la progression est gardée, et la tâche reprend au prochain tap sur le poste

**Étant donné** une menace en fenêtre
**Quand** un temps fort devait tomber
**Alors** il est mis en attente

**Étant donné** une tâche finie
**Quand** le niveau se termine
**Alors** ses points vont à la ligne Maison ; un temps fort raté joue son gag et fait monter la catastrophe de 10 %

**Étant donné** les bots
**Quand** ils jouent un niveau avec postes
**Alors** `perfect` finit les tâches dans les accalmies sans rater de menace ; le comportement des bots face aux tâches est réglable dans `bots.json`

#### Story 9.5 : Tâche « cuisine » et casserole sur le feu `[P3]`

**Exigences :** FR76, FR30 (révisée)

En tant que joueur,
je veux cuire la purée en surveillant le bébé,
afin de gagner des points Maison sans laisser brûler la casserole.

**Critères d'acceptation :**

**Étant donné** le poste « plaque »
**Quand** papa cuisine
**Alors** 4 temps forts (remuer, écraser, remuer, couper le feu) espacés de 1,5 à 3 s ; raté : purée qui attache (fumée)

**Étant donné** une cuisson commencée puis abandonnée
**Quand** 30 s passent sans y revenir
**Alors** la perturbation « casserole sur le feu » se déclenche (bruit, bazar, Parer : baisser le feu)

#### Story 9.6 : Tâche « lave-vaisselle » `[P3]`

**Exigences :** FR76, FR78

En tant que joueur,
je veux vider le lave-vaisselle au bon rythme,
afin de gagner des points Maison sans casser d'assiette.

**Critères d'acceptation :**

**Étant donné** le poste « lave-vaisselle »
**Quand** papa le vide
**Alors** 4 temps forts (rattraper l'assiette qui glisse du panier) ; raté : assiette cassée (objet cassé au Soupir, bruit)

**Étant donné** le lave-vaisselle ouvert et papa parti
**Quand** le bébé choisit une cible
**Alors** le lave-vaisselle ouvert devient une menace possible (Parer : refermer la porte)

#### Story 9.7 : Nouvelles bêtises du grand salon `[P3]`

**Exigences :** FR78

En tant que joueur,
je veux que le bébé fasse plus de bêtises différentes,
afin que chaque partie surprenne.

**Critères d'acceptation :**

**Étant donné** la liste candidate du GDD triée par Geo (au moins 3 retenues avant la création de la story)
**Quand** elles sont ajoutées
**Alors** chacune est une fiche `content/threats/<id>.json` avec une réponse existante, son télégraphe, son gag, sa séquelle, sa hausse de catastrophe et son ancre dans le grand salon

**Étant donné** le bot `perfect`
**Quand** il joue
**Alors** il pare chaque nouvelle bêtise ; `human` les rate parfois

#### Story 9.8 : Niveau grand salon jouable de bout en bout `[P3]`

**Exigences :** FR31, FR66, FR77

En tant que Geo,
je veux le grand salon en niveau complet, testé par les bots,
afin de le donner au playtest du troisième prototype.

**Critères d'acceptation :**

**Étant donné** `content/levels/salon_kitchen.json`
**Quand** il est joué
**Alors** il a ses vagues (menaces du salon, nouvelles bêtises), ses postes, ses perturbations et ses séquences ; il remplace `salon_crawler` comme premier niveau de l'âge bébé

**Étant donné** le bot `human`
**Quand** il joue avec une caméra qui suit
**Alors** il ne réagit à une menace hors cadre qu'après l'apparition de sa bulle (modèle de visibilité)

**Étant donné** les indicateurs simulés du GDD
**Quand** 200 parties sont jouées
**Alors** les cibles de défaite (10–30 % pour `human`) et d'équité (0 raté pour `perfect`) tiennent ; `npm run ci` est vert avant le lien de playtest

### 4.6 `epics.md` — Stories existantes modifiées

- **Story 5.2 (états cachés et note réelle)** : « remplace la valeur fixe de “État du bébé” (/30) » → « remplace “Calme du bébé” (/20) par propre, nourri, reposé (/20) ».
- **Story 6.1 (chien et casserole)** : retirer la casserole (passée en 9.5) ; titre « Chien ».
- **Story 7.6** : critère « la charge de chaque niveau reste sous 3 Mio » → « … tient NFR15 ».

### 4.7 `sprint-status.yaml`

Sous `epic-2` : `2-11-anneau-chrono-autour-des-menaces`, `2-12-bulle-d-activite-de-papa-et-tap-refuse-visible`, `2-13-poses-exagerees-du-cafe-et-du-telephone` (backlog). Sous `epic-3`, avant 3.7, un bloc commenté « Rattrapage v2.3 » : `3-12-note-de-maman-sur-cinq-lignes`, `3-13-equite-de-trajet-du-directeur`, `3-14-joueur-simule-humain-realiste`, `3-15-sequelles-des-gags`, `3-16-jauge-de-catastrophe-et-maman-est-rentree-plus-tot` (backlog). Nouvelle `epic-9: backlog` avec `9-1` à `9-8` et `epic-9-retrospective: optional`. Commentaire de séquence mis à jour (§4.2).

### 4.8 Architecture (`game-architecture.md`)

- **L50 et §Contexte** : « Vue isométrique fixe » → « Vue isométrique ; caméra fixe dans une petite pièce, qui suit papa dans une grande (`level.camera`) ».
- **Rendu (L593) et P4** : `isoCamera.ts` gagne un mode `follow` (zone morte, rattrapage, bornes, réglages dans `feel.camera`) ; le hit-test de l'`InputMapper` (L220) projette à travers la caméra courante ; ligne « caméra qui suit » au mouvement réduit (L250).
- **UI ancrée au monde (L190, L521)** : `chronoRing.ts`, `activityBubble.ts`, `offscreenBubble.ts` (projection de la position monde hors du frustum vers le bord, hors tiers bas).
- **Nouvel ADR-011 : équité de trajet dans le directeur.** Le jugement reste à l'horodatage de l'appui et la glissade reste cosmétique pour le jugement (ADR-003 inchangé) ; seul le directeur lit `glideMaxMs`, la position de papa et ses occupations pour programmer les délais. Note de renvoi sous ADR-003. P1 (L735) : rappel que la commande d'un papa occupé reste refusée (2.12 la rend visible).
- **Système d'événements (L393–411)** : `LevelEnded.reason` ajoute `mamaHome` ; nouveaux événements `CatastropheChanged`, `AfterEffectStarted` / `AfterEffectEnded`, `ChoreBeatTelegraphed` / `ChoreBeatJudged`, `ChoreCompleted`, `TapRefused`.
- **Flux (L496)** : branche « catastrophe → porte sans rush → photo → résultat ».
- **Modèle d'état et ordre des systèmes (L230)** : `catastrophe.ts` avec les jauges, avant score et flux ; `afterEffects.ts` avec les menaces ; `chores/` comme séquences de P1 enchaîné (précédent : 100 pas, L966–970), déclenchées par `TapObject`.
- **Scoring (L588, L946–960)** : `mamaScore.ts` sur cinq lignes ; `calmTracker` (temps sous le seuil de bruit) dans `world.score`.
- **Automatisation (L277)** : paramètres du bot `human` (réaction, erreur de lecture selon l'anneau, inattention) ; modèle de visibilité pour la caméra qui suit.
- **Performances (L1090)** : renvoi à NFR15.
- **Correspondance epics → architecture (L931)** : lignes E2 et E3 complétées, ligne E9 ajoutée.

### 4.9 UX (`DESIGN.md`, `EXPERIENCE.md`)

- **DESIGN** : jetons `chrono-ring`, `activity-bubble`, `offscreen-bubble`, `catastrophe-face` ; composants correspondants (World-anchored) ; règle de couleur : l'arc final en `alert` est un arc épais, distinct du halo (lueur) et du target-highlight (contour + chevron) par la forme (D492 complété) ; `result-row` × 5 (D518) et accents de « Calme du bébé » et « Maison » ; `hud-gauge` inchangé (3 pastilles au plus), le visage de Maman vit dans la zone du chrono ; D374 (caméra).
- **EXPERIENCE** : HUD hierarchy (E117–127 : visage de Maman au rang 2, E127 précisé « la note, jamais ; l'inquiétude de Maman, oui ») ; chaînes « Maman est rentrée plus tôt ! », « Maison », « Calme du bébé » ; State Patterns › Result (5 lignes, fin anticipée) ; Key Flows (Flow 2) ; Interaction Primitives (tap refusé) ; Input Schemes (ciblage des menaces hors cadre) ; Responsive (E453 : la caméra suit dans une grande pièce) ; mouvement réduit (ligne caméra) ; E87, E227, E323 (4 → 5 lignes).

### 4.10 Autres artefacts (à faire dans les stories, pas maintenant)

`content/feel.json` (mama, catastrophe, director, camera), `content/strings.fr.json`, schémas Zod et `content/_schemas/`, `tools/` `dist:check` (NFR15 par niveau), specs e2e du résultat, du HUD et du tap, goldens. Chaque story le dit.

## 5. Passage de relais

**Portée : modérée.** Le cap du jeu ne change pas ; le backlog est réorganisé, une epic s'ajoute, et trois documents de planification sont mis à jour.

| Rôle | Responsabilité |
|---|---|
| Samus (game designer, cette session) | Après l'accord de Geo : applique §4.1–4.7 à `epics.md` et `sprint-status.yaml`, et §4.8–4.9 à l'architecture et à l'UX ; commit sur `main` (fichiers sous `_bmad-output/` uniquement) |
| Link Freeman (`gds-create-story`, `gds-dev-story`, `gds-code-review`) | Crée et développe les stories dans l'ordre du §3, une branche et un worktree par story |
| Geo | Approuve la proposition ; trie les bêtises candidates avant 9.7 ; joue le playtest après le rattrapage ; règle les valeurs dans `feel.json` |

**Critères de réussite :**

- Après le rattrapage : au playtest, au moins 4 testeurs sur 5 réussissent une parfaite voulue dès la première partie ; la note de Geo n'est plus bloquée à 20 ; le bot `human` est à moins d'une étoile de la médiane des testeurs.
- Après E9 : le grand salon tient NFR15 et les budgets de rendu ; 0 raté du bot `perfect` dû à l'équité ; les bulles hors cadre permettent de traiter une menace hors écran.
