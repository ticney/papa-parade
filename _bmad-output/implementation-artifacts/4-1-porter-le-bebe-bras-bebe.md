# Story 4.1: Carrying the baby (baby-in-arms)

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.1 « Porter le bébé (bras-bébé) » (L1811-1836). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to take the baby in my arms to put him out of harm's way, at the price of one hand,
so that I decide at every moment when to carry and when to put him down.

**Requirements covered:**
- **FR22 `[P2]`, bras-bébé:** carrying the baby neutralises his direct threats. Papa has only one hand left: he can Parry (and Dodge, later), not hold with Firmness. His fatigue grows twice as fast, and new threats appear: Papa's micro-sleeps and crying (epics L55, GDD L171). Deciding when to carry and when to put down is a tactical decision.
- **The tail of FR17/E3 plumbing that was left for this story:** `isBabyCarried` is a stub that returns `false` (`src/sim/gauges/fatigue.ts`), the `carried` baby state is announced in `babyFsm.ts` (« Later stories add `carried` (4.1) »), `feel.fatigue.carriedMultiplier` (2) is in `feel.json` but nothing reads it, and `TapBaby` outside a silence only walks Papa to the baby (`deferred-work.md` L394: « Story 4.1 replaces that branch with “take the baby” »).
- **UX:** « POSE-LE D'ABORD ! » is the verb shown when Firmness is impossible while carrying (`EXPERIENCE.md` L159 and the hold-ring row L215; the string `verb.put_down_first` is already in `strings.fr.json`).

**What this story is not:**
- **No combo, no score for the drop.** `BabyPutDown{safe}` only says whether Papa stood in a safe zone. The multiplier, `combo-badge`, the slow-mo drop and the points are story 4.2. Do not create `sim/scoring/combo.ts` and do not touch Mama's note.
- **No bladder, no toilets** (4.3). **No sequence framework, no `stay_awake`, no snore noise, no « missed micro-sleep wakes the baby »** (4.4). A micro-sleep missed while carrying stays today's 3 s nap; the baby stays in his arms.
- **No crib, no bedroom level, no `ZONE_creak_*`, no `HoldAnywhere`** (4.8-4.10). The only new zone is the playpen.
- **No bot that carries.** `perfect`, `human`, `random` and `idle` never send a `TapBaby` outside a silence, so they do not carry (Open point 5). The carry is exercised by the unit tests, a fuzz test, the golden and the e2e test.
- **No new command.** `TapBaby` (story 1.21) does the work; `COMMAND_TYPES` and `commandProblem` do not change, so no journal from before this story becomes invalid.
- **No new top-level folder, no new dependency.**

