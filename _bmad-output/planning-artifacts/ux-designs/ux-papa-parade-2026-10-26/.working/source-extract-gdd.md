# Source extract — GDD (Papa Parade)

Source: `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` (v2.1, 2026-10-26, author Geo) + `decision-log.md`.
Note: the GDD is written in French (decision log: "Langue du document : français, en dérogation à document_output_language: English"). Quotes below are translated closely into English; French on-screen strings are kept verbatim.

---

## 1. Game summary

- **Genre** (front matter / "Type de jeu"): "Timing-based chaotic action, solo (hybrid Fighting / Party Game / Rhythm)". Fixed isometric view, low-poly 3D.
- **Concept** (Résumé > Concept): The player is a young dad who must keep his child alive and "more or less clean", from birth to adulthood. Each age is a short level (3–5 min) in a single room. Dangers arrive like in a fighting game: the child "attacks", dad **reads** the attack and **responds correctly** at the right moment — usually parry, but sometimes dodge, wait, stay firm, or do nothing at all.
  - "From the baby's point of view, everything dangerous is super cool. From dad's point of view, everything mundane becomes a boss fight."
- **Tone** (Résumé > Concept): funny and chaotic, "in the spirit of Overcooked".
- **Signature:** the epic / mundane contrast. A perfect parry triggers an action-movie slow-motion to catch… a spoon of mashed potato.
- **Working title:** Papa Parade (*parade* = *parry*).
- **USPs** (Arguments uniques): (1) parenting experiences as boss fights (Schrödinger's diaper, bed-drop bomb, the silence that announces mischief) turned into readable, parryable attack patterns; (2) epic/mundane contrast — slow-mo, choirs, parodic framings (action movie, stealth, hostage-taking) for tiny stakes; (3) the same gesture changes meaning with age, up to the final inversion: at Adult level the right answer is to stop parrying; (4) sound as a game system — baby noises inform (silence is an alert), dad's noises threaten (they wake Mum).
- **Design pillars** (Gameplay central > Piliers de design) — "A feature that serves none of them is out of scope":
  1. **Read, then respond correctly.** Each danger read via a telegraph, five responses: parry, firmness, dodge, wait, do nothing. Parry is primary. "No menu, no slow management."
  2. **Chaos is a gag, not a punishment.** Baby never hurt. Failure triggers a gag, never an injury or game over. Failing must make you laugh and want to replay.
  3. **Readable at a glance… and by ear.** Every threat has a clear telegraph (icon, halo, sound) even when the screen overflows. Every audio cue has a visual and haptic equivalent, "because many mobile players play without sound".
  4. **The same gesture changes meaning with age.** Controls stay the same; their meaning evolves. The game progressively teaches **restraint**, culminating at Adult level.
- **Core loop** (Boucle de jeu):
  - Micro (one threat, 2–6 s): Telegraph (icon, halo, distinct sound, vibration; baby's gaze locks onto target) → Read (player identifies threat and expected response: "colour code, displayed verb") → Response window (too early or too late = gag) → Response (dad slides to threat and executes) → Result (perfect: slow-mo, tight framing, action music, bonus / success / gag).
  - Meso (level, 3–5 min): threats stack in waves with disruptions (phone, dog, saucepan); dad's needs (fatigue, coffee, bathroom urge) disrupt responses; noise gauge rises; combo rises and is cashed only when baby is put down somewhere safe; special sequences (sleep cycle, diaper change, disarming) break rhythm.
  - Macro (end of level): door opens → **final rush** (last 10 s to hide everything) → **end photo** (scene freezes) → **Mum's reactions** (laugh, sigh, scream) → **5-star rating** → **replay** of best moments → replay or go to next age.
- **Target audience** (Public cible): Core: young parents, especially dads, who recognise their own struggles. [ASSUMPTION: 25–40, casual to regular players.] Broader: casual mobile players wanting short funny sessions, and action players sensitive to game feel (refs: Overcooked, Batman Arkham, Ghost of Tsushima, Sekiro). Shared expectation: "immediate pick-up, without a long tutorial".
- **Stakes / scope:** Solo-author project ("Auteur : Geo") with an AI-driven production principle (Principe de production): "Golden rule: AI writes and tests the systems, Geo plays and tunes the feel." Prototype first (one level, cubes, 3 min), then v1 (5 ages, 5 levels), store distribution (E8). Business model is an open question (paid, free with ads, or demo + full). Commercial vs hobby status: not explicitly stated beyond store distribution and open business model.

## 2. Platforms & form-factor

- Front matter: `platforms: [web, ios, android]`. "Browser (web), iOS and Android via Capacitor. Steam possibly later."
- Détails par plateforme: Browser — "playtest by simple link. Audio unlocks on first tap." iOS/Android — via Capacitor, with haptic feedback, landscape orientation. Steam — possibly later via a wrapper.
- **Orientation:** landscape (Contrôles et entrées; decision log "orientation paysage").
- Performance (Spécifications techniques > Performances): 60 FPS stable on mid-range mobile [ASSUMPTION: iPhone 12 and 2021 Android, measured on a full 5-min level]; tap → visual feedback ≤ 50 ms; level load < 5 s on mobile 4G.
- Viewing distance: Not stated (implied handheld phone + desktop browser; no TV/couch mention).

## 3. Input modalities

Mobile touch (primary), keyboard, controller. Table from "Contrôles et entrées":

| Action | Mobile (touch) | Keyboard | Controller |
|---|---|---|---|
| Move | Tap on floor | ZQSD / arrows | Left stick |
| Parry | Tap on threat | Space (tap) on targeted threat | A |
| Firmness | Hold on threat | Space (hold) | A (hold) |
| Dodge | Swipe | Shift + direction | B + direction |
| Hold breath (stealth only) | Hold anywhere | E (hold) | RT (hold) |
| Drink coffee, pick up phone | Tap on object | Contextual interaction (Space) | Contextual A |
| Pick up baby / find baby (suspicious silence) | Tap on baby, outside a current threat | Space near baby | A near baby |
| Sniff | 1 s hold on baby, outside a current threat | Space (hold) near baby | A (hold) near baby |

- **Input rules:** timing measured at finger/key press. Single 0.4 s threshold: release before 0.4 s = Parry; hold ≥ 0.4 s = Firmness (tunable). "Do nothing" fails only if the player acts on the targeted threat; other threats can be handled meanwhile.
- **Early press:** by default, a press before the window opens (minus input buffer) triggers the gag. A tunable "on guard" mode: early press launches the slide without judgement; must press again in window.
- **Freeflow slide:** tapping a threat auto-slides dad to it (Batman Arkham style), any point in room in ≤ 0.6 s. "The player chooses **what** to handle; the game handles the **how**."
- **Keyboard/controller targeting:** the most urgent threat in the aimed direction is auto-selected.
- **Baby-in-arms:** dad has one hand — can Parry and Dodge, not Firmness.
- **Haptics (mobile):** short vibration on each telegraph, strong vibration on perfect response.
- **Pause:** auto-pause when app goes to background; resume at same instant after 3 s countdown. "Pause possible at any time, with exact resume" (Durée des sessions).
- **[NOTE FOR DESIGNER]** "Tap parry on mobile is the main control hypothesis of the prototype. It must be validated first."
- Window values (Fenêtres de timing): telegraph→window delay 0.8–1.5 s; standard window 300 ms; perfect 100 ms centred; hidden tolerance +60 ms each side ("Celeste style", not displayed); input buffer 100 ms; hitstop 80 ms; perfect slow-mo ×0.3 for 1.2 s; last-threat-of-wave slow-mo ×0.2 for 1.5 s; dodge window 250 ms; Do nothing 1.5–3 s; 100-steps 180 ms/step; nose wash 150 ms.

## 4. Engine / UI system

- "Target engine: web in TypeScript. Stack detail belongs to the architecture document."
- Decision log (items to carry to architecture): rendering Three.js + Vite, TypeScript; physics Rapier (WASM); pure TS game logic independent of rendering; content in JSON; single feel config file; tests Vitest + Playwright; toon render and outlines written engine-side; glTF (.glb) export from Blender.
- UI system/framework (DOM overlay vs canvas, etc.): Not stated.

## 5. Screens, menus, UI surfaces mentioned

- **First-launch latency calibration** (Timing et latence): "tap in rhythm over 8 beats, offset applied to windows".
- **Audio unlock on first tap** (browser) — implies a tap-to-start moment.
- **Pause** (auto on background; 3 s resume countdown). Manual pause screen contents: Not stated.
- **Difficulty tier selection** (Accessibilité): Assistance / Normal / Papa expérimenté — where it is chosen: Not stated.
- **End-of-level sequence** (Macro-boucle; Fin de niveau): door opens → final rush (10 s) → frozen end photo → Mum's reactions (laugh / sigh / scream) → 5-star rating → "sports-match-style replay of best moments" → choice: replay or next age.
- **Age/level progression** (5 ages, unlocked at ≥ 2 stars) — implies a level/age selection, but no level-select or map screen is described.
- **Special-sequence framings** (diaper-change boss "arena with health bar… of the diaper"; stealth with breath gauge; hostage negotiation with calm gauge; bomb defusal).
- Title screen, main menu, options/settings, credits, store/shop: Not stated.

## 6. HUD elements / in-play information

- **Threat telegraphs:** icon, halo, distinct sound, vibration; baby's gaze locks onto target. Colour code: blue = parryable, red = dodge (unparryable); doubled by icon shape (circle = parryable, triangle = dodge). Alert hue reserved for dangers.
- **Displayed verb:** "a one-word verb shown big on each threat (SOULÈVE ! FERME ! ÉCHANGE !, WarioWare style)".
- **Timer / chrono:** Sieste = Mum's sleep countdown (4 min); Retour = time until Mum returns (3 min).
- **Noise gauge** (Sieste levels): 0–100 %, Mum wakes at 100 %.
- **Fatigue** (0–100) and **bathroom urge** (0–100) — dad's needs; fatigue > 70 shrinks windows, telegraphed micro-naps ("drooping eyelids, cottony sound"). How shown (gauge vs diegetic): Not stated beyond "fatigue gauge" in prototype scope ("la jauge de fatigue").
- **Combo multiplier** x1–x8, cashed when baby is put down safely (not in prototype).
- **Attention gauge** (toddler age, 0–100).
- **Calm gauge** (disarming, 0–100, starts at 50).
- **Breath gauge** (stealth exit, 6 s hold).
- **Diaper "health bar"** (diaper-change boss).
- **Suspicious-silence indicator:** "a blinking '…' bubble at the edge of the screen, and a short vibration"; music cuts.
- **Hidden baby state** (clean, fed, rested) — deliberately hidden; inferred via cues: visible green smell trail, typed cries (hunger, diaper, teeth, tiredness, no reason — each with sound and visual signature), behaviour. Sniff reveals diaper state.
- **Diegetic ideas:** dad's look degrades visibly during the level ("purée on the cheek, hair standing up, t-shirt inside out" — feeds Mum's laugh score); baby's gaze as telegraph; green smell trail; drooping eyelids; prep phase "baby's gaze reveals a forgotten zone"; visual sound equivalents "waves, bubbles".
- Score display during play: Not stated.

## 7. Game feel / juice / feedback

- Objective (Objectifs): "Polished game feel: every successful response is felt (sound, hitstop, vibration, slow-mo), even with cubes."
- Hitstop 80 ms on success; perfect: slow-mo ×0.3 for 1.2 s, tight framing, action music, bonus; camera zoom and rotation; screen shake, particles.
- Last response of a level: "outsized celebration (opera choir, fireworks, Peggle style)". Last threat of a wave: slow-mo ×0.2 for 1.5 s.
- Sounds: "one cult sound per response" (toy squeak, cupboard slam), baby's burst of laughter on perfect response ("Sekiro style"); one distinct sound per telegraph.
- Adaptive music: soft when calm, nervous when a threat approaches, shifts into slow-mo on perfects, cuts on suspicious silence.
- Haptics: short on telegraph, strong on perfect.
- Paternal instinct (catch-up): ≥ 3 active threats and 2 misses in < 10 s → light slow-mo ×0.8 and +30 % windows for 4 s; max once per 30 s. "Keep the chaos funny, never frustrating."
- Failure = cartoon gags (e.g., hair standing up after the outlet; baby slides down stairs on his bottom, delighted; object falls, bounces, breaks something else).
- Light physics: objects fall, roll, bounce; emergent accidents.
- Visual tap response ≤ 50 ms. All feel parameters tunable in a feel file without touching logic.
- Parodic framings per special sequence (action movie, stealth, hostage-taking, defusal); "thriller music, sweat on forehead, epic slow-mo" for bed-drop.

## 8. Art direction, visual style, references

- (Style visuel) "Cartoon low-poly 3D, round and exaggerated, designed to stay coherent when produced with AI help."
- Fixed isometric camera, one room per screen; gameplay on floor plane.
- Characters: simple shapes, baby with huge head, expressions carried by eyes; squash and stretch; dad's look degrades during the level.
- Rendering: vertex colours or small shared palette texture, toon render with outlines; style defined game-side.
- Colours: "vivid, limited palette. An alert hue reserved for dangers; blue signals 'parryable', red 'dodge'."
- End: frozen end photo, then sports-match-style replay.
- Prototype: geometric shapes/cubes ("If it's funny with cubes, the concept holds").
- **Typography:** Not stated.
- **Reference games:** Overcooked (tone), Batman Arkham (freeflow), Ghost of Tsushima (bedtime duel), Sekiro (baby laugh on perfect), Celeste (hidden tolerance), WarioWare (big verbs), Rhythm Heaven (100 steps), Metal Gear (stealth exit), Elden Ring (fake sleep delayed attack), Peggle (celebration), Benny Hill (toddler chase), escape game (dressing puzzle), tower defense (preparation).

## 9. Narrative voice / microcopy / localization

- Tone: funny, chaotic, epic/mundane parody. Content "all ages. No injury shown."
- On-screen verb examples (French, verbatim): "SOULÈVE !", "FERME !", "ÉCHANGE !".
- Mum's reactions remember previous runs, e.g. (verbatim) « *Encore* l'étagère ?! » ("The shelf *again*?!").
- Mum's three reactions: laugh (rire), sigh (soupir), scream (hurlement).
- Narrative thread between ages is "mechanical rather than scripted"; long scripted narrative out of scope v1.
- First level is an implicit tutorial: "one threat at a time, verbs displayed, no text explanation".
- **Localization languages:** Not stated (GDD written in French; displayed verbs are French).

## 10. Player journeys / personas / player types

- **Named player journeys:** None in the GDD. (The brainstorm used a "Persona Journey" technique per Contexte et intention, but no journeys are reproduced in the GDD.)
- Audience segments (Public cible): core = young parents, esp. dads [ASSUMPTION 25–40, casual-to-regular]; broader = casual mobile players seeking short funny sessions; action players sensitive to game feel. Common expectation: immediate pick-up without long tutorial.
- Difficulty tier names: "Assistance", "Normal", "Papa expérimenté" (Experienced dad).
- Playtester persona in success metrics: "an external tester" who should understand each threat without explanation; panel of ≥ 5 testers.

## 11. Accessibility

(Accessibilité et amplitude de compétence; Pilier 3; Audio)
- Difficulty tiers: Assistance (+50 % windows, paternal instinct on), Normal (base, on), Papa expérimenté (−25 %, off).
- Low floor: big one-word verb on each threat; hidden window tolerance; paternal instinct; Assistance tier "assumed" (owned).
- High ceiling: perfect responses, cashed x8 combos, calm/firm dosage, freeflow chaining.
- Colour blindness: blue/red code doubled by icon shape (circle = parryable, triangle = dodge).
- Play without sound: every audio cue has visual (waves, bubbles) and haptic equivalents.
- Latency calibration on first launch.
- Content: all ages, no injury shown.
- Other (text size, remapping, reduced motion/screen shake, haptics toggle, subtitles, one-handed play): Not stated.

## 12. Progression, economy, session, save/meta

- Session: level 3–5 min; special sequence 20–60 s; pause any time with exact resume; prototype 3 min.
- Level variants: Sieste (4 min, noise gauge, early end at 100 % = −1 star), Retour (3 min, no early end). No game over.
- Ages: Bébé à 4 pattes (0–1), Petite enfance (2–4), Enfance (5–11), Adolescence (12–17), Adulte (18+). v1: one level per age, 5 levels, each in a room (living room, bedroom, park, kitchen…).
- Success ≥ 1 star; unlock next age ≥ 2 stars [ASSUMPTION].
- Mum's rating: Score = Laugh (0–40) + Baby state (0–30; 10 each clean/fed/rested) + 30 − Sigh (0–15) − Scream (0–15), out of 100. Stars at 20/40/60/75/90.
- Resources (Économie et ressources): combo score, fatigue, noise gauge, attention gauge, object "coolness" (1–10 scale: spoon 2, fork 4, toy 5, remote 7, phone 8, car keys 10 — "currency of trades"), stars.
- Mum's memory across runs (requires persistence).
- Save system / profile / meta UI: Not stated explicitly (implied by star unlocks and Mum's memory).
- Out of scope v1: local coop, online multiplayer, long scripted narrative, character customisation. Post-launch: Steam, extra levels per age.
- Business model (shop/ads/IAP): open question.

## 13. Open questions / TBD relevant to UX

- **Business model:** paid, free with ads, or demo + full — "to decide before epic E8".
- **Last level tone:** stays funny or shifts to emotion — not decided.
- **Threat catalogues** for Enfance, Adolescence, Adulte "to complete before epic E6".
- **[NOTE FOR DESIGNER]** Tap parry on mobile must be validated first (prototype control hypothesis).
- Early-press rule: default gag vs "on guard" mode, to compare in playtest.
- Assumptions: audience 25–40; 2-star unlock; all timing/gauge/rating values are starting values; wave pacing; one level per age; reference devices; metric thresholds.
- Prototype exclusions: no dodge (no red threats before E5), no combo (E4).
- Undefined in GDD: menus/title/options/level select, HUD layout and which gauges are on-screen vs diegetic, typography, localization, settings content, save model.
