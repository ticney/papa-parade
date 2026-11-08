---
title: Papa Parade — Game Design Document
game_type: Action chaotique à timing, solo (hybride Fighting / Party Game / Rhythm)
platforms: [web, ios, android]
created: 2026-10-26
updated: 2026-11-08
version: 2.4
sources:
  - docs/Papa Parade — Game Design Doc.pdf (GDD v1, 2026-10-23)
  - _bmad-output/brainstorming/brainstorm-papa-parade-gameplay-2026-10-26/.memlog.md
---

# Papa Parade — Game Design Document

**Auteur :** Geo
**Type de jeu :** Action chaotique à timing, solo. Vue isométrique, 3D low poly ; caméra fixe dans une petite pièce, qui suit papa dans le grand salon.
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

Le GDD v1 (2026-10-23) posait le pitch, les piliers, la boucle, les 5 âges et la stack. Le brainstorming du 2026-10-26 (mode Creative Partner, Persona Journey puis Trait Transfer) a produit environ 70 idées. Il a fait évoluer la conception sur cinq points : le verbe central (« lire, puis répondre juste »), le rôle du son, la structure des niveaux autour de Maman, la note de fin et les contrôles mobiles. Ce document v2 intègre ces décisions ; le journal des décisions est dans `decision-log.md`. La v2.1 (2026-10-26) reporte trois décisions prises pendant l'architecture : les règles d'entrée (seuil unique de 0,4 s), la mesure des fenêtres en temps de jeu avec la règle de l'appui trop tôt, et les gestes sur le bébé. La v2.2 (2026-10-29) donne de vrais enjeux à chaque menace, après le constat de Geo sur le prototype : rater ne coûtait rien pendant la partie. Elle ajoute l'anneau-chrono autour de l'icône de menace, les séquelles des gags et la jauge de catastrophe, qui peut faire perdre le niveau (« Maman rentre ! »). La v2.3 (2026-11-03) répond au premier playtest de Geo : le bon moment ne se voyait pas, un papa occupé ne se lisait pas, deux menaces pouvaient être impossibles à traiter ensemble, et la note restait bloquée à 1 étoile. Elle ajoute la bulle d'activité de papa, la règle d'équité du directeur, une note de Maman sur cinq lignes, les tâches de la maison et un grand salon avec cuisine ouverte, filmé par une caméra qui suit papa.

---

## Gameplay central

### Piliers de design

Quatre principes tranchent chaque décision. Une feature qui n'en sert aucun sort du scope.

1. **Lire, puis répondre juste.** Chaque danger se lit grâce à un télégraphe et appelle une réponse au bon moment parmi cinq : **parer**, **fermeté**, **esquiver**, **attendre**, **ne rien faire**. La parade reste la réponse principale. Toute situation du jeu se ramène à ces cinq réponses, y compris les tâches de la maison, qui se jouent en parades. Pas de menu, pas de gestion lente.
2. **Le chaos est un gag, pas une blessure.** Le bébé n'est jamais blessé et un échec déclenche toujours un gag. Mais un gag a un prix : il laisse une séquelle qui complique la suite, et trop de catastrophes font rentrer Maman, ce qui fait perdre le niveau dans un dernier gag. Pas de game over sec au premier raté : on perd en riant, et on veut rejouer.
3. **Lisible en un coup d'œil… et d'oreille.** Chaque menace a un télégraphe clair (icône, halo, son), même quand l'écran déborde. Chaque signal sonore a un équivalent visuel et haptique, car beaucoup de joueurs mobiles jouent sans le son.
4. **Un même geste change de sens avec l'âge.** Les contrôles restent les mêmes ; ce qu'ils signifient évolue du bébé à l'adulte. Le jeu enseigne progressivement la **retenue**, qui culmine au niveau Adulte.

### Boucle de jeu

**Micro-boucle : le cycle d'une menace (2 à 6 s)**

