---
baseline_commit: 501ffee
---

# Story 3.9: Replay des meilleurs moments

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want to see my best moments again, like a sports replay,
so that I can enjoy my parries and my disasters.

Requirements: FR38 `[V1]` (« replay des meilleurs moments, façon match de sport »), UX-DR13 (Result sequence: photo → Mama → rows → stars → **REPLAY** → actions), UX-DR15 (the « REPLAY » banner, an `epic-stamp`). Architecture P7 (L836-841) and ADR-004 (snapshots, journal). GDD L101 and L539 (« Après un niveau perdu, le replay montre la cascade de catastrophes qui a fait rentrer Maman »).

It builds on:
- 1.3 (`snapshot()` / `restore(snapshot, tail)`);
- 1.4 (`createGameLoop`, `timeMap`);
- 2.5 (`epicStamp.ts` and the `stamp.replay` string, already in `strings.fr.json` L44 and used nowhere);
- 3.6 (the photo: the scene drawn on another world through its own camera);
- 3.7 / 3.8 (the Result phases);
- 3.16 (`mamaHome`).

3.10 (Retour) and 3.11 (Frigo, unlocks) come after it.

**Scope in one line:** the client keeps a snapshot of the live sim every 5 s of sim time, scores the moments of the game from the sim events it already receives, and at the end picks up to 3 of them (spaced at least 5 s apart). Between the stars and the actions, it replays each one in a separate sim restored from a snapshot, drawn through a tight replay camera under a « REPLAY » banner. A tap skips one moment, a second tap skips the rest. The live sim, its journal, the snapshot format and the goldens do not change.

## Acceptance Criteria

### Snapshots (D2)

1. **A snapshot every `SNAPSHOT_EVERY_MS`.** New constant `SNAPSHOT_EVERY_MS = 5000` in `src/shared/constants.ts` (the name `deferred-work.md` L29 gives it), with a doc comment (architecture « Snapshots »).
   - `src/client/app/levelSession.ts` keeps a snapshot log of the live sim: the snapshot at `world.time.sim === 0` (before the first step) and one each time the sim time is a multiple of `SNAPSHOT_EVERY_MS`.
   - They are taken in the loop's `beforeStep` hook, **before** `deps.beforeStep` (the autoplay bot): the state at `T` has no command of the step after `T`.
   - The log is cleared at each `start()` and by `releaseSim`. It never takes two snapshots at the same time (a frozen sim, an `advance` with no step).
   - It is a small module, `src/client/endOfLevel/snapshotLog.ts`: `createSnapshotLog()` with `take(sim)`, `latestAtOrBefore(simMs): SimSnapshot | null` and `clear()`. It is pure, imports `@sim` only and has a unit test.
