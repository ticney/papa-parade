---
baseline_commit: e4ebdb6508649c353827e29f101de9dd56c098d0
---

# Story 7.4: Célébration finale et cadrages parodiques

Status: review

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want an outsized celebration on a level's last response, and film framings for each sequence,
so that I live the epic / mundane contrast.

**Requirements covered:** FR62, FR79 (GDD v2.4: Papa's victory dance and collapse, added by the sprint change proposal of 2026-11-08, §4.4). **Depends on:** the sequence framing of 4.4 (`framing.camera`, `sequenceFramingBlendAt`, `createFramingChain` from 4.10), the bedtime cycle of 4.10 (`CycleCompleted`), the final rush and the photo of 3.5 and 3.6, the render of 7.3 (`feedback.json › render`, the per-level lights, `reservedHueProblems`, the particle pool), the early return of 3.16 (`LevelEnded{reason: 'mamaHome'}`), the rigged characters of 7.2 (`characterClips.ts`, `characterArt.ts`).

**Base (checked on 2026-11-08):** this branch was cut from `611a5b6`, 106 commits behind `main` that day: 3.12 to 3.16, Epic 9, 3.7, 3.8 and the v2.4 planning came since, and `mamaHome` does not exist on it yet. **Merge `main` into the branch before T1**, then re-check every line reference, the snapshot version and the level names below: they were written against the old base.

**Scope:**
- **The finale.** The sim names the level's last success with one new event, `FinaleReached` (D1, D2). The client plays a celebration on it: an opera-choir sting, fireworks over the room, an Epic stamp, a flash, and a `fanfare` vibration (D4 to D7). The end of the level waits for the celebration to finish before the photo (D3).
- **The film framings.** A sequence's JSON names a film grammar: `framing.style` and `framing.titleKey`. The client draws it while the sequence runs: letterbox bars, a grade through the room's lights, a vignette, a camera roll and an Epic title card. The look of each grammar is data in `feedback.json › framingStyles` (D8 to D12).
- **Papa's two moves (v2.4).** Papa dances his victory dance in the celebration, and collapses when Mama comes home early (D14).

**Not in this story:**
- The highlight replay (3.9). `FinaleReached` is a natural highlight there; 3.9 decides its score.
- Mama's reactions (3.7) and the music per age (7.5).
- A new sequence, including the hostage negotiation (6.2). Its grammar is defined here and is used by no live sequence yet (D9).
- Any change to timing, windows, slow-mos, bots' choices or `feel.json` (D2, D13).

## Acceptance Criteria

The epics' criteria are:
- *Given a level's last successful response, when it is judged, then a celebration (opera choir, fireworks) plays, with its visual and haptic equivalents.*
- *Given each special sequence, when it plays, then it applies the visual grammar of its reference (action, infiltration, hostage taking, bomb defusal), defined in its JSON.*
- *Given a level that ends without Mama coming home early, when the final celebration plays, then Papa dances his victory dance in it (GDD v2.4).* (added on 2026-11-08)
- *Given « Maman est rentrée plus tôt ! » (catastrophe gauge at 100 %), when the door opens, then Papa collapses, as a gag and with no injury (NFR9; GDD v2.4, read as the lost level only).* (added on 2026-11-08)

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
    - reduced motion on one sequence and on the fireworks;
    - Papa mid-dance, and Papa collapsed (AC 18, 19).

    Every image not opened is listed as not opened. The merge waits for Geo's visual OK.

**Papa's dance and collapse (v2.4, added on 2026-11-08)**

18. **Papa dances in the celebration.** On `FinaleReached`, Papa plays a new one-shot, `victory_dance` (`characterClips.ts › papaOneShotOf`). It belongs to the celebration: the end hold of D3 covers it, and the photo is still taken after `finish()`. It changes no position, no timing and no world field (D2 holds). Under reduced motion it still plays, since a pose carries a state (`EXPERIENCE.md`); only the squash is off. An e2e test reads Papa's clip (`clipsOf`, as `characters.spec.ts` does) and sees `victory_dance` after a finale.
19. **Papa collapses when Mama comes home early.** On `LevelEnded{reason: 'mamaHome'}` (story 3.16), Papa plays a new one-shot, `collapse`, as the door opens: a gag, with no injury (NFR9). It plays on that end only, never on `timer`, `cycleDone` or `mamaWoke` (D14). An e2e test forces the catastrophe gauge to 100 % and sees `collapse`.
20. **Both clips keep the character contract.** They are authored in `assets-src/blender/characters/papa.blend` like 7.2's clips, listed in Papa's contract in `tools/assets/characterArt.ts`, and pass `tests/architecture/characterAssets.test.ts` under `CHARACTER_GLB_MAX_BYTES`. Neither lifts Papa or moves his feet off the floor (D8 of 7.2). No golden moves for them.

## Tasks / Subtasks

- [x] **T1. The event in the sim** (AC 1, 2, D1)
  - [x] `src/sim/events.ts`: add `{ type: 'FinaleReached'; t: SimMs; cause: FinaleCause; threatId: number | null }`, plus `FinaleCause = 'lastWave' | 'cycleDone'` and the `FINALE_CAUSES` list beside `LEVEL_END_REASONS`. Add it to `SIM_EVENT_TYPES` and export the type through `src/sim/index.ts`.
  - [x] `threatFsm.ts › resolveThreat`, inside the `isLastOfWave` branch, after `startSlowMo('lastThreat')`: when `threat.waveIndex === ctx.level.waves.length - 1`, push the event. **Do not compute `isLastOfWave` twice.**
  - [x] `sequences/cycleEnd.ts › advanceCycle`: push it right after `CycleCompleted`. `cycleEnd.ts` stays free of threat code.
  - [x] Unit tests, in sim steps:
    - a single-wave test level: the last success emits it and an earlier success does not;
    - a two-wave level: the last of wave 0 does not, the last of wave 1 does;
    - a `fail` on the last threat does not; a micro-sleep resolved later does not;
    - the cycle's last entry emits `CycleCompleted`, `FinaleReached{cycleDone}`, `LevelEnded{cycleDone}` in this order at one `t`;
    - a `mamaWoke` end in the same step as a last success: `runThreats` runs before `runFlow`, so the finale comes first. Pin the order, and say so in the notes.
- [x] **T2. Goldens and reports** (AC 2, 3, 9)
  - [x] Run `npm test` and list the goldens that fail. For each one, check that the diff of its `.expected.json` adds `FinaleReached` entries and changes nothing else (same final hash, same other events). Then run `npm run golden:update` and list them in the notes. **If anything else moves, stop: the event is not presentation-only.**
  - [x] `tools/sim/simReport.ts`: add `finales: { lastWave, cycleDone }`, plus its line in `simArgs.ts`'s help. Diff the reports of the four bots on both levels at seed 1 against `main` (AC 3).
  - [x] The « 0 or 1 finale, never after `LevelEnded` » test (AC 2), in `tests/` beside the other bot-level checks.
- [x] **T3. Data** (AC 4, 10, 11, D5, D9, D12)
  - [x] `src/content/schemas/feedback.ts`:
    - `HAPTIC_KINDS` gains `fanfare`. Follow the six places `heartbeat` touched (story 2.9), listed under « What exists » below.
    - `celebration`: `{ endHoldMs, musicMuteMs, stampMs (≤ EPIC_STAMP_MAX_MS), fireworks: { bursts: { atMs, xPct, zPct, heightM, sparks }[], speedMps, lifeMs, sizeM, colorTokens } }`.
    - `framingStyles`: a strict record over `FRAMING_STYLE_IDS`.

    Bounds go in the schema and `tests/content/feedbackSchema.test.ts` keeps its unit-suffix rule (add a suffix only if a key needs it, anchored as 7.3 did).
  - [x] `src/content/schemas/sequence.ts › FramingSchema`: add `style?` and `titleKey?`, with a `superRefine` that refuses `titleKey` without `style`. Put `FRAMING_STYLE_IDS` in `src/shared/constants.ts`.
  - [x] `content/feedback.json`: the rows, the cue `finale_reached`, and `events.FinaleReached`. `content/sequences/*.json`: style and title. `content/strings.fr.json`: `stamp.finale` and the five `framing.title_*` (D10). Run `npm run content:schemas`.
  - [x] `tools/content/contentChecks.ts`:
    - a `titleKey` that is not in the strings;
    - a `colorTokens` entry that is not a `DESIGN.md` colour, or is `alert`, `parry` or `dodge`;
    - a grade whose colours fail `reservedHueProblems`;
    - a burst outside its bounds.

    Each refusal gets a test, as 7.3's review asked.
- [x] **T4. The choir clip** (AC 4, D6)
  - [x] `tools/audio/makePlaceholderAudio.ts`: a placeholder `music_finale_choir`, a stacked « aah » chord swell of about `musicMuteMs`. Commit the `.m4a`.
  - [x] **The generated take needs Geo's OK before any credit is spent** (7.6's rule). Propose one ElevenLabs prompt and its cost in chat. Only once he agrees, generate, cut with `tools/audio/cutMusicLoop.ts` or by hand, record it in `docs/audio-sources.md` and add it to `GENERATED_CLIPS`. Without his OK, the placeholder ships and the notes say so.
