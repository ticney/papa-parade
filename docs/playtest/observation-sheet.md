# Fiche d'observation du playtest

> Story 3.4. **Cette fiche est remplie par Geo pendant la séance, jamais par l'agent de dev.** Elle donne les trois indicateurs qu'un journal ne peut pas mesurer (la parade parfaite citée, la lisibilité, le rire). Les deux autres (relance, tactile contre clavier) sortent des journaux. Les seuils vivent dans `content/playtest.json` : on les change là, pas ici.

Une fiche par testeur. Un testeur est un **pseudonyme** que tu choisis (`T1`, `T2`…) : 1 à 32 caractères parmi `A-Z a-z 0-9 _ -`. Aucun nom, aucune donnée personnelle (NFR14).

## Le protocole

1. Envoyer le lien du build de playtest, **sans `?debug=1`** (le compteur de FPS et l'API de test ne sont pas pour les testeurs).
2. **Ne pas expliquer les menaces.** Dire seulement comment on joue (« tape sur l'icône qui apparaît »). Si le testeur demande ce qu'il doit faire face à une menace, ne pas répondre : c'est justement ce qu'on mesure.
3. **Ne jamais demander de relancer une partie.** L'indicateur de relance (NFR11) compte les testeurs qui recommencent « sans qu'on le leur demande ». Si tu as besoin d'une autre partie pour une autre raison, **recharge la page d'abord** : `gameIndexInSession` repart alors à 1 et cette partie ne compte pas comme une relance.
4. Observer sans parler. Remplir la grille ci-dessous pendant que le testeur joue.
5. À la fin, demander le journal : le bouton « Copier le journal » de l'écran de résultat (ou « Télécharger le journal » si le presse-papiers refuse), puis le coller dans un message ou joindre le fichier.
6. Ne poser la question de la parade parfaite qu'**après** avoir noté la réponse spontanée (voir « Ce qui compte »).

## La grille

Les menaces du prototype (`threatId`) : `outlet`, `stairs`, `coffee_table_object`, `silence_mischief`, `papa_microsleep`.

### Une ligne par menace rencontrée

| Menace (`threatId`) | A trouvé seul la bonne réponse (O/N) | Remarque |
|---|---|---|
| `outlet` | | |
| `stairs` | | |
| `coffee_table_object` | | |
| `silence_mischief` | | |
| `papa_microsleep` | | |

Laisser vide la ligne d'une menace que le testeur n'a pas rencontrée : elle n'entre pas dans le calcul.

### Une ligne pour toute la partie

| Question | Réponse |
|---|---|
| A cité la parade parfaite spontanément comme un temps fort (O/N) | |
| Nombre de rires | |
| Commentaires libres | |

## Ce qui compte

- **« A trouvé seul la bonne réponse »** : le testeur fait le bon geste face à la menace **dès la première rencontre**, sans aide et sans te l'avoir demandé. Un tap au hasard qui tombe juste, ce n'est pas comprendre : note N. Un tap juste mais trop tard, après avoir compris, note O seulement s'il a su quoi faire.
- **« Spontanément »** : le testeur cite la parade parfaite **avant** que tu poses une question dessus (« c'était quoi le meilleur moment ? »). S'il ne la cite qu'après ta question, note N.
- **Un rire** : un rire audible, ou un sourire clair accompagné d'un son. Compter **une fois par éclat**, pas une fois par seconde de rire.

## Le report : de la fiche au CSV

Les notes vont dans `docs/playtest/observations.csv`, une ligne par ligne de la fiche. Les colonnes sont exactement celles de `docs/playtest/observations.example.csv` : `testerId, sessionId, threatId, identifiedWithoutHelp, perfectCitedSpontaneously, laughs, comment`.

- **Une ligne par menace** : `testerId`, `threatId`, `identifiedWithoutHelp` (`O` ou `N`), éventuellement `comment`. Les autres colonnes restent vides.
- **Une ligne pour la partie** : `testerId`, `threatId` **vide**, `identifiedWithoutHelp` **vide**, `perfectCitedSpontaneously` (`O`, `N` ou vide), `laughs` (un nombre, ou vide), `comment`.
- `sessionId` : le plus souvent **vide** (« ce testeur, quelle que soit la session »). Tu ne le vois pas pendant la séance ; tu peux l'ajouter après coup, il est dans le journal (8 caractères hexadécimaux, aussi dans le nom du fichier téléchargé). C'est utile surtout si un testeur a rechargé la page : l'ordre dans lequel tu écris ses sessions dit laquelle était la première.
- Un commentaire qui contient une virgule ou un guillemet se met entre guillemets doubles (`"a dit ""waouh"", puis a ri"`). Un tableur français qui exporte avec des points-virgules convient aussi.
- Une seule ligne par menace et par session et par testeur.

Les **journaux** vont dans un dossier avec **un sous-dossier par testeur, nommé comme son pseudonyme** : `<dossier>/T1/*.json`, `<dossier>/T2/*.json`. Un `.json` posé directement dans `<dossier>` est refusé.

Où ranger quoi : garde le dossier des journaux **hors du dépôt**. Les journaux ne contiennent rien de personnel, mais le CSV contient tes notes sur des personnes réelles (sous pseudonyme) : ne commite que `observations.example.csv`.

Puis :

```bash
npm run playtest:metrics -- <dossier>
```

Le rapport (Markdown) sort sur stdout ; `--out rapport.md` l'écrit dans un fichier, `--json rapport.json` ajoute la version JSON, `--observations <fichier>` indique un autre CSV.

## Les cinq indicateurs et leurs seuils

Les valeurs de départ sont dans `content/playtest.json` (hypothèse 7 du GDD). Le rapport les relit à chaque fois :

| # | Indicateur | Clé de `content/playtest.json` | Source |
|---|---|---|---|
| 1 | Relance : des testeurs recommencent une partie sans qu'on le demande | `relaunchMinPct` | calculé (journaux) |
| 2 | Parade parfaite citée spontanément comme un temps fort | `perfectCitedMinPct` | observé (cette fiche) |
| 3 | Lisibilité : la bonne réponse à **chaque** menace dès la première rencontre | `identifiedMinPct` (observé), `firstEncounterSuccessMinPct` (calculé, en appoint) | observé et calculé |
| 4 | Le taux de réponses réussies au tactile, en pourcentage de celui au clavier | `touchVsKeyboardMinPct` | calculé (journaux) |
| 5 | Le chaos est drôle : le testeur rit au moins une fois pendant un niveau | `laughedMinPct` | observé (cette fiche) |

Le panel minimum est `panelMinTesters` (FR68) : en dessous, le rapport le dit et le statut du panel est KO, mais les autres indicateurs sont quand même calculés.

Un indicateur `n/a` n'a aucune donnée : jamais OK. Un `KO` est un résultat, pas une erreur : la commande sort quand même avec le code 0.