1. **Télégraphe :** l'enfant repère un danger. Icône, halo, son distinct et vibration l'annoncent. Le regard du bébé se verrouille sur sa cible. L'anneau-chrono commence à se remplir autour de l'icône.
2. **Lecture :** le joueur identifie la menace et la réponse attendue (code couleur, verbe affiché) et voit, à l'anneau, combien de temps il lui reste.
3. **Fenêtre de réponse :** le dernier arc de l'anneau s'allume ; c'est le moment d'agir. Trop tôt ou trop tard, le gag se déclenche.
4. **Réponse :** papa glisse vers la menace et exécute la réponse (soulever, tendre un jouet, fermer, distraire, rester ferme, esquiver, ne pas bouger).
5. **Résultat :** réponse parfaite (ralenti, cadrage serré, musique d'action, bonus), réponse réussie, ou gag. Le gag laisse une séquelle et fait monter la jauge de catastrophe.

**Méso-boucle : le niveau (3 à 5 min)**

- Les menaces s'empilent par vagues (escalade), avec des perturbations : téléphone, chien, casserole.
- Les besoins de papa (fatigue, café, envie pressante) dérèglent ses réponses s'il les ignore.
- Entre deux menaces, papa peut avancer les tâches de la maison (cuisine, lave-vaisselle) en parades au bon moment ; chaque tâche lui fait tourner le dos au bébé.
- La jauge de bruit monte avec chaque cri et chaque objet qui tombe.
- La jauge de catastrophe monte à chaque gag ; les séquelles s'additionnent et rendent les menaces suivantes plus dures. Pleine, elle fait rentrer Maman et le niveau est perdu.
- Le combo grimpe à chaque réponse réussie et pendant que papa porte le bébé ; il ne s'encaisse qu'en déposant le bébé en lieu sûr.
- Des séquences spéciales (cycle du dodo, change de couche, désarmement) cassent le rythme.

**Macro-boucle : la fin de niveau**

La porte s'ouvre → **rush final** (les 10 dernières secondes pour tout planquer) → **photo de fin** (la scène se fige) → **réactions de Maman** (rire, soupir, hurlement) → **note sur 5 étoiles** → **replay** des meilleurs moments → rejouer ou passer à l'âge suivant.

Si la jauge de catastrophe est pleine avant la fin du chrono, la boucle est raccourcie : la porte s'ouvre d'un coup, sans rush final → photo de fin → réaction de Maman (hurlement) → 0 étoile → rejouer.

### Conditions de victoire et d'échec

Pas de game over sec : chaque niveau se termine par la porte qui s'ouvre et une note. Mais un niveau peut être **perdu** : si la jauge de catastrophe atteint 100 %, Maman rentre avant la fin du chrono.

| Variante de niveau | Durée | Fin normale | Fin anticipée (bruit) | Fin anticipée (catastrophe) |
|---|---|---|---|---|
| **Sieste** (Maman dort dans la pièce d'à côté) | 4 min | Le chrono (sommeil de Maman) atteint 0 : Maman se réveille reposée | La jauge de bruit atteint 100 % : Maman est réveillée par le bruit, la note perd une étoile | La jauge de catastrophe atteint 100 % : Maman débarque, réveillée par un mauvais pressentiment ; niveau perdu |
| **Retour** (Maman est sortie) | 3 min | Le chrono atteint 0 : Maman rentre | Aucune | La jauge de catastrophe atteint 100 % : Maman rentre plus tôt, elle a oublié ses clés ; niveau perdu |

- **Niveau perdu (fin anticipée par catastrophe) :** la porte s'ouvre d'un coup, sans rush final ; la photo de fin fige le chaos du moment ; Maman réagit (hurlement) ; la note est de 0 étoile et l'écran de fin propose de rejouer en premier. Le perdant voit toujours sa photo et la réaction de Maman : la défaite est un gag, pas un écran rouge. « Niveau perdu » est un terme de conception : le texte affiché au joueur ne dit jamais « perdu », « échec » ni « game over » (règle de ton de l'UX), mais par exemple « Maman est rentrée plus tôt ! ».
- **Pendant le rush final**, la jauge de catastrophe est figée : la porte est déjà ouverte, Maman ne peut plus « rentrer plus tôt ». Les gags du rush pèsent seulement sur la note.
- **L'ouverture de la porte fait tomber des objets.** Quand le rush démarre, le choc de la porte fait tomber, à chaque niveau, quelques objets qui ne peuvent pas casser (deux par défaut) : ceux qui sont les plus proches de la table que le niveau désigne. Un objet cassable (une tasse, un vase) ne tombe jamais ainsi : le joueur ne perd jamais de points à cause de la porte sans pouvoir y répondre. Les objets tombés sont à ranger avant la photo ; chaque objet rangé retombe de la note de Maman (le Soupir), comme s'il n'avait jamais bougé. [DECISION de Geo, 2026-11-01 ; valeurs à régler dans `feel.json › endOfLevel`.]
- **Si les deux jauges atteignent 100 % au même instant** (niveau Sieste), la catastrophe l'emporte : niveau perdu.
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

**3. Glissade freeflow.** Taper une menace fait glisser papa automatiquement jusqu'à elle (façon Batman Arkham) : il atteint n'importe quel point de la pièce en 0,6 s maximum. Dans le grand salon, la glissade garde sa vitesse et plafonne à 0,9 s. [ASSUMPTION: plafond du grand salon à régler au playtest.] Le joueur choisit **quoi** traiter ; le jeu gère le **comment**.

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

**12. Anneau-chrono.** Un anneau entoure l'icône de chaque menace active et se remplit dans le sens horaire, du télégraphe jusqu'à la fermeture de la fenêtre. Il montre au joueur combien de temps il lui reste. [ASSUMPTION: durées et rendu à régler au playtest.]

L'anneau n'apparaît que sur les réponses à timing : **Parer**, **Fermeté** (le dernier arc marque la fenêtre d'appui de 300 ms ; pendant le maintien, l'anneau se vide jusqu'à la fin de l'attaque) et **Esquiver** (dernier arc de 250 ms). **Attendre**, **Ne rien faire** et les feintes n'ont pas d'anneau : lire le bon moment y est le défi (pilier 1), et un anneau trahirait le faux sommeil.

| Paramètre | Valeur |
|---|---|
| Début du remplissage | Au télégraphe (regard verrouillé) |
| Durée totale | Délai de la menace + fenêtre de réponse (1,5 s pour la prise électrique) |
| Dernier arc | Correspond à la fenêtre de réponse (300 ms) ; il s'allume d'une couleur distincte et s'épaissit |
| Encoche parfaite | Un repère plus clair marque les 100 ms de la fenêtre parfaite |
| Anneau plein | Fin de la fenêtre affichée ; le gag se déclenche à la fin de la tolérance cachée (+60 ms), qui n'est pas dessinée |
| Temps de référence | Temps de jeu : l'anneau ralentit avec le ralenti et se fige pendant le hitstop et la pause |

- L'anneau reflète les fenêtres réelles : réduites par la fatigue, élargies par l'instinct paternel ou le palier Assistance. La tolérance cachée n'est pas dessinée.
- Silence suspect : un premier anneau apparaît sur le bord de l'écran, à côté de la bulle « … », et mesure les 5 s laissées pour trouver le bébé. Une fois le bébé trouvé, l'anneau habituel de la parade prend le relais (délai 2 s + fenêtre 300 ms).
- Vibration courte quand le dernier arc s'allume, pour les joueurs sans le son (pilier 3).
- **Menace hors cadre (v2.3) :** quand la caméra suit papa, une menace hors de l'écran est signalée par une **bulle d'info** collée au bord de l'écran, du côté de la menace : son icône, son anneau-chrono et une flèche qui pointe vers elle. Taper la bulle revient à taper la menace (papa glisse vers elle). Le silence suspect garde sa bulle « … » sans flèche (mécanique 8) : trouver le bébé reste le défi. Une fois le bébé trouvé, sa menace a la bulle habituelle.
- **Priorité (playtest du 2026-11-03) :** sans anneau, Geo n'a réussi aucune réponse parfaite en plusieurs parties, alors que le joueur simulé humain en réussit 75 %. L'anneau passe avant tout nouveau contenu.
- [NOTE FOR DESIGNER] Maintenant que l'anneau rend le délai lisible, faut-il allonger les délais de télégraphe (de 0,8–1,5 s vers 1,5–2,5 s) pour laisser monter la tension ? À trancher au playtest.

**13. Séquelles des gags.** Chaque gag laisse une séquelle de jeu, en plus de son coût sur la note : le chaos s'empile, et un raté rend la menace suivante plus difficile. Une séquelle ne prive jamais papa de ses réponses plus de 2 s, glissade comprise (seule exception : la micro-sieste ratée, 3 s, qui sanctionne la fatigue ignorée), et l'instinct paternel reste le filet de sécurité. Pendant une séquelle qui l'occupe, papa ne peut répondre à aucune menace. Les séquelles qui occupent papa ne se cumulent pas : une nouvelle remplace celle en cours sans l'allonger ; les séquelles de décor (pénombre, débris, bazar) se cumulent. Les séquelles de chaque menace sont dans le catalogue des menaces. [ASSUMPTION: durées à régler au playtest.]

[NOTE FOR DESIGNER] Toute nouvelle menace, perturbation ou séquence spéciale (epics E3 à E6) doit déclarer sa séquelle et sa hausse de catastrophe. Valeurs proposées pour les perturbations v1 : chien +20 % (bazar), casserole qui déborde +20 % (bazar). Les gags des séquences spéciales sont à chiffrer avec E4.

**14. Jauge de catastrophe (0–100 %).** Visible en permanence dans le HUD, sous la forme d'un visage de Maman qui s'inquiète à mesure qu'elle monte. Chaque gag la fait monter ; à 100 %, Maman rentre et le niveau est perdu (voir Conditions de victoire et d'échec). [ASSUMPTION: valeurs de départ, à régler au playtest et avec les bots.]