- [x] **T5. Fireworks and the celebration** (AC 4 to 9, D3 to D7)
  - [x] `src/client/render/vfx/fireworks.ts`: one `InstancedMesh` of octahedra, with its own pool sized from the data's largest total (assert it is under a `FIREWORK_POOL_SIZE` constant). Colours go through `setColorAt` from `colorTokens`, resolved through `PALETTE` or the tokens. Each spark is placed by a golden-angle sphere, deterministic, with no `Math.random`. It runs on real time and `update` allocates nothing. `reset()` and `dispose()` exist and `aliveCount` is exposed. It is added under `content_root`. `resetFx` hides it.
  - [x] `src/client/endOfLevel/celebration.ts`: `createCelebration({ fireworks, stamp, … })` with `start(atReal, isMotionReduced)`, `isRunning(nowReal)`, `isMusicMuted(nowReal)`, `frame(nowReal)` and `reset()`. Reuse the epic stamp element, with a `show(text, …)` or a second instance. Keep the stamp under `EPIC_STAMP_MAX_MS`.
  - [x] `boot.ts`:
    - on `FinaleReached`, call `celebration.start` and mirror `data-pp-finale`;
    - in the music block, `setMusicMuted(isSilent || isSequenceMusicOn || celebration.isMusicMuted(now))`;
    - move the `LevelScored` block (`finish`, photo, `enter('result')`) into one function. When a celebration runs it is deferred until `isRunning` is false or `endHoldMs` has passed, counted on the frame loop's real clock;
    - refuse pause while it waits;
    - clear everything on `loading`, restart and error.
  - [x] `__PP__.fx()` gains `fireworksAlive` and `celebrating`. Add the test hook `__PP__.celebrate()` (debug only). It runs the client half with no sim, for specs that cannot reach a real finale fast.
