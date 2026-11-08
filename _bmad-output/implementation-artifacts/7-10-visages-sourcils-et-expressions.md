---
baseline_commit: 9db97387e3bd1e7286901b4c75a20cd44d13c201
---

# Story 7.10: Visages : sourcils et expressions

Status: review

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want to read on Papa's and the baby's faces what they feel,
so that every moment of the game gets its reaction, even at phone size.

**Requirements covered:** FR79 (the faces: four expressions each, carried by the brows). **Depends on:** the v2 skeleton of 7.9 (`brow_l`, `brow_r` on both characters, code-driven, no clip track, identity rest), the life layer of 7.8 (`feel.json › characters`, `LifeInputs`, the springs on the sim clock, the frame order), the event → one-shot path of 7.2 (`playCharacterEvent`), the sequences of 4.4-4.10 (duel, stealth exit, feints, bedtime cycle).

**Scope:** a pure expression module picks, every frame, one expression per character from the sim's events (the moments) and the world (the lasting states); a pure brow module blends the brows toward that expression's pose on springs stepped on the sim clock; the two views write `brow_l` / `brow_r` last in `animate`; the poses, the durations and the blend live in `feel.json › characters.expressions`, hot in the feel panel; a debug overlay (`__PP__.setExpressions`) and two `fx()` fields let captures and Geo show any expression on demand. No asset, clip, sim or content-other change.

**Not in this story:**
- Any change to `assets-src/blender/**`, `public/assets/**` (no `.blend`, no `.glb`: the brows exist since 7.9), `src/sim`, `src/bots`, `content/threats`, `content/sequences`, `content/levels`, `content/feedback.json`, `public/_headers`, `tools/blender/**`.
- New clips or body animations of any kind: the pout, the clap, the yawn and the eye rubbing are 7.15's; the facepalm is 7.14's; idles, starts and puffed cheeks are 7.11's.
- Writing a lid or the `eyes` bone for an expression (D1). Mama, the dog, the children.
- Moving the life layer to `pelvis` / `neck` (7.9's D2 stays Geo's option).

## Acceptance Criteria

The epics' criteria (`epics.md › Story 7.10`), made testable. The decisions D1-D15 below are part of them.

