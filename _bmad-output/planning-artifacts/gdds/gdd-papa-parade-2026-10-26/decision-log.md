# Decision log — Papa Parade GDD

- 2026-10-26 — Intent : refonte du GDD v1 (PDF du 2026-10-23) en `gdd.md` au format GDS, intégrant les décisions du brainstorming du 2026-10-26. Mode Create plutôt qu'Update, car les décisions touchent le pilier 1 et la boucle de jeu. (Geo)
- 2026-10-26 — Langue du document : français, en dérogation à `document_output_language: English` de la config. (Geo)
- 2026-10-26 — Type de jeu : hybride sur mesure « Action chaotique à timing, solo ». Section genre composée d'emprunts : Fighting (fenêtres chiffrées, boss, défense), Party Game (variété des séquences, accessibilité, sessions courtes), Rhythm (fenêtres de timing, calibration de latence). (Geo)
- 2026-10-26 — Mode de rédaction : Express. (Geo)
- 2026-10-26 — Cadre de niveau : deux variantes selon le niveau. « Sieste » (Maman dort à côté, jauge de bruit) et « Retour » (Maman rentre à la fin du chrono). Même fin : porte, rush final, photo, note. (Geo)
- 2026-10-26 — Pilier 1 réécrit : « Lire, puis répondre juste » (parer, fermeté, esquiver, attendre, ne rien faire). La parade reste la réponse principale ; le titre Papa Parade est conservé. (Geo)
- 2026-10-26 — Note de Maman : trois réactions (rire, soupir, hurlement) converties en note sur 5 étoiles. (Geo)
- 2026-10-26 — Contrôles mobiles : tap sur la menace = papa glisse vers elle et répond (façon freeflow Arkham) ; tap = calme, maintien = ferme ; tap au sol = déplacement. Répond à la question ouverte du GDD v1 sur la parade au tap, à valider au playtest. (Geo)
- 2026-10-26 — Questions ouvertes du GDD v1 « fil narratif » et « dernier niveau drôle ou émouvant » : réponse proposée par le brainstorming, le fil est mécanique (la retenue s'apprend d'âge en âge) et le niveau Adulte en est l'examen final. À confirmer en relecture. (coach, depuis brainstorming)
- 2026-10-26 — Brouillon complet de gdd.md (v2.0) et epics.md rédigé en mode Express. (coach)
- 2026-10-26 — Finalize, réconciliation et validation : 3 relectures (PDF v1, brainstorming, checklist GDS). Corrections appliquées : chemin source du PDF (`docs/`), ton Overcooked, formule des âges, chien et casserole en perturbations, règle d'or en principe de production, références, détails Blender ; scènes vécues réintégrées (truc dans la bouche, 3 ans violent, rester éveillé, débordement → rhabillage, zone à sécuriser en urgence) ; combo qui monte en portant le bébé ; fausses alertes et pleurs typés en mécaniques ; références parodiques par séquence ; valeurs chiffrées manquantes ; paliers de difficulté ; colonne de traçabilité ; formulations d'implémentation retirées ; incohérences E1 corrigées (pas d'esquive ni de combo dans le prototype, cinq critères, build web en E1). (coach)
- 2026-10-26 — Note de Maman : formule de départ Score = Rire (0–40) + État du bébé (0–30) + 30 − Soupir (0–15) − Hurlement (0–15) ; étoiles à 20 / 40 / 60 / 75 / 90 ; réveil anticipé −1 étoile. (Geo)
- 2026-10-26 — Toutes les situations se ramènent aux cinq réponses ; les termes dérivés (rythme, échange, dosage verbal, lâcher prise, attendre à distance) sont mappés, l'anticipation est un déplacement. (Geo)
- 2026-10-26 — Règles d'entrée par défaut : timing à l'appui ; relâché < 0,2 s = Parer, maintien > 0,4 s = Fermeté ; « Ne rien faire » échoue seulement sur la menace visée ; souffle retenu = maintien n'importe où, en infiltration uniquement ; bébé dans les bras : Parer et Esquiver, pas Fermeté ; orientation paysage. (Geo)
- 2026-10-26 — Pause : automatique en arrière-plan, reprise exacte avec décompte de 3 s. (Geo)
- 2026-10-26 — Question ouverte du GDD v1 « dernier niveau drôle ou émouvant » remise en questions ouvertes : le fil de la retenue structure le niveau, le ton reste à trancher. (coach, suite à la réconciliation)
- 2026-10-26 — Différé : modèle économique (avant E8) ; confirmation des ajouts au prototype ; catalogues de menaces des âges 3 à 5 (avant E6). (coach)

## À reporter dans le document d'architecture (retiré du GDD, pas abandonné)

- Rendu : Three.js + Vite, en TypeScript ; choisi parce que c'est la stack que les LLM maîtrisent le mieux et que tout est du code, sans éditeur.
- Physique : Rapier (WASM), rapide et déterministe.
- Logique de jeu : TypeScript pur, sans dépendance au rendu, sur le plan du sol ; testable dans Node, simulations rapides.
- Contenu : menaces, niveaux et âges en JSON, générés et validés par l'IA.
- Feeling : un fichier de config unique (fenêtres, hitstop, ralenti…).
- Tests : Vitest (logique) + Playwright (jeu lancé dans le navigateur, captures).
- Rendu toon et contours écrits côté moteur, car le rendu Blender ne se transpose pas tel quel.
- Assets : export glTF (.glb), pièces entières modélisées dans Blender, convention de nommage pour les colliders.
- Mémoire projet : CLAUDE.md + GDD comme source de vérité pour l'IA.
- 2026-10-26 — Ajouts du brainstorming au scope du prototype validés : silence-télégraphe, jauge de bruit et variante Sieste, verbes affichés, sons cultes et rire du bébé, tolérance cachée, équivalents visuels et haptiques. (Geo)
- 2026-10-26 — GDD v2.0 finalisé : décisions auditées, entrées réconciliées, checklist passée, aucun point bloquant pour le prototype. Points différés : modèle économique (avant E8), ton du dernier niveau, catalogues des âges 3 à 5 (avant E6). Prochaine étape : gds-game-architecture. (coach)