| Source | Hausse |
|---|---|
| Presque-accident (prise électrique, escalier) | +35 % |
| Bazar (objet de la table basse, bêtise surprise du silence suspect) | +20 % |
| Micro-sieste de papa ratée | +15 % |
| Décroissance | −0,5 %/s |
| Réponse parfaite | −5 % |

- Au palier Normal, trois presque-accidents en moins de 10 s environ font perdre le niveau (3 × 35 = 105 %) ; des gags espacés sont absorbés par la décroissance. Au palier Assistance, il en faut six ; au palier Papa expérimenté, deux presque-accidents et un bazar suffisent.
- Au-dessus de 70 %, la musique se tend et le visage de Maman passe à l'alerte, avec une vibration et un son d'alerte (pilier 3).
- La jauge de catastrophe est distincte de la jauge de bruit : le bruit réveille Maman (−1 étoile), la catastrophe la fait rentrer (niveau perdu). Les deux coexistent dans les niveaux Sieste.

**15. Bulle d'activité de papa.** Constat du playtest : on ne voyait pas que papa buvait son café ou téléphonait, et ses taps refusés passaient pour un jeu qui ne répond pas.

- Quand papa est occupé (café 3 s, téléphone 5 s, toilettes, tâche de la maison, séquelle qui l'occupe), une bulle au-dessus de sa tête montre le pictogramme de l'action : tasse, combiné, porte, casserole, assiette, étoiles de vertige pour une séquelle. Un anneau autour de la bulle se vide jusqu'au moment où papa peut de nouveau répondre. Il reprend le visuel de l'anneau de maintien et n'a jamais la couleur d'une menace.
- Chaque activité a une pose exagérée qui se lit sans la bulle. Téléphone : combiné énorme, bulle « bla bla » gribouillée, papa dos au bébé. Café : mug énorme, vapeur, « slurp », puis les yeux qui s'écarquillent pendant que la jauge de fatigue baisse.
- Début et fin marqués : un petit écrasement au début ; à la fin, un « ding », un pop et une vibration courte (pilier 3).
- Pendant une activité qui l'occupe, un tap sur une menace est refusé de façon visible (la bulle tremble, un son « occupé ») au lieu d'être ignoré en silence. Les tâches de la maison, elles, s'interrompent (mécanique 16).
- [ASSUMPTION: pictogrammes et durée des poses à régler au playtest.]

**16. Tâches de la maison.** Papa a des tâches qui ne concernent pas le bébé : faire cuire la purée, vider le lave-vaisselle. Elles sont facultatives et remplissent la ligne Maison de la note de Maman. Elles se jouent en mini-moments de Parer, pour rester dans le pilier 1.

- Un tap sur le poste (plaque de cuisson, lave-vaisselle) : papa glisse et commence. La tâche est une suite de temps forts, chacun avec son anneau-chrono et sa fenêtre de 300 ms : remuer avant que ça attache, écraser les pommes de terre, couper le feu à temps, rattraper l'assiette qui glisse du panier.
- Un temps fort réussi fait avancer la tâche, une parfaite fait rire comme ailleurs. Un temps fort raté donne un petit gag, qui fait monter la jauge de catastrophe de 10 % : assiette cassée (Soupir et bruit), purée qui attache (fumée).
- La tâche s'interrompt à tout moment : un tap sur une menace ou au sol fait partir papa, et la progression est gardée. Pendant une tâche, papa tourne le dos au bébé : c'est le pari.
- Les temps forts se mettent en attente pendant la fenêtre d'une menace : la menace a toujours priorité.
- Une cuisson abandonnée plus de 30 s devient la perturbation « casserole sur le feu ». Un lave-vaisselle laissé ouvert devient une cible du bébé.
- Prototype : deux tâches dans le grand salon, de 4 temps forts chacune, espacés de 1,5 à 3 s. [ASSUMPTION: nombre de temps forts, espacement, points et hausse de catastrophe à régler au playtest.]

**17. Équité de trajet (directeur des vagues).** Constat du playtest : le bébé derrière le canapé (silence suspect) et une autre menace tombaient en même temps, et papa ne pouvait en sauver qu'une. Un dilemme sans issue n'est pas une décision intéressante.

- Deux fenêtres de réponse ne s'ouvrent jamais à moins de « glissade max du niveau + 0,3 s » l'une de l'autre : 0,9 s dans une petite pièce, 1,2 s dans le grand salon. Des menaces « simultanées » sont donc actives en même temps, avec des fenêtres décalées.
- La réponse au silence suspect compte comme une occupation : tant que papa cherche puis soulève le bébé, aucune autre fenêtre ne s'ouvre avant qu'il puisse l'atteindre une fois libre.
- Un silence suspect actif compte pour deux menaces simultanées dans la vague : il n'apparaît donc qu'à partir de la vague 2.
- Les séquelles ne sont pas protégées : elles sont le prix d'un raté et doivent rendre la suite plus difficile (mécanique 13). Les occupations choisies par le joueur (café, téléphone, tâche de la maison) non plus : décrocher, c'est accepter le risque.
- Les bots vérifient la règle : en parties simulées, le joueur simulé parfait n'est jamais placé devant deux fenêtres impossibles à tenir.
- [ASSUMPTION: marge de 0,3 s à régler au playtest.]

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
| Anneau-chrono | 3 (lisible d'un coup d'œil), 1 (le bon moment se voit) |
| Séquelles des gags, jauge de catastrophe | 2 (le gag a un prix, la défaite reste un gag), 1 (choisir quoi traiter) |
| Bulle d'activité de papa | 3 (papa occupé se voit d'un coup d'œil) |
| Tâches de la maison | 1 (des parades de plus, choisir quoi traiter), 2 (l'assiette cassée est un gag) |
| Équité de trajet | 1 (chaque situation a une bonne réponse), 2 (perdre reste juste) |
| Caméra qui suit, bulle hors cadre | 3 (une menace hors cadre reste lisible) |

### Contrôles et entrées

| Action | Mobile (tactile) | Clavier | Manette |
|---|---|---|---|
| Se déplacer | Tap au sol | ZQSD / flèches | Stick gauche |
| Parer | Tap sur la menace | Espace (tap) sur la menace ciblée | A |
| Fermeté | Maintien sur la menace | Espace (maintien) | A (maintien) |
| Esquiver | Swipe | Maj + direction | B + direction |
| Retenir son souffle (infiltration uniquement) | Maintien n'importe où | E (maintien) | RT (maintien) |
| Boire un café, décrocher le téléphone | Tap sur l'objet | Interaction contextuelle (Espace) | A contextuel |
| Commencer une tâche de la maison | Tap sur le poste (plaque, lave-vaisselle) | Interaction contextuelle (Espace) | A contextuel |
| Temps fort d'une tâche | Tap au bon moment sur le poste | Espace | A |
| Aller vers une menace hors cadre | Tap sur sa bulle au bord de l'écran | Ciblage automatique, inchangé | Ciblage automatique, inchangé |
| Prendre le bébé, le trouver (silence suspect) | Tap sur le bébé, hors menace en cours | Espace près du bébé | A près du bébé |
| Renifler | Maintien de 1 s sur le bébé, hors menace en cours | Espace (maintien) près du bébé | A (maintien) près du bébé |

- **Orientation :** paysage.
- **Caméra :** fixe dans une petite pièce ; dans le grand salon, elle suit papa avec une zone morte (voir Cadre de level design).
- **Retour haptique** sur mobile : vibration courte à chaque télégraphe et quand le dernier arc de l'anneau-chrono s'allume, vibration marquée sur une réponse parfaite, vibration d'alerte quand la jauge de catastrophe dépasse 70 %.
- **Ciblage clavier/manette :** la menace la plus urgente dans la direction visée est sélectionnée automatiquement.
- **Pause :** pause automatique quand l'app passe en arrière-plan ; reprise au même instant après un décompte de 3 s.
- **[NOTE FOR DESIGNER]** La parade au tap sur mobile est la principale hypothèse de contrôle du prototype. Elle doit être validée en premier.

---

## Action chaotique à timing — éléments spécifiques

Section hybride : elle emprunte au Fighting (fenêtres chiffrées, boss, défense), au Party Game (variété, accessibilité, sessions courtes) et au Rhythm (timing, latence).

### Catalogue des menaces (« frame data »)

**Menaces du prototype « Bébé à 4 pattes » :**

| Menace | Télégraphe | Délai | Réponse | Fenêtre | Échec (gag) | Séquelle | Catastrophe |
|---|---|---|---|---|---|---|---|
| Prise électrique | Regard fixe, icône éclair, grésillement, anneau-chrono | 1,2 s | Parer : soulever ou poser un cache-prise | 300 ms | Bébé tire le chargeur, la lampe s'éteint, cheveux en pétard (dessin animé) | Papa électrisé : 1,5 s sans pouvoir répondre ; pièce dans la pénombre 6 s (icônes, halos et anneaux restent pleinement lisibles) | +35 % |
| Escalier | Bébé accélère, halo sur la marche, anneau-chrono | 1,0 s | Parer : intercepter | 300 ms | Plongeon-rattrapage raté : bébé glisse sur les fesses jusqu'en bas, ravi | Bébé en bas de l'escalier : papa doit aller le chercher (tap sur le bébé), 2 s occupé à le remonter | +35 % |
| Objet sur la table basse | Bébé se hisse, icône objet, anneau-chrono | 1,5 s | Parer : retirer l'objet ou détourner avec un jouet | 300 ms | L'objet tombe, rebondit, casse quelque chose d'autre | Les débris restent au sol jusqu'au ramassage (tap, 1 s) : ils comptent dans le Soupir, font monter la jauge de bruit quand on marche dessus (+3 %, niveaux Sieste) et deviennent une cible possible du bébé, au même titre que les menaces du niveau | +20 % |
| Téléphone qui sonne (perturbation) | Sonnerie, vibration | — | Décrocher (fatigue +10, attention détournée 5 s) ou ignorer (bruit +2 %/s tant qu'il sonne) | — | — | — | — |
| Silence suspect | Babillage coupé, musique coupée, bulle « … », anneau-chrono au bord de l'écran | 2 s | Trouver le bébé, puis Parer | 300 ms | Bêtise surprise tirée au hasard | Le bazar (mouchoirs, gribouillis) reste visible jusqu'à la fin du niveau et sur la photo de fin | +20 % |
| Micro-sieste de papa | Paupières qui tombent, son cotonneux, anneau-chrono | 1,2 s | Parer : se réveiller | 300 ms | Papa s'endort | Papa endormi 3 s, sans pouvoir répondre (exception assumée à la limite de 2 s : c'est la sanction de la fatigue) | +15 % |

**Perturbations d'escalade (v1) :**

| Perturbation | Effet | Réponse |
|---|---|---|
| Chien | Vole la purée, aboie (bruit +10 %), fait tomber des objets | Parer : le détourner |
| Casserole sur le feu (cuisine) | Une cuisson de la tâche « cuisine » laissée seule déborde après 30 s : bruit et bazar | Parer : baisser le feu |

[NOTE FOR DESIGNER: les catalogues de menaces des âges Enfance, Adolescence et Adulte sont à compléter avant l'epic E6.]

**Nouvelles bêtises du grand salon (v2.3, candidates).** Elles réutilisent les réponses existantes : chacune coûte une fiche de menace, un gag, un point d'ancrage et une animation, pas un nouveau système.

| Bêtise | Lieu | Réponse | Gag | Catastrophe |
|---|---|---|---|---|
| Tirer la nappe | Table à manger | Parer : rattraper la nappe | Vaisselle au sol (Soupir, bruit) | +20 % |
| Placard bas | Cuisine | Parer : fermer le placard | Concert de casseroles (bruit +15 %) | +20 % |
| Lave-vaisselle ouvert | Cuisine | Parer : refermer la porte | Bébé assis dans le panier, couverts au sol | +20 % |
| Poubelle | Cuisine | Fermeté : « Non ! » | Épluchures partout (bazar) | +20 % |
| Plante verte | Coin salon | Parer : détourner avec un jouet | Terre sur le tapis (bazar) | +20 % |
| Tasse de papa posée trop bas | Table basse | Fermeté : « Non ! » | Café renversé (bazar) | +20 % |

[NOTE FOR DESIGNER: liste à trier par Geo avant l'epic E9 ; chaque bêtise retenue déclare sa séquelle.]

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

  | Palier | Fenêtres | Instinct paternel | Hausse de la jauge de catastrophe |
  |---|---|---|---|
  | Assistance | +50 % | Oui | ×0,5 |
  | Normal | Valeurs de base | Oui | ×1 |
  | Papa expérimenté | −25 % | Non | ×1,25 |

- **Plancher bas :**
  - un verbe d'un mot affiché en gros sur chaque menace (SOULÈVE ! FERME ! ÉCHANGE !, façon WarioWare) ;
  - la tolérance cachée sur les fenêtres ;
  - l'instinct paternel ;
  - le palier Assistance, assumé.
- **Plafond haut :** les réponses parfaites, les combos x8 encaissés, le dosage calme / ferme et l'enchaînement des menaces en freeflow.
- **Daltonisme :** le code bleu / rouge est doublé par une forme d'icône (cercle = parable, triangle = esquive). Le dernier arc de l'anneau-chrono se distingue par son épaisseur, pas seulement par sa couleur.
- **Mouvement réduit :** un réglage, qui suit par défaut la préférence de l'appareil. Il calme la caméra et les effets, et arrête la couche de vie des personnages (« Animation des personnages ») ; les poses qui portent un état restent.
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
| Jauge de catastrophe | Menace globale de tous les niveaux : pleine, le niveau est perdu |
| Jauge d'attention | Menace globale de la petite enfance |
| Coolitude des objets | Monnaie des échanges |
| Étoiles | Débloquent l'âge suivant ; poussent à rejouer |

**Note de Maman.** À l'ouverture de la porte, Maman réagit de trois façons, et s'y ajoutent le calme du bébé et la maison :

| Composante | Points | Ce qui la nourrit |
|---|---|---|
| **Rire** | 0 à 35 | Papa débordé avec style : dégaine (purée sur la joue, cheveux en pétard, t-shirt à l'envers), réponses parfaites (1 point), réponses réussies (0,5 point), combos encaissés |
| **Calme du bébé** | 0 à 20 | Jusqu'à l'epic E5 : la part du niveau passée sous 50 % de la jauge de bruit (Sieste) ou sans pleurs du bébé (Retour : bébé reposé trop tôt, réveil). Avec E5 : propre, nourri, reposé |
| **Maison** | 0 à 15 | Les tâches de la maison finies : purée cuite, lave-vaisselle vidé (7,5 points chacune dans le prototype). Reste à 0 dans un niveau sans tâche |
| **Soupir** | 0 à −15 | Le bazar : 2,5 points par objet au sol, 4 par objet cassé, 1,5 par bêtise surprise du silence suspect |
| **Hurlement** | 0 à −15 | Les presque-accidents, 1,5 point chacun, y compris ceux figés sur la photo de fin (bébé en haut de l'étagère). Jamais une blessure |

- **Presque-accident figé (story 3.6) :** à la fin du niveau, quelle que soit la façon dont il finit, le bébé (pas dans les bras de Papa) à moins de `feel.endOfLevel.frozenNearMissReachM` du point d'une menace dont le gag est un presque-accident compte pour un presque-accident de plus, comme s'il avait glissé, et la photo montre pourquoi Maman crie. Le jeu n'a pas de hauteur : « en haut de l'étagère » s'y lit « au haut de l'escalier ». L'état de la menace ne compte pas, seule la place du bébé.
- **Dégaine de Papa (story 3.7) :** chaque gag dont la définition nomme une partie la montre jusqu'à la fin du niveau (cheveux en pétard : la prise ; purée sur la joue : l'objet de la table basse ; t-shirt à l'envers : le micro-sommeil). Une partie ne compte qu'une fois, même si le gag revient. Chaque partie montrée à la fin ajoute `laughPerLookPartPoints` (5) au Rire, dans la limite de ses 35 points : un Papa débraillé fait rire, mais chaque partie coûte un gag.
- **Réactions de Maman à l'ouverture de la porte (story 3.7) :** elle rit si le Rire a des points, soupire si le Soupir en a, crie si le Hurlement en a, dans cet ordre ; elle crie aussi quand elle s'est réveillée ou est rentrée plus tôt, même sans presque-accident. Une partie sans rien (ni parfaite, ni dégaine, ni bazar, ni presque-accident) lui arrache quand même un rire, à 0 point. Le Calme et la Maison n'ont pas de réaction.
- **Score** = Rire + Calme du bébé + Maison + 30 − Soupir − Hurlement, sur 100.
- **Pourquoi la v2.3 change la note (playtest du 2026-11-03) :** avec la v2.2, Geo finissait chaque partie à 20 points : Rire à 0 (aucune parfaite), État du bébé fixé à 20, Soupir et Hurlement au maximum après 3 objets au sol ou 5 ratés. Soit 1 étoile, quoi qu'il fasse. Les réussites nourrissent désormais le Rire, les pentes du Soupir et du Hurlement sont divisées par deux (il faut 10 presque-accidents pour atteindre −15 au Hurlement), et aucune ligne n'est une constante. [ASSUMPTION: pentes de départ, à régler au playtest et avec les bots.]
- **Étoiles :** 1 étoile à partir de 20, 2 à 40, 3 à 60, 4 à 75, 5 à 90.
- **Réveil anticipé de Maman** (niveau Sieste) : −1 étoile.
- **Coût d'un gag :** des objets au sol (soupir), un presque-accident (hurlement), du bruit (jauge), un multiplicateur remis à x1, une séquelle immédiate et une hausse de la jauge de catastrophe.
- **Niveau perdu** (jauge de catastrophe pleine) : 0 étoile, quel que soit le score.

Les réactions de Maman se souviennent des parties précédentes (« *Encore* l'escalier ?! »). **Règle (story 3.8) :** chaque réplique a une réaction (rire, soupir, cri) et, au besoin, des conditions (un gag survenu dans la partie, un nombre de parties précédentes où il est déjà survenu, la façon dont le niveau s'est fini). La mémoire compte les **parties** où chaque gag s'est produit, pas ses occurrences. La réplique **la plus spécifique** dont les conditions sont remplies l'emporte, un tirage départage les égalités, et une réplique générique de la réaction sert de repli. Dans ce jeu, « l'étagère » du GDD est l'escalier : le bébé au bord de la marche du haut.

---

## Cadre de level design

### Types de niveaux

- **Une pièce par niveau**, en vue isométrique. Le gameplay reste sur le plan du sol. Une petite pièce (la chambre) tient dans l'écran, avec une caméra fixe. Une grande pièce (le salon avec cuisine ouverte) est filmée par une **caméra qui suit papa** ; les menaces hors cadre sont signalées par une bulle d'info au bord de l'écran (mécanique 12).
- **Grand salon avec cuisine ouverte (v2.3) :** il remplace le salon du prototype. Environ 13 à 14 m × 7 m (le salon actuel fait 9 × 6 m) : coin salon (canapé, table basse, escalier, prise), coin repas (table et nappe), cuisine ouverte (plaque de cuisson, lave-vaisselle, placards bas, poubelle). À l'écran, les personnages gardent leur taille actuelle. [ASSUMPTION: dimensions et plan à valider dans Blender.]
- **Caméra qui suit :** zone morte autour de papa ; la caméra rattrape la glissade sans à-coup et ne tourne jamais, sauf la courte rotation d'une réponse parfaite. Pendant les ralentis et les cadrages serrés, elle cadre la menace jugée. [ASSUMPTION: taille de la zone morte et vitesse de rattrapage, réglables comme le reste du feeling.] [NOTE FOR DESIGNER: la v2.4 propose de resserrer le cadrage à 7,5 m de large pour des personnages environ 20 % plus grands, au prix de plus de menaces hors cadre, signalées par leur bulle d'info. Cela reviendrait sur « les personnages gardent leur taille actuelle » ci-dessus : à trancher par Geo en jouant.]
- **Variante Sieste :** Maman dort dans la pièce voisine ; la jauge de bruit est l'enjeu principal. Adaptée aux âges bébé et petite enfance, et aux niveaux de nuit.
- **Variante Retour :** Maman est sortie ; le chrono mène à son retour. Adaptée aux âges plus grands.
- Les deux variantes partagent la même fin : porte, rush final, photo, note. Si la jauge de catastrophe est pleine, la porte s'ouvre sans rush final et le niveau est perdu.

### Progression des niveaux

- v1 : un niveau par âge, soit 5 niveaux, chacun dans une pièce (grand salon avec cuisine ouverte, chambre, parc…). [ASSUMPTION: nombre de niveaux par âge à confirmer après le prototype.]
- Chaque niveau combine des menaces de base, une ou deux séquences spéciales et des perturbations.
- Le premier niveau sert de tutoriel implicite : une seule menace à la fois, verbes affichés, aucune explication textuelle.

---

## Direction artistique et audio

### Style visuel

Un cartoon 3D low poly, rond et exagéré, pensé pour rester cohérent quand il est produit avec l'aide de l'IA.

- **Vue :** 3D low poly, vue isométrique, une pièce par niveau ; caméra fixe dans une petite pièce, qui suit papa dans le grand salon.
- **Personnages :** formes simples, bébé à tête énorme, expressions portées par les yeux. Squash and stretch pour compenser des animations courtes. La dégaine de papa se dégrade visiblement pendant le niveau. Le mouvement, les visages et la variété des animations sont décrits dans « Animation des personnages » ci-dessous.
- **Rendu :** couleurs par sommet ou petite texture-palette partagée, rendu toon avec contours. Le rendu de l'outil de modélisation ne se transpose pas tel quel en jeu ; le style est défini côté jeu.
- **Couleurs :** palette vive et limitée. Une teinte d'alerte est réservée aux dangers ; le bleu signale « parable », le rouge « esquive ».
- **Effets de feeling :** hitstop, tremblement d'écran, particules. Sur réponse parfaite : ralenti, zoom et courte rotation de caméra, qui revient ensuite à son angle de départ. Sur la dernière réponse d'un niveau : célébration démesurée (chœur d'opéra, feu d'artifice, façon Peggle).
- **Cadrages parodiques :** chaque séquence spéciale emprunte la grammaire visuelle de sa référence (film d'action, infiltration, prise d'otage, désamorçage).
- **Fin de niveau :** photo de fin figée, puis replay façon match de sport des meilleurs moments. Après un niveau perdu, le replay montre la cascade de catastrophes qui a fait rentrer Maman.

### Animation des personnages

Constat de Geo (2026-11-08) : les personnages manquent de fluidité et de variété. Papa pivote d'un bloc, ses bras et ses jambes bougent sans coude ni genou, il reste planté pendant les temps forts de la cuisine, l'infiltration montre une marche au ralenti, et chaque réponse rejoue la même pose. Sur un téléphone en paysage, papa mesure une quarantaine de pixels et le bébé une vingtaine : des polygones en plus ne se verraient pas. À cette taille, ce qui se lit, c'est la silhouette, la netteté des poses, le timing et les yeux.

**Principes.**

1. **Le corps raconte l'état.** Ce que fait papa (tâche, café, téléphone, infiltration, fatigue, bébé dans les bras) se lit sur son corps sans la bulle d'activité (pilier 3).
2. **Le jeu décide, le corps suit.** Une animation ne change jamais une position, une durée ni une fenêtre, et ne contredit jamais le mouvement : le bébé ne s'assoit que lorsqu'il est à l'arrêt.
3. **Rien ne retarde une réponse.** Un tap coupe sur-le-champ toute attente, toute réaction et tout démarrage. La latence tap → retour visuel reste de 50 ms au plus.
4. **Varier sans brouiller.** Les variantes d'une réponse gardent la silhouette de cette réponse : une variante change le style, jamais le sens. Aucune attente, aucune expression et aucun déplacement, de papa comme du bébé, ne ressemble à un télégraphe : le bébé ne se hisse jamais près d'un meuble, ne fixe jamais un point, n'accélère jamais hors d'une menace ; hors micro-sieste, les paupières de papa ne tombent jamais (piliers 1 et 3).
5. **Aucune animation ne trahit une information cachée.** Le bébé ne montre que ce que le joueur sait déjà, sauf les indices voulus de son état caché (mécanique 10) : pointer un objet ou prendre un air concentré n'arrive qu'après le télégraphe de la menace. Le regard de papa ne suit jamais un bébé hors cadre ni caché. Pendant le duel du coucher, la sortie en infiltration et les feintes (faux sommeil, fausses alertes), ni papa ni le bébé n'ont de variante ni d'attente : seuls les signaux comptent.

**La couche de vie (pilier 3).** Par-dessus chaque animation, papa et le bébé bougent en continu. Valeurs de départ, réglables sans toucher à la logique :

- **Transitions :** un fondu qui démarre et finit en douceur, avec une durée par passage : 0,1 s pour se mettre en route, 0,2 s pour s'arrêter, 0,15 s pour revenir d'une pose ponctuelle.
- **Demi-tour :** en 0,25 s environ ; il démarre et freine en douceur et dépasse sa cible de 5 à 10° avant de s'y poser.
- **Élan :** le buste de papa penche jusqu'à 10° quand il accélère ou freine, et jusqu'à 8° vers l'intérieur d'un virage.
- **Respiration :** un cycle de 3 s au repos, de 1,5 s quand la jauge de catastrophe dépasse 70 %. Elle s'arrête quand papa retient son souffle.
- **Regard :** la tête de papa suit le bébé quand il est à l'écran, sinon la menace visible dont l'anneau-chrono est le plus avancé, jusqu'à 60° de chaque côté ; jamais le silence suspect.
- **Mouvement secondaire :** la mèche de papa suit ses gestes avec un temps de retard.
- **Dégaine qui se dégrade :** papa se voûte avec la fatigue, jusqu'à 15° à fatigue 100. Au-dessus de 70, il traîne les pieds. Cette posture s'ajoute aux parties de la dégaine (purée sur la joue, cheveux en pétard, t-shirt à l'envers).

**Les visages (pilier 3).** Les yeux portent l'expression ; à cette taille, des sourcils mobiles font le reste. Chaque personnage a quatre expressions, déclenchées par des moments que le joueur voit. Quand deux moments se chevauchent, le plus récent l'emporte.

| Expression | Papa | Bébé |
|---|---|---|
| Surprise / joie | Surpris quand une menace est télégraphiée | Ravi quand il rit, quand papa le prend ou après un gag |
| Fermeté / bouderie | Sourcils froncés pendant une Fermeté | Boudeur juste après une Fermeté |
| Fatigue / concentration | Épuisé au-dessus de 70 de fatigue (sourcils affaissés, paupières ouvertes) | Concentré pendant une bêtise déjà télégraphiée |
| Fierté / sommeil | Fier après une réponse parfaite | Ensommeillé dans le cycle du dodo, hors des moments du principe 5 |

**Panel de papa.** ⭐ = première vague.

| Famille | Animations | Piliers |
|---|---|---|
| Déplacement | ⭐ démarrage avec élan ; ⭐ freinage ; ⭐ pointe des pieds, joues gonflées pendant qu'il retient son souffle (infiltration) ; course paniquée quand la catastrophe dépasse 70 % (à la même vitesse : seule l'allure change) ; marche traînante au-dessus de 70 de fatigue | 3 |
| Attente | ⭐ trois variantes : il se gratte la tête, se masse la nuque, s'étire le dos. La première vient après 4 s d'immobilité, les suivantes toutes les 5 à 8 s, jamais deux fois la même de suite | 2, 3 |
| Tâches | ⭐ remuer la casserole ; ⭐ ramasser un débris ; vider le lave-vaisselle ; goûter la purée | 1, 3 |
| Réponses | ⭐ une deuxième variante de Parer ; puis deux ou trois variantes pour chaque réponse, jamais deux fois la même de suite ; un geste propre à certaines menaces (fermer le placard, plaquer la main sur la prise) ; une pose qui s'emballe avec le combo, à x3 puis à x6 | 1, 2 |
| Réactions | ⭐ soupir de soulagement après une réussite dans le dernier quart de la fenêtre, tolérance cachée comprise ; après un gag, un facepalm ou un regard caméra ; effondrement quand Maman rentre ; danse de victoire en fin de niveau réussie (elle alimente la célébration finale) | 2 |

Une réaction n'occupe jamais papa : c'est du jeu d'acteur, pas une séquelle, et un tap la coupe.

**Panel du bébé.** ⭐ = première vague.

| Famille | Animations | Piliers |
|---|---|---|
| Déplacement | ⭐ s'asseoir, puis repartir à quatre pattes | 3 (un bébé calme fait ressortir le télégraphe) |
| Attente | ⭐ taper des mains ; jouer avec ses orteils ; sucer son pouce | 3 |
| Réactions | ⭐ un deuxième rire ; un troisième rire ; moue boudeuse après une Fermeté ; applaudir une réponse parfaite ; bâiller et se frotter les yeux (cycle du dodo, hors des moments du principe 5) ; pointer l'objet de la menace, une fois celle-ci télégraphée | 1, 2 |

La première vague compte treize animations : dix pour papa, trois pour le bébé. Le reste du panel suit, puis les enfants des âges suivants, Maman et le chien, avec les mêmes principes.

**Netteté à l'écran (pilier 3).** Pas de polygones en plus : la silhouette d'abord.

- **Personnages détachés du décor :** un liseré clair sur leur pourtour, et un contour 1,5 fois plus épais que celui des meubles.
- **Taille à l'écran :** voir le cadrage de la caméra qui suit (« Cadre de level design »), point laissé à Geo.
- [NOTE FOR DESIGNER: un quatrième ton d'ombrage sur les personnages, à essayer en jeu avant de le retenir.]

**Garde-fous.**

- **Reproductible :** une même partie rejouée montre les mêmes animations (replay, photo de fin, captures de test).
- **Mouvement réduit :** la respiration, l'élan, la mèche et les attentes s'arrêtent ; les poses qui portent un état restent.
- **Performances :** 60 FPS stables sur les appareils de référence, dans les budgets d'affichage de l'architecture.

**Ordre de production.** (1) La couche de vie, sans nouvel asset : l'effet se voit dès la première partie ; la mèche arrive avec le squelette v2. (2) Le squelette v2 (voir « Besoins en assets »), avec les animations existantes reprises en soignant l'anticipation, le dépassement et les trajectoires en arc, et les sourcils. (3) La première vague des deux panels. (4) Le reste des panels.

[ASSUMPTION: durées des fondus, inertie du demi-tour, angles d'élan et de posture, respiration, angle du regard, cadence des attentes, paliers du combo, quart de fenêtre du soulagement et épaisseur du contour des personnages sont des valeurs de départ, à régler en jouant.]

### Audio et musique

Le son est le système nerveux du jeu.

- **Les bruits du bébé informent :** babillage continu, pleurs typés, soupirs (fausses alertes), et surtout le **silence** qui annonce une bêtise.
- **Les bruits de papa menacent :** parquet, objets, souffle relâché alimentent la jauge de bruit.
- **Un son culte par réponse :** couinement de jouet, claquement de placard, et un éclat de rire du bébé sur réponse parfaite (façon Sekiro).
- **Un son distinct par télégraphe.**
- **Musique adaptative :** douce quand tout est calme, nerveuse quand une menace approche. Elle bascule en ralenti sur les réponses parfaites, se coupe lors des silences suspects et se tend quand la jauge de catastrophe dépasse 70 %, avec un son d'alerte.
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
- **Squelette v2 (v2.4) :** une vingtaine d'os par personnage, 32 au plus, contre 11 pour papa et 9 pour le bébé aujourd'hui. Papa gagne coudes, genoux, pieds, cou, bassin, une mèche et des sourcils ; le bébé gagne coudes, genoux, mains, pieds et des sourcils. Le nombre de triangles par personnage ne change pas. Les animations existantes sont reprises sur ce squelette ; la couche de vie s'y ajoute en jeu, sans les remplacer.
- Audio : un son par télégraphe, un son par type de réponse, des pleurs typés, une musique adaptative par âge.
- **Poids d'un niveau :** la pièce et l'audio d'un niveau tiennent aujourd'hui dans 3 Mio ; la géométrie du salon pèse 58 Kio et l'audio fait l'essentiel. Le grand salon peut relever ce plafond si ses nouveaux sons l'exigent (décision de Geo, 2026-11-03), tant qu'un niveau se charge en moins de 5 s en 4G.

---

## Epics de développement

### Structure des epics

Le détail des epics et des stories de haut niveau est dans `epics.md`.

| # | Epic | Contenu | Phase |
|---|---|---|---|
| E1 | Prototype « Bébé à 4 pattes » en cubes | Boucle de base, 3 menaces, téléphone, silence suspect, fatigue, note de Maman, build web de playtest | Prototype |
| E2 | Game feel et lisibilité | Sons cultes, haptique, verbes affichés, anneau-chrono, bulle d'activité de papa, tolérance, calibration, instinct paternel, fichier de feeling | Prototype |
| E3 | Bruit et Maman | Jauge de bruit, variante Sieste, équité de trajet, note de Maman sur cinq lignes, joueur simulé humain réaliste, séquelles des gags, jauge de catastrophe et niveau perdu (« Maman rentre ! »), porte, rush final, photo, réactions et étoiles, replay | Prototype (partiel) puis v1 |
| E4 | Cycle du dodo | Rester éveillé, 100 pas, duel du coucher, dépose-bombe, sortie en infiltration, combo encaissé, bras-bébé | Deuxième prototype |
| E5 | Hygiène et état caché | Couche de Schrödinger, odeur, pleurs typés, change de couche boss, rhabillage, soins | v1 |
| E6 | Âges suivants | Petite enfance, enfance, adolescence, adulte | v1 |
| E7 | Production art et audio | Pipeline Blender, personnages, animation (couche de vie, squelette v2, visages, panel), DA, musique | v1 |
| E8 | Distribution | Capacitor iOS et Android, stores | v1 |
| E9 | Grand salon et maison | Salon avec cuisine ouverte, caméra qui suit, bulles hors cadre, tâches de la maison, nouvelles bêtises | Troisième prototype |

**Séquence :** E1 → E2 → E3 (partiel) → playtest → E4 → rattrapage de lisibilité v2.3 (stories ajoutées à E2 et E3) → playtest → E9 → E5 → E6, avec E7 et E8 en parallèle à partir de E4.

**Scope du prototype.** Un seul niveau, « Bébé à 4 pattes », jouable en 3 minutes avec des formes géométriques. S'il est drôle avec des cubes, le concept tient.

- Un salon, un papa, un bébé (une sphère qui se déplace).
- Trois menaces : prise électrique, escalier, objet sur la table basse.
- Une perturbation : le téléphone qui sonne.
- Le tap sur la menace, le déplacement, la jauge de fatigue.
- La note de Maman en fin de partie.
- **Ajouts issus du brainstorming :** le silence-télégraphe, la jauge de bruit avec la variante Sieste, les verbes affichés, un son culte par réponse et le rire du bébé, la tolérance cachée, les équivalents visuels et haptiques. Validés par Geo le 2026-10-26.
- **Ajouts de la v2.2 :** l'anneau-chrono, les séquelles des gags et la jauge de catastrophe avec la fin « Maman rentre ! ». Validés par Geo le 2026-10-29, après le premier jeu du prototype (« le jeu n'a pas d'enjeux »).
- **Ajouts de la v2.3, avant tout nouveau contenu :** l'anneau-chrono (pas encore livré), la bulle d'activité de papa, l'équité de trajet, la note de Maman sur cinq lignes (Maison reste à 0 sans tâche) et un joueur simulé humain réaliste, puis un playtest dans le salon actuel. Les séquelles et la jauge de catastrophe de la v2.2 ne sont pas encore livrées non plus. Le grand salon, les tâches et les nouvelles bêtises viennent ensuite (E9). Validés par Geo le 2026-11-03, après son premier playtest.
- **Pas dans le prototype :** l'esquive (aucune menace rouge avant E5) et le combo à encaisser (livré avec E4).

---

## Indicateurs de succès

### Indicateurs techniques

- 60 FPS stables sur les appareils de référence pendant un niveau complet.
- Latence tap → retour visuel ≤ 50 ms.
- Tous les paramètres de feeling se règlent sans toucher à la logique.
- Le jeu peut être lancé et joué de bout en bout sans intervention humaine.

### Indicateurs de gameplay

| Critère (GDD v1, puis v2.2) | Mesure |
|---|---|
| On a envie de relancer une partie juste après la première | ≥ 70 % des testeurs relancent sans qu'on le leur demande |
| Une parade parfaite procure une vraie satisfaction, même sans graphismes | ≥ 4 testeurs sur 5 la citent spontanément comme un moment fort |
| Un testeur extérieur comprend chaque menace sans explication | ≥ 4 testeurs sur 5 identifient la bonne réponse à chaque menace dès la première rencontre |
| La parade au tap tient sur mobile | Taux de réponses réussies sur mobile ≥ 80 % de celui mesuré au clavier |
| Le chaos reste drôle | ≥ 4 testeurs sur 5 rient au moins une fois pendant un niveau |
| Rater coûte quelque chose | ≥ 4 testeurs sur 5 disent avoir eu peur de rater une menace ; aucun ne juge la défaite « Maman rentre ! » injuste |
| La défaite est possible sans être un mur | En parties simulées au palier Normal : un joueur simulé humain (réactions et erreurs réalistes) perd le niveau dans 10 à 30 % des parties ; un joueur simulé parfait ne le perd jamais ; un joueur simulé inactif le perd avant la fin du chrono. Le rythme des menaces se règle pour tenir ces cibles |
| Le bon moment se voit | ≥ 4 testeurs sur 5 réussissent au moins une réponse parfaite voulue dès leur première partie |
| Le joueur simulé humain joue comme un humain | Sur un même niveau, son score moyen reste à moins d'une étoile de la médiane des testeurs, et il ne réussit pas plus de parfaites qu'eux. Au playtest du 2026-11-03, il faisait 84 points et 4 étoiles quand Geo restait à 20 points et 1 étoile |
| Papa se lit sans sa bulle | Sur des extraits joués sans la bulle d'activité, ≥ 4 testeurs sur 5 nomment ce que fait papa (tâche, café, téléphone, infiltration, fatigue, bébé dans les bras) ; aucun ne trouve spontanément une pose répétitive |

[ASSUMPTION: seuils de départ, panel de 5 testeurs minimum.]

---

## Hors scope

**Hors scope v1 :**

- Coop local papa + maman.
- Multijoueur en ligne.
- Narration scriptée longue (le fil entre les âges est mécanique).
- Personnalisation du personnage.
- Game over sec, qui arrête le niveau au premier raté ou montre le bébé blessé : la défaite passe toujours par la jauge de catastrophe et se termine en gag.
- Synchronisation labiale et visage entièrement animé : les yeux, les paupières et les sourcils portent l'expression.

**Reporté après le lancement :**

- Version Steam.
- Niveaux supplémentaires par âge.

---

## Hypothèses et dépendances

**Questions ouvertes :**

- **Modèle économique :** jeu payant, gratuit avec publicité, ou démo + version complète ? À trancher avant l'epic E8.
- **Dernier niveau :** reste-t-il drôle ou bascule-t-il vers l'émotion ? Le fil de la retenue est proposé comme structure, mais le ton n'est pas tranché.
- **Nouvelles bêtises du grand salon :** la liste candidate est à trier par Geo avant l'epic E9.

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
8. Valeurs de la jauge de catastrophe (hausses, décroissance, multiplicateurs par palier) et durées des séquelles : valeurs de départ, à régler au playtest et avec les bots.
9. Bulle d'activité de papa : pictogrammes et durée des poses.
10. Tâches de la maison : nombre de temps forts, espacement, points de la ligne Maison.
11. Équité de trajet : marge de 0,3 s.
12. Grand salon : dimensions et plan ; zone morte, vitesse et cadrage de la caméra.
13. Pentes de la note de Maman v2.3 : Rire par réussite, Calme du bébé, Soupir, Hurlement.
14. Animation des personnages : durées des fondus, inertie du demi-tour, angles d'élan et de posture, respiration, angle du regard, cadence des attentes, paliers du combo, quart de fenêtre du soulagement, épaisseur du contour des personnages, nombre d'os du squelette v2.

---

## Références

- GDD v1 : `docs/Papa Parade — Game Design Doc.pdf`.
- Brainstorming du 2026-10-26 : `_bmad-output/brainstorming/brainstorm-papa-parade-gameplay-2026-10-26/`.
- BMad Game Dev Studio — référence du module.
- BlenderMCP — dépôt et installation.
- Écarts de rendu Blender vers moteur de jeu (GameDev.tv).
