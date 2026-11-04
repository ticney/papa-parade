# Story 3.15: Séquelles des gags

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want a miss to make what follows harder,
so that missing has a price during the game, not only on the note.

Requirements: FR72 (`epics.md` L139: « Chaque gag laisse une séquelle (catalogue des menaces du GDD). Une séquelle qui occupe papa dure 2 s au plus, glissade comprise (micro-sieste : 3 s) ; elles ne se cumulent pas ; les séquelles de décor se cumulent. »), UX-DR28 (the activity bubble's « étoiles de vertige »). GDD: mechanic 13 (`gdd.md` L218), the threat catalogue (`gdd.md` L311-322), mechanic 15 (bubble, L238), mechanic 17 (fairness, L258: « Les séquelles ne sont pas protégées »). Architecture: L232-233 (`World.afterEffects`, `threats/afterEffects.ts` inside the threats system), L411 (`AfterEffectStarted{kind, until}` / `AfterEffectEnded{kind}`), L989.

Seventh story of the v2.3 catch-up (`sprint-change-proposal-2026-11-03.md` §3: 3.12, 2.11, 3.13, 2.12, 2.13, 3.14, **3.15**, 3.16, then a playtest, then E9). The proposal calls it one of the two « deep sim » stories (§ Effort) and warns that it touches the end of the level and moves the goldens. 3.16 (the catastrophe gauge) comes right after and builds on it: do not build any part of the catastrophe gauge here.

**What exists today (HEAD `5572c36`).** No séquelle system. Each gag has a one-shot sim consequence in `src/sim/threats/gags.ts` (`GAG_CONSEQUENCES`) and a short client show in `src/client/render/gags.ts` (`GAG_PRESENTATIONS`):

| Threat (def) | Gag | Sim today | Client today | Séquelle to build (GDD catalogue) |
|---|---|---|---|---|
| `outlet` | `outlet_hair` | nothing | lights off 600 ms, hair on end | Papa electrified **1.5 s** (cannot answer) + room dim **6 s** (icons, halos, rings fully readable) |
| `stairs` | `stairs_slide` | `NearMiss`, `score.nearMisses + 1`; the baby does not move | the baby slides 0.6 m out and back in 1.4 s (« provisional ») | the baby is at the bottom; Papa must fetch him (tap on the baby), **2 s** busy carrying him up |
| `coffee_table_object` | `table_object_fall` | one prop pushed off the table (`dropProps`) → `isMess`, counted in the Sigh | the falling prop | debris stay on the floor until picked up (tap, **1 s**); they count in the Sigh; **+3 %** noise when walked on (noise levels) |
| `silence_mischief` | `tissues_everywhere` / `crayon_scribbles` | `mess.mischiefs + 1` | clips only | the mess stays **visible until the end of the level and on the end photo** |
| `papa_microsleep` | `papa_asleep` | `putPapaToSleep`: `asleep` for `feel.fatigue.asleepMs` (3000) | Papa's `asleep` loop, bubble with stars | Papa asleep **3 s** (already there; the duration moves to the threat JSON) |

## Acceptance Criteria

### Content (`content/threats/*.json`, `src/content/schemas/threat.ts`)

1. **Given** any threat def, **when** content is loaded, **then** it declares a required `afterEffect` object, a union on `kind` (D1): `none`, `electrified {busyMs, dimMs}`, `babyDownstairs {carryUpMs, selfReturnMs}`, `debris {pickUpMs}`, `mess`, `asleep {busyMs}`. The salon values are the GDD catalogue's: `outlet` electrified 1500 / 6000, `stairs` babyDownstairs 2000 / 6000, `coffee_table_object` debris 1000, `silence_mischief` mess, `papa_microsleep` asleep 3000; the six E4 defs (`arms_cry`, `bedtime_eyes`, `bomb_drop_lay`, `fake_sleep`, `false_alarm_sigh`, `real_wake`) are `none` (GDD L220: their séquelles are to be costed later).
2. **Given** a def whose `afterEffect.kind` does not match its gag (`AFTER_EFFECT_OF_GAG`, D1; for the silence every `surpriseGags` entry maps to `mess`), **when** `createSim` builds the level or `npm run content:check` runs, **then** it is refused with a message naming the def, the gag and the expected kind. A Papa-occupying duration above its cap is refused by the schema: `electrified.busyMs`, `babyDownstairs.carryUpMs` and `debris.pickUpMs` ≤ `AFTER_EFFECT_BUSY_MAX_MS` (2000), `asleep.busyMs` ≤ `MICRO_SLEEP_BUSY_MAX_MS` (3000); every duration is a positive integer.
3. **Given** `content/feel.json`, **when** the story is done, **then** `fatigue.asleepMs` is gone (its value lives in `papa_microsleep.json`), and the new tunables are there: `noise.sources.debrisStep.noisePct` (3), `gags.debrisStepRadiusM` (0.25), `fx.dim.lightsPct` (40) and `fx.dim.fadeMs` (400). `content/_schemas/` is regenerated (`npm run content:schemas`), `tests/support/testFeel.json` and the `tests/support/test*.threat.json` copies follow.

### Sim (`src/sim/threats/afterEffects.ts` and its callers)

4. **Given** the outlet's gag, **when** it fires, **then** Papa enters `electrified` until `now + busyMs` (busy: presses are refused with `TapRefused` as in 2.12, moves ignored), his path, glide and walk target are dropped (as the nap does today), and `world.afterEffects.dimUntil` becomes `max(dimUntil, now + dimMs)`; `AfterEffectStarted` is emitted for `electrified` and for `dim`, and `AfterEffectEnded` when each ends.
5. **Given** the stairs' gag, **when** it fires, **then** the baby enters `downstairs` (not free: the director draws nothing that needs him, no silence starts, he cannot be taken into the 4.1 carry) with `baby.downstairsUntil = now + selfReturnMs`; the `NearMiss` and `score.nearMisses + 1` stay as today.
   - **When** the player taps the baby (`TapBaby`) while he is `downstairs`, **then** Papa walks to him (new intent `fetchBaby`) and, on arrival if the baby is still `downstairs`, Papa enters `carryingUp` for `carryUpMs` and the baby `carriedUp`; at its end the baby is back at the stairs' anchor in `babble`, Papa `idle`.
   - **When** nobody fetches him by `downstairsUntil`, **then** he climbs back by himself (`babble`, same place) (D4, Open point 1).
6. **Given** the coffee table's gag, **when** the pushed prop lands on the floor, **then** it is a debris (`PropSlice.debrisPickUpMs > 0 && isMess`): it counts in the Sigh as any prop on the floor (unchanged `computeMamaScore`); outside the final rush a `TapObject` on it walks Papa there and, on arrival, Papa enters `pickingUp` for `pickUpMs` (a busy, chosen occupation), then the prop is tidied (`tidyProp`, `PropTidied`) and `AfterEffectEnded{debris}` is emitted. In the final rush the 3.5 instant tidy is unchanged.
   - **When** Papa's position comes within `gags.debrisStepRadiusM` of a debris (any movement, glide included), **then** `DebrisSteppedOn{propId}` is emitted once per entry and `runNoise` adds `noise.sources.debrisStep.noisePct`; a level with no noise gauge adds nothing.
7. **Given** a surprise mischief of the suspicious silence, **when** it fires, **then** a mark `{gag, xM, zM}` is appended to `world.afterEffects.mischiefMarks` (never removed, not tidied by the rush), `mess.mischiefs + 1` stays, and `AfterEffectStarted{kind: 'mess', until: null}` is emitted.
8. **Given** the micro-sleep's gag, **when** it fires, **then** Papa is `asleep` for `afterEffect.busyMs` of `papa_microsleep.json` (3000), with today's behaviour otherwise (a coffee or toilet visit over this very step is finished first, else cancelled).
9. **Given** a Papa-occupying séquelle (`electrified`, `carryingUp`, `asleep`) under way, **when** another one arrives, **then** it replaces the first **without extending it** (D2): Papa's state becomes the new one, `busyUntil` keeps its value, `AfterEffectEnded{old}` then `AfterEffectStarted{new, until: busyUntil}` are emitted; the same séquelle again changes nothing (this closes deferred-work « The activity ring refills when an already-asleep Papa is put to sleep again »). A replaced `carryingUp` first puts the baby back up. Décor séquelles (`dim`, `debris`, `mess`) always stack. A séquelle that lands on a chosen occupation (`drink`, `onPhone`, `onToilet`, `pickingUp`) cancels it as the nap does today (finished first if it ends this very step).
10. **Given** any game (unit tests, the golden scenarios, and 200 seeds of `idle` and `human` on the salon), **when** a Papa-occupying séquelle starts, **then** Papa can answer a threat again (`isPapaBusy` false, or a press judged) no later than `AFTER_EFFECT_BUSY_MAX_MS` after it started, or `MICRO_SLEEP_BUSY_MAX_MS` for `asleep` — the GDD's « aucune ne dépasse 2 s glissade comprise, sauf la micro-sieste ». The walk to the baby or to a debris is the player's choice and is not counted.
11. **Given** the new `World` fields, **when** a game is snapshotted, replayed (`npm run sim:replay`) or hashed, **then** the snapshot is version 30 with validators for each new field and state, and two runs of the same journal give the same events and hash.

### Client

12. **Given** Papa `electrified` or `carryingUp`, **when** the activity bubble shows, **then** its pictogram is the dizzy stars (as `asleep` today) and its ring drains to `busyUntil`; `pickingUp` shows a new « hand » pictogram (D9). A replaced séquelle swaps the pictogram and the ring restarts toward the unchanged end (2.12's busy → busy swap).
13. **Given** the pénombre (`world.afterEffects.dimUntil > now`), **when** the room darkens, **then** only the 3D lights fade to `fx.dim.lightsPct` over `fx.dim.fadeMs` (combined with the outlet's 600 ms flash by `min`); the world UI (threat markers and their halos, chrono-ring, hold-ring, activity bubble, tidy markers, verb chips) is never dimmed, filtered or covered: an e2e test reads their computed opacity and filter during the pénombre and finds them equal to outside it, and a macOS screenshot of the pénombre with a threat up is added and looked at.
14. **Given** the baby `downstairs`, **when** he is drawn, **then** he sits at the bottom of the stairs (the 1.4 s out-and-back slide becomes « out and stays » while `downstairs`, back when he climbs or is carried); `carriedUp` is drawn in Papa's arms.
15. **Given** a debris outside the final rush, **when** the scene is drawn, **then** it carries the tidy marker of 3.5 and a tap on it sends `TapObject` with its id; `DebrisSteppedOn` has a cue with sound, visual and haptic (ADR-006, `content/feedback.json`).
16. **Given** mischief marks, **when** the level is played and when the end photo is taken, **then** each is drawn as a floor decal (tissues, crayon scribble) at its point, visible from the level camera, within the draw-call budget (`perf.spec.ts`: ≤ 100).
17. **Given** the dev mirrors, **when** `?debug=1` or dev, **then** `data-pp-dim` (`on` / `off`) and `data-pp-baby-state` / `data-pp-papa-state` (existing) expose the new states for e2e.

### Bots, reports, goldens

18. **Given** the bots `perfect`, `human` and `idle` on the salon (normal tier, 200 runs from seed 1000), **when** they play, **then** `perfect` has **no** séquelle (0 `AfterEffectStarted` over all runs), `idle` accumulates them (more than one per run on average, every kind but `carryUp` present), and `human` fetches a downstairs baby (after a drawn reaction) and has some. The `npm run sim` report gains `afterEffects` (per-kind totals and mean per run) and keeps every existing field. The numbers (with `endsByReason`, mean score and stars, before and after) are in the Completion Notes, for 3.16.
19. **Given** the golden tests, **when** the sim changes, **then** they are regenerated with `npm run golden:update` (**said here: this story regenerates the goldens**), after reading the diff of each moved summary, and new scenarios pin each séquelle (D12).
20. **Given** the docs, **when** the story is done, **then** `_bmad-output/project-context.md` (Busy Papa, a « Séquelles » paragraph, Activity bubble states), `game-architecture.md` L411 (the event shape, D8), `EXPERIENCE.md` (pénombre, debris marker outside the rush, the stairs fetch), `DESIGN.md` (the activity-bubble pictogram list gains the hand: `tests/architecture/activityBubbleSpec.test.ts` pins the bubble to DESIGN.md, check whether it reads the list) and `deferred-work.md` (the closed nap-ring item; the deferred baby-target debris) are updated.

## Tasks / Subtasks

- [ ] **Task 1 — Content: the `afterEffect` field** (AC 1, 2, 3)
  - [ ] `src/shared/constants.ts`: `AFTER_EFFECT_BUSY_MAX_MS = 2000`, `MICRO_SLEEP_BUSY_MAX_MS = 3000` (rules of the GDD, not tunables: D1).
  - [ ] `src/content/schemas/threat.ts`: `AfterEffectDefSchema` = `z.discriminatedUnion('kind', [...])` of strict objects (no `.optional()`, `.default()`, `.transform()`), each duration `durationMs(...)`-style positive int with its cap; `afterEffect` required in `baseShape`. Export `AfterEffectDefKind` (`'none' | 'electrified' | 'babyDownstairs' | 'debris' | 'mess' | 'asleep'`).
  - [ ] All 11 `content/threats/*.json` and the `tests/support/test*.threat.json` copies get their `afterEffect` (values in AC 1).
  - [ ] `src/sim/threats/gags.ts`: `AFTER_EFFECT_OF_GAG: Readonly<Record<GagId, AfterEffectDefKind>>` beside `NEAR_MISS_GAGS` (outlet_hair→electrified, stairs_slide→babyDownstairs, table_object_fall→debris, papa_asleep→asleep, tissues_everywhere / crayon_scribbles→mess, the six E4 gags→none). `createSim` refuses a mismatch (same place and style as the `PAPA_ASLEEP_GAG_ID` pairing, `createSim.ts` ~L256-283); `tools/content/contentChecks.ts` reports it.
  - [ ] `feel`: remove `fatigue.asleepMs` (schema `src/content/schemas/feel.ts:239`, `content/feel.json`, `tests/support/testFeel.json`, any debug-panel binding or `SetFeel` test that names it); add `noise.sources.debrisStep {noisePct}`, `gags.debrisStepRadiusM`, `fx.dim {lightsPct, fadeMs}`.
  - [ ] `npm run content:schemas`; schema tests (each kind, each cap, a missing `afterEffect`, an unknown kind, an extra key); content-check tests for the pairing.
- [ ] **Task 2 — Sim state, events and snapshot** (AC 4-9, 11)
  - [ ] `PapaState` + `PAPA_STATES`: `electrified`, `carryingUp`, `pickingUp`. `PapaIntent` + `PAPA_INTENTS`: `fetchBaby`. Rewrite `isPapaBusy` as a `Record<PapaState, boolean>` table (busy: `drink`, `asleep`, `onPhone`, `onToilet`, `electrified`, `carryingUp`, `pickingUp`), and add `isAfterEffectState` (`electrified`, `carryingUp`, `asleep`).
  - [ ] `BabyState` + `BABY_STATES`: `downstairs`, `carriedUp`; `BabySlice.downstairsUntil: SimMs | null`. Check every `Record<BabyState, …>` and every `switch` on the baby's state (the compiler lists them): they stay out of `isBabyFree`, `isTakeable`, wander, silence and cry-in-the-arms.
  - [ ] `PropSlice.debrisPickUpMs: number` (0 = not a debris). `World.afterEffects: { dimUntil: SimMs; steppedDebrisIndex: number; mischiefMarks: MischiefMark[] }` (`MischiefMark = { gag: GagId; xM: number; zM: number }`), initial `{0, -1, []}`.
  - [ ] Events (`events.ts`, `SIM_EVENT_TYPES`): `AfterEffectStarted{t, kind, until: SimMs | null, propId: string | null}`, `AfterEffectEnded{t, kind, propId: string | null}`, `DebrisSteppedOn{t, propId}`; `AfterEffectKind` = the def kinds minus `none`, plus `dim` and `carryUp` (D8).
  - [ ] `snapshot.ts`: version 29 → 30, validators for every new field, state and intent, and the existing `isBusy === (busyUntil !== 0)` invariant extended to the new busy states.
- [ ] **Task 3 — `src/sim/threats/afterEffects.ts`** (AC 4-10)
  - [ ] `occupyPapa(world, ctx, state, busyMs)`: the D2 rule; generalizes `putPapaToSleep` (`src/sim/papa/sleep.ts`), which becomes `occupyPapa(…, 'asleep', def.afterEffect.busyMs)` (keep its doc's coffee / toilet rule). Papa-side `AfterEffectStarted` / `AfterEffectEnded`.
  - [ ] `applyAfterEffect(world, ctx, threat, def, gag)`, called by `gagThreat` right after `applyGag` (`threatFsm.ts` ~L281-315), dispatching on `def.afterEffect.kind` (D3-D7). `GAG_CONSEQUENCES` keeps the one-shot consequences (the near miss, the push, the mischief count); the séquelle is applied by `applyAfterEffect`, so `papaAsleep` in `gags.ts` stops calling `putPapaToSleep` (one writer).
  - [ ] `runAfterEffects(world, ctx)` at the end of `runThreats` (architecture L233: séquelles inside the threats system): the dim end, the baby's self-return, the debris step detection (D5), the debris mark cleared when its prop breaks.
  - [ ] `runPapa`'s busy-end branch (`papaSystem.ts` ~L254-263): `carryingUp` → `finishCarryUp` (baby back, `babble`), `pickingUp` → `finishPickUp` (`tidyProp`), `electrified` / `asleep` → idle; each emits its `AfterEffectEnded`.
  - [ ] `tapBaby` (`papaSystem.ts` ~L75): a `downstairs` baby is fetched (walk with intent `fetchBaby`, or at once if within reach), never taken into the carry. `arrive` handles `fetchBaby`.
  - [ ] `tapObject` (`papaSystem.ts` ~L146): outside the rush, a debris prop is walked to; `arrive` starts `pickingUp` if it is still a debris. The rush path is unchanged.
  - [ ] `runNoise`: `DebrisSteppedOn` → `addNoise(…, debrisStep.noisePct, 'debrisStep')`.
  - [ ] Make sure the baby's post-gag `act` (`releaseTarget`, `babySystem.ts` ~L37) does not overwrite `downstairs` (Traps).
  - [ ] Unit tests per rule (D2-D7), each able to fail: replace without extending, same séquelle twice, decor stacking, chosen occupation cancelled, carry replaced, self-return, fetch race (baby climbs back while Papa walks), debris landing on the table or breaking, step noise once per entry, no noise without a gauge, the AC 10 cap as a property over a fuzz of gags.
- [ ] **Task 4 — Client** (AC 12-17)
  - [ ] `activityBubble.ts`: `ACTIVITY_PICTOGRAMS` entries (`electrified` / `carryingUp` → `stars`, `pickingUp` → new `hand`: one ink path in the style of the others); its test against `isPapaBusy` passes.
  - [ ] `characterClips.ts`: `PAPA_LOOPS` (`electrified`, `carryingUp`, `pickingUp`) and `BABY_LOOPS` (`downstairs`, `carriedUp`) with clips that exist in `papa.glb` / `baby.glb` (look them up; no Blender work: e.g. `carryingUp` → `carry_walk`, `carriedUp` → `carried`); the hair stays on end for the whole `electrified` state.
  - [ ] Pénombre: `levelScene.ts` light factor = `min(gagFlash, dimFactor)` from `world.afterEffects.dimUntil` and `feel.fx.dim`, at `renderSimMs` (sim time, frozen by pause / hitstop). No scrim, no CSS filter, nothing on the world-UI layer (D3).
  - [ ] The baby `downstairs` view (`src/client/render/gags.ts` slide functions and the baby view): out and stays while `downstairs`, with a small downward drop; back when he leaves the state.
  - [ ] Debris: tidy marker outside the rush (`tidyMarkers.ts`), hit-test (`hitTest.ts`, `inputMapper.ts`) sends `TapObject` for a debris outside the rush; the `DebrisSteppedOn` cue in `content/feedback.json` (sound + visual + haptic, reusing an existing sound file), routed in `simEventFeedback.ts`.
  - [ ] Mischief decals: one mesh per mark (merged or instanced if more than a few), cheap materials, drawn from `world.afterEffects.mischiefMarks` so the photo shows them with no extra code (`photo.ts` renders the frozen `World`).
  - [ ] `boot.ts` mirror `data-pp-dim`.
  - [ ] Unit tests (pictogram table, light factor, slide offset by state, decal count) and a new `tests/e2e/afterEffects.spec.ts` driving each séquelle with `window.__PP__` (force a gag, read the states, the bubble class, `data-pp-dim`, the world-UI styles, tap the baby and the debris, the photo); run with `activityBubble.spec.ts`, `finalRush.spec.ts`, `photo.spec.ts`, `noise.spec.ts`, `carry.spec.ts`, `silence.spec.ts`, `threat.spec.ts` on Chromium.
- [ ] **Task 5 — Bots and the sim report** (AC 18)
  - [ ] `src/bots/humanBot.ts`: `BUSY_PAPA_STATES` gains the new busy states; a `downstairs` baby is fetched (`TapBaby`) after a drawn reaction, when Papa is free and no command is planned. No draw on the paths that do not meet a downstairs baby.
  - [ ] `perfect` and `idle` unchanged; a bot test on the salon-like test level: `perfect` 0 `AfterEffectStarted`, `idle` > 0.
  - [ ] `tools/sim/simReport.ts` (+ tests that build whole reports): `afterEffects: { byKind: Record<AfterEffectKind, number>; meanPerRun: number }`.
  - [ ] Measure (CLI, background, `caffeinate -i -s`): `npm run sim -- --bot perfect|human|idle --runs 200 --seed 1000` on the salon, and `human --chrono-ring off`; record before (on `main`) and after in the Completion Notes.
- [ ] **Task 6 — Goldens** (AC 19)
  - [ ] New scenarios in `tests/golden/scenarios.ts`: `outlet_electrified_dim`, `stairs_fetch_carry_up`, `stairs_self_return`, `debris_pick_up_and_step`, `silence_mess_mark`, `after_effect_replaced`.
  - [ ] `npm run golden:update`; read each moved `*.expected.json` (only gag scenarios should move: say which in the Completion Notes).
- [ ] **Task 7 — Docs and checks** (AC 20)
  - [ ] `project-context.md`, `game-architecture.md` L411, `EXPERIENCE.md`, `DESIGN.md` (pictograms), `deferred-work.md`.
  - [ ] `npm run ci:fast` after each task; the touched e2e specs on Chromium (`npm run e2e -- <specs> --project=chromium`, in the background). `ci:story` is the review's.

## Dev Notes

### Decisions

- **D1. The data.** AC 3.15 says « ses durées dans le JSON de la menace » (and architecture L989): every duration is in the def's `afterEffect`, which every def must declare (GDD L220: « toute nouvelle menace … doit déclarer sa séquelle »), `none` included. A `z.discriminatedUnion('kind', …)` keeps the « required here / refused elsewhere » rules in the type, with no `.optional()`. The two caps (2 s, 3 s) are rules of the GDD (mechanic 13), not tunables: constants in `src/shared/constants.ts`, enforced by the schema, so a tuning typo cannot break the promise. The numbers Geo tunes (durations, dim strength, step noise, step radius) are data. The noise of a step goes in `feel.noise.sources` because `NoiseSource` is `keyof Feel['noise']['sources']` (`events.ts:14`), and the client's dim strength in `feel.fx` beside the other effects.
- **D2. « Remplace sans l'allonger ».** Read literally (GDD L218: « une nouvelle remplace celle en cours sans l'allonger »): the new séquelle takes Papa's state (pictogram, clip), the end stays where it was. So a chain of misses can never keep Papa busy past the first séquelle's end, and the AC 10 cap holds by construction. The same séquelle again (`asleep` on `asleep`) changes nothing and emits nothing. This is a change for the nap: today a second nap re-extends `busyUntil` (deferred-work L976). Open point 2.
- **D3. The pénombre** is presentation of a sim fact: the sim owns `dimUntil` (deterministic, in the snapshot, on the photo), the client only fades the 3D lights through the existing `GagStage.setLightsFactor` (`levelScene.ts:441-447`). The world UI (`src/client/ui/world/*`, `CSS2DObject`s) is DOM over the canvas, so lowering the 3D lights cannot touch it: that is how « icônes, halos et anneaux restent pleinement lisibles » holds. Never add a scrim, an overlay or a CSS filter for it (the instinct vignette is already a radial darkening: no confusion). Dims stack as `max` (two pénombres at once = dark until the later end).
- **D4. The stairs.** The sim keeps the baby's position at the stairs' anchor (`stairs_top`, on the nav grid: the baby reached it to act); « en bas » is drawn by the client (the bottom of the stairs is below the floor and off the grid: `boundsMinM.y = -0.8`, no `stairs_bottom` anchor, and adding one means a Blender change). Papa's walk to him is the player's choice; the occupation is `carryUpMs`. **Self-return** (`selfReturnMs` 6000) is this story's addition: the GDD does not say what happens if Papa never comes, and without it a baby downstairs is never free again (the director draws nothing that needs him), so `idle` would stop meeting threats after the first stairs gag and 3.16's « `idle` always loses » could not hold. Open point 1.
- **D5. Debris.** A debris is a prop the table's gag pushed (`debrisPickUpMs` written by `tableObjectFall` on the chosen prop: `dropProps` returns a count today, extend it to report the index) and that is a mess (`isMess`: on the floor, unbroken). A broken prop is not a debris (it counts 4 in the Sigh as « cassé », and nothing repairs it); when a marked prop breaks, its mark is cleared with `AfterEffectEnded{debris}`. The pick-up is a chosen, busy occupation like the coffee (`busyUntil` reused, refused presses visible), 1 s; in the final rush the 3.5 instant tidy of any mess stays (the rush is about speed; changing it moves 3.5's balance). The step noise uses the creak pattern (`stealthExit.ts:43`, `:215-228`): one `steppedDebrisIndex`, an event on entering a new one, reset on leaving. The GDD's « deviennent une cible possible du bébé » is **out of scope** (a dynamic threat anchor: E9's new bêtises are the place), recorded in `deferred-work.md`.
- **D6. The silence's mess.** A world list of marks, not a counter, so the client can draw it and the photo shows it (`photo.ts:114` renders the frozen `World`). The rush does not tidy it (GDD L321: « jusqu'à la fin du niveau et sur la photo de fin »). The mark's point is the baby's at the gag (inside the hidden zone, behind the sofa): if the decal is hidden from the level camera there, place it on the zone's edge that faces the camera and say so.
- **D7. The nap.** Already a séquelle; only its duration moves (`feel.fatigue.asleepMs` → `papa_microsleep.json › afterEffect.busyMs`) so that there is one source. `putPapaToSleep` takes the duration as a parameter.
- **D8. Events.** The architecture's `AfterEffectStarted{kind, until}` / `AfterEffectEnded{kind}` (L411), plus `propId` (null except for `debris`) because several debris stack and their ends must be told apart; `until` is `null` for `debris` and `mess` (they end on a pick-up or never). `carryUp` is an event kind (the second half of the stairs séquelle) that no def names. Update L411.
- **D9. Pictograms.** GDD L238: « étoiles de vertige pour une séquelle »: `electrified` and `carryingUp` use the existing `stars`. `pickingUp` is not a séquelle but a chosen occupation, and FR74 wants a bubble for every occupation: a new `hand` pictogram (Open point 3).
- **D10. Fairness.** Nothing changes in the director (3.13 AC 9: séquelles are not protected, the director reads no Papa state). It already waits while the baby is not free (`isBabyFree`, `directorSystem.ts:141,195`), which now covers `downstairs` and `carriedUp` the way it covers `carried`.
- **D11. Bots.** `perfect` never gags, so it has no séquelle without any change. `human` gets one realistic behaviour, fetching the baby (a human does it at once), because 3.16 measures `human`'s loss rate on top of this story; picking up debris stays out (a judgement: players rarely do it under pressure; revisit at the playtest).
- **D12. Goldens.** Every gag scenario moves (new events, new world fields in the hash). That is expected: regenerate, read each diff, and add one scenario per séquelle so that each rule is pinned by a trace, not only by unit tests (3.13's deferred lesson: « No golden scenario exercises a postponement »).

### The current code this story changes

- `src/sim/threats/gags.ts`: `GAG_CONSEQUENCES` (one-shot consequences, stays), `NEAR_MISS_GAGS` (unchanged), new `AFTER_EFFECT_OF_GAG`. `papaAsleep` today calls `putPapaToSleep`: the séquelle moves to `applyAfterEffect`.
- `src/sim/threats/threatFsm.ts` `gagThreat` (~L281-315): enters `gag`, `gagOf` (a silence draws from `surpriseGags` with `world.rng`), `ResponseResolved{fail}`, `GagTriggered`, `applyGag`, `startBabyCry` if `gagCryMs`, `resetCombo`, `recordMiss`, `failSequenceOnGag`. Add `applyAfterEffect` right after `applyGag`; keep the order of everything else (the draw order of `world.rng` must not move).
- `src/sim/papa/sleep.ts` `putPapaToSleep`: the template for `occupyPapa` (finishes a due coffee / toilet, clears path, glide, dir, `objectId`, `intent`, sets `busyUntil`, `enterPapaState`).
- `src/sim/papa/papaFsm.ts`: `PapaState`, `PAPA_STATES`, `isPapaBusy` (hard-coded list), `enterPapaState` (no-op on the same state).
- `src/sim/papa/papaSystem.ts`: `tapBaby` (~L75), `tapObject` (~L146, mess props in the rush only), `arrive` (~L102), `runPapa`'s busy end (~L254-263) and command loop (`if (isPapaBusy(papa)) break;`).
- `src/sim/threats/threatSystem.ts:144-171`: refuses `PressThreat` and ignores `TapBaby` while busy (`TapRefused`): unchanged, it reads `isPapaBusy`.
- Every other reader of `isPapaBusy` inherits the new states: `fatigueSystem.ts:39` (no micro-sleep telegraph while busy), `carry.ts:139`, `silence.ts:30`, `sequenceStart.ts:42`, `sequenceSteps.ts:64`, `stealthExit.ts:243`, `snapshot.ts:134-135`, `humanBot.ts`. Check each still means what it says.
- `src/sim/baby/babyFsm.ts` (`BabyState`, `isBabyFree`), `carry.ts` (`isTakeable`, `putDownBaby`), `approach.ts` (`ensureOnOpenCell`), `babySystem.ts` (`releaseTarget`).
- `src/sim/physics/dropProps.ts` (returns a count), `src/sim/papa/tidyProp.ts` (`messPropIndexOf`, `tidyProp`).
- `src/sim/gauges/noiseSystem.ts` (`runNoise` reads this step's events), `noise.ts` (`addNoise`).
- `src/sim/world.ts` (slices), `events.ts`, `snapshot.ts` (v29).
- Client: `src/client/render/gags.ts` (`GAG_PRESENTATIONS`, lights / hair / slide functions), `levelScene.ts:342,441-447` (lights), `views/characterClips.ts` (`PAPA_LOOPS`, `BABY_LOOPS`), `ui/world/activityBubble.ts` (`ACTIVITY_PICTOGRAMS`, `ActivityPictogram`), `ui/world/tidyMarkers.ts`, `input/hitTest.ts` + `inputMapper.ts`, `feedback/simEventFeedback.ts`, `boot.ts` (mirrors), `endOfLevel/photo.ts`.
- Bots: `src/bots/humanBot.ts` (`BUSY_PAPA_STATES`, `isBusy`).
- Tools: `tools/sim/simReport.ts`, `tools/content/contentChecks.ts`.

### What must keep working

- **3.13 fairness:** `fairnessCheck.test.ts` (`perfect` fails nothing, no unfair pair for `perfect` and `human`); the director's own tests (no Papa state read).
- **2.12 bubble:** the table test against `isPapaBusy`, the busy → busy swap, `TapRefused`, the pop on busy → free (`activityBubble.spec.ts`).
- **3.5 final rush:** instant tidy of mess props, `finalRush.spec.ts`, the `final_rush_tidied` golden's logic (its numbers may move only through gags).
- **3.12 note:** `mamaScore` pins (D7's tally); the Sigh still reads `world.mess`; picking up a debris lowers it the way rush tidying does.
- **4.1 carry** in the salon (`carry.spec.ts`, `carry.test.ts`): a free baby is still taken, put down, the combo cashed.
- **1.19 nap / coffee**, **1.20 phone**, **4.3 toilet**: the nap's coffee / toilet rule; `chambre_night` (E4 defs are `none`; the micro-sleep there uses the JSON duration, same 3000).
- **1.21 silence:** a busy Papa cannot find the baby; `mess.mischiefs` still counts.
- **3.14 human bot:** `humanBotRegression.test.ts` pins the command stream on frozen levels. Gag consequences now change the world, so a pin may move: check the frozen levels' games first; if a pin moves, prove the bot's draws did not (the frozen settings meet no downstairs baby, so the new fetch draw never runs) and re-pin, saying so. Never loosen the comparison.
- `npm run sim:replay` of a new run file (old run files and old tester journals may no longer reach the same end state: the sim changed; that is expected, say it in the Completion Notes).
- `autoplay.spec.ts`'s macOS screenshot (a frozen frame): if it moves, look before regenerating, and say so.

### Traps

- **Same step, two systems.** `runThreats` (gags, séquelles) runs before `runPapa` (`step.ts:44`), so a busy state ending this step is not recorded yet when a gag lands: `putPapaToSleep`'s « over this very step » rule (`sleep.ts:9-17`) must stay inside `occupyPapa` for every chosen occupation, `pickingUp` included (finish the pick-up if `now >= busyUntil`).
- **The baby's post-gag `act`.** After a gag the baby goes `act` for `feel.baby.actMs` (1500) then `babble` (`releaseTarget`). Find who writes it and in which system: `downstairs` must win, or the baby is free again 1.5 s later.
- **`enterPapaState` is a no-op on the same state**, so the same-séquelle case (D2) must not touch `busyUntil` either, or the ring jumps (deferred-work L976).
- **A replaced `carryingUp`** leaves a baby in `carriedUp` with no Papa carrying: always `finishCarryUp` first.
- **The fetch race.** Papa walks to a downstairs baby who climbs back meanwhile: `arrive` with `fetchBaby` and a baby no longer `downstairs` does nothing more (Papa idle). The salon has carry: `isTakeable` must refuse `downstairs` and `carriedUp`, and `tapBaby` must route a downstairs baby to the fetch before the « within reach → take » branch.
- **`dropProps` may push nothing** (no prop in reach): no debris, no `AfterEffectStarted{debris}`.
- **A pushed prop is off the floor until it lands.** Mark it at the push; it is a debris only once `isMess`. A prop that lands back on furniture is marked but never a debris (no pick-up, no step noise, no Sigh): acceptable, test it.
- **Debris and the rush.** `messPropIndexOf` is the rush's test; the outside-rush test is « debris » (marked and `isMess`). Do not open the rush's instant tidy to the whole level.
- **No Map, Set or closure in `World`;** `mischiefMarks` is a plain array of plain objects; the snapshot validates `gag` against `GAG_IDS`.
- **Removing `feel.fatigue.asleepMs`** changes the feel hash and the `SetFeel` / Tweakpane paths: grep `asleepMs` everywhere (`src`, `tools`, `tests`, `content`).
- **The bubble table test** compares `ACTIVITY_PICTOGRAMS` with `isPapaBusy`: `pickingUp` busy means it needs a pictogram (D9).
- **`perf.spec.ts`** (only in `npm run ci`): decals and the pénombre must keep ≤ 100 draw calls and the p95 frame ≤ 20 ms; it autoplays `human`, which will now meet séquelles.
- **A worse game wakes Mama more.** Séquelles cost time and noise: `npm run sim -- --bot human --seed 1` (ring on) must still end on `timer` for the autoplay specs (3.14 AC 15). If it ends on `mamaWoke`, do not detune anything: say so and propose another seed to Geo.
- **`VITE_DEBUG_ALLOWED`.** Run `env | grep VITE_` before `dev` or `e2e`; if set, `(unset VITE_DEBUG_ALLOWED; npm run e2e -- …)`.
- **Heavy checks queue** (`tools/ci/heavyLock.sh`): `npm run e2e -- …` in the background, never `npx playwright test`. 200-run sims in the background under `caffeinate -i -s`.
- **The worktree guard** refuses compound shell commands naming `git`, `cd` into computed paths and variables in an option position: plain commands, the edit tools, or one script in the scratchpad. A throwaway `tsx` script needs `.mts` and `npx tsx --tsconfig ./tsconfig.json <script>` from the worktree.

### Out of scope

- The catastrophe gauge, its rises per category, `mamaHome`, the rush freeze (3.16). Nothing here writes a catastrophe value; 3.16 will map gags to categories (presque-accident: outlet, stairs; bazar: table, silence; micro-sieste).
- Debris as a baby target (GDD L319, D5): deferred.
- Séquelles of the E4 sequence threats and of disruptions (GDD L220: to cost later): `none` today.
- Blender work (a `stairs_bottom` anchor, new clips): none; 2.13 is the Blender story of the catch-up.
- Changing the director, the fairness rule, the Mama score formula, or the rush's tidy.
- Picking up debris in any bot.

### Architecture compliance

- Layers: the séquelles live in `src/sim/threats/afterEffects.ts` (architecture L233, L501, L989), relative imports inside `src/sim`; the client reads `World` and `SimEvent`s through `@sim`; `src/content` keeps importing only `shared` and `zod`; constants in `src/shared/constants.ts`.
- The sim never logs, never reads real time, never calls `Math.random` (only `world.rng`, and this story adds no draw in the sim); every change of state goes through `enterPapaState` / `enterBabyState`, which emit their events.
- System order unchanged (`step.ts:44`): `runAfterEffects` is called from `runThreats`, not added to `SYSTEMS`.
- ADR-006: every new cue with audio has a visual and a haptic. ADR-011 / 3.13: séquelles are not protected.
- Content: strict schemas, camelCase keys with unit suffixes (`busyMs`, `dimMs`, `carryUpMs`, `selfReturnMs`, `pickUpMs`, `noisePct`, `debrisStepRadiusM`, `lightsPct`, `fadeMs`), generated JSON Schemas committed, never edited by hand.

### Library and framework notes

Stack pinned, nothing added: TypeScript 7 (`erasableSyntaxOnly`: no `enum`), Zod 4 (`z.strictObject`, `z.discriminatedUnion`), three 0.186.1 (lights already in `levelScene.ts`; `CSS2DObject` for the world UI), Vitest 5, Playwright 1.64, Biome 2.6. No web research needed: the story uses no API the codebase does not already use.

### File structure

- **New:** `src/sim/threats/afterEffects.ts` + `afterEffects.test.ts`; `tests/e2e/afterEffects.spec.ts`; the new golden journals and expected summaries; a decal module under `src/client/render/` (e.g. `mischiefDecals.ts` + test).
- **Updated (sim):** `src/sim/{world,events,snapshot,createSim}.ts`; `src/sim/threats/{gags,threatFsm,threatSystem}.ts`; `src/sim/papa/{papaFsm,papaSystem,sleep}.ts`; `src/sim/baby/{babyFsm,babySystem,carry}.ts`; `src/sim/physics/dropProps.ts`; `src/sim/gauges/noiseSystem.ts`; `src/sim/index.ts` (exports).
- **Updated (content):** `src/content/schemas/{threat,feel}.ts`; `content/threats/*.json` (11); `content/feel.json`; `content/feedback.json`; `content/_schemas/*` (generated); `src/shared/constants.ts`; `tools/content/contentChecks.ts`.
- **Updated (client):** `src/client/render/{gags,levelScene}.ts`; `src/client/render/views/characterClips.ts`; `src/client/ui/world/{activityBubble,tidyMarkers}.ts`; `src/client/input/{hitTest,inputMapper}.ts`; `src/client/feedback/simEventFeedback.ts`; `src/client/boot.ts`.
- **Updated (bots, tools, tests):** `src/bots/humanBot.ts`; `tools/sim/simReport.ts`; `tests/support/{testFeel.json,test*.threat.json,testContent.ts}`; `tests/golden/scenarios.ts`; the tests that build whole reports or whole worlds.
- **Docs:** `_bmad-output/project-context.md`, `_bmad-output/planning-artifacts/game-architecture.md`, `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/deferred-work.md`.

### Testing

- **Unit (sim):** one test per rule of D2-D7, built on the test content (`tests/support/testContent.ts`), each able to fail (the 3.13 lesson: « the obvious test cannot fail »): e.g. the replace rule asserts the exact `busyUntil`, not only « busy ». The AC 10 cap as a property test over random gag sequences (seeded `world.rng`, no `Math.random`).
- **Content:** schema and content-check tests (AC 2).
- **Snapshot / replay:** round-trip with each new state; determinism test still green.
- **Goldens:** regenerated plus the six new scenarios (D12).
- **Bots:** `perfect` 0 séquelle, `idle` > 0, `human` fetches (a fake world with a downstairs baby, as `humanModel.test.ts` does).
- **E2E (Chromium, background):** `afterEffects.spec.ts` + the specs listed in Task 4. The pénombre screenshot is macOS only (skipped on Linux, as `autoplay.spec.ts`).
- **Measurements (CLI):** AC 18's 200-run numbers in the Completion Notes.
- **Checks:** `npm run ci:fast` per task; `ci:story` is the review's.

### Previous story intelligence

- **3.14 (human bot):** `human` now misses (ring on, 200 runs: 3.4★, 73.6 pts, 41.2 % perfects, 95.1 % success, 25 / 200 `mamaWoke`); séquelles will cost it more. `BUSY_PAPA_STATES` is typed on `PapaState` (review fix): extend it. `humanBotRegression.test.ts` pins the frozen bot's commands. Draw-order rule: add a draw only on a new path. Its Completion Notes list `endsByReason` « for 3.16 »: do the same here.
- **3.13 (fairness):** the director reads no Papa state (D10); « séquelles not protected » is its AC 9. Lesson: pin new behaviour with a golden, not only units.
- **2.12 (bubble):** `ACTIVITY_PICTOGRAMS` is the extension point « for 3.15 »; `asleep` already uses the stars as « the after-effect that exists today ». Its deferred item (L976, ring refill on a second nap) is closed by D2. Another deferred item (the « free » ding on a busy → idle → busy chain in one step) may now happen more often (a pick-up or carry ending on the step a séquelle lands): leave it, note it if seen.
- **3.12 (note):** the Sigh reads `world.mess`; D7 tally pinned in `mamaScore` tests.
- **3.5 (rush):** `isMess`, `tidyProp`, `messPropIndexOf`, rush-only `TapObject` on props, `dropProps` shared with the table gag.
- **1.19 / 1.21 / 1.11:** the nap's coffee rule; the silence's `surpriseGags` and `mess.mischiefs`; `GAG_PRESENTATIONS` typed on `GagId`.

### Git intelligence

Recent `main`: `5572c36` merge of 3.14 (human bot, `--chrono-ring`, `--compare`), `e720fd9` merge of 2.12 (activity bubble, `TapRefused`), 3.13 before it (director fairness, `fairnessCheck.ts`). The snapshot is at version 29 (2.12 or 3.13 bumped it last). Commits follow « Story X : … » in French.

### Project Structure Notes

Follows the architecture's own placement (L233, L501, L989: `src/sim/threats/afterEffects.ts`, séquelles in `content/threats/<id>.json`). Variances, each with its reason: the caps are constants, not data (D1); the event gains `propId` (D8); the baby's « bottom of the stairs » is a client drawing, not a sim position (D4).

### Project Context Rules

- Golden rule: the AI writes and tests the séquelles; Geo plays and tunes. Every duration and strength Geo might tweak is data (`content/threats/*.json`, `feel.json`), never a number in code.
- Units are suffixes; `…At` / `…Until` are sim time.
- No `enum`, no `namespace`; FSM states are string-literal unions with `*_STATES` lists and their completeness proofs.
- Events are PascalCase past tense (`AfterEffectStarted`, `DebrisSteppedOn`); commands imperative.
- `World` is plain data (no Map, Set, class or closure); a new field bumps the snapshot version and moves the goldens: regenerate explicitly, say so.
- No `console.*` outside `src/shared/log.ts`; I/O returns `Result`; every fallback logs a `warn`.
- Never weaken a guardrail (Biome, `tests/architecture/`, the main-commit hook, a perf budget, a golden comparison).
- No merge without the review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **The baby climbs back by himself** after `selfReturnMs` (6 s) if Papa does not fetch him (D4). The GDD says nothing; without it a baby left downstairs blocks every later threat, which helps the player and freezes `idle`. Alternative: he waits forever (and cries?). Say which.
2. **« Remplace sans l'allonger », read literally** (D2): a second séquelle keeps the first one's end. The other reading (the new one restarts its own duration) lets a chain of misses keep Papa busy longer. Confirm the literal one.
3. **Picking up a debris** is a 1 s busy occupation with a new « main » pictogram, and debris carry the « RANGE ! » marker outside the final rush too (D5, D9). The GDD names no pictogram and the UX shows the marker in the rush only.
4. **Debris as a baby target** is deferred (D5); **broken props** cannot be picked up (they are « cassé »).
5. **The stairs' cost may feel light**: while the baby is downstairs no threat that needs him starts, so the séquelle is mostly the 2 s carry (and the near miss on the note). To check at the playtest after 3.16.

### References

- [Source: _bmad-output/planning-artifacts/epics.md › Story 3.15 (L2007-2032), FR72 (L139), FR74 (L141), FR75 (L142), UX-DR28 (L273), Story 2.12 (L1596-1622), Story 3.13 AC (L1976), Story 3.16 (L2034-2060), sequence (L399)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md › pillar 2 (L75), mechanic 13 (L218-220), mechanic 15 (L238), mechanic 17 (L255-258), threat catalogue (L311-322), cost of a gag (L499), open question 8 (L677)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md › L47(b), L53, L60(c)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md › L214 (bubble ring in sim time), L232-233 (World, system order), L403-426 (events, v2.3 additions), L501, L693-753 (P1 threats, busy Papa vs occupation), ADR-006 (L311), ADR-011 (L316), L989]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md › activity-bubble (L255-268, L617), rings contrast (L479, L500)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md › L217 (bubble), L220 (tidy marker), L375 (refused tap), L447-465 (reduced motion)]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md › §1, §3 order, Effort / Risks (L75-76), FR72 (L122)]
- [Source: _bmad-output/project-context.md › Busy Papa (L43), Activity bubble (L99), final rush (L58), gags (L59, L84), events (L87-90), goldens (L98, L150), World rules (L194-195)]
- [Source: _bmad-output/implementation-artifacts/2-12-bulle-d-activite-de-papa-et-tap-refuse-visible.md › L19, L27-29, L253-254, L353]
- [Source: _bmad-output/implementation-artifacts/3-13-equite-de-trajet-du-directeur.md › AC 9 (L39), D3, D5, Out of scope (L160)]
- [Source: _bmad-output/implementation-artifacts/3-14-joueur-simule-humain-realiste.md › Traps, Completion Notes (numbers, `endsByReason`)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md › L976 (nap ring refill), 2.12 « free ding » item, 3.13 golden item]
- [Source: src/sim/threats/{gags,threatFsm,threatSystem}.ts, src/sim/papa/{papaFsm,papaSystem,sleep,tidyProp}.ts, src/sim/baby/{babyFsm,carry,babySystem,approach}.ts, src/sim/physics/dropProps.ts, src/sim/gauges/noiseSystem.ts, src/sim/director/fairness.ts, src/sim/world.ts, src/sim/snapshot.ts, src/content/schemas/{threat,feel}.ts, src/client/render/{gags,levelScene}.ts, src/client/render/views/characterClips.ts, src/client/ui/world/activityBubble.ts, src/bots/humanBot.ts, tools/sim/simReport.ts, content/levels/salon_crawler{,.geometry}.json]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created (story creation, 2026-11-04). Five open points for Geo (self-return of the baby, the replace rule, the pick-up pictogram and marker, deferred baby-target debris, the stairs' cost); the story's decisions let the dev start without waiting for them.

### File List
