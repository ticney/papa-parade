# Story 4.8: The bomb drop

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.8 « Dépose-bombe » (L1980-2000). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to lay the sleeping baby on the mattress the way you defuse a bomb,
so that I live the epic slow motion of the tensest moment of the evening.

**Requirements covered:**
- **FR40 `[P2]`:** « Dépose-bombe : au ralenti ». GDD L306: « Musique de thriller, sueur au front, ralenti épique : poser 4 kilos de bébé sur un matelas ».
- **FR23 (already built, 4.2):** the combo is cashed in when the baby is laid in a safe place. This story calls the existing `putDownBaby`.

**What this story is not:**
- **Story 1.23 is `done`** (`sprint-status.yaml` L74), so the epic's third criterion asks for nothing: no Firmness work beyond the variant below.
- **No new step kind, no new world slice, no new command.** It is one `duel` step whose threat is a Firmness judged on its release (D1). `HoldAnywhere` is 4.9's.
- **No `chambre_night` level, no crib, no chain of sequences:** 4.10. Before it, the playpen of the salon is the mattress.
- **No cycle bot:** the bots play the sequence, but nothing walks them to it (4.10).
- **No real baby or sweat art:** E7. Placeholder glyphs, clips and a lowered baby.

**Sources:**
- Epics `epics.md` L1807-1809, L1980-2000, L2041.
- GDD `gdd.md` L133 (Fermeté), L169 (the drop is where the combo is cashed), L171 (one hand while carrying), L216 (sequence gags are priced with E4), L306, L308.
- Architecture `game-architecture.md` L222, L643 (`ZONE_safe_*`), L732, L968.
- UX: `DESIGN.md` L536 (hold-ring), L529 (sequence-bar, unused here); `EXPERIENCE.md` L209.
- Previous stories: `4-6-duel-du-coucher-reponse-attendre.md` and `4-7-faux-sommeil.md` (**read both, reviews included**); `4-2-combo-a-encaisser.md` for the cash-in; `1-23-fermete-optionnelle.md` for the hold.
- `project-context.md`: « Carrying the baby », « The combo », « Special sequences », « The Wait response and the bedtime duel », « The fake sleep ».

## Acceptance Criteria

Numbers in `content/` are live starting values for Geo to tune. Tests use frozen `tests/support/` files, never the live ones.

### The Firmness judged on its release

1. **Schema** (`src/content/schemas/threat.ts`, every key with a `.describe()`, then `npm run content:schemas`). New optional key on `baseShape`:

   ```ts
   release: z.strictObject({
     pressWithinMs, // .int().positive(): how long after the telegraph the press may come, sim ms
   }).optional()
   ```

   Rules (`superRefine`, one issue per path):
   - `release` only on a `firm` def.
   - A `firm` def has exactly one of `holdUntilMs` and `release` (`holdUntilMs` stays required on any other `firm`).
   - `telegraphDelayMs` must be a number, and `release.pressWithinMs < telegraphDelayMs`: the press always comes before the final pose.
   - `signalVerbKey`, `signalIcon` and `feedback.signal` are **required on a `release` def** and still refused on any other non-`wait` def. `minDelayMs` and `maxDelayMs` stay `wait`-only, so split the `waitKeys` loop (L246).
   - `THREAT_ICONS` gains `sweat` and `open_hand`, with paths in `THREAT_ICON_PATHS` (a compile error otherwise).
   - Tests: `tests/content/bombDropSchema.test.ts`, each refusal on its path.

2. **Timeline: one clock, no draw.** The descent **is** the telegraph: `telegraphDelayMs` is the descent's duration (the epic's « durée dans le JSON »), `windowOpenAt` is the final pose, and `responseWindow` is the window of the release. The press does not start any clock.
   - `telegraphThreat`: on a `release` def, `responseWindow.bufferMs = 0` (the precedent is `moveJudgeCursor`, `lullabyWalk.ts`): a buffer would keep a release that came too early. No `nextFloat`: **the rng stream of every other def is unchanged.**
   - `openWindow`: emits `WaitSignalGiven` when `def.feedback.signal !== undefined`, not when `response === 'wait'`. A `parry` or plain `firm` still emits nothing. Update the event's comment: it is « the signal », for both.

