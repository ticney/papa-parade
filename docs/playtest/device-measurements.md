# Mesures sur appareils réels

> Story 1.24. **Ce document est rempli par Geo (ou par un agent qui pilote un vrai appareil), jamais par l'agent de dev** : les tableaux sont vides (`—`) tant que personne n'a mesuré. Un chiffre que personne n'a pris ne s'écrit pas ici.

Le playtest ne démarre que si **NFR1** et **NFR2** passent sur les deux appareils (voir « La barrière » plus bas). Le CI (`npm run e2e:dist`) ne remplace pas ces mesures : il tourne sur le Chromium d'une machine de bureau, pas sur un téléphone.

## Appareils à mesurer

| Appareil | Navigateur |
|---|---|
| iPhone 12 ou plus récent | Safari |
| Un Android de 2021 (milieu de gamme) | Chrome |

## Le protocole (à répéter pour chaque appareil)

Avant de commencer : récupérer l'URL du build de playtest déployé (CLAUDE.md › Playtest deployment) et le commit déployé (`git rev-parse --short HEAD` au moment du `build:playtest`).

1. **Chargement (NFR3, moins de 5 s).**
   - Passer en **4G**, pas en Wi-Fi.
   - Ouvrir `<url>/`, **sans** `?debug=1` : avec lui, l'écran de départ attend aussi les deux modules de debug (le compteur et l'API de test), deux téléchargements en plus que les testeurs ne feront pas, et le temps mesuré serait trop long.
   - Pour lire le compteur plus bas (étape 2), recharger ensuite avec `<url>/?debug=1`.
   - Noter le temps entre le tap sur le lien et l'écran de départ, au chronomètre ou sur une vidéo à 240 i/s.
2. **Un niveau complet à la main.**
   - Jouer un niveau en entier (environ 5 minutes réelles).
   - Sur l'écran de résultat, lire le compteur en bas à gauche : `p95` et `DPR`. Le compteur reste figé sur l'écran de résultat exprès.
   - FPS p95 = `1000 / p95`. Le compteur mesure l'intervalle entre deux images affichées (l'horodatage du navigateur) et arrondit au dixième de milliseconde au-dessus : un écran à 60 Hz qui tient donne un p95 de 16,7 à 17 ms, et la gigue de l'écran peut le pousser un peu plus haut.
3. **Latence du tap (NFR2, au plus 50 ms).**
   - Filmer à **240 i/s** (iPhone : « Ralenti » 240 i/s), le doigt **et** l'écran dans le cadre.
   - Au moins **10 taps** sur des icônes de menace.
   - Pour chaque tap, compter les images entre le contact du doigt et la mise en évidence de l'icône. Latence = images × 4,17 ms.
4. **À noter aussi.**
   - Le son marche après le premier tap (iOS : interrupteur silencieux désactivé).
   - La vibration (Android).
   - Un démarrage à la manette seule, si une manette est sous la main (`deferred-work.md` : la manette demande HTTPS, donc l'URL déployée, pas le serveur local).

Si le compteur affiche un `DPR` plus bas que prévu à la fin du niveau, c'est le pixel ratio adaptatif qui est descendu (2 → 1,5 → 1) : à noter, c'est une information sur la charge du téléphone.

## Verdicts

| Exigence | Seuil | Verdict |
|---|---|---|
| NFR1 : 60 FPS stable sur un niveau complet | p95 ≤ 20 ms (le budget du CI : les 16,7 ms d'un écran à 60 Hz plus la gigue de la mesure) | `OK` si le seuil tient, sinon `KO` |
| NFR2 : du tap au retour visuel | chaque tap ≤ 50 ms | `OK` si les 10+ taps tiennent, sinon `KO` |
| NFR3 : un niveau charge en moins de 5 s en 4G | < 5 s | `OK` si le seuil tient, sinon `KO` |

## iPhone (Safari)

| Champ | Valeur |
|---|---|
| Date | — |
| URL du build | — |
| Commit | — |
| Appareil et OS | — |
| Navigateur et version | — |
| Temps de chargement (4G) | — |
| p95 du compteur (ms) | — |
| FPS p95 (`1000 / p95`) | — |
| DPR à la fin | — |
| Latences des taps (ms), 10 ou plus | — |
| Latence moyenne / maximale (ms) | — / — |
| Verdict NFR1 | — |
| Verdict NFR2 | — |
| Verdict NFR3 | — |
| Son après le premier tap | — |
| Démarrage à la manette seule | — |
| Notes | — |

## Android (Chrome)

| Champ | Valeur |
|---|---|
| Date | — |
| URL du build | — |
| Commit | — |
| Appareil et OS | — |
| Navigateur et version | — |
| Temps de chargement (4G) | — |
| p95 du compteur (ms) | — |
| FPS p95 (`1000 / p95`) | — |
| DPR à la fin | — |
| Latences des taps (ms), 10 ou plus | — |
| Latence moyenne / maximale (ms) | — / — |
| Verdict NFR1 | — |
| Verdict NFR2 | — |
| Verdict NFR3 | — |
| Son après le premier tap | — |
| Vibration | — |
| Démarrage à la manette seule | — |
| Notes | — |

## La barrière

**Le playtest ne démarre que si NFR1 et NFR2 passent sur les deux appareils.**

- Si l'un des deux échoue, noter l'écart ici (appareil, chiffres) et le dire à l'agent : le prochain `create-story` ajoute une story de correction, dont Geo décide le numéro.
- NFR3 (chargement) est mesuré et noté, mais c'est un budget, pas une barrière : un dépassement est un sujet à discuter avec l'agent (le premier chargement pèse environ 2,2 Mo gzip, dont 1,7 Mo pour le moteur physique).
