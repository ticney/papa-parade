---
baseline_commit: f1fd12ca14023ae86355dc865107156e4c2fed5b
---

# Story 4.7: The fake sleep

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 4.7 « Faux sommeil » (L1958-1978). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want a falsely sleeping baby to punish me if I relax too soon,
so that I learn to read before I act.

**Requirements covered:**
- **FR41 `[P2]`:** « faux sommeil, attaque retardée façon Elden Ring (Attendre) ». GDD L355: « Un œil s'entrouvre et punit le joueur qui se relâche trop tôt (Attendre) ».

**What this story is not:**
- **No new response and no new threat state.** It is a `wait` threat with one extra beat before the signal. The strict early rule of 4.6 already makes a press on the feint an `early` gag: **`pressThreat` does not change.**
- **No new sequence and no new engine.** The fake sleep is a round of the existing `bedtime_duel` (D1). `sequenceSystem`, `sequenceEnd`, `sequenceSteps` and `DUEL_HANDLER` do not change.
- **No `nothing` response and no false alarm:** that is 4.9 (`false_alarm_sigh`), a different thing, answered differently. **No ring** on a feint (GDD L198).
- **No real baby animation.** No eyes on the baby until E7: the marker carries them, as in 4.6's D8. No baby state.
- **No new command, no new dependency, no new top-level folder, no new string.**

