---
baseline_commit: 919942d
---

# Story 4.10: The « Chambre de nuit » level and the second prototype's playtest

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.10 (L2029-2049). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to chain the whole bedtime cycle in a night bedroom,
so that I live the evening from start to finish.

**Requirements covered:**
- **FR40 `[P2]`:** the bedtime cycle, whole, for the first time: the five sequences chained in a level of their own. GDD L299-307.

**This is the last story of Epic 4.** Its merge completes the epic, so the gate before the merge is the full `npm run ci`, not `ci:story` (CLAUDE.md › Which check, when).

**What this story is not:**
- **Not the playtest itself.** It delivers a level a tester can open and the metrics that read their journals. Running the sessions and deploying the link are Geo's calls (CLAUDE.md › Playtest deployment). The story is `done` without them.
- **No night look, no real crib, no sleeping baby:** greybox, as every level until E7. Nothing in `levelScene.ts` changes for a « night ».
- **No level menu, no unlock, no Fridge screen:** E3 `[V1]`. A URL parameter reaches the level (D7).
- **No Schrödinger diaper** (GDD L311): E5. **No suspicious silence and no phone in this room** (D6).
- **No star penalty for an unfinished cycle** (open point 3).
- **No Capacitor, no new dependency, no new top-level folder.**

**Sources:**
- Epics `epics.md` L82, L306, L389-390, L1807-1809, L1908, L1991, L2029-2049.
- GDD `gdd.md` L96, L169, L296-307, L357-360, L463, L530.
- Architecture `game-architecture.md` L496-497, L540, L643, ADR-004, ADR-009.
- UX: `DESIGN.md` L528-529; `EXPERIENCE.md` L87, L99, L208-209.
- Previous stories: `4-9-sortie-en-infiltration-reponse-ne-rien-faire.md` (**read it, review included**), `4-8`, `4-4` (D6), `4-1` T1 (how a safe zone is built in a `.blend`), `3-4` (the metrics), `3-3` (the journal).
- `deferred-work.md` L582, L618, L632, L708, L710-711, L786, L790, L794, L816-817, L840, L857: all wait for this story.
- `project-context.md`: « Special sequences », « Carrying the baby », « The combo », « The pressing need », « The bomb drop », « The stealth exit », « Two ways to end a level ».

## Acceptance Criteria

Numbers in `content/` are live starting values for Geo to tune. Tests use frozen `tests/support/` files, never the live ones (exception as in 4.9: the board placement test reads the live geometry).

### The room

1. **Any level can be a room with no salon furniture.** `REQUIRED_ANCHOR_IDS` (`src/content/levelNodeNames.ts`, and its Python twin in `tools/blender/export_level.py`) today demands the salon's `outlet_01`, `stairs_top`, `coffee_table`, `phone` and `coffee_machine` of every level, and `REQUIRED_ZONE_IDS` demands `behind_sofa`. This story blocks on it.
   - `REQUIRED_ANCHOR_IDS` becomes `papa_spawn`, `baby_spawn`, `door`. `REQUIRED_ZONE_IDS` is removed on both sides, and `tests/architecture/blenderConventions.test.ts` follows.
   - `extractLevelGeometry.ts` L406 tests the walkable distance of `behind_sofa` by name: it becomes every zone of kind `hidden`, so the salon's check does not change.
   - **This loosens no guarantee:** `content:check` already refuses a planned threat's or an object's anchor missing from the geometry (`contentChecks.ts` L1030, L1231), and so does `simLevelOf`. Prove it with a test on a level naming an anchor its geometry lacks, and cover a planned silence's zone too (add that check if it is missing, and say so).
   - `tests/architecture/levelAssets.test.ts` runs on every id in `content/levels/`, not only `DEFAULT_LEVEL_ID`.