**Sources:**
- Epics `epics.md` L55 (FR22), L388-392 (Epic 4), L1807-1836 (this story), L1838-1859 (4.2: the combo reads `BabyPutDown` and the 10 s tick), L1861-1882 (4.3: « le bébé porté: je dois d'abord le déposer »), L1884-1908 (4.4: `stay_awake` is « bébé dans les bras »), L2002-2027 (4.9, `ZONE_creak_*`).
- GDD `gdd.md` L171 (rule 5, Bras-bébé), L169 (rule 4: the combo is cashed at a drop « en lieu sûr (parc, lit, transat) »), L303 (`stay_awake`), L237 (E4 row).
- Architecture `game-architecture.md` L274 (baby FSM: `carried` « prévu pour E4 »), L643 (`ZONE_safe_<nom>` « zone de dépose en lieu sûr (E4) »), L886 (the `BabyState` union), L905-911 (the fatigue example reads `world.papa.carrying`: see D1), L965 (E4 row: `World.papa.carrying`, `babyFsm` (`carried`), `classifyPress.ts`).
- UX `EXPERIENCE.md` L159, L215; `DESIGN.md` (verb-label).
- Previous stories: `1-21-le-silence-suspect.md` (`TapBaby`, `isBabyFoundNow`, « the tap that found him is spent », hit-test priority), `1-19-fatigue-cafe-et-micro-siestes.md` (the system-spawned threat on Papa, `microSleepDef`), `1-23-fermete-optionnelle.md` (Firmness), `3-1-jauge-de-bruit.md` (`gagCryMs`, `startBabyCry`), `3-2-variante-sieste-et-reveil-de-maman.md` (how a sim story is cut: events, snapshot bump, golden, report), `1-15-physique-legere-des-objets.md` (Blender pipeline for a new node).
- Deferred work `deferred-work.md` L394 (`TapBaby`), L419 (« A Firmness hold keeps succeeding when Papa becomes busy mid-hold… settle with the busy states of E4/E5 »: not this story, see Open point 3), L343 (the snore: 4.4), L346 (HUD node budget: no new gauge here).

## Acceptance Criteria

Numbers in `content/feel.json` are live starting values for Geo to tune. Tests use the frozen `tests/support/testFeel.json`, never the live file.

### The playpen (Blender)

1. **A safe zone in the living room.** In `assets-src/blender/salon_crawler.blend`, add through the Blender pipeline of story 1.6 / 1.15 (Blender MCP if it is connected, else `/Applications/Blender.app -b … -P`; **never edit a generated JSON by hand**; if Blender cannot run, stop and tell Geo):
   - an empty or box node `ZONE_safe_playpen` in the zones collection, like `ZONE_hidden_behind_sofa`;
   - a low visual mesh `playpen` (unprefixed, lower_snake_case) under it: a flat play mat with a low rim, so the player sees where the safe place is. **No `COL_*` and no `NAV_block_*`:** Papa and the baby must be able to walk onto it (the zone is checked against both nav grids, AC 14).
   - Position it on open floor, away from every anchor: the front-left of the room, for instance a box centred near `[-2.0, 0.3, 1.6]` with `halfExtentsM ≈ [0.7, 0.3, 0.7]` (nav cells around x -2, z 1.6 are open in today's grid). It must be at least 1.2 × 1.2 m wide so that Papa (radius 0.25) and the baby (radius 0.2) each have open cells inside it.
   - Then `npm run assets:export`, `assets:extract`, `assets:optimize` (order and flags: `1-6-salon-greybox-depuis-blender.md`). `content/levels/salon_crawler.geometry.json` gets `{ "id": "playpen", "kind": "safe", … }` in `zones`, and `behind_sofa` is unchanged. `public/assets/levels/salon_crawler.glb` stays within `LEVEL_PAYLOAD_MAX_BYTES`.
   - `tests/support/testLevel.geometry.json` is a deliberate **byte copy** of the live geometry (story 1.15): copy it again and prove it with `cmp`.
   - The geometry schema does **not** require the playpen (a later level has a crib instead): `REQUIRED_ZONE_IDS` is unchanged. A level that turns carrying on needs one, AC 3.

### Content and schemas

2. **`feel.carry`** (`src/content/schemas/feel.ts`, then `content/feel.json`, `tests/support/testFeel.json`, `tests/tools/vite/fixtures/feelSample.json`; run `npm run content:schemas`). A new section, every key with a unit and a `.describe()`:
   - `reachM`: Papa takes the baby at once when he is within this distance of him (1.2).
   - `putDownOffsetM`: the baby is set down this far in front of Papa, along his heading (0.4).
   - `armsCryMinMs`, `armsCryMaxMs`: from picking the baby up, or from the last « cry in the arms » telegraph, to the next one; `Min <= Max` (a refine, like `microSleepMinMs`) (6000, 10000).
   - The fatigue multiplier is **not** duplicated: it is the existing `feel.fatigue.carriedMultiplier`.
   - The debug feel panel is generated from `FeelSchema`, so it gets the section for free: check it shows up.

3. **`carry` in the level file** (`src/content/schemas/level.ts`). A new optional key `carry: { armsCryDef?: id }` (absent: the level has no carrying, `TapBaby` behaves exactly as today). Like `gauges.noise: {}`, it is the level's opt-in.
   - `content/levels/salon_crawler.json` declares `"carry": { "armsCryDef": "arms_cry" }`.
   - `loadLevelContent` loads `armsCryDef` after the micro-sleep (path `['carry', 'armsCryDef']`); `contentChecks.ts` and `createSim` agree on the same rules and wording (the existing pattern for `microSleepDef`): the def exists, has `target: "papa"`, its gag is known and is **not** `papa_asleep` (that gag stays the micro-sleep's alone), and the level's geometry has at least one `kind: "safe"` zone (a level that carries must have somewhere safe to put the baby down).
   - `createTestLevel` (`tests/support/testContent.ts`) takes `carry`, resolving the def from the frozen threats like `microSleepDef`.

4. **The « cry in the arms » threat.** `content/threats/arms_cry.json`, modelled on `papa_microsleep.json`: `target: "papa"`, `response: "parry"`, `telegraphDelayMs: 1200`, `windowMs: null`, `gag: "arms_wail"`, `verbKey: "verb.rock"`, `icon: "cry"`, `iconShape: "circle"`, `color: "parry"`, `cooldownMs: 1000`, `gagCryMs: 4000`, `feedback: { telegraph: "tel_arms_cry", success: "resp_parry", perfect: "resp_parry_perfect", gag: "gag_arms_wail" }`.
   - New gag id `arms_wail` in `GAG_IDS` (`threats/gags.ts`): its sim consequence is none (the cry comes from `gagCryMs`, story 3.1 D9, which feeds the noise gauge); one entry in `GAG_CONSEQUENCES`, one in `client/render/gags.ts › GAG_PRESENTATIONS`.
   - New icon `cry` (a tear drop) in `THREAT_ICONS` and a path in `THREAT_ICON_PATHS` (`threatMarkers.ts`, a `Record`: a missing glyph is a type error). Regenerate the schemas.
   - New string `verb.rock` = « BERCE ! » in `strings.fr.json` (a verb is shouted with a plain space before the `!`, the schema checks it), and in the `REQUIRED_KEYS` list of `tests/content/stringsSchema.test.ts` next to `verb.put_down_first`.
   - Feedback (`content/feedback.json`, pillar 3: every cue with audio has a visual and a haptic): cues `tel_arms_cry` and `gag_arms_wail` modelled on `tel_papa_microsleep` / `gag_papa_asleep` (sound wave anchored on the threat, `light` and `heavy` haptics, the gag has `fx: "gag"`). Four new placeholder clips in `tools/audio/makePlaceholderAudio.ts`: `tel_arms_cry`, `gag_arms_wail`, `baby_pickup`, `baby_putdown` (AC 17). Run `npm run assets:audio` (macOS), **commit only the four new `.m4a`** and restore the others from git (story 1.22 T6). `content:check` and `dist:check` must pass (level audio ≤ 3 MiB).

### The sim: taking the baby

5. **Types.**
   - `BabyState` gains `'carried'` (`baby/babyFsm.ts`, with its doc, `BABY_STATES` in `snapshot.ts`).
   - `PapaSlice` gains `intent: 'none' | 'takeBaby' | 'putDownBaby'` (`world.ts`; a string-literal union with an `…_ARE_COMPLETE` proof like `PAPA_STATES`): what a tapped walk does on arrival, beside `objectId`. `createWorld` starts it at `'none'`.
   - `World` gains `carry: { armsCryAt: SimMs | null }` (when the next « cry in the arms » is due; null while the baby is not carried).
   - Events (`events.ts`, sorted into `SIM_EVENT_TYPES`, completeness proof passing): `BabyPickedUp{t}`, `BabyPutDown{t, safe: boolean}`, `ThreatCancelled{t, threatId, reason: ThreatCancelReason}` with `ThreatCancelReason = 'carried' | 'putDown'` (a `THREAT_CANCEL_REASONS` const with a completeness proof, exported from `@sim` like `LEVEL_END_REASONS`).
   - `isBabyCarried(world)` moves to `baby/babyFsm.ts` (`world.baby.state === 'carried'`) and the stub in `gauges/fatigue.ts` goes away (D1). `fatigueSystem.ts` imports it from there.

6. **What `TapBaby` does** (`papa/papaSystem.ts`, in the `TapBaby` branch, through helpers in a new `src/sim/baby/carry.ts`). In a level **without** `carry`, nothing changes. In a level with it, and a Papa who is not busy (`isPapaBusy`: a busy Papa answers nothing, as for every command), in this order (D2):
   1. The tap found a hidden baby this step (`isBabyFoundNow`): it is spent, as in 1.21. Papa stays.
   2. The baby is `carried`: **put him down here** (AC 9).
   3. The baby is `mischiefSilent` (hiding, not found): not takeable. Today's behaviour stays: Papa walks to where the baby is.
   4. The baby is within `feel.carry.reachM` of Papa: **take him** (AC 7).
   5. Otherwise Papa walks to the baby as today (`tapFloor` to his position) with `papa.intent = 'takeBaby'`; on arrival (`arrive()`), if the baby is then `reachM` close and not `mischiefSilent`, he takes him. If the baby has crawled off meanwhile, nothing happens (Papa is just idle there).
   - A tap on the floor (`TapFloor`) while the baby is `carried` **inside a safe zone box** walks Papa there with `papa.intent = 'putDownBaby'`; on arrival the baby is put down (AC 9). Any other `TapFloor`, a `TapObject`, a `Move` or a glide resets `intent` to `'none'` (the same places that reset `objectId`). `intent` is non-`none` only in `walkPath`.

7. **Taking the baby** (`takeBaby`, a helper of `baby/carry.ts`, called by `runPapa`; D3). At the step of the command, in this order:
   - Papa stops where he is (path, glide, objectId and intent cleared, `enterPapaState(idle)`).
   - The baby stops crawling (`stopCrawling`), `targetThreatId = null`, he is placed at Papa's point, his gaze follows Papa's heading, and `enterBabyState(carried)` emits `BabyStateChanged`.
   - `BabyPickedUp{t}`.
   - Every threat that is `telegraph` or `windowOpen` and whose def has `target: "anchor"` is cancelled **without a gag**, in threat order: `ThreatCancelled{reason: 'carried'}`, the threat goes straight to `idle` (new `cancelThreat` in `threats/threatFsm.ts`: clears `press`, `responseWindow`, `windowOpenAt`, `waveIndex = -1`, no `ResponseResolved`, no `GagTriggered`, no `ThreatRearmed`, no slow-mo, no hitstop). A pending press on it is dropped. Threats on Papa (`target: "papa"`: the micro-sleep, the arms cry) are **not** cancelled. A threat in `resolved`/`gag` keeps its cooldown.
   - If the level has an arms cry, `world.carry.armsCryAt = now + draw(armsCryMinMs…armsCryMaxMs)`, with **exactly one** `nextFloat`, whatever the tuning.
   - `drawBabbleMs` (private to `babySystem.ts`) moves to `baby/wander.ts` so that `carry.ts` shares it.

8. **While carried** (D4).
   - **The baby follows Papa.** At the end of `runPapa`, after Papa has moved, a carried baby is set to Papa's point and his gaze to Papa's heading. (`runBaby` already stored `prevXM/prevZM` at the start of the step, so the view interpolates.)
   - **`runBaby` leaves a carried baby alone:** after `runBabyCry` and `runSilence`, it runs `runCarry` (AC 11) and returns before `releaseTarget`, `lockOnThreat`, the approach, the wander and the babble. A carried baby never wanders, never locks on a threat, never leaves `carried` by itself. He can still cry (the cry timer is a parallel timer, 3.1).
   - **The director draws no threat aimed at the baby:** in `directorSystem.ts › isCandidate`, `isBabyCarried(world)` makes every idle threat a non-candidate (no `nextFloat` is consumed by a pick that does not happen; the wave clock and `director.nextAt` run on). `ForceThreat` (debug) is **not** changed: it still works while carried, which is how the Firmness ban (AC 12) and the verb (AC 16) are tested.
   - **Fatigue grows twice as fast:** `fatigueSystem.ts` already multiplies by `carriedMultiplier` through `isBabyCarried`; with the stub gone this just works. Pin it with a test (the rate over N steps is exactly `carriedMultiplier` times the uncarried one). Micro-sleeps then arrive earlier through the existing threshold logic; nothing else is added for them.
   - **Parry works as usual** on a threat that is up while carried (a micro-sleep, the arms cry, a forced threat).

9. **Putting the baby down** (`putDownBaby` in `carry.ts`; D5), from the `TapBaby` of rule 6.2 or from the arrival of rule 6.5/6.6:
   - Papa stops (as in AC 7). The baby is set `putDownOffsetM` in front of Papa along his heading, then, if that point is not open on the baby's grid, on the nearest open cell (`ensureOnOpenCell`).
   - `safe` = Papa's point is inside any `kind: "safe"` zone box of the level (x/z test, the same `isInZone` as the hidden zones: move it to a shared place, do not copy it).
   - The baby goes back to `babble` with `wanderAt = now + drawBabbleMs` (one `nextFloat`), `babbling = true`: « his normal FSM resumes ». Events in this order: `BabyStateChanged{carried → babble}`, `BabyPutDown{safe}`, then `ThreatCancelled{reason: 'putDown'}` for the arms cry if it is `telegraph`/`windowOpen` (it is the baby's cry: no baby in the arms, no cry in the arms). `world.carry.armsCryAt = null`.
   - Other active threats (a forced one, the micro-sleep) are left alone. The baby may lock on them from the next step, like any free baby.
   - `intent` is reset. A put-down never needs the safe zone: on bare floor it is `safe: false`.

10. **Taking and putting down are the same tap, so the order within one step matters:** both happen in `runPapa`, which runs **after** `runDirector`, `runBaby` and `runThreats`. A threat the director telegraphs in the very step of the pick-up is cancelled by it in the same step (`ThreatTelegraphed` then `ThreatCancelled`: acceptable, pin it with a test). Do not reorder `SYSTEMS`; no system is added (the carry lives in `runPapa` and `runBaby`).

11. **The cry in the arms** (`runCarry` in `baby/carry.ts`, called by `runBaby`; D6). It is the micro-sleep's twin:
    - A level with `carry.armsCryDef` has one more threat instance, **after** the micro-sleep (`SimLevel.armsCryIndex`, -1 if none; `microSleepIndex` stays the micro-sleep's: compute it before pushing the arms cry). It stands on Papa (`firstWaveIndex: -1`, `PAPA_TARGET_ANCHOR_ID`), follows him each step, is never drawn by the director, never counts against a wave's `maxSimultaneous`, never gets locked on by the baby, and a press on it does not glide Papa: every place that tests `target === 'papa'` already does this, check each one (`createSim`, `directorSystem.forceThreat`, `papaSystem.pressThreat`, `babySystem.lockOnThreat`, `threatMarkers.ts`, `client/app/threatsSwitch.ts`, `tools/content/contentChecks.ts`).
    - While the baby is `carried` and `now >= world.carry.armsCryAt`, it is telegraphed (`telegraphThreat(…, -1)`) at the first step where the instance is `idle`, Papa is not busy, the flow is `playing`, and it could be judged before the level ends (its delay, window and tolerance). Then `armsCryAt = now + draw(…)` (one `nextFloat`). The « could be judged before the end » test is the one `runFatigue` already has: extract it into a shared helper, do not copy it.
    - A success or a gag follows the normal FSM (the gag: `GagTriggered{arms_wail}`, then the baby cries `gagCryMs`, hence noise). Missing it does not make the baby leave the arms and costs no fatigue.
    - Papa's micro-sleep and the arms cry may be up together: two markers on Papa; the verb layout already offsets simultaneous verbs.

12. **Firmness is impossible while carried** (`threats/threatSystem.ts`; epics AC 3). In the branch that resolves a classified press: when `def.response === 'firm'` and `isBabyCarried(world)`, the press is a gag `wrongResponse` as soon as it is classified (a short press is already `wrongResponse` for a `firm` def, a held one now too), and never `resolveThreat`. A `parry` def pressed with a held press stays `wrongResponse`, unchanged. The director never draws a `firm` threat while carried and a pick-up cancels the ones up, so this is reached only by `ForceThreat`; a test with `tests/threats/fixtures/test_firm.json` pins it (force it while carried, hold it: `ResponseResolved{fail, reason: 'wrongResponse'}`).

13. **Snapshot v15.** In `src/sim/snapshot.ts`: the type, the literal, the `invariant`, the history comment (« 15 since story 4.1: `world.carry`, `papa.intent`, the `carried` baby state »), `BABY_STATES`, `PAPA_INTENTS`. Validate:
    - `world.carry.armsCryAt` is null or a finite number; non-null only while the baby is `carried` and the level has an arms cry (`planned.armsCryIndex >= 0`, passed in like `microSleepIndex`).
    - `papa.intent` is a known value; non-`none` only in `walkPath`, and never with an `objectId`; `putDownBaby` only with a `carried` baby; `takeBaby` only with a baby that is not.
    - A `carried` baby has no path, no `targetThreatId`, no `approachSpeedMps`, and no silence is under way.
    - Update the snapshot tests and the `version` fixtures; a round-trip test covers a carried world and a world mid-walk with each intent.

### The client

14. **Input.**
    - A touch on the baby already sends `TapBaby` (`inputMapper.ts`, `hitTest.pickBaby`, story 1.21): it now takes or puts down. While the baby is `carried`, `pickBaby` aims at the baby **where he is drawn** (lifted in Papa's arms: pass the carried height instead of `babyBodyRadiusM`), so a tap on Papa's chest puts him down and a tap on the floor elsewhere walks (a tap inside the playpen walks there and puts him down, rule 6).
    - Space / pad A (the context action, `inputMapper.act`): when the baby is `carried` he is always « in reach », so **an object in reach wins over the baby** in that case (otherwise the coffee machine and the phone could never be used from the keyboard while carrying). Without an object in reach, the action is `TapBaby` (put down). Not carried: unchanged (ties go to the baby).
    - Threats keep the top priority (threat > baby / object > floor): a tap on the arms-cry marker presses it.
    - Every handler stays « almost nothing » (project-context): no allocation per event.

15. **The baby in Papa's arms** (`render/views/babyView.ts`, `levelScene.ts`). While `world.baby.state === 'carried'` the baby is drawn lifted to Papa's chest, a little in front of him, riding his interpolated pose (not the baby's own, which equals Papa's anyway). It composes with the `setLiftM` hop of the response choreography (`createLiftFx`): add a separate carried offset and sum, do not make one overwrite the other. The shadow stays on the floor. Art constants (height, forward offset) are named with their units at the top of the file, like the others. Under reduced motion nothing changes (no motion is added).

16. **The verb « POSE-LE D'ABORD ! »** (`ui/world/threatMarkers.ts`). The marker of a threat whose def has `response: "firm"` shows `t('verb.put_down_first')` instead of its own verb while the baby is `carried`, and its own verb again when he is not. `ThreatMarkerEntry` gets the second text (translated once at build, like `verb`), `update` takes the carried flag (the caller passes `world.baby.state === 'carried'`), and the text is rewritten only when it changes (no per-frame DOM write, no allocation). The verb fit (`VERB_MAX_WIDTH_PCT`, `VERB_MIN_FONT_PX`) is recomputed for the longer string. A `parry` marker never changes. No live def is `firm` yet, so this is proved on a unit test with a `firm` def (and by `ForceThreat` on `test_firm` in a Vitest scenario); there is no e2e for it.

17. **Cues and mirrors.**
    - `content/feedback.json › events`: `BabyPickedUp → baby_picked_up`, `BabyPutDown → baby_put_down`, with the two cues (audio `baby_pickup` / `baby_putdown` on `sfx`, a sound wave anchored on Papa, a haptic: `light` to pick up, `medium` to put down). One cue for a safe and an unsafe put-down: telling them apart is story 4.2's cash-in. `ThreatCancelled` has no cue (the marker just goes away). `feedbackEquivalence.test.ts` passes unchanged.
    - Mirrors (dev and `?debug=1` only, on events, never per frame): `data-pp-baby-state` already follows `BabyStateChanged`, so it reads `carried`; new `data-pp-put-down` = `safe` | `unsafe` on `BabyPutDown`, removed at the next level start. `data-pp-threat` follows `ThreatCancelled` as `<id>:idle`.
    - The debug overlay's cheat list (`src/debug/cheats.ts › CHEATS`) gets « Take / put down the baby » (always available, sends `TapBaby`), so a tester or Playwright can carry without aiming a finger. `window.__PP__.send({ type: 'TapBaby' })` already works.

### Bots, CLI and tests

18. **The sim report** (`tools/sim/simReport.ts`). It assumes every telegraph ends in exactly one `ResponseResolved` and counts every telegraph with `waveIndex < 0` as a micro-sleep. Fix both:
    - `ThreatCancelled` for a wave threat does `activeCount--` (a system threat does not move it); otherwise a cancelled threat would leave the count high and flag `isOverLimit`.
    - A telegraph whose `kind` is the level's `carry.armsCryDef` counts as an `armsCries`, not a micro-sleep.
    - Per run and in the aggregate (sums): `babyPickUps`, `babyPutDowns`, `safePutDowns`, `armsCries`, `cancelledThreats`. `--help` (`simArgs.ts`) mentions them; `tests/tools/sim/simReport.test.ts` covers a level with a carry played by hand-fed events.

19. **The bots are unchanged and prove it.** On `salon_crawler` (which now has `carry`), with the same seeds, `npm run sim -- --bot perfect|human|random|idle --runs 20` gives the same `meanStars`, `endsByReason`, success rate and threat tallies before (on `main`) and after; put the two summaries in the Completion Notes. They never carry, so the sim's rng is untouched. The arms-cry instance must not appear in a wave's tallies.

20. **Unit tests** (next to the code, `vitest`), at least:
    - `baby/carry.test.ts`: the whole of rule 6 (a table: carried / hiding / near / far / busy Papa / no `carry` in the level / found this step), take and put down, event order (AC 7 and 9), `ThreatCancelled` for each state (`telegraph`, `windowOpen` with a pending press, `resolved`, `gag`, `idle`, a `papa`-target one), no `GagTriggered`, no `ResponseResolved`, no slow-mo and no hitstop requested; the baby follows Papa along a walk; he never leaves `carried` on his own over 1 000 steps; `safe` true inside the playpen and false on bare floor; the put-down point is open; the rng consumed is exactly one `nextFloat` at the take (arms-cry level) and one at the put-down, and none without an arms cry at the take.
    - `papaSystem.test.ts`: the walk-then-take (and the baby crawling out of reach: nothing is taken), the walk-to-the-playpen-then-put-down, `intent` reset by every other command, a busy Papa ignores `TapBaby`, `TapBaby` while carried stops a walk.
    - `babySystem.test.ts`: `runBaby` keeps a carried baby carried; `directorSystem.test.ts`: no draw while carried, no rng used by a skipped pick, `ForceThreat` still works carried; `threatFsm`/`threatSystem.test.ts`: `cancelThreat`, the Firmness ban (AC 12); `fatigueSystem`/`fatigue.test.ts`: exactly `carriedMultiplier` times the rate, micro-sleep earlier; the arms cry: due after the draw, not while Papa is busy, not too late to be judged, cancelled on put-down, `armsCryAt` null after, one more telegraph after a result.
    - `createSim.test.ts`: refusals (arms-cry def missing, with another target, with `papa_asleep`, a level that carries with no safe zone), `armsCryIndex`. `snapshot.test.ts`, `events.test.ts` (sorted, complete), `commands.test.ts` unchanged.
    - Content: `levelSchema.test.ts` (`carry` accepted, absent allowed, unknown key refused), `feelSchema.test.ts` (`carry` keys, `Min <= Max`), `threatSchema.test.ts` (`icon: "cry"`), `checkContent.test.ts` (the new pairing rules), `contentFiles.test.ts` / `loadLevelContent.test.ts` (the arms-cry def is loaded).
    - `tests/threats/threatCatalog.test.ts` generates « perfect / success / too early / too late » for every def: `arms_cry` must go through it. It treats every `target: "papa"` def as the micro-sleep; teach it the difference (the micro-sleep's gag is `papa_asleep`): for the arms cry it plans `carry: { armsCryDef }`, makes `armsCryMinMs`/`MaxMs` 0 and `carry.reachM` large in `contentFor`, sends `TapBaby` first, and adds it to `spawnedOnPapa`.
    - A **fuzz test** (`src/sim/baby/carryFuzz.test.ts`, next to the code): 200 seeds, 3 000 steps each on the frozen level with `carry` and the arms cry, random `TapBaby` / `TapFloor` (some in the playpen) / `TapObject` / `Move` / `MoveStop` / `PressThreat` / `ForceThreat` drawn from a seeded rng of the test (not `Math.random`). Invariants throw in test, so it must run clean; after every step also assert that a carried baby is at Papa's point, that `armsCryAt` is non-null only while carried, and that no `ThreatTelegraphed` of a wave threat is emitted while the baby is carried (a `ForceThreat` one is the only exception: leave `ForceThreat` out of this run, or filter it by id).
    - Client: `threatMarkers.test.ts` (the verb swap, no write when unchanged), `babyView.test.ts` (the carried offset composes with the hop), `hitTest.test.ts` / `inputMapper.test.ts` (pickBaby at the carried height; Space with an object in reach while carried), `cheats.test.ts` (the new cheat sends `TapBaby`).
    - `src/sim` coverage stays at or above 90 % (`npm run test:coverage`).

21. **Goldens** (deliberate: say so in the Completion Notes).
    - **Every existing golden moves, only in its hashes.** `testFeel.json` gains a section (`feelHash`), the geometry fixture gains a zone (`geometryHash`) and `World` gains a slice (`worldHash`). Regenerate with `npm run golden:update`, then **diff each `*.expected.json` and prove the event sequences and every non-hash field are identical**. If an event, a `t` or a score differs, stop: it is a bug, not a regeneration.
    - Add one scenario, `baby_carry` (`tests/golden/scenarios.ts`, a test file like `propFall.test.ts`): the frozen level with `carry`, an outlet wave, `TapBaby` while the outlet is telegraphed (pick-up and `ThreatCancelled`), a walk into the playpen, a safe put-down, and the outlet coming back after. Import `STEP_MS` from `@shared/constants`, do not hard-code 10.

22. **End to end** (`tests/e2e/carry.spec.ts`, chromium + webkit, frozen level, `ppSend` / `ppAdvance` like `silence.spec.ts` and `fatigue.spec.ts`; read bounds from the live content, never hard-code a tuned number).
    - Take: `TapBaby`, advance until `data-pp-baby-state` is `carried` (Papa walks there first); a real pointer tap on the baby does the same (follow how `silence.spec.ts` taps him).
    - Cancel: with a threat telegraphed (`ForceThreat`, then `TapBaby`), `data-pp-threat` ends `<id>:idle` with no `data-pp-gag` change.
    - Put down: a tap on Papa puts him down on bare floor (`data-pp-put-down` = `unsafe`, baby state back to `babble`); carry him into the playpen (`TapFloor` at its centre, read from the live geometry) and he is put down `safe`.
    - Cry in the arms: `ppSetFeel` `carry.armsCryMinMs`/`MaxMs` small, carry, advance: a `ThreatTelegraphed` for `arms_cry` appears, its marker reads « BERCE ! », a Parry resolves it; putting the baby down cancels a pending one.
    - Cues: `__PP__.cueLog()` holds `baby_picked_up` and `baby_put_down`; in Chromium the vibrations include their patterns (WebKit has no `navigator.vibrate`: DOM only).
    - The HUD still fits `HUD_MAX_DOM_NODES` (40). Nothing in the existing e2e suite regresses; no screenshot reference should move (if one does, refresh the darwin references and say so).

23. **Docs.**
    - `deferred-work.md`: close L394 (`TapBaby` now takes the baby), note that `isBabyCarried`'s stub is gone, and add what this story defers (Open points 3-5).
    - `_bmad-output/project-context.md`: add a « Carrying the baby (story 4.1) » paragraph to the Engine rules, in the style of the others (the state is the source of truth, `intent`, the director rule, the arms cry, `ThreatCancelled`), and bump the snapshot version it mentions (« snapshot version 14 » → 15).
    - Do **not** edit the architecture or the GDD. The architecture example reads `world.papa.carrying`; this story has no such field (D1). Say so in the Completion Notes.

24. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, run once, when `ci:fast` and the touched e2e specs are already green (CLAUDE.md › Commands).

## Tasks / Subtasks

- [ ] **T1. Blender: the playpen** (AC 1)
  - [ ] T1.1 Add `ZONE_safe_playpen` and the `playpen` mesh to `salon_crawler.blend` (no collider, no nav block); run `assets:export`, `assets:extract`, `assets:optimize`.
  - [ ] T1.2 Check `geometry.json` has the `playpen` safe zone and `behind_sofa` is unchanged; copy to `tests/support/testLevel.geometry.json` and `cmp`; check the `.glb` size; `blenderConventions.test.ts` and `levelGeometry.test.ts` pass.
- [ ] **T2. Content and schemas** (AC 2, 3, 4)
  - [ ] T2.1 `feel.carry` in `FeelSchema`, `feel.json`, `testFeel.json`, `feelSample.json`; refine `Min <= Max`; `npm run content:schemas`.
  - [ ] T2.2 `carry` in `LevelSchema`; `loadLevelContent`; `contentChecks.ts` rules; `salon_crawler.json`; `createTestLevel`.
  - [ ] T2.3 `arms_cry.json`, gag `arms_wail`, icon `cry`, string `verb.rock`, the two threat cues, the two event cues, four placeholder clips (`assets:audio`, commit only the new `.m4a`).
- [ ] **T3. Sim: types and the take / put-down** (AC 5-9, 13)
  - [ ] T3.1 `BabyState.carried`, `PapaSlice.intent`, `World.carry`, three events, `isBabyCarried` moved; `createWorld`, `createSim` (`armsCryIndex`, `safeZones` in `SimLevel`, the new threat instance, the refusals).
  - [ ] T3.2 `baby/carry.ts`: `takeBaby`, `putDownBaby`, shared `isInZone`; `cancelThreat` in `threatFsm.ts`; `drawBabbleMs` moved to `wander.ts`.
  - [ ] T3.3 `papaSystem.ts`: the `TapBaby` rules, `TapFloor` into a safe zone, `arrive()` with `intent`, the follow at the end of the step, resets of `intent`.
  - [ ] T3.4 Snapshot v15 and its tests.
- [ ] **T4. Sim: while carried** (AC 8, 10-12)
  - [ ] T4.1 `runBaby` returns early for a carried baby; `directorSystem` candidate rule; `fatigueSystem` reads the real `isBabyCarried`.
  - [ ] T4.2 `runCarry` and the arms cry (shared « judged before the end » helper); the Firmness ban in `threatSystem.ts`.
  - [ ] T4.3 Unit tests of AC 20 for the sim, then the fuzz test.
- [ ] **T5. Client** (AC 14-17)
  - [ ] T5.1 `inputMapper` / `hitTest` (carried height, Space with an object in reach); `babyView` carried offset; `levelScene` wiring.
  - [ ] T5.2 `threatMarkers` verb swap; `boot.ts` mirrors and `ThreatCancelled`; `feedback.json` events and cues; the debug cheat.
  - [ ] T5.3 Client unit tests of AC 20.
- [ ] **T6. Tools and tests** (AC 18-22)
  - [ ] T6.1 `simReport.ts` (`ThreatCancelled`, `armsCries`, counters) and its test; the bot regression of AC 19.
  - [ ] T6.2 `threatCatalog.test.ts` for the arms cry; goldens (regenerate, diff, add `baby_carry`).
  - [ ] T6.3 `tests/e2e/carry.spec.ts`.
- [ ] **T7. Docs and CI** (AC 23, 24)
  - [ ] T7.1 `deferred-work.md`, `project-context.md`.
  - [ ] T7.2 `ci:fast` after each task; the touched e2e specs on Chromium; one `npm run ci` before the review.

## Dev Notes

### Decisions (D1-D7)

- **D1. The baby's state is the single source of truth: no `papa.carrying`.** The architecture's example (L905-911, L965) reads `world.papa.carrying`. A second boolean next to `baby.state === 'carried'` would be two fields that must agree. `isBabyCarried(world)` reads the state; the snapshot checks the rest. Say it in the Completion Notes; do not edit the architecture.
- **D2. One command, and a deliberate reading of epics AC 4.** The epics say « I tap the floor or a `ZONE_safe_*`: Papa puts the baby down ». Taken literally, a tap on the floor could never be a walk again while carrying, which is the point of carrying (take him to the playpen). So: **tap the carried baby (Papa's chest) = put him down here; tap a safe zone = walk there and put him down on arrival (safe); tap any other floor = just walk, he stays in your arms.** The result is the epic's: a put-down on bare floor (`safe: false`) and in a safe zone (`safe: true`) both exist. Taking him is symmetric: close = at once, far = walk then take, like `TapObject`'s walk-then-act. This is the story's biggest judgement call: Open point 1.
- **D3. Take and put down live in `runPapa`, with helpers in `baby/carry.ts`.** `TapBaby` is already Papa's command there; the helpers write the baby slice like `answerPhone` writes a disruption's. No system is added or reordered, so the pinned order test and the goldens' structure hold.
- **D4. A carried baby is inert, not paused.** `runBaby` still ticks his cry and his silence (a no-op while carried), then returns. His position is Papa's at the end of every step, so there is no one-step lag.
- **D5. `safe` is about Papa's point, not the baby's.** The baby is set down in front of Papa and may be pushed to an open cell; Papa standing on the mat is the player's act and is what 4.2 cashes.
- **D6. The cry in the arms is a second system-spawned threat on Papa**, not a new `target`. Same FSM, judgement, feedback and markers as the micro-sleep. The pairing rule flips: the micro-sleep must end in `papa_asleep`, the arms cry must not.
- **D7. The level opts in (`carry`).** Carrying changes the game (the director goes quiet), so only the level that declares it has it. `salon_crawler` declares it because the epic says every sequence is launched from the debug overlay in the living room until 4.10.

### Current state of the files this story changes (read before editing)

- **`src/sim/papa/papaSystem.ts`** (213 lines). `runPapa` handles `TapFloor`, `TapObject`, `TapBaby`, `Move`, `MoveStop`, `PressThreat` in order, stops at the first command if Papa is busy (`break`). The `TapBaby` branch is: `if (!isBabyFoundNow(world, ctx)) tapFloor(world, ctx, world.baby.xM, world.baby.zM)`. `tapFloor` plans the walk, resets `objectId`, emits `PapaPathPlanned`, enters `walkPath`. `arrive()` emits `PapaArrived` then runs the object action or goes idle. Preserve: the busy rule, the found-baby rule, the glide (`pressThreat` does not glide a `papa`-target threat).
- **`src/sim/baby/babySystem.ts`** (158 lines). `runBaby`: `prevXM/prevZM`, `runBabyCry`, `runSilence`, `releaseTarget`, `lockOnThreat`, approach, act, babble, wander. `releaseTarget` would **drop a carried baby back to `babble`** if it ran (the target threat is no longer active): hence the early return. `drawBabbleMs` is private.
- **`src/sim/baby/babyFsm.ts`.** `BabyState` has six states; `enterBabyState` is the only writer; `isBabyFree` is `wander`/`babble` with no target and no silence (so false when carried: right).
- **`src/sim/baby/silence.ts`.** `isBabyFoundNow` scans this step's events for `SilenceEnded{found}`; `isBabyTapped` is how a `TapBaby` finds a baby. `isInZone` is exported from here and is imported by the director: move it to a shared helper.
- **`src/sim/gauges/fatigue.ts`** ends with the `isBabyCarried(_world)` stub returning `false`; **`fatigueSystem.ts`** already does `multiplier = isBabyCarried(world) ? carriedMultiplier : 1` and holds the micro-sleep scheduling this story mirrors.
- **`src/sim/threats/threatFsm.ts`.** `enterThreatState`, `telegraphThreat`, `resolveThreat`, `gagThreat`, `rearmThreat`; **`threatSystem.ts`**: the press resolve branch (`def.response === 'firm' && kind === 'firm'`, then `kind === def.response`, else `wrongResponse`).
- **`src/sim/director/directorSystem.ts`.** `isCandidate` is where « may be drawn now » is decided; `forceThreat` ignores gaps and the lull and refuses `papa` targets and a hidden zone with a busy baby.
- **`src/sim/createSim.ts`.** `simLevelOf` builds `SimLevel` and refuses a broken level with `invariant`s; the micro-sleep is pushed last and `microSleepIndex = threats.length - 1`; `checkReachable` proves reach; the world's threats are built from `simLevel.threats`.
- **`src/sim/context.ts`.** `SimLevel`, `SimHiddenZone`, `SimPlannedThreat`: add `safeZones`, `hasCarry`, `armsCryIndex`.
- **`src/sim/snapshot.ts`** (822 lines), version 14. `BABY_STATES`, `papaProblem`, the per-slice validators, `planned.microSleepIndex` passed to the validator.
- **`src/content/schemas/{feel,level,threat}.ts`**, `src/content/loadLevelContent.ts`, `tools/content/contentChecks.ts` (micro-sleep pairing L705-730, wave rules L657-680, gag/hiddenZone rule L306).
- **Client:** `input/inputMapper.ts` (`TapBaby` at L262 and L394, the context action), `input/hitTest.ts` (`pickBaby`), `render/views/babyView.ts` (`setLiftM`, `setSlideM`), `render/levelScene.ts` (`createLiftFx` at L323), `ui/world/threatMarkers.ts` (verb translated once at build, `followsPapa`), `app/threatsSwitch.ts` (`?threats=off` keeps the micro-sleep def), `boot.ts` (the mirrors L430-470, `mirrorThreatEvent` L536), `feedback/simEventFeedback.ts` (events table → cues).
- **Tools/tests:** `tools/sim/simReport.ts` (the telegraph/resolve accounting L160-215), `tests/support/testContent.ts` (`createTestLevel`, `FATIGUE_GAUGES`), `tests/threats/threatCatalog.test.ts`, `tests/threats/fixtures/test_firm.json`, `tests/golden/*`.

### Must not change

- The silence's rules (story 1.21): a tap that finds the baby is spent; `TapBaby` on a hiding baby that is not found still only walks. The existing silence tests, bots (`perfect` taps the baby when a silence is announced) and goldens pass unchanged except for hashes.
- Judgement: windows, tolerance, the effective-window order (`sim/timing/effectiveWindow.ts`), early press, buffer. Nothing here changes how a threat is judged except the Firmness ban while carried.
- Mama's note, the noise gauge, the fatigue formula (only the multiplier now applies), the micro-sleep's contract (`papa_asleep`, `target: "papa"`).
- `SYSTEMS` and its order; `COMMAND_TYPES`; the journal format.
- The thresholds that make a sim story safe: no `Math.random`, `Date`, `performance`, `setTimeout` in `src/sim` (`simPurity.test.ts`).

### Architecture compliance

- Pure sim, serialisable `World` (a union, numbers, a nullable `SimMs`); randomness only from `world.rng`, **a fixed number of draws that never depends on the tuning** (one per take with an arms cry, one per put-down, one per arms-cry telegraph); ids only from `allocateId`.
- State changes only through `enterBabyState` / `enterPapaState` / `enterThreatState`; durations from `world.time.sim - enteredAt`; no frame counters.
- The sim emits events (`BabyPickedUp`, `BabyPutDown`, `ThreatCancelled`, past tense, `t`) and never logs.
- Units in names: `reachM`, `putDownOffsetM`, `armsCryMinMs`, `armsCryAt` (an instant, sim time). A boolean is `is…`/`has…`. `intent` is a string-literal union.
- Tunables in `feel.json` (`carry`), content in JSON (`arms_cry`, the level's `carry`), strings in `strings.fr.json`; art constants of the placeholder carry pose named with units at the top of `babyView.ts`.
- Client imports only `@sim` (`src/sim/index.ts`): export `ThreatCancelReason`, `THREAT_CANCEL_REASONS` and anything else the client needs from there. No static import of `src/debug` or `src/bots`. The cheat belongs to `src/debug`.
- I/O errors, if any, are `Result`s; every fallback logs a `warn` (a marker that cannot find a string, for instance).

### Library and framework notes

- No new dependency. Zod 4 (`z.strictObject`, `.refine`, `z.toJSONSchema` through `npm run content:schemas`), Vitest 5, Playwright 1.64, Three r186 (the carried offset is plain `Object3D` position maths). The placeholder audio uses the existing macOS-only `afconvert` pipeline.

### File structure

New:
- `src/sim/baby/carry.ts`, `carry.test.ts`, `carryFuzz.test.ts`
- `content/threats/arms_cry.json`
- `public/assets/audio/{baby_pickup,baby_putdown,tel_arms_cry,gag_arms_wail}.m4a`
- `tests/golden/babyCarry.test.ts` with `tests/golden/journals/baby_carry*.json`
- `tests/e2e/carry.spec.ts`

Updated (source): `assets-src/blender/salon_crawler.blend`, `content/levels/salon_crawler.{json,geometry.json}`, `public/assets/levels/salon_crawler.glb`; `src/content/schemas/{feel,level,threat,strings}.ts`, `src/content/loadLevelContent.ts`, `tools/content/contentChecks.ts`, `content/{feel,feedback,strings.fr}.json`, `content/_schemas/*` (generated); `src/sim/{world,events,snapshot,createSim,context,index}.ts`, `baby/{babyFsm,babySystem,wander,silence}.ts`, `papa/papaSystem.ts`, `papa/papaFsm.ts` (doc), `director/directorSystem.ts`, `threats/{threatFsm,threatSystem,gags}.ts`, `gauges/{fatigue,fatigueSystem}.ts`; `src/client/{boot.ts,input/inputMapper.ts,input/hitTest.ts,render/views/babyView.ts,render/levelScene.ts,render/gags.ts,ui/world/threatMarkers.ts,app/threatsSwitch.ts}`, `src/debug/cheats.ts`; `tools/audio/makePlaceholderAudio.ts`, `tools/sim/{simReport,simArgs}.ts`.

Updated (tests): `tests/support/{testContent.ts,testFeel.json,testLevel.geometry.json}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/threats/threatCatalog.test.ts`, `tests/golden/*` (hashes), the unit tests next to each changed file, `tests/content/*`, `tests/tools/sim/simReport.test.ts`.

Docs: `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/project-context.md`, `sprint-status.yaml`.

### Testing

- Sim tests run in Node with `createSim` and typed commands; time is `stepN(sim, n)` (10 ms a step), never timers. Use the frozen `createTestContent()` / `createTestLevel({ carry: {…}, … })`, never the live `feel.json`.
- Put the baby near Papa by walking or by `reachM` in the test feel; the frozen room's playpen is the one copied in T1.
- Every new function in `sim/baby/carry.ts` has a unit test; every FSM change has its tests.
- Run `ci:fast` after each task. E2E on Chromium alone while developing: `npx playwright test tests/e2e/carry.spec.ts tests/e2e/silence.spec.ts tests/e2e/fatigue.spec.ts tests/e2e/threats.spec.ts --project=chromium`. **Check `env | grep VITE_` first:** if `VITE_DEBUG_ALLOWED=false` is exported, run these as `(unset VITE_DEBUG_ALLOWED; …)` or nearly every spec times out on `data-pp-app="start"`.
- Screenshots are macOS only; none should change.

### Previous story intelligence (3.4, 3.2, 3.1, 1.21, 1.19, 1.23, 1.15)

- A sim story is cut the way 3.2 is: events and types first, the snapshot version bump, a golden, the report, then the client. Do not touch what the previous story pinned.
- **Hashes move for three independent reasons here** (feel section, geometry zone, new world slice). Regenerate once, at the end, and diff: events must be identical (3.2 AC 15 did the same).
- 1.21 settled « the tap that found him is spent » through an event scan (`isBabyFoundNow`); reuse that pattern rather than a flag.
- 1.19's micro-sleep is the template for a threat the sim spawns on Papa (instance last in the list, follows Papa, never in a wave pool, scheduled with a draw, telegraphed only when judgeable before the end). Every place that special-cases `target === 'papa'` was found by grep then: grep again.
- 3.1: `gagCryMs` is on the def, the gag id carries no cry. Reuse it for `arms_cry`.
- 1.15: a node added to the `.blend` goes through the pipeline; `testLevel.geometry.json` is re-copied byte for byte.
- Reviews of 3.x found: story text contradicting the commits (keep the Completion Notes honest), an RNG seed shared between two placeholder clips (use the next free `SEED + n` in `makePlaceholderAudio.ts`), tests that hard-code `STEP_MS`, dead variables in tests, comments that claim more than the test asserts.
- The sim report is easy to forget: a new event that breaks its « one telegraph, one result » accounting silently flags every run (AC 18).

### Git intelligence

- Recent work: 3.4 (`tools/playtest`, `content/playtest.json`, tool-only content), 2.5 (screen effects), 3.3 (the exported journal). The branch convention and commit messages are « Story X.Y : création de la story / <titre> / corrections de la revue de code » (French, a space before the colon). Work on `story/4-1-porter-le-bebe-bras-bebe`; `main` only receives the merge after Geo's OK.

### Project Structure Notes

- `baby/carry.ts` sits with the other baby files (`silence.ts`, `cry.ts`); the architecture's `src/sim/baby/` is right for it. `classifyPress.ts` (named in the architecture's E4 row) is **not** touched: the ban is a judgement rule in `threatSystem.ts`, and `classifyPress` stays a pure function of times.
- A variance from the architecture: no `World.papa.carrying` (D1). Another: the carry is a level opt-in (D7).

### Project context rules (from `_bmad-output/project-context.md`)

- Golden rule: the AI writes and tests; Geo tunes. Every tunable is data (`feel.json`, `content/**`); nothing hard-coded.
- Layers: `sim` imports `shared`, `content` types; never `three`, `window`, `Date`, `performance`, `setTimeout`, `Math.random`; `client` imports `@sim` only (never `@sim/*` deep paths); `debug` is imported by nobody statically; no `console.*` (use `log`).
- Systems are `(world, ctx) => void` in the pinned order; they never call each other (helpers called from a system are fine); `World` is plain serialisable data; `state` changes only through `enter…State`.
- Randomness only `world.rng`; ids only `allocateId`; the number of draws must not depend on the tuning.
- New threat = new JSON, never a class. Cross-references (threat → feedback key, gag, icon, string) pass `content:check`. A gag's consequence lives in `gags.ts`, its presentation in `client/render/gags.ts`; a threat's marker glyph is its def's `icon`; the verb is `verbKey`.
- Every feedback `audio` has a `visual` and a `haptic`; a threat's success/perfect clip is `resp_<response>`, its telegraph a unique `tel_*`, its gag a `gag_*` (story 2.3).
- Units are suffixes; `t`/`…At` is sim time, `…AtReal` real time; constants `UPPER_SNAKE` in `shared/constants.ts`.
- Tests: colocated unit tests; sim coverage ≥ 90 %; goldens regenerated deliberately with the reason in the story; architecture tests are never weakened.
- Input handlers do almost nothing; zero allocation in hot paths (the follow step, the marker update, the view update).
- UX is the interface's source of truth: UI strings only through `t(key)`, `pp-` prefixed classes, tokens only.

### Open points for Geo (tune or decide after playing)

1. **The put-down gesture (D2).** Tap Papa's chest = put down here; tap the playpen = walk and put down; tap elsewhere = walk on. The epic's wording (« I tap the floor ») was not taken literally because it would forbid walking while carrying. Does this feel right on a phone, or do you want a dedicated button?
2. **Carrying is almost free until 4.2-4.4.** While carried, the director draws nothing, so the baby's threats disappear. The price is fatigue ×2 (`carriedMultiplier`), micro-sleeps and the cry in the arms (`armsCry*Ms`, `gagCryMs`). Without the combo (4.2), the bladder (4.3) and `stay_awake` (4.4), a player can carry for the whole level. Tune the cry and the multiplier if the playtest shows it.
3. **A missed micro-sleep while carrying** is still a 3 s nap with the baby in the arms; waking him with a snore and +15 % noise is story 4.4. The busy-Papa edge cases of deferred-work L419 are not settled here either.
4. **The playpen holds nobody.** It is a flat mat with a safe zone over it; the baby crawls off it after a put-down like anywhere else, and the player gets no hint (ring, highlight) of where it is except the mesh. A highlight of the safe zone while carrying is a possible next step (UX has none).
5. **The bots do not carry.** `perfect`, `human`, `random` and `idle` never take the baby, so the headless sim and `--autoplay` do not exercise the carry beyond the tests. The cycle bot comes with 4.10; say if you want `random` to carry earlier.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1 (L1811-1836), Epic 4 (L388-392, L1807-1809), FR22 (L55), Stories 4.2-4.4, 4.9]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L169-171, L237, L303]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L274, L643, L886, L905-911, L965]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md L159, L215]
- [Source: _bmad-output/project-context.md (Engine rules: busy Papa, the suspicious silence, the noise gauge; Testing rules; Critical Don't-Miss Rules)]
- [Source: _bmad-output/implementation-artifacts/{1-15,1-19,1-21,1-23,3-1,3-2}-*.md; deferred-work.md L343, L346, L394, L419, L425]
- [Source: src/sim/papa/papaSystem.ts, baby/{babySystem,babyFsm,silence,approach}.ts, director/directorSystem.ts, threats/{threatFsm,threatSystem,gags}.ts, gauges/{fatigue,fatigueSystem}.ts, createSim.ts, context.ts, snapshot.ts, world.ts, events.ts, commands.ts]
- [Source: src/content/schemas/{feel,level,threat,levelGeometry}.ts, levelNodeNames.ts, loadLevelContent.ts; tools/content/contentChecks.ts, tools/sim/simReport.ts, tools/assets/exportLevel.ts]
- [Source: src/client/input/{inputMapper,hitTest}.ts, render/views/babyView.ts, ui/world/threatMarkers.ts, boot.ts, feedback/simEventFeedback.ts; src/debug/cheats.ts]
- [Source: tests/support/testContent.ts, tests/threats/threatCatalog.test.ts, tests/threats/fixtures/test_firm.json, tests/golden/*, tests/e2e/silence.spec.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-10-30 | Story created (`gds-create-story`), status `ready-for-dev`. |
