# Story 7.4: Célébration finale et cadrages parodiques

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want an outsized celebration on a level's last response, and film framings for each sequence,
so that I live the epic / mundane contrast.

**Requirements covered:** FR62. **Depends on:** the sequence framing of 4.4 (`framing.camera`, `sequenceFramingBlendAt`, `createFramingChain` from 4.10), the bedtime cycle of 4.10 (`CycleCompleted`), the final rush and the photo of 3.5 and 3.6, the render of 7.3 (`feedback.json › render`, the per-level lights, `reservedHueProblems`, the particle pool).

**Scope:**
- **The finale.** The sim names the level's last success with one new event, `FinaleReached` (D1, D2). The client plays a celebration on it: an opera-choir sting, fireworks over the room, an Epic stamp, a flash, and a `fanfare` vibration (D4 to D7). The end of the level waits for the celebration to finish before the photo (D3).
- **The film framings.** A sequence's JSON names a film grammar: `framing.style` and `framing.titleKey`. The client draws it while the sequence runs: letterbox bars, a grade through the room's lights, a vignette, a camera roll and an Epic title card. The look of each grammar is data in `feedback.json › framingStyles` (D8 to D12).

**Not in this story:**
- The highlight replay (3.9). `FinaleReached` is a natural highlight there; 3.9 decides its score.
- Mama's reactions (3.7) and the music per age (7.5).
- A new sequence, including the hostage negotiation (6.2). Its grammar is defined here and is used by no live sequence yet (D9).
- Any change to timing, windows, slow-mos, bots' choices or `feel.json` (D2, D13).

## Acceptance Criteria

The epics' criteria are:
- *Given a level's last successful response, when it is judged, then a celebration (opera choir, fireworks) plays, with its visual and haptic equivalents.*
- *Given each special sequence, when it plays, then it applies the visual grammar of its reference (action, infiltration, hostage taking, bomb defusal), defined in its JSON.*

**The finale (sim)**

1. **One event names the last success.** The sim emits `FinaleReached{t, cause, threatId}` in two cases:
   - `cause: 'lastWave'` comes from `resolveThreat`, in the step a `perfect` or `success` resolves the last threat of the level's **last** wave (`isLastOfWave` holds and `threat.waveIndex === ctx.level.waves.length - 1`). It is pushed right after the `lastThreat` slow-mo starts. `threatId` is that threat's id.
   - `cause: 'cycleDone'` comes from `advanceCycle`, right after `CycleCompleted`. `threatId` is `null`.
   - It is never emitted on a `fail`, for a threat with `waveIndex -1` (micro-sleep, cry in the arms, sequence threats), or after a `mamaWoke` end (D1).
2. **At most one per level.** No world field is added and the snapshot version stays 28. A test plays the four bots on both live levels (seed 1, 5 runs) and checks that each game has 0 or 1 `FinaleReached`, and never one after `LevelEnded`.
3. **The game does not move.** Draws, timings, slow-mos, scores and end reasons are unchanged:
   - `npm run sim` with the four bots on both levels, seed 1, gives reports identical to `main` except the new `finales` counter;
   - the goldens that change gain `FinaleReached` events and nothing else, and every final-state hash is unchanged;
   - they are regenerated on purpose with `npm run golden:update`, and the story lists them (D2, T2).

**The celebration (client)**

4. **It plays, with its twins.** On `FinaleReached` the cue `finale_reached` plays its parts:
   - audio: the clip `music_finale_choir` on the `music` bus;
   - visual: a three-pulse sound wave on Papa and one flash;
   - haptic: the new `fanfare` pattern.

   The celebration module then adds the fireworks, the stamp `stamp.finale` and the music mute. `__PP__.cueLog()` shows the cue with `soundWave`, `flash` and `fanfare`, and `__PP__.fx()` shows `fireworksAlive > 0` while it runs. `feedbackEquivalence.test.ts` and `feedbackTwins.test.ts` pass unchanged.
5. **The end waits for it.** When `LevelScored` arrives while a celebration runs, `finish()`, the photo and the Result wait for it to end, for at most `feedback.json › celebration.endHoldMs` of real time. That covers `cycleDone`, where the finale and the level end share one step. Then the existing 3.6 sequence runs unchanged:
   - the photo holds no firework and no stamp;
   - `photo_taken` still flashes (the 334 ms gap from the last flash is kept);
   - `data-pp-result` still goes `photo`, `rows`, `stars`, `actions`.

   With no celebration, the end is exactly as today (D3).
