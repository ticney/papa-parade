---
baseline_commit: 8e1573caccd3497c0eae4bf0f881b1dc3de48401
---

# Story 1.21: The Suspicious Silence

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.21 « Le silence suspect » (L1088-1116). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want to understand that something is up when the baby disappears and goes quiet,
so that I go and find him before the mischief.

**Requirements covered:**
- FR28: the suspicious silence, a threat. A 2 s delay; find the baby, then Parry. Its gag is a surprise mischief drawn at random.
- FR19: the silence as a telegraph. When the baby is out of sight and stops babbling for more than 2 s, the music cuts, a « … » bubble blinks at the screen edge and a short vibration plays.
- FR12, the baby part: a tap on the baby, outside any threat, « finds » him during a silence. Space / A near him does the same. Taking him in the arms is story 4.1, not this one.
- UX-DR12: the `silence-bubble` sits at the screen edge, on the side of the zone, and never blinks faster than 3 Hz.

**Sources:**
- Epics `epics.md`:
  - L1088-1116: the story itself.
  - L42 (FR12), L52 (FR19), L64 (FR28), L124 (FR60: the music cuts during a silence), L237 (UX-DR12).
  - L1281-1284: story 2.3 gives the silence a distinct `tel_*` sound.
  - L1381-1383: story 2.6 keeps this story's music cut on `SilenceStarted` and brings it back on `SilenceEnded`.
  - L1826: story 4.1 reuses `TapBaby` to take the baby.
- GDD (`gdds/gdd-papa-parade-2026-10-26/gdd.md`):
  - L44 and L440: the baby's sounds inform, and the silence is an alert.
  - L176 (mechanic 8): « Quand il sort du champ de vision et que le babillage s'arrête plus de 2 s, la musique se coupe… une bulle « … » clignotante au bord de l'écran, et une vibration courte ».
  - L214: « Prendre le bébé, le trouver (silence suspect) | Tap sur le bébé, hors menace en cours | Espace près du bébé | A près du bébé ».
  - L239: « Silence suspect | Babillage coupé, musique coupée, bulle « … » | 2 s | Trouver le bébé, puis Parer | 300 ms | Bêtise surprise tirée au hasard ».
  - L444: the adaptive music cuts during suspicious silences.
- Architecture (`game-architecture.md`):
  - L68, L104: the baby AI owns babble and silence.
  - L221: `TapBaby{t}` is in the command list.
  - L252, L400, L410: `SilenceStarted` is a domain event.
  - L274: the baby FSM has `mischiefSilent`.
  - **L778-785 (P4, « Le silence comme télégraphe »): the source of truth for the sim and client split.**
  - L488: `src/sim/baby/` holds the silence. L537: `content/threats/silence_mischief.json`.
  - L643: `ZONE_hidden_<name>` marks a zone out of sight. Example: `ZONE_hidden_behind_sofa`.
  - L942: the E1 row « Silence suspect | `src/sim/baby/babble.ts`, `ZONE_hidden_*`, `feedback.json` | P4 ».
  - L1018: the level example puts `{ "def": "silence_mischief", "anchor": "behind_sofa" }` in wave 2.
- UX:
  - `DESIGN.md` L246-251 (`silence-bubble` tokens: `alert` fill, `ink` glyph and outline, `maxFlashHz: 3`, `reducedMotionPulseHz: 1`), L393 and L540.
  - `EXPERIENCE.md`:
    - L123: tier 1, always at full opacity.
    - L163: the « … » string.
    - L218: it appears with the music cut and a short vibration, and goes on `SilenceEnded`.
    - L295: muted, the bubble still shows.
    - L375: it is **screen-anchored, non-diegetic**, inside `{spacing.hud-inset}`.
    - L436: under reduced motion, a slow pulse of 1 Hz or less.
  - `mockups/key-hud-level.html` state C (L86-89, L251-273):
    - a 76 × 58 px `alert` bubble with an `ink` outline and a 40 px « … »;
    - its tail points out to the edge;
    - right edge, `right: hud-inset-r + 14px`, vertically mid-screen, below the HUD band.
- Previous stories:
  - 1.8: `babbling` is « true unless a silent mischief clears it ».
  - 1.9: the babble loop follows `world.baby.babbling` every frame (`boot.ts` › `onLevelFrame`).
  - 1.17: the context action.
  - 1.18: the director, waves, `isThreatActive`, `isLastOfWave`.
  - 1.19: busy Papa.
  - 1.20: `StartDisruption`, the e2e and headless patterns.
- `deferred-work.md`:
  - L93: zones reach the sim in 1.21.
  - L115: the baby in the hit test.
  - L131: hidden zones in wander.

**Downstream consumers. Design for them; none of them may need to change this story's code beyond adding their own case:**
- **2.3 (sounds):** replaces the placeholder clips `tel_silence_found` and `gag_silence_mischief`. No code change.
- **2.6 (adaptive music):** « la musique se coupe (comportement de la story 1.21 conservé), et reprend sur `SilenceEnded` ». It replaces the music loop with stems and keeps reading the same silence state (D7).
- **4.1 (take the baby):** `TapBaby` near the baby takes him. Today, outside a silence, `TapBaby` only walks Papa to the baby (D9). 4.1 changes that branch of `runPapa`, not the silence.
- **1.22 (Mama's score):** may count `world.mess.mischiefs` in the Sigh (D11). The silence's gags emit no `NearMiss`.
- **E2/E6:** a second hidden zone in another level is a second wave entry with another `ZONE_hidden_*`. No code change.

## Precondition (check first, stop if it fails)

1. Story 1.20 is `done`, with its review fixes committed.
   - When this story was written, 1.20 was `review` (implementation commit `0ae0b15`) and the tree was clean.
   - If `sprint-status.yaml` says anything but `done` for 1.20, or `git status` shows anything outside `_bmad-output/`, stop and tell Geo. The review may have moved files this story edits.
2. Re-read the files that 1.20 and its review changed before you edit them: `createSim.ts`, `snapshot.ts`, `events.ts`, `commands.ts`, `world.ts`, `context.ts`, `step.ts`, `papaSystem.ts`, `feedbackDirector.ts`, `boot.ts`, `simReport.ts`, `contentChecks.ts`, `level.ts`, `testContent.ts` and `tests/e2e/support/game.ts`. The excerpts in the Dev Notes are from commit `0ae0b15`.
3. Run `env | grep VITE_`. The agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap).
4. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish.
   - **Do not edit anything while it runs.**
   - Note the unit and e2e counts in the Debug Log.
   - If the baseline is red, stop and say so.
   - Under heavy load, use `--maxWorkers=5` / `--workers=4` and say so (1.20 Debug Log).

## Acceptance Criteria

1. **Content: the threat def.**
   - `content/threats/silence_mischief.json` is validated by `ThreatDefSchema`, which becomes a union on `target` (D2):
     - `anchor` and `papa` keep today's fields;
     - `hiddenZone` replaces `gag` with `surpriseGags`, a non-empty array of gag ids, and adds `findMaxMs`.
   - The file:
     ```json
     {
       "$schema": "../_schemas/threat.schema.json",
       "id": "silence_mischief",
       "target": "hiddenZone",
       "response": "parry",
       "telegraphDelayMs": 800,
       "windowMs": null,
       "findMaxMs": 5000,
       "surpriseGags": ["tissues_everywhere", "crayon_scribbles"],
       "icon": "dots",
       "feedback": {
         "telegraph": "tel_silence_found",
         "success": "resp_parry",
         "perfect": "resp_parry_perfect",
         "gag": "gag_silence_mischief"
       },
       "cooldownMs": 6000
     }
     ```
   - `feel.json › baby` gains:
     - `silenceAlertMs` (2000): how long the hidden baby stays quiet before `SilenceStarted`;
     - `sneakSpeedMps` (1.2): how fast it crawls to the zone.
   - Every value is in the JSON, none in the code.