- [x] **T5b. Papa's two clips** (AC 18 to 20, D14)
  - [x] `assets-src/blender/characters/papa.blend`: author `victory_dance` (no longer than `celebration.endHoldMs`) and `collapse` (ends lying down, and holds). Export with `npm run assets:character:export`, then `npm run assets:character:optimize`.
  - [x] `tools/assets/characterArt.ts`: add both clips to Papa's contract. `tests/architecture/characterAssets.test.ts` passes on the committed file.
  - [x] `characterClips.ts › papaOneShotOf`: `FinaleReached` → `victory_dance`; `LevelEnded` with `reason: 'mamaHome'` → `collapse`. Unit tests for both, and for the ends that play nothing.
  - [x] E2E: the dance after a finale (`celebration.spec.ts`); the collapse after a forced catastrophe, beside the e2e spec of the early return (story 3.16).
- [x] **T6. The framings** (AC 10 to 15, D8 to D11)
  - [x] `cameraFx.ts`: `SequenceFraming` gains `rollDeg`. Compose it like the perfect's yaw (additive, × blend, 0 under reduced motion). Extend the dirty check. **It does not start a refocus.** `createFramingChain` carries the old roll out.
  - [x] `levelScene.ts`: `setGrade(grade | null, blend)`. The lights are `level × lerp(1, grade.lightsFactor, blend) × gagFactor`, with the colours lerped. It allocates nothing and writes nothing when unchanged.
  - [x] `src/client/ui/hud/filmFraming.ts`: the letterbox (one element and its two pseudo-elements), the vignette, and the title card (one element in `pp-type-epic`, Web Animations as `epicStamp.ts` uses, no CSS keyframes). They are siblings placed before `#pp-world`, like the instinct vignette, so the HUD's 40-node budget is not touched. Check how `sequence.spec.ts:185` counts, and say so. `update(world, def, style, blend, clockMs, isMotionReduced)` writes only on change. Reduced-motion rules use `:where(:root[data-pp-motion="reduced"])`, placed after the rule they soften.
  - [x] `boot.ts › beforeRender`: one read of `currentSequences[world.sequence.lastId]` feeds the camera, the grade and `filmFraming`, through the same chain values. Add the mirrors, and the restart reset list (L720-735).
  - [x] The readability test (AC 13): the scan for `windowOpenAt` and `feintAt` covers `filmFraming.ts`, `fireworks.ts` and `celebration.ts`. The floor-contrast check of `tools/assets/roomArt.ts` runs with each graded light set in `levelAssets.test.ts`.
