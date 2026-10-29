---
baseline_commit: 516b463eb33099f1dba6c6e5ee4d9ad2bfd61b81
---

# Story 3.1: Noise gauge

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 3.1 « Jauge de bruit » (L1534-1561). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to see the noise rise with every fall and every ring,
so that I feel the chaos might wake Mama.

**Requirements covered:**
- **FR18 `[P]`, the noise gauge (Sieste levels):** it rises with the baby's cries (+2 %/s), falling objects (+5 to +15 %), creaking floorboards (+3 %), breath released too early (+5 %) and sniffing (+3 %). It goes down by 1 %/s. At 100 % Mama wakes up (epics L51, GDD L174).
- **UX-DR4, the HUD:** the gauges share one pill, in the order Bruit · Fatigue · Envie, with 10 segments. When idle they sit at 70 % opacity. From 70 % they switch to `gauge-warn` and their icon pulses (epics L218-221).
- **EXPERIENCE L207 / L420 / L557:** « Above 80%, noise fires a visual and a haptic cue (story 3.1). » The 80 % is the only threshold there that is not marked `[ASSUMPTION]`.

**What this story is not:**
- **No `MamaWoke` and no early end.** At 100 % the gauge stops at 100 and nothing else happens. Story 3.2 adds `MamaWoke`, `LevelEnded{reason: "mamaWoke"}`, the −1 star and the « Maman s'est réveillée ! » header.
- **No emitter for the later sources.** Floorboards and breath (4.9) and sniffing (5.3) get their row in `feel.noise.sources` now, and nothing emits them yet. The dog bark (+10 %, 6.1), the wrong remedy (+5 %, 5.4) and the snore (+15 %, 4.4) are not in the AC list. Each of those stories adds its own row (D4).
- **No live threat declares `gagCryMs`.** The mechanism (a gag that makes the baby cry, `BabyCrying`, +2 %/s) is built and tested on frozen test threats. Which live gag makes the baby cry is Geo's call (Open point 1).
- **No sound for the noise or for the cry.** The 80 % alert is haptic plus visual (a haptic-only cue is allowed, like `silence_started`). Crying sounds belong to 2.3 and 5.4.
- **No variant rule.** `LEVEL_VARIANTS` is `['nap']` only. « Bruit only in Sieste » holds because the one variant is Sieste and a level opts in with `gauges.noise` (D2). Story 3.10 (`return`) adds the refusal of `gauges.noise` outside `nap`.
- **No change to the code of stories 1.15 and 1.20** (epics AC 3). This covers `propsSystem.ts`, `rapierPhysics.ts`, `physicsPort.ts`, `disruptionsSystem.ts`, `phone.ts`, `phoneCall.ts`, the `PropImpact` / `PropBroken` / `Phone*` event shapes, `PropSlice` and `DisruptionInstance`. The noise reads their events and nothing else.

