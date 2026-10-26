---
title: Papa Parade — Epics de développement
gdd: gdd.md
created: 2026-10-26
updated: 2026-10-26
---

# Papa Parade — Epics de développement

> **Remplacé pour le détail.** Les epics et les 76 stories avec critères d'acceptation sont dans [`planning-artifacts/epics.md`](../../epics.md) (2026-10-26). Ce fichier reste la vue d'ensemble du GDD ; en cas d'écart, `planning-artifacts/epics.md` fait foi.

Détail des epics résumés dans `gdd.md`. Les stories sont de haut niveau ; elles seront découpées par `gds-create-epics-and-stories`.

## E1 — Prototype « Bébé à 4 pattes » en cubes

**Objectif :** prouver que la boucle de base est drôle avec des formes géométriques.
**Mécaniques livrées :** Parer (et Fermeté si le temps le permet), fenêtres de timing, glissade freeflow, fatigue, physique légère, note de Maman. L'esquive et le combo à encaisser ne font pas partie du prototype.

- Le joueur se déplace dans un salon isométrique (tap au sol, clavier, manette).
- Le bébé (sphère) se déplace et choisit des cibles selon les menaces du niveau.
- Trois menaces avec télégraphe, fenêtre et gag d'échec : prise électrique, escalier, objet sur la table basse.
- Perturbation : le téléphone qui sonne (décrocher ou ignorer).
- Silence suspect : babillage coupé, musique coupée, bulle « … ».
- Tap sur une menace : papa glisse vers elle et répond ; réponse parfaite avec ralenti.
- Jauge de fatigue, café.
- Fin de niveau au chrono (3 min), note de Maman sur 5 étoiles.
- Menaces et niveau définis en données éditables hors code.
- Build web partageable par lien pour les playtests.

**Critère de sortie :** les cinq indicateurs de gameplay du GDD sont mesurés sur au moins 5 testeurs, et tous les paramètres de feeling se règlent sans toucher à la logique.

## E2 — Game feel et lisibilité

**Objectif :** chaque réponse est satisfaisante et chaque menace se comprend sans explication.

- Fichier de feeling unique : fenêtres, tolérance, buffer, hitstop, ralentis, instinct paternel.
- Un son culte par type de réponse, rire du bébé sur réponse parfaite.
- Verbe d'un mot affiché sur chaque menace.
- Code couleur et forme : bleu / cercle = parable, rouge / triangle = esquive.
- Retour haptique sur mobile.
- Équivalents visuels de chaque signal sonore.
- Calibration de la latence au premier lancement.
- Instinct paternel (rattrapage) et mode assistance.

## E3 — Bruit et Maman

**Objectif :** relier tous les systèmes par la jauge de bruit et rendre la fin de niveau mémorable.

- Jauge de bruit et variante Sieste (fin anticipée au réveil de Maman). *(prototype)*
- Porte qui s'ouvre, rush final, photo de fin figée.
- Réactions de Maman (rire, soupir, hurlement) converties en étoiles ; dégaine de papa.
- Replay des meilleurs moments.
- Répliques de Maman qui se souviennent des parties précédentes.
- Variante Retour.

## E4 — Cycle du dodo (deuxième prototype)

**Objectif :** valider une séquence variée qui ne repose pas sur la parade.

- Bras-bébé : porter le bébé, une seule main (Parer et Esquiver, pas Fermeté), fatigue doublée.
- Rester éveillé : parer ses propres micro-siestes, bébé dans les bras.
- Les 100 pas en rythme, berceuse qui ralentit, contretemps piège.
- Duel du coucher (attendre, puis partir au bon moment).
- Dépose-bombe au ralenti.
- Sortie en infiltration : lattes qui grincent, souffle retenu, fausses alertes (soupir ou vrai réveil).
- Combo à encaisser : il monte en portant le bébé et à chaque réponse, il s'encaisse à la dépose.
- Faux sommeil (attaque retardée).

## E5 — Hygiène et état caché

- États cachés du bébé : propre, nourri, reposé ; leur effet sur la note.
- Odeur visible, renifler, couche de Schrödinger.
- Pleurs typés et diagnostic (un mauvais remède fait escalader) ; pleur sans raison inparable.
- Change de couche en boss (jet, pied, retournement, lingette manquante).
- Rhabillage en puzzle physique, enchaîné directement quand la couche a débordé.
- Soins : lavage de nez, coupe d'ongles.
- Vomi en jet (menace rouge à esquiver).

## E6 — Âges suivants

- **Petite enfance :** crises de colère (boss), coups et morsures, provocation et dosage, jauge d'attention, aide invisible, fugue et escalade, plongeon-rattrapage.
- **Enfance :** dangers à distance (parc, vélo, cuisine), anticiper et rattraper de loin.
- **Adolescence :** duel verbal sous pression de temps.
- **Adulte :** ne plus parer, le laisser faire ; examen final du fil de la retenue.
- Désarmement (fourchette, truc dans la bouche) et valeur de coolitude ; préparation entre les vagues et zones à sécuriser en urgence.
- Perturbations d'escalade : chien, casserole.
- Catalogues de menaces des âges Enfance, Adolescence et Adulte, à écrire avant cette epic.

## E7 — Production art et audio

- Pipeline Blender : pièces entières, Blender comme éditeur de niveaux, blocage et exports pilotés par l'IA via Blender MCP.
- Personnages : papa (dégaine qui se dégrade), bébé, enfants par âge, Maman, chien.
- Rendu toon avec contours, palette limitée avec teinte d'alerte.
- Effets : hitstop, tremblement, particules, célébration finale.
- Musique adaptative par âge, bibliothèque de sons.

## E8 — Distribution

- Builds iOS et Android via Capacitor (haptique, audio, orientation).
- Préparation des fiches stores.
- Modèle économique à trancher avant cette epic.