1. **Four expressions each, on the brows.** Papa has `surprised`, `firm`, `tired`, `proud`; the baby has `delighted`, `sulky`, `focused`, `sleepy` (the GDD's « Surprise / joie », « Fermeté / bouderie », « Fatigue / concentration », « Fierté / sommeil », in that order). With no moment and no lasting state a face is `neutral`: both brows at their rest. Each expression is a brow pose (D2) read from `feel.json › characters.expressions`, written on `brow_l` and `brow_r` in `animate`, after the gaze and outside the forelock's early returns (D14). No expression writes a lid, the `eyes` bone or any other bone (D1); no clip, `.blend` or `.glb` changes; no draw call, triangle or material is added.
2. **The moments that trigger them (D4).** Each row of D4's table starts its expression, and only its row: a unit test per row, and one per exclusion (a telegraph of a threat on Papa, a `ThreatHidden`, a `SilenceStarted`, a `ChoreBeatTelegraphed` and a surprise while Papa is `asleep` start nothing; a perfect Firmness makes Papa proud and the baby delighted, never sulky).
3. **The most recent wins (D3).** Two moments that overlap: the later one shows. A lasting state (Papa's fatigue above the threshold, the baby's focus on a telegraphed mischief, the bedtime) shows again when the moment that covered it is over; a lasting state that starts after a moment covers it. Papa's Firmness frown is held from `ResponseHeld` to that threat's `ResponseResolved`, then `firmAfterMs` more on a success, and ends at once on a fail or a `ThreatCancelled` of that threat. A gag cuts Papa's current moment (D15). Each moment's duration is in `feel.json › characters.expressions`.
4. **Papa's lids are the micro-sleep's alone.** For each of Papa's four expressions, once settled, with no micro-sleep and Papa not asleep, `fx().papaEyelidsPct` is 0 and the `eyelids` bone is at `EYELIDS_OPEN_SCALE`; `tired` sags the brows with the lids open. The existing micro-sleep and sleep tests of the lids pass unchanged. The baby's lids stay `babyLidsAfter`'s alone (the duel's signals): no expression writes them either (D1).
5. **Focus only after the telegraph (D6).** The baby is `focused` only while he is `targetLocked` or `approach` on a threat whose state is `telegraph` or `windowOpen` (its marker is shown): never in `mischiefSilent`, never for a `hidden` threat, never before that threat's `ThreatTelegraphed`. A headless test on the live levels proves it on every step (T5). `expressions.ts`, `brows.ts` and `faceInputs.ts` read no `windowOpenAt`, `feintAt`, `realWakePct` or `toleranceMs` (the scans of `characterAssets.test.ts`), and `expressions.ts` takes no threat (no `ThreatInstance`, no `.threats`).
6. **Only the signals count (D5).** While a `duel` step or a `stealth` step runs (`isDuelStepRunning(world) || isStealthStepRunning(world)`), both faces are `neutral`: no moment starts, a running one is dropped (it does not come back after), and the baby is not `sleepy`. A unit test feeds a `WaitFeintGiven` and a `WaitSignalGiven` during a duel and finds both characters' brows identical and at rest; the live test finds both faces neutral on every step of every duel and stealth step of `chambre_night`.
7. **Reduced motion keeps them.** Under « Réduire les animations » every expression shows as without it, with the same poses and the same blend (the blend never overshoots, so there is nothing to remove). `EXPERIENCE.md`'s reduced-motion row (« the expressions … stay ») already says so: check it still matches.
8. **Data, hot (D10).** `characters.expressions` (`reachMs`, then `papa` and `baby`, each with `browScalePct`, its moment durations and its four `poses`) lives in `feel.json › characters` (client only), with Zod bounds and a `describe` on every key and group, the regenerated `content/_schemas/feel.schema.json`, and is read from `world.feel.characters` every frame (`LifeInputs.characters`), so a change in the feel panel shows on the next frame. Every numeric key passes the unit-suffix rule of `tests/content/feelSchema.test.ts` (D10: `…OffsetM`, not a bare `…M`). Papa's `tired` reads `world.feel.fatigue.thresholdPoints` with the sim's strict `>` (D7), not a copy.
9. **Reproducible.** The expressions and the brows read only the sim clock, the sim's events and the world: no real time, `Math.random`, `Date`, `performance`, `world.rng` (the scans). The brow springs step at `STEP_MS`: the same span in 1, 3 or 7 frames gives the same brows; a `dtMs` of 0 holds them. The same game played twice gives the same expression on every frame. `resetFx()` (a restart, a replay moment, a stopped loop) puts both faces at `neutral` with the brows at rest; the first frame after it puts the brows on their expression at once, with no blend (D9). A highlight replay shows the moments of its own events (they go through `playCharacterEvent`).
10. **The game does not move (D12).** No file changes under the paths of « Not in this story ». `npm run golden:update` is run once, deliberately: only the `feelHash` and `worldHash` lines of `tests/golden/journals/` move, with D12's proof. `npm run sim` with the four bots on `salon_kitchen`, `salon_crawler` and `chambre_night`, seed 1, gives the same reports as `main` apart from the hashes. `tests/bots/humanBotRegression.test.ts`: its `PINNED` is re-pinned only if it moved, `PINNED_COMMANDS` unchanged.
11. **Budgets.** Nothing in the rAF path allocates (scratch values made once; the brows' rest positions read once at creation). No new mesh, material or draw call. `perf.spec.ts` is not rerun for this story (no asset, no draw call; `npm run ci` covers it before the next playtest link): say so in the notes.
12. **Geo can see them (D11, D13).** `fx()` gains `papaExpression`, `babyExpression` (what each face shows now) and `papaBrowTiltDeg`, `babyBrowTiltDeg` (the drawn tilt). `__PP__.setExpressions({ papa, baby })` shows any expression over what the game says (debug overlay, `null` gives the face back, cleared by `resetFx`), like `setPapaLook`. Captures at real size on a landscape phone (844 × 390 CSS px at the game's DPR cap of 2) in `7-10-screenshots/`: the four expressions of each character and `neutral`, on `salon_kitchen` and `salon_crawler`, each with a ×4 nearest-neighbour crop of the face taken from the same image, plus two natural moments (Papa surprised at a telegraph, the baby delighted when picked up). A `notes.txt` lists each image, its expression and frame, and every image not opened. The macOS references of `autoplay.spec.ts` and `afterEffects.spec.ts` are regenerated only if they fail on the brows, deliberately (`--update-snapshots=all`), opened, and said so. The look of the faces is Geo's call; the merge waits for his visual OK.

## Tasks / Subtasks

- [x] **T0. Before touching anything** (AC 1, 12, D2, D10, D13)
  - [x] `env | grep VITE_` (memory: the shell may export `VITE_DEBUG_ALLOWED=false`; then run `dev` and `e2e` as `(unset VITE_DEBUG_ALLOWED; …)`).
  - [x] Read « What exists » below, then `papaView.ts`, `babyView.ts`, `lifeLayer.ts`, `characterSpring.ts`, `characterClips.ts`, `levelScene.ts` (its `playCharacterEvent`, `update`, `resetFx`, `realFxState`), `levelSession.ts` L514-538, `tests/support/testCharacters.ts`, `tests/architecture/characterAssets.test.ts` L751-824, `src/content/schemas/feel.ts` L881-1041 in full.
  - [x] Check the brow geometry this story was written from (« The faces in the files » below) against the committed `.glb` (node translations of `brow_l`, `brow_r` under `head`). If it differs, use the file's.
  - [x] **The « before » captures** (D13): `neutral` faces at real size on both levels, before any code. Measure each brow's length and thickness in physical pixels at DPR 2 and write them in the notes: they decide `browScalePct`'s starting value (D10).
- [x] **T1. Data** (AC 8, 10, D10, D12)
  - [x] `CharactersSchema.expressions` in `src/content/schemas/feel.ts`, after `forelock` (strict at every level, a `BrowPoseSchema` reused for the eight poses, the bounds and `describe`s of D10). Extend the `CharactersSchema` description (« … forelock (story 7.9), expressions (story 7.10), rim and outline »).
  - [x] The block with D10's starting values in `content/feel.json`, `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json` (a whole feel since 7.8). `npm run content:schemas`. `tests/content/feelSchema.test.ts`: the bounds, the unit-suffix rule passes, every group is described.
  - [x] `npm run ci:fast`: the goldens go red on hashes only. `npm run golden:update` once; D12's proof; `humanBotRegression` as AC 10 says.
- [x] **T2. The pure modules** (AC 1-3, 5, 6, 9, D2-D9, D15)
  - [x] `src/client/render/views/expressions.ts` (no Three, no threat): the two expression lists and types, the per-character track (D3), `notePapaEvent` / `noteBabyEvent` (D4, D15), `papaExpressionAt` / `babyExpressionAt` (D3, D5), `clearExpressions`. Names may differ; the rules may not.
  - [x] `src/client/render/views/brows.ts` (no Three): the drawn pose as four springs of `characterSpring.ts` (raise, tilt, inward, skew; damping 1, no overshoot cap needed), `createBrowState`, `resetBrows` (to a pose, at once), `stepBrows(state, pose, dtMs, reachMs)`.
  - [x] `expressions.test.ts`: one test per row and per exclusion of D4; the most-recent rule both ways; a lasting state back after a moment; a lasting state starting over a moment; the held frown (success → `firmAfterMs` more; fail, `ThreatCancelled` → ends); a gag cuts Papa's moment; the guard drops and ignores; a perfect Firmness; the same events twice give the same faces; **the laugh coupling** (D4): the cues of `content/feedback.json` whose `layers` hold `baby_laugh_perfect` are exactly `resp_parry_perfect`, `resp_firm_perfect`, `resp_wait_perfect`, `combo_cashed_in`, `chore_beat_perfect`, so that a new laughing cue fails the test until its event is added to D4.
  - [x] `brows.test.ts`: a held pose settles; 1, 3 or 7 frames over the same span give the same pose; `dtMs` 0 holds; `resetBrows` jumps.
- [x] **T3. The brows in the views** (AC 1, 4, 7, 9, 11, D2, D9, D14)
  - [x] `LifeInputs` gains `papaExpression` and `babyExpression` (`'neutral'` in `createLifeInputs`).
  - [x] `papaView.ts` / `babyView.ts`: `brow_l`, `brow_r` and their rest positions read once at creation; each frame, after the gaze, step the brows toward `characters.expressions.<who>.poses[expression]` (the rest pose for `neutral`) and write both bones absolutely (D2); the first frame after creation or `resetAnimation()` snaps (D9). In `papaView`, the brows must not sit after the forelock's `return`s: write them before the forelock block, or move the forelock into a local function. Getters `browTiltDeg` (and whatever the tests need).
  - [x] `tests/support/testCharacters.ts`: put `brow_l` and `brow_r` under `head` in both fixtures, at the `.glb`'s rest positions (Papa ±0.075, 0.262, 0.115; the baby ±0.062, 0.187, 0.1), so that a wrong frame, mirror or sign fails (the lesson of 7.9's review).
  - [x] `papaView.test.ts` / `babyView.test.ts`: **replace** 7.9's « never writes a brow » tests (they pin the brows at rest, which this story ends) with: at `neutral` both brows sit at their rest (position, identity rotation, scale `browScalePct / 100`); each expression brings them to rest + its pose, with the signs of D2 pinned on world points of each brow's two ends (inner end up for a positive tilt, both brows toward the nose for a positive inward, his left brow up for a positive skew); no expression moves the lids or `eyes` (AC 4); reduced motion gives the same pose; `resetAnimation()` puts them at rest at once; 1/3/7 frames give the same brows.
- [x] **T4. The scene, the session and the debug hooks** (AC 2, 3, 5, 6, 9, 12, D3-D8, D11)
  - [x] `src/client/render/views/faceInputs.ts` (pure, no Three; reads the world, never a timing field): `babyFocusOf(world)` (D6), `isSignalOnly(world)` (the guard of D5, through `@sim`'s `isDuelStepRunning` / `isStealthStepRunning`), `isPapaTired(world)` (D7). Unit tests next to it, on hand-made worlds: a hidden threat, a `mischiefSilent` baby, a duel step, a stealth step, fatigue at exactly the threshold (not tired) and just above.
  - [x] `levelScene.ts`: a track per character; `playCharacterEvent` notes each event (D4) after its one-shots, through the guard (D5); `update` fills `life.papaExpression` / `life.babyExpression` from the tracks, the lasting states (`faceInputs.ts`, `SceneBodies.hasBedtimeCycle`) and the overlay, before `papa.animate` / `baby.animate`; the guard every frame (D5); `resetFx` clears the tracks and the overlay; `realFxState()` gains the four fields of AC 12; `setExpressionOverlay(papa, baby)` on `LevelScene`. The scan of `levelScene.ts` must still find `windowOpenAt` only in its two helpers.
  - [x] `SceneBodies.hasBedtimeCycle` (D8), filled in `levelSession.ts` from `levelPlan.level.cycle !== undefined`; the fakes in `levelSession.test.ts` and `levelScene.test.ts` follow.
  - [x] `levelScene.test.ts`: a `ThreatTelegraphed` makes `fx().papaExpression` `surprised`, then `neutral` after `surprisedMs`; tired Papa surprised goes back to `tired`; a world in a duel step shows both `neutral`; the overlay wins and `resetFx` clears it.
  - [x] The test API: `TestHost` (`src/client/app/testHost.ts`) gains the four fx fields and `setExpressions`; `boot.ts` implements them; `src/debug/testApi.ts` validates the names (the two lists, `'neutral'` or `null`) and forwards; `src/debug/testApi.test.ts`, `tests/support/fakeTestHost.ts`, `tests/e2e/support/testApi.ts`. **Both lists of `__PP__` methods must gain `setExpressions`:** `src/debug/testApi.test.ts` (`installTestApi`) and `tests/e2e/testApi.spec.ts` (a smoke spec: `ci:story` fails without it).
- [x] **T5. The live proof and the scans** (AC 5, 6, 9, D13)
  - [x] `tests/bots/expressionsLive.test.ts` (as `highlightReplayLive.test.ts` does: `loadSimLevel`, `createSim`, a bot, relative imports of `expressions.ts` and `faceInputs.ts`, no Three): on `salon_kitchen`, `salon_crawler` and `chambre_night`, `human` and `perfect`, seeds 1 to 3, feed each step's events to the tracks and read the faces from the world as `levelScene` does, and assert on every step: the baby `focused` only with his target's `ThreatTelegraphed` already seen and never in `mischiefSilent`; both `neutral` through every duel and stealth step; `sleepy` only in `chambre_night`; each of the eight expressions shows at least once over the runs (or say which never does and why); the same seed twice gives the same faces (`hashJson`, never `JSON.stringify`).
  - [x] `characterAssets.test.ts`: `expressions`, `brows` and `faceInputs` join `LIFE_VIEWS` (both scans); a test « expressions.ts takes no threat » next to « characterClips.ts takes no threat » (`faceInputs.ts` reads `world.threats` for the focus, so it is not in that one).
- [x] **T6. Prove nothing moved** (AC 10, 11)
  - [x] `git diff --stat main` on the paths of « Not in this story »: empty. D12's proof of the goldens. The bots on the three levels against `main`.
  - [x] `npm run ci:fast`. Then on Chromium, in the background: `npm run e2e -- tests/e2e/testApi.spec.ts tests/e2e/characters.spec.ts tests/e2e/lifeLayer.spec.ts --project=chromium` (the API's method list, the fx fields, the clips and the life layer).
- [x] **T7. Captures and references** (AC 12, D13), after the last tuning of the starting values
  - [x] A throwaway Playwright file (deleted after, as 7.9's) takes the captures of D13 into `7-10-screenshots/`, with the crops and `notes.txt`. Open every image you name, write what you saw, list what you did not open.
  - [x] `npm run e2e -- tests/e2e/autoplay.spec.ts tests/e2e/afterEffects.spec.ts --project=chromium`. Only if they fail on the brows: `--update-snapshots=all` (both browsers), open the four images, say what changed. `afterEffects.spec.ts` times out under load and passes alone (memory): rerun it alone before concluding.
- [x] **T8. Close** — `project-context.md › Rigged characters`: the brows are written by the expressions (replace « The brows rest until story 7.10 writes them; nothing writes them before »), and a line for the expressions (modules, inputs, the guard, the feel block, the overlay). The comments of `characterClips.ts` that say « at rest until story 7.10 ». `deferred-work.md`: what this story leaves (« Open for Geo » items not settled, D13's « never shown » if any).

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The faces are the brows alone.** Every expression is written on `brow_l` and `brow_r`, the code-driven bones of 7.9 (no clip track, identity rest, children of `head`, 100 % weighted to their `art_ink` bar). No expression writes Papa's `eyelids` (the micro-sleep's telegraph and his sleep), the baby's `eyelids` (the duel's signals through `babyLidsAfter`: half shut is the feint, shut is the signal) or Papa's `eyes` (keyed by `coffee_kick`, so the code cannot drive it without fighting the mixer). No new bone, node, clip or asset. | The epics' AC: « ses expressions passent par les sourcils ». A sleepy baby with half-shut lids would look like the fake sleep's peek: principle 4 (« aucune expression ne ressemble à un télégraphe »). The GDD's « les yeux portent l'expression » stays true of the drawn eyes; the lids and the eyes are signal channels. |
| D2 | **A brow pose is four numbers, mirrored, written absolutely.** `raiseOffsetM` (both brows up along the head's Y), `tiltDeg` (positive lifts the inner ends, toward the nose), `inwardOffsetM` (both toward the nose), `skewOffsetM` (positive raises his left brow, `brow_l`, and lowers his right by as much: the cocked brow). Per character, `browScalePct` scales both brows about their bone (the bar's centre). Writes, each frame, from the rest positions read once: `brow_l.position = (rx − inward, ry + raise + skew, rz)`, `brow_r.position = (−rx + inward, ry + raise − skew, rz)`; `brow_l` turns by `−tilt` and `brow_r` by `+tilt` about the bone's local Z (forward); scale `browScalePct / 100` on all three axes. The signs come from the axes (X his left, Y up, Z forward; a turn of +θ about Z lifts the +X end): **pin them with a test on world points** of each brow's two ends before trusting them. `neutral` is the rest (all four at 0). | Four numbers give each expression its own shape at 3-6 px: height (surprise, fatigue), slant (frown, sag), the cocked brow (pride), the knot (focus). Absolute writes from a rest read once hold on a re-export (identity rest, 7.9 AC 1). The bone's head is the bar's centre (« The faces in the files »), so a tilt and a scale pivot on it. |
| D3 | **The most recent wins, with one slot per character.** A track holds the current moment (`kind`, `startAt`, `untilAt`, and for Papa's held frown the threat id it waits for) and the lasting expression's start (`lastingAt`). A new moment replaces the current one. `lastingAt` is set to the frame's clock when the lasting expression changes to a non-neutral one (a lasting state that ends starts nothing). What shows at `nowMs`: the moment if `nowMs < untilAt` and `startAt ≥ lastingAt`; else the lasting expression; else `neutral`. Times are sim ms: a moment starts at its event's `t`; the frame's clock is `world.time.sim + alpha × STEP_MS`, so a pause and a hitstop hold a face and a slow-mo slows it. | The epics' AC: « le plus récent l'emporte ; un état qui dure revient quand le moment ponctuel est fini ». A lasting state that begins is the latest thing that happened (a telegraph while the baby is delighted: he focuses). A moment that a lasting state covered does not come back: it is over in the player's eyes. |
| D4 | **The triggers** (table « The expressions » below). Papa: `surprised` on a `ThreatTelegraphed` whose `anchorId` is not `PAPA_TARGET_ANCHOR_ID`, unless Papa is `asleep`; `firm` from a `ResponseHeld` (the press became a Firmness) to its threat's resolution (D3); `proud` on a `ResponseResolved` or a `ChoreBeatJudged` of quality `perfect`; `tired` lasting while `world.gauges.fatigue > world.feel.fatigue.thresholdPoints`. The baby: `delighted` on a `BabyPickedUp`, a `GagTriggered`, and every event whose cue makes him laugh (`ResponseResolved` and `ChoreBeatJudged` of quality `perfect`, `ComboCashedIn`); `sulky` on a `ResponseResolved` of response `firm` and quality `success`; `focused` lasting (D6); `sleepy` lasting in a bedtime level (D8). Nothing else starts an expression: not `ThreatHidden`, `SilenceStarted`, `ChoreBeatTelegraphed`, `WaitFeintGiven`, `WaitSignalGiven`, `DecoyCued`. | The GDD table and the epics' AC. « Quand il rit » is read from the cues that layer `baby_laugh_perfect` (`content/feedback.json`): the face follows the sound the player hears, so a perfect Firmness makes him laugh, not sulk (his laugh is in that cue). A telegraph on Papa is the micro-sleep, whose telegraph is his own lids. A hidden threat is not telegraphed: surprise there would give the silence away. An asleep Papa has his eyes shut. |
| D5 | **Only the signals count (principle 5).** The guard is `isDuelStepRunning(world) \|\| isStealthStepRunning(world)` (both exported by `@sim`; `boot.ts` already reads them): the bedtime duel and the bomb drop are `duel` steps, the fake sleep's feints happen only in a duel, the false alerts (the sigh, the real wake) only in the stealth exit. While it holds: both faces `neutral`, every lasting state included (the track's lasting expression counts as `neutral`, so a lasting state that still holds afterwards starts again when the guard ends, D3); events start nothing; the current moments are dropped. Evaluated on the live world in `playCharacterEvent` (after the step) and in every `update`. | The epics' AC: « aucune expression ne s'ajoute à leurs signaux : le bébé n'y paraît pas ensommeillé, et papa n'y réagit pas différemment à un vrai signal et à une feinte »; architecture « Information cachée ». One rule, no per-event list, so that a feint and a real signal are the same by construction. A duel that retreats to an earlier step is still running: the guard still holds. |
| D6 | **The focus reads only what the marker shows.** `babyFocusOf(world)` (pure, in a small `src/client/render/views/faceInputs.ts` with the guard of D5 and the bedtime flag, so that the live test imports them without Three): `baby.state` is `targetLocked` or `approach`, `baby.targetThreatId` is not null, and that threat's `state` is `telegraph` or `windowOpen`. It reads no timing field (`faceInputs.ts` joins the scans). The baby locks only on a threat that is active and not `hidden` (`lockOnThreat`), in the step of its telegraph (the director runs before the baby; a found silence enters `targetLocked` and telegraphs in the same call): the live test pins that the face never comes before the event. `act` is not focus: the gag that starts it makes him delighted. | The epics' AC: « il ne prend son air concentré qu'après le télégraphe de cette menace, jamais en `targetLocked` avant ». The threat's state is public (the marker, the ring), its `windowOpenAt` is not. Keeping the threat read in the scene keeps `expressions.ts` threat-free, a guarantee the scan can hold. |
| D7 | **Tired is the gameplay threshold.** Papa is `tired` while `world.gauges.fatigue > world.feel.fatigue.thresholdPoints` (70; the sim's own strict `>`, `sim/gauges/fatigue.ts`), not a second number in `characters`. A level with no fatigue gauge stays at 0, so never tired. | Above it his windows shrink and the micro-sleeps come: the face tells the truth of the gauge, and a copy in `characters` could drift from it. |
| D8 | **The bedtime is the level's `cycle`.** The baby's lasting `sleepy` holds in a level that has a `cycle` (`chambre_night` today), whatever the cycle's index, outside the guard of D5. `SceneBodies.hasBedtimeCycle` is filled by `levelSession.ts` from `levelPlan.level.cycle !== undefined`, as `microSleepDefId` is. | The GDD: « ensommeillé dans le cycle du dodo, hors des moments du principe 5 ». The whole bedroom level is the bedtime; the interludes and the lullaby walk are where he can look sleepy. |
| D9 | **The blend: four springs per character, on the sim clock.** `brows.ts` steps raise, tilt, inward and skew with `stepSpring` (damping 1, no overshoot), `reachMs` of `characters.expressions`, at `STEP_MS` on the frame's `dtMs`. The first frame after the view is made or `resetAnimation()` snaps them on the target (the body spring does the same), so a restart and a replay moment start on the right face. Reduced motion changes nothing: expressions carry a state, and a critically damped blend has no overshoot to remove. | Architecture « Reproductible »: springs at the fixed step, frame-rate free. The forelock and the turn use the same module (7.8, 7.9). |
| D10 | **The feel block** (table « The feel block » below). Every numeric leaf must pass `UNIT_SUFFIX` of `feelSchema.test.ts`: a bare `…M` is refused (only `OffsetM`, `RadiusM`, `DistM`, `ReachM`, `WidthM`, `DepthM` and a few exact keys are lengths), hence `raiseOffsetM`, `inwardOffsetM`, `skewOffsetM`. Strict objects, bounds on both sides (the panel draws a slider only then), a `describe` on every key and group. Starting values `[ASSUMPTION]`, tuned once on the T7 captures before they are final: Geo's to judge. `browScalePct` starts at 100 unless T0's measure shows a brow under about 6 physical px long at DPR 2, in which case start it where that holds and say so. | CLAUDE.md: « Anything Geo might want to tweak is data ». The panel is built from the schema (`feelControls.ts`): a new key shows with no panel change. |
| D11 | **`__PP__.setExpressions({ papa, baby })` and four `fx()` fields.** The overlay (an expression name, or `null` to give the face back to the game) wins over the computed expression, is applied at the next `update`, and is cleared by `resetFx()`; the guard of D5 does not apply to it (it is a debug tool). `fx()`: `papaExpression`, `babyExpression` (what shows now, overlay included) and `papaBrowTiltDeg`, `babyBrowTiltDeg` (the drawn tilt, positive inner ends up), so a capture can wait for a face to settle. No new e2e spec: the rules are proven in Vitest. | `setPapaLook` (story 3.7) is the precedent. The moments are short and some (a perfect Firmness, the bedtime) are slow to stage in a browser: the overlay makes the captures exact and lets Geo tune each pose in the panel while he sees it. |
| D12 | **Goldens: `feelHash` and `worldHash` move, and only they,** as 7.8's D2 and 7.9's D9: `tests/golden/scenarios.ts` hashes the world, which carries its feel. Prove it: for the regenerated journals, hash the final world without its `feel` key and the events on `main` and on the branch (a throwaway test outside `tests/golden/`, deleted after), and compare; write the file count and the result. | The sim reads no `characters` key. A golden whose events move means the sim reads the new block: stop and look. 7.9 lost a run to a proof left inside `tests/golden/`. |
| D13 | **Captures** in `7-10-screenshots/`, by a throwaway Playwright file (deleted after). 844 × 390 CSS px with `deviceScaleFactor: 2` (the game draws at `min(devicePixelRatio, 2)`), Chromium. `salon_kitchen` (the first level, the follow camera) and `salon_crawler` (the fixed camera, the smallest characters). Frozen (`__PP__.freeze`), the overlay set, `advance` until `fx()`'s tilt has settled, then capture: per level, one image per expression per character and one `neutral`, Papa and the baby both in frame (the threats off, as the e2e helpers' `THREATS_OFF` query does; move Papa next to the baby first; neither busy nor hidden). The game's DPR steps down when frames are slow (`adaptivePixelRatio.ts`), which a headless GPU can trigger: write the ratio each image was drawn at (`canvas.width / canvas.clientWidth`), and say so if it is under 2. Each image with a ×4 nearest-neighbour crop of the faces cut from it (no re-render), so Geo sees the pixels the phone shows. Plus two natural moments with no overlay: Papa `surprised` right after a `ThreatTelegraphed`, the baby `delighted` right after `BabyPickedUp` (`fx()` says so). `notes.txt`: each file, level, expression, sim time, `fx()` tilt, what you saw, and every image not opened. The « before » set of T0 is the neutral faces on untouched code. | The epics' AC: « des captures à la taille réelle, sur un téléphone en paysage, permettent à Geo de juger qu'elles se distinguent ». The real-size image is the judge; the crop only helps the eye. |
| D14 | **Where in the frame.** In `animate`: clip choice → body spring → `rig.update` → the life layer (spine) → the gaze (head) → the forelock (Papa) and the brows, last. The brows are the head's children: they turn with the gaze and the squash, and no clip and no `rig.update` touches them (no track, not a life bone), so the absolute writes stand until the next frame. `papaView.animate` returns early three times in its forelock block (no marker, reduced motion or first frame, a degenerate aim): the brows cannot follow those returns. | Architecture « Ordre dans une frame »: « les os pilotés par le code (paupières, sourcils, mèche) sont écrits en dernier ». |
| D15 | **A gag ends Papa's moment.** A `GagTriggered` (any threat) ends Papa's current moment (`untilAt` = its `t`): his gag clip (`gag_hit`, `gag_shock`, `stumble`…) carries the reaction, and a proud or surprised brow over it would read wrong. His lasting `tired` still shows. 7.14 adds his facepalm after the gag's after-effect. | Derived: the table has no Papa expression for a failure, and a frown held through a failed hold must stop (AC 3). |

### The expressions

| Character | Expression | Kind | Starts | Ends |
|---|---|---|---|---|
| Papa | `surprised` | moment | `ThreatTelegraphed`, `anchorId !== PAPA_TARGET_ANCHOR_ID`, Papa not `asleep` | `surprisedMs` later |
| Papa | `firm` | moment, held | `ResponseHeld` (its `threatId` remembered) | that threat's `ResponseResolved`: + `firmAfterMs` on `success`, at once on `fail`; `perfect` makes him `proud` instead; its `ThreatCancelled`: at once |
| Papa | `tired` | lasting | `fatigue > feel.fatigue.thresholdPoints` | when it is not |
| Papa | `proud` | moment | `ResponseResolved` or `ChoreBeatJudged` of quality `perfect` | `proudMs` later |
| Papa | — | — | `GagTriggered` | ends his current moment (D15) |
| Baby | `delighted` | moment | `BabyPickedUp`, `GagTriggered`, `ComboCashedIn`, `ResponseResolved` / `ChoreBeatJudged` of quality `perfect` | `delightedMs` later |
| Baby | `sulky` | moment | `ResponseResolved`, response `firm`, quality `success` | `sulkyMs` later |
| Baby | `focused` | lasting | `babyFocusOf(world)` (D6) | when it is not |
| Baby | `sleepy` | lasting | the level has a `cycle` (D8) | never in that level, but hidden by the guard |
| Both | `neutral` | — | the guard of D5, or nothing else | — |

Lasting precedence for the baby when both hold: `focused` over `sleepy` (the focus starts later, D3). The guard wins over everything.

### The feel block

`feel.json › characters.expressions` (D10). Starting values `[ASSUMPTION]`; bounds to confirm against the geometry at T0 (the brows must stay on the forehead, out of the eyes, and Papa's inner ends clear of his forelock, which hangs between them at x ≈ −0.006 to 0.012 m).

| Key | Start | Bounds | Meaning |
|---|---|---|---|
| `reachMs` | 100 | `reachMs()` 50-1000 | Time the brows take to cover 95 % of the way to a new pose, sim ms, no overshoot |
| `papa.browScalePct` / `baby.browScalePct` | 100 | 50-250 | Both brows' size, % of the modelled bar, about its centre (D2) |
| `papa.surprisedMs` | 900 | 0-5000 | How long the surprise of a telegraph shows (0: never) |
| `papa.firmAfterMs` | 700 | 0-3000 | How long the frown stays after a successful Firmness (covers `respond_firm`, 22 frames) |
| `papa.proudMs` | 1600 | 0-5000 | How long the pride of a perfect shows (covers the glide and `respond_perfect`) |
| `baby.delightedMs` | 1200 | 0-5000 | How long his delight shows (covers `laugh` 20 f, `gag_delight` 26 f) |
| `baby.sulkyMs` | 1500 | 0-5000 | How long he sulks after a Firmness |
| `<who>.poses.<expression>.raiseOffsetM` | below | −0.02 to 0.05 | Both brows up (+) or down (−), metres |
| `….tiltDeg` | below | −45 to 45 | Inner ends up (+, worry, sag) or down (−, frown) |
| `….inwardOffsetM` | below | 0 to 0.02 | Both brows toward the nose (the knot) |
| `….skewOffsetM` | below | −0.02 to 0.02 | His left brow up and his right down (+), the cocked brow |

| Pose | raiseOffsetM | tiltDeg | inwardOffsetM | skewOffsetM |
|---|---|---|---|---|
| Papa `surprised` | 0.03 | 10 | 0 | 0 |
| Papa `firm` | −0.012 | −28 | 0.008 | 0 |
| Papa `tired` | −0.01 | 22 | 0 | 0 |
| Papa `proud` | 0.008 | −10 | 0 | 0.02 |
| Baby `delighted` | 0.025 | 6 | 0 | 0 |
| Baby `sulky` | −0.008 | −25 | 0.008 | 0 |
| Baby `focused` | −0.004 | −8 | 0.004 | −0.012 |
| Baby `sleepy` | −0.01 | 18 | 0 | 0 |

Shape on purpose: two high (surprise / delight), two slanted down (frown / sulk), two sagging (fatigue / sleep), two lopsided (pride / focus), so that the four of each character sit apart even where the slant is a single pixel.

### The faces in the files

Read on 2026-11-08 from the committed files (glTF axes: X his left, Y up, Z forward; Blender: Z up, he faces −Y):

- **Papa:** `brow_l` / `brow_r` at (±0.075, 0.262, 0.115) m under `head` (`head` 0.04 above `neck`); each bar 7 cm long (x 0.039 to 0.109), 3 cm tall, 12 vertices all 100 % on its bone, the bone's head at the bar's centre (Blender (±0.075, −0.115, 0.822); bar z 0.806 to 0.836). Eyes up to z 0.801, lids up to 0.801, head top 0.89. Forelock root (0.012, 0.315, 0.08) under `head`, its tip marker (−0.018, −0.08, 0.068) under `forelock`: the lock hangs between the brows.
- **The baby:** `brow_l` / `brow_r` at (±0.062, 0.187, 0.1) under `head`; each bar 6.7 cm (x 0.028 to 0.095), 2.5 cm tall, 12 vertices, the bone's head at the bar's centre (Blender (±0.062, −0.1, 0.347); bar z 0.332 to 0.357, sitting on the lids' top at 0.331). Head top 0.404.
- No clip has a track on any brow (checked). On a phone Papa is about 40 px tall and the baby about 20 (GDD): a brow is a few pixels, hence `browScalePct` and the crops.

### What exists, and what must keep working

- **`papaView.ts` › `animate`** (L354-473): clip choice → body spring → `rig.update` → stoop, lean, breath on `spine` → gaze on `head` → the forelock (early returns at L430, L440, L461). `resetAnimation` resets the springs and the lock; `setAway`, `setEyelids`, `setAsleep`, `setHair`, `setLook`, the busy props stay as they are. Add the brows (D14); `eyelidsPct` must stay what the micro-sleep and the sleep say.
- **`babyView.ts` › `animate`** (L204-245): clip choice → body spring → `headBone.rotation.y` (the gaze, absolute) → `rig.update` → breath on `spine`. Add the brows after the breath. `setEyelids` (fed by `babyLidsAfter`) is untouched.
- **`lifeLayer.ts`:** `LifeInputs` (one scratch object filled by the scene each frame), `createLifeInputs`. Add the two expressions; nothing else changes.
- **`characterSpring.ts`:** `createSpring`, `resetSpring(spring, value)`, `stepSpring(spring, target, dtMs, reachMs, zeta, overshootMax)` (whole `STEP_MS` steps with a leftover, `dtMs` 0 holds, returns the drawn value). Reuse it; do not write another integrator.
- **`characterRig.ts`:** the mixer writes only keyed bones; `rig.update` restores the life bones (`spine`, `head`) only; `rig.node(name)` warns once and returns an origin node for a missing name (a file with no brow would draw nothing and log, not crash).
- **`characterClips.ts`:** `babyLidsAfter` (the baby's lids), the contracts (`codeDrivenBones` already list both brows). Only comments change (T8). The architecture test slices this file at `"/** Papa's contract"`: keep the contracts last.
- **`levelScene.ts`:** `playCharacterEvent` (L719-746) plays the one-shots, the baby's lids and the squash for every live event (boot L1899), every replay event (`highlightReplay.ts` L293) and `__PP__.celebrate`; `update` (L801-889) fills `life` then animates; `resetFx` (L912-942) resets the views; `realFxState` (L758-787). `eyelidsAmountAt` and `layDownPctAt` are the only readers of `windowOpenAt` (a scan holds it): the new helpers must not read it.
- **`responseChoreography.ts`:** the response pose waits for Papa's arrival (P3). The expressions do not wait for it: they start at the judgement (`ResponseResolved`), when the sound, the slow-mo and the camera fire, and their durations cover the glide and the pose.
- **`levelSession.ts`** L514-538 builds `SceneBodies`; add `hasBedtimeCycle`.
- **The test API:** `TestHost` (`testHost.ts`: `fxState`, `setPapaLook`), `boot.ts` (the fx object around L2720-2750), `src/debug/testApi.ts` (`setPapaLook` validates then forwards, L314-330), `src/debug/testApi.test.ts` (`installTestApi` pins the method list, L616), `tests/e2e/testApi.spec.ts` L48-66 (smoke: pins the method list), `tests/support/fakeTestHost.ts`, `tests/e2e/support/testApi.ts`.
- **`tests/architecture/characterAssets.test.ts`** L751-824: `LIFE_VIEWS` (both scans), « characterClips.ts takes no threat », the `levelScene.ts` helper scan.
- **`papaView.test.ts` L895-913 and `babyView.test.ts` L90-102** pin the brows at rest under every life input: replace them (T3), do not delete the intent (neutral = rest).
- **E2E that read `fx()` or clips:** `characters.spec.ts`, `lifeLayer.spec.ts`. New fields do not break them; the brows move no clip.

**Expected changes:** `src/client/render/views/{expressions,brows,faceInputs}.ts` and their tests (new), `src/client/render/views/{papaView,babyView,lifeLayer,characterClips}.ts`, `papaView.test.ts`, `babyView.test.ts`, `src/client/render/levelScene.ts` and `levelScene.test.ts`, `src/client/app/{levelSession,testHost}.ts`, `levelSession.test.ts`, `src/client/boot.ts`, `src/debug/testApi.ts`, `src/debug/testApi.test.ts`, `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json`, `tests/content/feelSchema.test.ts`, `tests/support/{testFeel.json,testCharacters.ts,fakeTestHost.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`, `tests/architecture/characterAssets.test.ts`, `tests/bots/expressionsLive.test.ts` (new), `tests/golden/journals/*` (hashes), possibly `tests/bots/humanBotRegression.test.ts` and the four darwin references, `_bmad-output/project-context.md`, `deferred-work.md`, `sprint-status.yaml`, `7-10-screenshots/`, this file.

### Testing

- **Unit (Vitest):** `expressions.test.ts`, `brows.test.ts`, `faceInputs.test.ts`, `papaView.test.ts`, `babyView.test.ts`, `levelScene.test.ts`, `feelSchema.test.ts`, `testApi.test.ts`. Express time in sim ms; `createTestLife(patch)` for the inputs.
- **Live, headless:** `tests/bots/expressionsLive.test.ts` (AC 5, 6, 9).
- **Architecture:** the scans of `characterAssets.test.ts`.
- **Goldens:** `npm run golden:update` once, deliberately (D12). Never twice to « make it green ».
- **E2E:** no new spec (CLAUDE.md › Where a test goes). `testApi`, `characters`, `lifeLayer` on Chromium (T6); `autoplay`, `afterEffects` only to check the references (T7). Always through `npm run e2e`, in the background, never `npx playwright test`. `ci:story` is the review's gate, not dev-story's.

### Project Structure Notes

- Three new modules in `src/client/render/views/` (the life layer's home), pure, no Three: `expressions.ts` (events and flags in, an expression out; takes no threat), `brows.ts` (the blend), `faceInputs.ts` (the world-reading flags: focus, guard, fatigue). Three only in the views, where they touch bones; `levelScene.ts` wires them as it wires the lids and the lowering.
- **Variance:** the epics' table names four expressions per character; between moments the face is at rest (`neutral`), which the GDD implies (« quatre expressions, déclenchées par des moments »).
- **Variance:** the epics' « seules les empreintes `feelHash` » is read as D12 (`worldHash` too), as 7.8 and 7.9 did.
- **Variance:** « Quand il rit » is read as the events whose cue layers his laugh (D4); « pendant une Fermeté » as the hold, from `ResponseHeld` (the hold ring closes) to its resolution and the pose after it (D3, D4).

### Project Context Rules

- **Layers:** `client` may import `@sim`, `@content`, `@shared`, `three`; `src/` never imports `tools/`; `tests/bots` may import the client's pure modules by relative path (as `highlightReplayLive.test.ts`).
- **Sim boundary:** the client only reads `world` and events; never a gameplay value from a bone or a mixer. No file in `views/` reads `windowOpenAt`, `feintAt`, `realWakePct` or `toleranceMs`.
- **Golden rule:** every number Geo may touch is `feel.json › characters.expressions`; constants in `shared/constants.ts`, `UPPER_SNAKE`, with a unit suffix.
- **Zero allocation** in the rAF path: no closures, arrays or literals per frame; the rest positions and an axis vector made once.
- **TypeScript:** `strict` + `erasableSyntaxOnly`: the expressions are string-literal unions from `as const` arrays, no `enum`.
- **No `console.*`:** `log.warn('render', …)`. Units as suffixes. `describe/it/expect` from `vitest`.
- **Git:** this worktree, branch `story/7-10-visages-sourcils-et-expressions`. Commit « Story 7.10 : visages, sourcils et expressions ». Merge only after the review, a green `ci:story` and Geo's visual OK.
- **Heavy checks:** `npm run e2e` and `ci:story` queue on `tools/ci/heavyLock.sh`: run them in the background. A 30 s timeout failing after minutes means the Mac slept (memory).

### Previous story intelligence

- **7.9 (squelette v2):** the brows exist, rest, and are pinned at rest by two view tests this story replaces. The review caught a fixture that hid frame and sign mistakes (every bone at the origin under `root`): put the brows under `head` at their real rest positions. `golden:update` ran twice because a throwaway proof sat in `tests/golden/`: keep D12's proof outside it. A screen shake moves `content_root` on real time: the brows are local to the head, so it does not concern them, but nothing here may read world positions. **Never claim a visual check you did not make:** list what you did not open.
- **7.8 (couche de vie):** `LifeInputs` filled once per frame; every life-layer number read from `world.feel.characters` each frame; the D2 procedure for the goldens; `--update-snapshots=all` (a plain `--update-snapshots` wrote nothing in 7.3); e2e that read a drawn value wait for its spring to settle.
- **3.7 (look):** `setPapaLook` is the overlay pattern (validated in `testApi.ts`, cleared by `resetFx`, merged in the scene).
- **2.13 / 1.19:** the lids are the micro-sleep's telegraph; `eyelidsAmountAt` reads `windowOpenAt` only for the level's micro-sleep def. Nothing here may change them.
- **Recent commits:** 7.9 (skeleton v2, retakes, forelock) and 7.4 (finale, film framings) merged; the light CI (`ci:fast` per task, `ci:story` once).

### Latest technical information

No new dependency: `three@0.186.1` and `zod@4.6.7` are pinned, so no web research applies. Read in `node_modules/three` rather than from memory: `Quaternion.setFromAxisAngle(axis, angle)` (a unit axis made once), `Vector3.set`, `Vector3.setScalar`. Zod 4: `z.strictObject`, `.describe`, `z.toJSONSchema` (through `npm run content:schemas`).

### Open for Geo

1. **Brows only (D1):** no expression lowers the baby's lids (they are the duel's signals) or widens Papa's eyes (they belong to `coffee_kick`). A sleepy baby with slightly lowered lids would read better but would look like the fake sleep's peek. Your call if you want it later.
2. **The poses and their size (D10):** starting values, two of each shape; `browScalePct` is the knob if the brows do not read at phone size. Judge on `7-10-screenshots/` and tune in the feel panel with `__PP__.setExpressions`.
3. **Papa's surprise on every telegraph (D4),** off-screen ones included (the off-screen bubble shows them too), but never on his own micro-sleep. Say if you want it on visible threats only.
4. **Tired reads the gameplay threshold (D7)** (`fatigue.thresholdPoints`, 70): the face and the window penalty move together. Say if you want them apart.
5. **Pride and delight on a perfect chore beat (D4),** as on a perfect response: the baby already laughs there.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.10, #Story 7.9, #Story 7.15, Epic 7]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Animation des personnages L542-609 (principles 4 and 5, « Les visages »), L358 and L408 (false alerts)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Animation des personnages (v2.4) L275-292, #Mouvement réduit L254, L266]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08.md (§ story 7.10, L210-255; the reduced-motion row L496)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#Reduced motion L450-470]
- [Source: _bmad-output/implementation-artifacts/7-9-squelette-v2-et-animations-reprises.md (D3, D7, D14, review findings), 7-8-couche-de-vie-et-personnages-detaches-du-decor.md (D2), deferred-work.md (7.9 sections)]
- [Source: _bmad-output/project-context.md#Rigged characters, #Special sequences, #The Wait response and the bedtime duel, #The bedtime cycle, #Testing Rules]
- [Source: src/client/render/views/{papaView,babyView,lifeLayer,characterSpring,characterClips,characterRig}.ts, src/client/render/levelScene.ts, src/client/feedback/responseChoreography.ts, src/client/endOfLevel/highlightReplay.ts L293, src/client/app/levelSession.ts L514-538, src/sim/baby/{babySystem,silence,babyFsm}.ts, src/sim/events.ts L215-470, src/sim/gauges/fatigue.ts L32, src/sim/sequences/{bedtimeDuel,stealthExit}.ts, content/feedback.json (cues with `baby_laugh_perfect`, `events`), content/feel.json L52-62 and L301-327, src/content/schemas/feel.ts L881-1041, tests/content/feelSchema.test.ts L29-30, tests/architecture/characterAssets.test.ts L751-824, tests/support/testCharacters.ts, tests/e2e/testApi.spec.ts L48-66, src/debug/testApi.test.ts L616, public/assets/characters/{papa,baby}.glb and assets-src/blender/characters/{papa,baby}.blend (brows probed headless, read only, on 2026-11-08)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), 2026-11-08.

### Debug Log References

- T0: `env | grep VITE_` empty. The `.glb` brows match « The faces in the files » exactly (`brow_l` (0.075, 0.262, 0.115), baby (0.062, 0.187, 0.1) under `head`, no rotation, no scale). Measure on the « before » captures: 84 physical px per metre at the brows on both levels at DPR 2, so Papa's bar is 5.9 × 2.5 px and the baby's 5.6 × 2.1 px.
- Captures: the first takes had Papa looking at the baby (his gaze) and the baby crawling between images; the final setup puts the baby behind Papa past `gaze.behindDeg`, in a long babble, for Papa's set, and carried toward the camera for the baby's set. The game's pixel ratio stepped down to 1.5 on long takes (headless GPU, `adaptivePixelRatio.ts`); shorter loops kept every pose image at 2.
- `npm run golden:update`, once: 72 files, 144 changed lines, 36 `feelHash` and 36 `worldHash` pairs, nothing else (one file's `eventTypes` was rewritten on several lines by the writer and put back by `biome format`, same content). D12's proof (a throwaway `tests/bots/zzD12Proof.test.ts`, deleted): main's `tests/support/testFeel.json` differs from the branch's only by `characters.expressions`, and the 36 scenarios played with each give the same hash of the final world without `feel` and the same events hash, 36/36.
- `tools/sim/runSim.ts`, the four bots on `salon_kitchen`, `salon_crawler` and `chambre_night`, seed 1, on the branch and on an export of `main` in the scratchpad: 12/12 reports equal once the hash keys (`hashes`, `runList[].worldHash`) are dropped.
- `humanBotRegression`: `PINNED` re-pinned (the feel hash in the journal header), `PINNED_COMMANDS` unchanged and green.

### Completion Notes List

- **Data (T1):** `feel.json › characters.expressions` (`reachMs`; `papa` and `baby` with `browScalePct`, their moment durations and four `poses` of `raiseOffsetM`, `tiltDeg`, `inwardOffsetM`, `skewOffsetM`), strict at every level, bounded and described; `content/_schemas/feel.schema.json` regenerated. D10's pose values as written; **`browScalePct` starts at 120 for both** (T0's measure was under 6 px), not retuned after the captures: Geo's call.
- **Pure modules (T2, T4):** `expressions.ts` (the two lists, the per-character `FaceTrack`, `notePapaEvent` / `noteBabyEvent` for D4 and D15, `papaExpressionAt` / `babyExpressionAt` for D3 and D5, `clearExpressions`, `dropMoment`; no Three, no threat), `brows.ts` (four critically damped springs of `characterSpring.ts`: `createBrowState`, `resetBrows`, `unplaceBrows`, `stepBrows`), `faceInputs.ts` (`babyFocusOf`, `isSignalOnly`, `isPapaTired`, reading only a threat's `id` and `state`).
- **Views (T3):** `browBonesOf` / `writeBrowBones` (in `papaView.ts`, reused by `babyView.ts`) write both brows absolutely from rests read once: `brow_l` turned by −tilt and `brow_r` by +tilt about Z; scale `browScalePct`. Papa's brows are written after the gaze and before the forelock block (its early returns); the baby's after his breath. The first frame after creation or `resetAnimation` snaps; `resetAnimation` puts them at rest at once (at the last drawn size). `browTiltDeg` getters. `LifeInputs` gains `papaExpression` / `babyExpression`.
- **Scene (T4):** one track per character; `playCharacterEvent` notes each event after the one-shots and the baby's lids, before the reduced-motion return (the faces stay under reduced motion), and drops the moments while `isSignalOnly`; `update` reads the faces (the guard every frame, `isPapaTired`, `babyFocusOf`, `SceneBodies.hasBedtimeCycle`) and lays the overlay over them before `animate`; `resetFx` clears the tracks and the overlay; `realFxState()` gains the four fields; `setExpressionOverlay`. `levelSession.ts` fills `hasBedtimeCycle` from `levelPlan.level.cycle !== undefined`.
- **Debug (T4):** `TestHost.setExpressions` and the four fx fields; `__PP__.setExpressions({ papa, baby })` checks each name against the character's list, `'neutral'` or `null`; both method lists (`testApi.test.ts`, `testApi.spec.ts`) gain it.
- **Tests:** `expressions.test.ts` (every row and exclusion of D4, the most-recent rule both ways, a lasting state back and covering, the held frown, the gag, the guard, determinism, and the laugh coupling on `content/feedback.json`), `brows.test.ts`, `faceInputs.test.ts`, the brow tests of `papaView.test.ts` / `babyView.test.ts` (they **replace** 7.9's « never writes a brow »: rest at neutral, rest + pose, the signs of D2 pinned on world points of each bar's two ends brought into the head's axes, no lid or `eyes` moved, reduced motion, reset, 1/3/7 frames), five scene tests, two debug tests, the bounds in `feelSchema.test.ts`. The fixtures now hang `brow_l` / `brow_r` under `head` at the files' rests. **`tests/bots/expressionsLive.test.ts`**: `salon_kitchen`, `salon_crawler`, `chambre_night` × `human`, `perfect` × seeds 1-3 (18 whole games, about 3 s): no violation of the focus, the guard or the bedtime on any step; the guard held on thousands of bedroom steps; all eight expressions show; the same seed twice gives the same faces. The scans of `characterAssets.test.ts` cover the three modules, plus « expressions.ts takes no threat ».
- **Where a test goes:** every rule is in Vitest; no e2e spec was added. The e2e run (Chromium, through `npm run e2e`): `testApi`, `characters`, `lifeLayer`, `autoplay`, `afterEffects`, 33 passed; the macOS references of `autoplay` and `afterEffects` did not fail, so none was regenerated.
- **Not rerun:** `perf.spec.ts` (no asset, no mesh, no draw call; `npm run ci` covers it before the next playtest link). `ci:story` is the review's gate.
- **Order:** `npm run golden:update` ran once, after the captures (T7), so that a retune of the starting values would not need a second run; no retune was made.
- **Not covered:** `SceneBodies.hasBedtimeCycle` has no session test with a real cycle level (`levelSession.test.ts` pins `false`); the live test reads `level.cycle` as the session does (noted in `deferred-work.md`).
- **AC 7:** `EXPERIENCE.md`'s reduced-motion row (« the expressions … stay ») still matches.
- **Captures (T7):** `7-10-screenshots/` with `notes.txt` (each image, its expression, sim time, tilt and pixel ratio, what was opened and what was not). The two natural moments are true to `fx()` but show the faces turned away from the camera at that instant; the pose sets show the faces. **The look is Geo's call; the merge waits for his visual OK.**

### File List

New:
- `src/client/render/views/expressions.ts`, `src/client/render/views/expressions.test.ts`
- `src/client/render/views/brows.ts`, `src/client/render/views/brows.test.ts`
- `src/client/render/views/faceInputs.ts`, `src/client/render/views/faceInputs.test.ts`
- `tests/bots/expressionsLive.test.ts`
- `_bmad-output/implementation-artifacts/7-10-screenshots/` (49 files: 24 frames, 24 crops, `notes.txt`)

Modified:
- `content/feel.json`, `content/_schemas/feel.schema.json`, `src/content/schemas/feel.ts`
- `src/client/render/views/lifeLayer.ts`, `papaView.ts`, `babyView.ts`, `characterClips.ts` (comments), `papaView.test.ts`, `babyView.test.ts`
- `src/client/render/levelScene.ts`, `src/client/render/levelScene.test.ts`
- `src/client/app/levelSession.ts`, `src/client/app/levelSession.test.ts`, `src/client/app/testHost.ts`, `src/client/boot.ts`
- `src/debug/testApi.ts`, `src/debug/testApi.test.ts`
- `tests/support/testFeel.json`, `tests/support/testCharacters.ts`, `tests/support/fakeTestHost.ts`, `tests/tools/vite/fixtures/feelSample.json`
- `tests/content/feelSchema.test.ts`, `tests/architecture/characterAssets.test.ts`, `tests/bots/humanBotRegression.test.ts`
- `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`
- `tests/golden/journals/*` (72 files, `feelHash` and `worldHash` only)
- `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file

### Change Log

- 2026-11-08: Story 7.10 implemented: the faces (four expressions each, on the brows), `feel.json › characters.expressions`, `__PP__.setExpressions`, the live headless proof, the goldens re-hashed once (feel and world hashes only), captures for Geo. Status → review.