2. **Content: the wave entry.**
   - `salon_crawler.json` wave 2 gets `{ "def": "silence_mischief", "anchor": "behind_sofa" }` (architecture L1018).
   - For a `hiddenZone` def, the entry's `anchor` names a **`ZONE_hidden_*` zone** of the geometry, not an `ANCHOR_*` (D3).
   - `content:check` names the file, the JSON path and the culprit for each of these:
     - a `hiddenZone` entry whose `anchor` is not a zone of kind `hidden`;
     - an `anchor` / `papa` entry whose `anchor` is a zone;
     - a `surpriseGags` entry that is not in `GAG_IDS`, or is `papa_asleep`.
   - `createSim` refuses the same, with an `invariant`, in the same wording.
   - `createSim` also refuses a hidden zone where the **baby's** grid or **Papa's** grid has no open cell inside the zone box, in the region of the agent's spawn (D3).
3. **The director picks a silence.** A `hiddenZone` threat is drawn like any other: same pool, same `world.rng` draws, same `maxSimultaneous`. Two exceptions:
   - it is a candidate only while the baby is free: `wander` or `babble`, no `targetThreatId`, and no silence under way;
   - picking it does not telegraph it. `hideThreat` puts it `idle → hidden` (a new `ThreatState`) and emits `ThreatHidden{t, threatId, kind, anchorId, waveIndex}`. A `hidden` threat has no window and no marker, and cannot be pressed.

   `isThreatActive` counts `hidden`, so a silence counts against `maxSimultaneous` and `isLastOfWave`.
4. **The baby hides.**
   - In the step the threat is `hidden`, `runBaby` takes it:
     - `world.silence.threatId = id` and `baby.targetThreatId = id`;
     - `BabyStateChanged → mischiefSilent`;
     - a path to the threat's point (the zone cell, D3), crawled at `feel.baby.sneakSpeedMps`.
   - On arrival in the zone box (x and z):
     - `babbling = false` (the babble loop stops: the sound telegraph);
     - `world.silence.zoneEnteredAt = now`.
   - At the first step where `now ≥ zoneEnteredAt + silenceAlertMs`, the sim emits `SilenceStarted{t, threatId}` and sets `world.silence.startedAt`.
   - The baby never locks on another threat while `mischiefSilent`.
5. **Feedback of the silence.**
   - `SilenceStarted` is mapped in `feedback.json › events` to the cue `silence_started`: a `light` haptic, **no audio, no visual**. A sound would break the silence, and the bubble is the visual.
   - While `world.silence.startedAt !== null` and the flow is `playing`, the client keeps:
     - **the music loop off**: the new `audio.setMusicMuted(true)`, edge-triggered per frame like `setBabbling` (D7);
     - **the `silence-bubble` shown**: a DOM element of the HUD layer, at the left or right screen edge on the side of the zone's projected point, vertically at that point clamped below the HUD row and above the bottom third, `{colors.alert}` fill, `{colors.ink}` « … » and outline, its tail pointing to the edge.
   - The bubble blinks at 2 Hz (under the 3 Hz ceiling). Under `prefers-reduced-motion: reduce`, it pulses at 1 Hz or slower, with no on/off flash.
   - It is hidden while paused (the HUD is) and once the level has ended.
6. **`TapBaby` in the client (D8).**
   - **Touch:** the hit test gains `pickBaby`: the baby's centre (at `feel.baby.bodyRadiusM` height), projected like an icon, within `objectTouchRadiusPx`.
     - `inputMapper` tries it **after the threats and before the objects** (threat > baby > object > floor), and sends `TapBaby{t}`.
     - The tap marker shows at the baby's floor point.
   - **Space / A with no threat targeted:** the context action takes the nearer of the baby (within `contextReachM` of Papa) and the context object, and sends `TapBaby{t}` or `TapObject` (ties go to the baby).
   - The busy gate covers `TapBaby` like every other command.
7. **`TapBaby` in the sim.**
   - `TapBaby{t}` is a new command (in `COMMAND_TYPES`, checked by `commandProblem`, journaled).
   - **Outside a started silence:** `runPapa` walks Papa to the baby's current floor point, exactly as `TapFloor` there would (D9). It is ignored while Papa is busy.
   - 4.1 replaces this branch with « take the baby ».
8. **Finding the baby.**
   - While `world.silence.startedAt !== null`, the baby is found at the first step where either:
     - Papa's point is inside the zone box; or
     - a `TapBaby` is applied in that step, and Papa is not busy.
   - Then, in this order:
     - `SilenceEnded{t, threatId, reason: 'found'}`;
     - `babbling = true`;
     - `world.silence` cleared;
     - the baby goes `targetLocked` on the threat;
     - the threat is revealed with `telegraphThreat` (`hidden → telegraph`, `ThreatTelegraphed`, its window opens `telegraphDelayMs` later; D4).
   - From there it is parried like any other threat: marker, press, glide, judgement, cooldown. The music comes back with `startedAt` cleared.
9. **Not found in time.**
   - At the first step where `now ≥ startedAt + findMaxMs` with no find, the sim emits `SilenceEnded{reason: 'timedOut'}`.
   - Then `babbling = true` and `world.silence` is cleared.
   - Then `gagThreat(..., 'late', null)`: `ResponseResolved{fail, reason: 'late', offsetMs: null}` and `GagTriggered{gag}`.
   - `gag` is drawn from `surpriseGags` with **one** `nextFloat(world.rng)` (D5).
   - A find and the deadline in the same step: the find wins.
   - Any gag of a `hiddenZone` def is drawn the same way, a missed parry after the reveal too.
   - The surprise gags add one to `world.mess.mischiefs` (D11) and emit no `NearMiss`.
10. **Debug command.** `ForceThreat{t, threatId}` makes the director pick that idle threat now, through the same helper as a draw: a `hidden` for a `hiddenZone` def, a telegraph otherwise. It ignores gaps, `maxSimultaneous` and the lull.
    - It is ignored with no event when:
      - the threat is not `idle`;
      - the id is unknown;
      - the threat is a `papa` target;
      - it is a `hiddenZone` and the baby is not free.
    - The `waveIndex` is `director.waveIndex`.
    - It is journaled like `StartDisruption`, checked by `commandProblem` (an integer ≥ 1) and applied by `runDirector`. The e2e and Geo use it.
11. **Bots.**
    - `perfect` sends `TapBaby` at the first step it sees a started silence it has not tapped for yet.
    - `human` sends it `settings.human.reactionMs` after `startedAt`.
    - `random` and `idle` never find the baby.
    - Bots read `world.silence` through `@sim` (export `SilenceSlice`). No bot touches `world.rng`.
12. **Headless check.** `tests/tools/sim/silence.test.ts` plays the **live** `salon_crawler` for the level's duration over 3 seeds, once with `idle` and once with `perfect`.
    - **Both bots, for every `ThreatHidden` of `silence_mischief`:**
      - `mischiefSilent`;
      - `SilenceStarted` exactly `silenceAlertMs` after the zone entry (to the step).
    - **`idle`:**
      - `SilenceEnded{timedOut}` at `startedAt + findMaxMs` (to the step);
      - a `GagTriggered` whose `gag` is in `surpriseGags`.
    - **`perfect`:**
      - `SilenceEnded{found}` within one step of `SilenceStarted`;
      - then a `ResponseResolved{perfect}` for that threat.
    - At least one silence over the three seeds, per bot.
    - Every bound is read from the live content, the live feel and `STEP_MS`.
13. **CLI report.** The report gains these counters, summed over the runs:
    - `silences` (`SilenceStarted`);
    - `silencesFound` (`SilenceEnded{found}`);
    - `silencesTimedOut` (`SilenceEnded{timedOut}`).

    The per-def stats still add up for a threat that was resolved without a `ThreatTelegraphed` (a silence never found). 1.18's, 1.19's and 1.20's live tests still pass.