**Sources:**
- Epics `epics.md` L51 (FR18), L65 (FR29, the phone's noise half), L71 (FR32), L218-221 (UX-DR4), L258-261 (UX-DR26: HUD ≤ 40 DOM nodes, `scaleX` only), L1534-1561 (this story), L1563-1588 (3.2, next), L1759 (3.10: no noise in Retour).
- GDD `gdds/gdd-papa-parade-2026-10-26/gdd.md` L44 (« les bruits de papa menacent »), L93, L107 (Sieste row), L174 (rule 7, the numbers), L238 (phone: « bruit +2 %/s tant qu'il sonne »), L399 (« un gag coûte … du bruit »), L445 (sound-off equivalents), L559 (every number is a starting value).
- Architecture `game-architecture.md` L246 (noise from Rapier contacts filtered by impulse), L252 / L400 / L411 (`NoiseChanged{t, value, delta}`), L348-351 (`noise.ts` sample with `clampInvariant`: superseded, D6), L492 (`gauges/noise.ts`), L585, L629 (`noisePct`), L958 (E3 prototype row).
- UX `DESIGN.md` L158-172 (`hud-gauge` frontmatter), L396-398 (gauge tokens), L409 (warn never relies on hue alone), L522-526 (prose: « The noise gauge's "progressive colour code" (story 3.1) uses the calm→warn pair »). `EXPERIENCE.md` L124, L164 (« Bruit » in Sieste only), L207 (component row), L379 (fade rule), L420 (juice: « Above 80% noise (story 3.1) »), L482 (`scaleX` only), L557 (journey step 5). Mockup `mockups/key-hud-level.html` L54-62, L157 (`#i-bruit`, already in `gaugesHud.ts`), L178-183.
- Previous stories: `1-15-physique-legere-des-objets.md` D6 (`PropImpact`), `1-19-fatigue-cafe-et-micro-siestes.md` (the gauge pill, `runGauges`, `addFatigue` as the only writer, D5, D11, D12), `1-20-le-telephone-qui-sonne.md` D5 (`PhoneRinging` = one second), `1-21-le-silence-suspect.md` (`isBabyFoundNow`: a system reading this step's events), `1-22-note-de-maman-et-ecran-de-fin.md` (client feedback events `ResultStarStamped`).
- Deferred work `deferred-work.md` L262, L343, L346 (HUD node budget, check it here), L354 (renames at the next snapshot bump, D11), L360, L365, L370.

## Acceptance Criteria

Numbers in `content/feel.json` are live starting values for Geo to tune. Tests use the frozen `tests/support/testFeel.json` (which gains the same `noise` block), never the live file. « % » and « points » are the same unit here: the gauge runs 0-100 (`GAUGE_MAX_POINTS`).

### The gauge (sim)

1. **The feel table.** `content/feel.json` gains a `noise` block (D3), validated by a strict `NoiseSchema` in `src/content/schemas/feel.ts` with no defaults:
   ```json
   "noise": {
     "decayPerSec": 1,
     "alertPct": 80,
     "sources": {
       "propImpact": { "minPct": 5, "maxPct": 15, "minImpulseNs": 0.3, "maxImpulseNs": 2, "samePropCooldownMs": 1000 },
       "phoneRinging": { "perSec": 2 },
       "babyCrying": { "perSec": 2 },
       "floorCreak": { "noisePct": 3 },
       "breathReleased": { "noisePct": 5 },
       "sniff": { "noisePct": 3 }
     }
   }
   ```
   - The schema refuses `minPct > maxPct` and `minImpulseNs >= maxImpulseNs`, naming the key.
   - Every `…Pct` is in `[0, 100]`.
   - `npm run content:schemas` regenerates `content/_schemas/feel.schema.json`.
   - `tests/support/testFeel.json` gets the same block, so the goldens' `feelHash` moves (AC 15).

2. **A level opts in.** `LevelGaugesSchema` gains `noise: z.strictObject({}).optional()`: present means the level has the noise gauge (D2).
   - `content/levels/salon_crawler.json` declares `"gauges": { "noise": {}, "fatigue": { … } }`.
   - `SimLevel` gains `hasNoise: boolean`, set by `createSim`.
   - In a level without it nothing changes: no value, no event, no HUD gauge.

3. **One writer.** `src/sim/gauges/noise.ts` › `addNoise(world, ctx, deltaPct, source)` is the only writer of `world.gauges.noisePct` (the `addFatigue` pattern, 1.19 D5).
   - It does nothing in a level without noise.
   - It clamps the value to `[0, GAUGE_MAX_POINTS]` silently: reaching 0 or 100 is gameplay, not a bug (D6).
   - When the value actually changed, it emits `NoiseChanged{t, source, noisePct, deltaPct}`. `deltaPct` is the change after the clamp. A change of 0 emits nothing (D5).

4. **The step.** `runNoise(world, ctx)` (in `src/sim/gauges/noiseSystem.ts`) is called by `runGauges` after this step's debug commands and after `runFatigue`. `SYSTEMS` does not change. In order:
   1. **Decay.** The value goes down by `decayPerSec × STEP_MS / 1000`, with no event (D5). Sim time drives it, so a slow-mo slows it and a pause or the end of the level stops it.
   2. **Sources.** For each event of **this step** (scanned like `isBabyFoundNow`: from the end of `ctx.events` while `event.t === world.time.sim`, then applied in emission order, D7):
      - `PropImpact`: `+lerp(minPct, maxPct, clamp01((impulseNs − minImpulseNs) / (maxImpulseNs − minImpulseNs)))`, unless the same prop made noise less than `samePropCooldownMs` ago (D8). Each prop of a prop-on-prop hit counts on its own.
      - `PhoneRinging`: `+phoneRinging.perSec × PHONE_RINGING_EVERY_MS / 1000`, so +2 per event.
      - `BabyCrying`: `+babyCrying.perSec × BABY_CRYING_EVERY_MS / 1000`, so +2 per event.
   - It never reads the phone's or the props' state, only their events (epics AC 3).

5. **The crying baby.** A threat def may declare `gagCryMs`, an optional positive integer in sim ms, on both variants of `ThreatDefSchema` (D9).
   - When `gagThreat` fails such a threat, after `applyGag`, it calls `startBabyCry(world, ctx, def.gagCryMs)` (`src/sim/baby/cry.ts`).
   - The baby then cries until `cryEndsAt = max(cryEndsAt ?? now, now + gagCryMs)`. A gag during a cry extends it, on the same tick grid.
   - `runBaby` emits `BabyCrying{t}` at the first step at or after each `cryStartedAt + k × BABY_CRYING_EVERY_MS` (k ≥ 1), up to `cryEndsAt` included, with no drift (the `PhoneRinging` contract). So a cry of `gagCryMs` gives `floor(gagCryMs / BABY_CRYING_EVERY_MS)` events. Then the cry is over (`cryStartedAt` and `cryEndsAt` back to `null`).
   - A cry runs in any level, with or without noise: crying is the baby's, the noise is the gauge's.
   - `BABY_CRYING_EVERY_MS = 1000` lives in `shared/constants.ts`, beside `PHONE_RINGING_EVERY_MS`, with the same « contract, not a feel » comment.
   - No live def declares `gagCryMs` (Open point 1).

6. **Debug command.** `SetNoise{t, pct}` is a debug / test command, journaled like `SetFatigue`.
   - `commandProblem` refuses a non-finite `pct`.
   - `runGauges` applies it first, through `addNoise(world, ctx, pct − noisePct, 'debug')`. A value out of `[0, 100]` is clamped.

7. **Events.** `events.ts` gains two events, documented like their neighbours, and `SIM_EVENT_TYPES` stays sorted and complete:
   - `NoiseChanged{t, source: NoiseSource, noisePct, deltaPct}`. `NoiseSource` is the keys of `feel.noise.sources` plus `'debug'`, typed from the schema.
   - `BabyCrying{t}`, not past tense: the epic names it, like `PhoneRinging`.
   - The architecture's `value` / `delta` become `noisePct` / `deltaPct` (unit rule).

8. **Snapshot v12.** `world.gauges` gains `noisePct: number` and `propNoiseAt: (SimMs | null)[]`, index-aligned with `world.props` and all `null` at the start. `world.baby` gains `cryStartedAt: SimMs | null` and `cryEndsAt: SimMs | null`.
   - The snapshot version becomes 12.
   - `gaugesProblem` refuses a `noisePct` that is not finite or is outside `[0, 100]`, and `noisePct ≠ 0` in a level without noise.
   - It also refuses a `propNoiseAt` of the wrong length or with an entry that is not `null` or a finite number ≥ 0.
   - The baby check refuses a cry pair where only one side is `null`, or where `cryEndsAt < cryStartedAt`.
   - The determinism and snapshot round-trip tests cover a level with noise, mid-cry.

### The HUD (client)

9. **The gauge shows first.** In a level with `gauges.noise`, the pill shows Bruit, then Fatigue. The order comes from `GAUGE_IDS`, untouched; `gaugesHud.ts` already has the icon, the label and the slot.
   - `boot.ts` › `onLevelStarted` sets its start value.
   - `onLevelFrame` writes `Math.round(world.gauges.noisePct)` through `hudBatch` (slot `gaugeSlotOf('noise')`), like the fatigue.
   - The calm → warn colour from 70 %, the icon pulse, the 70 % idle opacity under 50 % and the « changing » hold are the 1.19 rules, unchanged.
   - In a level without noise there is no Bruit gauge.

10. **The 80 % alert.** When a drained `NoiseChanged` crosses `feel.noise.alertPct` upwards (`noisePct − deltaPct ≤ alertPct < noisePct`), the client plays it once (D10):
    - the `noise_alert` cue, through a new client feedback event `NoiseAlertReached`, mapped in `content/feedback.json` › `events`. It is `{ "visual": { "kind": "uiElement" }, "haptic": "medium" }`, with no audio.
    - the visual twin: the noise gauge gets `pp-hud-gauge-alert` for one run of a short shake animation (about 600 ms, a CSS `transform` only). Under `prefers-reduced-motion` the shake is replaced by a non-moving flash (the icon chip's ring goes from 3 px to 5 px for the same time).
    - It fires again on the next upward crossing, after a fall below the threshold.
    - The `debug` source counts: `SetNoise` to 90 from 0 alerts. The e2e test uses this.

11. **HUD budget.** With Bruit and Fatigue both shown, `#pp-hud` stays within `HUD_MAX_DOM_NODES` (40). The existing checks in `fatigue.spec.ts` / `timer.spec.ts` / `ui.spec.ts` run on `salon_crawler`, which now has both gauges. If it goes over, the gauge markup gets lighter. The budget is never raised (deferred-work L346).

12. **Mirrors.** In mirrored builds (dev, `?debug=1`), `data-pp-noise` is the rounded value.
    - It is written at the level start and on each `NoiseChanged`, never per frame.
    - It is removed in a level without noise, like `ppFatigue`.
    - The decay does not write it: e2e reads `ppWorld(page).gauges.noisePct` for exact values.

### Bots, CLI and tests

13. **Report.** `tools/sim/simReport.ts` gains, per run:
    - `noisePeakPct`: the highest `NoiseChanged.noisePct`, 0 if none.
    - `noiseFinalPct`: the final world's, rounded to 0.1.
    - `noiseBySourcePct: Record<NoiseSource, number>`: the sum of positive `deltaPct` per source.
    The aggregate reports the mean and max of the peak and the summed `noiseBySourcePct`, and `--help` and the tool's tests are updated. `npm run sim -- --bot random --runs 100` and `--bot idle` / `--bot perfect` give numbers that go into the Completion Notes. They tell Geo whether 3.2 will end games (Open point 2).

14. **Unit tests** (next to the code, `vitest`), at least:
    - `noise.test.ts`: the clamp at both ends; no event for a change of 0; `deltaPct` after the clamp; nothing at all in a level without noise.
    - `noiseSystem.test.ts`: the decay over one second is exactly `decayPerSec` (100 steps, float-tolerant); the `PropImpact` lerp at `minImpulseNs`, mid-range, `maxImpulseNs` and above; the per-prop cooldown (two impacts of the same prop 500 ms apart count once; two props in one step both count); `PhoneRinging` and `BabyCrying` +2 each; events of earlier steps left undrained in `ctx.events` are not counted again (D7); `SetNoise`.
    - `cry.test.ts`: a 3500 ms cry gives 3 `BabyCrying` at +1000, +2000, +3000; an extension keeps the grid; nothing once the level has ended.
    - Schema tests (`tests/content/feelSchema.test.ts`, the threat and level schema tests): the refusals of AC 1, `gagCryMs` ≤ 0 or non-integer refused, `gauges.noise` with a key refused.
    - `events.test.ts` and `commands.test.ts` updated.
    - The architecture test `simPurity` still passes, and no file of 1.15 / 1.20 appears in the diff (`git diff --stat` in the Completion Notes).
    - Coverage of `src/sim` stays at or above 90 % (`npm run test:coverage`).

15. **Goldens.** The new `testFeel.json` keys move `feelHash`, and the new world fields move `worldHash`. Regenerate with `npm run golden:update` and say so in the Completion Notes.
    - The scenarios use `createTestLevel()` with no `gauges.noise`, so their journals must not gain any `NoiseChanged`. Check this in the diff of `tests/golden/journals/`: only hashes may move.
    - One new golden scenario is optional: `prop_fall` with `gauges: { noise: {} }`. It pins how much noise one fall from the coffee table makes (Open point 3).

16. **End to end** (`tests/e2e/noise.spec.ts`, chromium + webkit, frozen level, `ppSend` / `ppAdvance` like `fatigue.spec.ts`):
    - On `salon_crawler` the pill holds two gauges, Bruit first, then Fatigue, with `aria-label`s « Bruit 0 % » and « Fatigue 0 % ».
    - `SetNoise` 75 shows `pp-hud-gauge-warn` on Bruit with `scaleX(0.75)`.
    - `SetNoise` 90 from below 80 adds `pp-hud-gauge-alert`, and in Chromium vibrates with the `medium` pattern read from `content/feedback.json` (`hapticPatternOf('NoiseAlertReached')`, the `feedback.spec.ts` helper). WebKit has no `navigator.vibrate`, so it checks the class only.
    - After advancing 10 s of sim time from 50, the value is 40 (±0.5).
    - Nothing in the existing e2e suite regresses. If the second gauge changes a screenshot, refresh both references (darwin and linux, the Docker command of story 1.13) and say so.

17. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch (typecheck, lint, `content:check`, coverage, e2e, playtest build).

## Tasks / Subtasks

- [x] **T1. Content and schemas** (AC 1, 2, 5)
  - [x] `src/content/schemas/feel.ts`: `NoiseSchema` and its sources (D3). Use `pct()` / `durationMs()` / `delayMs()` / `points()` style helpers. Add the two refines, and add `noise` to `FeelSchema` after `fatigue`. Export `NOISE_SOURCE_IDS` (the keys, in file order) for the sim and the report.
  - [x] `src/content/schemas/level.ts`: `noise` in `LevelGaugesSchema`. Update the header comment and the `GAUGE_IDS` doc (« only `fatigue` has a level schema entry so far »).
  - [x] `src/content/schemas/threat.ts`: `gagCryMs` in `baseShape`, optional, `z.int().positive()`, described in sim ms.
  - [x] `content/feel.json`, `tests/support/testFeel.json`, `content/levels/salon_crawler.json`.
  - [x] `npm run content:schemas`, then `npm run content:check`. Add a `content:check` rule only if one is needed; none is expected.
- [x] **T2. Sim: the noise** (AC 3, 4, 6, 7)
  - [x] `src/shared/constants.ts`: `BABY_CRYING_EVERY_MS = 1000`, documented like `PHONE_RINGING_EVERY_MS`.
  - [x] `src/sim/events.ts`: `NoiseChanged`, `BabyCrying`, `SIM_EVENT_TYPES`. Rewrite the `PropImpact` / `PhoneRinging` docs only if a word is wrong (they already announce 3.1). Those are comments in `events.ts`, not 1.15 / 1.20 code.
  - [x] `src/sim/commands.ts`: `SetNoise`, in `COMMAND_TYPES` and `commandProblem`.
  - [x] `src/sim/context.ts` (`SimLevel.hasNoise`) and `src/sim/createSim.ts` (sets it from `level.gauges.noise !== undefined`).
  - [x] `src/sim/world.ts`: the `GaugesSlice` and `BabySlice` fields, with docs. `createWorld` sets `noisePct: 0` and `propNoiseAt` to one `null` per prop.
  - [x] `src/sim/gauges/noise.ts` (`addNoise`, the impulse lerp as a pure exported helper `propImpactNoisePct(feel, impulseNs)`) and `src/sim/gauges/noiseSystem.ts` (`runNoise`). They are split like fatigue / fatigueSystem only if needed; otherwise one file, `noise.ts`, as the architecture names it.
  - [x] `src/sim/gauges/gaugesSystem.ts`: `SetNoise` in the command loop, then `runFatigue`, then `runNoise`. Update its doc and `step.ts`'s header comment (« noise joins it in 3.1 » becomes a fact).
- [x] **T3. Sim: the cry** (AC 5)
  - [x] `src/sim/baby/cry.ts`: `startBabyCry` and `runBabyCry` (the ticks). `runBaby` calls `runBabyCry` first, before `runSilence`.
  - [x] `src/sim/threats/threatFsm.ts` › `gagThreat`: after `applyGag`, `if (def.gagCryMs !== undefined) startBabyCry(...)`. Do not put it in `gags.ts`'s `GAG_CONSEQUENCES`: the cry belongs to the def, not to the gag id (D9).
- [x] **T4. Snapshot v12** (AC 8)
  - [x] `src/sim/snapshot.ts`: version 12 (the type, the literal, the `invariant`); `gaugesProblem` gets the level's `hasNoise` and prop count; the baby check gets the cry pair. Update the snapshot tests and the `version` fixtures.
- [x] **T5. Client** (AC 9, 10, 12)
  - [x] `src/client/boot.ts`: noise start value, per-frame `hudBatch.set`, the `ppNoise` mirror, the crossing test on drained `NoiseChanged` → `director.handle('NoiseAlertReached', null)` + `gaugesHud.alert('noise')`. The crossing test is a pure helper with a unit test, e.g. `src/client/feedback/noiseAlert.ts` › `isNoiseAlertCrossing(event, alertPct)`.
  - [x] `src/client/feedback/feedbackEvents.ts`: `'NoiseAlertReached'` in `FEEDBACK_CLIENT_EVENTS`.
  - [x] `src/client/ui/hud/gaugesHud.ts`: `alert(id)` restarts the one-shot class (remove it, force a reflow-free restart with `animationend` cleanup or a toggle on the next frame, no per-frame allocation). Add tests in `gaugesHud.test.ts`.
  - [x] `src/client/ui/styles/ui.css`: `.pp-hud-gauge-alert` keyframes (transform only) and the `prefers-reduced-motion` variant, using tokens only (no hex).
  - [x] `content/feedback.json`: the `noise_alert` cue and the `NoiseAlertReached` event; `npm run content:check`.
- [x] **T6. Report** (AC 13)
  - [x] `tools/sim/simReport.ts` (+ `tests/tools/sim/simReport.test.ts`, `runSim` `--help`).
- [x] **T7. Tests and goldens** (AC 14, 15)
  - [x] Unit tests listed in AC 14. `tests/support/testContent.ts`: frozen test threats can take `gagCryMs` (add one, e.g. `testCrying.threat.json`, or an override helper).
  - [x] `npm run golden:update`; check the journals diff (hashes only).
- [x] **T8. End to end** (AC 11, 16)
  - [x] `tests/e2e/noise.spec.ts`. Run the whole e2e suite: `fatigue.spec.ts` asserts a single gauge in the pill (`GAUGE` locator, `aria-label` « Fatigue 0 % »), so update its locators to target the fatigue gauge by position or label, without weakening what it checks.
- [x] **T9. Docs**
  - [x] `_bmad-output/project-context.md` L40: `runGauges` is fatigue then noise. A level opts into noise with `gauges.noise`, and `addNoise` is the only writer of `noisePct`. L41: say that `runNoise` reads **this step's** `PropImpact` / `PhoneRinging` / `BabyCrying` (like `isBabyFoundNow`), the one gauge built on events (epics AC 3).
  - [x] `deferred-work.md`: close L262, L346 (with the measured count), L360, L365, L370. Add a « Deferred from: story 3.1 » section with the open points that stay open and the sources with no row (dog, wrong remedy, snore).
- [x] **T10. CI** (AC 17): `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

## Dev Notes

### Decisions (D1-D11)

| # | Decision | Why |
|---|---|---|
| D1 | **Noise lives in `runGauges`**, after the fatigue, in `src/sim/gauges/noise.ts` (+ `noiseSystem.ts` if it grows). No new system and no change to `SYSTEMS`. | 1.19 built `runGauges` « so that the noise gauge (story 3.1) joins it ». It runs after `runDisruptions` (`PhoneRinging`), `runBaby` (`BabyCrying`), `runThreats` (gags) and `runPhysics` (`PropImpact`), so every source event of the step already exists. |
| D2 | **Opt-in per level, `gauges.noise: {}`**, not derived from `variant`. | It follows the 1.19 rule « a gauge exists only if its system is in the level », and the HUD code already does `GAUGE_IDS.filter((id) => id in gauges)`. With one variant (`nap`), « Sieste only » holds by content. Story 3.10 refuses `gauges.noise` outside `nap` when `return` exists (a refine that cannot fail today cannot be tested today). |
| D3 | **`feel.noise`**: `decayPerSec`, `alertPct`, and `sources` with one key per source. Per-event sources (`propImpact`) have their own shape. Per-second sources (`phoneRinging`, `babyCrying`) have `perSec`. One-shot later sources have `pct`. | « Anything Geo might tweak is data ». `perSec` × the contract period (`PHONE_RINGING_EVERY_MS`, `BABY_CRYING_EVERY_MS`) keeps the rule « +2 % par seconde » true even if a period changed. The `fatigue.perSec` naming is the precedent. The 70 % warn stays in `gaugesHud.ts` (`WARN_FROM_PCT`, a display value, 1.19 D12). |
| D4 | **Later sources are rows with no emitter**: `floorCreak`, `breathReleased`, `sniff`. They are typed into `NoiseSource`, so their stories only emit. | Epics AC 1, last bullet. The dog, the wrong remedy and the snore are not in that list, so their stories add the rows (a strict schema must not hold dead keys nobody asked for). |
| D5 | **`NoiseChanged` is per source event, not per step.** The decay is silent: the HUD reads `world.gauges.noisePct` every frame through `hudBatch`, as for the fatigue and the silence bubble. A change of 0 (already at 100, or a 0 tuning) emits nothing. | A 1 %/s decay at `STEP_MS` = 10 would be 100 events per second in every journal and golden. Readers that need the exact value read `World`. Story 3.2 tests « reaches 100 » on the value after `addNoise`, not on an event. |
| D6 | **A silent clamp, not `clampInvariant`.** | The architecture sample (L348-351) predates 1.19 D5, which settled it: `clampInvariant` is for bugs, and +15 at 95 % is gameplay. Same as `addFatigue`. |
| D7 | **Reading this step's events.** `runNoise` scans `ctx.events` backwards while `event.t === world.time.sim`, then applies that tail in order (keep a start index, so no allocation). | `ctx.events` is drained by the caller, not per step. Headless `playGame` and `advance(n)` step many times between drains, so a scan from 0 would count an impact twice. Sim time advances by exactly `STEP_MS` every step (`clock.ts` L13), so `t === now` marks this step's events. This is the `isBabyFoundNow` precedent (`baby/silence.ts` L41-48). |
| D8 | **`PropImpact` → `minPct..maxPct`, linear in `impulseNs` between `minImpulseNs` and `maxImpulseNs`, clamped, plus `samePropCooldownMs` per prop** (`world.gauges.propNoiseAt[i]`; 0 disables it). | The GDD gives +5 to +15 % **per falling object**. A mug falling off the table bounces (restitution 0.3) and gives a second `PropImpact` above `impactMinImpulseNs`, about 100 ms later. Without a per-prop window one fall would cost 20 % or more. `physics.impactCooldownMs` is 1.15's and only throttles the event, so the noise keeps its own window. Its own `minImpulseNs` (equal to `physics.impactMinImpulseNs` today) keeps the table self-contained, with no cross-section refine. Each side of a prop-on-prop hit counts (two objects clatter). Open point 3. |
| D9 | **`gagCryMs` on the threat def; `BabyCrying` emitted by the baby, one per second.** | The epic says « quand un gag déclare `gagCryMs` ». A gag id (`table_object_fall`) is shared by many defs, so the def is where a level designer says « this one makes him cry ». Emitting `BabyCrying` from the baby side (like `PhoneRinging` from the phone) gives E5's typed cries (5.4, « +2 %/s ») a ready contract: they start a cry, the noise needs no change. `gagThreat` calls a helper (`startBabyCry`) and never writes `world.baby` itself. |
| D10 | **The 80 % alert is the client's.** It fires on an upward crossing read from `NoiseChanged` (`noisePct − deltaPct ≤ alertPct < noisePct`), plays the haptic-only cue `noise_alert` (`medium`) through the client feedback event `NoiseAlertReached`, and runs a one-shot shake of the gauge as the visual twin. | It is presentation, like the star stamps (1.22). The sim needs no extra state: the event carries the value before and after, and the decay runs before the sources in a step, so `noisePct − deltaPct` is the value just before. « Au-delà de 80 % » means strictly above. It re-arms after a fall below. Medium is stronger than a telegraph (`light`) and weaker than a gag (`heavy`). The look is an `[ASSUMPTION]` for Geo (Open point 4). |
| D11 | **No renames of `fatigue` / `busyUntil`** in this snapshot bump, although `deferred-work.md` L354 says « do it with the next snapshot version bump ». | `PhoneAnswered.fatigue` is a 1.20 event field, and epics AC 3 forbids touching 1.20's code. A partial rename would leave the names inconsistent. The new fields follow the rule (`noisePct`, `deltaPct`, `propNoiseAt`, `cryStartedAt`, `cryEndsAt`). Update the deferred note: « not with 3.1, because its AC forbids touching 1.20 ». |

### Current state of the files this story changes (read before editing)

- **`src/sim/gauges/gaugesSystem.ts`** (19 lines). `runGauges` applies `SetFatigue`, then calls `runFatigue`. Its doc already says the noise joins here. Keep that order: commands, fatigue, then noise.
- **`src/sim/gauges/fatigue.ts` / `fatigueSystem.ts`.** This is the pattern to copy: one writer (`addFatigue`), a level guard first (`microSleepIndex < 0` → return), a silent clamp, and events only on meaningful change. Do not touch them.
- **`src/sim/world.ts`.**
  - `GaugesSlice` (L232-243) has `fatigue`, `isFatigueAbove` and `microSleepAt`, and its doc says « noise joins in 3.1 ».
  - `createWorld` (L379) builds `gauges`, and `WorldOptions` has `props`. `propNoiseAt` takes their count.
- **`src/sim/events.ts`.**
  - `PropImpact` (impulse in `impulseNs`, `otherPropId`) and `PhoneRinging` (one per `PHONE_RINGING_EVERY_MS`) already document the 3.1 contract.
  - `LevelEndReason` is `'timer'` and stays so (3.2).
  - `SIM_EVENT_TYPES` is sorted, and a compile-time proof checks that it is complete.
- **`src/sim/threats/threatFsm.ts` › `gagThreat`** (L170-193) emits `ResponseResolved{fail}` and `GagTriggered`, then calls `applyGag`. The cry goes after `applyGag`.
- **`src/sim/threats/gags.ts`.** Its header already says « noise from `PropImpact`, story 3.1 ». No change is needed, beyond a doc line saying the cry comes from the def (`gagCryMs`).
- **`src/sim/baby/babySystem.ts`** runs `runSilence` and the baby FSM. Add `runBabyCry` at the top. The cry does not change `BabyState`; it is a parallel timer (the baby can cry while it wanders).
- **`src/sim/snapshot.ts`.**
  - The version is 11 (L38, L57, L727).
  - `gaugesProblem(gauges, hasFatigue)` (L288-310) gets a third and a fourth argument (`hasNoise`, `propCount`) or a small options object.
  - The comments explain each check; keep that style.
- **`src/sim/createSim.ts`** builds `SimLevel` (look for `microSleepIndex`). Add `hasNoise` there.
- **`src/sim/commands.ts`.** `SetFatigue` (L15, L66, L96) is the model for `SetNoise`.
- **`src/content/schemas/level.ts`.**
  - `LEVEL_VARIANTS = ['nap']`.
  - `GAUGE_IDS = ['noise', 'fatigue', 'need']` (the pill order; do not reorder).
  - `LevelGaugesSchema` has `fatigue` only.
- **`src/content/schemas/feel.ts`.** Every key is required, with no `.default()` / `.optional()`. Refines are per block (`.refine(…, {path, error})`). `FatigueSchema` is the closest model.
- **`src/client/ui/hud/gaugesHud.ts`** already has the noise icon (`#i-bruit` from the mockup), the label key `gauge.noise` (« Bruit », in `strings.fr.json`) and the order. No new string is needed. It exposes `setGauges`, `setValue` and `frame`. Add `alert(id)`.
- **`src/client/boot.ts`.**
  - L64 `gaugeSlotOf`.
  - L369-377 `mirrorFatigue`: copy it for `ppNoise`.
  - L548-555 `onLevelStarted`: set the noise start value next to the fatigue.
  - L600-605: per-frame `hudBatch.set` for the fatigue; add the noise.
  - L772-777 `hudBatch` already has one slot per `GAUGE_IDS` entry, noise included.
  - Find where drained sim events reach `director.handle` and the mirrors, and add the crossing test there.
  - L847 shows how a client feedback event is played: `director.handle('ResultStarStamped', null)`.
- **`src/client/feedback/feedbackEvents.ts`** lists `FEEDBACK_CLIENT_EVENTS` (`CountdownTicked`, `ResultStarStamped`, `ResultLastStarStamped`). `content:check` checks the names in `feedback.json` › `events` against it.
- **`content/feedback.json`** › `cues.silence_started` (`{ "haptic": "light" }`) is the precedent for a cue with no audio. `feedbackEquivalence.test.ts` only constrains cues that have an audio.
- **`tools/sim/simReport.ts`** already counts `phoneRingingSeconds` (« the number 3.1 will turn into noise »). Keep it, and add the noise fields next to it.
- **`tests/e2e/fatigue.spec.ts`** L29-30: `GAUGE = '${PILL} > .pp-hud-gauge'` assumes a single gauge. With Bruit first, `.first()` would now be the noise gauge, so retarget it (e.g. `nth(1)` with a comment, or filter by `aria-label` starting with « Fatigue »).

### Must not change (epics AC 3 and regressions)

- No line of `src/sim/physics/**` or `src/sim/disruptions/**`, and none of `src/sim/papa/phoneCall.ts`. The `PropImpact`, `PropBroken`, `PhoneRingStarted`, `PhoneRinging`, `PhoneRingEnded` and `PhoneAnswered` shapes stay as they are.
- The fatigue's behaviour and events. The golden journals gain no event, because their test level has no noise.
- `GAUGE_IDS`, the pill's order, the 70 % warn, the 50 % idle and the « changing » hold (1.19).
- Mama's note: the noise does not enter the score in 3.1. The −1 star is 3.2's, for an early wake only.

### Architecture compliance

- Sim purity: no `Math.random`, `Date`, `performance` or `console`. `BabyCrying` ticks and the decay use `world.time.sim` only, and no `world.rng` draw is added, so the draw count is unchanged and other goldens' journals stay identical.
- `World` stays plain JSON: `propNoiseAt` is an array of `number | null`, never `-Infinity` (the snapshot clone and JSON drop it).
- Hot paths allocate nothing: `runNoise` loops over indices, has no `filter` / `map`, and keeps a start index rather than slicing.
- The client reads `@sim` only (types `NoiseSource` and `SimEvent` from `src/sim/index.ts`; export what you add). `@content` gives `Feel`.
- Every tunable number is in `feel.json` except the contract periods (`BABY_CRYING_EVERY_MS`, constants) and display values already in `gaugesHud.ts`. The shake's 600 ms is CSS animation timing, like the existing pulse (`ui.css` L405), not feel.

### Library and framework notes

- No new dependency. Zod 4 (`z.strictObject`, `z.int()`, `.refine(…, { path, error })`) as in `feel.ts`. Vitest and Playwright as already configured.
- Haptics go through `Platform.haptics` via the feedback director, never `navigator.vibrate` directly (project-context L136).

### File structure

New:
- `src/sim/gauges/noise.ts` (+ `noise.test.ts`), optionally `noiseSystem.ts` (+ test)
- `src/sim/baby/cry.ts` (+ `cry.test.ts`)
- `src/client/feedback/noiseAlert.ts` (+ test), or the helper inside an existing feedback module
- `tests/e2e/noise.spec.ts`
- a frozen crying test threat in `tests/support/` if needed

Updated:
- `src/content/schemas/{feel,level,threat}.ts`
- `content/{feel.json,feedback.json,levels/salon_crawler.json}` and `content/_schemas/*` (generated)
- `src/shared/constants.ts`
- `src/sim/{events,commands,context,createSim,world,snapshot,step}.ts`, `gauges/gaugesSystem.ts`, `baby/babySystem.ts`, `threats/threatFsm.ts` (and `threats/gags.ts` doc), `index.ts`
- `src/client/boot.ts`, `feedback/feedbackEvents.ts`, `ui/hud/gaugesHud.ts`, `ui/styles/ui.css`
- `tools/sim/simReport.ts` (+ `runSim.ts` help)
- tests and fixtures, golden journals (hashes), `tests/e2e/fatigue.spec.ts` locators
- `_bmad-output/project-context.md`, `deferred-work.md`

### Testing

- Unit first: `noise.test.ts` and `cry.test.ts` with a hand-built `World` / `StepContext` (see `fatigue.test.ts` and `tests/support/simSupport.ts`).
- An integration test through `createSim` + `createTestLevel({ gauges: { noise: {} } })`:
  - push a prop (debug `PushProp`) and check that `noisePct` rises once within 5-15 % for one fall;
  - force a phone (`StartDisruption`, the 1.20 debug command) and ignore it: +2 per ring;
  - a frozen `gagCryMs` threat missed gives the cry.
- Determinism: same seed, same journal, same `worldHash`, with noise on. A snapshot taken mid-cry and restored ends in the same state.
- Run `npm run test:coverage`, not just `npm test`: CI enforces the `src/sim` ≥ 90 % thresholds.
- e2e under load: if two worktrees run CI at once, rerun with `--workers=4` and say so.

### Previous story intelligence (1.15, 1.19-1.23)

- **1.23** (last merged) touched `threatFsm.ts` (Firmness, `ResponseHeld`) and `holdRing`. `gagThreat`'s signature is current; do not reorder its events.
- **1.22** added client feedback events and a cue with `visual.kind: "uiElement"`, which is only valid for a client event (the schema says so). It also put `world.score` counters « written at their source ». The noise follows that: `addNoise` is the source.
- **1.21** set the precedent of a system reading this step's events by `t === now` (D7), and of a haptic-only cue (`silence_started`).
- **1.20** gives one `PhoneRinging` = 1 s (D5). `ringMaxMs` is 15 s, so an ignored phone is +30 % (deferred L370). A phone still ringing at the end is closed by `runFlow` (`PhoneRingEnded{levelEnded}`). The noise ignores `PhoneRingEnded` anyway.
- **1.19** gave the pill, `runGauges`, the one-writer pattern, the silent clamp (D5), the 70 % display vs sim thresholds (D12) and the « changing » hold (D11). The review deferred the HUD node budget to here (L346).
- **1.15** emits `PropImpact` at most once per `impactCooldownMs` (100 ms) per prop, in prop index order, with one event per side of a prop-on-prop hit (D6).
- Reviews keep catching: missing unit suffixes, a dead schema tuning (add bounds and refines with rejection tests), tests that read the live `feel.json` (use `testFeel.json`), undisclosed golden moves, and e2e locators that silently change meaning when the DOM grows.

### Git intelligence

- The last commits are the 1.23 cycle (`9b4bfeb` creation, `ab522f7` implementation, `d0461a2` review fixes, `516b463` merge). They follow the branch-per-story flow; this story is on `story/3-1-jauge-de-bruit`, in its worktree.
- 1.22 (`659150d`) is the closest in shape. It changed the feel schema, `feedback.json`, client feedback events, `boot.ts`, the `events.ts` union and the schemas, plus the regenerated `content/_schemas`.

### Project Structure Notes

- `src/sim/gauges/noise.ts` is the file the architecture names (L492, L958).
- The cry is in `src/sim/baby/` because it is the baby's state.
- The alert helper stays client-side, in `src/client/feedback/`.
- No conflict with the unified structure.
- **Variance with the architecture (by design):**
  - `NoiseChanged` fields are suffixed (`noisePct`, `deltaPct`) and carry a `source`.
  - The clamp is silent, not `clampInvariant` (D6).

### Project context rules (from `_bmad-output/project-context.md`)

- Layers: the sim imports `shared` and `content` types only. The client imports `@sim`, never sim internals. Cross-layer imports go through aliases; inside `src/sim`, imports are relative.
- The sim never logs and never reads real time or randomness except `world.rng`. It emits `SimEvent`s, PascalCase past tense (`BabyCrying`, like `PhoneRinging`, is the epic's name; say so in its doc).
- `World` is serializable: no `Map`, `Set`, class instances or non-finite numbers.
- No GDD number is hard-coded: +2, 1 %/s, 5-15 %, 80 % and the per-prop window all live in `feel.json`.
- Units are mandatory suffixes (`noisePct`, `deltaPct`, `perSec`, `samePropCooldownMs`, `minImpulseNs`).
- Unit tests sit next to the code and import `describe`, `it` and `expect` from `vitest`.
- Content ids are `lower_snake_case`; JSON keys are `camelCase`. `content/_schemas` is generated, never edited by hand.
- No `console.*`. Every fallback logs a `warn`. Never weaken a guardrail (Biome rules, architecture tests, `feedbackEquivalence`, the HUD node budget) to make code pass.
- Shell trap: run `env | grep VITE_` before `dev`, `e2e` or `ci`. If `VITE_DEBUG_ALLOWED` is set, run `(unset VITE_DEBUG_ALLOWED; …)`.

### Open points for Geo (tune or decide after playing)

1. **Which gag makes the baby cry?** None for now (no live `gagCryMs`). Possible candidates: the stairs slide (no, he is « delighted »), the object falling from the coffee table (the fright of the crash), the outlet (the jolt). Say which, and for how long (e.g. 3000 ms = +6 %).
2. **Will 3.2 end games?** The `npm run sim` numbers in the Completion Notes show the peak noise per bot. If the `random` bot reaches 100 % often, the 3 min level will end early a lot once 3.2 lands. Tune the `sources` or `decayPerSec` before 3.2.
3. **How much does one falling object cost?** `samePropCooldownMs` 1000 and the 0.3-2 N·s lerp are starting values. The `prop_fall` measure in the Completion Notes says where a mug off the table lands in 5-15 %.
4. **The look of the 80 % alert:** the shake and its reduced-motion flash, and the `medium` vibration, are `[ASSUMPTION]`s to judge in play.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1 : Jauge de bruit (L1534-1561)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2 (L1563-1588)] (boundary: what 3.1 does not do)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md (L107, L174, L238, L399)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md (L246, L252, L348-351, L400-411, L492, L629, L958)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md (L158-172, L396-398, L409, L522-526)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md (L164, L207, L379, L420, L557)]
- [Source: _bmad-output/implementation-artifacts/1-19-fatigue-cafe-et-micro-siestes.md (D5, D11, D12; review L346, L360)]
- [Source: _bmad-output/implementation-artifacts/1-20-le-telephone-qui-sonne.md (D5)]
- [Source: _bmad-output/implementation-artifacts/1-15-physique-legere-des-objets.md (D6)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L262, L343, L346, L354, L360, L365, L370)]
- [Source: _bmad-output/project-context.md (L40, L41, L43, L61, L69, L108, L136, L153, L159)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Implementation Plan

- **Content first (T1).** `NoiseSchema` in `feel.ts` (strict, no defaults, two refines, `NOISE_SOURCE_IDS`), `gauges.noise: {}` in `LevelGaugesSchema`, `gagCryMs` in the threat `baseShape`. `feel.json`, `testFeel.json` and `salon_crawler.json` updated, `content:schemas` regenerated.
- **Sim (T2-T4).** `addNoise` (event + silent clamp) and `decayNoise` (silent) are the two writers of `noisePct`, both in `gauges/noise.ts`; `runNoise` is in `gauges/noiseSystem.ts` (split like fatigue). It scans this step's events backwards (D7), so no allocation and no double count when the caller has not drained. `baby/cry.ts` keeps the cry stateless between steps: the tick grid is `cryStartedAt` plus the step size, so the snapshot only needs the two instants. `gagThreat` calls `startBabyCry` after `applyGag`. Snapshot v12 with checks for `noisePct`, `propNoiseAt` and the cry pair.
- **Client (T5).** Pure helper `isNoiseAlertCrossing`; `boot.ts` sets the start value, writes the value per frame through `hudBatch`, mirrors `data-pp-noise` on `NoiseChanged` and level start only, and on an upward crossing plays the client event `NoiseAlertReached` (cue `noise_alert`, haptic `medium`, no audio) and `gaugesHud.alert('noise')`. The alert class is taken off by `frame()` after 600 ms (not by `animationend`, which the reduced-motion flash has no animation to fire); a second alert restarts it on the next frame. CSS is `transform` only, tokens only; reduced motion swaps the shake for the 3 px → 5 px ring.
- **Report (T6).** `noisePeakPct`, `noiseFinalPct`, `noiseBySourcePct` per run; mean / max of the peak, mean final and summed per source in the aggregate; `--help` mentions them.
- **Decisions kept from the story:** D1-D10 as written. D11 holds: no rename of `fatigue` / `busyUntil`.

### Debug Log References

- (Superseded by the code review: the one-shot rows are `noisePct`, and the unit-suffix test no longer allows a bare `pct`.)
- `golden:update` moved only `worldHash` / `feelHash` in the six existing journals (one line each, no `NoiseChanged` in any of them: their level has no noise). The optional golden `prop_fall_noise` was added.
- A first `npm run ci` had 3 failures: the two `autoplay-frozen` screenshots (the pill now holds a second gauge, expected) and `pauseResume.spec.ts` in chromium under 7 workers; the latter passes alone in both browsers, and the whole suite is green with `--workers=4` (286 passed).

### Completion Notes List

- Implemented all 17 ACs. `npm run typecheck`, `lint`, `content:check`, `test:coverage` (202 files, 3496 tests; `src/sim` 98.08 % statements / 96.78 % branches, thresholds are 90 %) and `build:playtest` are green. The e2e suite is green (286 passed) with `--workers=4`; with the default 7 workers `pauseResume.spec.ts` (chromium) failed once under load and passes alone and on rerun. **The e2e was run in the local checkout, not through `npm run ci` in one go, after the screenshot refresh.**
- **Goldens regenerated deliberately** (`npm run golden:update`): the new `testFeel.json` keys move `feelHash`, the new world fields move `worldHash`; journals are otherwise identical (`git diff -U0 tests/golden`: hash lines only). New scenario `prop_fall_noise`.
- **Screenshot references:** both `autoplay-frozen-*-darwin.png` refreshed (looked at: Bruit and Fatigue side by side in the pill, nothing else moved). **The two `*-linux.png` references are NOT refreshed**: Docker is not installed in this environment. Geo has to run the story 1.13 Docker command (with `-v pp-node-modules:/work/node_modules`) before CI on ubuntu can pass.
- **HUD budget:** with Bruit and Fatigue on `salon_crawler`, `#pp-hud` has **30** nodes (limit 40). Checked in `noise.spec.ts` and `fatigue.spec.ts`. The need gauge (epic 4) will add about 8.
- **Open point 3, one fall:** the `prop_fall_noise` golden: the mug off the coffee table onto the vase is two `PropImpact` of 0.40 N·s (one per side), 2 × 5.59 % = **11.2 %**. The later impacts (vase on the floor at +100 ms, mug at +350 ms) fall inside `samePropCooldownMs` and add nothing.
- **Open point 2, will 3.2 end games?** `npm run sim` on `salon_crawler` (the phone is the one big source, +30 % over its 15 s ring, minus 15 % decay):

  | bot | runs | peak mean / max | final mean | propImpact | phoneRinging |
  |---|---|---|---|---|---|
  | random | 100 | 16 % / 16 % | 0 % | 1117.3 | 3000 |
  | idle | 20 | 16 % / 16 % | 0 % | 223.5 | 600 |
  | perfect | 20 | 16 % / 16 % | 0 % | 0 | 600 |
  | human | 20 | 16 % / 16 % | 0 % | 0 | 600 |

  (`babyCrying` is 0 everywhere: no live def has `gagCryMs`.) **No bot gets near 100 %, so 3.2 would end no game with the current content.** Geo has to decide between tuning `sources` / `decayPerSec`, a live `gagCryMs`, or more sources, before 3.2.
- **1.15 / 1.20 untouched:** `git diff --stat main -- src/sim/physics src/sim/disruptions src/sim/papa/phoneCall.ts` is empty; no event shape of 1.15 / 1.20 changed.
- **Not done on purpose:** no `MamaWoke` (3.2); no emitter for floor creak, breath and sniff; no sound; no live `gagCryMs` (Open point 1); no renames (D11).
- Commit on `story/3-1-jauge-de-bruit` only; nothing merged to `main`.

### File List

- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/project-context.md`
- `content/_schemas/feel.schema.json`
- `content/_schemas/level.schema.json`
- `content/_schemas/threat.schema.json`
- `content/feedback.json`
- `content/feel.json`
- `content/levels/salon_crawler.json`
- `src/client/boot.ts`
- `src/client/feedback/feedbackEvents.ts`
- `src/client/feedback/noiseAlert.test.ts`
- `src/client/feedback/noiseAlert.ts`
- `src/client/render/views/babyView.test.ts`
- `src/client/ui/hud/gaugesHud.test.ts`
- `src/client/ui/hud/gaugesHud.ts`
- `src/client/ui/styles/ui.css`
- `src/content/schemas/feel.ts`
- `src/content/schemas/level.ts`
- `src/content/schemas/threat.ts`
- `src/shared/constants.ts`
- `src/sim/baby/approach.test.ts`
- `src/sim/baby/babySystem.ts`
- `src/sim/baby/cry.test.ts`
- `src/sim/baby/cry.ts`
- `src/sim/baby/wander.test.ts`
- `src/sim/commands.test.ts`
- `src/sim/commands.ts`
- `src/sim/context.ts`
- `src/sim/createSim.ts`
- `src/sim/events.test.ts`
- `src/sim/events.ts`
- `src/sim/gauges/gaugesSystem.ts`
- `src/sim/gauges/noise.test.ts`
- `src/sim/gauges/noise.ts`
- `src/sim/gauges/noiseSystem.test.ts`
- `src/sim/gauges/noiseSystem.ts`
- `src/sim/index.ts`
- `src/sim/snapshot.test.ts`
- `src/sim/snapshot.ts`
- `src/sim/step.ts`
- `src/sim/threats/gags.ts`
- `src/sim/threats/threatFsm.ts`
- `src/sim/world.ts`
- `tests/content/feelSchema.test.ts`
- `tests/content/levelSchema.test.ts`
- `tests/content/threatSchema.test.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-chromium-darwin.png`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-webkit-darwin.png`
- `tests/e2e/fatigue.spec.ts`
- `tests/e2e/noise.spec.ts`
- `tests/golden/journals/baby_wander.expected.json`
- `tests/golden/journals/baby_wander.json`
- `tests/golden/journals/core_basic.expected.json`
- `tests/golden/journals/core_basic.json`
- `tests/golden/journals/outlet_parry.expected.json`
- `tests/golden/journals/outlet_parry.json`
- `tests/golden/journals/papa_walk.expected.json`
- `tests/golden/journals/papa_walk.json`
- `tests/golden/journals/prop_fall.expected.json`
- `tests/golden/journals/prop_fall.json`
- `tests/golden/journals/prop_fall_noise.expected.json`
- `tests/golden/journals/prop_fall_noise.json`
- `tests/golden/journals/threat_trio.expected.json`
- `tests/golden/journals/threat_trio.json`
- `tests/golden/scenarios.ts`
- `tests/support/testContent.ts`
- `tests/support/testCrying.threat.json`
- `tests/support/testFeel.json`
- `tests/tools/sim/simReport.test.ts`
- `tools/sim/simArgs.ts`
- `tools/sim/simReport.ts`

### Change Log

- 2026-10-28: Story 3.1 implemented: the noise gauge (feel table, level opt-in, `addNoise` / `runNoise`, `NoiseChanged`, `SetNoise`), the crying baby (`gagCryMs`, `BabyCrying`), snapshot v12, the HUD gauge with the 80 % alert (haptic + shake), the sim report's noise fields, the `prop_fall_noise` golden, `noise.spec.ts`, and the docs (`project-context.md`, `deferred-work.md`). Goldens regenerated (hashes only), darwin screenshot references refreshed, Linux ones pending.

### Review Findings

Code review of 2026-10-28 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 `decision_needed` (both resolved), 8 `patch` (all applied), 0 `defer`, 12 dismissed.

- [x] [Review][Decision] **Resolved by Geo (2026-10-28): merge without the Linux references**; the visual test seems not worth the upkeep (see `deferred-work.md`). The two Linux screenshot references are stale — `autoplay-frozen-{chromium,webkit}-linux.png` were not refreshed (Docker is not installed on the dev machine), while the pill now holds a second gauge: the Linux CI run of `autoplay.spec.ts` will fail. AC 16 asks for both platforms and T8 is ticked. Options: (a) Geo regenerates them with the Docker command of story 1.13 before the merge; (b) merge now and fix the Linux references in a follow-up commit on `main` (CI red until then). [tests/e2e/__screenshots__/autoplay.spec.ts/]
- [x] [Review][Decision] **Resolved (a), applied:** the three keys are `noisePct` (feel.json, schema, generated JSON Schema, tests, goldens' `feelHash`), the regex is back to its old form. `UNIT_SUFFIX` now accepts a bare `pct` key — `floorCreak.pct`, `sniff.pct`, `breathReleased.pct` (spec JSON) forced the guardrail in `feelSchema.test.ts` to allow `^pct$`; CLAUDE.md says a guardrail is never weakened. Options: (a) rename the three keys `noisePct` (feel.json, schema, generated JSON Schema, tests) and restore the old regex; (b) keep `pct` as a deliberate exception. [tests/content/feelSchema.test.ts:21]
- [x] [Review][Patch] `runBabyCry` emits a phantom `BabyCrying` when a cry starts in the same step, before `runBabyCry` (`ticksBefore = floor(-10 / 1000) = -1`): clamp `ticksBefore` at 0. Latent today (every gag runs after `runBaby`), nothing enforces the order. Add a unit test that calls `startBabyCry` before `runBabyCry`. [src/sim/baby/cry.ts:34-37]
- [x] [Review][Patch] Snapshot v12 does not tie `cryStartedAt` and `propNoiseAt[i]` to the clock: a value after `clock.sim` restores without error and desynchronises the cry grid / the prop cooldown. Add `≤ clock.sim` checks and their refusal tests. [src/sim/snapshot.ts:245-251, 333-338]
- [x] [Review][Patch] The test « emits nothing once the level has ended, and leaves the cry as it was » is vacuous: it never asserts that a cry was in progress at `LevelEnded` nor that `cryStartedAt` / `cryEndsAt` are unchanged afterwards. [src/sim/baby/cry.test.ts:147]
- [x] [Review][Patch] The test « a pushed prop makes noise once for one fall … through its bounces » has no upper bound (`>=`): it would pass if the cooldown were broken. Assert the exact number of `NoiseChanged` (with `source: 'propImpact'`) for the fall. [src/sim/gauges/noiseSystem.test.ts:261]
- [x] [Review][Patch] `gagCryMs` of 1 to 999 passes the schema and gives zero `BabyCrying` (a cry shorter than one period is invisible): require `≥ BABY_CRYING_EVERY_MS`, regenerate `content/_schemas`, add a schema test. [src/content/schemas/threat.ts:76]
- [x] [Review][Patch] The alert restart (`alert()` removes the class, `frame()` puts it back in the same rAF) may not replay the CSS animation without a style flush: force a reflow between the two writes, or restart through the `animation` property. [src/client/ui/hud/gaugesHud.ts:222-243]
- [x] [Review][Patch] `deferred-work.md` L354 says « Resolved in story 3.1 » for the `busyUntil` / `fatigue` renames but explains that nothing was renamed: reword to « Still deferred (not resolved by 3.1) ». [_bmad-output/implementation-artifacts/deferred-work.md:354]

Dismissed (12): `runNoise` event scan « any event with `t ≠ now` hides impacts » (every event is stamped `now`, `ctx.events` is monotone, checked by the Edge Case Hunter); prop-on-prop hit counted twice (spec D8 decision, Open point 3 for Geo, pinned by the `prop_fall_noise` golden); `isNoiseAlertCrossing` float drift (`before` is recovered exactly) and `alertPct = 100` never firing; NaN impulse not guarded in `addNoise` (no normal input produces it); `decayNoise` sign guard; `addNoise` not the only writer (`decayNoise` is the deliberate silent twin, `project-context.md` says so); the « 3 cries in 10 s » test is deterministic; unused `_ctx` in `startBabyCry`; `ALERT_HOLD_MS` mirrors the CSS 600 ms (documented); `SetNoise` accepted from any journal (same exposure as `SetFatigue`); per-run `noiseBySourcePct` not rounded (cosmetic); AC 17 « CI not run in one go » (the `on_complete` CI run covers it).