- [x] **T7. Tests** (AC 4 to 16)
  - [x] Unit tests:
    - the schema bounds and refusals;
    - `fireworks` (pool, colours, reduced count, reset);
    - `celebration` (timing, music mute window, reset);
    - `setGrade` (lerp, gag product, no write when unchanged);
    - `cameraFx` (roll composition, reduced motion, chain);
    - `filmFraming` (blend, title window on the sim clock, pause holding it, reduced motion);
    - the boot end deferral, as an extracted pure decision helper.
  - [x] E2E. New `tests/e2e/celebration.spec.ts`, using `__PP__.celebrate()`:
    - the cue and its visuals in `cueLog`, `fireworksAlive`, the music mute mirror, reduced motion;
    - `ForceThreat` and `advance` to the salon's end with a finale running: the Result waits, then the photo flashes and the phases run.

    In `sequence.spec.ts` (or a new `framing.spec.ts`), for each sequence:
    - the style mirror, the blend at 1 after `inMs`, the bars' height, Papa outside the bars at both sizes, back to none after `outMs`;
    - a pause holding it;
    - reduced motion: roll 0;
    - the bomb_drop → stealth seam without a pop.

    Pin the real finale in `chambreNight.spec.ts:103`.
  - [x] Specs to run on Chromium: `celebration`, `sequence`, `chambreNight`, `photo`, `finalRush`, `juice`, `reducedMotion`, `feedback`, `testApi`, `ui`, `bedtimeDuel`, `lullaby`, `bombDrop`, `stealthExit`, `render`, `level`. Check `chambreNight.spec.ts:268` `FRAMING_OUT_STEPS` against any new out-blend. `tests/e2e-dist/dist.spec.ts` also waits for a `cycleDone` end, and the hold of D3 delays its Result by up to `endHoldMs`. It runs only in `e2e:dist`, so read its timeouts now and say so.
- [x] **T8. Docs**
  - [x] Update `project-context.md`: a « The finale and the film framings (story 7.4) » paragraph, in the house style.
  - [x] Update `game-architecture.md`: the E7 row (L978), the `vfx/` tree (L515) gaining `fireworks.ts`, `client/endOfLevel/`, and P7 noting that `FinaleReached` exists for 3.9. Write in French.
  - [x] Update `deferred-work.md`: close L707 (« 7.4 owns the parody »).
- [x] **T9. Performance and delivery** (AC 16, 17). Run this under `caffeinate`, alone on the machine, **after the last visual edit**.
  - [x] Run `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`, then `npx playwright test -c playwright.dist.config.ts --project perf --workers=1` (salon). Record the numbers.
  - [x] Take the screenshots of AC 17, open them, and say which were opened.
  - [x] If an autoplay reference moves, regenerate it with `--update-snapshots=all`, open it and say so. A plain `--update-snapshots` let 7.3's soft change pass.

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
| D14 | **Papa's two moves are one-shots chosen from events, like every one-shot (D5 of 7.2).** The dance belongs to the celebration (`FinaleReached`). The collapse belongs to the early return only (`mamaHome`), read as the lost level. **Approved by Geo on 2026-11-08** (sprint change proposal of that day, §4.4). If story 7.9 (skeleton v2) lands first, author both clips on its skeleton; otherwise 7.9 retakes them with every other clip. | GDD v2.4, « Réactions » of Papa's panel: « effondrement quand Maman rentre ; danse de victoire en fin de niveau réussie (elle alimente la célébration finale) ». If he collapsed every time Mama comes home, he would also collapse at the end of a won level, against the dance. Both are presentation: the sim does not change, and a character `.glb` is in none of `feelHash`, `geometryHash` or `levelHash`, so no golden moves for them. |

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
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08.md §4.4; gdd.md v2.4, « Animation des personnages », Papa's panel, « Réactions » (on `main`)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L30, L42, L87, L298-345, L481-482]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L209, L250-255, P7 L815-826, L978, ADR-006, ADR-008]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L365-368, L443, L519, L556; EXPERIENCE.md L403-433, L466]
- [Source: _bmad-output/project-context.md: Special sequences (4.4), The bedtime cycle (4.10), Three ways to end a level, The final rush (3.5), The end photo (3.6), Feedback rendering UI, Rigged characters, Performance Rules]
- [Source: _bmad-output/implementation-artifacts/7-3-rendu-toon-final-et-effets.md, 4-4-cadre-des-sequences-speciales-et-rester-eveille.md (open point 6), 7-6-musique-generee-du-salon-et-des-sequences.md, deferred-work.md L707]
- [Source: src/sim/director/waveState.ts, src/sim/threats/threatFsm.ts, src/sim/sequences/cycleEnd.ts, src/sim/flow/flowSystem.ts, src/sim/events.ts, src/sim/createSim.ts L524 and L685-687, src/content/schemas/{sequence,feedback}.ts, src/client/render/{cameraFx,levelScene}.ts, src/client/render/vfx/particles.ts, src/client/ui/hud/{epicStamp,instinctVignette,sequenceBar,screenFlash}.ts, src/client/boot.ts, tools/content/contentChecks.ts, tools/sim/simReport.ts, tools/build/inspectDist.ts, tests/e2e/{sequence,chambreNight,photo,juice}.spec.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), dev-story, 2026-11-08.

