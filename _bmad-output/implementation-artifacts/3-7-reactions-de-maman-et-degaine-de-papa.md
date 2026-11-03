# Story 3.7: Réactions de Maman et dégaine de papa

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see Mama laugh, sigh or scream, and Papa look more and more of a mess,
so that the note tells the story of my game.

Requirements: FR35 `[V1]` (the end sequence: photo → **Mama's reactions** → note), FR37 `[V1]` (Papa's look degrades during the level and feeds the Laugh), UX-DR13. It builds on 7.2 (Papa's look parts, ready and undriven), 3.5 (the door, the rush) and 3.6 (the photo and the `photo` phase of the Result screen). Story 3.8 (Mama's memory and `mama-lines.json`) replaces this story's fixed lines; 3.9 (replay) and 3.11 (buttons) come after the stars, as today.

**Scope in one line:** the sim gets `World.papa.look` and `ThreatDef.lookChange` (a gag degrades the look, and each part shown at the end adds Laugh points), the client draws the look from the world, and the Result screen plays Mama's reactions (Laugh, Sigh, Scream) in a `mum-bubble`, each with a provisional animation, a sound and its value, between the photo and the score rows.

## Acceptance Criteria

### Papa's look in the sim

1. **The look is world state.** `PapaSlice` gains `look: PapaLook` with `hasMashOnCheek`, `hasHairOnEnd`, `isShirtInsideOut` (all `false` in `createWorld`). The type `PapaLook` moves from `client/render/views/papaView.ts` to `src/sim/world.ts` and is exported from `@sim`; `papaView.ts`, `testHost.ts`, `levelScene.ts` and `debug/testApi.ts` import it from there (no second definition). `SimSnapshot.version` goes from 28 to 29, the snapshot refuses a `papa.look` that is not an object of exactly these three booleans (`papaProblem`, same words style: `world.papa.look`), and the version comment says « 29 since story 3.7: `papa.look` and the `PapaLookChanged` event ».
2. **A def says which part its gag degrades.** `ThreatDefSchema`'s shared shape (`baseShape`, beside `gagCryMs`) gains an optional `lookChange`, one of `PAPA_LOOK_PARTS = ['mashOnCheek', 'hairOnEnd', 'shirtInsideOut'] as const` (declared in `src/content/schemas/threat.ts`, like `THREAT_COLORS`), with a `.describe()` that says it is applied when a miss ends in the gag, once per part per level. Absent: the gag does not change the look. `npm run content:schemas` regenerates `content/_schemas/threat.schema.json`.
3. **The live content (D2).** `content/threats/outlet.json` → `"lookChange": "hairOnEnd"`, `coffee_table_object.json` → `"mashOnCheek"`, `papa_microsleep.json` → `"shirtInsideOut"`. No other def gets one. These are data: Geo rewires them.
4. **Applying it.** In `gagThreat` (`sim/threats/threatFsm.ts`), right after `applyGag` and beside the `gagCryMs` line, a def with `lookChange` calls `changePapaLook(world, ctx, part, threat.id)` (new `src/sim/papa/look.ts`). If that part is already shown, it does nothing (no event). Otherwise it sets the part's boolean and emits `PapaLookChanged{t, part, threatId}` (new event, in `SIM_EVENT_TYPES` in sorted place, past tense). No `world.rng` draw, no state, no sound in the sim. It applies whatever the flow state a gag can occur in (`playing`, `sequence`, `finalRush`), and on hidden-zone defs too (the def, not the gag id, says it, as `gagCryMs` does).
5. **It feeds the Laugh (D3).** `feel.mama` gains `laughPerLookPartPoints` (number ≥ 0, `points(...)` helper; **5** in `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`). `ScoreTally` gains `lookParts` (how many of the three are shown when the level ends), `scoreLevel` counts them from `world.papa.look`, and `computeMamaScore`'s Laugh becomes `perfects × laughPerPerfectPoints + comboPoints + lookParts × laughPerLookPartPoints`, still held to `laughMaxPoints` and rounded. A unit test scores the same tally with 0 and 3 parts and pins the difference through the feel's values, not a literal, and another pins the cap. `MamaScore` doc comment for `laughPoints` names the look.
6. **Report.** `simReport` gains `lookParts` per run (the parts shown at the end, from `PapaLookChanged`) and in the totals (`lookParts` sum and the per-run mean, following `frozenNearMisses`); `simArgs` help says so; the whole-report tests get their new zero.