2. **The sim is not touched.** No `createSim` option, no command, no event, no `World` field, no new snapshot version (it stays 34), no journal change, and no golden moves. Taking a snapshot is a read (`sim.snapshot()`): `__PP__.journal()` and the world's `hashJson` are the same with and without the log. Measured on 2026-11-07 (Node, live content): a snapshot takes 0.2 to 0.7 ms and weighs about 33 kB of JSON, so about 37 snapshots and 1.3 MB for a 3-minute level.
3. **What a replay needs.** `levelSession` exposes `replaySource(): ReplaySource | null` (a getter, `null` with no active sim). It returns:
   - `content`: the **exact bundle the live sim was created with** (feel.json plus the level's `feelOverrides`: `simFeel`, `levelSession.ts:452`). It is **not** `ActiveLevel.feel`, which also holds the remembered tweaks: those come in the journal as the `SetFeel` at t=0 (L474). Another bundle is refused by `restore` (`feelHash`).
   - `geometry`, `level` and `seed`.
   - `journal()`: the live `sim.journal()`.
   - `snapshots`: the log.
   - `endedAt`: the `t` of the `LevelEnded` the session saw, `null` before it.

   It stays readable during `result`: `finish()` stops the loop, and the sim lives until the next `start()` / `stop()` (L354, `releaseSim` L315).

### Moments (D3, D4, D5)

4. **The rules are data in `content/feedback.json › replay` (D1).** New `ReplaySchema` in `src/content/schemas/feedback.ts`, beside `PhotoSchema`. It is strict, each field has a `.describe()`, and its keys are:
   - `preRollMs` (2000) and `postRollMs` (1500): sim ms before and after the moment.
   - `minSpacingMs` (5000): sim ms between two retained moments.
   - `momentCount` (3, an int in `1..5`).
   - `points { perfect: 3, messyGag: 2, nearMiss: 2, waveLast: 1 }`: ints ≥ 0.
   - `messyGagMinProps` (2) and `messWindowMs` (1000): see AC 5.
   - `camera { frameWidthM, frameDepthM }`: the frame box of AC 9, positive and finite. Start from about 5 × 3.4 m (`[ASSUMPTION]`, tighter than the follow camera's 9.1 × 6.2 of `feel.camera`; Geo tunes it).
   - `delayMs` (400, real ms after the last star before the replay), `endHoldMs` (300, real ms on the last frame of a moment before the next one or the actions).

   Export `ReplaySettings`. `npm run content:schemas` regenerates `content/_schemas/feedback.schema.json`. The fixture table of the tests (`tests/support/testContent.ts` / its feedback fixture) gets the section too.
5. **Scoring, in a pure client module.** `src/client/endOfLevel/highlights.ts` imports `@sim` types and `@content` types only (no `three`, no DOM). It has `createHighlightRecorder()` with `onSimEvent(event)`, `clear()` and `pick(endReason, rules): readonly Highlight[]`. A candidate is **one threat at one sim time**, so the events of one threat in one step add up (D3). Its points are:
   - **`perfect`**: a `ResponseResolved` with `quality: 'perfect'` (`src/sim/events.ts:313`). Chore beats (`ChoreBeatJudged`) and rhythm beats (`BeatHit`) are **not** responses here (D3).
   - **`messyGag`**: a `GagTriggered` (L323) after which at least `messyGagMinProps` **distinct** props had a `PropImpact` (`propId`, and `otherPropId` when it is not null) or a `PropBroken`, with `gag.t ≤ t ≤ gag.t + messWindowMs`. This is P7's « bazar ≥ 2 objets ».
   - **`nearMiss`**: a `NearMiss` (L328). **`NearMissFrozen`** (L335) is not a moment of play: it is emitted at the level's end, and its own doc says « nothing that reads the moments of play takes it for one ». It scores nothing.
   - **`waveLast`**: the `ResponseResolved` (any quality) with the largest `t` among the threats of one wave (`waveIndex ≥ 0`, read from the threat's `ThreatTelegraphed` or `ThreatHidden`, L253 and L265), over the whole game. It is computed in `pick`, not live. A threat no wave planned (`waveIndex: -1`) never counts.

   `Highlight = { t: SimMs; threatId: number; points: number; kinds: readonly HighlightKind[]; anchorId: string | null }`. The `anchorId` is the threat's, from its telegraph or hidden event.
6. **Selection (D4).** `pick` keeps the candidates with `points > 0`.
   - It sorts them by points (highest first), then by `t` (**later first**), then by `threatId` (lower first).
   - It takes them greedily. A candidate is taken when it is at least `minSpacingMs` from every one already taken, until `momentCount`.
   - It returns them in **chronological** order.

   With no candidate there is no moment: the Result goes from the stars to the actions as today (AC 11). The same events always give the same moments: no clock, no random draw.
7. **`mamaHome`: the cascade (D5).** When `endReason === 'mamaHome'`:
   - the candidates are the `GagTriggered` of the game only, with the points of their own kinds (`messyGag`, `nearMiss`; 0 is fine here);
   - they are sorted by `t`, **latest first**, and taken greedily with the same spacing up to `momentCount`;
   - they are returned in chronological order.

   The last gag (the one that filled the gauge) is therefore always in, and the replay shows « la cascade de catastrophes qui a fait rentrer Maman » (GDD L539, `deferred-work.md` L1045). This applies to `mamaHome` only, not to `mamaWoke`.

### The replay (D6, D7)

8. **A separate sim per moment.** New `src/client/endOfLevel/momentSim.ts` (imports `@sim` only): `createMomentSim(source, highlight, rules): Promise<Result<MomentSim, AppError>>`. It does five things:
   - It computes `fromMs = max(0, t − preRollMs)` and `untilMs = min(endedAt ?? ∞, t + postRollMs)`, both on the step grid (`STEP_MS`).
   - It creates a sim with `createSim({ content, geometry, level, seed })` from the `ReplaySource` (no `journal` option).
   - It restores `snapshots.latestAtOrBefore(fromMs)` with the tail `journal.entries.filter(e => e.applyAt > snapshot.world.time.sim)` (`Sim.restore`, `createSim.ts:116`).
   - It steps **silently** up to `fromMs`, draining and dropping the events.
   - It returns `{ sim, fromMs, untilMs }`.

   A refused restore, or a sim that throws, is an `err` with a `log.warn` naming the moment. The caller skips that moment, and its sim is disposed. **The caller disposes every moment sim** (WASM memory, `Sim.dispose`); there is never more than one alive.
9. **The replay player.** New `src/client/endOfLevel/highlightReplay.ts` (client, may import `three`): `createHighlightReplay(deps)` with `play(highlights, source, rules, onDone)`, `skipMoment()`, `skipAll()` and `cancel()`. For each moment, in order:
   - **The sim.** It builds the moment sim (AC 8), then runs it with its own `createGameLoop` (`src/client/loop.ts:20`). The loop gets a fresh `createTimeMap()` and a fresh, unpaused pause controller, at the level's `?speed`. So the perfect's slow-mo and the hitstops play as in the game, and the live loop's `timeMap` is never reset (that closes `deferred-work.md` L51: nothing restores the live sim).
   - **Stopping.** The loop stops at the first step where `world.time.sim ≥ untilMs`. It holds `endHoldMs` on that frame, then disposes the sim and goes to the next moment.
   - **Drawing.** Each frame calls `currentLevel.update(momentSim.world, alpha, now)` and draws with a dedicated `replayCamera = createIsoCamera()` (beside `photoCamera`, `boot.ts:301`). The camera is placed once per moment with `fitFollowCamera(replayCamera, room, rules.camera, cx, cz, aspect)` (`render/isoCamera.ts:141`): the game camera's angle, and a frame box centred on the moment's **focus**. The focus is the anchor of `highlight.anchorId` in `geometry.anchors` if it has one; otherwise Papa's position in the moment sim at `fromMs` (a threat on Papa: the micro-sleep, the duel). The camera does not move during a moment (a cut between moments), so reduced motion needs nothing more.
   - **Sound and effects.** Each event of the moment sim goes to `playSimEventFeedback(event, { sim: momentSim, level }, replayDirector)` (`feedback/simEventFeedback.ts`) and to `currentLevel.playCharacterEvent(event, world, isMotionReduced)`. The exceptions are `LevelEnded`, `LevelScored` and `NearMissFrozen`, which are not routed (end bookkeeping). The events never reach boot's `onSimEvent`, the test log, the mirrors, `runMamaTags`, the highlight recorder or the save.
   - **`replayDirector`** is a second `createFeedbackDirector` built in boot with the same table and audio. It has:
     - **no haptics** (a no-op port) and no flash;
     - a `stamp` that does nothing, so « PARADE PARFAITE » does not fight the banner;
     - `getScene` returning `currentLevel.fx` while a replay plays, `null` otherwise;
     - `getFx` returning the live feel's `fx`;
     - `onVisual` / `onCue` that do **not** count into `cueLog()`, `data-pp-stamp-count` or `data-pp-flash-count` (D7).
   - **Scene state.** Before each moment and after the replay, it calls `currentLevel.resetFx()`.
   - **The end.** After the last moment (or a skip), it draws the scene once more on the **frozen live world** with the game camera (`currentLevel.update(active.sim.world, 1, now)`, then `renderer.render(scene, camera)`, like `drawStatic`, `boot.ts:324`). The backdrop of the actions is then the end of the game, as before.

   `cancel()` stops the loop, disposes the moment sim and does not call `onDone`. It is called on `AppStateChanged → loading`, before the live scene and sim are released, and by the Result screen's `dispose()`. It is idempotent.
10. **The live game is untouched.** After a replay, `__PP__.journal()` deep-equals the journal before it, and `__PP__.state()`'s world hashes the same. « Copier le journal » exports the same file. The live `timeMap`, the follow rig and `cameraFx` are not touched.

### The Result screen (D8, D9)

11. **A `replay` phase.** `ResultPhase` (`src/client/ui/screens/resultScreen.ts:21`) becomes `'photo' | 'mama' | 'rows' | 'stars' | 'replay' | 'actions'`.
    - `ResultScreenOptions` gains `replay: { readonly momentCount: number; play(onDone: () => void): void; skipMoment(): void; skipAll(): void; cancel(): void } | null`. `null`, or `momentCount === 0`, means no replay.
    - Where the stars end today (the three branches that schedule `showActions`: `stamp`, `stampLost` and the no-star branch of `startStars`, L648-668), the screen does this instead, when there is a replay: `later(startReplay, timings.delayMs)`. `startReplay` does `enter('replay')`, adds `pp-result-screen--replaying` and calls `replay.play(() => later(showActions, actionsDelayMs))`.
    - Without a replay, it is exactly today's chain.
    - The timings come from `feedbackTable.replay` (AC 4), passed beside `resultScreen`.
12. **The screen while it replays.** Under `pp-result-screen--replaying`:
    - the scrim, the panel, the polaroid and Mama are hidden (`visibility: hidden`, so focus and layout stay), and the canvas is seen;
    - the banner shows: a new element inside the screen, `pp-replay-banner pp-type-epic pp-stroked`, text `t('stamp.replay')` (« REPLAY », `strings.fr.json` L44). It is the `epic-stamp` look (`DESIGN.md` L600: `{typography.epic}`, uppercase, `{colors.paper}` fill, `{colors.ink}` stroke). It is placed at the top of the screen and above the scene, and stays up for the whole replay (EXPERIENCE L234). It is **not** `epicStamp.show` (capped at 900 ms, z-index 16, below the overlay);
    - the banner has a short scale-in, none under reduced motion (`:root[data-pp-motion="reduced"]`), and never blinks (NFR, 3 Hz rule);
    - tokens only (`designTokens.test.ts`), and it fits at 844 × 390, 667 × 375 and 750 × 340;
    - the HUD and the world UI stay hidden (`uiShell.ts:72`: the app is in `result`).
13. **Skipping (EXPERIENCE L344, L384).**
    - **During the replay:** the first press skips the current moment, so the next one starts. A second press skips the whole replay and goes to the actions. A press is the screen's existing tap (pointerdown then pointerup), Enter / NumpadEnter / Space, or the pad's A (`activate()`), with the same `inputGraceMs` and `heldSkipKey` rules. With one moment left, a single press ends the replay.
    - **Before the replay:** a press during `photo` → `stars` keeps today's meaning: it skips everything to the actions, the replay included (D8). So the existing skip specs keep their assertions.
    - **The replay ends:** `showActions` focuses « Rejouer » as today. A press that ended the replay never presses « Rejouer » (the grace and `heldSkipKey` already do this; test it).
14. **Rebuild and leaving.**
    - A portrait rebuild (`isDone: hasResultStarted`, `boot.ts:2100`) during the replay cancels it and shows the end state with the actions, as a rebuild does in any phase.
    - `dispose()` cancels it.
    - « Rejouer » and the next level go through `loading`, which cancels it first (AC 9).
15. **Boot.**
    - `src/client/boot.ts` keeps a `highlightRecorder`. It is cleared in `onLevelStarted` and on `AppStateChanged → loading` (beside `runMamaTags`, `resultScore`), and fed from `onSimEvent`.
    - At `LevelScored` it computes `resultHighlights = highlightRecorder.pick(resultEndReason, feedbackTable.replay)` and hands it to the Result screen with the player.
    - A rebuilt screen reuses `resultHighlights` (no second pick).
    - `?autoplay` plays the replay too (it is part of the game), at its `?speed`.
16. **Test handle.**
    - `__PP__` gains `highlights(): readonly Highlight[] | null`: the moments of the current Result, `null` before the first `LevelScored` and after loading. Wire it like `mamaLines()`: `src/client/app/testHost.ts`, `src/debug/testApi.ts` (+ test), `tests/support/fakeTestHost.ts` and `tests/e2e/support/testApi.ts`. Update the method list of `tests/e2e/testApi.spec.ts`.
    - A mirror `data-pp-replay-moment` holds the index of the moment playing (`0`, `1`, …) during `replay`, and is removed otherwise and on loading (`boot.ts` mirrors L434-439 and the loading reset).

### Proof and docs

17. **Headless proof (the golden rule).** New `tests/bots/highlightReplayLive.test.ts`: the real `createSim`, the live content, the `human` bot (and `perfect`), on `salon_kitchen` and `salon_crawler`, at least 3 seeds each. It plays a whole game with the AC 1 snapshot rule, records with `createHighlightRecorder`, then picks. For **every** picked moment it builds `createMomentSim` and steps to `untilMs`, and checks:
    - (a) the events of the moment sim over `(snapshotTime, untilMs]` are **the same as the live events over that span**, compared with `hashJson` (canonical). Not with `JSON.stringify`: `cloneJson` sorts keys, so a key-order diff is not a real diff (seen on 2026-11-07);
    - (b) the moment's own event (its `t`, `threatId`, kind) is in that span;
    - (c) at least one game has 3 moments, all spaced at least `minSpacingMs` apart;
    - (d) a `mamaHome` game (find a seed of the `idle` or `random` bot that ends on `mamaHome`, and name it) picks the last gag.
18. **E2E (Chromium), new `tests/e2e/replay.spec.ts`,** on `salon_crawler` with a fixed `?seed` (and `?speed` where it helps):
    - (a) a game with moments shows `photo, mama, rows, stars, replay, actions` in that order;
    - (b) `data-pp-replay-moment` walks `0 … n−1`, and `highlights()` has `n` entries;
    - (c) the banner is visible with « REPLAY » during `replay` and gone in `actions`;
    - (d) one press moves to the next moment, and a second goes to `actions` (with `n ≥ 2`);
    - (e) a press during `stars` goes straight to `actions`, with no `replay` phase;
    - (f) `journal()` is the same before and after the replay;
    - (g) no vibration and no `cueLog()` entry during `replay` (the replay director does not count);
    - (h) a game that ends with no moment has no `replay` phase;
    - (i) a portrait rebuild during `replay` lands on the actions;
    - (j) screenshots (`PP_SCREENSHOTS_DIR`) of a moment with the banner at 844 × 390 and 750 × 340, in `_bmad-output/implementation-artifacts/3-9-screenshots/`.
19. **Docs.**
    - **Architecture** (`game-architecture.md`):
      - « Déterminisme, journal et replay » L241: the snapshots are the client's (`levelSession`), every `SNAPSHOT_EVERY_MS`, and the sim does not change.
      - P7 L840-841: the scoring rule of AC 5 (a candidate is a threat at a `t`, `NearMissFrozen` excluded, « bazar » = distinct props hit within `messWindowMs`), the selection of AC 6, the `mamaHome` cascade, the rules in `feedback.json › replay`, the moment sim through `createGameLoop`, and the second director.
      - The source tree L540: `endOfLevel/` holds `photo.ts`, `highlights.ts`, `snapshotLog.ts`, `momentSim.ts` and `highlightReplay.ts`.
      - Each with « (story 3.9, D…) ».
    - **`project-context.md`:** a « Highlight replay (story 3.9) » bullet beside 3.7 / 3.8's: where the rules live, the snapshot log, the moment sim and its disposal, the second director, the skip, `__PP__.highlights()`, `data-pp-replay-moment`.
    - **EXPERIENCE** L107, L234, L344: they already say it; add the `mamaHome` cascade to L342 only if it is not clear.
    - **`deferred-work.md`:** close L29, L51, L266 and L1045, and say that L280 (a hash of the Rapier bytes) stays open: the snapshots never leave the page.
    - **CLAUDE.md:** no change needed (no new command).

## Tasks / Subtasks

- [ ] Task 1: Rules and pure scoring (AC: 4, 5, 6, 7)
  - [ ] `ReplaySchema` in `src/content/schemas/feedback.ts`, `content/feedback.json › replay`, the test fixture's feedback, `npm run content:schemas`
  - [ ] `src/client/endOfLevel/highlights.ts` and `highlights.test.ts` (table-driven, see Testing)
- [ ] Task 2: Snapshots and the moment sim (AC: 1, 2, 3, 8)
  - [ ] `SNAPSHOT_EVERY_MS`; `snapshotLog.ts` + test; the log in `levelSession` (`beforeStep` order, clear on start / release); `replaySource()`, `endedAt`; `levelSession` tests (fake sim: snapshots at 0, 5000, 10000…, none twice, cleared)
  - [ ] `momentSim.ts` + test (fake or real sim: window clamps, the snapshot chosen, the tail filter, silent fast-forward, `err` + warn on a refused restore)
  - [ ] `tests/bots/highlightReplayLive.test.ts` (AC 17)
- [ ] Task 3: The player (AC: 9, 10)
  - [ ] `highlightReplay.ts`: the loop per moment, the stop at `untilMs`, `endHoldMs`, the camera focus, the routing (deny list), `resetFx`, the final redraw, `skipMoment` / `skipAll` / `cancel`; a unit test with a fake scheduler, a fake scene and a fake director (no WebGL)
  - [ ] `replayCamera` and `replayDirector` in boot
- [ ] Task 4: The Result screen and boot (AC: 11-16)
  - [ ] `resultScreen.ts`: the phase, the option, the branches, the class, the banner, the two-press skip; `resultScreen.test.ts` (with and without a replay, the skip before and during, rebuild, dispose cancels)
  - [ ] `ui.css`: `pp-result-screen--replaying`, `pp-replay-banner` and its reduced-motion rule
  - [ ] boot: the recorder, `resultHighlights`, the player wiring, cancel on loading, the mirror, `__PP__.highlights()` and its plumbing
- [ ] Task 5: E2E and the specs it moves (AC: 18 and « What must keep working »)
  - [ ] `tests/e2e/replay.spec.ts`; `waitForResultActions` (`tests/e2e/support/game.ts:908`) passes through a `replay` phase (two presses once `data-pp-result="replay"` shows, after the grace) so that the other specs keep their 15 s budget
  - [ ] Phase lists and cue counts of the Traps; screenshots; look at them and say what you saw
- [ ] Task 6: Docs (AC: 19)
  - [ ] `npm run ci:fast` after each task, plus the touched specs on Chromium

## Dev Notes

### Decisions

- **D1. The rules are client data in `feedback.json`, not `feel.json`.** The sim never reads them: they score events after the fact, choose a camera and time a screen.
  - `feel.json` is hashed (`feelHash` in every journal, `world.feel` in every snapshot). A new feel key moves every golden (3.6 and 3.7 regenerated 54 files for theirs).
  - It would also make every journal a tester exported before this story unreplayable (`sim:replay` refuses another `feelHash`).
  - `feedback.json` is client-only and outside the sim's hashes (`contentBundle.ts:15`), and it already holds the Result timings (`resultScreen`) and the photo's frame (`photo`). The 2.5 note says the same of client tuning (`deferred-work.md` L557).

  So: **no golden moves in this story.** If one does, it is a bug. The camera of the replay is there too: unlike the photo's yaw (`feel.fx.photoCamera`, 3.6), it has no angle of its own (AC 9), only a frame size.
- **D2. The snapshots are the client's.** The architecture says « un snapshot du World et de Rapier toutes les 5 s » without saying who takes them. Taking them in the sim would add state, an option or an event for something no gameplay reads. `levelSession` owns the live sim and its loop, so it takes them in `beforeStep`, where `world.time.sim` is exactly on the step grid. Measured: about 0.3 ms per snapshot, once every 500 steps. If a device profile ever shows a hitch, spreading the `cloneJson` is a later story, not a reason to move them into the sim.
- **D3. What a moment is.** P7 scores « chaque `SimEvent` ». One threat often emits several in one step (`GagTriggered` and its `NearMiss`, a perfect that is also the last of its wave), so a candidate is a threat at a `t`, and its points add up (a near-miss stair slide that knocked two props is 4). The definitions:
  - « Réponse parfaite » is a threat's `ResponseResolved`. Chore beats are judged in rhythm and come by the dozen in `salon_kitchen` (8 per game measured; rhythm sequences have more): counting them would fill every replay with dishes.
  - `NearMissFrozen` is excluded by its own contract.
  - « Bazar ≥ 2 objets » has no event of its own. The props the gag set moving are the distinct props hit or broken within `messWindowMs` after it: the only gag that pushes a prop pushes one (`gags.ts:105`, `count: 1`), so « 2 » means it knocked into another, or broke.
  - « Dernière menace d'une vague » is the last response of each wave, found once the game is over.
- **D4. Ties go to the later moment; playback is chronological.** Most games have dozens of perfects (measured 9 to 65 per game), so ties are the rule. The later one wins because the end of a level is its climax (waves get harder), and it is deterministic. Playing in time order tells the game as it went, like a sports recap.
- **D5. A lost level replays its cascade.** On `mamaHome`, scores would pick perfects, and the GDD wants the opposite. The last gags, spaced, latest first, end on the one that brought Mama home. `mamaWoke` (Sieste) keeps the normal pick: the noise gauge is not a cascade of gags.
- **D6. One moment sim at a time, played by the game's own loop.** `createSim` is async (Rapier) but cheap once the WASM is up: measured 1 to 2 ms to create, about 5 ms to restore and fast-forward up to 5 s. The moment sim is therefore built when its moment starts, not all three upfront: less WASM memory, and a skip drops one sim. Reusing `createGameLoop` gives the hitstop, the slow-mo and `?speed` for free, with its own `timeMap`.
- **D7. The replay's feedback is sound and scene effects, not the controller.**
  - Replaying a parry's sound and puff is the sports-replay effect.
  - Vibrating again for a moment already lived is noise. `result.spec.ts` and `catastrophe.spec.ts` pin the exact vibrations of the Result.
  - A second director with its own deps keeps the live director's counters (`cueLog`, the stamp and flash counts) and its scene gate (`getScene` only in `level`) as they are.
  - No world UI (icons, verbs, rings) in the replay: it is a TV replay, not the game.
- **D8. A press before the replay skips the replay too.** Today a press anywhere in the sequence means « take me to the actions ». A player in a hurry should not then get a replay they did not wait for. The two-press rule (EXPERIENCE L344) applies inside the replay.
- **D9. Real time, no new clock in the sim.** The screen's timings are real ms (`ResultScheduler`), the moment windows are sim ms (the moment sim's clock): the names say which (`…Ms` in `feedback.json › replay` are documented as sim or real in each `.describe()`).

### Current state of the files this story changes

Line numbers checked on 2026-11-07 on `main` 501ffee (3.8 merged).

- **`src/sim/createSim.ts`** (not changed): `Sim` L86-126 (`snapshot()` L106, `restore(snapshot, tail)` L116, `journal()` L118, `dispose()` L125); the implementation of `restore` (L1084-1118) checks everything first, clears the queue and events, and re-records the tail with its `applyAt` (each must be later than the snapshot). `replayJournal` (`src/sim/replay.ts`) replays from 0 only; this story does not use it.
- **`src/sim/events.ts`** (not changed): `ThreatTelegraphed` L253 and `ThreatHidden` L265 carry `anchorId` and `waveIndex`; `ResponseResolved` L313; `GagTriggered` L323; `NearMiss` L328; `NearMissFrozen` L335; `PropImpact` L385; `CatastropheChanged` L406; `PropBroken` L532; `LevelEnded` L571; `LevelScored` L579.
- **`src/client/app/levelSession.ts`**:
  - `ActiveLevel` L111-125;
  - `effectiveFeel` L228;
  - `makeSim` L278;
  - `releaseSim` L315;
  - `finish()` L354 (stops the loop only);
  - the sim's creation with `content` (`simFeel`) L450-459, and the tweaks `SetFeel` at t=0 L474;
  - the frame `render` and `createGameLoop` L550-570 (`beforeStep: deps.beforeStep`).
- **`src/client/loop.ts`**: `GameLoopOptions` L20-44 (`sim`, `timeMap`, `pause`, `scheduler`, `render`, `onSimEvent`, `speed`, `beforeStep`).
- **`src/client/ui/screens/resultScreen.ts`**:
  - `ResultPhase` L21, `ResultScheduler` L40, the timings L72-81;
  - `later` / `cancelAll` L553-564, `enter` L568;
  - `showActions` L606, `complete()` L618 (the skip-all);
  - the star chain L651-666, `startStars` L662;
  - input L680-688 (pointer, `SKIP_KEYS` L116, `isGraceOver` L480, `heldSkipKey` L478);
  - the build L746-769, `activate()` L775, `dispose()` L780.
- **`src/client/boot.ts`**:
  - the cameras L299-305 (`photoCamera` L301);
  - `drawStatic` L324;
  - the mirrors L434-439;
  - the epic stamp L551-552;
  - the live director L574-600;
  - the Result state L1139-1155;
  - `takeResultPhoto` L1161-1190;
  - `chooseAndRecordMamaLines` L1223;
  - `onSimEvent` and the `LevelScored` branch L1829-1852;
  - the Result factory L2100-2127 (`onPhase` → `ppResult`);
  - the loading reset L2342-2365;
  - `installTestApi` L2549.
- **`src/client/render/`**:
  - `levelScene.ts`: `update(world, alpha, nowReal)` L150, `playCharacterEvent` L124, `resetFx` L190; the views read the world each frame;
  - `isoCamera.ts`: `createIsoCamera` L41, `fitIsoCamera` L55, `fitFollowCamera` L141;
  - `renderer.ts`: `render` / `capture` L43-55.
- **`src/client/feedback/`**: `createFeedbackDirector(deps)` (`feedbackDirector.ts:94`, deps L14-55); `playSimEventFeedback(event, active, director)` (`simEventFeedback.ts`), a pure routing.
- **`src/client/ui/hud/epicStamp.ts`**: `createEpicStamp(doc, { text })`, classes `pp-epic-stamp pp-type-epic pp-stroked`, capped at `EPIC_STAMP_MAX_MS` (`constants.ts:569`); `ui.css` L313-327 (`z-index: 16`). Its look is the model for the banner; the component is not reused (AC 12).
- **`content/feedback.json`**: `resultScreen` (8 timings), `photo` (6 keys); schema `src/content/schemas/feedback.ts` L725-770 (`ResultScreenTimings`, `PhotoSettings` exported L771-772).
- **`content/strings.fr.json`** L44: `stamp.replay` « REPLAY », unused today.

### What must keep working

- **Specs that pin the phase list** (agent map of 2026-11-07). Each must name whether its game has moments:
  - `photo.spec.ts` L197 (`['photo','mama','rows','stars','actions']`), L305 (`['photo','actions']`, a skip: unchanged by D8), L369 (`slice(0,3)`), L511-515;
  - `mamaReactions.spec.ts` L198.

  A game with a perfect gets `'replay'` before `'actions'`.
- **Cue and vibration counts:** `result.spec.ts` L186 (`cueCount === cuesBefore + reactions + stars`) and L204 (exact vibrations), `catastrophe.spec.ts` L237 and L279. D7 keeps them, since the replay director counts nothing; check they still pass.
- **Skip specs** (`result.spec.ts` L214-237, `mamaWoke.spec.ts` L181, `mamaReactions.spec.ts` L289 and L322, `photo.spec.ts` L293 and L377): a press before the replay still lands on `actions` (D8).
- **Waits for `actions`** (15 s, `RESULT_SEQUENCE_TIMEOUT_MS`, `game.ts:900`) in `result`, `photo`, `mamaReactions`, `mamaMemory`, `mamaWoke`, `catastrophe`, `chambreNight`, `journal`, `chores`, `dishwasher`, `newMischiefs`, `debugOverlay`, `salonKitchen`, `autoplay`. Today's sequence is about 9 s; three moments add 10 s or more (a perfect's slow-mo stretches one). Use `waitForResultActions`' replay pass-through (Task 5) everywhere a spec does not test the replay. Do not just raise the timeout.
- `testApi.spec.ts` (the method list), `reducedMotion.spec.ts`, `journal.spec.ts` (« Copier le journal » after the replay exports the same journal), `autoplay.spec.ts` and its macOS screenshot references (they are taken in play, not on the Result: check).
- Goldens, the snapshot (34), journals, `npm run sim`, `sim:replay`, `sim:balance`: **untouched** (D1, D2).

### Traps

- **Compare events canonically.** `cloneJson` (the snapshot) sorts object keys, so a restored sim's `responseWindow` comes out in another key order: `JSON.stringify` says « different » for equal events. Use `hashJson` (`@shared/hash`).
- **The replay content is `simFeel`'s bundle, not `ActiveLevel.feel`.** With remembered tweaks (`rememberFeel`), `ActiveLevel.feel` differs from what the sim hashed, and `restore` refuses the snapshot (`feelHash`). The tweaks are in the journal (`SetFeel` at t=0) and in the snapshot's `world.feel`.
- **The tail is `applyAt > snapshotTime`, with `restore`'s second argument,** never `enqueue` (it would recompute `applyAt`; `createSim.ts:112-115`).
- **Snapshot before the bot.** In `beforeStep`, take the snapshot first, then call `deps.beforeStep` (the autoplay bot enqueues there). Commands enqueued at `T` apply at the step ending `T + STEP_MS` and are in the tail, either way; the order keeps the log independent of the bot.
- **Dispose every moment sim** (WASM is not garbage-collected), on its end, on a skip, on `cancel` and on a failed build. A test asserts that `dispose` is called once per created sim.
- **The scene goes back in time.** `currentLevel.update` on a world earlier than the last one drawn (props un-break, Papa's look comes back, mischief decals disappear, the door shuts). The views read the world each frame, but check the ones that keep state: the character mixers (`papaMixerMs`, in sim ms), the door, the decals, the chore shards. `resetFx()` before each moment; then **look at it**: a frame of the screenshots must show the right look for the moment.
- **Redraw the end after the replay** (AC 9), or the actions sit on the last replayed frame and the next photo of a rebuild shows the wrong world.
- **`director.getScene` is gated on `appFsm.state === 'level'`** (`boot.ts:580`): the live director plays no scene effect in `result`. The replay director has its own gate.
- **Cancel before release.** On `AppStateChanged → loading`, cancel the replay **before** `levelSession.start()` disposes the old scene and sim (`releaseSim`, `previous?.dispose()`).
- **The Result screen's input grace** (`inputGraceMs`) restarts at `showActions`; the press that ends the replay must not press « Rejouer » (AC 13).
- **The worktree guard** refuses compound shell commands naming `git`, shell variables in option positions and `git -C`: use plain commands. Scratch scripts outside the repo need `.mts` (top-level await) and `npx tsx --tsconfig tsconfig.json <file>`.
- **`VITE_DEBUG_ALLOWED=false` may be exported:** run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` if it is (not set in this session's shell on 2026-11-07).
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`, and e2e through `npm run e2e -- …` in the background (heavy lock).

### Out of scope

- A hash of the Rapier bytes in the snapshot (`deferred-work.md` L280): the snapshots never leave the page.
- Highlights in the sim report (`npm run sim`) or in the exported journal: possible later, not asked.
- Slow-motion or camera moves added by the replay itself (« ralenti TV »), a moment title (« PARADE PARFAITE ! » card), or music for the replay: later, if Geo wants them after playing.
- The world UI in the replay (icons, verbs, rings): D7.
- The final rush's own scoring (`PropTidied`), chore and rhythm beats: D3.
- 3.11's « Âge suivant » and its actions: 3.11.

### Architecture compliance

- `src/sim` is not changed (D2).
- `highlights.ts`, `snapshotLog.ts` and `momentSim.ts` import `@sim` (the public API), `@content` types and `@shared`, with no `three` and no DOM, so the headless test can run them. `highlightReplay.ts` is client code with `three`. `@sim` is `src/sim/index.ts` only: `SimSnapshot`, `Journal`, `JournalEntry`, `Sim`, `createSim` and `SimEvent` are already exported.
- The client never imports `bots` or `debug` statically. `tests/bots/` may import `@bots`, `@sim` and the pure client modules.
- No `console.*`; I/O and the moment sim return `Result`; every fallback (a refused restore, a skipped moment) logs a `warn`.
- Everything Geo tunes is data: `feedback.json › replay` (points, windows, spacing, count, frame, delays).

### Library and framework notes

No new dependency, no upgrade. Three.js `OrthographicCamera` through `createIsoCamera` / `fitFollowCamera`; Zod 4 `z.strictObject`, `.int()`, `.min/.max`, `.describe`, as the other schemas do. Rapier (`@dimforge/rapier3d-deterministic-compat` 0.21.0) is reached only through `Sim.snapshot()` / `restore()`, so no web research is needed.

### File structure

- **New:** `src/client/endOfLevel/{highlights,snapshotLog,momentSim,highlightReplay}.ts` and their tests, `tests/bots/highlightReplayLive.test.ts`, `tests/e2e/replay.spec.ts`, `_bmad-output/implementation-artifacts/3-9-screenshots/`.
- **Updated:**
  - shared: `src/shared/constants.ts`;
  - content: `src/content/schemas/feedback.ts`, `content/feedback.json`, `content/_schemas/feedback.schema.json` (generated);
  - client: `src/client/app/levelSession.ts` (+ test), `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/ui/screens/resultScreen.ts` (+ test), `src/client/ui/styles/ui.css`;
  - debug: `src/debug/testApi.ts` (+ test);
  - tests: `tests/support/{testContent,fakeTestHost}.ts` (and the feedback fixture if separate), `tests/e2e/support/{game,testApi}.ts`, the specs of « What must keep working » that pin a phase list, `tests/e2e/testApi.spec.ts`;
  - docs: the docs of AC 19, `sprint-status.yaml`.

### Testing

- **`highlights.test.ts`, table-driven:**
  - each kind alone;
  - the points of one threat at one `t` add up;
  - `NearMissFrozen` scores 0;
  - a messy gag needs `messyGagMinProps` distinct props within the window (`otherPropId` counted, the same prop twice counted once, one at `messWindowMs + STEP_MS` not counted);
  - the last of a wave, and `waveIndex: -1` never;
  - a chore beat is not a perfect;
  - spacing (a better candidate 4 s away is dropped);
  - a tie goes to the later;
  - the output is chronological;
  - `momentCount`;
  - no candidate gives `[]`;
  - `mamaHome` keeps the last gags and ignores the perfects;
  - `mamaWoke` uses the normal pick;
  - `clear()`.
- **`snapshotLog.test.ts` / `levelSession` tests:** snapshots at 0 and on the grid only, not twice, `latestAtOrBefore` at the edges (0, exactly on a snapshot, between), cleared on start and release.
- **`momentSim.test.ts`:** the window clamps (`t < preRollMs`, `t + postRollMs > endedAt`), the snapshot chosen, the tail filter, the silent fast-forward (no event reaches the caller before `fromMs`), and a refused snapshot giving `err` and a warn.
- **`highlightReplay.test.ts`:** a fake scheduler, scene, renderer and director:
  - moments in order;
  - the stop at `untilMs`, then `endHoldMs`;
  - the deny list not routed;
  - `skipMoment` then `skipAll`;
  - `cancel` with no `onDone`;
  - one `dispose` per sim;
  - the final redraw on the live world;
  - a failed moment skipped with a warn.
- **`resultScreen.test.ts`:** with and without a replay; the phase order; the banner; one press → `skipMoment`, two → `skipAll` and the actions; a press in `stars` → actions with no `replay` and `replay.play` never called; rebuild `isDone`; `dispose` → `cancel`.
- **Live headless:** AC 17. Name the seeds you used.
- **E2E (Chromium):** AC 18, then the specs of « What must keep working ».
- **Look at it.** Screenshots of a moment with the banner at both sizes. Say what you saw: the banner legible and inside the frame, the moment framed tight on its focus, Papa's look right for the moment, the end frame back after the replay. Say what you did not capture (WebKit, a `mamaHome` cascade, the big salon if not shot).
- **Checks:** `npm run ci:fast` per task, plus the touched specs on Chromium. `ci:story` belongs to the review.

### Previous story intelligence

- **3.8:**
  - Assert on actual values (ids, counts, texts), not « something happened ». Tests that would pass with the feature broken were found in 3.6, 3.7 and 3.8.
  - `createResultScreen`'s options are required: every call in `resultScreen.test.ts` must pass `replay` (`null` is fine).
  - A rebuilt screen reuses boot's state and never recomputes (`resultMamaLines`): same for `resultHighlights`.
  - `?autoplay` and the save: the replay writes nothing.
- **3.7:** the phases are mirrored (`data-pp-result`) and specs list them exactly; a new phase moves those lists (named above). Mama's bubble is a live region present from the start; do not rebuild the screen's DOM to hide it, toggle a class.
- **3.6:** the photo draws the scene on another world through its own camera (`photo.ts:114`: `level.update(world, 1, now)`, no step). The replay does the same each frame, on a moving world. Its review found stale comments and tests that could not fail: keep the « Current state » line numbers honest.
- **3.16:** `mamaHome` is the only lost level. It screams before its header; its replay is the cascade (D5).
- **1.4 deferred:** `timeMap.reset()` after a `restore` of the live sim. This story never restores the live sim; the moment sims have their own `timeMap` (D6).

### Git intelligence

`main` is at 501ffee, the merge of 3.8 (« Story 3.8 : merge de story/3-8-memoire-de-maman »). This branch was cut from it. The closest models: 3.6 (`photo.ts`, a scene drawn on another world, a camera of its own, the Result phase `photo`), 3.7 / 3.8 (Result phases, boot state reset on loading, `__PP__` readers), 1.4 (`createGameLoop`), and 2.5 (`epicStamp.ts`, the stamp's look).

### Project Structure Notes

It follows the layers and aliases. `src/client/endOfLevel/` is where the architecture tree puts the replay (L540: « photo.ts, highlights.ts »). The split into four files keeps the pure parts testable without WebGL. There are two variances, both documented and reflected in the architecture by AC 19:
- the rules live in `feedback.json` rather than `feel.json` (D1);
- the snapshots are the client's (D2).

### Project Context Rules

- Anything Geo might tune is data: the points, the windows, the spacing, the count, the frame and the delays (`feedback.json › replay`).
- Units are suffixes (`preRollMs`, `frameWidthM`); `…At` is sim time, `…AtReal` real time. Factories are `create<Name>`; pure readers are `…Of` or verbs. Booleans are `is…` / `has…`. No `enum`, no `namespace`, no constructor parameter properties.
- The sim never logs and never reads time or randomness; this story adds nothing to it.
- No `console.*`; I/O returns `Result`, and every fallback logs a `warn`.
- UI text is French and lives in `strings.fr.json` (`stamp.replay` exists). Tokens only in CSS. Nothing blinks above 3 Hz; reduced motion removes the banner's motion.
- Never weaken a guardrail or widen the CSP. No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **D1: the replay's rules live in `feedback.json`, not `feel.json`.** No golden moves, and testers' journals stay replayable. Confirm, or ask for `feel.json` (every golden moves, `feelHash` in every journal).
2. **D3/D4: a clean game replays three perfects.** With P7's points, a perfect (3) beats a near miss (2) and a messy gag (2), and most games have dozens of perfects. Your disasters rarely make the cut except on `mamaHome`. The points are data: set `nearMiss` to 3 or 4 if you want the gags in.
3. **D5: on `mamaHome`, the replay is the last gags** (the cascade), whatever the perfects.
4. **D7: the replay plays the sounds and the puffs, not the vibrations,** and no « PARADE PARFAITE » stamp under the banner.
5. **Length:** about 3.5 s of sim per moment plus the perfect's slow-mo, so 10 to 18 s for three moments. One press skips a moment, two skip the rest. `momentCount`, `preRollMs` and `postRollMs` are data.
6. **D8: a press before the replay skips it too.**

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.9] L1839-1862; FR38 L77; UX-DR13 L247-253; UX-DR15 L254
- [Source: _bmad-output/planning-artifacts/game-architecture.md] Déterminisme L237-242, ADR-004 L309, source tree L540, P7 L836-841, the story map L982
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] L101 (macro-boucle), L539 (fin de niveau, cascade)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L66, L90, L107, L166, L234, L306, L337, L342, L344, L384, L396, L590, L598
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L326, L434, L600 (`epic-stamp`)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L29, L51, L266, L280, L557-558, L1045
- [Source: _bmad-output/implementation-artifacts/3-8-memoire-de-maman.md] boot state, `__PP__` readers, Review Findings
- [Source: src/sim/createSim.ts], [src/sim/events.ts], [src/client/app/levelSession.ts], [src/client/loop.ts], [src/client/ui/screens/resultScreen.ts], [src/client/boot.ts], [src/client/endOfLevel/photo.ts], [src/client/render/isoCamera.ts], [src/client/feedback/simEventFeedback.ts], [src/client/ui/hud/epicStamp.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