6. **Nothing can be done during the wait.** The level is over: no input reaches the sim, pause is refused, and a hidden tab holds the wait. The celebration's sound is not cut by the change to `result`.
7. **The music gives way.** While the choir sings (`celebration.musicMuteMs`), the level stems and any sequence music are muted through the existing `setMusicMuted` path. They come back after it if the level goes on (salon: a finale before 180 s).
8. **Comfort.** Under « Réduire les animations »:
   - fireworks keep `REDUCED_MOTION_PARTICLE_KEEP_PCT` of their sparks;
   - the flash is a border glow;
   - the stamp is a plain fade;
   - nothing shakes.

   Nothing flashes above 3 Hz, and `flashRate.test.ts` passes, with its animation list updated only if a CSS animation is added.
9. **It plays without a human.** `chambreNight.spec.ts` « the perfect bot chains the five sequences » sees one `FinaleReached{cycleDone}`, the cue in `cueLog()`, `data-pp-finale="cycleDone"`, then the Result with its photo. `npm run sim` reports `finales: { lastWave, cycleDone }`.

**The framings**

10. **Defined in its JSON.** `FramingSchema` gains two optional keys:
    - `style`, one of `FRAMING_STYLE_IDS`: `action | rhythm | duel | defusal | infiltration | hostage`;
    - `titleKey`, a `framing.title_*` key of `strings.fr.json`, allowed only with `style`.

    The five live sequences name theirs: `stay_awake` → `action`, `lullaby_walk` → `rhythm`, `bedtime_duel` → `duel`, `bomb_drop` → `defusal`, `stealth_exit` → `infiltration` (D9). The test fixtures `tests/support/test*.sequence.json` are not touched, so no golden moves for it. `content:check` refuses an unknown style or an unknown title key.
11. **The look is data.** `feedback.json › framingStyles` has one row per style id: `letterboxPct`, `rollDeg`, `vignetteOpacityPct`, `titleHoldMs`, and `grade` (`{ lightsFactor, ambientColor, sunColor }` or `null`). The schema sets bounds and the units are suffixes. `npm run content:schemas` is regenerated and no golden moves (D12).
12. **It is drawn while the sequence runs.** Every frame, from the world's sequence slice and the sim clock only, with the blend of `sequenceFramingBlendAt` (in over `camera.inMs`, out over `camera.outMs`), the client draws four things:
    - the letterbox bars, and the vignette;
    - the grade, mixed into the level's own lights. The gag's `setLightsFactor` multiplies on top.
    - the roll, composed by `cameraFx` with the zoom and pan it already makes;
    - the title card, for `titleHoldMs` of sim time from `startedAt`.

    A pause holds all of it. A slow-mo (bomb drop) stretches it. The bomb drop → stealth seam goes through `createFramingChain` with no pop: the grade's and the bars' change between two frames stays under 0.1 of their full range.
13. **Play stays readable.**
    - Bars, vignette and title take no pointer events and sit under `#pp-world`, so markers, verbs, rings and the HUD stay on top.
    - At both 844 × 390 and 667 × 375, Papa's projected point and, in a stealth step, the exit marker stay outside the bars. An e2e test projects them.
    - The grade keeps the walkable floor at 3:1 or more against `ink`, as the drawn contrast of 7.3 computes it with the graded lights, on both levels. It also passes `reservedHueProblems`.
    - No framing file reads `windowOpenAt` or `feintAt`, and the scan of `views/` and `ui/` covers the new files.
14. **Comfort.** Under reduced motion:
    - the roll is 0;
    - the bars and the title fade instead of sliding or scaling;
    - the zoom cap of 4.4 is unchanged;
    - grade and vignette stay (they are not motion).