3. **Judgement** (`threatSystem.ts`).
   - `pressThreat`: a `release` branch **first**. A press with `t <= threat.enteredAt + pressWithinMs + toleranceMs` in `telegraph` sets `threat.press` (`quality: 'success'`, `offsetMs: 0`; neither is read); anything later is `gagThreat(…, 'late', …)`. `enteredAt` is the telegraph's start while in `telegraph`, and `pressWithinMs < telegraphDelayMs` means a press in `windowOpen` is always late. `earlyPress` is not read.
   - In the per-instance loop, inside `press !== null`, a `release` branch **before** the carried Firmness gag at L130, in both `telegraph` and `windowOpen`, keeping the `ResponseHeld` above it (the ring closes as for any hold):
     - With `releasedAt` set: `judgePress(releasedAt, threat.windowOpenAt, responseWindow)`. `early` is `gagThreat(…, 'released', offsetMs)`, `late` is `gagThreat(…, 'late', offsetMs)`, otherwise `resolveThreat(…, quality, offsetMs)`. **Judged on the release's own `t`.** A quick tap is thus a `released` gag, not a `wrongResponse`.
     - With no release: `now > windowOpenAt + windowMs + toleranceMs + lagMs` is `gagThreat(…, 'late', null)`. **`firmHoldOutcome` must not run on this def**: it resolves a held Firmness with no release, and holding through the pose would win.
   - No press at all: with `press === null`, `threat.state === 'telegraph'` and `now > enteredAt + pressWithinMs + toleranceMs + lagMs`, `gagThreat(…, 'late', null)`.
   - **The carried Firmness rule (GDD L171, story 4.1) stays for every def without `release`.** Laying the baby takes both hands: that is the point of the moment. A `firm` def with `holdUntilMs` while carried is still a `wrongResponse`, and a test says so.
   - `pressKindOf`, `judgePress`, `classifyPress`, `firmHoldOutcome`, `holdEndAt`, `effectiveWindow` do not change.

4. **Duel checks** (`bedtimeDuel.ts`, `sequenceDuelProblems`). A step's threat is accepted when it is a `wait` **or a `firm` with `release`**; the shape `DuelThreatShape` gains `release?`. `neededMs` needs no new term: the descent is `telegraphDelayMs`, already counted, and `isJudgeableBeforeEnd` counts it too. A test for the refusal of a plain `firm`. Update `DuelStepSchema`'s descriptions, and the now-wrong comments: `sequence.ts` « 4.8 lifts this for its own kind » and `sequenceSteps.ts` L17 « 4.8's after it ».

### The sequence