### Papa's look on screen

7. **The view follows the world.** `levelScene.update(world, …)` calls `papa.setLook(...)` from `world.papa.look` every frame (allocation-free: one reusable scratch object). The debug `__PP__.setPapaLook(look)` keeps working: it sets a **debug overlay**, and the view shows a part when the world **or** the overlay says so (so `tests/e2e/characters.spec.ts` stays green unedited). The overlay is cleared when a level starts. `tests/architecture/characterAssets.test.ts:272` pins `setPapaLook(look) { papa.setLook(look); }`: update that regex to the new body deliberately and say so in the notes.
8. **Visible in the photo.** The end photo draws `snapshot.world` through `level.update`, so the look is in the picture with no extra code; an e2e checks `state().papa.look` and `fx().papaLook` (new field of `FxState` / `realFxState()`: the look the view draws) after a real gag in a live game.
9. **The outlet's hair.** The outlet gag already draws the hair up for a while (`gagHairAmount`, 7.2 D2); with `hairOnEnd` in the world it stays up after the gag (`max` of the two amounts, unchanged code). Check it on a capture.

### Mama's reactions on the Result screen

10. **Which reactions, in which order (sim, pure).** New `src/sim/scoring/mamaReactions.ts`, exported from `@sim`: `mamaReactionsOf(score: Readonly<MamaScore>, reason: LevelEndReason): readonly MamaReaction[]`, `MamaReaction = { reaction: MamaReactionId; points: number }`, `MAMA_REACTIONS = ['laugh', 'sigh', 'scream'] as const` in `src/shared/constants.ts` (3.8's `MamaLinesSchema` will read it from there; `MamaReactionId` its type). Rules (D4): always in the order Laugh, Sigh, Scream; `laugh` when `laughPoints > 0`, `sigh` when `sighPoints > 0`, `scream` when `screamPoints > 0` **or** `reason === 'mamaWoke'`; with none of them, `[{ reaction: 'laugh', points: laughPoints }]` (Mama always reacts: GDD « le perdant voit toujours sa photo et la réaction de Maman »). `points` is that component's points as in `MamaScore`. No `world.rng`, no event: it reads the note. Unit tests cover each rule, the empty case and the three ends.
11. **The new phase.** `ResultPhase` becomes `'photo' | 'mama' | 'rows' | 'stars' | 'actions'`. `createResultScreen` takes `reactions: readonly MamaReaction[]` (computed in `boot.ts` from `resultScore` and `resultEndReason` with `mamaReactionsOf`) and `onMamaReaction(reaction: MamaReactionId)`. After the photo's hold (or at build, with no photo), the screen enters `mama`: each reaction in turn shows its line in the `mum-bubble`, its value chip, Mama's expression and animation, fires `onMamaReaction` once, and holds for `feedback.json › resultScreen.reactionHoldMs`; after the last one, `startRows` runs as today (the woken header and `onMamaWoke` still come with the rows: nothing sits between the photo and her reaction). `reactionHoldMs: 0` goes straight on in the same call (as 3.6's `photoHoldMs: 0`).
12. **The `mum-bubble` (DESIGN.md › `mum-bubble`, `key-result.html` `.bubble`).** `paper` fill, 3 px `ink` outline, `{rounded.lg}`, the sticker lift, a tail pointing at Mama, text in `{typography.body}` `ink`, never under 16 px, wrapping, never truncated. Its accent (border-left bar or tail, the dev's call, as long as it is not the only signal) takes the active reaction's token: `mama-laugh`, `mama-sigh`, `mama-scream` (classes `pp-mum-bubble--laugh|sigh|scream`). It is the caption of her voice: `role="status"`, `aria-live="polite"`, and it always shows, muted or not. **Never put body text on `mama-sigh`** (DESIGN contrast table: 4.1:1, large text only): the text stays `ink` on `paper`.
13. **The value.** Beside the bubble, a chip shows the reaction's points: `+N` for the Laugh, `−N` (U+2212, as `result.star_lost`) for the Sigh and the Scream, on the reaction's accent, `ink` text, `{typography.label}` or bigger, like the lost star's `« −1 »` chip. A reaction worth 0 (the fallback Laugh, a woken Mama's Scream with no near miss) shows no chip.
14. **The provisional Mama (D5).** A small 2D Mama, built in code with `svgElement` (head, hair, body; the mockup's `#mama-sigh` / `#mama-woke` symbols are the model), drawn in tokens only (no hex in `ui.css`: `designTokens.test.ts`; if a skin or dress colour is missing, add the token to `DESIGN.md` and `tokens.css` together), `aria-hidden`. One expression per reaction (laugh: open smile, eyes shut; sigh: flat eyes and mouth, drooping; scream: round mouth, hair up, the three marks of `#mama-woke`) and one CSS animation each, on `transform` / `opacity` only (laugh: a bounce; sigh: a slow slump; scream: a short shake, oscillating at **3 Hz or less**). Under reduced motion (`:where(:root[data-pp-motion="reduced"])`) there is no animation, only the expression. No `.glb`, no 3D view, nothing in the captured canvas: Mama's model belongs to E7 (update `deferred-work.md` L925).
15. **Where she stands.** With a photo, Mama and her bubble sit on the polaroid's top-right corner, in front of it (the mockup's place: Mama at the door of the photo, the bubble above), inside the left column; the canvas is not touched. With no photo, the same block takes the left column alone, so both cases use the two-column layout and **fit 750 × 340 with no scroll**, whatever the header and the playtest-only journal button, at +30 % text (the 1.22 / 3.3 / 3.6 constraint). Once the reactions are over, Mama and the bubble stay, at rest, showing the last reaction.
16. **Sound, visual, haptic.** Three client events in `FEEDBACK_CLIENT_EVENTS` and `feedback.json › events`: `ResultMamaLaughed` → cue `mama_laugh`, `ResultMamaSighed` → `mama_sigh`, `ResultMamaScreamed` → `mama_scream`. Each has an audio layer on the **`voice`** bus (new clips `mama_laugh`, `mama_sigh`, `mama_scream`: placeholder synths in `tools/audio/makePlaceholderAudio.ts`, `npm run assets:audio -- --only <clip>`), `visual: { kind: 'uiElement' }` (the bubble is the twin) and a haptic (`light`, `light`, `medium`: `[ASSUMPTION]`). `CLIP_PATTERN` in `src/content/schemas/feedback.ts` gains the `mama` category, and `project-context.md › Audio` lists it. `feedbackTwins.test.ts` and `content:check` pass.
17. **Skip and rebuild.** A press during `mama`, past `inputGraceMs`, does what a skip does today (panel shown, rows at totals, stars silent, the header at rest, buttons up) and leaves Mama and the bubble at rest on the **last** reaction of the list, with no animation and no cue. A screen rebuilt with `isDone` shows the same, silently. A press during `photo` skips the reactions too (they never play after a skip). `onMamaReaction` is never called on a rebuild or after a skip.
18. **Mirrors.** `data-pp-result` shows `mama`. No new mirror (the bubble's class and text are the e2e's handle).
19. **Lines (D6).** Fixed lines in `content/strings.fr.json`: `result.mama_line_laugh`, `result.mama_line_sigh`, `result.mama_line_scream`, and `result.mama_line_scream_woke` (used for the Scream of a `mamaWoke` end). Exasperated-loving, never shaming the parent, never naming failure (EXPERIENCE › Voice and Tone). Proposed: « Ha ha ! Vous deux, alors… », « Bon… qui range ? », « Pas si près de l'escalier ! », « Qui fait tout ce bruit ?! ». They are placeholders until 3.8 picks lines from `mama-lines.json`; say so in a comment-free way (the story and `deferred-work.md`), not in the JSON.

### Docs

20. **Docs.** `project-context.md` gets « Papa's look and Mama's reactions (story 3.7, snapshot version 29) » (the field, `lookChange`, `PapaLookChanged`, the Laugh weight, the view's debug overlay, `mamaReactionsOf` and its rules, the `mama` phase, the cues and the `mama` clip category) and « Mama's note » names the look in the Laugh. GDD › Note de Maman: the look's Laugh rule (one part, once, `laughPerLookPartPoints`) and the reaction rule (D4). `EXPERIENCE.md`: Result sequence step 2 says which reactions play, their hold, the skip, and the no-photo case; L127 and L378 already say the look is the in-play hint (keep). `decision-log.md`: D3, D4, D5. `deferred-work.md` L925-926: the look is wired (close 926), Mama's model goes to E7.

## Tasks / Subtasks

- [ ] Task 1: The look in the sim (AC: 1, 2, 3, 4, 5)
  - [ ] `PapaLook` in `world.ts`, exported from `@sim`; `createWorld`; client imports moved
  - [ ] `PAPA_LOOK_PARTS` and `lookChange` in `threat.ts`; the three live defs; `npm run content:schemas`
  - [ ] `sim/papa/look.ts` (`changePapaLook`), the call in `gagThreat`, `PapaLookChanged` in `events.ts` and `SIM_EVENT_TYPES`
  - [ ] Snapshot version 29 and `papaProblem`; round-trip tests of a world with a look
  - [ ] `laughPerLookPartPoints` in `FeelSchema` and the three feel files; `ScoreTally.lookParts`; `computeMamaScore`
  - [ ] Unit tests: a gag with and without `lookChange`, the same part twice (one event), a hidden-zone def, a gag in `finalRush`, the Laugh difference and its cap
- [ ] Task 2: Reactions, pure (AC: 10)
  - [ ] `MAMA_REACTIONS` in `shared/constants.ts`; `sim/scoring/mamaReactions.ts` and test; export from `src/sim/index.ts`
- [ ] Task 3: The look on screen (AC: 7, 8, 9)
  - [ ] `levelScene.update` and the debug overlay; `fx().papaLook`; `characterAssets.test.ts` regex; `levelScene.test.ts`
- [ ] Task 4: Cues and clips (AC: 16)
  - [ ] `mama` in `CLIP_PATTERN`; three synths, `npm run assets:audio -- --only mama_laugh` (and the two others); a clip test beside `tests/tools/audio/cameraShutterClip.test.ts`
  - [ ] The three client events, cues and event rows; `tests/support/testContent.ts` and the tests that build a full table
- [ ] Task 5: The Result screen (AC: 11, 12, 13, 14, 15, 17, 18, 19)
  - [ ] `reactionHoldMs` in `ResultScreenSchema` and `feedback.json › resultScreen` (start at **1 200**)
  - [ ] `reactions`, `onMamaReaction`, the `mama` phase, Mama's block (face + bubble + chip), `complete()` and `isDone` at rest on the last reaction
  - [ ] Wire `boot.ts`: `mamaReactionsOf(resultScore ?? NO_SCORE, resultEndReason)`, `onMamaReaction` → `director.handle('ResultMama…', null)`
  - [ ] `ui.css`: bubble, chip, Mama, three keyframes and their reduced-motion rule; the no-photo left column
  - [ ] Strings in `strings.fr.json`
  - [ ] `resultScreen.test.ts`: both paths (photo, no photo), the order and count of `onMamaReaction`, `reactionHoldMs: 0`, skip in `photo` and in `mama`, rebuild, the chip's sign and its absence at 0, the woke line. Existing tests pass `reactions` and keep their assertions
- [ ] Task 6: Report, goldens, e2e (AC: 6, 8 and all)
  - [ ] `simReport.ts`, `simArgs.ts`, the whole-report pins
  - [ ] The `papa_look` golden scenario (see Traps); `npm run golden:update`, deliberately; read the diff and say what moved
  - [ ] New `tests/e2e/mamaReactions.spec.ts`; adapt the specs listed in Traps
  - [ ] `npm run sim` with the four bots on the salon (and `chambre_night` for `perfect` and `random`), before and after: `meanStars`, `lookParts`, the Laugh mean, in the Completion Notes
- [ ] Task 7: Docs (AC: 20)
  - [ ] `npm run ci:fast` after each task, plus the touched specs on Chromium

## Dev Notes

### Decisions

- **D1. The look is sim state, the reactions are not.** The look changes during play, is in the photo, feeds the score and must replay identically: it lives in `World` and journals through its event. The reactions are a pure reading of the final note and the end reason, done once the level is over: a function of `@sim`, not world state and not an event, so the snapshot and the goldens carry nothing more for them. **3.8 will need the PRNG to pick a line**; it can then call a sim-side selection at the end step and emit an event with the chosen line ids. That is 3.8's design call, and this story must not pre-empt it with an event nobody reads.
- **D2. Which gag degrades which part.** The GDD names the three parts but not their causes. The outlet's gag *is* « cheveux en pétard » (GDD catalogue), the coffee-table object is the game's spoon of purée (GDD signature: « rattraper… une cuillère de purée »), and the micro-sleep leaves Papa crumpled, shirt inside out. Both levels have the three (`chambre_night`'s waves hold `outlet` and `coffee_table_object`, and both levels name `papa_microsleep` as `microSleepDef`), so the look shows in each. Stairs and silence change nothing: their cost is Mama's scream and sigh. All of it is `lookChange` data in the defs.
- **D3. One part, once, one weight.** A part is shown or not; a second outlet gag adds nothing (no event, no points). The points come from the parts shown **at the end** (`lookParts × laughPerLookPartPoints`), so the event is for the presentation, the report and 3.8/3.9, not a score counter. Start at 5 (three parts = 15 of the Laugh's 40; one perfect is worth 1): a messy Papa is funny, not a strategy. Measure the bots before and after (Task 6) and report it; Geo tunes it.
- **D4. Mama reacts to what happened.** A perfect game does not make her sigh at nothing: a reaction plays only when its component has points, in the fixed order. A woken Mama always screams (GDD: early end → « hurlement »), even with no near miss, with her own line. With nothing at all (no perfect, no look, no mess, no near miss) she still reacts: the Laugh, at 0, with no value chip.
- **D5. A provisional 2D Mama, in the DOM.** 7.2 (D1) gave Mama no model and `deferred-work.md` expected one « with 3.5 / 3.7 ». The reactions play on the Result screen, over a photo that is a frozen 2D canvas: a 3D Mama would need a second live render on the Result screen or a re-capture per reaction, plus a rigged `.glb` (payload, pipeline, contract), for an animation the AC calls provisional. A small SVG figure on the polaroid, as the mockup draws her, does the job, costs no draw call and no byte of `.glb`, and is replaced when E7 models her. **Geo may overrule this** (open point 1).
- **D6. Fixed lines now, content-driven lines in 3.8.** `mama-lines.json`, `MamaLinesSchema` and the « most specific line wins » rule are 3.8's AC. This story's four lines are plain strings, picked by the client from the reaction (and the woke case). Do not create `mama-lines.json` here.
- **D7. Mama's voice is on the `voice` bus,** with the baby's; her reactions are a character speaking, not UI. The Result's stars stay on `ui`.

### Current state of the files this story changes

- **`src/sim/world.ts`.** `PapaSlice` (L14-49) has no look; `createWorld` builds it at L673. `MamaScore` (L246) documents `laughPoints` as « the perfect responses ». `ScoreSlice` needs no change (the look is not a counter).
- **`src/sim/threats/threatFsm.ts`.** `gagThreat` (L273-305): `ResponseResolved{fail}`, `GagTriggered`, `applyGag`, then `if (def.gagCryMs !== undefined) startBabyCry(...)`. Put the look call right after the cry line, with the same « the def, not the gag id » comment. `gagOf` draws `world.rng` for hidden-zone defs only: do not add a draw.
- **`src/sim/threats/gags.ts`.** Untouched: the look is per def, not per gag (two defs may share a gag). Its header comment lists what the client and the score read: add the look's line.
- **`src/content/schemas/threat.ts`.** `baseShape` ends with `gagCryMs` (L208-215); add `lookChange` after it. `THREAT_COLORS` (L48) shows the pattern for `PAPA_LOOK_PARTS`.
- **`src/content/schemas/feel.ts`.** `MamaSchema` (L469-532), `points(...)` for weights. The refines do not need to change.
- **`src/sim/scoring/mamaScore.ts`.** `ScoreTally`, `computeMamaScore` (the Laugh line), `scoreLevel` (reads `world.score` and `world.mess`; add `world.papa.look`).
- **`src/sim/snapshot.ts`.** `version: 28` (L43, L62) and the long history comment (L36); `papaProblem` (L72-178) checks each key of the slice: add `look`.
- **`src/client/render/views/papaView.ts`.** `PapaLook` (L41-46, to move), `setLook` (L263-268): mash, shirt / inside-out shirt, `lookHairAmount`. Leave the view as it is apart from the import.
- **`src/client/render/levelScene.ts`.** `setPapaLook(look) { papa.setLook(look); }` (L526) and `update` (L529): today nothing in a game sets the look. The new body ORs the debug overlay into the scratch look each frame.
- **`src/client/ui/screens/resultScreen.ts`.** Read it whole before editing. The phases, `startRows` (L540), `complete` (L453), the `isDone` branch (L551), the photo branch (L558-568). The header comment says « Mama's lines (3.7) … come later »: update it. `polaroid` is built at L211; Mama's block goes with it (or alone in the left column without a photo).
- **`src/client/boot.ts`.** The `result` builder at L1681 passes the callbacks to `director.handle(...)`; `resultScore`, `resultEndReason` are set in the `LevelScored` branch; `NO_SCORE` (L128).
- **`src/client/feedback/feedbackEvents.ts`.** `FEEDBACK_CLIENT_EVENTS` (L7-15).
- **`content/feedback.json`.** Cues near `photo_taken` (L181), events at the end (L557-561), `resultScreen` (L72-80). `voice` bus at 80 %.
- **`src/debug/testApi.ts`.** `setPapaLook` validates three booleans (L289-305): keep it, now an overlay. Its doc comment (L96, « nothing in a game sets it until story 3.7 ») and the one of `PapaLook` in `papaView.ts` (« story 3.7 will drive them ») become stale: update them.

### What must keep working

- A level whose gags have no `lookChange` (stairs, silence, the bedroom's arms and sequence gags) emits the same events as today.
- `data-pp-flow`, the 3.6 photo path and its fallback, the woken header after the photo, the input grace, the 3.3 journal buttons.
- `characters.spec.ts` (the debug look), `photo.spec.ts`, `result.spec.ts`, `mamaWoke.spec.ts`, `chambreNight.spec.ts`.
- `autoplay.spec.ts`'s frozen screenshot is taken in play, early: the look should not show in it. If it moves, find out which gag did it and say so; regenerate only if the change is this story's on purpose, and look at the images.
- Perf: one boolean copy per frame in `update`, nothing allocated; the Result screen is outside play.

### Traps

- **The phase list moved.** Every spec or unit test that pins the phases in order (`photo.spec.ts`'s mutation recorder: `photo`, `rows`, `stars`, `actions`) now sees `mama` between `photo` and `rows`. Specs that wait for `rows` or `actions` now wait up to `photoHoldMs + n × reactionHoldMs` longer (up to 3.6 s more): check them against the `expect` timeout of `playwright.config.ts` and wait for the phase you need; do not lengthen timeouts, and do not set `reactionHoldMs` to 0 in the live feedback to save time. The two specs that race `photoHoldMs` (3.6 Review › Defer) skip during `photo`: still fine, the skip now also covers `mama`.
- **`mamaWoke.spec.ts` counts cues and vibrations in order** (3.6 added the shutter first): a woken Mama now also plays at least `mama_scream` before `mama_woke`. Update the expected sequence from the content, not literals.
- **The goldens move.** The new feel key changes `feelHash`, and the new `papa.look` changes `worldHash`, in every journal. The golden scenarios build their content with `createTestContent` (`tests/support/testContent.ts`), not the live defs: as long as its fixture defs have no `lookChange`, **no `eventTypes` and no `eventsHash` may move**. Pin the look's replay with one new scenario (`papa_look` in `tests/golden/scenarios.ts` and its test: a fixture def with `lookChange` missed twice, so one `PapaLookChanged`, then the level scored), written with `npm run golden:update`. Read the diff and name what moved; any other movement is a bug.
- **Exact scores in tests.** `result.spec.ts`, `tests/tools/sim/mamaScore.test.ts`, `mamaScore.test.ts` and report tests may pin a Laugh. A game with an outlet gag now earns `laughPerLookPartPoints` more. Move the fixture or seed with a reason; never loosen the assertion.
- **New lists:** `events.test.ts` pins `SIM_EVENT_TYPES`; `simEventFeedback.ts` routes by type (an event with no row plays nothing: fine); `feedbackSchema.test.ts` has an explicit unit-suffix list if a new key needs it; the snapshot tests that build a `PapaSlice` by hand need `look`.
- **`LevelScored` carries the note, not the reason.** `lostStars > 0` does not mean `mamaWoke` (a woken Mama with 0 stars loses none): use `resultEndReason`, which boot already keeps.
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

- `World.papa.look` and `sim/scoring/` are where the architecture puts this story (L960: « Réactions de Maman, étoiles, dégaine de papa | `src/sim/scoring/`, `World.papa.look` »). `src/client/endOfLevel/` is untouched (photo is 3.6's, highlights 3.9's).
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
- **E2E (Chromium), `mamaReactions.spec.ts`:** end a level through the test API on `?threats=off` (no gag, no mess: the fallback Laugh at 0, no chip) and on a live game with a mess (several reactions): `data-pp-result` goes `photo`, `mama`, `rows` (mutation recorder, as `photo.spec.ts`); the bubble's text and accent class per reaction, in order; `cueLog()` holds `mama_*` once each in order, before `mama_woke` on a woken end; a skip in `mama` reaches `actions` with the bubble at rest on the last reaction and no new cue; a portrait rebuild adds no cue; reduced motion has no animation on Mama; 844 × 390 and 750 × 340 fit with no scroll, with and without a photo (a refused 2D context, as `photo.spec.ts` does); muted, the bubble still shows. **The look:** an `idle` autoplay salon game until the first `PapaLookChanged` in `events()`, then `state().papa.look` has that part and `fx().papaLook` draws it.
- **Look at it.** Screenshots of the Result screen during each reaction, on both levels, and of Papa with each part in play (from a real gag, not the debug setter), in `_bmad-output/implementation-artifacts/3-7-screenshots/`. Say what you saw by eye and what you did not capture.
- **Checks:** `npm run ci:fast` per task, plus the touched specs on Chromium (`mamaReactions`, `photo`, `result`, `mamaWoke`, `characters`, `chambreNight`, `feedback`, `testApi`, `autoplay`, `debugOverlay`'s Result tests). `ci:story` belongs to the review.

### Previous story intelligence

- **3.6 review:** tests that cannot fail were found again (a check that passes on an empty picture, `toBeTruthy` on any value, a value compared with itself). Assert on something that exists; for the cues, read `cueLog()` and visibility, not only the log.
- **3.6:** `.pp-panel` has a `pp-pop-in` animation with `both`; the waiting panel needed two classes to beat it. Mama's animations meet the same specificity games: check the computed style in the e2e.
- **3.6:** `ResultPhase` and the options are required, not optional: every existing `createResultScreen` call in tests must pass `reactions` (e.g. `[]` is **not** valid input from boot, but a test may pass a fixed list). `startRows` and `complete` are where the sequence joins.
- **3.6:** a new feel key reaches `testFeel.json` and `feelSample.json`, every report test needs the new zero, and stale doc comments and snapshot numbers in `project-context.md` are updated as you go.
- **7.2:** the look parts are hidden nodes in `papa.glb` (`papa_look_mash`, `papa_look_shirt`, the shared `papa_hair`), toggled on the named node; `__PP__.setPapaLook` checks its three booleans and throws `__PP__.setPapaLook: …`. Do not touch the `.glb`.
- **3.5:** module-level state in `src/sim` is refused; `changePapaLook` keeps none.

### Git intelligence

The last commits are 3.6's merge and 7.3's. Reuse 3.6's patterns: a client event with a `uiElement` cue (`PhotoTaken`), a required option of `createResultScreen` with a callback, a phase with its hold and its 0 case, a placeholder clip and its test, a `simReport` counter with its zero in the pins.

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

1. **Mama is a 2D placeholder on the Result screen (D5),** not a 3D model in the photo. If you want her modelled now, that is a 7.2-style pipeline job (one `.blend`, one contract, one view) and a change to the photo: say so and it becomes its own story.
2. **Which gag gives which part (D2):** outlet → hair, coffee-table object → purée, micro-sleep → shirt inside out. Rewire in the threat files.
3. **The weight (D3):** 5 points per part (15 for all three, out of 40). The measure in the Completion Notes tells you how much it lifts the `random` and `idle` bots.
4. **Mama only reacts to what happened (D4):** no sigh in a tidy game, a scream always when she was woken.
5. **The lines and the sounds are placeholders:** four fixed French lines until 3.8, and synthesised clips (a generated voice, as for the babble of 7.7, is possible later).
6. **`reactionHoldMs` starts at 1 200:** up to 3.6 s more on every Result before the rows. A press skips it.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.7], FR35, FR37, UX-DR13 (L238-242)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Note de Maman] (L434-450), `#Macro-boucle` (L100-113), threat catalogue (L276-285), art direction (L478)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L252, L259, L495, L817-827, L960, L992
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L99-105, L127, L137, L171, L226-227, L323, L327, L378-380, L506, L517
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L32-34, L292-307, L400-402, L429, L517, L557; `mockups/key-result.html` (`.bubble`, `#mama-sigh`, `#mama-woke`)
- [Source: _bmad-output/project-context.md] « Mama's note », « Three ways to end a level », « The end photo », « Audio », « Golden tests », « Rigged characters »
- [Source: _bmad-output/implementation-artifacts/7-2-personnages-rigges-et-animes.md] D1, D2, D4
- [Source: _bmad-output/implementation-artifacts/3-6-photo-de-fin-figee.md] AC 12-14, Traps, Review Findings
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L925-926

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