15. **Mirrored for tests.** `data-pp-framing-style` (`<id>`, removed at the end of the sequence's out-blend) and `__PP__.fx().framing` (`{ style, blend, letterboxPct, lightsFactor, rollDeg }`). `sequence.spec.ts`'s zoom tests still pass, because the zoom stays `1 + zoomPct/100`. The new markers go in `PROD_FORBIDDEN_MARKERS`, as `ppPhoto` did.
16. **Budgets.** Fireworks are one `InstancedMesh` (one draw call, only while shown). The framing adds no draw call. `perf.spec.ts` on the built playtest, salon, holds p95 ≤ 20 ms, ≤ 100 draw calls and ≤ 100k triangles. `dist:check --flavor playtest` passes with each level ≤ 3 MiB. The numbers go in the notes.
17. **Geo has seen it.** Screenshots go in `_bmad-output/implementation-artifacts/7-4-screenshots/`:
    - each of the five sequences at full blend, at 844 × 390, and two of them at 667 × 375;
    - the fireworks mid-burst in both rooms;
    - reduced motion on one sequence and on the fireworks.

    Every image not opened is listed as not opened. The merge waits for Geo's visual OK.

## Tasks / Subtasks

- [ ] **T1. The event in the sim** (AC 1, 2, D1)
  - [ ] `src/sim/events.ts`: add `{ type: 'FinaleReached'; t: SimMs; cause: FinaleCause; threatId: number | null }`, plus `FinaleCause = 'lastWave' | 'cycleDone'` and the `FINALE_CAUSES` list beside `LEVEL_END_REASONS`. Add it to `SIM_EVENT_TYPES` and export the type through `src/sim/index.ts`.
  - [ ] `threatFsm.ts › resolveThreat`, inside the `isLastOfWave` branch, after `startSlowMo('lastThreat')`: when `threat.waveIndex === ctx.level.waves.length - 1`, push the event. **Do not compute `isLastOfWave` twice.**
  - [ ] `sequences/cycleEnd.ts › advanceCycle`: push it right after `CycleCompleted`. `cycleEnd.ts` stays free of threat code.
  - [ ] Unit tests, in sim steps:
    - a single-wave test level: the last success emits it and an earlier success does not;
    - a two-wave level: the last of wave 0 does not, the last of wave 1 does;
    - a `fail` on the last threat does not; a micro-sleep resolved later does not;
    - the cycle's last entry emits `CycleCompleted`, `FinaleReached{cycleDone}`, `LevelEnded{cycleDone}` in this order at one `t`;
    - a `mamaWoke` end in the same step as a last success: `runThreats` runs before `runFlow`, so the finale comes first. Pin the order, and say so in the notes.
- [ ] **T2. Goldens and reports** (AC 2, 3, 9)
  - [ ] Run `npm test` and list the goldens that fail. For each one, check that the diff of its `.expected.json` adds `FinaleReached` entries and changes nothing else (same final hash, same other events). Then run `npm run golden:update` and list them in the notes. **If anything else moves, stop: the event is not presentation-only.**
  - [ ] `tools/sim/simReport.ts`: add `finales: { lastWave, cycleDone }`, plus its line in `simArgs.ts`'s help. Diff the reports of the four bots on both levels at seed 1 against `main` (AC 3).
  - [ ] The « 0 or 1 finale, never after `LevelEnded` » test (AC 2), in `tests/` beside the other bot-level checks.
- [ ] **T3. Data** (AC 4, 10, 11, D5, D9, D12)
  - [ ] `src/content/schemas/feedback.ts`:
    - `HAPTIC_KINDS` gains `fanfare`. Follow the six places `heartbeat` touched (story 2.9), listed under « What exists » below.
    - `celebration`: `{ endHoldMs, musicMuteMs, stampMs (≤ EPIC_STAMP_MAX_MS), fireworks: { bursts: { atMs, xPct, zPct, heightM, sparks }[], speedMps, lifeMs, sizeM, colorTokens } }`.
    - `framingStyles`: a strict record over `FRAMING_STYLE_IDS`.

    Bounds go in the schema and `tests/content/feedbackSchema.test.ts` keeps its unit-suffix rule (add a suffix only if a key needs it, anchored as 7.3 did).
  - [ ] `src/content/schemas/sequence.ts › FramingSchema`: add `style?` and `titleKey?`, with a `superRefine` that refuses `titleKey` without `style`. Put `FRAMING_STYLE_IDS` in `src/shared/constants.ts`.
  - [ ] `content/feedback.json`: the rows, the cue `finale_reached`, and `events.FinaleReached`. `content/sequences/*.json`: style and title. `content/strings.fr.json`: `stamp.finale` and the five `framing.title_*` (D10). Run `npm run content:schemas`.
  - [ ] `tools/content/contentChecks.ts`:
    - a `titleKey` that is not in the strings;
    - a `colorTokens` entry that is not a `DESIGN.md` colour, or is `alert`, `parry` or `dodge`;
    - a grade whose colours fail `reservedHueProblems`;
    - a burst outside its bounds.

    Each refusal gets a test, as 7.3's review asked.
- [ ] **T4. The choir clip** (AC 4, D6)
  - [ ] `tools/audio/makePlaceholderAudio.ts`: a placeholder `music_finale_choir`, a stacked « aah » chord swell of about `musicMuteMs`. Commit the `.m4a`.
  - [ ] **The generated take needs Geo's OK before any credit is spent** (7.6's rule). Propose one ElevenLabs prompt and its cost in chat. Only once he agrees, generate, cut with `tools/audio/cutMusicLoop.ts` or by hand, record it in `docs/audio-sources.md` and add it to `GENERATED_CLIPS`. Without his OK, the placeholder ships and the notes say so.