### Debug Log References

- `main` (bcc9017) merged into the branch before T1 (`e4ebdb6`, the base recorded as `baseline_commit`): only `sprint-status.yaml` conflicted (main's version kept, this story set to `in-progress`). After the merge `ci:fast` was green (460 files, 10,206 tests). The level names, the snapshot version (28) and the line references were re-read on the merged code: three live levels now (`salon_kitchen`, `salon_crawler`, `chambre_night`), all three listing the five sequences.
- Baseline `npm run sim` reports (4 bots × 3 levels, seed 1, 5 runs) were written before the first sim edit, then compared with the reports after T1 and again at the end (scratchpad, not committed).
- `papa.blend` authored headless (`Blender -b … -P <scratchpad script>`, Blender 5.2.3), never through the live MCP session; the script stayed in the scratchpad, the `.blend1` backup was deleted.

### Completion Notes List

**Sim (T1, T2).**
- `FinaleReached{t, cause, threatId}` with `FinaleCause`, `FINALE_CAUSES` (and its completeness proof), in `SIM_EVENT_TYPES` and `@sim`. `resolveThreat` pushes `lastWave` inside the one `isLastOfWave` branch, right after the `lastThreat` slow-mo, when `threat.waveIndex === ctx.level.waves.length - 1`; `advanceCycle` pushes `cycleDone` right after `CycleCompleted` (`cycleEnd.ts` has no threat code).
- Pinned order: a `mamaWoke` in the step of the last success comes **after** the finale (`runThreats`, and `advanceCycle` via the sequence end, run before `runFlow`): `CycleCompleted`, `FinaleReached{cycleDone}`, `MamaWoke`, `LevelEnded{mamaWoke}` in a cycle tie with the noise. Tests in `src/sim/threats/finale.test.ts` (one wave, two waves, a fail, a micro-sleep after the last wave closed, the mamaWoke tie) and `bedtimeCycle.test.ts`.
- Goldens: only `bedtime_cycle_won` failed; its `.expected.json` gained `"FinaleReached"` in the event list and a new `eventsHash`, its `worldHash` unchanged; regenerated with `npm run golden:update` (deliberate). `golden:update` also rewrote `mama_woke.expected.json` with a different line wrapping only: reverted.
- `simReport`: `finales: { lastWave, cycleDone }` per run and over the runs, help line in `simArgs.ts`. Reports vs the baseline (4 bots × 3 levels, seed 1, 5 runs): **identical except `finales` and `hashes.level`** (the sequence JSONs gained `style`/`titleKey`, D12). Finales seen: `perfect` 5/5 `lastWave` on `salon_kitchen`, 3/5 on `salon_crawler` (a wave can close with nothing of it active, 1.18 D7: no last threat, no finale), 5/5 `cycleDone` on `chambre_night`; `human` 3, 2 and 4; `idle` and `random` 0. `tests/bots/finaleLive.test.ts` plays the four bots on the **three** live levels (seed 1 to 5): 0 or 1 a game, never after `LevelEnded` (200 steps played past it), and the perfect bot does reach it.
- `sim:replay` and the level hash (D12): a `papa-parade.run` recorded before this story is refused, exit 1: « cannot replay this game: the journal was recorded on another level than the given one (chambre_night) (was the content changed since it was recorded?) » (checked by replaying a run file with a stale `levelHash`).
- Where a test goes: the finale's rules are proven in Vitest (sim tests, the live bots, the report); the e2e specs only check the client wiring.

**Data (T3, T4).**
- `HAPTIC_KINDS` gains `fanfare` (`[80, 420, 80, 520, 80, 620, 120]`: a pulse on each of the first four bursts), through the six places of 2.9 (`platform.ts`, `webHaptics.ts`, `boot.ts`, the fixtures, `tests/e2e/support/game.ts`).
- `feedback.json › celebration` (`endHoldMs` 4000, `collapseHoldMs` 1600, `musicMuteMs` 3600, `stampMs` 900, `fireworks`: five bursts of 248 sparks in all, `areaHalfM` 3, `speedMps` 3.2, `lifeMs` 1500, `sizeM` 0.12, five colour tokens) and `framingStyles` (a strict object over `FRAMING_STYLE_IDS`). `FRAMING_STYLE_IDS`, `LETTERBOX_MAX_PCT` (12) and `FIREWORK_POOL_SIZE` (256) in `shared/constants.ts`. Bounds in the schema; the unit-suffix rule anchors `sizeM`, `areaHalfM`, `sparks` and `lightsFactor` (commented as 7.3 did).
- `FramingSchema` gains `style` and `titleKey` (`framing.title_*`), a refine refuses a title with no style; the five live sequences name theirs (D9); the fixtures `tests/support/test*.sequence.json` are untouched, and `sequenceSchema.test.ts`'s same-shape check leaves the two presentation keys out.
- Strings: `stamp.finale` « MISSION ACCOMPLIE » and the six `framing.title_*` of D10, as proposed.
- **Variances, said here:** the colour tokens of a firework are a schema enum (`FIREWORK_COLOR_TOKENS`: `primary`, `gauge-calm`, `mama-calm`, `smell`, `paper`), so an unknown, reserved (`alert`, `parry`, `dodge`) or near-reserved (`star`, on `alert`'s hue) token is refused when the file is read, not only by `content:check`; an unknown `titleKey` is refused by `content:check`'s generic `…Key` rule (`checkStringReferences`), not a new check; a burst out of bounds and an overflowing pool are schema refusals. Each refusal has its test (`tests/content/checkFramings.test.ts`). The grade colours' reserved-hue rule and the floor contrast under each grade are in `tests/architecture/levelAssets.test.ts`, which has DESIGN.md's tokens (`content:check` does not read DESIGN.md).
- **The choir (T4):** a synthesized placeholder, `synthFinaleChoir` (two detuned voices a note through two « ah » formants, C, F/C, C, a 0.9 s swell), 3.6 s, 33 KB. **No credit was spent:** the generated take waits for Geo's OK (prompt and cost in the closing message), so `docs/audio-sources.md` and `GENERATED_CLIPS` are unchanged.

**Client (T5, T5b, T6).**
- `render/vfx/fireworks.ts`: one `InstancedMesh` of `FIREWORK_POOL_SIZE` octahedra under `content_root`, every instance coloured before the first render, golden-angle spheres (no `Math.random`), real time, `update` allocates nothing, hidden (`visible = false`, `count` 0) when idle, so it costs a draw call only while shown. **Placement changed after the first screenshots:** on the room's whole floor the big room's follow camera showed almost none of them; the bursts now go off in a square of `areaHalfM` around the floor point the camera looks at, cut to the room (`fireworkAreaOf`), and the sparks were made bigger (0.07 → 0.12 m).
- `endOfLevel/celebration.ts` (fireworks, the second stamp « MISSION ACCOMPLIE », the music mute window) and `endOfLevel/endHold.ts` (the pure decision of D3: `request` at `LevelScored`, `frame` each frame, each frame worth at most `END_HOLD_FRAME_CAP_MS` so a hidden tab holds the wait). `boot.ts`: the `LevelScored` block keeps the score, Mama's lines and the highlights at once and moves `finish()`, the photo and `enter('result')` into `endTheLevel()`, run at once with nothing to wait for (exactly as before) or by the frame loop when the hold ends. While it waits: the loop runs (the sim keeps only its clock, so the dance and the rings play; the exported journal replays to `world.time.sim` as before), `endHold.isPending` blocks the input mapper and the move intent, and `pause.setRefused(true)` refuses every pause (`pauseController.setRefused`, new). `onFxReset` resets the celebration and drops a wait.
- **D14 variance:** the early return holds the end too, for `celebration.collapseHoldMs` (1.6 s), or Papa's collapse would never be seen (`finish()` resets the characters in the same frame). A `LevelEnded{mamaHome}` also resets a celebration under way (closes the 3.16 deferred item: a `mamaHome` is no finished level). This changes the `mamaHome` end by 1.6 s; `catastrophe.spec.ts` passes as it was.
- Papa's two clips: `victory_dance` (84 frames, 2.8 s: a disco point switching sides every 12 frames, the hips swaying, then a V and back to rest; the lowest point −4 mm, under the 3 cm floor slack) and `collapse` (34 frames: the knees give, he tips over backwards and lies flat, arms and legs splayed; the root is lifted per frame by exactly what keeps his lowest point on the floor). `papa.glb` 65 KB (59 KB before), under `CHARACTER_GLB_MAX_BYTES`. `papaOneShotOf`: `FinaleReached` → `victory_dance`, `LevelEnded{mamaHome}` → `collapse`, nothing on the other ends. Two lists: `PAPA_HELD_ONE_SHOTS` (`collapse` stays on its last frame: `playOnce(…, holdsLastPose)` in the rig) and `PAPA_DEFERRED_ONE_SHOTS` (the finale comes with the last response, mid-glide, when a one-shot is dropped: the dance waits for the glide and the response pose to end, or plays at once once the level is over). The contract lives in `characterClips.ts › PAPA_CONTRACT` (which `tools/assets/characterArt.ts` checks), so that is where the clips were listed.
- The framings: `SequenceFraming` gains the look (`rollDeg`, `letterboxPct`, `vignetteOpacityPct`, the grade and its weight, the carried grade and its weight; `createSequenceFraming()`), the chain carries all of it at a seam, `cameraFx` rolls about the view axis after the turn (dirty-checked, 0 under reduced motion, no refocus), `render/grade.ts` mixes up to two grades into the level's lights (weights scaled down past 1, exactly the level's lights at 0), `levelScene.setGrade` writes the lights only on change with the gags' factor on top, and `ui/hud/filmFraming.ts` draws the three layers (vignette, bars, title) before `#pp-world`. **The bars got a 2 px `ink-soft` inner edge after the first screenshots:** the scene's background is ink, so an ink bar alone did not read.
- `sequence.spec.ts:185` counts `#pp-hud *`: the film layers are siblings outside `#pp-hud`, not counted (the HUD budget is untouched).
- Mirrors `data-pp-finale`, `data-pp-end-hold`, `data-pp-framing-style` (in `PROD_FORBIDDEN_MARKERS` and the dist fixture); `__PP__.fx()` gains `fireworksAlive`, `celebrating`, `framing`; `__PP__.celebrate()` (debug only).

**Tests (T7).** Unit: the schema refusals, `fireworks` (pool, colours, sphere, reduced count, reset, determinism, the area), `celebration`, `endHold`, `grade`, `setGrade` (lerp, gag product, no write, reset), `cameraFx` (roll, reduced motion, dirty check, no refocus, the seam with no drawn value jumping by a tenth), `filmFraming` (blend, title on the sim clock, pause, slow-mo, reduced motion, no CSS keyframes), the pause refusal, the clips and the held one-shot, `celebrate()`. E2E (extended tier, not in `SMOKE_SPECS`): new `celebration.spec.ts` and `framing.spec.ts`, a collapse test in `catastrophe.spec.ts`, the real `cycleDone` finale pinned in `chambreNight.spec.ts`'s perfect-bot test. `e2e:dist`: `dist.spec.ts` waits for `data-pp-end-reason="cycleDone"`, mirrored at `LevelEnded`, before the hold, and its Result waits have a 30 s margin over the level: the hold (≤ 4 s) fits (read, not run: `e2e:dist` is `ci`'s).