14. **Tests, goldens, CI.**
    - The tests of § Testing pass.
    - Golden levels plan no silence, so `eventTypes` and `eventsHash` of all six scenarios stay **identical**. `worldHash` (`world.silence`, `mess.mischiefs`) may move; `levelHash` should not. Regenerate with `npm run golden:update` and say so.
    - The screenshot references should not move: the silence is only in wave 2, and the bubble is hidden. If they do, find out why before regenerating.
    - Coverage of `src/sim` stays ≥ 90 %.
    - `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T0 — Precondition** (§ Precondition). Record the baseline CI and the counts in the Debug Log.
- [x] **T1 — Content** (AC 1, 2, 5)
  - [x] `src/content/schemas/threat.ts`:
    - `THREAT_TARGETS` gains `'hiddenZone'`; `THREAT_ICONS` gains `'dots'`.
    - Split `ThreatDefSchema` into a shared base and two strict variants: `target: z.enum(['anchor', 'papa'])` with `gag`, and `target: z.literal('hiddenZone')` with `findMaxMs` (> 0, « from `SilenceStarted` to the surprise mischief, in sim ms ») and `surpriseGags` (`z.array(idSchema).min(1)`).
    - Join them with `z.discriminatedUnion('target', …)`. If Zod 4 refuses an enum discriminator, use three variants (one per target).
    - Export `ThreatDef` (the union), plus `HiddenZoneThreatDef` and `ThreatGagIds(def)` → `readonly string[]` (`[def.gag]` or `def.surpriseGags`), so that callers stop reading `def.gag` directly.
    - `.describe` everything with its unit.
  - [x] `src/content/schemas/feel.ts` › `BabySchema`: `silenceAlertMs` (int > 0) and `sneakSpeedMps` (> 0, ≤ `MAX_CRAWL_SPEED_MPS` if the other speeds are bounded so), both described. `content/feel.json`: 2000 and 1.2.
  - [x] `content/threats/silence_mischief.json` (AC 1); `content/levels/salon_crawler.json` wave 2 (AC 2).
  - [x] `content/feedback.json`, cues:
    - `silence_started`: `{ "haptic": "light" }` only, mapped in `events` as `"SilenceStarted": "silence_started"`;
    - `tel_silence_found`: audio sfx, `soundWave` `threat` about 0.8 m / 400 ms, `light`;
    - `gag_silence_mischief`: audio sfx, `soundWave` `threat` 1.0 m / 500 ms, `heavy`.
  - [x] `content/strings.fr.json`: `hud.silence_bubble` « … » and `hud.silence_bubble_label` « Silence » (the aria label; `EXPERIENCE.md` L163). Match the existing `hud.*` keys.
  - [x] `tools/content/contentChecks.ts`:
    - `checkThreatReferences` checks each id of `ThreatGagIds(def)` against `GAG_IDS`, and refuses `papa_asleep` in `surpriseGags`;
    - `checkLevelReferences`: a `hiddenZone` entry's `anchor` must be a `geometry.zones` entry of kind `hidden`; any other entry's `anchor` must be a `geometry.anchors` entry (today's message);
    - tests in `tests/content/checkContent.test.ts` and `tests/content/threatSchema.test.ts` (or the existing threat-schema test file).
  - [x] `npm run content:schemas`; commit `content/_schemas/{threat,feel,feedback}.schema.json` (and `level` if it moves).
- [x] **T2 — Sim: plan, world, snapshot** (AC 2-4)
  - [x] `src/sim/context.ts` › `SimPlannedThreat` gains `zone: SimHiddenZone | null`. `SimHiddenZone` is `{ id; centerXM; centerZM; halfXM; halfZM }` from the geometry box; non-null exactly for a `hiddenZone` def.
  - [x] `src/sim/createSim.ts`:
    - `simLevelOf` resolves a `hiddenZone` entry against `geometry.zones` (kind `hidden`), not `anchors`. It keeps the duplicate rule (a zone planned twice is refused like an anchor). It uses the gag wording of `content:check` for every id of `ThreatGagIds`.
    - The threat instance's `xM` / `zM` is the **centre of the open baby cell inside the zone box nearest the zone's centre**, in the baby's spawn region. None means an invariant.
    - Papa's grid needs one open cell inside the box, in Papa's spawn region. None means an invariant too: « papa entre dans la zone » must be possible.
    - Extend `checkReachable` and use the same wording in `content:check` where it can be checked statically. The nav grid cannot be checked there; the sim checks it (story 1.18 D12).
  - [x] `src/sim/threats/threatFsm.ts`:
    - `ThreatState` gains `'hidden'` (and `THREAT_STATES`). Update the doc: « `hidden`: a silent mischief picked by the director; no window until the baby is found ».
    - `hideThreat(world, ctx, threat, waveIndex)`:
      - `idle → hidden`;
      - `press = null`, `responseWindow = null`, `windowOpenAt = 0`;
      - sets `waveIndex`;
      - emits `ThreatHidden`.
    - `gagThreat` draws the gag through `gagOf(world, def)`. A `hiddenZone` def does one `nextFloat`, then `surpriseGags[min(len − 1, floor(f × len))]` through `gagIdOf`. Any other def does no draw: `gagIdOf(def.gag)`.
  - [x] `src/sim/director/waveState.ts` › `isThreatActive` includes `hidden`.
  - [x] `src/sim/world.ts`:
    - `SilenceSlice { threatId: number | null; zoneEnteredAt: SimMs | null; startedAt: SimMs | null }` and `World.silence` (all null at creation);
    - `MessSlice.mischiefs: number` (0 at creation; cumulative, **not** recounted by `runPhysics`; say so in its doc and check `propsSystem.ts` does not reset it).
  - [x] `src/sim/baby/babyFsm.ts`: `BabyState` gains `'mischiefSilent'`. Update the doc, since it lists the states still to come.
  - [x] `src/sim/snapshot.ts`:
    - `version: 9`, with a comment.
    - `BABY_STATES` gains `mischiefSilent`.
    - `silenceProblem`:
      - `threatId` is null or the id of a threat that is `hidden` or `telegraph`;
      - `zoneEnteredAt` is non-null only with a `threatId`; `startedAt` is non-null only with `zoneEnteredAt`, and ≥ it;
      - the baby is `mischiefSilent` exactly while `threatId !== null`;
      - `babbling` is false exactly while `zoneEnteredAt !== null`.
    - `mess.mischiefs` is a non-negative integer.
    - The threat check accepts `hidden`, with `responseWindow === null` and `windowOpenAt === 0` there.
    - Tests.
- [x] **T3 — Sim: the silence** (AC 3-4, 7-10)
  - [x] `src/sim/director/directorSystem.ts`:
    - In the candidate count and the pick, a `hiddenZone` threat is a candidate only when the baby is free (AC 3). Use a pure helper. Keep « one `nextFloat` per gap and one per pick ».
    - The pick calls a local `startThreat(world, ctx, index, waveIndex)`: `hideThreat` for a `hiddenZone` def, `telegraphThreat` otherwise.
    - Apply this step's `ForceThreat` commands first, through the same `startThreat` (AC 10). They draw nothing.
    - Update the doc comment.
  - [x] `src/sim/baby/silence.ts` (new; architecture L942 calls it `babble.ts`, see Project Structure Notes): `runSilence(world, ctx)`, called **first** in `runBaby`, before `releaseTarget`. It does, in order:
    1. **Take:** a `hidden` threat while `world.silence.threatId === null`. Plan the path with `planApproach`; no path means an invariant (`createSim` checked it).
    2. **Sneak:** crawl `sneakSpeedMps` along the path; on arrival in the box, the zone entry of AC 4.
    3. **Alert:** at the first step where `now ≥ zoneEnteredAt + silenceAlertMs`, `SilenceStarted`.
    4. **Find:** AC 8. It reads `ctx.commands` for `TapBaby`, and `world.papa` for the box test.
    5. **Deadline:** AC 9.

    It writes the baby only through `enterBabyState` and its own fields, and the threat only through `threatFsm` helpers (`telegraphThreat`, `gagThreat`). Allocation-free (the path array is the only allocation, as in `planApproach`).
  - [x] `src/sim/baby/babySystem.ts`:
    - call `runSilence` first;
    - `lockOnThreat` skips `hidden` threats and `hiddenZone` defs;
    - the local `isActive` becomes `isThreatActive` (so `releaseTarget` keeps a `hidden` target);
    - wander and babble do nothing while `mischiefSilent`.
  - [x] `src/sim/threats/gags.ts`:
    - `GAG_IDS` gains `tissues_everywhere` and `crayon_scribbles`;
    - their consequence is `addMischief(world)`, `mess.mischiefs += 1`, a helper in `propsSystem.ts` beside the mess, or in `gags.ts`; there is no `NearMiss`.
    - Update the header comment.
  - [x] `src/sim/papa/papaSystem.ts`:
    - `TapBaby` → `tapFloor(world, ctx, baby.xM, baby.zM)` (AC 7), inside the busy `break` like the others;
    - `pressThreat` does not glide to a `hidden` threat;
    - update the header doc.
  - [x] `src/sim/events.ts`:
    - `ThreatHidden`, `SilenceStarted{t, threatId}` and `SilenceEnded{t, threatId, reason: SilenceEndReason}`, with doc comments;
    - `SilenceEndReason = 'found' | 'timedOut'`;
    - `SIM_EVENT_TYPES` stays sorted.
  - [x] `src/sim/commands.ts`: `TapBaby{t}` (gameplay) and `ForceThreat{t, threatId}` (debug), in `COMMAND_TYPES` and `commandProblem`.
  - [x] `src/sim/index.ts`: export `SilenceSlice`, `SilenceEndReason` and anything the client, bots or tools need.
  - [x] Tests: `silence.test.ts`, `babySystem.test.ts`, `directorSystem.test.ts`, `threatFsm.test.ts`, `threatSystem.test.ts`, `gags.test.ts`, `papaSystem.test.ts`, `snapshot.test.ts`, `commands.test.ts`, `events.test.ts` and `createSim.test.ts`. See § Testing.
- [x] **T4 — Client** (AC 5, 6)
  - [x] `src/client/audio/audioEngine.ts`:
    - `setMusicMuted(isMuted)`, edge-triggered and cheap per frame;
    - muting fades the music loop out (`stopLoop('music')`);
    - unmuting restarts it if `areLoopsActive`;
    - `stopLevelLoops` / `startLevelLoops` stay as they are (a level start unmutes).
    - Tests in `audioEngine.test.ts`.
  - [x] `src/client/boot.ts` › `onLevelFrame`, next to `setBabbling`: `audio.setMusicMuted(isSilent)` and `silenceBubble.update(isSilent, world)`. `isSilent` is `flow === 'playing' && world.silence.startedAt !== null`.
  - [x] `src/client/ui/hud/silenceBubble.ts` (new; `createSilenceBubble`):
    - one element, mounted in the HUD root, `pp-silence-bubble` classes, `aria-label` from `t()`;
    - `update(isSilent, world)` writes the DOM only on a change;
    - the side and the vertical position are computed **when it shows and on resize**, from the threat's point projected with the iso camera (a preallocated `Vector3`), never per frame.
    - CSS in `ui.css`: the mockup's shape and tail, mirrored for the left edge; the blink as a `steps()` opacity animation at 2 Hz; a `prefers-reduced-motion` 1 Hz pulse. Use tokens only (`--pp-color-alert`, `--pp-color-ink`, `--pp-spacing-hud-inset-*`).
    - A test (`silenceBubble.test.ts`).
  - [x] `src/client/input/hitTest.ts`: `pickBaby(clientX, clientY, rect, baby, yM, radiusPx): boolean`, allocation-free, beside `pickObject`. Update the header doc (« the baby comes with story 1.21 »).
  - [x] `src/client/input/inputMapper.ts`:
    - the pointer path tries the baby where the comment says it slots in;
    - the action path (Space / A) compares the baby with `pickContextObject`;
    - tests.
  - [x] `src/client/ui/world/threatMarkers.ts`:
    - `threatMarkerEntries` places a `hiddenZone` threat's marker at its `xM` / `zM`, at the baby's height plus the usual offset (no anchor lookup, no warning);
    - `THREAT_ICON_PATHS.dots` (three dots), with tests.
  - [x] `src/client/render/gags.ts`: `GAG_PRESENTATIONS` entries for the two new gags. All flags false, with a comment: « the gag cue's ring and sound are the show until E7; the mess is `world.mess.mischiefs` ».
  - [x] Mirrors (`boot.ts`), written on events only:
    - `ppSilence` (`on` on `SilenceStarted`, `found` / `timedOut` on `SilenceEnded`);
    - `ppBabyPx` (the baby's projected screen point, written on `SilenceStarted`, for the e2e tap);
    - delete both at level start.
  - [x] `tools/audio/makePlaceholderAudio.ts`:
    - `tel_silence_found`: a short rising « ah-ha » chirp of about 300 ms;
    - `gag_silence_mischief`: a paper-rustle noise burst of about 500 ms;
    - next `SEED + n`; update the header and the test.
    - Run `npm run assets:audio` (macOS) and **keep only the two new `.m4a`**; restore the others from git.
- [x] **T5 — Bots and CLI** (AC 11-13)
  - [x] `src/bots/perfectBot.ts`, `src/bots/humanBot.ts` (AC 11). Remember the last `startedAt` tapped, so that each silence is tapped once. Tests.
  - [x] `tools/sim/simReport.ts` (AC 13) and its tests. Check how per-def stats count a result with no `ThreatTelegraphed` before it, and count `ThreatHidden` as the pick of a silence if needed.
  - [x] `tests/tools/sim/silence.test.ts` (AC 12).
- [x] **T6 — Tests to migrate**
  - [x] `tests/support/testContent.ts`:
    - a frozen `testSilence.threat.json` (`createTestSilence()`), a `SILENCE` wave entry on `behind_sofa`, and `createTestThreats` including it;
    - check that the test geometry's `behind_sofa` is reachable by both grids. If not, fix the **test geometry**, never the invariant.
  - [x] Every place that read `def.gag` now reads `ThreatGagIds(def)` or narrows on `target`: `tsc` lists them.
  - [x] Every test that builds a `World` or a `MessSlice` literal gains `silence` / `mischiefs`.
  - [x] Never delete a test to go green. Rewrite one whose premise changed, and say so. For example, a test that says « every result follows a telegraph » is false for a silence that was never found.
- [x] **T7 — e2e** (AC 5, 6, 8, 9)
  - [x] New `tests/e2e/silence.spec.ts`: chromium + webkit, frozen with `ppLoadLevel('salon_crawler', 42)`, helpers local to the spec. The silence threat's id comes from `__PP__` state (the instance whose `defId` is `silence_mischief`), never a literal.
    - **Silence:**
      - `ppSend ForceThreat{threatId}`, then advance until `SilenceStarted`;
      - expect `ThreatHidden`, `BabyStateChanged → mischiefSilent`, `ppBabble = off`, `ppMusic = off`, `ppSilence = on`;
      - the `.pp-silence-bubble` is visible on the side of the zone (compare its box with the viewport centre and the zone's projected point), its colour is the `alert` token, and its blink keyframes are ≥ 333 ms per cycle;
      - one vibration of the `light` pattern (`recordVibrations`, chromium), and no `[feedback]` warning (`collectProblems`).
    - **Found by tap:**
      - `touchscreen.tap` on `ppBabyPx`;
      - advance; expect `SilenceEnded{found}`, `ThreatTelegraphed` for the silence threat, `ppMusic = on`, `ppBabble = on`, and the bubble hidden;
      - then press the marker in its window (frozen-time pattern of `threat.spec.ts`) and expect `ResponseResolved{success|perfect}`.
    - **Found by walking in:** `ForceThreat`, wait for `SilenceStarted`, `ppSend TapFloor` at the zone centre, advance; expect `SilenceEnded{found}` before `startedAt + findMaxMs`.
    - **Not found:** `ForceThreat`, then advance `(silenceAlertMs + findMaxMs) / STEP_MS` steps past the zone entry; expect `SilenceEnded{timedOut}` and a `GagTriggered` with a `gag` from `surpriseGags`.
    - **Reduced motion** (`page.emulateMedia({ reducedMotion: 'reduce' })`): the bubble's animation is the slow pulse.
    - Every bound comes from the live content (`content/threats/silence_mischief.json` and `feel.json`, read in `support/game.ts` beside `livePhone`).
  - [x] Check the long-running specs (`threats`, `timer`, `fatigue`, `phone`, `autoplay`, `perf`). The silence now happens in wave 2 of a live run: no assertion may assume that every threat is telegraphed when picked, that every result follows a `ThreatTelegraphed`, or that only three kinds exist.
- [x] **T8 — Goldens** (AC 14): `npm run golden:update`, then `git diff tests/golden/journals`. Only `worldHash` may move. If `eventTypes`, `eventsHash` or `levelHash` move, a system emits, draws or reshapes something on a level without silence: fix that, never the references.
- [x] **T9 — Docs and deferred work**
  - [x] `deferred-work.md`:
    - mark L93 (zones) and L115 (the baby in the hit test) resolved with « (story 1.21) »;
    - mark L131 resolved: wander may still cross hidden zones, since a babbling baby is heard and the silence needs `mischiefSilent`.
    - Add a « Deferred from: implementation of story 1-21 » section: the placeholder sounds (2.3), the music stems (2.6), a real mischief animation and a visible mess (E7), `TapBaby` walking instead of taking (4.1), the fixed `findMaxMs`, and the silence's `telegraphDelayMs` after the find.
  - [x] `_bmad-output/project-context.md`:
    - the `hidden` state and `hiddenZone` target;
    - a silence counts as active;
    - hit-test priority threat > baby > object > floor;
    - `TapBaby`;
    - the music and the bubble follow `world.silence.startedAt`.
  - [x] `sprint-status.yaml` when done.

## Dev Notes

### Decisions (D1-D12)

| # | Decision | Why |
|---|---|---|
| D1 | **The silence is a threat with a pre-phase, not a disruption.** It is drawn by the director from the wave pool, counts against `maxSimultaneous`, has a parry window and a gag. Only its telegraph is delayed until the baby is found. | GDD L239 lists it in the threat catalogue (« Délai 2 s, Fenêtre 300 ms, gag »); architecture L1018 plans it in a wave's `threats`. |
| D2 | **`ThreatDefSchema` becomes a union on `target`.** A `hiddenZone` def has `surpriseGags` and `findMaxMs` instead of `gag`. | « Bêtise surprise tirée au hasard » (GDD L239) is a list, not a gag. A flat schema with an ignored `gag` would lie. With a union, `tsc` finds every reader of `def.gag`. `ThreatGagIds` keeps the callers simple. |
| D3 | **The wave entry's `anchor` names a `ZONE_hidden_*` for a `hiddenZone` def.** The threat's point is the open baby cell inside the zone nearest its centre. `createSim` proves both agents can stand in the zone. | Architecture L1018 writes `"anchor": "behind_sofa"`. A point inside the box makes « the baby is in the zone » true on arrival by construction. Papa must be able to enter it, or « papa entre dans la zone » is dead. |
| D4 | **Found ⇒ `telegraph` with a `telegraphDelayMs` (800 ms) to the window, not `windowOpen` at once.** The epic says « la menace passe en `windowOpen` et se pare comme une autre ». A window that opens at the instant of the find (300 ms + 60 ms tolerance) cannot be anticipated: no other threat works that way. Revealing it through `telegraphThreat` gives it a marker, a telegraph cue and a normal window, which is « se pare comme une autre ». **This deviates from the epic's literal wording: say so in the Completion Notes.** | GDD L144-152: every threat has a telegraph-to-window delay of 0.8 to 1.5 s. The GDD's « Délai 2 s » for the silence is `silenceAlertMs`. Open point 1. |
| D5 | **One `nextFloat` per surprise gag, and only for a `hiddenZone` def.** | Other threats draw nothing at a gag today: goldens and live runs without a silence keep their draws. « One draw even with one entry »: the number of draws never depends on the tuning (`drawBabbleMs`, the director). |
| D6 | **The silence is a world slice (`world.silence`), run by `runSilence` inside `runBaby`.** No new system. | Architecture L581 and P4: the silence is the baby's. It needs Papa's point (read) and this step's `TapBaby` (read). It writes threats only through `threatFsm` helpers, as the director does. Order: `runBaby` runs before `runThreats`, so a found threat's telegraph and a deadline gag are visible to `runThreats` in the same step. Papa's point is from the end of the previous step (`runPapa` runs later): one step of lag, deterministic. |
| D7 | **The music cut and the bubble follow world state per frame; the vibration is the `SilenceStarted` cue.** | The babble loop already works this way (story 1.9). State-driven means a pause, a `restore`, a restart or a level end can never leave the music off or the bubble up. Story 2.6 keeps reading the same state. The epic says « quand le `FeedbackDirector` le traite… ». The director plays the vibration; the music and the bubble are the same signal, made robust. Say so. |
| D8 | **Hit test: threat > baby > object > floor. The baby is picked by its projected centre within `objectTouchRadiusPx`. Space / A take the nearer of the baby and the context object.** | Epic AC 3. A finger aims at the baby the way it aims at an object. No new feel key: Geo can split it later. |
| D9 | **Outside a started silence, `TapBaby` walks Papa to the baby.** The epic says « sans effet jusqu'à la story 4.1 ». | Until today a tap near the baby walked Papa there. Swallowing it into a no-op command would make every tap on the baby feel dead. Walking keeps today's feel and is what 4.1 starts with (« papa près du bébé »). Open point 3. |
| D10 | **The babble stops when the baby enters the zone, not when it sets off.** | GDD L176: « quand il sort du champ de vision **et** que le babillage s'arrête plus de 2 s ». Architecture P4: babbling is false and the baby is in the zone for `silenceAlertMs`. Stopping on arrival makes the sound cut mean « out of sight ». |
| D11 | **Two new surprise gags, `tissues_everywhere` and `crayon_scribbles`, each `mess.mischiefs += 1`, no `NearMiss`.** | « (gag, bazar) »: a mischief is mess, not a near accident. A cumulative counter lets 1.22 add it to the Sigh (its AC counts objects on the floor and broken; Open point 4). The presentation is the gag cue until E7. |
| D12 | **`ForceThreat` is generic** (any idle threat), not a « start silence » command. | The e2e needs a silence on demand. Every later threat story needs the same, and the director's helper already decides how a threat starts. |

### Current state of the files this story changes (read before editing)

- **`src/sim/baby/babySystem.ts`** (`0ae0b15`):
  - `runBaby` runs `releaseTarget`, `lockOnThreat`, the approach, `act`, then babble / wander.
  - Its local `isActive` is `telegraph || windowOpen`.
  - `lockOnThreat` skips `def.target === 'papa'`.
  - `babbling` is never written after `createWorld` (always true).
  - **Keep:** the draws (`drawBabbleMs`, `pickWanderCell`) in the same order, so that levels without a silence draw the same numbers.
- **`src/sim/baby/babyFsm.ts`**: five states. Its doc names `mischiefSilent` (1.21) as coming.
- **`src/sim/director/directorSystem.ts`**:
  - Enters the waves, then counts `activeCount` (wave threats only) and `candidateCount`.
  - Draws `pick` with one `nextFloat`, telegraphs, then draws the next gap.
  - It already returns while the baby is `act`.
- **`src/sim/director/waveState.ts`**: `isThreatActive` = `telegraph || windowOpen`, used by the director and `isLastOfWave`.
- **`src/sim/threats/threatFsm.ts`**:
  - `enterThreatState` is the only writer of the state.
  - `telegraphThreat(world, ctx, threat, def, waveIndex)` freezes the window (fatigue included), sets `windowOpenAt` and emits `ThreatTelegraphed`. Reuse it for the reveal.
  - `gagThreat` calls `gagIdOf(def.gag)` and then `applyGag`.
- **`src/sim/threats/threatSystem.ts`**: presses only `telegraph` / `windowOpen`. A `hidden` threat is not touched there: no window, no expiry, no rearm. The `resolved` / `gag` rearm is unchanged.
- **`src/sim/threats/gags.ts`**: `GAG_IDS` (4), `GAG_CONSEQUENCES` as a `Record`, `PAPA_ASLEEP_GAG_ID`.
- **`src/sim/papa/papaSystem.ts`**:
  - `tapFloor`, `tapObject`, `move`, `pressThreat` (glides for any state but `idle`) and `moveStop`.
  - The command loop `break`s while busy.
- **`src/sim/createSim.ts`**:
  - `simLevelOf` checks each planned entry against `geometry.anchors`, the gag, the `papa` target and anchor uniqueness.
  - `checkReachable` checks anchors against the baby's spawn region.
  - The threat instances' `xM` / `zM` come from the anchor (find where `world.threats` is built, after L330).
- **`src/sim/world.ts`**: `BabySlice.babbling` (« only a silent mischief clears it »), `MessSlice` (recounted by `runPhysics`), `createWorld`.
- **`src/sim/snapshot.ts`**: `version: 8`, `BABY_STATES` (L148), `babyProblem`, `worldProblem`.
- **`src/sim/events.ts`**, **`src/sim/commands.ts`**: the unions, the sorted `SIM_EVENT_TYPES`, `COMMAND_TYPES`, `commandProblem`.
- **`src/content/schemas/threat.ts`**: one strict `ThreatDefSchema`, `THREAT_TARGETS = ['anchor', 'papa']`, `THREAT_ICONS` (4).
- **`src/content/levelNodeNames.ts`**: `ZONE_KINDS`, `REQUIRED_ZONE_IDS = ['behind_sofa']` (every geometry has it, test ones included).
- **`content/levels/salon_crawler.geometry.json`** (generated, never edited):
  - `zones: [{ id: 'behind_sofa', kind: 'hidden', centerM: [0.5, 0.5, -2.6], halfExtentsM: [1.1, 0.5, 0.4] }]`;
  - the sofa collider spans z −2.2 … −1.3 and the back wall starts at z −3.0;
  - the raw grid is open at z −3.0 … −2.25 behind the sofa;
  - with Papa's 0.25 m and the baby's 0.2 m clearance, expect one open row (z ≈ −2.625). The invariant of D3 proves it.
- **`tools/content/contentChecks.ts`**: `checkThreatReferences` (L240, `threat.gag`), `checkLevelReferences` (L313, anchors only).
- **`src/client/audio/audioEngine.ts`**: `LoopName = 'babble' | 'music'`, `startLevelLoops`, `stopLevelLoops`, `setBabbling` (edge-triggered), `onLoopChange` (feeds `ppBabble` / `ppMusic`).
- **`src/client/boot.ts`**:
  - `onLevelFrame` (≈ L529) calls `setBabbling` with the flow gate. Add the music and the bubble there.
  - The mirror names are a typed union (≈ L212-226); add `ppSilence` and `ppBabyPx`.
  - The phone mirror on events (≈ L396-405) is the model.
- **`src/client/input/inputMapper.ts`**:
  - Pointer path (≈ L320-385): threat, then the comment « (Story 1.21: the baby slots in here, between the threats and the objects.) », then objects, then floor.
  - Action path (≈ L230-252): threat, else `pickContextObject`.
- **`src/client/input/hitTest.ts`**: `pickThreat`, `pickObject` (projection with the object's height, allocation-free). `pickBaby` mirrors `pickObject`.
- **`src/client/ui/hud/hudLayer.ts`**: three zones in one row; the bubble is not in the row, it is absolutely positioned in the HUD root.
- **`src/client/ui/world/threatMarkers.ts`**:
  - `threatMarkerEntries` special-cases `target === 'papa'` and otherwise looks up the anchor (warn plus fallback when missing).
  - Markers show only `telegraph` / `windowOpen`.
- **`src/client/feedback/feedbackDirector.ts`**: `handle` (events table) and `playCue`. Nothing to change: `SilenceStarted` goes through `handle`, and the reveal through `threatCueOf` on `ThreatTelegraphed`.
- **`src/bots/perfectBot.ts`**, **`humanBot.ts`**: scheduler and cycle memory. `isPressable` (telegraph/windowOpen) already ignores `hidden`.

### Architecture compliance

- **Sim purity.** The only new draw is D5. No `Math.random`, `Date` or `performance`.
- **Systems never call systems.**
  - `runSilence` is a helper called by `runBaby`.
  - It uses the `threatFsm` helpers.
  - The director calls `hideThreat` / `telegraphThreat`.
- **FSMs.**
  - `baby.state` changes only through `enterBabyState`, `threat.state` through `enterThreatState` (via the helpers).
  - Durations are instants: `zoneEnteredAt + silenceAlertMs`, `startedAt + findMaxMs`.
- **Events** are past tense: `ThreatHidden`, `SilenceStarted`, `SilenceEnded`. **Commands** are imperative: `TapBaby`, `ForceThreat`.
- **Units:** `silenceAlertMs`, `sneakSpeedMps`, `findMaxMs`, `zoneEnteredAt`, `startedAt`.
- **Zero allocation** in `step()`, `runSilence`, the director, `onLevelFrame` and `silenceBubble.update` (DOM writes on change only).
- **Client** imports only `@sim`, `@content`, `@shared`, `@platform` and `three`. The bubble is DOM + CSS with `pp-` classes and tokens only, and its strings go through `t()`. Reduced motion is CSS only and never touches sim timing.
- **Content.** A new JSON is not done until `content:check` passes. `content/_schemas` is regenerated, never hand-edited. The geometry is never hand-edited.

### Library and framework notes

- **Zod 4 (pinned 4.6.7):**
  - `z.discriminatedUnion('target', [...])` with strict objects;
  - check the generated JSON Schema (a `oneOf`) still gives autocompletion;
  - a refine does not show in the JSON Schema.
- **Three.js:** project with the iso camera and a preallocated `Vector3` (as `hitTest.ts` does).
- **CSS:**
  - `animation: … steps(2, jump-none)` or two keyframes with opacity 1 / 0.35 over 500 ms gives 2 Hz;
  - the reduced-motion variant is a 1000 ms ease-in-out opacity or scale pulse;
  - `@media (prefers-reduced-motion: reduce)` as in `ui.css` L411.
- No new dependency. The audio tool needs macOS `afconvert`; CI never runs it.

### File structure

| File | New / Update |
|---|---|
| `content/threats/silence_mischief.json` | New |
| `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/levels/salon_crawler.json`, `content/_schemas/{threat,feel,feedback}.schema.json` | Update |
| `src/content/schemas/{threat,feel}.ts`, `tools/content/contentChecks.ts` | Update |
| `src/sim/baby/silence.ts` (+ test) | New |
| `src/sim/baby/{babyFsm,babySystem}.ts`, `src/sim/director/{directorSystem,waveState}.ts`, `src/sim/threats/{threatFsm,gags}.ts`, `src/sim/papa/papaSystem.ts`, `src/sim/{world,context,createSim,snapshot,events,commands,index}.ts` | Update |
| `src/client/ui/hud/silenceBubble.ts` (+ test) | New |
| `src/client/audio/audioEngine.ts`, `src/client/input/{hitTest,inputMapper}.ts`, `src/client/ui/world/threatMarkers.ts`, `src/client/render/gags.ts`, `src/client/ui/styles/ui.css`, `src/client/boot.ts` | Update |
| `src/bots/{perfectBot,humanBot}.ts` | Update |
| `tools/audio/makePlaceholderAudio.ts`, `public/assets/audio/{tel_silence_found,gag_silence_mischief}.m4a` | Update / New |
| `tools/sim/simReport.ts`, `tests/tools/sim/silence.test.ts` (new), `tests/support/testContent.ts` (+ `testSilence.threat.json`), `tests/e2e/silence.spec.ts` (new), `tests/e2e/support/game.ts`, `tests/golden/journals/*` | Update |

### Testing

**Unit (Node, Vitest; time in steps):**
- **`silence.test.ts`:**
  - taking a `hidden` threat: `mischiefSilent`, the path, `sneakSpeedMps`;
  - babbling stays true until the zone, then false;
  - `SilenceStarted` exactly `silenceAlertMs` after the entry;
  - found by `TapBaby`: the event order of AC 8, `babbling` true, `targetLocked`, then `ThreatTelegraphed` and a window `telegraphDelayMs` later;
  - found by Papa in the box (set Papa's point);
  - `TapBaby` while Papa is busy does not find;
  - the deadline: `timedOut`, a gag from the list, `mess.mischiefs` + 1, no `NearMiss`;
  - a find and the deadline in one step: found;
  - a `TapBaby` before `SilenceStarted` only walks;
  - nothing runs while the flow is `ended`;
  - the gag draw is exactly one `nextFloat` (compare the rng state).
- **Director:**
  - a silence is not drawn while the baby is `targetLocked` / `approach` / `act` / `mischiefSilent`;
  - a `hidden` silence counts against `maxSimultaneous` and `isLastOfWave`;
  - `ForceThreat` on every refusal case;
  - a level without silence: the same picks, at the same steps, with the same rng state as before (pin it with a captured trace of the `threat_trio` level).
- **Baby:** `lockOnThreat` skips the silence; `releaseTarget` keeps a `hidden` target; after a found-and-parried silence, the baby goes back to `babble`; after a gag, `act` then `babble`.
- **Papa:** `TapBaby` walks to the baby; it is ignored while busy; no glide to a `hidden` threat.
- **Snapshot v9** (every field of `silenceProblem`), `createSim` refusals (AC 2, D3), `TapBaby` / `ForceThreat` in `commandProblem`, `SIM_EVENT_TYPES` sorted.
- **Content:** the union schema (each variant, a `hiddenZone` with `gag`, an `anchor` def with `surpriseGags`), the feel keys, and `content:check` (AC 2).
- **Client:**
  - `pickBaby`;
  - `inputMapper` (priority threat > baby > object; Space / A nearer of baby and object; busy gate);
  - `audioEngine.setMusicMuted` (edges, with no level loops active);
  - `silenceBubble` (shows and hides on edges only; side from the projected point; DOM untouched between edges);
  - `threatMarkerEntries` for a `hiddenZone` threat and the `dots` glyph;
  - `GAG_PRESENTATIONS` completeness.
- **Bots:** `perfect` taps once per silence at once; `human` taps after `reactionMs`; `idle` never.
- **CLI:** `simReport` (the three counters) and `silence.test.ts` (AC 12).

**e2e:** T7. **Golden:** T8.

### Previous story intelligence (1.18-1.20)

- **1.20:**
  - A new world slice means a snapshot version bump with a `…Problem` check per field.
  - A debug command (`StartDisruption`) is journaled, checked by `commandProblem` and applied inside its system.
  - Mirrors are written on events only, never per frame, and deleted at level start.
  - `npm run assets:audio` rewrites every `.m4a`: restore the others.
  - The e2e reads every bound from the live content via `support/game.ts`.
  - The CI under load needed `--maxWorkers=5` / `--workers=4`: say so if you need it.
  - Its baseline was polluted by commits landing during the run.
- **1.19:**
  - The busy machinery (`isPapaBusy`, the client gate).
  - Import cycles: `runFatigue` was moved to avoid a cycle with `threatFsm.ts`. Here `silence.ts` imports `threatFsm.ts`, which imports `waveState.ts`, `gags.ts` and `papa/sleep.ts`. Make sure nothing in that chain imports `babySystem.ts` or `silence.ts`.
  - CSS state classes start with `pp-`.
- **1.18:**
  - Waves are cumulative.
  - « One `nextFloat` per gap and one per pick ».
  - `ENDED_SYSTEMS` freezes the world at the end of the level.
  - The live 180 s tests take time (120 s timeouts). `silence.test.ts` may stop each run at the end of wave 2, if it stays a check of the live plan.
- **1.17:** `pickContextObject` needs no active threat, and Space / A target a threat first. So during a silence with another threat up, Space / A presses the threat, and the player finds the baby by tap or by walking: the GDD's « choose ».
- **1.15 / 1.16 reviews** punished:
  - e2e tied to live timings or ids;
  - tautological assertions;
  - records that overstate what was verified.

  Derive every bound from the content and `STEP_MS`. Tick only what you ran.

### Git intelligence

- The commits read « Story X : création de la story », « Story X : <titre> » and « Story X : corrections de la revue de code », in French, with a space before the colon. The implementation commit is `Story 1.21 : le silence suspect`.
- Goldens, schemas and generated audio go in the same commit as the code that changes them.

### Project Structure Notes

- **`src/sim/baby/silence.ts`, not `babble.ts`** (architecture L488 and L942). The babble is one boolean; the file holds the silence's lifecycle. The folder is the one the architecture names. Note the variance in the Completion Notes.
- **`src/client/ui/hud/silenceBubble.ts`, not `ui/world/silenceBubble.ts`** (architecture L521, a `CSS2DRenderer` label). `EXPERIENCE.md` L375 makes it screen-anchored and non-diegetic, and the UX spec wins for the interface (project-context › UX).
- `ThreatDef` becomes a union. Any code that spreads or clones a def keeps working; code that reads `gag` must narrow.

### Project context rules (from `_bmad-output/project-context.md`)

- System order and « systems never call each other » (L40). FSMs only through `enter…State()`, with instants or `enteredAt` (L43).
- Randomness only from `world.rng`; ids only from `world.nextId`.
- The hit-test priority is decided in the client; the sim never guesses (L55). This story adds the baby.
- No GDD number hard-coded. Every feedback entry with `audio` has `visual` and `haptic`; a haptic-only cue is allowed (`countdown_tick`).
- New threat = new JSON (plus gags in `GAG_IDS`, with sim consequences in `gags.ts` and a presentation in `client/render/gags.ts`).
- « The baby's babble must loop continuously while `baby.babbling`: its stop *is* the silence telegraph. »
- Zero allocation in hot paths. Goldens are regenerated deliberately.
- No `enum`, no constructor parameter properties, no new library.

### Open points for Geo (do not block on them; implement the decisions above)

1. **After the find**, the parry window opens `telegraphDelayMs` (800 ms) later, with a marker on the zone (D4). Is that how you want « trouver le bébé, puis Parer »? Or should finding be the whole response (no parry)?
2. **`findMaxMs` = 5 s** after `SilenceStarted`, so about 7 s of quiet in total, plus the crawl. Too generous for wave 2?
3. **A tap on the baby outside a silence walks Papa to him** (D9), instead of doing nothing until 4.1.
4. **Surprise mischiefs** (D11): two placeholders (`tissues_everywhere`, `crayon_scribbles`), shown only by their cue until E7. Which mischiefs do you want? Should 1.22 count them in Mama's Sigh?
5. **The silence is drawn only while the baby is free** (AC 3), so wave 2's other threats delay it. Should it be planned at a fixed time instead, like the phone?
6. **The bubble blinks at 2 Hz** (the token allows up to 3 Hz).

### References

- `epics.md`: L42, L52, L64, L124, L237, L1001-1031 (1.18), L1066-1086 (1.20), L1088-1116 (1.21), L1118-1151 (1.22), L1281-1284 (2.3), L1381-1383 (2.6) and L1821-1838 (4.1).
- GDD L44, L144-158, L176, L214, L239, L440 and L444.
- Architecture L68, L104, L221, L252, L274, L400-410, L488, L521, L537, L581, L643, L778-785, L886, L942 and L1018.
- `DESIGN.md` L246-251, L393 and L540. `EXPERIENCE.md` L123, L163, L218, L287, L295, L375 and L436. `mockups/key-hud-level.html` L86-89 and L251-273.
- `deferred-work.md` L93, L115 and L131.
- `1-20-le-telephone-qui-sonne.md` (D3, D4, the Dev Agent Record) and `1-19-fatigue-cafe-et-micro-siestes.md` (D6).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5

### Debug Log References

- Baseline (T0), `(unset VITE_DEBUG_ALLOWED; npm run ci)` on `8e1573c` before the first edit: green. 186 unit files / 3046 tests, 234 e2e tests (chromium + webkit). 1.20 is `done`, the tree was clean.
- `VITE_DEBUG_ALLOWED=false` was exported by the shell; every run above is under `unset`.
- Final: typecheck, lint, `content:check` clean; `test:coverage` 190 files / 3172 tests, `src/sim` at 98.0 % lines / 96.6 % branches; e2e 244 passed (chromium + webkit); `build:playtest` OK.
- The machine was under heavy load (load average 24-31, other processes) during the last full `npm run ci`: 14 timeouts, none an assertion. I re-ran the steps with `--maxWorkers=5` and `--workers=4` (as 1.20 did) and they pass. The earlier full run under normal load had passed every unit test and every e2e but `threats.spec.ts` (see below).
- Proof that a level with no silence is untouched: a trace of the 3-threat level (seed 7, 6000 steps) gives the same final rng state and the same events hash on `8e1573c` and on this branch; it is pinned in `directorSystem.test.ts`. The goldens' `eventsHash` and `levelHash` did not move.

### Completion Notes List

- **Implemented all of AC 1-14.** A `hiddenZone` threat def (union on `target`), `silence_mischief.json`, two feel keys, the wave entry on `behind_sofa`; `hideThreat` / `ThreatHidden`; `runSilence` inside `runBaby`; `world.silence`; `SilenceStarted` / `SilenceEnded`; `TapBaby` and `ForceThreat`; two surprise gags; music mute and `silence-bubble` following `world.silence.startedAt`; `pickBaby`; bots; CLI counters.
- **Deviation D4, as the story asked me to say:** a found silence is revealed by `telegraphThreat` (`hidden → telegraph`, a window `telegraphDelayMs` = 800 ms later), not `windowOpen` at once as the epic reads. Open point 1 asks Geo.
- **Variance from the architecture file names:** `src/sim/baby/silence.ts` (not `babble.ts`) and `src/client/ui/hud/silenceBubble.ts` (not `ui/world/`), as the story prescribes.
- **Zod accepted an enum discriminator,** so two variants (`anchor | papa` and `hiddenZone`) are enough. A def with no `target` now gives one error instead of one per missing key; `loadLevelContent.test.ts` « collects every problem » was rewritten for that (`>= 2` problems instead of `> 2`), its point (several files reported at once) is unchanged.
- **Snapshot v9.** `silenceProblem` checks every field of the slice; the old « threat in every state » test now excludes `hidden` for the outlet, and a new silence test covers `hidden`.
- **Edge cases I met and did not change (not ACs), listed in `deferred-work.md`:**
  - A `TapBaby` that finds the baby also walks Papa to him: the silence is cleared before `runPapa` runs, so the tap falls into the « outside a silence » branch.
  - Papa standing in the zone after a parry finds the next silence at the very step it is announced (seen in the bot tests: the second silence of a run starts and ends in one step).
  - The bubble is also hidden during a pause veil or the resume countdown (`pause.state !== 'running'`), not only when the level has ended; the music mute is not: it follows the flow only, so a pause cannot bring the music back mid-silence.
- **Tests I rewrote because their premise changed** (none deleted): `threatCatalog.test.ts` (a hidden-zone def is telegraphed after a find, its gag is one of a list), `threats.spec.ts` (the live level now plans `silence_mischief` between the coffee table and the micro-sleep), the mess `toEqual`s (`mischiefs: 0`), `snapshot.test.ts` version tests, `makePlaceholderAudio.test.ts` « no two clips alike » (same assertion, 30 s timeout: it grows with the number of clips and went over 5 s under load).
- **Placeholder audio:** `npm run assets:audio` rewrote every `.m4a`; I restored the others from git and kept only `tel_silence_found.m4a` and `gag_silence_mischief.m4a`.
- **Goldens regenerated deliberately** (`npm run golden:update`): only `worldHash` (new `silence` and `mischiefs` slices) and `feelHash` (the frozen test feel gained `silenceAlertMs` and `sneakSpeedMps`) moved; `eventTypes`, `eventsHash` and `levelHash` are identical. The screenshot references did not move.
- **Not run:** nothing played by hand in a real browser or on a device (no feel check of the bubble's look, the crawl or the cut of the music): Geo's to play. The e2e proves the DOM state, the colour token, the blink period, the side, the vibration and the mirrors on a frozen level.
- **Open points for Geo** are those of the story (1-6); the Papa-in-the-zone edge above is a seventh.

### File List

content/_schemas/feel.schema.json, content/_schemas/threat.schema.json, content/feedback.json, content/feel.json, content/levels/salon_crawler.json, content/strings.fr.json, content/threats/silence_mischief.json (new), public/assets/audio/gag_silence_mischief.m4a (new), public/assets/audio/tel_silence_found.m4a (new), src/bots/{humanBot,perfectBot,threatTiming}.ts, src/client/audio/audioEngine.ts (+test), src/client/boot.ts, src/client/input/{hitTest,inputMapper}.ts (+tests), src/client/render/gags.ts (+test), src/client/ui/hud/silenceBubble.ts (new, +test), src/client/ui/styles/ui.css, src/client/ui/world/threatMarkers.ts (+test), src/content/schemas/{feel,threat}.ts, src/sim/baby/{approach,babyFsm,babySystem}.ts (+babySystem.test.ts), src/sim/baby/silence.ts (new, +test), src/sim/{commands,context,createSim,events,index,snapshot,world}.ts (+commands, createSim, snapshot tests), src/sim/director/{directorSystem,waveState}.ts (+directorSystem.test.ts), src/sim/papa/papaSystem.ts (+test), src/sim/physics/propsSystem.test.ts, src/sim/threats/{gags,threatFsm}.ts (+tests), tests/bots/silenceBots.test.ts (new), tests/content/{levelSchema,loadLevelContent,threatSchema}.test.ts, tests/e2e/{props.spec,threats.spec}.ts, tests/e2e/silence.spec.ts (new), tests/e2e/support/game.ts, tests/golden/journals/*.json (12 files, regenerated), tests/golden/{propFall,threatTrio}.test.ts, tests/support/{testContent.ts,testFeel.json,testSilence.threat.json (new)}, tests/threats/threatCatalog.test.ts, tests/tools/audio/makePlaceholderAudio.test.ts, tests/tools/sim/{silence.test.ts (new),simReport.test.ts}, tools/audio/makePlaceholderAudio.ts, tools/content/contentChecks.ts, tools/sim/simReport.ts, _bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml}, _bmad-output/project-context.md.

### Change Log

- 2026-10-28: story 1.21 implemented (the suspicious silence): content, sim, client, bots, CLI report, tests, goldens regenerated; status → review.