- [ ] **T5. Fireworks and the celebration** (AC 4 to 9, D3 to D7)
  - [ ] `src/client/render/vfx/fireworks.ts`: one `InstancedMesh` of octahedra, with its own pool sized from the data's largest total (assert it is under a `FIREWORK_POOL_SIZE` constant). Colours go through `setColorAt` from `colorTokens`, resolved through `PALETTE` or the tokens. Each spark is placed by a golden-angle sphere, deterministic, with no `Math.random`. It runs on real time and `update` allocates nothing. `reset()` and `dispose()` exist and `aliveCount` is exposed. It is added under `content_root`. `resetFx` hides it.
  - [ ] `src/client/endOfLevel/celebration.ts`: `createCelebration({ fireworks, stamp, … })` with `start(atReal, isMotionReduced)`, `isRunning(nowReal)`, `isMusicMuted(nowReal)`, `frame(nowReal)` and `reset()`. Reuse the epic stamp element, with a `show(text, …)` or a second instance. Keep the stamp under `EPIC_STAMP_MAX_MS`.
  - [ ] `boot.ts`:
    - on `FinaleReached`, call `celebration.start` and mirror `data-pp-finale`;
    - in the music block, `setMusicMuted(isSilent || isSequenceMusicOn || celebration.isMusicMuted(now))`;
    - move the `LevelScored` block (`finish`, photo, `enter('result')`) into one function. When a celebration runs it is deferred until `isRunning` is false or `endHoldMs` has passed, counted on the frame loop's real clock;
    - refuse pause while it waits;
    - clear everything on `loading`, restart and error.
  - [ ] `__PP__.fx()` gains `fireworksAlive` and `celebrating`. Add the test hook `__PP__.celebrate()` (debug only). It runs the client half with no sim, for specs that cannot reach a real finale fast.
- [ ] **T6. The framings** (AC 10 to 15, D8 to D11)
  - [ ] `cameraFx.ts`: `SequenceFraming` gains `rollDeg`. Compose it like the perfect's yaw (additive, × blend, 0 under reduced motion). Extend the dirty check. **It does not start a refocus.** `createFramingChain` carries the old roll out.
  - [ ] `levelScene.ts`: `setGrade(grade | null, blend)`. The lights are `level × lerp(1, grade.lightsFactor, blend) × gagFactor`, with the colours lerped. It allocates nothing and writes nothing when unchanged.
  - [ ] `src/client/ui/hud/filmFraming.ts`: the letterbox (one element and its two pseudo-elements), the vignette, and the title card (one element in `pp-type-epic`, Web Animations as `epicStamp.ts` uses, no CSS keyframes). They are siblings placed before `#pp-world`, like the instinct vignette, so the HUD's 40-node budget is not touched. Check how `sequence.spec.ts:185` counts, and say so. `update(world, def, style, blend, clockMs, isMotionReduced)` writes only on change. Reduced-motion rules use `:where(:root[data-pp-motion="reduced"])`, placed after the rule they soften.
  - [ ] `boot.ts › beforeRender`: one read of `currentSequences[world.sequence.lastId]` feeds the camera, the grade and `filmFraming`, through the same chain values. Add the mirrors, and the restart reset list (L720-735).
  - [ ] The readability test (AC 13): the scan for `windowOpenAt` and `feintAt` covers `filmFraming.ts`, `fireworks.ts` and `celebration.ts`. The floor-contrast check of `tools/assets/roomArt.ts` runs with each graded light set in `levelAssets.test.ts`.
- [ ] **T7. Tests** (AC 4 to 16)
  - [ ] Unit tests:
    - the schema bounds and refusals;
    - `fireworks` (pool, colours, reduced count, reset);
    - `celebration` (timing, music mute window, reset);
    - `setGrade` (lerp, gag product, no write when unchanged);
    - `cameraFx` (roll composition, reduced motion, chain);
    - `filmFraming` (blend, title window on the sim clock, pause holding it, reduced motion);
    - the boot end deferral, as an extracted pure decision helper.
  - [ ] E2E. New `tests/e2e/celebration.spec.ts`, using `__PP__.celebrate()`:
    - the cue and its visuals in `cueLog`, `fireworksAlive`, the music mute mirror, reduced motion;
    - `ForceThreat` and `advance` to the salon's end with a finale running: the Result waits, then the photo flashes and the phases run.

    In `sequence.spec.ts` (or a new `framing.spec.ts`), for each sequence:
    - the style mirror, the blend at 1 after `inMs`, the bars' height, Papa outside the bars at both sizes, back to none after `outMs`;
    - a pause holding it;
    - reduced motion: roll 0;
    - the bomb_drop → stealth seam without a pop.

    Pin the real finale in `chambreNight.spec.ts:103`.
  - [ ] Specs to run on Chromium: `celebration`, `sequence`, `chambreNight`, `photo`, `finalRush`, `juice`, `reducedMotion`, `feedback`, `testApi`, `ui`, `bedtimeDuel`, `lullaby`, `bombDrop`, `stealthExit`, `render`, `level`. Check `chambreNight.spec.ts:268` `FRAMING_OUT_STEPS` against any new out-blend. `tests/e2e-dist/dist.spec.ts` also waits for a `cycleDone` end, and the hold of D3 delays its Result by up to `endHoldMs`. It runs only in `e2e:dist`, so read its timeouts now and say so.