**Performance and delivery (T9)**, run after the last visual edit, alone, under `caffeinate` (through the heavy-check lock):
- `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`: OK, the heaviest level payload 2,827.4 KiB (the choir adds 33 KB, `papa.glb` 6 KB), first load 4,497.8 KiB gzip.
- `perf.spec.ts` (salon, a whole level at speed 1, 16,729 frames): p95 16.7 ms (mean 16.68, max 149.9), draw calls max 90 (87 in 7.3; the fireworks are one draw call, only while shown), triangles max 20,110. Budgets ≤ 20 ms, ≤ 100, ≤ 100k: held.
- No autoplay screenshot reference was run or regenerated (the story changed nothing of a level at rest outside a sequence or a finale).
- Screenshots (`7-4-screenshots/`, taken by a throwaway spec, not committed): the five sequences at full blend at 844 × 390, `bedtime_duel` and `stealth_exit` at 667 × 375, `bedtime_duel`'s title card, reduced motion on `bedtime_duel` and on the fireworks, the fireworks mid-burst in `salon_kitchen` and `chambre_night`, Papa mid-dance (three crops and the room) and collapsed (falling, down, and the room). **Opened** after the last edit: all five 844 × 390 sequences except `stay_awake` and `bedtime_duel`'s title (both opened before the bars' edge was added, same picture but for that edge), `667x375-stealth_exit`, both fireworks, the reduced fireworks, the reduced duel, `papa-dance-1`, `papa-collapse-falling`, the collapse room. **Not opened after the last edit:** `667x375-bedtime_duel-full-blend.png`, `844x390-papa-dance-room.png`, `papa-dance-2.png` and `papa-collapse-down.png` (opened in the first take, clips unchanged since), `papa-dance-3.png`. What they show: the bars read thanks to the inner edge; the grades are subtle; in the big room the fireworks stay small on screen (`sizeM` and `speedMps` are Geo's to tune). The merge waits for Geo's visual OK.

