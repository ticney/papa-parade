---
title: Papa Parade — Game Design Document
game_type: Action chaotique à timing, solo (hybride Fighting / Party Game / Rhythm)
platforms: [web, ios, android]
created: 2026-10-26
updated: 2026-10-26
version: 2.1
sources:
  - docs/Papa Parade — Game Design Doc.pdf (GDD v1, 2026-10-23)
  - _bmad-output/brainstorming/brainstorm-papa-parade-gameplay-2026-10-26/.memlog.md
---

# Papa Parade — Game Design Document

**Auteur :** Geo
**Type de jeu :** Action chaotique à timing, solo. Vue isométrique fixe, 3D low poly.
**Plateformes cibles :** Navigateur (web), iOS et Android via Capacitor. Steam éventuellement plus tard.

---

## Résumé

### Concept

Le joueur incarne un jeune papa qui doit garder son enfant en vie et à peu près propre, de la naissance à l'âge adulte. Chaque âge est un niveau court (3 à 5 min) dans une seule pièce. Les dangers arrivent comme dans un jeu de combat : l'enfant « attaque », papa **lit** l'attaque et **répond juste** au bon moment. Le plus souvent il pare, mais il doit parfois esquiver, attendre, rester ferme ou ne surtout rien faire.

Du point de vue du bébé, tout ce qui est dangereux est super cool. Du point de vue de papa, tout ce qui est banal devient un combat de boss.

- **Ton :** drôle et chaotique, dans l'esprit d'Overcooked.
- **Signature :** le contraste épique / banal. Une parade parfaite déclenche un ralenti façon film d'action pour rattraper… une cuillère de purée.
- **Nom de travail :** Papa Parade (*parade* = *parry*).

### Public cible

- **Cœur :** jeunes parents, en particulier les papas, qui reconnaissent leurs propres galères (couche surprise, dépose au lit ratée, silence suspect). [ASSUMPTION: 25–40 ans, joueurs occasionnels à réguliers.]
- **Élargi :** joueurs mobiles casual qui cherchent des sessions courtes et drôles, et joueurs d'action sensibles au game feel (références : Overcooked, Batman Arkham, Ghost of Tsushima, Sekiro).
- **Attente commune :** prise en main immédiate, sans tutoriel long.

### Arguments uniques (USP)

1. **Le vécu parental en combat de boss.** Des situations que tout parent a connues (couche de Schrödinger, dépose-bombe au lit, silence qui annonce une bêtise) deviennent des patterns d'attaque lisibles et parables.
2. **Le contraste épique / banal.** Ralentis, chœurs et cadrages parodiques (film d'action, infiltration, prise d'otage) pour des enjeux minuscules.
3. **Un même geste qui change de sens avec l'âge**, jusqu'à l'inversion finale : au niveau Adulte, la bonne réponse est de ne plus parer.
4. **Le son comme système de jeu.** Les bruits du bébé informent (le silence est une alerte), les bruits de papa menacent (ils réveillent Maman).

---

## Objectifs et contexte

### Objectifs du projet

- **Dynamique et drôle :** on relance une partie juste après la première (voir Indicateurs de succès).
- **Prise en main immédiate :** un nouveau joueur comprend chaque menace sans explication.
- **Relatable :** un parent se reconnaît dans chaque situation.
- **Game feel soigné :** chaque réponse réussie se ressent (son, hitstop, vibration, ralenti), même avec des cubes.
- **Variété :** la parade est la réponse principale, pas l'unique gameplay.

### Principe de production

**Règle d'or : l'IA écrit et teste les systèmes, Geo joue et règle le feeling.** Le jeu est conçu pour que l'IA puisse le lancer, le jouer et vérifier qu'il tourne sans intervention humaine. Les menaces, niveaux et âges sont des données éditables hors code, que l'IA peut générer et valider. Tous les paramètres de feeling se règlent sans toucher à la logique. Ce GDD est la source de vérité des règles pour l'IA.

### Contexte et intention

Le GDD v1 (2026-10-23) posait le pitch, les piliers, la boucle, les 5 âges et la stack. Le brainstorming du 2026-10-26 (mode Creative Partner, Persona Journey puis Trait Transfer) a produit environ 70 idées. Il a fait évoluer la conception sur cinq points : le verbe central (« lire, puis répondre juste »), le rôle du son, la structure des niveaux autour de Maman, la note de fin et les contrôles mobiles. Ce document v2 intègre ces décisions ; le journal des décisions est dans `decision-log.md`. La v2.1 (2026-10-26) reporte trois décisions prises pendant l'architecture : les règles d'entrée (seuil unique de 0,4 s), la mesure des fenêtres en temps de jeu avec la règle de l'appui trop tôt, et les gestes sur le bébé.

---

## Gameplay central

### Piliers de design

Quatre principes tranchent chaque décision. Une feature qui n'en sert aucun sort du scope.