- [ ] **T8. Docs**
  - [ ] Update `project-context.md`: a « The finale and the film framings (story 7.4) » paragraph, in the house style.
  - [ ] Update `game-architecture.md`: the E7 row (L978), the `vfx/` tree (L515) gaining `fireworks.ts`, `client/endOfLevel/`, and P7 noting that `FinaleReached` exists for 3.9. Write in French.
  - [ ] Update `deferred-work.md`: close L707 (« 7.4 owns the parody »).
- [ ] **T9. Performance and delivery** (AC 16, 17). Run this under `caffeinate`, alone on the machine, **after the last visual edit**.
  - [ ] Run `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`, then `npx playwright test -c playwright.dist.config.ts --project perf --workers=1` (salon). Record the numbers.
  - [ ] Take the screenshots of AC 17, open them, and say which were opened.
  - [ ] If an autoplay reference moves, regenerate it with `--update-snapshots=all`, open it and say so. A plain `--update-snapshots` let 7.3's soft change pass.

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The finale is the success that closes the level's last wave, or the cycle's completion.** It is the sim's call: an event, `FinaleReached{cause}`. | The client cannot know, when a response is judged, that it is the level's last: more threats may come. The sim already knows it for a wave: `isLastOfWave` starts the ×0.2 `lastThreat` slow-mo, which is the GDD's « dernière menace » (arch L209), and a wave closed to new telegraphs with nothing of it left active cannot have a later success. Threat instances carry the director's wave at telegraph time (`startThreat(…, director.waveIndex)`), so in the salon wave 3's draws carry index 2 even though its own pool is empty. In `chambre_night` the cycle is the level's win: the stealth exit ends it (`CycleCompleted` → `LevelEnded{cycleDone}`) and is no `ResponseResolved`. Most finales come from the salon's last wave, typically between 175 s and 180 s. A micro-sleep cannot follow in the rush, since it keeps `=== 'playing'` (3.5). **Rejected:** a client-side guess from `world.time.slowMos` (reads a time effect's internals, and no tool could count it); a celebration at `LevelEnded` (not « when it is judged », and a lost level would party). |
| D2 | **An event only: no world field, snapshot 28 stays, no new time effect.** The cause decides nothing in the sim. | A world field moves every golden's state hash and the snapshot version. The event moves only the event lists of the goldens that reach a last-wave success or a cycle end, and the final hash proves nothing else moved (T2). The `lastThreat` slow-mo is already the GDD's slowdown; the celebration adds none. « At most one » holds by construction (D1); a test pins it (AC 2). |
| D3 | **The end waits for the celebration, in the client, for at most `endHoldMs` of real time.** | With `cycleDone`, the finale, `LevelEnded` and `LevelScored` share one step. Today `finish()` resets every effect at once, and the scene goes away (`getScene` is null outside `level`), so the celebration would die in its first frame. The world is already frozen (`photo` or `ended`, `ENDED_SYSTEMS`), so letting the frozen room render a few seconds more changes no rule, and the photo is still taken after `finish()` (no firework in it, 3.6 unchanged). The salon's last success can land at 179.9 s; the same rule covers it. |
| D4 | **The cue carries the twins, and the module carries the show.** `finale_reached` has: audio (`music_finale_choir`, `music` bus), a `soundWave` on `papa` with three `pulses`, `haptic: 'fanfare'` and one `flash`. No `fx` preset. | The twin tests and `content:check` already understand a cue. A sim event's cue may not use `uiElement` and may not anchor on `threat` or `object` (contentChecks L231-253). The `fx` presets are a closed enum in `feel.json`, which is hashed (`feelHash`) and would move every golden. The fireworks, stamp and music mute belong to `celebration.ts`, read from `feedback.json › celebration`, which no hash covers. |
| D5 | **`fanfare` is a new haptic kind**, about 6 pulses (for example `[60, 80, 60, 80, 120, 60]`, within 1-8 entries of 1-1000 ms). Its rhythm follows the burst times. | It is the haptic twin the AC names. `heavy` alone is a perfect, and the finale must feel bigger. Safari iOS has no `vibrate`: the visual twins carry it there, as for every cue. |
| D6 | **An original choir « Ah! » swell, about 3-4 s, ours, not Ode to Joy.** The placeholder is synthesized; a generated take only with Geo's prior OK on credits. | The DESIGN cites Peggle as « Outsized celebration » to embrace, not to copy: its Ode to Joy finale is its signature. `music_` on the `music` bus makes the player's music volume control it. About 40 KB at 64 kbps leaves the levels (2,635 KiB in 7.3) under 3 MiB. |
| D7 | **Fireworks are a second pooled `InstancedMesh`**, not the 64-slot particle pool. | That pool has a floor-level origin, fixed colours and a 32-per-burst cap, and a perfect's sparks would steal its slots mid-finale. A second mesh is one draw call, only while shown. Colours are `DESIGN.md` tokens, never `alert`, `parry` or `dodge` (7.3's reserved hues). |
| D8 | **A film grammar is five cheap primitives, all client-side, on the sim clock:** letterbox, grade (the room's lights), vignette, camera roll, and an Epic title card. No post-processing, no shader, no new draw call. | 7.3 and ADR-008 rule out post-processing. The iso camera is fixed, so a « shot » is zoom, pan and roll on top of 4.4's framing. The lights are already per-level data and the gag already scales them. DOM bars and vignette below `#pp-world` keep every marker, verb and ring readable on top. |
| D9 | **Six grammars:** `action` (stay_awake, the « last stand » of a night shift), `rhythm` (lullaby_walk, a stage spotlight: GDD « façon Rhythm Heaven » is a game, so no film), `duel` (bedtime_duel: wide bars, a cold desaturated grade, a slow roll), `defusal` (bomb_drop: thriller), `infiltration` (stealth_exit: dim, cool, heavy vignette), `hostage` (no live sequence: 6.2's « désarmement »). | The epics list four references: action, infiltration, hostage taking, bomb defusal. The five live sequences have three more of their own in the GDD (L304-308). `hostage` is defined now so that 6.2 only has to name it, and a fixture test keeps it valid. **No countdown on `defusal`:** it would read `windowOpenAt` (story 4.6's rule; `layDownProgressPct` is the only exception). |
| D10 | **Titles are Epic register, short.** Each lasts `titleHoldMs` ≤ `EPIC_STAMP_MAX_MS`. Proposed strings for Geo to change: « TENIR JUSQU'À L'AUBE », « LES 100 PAS », « LE DUEL », « DÉSAMORÇAGE », « INFILTRATION », « NÉGOCIATION »; finale stamp « MISSION ACCOMPLIE ». | DESIGN.md L368: Epic is a burst that never owns a screen; stamps last at most 900 ms. |
| D11 | **Bars never hide Papa or the exit.** `letterboxPct` is bounded at 12 % per bar, and an e2e test checks the projections. | The bars cut the room's top and bottom while the zoom of 4.4 is up. Markers are DOM above them, but Papa and the stealth exit are what the player steers by. |
| D12 | **Look in `feedback.json`, choice in the sequence JSON.** The sequence names `style` and `titleKey`; `framingStyles.<id>` holds the numbers. Both keys are optional in the schema. | The AC wants the grammar « défini dans son JSON ». The sequence JSON is inside `levelHash` (`LevelContent.sequences`, `createSim.ts:687`), so tuning the bars or the grade there would change every live level's hash at each touch. The goldens use the fixtures `tests/support/test*.sequence.json`, which stay as they are (optional keys), so no golden moves for the framing. A live level's hash does move once: a journal exported before this story no longer matches this checkout (check how `sim:replay` reports it, and say so). |
| D13 | **No bot change.** The bots play as before; only the report counts finales. | The celebration and the framings are presentation. The perfect bot already completes the cycle (`chambreNight.spec.ts:103`). |

### What exists, and what must keep working

- **`waveState.ts`:** `isLastOfWave` and `isWaveClosed` are pure and stay untouched. **`threatFsm.ts › resolveThreat` (L216-252):** the hitstop, then perfect slow-mo, then `lastThreat` slow-mo. Add the push inside that last branch. **`cycleEnd.ts` (L16-40):** `CycleCompleted` at L39.
- **`flowSystem.ts › runFlow`** checks noise, then cycle, then timer, then rush. `endLevel` emits `LevelEnded` and then `LevelScored` in one step. Untouched.
- **`boot.ts` end (L1502-1520):** `finish()` calls `resetFx()` and the camera reset, then `takeResultPhoto()`, then `enter('result')`, then `onPhoto()` and `PhotoTaken`. Keep that order; only defer the whole block. `getScene` (L491) is null outside `level`. `stopLevelLoops` (L566) fades loops only, so one-shots run on.
- **Music (boot L1160-1188):** `setSequenceMusic` and `setMusicMuted(isSilent || isSequenceMusicOn)` run every frame. `adaptiveMusic` runs only while `isFlowLive`.
- **`FeedbackDirector`:** plays audio, then layers, then haptic, then the ring (sim clock), then flash, then fx. A flash is refused if it comes within 334 ms of the previous one (`screenFlash.ts:46`), hence D3's order, finale flash long before the photo's.
- **Particles (`vfx/particles.ts`):** 64 slots, 32 per burst, octahedra (7.3), real time. Untouched (D7).
- **`epicStamp.ts`:** fixed text today. Extend it without changing the perfect's stamp (`juice.spec.ts`).
- **`cameraFx.ts`:** `SequenceFraming` (L115-121), composition (L281-299), the dirty check (L260-274), `createFramingChain` (L64-108). Its tests are at `cameraFx.test.ts` L320-490. `cameraFx` is the only camera writer, and the shake moves the root.
- **`levelScene.ts` L341-344 and L438-443:** the lights per level, and the gag's `setLightsFactor`, which multiplies the level's own values. The grade must compose with it, never replace it.
- **Adding a haptic kind:** `HAPTIC_KINDS` and `HapticsSchema` (`feedback.ts:16,56-64`), `HapticKind` (`platform.ts:9`), `webHaptics.ts:27-32`, `boot.ts:379-384`, `content/feedback.json`, and the fixtures `tests/support/testContent.ts:44`, `tests/e2e/support/game.ts:22,26`, `createPlatform.test.ts`, `webHaptics.test.ts`.
- **`content:check` cue rules (L204-263):** an `events` key must be an event; no `uiElement` on a sim event's cue; no `threat` or `object` anchor; `fx` needs a `soundWave`; the clip must exist.
- **Sequence presentation already read from state:** the sequence bar, compact timer, music and camera (4.4). Cues come from events (`sequenceCueOf`). Follow the same split: framing from state, celebration from the event.
- **Mirrors:** `mirrorSequenceEvent` (L748-760); the restart reset list (L720-735); `PROD_FORBIDDEN_MARKERS` in `tools/build/inspectDist.ts:64`.

### Testing

- **Sim:** see T1, in Node, in sim steps, asserting drained events.
- **Goldens:** a deliberate regeneration (T2). `npm run golden:update` without first checking each diff is a review failure.
- **E2E: check `env | grep VITE_` first.** This shell exports `VITE_DEBUG_ALLOWED=false`, so wrap dev and e2e in `(unset VITE_DEBUG_ALLOWED; …)`. Use `freeze()` and `advance(n)`, never `waitForTimeout`, except for the real-time hold of D3, which is driven by frames: use `expect.poll`.
- **Before the merge:** one `npm run ci:story`, after the review. `npm run ci` is not needed while 7.5 keeps the epic open.

### Project Structure Notes

- New files: `src/client/render/vfx/fireworks.ts`, `src/client/endOfLevel/celebration.ts` (beside `photo.ts`), `src/client/ui/hud/filmFraming.ts`, with their tests, plus `tests/e2e/celebration.spec.ts`. The architecture tree lists `vfx/particles.ts, screenShake.ts, dangerTint.ts`; add `fireworks.ts` in T8.
- **Variance:** `filmFraming.ts` lives in `ui/hud/` but sits outside `#pp-hud`, like `instinctVignette.ts` and `screenFlash.ts`.
- **Variance:** the architecture's feedback entry has an optional `camera` field (L253) that was never built. The framing's camera stays in the sequence JSON (4.4); do not add `camera` to cues.

### Project Context Rules

- **Layers:** `src/sim` imports no `three` and no DOM, uses no `Math.random`, `Date` or `performance`, and never logs: it emits events. The client imports `@sim` (index only) and never sim internals. Debug code (`__PP__.celebrate`) stays behind `VITE_DEBUG_ALLOWED` and a dynamic import.
- **Golden rule:** every number Geo may tune is data (`feedback.json`, strings). Nothing in `feel.json`: it is hashed.
- **Zero allocation** in `update` and `frame`. Nothing loads during play: the choir clip is decoded with the level.
- **UX:** `parry`, `dodge` and `alert` keep their meaning. Nothing flashes above 3 Hz. Anton only in the Epic register. Strings go through `t(key)`.
- **No `console.*`.** Use `log.warn('render' | 'audio', …)`, and every fallback warns (a missing token, a clip not decoded). Units are suffixes (`endHoldMs`, `letterboxPct`, `rollDeg`, `heightM`, `speedMps`). Import `describe`, `it` and `expect` from `vitest`.
- **Git:** this worktree, branch `story/7-4-celebration-finale-et-cadrages-parodiques`. Commit « Story 7.4 : célébration finale et cadrages parodiques ». Merge only after the review, a green `ci:story` and Geo's OK.
- **Shared machine:** use `caffeinate` for long runs, and run the perf spec alone.

### Previous story intelligence

- **7.3:**
  - `feedback.json › render` is client-only and unhashed; `feel.json` and level content are hashed. That is why D4 and D12 are shaped this way.
  - Reserved hues are guarded by `reservedHueProblems` and `tests/architecture/reservedHues.test.ts`: only `dangerTint.ts` under `render/` names `PALETTE.alert`, `parry` or `dodge`.
  - Floor contrast is computed from the drawn colour with the level's lights (`tools/assets/roomArt.ts`).
  - Budgets were 87 and 79 draw calls, p95 16.7 ms.
  - « Never claim a visual check you did not make. » A plain `--update-snapshots` hid a soft change.
- **3.6:** the photo is taken after `finish()`, in the same task as the render. The CSP forbids image URLs. `photo_taken` must flash.
- **4.4 and 4.10:** the framing is read from state on the sim clock and the chain avoids pops. Open point 6 hands the parody to this story: « tune `zoomPct` and `focusPct` first ».
- **7.6 and 7.7:** generated audio needs Geo's OK before credits are spent, and is recorded in `docs/audio-sources.md`. `GENERATED_CLIPS` protects it from `npm run assets:audio`.
- **Recent commits:** 3.6's photo and 7.3's render merged on `main` (611a5b6). The branch starts from there.

### Latest technical information

No new dependency. In the pinned `three@0.186.1`, `InstancedMesh.setColorAt` creates `instanceColor` on first use: set `instanceColor.needsUpdate = true` after writing, and give each instance a colour before the first render, or the mesh shows black. `navigator.vibrate` takes an array pattern; the 1-8 entry bound is the project's (`feedback.ts:47-55`). No web research was needed beyond what 7.3 recorded.

### Open for Geo

1. **What counts as « the last response » (D1).** Proposed: the success that closes the last wave (the salon, around 175-180 s), and the end of the bedtime cycle (`chambre_night`). The finale does not protect the level. Mama can still wake in the salon's last seconds after it, and the Result then says she woke. Is that the moment you want?
2. **The end waits for the party (D3).** Up to `endHoldMs` (start at 4,000 ms real) of fireworks over the frozen room, then the photo. Too long?
3. **The choir (D6).** The placeholder is synthesized. A generated take costs ElevenLabs credits: the dev asks you first, with the prompt and the price.
4. **Grammars and titles (D9, D10).** `stay_awake` as an action film and `lullaby_walk` as a stage show are my readings: the GDD gives no film for them. The titles are drafts.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.4 (L2397-2413), FR62 (L126)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L30, L42, L87, L298-345, L481-482]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L209, L250-255, P7 L815-826, L978, ADR-006, ADR-008]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L365-368, L443, L519, L556; EXPERIENCE.md L403-433, L466]
- [Source: _bmad-output/project-context.md: Special sequences (4.4), The bedtime cycle (4.10), Three ways to end a level, The final rush (3.5), The end photo (3.6), Feedback rendering UI, Rigged characters, Performance Rules]
- [Source: _bmad-output/implementation-artifacts/7-3-rendu-toon-final-et-effets.md, 4-4-cadre-des-sequences-speciales-et-rester-eveille.md (open point 6), 7-6-musique-generee-du-salon-et-des-sequences.md, deferred-work.md L707]
- [Source: src/sim/director/waveState.ts, src/sim/threats/threatFsm.ts, src/sim/sequences/cycleEnd.ts, src/sim/flow/flowSystem.ts, src/sim/events.ts, src/sim/createSim.ts L524 and L685-687, src/content/schemas/{sequence,feedback}.ts, src/client/render/{cameraFx,levelScene}.ts, src/client/render/vfx/particles.ts, src/client/ui/hud/{epicStamp,instinctVignette,sequenceBar,screenFlash}.ts, src/client/boot.ts, tools/content/contentChecks.ts, tools/sim/simReport.ts, tools/build/inspectDist.ts, tests/e2e/{sequence,chambreNight,photo,juice}.spec.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