**Docs (T8).** `project-context.md` (« The finale and the film framings »), `game-architecture.md` (the E7 row, the `vfx/`, `hud/` and `endOfLevel/` trees, P7's finale), `deferred-work.md` (L707 and the 3.16 `mamaHome` item closed), CLAUDE.md (`finales` in the sim report).

### File List
- `CLAUDE.md`
- `_bmad-output/implementation-artifacts/7-4-celebration-finale-et-cadrages-parodiques.md`
- `_bmad-output/implementation-artifacts/7-4-screenshots/` (19 PNG, new)
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/game-architecture.md`
- `_bmad-output/project-context.md`
- `assets-src/blender/characters/papa.blend`
- `content/_schemas/feedback.schema.json`
- `content/_schemas/sequence.schema.json`
- `content/feedback.json`
- `content/sequences/bedtime_duel.json`
- `content/sequences/bomb_drop.json`
- `content/sequences/lullaby_walk.json`
- `content/sequences/stay_awake.json`
- `content/sequences/stealth_exit.json`
- `content/strings.fr.json`
- `public/assets/audio/music_finale_choir.m4a` (new)
- `public/assets/characters/papa.glb`
- `src/client/app/levelSession.test.ts`
- `src/client/app/pauseController.test.ts`
- `src/client/app/pauseController.ts`
- `src/client/app/testHost.ts`
- `src/client/boot.ts`
- `src/client/endOfLevel/celebration.test.ts` (new)
- `src/client/endOfLevel/celebration.ts` (new)
- `src/client/endOfLevel/endHold.test.ts` (new)
- `src/client/endOfLevel/endHold.ts` (new)
- `src/client/feedback/feedbackDirector.test.ts`
- `src/client/input/hitTest.test.ts`
- `src/client/render/cameraFx.test.ts`
- `src/client/render/cameraFx.ts`
- `src/client/render/followRig.test.ts`
- `src/client/render/grade.test.ts` (new)
- `src/client/render/grade.ts` (new)
- `src/client/render/levelScene.test.ts`
- `src/client/render/levelScene.ts`
- `src/client/render/vfx/fireworks.test.ts` (new)
- `src/client/render/vfx/fireworks.ts` (new)
- `src/client/render/views/characterClips.test.ts`
- `src/client/render/views/characterClips.ts`
- `src/client/render/views/characterRig.test.ts`
- `src/client/render/views/characterRig.ts`
- `src/client/render/views/papaView.ts`
- `src/client/ui/hud/filmFraming.test.ts` (new)
- `src/client/ui/hud/filmFraming.ts` (new)
- `src/client/ui/styles/ui.css`
- `src/content/schemas/feedback.ts`
- `src/content/schemas/sequence.ts`
- `src/debug/testApi.test.ts`
- `src/debug/testApi.ts`
- `src/platform/createPlatform.test.ts`
- `src/platform/platform.ts`
- `src/platform/web/webHaptics.test.ts`
- `src/platform/web/webHaptics.ts`
- `src/shared/constants.ts`
- `src/sim/events.test.ts`
- `src/sim/events.ts`
- `src/sim/index.ts`
- `src/sim/sequences/bedtimeCycle.test.ts`
- `src/sim/sequences/cycleEnd.ts`
- `src/sim/threats/finale.test.ts` (new)
- `src/sim/threats/threatFsm.ts`
- `tests/architecture/characterAssets.test.ts`
- `tests/architecture/levelAssets.test.ts`
- `tests/bots/finaleLive.test.ts` (new)
- `tests/content/checkFramings.test.ts` (new)
- `tests/content/feedbackSchema.test.ts`
- `tests/content/sequenceSchema.test.ts`
- `tests/e2e/catastrophe.spec.ts`
- `tests/e2e/celebration.spec.ts` (new)
- `tests/e2e/chambreNight.spec.ts`
- `tests/e2e/framing.spec.ts` (new)
- `tests/e2e/support/game.ts`
- `tests/e2e/support/testApi.ts`
- `tests/golden/journals/bedtime_cycle_won.expected.json`
- `tests/support/fakeTestHost.ts`
- `tests/support/testContent.ts`
- `tests/tools/build/checkDist.test.ts`
- `tests/tools/sim/finaleReport.test.ts` (new)
- `tests/tools/sim/simReport.test.ts`
- `tools/audio/makePlaceholderAudio.ts`
- `tools/build/inspectDist.ts`
- `tools/sim/simArgs.ts`
- `tools/sim/simReport.ts`

## Change Log

- 2026-11-08: Story 7.4 implemented (dev-story): `FinaleReached` in the sim, the celebration and the end that waits for it, Papa's victory dance and collapse, the film grammars of the five sequences. Goldens: `bedtime_cycle_won` regenerated on purpose (one event added, world hash unchanged).