**Sources:**
- Epics `epics.md` L1807-1809, L1958-1978, L2041 (4.10's chain has no fake sleep step of its own, hence D1).
- GDD `gdd.md` L135, L198 (« un anneau trahirait le faux sommeil »), L216 (pricing of sequence gags), L305, L353-355.
- Architecture `game-architecture.md` L222, L738-744 (P2), L967 (« Duel du coucher, faux sommeil | ThreatDef `response: 'wait'` | P2 »).
- UX: `DESIGN.md` and `EXPERIENCE.md` say nothing of the feint; `source-extract-arch-epics-readiness.md` L189 lists « eye half-opening (fake sleep) ». Tokens and marker rules apply as for 4.6.
- Previous story: `4-6-duel-du-coucher-reponse-attendre.md`. **Read all of it, reviews included.** Its D1, D2, D6 and D8 are what this story stands on.

## Acceptance Criteria

Numbers in `content/` are live starting values for Geo to tune. Tests use frozen `tests/support/` files, never the live ones.

### The feint, generic on any `wait` def

1. **Schema** (`src/content/schemas/threat.ts`, every key with a `.describe()`, then `npm run content:schemas`). New optional key on `baseShape`, **refused on a def that is not `wait`** (the `superRefine`, one message per path):

   ```ts
   feint: z.strictObject({
     minDelayMs,  // .int().positive(): from the end of telegraphDelayMs to the feint, sim ms
     maxDelayMs,  // .int().positive(), at least minDelayMs
     minGapMs,    // .int().positive(): the shortest time between the feint and the real signal
     icon,        // z.enum(THREAT_ICONS): the glyph from the feint on
   }).optional()
   ```

   - `feint.maxDelayMs + feint.minGapMs <= minDelayMs` (issue at `['feint', 'maxDelayMs']`). **So the feint always comes first, and a player who reacts to it presses before the signal**: without the gap, a reflex on the feint could land in the real window and be paid (D3).
   - `feedback.feint`: a cue id, optional in `FeedbackCuesSchema`, **required when the def has `feint`, refused otherwise**, in the style of `feedback.signal`.
   - `THREAT_ICONS` gains `peek` (one eye half open, the other closed), with its path in `THREAT_ICON_PATHS` (`threatMarkers.ts`; a compile error otherwise). It must read differently from `eyes` and from `eyelids` at the marker's size in a 667 × 375 screenshot.
   - Tests: `tests/content/waitThreatSchema.test.ts` or a new `fakeSleepSchema.test.ts`: each refusal on its path; `feint` on a `parry`; a `min > max`; a gap that does not fit; a missing and an unwanted `feedback.feint`.

2. **The draw** (`threatFsm.ts`). `ThreatInstance` (`world.ts`) gains `feintAt: SimMs | null` and `isFeintGiven: boolean`, `null` and `false` at creation (`createSim.ts` L613).
   - `telegraphThreat`: a def **with** `feint` draws **a second `nextFloat`, after the signal's**, and sets `feintAt = now + openAfterMs + Math.round(feint.minDelayMs + draw × (feint.maxDelayMs − feint.minDelayMs))`. Keep the order explicit: the signal's draw is inside the `windowOpenAt` expression today, so take it out into a local first, or the two draws can swap silently. **The second draw is independent of the first**, so the feint tells nothing of when the signal comes, beyond the range.
   - **A `wait` def with no feint still draws exactly one, and any other def none**: `bedtime_eyes`, `test_wait` and the salon keep their rng streams. `isFeintGiven = false` at every telegraph.
   - `rearmThreat`, `cancelThreat` and `hideThreat` clear both, beside `windowOpenAt`. `resolved` and `gag` keep them until the rearm.

3. **The event** (`threatSystem.ts`, `runThreats`). In the per-instance loop, **before** the `telegraph → windowOpen` check: when `threat.state === 'telegraph' && threat.feintAt !== null && !threat.isFeintGiven && now >= threat.feintAt`, set `isFeintGiven = true` and push `WaitFeintGiven{t: now, threatId}` (`events.ts`; `SIM_EVENT_TYPES`, sorted, so right before `WaitSignalGiven`). A helper in `threatFsm.ts` (`giveFeint`), not inline. It allocates nothing but the event. **A press in the same step wins:** commands run first, the threat is then in `gag` and no feint comes.

4. **Judgement: no code, only proof.** A press anywhere before the signal is already `gagThreat(…, 'early', …)`, whatever `earlyPress` says. Prove it, in `waitResponse.test.ts` or `fakeSleep.test.ts`: a press at `feintAt` exactly, one step after, one ms before the signal, and one **before** the feint, are each an `early` gag; a press stamped before the signal that arrives after it is `early`; a press in the window after a given feint is `perfect` or `success` exactly as with no feint, same `offsetMs`. The `ResponseResolved.response` stays `wait` and `reason` is `early` (the epic's AC).

5. **Client: the feint shows only once it is given** (`threatMarkers.ts`, the block at L741).
   - `ThreatMarkerDef` and `ThreatMarkerEntry` gain optional `feintIcon`; `threatMarkerDefOf`-style plumbing as for `signalIcon` (L160-162, L205-213).
   - The marker gains `isFeintShown` and reads **`threat.isFeintGiven` only, never `threat.feintAt` or `threat.windowOpenAt`**. In `telegraph` with `isFeintGiven`: the glyph is `feintIcon` and the class `pp-threat--feint` is on. In `windowOpen`: the signal takes over, `signalIcon`, `pp-threat--signal`, feint class off. At the next telegraph, or when the marker goes: back to `icon`, both off. The `d` and the class are written only when they change, and they compose: today's block writes the glyph from `isSignal` alone, so compute the one glyph from both flags (for a def with no `feintIcon`, the same as today).
   - **The verb stays « ATTENDS… » through the feint** (D2). No `refit`, since the text does not move.
   - `ui.css`: `.pp-threat--feint .pp-threat-icon` a short pop distinct from the signal's; a rule under `:where(:root[data-pp-motion="reduced"])` next to the signal's at L1987 drops the animation and keeps the glyph (`designTokens.test.ts` fails otherwise). Tokens only.
   - **Unit tests** beside `waitMarker.test.ts`: the swap, once per change; the order eyes → peek → closed → eyes at the next telegraph; a def with no feint is unchanged; **no leak: two instances whose `feintAt` and `windowOpenAt` differ write the same DOM until `isFeintGiven`**.
   - `threatCloseAt` (`urgency.ts`) and the eyelids (`levelScene.ts`) do not read the feint.

6. **Feedback.** `threatFeedback.ts`: `threatCueOf` gains `WaitFeintGiven` → `feedback.feint` (both switches). `tools/content/contentChecks.ts`, beside `checkThreatSignal` (L460): `feedback.feint` must be a cue of `feedback.json`, with `audio`, `visual` and `haptic`; **its haptic and its clip must differ from those of `feedback.signal`** (D2: the feint must be readable with the sound off, and with the phone off the wrist). One failing test each in `tests/content/`.

### The fake sleep in the duel

7. **Content.** New `content/threats/fake_sleep.json`:

   ```json
   {
     "$schema": "../_schemas/threat.schema.json",
     "id": "fake_sleep",
     "target": "papa",
     "response": "wait",
     "telegraphDelayMs": 800,
     "minDelayMs": 3500,
     "maxDelayMs": 7000,
     "feint": { "minDelayMs": 1200, "maxDelayMs": 2600, "minGapMs": 900, "icon": "peek" },
     "windowMs": null,
     "gag": "baby_sat_up",
     "gagCryMs": 2000,
     "verbKey": "verb.wait",
     "signalVerbKey": "verb.go",
     "icon": "eyes",
     "signalIcon": "eyelids",
     "iconShape": "circle",
     "color": "parry",
     "feedback": {
       "telegraph": "tel_fake_sleep",
       "feint": "fake_sleep_eye_peeks",
       "signal": "bedtime_eyes_closed",
       "success": "resp_wait",
       "perfect": "resp_wait_perfect",
       "gag": "gag_baby_sat_up"
     },
     "cooldownMs": 600
   }
   ```

   `content/sequences/bedtime_duel.json`: **the third step becomes `{ "kind": "duel", "durationMs": 10000, "threatDef": "fake_sleep", "restMs": 1200 }`**, the two others unchanged. `sequenceDuelProblems` needs at least `1200 + 800 + 7000 + 300 × 1.5 + 60 = 9510` ms. The real signal keeps the cue of the first two rounds, so the last round's reward sounds like the others.

8. **Noise** (the epic's « bruit »). It is `gagCryMs`, which already exists (4.6's D6 names this story): `gagThreat` starts the cry, `runBabyCry` runs **before** the carried return in `runBaby` (`babySystem.ts` L89-93), so a carried baby cries, and `runNoise` adds `feel.noise.sources.babyCrying.perSec` (2) per `BabyCrying`: +4 % on the live values. **Prove it with a test on a carried baby in a duel: 2 `BabyCrying`, `noisePct` up by 2 × `perSec` (less the decay), in a level with `gauges.noise`, and nothing in a level without.** It applies to every gag of this def, `early` and `late` alike (4.6's D4: one gag per def, one cost). The retreat is otherwise unchanged. **A cry over the next round's signal would cover it**: earliest signal after a gag = `restMs + telegraphDelayMs + minDelayMs of the previous step's def` = 4000 ms, over 2000. A test pins this on the frozen defs.

9. **New gag.** `GAG_IDS` gains `baby_sat_up` (an empty consequence in `GAG_CONSEQUENCES`, like `babyEyesReopened`; all flags false in `GAG_PRESENTATIONS`). `sequenceDuelProblems` already accepts it. `tests/threats/...` and `gags.test.ts` list it as they list `baby_eyes_reopened`.

10. **`feedback.json`:** cues `tel_fake_sleep` (clip of the same name, no other telegraph shares it, haptic `light`), `fake_sleep_eye_peeks` (clip `baby_eye_peek`, a `soundWave` on `threat`, **haptic `light`, where the signal's is `medium`**), `gag_baby_sat_up` (clip of the same name, haptic `heavy`, `fx: "gag"`). Placeholder clips `tel_fake_sleep`, `baby_eye_peek`, `gag_baby_sat_up` in `PLACEHOLDER_CLIPS`, seeds `SEED + 32` to `+ 34` (**read every `SEED +` first**; 31 is the highest today). `baby_eye_peek` is close kin to `baby_eyes_close`, soft, with a rising end, so a careless ear takes it for the signal and a listening one does not. `npm run assets:audio -- --only …` (macOS), **commit only the new `.m4a`**, restore the others from git. `dist:check` must still pass (level audio ≤ 3 MiB). `tests/tools/audio/bedtimeClips.test.ts` lists the new names.

11. **Snapshot v24** (`snapshot.ts`, the type, `takeSnapshot`, the `invariant` at L1160 and the history comment; a parallel story may bump it, **look before merging**). `threatProblem` gains: `feintAt` null or finite and ≥ 0; `isFeintGiven` a boolean; both clear on `idle` and `hidden`; `isFeintGiven` true only with a non-null `feintAt`; a non-null `feintAt` strictly below `windowOpenAt`. Fixtures in `createSim.test.ts` and `snapshot.test.ts` (L195, L1630, L1765) gain the keys, each rejected field has a test, and **a round trip with something in flight**: before the feint (the drawn `feintAt` survives), after it and before the signal (`isFeintGiven` survives and no second `WaitFeintGiven` comes), each continued to the end on both copies with the hashes compared. Stale « version 23 » titles in `snapshot.test.ts` move too.

### Tools and tests

12. **Bots: the golden rule.**
    - `perfect`: no code. It reads the drawn `windowOpenAt`, so the feint cannot fool it. Offset 0, so `perfect`.
    - `human`: no code. It already skips a `wait` threat until it is `windowOpen` (`humanBot.ts`). So **it never falls for the feint**, and it says nothing of how hard the feint is: say so in a comment and in the open points (open point 5). `tests/bots/waitBots.test.ts`: never presses before the signal on `fake_sleep`, over many seeds; **no extra draw from the bot's own rng**.
    - `random`, `idle`: nothing.
    - `tools/sim/simReport.ts`: L258 counts a telegraph as a micro-sleep unless `duelDefs.has(event.kind)`. `duelDefs` must hold both defs of the live sequence. A test: `fake_sleep`'s telegraphs are not micro-sleeps.

13. **The generated tests** (`tests/threats/threatCatalog.test.ts`, FR41's safety net). `fake_sleep` joins by being named in a live duel step (`duelDefs`), at each tier. A new block `if (def.feint !== undefined)`: `WaitFeintGiven` comes once, before `WaitSignalGiven`, at `Math.ceil(feintAt / STEP_MS) * STEP_MS`, and with a gap of at least `minGapMs − STEP_MS`; a press at the feint is an `early` gag with `earlyPress` `fail` **and** `guard`; a press in the window after the feint is a success. The existing set (perfect, success at the opening, too early, too late, held) runs unchanged. A def with no feint draws one `nextFloat` and a def with one draws two (the rng state before and after).

14. **Unit tests** (next to the code, driving the real `createSim`), at least:
    - `src/sim/threats/fakeSleep.test.ts`, on a frozen def (`tests/support/testFakeSleep.threat.json`): the draws (AC 2) at both ends of the range, whole ms; the feint before the signal over many seeds; the event order; ACs 3, 4 and 8.
    - `src/sim/sequences/fakeSleepDuel.test.ts`, on a frozen sequence (`tests/support/testFakeSleepDuel.sequence.json`, rounds `bedtime_eyes`, `fake_sleep`): won through the feint; a press on the feint retreats to the eyes' step with `reason: "early"`, counts, cries and costs the combo; the eyes' round after it is on its own instance, with its one draw; one instance per def, `duelThreatIndexes` right, `microSleepIndex` and `armsCryIndex` unmoved; a cancelled or restarted round has a fresh feint, and `isFeintGiven` is false at each telegraph; a level end mid-round closes it.
    - `bedtimeDuelFuzz.test.ts` (or its twin) runs the same 30 seeds on the frozen sequence with the feint; the aggregate requires a feint given and a retreat.
    - Client: AC 5's marker tests; `waitFeedback.test.ts` gains the feint cue. Schemas and `content:check`: ACs 1 and 6.
    - `src/sim` coverage stays at or above 90 %.

15. **Bots and goldens (deliberate: say so in the Completion Notes).**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20`, `main` against the branch: `perfect`, `human` and `idle` have identical stars, end reasons, success rate, score and gags; only hashes move. **`random` will move** (one more instance, `nextInt(rng, 0, world.threats.length)`), as in 4.6. **Prove the cause:** on the branch, put the third step back to `bedtime_eyes` temporarily, rerun `random`, show it matches `main`, restore. **Paste both tables.**
    - `npm run sim -- --bot <id> --level salon_crawler --seed 1 --runs 20 --sequence bedtime_duel --sequence-at-ms 5000`: `perfect` wins 20 of 20 with no retreat and every response `perfect`; `idle` loses 20 of 20 at its third failure; `human`, `random`, say what they do. **Paste the table.** `human` losing often is a finding for Geo, not a thing to tune away.
    - `tests/tools/sim/duelSequence.test.ts` is on the frozen duel, so its numbers should not move. Add the same pin for the frozen sequence with the feint: `perfect` and `idle` over seeds 1 to 5.
    - `npm run golden:update`, then diff, then `biome format` the JSON: every existing journal moves **only** in its hashes (the world has two new fields). Anything else is a bug: stop.
    - New golden scenarios `fake_sleep_won` and `fake_sleep_feint_pressed` (`tests/golden/scenarios.ts`, `tests/golden/fakeSleep.test.ts`, frozen defs). Whole-ms stamps only.

16. **End to end** (`tests/e2e/fakeSleep.spec.ts`, chromium + webkit, like `bedtimeDuel.spec.ts`: `openFrozen`, real taps, values from the live content and from `feintAt` / `windowOpenAt` read through `__PP__`). The live round is the **third**: win the first two by real taps first, with a helper shared with `bedtimeDuel.spec.ts` rather than copied.
    - Before the feint: the `eyes` glyph, « ATTENDS… », no `pp-threat--feint`, no feint cue.
    - After `feintAt`: `pp-threat--feint`, the `peek` path, the verb unchanged, `fake_sleep_eye_peeks` in `__PP__.cueLog()`, and in Chromium its vibration pattern (WebKit has no `navigator.vibrate`).
    - A real tap on the feint: `gag_baby_sat_up`, `data-pp-sequence-retreats="1"`, `data-pp-sequence-step` back at 1, `noisePct` higher than before after the cry's first tick.
    - A real tap after the signal: `resp_wait`, `data-pp-sequence-outcome="succeeded"`. **Space works too.**
    - `?autoplay=perfect`, started by `__PP__.send`, waiting first for `data-pp-sequence="bedtime_duel"`: `outcome` `succeeded`.
    - The marker before, at the feint and at the signal: **screenshot at 667 × 375, looked at**, and under reduced motion. With the `sfx` volume at 0, the swap and the vibration still come. No screenshot reference should move.
    - `bedtimeDuel.spec.ts` stays green, edited only where the third round changes what it asserts (`eyesOf` looks up `bedtime_eyes` by id: the autoplay and any test that reaches step 2 must not read it there).

17. **Docs.**
    - `project-context.md`: a « The fake sleep (story 4.7, snapshot version 24) » paragraph, right after 4.6's (the second draw, its independence, `minGapMs` and why, `WaitFeintGiven`, `isFeintGiven` the only thing the client reads, the strict rule that does the judging, noise through `gagCryMs`), and `snapshot version 24` at L74. 4.6's paragraph keeps its own version.
    - `deferred-work.md`: this story's open points.
    - Do not edit the architecture or the GDD.

18. **CI.** `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the branch, once, when `ci:fast` and the touched specs are already green.

## Tasks / Subtasks

- [x] **T1. The feint in the sim** (AC 1-4, 11, part of 13-14)
  - [x] T1.1 Schema, `peek`, `content:schemas`, the schema tests.
  - [x] T1.2 The fields, the second draw, `giveFeint`, `WaitFeintGiven`; `threatCueOf`, `contentChecks` (AC 6).
  - [x] T1.3 Snapshot v24, with the in-flight round trips.
  - [x] T1.4 `fakeSleep.test.ts` on the frozen def, **before any live content**.
- [x] **T2. The fake sleep in the duel** (AC 7-10)
  - [x] T2.1 `fake_sleep.json`, the gag, `feedback.json`, the clips, `bedtime_duel.json`.
  - [x] T2.2 `fakeSleepDuel.test.ts`, the noise proof, the fuzz, the catalogue block.
- [x] **T3. Client** (AC 5)
  - [x] T3.1 The glyph, the class, the CSS, the no-leak test.
- [x] **T4. Tools and tests** (AC 12, 15, 16)
  - [x] T4.1 Bot pins and `simReport`; the tables pasted, the `random` cause proved.
  - [x] T4.2 Goldens (regenerate, diff, add the two scenarios).
  - [x] T4.3 `tests/e2e/fakeSleep.spec.ts`; touched specs; the screenshots looked at.
- [x] **T5. Docs and CI** (AC 17, 18)

### Review Findings

Code review of 2026-10-31 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; no layer failed). No high finding: AC 1-18 are met, `pressThreat`, `sequenceSystem`, `sequenceEnd`, `sequenceSteps` and `DUEL_HANDLER` are untouched, the sim is deterministic and clean of forbidden globals. 11 findings dismissed as noise.

- [x] [Review][Decision] (accepted as is by Geo, 2026-10-31; E7 draws the final one) The `peek` glyph is barely legible at the marker's real size (the Completion Notes say « small, two dark marks beside the eyes' big white eye »), and the screenshot evidence is Chromium only with the banner covering the verb. AC 5 asks for a glyph that « reads differently from `eyes` and `eyelids` at 667 × 375 ». Geo to look at `fake-sleep-feint.png` and either accept it (E7 draws the final one) or ask for a bolder placeholder [src/client/render/ or the `peek` path in `THREAT_ICON_PATHS`]
- [x] [Review][Patch] The fuzz's « sensible press » never fires: `threat.windowOpenAt !== world.time.sim - (world.time.sim % STEP_MS)` is true only when `windowOpenAt` lands on the step grid (it « may be off the step grid », `world.ts`), so the aggregate « exercised the feint » test passes by the seeds' luck, not by design. Answer each window once, the step it is seen open [src/sim/sequences/fakeSleepDuelFuzz.test.ts:59]
- [x] [Review][Patch] The fuzz's aggregate test reads `games`, filled by the 30 `it.each` cases: it fails alone (`-t`, `--shard`, shuffle, one retry). Play each seed through a cached helper that both the per-seed tests and the aggregate call [src/sim/sequences/fakeSleepDuelFuzz.test.ts:27]
- [x] [Review][Patch] « makes no noise in a level without the noise gauge, and the cry still comes » never asserts that `BabyCrying` fires (AC 8, 4.6's review pitfall) [src/sim/threats/fakeSleep.test.ts:469]
- [x] [Review][Patch] `checkThreatFeint` does not refuse `feint.icon` equal to `icon` (the glyph never changes at the feint) or to `signalIcon` (the feint looks like the signal); add the check and its test in `checkFakeSleep.test.ts` [tools/content/contentChecks.ts:489]
- [x] [Review][Patch] The `THREAT_CLASSES.feint` doc says « a short pop »; the CSS is a tilt, « not the signal's pop » [src/client/ui/world/threatMarkers.ts, src/client/ui/styles/ui.css]
- [x] [Review][Patch] « has a fresh feint at each telegraph » compares absolute `feintAt` values, always increasing; compare the delay since each telegraph [src/sim/sequences/fakeSleepDuel.test.ts:254]
- [x] [Review][Patch] `synthTelegraphFakeSleep` mixes `noise * FAKE_SLEEP_TEL_NOISE_GAIN * 10` with a gain of 0.1: the constant lies and the `10` is hidden. Name the real gain [tools/audio/makePlaceholderAudio.ts:1539]
- [x] [Review][Patch] `threatsSwitch.test.ts` does not say that `?threats=off` keeps `fake_sleep` (the story's « previous story intelligence » asked for it) [src/client/app/threatsSwitch.test.ts:55]
- [x] [Review][Defer] The snapshot's `threatProblem` ties `feintAt` / `isFeintGiven` to idle, hidden and `windowOpenAt` only: a `windowOpen` threat with a pending feint, or a feint on a def that has none, is accepted (the sim never writes them; AC 11 asks for exactly these checks) — deferred, spec-conforming
- [x] [Review][Defer] `tests/golden/fakeSleep.test.ts` redeclares `FAKE_SLEEP_ID` and hard-codes the rng-bound instants (8740, 11 820, 17 050, 19 290): any rng or timing change needs several manual edits — deferred, low

## Dev Notes

### Decisions (D1-D6)

- **D1. The fake sleep is the duel's last round.** The epic gives a threat file and no place to run it, and 4.10's chain has no step for it, yet the epic's intro says the player « déjoue le faux sommeil » in the cycle. A round of `bedtime_duel` is the one place that runs a `target: "papa"` `wait` today and it needs no engine change: `simLevelOf` already makes one instance per distinct def, and the retreat machinery works per step. It also teaches in order: two plain rounds, then the betrayal, when the player has learned « the eyes close, go ». An anchored or wave-planned use is refused by nothing but is still unspecified (4.6's deferred item).
- **D2. The feint changes the glyph, not the verb.** The epic calls it a « faux signal » and « un œil s'entrouvre »: it should look like the signal to someone not reading. So: a pop, a sound akin to the signal's, and the glyph moves. But « ATTENDS… » stays, the eye is visibly half open, and its vibration is lighter. All the information is there, in three channels, and it is fair (pillar 1, pillar 3). A verb that lied (« FILE ! ») would be a trap with no way to read it.
- **D3. `minGapMs` is a design key, not a safety margin.** With a feint too near the signal, a reflex on the feint lands in the window and pays: the feint would reward what it should punish. 900 ms is above any reaction (the human bot's is 250 ms).
- **D4. Two fields and an event, no state.** As 4.6's D1: `telegraph` still means « announced, not open ». `isFeintGiven` is separate from `feintAt` so that the client has something to read that says nothing before it happens, and a snapshot taken between the two gives no second event. **The price, as for `windowOpenAt`: `feintAt` sits in the world before the feint, and the client must not read it for anything visible** (AC 5).
- **D5. The second draw only on a def that has a feint.** The rng count stays independent of the tuning, and `bedtime_eyes`' journals keep their stream; only the hashes move.
- **D6. One gag and one cost per def.** The epic's « le bébé se relève, bruit » is written for the feint, but a late press on `fake_sleep` shares it, as `early` and `late` share `baby_eyes_reopened` (4.6's D4). The gag id belongs to the def, and a second one per reason would be a mechanism for a joke. Open point 3.

### What the epic leaves open, decided here (to confirm with Geo)

The place of the fake sleep in the cycle (D1), the look of the feint (D2), and the amount of noise (AC 8). All three are data or one line of JSON.

### Current state of the files this story changes (read before editing)

- **`src/sim/threats/threatFsm.ts`:** `signalDelayMs` L60 is the draw; `telegraphThreat` L75 (the draw sits inside the `windowOpenAt` expression at L89); `openWindow` L130; `rearmThreat` L255, `cancelThreat` L269, `hideThreat` L108 reset `windowOpenAt`. **Keep:** the side-effect order and the single draw for a plain `wait`.
- **`src/sim/threats/threatSystem.ts`:** `pressThreat` L15 is **not** touched; the strict rule is L26. The per-instance loop is L94, `openWindow` at L100-102: the feint goes right before it.
- **`src/sim/world.ts`:** `ThreatInstance` L132. **`src/sim/createSim.ts`:** the instance literal L613; `duelThreatIndexes` L372 already handles several defs.
- **`src/sim/snapshot.ts`:** `threatProblem` L497 has no def in hand, so its checks are on state only. Type L43, `takeSnapshot` L62, the invariant L1160.
- **`src/sim/baby/babySystem.ts`:** `runBabyCry` at L89 runs before the carried branch at L93.
- **`src/client/ui/world/threatMarkers.ts`:** entry fields L56-61, L160-162, L205-213; icon paths L303-308; the swap L741-758, which writes `d` from `isSignal`, **so composing with the feint is a real edit, not an addition**; the verb fit reads `isSignalShown` at L602 and needs no change.
- **`src/client/feedback/threatFeedback.ts`:** two switches, L20 and L42. **`src/client/ui/styles/ui.css`:** the pop L1739, the reduced rule L1987.
- **`tools/content/contentChecks.ts`:** `checkThreatSignal` L460; `checkThreatTwins` is the haptic rule. **`tools/sim/simReport.ts`:** L258.
- **`content/sequences/bedtime_duel.json`:** the third step changes. **`tests/support/testBedtimeDuel.sequence.json` does not**, so 4.6's tests stay as they are.
- **Must not change:** `judgePress`, `effectiveWindow`, `pressThreat`, `pressKindOf`, `DUEL_HANDLER`, `sequenceEnd.ts`, `sequenceSteps.ts`, `sequenceSystem.ts`, `isJudgeableBeforeEnd` (the feint is before the signal, so `maxDelayMs` still bounds the round), `COMMAND_TYPES`, `tokens.css`, `HUD_MAX_DOM_NODES`, the rng draws of any def with no feint.

### Architecture compliance

- Pure sim, serialisable `World`; no real time, no log; `world.rng` only; events past tense with `t`. `giveFeint` is a helper, systems do not call each other.
- Units: `minDelayMs`, `maxDelayMs`, `minGapMs`, `gagCryMs`; `feintAt` is sim time. Booleans `is…`. Bots import `@sim` only. Layer rules unchanged.
- Every cue with `audio` has `visual` and `haptic` (`feedbackEquivalence.test.ts`). A telegraph vibrates `light`, a gag `heavy`. Reduced motion never changes sim timing.
- The player never reads that they failed: no new string, and `failed` lives in code only.
- Not a variance: the architecture's L222 and project-context's « `wait` threats always gag on early press ». The feint adds no judgement.

### Library and framework notes

No new dependency and no version-sensitive API: the stack is pinned and this story uses only what is there, so no web research was needed.

### File structure

New: `content/threats/fake_sleep.json`; the three new `public/assets/audio/*.m4a`; `src/sim/threats/fakeSleep.test.ts`; `src/sim/sequences/fakeSleepDuel.test.ts`; `tests/support/{testFakeSleep.threat,testFakeSleepDuel.sequence}.json`; `tests/e2e/fakeSleep.spec.ts`; `tests/golden/fakeSleep.test.ts` and journals.

Updated: `src/content/schemas/threat.ts`, `content/feedback.json`, `content/sequences/bedtime_duel.json`, `content/_schemas/*`; `src/sim/{world,events,createSim,snapshot}.ts`, `threats/{threatFsm,threatSystem,gags}.ts`; `src/client/feedback/threatFeedback.ts`, `render/gags.ts`, `ui/world/threatMarkers.ts`, `ui/styles/ui.css`; `tools/audio/makePlaceholderAudio.ts`, `tools/content/contentChecks.ts`, possibly `tools/sim/simReport.ts`; tests next to each, `tests/threats/threatCatalog.test.ts`, `tests/content/*`, `tests/support/testContent.ts`, `tests/golden/*`, `tests/bots/waitBots.test.ts`, `tests/e2e/bedtimeDuel.spec.ts`; docs.

### Testing

- Sim tests use `createTestContent()` / `createTestLevel({ carry: CARRY, sequences: [...], sequenceDefs })` and `stepN`. `STEP_MS` from `@shared/constants`, never a literal. `createSimWithSystems` **replaces** the system list: use `[...SYSTEMS, spy]`.
- `simPurity` refuses the identifier `window`: name a window parameter `response` in `src/sim`.
- `ci:fast` after each task. E2E while developing: `npx playwright test tests/e2e/fakeSleep.spec.ts tests/e2e/bedtimeDuel.spec.ts tests/e2e/threats.spec.ts tests/e2e/feedback.spec.ts tests/e2e/testApi.spec.ts --project=chromium`.
- **`VITE_DEBUG_ALLOWED=false` is exported in this shell (checked):** run as `(unset VITE_DEBUG_ALLOWED; …)`, or nearly every spec times out on `data-pp-app="start"`.
- `botContract.test.ts` can time out at 5 s under load: it passes alone; rerun with `VITEST_MAX_WORKERS=5` and say so.
- On WebKit, wait 3 frames after each `advanceTo` before a real input (4.5). `waitFrames` before asserting something absent, or it holds in the initial state too (4.6's review).

### Previous story intelligence (4.6)

- **Its reviews found, and this story must not repeat:** something visible reading the unrevealed instant (Papa's eyelids read the telegraph of the first Papa-anchored threat, now limited to the micro-sleep, and `fake_sleep` is one more Papa-anchored threat: check it); `neededMs` forgetting a term; a fuzz that asserted nothing happened (require a retreat and an end); a test whose title promised more than it checked; a File List that omitted files; a snapshot history comment left behind; e2e checks that held in the initial state.
- **`?threats=off`** keeps the defs the `duel` steps name, so `fake_sleep` stays. `threatsSwitch.test.ts` should say so.
- **The bots never put the baby down after a sequence** (4.10): the `perfect` bot's stars fall after any sequence on `salon_crawler`. Expected, not a finding.
- **`npm run ci` in 4.6 had unrelated flaky e2e failures on a loaded machine.** Rerun the spec alone, then the full CI once, and report what happened as it happened.

### Git intelligence

Last merged: 4.6 (`f1fd12c`), which built everything this story stands on. Commit convention: « Story 4.7 : <titre> », « Story 4.7 : corrections de la revue de code ». `main` only receives the merge after Geo's OK. This branch is `story/4-7-faux-sommeil`, in its worktree, with `npm ci` already done.

### Project Structure Notes

Paths follow the epic and the architecture (`content/threats/fake_sleep.json` is the epic's own name). No conflict.

### Project Context Rules

- Golden rule: the AI writes and tests, Geo tunes; everything stays playable without a human (AC 12, 15).
- Layer rules; the sim never logs; I/O returns `Result`; no silent `catch`, every fallback logs a `warn`.
- A new content file is not done until `content:check` passes. No `$schema`-less JSON, no hand-edited `_schemas`.
- UI: `t(key)` only, tokens only, `pp-` classes. Reduced rules are `:where(:root[data-pp-motion="reduced"]) <selector>`, never `@media`.
- A new `GagId` needs its consequence and its presentation (both `Record`s). A threat's success clip is exactly `resp_<response>`, its telegraph a `tel_*` clip no other shares, its gag a `gag_*` clip.
- Goldens and screenshots are regenerated deliberately, with the reason in the story; architecture tests are never weakened.

### Open points for Geo (tune or decide after playing)

1. **The fake sleep is the duel's third round** (D1), since the epic and 4.10 give it no place of its own. One line of JSON moves it.
2. **The feint keeps « ATTENDS… »** (D2): only the glyph, the sound and a lighter vibration change. If everyone sees through it, a shorter glance or a closer sound makes it meaner.
3. **A late press on the fake sleep also cries** (D6), not only a press on the feint.
4. **The noise is +4 %** (a 2 s cry). The GDD does not price it (L216). `gagCryMs` tunes it.
5. **No bot falls for the feint.** `human` reacts to the real signal only, so the numbers will not tell how hard it is: only playing will. 4.10's playtest metrics are the measure.
6. **The tuning is a guess:** feint at 1.2-2.6 s, signal at 3.5-7 s, at least 0.9 s between them. The round is the duel's longest, about 30 s for the whole duel.
7. **The baby does not sit up on screen** until E7: « le bébé se relève » is a sound, a cue and the marker. Same for the half-open eye: a glyph, not the baby's face.

### References

- [Source: _bmad-output/planning-artifacts/epics.md L1807-1809, L1958-1978, L2041]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md L135, L198, L216, L305, L353-355]
- [Source: _bmad-output/planning-artifacts/game-architecture.md L222, L738-744, L967]
- [Source: _bmad-output/project-context.md (The Wait response and the bedtime duel, The noise gauge, Time & input judgement, Testing)]
- [Source: _bmad-output/implementation-artifacts/4-6-duel-du-coucher-reponse-attendre.md (Decisions, Review Findings); deferred-work.md L772-794]
- [Source: src/sim/threats/*, src/sim/sequences/bedtimeDuel.ts, src/sim/snapshot.ts, src/sim/baby/{babySystem,cry}.ts, src/content/schemas/threat.ts, src/client/ui/world/threatMarkers.ts, src/client/feedback/threatFeedback.ts, src/bots/{humanBot,perfectBot}.ts, tools/content/contentChecks.ts, tests/threats/threatCatalog.test.ts, tests/e2e/bedtimeDuel.spec.ts]

## Dev Agent Record

### Agent Model Used

Not recorded here (the story file is a repo artifact).

### Debug Log References

- Environment: `VITE_DEBUG_ALLOWED=false` was exported in the shell; every `vitest` / `playwright` / `ci` run was started with it unset (`env -u …` or a subshell).
- **The slow and red runs were the Mac going to sleep, not the code and not the load.** `pmset -g log` shows 20 sleeps from noon on (15:28 to 15:44 for one), with `sleep 1` in the power settings: a background run does not keep it awake once the agent's turn ends. Hence tests with a 30 s timeout failing after 2 to 5 minutes, by groups of one per worker, a first `npx vitest run src tests` over 10 minutes, `carryFuzz.test.ts` on its 5 s timeout, `page.goto` timeouts, and a first CI killed at its 1 h limit. Each of those tests passes alone in seconds. Attributing it to load or to a cold Vite server, as first reported, was wrong. Long runs now go under `caffeinate -i -s`.
- The worktree guard refuses a `heredoc` appended to a file and some compound commands: the edits went through the edit tools.

### Completion Notes List

- **The feint in the sim (AC 1-4, 11).** `threat.ts` gains `feint` (`minDelayMs`, `maxDelayMs`, `minGapMs`, `icon`) and `feedback.feint`, both refused off a `wait` and required together; the schema refuses `maxDelayMs < minDelayMs` and `maxDelayMs + minGapMs > minDelayMs` (both at `feint.maxDelayMs`, one issue per path). `THREAT_ICONS` gains `peek`. `telegraphThreat` takes the signal's draw into a local, then draws the feint's second (`feintDelayMs`); a `wait` with no feint still draws one float, any other def none. `ThreatInstance.feintAt` / `isFeintGiven`, `giveFeint`, `WaitFeintGiven` (sorted right before `WaitSignalGiven`), cleared by rearm / cancel / hide. Snapshot **v24** with the `threatProblem` checks; one rejection test per field and a round trip taken before the feint and after it (no second `WaitFeintGiven`), continued to the end on both copies with events and hashes compared.
- **Judgement: no code, only proof (AC 4).** `pressThreat` is untouched. `fakeSleep.test.ts` proves a press before the feint, at `feintAt` exactly, one step after, one ms before the signal and one stamped before the signal that arrives after it are each an `early` gag (with `earlyPress` `guard` and `fail`), and a press in the window after a given feint is judged exactly as `judgePress` says, same quality and `offsetMs`.
- **The fake sleep in the duel (AC 7-10).** `content/threats/fake_sleep.json`, `bedtime_duel.json`'s third step now `fake_sleep` (`durationMs` 10 000: the minimum is 9 510), the `baby_sat_up` gag (sim and `render/gags.ts`), the three cues, and three placeholder clips (`tel_fake_sleep`, `baby_eye_peek`, `gag_baby_sat_up`, seeds `SEED + 32` to `+ 34` after reading every `SEED +`: 31 was the highest). Only the three new `.m4a` were committed. `tel_fake_sleep`'s wave is two pulses (400 ms apart, 500 ms long) because a twin-wave test refuses a telegraph that shares size, pulses and duration with `tel_bedtime_eyes`. **Noise** is `gagCryMs` 2000: proved on a carried baby (2 `BabyCrying`, `noisePct` up by `2 × perSec` less the decay, none in a level without `gauges.noise`), for `early` and `late` alike, and a test pins that the earliest signal after a gag is later than the cry on the frozen defs.
- **The client (AC 5-6).** The marker reads `threat.isFeintGiven` only; one glyph is composed from `isSignalShown` and `isFeintShown` and written, with the `pp-threat--feint` class, only when either changes; the verb stays « ATTENDS… » until the signal. `ui.css` has a 180 ms tilt for the feint and its reduced-motion rule. `threatCueOf` plays `feedback.feint`; `content:check` (`checkThreatFeint`) requires audio, visual and haptic on it and a haptic and a clip different from the signal's (one test each in `tests/content/checkFakeSleep.test.ts`). **A deliberate difference from the story:** `ThreatMarkerDef` takes `feint?: { icon }` (a `ThreatDef` is assigned to it as it is, with no mapping) and `ThreatMarkerEntry` carries `feintIcon`.
- **The peek glyph was redrawn after looking at it.** The first path (small, mostly ink) read as two dark smudges at the marker's size; the final one is a shut eye (a curve) beside an almond under a drooping lid with its iris cut in half. Rendered next to `eyes` and `eyelids` at 150 and 52 px, and looked at in the 667 × 375 screenshots (`fake-sleep-before`, `-feint`, `-signal`): three clearly different glyphs, though at the real marker size the peek is small, two dark marks beside the eyes' big white eye. In those frames the « PARADE PARFAITE » banner of the round just won stays up (the loop is frozen) and covers the verb; the glyphs are not covered. A placeholder: E7 draws the final one.
- **Bots (AC 12).** `perfect` and `human`: no code (a comment on `humanBot.ts` says it never falls for the feint and says nothing of how hard it is). `tests/bots/waitBots.test.ts`: `perfect` is perfect with offset 0 on the fake sleep, `human` never presses before the signal over 40 seeds (and the feint did come in each), and its first press is the first of its own draws. `simReport`'s `duelDefs` already held every def the live sequences name (`duelDefIdsOf` is now exported and pinned: `bedtime_eyes` and `fake_sleep`).
- **Generated tests (AC 13).** `fake_sleep` joined `threatCatalog.test.ts` through the live duel at each tier with no edit; the `def.feint` block proves one `WaitFeintGiven` before the signal at the first step at or after `feintAt` with a gap of at least `minGapMs − STEP_MS`, an `early` gag for a press at the feint with `earlyPress` `fail` and `guard`, and a success for a press in the window. **The draws:** the step that starts a sequence draws one float of its own for every def (not the threat's), so the test pins the difference: a def with a feint draws exactly one float more than a wait with none, at every tier.
- **Tests (AC 14).** New: `fakeSleep.test.ts` (draws at the exact ms of a collapsed range, spread over 400 states, the feint at least `minGapMs` before the signal over 500 states, events, judging, noise), `fakeSleepDuel.test.ts` (won through the feint; a press on it retreats to step 1 with `reason: "early"`, counts, cries, costs the combo; the eyes' round after it has no feint; one instance per def and the right indices with and without the micro-sleep; a restarted round has a fresh feint; a level end mid-round closes it), `fakeSleepSnapshot.test.ts`, `fakeSleepDuelFuzz.test.ts` (30 seeds with a mix of sensible and wild presses: a wild-only fuzz never got past the eyes; the aggregate requires a feint given, a retreat, an `early` `baby_sat_up` gag and an end), `fakeSleepSchema.test.ts`, `checkFakeSleep.test.ts`, the marker tests in `waitMarker.test.ts`, `waitFeedback.test.ts`, `bedtimeClips.test.ts`, `duelSequence.test.ts` (frozen `fake_sleep_duel`: `perfect` and `idle` over seeds 1 to 5, `human` over 10 runs).
- **Goldens (AC 15, deliberate).** `npm run golden:update`: the 13 existing journals moved **only** in `worldHash` (the world has two new fields; 13 lines changed, every one a `worldHash`, no command and no event line), diffed and formatted with biome. New scenarios `fake_sleep_won` (ends `succeeded` at 11 820 ms) and `fake_sleep_feint_pressed` (a tap on the feint at 8 738, a retreat, ends `succeeded` at 19 290 ms), whole-ms stamps from the draws of seed 48, pinned by `tests/golden/fakeSleep.test.ts`.
- **Bot tables (AC 15), `salon_crawler`, seed 1, 20 runs, `main` against the branch.** `perfect`, `human` and `idle` are identical in stars, end reasons, success rate, score, gags and every per-run field; only the hashes move. `random` moves, as predicted:

  | bot | mean stars | star counts (0-5) | ends (timer / Mama woke) | success % | mean score | gags |
  |---|---|---|---|---|---|---|
  | perfect, `main` and branch | 5 | 0 0 0 0 0 20 | 20 / 0 | 100 | 90 | 0 |
  | human, `main` and branch | 4 | 0 0 0 1 18 1 | 20 / 0 | 99.9 | 82.1 | 1 |
  | idle, `main` and branch | 1 | 0 20 0 0 0 0 | 20 / 0 | 0 | 20 | 762 |
  | random, `main` | 1 | 0 20 0 0 0 0 | 20 / 0 | 2.4 | 20.1 | 759 |
  | random, branch | 1 | 0 20 0 0 0 0 | 20 / 0 | 1.2 | 20 | 766 |
  | random, branch with the third step put back to `bedtime_eyes` | 1 | 0 20 0 0 0 0 | 20 / 0 | 2.4 | 20.1 | 759 |

  **The cause of `random` is proved:** with the duel's third step temporarily back on `bedtime_eyes` (restored right after; `git diff` shows only the intended line), `random` matches `main` run by run (hash aside). It draws `nextInt(rng, 0, world.threats.length)` and the level has one more threat instance.
- **The duel table (AC 15), `--sequence bedtime_duel --sequence-at-ms 5000`, 20 runs, the live content on the branch.** `perfect` wins 20 of 20 with no retreat and every response `perfect` (40 eyes, 20 fake sleep); `idle` loses 20 of 20 at its third failure on the eyes and never reaches the fake sleep; `human` wins 20 of 20 with 3 retreats in all (2 `late` on the fake sleep, none `early`: it never falls for the feint); `random` loses 20 of 20.

  | bot | started | won | lost | retreats | `bedtime_eyes` | `fake_sleep` | gags |
  |---|---|---|---|---|---|---|---|
  | perfect | 20 | 20 | 0 | 0 | 40 resp (40 P) | 20 resp (20 P) | 0 |
  | human | 20 | 20 | 0 | 3 | 44 resp (6 P, 37 S, 1 F late) | 22 resp (5 P, 15 S, 2 F late) | 5 (`baby_sat_up` 2, `baby_eyes_reopened` 1, `arms_wail` 1, `papa_asleep` 1) |
  | random | 20 | 0 | 20 | 40 | 61 resp (1 P, 1 S, 59 F: 16 early, 42 late) | 1 resp (1 F late) | 603 |
  | idle | 20 | 0 | 20 | 40 | 60 resp (60 F late) | none | 460 |

  `human` wins every time, so the fake sleep costs it two failures in 22 rounds and says nothing of how hard the feint is for a player (open point 5).
- **End to end (AC 16).** `tests/e2e/fakeSleep.spec.ts` (9 tests, chromium and webkit, both green; 1.2 min each) on the helpers extracted to `tests/e2e/support/duel.ts` and shared with `bedtimeDuel.spec.ts` (which only lost its local copies; `untilTelegraphed` now steps 200 ms at a time, well under the 2.8 s a round takes to its signal). Before the feint the eyes glyph and « ATTENDS… »; after `feintAt` the `peek` glyph, the class, the verb unchanged, `fake_sleep_eye_peeks` in the cue log and its vibration (Chromium); a real tap on the feint gags with `gag_baby_sat_up`, one retreat, back at step 1, more noise after the cry's first tick; a real tap after the signal and Space win; `?autoplay=perfect` wins with one feint; the marker at 667 × 375, under reduced motion (animation `none`) and with the `sfx` bus at 0. `bedtimeDuel.spec.ts` needed no assertion change (its rounds are the first two, the eyes). No screenshot reference moved (`autoplay.spec.ts` run).
- **Docs (AC 17).** `project-context.md`: « The fake sleep (story 4.7, snapshot version 24) » after 4.6's paragraph, and `snapshot version 24` in the `loadContent()` line. `deferred-work.md`: the open points. The architecture and the GDD are untouched.
- **CI (AC 18).** `caffeinate -i -s npm run ci`, with `VITE_DEBUG_ALLOWED` unset, is green (exit 0): `e2e` 668 passed, 2 skipped, in 10.1 min; `e2e:dist` 10 passed; `perf.spec.ts` passed; both `dist:check`; statement coverage 98.09 % over all files covered. The run before it had one failure, `settings.spec.ts:300`, **a flake already on `main`** (6 failures in 20 repeats on an export of `main`, 5 in 20 on the branch): it read `difficultyTier` right after seeing the command in the journal, before the sim's next step. It now polls for the same value (20 of 20). Not this story's code, fixed here because the CI has to be green.
- **To say plainly.** The `ui.css` lint reports two *warnings* (`noDescendingSpecificity`, on the beat ring's rules around line 1646); the same two are on `main`. The webkit run of `fakeSleep.spec.ts` and the screenshots predate the removal of a needless 90 s timeout from that spec; the CI covers it since. The first screenshots are looked at on Chromium only.

### File List

**New:** `content/threats/fake_sleep.json`; `public/assets/audio/{tel_fake_sleep,baby_eye_peek,gag_baby_sat_up}.m4a`; `src/sim/threats/fakeSleep.test.ts`; `src/sim/sequences/{fakeSleepDuel,fakeSleepDuelFuzz,fakeSleepSnapshot}.test.ts`; `tests/support/{testFakeSleep.threat,testFakeSleepDuel.sequence}.json`; `tests/content/{fakeSleepSchema,checkFakeSleep}.test.ts`; `tests/golden/fakeSleep.test.ts`; `tests/golden/journals/{fake_sleep_won,fake_sleep_feint_pressed}{,.expected}.json`; `tests/e2e/fakeSleep.spec.ts`; `tests/e2e/support/duel.ts`.

**Modified:** `content/{feedback.json,sequences/bedtime_duel.json,_schemas/threat.schema.json}`; `src/content/schemas/threat.ts`; `src/sim/{world,events,createSim,snapshot}.ts`; `src/sim/threats/{threatFsm,threatSystem,gags}.ts`; `src/bots/humanBot.ts`; `src/client/feedback/threatFeedback.ts`; `src/client/render/gags.ts`; `src/client/ui/world/threatMarkers.ts`; `src/client/ui/styles/ui.css`; `tools/audio/makePlaceholderAudio.ts`; `tools/content/contentChecks.ts`; `tools/sim/runSim.ts` (`duelDefIdsOf` exported); tests: `src/sim/{createSim,events,snapshot}.test.ts`, `src/sim/sequences/{duelSnapshot,sequenceSnapshot}.test.ts`, `src/sim/threats/{gags,threatFsm,inputLag}.test.ts`, `src/bots/threatTiming.test.ts`, `src/client/input/autoTarget.test.ts`, `src/client/feedback/waitFeedback.test.ts`, `src/client/ui/world/waitMarker.test.ts`, `tests/support/testContent.ts`, `tests/bots/waitBots.test.ts`, `tests/content/{checkDuel,loadLevelContent}.test.ts`, `tests/threats/threatCatalog.test.ts`, `tests/tools/audio/bedtimeClips.test.ts`, `tests/tools/sim/duelSequence.test.ts`, `tests/golden/scenarios.ts`, `tests/golden/journals/*.expected.json` (13 existing, `worldHash` only), `tests/e2e/bedtimeDuel.spec.ts`, `tests/e2e/threats.spec.ts` (the world's threat list gains `fake_sleep`), `tests/e2e/settings.spec.ts` (a flake of `main`: polls for the tier); docs: `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml,4-7-faux-sommeil.md}`.

## Change Log

| Date | Change |
|---|---|
| 2026-10-31 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
| 2026-10-31 | Implemented (`gds-dev-story`): the feint, the fake sleep as the duel's third round, snapshot v24, goldens regenerated deliberately (`worldHash` only) plus two scenarios. Full CI green under `caffeinate`. Status `review`. |
