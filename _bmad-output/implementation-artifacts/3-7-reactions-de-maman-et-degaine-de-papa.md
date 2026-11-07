---
baseline_commit: af716cba5bc7d323b22b03fadf03cd8e30b604d5
---

# Story 3.7: Réactions de Maman et dégaine de papa

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see Mama laugh, sigh or scream, and Papa look more and more of a mess,
so that the note tells the story of my game.

Requirements: FR35 `[V1]` (the end sequence: photo → **Mama's reactions** → note), FR37 `[V1]` (Papa's look degrades during the level and feeds the Laugh), UX-DR13. It builds on 7.2 (Papa's look parts, ready and undriven), 3.5 (the door, the rush), 3.6 (the photo and the `photo` phase of the Result screen), 3.12 (Mama's note on five rows: Rires /35, Calme, Maison, « Sans soupir », « Sans hurlement »), 3.15 (`applyAfterEffect` in `gagThreat`) and 3.16 (the `mamaHome` end, which owes its scream to this story: `deferred-work.md` L1044). Story 3.8 (Mama's memory and `mama-lines.json`) replaces this story's fixed lines; 3.9 (replay) and 3.11 (buttons) come after the stars, as today.

**Scope in one line:** the sim gets `World.papa.look` and `ThreatDef.lookChange` (a gag degrades the look, and each part shown at the end adds Laugh points), the client draws the look from the world, and the Result screen plays Mama's reactions (Laugh, Sigh, Scream) in a `mum-bubble`, each with a provisional animation, a sound and its value, between the photo and the score rows.

## Acceptance Criteria

### Papa's look in the sim

1. **The look is world state.** `PapaSlice` gains `look: PapaLook` with `hasMashOnCheek`, `hasHairOnEnd`, `isShirtInsideOut` (all `false` in `createWorld`). The type `PapaLook` moves from `client/render/views/papaView.ts` to `src/sim/world.ts` and is exported from `@sim`; `papaView.ts`, `testHost.ts`, `levelScene.ts` and `debug/testApi.ts` import it from there (no second definition). `SimSnapshot.version` goes from **33 to 34** (both `version: 33` sites and the `restore` invariant), the snapshot refuses a `papa.look` that is not an object of exactly these three booleans (`papaProblem`, same words style: `world.papa.look`), and the version comment starts with « 34 since story 3.7: `papa.look` and the `PapaLookChanged` event ». If another story bumps the version before this one merges, take the next number and say so.
2. **A def says which part its gag degrades.** `ThreatDefSchema`'s shared shape (`baseShape`, after `gagNoisePct`, the last key today) gains an optional `lookChange`, one of `PAPA_LOOK_PARTS = ['mashOnCheek', 'hairOnEnd', 'shirtInsideOut'] as const` (declared in `src/content/schemas/threat.ts`, like `THREAT_COLORS`), with a `.describe()` that says it is applied when a miss ends in the gag, once per part per level. Absent: the gag does not change the look. `npm run content:schemas` regenerates `content/_schemas/threat.schema.json`.
3. **The live content (D2).** `content/threats/outlet.json` → `"lookChange": "hairOnEnd"`, `coffee_table_object.json` → `"mashOnCheek"`, `papa_microsleep.json` → `"shirtInsideOut"`. No other def gets one (not even `pot_on_stove`'s boiled-over purée: open point 2). These are data: Geo rewires them. All three live levels (`chambre_night`, `salon_crawler`, `salon_kitchen`) place `outlet` and `coffee_table_object` and name `papa_microsleep` as `microSleepDef`, so the three parts can show in each.
4. **Applying it.** In `gagThreat` (`sim/threats/threatFsm.ts`), after `applyGag` and `applyAfterEffect`, beside the `gagCryMs` and `gagNoisePct` lines, a def with `lookChange` calls `changePapaLook(world, ctx, part, threat.id)` (new `src/sim/papa/look.ts`). If that part is already shown, it does nothing (no event). Otherwise it sets the part's boolean and emits `PapaLookChanged{t, part, threatId}` (new event, in `SIM_EVENT_TYPES` in sorted place, past tense). No `world.rng` draw, no state, no sound in the sim. It applies whatever the flow state a gag can occur in (`playing`, `sequence`, `finalRush`), and on hidden-zone defs too (the def, not the gag id, says it, as `gagCryMs` does).
5. **It feeds the Laugh (D3).** `feel.mama` gains `laughPerLookPartPoints` (number ≥ 0, `points(...)` helper; **5** in `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`). `ScoreTally` gains `lookParts` (how many of the three are shown when the level ends), `scoreLevel` counts them from `world.papa.look`, and `computeMamaScore`'s Laugh becomes `perfects × laughPerPerfectPoints + successes × laughPerSuccessPoints + comboPoints + lookParts × laughPerLookPartPoints`, still held to `laughMaxPoints` (35) and rounded by `row(...)`. A unit test scores the same tally with 0 and 3 parts and pins the difference through the feel's values, not a literal, and another pins the cap. `MamaScore` doc comment for `laughPoints` names the look.
6. **Report.** `simReport` gains `lookParts` per run (the parts shown at the end, from `PapaLookChanged`) and in the totals (`lookParts` sum and the per-run mean, following `frozenNearMisses`); `simArgs` help says so; the whole-report tests get their new zero.

### Papa's look on screen

7. **The view follows the world.** `levelScene.update(world, …)` calls `papa.setLook(...)` from `world.papa.look` every frame (allocation-free: one reusable scratch object). The debug `__PP__.setPapaLook(look)` keeps working: it sets a **debug overlay**, and the view shows a part when the world **or** the overlay says so (so `tests/e2e/characters.spec.ts` stays green unedited). The overlay is cleared when a level starts. One shared `createPapaView` (`levelScene.ts:441`) serves all three levels, so this is one change. `tests/architecture/characterAssets.test.ts` pins today's state in its describe « nothing in a game sets the look until story 3.7 » (L374-381): exactly one `papa.setLook(` in `levelScene.ts` (L377), the body `setPapaLook(look) { papa.setLook(look); }` (L378), exactly two `setPapaLook` in `boot.ts` (L380) and the test host's `setPapaLook: (look) => currentLevel?.setPapaLook(look)` (L381). Rewrite that describe deliberately to pin the new contract (one `papa.setLook(` in `levelScene.ts`, fed by the world OR the overlay; boot unchanged) and say so in the notes.
8. **Visible in the photo.** The end photo draws `snapshot.world` through `level.update`, so the look is in the picture with no extra code; an e2e checks `state().papa.look` and `fx().papaLook` (new field of `FxState`, `src/client/app/testHost.ts:26-63`, filled by `realFxState()`, `levelScene.ts:586`, and copied in `boot.ts` L2374-2396: the look the view draws) after a real gag in a live game. On `salon_kitchen` the photo frames the whole big room (`deferred-work.md` L1019), so Papa is small in it: check the look on `salon_crawler`'s photo and say what shows on the big room's.
9. **The outlet's hair.** The outlet gag already draws the hair up for a while (`gagHairAmount`, 7.2 D2), and 3.15 holds it at 1 while Papa is `electrified` (`levelScene.ts` L500-503, L653-656, reset in `resetFx` L674-675). `papaView.applyHair` (L236-241) draws `max(gag, look)` on the one `papa_hair` mesh, so with `hairOnEnd` in the world the hair stays up after the electrified time ends, with no change to that code. Check it on a capture: during the gag, during `electrified`, and after.

### Mama's reactions on the Result screen

10. **Which reactions, in which order (sim, pure).** New `src/sim/scoring/mamaReactions.ts`, exported from `@sim`: `mamaReactionsOf(score: Readonly<MamaScore>, reason: LevelEndReason): readonly MamaReaction[]`, `MamaReaction = { reaction: MamaReactionId; points: number }`, `MAMA_REACTIONS = ['laugh', 'sigh', 'scream'] as const` in `src/shared/constants.ts` (3.8's `MamaLinesSchema` will read it from there; `MamaReactionId` its type; content may import `shared`). Rules (D4): always in the order Laugh, Sigh, Scream; `laugh` when `laughPoints > 0`, `sigh` when `sighPoints > 0`, `scream` when `screamPoints > 0` **or** the level ended early (`reason === 'mamaWoke'` or `reason === 'mamaHome'`: GDD L103 and L114, « Maman réagit (hurlement) »); with none of them, `[{ reaction: 'laugh', points: laughPoints }]` (Mama always reacts: GDD « le perdant voit toujours sa photo et la réaction de Maman »). `points` is that component's points as in `MamaScore` (the Calme and Maison rows have no reaction). No `world.rng`, no event: it reads the note. Unit tests cover each rule, the empty case and the four ends (`timer`, `cycleDone`, `mamaWoke`, `mamaHome`; iterate `LEVEL_END_REASONS` so a fifth reason fails the test).
11. **The new phase.** `ResultPhase` becomes `'photo' | 'mama' | 'rows' | 'stars' | 'actions'`. `createResultScreen` takes `reactions: readonly MamaReaction[]` (computed in `boot.ts` from `resultScore` and `resultEndReason` with `mamaReactionsOf`) and `onMamaReaction(reaction: MamaReactionId)`. After the photo's hold (or at build, with no photo), the screen enters `mama`: each reaction in turn shows its line in the `mum-bubble`, its value chip, Mama's expression and animation, fires `onMamaReaction` once, and holds for `feedback.json › resultScreen.reactionHoldMs`; after the last one, `startRows` runs as today (the woken or home-early header and `onMamaWoke` / `onMamaHome` still come with the rows, in `startRows`: nothing sits between the photo and her reaction). `reactionHoldMs: 0` goes straight on in the same call (as 3.6's `photoHoldMs: 0`).
12. **The `mum-bubble` (DESIGN.md › `mum-bubble`, `key-result.html` `.bubble`).** `paper` fill, 3 px `ink` outline, `{rounded.lg}`, the sticker lift, a tail pointing at Mama, text in `{typography.body}` `ink`, never under 16 px, wrapping, never truncated. Its accent (border-left bar or tail, the dev's call, as long as it is not the only signal) takes the active reaction's token: `mama-laugh`, `mama-sigh`, `mama-scream` (classes `pp-mum-bubble--laugh|sigh|scream`). It is the caption of her voice: `role="status"`, `aria-live="polite"`, and it always shows, muted or not. **Never put body text on `mama-sigh`** (DESIGN contrast table: 4.1:1, large text only): the text stays `ink` on `paper`.
13. **The value.** Beside the bubble, a chip shows the reaction's points: `+N` for the Laugh, `−N` (U+2212, as `result.star_lost`) for the Sigh and the Scream, on the reaction's accent, `ink` text, `{typography.label}` or bigger, like the lost star's `« −1 »` chip. A reaction worth 0 (the fallback Laugh, the Scream of a `mamaWoke` or `mamaHome` end with no near miss) shows no chip. The rows below keep their own framing (« Sans soupir » and « Sans hurlement » show `max − points`): the chip is what Mama takes off, the row what is left.
14. **The provisional Mama (D5).** A small 2D Mama, built in code with `svgElement` (head, hair, body; the mockup's `#mama-sigh` / `#mama-woke` symbols are the model), drawn in tokens only (no hex in `ui.css`: `designTokens.test.ts`; if a skin or dress colour is missing, add the token to `DESIGN.md` and `tokens.css` together), `aria-hidden`. One expression per reaction (laugh: open smile, eyes shut; sigh: flat eyes and mouth, drooping; scream: round mouth, hair up, the three marks of `#mama-woke`) and one CSS animation each, on `transform` / `opacity` only (laugh: a bounce; sigh: a slow slump; scream: a short shake, oscillating at **3 Hz or less**). Under reduced motion (`:where(:root[data-pp-motion="reduced"])`) there is no animation, only the expression. No `.glb`, no 3D view, nothing in the captured canvas: Mama's model belongs to E7 (update `deferred-work.md` L925).
15. **Where she stands.** With a photo, Mama and her bubble sit on the polaroid's top-right corner, in front of it (the mockup's place: Mama at the door of the photo, the bubble above), inside the left column; the canvas is not touched. With no photo, the same block takes the left column alone, so both cases use the two-column layout and **fit 750 × 340 with no scroll**, whatever the header and the playtest-only journal button, at +30 % text (the 1.22 / 3.3 / 3.6 constraint). Once the reactions are over, Mama and the bubble stay, at rest, showing the last reaction.
16. **Sound, visual, haptic.** Three client events in `FEEDBACK_CLIENT_EVENTS` and `feedback.json › events`: `ResultMamaLaughed` → cue `mama_laugh`, `ResultMamaSighed` → `mama_sigh`, `ResultMamaScreamed` → `mama_scream`. They come after the existing `ResultMamaWokeShown` / `ResultMamaHomeShown` rows (`feedback.json` L772-777; their cues `mama_woke` L187 and `mama_home` L192 are the door slam, unchanged). Each has an audio layer on the **`voice`** bus (new clips `mama_laugh`, `mama_sigh`, `mama_scream`: placeholder synths in `tools/audio/makePlaceholderAudio.ts`, `npm run assets:audio -- --only <clip>`), `visual: { kind: 'uiElement' }` (the bubble is the twin) and a haptic (`light`, `light`, `medium`: `[ASSUMPTION]`). `CLIP_PATTERN` in `src/content/schemas/feedback.ts` (L19: `tel|resp|gag|baby|papa|env|ui|music`) gains the `mama` category (the `voice` bus is already described as « the baby, Mama », L39-46), and `project-context.md › Audio` lists it. `feedbackTwins.test.ts` and `content:check` pass.
17. **Skip and rebuild.** A press during `mama`, past `inputGraceMs`, does what a skip does today (`complete()`: panel shown, rows at totals, stars silent, the header at rest with no `onMamaWoke` / `onMamaHome`, buttons up) and leaves Mama and the bubble at rest on the **last** reaction of the list, with no animation and no cue. A screen rebuilt with `isDone` shows the same, silently. A press during `photo` skips the reactions too (they never play after a skip). `onMamaReaction` is never called on a rebuild or after a skip.
18. **Mirrors.** `data-pp-result` shows `mama`. No new mirror (the bubble's class and text are the e2e's handle).
19. **Lines (D6).** Fixed lines in `content/strings.fr.json`: `result.mama_line_laugh`, `result.mama_line_sigh`, `result.mama_line_scream`, `result.mama_line_scream_woke` (the Scream of a `mamaWoke` end) and `result.mama_line_scream_home` (the Scream of a `mamaHome` end). Exasperated-loving, never shaming the parent, never naming failure (EXPERIENCE › Voice and Tone; no « perdu », « échec », « game over »: NFR9). Proposed: « Ha ha ! Vous deux, alors… », « Bon… qui range ? », « Pas si près de l'escalier ! », « Qui fait tout ce bruit ?! », « Mais qu'est-ce qui s'est passé ici ?! ». They must not repeat the headers « Maman s'est réveillée ! » / « Maman est rentrée plus tôt ! », which come after them with the rows. They are placeholders until 3.8 picks lines from `mama-lines.json`; say so in a comment-free way (the story and `deferred-work.md`), not in the JSON.

### Docs

20. **Docs.** `project-context.md` gets « Papa's look and Mama's reactions (story 3.7, snapshot version 34) » (the field, `lookChange`, `PapaLookChanged`, the Laugh weight, the view's debug overlay, `mamaReactionsOf` and its rules, the `mama` phase, the cues and the `mama` clip category) and « Mama's note » names the look in the Laugh. GDD › Note de Maman: the look's Laugh rule (one part, once, `laughPerLookPartPoints`) and the reaction rule (D4). `EXPERIENCE.md`: Result sequence step 2 says which reactions play, their hold, the skip, and the no-photo case; L127 and L378 already say the look is the in-play hint (keep). `decision-log.md`: D3, D4, D5. `deferred-work.md` L925-926: the look is wired (close 926), Mama's model goes to E7; L1044 (Mama's scream on `mamaHome`): close it. GDD L114 and EXPERIENCE L340 already say « Maman réagit (hurlement) » for `mamaHome`: keep, and add the `mamaHome` line to EXPERIENCE's Result step 2.

## Tasks / Subtasks

- [x] Task 1: The look in the sim (AC: 1, 2, 3, 4, 5)
  - [x] `PapaLook` in `world.ts`, exported from `@sim`; `createWorld`; client imports moved
  - [x] `PAPA_LOOK_PARTS` and `lookChange` in `threat.ts`; the three live defs; `npm run content:schemas`
  - [x] `sim/papa/look.ts` (`changePapaLook`), the call in `gagThreat`, `PapaLookChanged` in `events.ts` and `SIM_EVENT_TYPES`
  - [x] Snapshot version 34 and `papaProblem`; round-trip tests of a world with a look
  - [x] `laughPerLookPartPoints` in `FeelSchema` and the three feel files; `ScoreTally.lookParts`; `computeMamaScore`
  - [x] Unit tests: a gag with and without `lookChange`, the same part twice (one event), a hidden-zone def, a gag in `finalRush`, the Laugh difference and its cap
- [x] Task 2: Reactions, pure (AC: 10)
  - [x] `MAMA_REACTIONS` in `shared/constants.ts`; `sim/scoring/mamaReactions.ts` and test; export from `src/sim/index.ts`
- [x] Task 3: The look on screen (AC: 7, 8, 9)
  - [x] `levelScene.update` and the debug overlay; `fx().papaLook`; `characterAssets.test.ts` regex; `levelScene.test.ts`
- [x] Task 4: Cues and clips (AC: 16)
  - [x] `mama` in `CLIP_PATTERN`; three synths, `npm run assets:audio -- --only mama_laugh` (and the two others); a clip test beside `tests/tools/audio/cameraShutterClip.test.ts`
  - [x] The three client events, cues and event rows; `tests/support/testContent.ts` and the tests that build a full table
- [x] Task 5: The Result screen (AC: 11, 12, 13, 14, 15, 17, 18, 19)
  - [x] `reactionHoldMs` in `ResultScreenSchema` and `feedback.json › resultScreen` (start at **1 200**)
  - [x] `reactions`, `onMamaReaction`, the `mama` phase, Mama's block (face + bubble + chip), `complete()` and `isDone` at rest on the last reaction
  - [x] Wire `boot.ts`: `mamaReactionsOf(resultScore ?? NO_SCORE, resultEndReason)`, `onMamaReaction` → `director.handle('ResultMama…', null)`
  - [x] `ui.css`: bubble, chip, Mama, three keyframes and their reduced-motion rule; the no-photo left column
  - [x] Strings in `strings.fr.json`
  - [x] `resultScreen.test.ts`: both paths (photo, no photo), the order and count of `onMamaReaction`, `reactionHoldMs: 0`, skip in `photo` and in `mama`, rebuild, the chip's sign and its absence at 0, the woke line. Existing tests pass `reactions` and keep their assertions
- [x] Task 6: Report, goldens, e2e (AC: 6, 8 and all)
  - [x] `simReport.ts`, `simArgs.ts`, the whole-report pins
  - [x] The `papa_look` golden scenario (see Traps); `npm run golden:update`, deliberately; read the diff and say what moved
  - [x] New `tests/e2e/mamaReactions.spec.ts`; adapt the specs listed in Traps
  - [x] `npm run sim` with the four bots on `salon_crawler` and `salon_kitchen` (and `chambre_night` for `perfect` and `random`), before and after: `meanStars`, `lookParts`, the Laugh mean and `endsByReason.mamaHome` (the look must not change how often Mama comes home: it adds no catastrophe), in the Completion Notes
- [x] Task 7: Docs (AC: 20)
  - [x] `npm run ci:fast` after each task, plus the touched specs on Chromium

## Dev Notes

### Decisions

- **D1. The look is sim state, the reactions are not.** The look changes during play, is in the photo, feeds the score and must replay identically: it lives in `World` and journals through its event. The reactions are a pure reading of the final note and the end reason, done once the level is over: a function of `@sim`, not world state and not an event, so the snapshot and the goldens carry nothing more for them. **3.8 will need the PRNG to pick a line**; it can then call a sim-side selection at the end step and emit an event with the chosen line ids. That is 3.8's design call, and this story must not pre-empt it with an event nobody reads.
- **D2. Which gag degrades which part.** The GDD names the three parts but not their causes. The outlet's gag *is* « cheveux en pétard » (GDD catalogue), the coffee-table object is the game's spoon of purée (GDD signature: « rattraper… une cuillère de purée »), and the micro-sleep leaves Papa crumpled, shirt inside out. Both levels have the three (`chambre_night`'s waves hold `outlet` and `coffee_table_object`, and both levels name `papa_microsleep` as `microSleepDef`), so the look shows in each. Stairs and silence change nothing: their cost is Mama's scream and sigh. All of it is `lookChange` data in the defs.
- **D3. One part, once, one weight.** A part is shown or not; a second outlet gag adds nothing (no event, no points). The points come from the parts shown **at the end** (`lookParts × laughPerLookPartPoints`), so the event is for the presentation, the report and 3.8/3.9, not a score counter. Start at 5 (three parts = 15 of the Laugh's 35 since v2.3; one perfect is worth 1, one success 0.5): a messy Papa is funny, but each part costs a gag (Soupir or Hurlement, catastrophe, combo lost), so it is not a strategy. Measure the bots before and after (Task 6) and report it; Geo tunes it.
- **D4. Mama reacts to what happened.** A perfect game does not make her sigh at nothing: a reaction plays only when its component has points, in the fixed order. A Mama woken by the noise (`mamaWoke`) or home early (`mamaHome`, story 3.16) always screams (GDD L103, L114: early end → « hurlement »), even with no near miss, each with her own line. A `cycleDone` end (the bedtime cycle, 4.10) follows the general rule like `timer`. With nothing at all (no perfect, no look, no mess, no near miss) she still reacts: the Laugh, at 0, with no value chip.
- **D5. A provisional 2D Mama, in the DOM.** 7.2 (D1) gave Mama no model and `deferred-work.md` expected one « with 3.5 / 3.7 ». The reactions play on the Result screen, over a photo that is a frozen 2D canvas: a 3D Mama would need a second live render on the Result screen or a re-capture per reaction, plus a rigged `.glb` (payload, pipeline, contract), for an animation the AC calls provisional. A small SVG figure on the polaroid, as the mockup draws her, does the job, costs no draw call and no byte of `.glb`, and is replaced when E7 models her. **Geo confirmed it on 2026-11-03** (open point 1).
- **D6. Fixed lines now, content-driven lines in 3.8.** `mama-lines.json`, `MamaLinesSchema` and the « most specific line wins » rule are 3.8's AC. This story's four lines are plain strings, picked by the client from the reaction (and the woke case). Do not create `mama-lines.json` here.
- **D7. Mama's voice is on the `voice` bus,** with the baby's; her reactions are a character speaking, not UI. The Result's stars stay on `ui`.

### Current state of the files this story changes

Line numbers checked on 2026-11-07, after merging `main` (stories 3.12 to 3.16 and 9.1 to 9.7) into the branch.

- **`src/sim/world.ts`.** `PapaSlice` (L17) has no look (the `look…` at L106 is the baby's gaze, unrelated); `createWorld` (L757) builds `papa` at L771. `MamaScore` (L321) documents `laughPoints` as « the perfects, the successes and the combo points cashed in »: add the look. `ScoreSlice` needs no change (the look is not a counter).
- **`src/sim/threats/threatFsm.ts`.** `gagThreat` (L283-321): `ResponseResolved{fail}`, `GagTriggered`, `applyGag`, `applyAfterEffect` (3.15), `gagCryMs` → `startBabyCry`, `gagNoisePct` → `addNoise` (9.5), `resetCombo`, `recordMiss`, `failSequenceOnGag`. Put the look call after the `gagNoisePct` line, with the same « the def, not the gag id » comment. `gagOf` draws `world.rng` for hidden-zone defs only: do not add a draw.
- **`src/sim/threats/gags.ts`** and **`afterEffects.ts`.** Untouched: the look is per def, not per gag (two defs may share a gag), and it is not an after-effect (it blocks nothing, never expires, costs no catastrophe). `gags.ts`'s header comment lists what the client and the score read: add the look's line.
- **`src/content/schemas/threat.ts`.** `baseShape` (L172) ends with `gagCryMs` (L298) and `gagNoisePct` (L305-312); add `lookChange` after it. `THREAT_COLORS` (L68) shows the pattern for `PAPA_LOOK_PARTS`.
- **`src/content/schemas/feel.ts`.** `MamaSchema` (L525), `points(...)` for weights (`laughPerSuccessPoints`, L556, is the nearest model). The refines do not need to change.
- **`src/sim/scoring/mamaScore.ts`.** `ScoreTally` (L10), `computeMamaScore` (L49, the Laugh line L54-59), `scoreLevel` (L102: reads `world.score`, `world.mess` and the chores; add `world.papa.look`).
- **`src/sim/snapshot.ts`.** `version: 33` (L47, L66), the `restore` invariant (L1601) and the long history comment (L39, newest first); `papaProblem` (L76) checks each key of the slice: add `look`.
- **`src/client/render/views/papaView.ts`.** `PapaLook` (L45-50, to move; its doc « story 3.7 will drive them » goes stale), `setHair` (L343-346) and `setLook` (L347-353): mash, shirt / inside-out shirt, `lookHairAmount`; `gagHairAmount` / `lookHairAmount` (L234-235) and `applyHair` (L236-241, the `max`). Nodes `papa_hair`, `papa_look_mash`, `papa_shirt`, `papa_look_shirt` (L170-173). Leave the view as it is apart from the import.
- **`src/client/render/levelScene.ts`.** The interface's `setPapaLook` (L180-181, doc « Nothing in a game sets it until story 3.7 ») and `update(world, alpha, nowReal)` (L149); their bodies at L605-607 and L608. The electrified hair hold (L500-503, L653-656) and `resetFx` (L674-675) stay as they are. `realFxState` (interface L151-179, body L586). The new body ORs the debug overlay and `world.papa.look` into one scratch look each frame; `resetFx` (or the level start) clears the overlay.
- **`src/client/ui/screens/resultScreen.ts` (621 lines).** Read it whole before editing. `ResultPhase` (L14, its comment L10-13), `ResultScreenOptions` (L58-98: `onPhoto` L77, `onMamaWoke` L81, `onMamaHome` L83, `onPhase` L87), the five rows (L165-196), the header comment (L150-162; L161 says « Mama's lines (3.7) and the 3.11 buttons come later »: update it), the polaroid (L227-238, appended at L408), `isMamaWoke` / `isMamaHome` (L240-241), the header and `mountHeader` (L245-265), `complete()` (L477-487), `startRows` (L566-576), the `isDone` branch (L578-584), the photo branch (L585-595) and the no-photo `else` (L596-597). The `mama` phase goes between the photo branch's hold and `startRows`, and in front of the no-photo `startRows()`. No `mum-bubble` exists yet anywhere.
- **`src/client/boot.ts`.** `NO_SCORE` (L174-183), `resultScore` (L1118, set at `LevelScored` L1780-1782), `resultEndReason` (L1120, set from `LevelEnded` L1777, both reset at L2280-2281). The `result` builder (L2028) calls `createResultScreen` (L2034-2073) with `director.handle(...)` callbacks: `PhotoTaken` (L2044), the stars (L2051-2052), `ResultMamaWokeShown` (L2054), `ResultMamaHomeShown` (L2056), `ResultStarLost` (L2057), `onPhase` (L2058, `ppResult`). The test host's `setPapaLook` is L2398 and the fx copy L2374-2396.
- **`src/client/feedback/feedbackEvents.ts`.** `FEEDBACK_CLIENT_EVENTS` (L7-25, 13 events, the last `ResultMamaHomeShown`, `ResultStarLost`).
- **`content/feedback.json`.** `resultScreen` (L72-80: `photoHoldMs` 1200 is the last key; add `reactionHoldMs` after it), cues from L170 (`mama_woke` L187, `mama_home` L192, `photo_taken` L202), events from L741 (the Result rows L772-777). `voice` bus at 80 %.
- **`src/content/schemas/feedback.ts`.** `AUDIO_BUSES` (L15), `CLIP_PATTERN` (L19), `BusesSchema` (L39-46).
- **`tools/audio/makePlaceholderAudio.ts`.** `PLACEHOLDER_CLIPS` (L2602; the model is `{ clip: 'ui_camera_shutter', synth: synthCameraShutter }`, L2680, synth at L2078 with `createRng(SEED + 49)`: take the next free seed offsets), `--only` (`parseOnly`, L2757). The clip test model is `tests/tools/audio/cameraShutterClip.test.ts`.
- **`src/debug/testApi.ts`** and **`src/client/app/testHost.ts`.** `setPapaLook` validates three booleans (`testApi.ts` L295-311): keep it, now an overlay. The doc comments (`testApi.ts` L102-103, `testHost.ts` L136-137, « nothing in a game sets it until story 3.7 ») go stale: update them. `FxState` (`testHost.ts` L26-63) gains `papaLook`.
- **`src/client/ui/styles/tokens.css`.** `--pp-color-mama-laugh|sigh|scream|calm|home` (L34-38) exist; there is no skin or dress token. `svgElement` is `src/client/ui/svg.ts:7`.
- **`tools/sim/simReport.ts`.** Follow `frozenNearMisses` through its five places: `RunSummary` (L223), `createRunRecorder` (L401, incremented from the event at L517-518, emitted L662), `SimReport` (L860), `summarizeRuns` (L997, L1124) and the output (L1280).

### What must keep working

- A level whose gags have no `lookChange` (stairs, silence, the bedroom's arms and sequence gags) emits the same events as today.
- `data-pp-flow`, the 3.6 photo path and its fallback, the woken and home-early headers after the photo (now after the reactions), the input grace, the 3.3 journal buttons.
- `characters.spec.ts` (the debug look), `photo.spec.ts`, `result.spec.ts`, `mamaWoke.spec.ts`, `catastrophe.spec.ts`, `chambreNight.spec.ts`, `salonKitchen.spec.ts`.
- The 3.16 `mamaHome` Result: 0 dashed stars, no chip, its header and door-slam cue with the rows, « Rejouer » first.
- `autoplay.spec.ts`'s frozen screenshot is taken in play, early: the look should not show in it. If it moves, find out which gag did it and say so; regenerate only if the change is this story's on purpose, and look at the images.
- Perf: one boolean copy per frame in `update`, nothing allocated; the Result screen is outside play.

### Traps

- **The phase list moved.** Every spec or unit test that pins the phases in order now sees `mama` between `photo` and `rows`: `photo.spec.ts` L192 (`['photo','rows','stars','actions']`), L300 (a skip in `photo`: `['photo','actions']`, unchanged since a skip covers the reactions), L363 (`slice(0, 2)` of a woken end: now `['photo','mama']`), L366 (`mama_woke` after `photo_taken`: still true, `mama_scream` sits between), L502-505 (no photo: now `['mama','rows','stars','actions']`). Specs that wait for `rows` or `actions` now wait up to `photoHoldMs + n × reactionHoldMs` longer (up to 3.6 s more): check them against the `expect` timeout of `playwright.config.ts` and wait for the phase you need; do not lengthen timeouts, and do not set `reactionHoldMs` to 0 in the live feedback to save time. The two specs that race `photoHoldMs` (3.6 Review › Defer) skip during `photo`: still fine, the skip now also covers `mama`.
- **Cue counts and vibration lists are pinned exactly.** `mamaWoke.spec.ts` L152 (before + shutter + slam + stars + lost) and L162-168 (`[shutter, slam, light × (stars − 1), heavy, lost]`): a woken Mama now plays one cue per reaction, at least `mama_scream`, between the shutter and the slam. `catastrophe.spec.ts` L264 (before + 2) and L266-269 (`[PhotoTaken, ResultMamaHomeShown]`): same, the Scream sits between. `result.spec.ts` L183 (before + stars) and L201 (`[light…, heavy]`) count from the opening of the Result screen: its game now also plays its reactions first. Compute each expected list from `mamaReactionsOf` of the mirrored note (or from `cueLog()` filtered on the `mama_` cues) and the content's haptics, not literals; the skip checks (`result.spec.ts` L224, L287; `photo.spec.ts` L379) must still see no new cue.
- **The goldens move.** The new feel key changes `feelHash`, and the new `papa.look` changes `worldHash`, in every journal. The golden scenarios build their content with `createTestContent` (`tests/support/testContent.ts`), not the live defs: as long as its fixture defs have no `lookChange`, **no `eventTypes` and no `eventsHash` may move**. Pin the look's replay with one new scenario (`papa_look` in `tests/golden/scenarios.ts` and its test: a fixture def with `lookChange` (a copy of `tests/support/testOutlet.threat.json` with it, or an override in the scenario's content; never add it to the shared fixture, which would move `outlet_parry` and `after_effect_replaced`) missed twice, so one `PapaLookChanged`, then the level scored), written with `npm run golden:update`. Read the diff and name what moved; any other movement is a bug.
- **Exact scores in tests.** `result.spec.ts`, `tests/tools/sim/mamaScore.test.ts`, `mamaScore.test.ts` and report tests may pin a Laugh. A game with an outlet gag now earns `laughPerLookPartPoints` more. Move the fixture or seed with a reason; never loosen the assertion.
- **New lists:** `events.test.ts` pins `SIM_EVENT_TYPES`; `simEventFeedback.ts` routes by type (an event with no row plays nothing: fine); `feedbackSchema.test.ts` has an explicit unit-suffix list if a new key needs it; the snapshot tests that build a `PapaSlice` by hand need `look`.
- **`LevelScored` carries the note, not the reason.** `lostStars > 0` does not mean `mamaWoke` (a woken Mama with 0 stars loses none), and `stars === 0` does not mean `mamaHome`: use `resultEndReason`, which boot already keeps (`world.flow.endReason` in the sim).
- **`mamaHome` is the only « lost level » (3.16).** Its Result shows 0 dashed stars and no chip, then its header and cue with the rows. Mama's Scream plays before all that, with `result.mama_line_scream_home`; `catastrophe.spec.ts` pins that end (its header check, L238, now waits behind the reactions); `mamaReactions.spec.ts` checks the `mamaHome` bubble and that `mama_scream` comes before `mama_home` in `cueLog()`. The 3.16 golden (`tests/golden/catastrophe.test.ts`) uses fixture defs: its events must not move.
- **The 3.15 after-effects keep their own visuals.** The outlet's `electrified` busy time and the `asleep` micro-sleep already animate Papa; the look is a part on top that stays after them. Do not hang the look on an `AfterEffect…` event, nor clear it when the after-effect ends.
- **The bubble on `mama-sigh` text.** Contrast fails for body text: accent only.
- **Shake ≤ 3 Hz** (`flashRate.test.ts` and UX-DR18 forbid anything blinking faster; keep the scream's oscillation slow and short).
- **Keyframes only on `transform` / `opacity`**, hard shadows only, `pp-` selectors only, no hex: `designTokens.test.ts` checks all of it, and a reduced-motion rule is required for each animation (`checkReducedMotion`).
- **The worktree guard** refuses compound shell commands naming `git`, heredocs, and shell variables in option positions: use plain commands and the edit tools.
- **`VITE_DEBUG_ALLOWED=false` may be exported:** run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` if it is.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`.

### Out of scope

- `save.mamaMemory`, tags, `mama-lines.json`, `MamaLinesSchema`, the PRNG choice of a line: 3.8.
- Replay and the `REPLAY` banner: 3.9 (after the stars, as today).
- « Âge suivant », « Frigo », the unlock header: 3.11.
- A 3D Mama, her `.glb`, Mama in the captured photo, a door that opens for a `mamaWoke` photo (3.6 open point 2): E7 / Geo.
- Combos in the Laugh are already there (4.2); the baby state stays `babyStateFixedPoints` (E5).
- A cue for `PapaLookChanged` in play: the gag's own cue plays at the same step. Add one only if Geo asks.

### Architecture compliance

- `World.papa.look` and `sim/scoring/` are where the architecture puts this story (L981: « Réactions de Maman, étoiles, dégaine de papa | `src/sim/scoring/`, `World.papa.look` »). `src/client/endOfLevel/` is untouched (photo is 3.6's, highlights 3.9's).
- `src/sim` stays pure: no client type, no strings, no sound. `mamaReactionsOf` returns ids and points; the client maps them to strings, classes and cues.
- `@sim` is `src/sim/index.ts` only: export `mamaReactionsOf`, `MamaReaction`, `PapaLook` there. Content may not import the sim: `PAPA_LOOK_PARTS` is content's, `MAMA_REACTIONS` shared's.
- Anything Geo tunes is data: the weight in `feel.json`, the hold in `feedback.json`, the lines in `strings.fr.json`, the part per def in the threat files, colours as tokens.
- Every cue with audio has a visual and a haptic; reduced motion is client-only.

### Library and framework notes

No new dependency, no upgrade (`three@0.186.1`, Zod 4 already pinned). Inline SVG built with `svgElement` is DOM, not an image URL, so the CSP (`default-src 'self'`) is untouched: never use `<img>`, `data:` or `blob:` for Mama. No web research needed.

### File structure

- **New:** `src/sim/papa/look.ts` and test, `src/sim/scoring/mamaReactions.ts` and test, `tests/e2e/mamaReactions.spec.ts`, `public/assets/audio/mama_{laugh,sigh,scream}.m4a`, a clip test in `tests/tools/audio/`, `tests/golden/papaLook.test.ts` with `tests/golden/journals/papa_look{,.expected}.json`.
- **Updated:** `src/sim/{world,events,snapshot,index}.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/scoring/mamaScore.ts`, `src/content/schemas/{threat,feel,feedback}.ts`, `src/shared/constants.ts`, `content/{feel,feedback,strings.fr}.json`, `content/threats/{outlet,coffee_table_object,papa_microsleep}.json`, `content/_schemas/`, `src/client/boot.ts`, `src/client/render/{levelScene,views/papaView}.ts`, `src/client/app/testHost.ts`, `src/client/feedback/feedbackEvents.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/styles/ui.css` (and `tokens.css` + `DESIGN.md` only if a token is added), `src/debug/testApi.ts`, `tools/audio/makePlaceholderAudio.ts`, `tools/sim/{simArgs,simReport}.ts`, `tests/support/{testFeel.json,testContent.ts,fakeTestHost.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/architecture/characterAssets.test.ts`, `tests/golden/journals/*`, the e2e specs named in Traps, the docs of AC 20.

### Testing

- **Sim:** real `createSim` with typed commands, time in `STEP_MS`, tunables through the feel's values. Get a gag by letting a threat time out (no press), never by writing to `sim.world`; place state with `restore` when needed.
- **Pure:** `mamaReactionsOf` table-driven; `computeMamaScore` with `lookParts`.
- **Client unit:** `levelScene` (world look shown, overlay ORed, overlay cleared on start, nothing allocated per frame if the existing tests measure it), `resultScreen` with the fake scheduler (AC 11, 13, 17), boot wiring through the existing fakes.
- **E2E (Chromium), `mamaReactions.spec.ts`:** end a level through the test API on `?threats=off` (no gag, no mess: the fallback Laugh at 0, no chip) and on a live game with a mess (several reactions): `data-pp-result` goes `photo`, `mama`, `rows` (mutation recorder, as `photo.spec.ts`); the bubble's text and accent class per reaction, in order; `cueLog()` holds `mama_*` once each in order, before `mama_woke` on a woken end and before `mama_home` on a `mamaHome` end (driven to 100 % the way `catastrophe.spec.ts` does, with `result.mama_line_scream_home` in the bubble); a skip in `mama` reaches `actions` with the bubble at rest on the last reaction and no new cue; a portrait rebuild adds no cue; reduced motion has no animation on Mama; 844 × 390 and 750 × 340 fit with no scroll, with and without a photo (a refused 2D context, as `photo.spec.ts` does); muted, the bubble still shows. **The look:** an `idle` autoplay `salon_crawler` game until the first `PapaLookChanged` in `events()`, then `state().papa.look` has that part and `fx().papaLook` draws it.
- **Look at it.** Screenshots of the Result screen during each reaction, on both levels, and of Papa with each part in play (from a real gag, not the debug setter), in `_bmad-output/implementation-artifacts/3-7-screenshots/`. Say what you saw by eye and what you did not capture.
- **Checks:** `npm run ci:fast` per task, plus the touched specs on Chromium (`mamaReactions`, `photo`, `result`, `mamaWoke`, `catastrophe`, `characters`, `chambreNight`, `salonKitchen`, `feedback`, `testApi`, `autoplay`, `debugOverlay`'s Result tests). `ci:story` belongs to the review.

### Previous story intelligence

- **3.6 review:** tests that cannot fail were found again (a check that passes on an empty picture, `toBeTruthy` on any value, a value compared with itself). Assert on something that exists; for the cues, read `cueLog()` and visibility, not only the log.
- **3.6:** `.pp-panel` has a `pp-pop-in` animation with `both`; the waiting panel needed two classes to beat it. Mama's animations meet the same specificity games: check the computed style in the e2e.
- **3.6:** `ResultPhase` and the options are required, not optional: every existing `createResultScreen` call in tests must pass `reactions` (e.g. `[]` is **not** valid input from boot, but a test may pass a fixed list). `startRows` and `complete` are where the sequence joins.
- **3.6:** a new feel key reaches `testFeel.json` and `feelSample.json`, every report test needs the new zero, and stale doc comments and snapshot numbers in `project-context.md` are updated as you go.
- **7.2:** the look parts are hidden nodes in `papa.glb` (`papa_look_mash`, `papa_look_shirt`, the shared `papa_hair`), toggled on the named node; `__PP__.setPapaLook` checks its three booleans and throws `__PP__.setPapaLook: …`. Do not touch the `.glb`.
- **3.5:** module-level state in `src/sim` is refused; `changePapaLook` keeps none.

### Git intelligence

The story was first written on 2026-11-03, then refreshed on 2026-11-07 after merging `main` (85 commits: 3.12 to 3.16, 2.11 to 2.13, 9.1 to 9.7) into the branch; the last commits on `main` are 9.7's merge. 3.16 is the closest model for the Result side (`onMamaHome`, a client event with its cue, the header after the photo). Reuse 3.6's patterns too: a client event with a `uiElement` cue (`PhotoTaken`), a required option of `createResultScreen` with a callback, a phase with its hold and its 0 case, a placeholder clip and its test, a `simReport` counter with its zero in the pins.

### Project Structure Notes

Follows the layers and aliases. New files: `sim/papa/look.ts` (beside `sleep.ts`, `tidyProp.ts`), `sim/scoring/mamaReactions.ts` (beside `mamaScore.ts`). No variance from the architecture tree.

### Project Context Rules

- Anything Geo might tune is data: `laughPerLookPartPoints` in `feel.json`, `reactionHoldMs` in `feedback.json`, the lines in `strings.fr.json`, `lookChange` in the defs, colours as tokens.
- Units are suffixes (`reactionHoldMs`, `laughPerLookPartPoints`); `…At` is sim time; events are past tense (`PapaLookChanged`, `ResultMamaLaughed`); no `enum`; booleans `is…` / `has…`; factories `create<Name>`.
- The sim never logs, never reads time or randomness except `world.rng` (this story draws none).
- No `console.*`; I/O returns `Result`, every fallback logs a `warn`.
- Every cue with audio has a visual and a haptic; nothing flashes above 3 Hz; reduced motion is client-only, with no `@media (prefers-reduced-motion)` in a stylesheet.
- UI text is French, in `strings.fr.json`; text ≥ 16 px; failure is never named; Mama is exasperated-loving.
- Regenerating goldens is deliberate and said in the story; never weaken a guardrail or widen the CSP.
- No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. ~~**Mama is a 2D placeholder on the Result screen (D5),** not a 3D model in the photo.~~ **Resolved by Geo on 2026-11-03: a 2D Mama for now.** Her 3D model stays in E7 (`deferred-work.md`).
2. **Which gag gives which part (D2):** outlet → hair, coffee-table object → purée, micro-sleep → shirt inside out. Rewire in the threat files.
3. **The weight (D3):** 5 points per part (15 for all three, out of the Laugh's 35). The measure in the Completion Notes tells you how much it lifts the `random` and `idle` bots.
4. **Mama only reacts to what happened (D4):** no sigh in a tidy game, a scream always when she was woken.
5. **The lines and the sounds are placeholders:** four fixed French lines until 3.8, and synthesised clips (a generated voice, as for the babble of 7.7, is possible later).
6. **`reactionHoldMs` starts at 1 200:** up to 3.6 s more on every Result before the rows. A press skips it.
7. **`mamaHome` gets the Scream too (D4, GDD L114),** with its own line « Mais qu'est-ce qui s'est passé ici ?! ». Its Result then plays photo → Scream → header « Maman est rentrée plus tôt ! » with the door slam → rows → 0 stars.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.7], FR35, FR37, UX-DR13 (L238-242)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Note de Maman] (L484-503), `#Macro-boucle` (L99-103), the lost level (L114), threat catalogue (outlet L317), séquelles (L218), art direction (L532)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L699 (`gags.ts`: « dégaine de papa »), L981
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L90, L104-105 (Result steps 1-2), L237 (mum-bubble), L238 (the five rows), L336-340 (Result states, `mamaHome` L340), L396, L499, L532, L543, L588. Line numbers checked on 2026-11-07
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L32-34, L292-307, L400-402, L429, L517, L557; `mockups/key-result.html` (`.bubble`, `#mama-sigh`, `#mama-woke`)
- [Source: _bmad-output/project-context.md] « Mama's note », « Three ways to end a level », « The end photo », « Audio », « Golden tests », « Rigged characters »
- [Source: _bmad-output/implementation-artifacts/7-2-personnages-rigges-et-animes.md] D1, D2, D4
- [Source: _bmad-output/implementation-artifacts/3-6-photo-de-fin-figee.md] AC 12-14, Traps, Review Findings
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L925-926, L1019 (the big room's photo), L1044 (the `mamaHome` scream)
- [Source: _bmad-output/implementation-artifacts/3-16-jauge-de-catastrophe-et-maman-est-rentree-plus-tot.md] (`mamaHome`, `onMamaHome`, `catastrophe.spec.ts`), 3-12 (the five rows), 3-15 (`applyAfterEffect`, the electrified hair)

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- `VITE_DEBUG_ALLOWED=false` was exported in the shell: every `dev` / `e2e` / `ci` run used `(unset VITE_DEBUG_ALLOWED; …)`.
- The first e2e runs failed on exactly the specs the Traps predicted (phase lists, cue and vibration counts), then on my own fit check (a typo left the home-early end in it, and the panel's fit was read before the fonts and the slam settled); all fixed in the specs.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Refreshed on 2026-11-07 after merging `main` into the branch: snapshot 33 → 34, the Laugh's v2.3 formula and cap (35), the `mamaHome` end (D4, AC 10, 19), three levels, every line number re-checked.


**Implemented (Date: 2026-11-07), all seven tasks.**

- **The look in the sim.** `world.papa.look` (`PapaLook` moved to `sim/world.ts`, exported from `@sim`), `ThreatDef.lookChange` (`PAPA_LOOK_PARTS` in `content/schemas/threat.ts`), `changePapaLook` (`sim/papa/look.ts`) called from `gagThreat` after `gagNoisePct`, the `PapaLookChanged` event (sorted in `SIM_EVENT_TYPES`), snapshot **33 → 34** with `papaProblem` refusing a `papa.look` that is not exactly three booleans. `outlet` → `hairOnEnd`, `coffee_table_object` → `mashOnCheek`, `papa_microsleep` → `shirtInsideOut`. `feel.mama.laughPerLookPartPoints` = 5 (live feel, `testFeel.json`, `feelSample.json`), `ScoreTally.lookParts`, `computeMamaScore`'s Laugh and `scoreLevel`. `world.rng` is not drawn (a unit test compares the PRNG state with and without the look).
- **Reactions, pure.** `MAMA_REACTIONS` / `MamaReactionId` in `shared/constants.ts`; `mamaReactionsOf` in `sim/scoring/mamaReactions.ts`, exported from `@sim` (rules D4, tested table-driven over `LEVEL_END_REASONS`).
- **The look on screen.** `levelScene.update` copies `world.papa.look` into scratch objects; `applyLook` merges the world's look and the debug overlay (`setPapaLook`, cleared by `resetFx`) and holds the one `papa.setLook(` of the file. New `FxState.papaLook` (`fx().papaLook`). `tests/architecture/characterAssets.test.ts`'s describe « nothing in a game sets the look until story 3.7 » was **rewritten deliberately** to pin the new contract (one `papa.setLook(` fed by the merge of world and overlay; boot still hands only the overlay to the debug host: two `setPapaLook` in `boot.ts` unchanged).
- **Cues and clips.** `mama` category in `CLIP_PATTERN`; three placeholder synths (`mama_laugh`, `mama_sigh`, `mama_scream`, seeds `SEED + 58..60`) written with `npm run assets:audio -- --only …` (about 32 KiB of `.m4a` together; `dist:check --flavor playtest`: level payload 2788.5 KiB, under the 3 MiB / 5 MiB limits); events `ResultMamaLaughed|Sighed|Screamed` → cues on the `voice` bus, `uiElement` visual, haptics `light` / `light` / `medium` `[ASSUMPTION]`; `tests/tools/audio/mamaClips.test.ts`.
- **The Result screen.** `ResultPhase` gains `mama`; `createResultScreen` takes `reactions` and `onMamaReaction`; each reaction sets its line, the `+N` / `−N` chip (hidden at 0), the figure and its accent class, fires its cue once, and holds `resultScreen.reactionHoldMs` (1 200). The 2D Mama is built in code with `svgElement` (one figure per reaction), drawn with tokens only: two tokens were missing and were added to `DESIGN.md` and `tokens.css` together (`mama-skin`, `mama-dress`, taken from the mockup's `#mama-sigh`). New left column `pp-result-left` (polaroid + Mama on its corner, or Mama alone with no photo). A press in `photo` or `mama`, and a rebuilt screen, leave her at rest on the last reaction with no cue. Boot computes `mamaReactionsOf(resultScore ?? NO_SCORE, resultEndReason)`.
- **Strings.** Four lines as proposed, with one change: `result.mama_line_laugh` is « Ha ha ! Tous les deux, alors… », not « Vous deux, alors… », because `StringsSchema` forbids « vous » (tutoiement register). Two extra keys, `result.mama_value_gain` / `_loss` (`+{points}` / `−{points}`), because `uiStrings.test.ts` forbids a sign or any prose written in `src/client/ui`. The lines stay placeholders for 3.8 (here and in `deferred-work.md`, not in the JSON).
- **Report.** `lookParts` per run and `lookParts` / `meanLookPartsPerRun` over the runs; `simArgs` help updated.
- **Goldens (deliberate, `npm run golden:update`).** Every journal moved by exactly two things: the `feelHash` of its header (the new feel key) and the `worldHash` of its reference (the new `papa.look`). **No `eventTypes` and no `eventsHash` moved** (the fixture defs have no `lookChange`); the one other diff, `mama_woke.expected.json`, is the formatter's line break of an unchanged array. New scenario `papa_look` (its own copy of the outlet def with `lookChange`, missed twice: one `PapaLookChanged`, then the timer end scores the part) and `tests/golden/papaLook.test.ts`. `tests/bots/humanBotRegression.test.ts` re-pinned its whole-journal hashes (header's feel hash) and left `PINNED_COMMANDS` untouched: they still hold, as in 3.15 / 3.16 / 9.2.
- **Tests that moved, with a reason.** The 33 → 34 snapshot version in the snapshot tests; `tests/tools/sim/mamaScore.test.ts`: the idle bot now scores `lookParts × laughPerLookPartPoints` of Laugh (a micro-sleep and the outlet show on it), asserted through the feel's value, not loosened; `result.spec.ts`, `mamaWoke.spec.ts`, `catastrophe.spec.ts`, `photo.spec.ts` count the cues and vibrations of the reactions from `mamaReactionsOf` of the sim's note (new `mamaCueOf` / `mamaHapticsOf` in `tests/e2e/support/game.ts`), and the phase lists have `mama`; specs that wait for `rows` pass `SEQUENCE_TIMEOUT_MS` (no global timeout changed, `reactionHoldMs` left at 1 200 in the live feedback).

**Verification.** `npm run ci:fast` green (439 files, 9 779 tests). Chromium, in several runs, alone on the queue: `mamaReactions`, `photo`, `result`, `mamaWoke`, `catastrophe`, `characters`, `chambreNight`, `salonKitchen`, `feedback`, `testApi`, `autoplay`, `debugOverlay`: all green after the fixes below (the first runs failed only on the phase lists and cue counts above, and on my own new fit check). `ci:story` and WebKit are left to the review.

**Bots, before / after** (`npm run sim`, 30 games each from seed 1, Normal tier; « before » is the same code with `laughPerLookPartPoints` set to 0 for the run, which is exactly the old note since the bots never see the look; the look adds no catastrophe, so `mamaHome` does not move):

| level / bot | meanStars | mean Laugh | `lookParts` per run | `mamaHome` of 30 |
|---|---|---|---|---|
| salon_crawler / human | 2.90 → 3.00 | 31.4 → 33.4 | 0.93 | 4 → 4 |
| salon_crawler / perfect | 4.00 → 4.00 | 35 → 35 | 0 | 0 → 0 |
| salon_crawler / random | 0 → 0 | 0.0 → 5.0 | 1.00 | 30 → 30 |
| salon_crawler / idle | 0 → 0 | 0.0 → 5.0 | 1.00 | 30 → 30 |
| salon_kitchen / human | 2.20 → 2.20 | 31.4 → 32.5 | 1.17 | 12 → 12 |
| salon_kitchen / perfect | 4.80 → 4.80 | 35 → 35 | 0 | 0 → 0 |
| salon_kitchen / random | 0 → 0 | 0.1 → 4.4 | 0.87 | 30 → 30 |
| salon_kitchen / idle | 0 → 0 | 0.0 → 4.3 | 0.87 | 30 → 30 |
| chambre_night / perfect | 4.00 → 4.00 | 35 → 35 | 0 | 0 → 0 |
| chambre_night / random | 0 → 0 | 0.1 → 10.4 | 2.07 | 30 → 30 |

The weight lifts a bot that lets gags through by 4 to 10 Laugh points, and the human bot (who parries most gags) by one or two; the perfect bot is already at the cap. `meanStars` moves by 0.1 for the human on `salon_crawler` only. Geo tunes `laughPerLookPartPoints`.

**What I saw (screenshots in `3-7-screenshots/`, Chromium 844 × 390 and 750 × 340, real gags, not the debug setter).** Laugh, Sigh and Scream bubbles with their accent bar and chip on both levels; Mama stands on the polaroid's top-right corner, in front of it; with no photo she stands alone in the left column (750 × 340). On `salon_crawler` Papa's hair on end is seen in play after a real outlet gag, during `electrified` and still after it ended (`salon_crawler-look-hair-*.png`). On `salon_kitchen`, the photo frames the whole 13.5 × 7 m room: Papa is a few pixels tall in it and **no part of his look can be made out in the picture** (as predicted by `deferred-work.md` L1019); his look is visible in play only. **Not captured:** the purée on the cheek and the shirt inside out in a screenshot (the idle game's first gag at these seeds was the outlet; the e2e only proves them through `state()` / `fx()`), the Result screen on `chambre_night`, the chip over the sigh's violet at 130 % text, WebKit, and any device.

**Found while testing, not caused by this story (to decide):** the home-early header « Maman est rentrée plus tôt ! » (3.16) wraps to two lines in the 360 px panel, which makes the panel scroll by 12 px at 844 × 390 and by 26 px at 750 × 340 (667 × 375 fits). The woken header fits. `mamaReactions.spec.ts` therefore measures the panel's fit on a woken end and only Mama's own place on a home-early end (750 × 340); it is in `deferred-work.md`. The `+30 % text` constraint of AC 15 has no mechanism in the app today (the CSS is in px tokens): it is not tested.

**Open points for Geo (from the story):** 2 (which gag gives which part) and 3 (the weight) are data, see above; 4 (Mama reacts only to what happened), 5 (placeholder lines and clips), 6 (`reactionHoldMs` 1 200: `photo` + up to 3 holds before the rows, a press skips) and 7 (`mamaHome` screams too) are as the story wrote them.

### File List

- `_bmad-output/implementation-artifacts/3-7-screenshots/`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md`
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`
- `_bmad-output/project-context.md`
- `content/_schemas/feedback.schema.json`
- `content/_schemas/feel.schema.json`
- `content/_schemas/threat.schema.json`
- `content/feedback.json`
- `content/feel.json`
- `content/strings.fr.json`
- `content/threats/coffee_table_object.json`
- `content/threats/outlet.json`
- `content/threats/papa_microsleep.json`
- `public/assets/audio/mama_laugh.m4a`
- `public/assets/audio/mama_scream.m4a`
- `public/assets/audio/mama_sigh.m4a`
- `src/client/app/levelSession.test.ts`
- `src/client/app/testHost.ts`
- `src/client/boot.ts`
- `src/client/feedback/feedbackDirector.test.ts`
- `src/client/feedback/feedbackEvents.ts`
- `src/client/render/levelScene.test.ts`
- `src/client/render/levelScene.ts`
- `src/client/render/views/papaView.test.ts`
- `src/client/render/views/papaView.ts`
- `src/client/ui/screens/resultScreen.test.ts`
- `src/client/ui/screens/resultScreen.ts`
- `src/client/ui/styles/tokens.css`
- `src/client/ui/styles/ui.css`
- `src/content/schemas/feedback.ts`
- `src/content/schemas/feel.ts`
- `src/content/schemas/threat.ts`
- `src/debug/testApi.test.ts`
- `src/debug/testApi.ts`
- `src/shared/constants.ts`
- `src/sim/chores/choreSnapshot.test.ts`
- `src/sim/events.ts`
- `src/sim/flow/flowSystem.test.ts`
- `src/sim/index.ts`
- `src/sim/papa/glide.test.ts`
- `src/sim/papa/look.test.ts`
- `src/sim/papa/look.ts`
- `src/sim/papa/walk.test.ts`
- `src/sim/scoring/frozenNearMiss.test.ts`
- `src/sim/scoring/mamaReactions.test.ts`
- `src/sim/scoring/mamaReactions.ts`
- `src/sim/scoring/mamaScore.test.ts`
- `src/sim/scoring/mamaScore.ts`
- `src/sim/sequences/bombDropSnapshot.test.ts`
- `src/sim/sequences/cycleSnapshot.test.ts`
- `src/sim/sequences/duelSnapshot.test.ts`
- `src/sim/sequences/fakeSleepSnapshot.test.ts`
- `src/sim/sequences/sequenceSnapshot.test.ts`
- `src/sim/snapshot.test.ts`
- `src/sim/snapshot.ts`
- `src/sim/threats/afterEffectsSnapshot.test.ts`
- `src/sim/threats/gags.ts`
- `src/sim/threats/inputLag.test.ts`
- `src/sim/threats/threatFsm.ts`
- `src/sim/world.ts`
- `tests/architecture/characterAssets.test.ts`
- `tests/bots/humanBotRegression.test.ts`
- `tests/content/feedbackSchema.test.ts`
- `tests/content/stringsSchema.test.ts`
- `tests/e2e/catastrophe.spec.ts`
- `tests/e2e/debugOverlay.spec.ts`
- `tests/e2e/mamaReactions.spec.ts`
- `tests/e2e/mamaWoke.spec.ts`
- `tests/e2e/photo.spec.ts`
- `tests/e2e/result.spec.ts`
- `tests/e2e/support/game.ts`
- `tests/e2e/support/testApi.ts`
- `tests/golden/papaLook.test.ts`
- `tests/golden/scenarios.ts`
- `tests/support/fakeTestHost.ts`
- `tests/support/testContent.ts`
- `tests/support/testFeel.json`
- `tests/tools/audio/mamaClips.test.ts`
- `tests/tools/sim/mamaScore.test.ts`
- `tests/tools/sim/simReport.test.ts`
- `tests/tools/vite/fixtures/feelSample.json`
- `tools/audio/makePlaceholderAudio.ts`
- `tools/sim/simArgs.ts`
- `tools/sim/simReport.ts`
- `tests/golden/journals/*.json` and `*.expected.json` (every journal: `feelHash` in the header, `worldHash` in the reference; plus the new `papa_look` pair)
- `_bmad-output/implementation-artifacts/3-7-reactions-de-maman-et-degaine-de-papa.md` (this file)

### Change Log

- 2026-11-07: Story 3.7 implemented: Papa's look in the sim (snapshot 34), Mama's reactions on the Result screen (`mama` phase, 2D Mama, three cues on the voice bus), docs and goldens updated; status `review`.