5. **Slow motion.** `DuelStepSchema` gains optional `slowMo: { timeScale, returnMs }` (`timeScale` above 0 and below 1; `returnMs` an int ≥ 0).
   - `SlowMoSource` and `SLOW_MO_SOURCES` gain `sequence`.
   - `DUEL_HANDLER.tick`, right after `telegraphThreat`: with `step.slowMo`, `startSlowMo(world, ctx, 'sequence', {timeScale, returnMs, durationMs})`, where `durationMs` is computed from the frozen values: `threat.windowOpenAt - now + responseWindow.windowMs + responseWindow.toleranceMs + world.input.lagMs`. So it covers the whole descent, the pose and no more, whatever the tier.
   - New `endSlowMo(world, ctx, source)` in `time/slowMo.ts`: for a running one, `holdUntil = min(holdUntil, now)`, `endsAt = min(endsAt, now + returnMs)` (keep what remains of the return), then `updateTimeScale`. A no-op if none runs. Needs `returnMs`: read it from the slow-mo as `endsAt - holdUntil` before writing.
   - `goToSequenceStep` and `closeSequence` call it, so a gag does not keep the world in slow motion through the rest, and a level end closes it. `slowMo.ts` imports no threat code, so `sequenceEnd.ts` keeps its rule.
   - The existing overlap rule applies (the perfect's slow-mo at the release stacks; the slowest wins).
   - **A `duel` with no `slowMo` draws, times and emits exactly as today**: `bedtime_duel` journals move in nothing but their hash.

6. **A new success: the baby is laid.** `SEQUENCE_SUCCESS_KINDS` gains `babyLaid` (schema: it needs `babyCarried: true` and a `retreats` failure; test each refusal). It runs like `stepsDone`, and also:
   - **Start: Papa is placed over the mattress.** In `startSequence`, after `stopPapa` and before `takeBaby`: if `isInSafeZone(ctx, papa.xM, papa.zM)` is false, Papa's point moves to the centre of the nearest safe zone (squared distances, ties to the first listed, no allocation, no event, no draw). See D3. `simLevelOf` and `content:check` refuse a level that plans a `babyLaid` sequence when **every** safe zone's centre is on a closed nav cell, or that has no `carry` (same words, shared pure function, as `sequenceDuelProblems`). The nearest-zone search considers only zones with an open centre.
   - **End: the baby goes down and the combo is cashed.** `carry.ts` imports `threatFsm`, which imports `sequenceEnd`, so **`sequenceEnd.ts` must not call `putDownBaby`** (a cycle). `runPapa` runs after `runThreats`, in the same step: at its top, when `world.sequence.endedAt === now`, the `lastId` def's success is `babyLaid`, the baby is carried and this step's `SequenceEnded` says `succeeded` (scan `ctx.events` from the end while `t === now`, the rule of `runNoise`), call `putDownBaby`. So one step holds: `ResponseResolved`, `SequenceEnded{succeeded}`, `BabyStateChanged`, `BabyPutDown{safe: true}`, `ComboCashedIn`, `ComboChanged{cashIn}`. Pin this order in a test.
   - The response is +1 on the multiplier first (`resolveThreat`), so **a success always cashes in**, at x2 at least. A failed sequence never puts him down.
   - After success, the baby's normal FSM runs (`putDownBaby` already does this) and the resume gap applies. Papa is free.

7. **Gag and retreat** (the epic's « le bébé se réveille (gag), et la séquence recule »). Both are `failSequenceOnGag` with no edit.
   - The retreat from step 0 stays at step 0, so **the descent starts over after `restMs`**: the baby is back up (D2).
   - The third failure wakes him: `BabyWoke`, `SequenceEnded{failed}`, and **he stays carried**.
   - New gag id `baby_woke_on_drop` (empty consequence in `GAG_CONSEQUENCES`, all flags false in `GAG_PRESENTATIONS`; `tests` list it as they list `baby_sat_up`).
   - `gagCryMs: 2000`: the cry and the noise (+4 % at live values) come through `runBabyCry` on a carried baby, as in 4.7. **The gag resets the combo**: existing behaviour, tested here. `restMs` (2000) ≥ the cry, so a cry never covers the next descent's cue: pinned by a test on frozen defs.

8. **Content.** New `content/threats/bomb_drop_lay.json`:

   ```json
   {
     "$schema": "../_schemas/threat.schema.json",
     "id": "bomb_drop_lay",
     "target": "papa",
     "response": "firm",
     "telegraphDelayMs": 2600,
     "release": { "pressWithinMs": 700 },
     "windowMs": 300,
     "gag": "baby_woke_on_drop",
     "gagCryMs": 2000,
     "verbKey": "verb.hold_on",
     "signalVerbKey": "verb.let_go",
     "icon": "sweat",
     "signalIcon": "open_hand",
     "iconShape": "circle",
     "color": "parry",
     "feedback": {
       "telegraph": "tel_bomb_drop",
       "signal": "bomb_drop_touchdown",
       "success": "resp_firm",
       "perfect": "resp_firm_perfect",
       "gag": "gag_baby_woke_on_drop"
     },
     "cooldownMs": 600
   }
   ```

   New `content/sequences/bomb_drop.json`:

   ```json
   {
     "$schema": "../_schemas/sequence.schema.json",
     "id": "bomb_drop",
     "babyCarried": true,
     "steps": [
       {
         "kind": "duel",
         "durationMs": 6000,
         "threatDef": "bomb_drop_lay",
         "restMs": 2000,
         "slowMo": { "timeScale": 0.4, "returnMs": 400 }
       }
     ],
     "success": { "kind": "babyLaid" },
     "failure": { "kind": "retreats", "maxRetreats": 3 },
     "framing": {
       "camera": { "zoomPct": 40, "focusPct": 80, "inMs": 1000, "outMs": 700 },
       "musicLoop": "bomb_drop",
       "bar": null
     },
     "feedback": {
       "started": "sequence_started",
       "succeeded": "sequence_succeeded",
       "failed": "sequence_failed"
     }
   }
   ```

   `content/levels/salon_crawler.json`: `sequences` gains `bomb_drop`. `strings.fr.json`: `verb.hold_on` « TIENS… », `verb.let_go` « LÂCHE ! » (check the verb fit and `VERB_MAX_WIDTH_PCT` at 667 × 375). `resp_firm` and `resp_firm_perfect` already exist in `feedback.json`.

9. **`feedback.json` and audio.** Cues `tel_bomb_drop` (a `tel_*` clip no other shares, haptic `light`), `bomb_drop_touchdown` (clip `baby_mattress_touch`, `soundWave` on `threat`, haptic `medium`), `gag_baby_woke_on_drop` (clip of the same name, haptic `heavy`, `fx: "gag"`). `loops.sequenceMusic.bomb_drop` with clip `music_bomb_thriller`. Placeholder clips in `PLACEHOLDER_CLIPS` with seeds from the next free `SEED +` (**read every one first**; 34 was the highest after 4.7). `npm run assets:audio -- --only …` (macOS), **commit only the new `.m4a`**. `dist:check` stays green (level audio ≤ 3 MiB: the thriller loop is the risk, keep it short). `tests/tools/audio/` lists the names. `checkThreatSignal` (`contentChecks.ts` L460) now applies to a `release` def too: audio, visual, haptic on the signal cue.

10. **Snapshot v25** (the type, `takeSnapshot`, the `invariant`, the history comment; a parallel story may bump it, **look before merging**). The `sequence` slow-mo source is the only change. No new field. Stale « version 24 » titles and `project-context.md` L74 move. A round trip in flight: mid-descent held (the press and the slow-mo survive), continued to the end on both copies, hashes compared.

### Client

11. **The marker** (`threatMarkers.ts`).
    - **Trap: L210-211 gives every `firm` def `carriedVerb` « POSE-LE D'ABORD ! ».** While carried that verb would replace « TIENS… » on the one Firmness that is meant to be held carrying. Add `release` to `ThreatMarkerDef`, and give a `release` def no `carriedVerb`.
    - The swap at `windowOpen` already works off `signalIcon` / `signalVerb` (L763-779); the fit reads `isSignalShown`. Prove it with a test: « TIENS… » + `sweat`, then « LÂCHE ! » + `open_hand` at `WindowOpened`.
    - The hold-ring is unchanged (`updateHoldRing`, `.pp-threat-hold`): fills in `holdMinMs`, closes.

12. **The descent on screen** (`babyView.ts`, `render/`). While the running threat is a `release` def's, the carried baby's lift goes linearly from the carried height to `feedback.json › bombDrop.laidHeightM`, from the telegraph's start to `windowOpenAt`, on the render's sim clock (a pure `layDownProgressPct(threat, renderSimMs)`, unit-tested: clamped, 100 in `windowOpen`). Reading `windowOpenAt` is allowed: this is not a `wait`, its instant is not hidden, and the player must see it coming. **That lowering is what the release is aimed at**, and it is motion-essential, so it stays under reduced motion. No allocation per frame. A gag or a retreat sends him back up at once.

13. **Input: no code.** `isDuelStepRunning` already turns a finger anywhere into the press and `targetNow` finds the telegraphed threat, and `Release` follows from the tracker, for pointer, Space and A. Prove it in e2e. **A pause during the hold sends `Release` (`releaseHeld`), so it is a `released` gag**, as with any Firmness (1.23): tested, and in the open points.

### Tools and tests

14. **Bots: the golden rule.** `BotResponse` is derived from `ResponseResolved['response']` (`bot.ts` L7), so it stays `firm` here: **do not add a member to it.** `BotSetup` gains the ids of the `release` defs (built beside `botResponsesOf`, which keeps its output), and the bots check them before `schedulePress`. Plan: a press and a `Release` scheduled at the computed instant, with `hold.noteTap`, **not** `firmHold` (which releases only once the threat is answered, so it would hold through the pose and gag `late`).
    - `perfect`: press at the first step of `telegraph` (not at `centreOf`, far past `pressWithinMs`), release at `round(centreOf(threat))`: offset 0, `perfect`.
    - `human`: press at `enteredAt + reactionMs`, release at `round(centreOf + aimOffsetMs + jitterSdMs × N(0, 1))`, one draw. It aims at what is visible, so no rule like `wait`'s needs a signal.
    - `random`, `idle`: nothing (`idle` gags `late`, three times, then loses).
    - Parry and wait draws **do not move**: `botContract` and a test say so.

15. **The generated tests** (`tests/threats/threatCatalog.test.ts`). `bomb_drop_lay` joins by being named in a live duel step. Its firm block assumes `holdUntilMs`: branch on `def.release` for release perfect, release success at both window edges, too early (`released`), too late (`late`, with and without a release), no press, press past `pressWithinMs`, at each tier.

16. **Unit tests** (next to the code, driving the real `createSim`, frozen `tests/support/testBombDrop.{threat,sequence}.json`), at least:
    - `src/sim/threats/bombDropRelease.test.ts`: AC 3 in full. The window edges inclusive on the better side. A release stamped in the window arriving after the close is judged on its `t`. `lagMs` delays the late verdict. Holding past the pose never resolves. `earlyPress: guard` changes nothing. Carried and not carried give the same result. A plain carried `firm` is still `wrongResponse`.
    - `src/sim/sequences/bombDrop.test.ts`: a win; the event order of AC 6; `safe: true` and the cash-in amount; Papa placed from outside the zone and left alone inside it; the nearest zone of two; a retreat restarts the descent with the slow-mo ended and restarted; the third failure wakes him, still carried, and no cash-in; `noisePct` up on a gag in a level with noise; a level end mid-descent closes it and its slow-mo; `?threats=off` keeps the def.
    - `bombDropFuzz.test.ts`: 30 seeds with sensible and wild presses, cached per seed (4.7's review: **the aggregate must not read another test's state**), requiring a win, a retreat, a loss and an end across seeds. No test title promises more than it checks (4.6's review).
    - `slowMo.test.ts`: `endSlowMo`, including a no-op with none running, and the time scale of the step after.
    - Client: AC 11's marker and `layDownProgressPct`; `waitFeedback.test.ts`-style signal cue. Schemas and `content:check`: ACs 1, 4, 6, 9.
    - `src/sim` coverage stays at or above 90 %.

17. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: `perfect`, `human` and `idle` identical apart from hashes. **`random` will move** (one more instance, as in 4.6 and 4.7). **Prove the cause** by removing `bomb_drop` from the level's `sequences` temporarily, then restoring. **Paste both tables.**
    - `… --sequence bomb_drop --sequence-at-ms 5000`: `perfect` wins 20 of 20, no retreat, every response `perfect`, the baby down, the combo cashed; `idle` loses 20 of 20 at its third failure. Say what `human` and `random` do. **Paste the table.** `human` losing often is a finding for Geo, not a thing to tune away. `tools/sim/simReport.ts`: the micro-sleep count skips duel defs (`duelDefIdsOf`), and a test checks `bomb_drop_lay` is among them.
    - `tests/tools/sim/`: the same pin on the frozen sequence for `perfect` and `idle`, seeds 1 to 5.
    - `npm run golden:update`, diff, then `biome format` the JSON: every existing journal moves **only** in its `worldHash`. Anything else is a bug: stop.
    - New golden scenarios `bomb_drop_won` and `bomb_drop_released_early` (frozen defs, whole-ms stamps).

18. **End to end** (`tests/e2e/bombDrop.spec.ts`, chromium + webkit, `openFrozen`, real input, values from the live content and from `windowOpenAt` through `__PP__`). Share `tests/e2e/support/duel.ts`.
    - Start with Papa outside the playpen: he stands in it, the baby in the arms, `data-pp-sequence="bomb_drop"`, `data-pp-sequence-music`.
    - A held press: hold-ring closes, « TIENS… », the baby's height falls (the mirror or view state, not a pixel); no « POSE-LE D'ABORD ! ».
    - At the pose: « LÂCHE ! », the signal cue in `__PP__.cueLog()`, its vibration in Chromium.
    - Release in the window: `resp_firm`, `outcome` `succeeded`, `baby_put_down`, `combo_cashed_in`, `data-pp-combo-cashed`.
    - A tap at once: `gag_baby_woke_on_drop`, `data-pp-sequence-retreats="1"`, the baby back up. Held past the pose: the same, by `late`.
    - **Space works too, press and release.** A pause during the hold gags.
    - `world.time.scale` is the step's `timeScale` during the descent, and back at 1 after the end.
    - `?autoplay=perfect`, started by `__PP__.send`: `succeeded`.
    - Screenshots at 667 × 375, **looked at**, and under reduced motion. With the `sfx` volume at 0, the verb, the glyph and the vibration still come. No screenshot reference should move. `sequence.spec.ts` and `threats.spec.ts` follow the new threat in the list, as 4.7's did.

19. **Docs.** `project-context.md`: a « The bomb drop (story 4.8, snapshot version 25) » paragraph after 4.7's, and `snapshot version 25` at L75; correct « Carrying the baby » (« a Firmness pressed while carried is a `wrongResponse` gag ») with the exception. `deferred-work.md`: the open points. Do not edit the architecture or the GDD.

20. **CI.** `(unset VITE_DEBUG_ALLOWED; caffeinate -i -s npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [ ] **T1. The release Firmness in the sim** (AC 1-3, 10, part of 15-16)
  - [ ] T1.1 Schema, glyphs, `content:schemas`, schema tests.
  - [ ] T1.2 `telegraphThreat`, `openWindow`, `pressThreat`, the loop branch; `bombDropRelease.test.ts` on a frozen def, **before any live content**.
- [ ] **T2. The sequence** (AC 4-7, 10)
  - [ ] T2.1 `sequenceDuelProblems`, `slowMo` on the step, the `sequence` source, `endSlowMo`, snapshot v25.
  - [ ] T2.2 `babyLaid`: placement, the put-down in `runPapa`, the shared level check.
  - [ ] T2.3 `bombDrop.test.ts`, the fuzz, the round trip.
- [ ] **T3. Content** (AC 8-9): the JSON, the gag, strings, cues, clips.
- [ ] **T4. Client** (AC 11-13): the marker trap, the descent, the music.
- [ ] **T5. Bots and tools** (AC 14-15, 17): the release plan, catalogue, tables, goldens.
- [ ] **T6. End to end, docs, CI** (AC 18-20).

## Dev Notes

### Decisions (D1-D6)

- **D1. One `duel` step with a Firmness threat; no new step kind and no own slice.** The epic asks for a Firmness, a gag and a retreat: those are `gagThreat`, `failSequenceOnGag` and the duel slice. A threat also brings the marker, the verb swap, the ring, the cues, the combo, the catalogue tests and 4.10's metrics, while finger-anywhere and `Release` already work. A separate slice (the 4.5 way) would rewrite all of that for a single judged instant. The code comments that expected a kind of its own were a guess: correct them (AC 4).
- **D2. « La séquence recule » means the descent starts over.** There is one step, and a retreat from step 0 stays at step 0. Going back to `bedtime_duel` would need sequences that chain, which do not exist before 4.10. To revisit there if the cycle feels too forgiving.
- **D3. The start places Papa rather than refusing.** The epic has the sequence start « au-dessus d'une `ZONE_safe_*` ». A `sequenceRefusal` would leave `--sequence bomb_drop`, the overlay, autoplay and 4.10's chain stuck unless something walked Papa there, against the golden rule. `startSequence` already takes a far baby instantly (4.4's D6), so this is the same licence. A jump is visible in the salon's debug start, and 4.10's Papa should already be at the crib.
- **D4. The descent's clock is the telegraph, not the press.** One clock means no second frozen window, no draw and a release instant the world already holds. The price: a press at the end of `pressWithinMs` holds for less time than one at the start. It does not change the target, and the limit keeps « toute la descente » honest.
- **D5. `WaitSignalGiven` is reused, not renamed or doubled.** It means « the signal », `threatCueOf` and the marker already follow it, and a second event would double every switch. The name is slightly narrow; the comment says so.
- **D6. Slow-mo is a step key, its length computed.** A `durationMs` in JSON could disagree with the descent, or stop before the pose. Sim time stays the judge: at 0.4 the 300 ms window is 750 ms of real time, on purpose (project-context: « Slow-mo widens windows on purpose — don't "fix" it »).

### What the epic leaves open, decided here (to confirm with Geo)

The meaning of the retreat (D2), placing Papa (D3), the noise (AC 7) and all the tuning. All but D3 are JSON.

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatSystem.ts`:** `pressThreat` L15; the wait rule L26 is the model for the new first branch; the loop's press block L116-150. The carried Firmness gag L130 and `firmHoldOutcome` L139 are what the release branch must come before. The expiry L151-156 only sees `press === null` in `windowOpen`; a threat with a press never expires, so the late check on a held release is new. **Keep:** every other def's path, the order commands → feint → open → press → expiry.
- **`src/sim/threats/threatFsm.ts`:** `telegraphThreat` (window frozen first), `openWindow`, `resolveThreat` (hitstop, perfect slow-mo, combo, then `advanceSequenceOnResolve`, last), `gagThreat`.
- **`src/sim/sequences/bedtimeDuel.ts`:** handler L29; `sequenceDuelProblems` L120, the `wait` check L154. **`sequenceEnd.ts`:** imports no threat code; `closeSequence` L32, `goToSequenceStep` L99 (asserts a duel: true here). **`sequenceStart.ts`:** the order at L59-82; `sequenceRefusal` is unchanged. **`sequenceSteps.ts`:** no new handler.
- **`src/sim/baby/carry.ts`:** `isInSafeZone` L28, `putDownBaby` L97 (safe, cry cancel, cash-in; no change). **`src/sim/papa/papaSystem.ts`:** the sequence hold at L271; the put-down goes before it.
- **`src/sim/time/slowMo.ts`:** `startSlowMo` extends a running source, never shortens it, hence `endSlowMo`. **`src/sim/world.ts`:** `SlowMoSource` L457.
- **`src/sim/createSim.ts`:** `duelThreatIndexes` L372-ish already builds an instance per def, for any duel step; `simLevelOf` runs the checks.
- **`src/content/schemas/sequence.ts`:** `DuelStepSchema`; `SEQUENCE_SUCCESS_KINDS`. **`threat.ts`:** firm rule L230-243, wait keys L246.
- **`src/client/ui/world/threatMarkers.ts`:** L210-211 (the trap), L746-751, L763-779. **`src/client/render/views/babyView.ts`:** `wantedLiftM` L138.
- **`src/bots/threatTiming.ts`:** `fingerPlanFor` is exhaustive, `createFirmHold`, `schedulePress`. **`humanBot.ts`, `perfectBot.ts`:** the press loops; `centreOf`.
- **`content/levels/salon_crawler.geometry.json`:** the one safe zone, `playpen`, centre (-2, 1.6), half extents 0.7. Check the centre is open before relying on it.
- **Must not change:** `judgePress`, `classifyPress`, `firmHoldOutcome`, `holdEndAt`, `effectiveWindow`, `pressKindOf`, `sequenceSystem.ts`, `advanceSequenceOnResolve`, `failSequenceOnGag`, `COMMAND_TYPES`, `tokens.css`, `HUD_MAX_DOM_NODES`, the rng draws of any existing def, `content/sequences/bedtime_duel.json`.

### Architecture compliance

- Pure sim, serialisable `World`; no real time, no log; `world.rng` only (this story adds no draw in the sim). Events past tense with `t`. Helpers, not system calls: `runPapa` calling `putDownBaby` is existing practice.
- Judged on the release's own stamp (ADR-003), windows in sim time (ADR-002). A release goes through `toSim` like every stamp.
- Units: `pressWithinMs`, `returnMs`, `laidHeightM`. Booleans `is…`. Bots import `@sim` only. Layer rules unchanged. `three` stays out of the sim; the height is client data.
- Every cue with `audio` has `visual` and `haptic`. A telegraph vibrates `light`, a gag `heavy`. Reduced motion never changes sim timing.
- **A deliberate exception, not a variance:** GDD L171's « pas tenir avec Fermeté » concerns carrying through a threat. Laying the baby is the end of carrying, and the epic itself asks for the Firmness.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned and this story uses only what is there, so no web research was needed.

### File structure

New: `content/threats/bomb_drop_lay.json`, `content/sequences/bomb_drop.json`; new `public/assets/audio/*.m4a`; `src/sim/threats/bombDropRelease.test.ts`; `src/sim/sequences/{bombDrop,bombDropFuzz}.test.ts`; `tests/support/testBombDrop.{threat,sequence}.json`; `tests/content/bombDropSchema.test.ts`; `tests/e2e/bombDrop.spec.ts`; `tests/golden/bombDrop.test.ts` and journals.

Updated: `src/content/schemas/{threat,sequence}.ts`, `content/{feedback.json,strings.fr.json,levels/salon_crawler.json}`, `content/_schemas/*`; `src/sim/{world,snapshot,createSim}.ts`, `threats/{threatFsm,threatSystem,gags}.ts`, `sequences/{bedtimeDuel,sequenceEnd,sequenceStart}.ts`, `time/slowMo.ts`, `papa/papaSystem.ts`, `baby/carry.ts`; `src/bots/{threatTiming,botResponses,humanBot,perfectBot}.ts`; `src/client/render/gags.ts`, `render/views/babyView.ts`, `ui/world/threatMarkers.ts`; `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`; tests next to each, `tests/threats/threatCatalog.test.ts`, `tests/support/testContent.ts`, `tests/golden/*`, `tests/bots/*`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ carry: CARRY, sequences: [...], sequenceDefs })` and `stepN`. `STEP_MS` from `@shared/constants`, never a literal. `createSimWithSystems` **replaces** the system list: use `[...SYSTEMS, spy]`.
- `simPurity` refuses the identifier `window`: name a window parameter `response` in `src/sim`.
- `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/bombDrop.spec.ts tests/e2e/bedtimeDuel.spec.ts tests/e2e/fakeSleep.spec.ts tests/e2e/holdRing.spec.ts tests/e2e/sequence.spec.ts tests/e2e/threats.spec.ts tests/e2e/combo.spec.ts tests/e2e/carry.spec.ts --project=chromium`.
- **`VITE_DEBUG_ALLOWED=false` may be exported in the shell:** check with `env | grep VITE_`, and run as `(unset VITE_DEBUG_ALLOWED; …)`.
- **The Mac sleeps during background runs:** long runs under `caffeinate -i -s`. A 30 s timeout failing after minutes means it slept, not that the code is wrong (4.7's Debug Log).
- `botContract.test.ts` can time out at 5 s under load: it passes alone; rerun with `VITEST_MAX_WORKERS=5` and say so.
- On WebKit, wait 3 frames after each `advanceTo` before a real input. `waitFrames` before asserting something absent, or it holds in the initial state too.

### Previous story intelligence (4.6, 4.7)

- **Their reviews found, and this story must not repeat:** a fuzz whose « sensible press » never fired; an aggregate reading another test's state; a test whose title promised more than it checked; a `no X` test that did not assert the thing did come; a File List that omitted files; a stale snapshot history comment; e2e checks that held in the initial state.
- **`?threats=off`** keeps the defs `duel` steps name; `threatsSwitch.test.ts` should say so for `bomb_drop_lay`.
- **`human` and `perfect` never exercise a wrong release alone:** the fuzz has to.
- **The bots never put the baby down after other sequences**; `bomb_drop` is the first that ends with him down. A bot going on playing after it is new ground: watch the sim table.
- **Worktree guard:** compound shell commands that name `git`, and a heredoc appended to a file, are refused. Use plain commands and the edit tools.

### Git intelligence

Last merged: 4.7 (`c1cfddf`), on 4.6's machinery. Commit convention: « Story 4.8 : <titre> », « Story 4.8 : corrections de la revue de code ». `main` only receives the merge after Geo's OK. This branch is `story/4-8-depose-bombe`, in its worktree, with `npm ci` already done.

### Project Structure Notes

Paths follow the architecture (`src/sim/sequences/`, `content/sequences/`). The architecture's L968 names `HoldAnywhere` for this line, but the epic gives it to 4.9 alone (« uniquement pendant l'infiltration »): the epics are followed here, and a press on the threat does the work.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 14, 17).
- Layer rules; the sim never logs; I/O returns `Result`; no silent `catch`, every fallback logs a `warn`.
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes. Reduced rules are `:where(:root[data-pp-motion="reduced"]) <selector>`, never `@media`.
- A new `GagId` needs its consequence and its presentation. A threat's success clip is exactly `resp_<response>`, its telegraph a `tel_*` clip no other shares, its gag a `gag_*` clip.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **Papa is placed over the playpen at the start** (D3) rather than the start being refused elsewhere. It shows as a jump in the salon's debug start.
2. **A failure restarts the descent** (D2); it does not go back to the duel. 4.10 can revisit it.
3. **Laying the baby is the one Firmness allowed while carrying** (GDD L171's exception).
4. **A pause during the hold is a failure** (AC 13), as for every Firmness. On a 6 s real-time hold it may feel harsher than elsewhere.
5. **The noise is +4 %** per failure (a 2 s cry). The GDD does not price it (L216). `gagCryMs` tunes it.
6. **The tuning is a guess:** 2.6 s of descent, 700 ms to press, a 300 ms window, slow motion at 0.4, so about 6.5 s of real time and a 750 ms window. Slow motion makes the window generous; if it is too easy, narrow `windowMs`.
7. **The sweat and the baby are placeholders** until E7: a glyph and a lowered sphere. The verbs « TIENS… » and « LÂCHE ! » are mine.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L1807-1809, L1980-2000, L2041]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L133, L169, L171, L216, L306, L308]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L222, L643, L732, L968]
- [Source: _bmad-output/project-context.md (Carrying the baby, The combo, Special sequences, The Wait response and the bedtime duel, The fake sleep, Time & input judgement)]
- [Source: _bmad-output/implementation-artifacts/4-6-duel-du-coucher-reponse-attendre.md, 4-7-faux-sommeil.md (Decisions, Review Findings); deferred-work.md L785]
- [Source: src/sim/threats/{threatSystem,threatFsm,judgeable}.ts, src/sim/sequences/{bedtimeDuel,sequenceEnd,sequenceStart,sequenceSteps}.ts, src/sim/baby/carry.ts, src/sim/time/slowMo.ts, src/sim/timing/{holdEnd,judge,classifyPress}.ts, src/content/schemas/{threat,sequence}.ts, src/client/input/inputMapper.ts, src/client/ui/world/threatMarkers.ts, src/bots/{threatTiming,humanBot,perfectBot}.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-11-01 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