1. **Lire, puis répondre juste.** Chaque danger se lit grâce à un télégraphe et appelle une réponse au bon moment parmi cinq : **parer**, **fermeté**, **esquiver**, **attendre**, **ne rien faire**. La parade reste la réponse principale. Toute situation du jeu se ramène à ces cinq réponses. Pas de menu, pas de gestion lente.
2. **Le chaos est un gag, pas une punition.** Le bébé n'est jamais blessé. Un échec déclenche un gag, jamais une blessure ni un game over. Échouer doit faire rire et donner envie de rejouer.
3. **Lisible en un coup d'œil… et d'oreille.** Chaque menace a un télégraphe clair (icône, halo, son), même quand l'écran déborde. Chaque signal sonore a un équivalent visuel et haptique, car beaucoup de joueurs mobiles jouent sans le son.
4. **Un même geste change de sens avec l'âge.** Les contrôles restent les mêmes ; ce qu'ils signifient évolue du bébé à l'adulte. Le jeu enseigne progressivement la **retenue**, qui culmine au niveau Adulte.

### Boucle de jeu

**Micro-boucle : le cycle d'une menace (2 à 6 s)**

1. **Télégraphe :** l'enfant repère un danger. Icône, halo, son distinct et vibration l'annoncent. Le regard du bébé se verrouille sur sa cible.
2. **Lecture :** le joueur identifie la menace et la réponse attendue (code couleur, verbe affiché).
3. **Fenêtre de réponse :** un court délai pour agir. Trop tôt ou trop tard, le gag se déclenche.
4. **Réponse :** papa glisse vers la menace et exécute la réponse (soulever, tendre un jouet, fermer, distraire, rester ferme, esquiver, ne pas bouger).
5. **Résultat :** réponse parfaite (ralenti, cadrage serré, musique d'action, bonus), réponse réussie, ou gag.

**Méso-boucle : le niveau (3 à 5 min)**

- Les menaces s'empilent par vagues (escalade), avec des perturbations : téléphone, chien, casserole.
- Les besoins de papa (fatigue, café, envie pressante) dérèglent ses réponses s'il les ignore.
- La jauge de bruit monte avec chaque cri et chaque objet qui tombe.
- Le combo grimpe à chaque réponse réussie et pendant que papa porte le bébé ; il ne s'encaisse qu'en déposant le bébé en lieu sûr.
- Des séquences spéciales (cycle du dodo, change de couche, désarmement) cassent le rythme.

**Macro-boucle : la fin de niveau**

La porte s'ouvre → **rush final** (les 10 dernières secondes pour tout planquer) → **photo de fin** (la scène se fige) → **réactions de Maman** (rire, soupir, hurlement) → **note sur 5 étoiles** → **replay** des meilleurs moments → rejouer ou passer à l'âge suivant.

### Conditions de victoire et d'échec

Pas de game over : chaque niveau se termine par une note.

| Variante de niveau | Durée | Fin normale | Fin anticipée |
|---|---|---|---|
| **Sieste** (Maman dort dans la pièce d'à côté) | 4 min | Le chrono (sommeil de Maman) atteint 0 : Maman se réveille reposée | La jauge de bruit atteint 100 % : Maman est réveillée par le bruit, la note perd une étoile |
| **Retour** (Maman est sortie) | 3 min | Le chrono atteint 0 : Maman rentre | Aucune |

- **Réussite d'un niveau :** au moins 1 étoile.
- **Déblocage de l'âge suivant :** au moins 2 étoiles. [ASSUMPTION: seuil à valider au playtest.]
- Le prototype dure 3 minutes.

---

## Mécaniques de jeu

### Mécaniques principales

Toutes les valeurs ci-dessous sont des **valeurs de départ** du fichier de feeling, réglables sans toucher à la logique. [ASSUMPTION: valeurs à régler au playtest du prototype.]

**1. Les cinq réponses**

| Réponse | Geste | Fenêtre | Quand | Exemple |
|---|---|---|---|---|
| **Parer** | Tap sur la menace | 300 ms | Menace bleue (parable) | Soulever le bébé avant la prise électrique |
| **Fermeté** | Maintien sur la menace (≥ 0,4 s) | Appui dans les 300 ms, maintien jusqu'à la fin de l'attaque | Menace qui exige d'être tenue | Tenir le bébé qui gigote pendant le change |
| **Esquiver** | Glisser (swipe) dans une direction | 250 ms | Menace rouge (inparable) | Le vomi en jet |
| **Attendre** | Aucune action jusqu'au signal, puis tap | 300 ms après le signal | Feintes, duels | Duel du coucher, faux sommeil |
| **Ne rien faire** | Aucune action sur la menace visée | 1,5 à 3 s | Provocations, autonomie | L'enfant de 3 ans qui teste ta réaction |

Termes dérivés, tous ramenés aux cinq réponses :

| Terme utilisé | Réponse |
|---|---|
| Rythme (les 100 pas) | Parer en cadence |
| Échange (désarmement) | Parer avec un objet en main |
| Dosage verbal (adolescence) | Parer ou Fermeté pendant un duel |
| Lâcher prise (adulte) | Ne rien faire |
| Attendre à distance (enfance) | Attendre |
| Anticipation, préparation | Déplacement et placement, pas une réponse |

**Règles d'entrée.** Le timing est mesuré à l'appui du doigt (ou de la touche). Un seuil unique de 0,4 s sépare les deux gestes : un relâchement avant 0,4 s compte comme Parer ; un maintien de 0,4 s ou plus compte comme Fermeté. Le seuil est réglable dans le fichier de feeling. « Ne rien faire » échoue seulement si le joueur agit sur la menace visée ; il peut traiter d'autres menaces pendant ce temps.

**Appui trop tôt.** Par défaut, un appui sur une menace avant l'ouverture de sa fenêtre (moins le buffer d'entrée) déclenche le gag. Un mode « en garde » est réglable dans le fichier de feeling, pour comparaison au playtest : l'appui précoce lance la glissade sans être jugé, et il faut appuyer à nouveau dans la fenêtre.

**2. Fenêtres de timing**

| Paramètre | Valeur |
|---|---|
| Délai entre télégraphe et ouverture de la fenêtre | 0,8 à 1,5 s selon la menace |
| Fenêtre de réponse standard | 300 ms |
| Fenêtre de réponse parfaite | 100 ms, centrée |
| Tolérance cachée (façon Celeste) | +60 ms de chaque côté, non affichée |
| Temps de référence | Temps de jeu : un ralenti allonge aussi les fenêtres en temps réel ; le hitstop gèle le temps de jeu ; la pause ne consomme rien |
| Buffer d'entrée | 100 ms |
| Hitstop sur réponse réussie | 80 ms |
| Ralenti sur réponse parfaite | ×0,3 pendant 1,2 s |
| Ralenti sur la dernière menace d'une vague | ×0,2 pendant 1,5 s |

**3. Glissade freeflow.** Taper une menace fait glisser papa automatiquement jusqu'à elle (façon Batman Arkham) : il atteint n'importe quel point de la pièce en 0,6 s maximum. Le joueur choisit **quoi** traiter ; le jeu gère le **comment**.

**4. Combo à encaisser.** Le multiplicateur va de x1 à x8. Il augmente de 1 à chaque réponse réussie, et de 1 toutes les 10 s pendant lesquelles papa porte le bébé sans incident. Il ne s'ajoute au score que lorsque papa **dépose le bébé en lieu sûr** (parc, lit, transat) ; la dépose au ralenti est le moment où on l'encaisse. Une menace ratée avant la dépose remet le multiplicateur à x1. *(Livré avec le cycle du dodo, pas dans le prototype.)*

**5. Bras-bébé.** Porter le bébé neutralise ses menaces directes, mais papa n'a plus qu'une main : il peut Parer et Esquiver, pas tenir avec Fermeté. Sa fatigue monte deux fois plus vite, et de nouvelles menaces apparaissent : micro-siestes de papa et pleurs. Décider quand porter et quand déposer est une décision tactique.

**6. Besoins de papa**

| Besoin | Évolution | Effet | Remède |
|---|---|---|---|
| **Fatigue** (0–100) | +0,5/s (×2 en portant le bébé) | Au-dessus de 70 : fenêtres réduites de 20 %, micro-siestes télégraphiées toutes les 8 à 12 s (paupières qui tombent, son cotonneux), à parer pour se réveiller | Café : −40, 3 s d'action |
| **Envie pressante** (0–100) | +0,4/s | À 100 : déplacements ralentis de 30 % | Toilettes : 5 s hors de la pièce, remise à 0 |

**7. Jauge de bruit (niveaux Sieste).** Elle monte avec les cris du bébé (+2 %/s), les objets qui tombent (+5 à +15 %), les lattes qui grincent (+3 %), le souffle relâché trop tôt (+5 %) et le reniflage (+3 %). Elle redescend de 1 %/s. À 100 %, Maman se réveille.

**8. Le silence comme télégraphe.** Le bébé babille en continu. Quand il sort du champ de vision et que le babillage s'arrête plus de 2 s, la musique se coupe : une bêtise se prépare. Équivalent visuel : une bulle « … » clignotante au bord de l'écran, et une vibration courte.

**9. Instinct paternel (rattrapage).** Quand 3 menaces ou plus sont actives et que papa vient de rater 2 réponses en moins de 10 s, l'instinct paternel s'active : ralenti léger (×0,8) et fenêtres élargies de 30 % pendant 4 s. Il ne peut se déclencher qu'une fois toutes les 30 s. Le but est de garder le chaos drôle, jamais frustrant.

**10. État caché du bébé.** Le bébé a trois états cachés : **propre**, **nourri**, **reposé**. Le joueur les devine grâce à des indices :

- **L'odeur :** une traînée verte visible.
- **Les pleurs typés :** faim, couche, dents, fatigue, sans raison. Chacun a une signature sonore et visuelle et son remède (biberon, change, anneau de dentition, bercer). Un mauvais remède fait monter le pleur d'un cran et la jauge de bruit de 5 %.
- **Le comportement.**

**Renifler** (maintien de 1 s sur le bébé) révèle l'état de la couche. Ces états alimentent la note de Maman.

**11. Physique légère.** Les objets tombent, roulent et rebondissent. Les accidents émergents font le spectacle.

**Traçabilité des mécaniques**

| Mécanique | Pilier servi |
|---|---|
| Cinq réponses, fenêtres, glissade | 1 |
| Combo à encaisser, bras-bébé | 1, 4 |
| Besoins de papa | 1 (ils dérèglent les réponses), 2 (micro-siestes en gag) |
| Jauge de bruit, silence-télégraphe | 3, 2 |
| Instinct paternel, physique légère | 2 |
| État caché, pleurs typés | 1 (lire) |
| Perturbations (téléphone, chien, casserole) | 1 (choisir quoi traiter), 2 |
| Préparation | 1 (anticiper la lecture) |
| Note et mémoire de Maman | 2 (envie de rejouer) |

### Contrôles et entrées

| Action | Mobile (tactile) | Clavier | Manette |
|---|---|---|---|
| Se déplacer | Tap au sol | ZQSD / flèches | Stick gauche |
| Parer | Tap sur la menace | Espace (tap) sur la menace ciblée | A |
| Fermeté | Maintien sur la menace | Espace (maintien) | A (maintien) |
| Esquiver | Swipe | Maj + direction | B + direction |
| Retenir son souffle (infiltration uniquement) | Maintien n'importe où | E (maintien) | RT (maintien) |
| Boire un café, décrocher le téléphone | Tap sur l'objet | Interaction contextuelle (Espace) | A contextuel |
| Prendre le bébé, le trouver (silence suspect) | Tap sur le bébé, hors menace en cours | Espace près du bébé | A près du bébé |
| Renifler | Maintien de 1 s sur le bébé, hors menace en cours | Espace (maintien) près du bébé | A (maintien) près du bébé |

- **Orientation :** paysage.
- **Retour haptique** sur mobile : vibration courte à chaque télégraphe, vibration marquée sur une réponse parfaite.
- **Ciblage clavier/manette :** la menace la plus urgente dans la direction visée est sélectionnée automatiquement.
- **Pause :** pause automatique quand l'app passe en arrière-plan ; reprise au même instant après un décompte de 3 s.
- **[NOTE FOR DESIGNER]** La parade au tap sur mobile est la principale hypothèse de contrôle du prototype. Elle doit être validée en premier.

---

## Action chaotique à timing — éléments spécifiques

Section hybride : elle emprunte au Fighting (fenêtres chiffrées, boss, défense), au Party Game (variété, accessibilité, sessions courtes) et au Rhythm (timing, latence).

### Catalogue des menaces (« frame data »)

**Menaces du prototype « Bébé à 4 pattes » :**

| Menace | Télégraphe | Délai | Réponse | Fenêtre | Échec (gag) |
|---|---|---|---|---|---|
| Prise électrique | Regard fixe, icône éclair, grésillement | 1,2 s | Parer : soulever ou poser un cache-prise | 300 ms | Bébé tire le chargeur, la lampe s'éteint, cheveux en pétard (dessin animé) |
| Escalier | Bébé accélère, halo sur la marche | 1,0 s | Parer : intercepter | 300 ms | Plongeon-rattrapage raté : bébé glisse sur les fesses jusqu'en bas, ravi |
| Objet sur la table basse | Bébé se hisse, icône objet | 1,5 s | Parer : retirer l'objet ou détourner avec un jouet | 300 ms | L'objet tombe, rebondit, casse quelque chose d'autre |
| Téléphone qui sonne (perturbation) | Sonnerie, vibration | — | Décrocher (fatigue +10, attention détournée 5 s) ou ignorer (bruit +2 %/s tant qu'il sonne) | — | — |
| Silence suspect | Babillage coupé, musique coupée, bulle « … » | 2 s | Trouver le bébé, puis Parer | 300 ms | Bêtise surprise tirée au hasard |

**Perturbations d'escalade (v1) :**

| Perturbation | Effet | Réponse |
|---|---|---|
| Chien | Vole la purée, aboie (bruit +10 %), fait tomber des objets | Parer : le détourner |
| Casserole sur le feu (cuisine) | Déborde après 30 s si on l'oublie, bruit et bazar | Parer : baisser le feu |

[NOTE FOR DESIGNER: les catalogues de menaces des âges Enfance, Adolescence et Adulte sont à compléter avant l'epic E6.]

### Séquences variées

Des séquences de 20 à 60 s s'insèrent dans les niveaux pour varier le gameplay au-delà de la parade. Chacune part d'une scène vécue et la traite avec une référence parodique, qui porte l'humour épique / banal.

**Cycle du dodo**

- **Vécu :** le bébé ne dort que contre papa, épuisé ; impossible de le poser ; chaque bruit fait stresser.
- **Étapes :**
  1. **Rester éveillé** (endurance). Bébé dans les bras, papa pare ses propres micro-siestes. S'endormir déclenche un gag : papa ronfle, le bébé se réveille, bruit +15 %.
  2. **Les 100 pas** (façon Rhythm Heaven). La berceuse démarre à 90 BPM et ralentit jusqu'à 60 BPM à mesure que le bébé s'endort ; fenêtre de 180 ms par pas ; un contretemps piège.
  3. **Duel du coucher** (façon Ghost of Tsushima). Immobile face au lit, papa doit partir à l'instant où le bébé ferme les yeux. Trop tôt, il les rouvre.
  4. **Dépose-bombe** (désamorçage de bombe). Musique de thriller, sueur au front, ralenti épique : poser 4 kilos de bébé sur un matelas.
  5. **Sortie en infiltration** (façon Metal Gear). Les lattes qui grincent sont à mémoriser ; papa retient son souffle (maintien, jauge de 6 s). Le bébé émet des fausses alertes : un soupir appelle Ne rien faire ; un vrai réveil impose de revenir bercer.
- **Réponses :** Parer en cadence, Attendre, Fermeté, Ne rien faire.

**Change de couche (boss)**

- **Vécu :** la couche surprise, celle qui a débordé jusque dans le body.
- **Parodie :** combat de boss en arène, avec barre de vie… de la couche.
- **Attaques :** jet surprise (rouge, à esquiver), pied qui plonge dans la couche, retournement en pleine opération, lingette qui manque.
- **Enchaînement :** si la couche a débordé, le change enchaîne directement sur le rhabillage complet.
- **Réponses :** Parer, Esquiver, Fermeté.

**Rhabillage**

- **Vécu :** le body à pressions, au réveil.
- **Parodie :** puzzle d'escape game.
- **Gameplay :** les pressions ne tombent jamais en face, le bras ressort par le col, le bébé se raidit comme une planche.
- **Réponses :** Fermeté, Parer.

**Soins**

- **Vécu :** les soins du quotidien que tous les bébés détestent.
- **Lavage de nez :** le boss le plus redouté. Le bébé esquive de la tête ; fenêtre de 150 ms.
- **Coupe d'ongles :** précision entre deux coups de pied.
- **Réponses :** Parer, Attendre.

**Désarmement**

- **Vécu :** le bébé a attrapé une fourchette ; on la lui retire sans geste brusque, en priant.
- **Parodie :** négociation de prise d'otage.
- **Jauge de calme :** elle va de 0 à 100 et démarre à 50. Une glissade trop rapide vers le bébé lui retire 30 points ; sous 20, le bébé agite l'objet.
- **Contre principal :** l'échange contre un objet plus cool.
- **Variante, le truc dans la bouche :** retrait au doigt, en précision. Le bébé serre les mâchoires ; papa répond par Fermeté puis Parer au moment où elles se desserrent.
- **Réponses :** Attendre, Parer (échange), Fermeté.

**Préparation**

- **Vécu :** la zone qu'on croyait sûre et qui ne l'est pas.
- **Parodie :** tower defense.
- **Entre deux vagues :** poser cache-prises et barrières, monter les objets en hauteur.
- **Pendant les vagues :** le regard du bébé révèle une zone oubliée, à sécuriser en urgence.
- **Réponses :** déplacement, puis Parer.

**Valeur de coolitude (échelle 1–10).** Chaque objet a une valeur de coolitude aux yeux du bébé : cuillère 2, fourchette 4, jouet 5, télécommande 7, téléphone 8, clés de voiture 10. Un échange réussit si l'objet proposé est plus cool que l'objet tenu.

### Boss et feintes

Les boss sont des situations, pas des personnages : change de couche, lavage de nez, crise de colère (petite enfance). Les feintes obligent à lire avant d'agir :

- **Faux sommeil :** attaque retardée façon Elden Ring. Un œil s'entrouvre et punit le joueur qui se relâche trop tôt (Attendre).
- **Pleur sans raison :** inparable. Le seul contre est de bercer et de tenir (Fermeté pendant 5 s).
- **Fausses alertes :** soupirs et gémissements qui ressemblent à un réveil. Les reconnaître (Ne rien faire) fait partie de la compétence.
- **Couche de Schrödinger :** le joueur dépose le bébé sans savoir si la couche est sale ; si elle l'est, le dodo échoue et tout est à refaire.

### Accessibilité et amplitude de compétence

- **Paliers de difficulté :**

  | Palier | Fenêtres | Instinct paternel |
  |---|---|---|
  | Assistance | +50 % | Oui |
  | Normal | Valeurs de base | Oui |
  | Papa expérimenté | −25 % | Non |

- **Plancher bas :**
  - un verbe d'un mot affiché en gros sur chaque menace (SOULÈVE ! FERME ! ÉCHANGE !, façon WarioWare) ;
  - la tolérance cachée sur les fenêtres ;
  - l'instinct paternel ;
  - le palier Assistance, assumé.
- **Plafond haut :** les réponses parfaites, les combos x8 encaissés, le dosage calme / ferme et l'enchaînement des menaces en freeflow.
- **Daltonisme :** le code bleu / rouge est doublé par une forme d'icône (cercle = parable, triangle = esquive).
- **Contenu :** tout public. Aucune blessure montrée.

### Timing et latence

- **Calibration** de la latence audio et tactile au premier lancement : tap en rythme sur 8 temps, décalage appliqué aux fenêtres.
- **Réponse visuelle à un tap :** au plus 50 ms.
- Les fenêtres de timing sont définies en millisecondes de **temps de jeu**, indépendamment du framerate. Le décalage de calibration est corrigé en temps réel, avant la conversion en temps de jeu.

### Durée des sessions

Un niveau dure 3 à 5 minutes, une séquence spéciale 20 à 60 s. La pause est possible à tout moment, avec reprise exacte (voir Contrôles et entrées).

---

## Progression et équilibrage

### Progression du joueur

Chaque âge garde les mêmes contrôles mais change ce que « répondre juste » veut dire. Le bébé teste les réflexes, l'ado teste le sang-froid, l'adulte teste ta capacité à lâcher prise.

| Âge | Menaces | Bonne réponse dominante | Réponse introduite |
|---|---|---|---|
| **Bébé à 4 pattes** (0–1 an) | Prise, escalier, table basse, couche, dodo | Intercepter, soulever, fermer le placard | Parer, Esquiver, Attendre |
| **Petite enfance** (2–4 ans) | Crises de colère (boss), coups et morsures, provocations, fugues, escalade, « moi tout seul ! » | Câlin, diversion ou fermeté au bon moment ; aide invisible | Fermeté, Ne rien faire |
| **Enfance** (5–11 ans) | Dangers à distance au parc, à vélo, en cuisine | Anticiper, rattraper, sécuriser de loin | Attendre à distance |
| **Adolescence** (12–17 ans) | Répliques, négociations, portes qui claquent | Duel verbal sous pression de temps | Parer et Fermeté en duel |
| **Adulte** (18 ans et plus) | Ses propres choix | Ne plus parer, le laisser faire | Ne rien faire, comme réponse finale |

**Le fil de la retenue.** Dès la petite enfance, des réponses « ne rien faire » apparaissent : provocation à ne pas récompenser, aide invisible, duel du coucher, faux sommeil, pleur à encaisser. Le niveau Adulte est l'examen final de cette compétence. Le fil narratif entre les âges est donc mécanique plutôt que scripté. [NOTE FOR DESIGNER: proposition issue du brainstorming, à confirmer. Le ton du dernier niveau (drôle ou émouvant) reste une question ouverte.]

**Petite enfance — mécaniques spécifiques :**

- **Coups et morsures :** l'enfant tape, mord, lance des objets. C'est la parade la plus littérale du jeu (Parer, Esquiver).
- **Provocation :** l'enfant regarde papa en tendant la main vers l'interdit. Une Fermeté excessive récompense son besoin d'attention, et il recommence deux fois plus vite. La bonne réponse est Parer en douceur ou Ne rien faire.
- **Jauge d'attention (0–100) :** elle perd 5 points par seconde quand papa s'occupe de lui-même (café, téléphone) et en regagne 10 à chaque interaction avec l'enfant. À 0, l'enfant passe à l'interdit.
- **Aide invisible :** guider l'enfant sans qu'il le voie, par exemple tenir le verre par derrière. S'il repère papa, c'est la crise.
- **Fugue et escalade :** course-poursuite dans la pièce (façon Benny Hill), plongeon-rattrapage au ralenti quand il tombe d'un meuble.

### Courbe de difficulté

- **Dans un niveau :** les menaces s'empilent. Vague 1 : une menace à la fois ; vague 2 : deux simultanées ; vague 3 : trois simultanées et une perturbation. [ASSUMPTION: rythme à régler au playtest.]
- **Entre les âges :** une nouvelle réponse est introduite à la fois, d'abord isolée, puis mélangée aux précédentes.
- **Rattrapage :** l'instinct paternel et les paliers de difficulté évitent les murs.

### Économie et ressources

| Ressource | Rôle |
|---|---|
| Score de combo | Multiplicateur x1 à x8, encaissé au dépôt du bébé |
| Fatigue | Contraint le rythme ; le café la réduit au prix du temps |
| Jauge de bruit | Menace globale des niveaux Sieste |
| Jauge d'attention | Menace globale de la petite enfance |
| Coolitude des objets | Monnaie des échanges |
| Étoiles | Débloquent l'âge suivant ; poussent à rejouer |

**Note de Maman.** À l'ouverture de la porte, Maman réagit de trois façons, et l'état du bébé s'y ajoute :

| Composante | Points | Ce qui la nourrit |
|---|---|---|
| **Rire** | 0 à 40 | Papa débordé avec style : dégaine (purée sur la joue, cheveux en pétard, t-shirt à l'envers), réponses parfaites, combos encaissés |
| **État du bébé** | 0 à 30 | 10 points chacun : propre, nourri, reposé |
| **Soupir** | 0 à −15 | Le bazar : objets au sol, dégâts |
| **Hurlement** | 0 à −15 | Les presque-accidents, y compris ceux figés sur la photo de fin (bébé en haut de l'étagère). Jamais une blessure |

- **Score** = Rire + État du bébé + 30 − Soupir − Hurlement, sur 100.
- **Étoiles :** 1 étoile à partir de 20, 2 à 40, 3 à 60, 4 à 75, 5 à 90.
- **Réveil anticipé de Maman** (niveau Sieste) : −1 étoile.
- **Coût d'un gag :** des objets au sol (soupir), un presque-accident (hurlement), du bruit (jauge), et un multiplicateur remis à x1.

Les réactions de Maman se souviennent des parties précédentes (« *Encore* l'étagère ?! »).

---

## Cadre de level design

### Types de niveaux

- **Une pièce par écran**, en caméra isométrique fixe. Le gameplay reste sur le plan du sol.
- **Variante Sieste :** Maman dort dans la pièce voisine ; la jauge de bruit est l'enjeu principal. Adaptée aux âges bébé et petite enfance, et aux niveaux de nuit.
- **Variante Retour :** Maman est sortie ; le chrono mène à son retour. Adaptée aux âges plus grands.
- Les deux variantes partagent la même fin : porte, rush final, photo, note.

### Progression des niveaux

- v1 : un niveau par âge, soit 5 niveaux, chacun dans une pièce (salon, chambre, parc, cuisine…). [ASSUMPTION: nombre de niveaux par âge à confirmer après le prototype.]
- Chaque niveau combine des menaces de base, une ou deux séquences spéciales et des perturbations.
- Le premier niveau sert de tutoriel implicite : une seule menace à la fois, verbes affichés, aucune explication textuelle.

---

## Direction artistique et audio

### Style visuel

Un cartoon 3D low poly, rond et exagéré, pensé pour rester cohérent quand il est produit avec l'aide de l'IA.

- **Vue :** 3D low poly, caméra isométrique fixe, une pièce par écran.
- **Personnages :** formes simples, bébé à tête énorme, expressions portées par les yeux. Squash and stretch pour compenser des animations courtes. La dégaine de papa se dégrade visiblement pendant le niveau.
- **Rendu :** couleurs par sommet ou petite texture-palette partagée, rendu toon avec contours. Le rendu de l'outil de modélisation ne se transpose pas tel quel en jeu ; le style est défini côté jeu.
- **Couleurs :** palette vive et limitée. Une teinte d'alerte est réservée aux dangers ; le bleu signale « parable », le rouge « esquive ».
- **Effets de feeling :** hitstop, tremblement d'écran, particules. Sur réponse parfaite : ralenti, zoom et rotation de caméra. Sur la dernière réponse d'un niveau : célébration démesurée (chœur d'opéra, feu d'artifice, façon Peggle).
- **Cadrages parodiques :** chaque séquence spéciale emprunte la grammaire visuelle de sa référence (film d'action, infiltration, prise d'otage, désamorçage).
- **Fin de niveau :** photo de fin figée, puis replay façon match de sport des meilleurs moments.

### Audio et musique

Le son est le système nerveux du jeu.

- **Les bruits du bébé informent :** babillage continu, pleurs typés, soupirs (fausses alertes), et surtout le **silence** qui annonce une bêtise.
- **Les bruits de papa menacent :** parquet, objets, souffle relâché alimentent la jauge de bruit.
- **Un son culte par réponse :** couinement de jouet, claquement de placard, et un éclat de rire du bébé sur réponse parfaite (façon Sekiro).
- **Un son distinct par télégraphe.**
- **Musique adaptative :** douce quand tout est calme, nerveuse quand une menace approche. Elle bascule en ralenti sur les réponses parfaites et se coupe lors des silences suspects.
- **Jeu sans le son :** chaque signal sonore a un équivalent visuel (ondes, bulles) et haptique.

---

## Spécifications techniques

### Performances

- 60 FPS stables sur mobile milieu de gamme. [ASSUMPTION: appareils de référence iPhone 12 et Android de 2021, mesurés sur un niveau complet de 5 min.]
- Latence entre tap et retour visuel : 50 ms maximum.
- Chargement d'un niveau : moins de 5 s sur mobile en 4G.

### Détails par plateforme

- **Navigateur :** playtest par simple lien. L'audio se déverrouille au premier tap.
- **iOS et Android :** distribués via Capacitor, avec retour haptique, en orientation paysage.
- **Steam :** éventuellement plus tard, via un wrapper.
- **Moteur cible :** web en TypeScript. Le détail de la stack relève du document d'architecture (voir `decision-log.md`, éléments à reporter).

### Besoins en assets

- Pièces entières modélisées dans Blender, qui sert d'éditeur de niveaux. L'IA pilote via Blender MCP le blocage des pièces, les meubles et les scripts d'export. Le pipeline d'export est défini dans l'architecture.
- Personnages, rig et animations faits à la main : papa, bébé (puis un enfant par âge), Maman, chien.
- Audio : un son par télégraphe, un son par type de réponse, des pleurs typés, une musique adaptative par âge.

---

## Epics de développement

### Structure des epics

Le détail des epics et des stories de haut niveau est dans `epics.md`.

| # | Epic | Contenu | Phase |
|---|---|---|---|
| E1 | Prototype « Bébé à 4 pattes » en cubes | Boucle de base, 3 menaces, téléphone, silence suspect, fatigue, note de Maman, build web de playtest | Prototype |
| E2 | Game feel et lisibilité | Sons cultes, haptique, verbes affichés, tolérance, calibration, instinct paternel, fichier de feeling | Prototype |
| E3 | Bruit et Maman | Jauge de bruit, variante Sieste, porte, rush final, photo, réactions et étoiles, replay | Prototype (partiel) puis v1 |
| E4 | Cycle du dodo | Rester éveillé, 100 pas, duel du coucher, dépose-bombe, sortie en infiltration, combo encaissé, bras-bébé | Deuxième prototype |
| E5 | Hygiène et état caché | Couche de Schrödinger, odeur, pleurs typés, change de couche boss, rhabillage, soins | v1 |
| E6 | Âges suivants | Petite enfance, enfance, adolescence, adulte | v1 |
| E7 | Production art et audio | Pipeline Blender, personnages, DA, musique | v1 |
| E8 | Distribution | Capacitor iOS et Android, stores | v1 |

**Séquence :** E1 → E2 → E3 (partiel) → playtest → E4 → E5 → E6, avec E7 et E8 en parallèle à partir de E4.

**Scope du prototype.** Un seul niveau, « Bébé à 4 pattes », jouable en 3 minutes avec des formes géométriques. S'il est drôle avec des cubes, le concept tient.

- Un salon, un papa, un bébé (une sphère qui se déplace).
- Trois menaces : prise électrique, escalier, objet sur la table basse.
- Une perturbation : le téléphone qui sonne.
- Le tap sur la menace, le déplacement, la jauge de fatigue.
- La note de Maman en fin de partie.
- **Ajouts issus du brainstorming :** le silence-télégraphe, la jauge de bruit avec la variante Sieste, les verbes affichés, un son culte par réponse et le rire du bébé, la tolérance cachée, les équivalents visuels et haptiques. Validés par Geo le 2026-10-26.
- **Pas dans le prototype :** l'esquive (aucune menace rouge avant E5) et le combo à encaisser (livré avec E4).

---

## Indicateurs de succès

### Indicateurs techniques

- 60 FPS stables sur les appareils de référence pendant un niveau complet.
- Latence tap → retour visuel ≤ 50 ms.
- Tous les paramètres de feeling se règlent sans toucher à la logique.
- Le jeu peut être lancé et joué de bout en bout sans intervention humaine.

### Indicateurs de gameplay

| Critère (GDD v1) | Mesure |
|---|---|
| On a envie de relancer une partie juste après la première | ≥ 70 % des testeurs relancent sans qu'on le leur demande |
| Une parade parfaite procure une vraie satisfaction, même sans graphismes | ≥ 4 testeurs sur 5 la citent spontanément comme un moment fort |
| Un testeur extérieur comprend chaque menace sans explication | ≥ 4 testeurs sur 5 identifient la bonne réponse à chaque menace dès la première rencontre |
| La parade au tap tient sur mobile | Taux de réponses réussies sur mobile ≥ 80 % de celui mesuré au clavier |
| Le chaos reste drôle | ≥ 4 testeurs sur 5 rient au moins une fois pendant un niveau |

[ASSUMPTION: seuils de départ, panel de 5 testeurs minimum.]

---

## Hors scope

**Hors scope v1 :**

- Coop local papa + maman.
- Multijoueur en ligne.
- Narration scriptée longue (le fil entre les âges est mécanique).
- Personnalisation du personnage.

**Reporté après le lancement :**

- Version Steam.
- Niveaux supplémentaires par âge.

---

## Hypothèses et dépendances

**Questions ouvertes :**

- **Modèle économique :** jeu payant, gratuit avec publicité, ou démo + version complète ? À trancher avant l'epic E8.
- **Dernier niveau :** reste-t-il drôle ou bascule-t-il vers l'émotion ? Le fil de la retenue est proposé comme structure, mais le ton n'est pas tranché.

**Dépendances :**

- Blender + Blender MCP pour le blocage des pièces, les meubles et les exports.
- Capacitor pour la distribution mobile.
- Le prototype doit valider la parade au tap avant la production des âges suivants.

**Index des hypothèses** (`[ASSUMPTION]` dans le texte) :

1. Public cœur : 25–40 ans.
2. Seuil de déblocage de l'âge suivant : 2 étoiles.
3. Toutes les valeurs de timing, de jauges et de la note de Maman sont des valeurs de départ, à régler au playtest.
4. Rythme des vagues au sein d'un niveau.
5. Un niveau par âge en v1.
6. Appareils de référence pour les performances.
7. Seuils des indicateurs de gameplay et taille du panel.

---

## Références

- GDD v1 : `docs/Papa Parade — Game Design Doc.pdf`.
- Brainstorming du 2026-10-26 : `_bmad-output/brainstorming/brainstorm-papa-parade-gameplay-2026-10-26/`.
- BMad Game Dev Studio — référence du module.
- BlenderMCP — dépôt et installation.
- Écarts de rendu Blender vers moteur de jeu (GameDev.tv).