2. **The greybox** (Blender MCP if connected, else `/Applications/Blender.app -b -P` with a throwaway script; **read the salon's `.blend` first and copy its collections, material and naming**, and 4.1's T1 for the safe zone). New `assets-src/blender/chambre_night.blend`:
   - A closed bedroom, about 6 × 5 m: `NAV_floor`, walls (`COL_wall_*`), `COL_bed`, `COL_wardrobe`, `COL_nightstand`, one `PROP_mug_01` on the nightstand.
   - **The crib:** a low visual frame and `ZONE_safe_crib`, **with an open cell at its centre** (`sequenceLayProblems` refuses a closed one, which is why a solid `COL_crib` would fail).
   - `ZONE_creak_board_01`, `_02`, `_03`: boxes with no mesh, no collider, no nav block (4.9's D10).
   - Anchors: `papa_spawn`, `baby_spawn`, `door`, `toilet`, `outlet_01`, `nightstand`. The door and the toilet are on different walls, and the toilet is not on the way from the crib to the door.
   - `npm run assets:export -- chambre_night`, `assets:extract -- chambre_night`, `assets:optimize -- chambre_night` (each script takes the id as `argv[2]`). `content/levels/chambre_night.geometry.json` and `public/assets/levels/chambre_night.glb` are committed. `dist:check`'s per-level payload stays within budget.
   - **Board placement is a test, not a judgement:** `tests/content/creakZones.test.ts` also runs on this geometry: the A* path from the crib's centre to the door crosses at least one board, and a fixed list of waypoints reaches the exit radius crossing none. Move the boards if the test says so, and record the final values.

3. **`content/levels/chambre_night.json`.** `variant: "nap"`, `durationMs: 240000` (GDD's 4 min). Starting values:

   ```json
   {
     "$schema": "../_schemas/level.schema.json",
     "id": "chambre_night",
     "variant": "nap",
     "durationMs": 240000,
     "waves": [
       { "fromMs": 0, "maxSimultaneous": 1, "gapMinMs": 4000, "gapMaxMs": 7000, "lullMs": 3000,
         "threats": [{ "def": "outlet", "anchor": "outlet_01" }] },
       { "fromMs": 60000, "maxSimultaneous": 2, "gapMinMs": 3000, "gapMaxMs": 6000, "lullMs": 3000,
         "threats": [{ "def": "coffee_table_object", "anchor": "nightstand" }] }
     ],
     "objects": [{ "id": "toilet", "kind": "toilet", "anchor": "toilet" }],
     "gauges": { "noise": {}, "fatigue": { "microSleepDef": "papa_microsleep" }, "need": {} },
     "carry": { "armsCryDef": "arms_cry" },
     "sequences": ["stay_awake", "lullaby_walk", "bedtime_duel", "bomb_drop", "stealth_exit"],
     "cycle": {
       "entries": [
         { "sequence": "stay_awake", "interludeMs": 15000 },
         { "sequence": "lullaby_walk", "interludeMs": 12000 },
         { "sequence": "bedtime_duel", "interludeMs": 12000 },
         { "sequence": "bomb_drop", "interludeMs": 6000 },
         { "sequence": "stealth_exit", "interludeMs": 0 }
       ],
       "retryInterludeMs": 8000,
       "gatherMaxMs": 6000
     },
     "feelOverrides": { "bladder": { "startPct": 30 } }
   }
   ```

   `bladder.startPct: 30` makes the need reach 100 about 175 s in (`deferred-work.md` L632), so the toilet matters in this room. Check that `feelOverrides` merges a nested key without dropping its siblings.

### The chain

4. **Schema** (`src/content/schemas/level.ts`, every key with a `.describe()`, then `npm run content:schemas`). New **optional** key `cycle` (D1). It must stay optional with no default, so `salon_crawler`'s `levelHash` does not move:

   ```ts
   cycle: { entries: { sequence: id, interludeMs: int >= 0 }[] (min 1), retryInterludeMs: int >= 0, gatherMaxMs: int > 0 }
   ```

   The `sequences` key's description, which says « a bedtime level starts them (4.10) », is updated. A shared pure `cycleProblems` in a new `src/sim/sequences/bedtimeCycle.ts`, called by `simLevelOf` and `content:check` with the same words (as `sequenceDuelProblems` is), refuses, each with a failing test:
   - an entry not listed in `level.sequences`, or listed twice in the cycle (the end hook matches by id);
   - a `durationMs` below the sum of every entry's `interludeMs` and its steps' `durationMs` (the level could not hold one clean cycle);
   - a `babyLaid` or stealth entry in a level with no open safe centre;
   - a level whose `papa_spawn` is inside the stealth step's `exitRadiusM`;
   - the guards `deferred-work.md` L857 left for this level (`sequenceStealthProblems`): the crib's centre within `exitRadiusM` of the exit, a board overlapping another board or the exit radius.

5. **World.** `world.cycle: CycleSlice`, in every level:

   ```ts
   interface CycleSlice {
     index: number;            // the entry being waited for or run; entries.length once done, 0 in a level with no cycle
     nextAt: SimMs | null;     // when the current entry is due; null with no cycle or once done
     completedAt: SimMs | null;
   }
   ```

   `createSim` sets `nextAt` to the first entry's `interludeMs`. `SimLevel` gains `cycle: SimCycle | null` (`entries` with each def resolved, `retryInterludeMs`, `gatherMaxMs`). **No draw anywhere in this story's sim code**, except the ones `takeBaby` already makes.

6. **Starting an entry** (`runCycle` in `bedtimeCycle.ts`, called by `runSequence` right after the `StartSequence` loop, while `flow.state === 'playing'`). With `now >= nextAt` and `sequenceRefusal(world) === null` (refused: wait, try again next step), in this order:
   1. **The baby (D3):** if the def is `babyCarried` and he is not carried: within `feel.carry.reachM`, `takeBaby`. Otherwise, with Papa `idle`, a walk to him with `papa.intent = 'takeBaby'`. **The sequence does not start this step.**
   2. **The crib (D3):** if the def's success is `babyLaid` or it has a stealth step, and Papa is not in a safe zone: with Papa `idle`, a walk to the nearest open safe centre, `intent: 'none'`. **The sequence does not start this step.**
   3. **Otherwise:** `startSequence`. So on the normal path `placePapaOverMattress` and the pop into the arms find nothing to do.
   4. **The cap:** at `now >= nextAt + gatherMaxMs`, `startSequence` at once, with its existing placements. So a player who keeps walking away, or a baby out of reach, can never hold the cycle up.

   Papa walking or gliding is left alone until `idle`: the sim never cuts across a command of the player. The walk helper is `tapFloor` from `papaSystem.ts`, moved to `papa/planWalk.ts` and exported (`startWalkTo`), its body unchanged. The nearest-centre search comes out of `layDown.ts` as an export, unchanged. **The salon has no cycle, so none of this runs there.**

7. **Ending an entry** (`advanceCycle`, called at the end of `succeedSequence` and `failSequence`; `sequenceEnd.ts` keeps importing no threat code). A no-op with no cycle and **when the sequence that ended is not the current entry's**, so a debug `StartSequence` moves nothing. Not called on `levelEnded`.
   - **Won:** `index + 1`; `nextAt = now + next.interludeMs`. After the last entry: `completedAt = now`, `nextAt = null`, `CycleCompleted{t}` (`SIM_EVENT_TYPES`, sorted).
   - **Lost:** same `index`, `nextAt = now + retryInterludeMs` (D4). The noise of the failure is what it costs, on top of the time.

8. **The level's end** (`flowSystem.ts`). `LevelEndReason` and `LEVEL_END_REASONS` gain `cycleDone`. In `runFlow`, after the noise and before the timer: `world.cycle.completedAt !== null` → `endLevel(…, 'cycleDone')`, in the very step the exit is reached. Order on a tie: Mama, then the cycle, then the timer. `computeMamaScore` is unchanged: `reason === 'mamaWoke'` still decides the penalty. The timer ending an unfinished cycle stays `timer`.

9. **Snapshot v27** (the type, `takeSnapshot`, the `invariant`, the history comment; **look before merging**, a parallel story may bump it). The guard checks `index` an integer between 0 and the level's entry count, `nextAt` and `completedAt` null or finite and ≥ 0, `nextAt` null when `completedAt` is set, and in a level with no cycle all at rest (4.9's review: bound by the level). Fixtures gain the keys, each rejected field has a test, and **round trips in flight**, each continued to the end on both copies with hashes and events compared: during an interlude; during a gather walk; during a retry's wait. Stale « version 26 » titles and `project-context.md` move.

### Client

10. **Reaching the level (D7).** `readDebugParams` gains `level` (`?level=<id>`, `SNAKE_ID_PATTERN`; a bad shape is ignored with one `warn`, the pattern of the others). `boot.ts` passes it to `levelSession` as `levelId`, **only where debug params are read**, so a production build still plays `DEFAULT_LEVEL_ID`. An id with no level file is ignored with one `warn` and the default plays: no Oops screen on a mistyped link. A restart and « Rejouer » stay on the level (`requested.levelId` already does this: test it). `?autoplay` and `?level` work together.

11. **What the player sees.** No new screen; each sequence already brings its framing, music and cues. New:
    - `result.cycle_done` « Il dort enfin ! » in `strings.fr.json`, shown by `resultScreen.ts` for `endReason === 'cycleDone'`, in the place and class of the mama-woke header, **without** its slam, its `pp-result-panel-woken` or its event. Nothing is shown for a `timer` end (no failure string: project rule).
    - Mirror `data-pp-cycle-index` (written on `SequenceEnded` and level start), in the reset list of a restart (4.9's review) and in `dist:check`'s markers if it enumerates them. `data-pp-end-reason` already carries `cycleDone`.
    - `threatsSwitch.ts`: `?threats=off` still plays the chain; check that the threats of the cycle's sequences survive it.

### Bots

12. **The cycle bot (D5): `perfect` and `human`, a shared helper in `threatTiming.ts`.** `planCycleDrop`: in a level with a cycle, flow `playing`, the baby carried, Papa `idle`, no threat of his up, and `world.cycle.nextAt - now >= CYCLE_DROP_MIN_LEAD_MS` (a local constant, a bot's habit and not a game number, like `tapMs`' neighbours): one `TapFloor` at the crib, so they cash in, base threats come, and the gather walks back. One tap per put-down, with a memory like `planStealthWalk`'s (4.9's review: no tap on every idle step).
    - `BotSetup` gains `safeSpot: { xM, zM } | null`, required like `releaseDefIds` and built beside it by a `safeSpotOf`; every caller follows (`tools/sim/runSim.ts`, `src/debug/autoplay.ts`, tests).
    - `random` and `idle` are unchanged. **No bot goes to the toilet** (open point 5); `deferred-work.md` L632's line is closed by the override, not by a bot.
    - The bots' draws on every other def **do not move**, and with no cycle the helper does nothing: `botContract` and a test say so.

13. **`tools/sim/simReport.ts`.** `endsByReason` gains `cycleDone` by itself. The report gains `cycleCompleted` (runs), `cycleEntriesReached` (mean) and `sequenceOutcomes: Record<id, { started, won, lost }>`. The def-id set of `sequenceDefIdsOf` already keeps the alerts out of `microSleeps`.

### `playtest:metrics`

14. **The journal.** `SummarySchema` (`src/content/schemas/journal.ts`) gains an **optional** `sequences` (D8), so a journal from the first prototype still parses and `JOURNAL_FILE_VERSION` stays 1:

    ```ts
    sequences?: { id: string; t: number; outcome: 'succeeded' | 'failed' | 'levelEnded';
                  steps: { stepIndex: int; outcome: 'passed' | 'failed' | 'cut' }[] }[]
    ```

    `gameSummary.ts` records it from events, always writing the key:
    - `SequenceStepStarted` opens an attempt at its `stepIndex`, closing the open one as `passed` **only when the new index is higher**;
    - `SequenceStepRetreated` closes the open one as `failed` (the `SequenceStepStarted` that follows opens the next, even from step 0 back to step 0);
    - `SequenceEnded` closes the open one: `succeeded` → `passed`, `failed` → `failed`, `levelEnded` → `cut`, then closes the entry.

    A sequence not ended when the summary is read cannot happen (`endLevel` closes it first): assert it with a test on a level end in mid-sequence.

15. **The tool** (`tools/playtest/computeMetrics.ts`, `renderMetrics.ts`). `PLAYTEST_REPORT_VERSION` becomes 2. The report and each tester's line gain:

    ```ts
    sequences: {
      games: number;            // the journals holding at least one sequence
      cycleCompletedGames: number; // of those, `endReason === 'cycleDone'`
      bySequence: Record<id, { attempts: number; succeeded: number; failed: number; cut: number;
                               ratePct: number | null;
                               steps: { stepIndex: number; attempts: number; passed: number; failed: number; cut: number; ratePct: number | null }[] }>;
    }
    ```

    - `ratePct` is success over `succeeded + failed` (or `passed + failed`): **a game cut by the end of the level says nothing**, so it does not count against the player. Truncated through `roundedPct`, like every other share. `bySequence` is sorted by `compareNames` (`ownValue` for ids), steps by index.
    - **Rates, no thresholds and no status** (D9): `content/playtest.json` and the five indicators do not change. A journal with no `sequences` key adds nothing and raises no warning.
    - The Markdown gains a « Séquences » section after the indicators, with one table per sequence and step, and nothing at all when no journal has a sequence.
    - `docs/playtest/observation-sheet.md` gains a short « Chambre de nuit » block: Geo notes, per sequence, whether the tester had fun, **in the existing `comment` column** (no CSV column moves), since a success rate cannot say whether a sequence with no parry is fun, which is the epic's question.

### Tests

16. **Unit tests** (next to the code, driving the real `createSim`, a frozen `tests/support/testCycle.level.json` with `testCycle.geometry.json`, copied from the live one with `cmp`), at least:
    - `src/sim/sequences/bedtimeCycle.test.ts`: the chain in order; each interlude to the ms; a retry on the same entry after each kind of failure (`gag`, `babyAwake`, `retreats` at the maximum, stealth); a refused start waits (Papa on the toilet, a hidden baby, in a test level that has one) and starts once free; **the baby walked to and taken with no jump** (Papa's and the baby's points continuous, no `SequenceStarted` before `BabyPickedUp`); Papa walked to the crib, `placePapaOverMattress` moving nothing; the player's walk not cut; the cap starting the sequence with its placements; a debug `StartSequence` of another sequence moving nothing; `CycleCompleted` and `LevelEnded{cycleDone}` in the one step; a tie with noise going to Mama and a tie with the timer going to the cycle; a timer end mid-cycle staying `timer`; **no event and no field change in a level with no cycle**; base threats telegraphed in the first interlude and, once the baby is put down, in a later one; none while he is carried.
    - `bedtimeCycleFuzz.test.ts`: 30 seeds with sensible and wild commands, **cached per seed**, requiring across seeds a completed cycle, a retry, a `mamaWoke` end and a `timer` end. No test title promises more than it checks.
    - `cycleProblems`: one failing test per rule. Snapshot: AC 9.
    - `gameSummary.test.ts`: AC 14 case by case, with a retreat from step 0 and a forward-then-back run of a duel. `computeMetrics` and `renderMetrics`: AC 15 on built journals, `cut` left out, a share truncated, an old journal, a `constructor` sequence id. `debugParams.test.ts`, `resultScreen.test.ts`, the mirror.
    - `src/sim` coverage stays at or above 90 %.

17. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level chambre_night --seed 1 --runs 20`, all four bots, live content. **`perfect` ends every run on `cycleDone`** with all five sequences won. **`idle` never does**, ending on `mamaWoke` or `timer`, and fails or never passes `stay_awake`. Say what `human` and `random` do. **Paste the table**, with `sequenceOutcomes`. `human` losing often is a finding for Geo, not a thing to tune away.
    - `npm run sim -- --bot perfect --level chambre_night --journals <dir>`, then `npm run sim:replay` on one: it ends in the same state.
    - `tests/tools/sim/cycleLevel.test.ts`: the same pin on the frozen level, `perfect` and `idle`, seeds 1 to 5.
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: **identical for all four bots** apart from hashes and the new keys at zero. Paste the table.
    - `npm run golden:update`, diff, then `biome format` the JSON. **Every existing journal moves only in `worldHash`** (a new slice; `levelHash`, `feelHash` and `geometryHash` must not move, and neither may a command or an event). Anything else is a bug: stop. New golden scenario `bedtime_cycle_won` on the frozen level, pinned by `tests/golden/bedtimeCycle.test.ts`.

18. **End to end** (`tests/e2e/chambreNight.spec.ts`, chromium + webkit, `openFrozen` where it applies, real input, values through `__PP__`).
    - `/?level=chambre_night` shows the room, with `data-pp-cycle-index="0"`; a mistyped id plays the salon and logs its `warn`.
    - `?level=chambre_night&autoplay=perfect&speed=4` reaches `data-pp-end-reason="cycleDone"`, with the five `SequenceStarted` in order in `__PP__`'s event log (`data-pp-sequence` holds only the current one) and « Il dort enfin ! » on the Result. `?autoplay=idle` never shows it.
    - **Real input in an interlude:** a tap in the crib with the baby carried cashes in (`combo_cashed_in`); the next entry walks Papa to him, with no teleport; a base threat is parried by a real tap between two sequences.
    - A failed sequence comes back after `retryInterludeMs`. The toilet: refused with the baby carried, usable once he is down. **The Copy journal button holds `summary.sequences`**, and `npm run sim:replay` accepts that file (`journal.spec.ts`'s pattern).
    - Screenshots at 667 × 375, **looked at** (the room, the crib, the door, the toilet, an interlude). No existing screenshot reference moves.
    - `tests/e2e-dist/dist.spec.ts`: one more case playing `/?level=chambre_night` on the built playtest. `perf.spec.ts` takes `PP_PERF_LEVEL` (default the salon, so CI's time does not grow); run it once by hand on `chambre_night` and **paste p95, draw calls and triangles** in the Completion Notes.

19. **Docs.** `project-context.md`: a « The bedtime cycle (story 4.10, snapshot version 27) » paragraph after 4.9's, `snapshot version 27`, and correct « Nothing schedules one in a normal level », « The bots never cash in », « No bot goes to the toilet » and the « two ways to end a level » (now three). `CLAUDE.md`: `?level=` in the autoplay row and in Playtest deployment step 5 (the second prototype's link). `deferred-work.md`: close L582, L618, L632, L708, L710, L711, L786, L816, L857; say what stays open from L754, L817, L840; add this story's open points. Do not edit the architecture or the GDD.

20. **CI.** `(unset VITE_DEBUG_ALLOWED; caffeinate -i -s npm run ci)` is green on the branch once, when `ci:fast` and the touched specs are already green: **this merge completes Epic 4.**

## Tasks / Subtasks

- [x] **T1. The room** (AC 1-3): required anchors on both sides with the proof of AC 1; the `.blend`, the export, the geometry, the board test; the level JSON **without** `cycle` first, playable through `__PP__.loadLevel`.
- [x] **T2. The chain in the sim** (AC 4-9): schema and `cycleProblems`; the slice and `runCycle`; `advanceCycle`; `cycleDone`; snapshot v27; `bedtimeCycle.test.ts` on a frozen level, then `cycle` in the live JSON.
- [x] **T3. Bots and tools** (AC 12-13, 17): the helper, `safeSpot`, the report, the tables, the goldens.
- [x] **T4. Client** (AC 10-11): `?level=`, the Result header, the mirror.
- [x] **T5. Metrics** (AC 14-15): the journal's `sequences`, the tool, the sheet.
- [x] **T6. End to end, docs, CI** (AC 16, 18-20): the fuzz, the specs, the perf reading, the docs, `npm run ci`.

## Dev Notes

### Decisions (D1-D9)

- **D1. `cycle` in the level, with the chain in the sim.** The cycle is a game rule, it must run headless, and it must replay from a journal with no new command (`StartSequence` stays the debug twin). So the sim starts the entries itself, and the journal is unchanged.
- **D2. A sequence is due on a clock, not on a trigger the player must find.** `interludeMs` after the previous end. A player who does nothing still gets the next sequence and fails it, so `idle` has an honest ending and nothing can hang.
- **D3. The gather: the sim walks Papa, instead of a pop.** 4.4's D6 and 4.8's D3 teleport because a debug start has no way to walk there; `deferred-work.md` L708 and L816 leave that to this story. The cap keeps the promise that nothing hangs, and only then may the old pop show.
- **D4. A failure retries the same entry,** after `retryInterludeMs`. The epic's « séquences ratées » gives the ending and leaves the rule open; the GDD's « tout est à refaire » is about the diaper (E5). The costs are time against the 4 min, and noise. Open point 1.
- **D5. « Menaces de base entre les séquences » depends on the baby being down.** The director draws nothing while he is carried (`directorSystem.ts` L101), and all four first sequences end with him in the arms. **No rule is added:** an interlude holds what the player chose. Carry on and climb the combo (with the cry in the arms, the micro-sleeps and double fatigue), or put him in the crib to cash in, then face the base threats and fetch him again. That is GDD L169's trade, and the first interlude always has the baby free. The cycle bot exists so the headless runs prove this path. Open point 2.
- **D6. No silence and no phone here.** Both block `sequenceRefusal`, so one would delay the chain by up to `findMaxMs`, and a bedroom needs neither to test the epic's question. `cycleProblems` does not forbid them, and `runCycle` waits correctly if a later level has them (tested).
- **D7. `?level=<id>`, in dev and playtest builds only.** The prototype has no menu, and one is E3 `[V1]`. A link is how testers already receive the game (FR67), and the playtest build is what they get. The production build still has one level.
- **D8. The journal carries the attempts, rather than the tool replaying them.** `sim:replay` could rebuild them, but only with matching content, and testers' journals cross versions (a different content hash is only a warning). The summary is what 3.4's tool already reads. Optional, so the first prototype's journals stay valid.
- **D9. Rates, no thresholds.** The epic asks to « ajouter le taux ». NFR11's five indicators have thresholds and this has none in any document: inventing one would turn a reading into a verdict. The question « is it fun » goes to Geo's notes (AC 15).

### Current state of the files this story changes (read before editing; lines at `919942d`)

- **`src/sim/sequences/sequenceSystem.ts`:** the loop L27-30 runs commands, then returns unless in a sequence. `runCycle` goes between them. **`sequenceStart.ts`:** `sequenceRefusal` L31, `startSequence` L60; its placements L72-80 stay, for the debug start and the cap. **`sequenceEnd.ts`:** `succeedSequence` L74, `failSequence` L86, `resumeAfterSequence` L63, all three kept in that order with `advanceCycle` last; `endSequenceForLevelEnd` must not call it.
- **`src/sim/flow/flowSystem.ts`:** `runFlow` L39, the noise first, the timer last. `endLevel` L19 is unchanged.
- **`src/sim/papa/papaSystem.ts`:** private `tapFloor` L27 (to move); `tapBaby` L107 and `arrive` L137 show `intent`. A gather walk sets `intent` **after** the plan, as `tapBaby` L118 does, since the helper clears it.
- **`src/sim/sequences/layDown.ts`:** the nearest-centre search. **`src/sim/director/directorSystem.ts`:** L46-49 (suspended in a sequence), L101 (carried). Neither needs a behaviour change.
- **`src/sim/createSim.ts`:** `simLevelOf`. **`src/sim/snapshot.ts`:** L43, L62, L1263 for the version.
- **`src/content/levelNodeNames.ts`** L30-42, **`tools/blender/export_level.py`** L24-34, L109-113, **`tools/assets/extractLevelGeometry.ts`** L371-378, L406, **`tests/tools/assets/extractLevelGeometry.test.ts`** L75, L109, L216, **`tests/architecture/blenderConventions.test.ts`** L46.
- **`src/content/schemas/level.ts`:** `LevelSchema`; **`src/content/loadLevelContent.ts`** reads the sequences a level lists, so `cycle` adds no load. The client's content comes through `import.meta.glob` (`src/client/assets/browserContentSource.ts`, `loadLevelAssets.ts`), so a new file ships by itself; **`tools/build/checkDist.ts`** L79 lists levels from the folder. Check `dist:check`'s prod flavor still passes with the second level.
- **`src/client/app/debugParams.ts`** (the pattern), **`boot.ts`** L259-262 (where it is read), **`levelSession.ts`** L68, L272 (`levelId`). **`src/client/ui/screens/resultScreen.ts`** L177-182.
- **`src/client/telemetry/gameSummary.ts`:** the `switch` in `onEvent`. **`tools/playtest/computeMetrics.ts`:** `analyseTester` L233 and `computeMetrics` L369; `roundedPct` L133, `ownValue` L138.
- **`src/bots/threatTiming.ts`:** `planStealthWalk` L236 is the model. **`src/bots/bot.ts`:** `BotSetup`. **`src/bots/perfectBot.ts`, `humanBot.ts`:** one call beside `planStealthWalk`.
- **Must not change:** every sequence def and threat def in `content/`, `judgePress`, `classifyPress`, the step handlers (`DUEL_HANDLER`, `BEATS_HANDLER`, `STEALTH_HANDLER`), `computeMamaScore`, `content/playtest.json`, `tokens.css`, `HUD_MAX_DOM_NODES`, `salon_crawler.json` and its geometry, the rng draws of any existing path.

### What must keep working

- **A level with no cycle sees nothing new:** no event, no draw, no walk. AC 17's salon table and the hash-only goldens are the proof.
- **The debug start of any sequence** (overlay, `__PP__.send`, `--sequence`) still works in both levels, with its placements and its pop. All 4.4-4.9 specs stay green, and they run on the salon.
- **The Result screen's mama-woke flow,** and `simReport`'s reasons.
- **The stealth step** in a chain: `creakZoneIndex` set on `enter`, Papa never creaks for where he starts, the mapper's `floorFinger` and `breathHolder` forgotten when a step ends (4.9's review patched exactly this for the chain).
- **`?threats=off`** and the e2e that lean on it.

### Traps

- **`isBabyJustLaid` runs in `runPapa`,** so in the step `bomb_drop` ends the baby is still carried when `runSequence` has passed. `stealth_exit`'s `interludeMs: 0` is due the **next** step, when he is down and in the crib. A test must pin that no gather walk fires between them, and that the baby does not crawl out first.
- **After `bomb_drop` the baby is free**, so any positive interlude lets him crawl from the crib, and `placeBabyForStealth` would then teleport him back. That is why the entry is 0. On a stealth **retry** that teleport does show (open point 1).
- **A walk to a tap in a safe zone puts the baby down;** the gather's walk to the crib must keep `intent: 'none'`, or it undoes itself. A player's own tap there does put him down, and the gather then fetches him: correct, and tested.
- **`resumeAfterSequence` pushes clocks by `resumeGapMs`** (2 s): an interlude shorter than that has no threat in it, by design.
- **Fatigue suspends during a sequence** and doubles while carried, so a player who never puts him down arrives tired: fine, and worth watching.
- **`LEVEL_END_REASONS` is a typed list:** `simReport` adds the key itself, and every test pinning a whole report needs the new zero (`tests/tools/sim/simReport.test.ts` L246, L249).
- **`BotSetup.safeSpot` is required,** so a dozen test files that build a setup follow (`grep -rl "releaseDefIds:" src tools tests`). Pass `null` there.
- **The worktree guard** refuses compound shell commands that name `git`, commands whose option position holds a shell variable, heredocs appended to a file and `xargs sed`. Use plain commands and the edit tools.
- **`VITE_DEBUG_ALLOWED=false` may be exported in the shell** (it was not at this story's creation): check `env | grep VITE_`, and run as `(unset VITE_DEBUG_ALLOWED; …)`.
- **The Mac sleeps during background runs:** long runs under `caffeinate -i -s`. A 30 s timeout failing after minutes means it slept.

### Architecture compliance

- Pure sim, serialisable `World`, no real time, no log, `world.rng` only. `bedtimeCycle.ts` is a helper called by `runSequence`: systems do not call each other. `runCycle` importing `sequenceStart.ts` and `advanceCycle` being imported by `sequenceEnd.ts` must not make a cycle: **put `advanceCycle` where it imports neither** (only `world`, `context`, and the sim's events), and `runCycle` where it may import both. A file split is fine.
- Units: `interludeMs`, `retryInterludeMs`, `gatherMaxMs`, `xM`. Events past tense (`CycleCompleted`). Content ids `lower_snake_case`, matching the file name. Strings in `strings.fr.json`, read through `t(key)`.
- ADR-009: the sim reads `chambre_night.geometry.json`, never the `.glb`. ADR-004: the chain replays from the journal with no new command.
- Bots import `@sim` only; `safeSpot` is handed to them, as `releaseDefIds` is.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned, and Blender 5.2.3 and its export script are already in use, so no web research was needed. `/Applications/Blender.app` is installed, so the `-b -P` route works without Geo. The Blender MCP needs Blender open with its add-on: this was not checked when the story was written, so try it and fall back.

### File structure

New: `assets-src/blender/chambre_night.blend`, `public/assets/levels/chambre_night.glb`, `content/levels/chambre_night{,.geometry}.json`; `src/sim/sequences/bedtimeCycle.ts` and its tests (`bedtimeCycle`, `bedtimeCycleFuzz`, a snapshot test); `tests/support/testCycle.{level,geometry}.json`; `tests/tools/sim/cycleLevel.test.ts`; `tests/golden/bedtimeCycle.test.ts` and its journals; `tests/e2e/chambreNight.spec.ts`.

Updated: `content/_schemas/level.schema.json`, `content/strings.fr.json`; `src/content/levelNodeNames.ts`, `src/content/schemas/{level,journal}.ts`; `src/sim/{world,events,createSim,snapshot,index,context}.ts`, `src/sim/sequences/{sequenceSystem,sequenceEnd,layDown,stealthExit}.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/papa/{papaSystem,planWalk}.ts`; `src/bots/{bot,botResponses,threatTiming,perfectBot,humanBot}.ts`; `src/client/app/debugParams.ts`, `src/client/boot.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/telemetry/gameSummary.ts`; `src/debug/autoplay.ts`; `tools/blender/export_level.py`, `tools/assets/extractLevelGeometry.ts`, `tools/content/contentChecks.ts`, `tools/sim/{runSim,simReport}.ts`, `tools/playtest/{computeMetrics,renderMetrics}.ts`; tests next to each, `tests/architecture/{blenderConventions,levelAssets}.test.ts`, `tests/content/creakZones.test.ts`, `tests/tools/assets/extractLevelGeometry.test.ts`, `tests/golden/*`, `tests/e2e-dist/{dist,perf}.spec.ts`; docs: `docs/playtest/observation-sheet.md`, `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml}`.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({…})` and `stepN`. `STEP_MS` from `@shared/constants`, never a literal. `createSimWithSystems` **replaces** the system list: use `[...SYSTEMS, spy]`.
- `simPurity` refuses the identifier `window` in `src/sim`.
- `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/chambreNight.spec.ts tests/e2e/sequence.spec.ts tests/e2e/stealthExit.spec.ts tests/e2e/bombDrop.spec.ts tests/e2e/carry.spec.ts tests/e2e/result.spec.ts tests/e2e/journal.spec.ts tests/e2e/autoplay.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- On WebKit, wait 3 frames after each `advanceTo` before a real input. `waitFrames` before asserting something absent, or it holds in the initial state too.
- `botContract.test.ts` can time out at 5 s under load: it passes alone; rerun with `VITEST_MAX_WORKERS=5` and say so. A whole-level `perfect` run takes longer than the 5 s default: give those tests a timeout, as 4.9 had to.

### Previous story intelligence (4.8, 4.9)

- **Their reviews found, and this story must not repeat:** vacuous assertions (`>= 0`) under a title that promises more; a mirror missing from the restart reset list; a bot re-sending a command every idle step; a snapshot guard not bounded by the level; a stale client holder surviving a step's end; a File List that omitted files.
- **4.9's review already patched the mapper for this story** (« a stale holder would stop a chained second stealth step (4.10) »). Trust it, and test the chain.
- **4.9's board placement moved when its test ran.** Expect the same.
- **`content:check` names clips and cues strictly.** This story adds none, if it reuses the sequences' cues as planned; say so if that changes.
- **A new threat instance moves only `random`.** The salon gains none here, so `random` must not move on it at all. If it does, something is wrong.
- **Biome folds a `let` it sees assigned nowhere into a `const`:** an edit that failed to apply can quietly turn a drawn value into a constant.

### Git intelligence

Last merged: 4.9 (`919942d`), with the lighter CI of 2026-11-01. Commit convention: « Story 4.10 : <titre> », « Story 4.10 : corrections de la revue de code ». This branch is `story/4-10-niveau-chambre-de-nuit-et-playtest-du-deuxieme-prototype`, in its worktree, with `npm ci` already done. `main` receives the merge only after a green `npm run ci` and Geo's OK.

### Project Structure Notes

Paths follow the architecture (`src/sim/sequences/`, `content/levels/`, `assets-src/blender/`). Variances, each deliberate:
- **The architecture's `flow/levelFlow.ts` is not created:** `flowSystem.ts` holds the flow today, and `cycleDone` is one more exit in it.
- **`REQUIRED_ANCHOR_IDS` shrinks** (AC 1): the list was written when one level existed, and no second room can satisfy it honestly (a bedroom with a coffee machine and a staircase).
- **The timer's meaning** (`EXPERIENCE.md` L208) is unchanged: in this `nap`, it is Mama's sleep. Finishing the cycle ends the level early.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 12, 17); anything Geo might tweak is data (`cycle` in the level, `feelOverrides`).
- Layer rules; the sim never logs; I/O returns `Result`; no silent `catch`, every fallback logs a `warn` (AC 10's fallback).
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes. The player never reads that they failed.
- Input handlers do almost nothing; this story adds none.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened (AC 1 proves its loosening is safe).

### Open points for Geo (tune or decide after playing)

1. **A failed sequence retries itself** (D4), and a failed infiltration shows the baby back in the crib. Going back to the lullaby would be truer to life and much harsher.
2. **Base threats between sequences only come with the baby down** (D5). A player who keeps him in the arms meets only the cry and the micro-sleeps. This is the decision most worth playing.
3. **An unfinished cycle costs no stars.** A good player out of time can get a high note. A penalty would be one `feel.mama` number, using the mechanism a woken Mama already has.
4. **The level reaches the Result the instant Papa is at the door,** with no breath of relief. E7's end sequence may want one.
5. **No bot goes to the toilet,** so the tables say nothing of that trade. Only playing does.
6. **The boards still creak only in the infiltration** (4.9's D9). Everywhere in the bedroom is a one-line change.
7. **Papa does not walk during the 100 pas** (`deferred-work.md` L754). It stays open.
8. **Starting values are guesses:** interludes of 15, 12, 12, 6 and 0 s, 8 s before a retry, 4 min. The interlude lengths set how much base play the evening has.
9. **The room has no night look** until E7. Only the name says it is night.
10. **« Il dort enfin ! » is my wording.**

### References

- [Source: _bmad-output/planning-artifacts/epics.md L82, L306, L389-390, L1807-1809, L1908, L1991, L2029-2049]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L96, L169, L296-307, L357-360, L463, L530]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L496-497, L540, L643, ADR-004, ADR-009]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md L528-529; EXPERIENCE.md L87, L99, L208-209]
- [Source: _bmad-output/project-context.md (Special sequences, Carrying the baby, The combo, The pressing need, The bomb drop, The stealth exit, Two ways to end a level)]
- [Source: _bmad-output/implementation-artifacts/4-1, 4-4, 4-8, 4-9, 3-3, 3-4; deferred-work.md L582, L618, L632, L708, L710-711, L754, L786, L790, L794, L816-817, L840, L857]
- [Source: src/sim/sequences/*, src/sim/flow/flowSystem.ts, src/sim/papa/papaSystem.ts, src/sim/director/directorSystem.ts, src/content/schemas/{level,journal}.ts, src/content/levelNodeNames.ts, src/client/telemetry/gameSummary.ts, src/client/app/debugParams.ts, src/client/ui/screens/resultScreen.ts, src/bots/*, tools/assets/*, tools/blender/export_level.py, tools/playtest/*, tools/sim/*]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`)

### Debug Log References

- The first `npm run sim` baseline of the salon was run from the main checkout (read-only, `--out` to the session's scratchpad), because the branch cannot hold `main`'s code. It wrote nothing there as far as the command goes; the worktree guard refuses a `git status` of that checkout, so this was not re-verified with git. The session then went back to this worktree.
- 139 unit tests went red midway, for three causes, all fixtures: `threatCatalog` picked the bedroom's `nightstand` for a def it plays in the salon (it now keeps anchors and zones of the frozen room), the dist fixture lacked the new marker, and two hand-built bot worlds lacked `cycle`.
- `bedtimeCycleFuzz.test.ts` moved from `src/sim/sequences/` to `tests/bots/`: Biome's layer rule refuses a `src/sim` test importing `@bots`. The guardrail was not touched.

### Completion Notes List

**Done:** every task, and every AC except 20, which this workflow leaves to the review on purpose (see below).

**AC 20 and the WebKit and CI gates are NOT run in dev-story.** The project's dev-story rule says not to run `npm run ci` or `ci:story` here whatever the acceptance criteria say. This merge completes Epic 4, so **the review must run the full `npm run ci` before the merge**. Run here instead: `ci:fast` green (7,400+ unit tests); the 9 touched e2e spec files on Chromium (97 passed); `chambreNight.spec.ts` on WebKit too (7 passed); `dist:check` on both flavours; the dist specs on the built playtest on Chromium (6 passed); `src/sim` coverage 98 % statements, 96.18 % branches, 100 % functions, 99.62 % lines (no threshold failure).

**Goldens (deliberate).** `npm run golden:update`: 25 `.expected.json` files moved, **only in `worldHash`** (the new slice); checked with a diff filtered on that key, which left no other line. No journal, command or event moved. New scenario `bedtime_cycle_won` (the frozen bedroom, played by the perfect bot: `Scenario` gains `geometry` and `createBot`), pinned by `tests/golden/bedtimeCycle.test.ts`. No screenshot reference moved.

**`chambre_night`, live content, seed 1, 20 runs per bot:**

| Bot | timer | mamaWoke | cycleDone | Mean entries | Cash-ins | stay_awake (s/w/l) | lullaby_walk | bedtime_duel | bomb_drop | stealth_exit |
|---|---|---|---|---|---|---|---|---|---|---|
| perfect | 0 | 0 | **20** | 5 | 80 | 20/20/0 | 20/20/0 | 20/20/0 | 20/20/0 | 20/20/0 |
| human | 0 | 0 | 20 | 5 | 80 | 20/20/0 | 20/20/0 | 21/20/1 | 20/20/0 | 20/20/0 |
| random | 0 | 20 | 0 | 0 | 0 | 248/0/248 | – | – | – | – |
| idle | 0 | 20 | 0 | 0 | 0 | 240/0/240 | – | – | – | – |

(s/w/l: started, won, lost.) **`perfect` ends every run on `cycleDone`; `idle` never does**, and never passes `stay_awake`: it snores until Mama wakes. `random` is the same: it fails `stay_awake` and wakes Mama. **`human` losing almost nothing is a finding, not a verdict:** this bot never falls for a feint and aims with a small jitter, so it says nothing of how hard the evening is for a person. Only playing does.

`npm run sim -- --bot perfect --level chambre_night --seed 7 --runs 1 --journals <dir>`, then `npm run sim:replay` on it: « replay matches », exit 0.

**`salon_crawler`, `main` against the branch, seed 1, 20 runs:** identical for all four bots once hashes and the new keys at zero are set aside (compared by a script over the whole JSON reports).

| Bot | `main` vs branch | Ends | cycleCompleted | sequenceOutcomes |
|---|---|---|---|---|
| perfect | identical | 20 timer | 0 | none |
| human | identical | 20 timer | 0 | none |
| random | identical | 20 timer | 0 | none |
| idle | identical | 20 timer | 0 | none |

**Perf, by hand, `PP_PERF_LEVEL=chambre_night`, built playtest, Chromium, speed 1:** 12,095 frames, **p95 16.8 ms** (mean 16.68, max 100.0), **35 draw calls** at most, **1,748 triangles** at most. Budgets: 20 ms, 100, 100k. Level payload 853.4 KiB (`.glb` plus audio), budget 3 MiB.

**The room.** Greybox built headless with a throwaway script from the salon's `.blend` (same collections and materials; the crib is the playpen's mesh, renamed). Final boards, in Blender coordinates: `board_01` (-0.6, -0.6), `board_02` (0.35, 0.35), `board_03` (1.3, 0.7). They moved twice, as 4.9's did: first because `board_03` reached into the exit radius, then because the grid closes the wardrobe's side up to x = 2.0, which left no clean corridor. `creakZones.test.ts` runs on both live rooms. Screenshots at 667 x 375 and 844 x 390 were looked at: the room, crib, door and toilet read; see the note on the verb below.

**Decisions taken while implementing:**
- **The whole of `runCycle` waits while Papa is not `idle`,** not only the gather: AC 6's step 3 alone would have cut across a player's walk when nothing is left to gather, which the same AC forbids. The cap still bounds it.
- **`advanceCycle` lives in `sequences/cycleEnd.ts`,** as the story allows, so that `sequenceEnd.ts` imports no threat code.
- **The snapshot guard is stricter than AC 9 asks:** `completedAt` set exactly once past the last entry, and `nextAt` null exactly then. `flowProblem` also had to accept an early `ended` with the cycle done.
- **`LevelGeometrySchema` dropped its required zone too:** the story names the two constants' other users, not this one, but it read the same list.
- **`StartedLevel` gains `geometry`,** which the autoplay needs for `safeSpotOf`.
- **The planned silence's zone was already checked** by `content:check` and `simLevelOf`, so nothing was added; `checkCycle.test.ts` proves it, with the anchor and object cases.
- **`CYCLE_DROP_MIN_LEAD_MS` is 5,000,** so the bot also drops in the 6 s before `bomb_drop`. It keeps one tap per interlude: 3 taps a game, plus the drop's own cash-in.

**For Geo:** the open points are in `deferred-work.md`. One is new: at 844 x 390 the outlet's verb can sit over the toilet's marker, both being on the left wall, for the length of a telegraph.

### File List

New:
- `assets-src/blender/chambre_night.blend`
- `public/assets/levels/chambre_night.glb`
- `content/levels/chambre_night.json`, `content/levels/chambre_night.geometry.json`
- `src/sim/sequences/bedtimeCycle.ts`, `bedtimeCycle.test.ts`, `cycleEnd.ts`, `cycleSnapshot.test.ts`
- `tests/support/cycleSupport.ts`, `testCycle.level.json`, `testCycle.geometry.json`
- `tests/bots/bedtimeCycleFuzz.test.ts`
- `tests/content/checkCycle.test.ts`
- `tests/e2e/chambreNight.spec.ts`
- `tests/golden/bedtimeCycle.test.ts`, `tests/golden/journals/bedtime_cycle_won.json`, `bedtime_cycle_won.expected.json`
- `tests/tools/playtest/sequenceMetrics.test.ts`
- `tests/tools/sim/cycleLevel.test.ts`

Modified, docs and data:
- `CLAUDE.md`, `docs/playtest/observation-sheet.md`
- `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml}`, this story
- `content/_schemas/level.schema.json`, `content/strings.fr.json`

Modified, source:
- `src/bots/{bot,botResponses,humanBot,perfectBot,threatTiming}.ts`
- `src/client/boot.ts`, `src/client/app/{debugParams,levelSession}.ts`, `src/client/assets/browserContentSource.ts`, `src/client/telemetry/gameSummary.ts`, `src/client/ui/screens/resultScreen.ts`
- `src/content/levelNodeNames.ts`, `src/content/schemas/{journal,level,levelGeometry}.ts`
- `src/debug/autoplay.ts`
- `src/sim/{context,createSim,events,index,snapshot,world}.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/papa/{papaSystem,planWalk}.ts`, `src/sim/sequences/{layDown,sequenceEnd,sequenceSystem}.ts`
- `tools/assets/extractLevelGeometry.ts`, `tools/blender/export_level.py`, `tools/build/inspectDist.ts`, `tools/content/contentChecks.ts`, `tools/playtest/{computeMetrics,renderMetrics}.ts`, `tools/sim/{runSim,simReport}.ts`

Modified, tests:
- `src/client/app/{debugParams,levelSession,threatsSwitch}.test.ts`, `src/client/telemetry/gameSummary.test.ts`, `src/client/ui/screens/resultScreen.test.ts`
- `src/content/levelNodeNames.test.ts`, `src/content/schemas/levelGeometry.test.ts`
- `src/debug/{autoplay,feelPanel,testApi}.test.ts`
- `src/sim/{events,snapshot}.test.ts`, `src/sim/threats/inputLag.test.ts`, `src/sim/sequences/{bombDropSnapshot,duelSnapshot,fakeSleepSnapshot,sequenceSnapshot}.test.ts`
- `tests/architecture/{blenderConventions,levelAssets}.test.ts`
- `tests/bots/{beatBots,botContract,instinct,silenceBots}.test.ts`
- `tests/content/{checkContent,creakZones}.test.ts`
- `tests/e2e/support/game.ts`, `tests/e2e-dist/{dist,perf}.spec.ts`
- `tests/golden/{golden.test,scenarios}.ts`, `tests/golden/journals/*.expected.json` (25 files, `worldHash` only)
- `tests/support/botSupport.ts`, `tests/threats/threatCatalog.test.ts`
- `tests/tools/assets/extractLevelGeometry.test.ts`, `tests/tools/build/checkDist.test.ts`
- `tests/tools/playtest/{computeMetrics,playtestMetrics,renderMetrics}.test.ts`
- `tests/tools/sim/{journalReplay,mamaScore,microSleep,phone,playGame,runSim,silence,simReport}.test.ts`

## Change Log

| Date | Change |
|---|---|
| 2026-11-01 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
| 2026-11-01 | Story implemented (`gds-dev-story`), status `review`. The bedroom, the chain in the sim (snapshot v27), the cycle bot, `?level=`, the journal's sequences and `playtest:metrics` report v2. Goldens regenerated (`worldHash` only). The full `npm run ci` is left to the review. |
