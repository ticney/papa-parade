---
baseline_commit: d20dddd3843d98220cf390bcd2e4ce5531658a57
---

# Story 2.13: Poses exagérées du café et du téléphone

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want to tell at a glance what Papa is doing, even without the bubble,
so that his being busy reads on a small screen.

**Requirement:** FR74 `[P]`, UX-DR28. Fifth story of the v2.3 catch-up (sprint change proposal 2026-11-03: 3.12 → 2.11 → 3.13 → 2.12 → **2.13** → 3.14 → 3.15 → 3.16 → playtest → E9). At Geo's first playtest the `drink` and `on_phone` clips and their props were tiny in the iso view, so nobody saw that Papa was busy. Story 2.12 added the activity bubble above him. This story makes the body itself say it (GDD mechanic 15, L239): « Téléphone : combiné énorme, bulle « bla bla » gribouillée, papa dos au bébé. Café : mug énorme, vapeur, « slurp », puis les yeux qui s'écarquillent pendant que la jauge de fatigue baisse. »

**Depends on:** the rig, pipeline and contract of story 7.2, the outlines of 7.3, the bubble of 2.12.

**Not in this story:**
- Any sim change. No new state, event, command or world field (D9).
- Elbows or any new limb bone, and carried variants of `drink` / `on_phone` (D8: they stay deferred).
- The baby, Mama, the look (3.7), the after-effects (3.15), the chores (9.4).
- The activity bubble itself, its « Z » overlap and its sounds (2.12's open points stay Geo's).

## Acceptance Criteria

The epics' criteria are: *given `papa.glb`, when the `drink` and `on_phone` clips are redone in Blender, then the mug and the handset are at least twice as big, the phone has a scribbled « bla bla » bubble and Papa turns his back on the baby, the coffee has steam, a « slurp » and eyes that widen at the end; given reduced motion, when Papa drinks or phones, then the pose stays (it carries a state) and only the side effects (steam, animated scribbles) are frozen; given `npm run dist:check`, when the character is rebuilt, then the level's budget still holds.* The decisions D1 to D10 below make them precise.

### The coffee

1. **A huge mug.** `papa_mug` is at least twice as big as in story 7.2: the longest side of its box at rest is ≥ 2 × 0.218 m. It stays in his right hand (`hand_r`), in its existing materials (`art_paper`, `art_ink`). The existing guard still holds: in `drink` it touches his body's box and its centre is above 0.45 m.
2. **The drink pose, redone.** `drink` is reauthored in `papa.blend`, broad enough to read from the fixed camera at 667 × 375:
   - head thrown back, spine leaning back;
   - the mug up at his mouth, with at least one sip per loop;
   - the free arm out (a hand on the hip or flung wide).

   It loops, and no pose sinks him below the floor (`FLOOR_SLACK_M`).
3. **Steam.** A new node `papa_mug_steam` sits under `papa_mug`, so it shows and hides with the mug. It is made of one or two wisps in `art_paper` (the outline comes from 7.3). In `drink` it stands above the mug's rim. The view sways it on the sim clock (D3, AC 9).
4. **The « slurp ».** `CoffeeStarted` plays a new cue `papa_coffee_slurp`:
   - audio: a new placeholder clip `papa_coffee_slurp.m4a`;
   - visual twin: a `soundWave` on Papa;
   - haptic: `light` (ADR-006).

   It goes through `feedback.json › events`, with no code. `content:check` and the twin tests pass.
5. **Eyes that widen at the end.** `CoffeeDrunk` (the step where the fatigue drops) plays a new Papa one-shot `coffee_kick`:
   - a new bone `eyes`, child of `head`, carries his eye whites and pupils, and scales up to at least 1.4 at the clip's peak, then back;
   - his body snaps upright.

   `papaOneShotOf` maps `CoffeeDrunk → 'coffee_kick'`, and a new `characters.squash` row stretches him on `CoffeeDrunk` (data). The lids keep their code-driven bone and no clip keys `eyelids`. A coffee cut short by a nap emits no `CoffeeDrunk`, so it has no kick.

### The phone

6. **A huge handset.** `papa_handset` is at least twice as big as in 7.2: the longest side of its box at rest is ≥ 2 × 0.32 m. It may be remodelled from its 8-vertex box into a readable handset (an earpiece and a mouthpiece), in `art_ink` (review, 2026-11-04: the two cups are `art_paper`, so that the front view does not read as a black bar; see the Debug Log), still in his left hand (`hand_l`). The existing guard still holds: in `on_phone` it touches his body's box and its centre is above 0.55 m.
7. **The phone pose, redone.** `on_phone` is reauthored:
   - the handset at his ear;
   - the free arm gesturing broadly, as people talk with their hands;
   - the head nodding and chattering.

   It loops, with no floor sink.
8. **The « bla bla » bubble.** A new hidden node `papa_blabla` is a paper bubble (`art_paper`) with a tail and two or three ink scribbles in it (`art_ink`). The scribbles are squiggles, not letters (D4, open point 2). The view:
   - shows it exactly while `papa.state === 'onPhone'`;
   - takes it out of the turning body into its own non-turning group, beside his head, toward the side of the screen given by data;
   - turns its face to the camera (`ISO_YAW_DEG`);
   - wobbles it on the sim clock (D4).

   At both surfaces it does not sit under the activity bubble or the combo badge (D10).

### Facing

9. **Papa turns for the camera to drink, and his back to the baby to phone.** A new data table `feedback.json › characters.papaClipFacing` gives a facing per clip (D5). Its rows:

   | Clip | Facing |
   |---|---|
   | `drink` | `camera` |
   | `coffee_kick` | `camera` |
   | `on_phone` | `awayFromBaby` |

   - The body's turn reads `rig.clipName` (the clip the player sees) and turns at `turnRateDegPerSec` toward:
     - `camera`: `ISO_YAW_DEG` in radians;
     - `awayFromBaby`: `atan2(papa.xM − baby.xM, papa.zM − baby.zM)`.
   - It falls back to his heading:
     - for a clip with no row;
     - for `awayFromBaby` only (the `camera` facing never reads the baby; amended after the code review, 2026-11-04): when the baby is `carried`;
     - for `awayFromBaby` only: when the baby is `mischiefSilent` (a turn away from a hidden baby would point at him, D5);
     - for `awayFromBaby` only: when the baby is closer than a small epsilon.
   - `papaPose.yawRad`, the sim's heading and every marker are unchanged: only the drawn body turns.
   - The helper is pure, takes Papa, the baby and the clip only, never a threat, and allocates nothing.

### Comfort and time

10. **Reduced motion freezes the side effects only.** Under « Réduire les animations »:
    - The clips, the facing and the props play as without the setting: a pose carries a state.
    - The steam and the bla-bla bubble are shown, held at their rest transform, and do not move.
    - The `CoffeeDrunk` squash is off, like every squash.
    - The setting is read from `bodies.isMotionReduced()` each frame, as the door and the danger tint do.
11. **The sim clock drives the side effects.** The sway of the steam and the wobble of the bubble are pure functions of `clockMs` (`world.time.sim + alpha × STEP_MS`), so a pause and a hitstop freeze them and a slow-mo slows them, with no code for any of them. Their amplitudes and periods are data (`characters.busyProps`). Each period is ≥ `SCREEN_FLASH_MIN_INTERVAL_MS` (334 ms, the 3 Hz cap), checked by the schema. Nothing allocates per frame.

### What must not move

12. **The game does not move.**
    - No file changes under `src/sim`, `src/bots`, `tests/golden/`, `content/levels/`, `content/threats/`, `content/sequences/`, `content/disruptions/`, `content/feel.json`, `public/_headers`, `public/assets/levels/`, `tools/blender/export_level.py`.
    - `npm run ci:fast` passes with no golden regenerated.
    - `npm run sim` with the four bots on both levels, seed 1, gives reports byte-identical to `main`.
    - `feedback.json` is not hashed into the journal (`feelHash`, `geometryHash`, `levelHash`), so its new keys move nothing.
13. **The budgets hold.**
    - `papa.glb` keeps to `characterRigProblems` and the `CHARACTER_*` budgets: ≤ 6 visible draw calls, ≤ 4,000 visible triangles, ≤ 32 bones, ≤ 6 materials (it has 6: **no new material**), ≤ 300 KiB.
    - `npm run dist:check -- --flavor playtest` passes, and the level payload is written in the notes.
    - `data-pp-draw-calls` stays ≤ 100 in the salon while Papa drinks and while he is on the phone (both read by an e2e). `perf.spec.ts` passes on `salon_crawler` on the built playtest.
14. **A restart leaks nothing.** `level.spec.ts`'s equal counts after a restart still hold: the reparented bubble's geometry is freed by the view (D4).
15. **It plays without a human.** `/?autoplay=human&seed=1&speed=4` plays the salon with no `warn` on `assets` or `render` (a missing node warns: `rig.node`).
16. **Geo has seen it.** Screenshots at 844 × 390 and 667 × 375 go in `_bmad-output/implementation-artifacts/2-13-screenshots/`:
    - Papa drinking with steam;
    - the kick's wide eyes;
    - Papa on the phone with his back to the baby, at two baby positions;
    - the bla-bla with the activity bubble and a combo badge shown, and with the bubble aside;
    - one frame under reduced motion.

    Each image is listed as opened or not opened. The merge waits for Geo's look: the charm and the sizes are his call.

## Tasks / Subtasks

- [x] **T0. Read « Blender access » and « The file today »** (AC 1-8, D1)
  - [x] Never touch the live Blender MCP session. Work headless in this worktree, with throwaway scripts in the scratchpad.
  - [x] Rerun the read-only listing (`papa.blend`'s objects, bones, actions) and compare it with « The file today »: if they differ, trust the file.
- [x] **T1. Data and schema** (AC 4, 5, 9, 10, 11; D5, D7)
  - [x] `src/content/schemas/feedback.ts`:
    - `CharactersSchema` gains `papaClipFacing: { clip, facing: 'camera' | 'awayFromBaby' }[]`, with a duplicate-clip refusal in the existing `superRefine`, and `busyProps: { steamSwayDeg, steamStretchPct, steamPeriodMs, blablaTiltDeg, blablaBobAmplitudeM, blablaPeriodMs, blablaPlace: { screenOffsetM, heightM } }`. These names end in suffixes `feedbackSchema.test.ts`'s `UNIT_SUFFIX` already accepts (`Deg`, `Pct`, `Ms`, `AmplitudeM`, `OffsetM`, `^heightM`); a name like `bobM` or `sideM` would fail it;
    - bounds: degrees in 0–45, the stretch in 0–50, `blablaBobAmplitudeM` in 0–0.2, periods ≥ `SCREEN_FLASH_MIN_INTERVAL_MS`, `screenOffsetM` in −1–1, `heightM` within 0.3–1.2;
    - `SQUASH_EVENTS` gains `'CoffeeDrunk'` (the test that ties it to `SIM_EVENT_TYPES` must still pass).
  - [x] `content/feedback.json`:
    - the three facing rows;
    - `busyProps` (start: sway 12°, stretch 15 %, 900 ms; tilt 8°, bob 0.03 m, 700 ms; side 0.35 m, height 0.8 m; measure and adjust in T9);
    - a squash row `{ "event": "CoffeeDrunk", "character": "papa", "amountPct": 18, "durationMs": 320 }`;
    - the cue `papa_coffee_slurp` (`audio` on `sfx` at about 90 %, `soundWave` on `papa` near 0.6 m / 350 ms like `papa_phone_answer`, `haptic: "light"`);
    - `"CoffeeStarted": "papa_coffee_slurp"` in `events`.
  - [x] Then:
    - `npm run content:schemas`;
    - `tests/support/testContent.ts` gains the same keys;
    - `tests/content/feedbackSchema.test.ts`: each bound and the duplicate refusal, one failing case each. Its numeric-key check (`UNIT_SUFFIX`, L23) must pass unchanged; never widen it to let a name through.
  - [x] `npm run content:check`.
- [x] **T2. Contract and guards, before any art** (AC 1, 3, 5, 6, 8, 13; D2, D3, D6)
  - [x] `characterClips.ts` › `PAPA_CONTRACT`:
    - `bones` + `'eyes'`;
    - `hiddenNodes` + `'papa_mug_steam'`, `'papa_blabla'`;
    - `clips` + `'coffee_kick'`;
    - a new `codeDrivenNodes: ['papa_mug_steam', 'papa_blabla']`. `BABY_CONTRACT.codeDrivenNodes` is `[]`.
  - [x] `tools/assets/characterArt.ts`:
    - `CharacterContract` gains `codeDrivenNodes`;
    - `characterRigProblems` refuses a clip track on any of them, with the same message shape as for `codeDrivenBones`;
    - a failing fixture in `tests/tools/assets/characterArt.test.ts`.
  - [x] `tests/architecture/characterAssets.test.ts`, new cases on the committed file:
    - the mug's and the handset's longest side at rest are ≥ twice 7.2's (name the two numbers as constants, with the story's reference);
    - in `drink` at mid-clip, `papa_mug_steam` is above the mug's box;
    - the bone `eyes` reaches a scale ≥ 1.4 in `coffee_kick` and has no track in any other clip (the eyes widen only at the kick, until Geo says otherwise);
    - every clip of `feedback.json › characters.papaClipFacing` exists in `papa.glb` (extend the `clipSpeeds` case).
  - [x] These fail on the 7.2 file: that is the point. Run them again after T3.
- [x] **T3. The art, in `papa.blend`, headless** (AC 1-3, 5-8; D1, D2, D3, D6)
  - [x] Scale the mug and the handset mesh data (not the object), keeping each grip at its hand bone. The handset may be remodelled. Apply the transforms.
  - [x] `papa_mug_steam`: one or two wisps in `art_paper`, parented to `papa_mug` (object parent), its origin at the mug's rim so that the code's sway pivots there. Authored upright.
  - [x] `papa_blabla`: a paper bubble with a tail and two or three ink squiggles, as one object with the two materials, parented to the armature object (`OBJECT`, not a bone). Facing Blender's -Y (glTF +Z, the way Papa faces), its origin at the tail's tip.
  - [x] Bone `eyes`, child of `head`, standing straight up with no roll like every other bone, its head at the eyes' centre. Move the eye whites and the pupils from the `head` vertex group to `eyes`; the eyelids stay on `eyelids`.
  - [x] Reauthor `drink` and `on_phone`, author `coffee_kick` (about 0.6–0.8 s, longer than 3 × `crossFadeMs`). Each action needs a slot and a fake user (see 7.2's T0 note). No action keys `eyelids`, `papa_mug_steam` or `papa_blabla`.
  - [x] Purge orphans; pack no image; save once.
  - [x] Then:
    - `npm run assets:character:export -- papa`, then `npm run assets:character:optimize -- papa`;
    - `npx vitest run tests/architecture/characterAssets.test.ts tests/tools/assets/characterArt.test.ts`.
  - [x] Iterate by looking in the browser (T9), never in a Blender render (GDD: the modelling tool's render does not carry over).
- [x] **T4. The view** (AC 5, 8-11, 14; D3, D4, D5)
  - [x] `characterMotion.ts`: `papaFacingYawRad(papa, baby, clip, facings): number | null`, where `null` means « his heading ». It is pure, with a unit test for each branch: camera, away, no row, carried, `mischiefSilent`, too close.
  - [x] `characterClips.ts`: `papaOneShotOf` gains `case 'CoffeeDrunk': return 'coffee_kick'`.
  - [x] `papaView.ts`:
    - `animate` aims the body at `papaFacingYawRad(…) ?? pose.yawRad` through `turnToward`.
    - `CharacterMotionConfig` gains `clipFacing` and `busyProps`. Its fields are read once; the clip lookup must not allocate.
    - `setDrinking(isDrinking, clockMs, isMotionReduced)` and `setOnPhone(isOnPhone, clockMs, isMotionReduced)` show the props and write the sway and wobble. Both are held at rest under reduced motion, and the transform is written only when shown.
    - At creation, move `papa_blabla` from the rig into `group` (`group.add(node)`), position it from `blablaPlace` along the screen side computed once from `ISO_YAW_DEG`, and set `rotation.y` so it faces the camera.
    - `dispose` frees its geometry and its hull's, which `rig.dispose()` no longer reaches.
    - Getters `bodyYawRad`, `steamSwayDeg`, `blablaTiltDeg` (0 when hidden).
  - [x] `levelScene.ts`:
    - pass `clockMs` and `bodies.isMotionReduced()` to both setters;
    - pass the new config from `bodies.characters`;
    - `realFxState()` gains `papaBodyYawRad`, `papaSteamSwayDeg`, `papaBlablaTiltDeg`.
  - [x] Update `testHost.ts`'s `RealFxState` and the e2e default in `tests/e2e/support/testApi.ts`. `dist:check --flavor prod` must still find no debug marker.
  - [x] Update the views' unit tests (`papaView.test.ts`, `levelScene.test.ts`, `characterClips.test.ts`, `characterMotion.test.ts`). The fixture rig (`tests/support/testCharacters.ts`) builds every contract node, so the new ones come for free.
- [x] **T5. The slurp** (AC 4; D7)
  - [x] `tools/audio/makePlaceholderAudio.ts`: a `papa_coffee_slurp` synth, a short noisy rising sip of about 350 ms, unlike `papa_busy`. Use the next free seed offset and say which one. Update the header's story list.
  - [x] Then:
    - `npm run assets:audio -- --only papa_coffee_slurp` (macOS `afconvert`);
    - commit the `.m4a`;
    - `npm run content:check`.
- [x] **T6. Tests in the browser** (AC 5, 8-10, 13)
  - [x] Run all of it on a frozen salon, through `__PP__`, with a `waitFrames` after each `ppAdvance` before reading.
  - [x] `tests/e2e/characters.spec.ts`, **coffee**:
    - `TapObject coffee_machine`, until `drink`;
    - `fx().papaClip === 'drink'`;
    - after at least 300 ms of sim time, `papaBodyYawRad` is within 0.05 rad of `ISO_YAW_DEG`;
    - `papaSteamSwayDeg` changes between two advances;
    - `data-pp-draw-calls` ≤ 100;
    - at `CoffeeDrunk`, `papaClip === 'coffee_kick'`, then the loop's clip once it ends.
  - [x] `tests/e2e/characters.spec.ts`, **phone**:
    - `StartDisruption`, `TapObject phone`, until `onPhone`;
    - the yaw is within 0.05 rad of the away-from-baby angle computed from `ppWorld`;
    - `papaBlablaTiltDeg` changes;
    - draw calls ≤ 100.

    Pick a moment where the baby is neither carried nor `mischiefSilent`, and assert it.
  - [x] `tests/e2e/reducedMotion.spec.ts`: with the saved setting on, during `drink` the clip is `drink`, `papaMixerMs` advances, the yaw still turns, and `papaSteamSwayDeg` stays exactly the same across advances. Add a positive control with the setting off.
  - [x] Every test must be able to fail (lesson of the 2.11 and 2.12 reviews): no `typeof` checks, no bound true by construction, no `.every` on a possibly empty list.
  - [x] Run on Chromium, through the queue: `characters`, `reducedMotion`, `activityBubble`, `phone`, `fatigue`, `level`, `feedback`, `testApi`, `render`, `autoplay`. (Review 2026-11-04: rerun after the review fixes, 87 passed in 2.9 min on Chromium, no retry; `level` covers AC 14, `autoplay` AC 15.)
- [x] **T7. Prove nothing moved** (AC 12)
  - [x] `git diff --stat main` on AC 12's paths is empty.
  - [x] The four bots on both levels, seed 1, against `main`: 8 reports byte-identical.
  - [x] `npm run ci:fast` with no golden regenerated.
- [x] **T8. Budgets on the build, after the last art edit** (AC 13), in the background, under `caffeinate`
  - [x] `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`: write the payload and `papa.glb`'s size.
  - [x] `npm run e2e:dist` (it waits its turn and runs `perf.spec.ts` alone): write p95, draw calls max and triangles max for the salon.
  - [x] A failure under load is rerun alone, and both runs are reported.
- [x] **T9. Look, and screenshots** (AC 16; D10)
  - [x] AC 16's list. Run through the frozen salon and `__PP__`, Chromium, at both sizes. (Review 2026-11-04: all but the frame with the activity bubble *aside*, never captured; open point 6.)
  - [x] Tune `busyProps` and the art until the bla-bla clears the activity bubble and the badge, and say what you changed.
  - [x] `autoplay.spec.ts`'s frozen frame moves only if Papa's rest pose or file changed in view. If it moves, regenerate the two macOS references deliberately, open them and say so.
  - [x] List what you did not open and what you did not capture, such as the motion itself. Never claim a look you did not take.
- [x] **T10. Docs and debts**
  - [x] `project-context.md` › « Rigged characters (story 7.2) »:
    - `codeDrivenNodes`;
    - `papaClipFacing`, with the body turning per clip while `pose.yawRad` stays the sim's;
    - `busyProps` on the sim clock, held under reduced motion;
    - the `eyes` bone.
  - [x] `EXPERIENCE.md`, the reduced-motion table: a row « Papa's busy side effects (steam, bla-bla) (v2.3) | Held still; the pose, the props and the facing stay `[ASSUMPTION]` ».
  - [x] `deferred-work.md`:
    - close « No spec for the busy feedback or the coffee cue » (story 1.19, L342) for the coffee's sound: the slurp;
    - record « Elbows » (L930) and « carried variants » (L936) as still open, with D8.

### Review Findings

Code review of 2026-11-04 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; diff `main...story/2-13-…`). 3 `decision_needed` (all resolved by Geo on 2026-11-04: D1 → patch, D2 → dismissed, D3 → patch), 7 `patch`, 7 `defer`, 12 dismissed as noise.

- [x] [Review][Patch] Keep `blablaPlace` at 0.85 m / 0.35 m (Geo chose option 1, 2026-11-04) and document it [content/feedback.json:128, src/content/schemas/feedback.ts:488-500, tests/support/testContent.ts:64] — add the T9 retune to « Open points for Geo » (the bla-bla stands at hip level, beside the badge, so that the DOM activity bubble does not hide it; the aside capture of D10 was never taken); say the same on T9; replace « beside his head » in the schema descriptions, comments and test titles by what it is (a bubble at his side, clear of the activity bubble).
- [x] [Review][Dismissed] The mug and the steam vanish on the first frame of `coffee_kick` [src/client/render/levelScene.ts:556, papaView.ts:307-309] — Geo kept it (2026-11-04): the sip is over, the mug is gone, the eyes pop.
- [x] [Review][Patch] Amend AC 9's wording to match the code (Geo kept the code, 2026-11-04) [this file, AC 9; src/client/render/views/characterMotion.ts:93] — the `camera` facing never reads the baby; the fallbacks to his heading (baby `carried`, `mischiefSilent`, or within epsilon) apply to `awayFromBaby` only, as D5's reasoning says.
- [x] [Review][Patch] `papa_mug_steam` is never asserted to be the mug's child in the real `papa.glb` [tests/architecture/characterAssets.test.ts:323] — the view only toggles `mug.visible`, so the steam shows and hides with the mug only if it really is its child; the test only checks geometry (and `createTestPapa` re-parents it by hand). Add `expect(steam.parent).toBe(mug)` on the real asset.
- [x] [Review][Patch] The `eyes` guard checks only the maximum [tests/architecture/characterAssets.test.ts:~340] — AC 5 says « scales up … then back »; `max ≥ 1.4` over a flat array passes for a single axis and does not check that the scale returns to 1 or that the peak falls mid-clip. Check the first and last keys are 1 and the peak is inside the clip, on all three axes.
- [x] [Review][Patch] Dead `eventsOfType` export [tests/e2e/support/busyPapa.ts:102] — unused by every spec; remove it (and its `ppEvents` import if nothing else uses it).
- [x] [Review][Patch] Two test titles claim more than they check [src/client/render/levelScene.test.ts, tests/content/feedbackSchema.test.ts] — « … and a hitstop holds it » only repeats the same clock value (no hitstop is run); « the cue plays on the first sip » only checks that `CoffeeStarted` maps to a cue with audio, visual and haptic. Rename them to what they pin, or make them pin it.
- [x] [Review][Patch] The story record is out of step with the code [this file] — (a) AC 6 says the handset is `art_ink`; its cups are `art_paper` (Debug Log only): add it to the open points as a deviation and its reason; (b) T6 ticks `level`, `phone`, `fatigue`, `feedback`, `testApi`, `render`, `autoplay` but the record only reports `characters` and `reducedMotion`: run the others on Chromium (`npm run e2e -- <specs> --project=chromium`) and write the result (AC 14: equal counts after a restart; AC 15: `autoplay=human` without an `assets` / `render` warn); (c) T9 is ticked although the aside capture is missing: say so on the task.
- [x] [Review][Defer] The end photo and the perfect camera use another yaw than `ISO_YAW_DEG` [src/client/render/views/characterMotion.ts:74, papaView.ts:190] — the `camera` facing and the bubble billboard are fixed to 45°; with `photoCamera.yawDeg` (live 38) or `perfectCamera.yawDeg` Papa faces up to 30° off the camera and the bubble is foreshortened by up to cos 30°. Deferred: the spec fixes `ISO_YAW_DEG`; revisit with the end photo's look.
- [x] [Review][Defer] Papa can slide in the kick pose, facing the camera, if he is sent off right after the coffee [src/client/render/views/papaView.ts:257-269] — facing follows `rig.clipName`, and `rig.play` waits for the one-shot (up to about 0.7 s). Deferred: the one-shot rule is story 7.2's; judge it in the motion pass.
- [x] [Review][Defer] `awayFromBaby` can swing by up to 180° when the baby passes within 0.05 m, and jitter with a baby circling at 0.1–0.3 m [src/client/render/views/characterMotion.ts:73,97] — no hysteresis; the 0.05 m is the spec's value but sits in code. Deferred: not seen in a frozen frame; Geo's playtest will say.
- [x] [Review][Defer] `papa_blabla` is taken out of the rig by `group.add` [src/client/render/views/papaView.ts:194,219] — a second `createPapaView` on the same `CharacterAsset` would find no bubble (`levelSession` re-parses on every start, so it cannot happen today); the file's x / y rotation and translation are dropped. Deferred: latent only.
- [x] [Review][Defer] `resetFx` / `resetAnimation` leave `bodyYawRad` and the props' view state stale until the next `update` [src/client/render/levelScene.ts:569-580, papaView.ts:284-287] — a restart builds a new view today. Deferred: latent only.
- [x] [Review][Defer] The reduced-motion e2e cannot tell a hidden steam or bubble from a held one [tests/e2e/reducedMotion.spec.ts] — `papaSteamSwayDeg` and `papaBlablaTiltDeg` are 0 in both cases; the unit tests (`papaView`, `levelScene`) pin the visibility. Deferred: covered one layer down.
- [x] [Review][Defer] The busy props are outside the static draw-call budget, and the e2e reads draw calls in one state per prop [src/client/render/views/characterClips.ts:129-137] — `perf.spec.ts` plays a whole level (max 85 draw calls). Deferred: measured by the perf run.

## Dev Notes

### Blender access: read this first

**The live Blender MCP session belongs to Geo's main checkout, and it may hold unsaved work.** Same trap as 7.1 and 7.2.

- **Never save, reload or open another file in that session, and never export from it.** Its docs tools (`search_api_docs`, `get_python_api_docs`) are safe.
- **Work headless, in this worktree:** `/Applications/Blender.app/Contents/MacOS/Blender -b assets-src/blender/characters/papa.blend -P <scratchpad script>`. Blender 5.2.3 LTS is installed (checked).
- **The worktree guard** refuses a compound shell command it cannot read: write the Python to a file in the scratchpad, then run Blender as one plain command.
- Run Python only on the project's own `.blend`. Commit the `.blend` once, at the end; purge orphans; pack no image.

### The file today (read headless on 2026-11-04, `papa.blend` on `main` at e720fd9)

- **Objects.**
  - `papa_rig`, the armature.
  - Parented to the armature object: `papa_body` (`art_ink`, `art_skin`, `art_paper`; 1,092 verts; vertex groups `leg_l`, `leg_r`, `hand_l`, `hand_r`, `head`, `eyelids`), `papa_shirt` (`art_shirt`) and `papa_look_shirt` (`art_inside`, `art_paper`).
  - Parented to bones:
    - `papa_mug` → `hand_r`: 0.218 × 0.18 × 0.161 m, `art_paper` + `art_ink`;
    - `papa_handset` → `hand_l`: 0.06 × 0.1 × 0.32 m, an 8-vertex box in `art_ink`;
    - `papa_hair` → `head`;
    - `papa_look_mash` → `head`.
- **Bones** (all straight up, no roll):

  | Bone | Parent | Head (m) |
  |---|---|---|
  | `root` | — | z 0 |
  | `spine` | `root` | 0.25 |
  | `head` | `spine` | 0.56 |
  | `eyelids` | `head` | 0.8 |
  | `arm_l` / `arm_r` | `spine` | ±0.195, 0.53 |
  | `hand_l` / `hand_r` | their arm | 0.25 |
  | `leg_l` / `leg_r` | `root` | 0.27 |

  10 joints. **No elbow**: one bone a limb.
- **Actions** (30 fps, all with fake users):
  - `drink` (1–46) keys `arm_r`, `hand_r`, `head`, `spine`;
  - `on_phone` (1–41) keys `arm_l`, `arm_r`, `hand_l`, `head`;
  - the other 13 are not this story's.
- **Materials** in the `.glb`: `art_ink`, `art_skin`, `art_paper`, `art_mash`, `art_inside`, `art_shirt`. That is 6 = `CHARACTER_MATERIALS_MAX`, so the steam, the bubble and the eyes reuse `art_paper` and `art_ink`.
- **The eyes** are part of `papa_body` (`art_paper` whites, ink pupils) and weighted to `head`. T3 moves them to the new `eyes` group.
- **`papa.glb`:** 46.6 KB, 4 visible draw calls, 2,600 visible triangles (7.2 review).
- **Where the busy props stand in the salon:**
  - `ANCHOR_coffee_machine` (-3.6, 1.05, -2) and `ANCHOR_phone` (-1.3, 0.65, -1.2) are toward the back of the room;
  - the camera looks from +x +z (yaw 45°);
  - so Papa reaches both with his back to the camera. That is why D5 turns him to drink.

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Art authored by the agent, headless, as 7.2 D3.** First-pass poses and props scripted in the scratchpad, the `.blend` as the source, Geo free to redo any of it and rerun the two commands. | No human is scheduled to animate, and 7.2 shipped this way. The contract and the guards, not the hand, define what the code needs. |
| D2 | **Scale the props' mesh data, grips at their bones.** Measure size by the longest side of the box at rest, compared with 7.2's numbers. The handset may become a real handset shape. | An object scale would be baked differently by gltfpack's quantisation (every mesh node carries a scale near 6e-5) and could move the grip. « Au moins ×2 » needs a measure a test can hold; the box's longest side is the one that reads on screen. |
| D3 | **Steam and bla-bla: meshes in the `.glb`, motion in code.** The view sways `papa_mug_steam` (rotation about its forward axis, and a height stretch) and wobbles `papa_blabla` (in-plane tilt and a bob) from `clockMs` and `busyProps`. No clip keys them (`codeDrivenNodes`, guarded). | Reduced motion must keep the clip (it carries the state) and stop these alone. A clip cannot be half switched off, and a second mixer layer is new machinery for two props. In the file, Geo redraws them in Blender, and 7.3's hulls outline them for free (the hull is a sibling under the named node, so moving the node moves both). The « Z » is the precedent for code motion on the sim clock. |
| D4 | **The bubble does not turn with Papa.** `papa_blabla` is moved at creation from the rig into the view's `group`, which carries the shadow and the « Z » and never turns. There it stands at a fixed offset toward one side of the screen and at head height, faces the camera, and keeps its wobble. The view frees its geometry (and its hull's) in `dispose`, since `rig.dispose()` traverses `rig.root` only. Squiggles, not letters. | Parented to `head`, the bubble would hide behind his head whenever he turns his back to the camera, which `awayFromBaby` often does. A billboard in the group reads from every heading at no per-frame cost. A word would be a string outside `strings.fr.json` and `t()`; squiggles are the scribbled « bla bla » of comics. |
| D5 | **Facing is per clip, in data.** `papaClipFacing` maps a clip to `camera` or `awayFromBaby`. The view reads `rig.clipName`, so the kick holds the camera facing while the state is already `idle`. It falls back to the heading: <br>- with no row; <br>- with a carried baby (meaningless); <br>- with a baby `mischiefSilent` (turning away from a hidden baby would point the player at him: the spirit of 7.2 D9); <br>- with the baby within about 0.05 m. <br>The turn goes through `turnToward` at `turnRateDegPerSec` (720°/s, a half turn in 250 ms). | The coffee machine and the phone stand at the back: Papa drinks with his back to the camera, so the mug and the widened eyes would be hidden. The GDD wants the phone's back turned to the baby: « c'est le pari ». Data, because whether he faces us to drink is a feel call (golden rule); removing a row restores 7.2's behaviour. `pose.yawRad` is untouched: markers, hit tests and the sim never see this. |
| D6 | **The eyes widen through a bone, keyed only by `coffee_kick`.** It is a new `eyes` bone under `head`, not code-driven. The lids keep `eyelids` (code-driven, no track). | The widening is a one-off gesture tied to an event, which is what one-shots are for (7.2 D5). A code-driven scale would need a timer and an event hook for one gesture. The guard pins that only `coffee_kick` keys it, so a later clip that uses it (a `gag_shock`, say) is a deliberate change of that test. |
| D7 | **The slurp is on `CoffeeStarted`.** It is a sim-event cue with a `soundWave` twin and a light haptic, and the clip is a placeholder synth. | The GDD's order is mug, steam, slurp, then eyes. `CoffeeDrunk` already carries 2.12's ding, pop and vibration (`papa_free`) and now the kick: a third sound there would crowd it. A sim event's cue cannot be `uiElement` (`contentChecks.ts`), hence the ring. The final sound is 7.5's or Geo's recording. |
| D8 | **No elbows, no carried variants.** The poses read through the props' size, the head and spine, the arms' swing and the facing. | Adding `forearm_*` reweights the shirt, the inside-out shirt and the body, and moves all 15 clips: a 7.x art pass, not this story. `deferred-work.md` L930 and L936 stay open, and say so. |
| D9 | **No sim change.** Everything comes from `papa.state`, the baby's position and state, `CoffeeStarted` and `CoffeeDrunk`. | « Papa busy » is already exact in the sim (P1). `feedback.json` is not hashed into the journal, so no golden moves (AC 12). |
| D10 | **Three things near Papa's head.** The DOM activity bubble is centred at `PAPA_HEIGHT_M + COMBO_BADGE_OFFSET_M` = 1.2 m, with its ring and tail reaching toward his head. The badge sits on its right, and the bubble steps left when a threat follows Papa. The 3D bla-bla goes beside his head, lower than the DOM bubble, on the side `blablaPlace.screenOffsetM` sets (positive is screen right). | The CSS2D layer is drawn over the canvas, so a bla-bla under the DOM bubble would be hidden. At about 80 px/m (7.3's estimate at 844 wide), the DOM bubble's half-width with its ring is about 0.4 m: start the side at 0.35–0.5 m and measure on the captures. If the bubble's left step makes them meet, put the bla-bla on the right, below the badge. |

### What exists, and what must keep working

- **`papaView.ts`** (277 lines).
  - **Today:** the rig plus the code-made « Z ». It hides `papa_mug`, `papa_handset`, `papa_hair`, `papa_look_mash`, `papa_look_shirt` at creation. `setDrinking` / `setOnPhone` toggle visibility only. `animate` turns the body toward `pose.yawRad`, plays `papaClipOf`, and updates the rig.
  - **Changes:** the facing target, the two setters' extra arguments and motion, the reparented bubble, the getters.
  - **Preserved:**
    - every other method and its meaning;
    - `PAPA_HEIGHT_M`, `papaPoseAt`, the shadow that does not turn, node names;
    - `setAway` hiding the whole group (the bubble too, since it is now in `group`);
    - the eyelids rule.
- **`characterRig.ts`:**
  - `node(name)` warns once and returns an empty `Group` for a missing node, so a contract node missing from the file shows as a `warn` in AC 15, not a crash;
  - `clipName` is the one-shot while it plays, else the loop;
  - `playOnce` restarts a fading clip.

  Unchanged.
- **`characterClips.ts`:** `PAPA_LOOPS` already maps `drink` and `onPhone`. Only the one-shot switch and the contract change. The architecture test « every clip characterClips.ts writes is in its contract » reads the code above `/** Papa's contract`: keep `'coffee_kick'` written as a plain string return there.
- **`characterMotion.ts`:** `turnToward`, `wrapAngleRad`, the clip speeds. The new helper lives here (pure, no Three).
- **`levelScene.ts` L528–558:** the order of `update`: pose, then mixers, squash, props, then the busy setters. Keep it.
  - `playCharacterEvent` already routes every sim event, with the squash rows skipped under reduced motion. The new `CoffeeDrunk` row and one-shot need no wiring beyond the switch and the enum.
  - A one-shot is skipped while gliding, which cannot happen at `CoffeeDrunk`.
- **`boot.ts` L1436:** `currentLevel.fx.playCharacterEvent(event, world, isMotionReduced)` for every sim event. Unchanged.
- **2.12's bubble** (`ui/world/activityBubble.ts`): a separate DOM layer, untouched. Its ring, pop and ding are the busy timing; this story adds the body.
- **Outlines (7.3):** hulls are added in `createCharacterRig` as siblings under each named node. Moving `papa_blabla`'s named node moves its hull. `outlines.skipMaterials` is `["art_ink"]`, so the ink squiggles get no hull, which is right.
- **Guards that already hold the props:**
  - « raises the mug to his head while he drinks » (centre > 0.45 m, touches the body);
  - « holds the handset by his head » (centre > 0.55 m);
  - « no clip sinks him ».

  Keep them green; do not loosen them.
- **Must not change:** AC 12's paths, plus `CHARACTER_GLTFPACK_FLAGS`, `GLTFPACK_FLAGS`, the baby's files, `tools/blender/export_character.py` (it already exports every action and every object).

### Traps

- **Six materials is the cap, and the file is at it.** A new material, even a « steam white », fails `characterRigProblems`.
- **The visible budget counts nodes not listed as hidden.** `papa_mug_steam` sits under `papa_mug`, so it is skipped either way, but `papa_blabla` must be in `hiddenNodes`, or its triangles count against the 4,000.
- **Blender 5 actions need a slot and a fake user** to export (7.2 T0). A new action with no slot exports nothing, silently: the contract test catches it.
- **`export_optimize_animation_keep_anim_armature=False` drops constant tracks.** An `eyes` scale that never leaves 1 in `coffee_kick` exports no track, and the guard fails. That is intended.
- **A one-shot ends when its time left is ≤ `crossFadeMs` (140 ms).** Keep `coffee_kick` well over three times that.
- **The facing reads `rig.clipName`, which is a string.** Look it up in the facing rows with a loop, as `clipTimeScaleOf` does, with no `find` closure per frame.
- **`ISO_YAW_DEG` is in degrees, and Papa's yaw convention is 0 = +z, positive toward +x** (`papaPoseAt` uses `atan2(headingX, headingZ)`). The camera sits at `(sin yaw, ·, cos yaw)` from the centre, so facing the camera is `ISO_YAW_DEG × π / 180`. Verify it on a capture, not only by algebra.
- **Reparenting a node that gltfpack put under a quantised child**: move the **named** node (`papa_blabla`), never its unnamed mesh child, or the dequantisation scale is lost.
- **Hidden accessories are toggled on the named node**: the mesh is its unnamed child (7.1, 7.2).
- **`ppAdvance` runs steps without a frame:** `waitFrames` before reading `fx()` or the DOM. The drawn clock trails by one step in a frozen frame.
- **`VITE_DEBUG_ALLOWED=false` may be exported in the agent shell.** Run `env | grep VITE_` first; wrap `dev` and `e2e` in `(unset VITE_DEBUG_ALLOWED; …)`.
- **E2E only through `npm run e2e -- <files> --project=chromium`** (the heavy-check lock), in the background. The Mac sleeps during long background runs: `caffeinate -i -s`.
- **`golden:update` here is a mistake** (AC 12).

### Architecture compliance

- Client-only. The view reads `world.papa`, `world.baby`, the drawn clock and `feedback.json`, and never writes the world. No deep import of `src/sim/...`: `PapaSlice`, `BabySlice` and the event types come from `@sim`.
- The architecture's E2 (v2.3) row (`game-architecture.md` L978) names `public/assets/characters/papa.glb` for this story: that is the file that changes.
- Feedback goes through `FeedbackDirector` and `feedback.json` (ADR-006: a cue with audio has a visual and a haptic twin).
- Reduced motion is client-only. `reducedMotion` never appears in the sim, the bots or the tools.
- Zero allocation on the rAF path: scratch values reused, no closures, arrays or literals per frame. Nothing loads during play.
- Budgets: ≤ 100 draw calls, ≤ 100k triangles, level payload ≤ 3 MiB.

### Library and framework notes

No new dependency and no upgrade: `three@0.186.1`, `gltfpack@1.3.0`, Blender 5.2.3 LTS, all pinned, and the exporter's arguments were checked against the running Blender in 7.2's T0. No web research is relevant. Three's `Object3D.add` reparents (it removes the node from its old parent), and it keeps the local transform, not the world one: set the bubble's position after the move.

### File structure

- **New:**
  - `public/assets/audio/papa_coffee_slurp.m4a`;
  - `_bmad-output/implementation-artifacts/2-13-screenshots/`.
- **Updated (art):** `assets-src/blender/characters/papa.blend`, `public/assets/characters/papa.glb`.
- **Updated (code):**
  - `src/client/render/views/{papaView,characterClips,characterMotion}.ts`;
  - `src/client/render/levelScene.ts`, `src/client/app/testHost.ts`;
  - `src/content/schemas/feedback.ts`, `content/feedback.json`, `content/_schemas/feedback.schema.json`;
  - `tools/assets/characterArt.ts`, `tools/audio/makePlaceholderAudio.ts`.
- **Updated (tests):**
  - the colocated tests of the views and of `levelScene`;
  - `tests/architecture/characterAssets.test.ts`, `tests/tools/assets/characterArt.test.ts`;
  - `tests/content/feedbackSchema.test.ts`, `tests/support/testContent.ts`;
  - `tests/e2e/{characters,reducedMotion}.spec.ts`, `tests/e2e/support/testApi.ts`;
  - the darwin references only if T9 says they moved.
- **Docs:** `_bmad-output/project-context.md`, `EXPERIENCE.md`, `deferred-work.md`.
- **Not touched:** AC 12's paths, `baby.blend`, `baby.glb`, `src/client/ui/world/**`.

### Testing

- **Unit:**
  - `papaFacingYawRad`, every branch;
  - `papaView`: the props shown per state; the sway changes with `clockMs` and not with `dtMs` 0; held at rest under reduced motion; the bubble in `group` with its yaw; `dispose` frees the bubble's geometry (spy, as 7.2's review did for the mixer);
  - `papaOneShotOf(CoffeeDrunk)`;
  - the schema's bounds and refusals;
  - `characterRigProblems` on a `codeDrivenNodes` fixture.
- **Architecture:** the committed file's sizes, steam, eyes, facing clips and contract (T2), with no Blender in CI (the JSON chunk through `parseGlb`, poses through `parseCharacterGlb` and an `AnimationMixer`).
- **E2E (Chromium):** T6. Bounds from the live content and feel, never literals copied from them.
- **Checks:** `npm run ci:fast` after each task, the touched specs (T6), T7 and T8 after the last art edit. `ci:story` belongs to the review, before the merge.

### Previous story intelligence

- **2.12 (bubble, merged at e720fd9).**
  - The bubble is the busy timing, in sim time, at 1.2 m. Its open point 5 (the « Z » under the bubble) is still Geo's: do not change the « Z ».
  - Its notes ask Geo to judge whether the cup glyph should become a steaming cup: that is the bubble's pictogram, not this story.
  - Its review found vacuous e2e assertions and screenshots claimed but not taken: avoid both.
  - It also found a shake swallowed by a WAAPI animation on the same `transform`. The analogue here is the bubble's wobble against the group's transform: animate the bubble node only, never `group`.
- **7.2 (rig).**
  - The kit, the contract and the guards.
  - « No one has watched them move »: say plainly what you watched move and what you only saw as frozen frames.
  - Run T7 and T8 **after** the last art edit (7.1 had to rerun them).
  - Its deferred items L930 (elbows) and L936 (carried variants) are this story's D8.
- **7.3 (outlines).** Hulls are siblings under named nodes; `art_ink` is skipped. Its perf at the time: salon 87 draw calls max, bedroom 79, p95 16.7 ms; payload 2,634.9 KiB. The audio has grown since (2.12's clips, 7.7's babble): today it is about 2,516 KiB plus about 141 KiB of `.glb` files, which leaves about 400 KiB.
- **2.10 (reduced motion).** Every reduced rule is client-only and reads the saved setting. Nothing flashes above 3 Hz. A pose is kept (7.2 D7, `EXPERIENCE.md`).
- **1.19 / 1.20.** `CoffeeStarted` / `CoffeeDrunk` (fatigue drops at the end), `PhoneAnswered` (fatigue added at once, the `papa_phone_answer` cue through the disruption def). A nap can cut the coffee or the call (`putPapaToSleep`): no `CoffeeDrunk` then.

### Git intelligence

The last commits are 2.12 (bubble, `TapRefused`, `activityBubble.ts`, `feedback.json`, `project-context.md`) and 3.13 (route fairness, sim side). This story touches `feedback.json`, `project-context.md`, `deferred-work.md` and `EXPERIENCE.md` like them; merge by hand if one moves under it.

**`papa.blend` and `papa.glb` are binaries.** If any other story touches them before this merges, stop and ask Geo (CLAUDE.md › Git workflow). Today none in the backlog before E9 does: 3.14 is bots, 3.15 adds after-effects that may want a pose, so watch for it, and 3.16 is UI.

### Project Structure Notes

- Everything follows 7.2's layout (`assets-src/blender/characters/`, `public/assets/characters/`, `src/client/render/views/`).
- **Variance:** `codeDrivenNodes` is a new contract field beside `codeDrivenBones`, for objects (not bones) the code moves; the guard treats both the same.
- **Variance:** the bubble is reparented out of the rig at runtime (D4). It is the first node to leave `rig.root`, hence the explicit dispose.

### Project Context Rules

- **Golden rule:** the AI builds and tests, Geo plays and tunes. The facing, the props' motion, the squash and the cue are data in `feedback.json`, never literals in the view.
- **Layers:** `client` may import `three`, `@sim`, `@content`, `@shared`. `src/` never imports `tools/`. `tests/architecture` may import both.
- **Sim boundary:** the client reads `world` only and never reads a gameplay value from a mixer or a bone. Views take Papa, the baby and events, never a threat.
- **Units are suffixes:** `steamSwayDeg`, `steamPeriodMs`, `blablaBobAmplitudeM`, `amountPct`, `bodyYawRad`. Booleans are `is…` / `has…`.
- **Time:** the mixers and the side effects use the sim clock (`clockMs`); nothing here uses real time.
- **I/O and logs:** no `console.*`; a missing node warns once (`rig.node`); channels `assets`, `render`.
- **TypeScript:** `strict`, `erasableSyntaxOnly`. The facing kinds are a string-literal union from the schema, not an `enum`.
- **Content:** ids `lower_snake_case`; JSON keys `camelCase`; `npm run content:schemas` after a schema change, never a hand edit of `content/_schemas/`.
- **Git:** this worktree, branch `story/2-13-poses-exagerees-du-cafe-et-du-telephone`. Commit « Story 2.13 : poses exagérées du café et du téléphone ». Merge only after the review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. **Turning to face the camera to drink** (D5). The machine is at the back, so without it you would see his back and not the mug or the eyes. Remove the `drink` / `coffee_kick` rows from `papaClipFacing` to go back to facing the machine.
2. **« bla bla » as squiggles, not letters** (D4). Readable letters would be a word outside the string table; say if you want the word.
3. **The slurp at the start of the coffee** (D7), not at the end where the ding and the kick already play.
4. **No elbows** (D8): the poses stay « rigid parts ». Elbows are a later art pass.
5. **Sizes:** ×2 is the floor the epics set. Whether a 0.64 m handset on a 0.9 m Papa is funny or too much is your call.
6. **Where the bla-bla stands** (D10, review 2026-11-04). T9 retuned `blablaPlace` to `screenOffsetM` 0.85 / `heightM` 0.35 so that the DOM activity bubble does not hide it: it stands at his side at hip level, not beside his head. Kept as is by Geo's call; the frame with the activity bubble stepping left while he is on the phone was never captured, so that overlap has not been seen. It is data (`feedback.json › characters.busyProps.blablaPlace`).
7. **The handset's cups are paper** (AC 6): the two cups are `art_paper`, the bar and arms `art_ink`, because an all-ink handset read as a black bar from the front.
8. **The mug and the steam leave with the sip** (review 2026-11-04): `CoffeeDrunk` puts him in `idle` in the same step, so the `coffee_kick` plays with an empty fist and no steam. Kept as is by Geo's call.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.13] (L1621–1642), Epic 2 (L1250)
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md] L56, L85, L124, L142, L220–235
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] mechanic 15 (L236–242), L248 (« papa tourne le dos au bébé : c'est le pari »), style (L529); `decision-log.md` L52
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L978 (E2 v2.3 row), P1 (busy Papa), P3 (choreography), ADR-006
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L217 (activity-bubble), L447–465 (reduced motion table)
- [Source: _bmad-output/project-context.md] L43 (Busy Papa), L99 (Activity bubble), L176 (Rigged characters), Performance Rules (L101–109)
- [Source: _bmad-output/implementation-artifacts/7-2-personnages-rigges-et-animes.md] D3–D10, T0 notes, Review Findings
- [Source: _bmad-output/implementation-artifacts/7-3-rendu-toon-final-et-effets.md] D3, D4, perf table (L234–239)
- [Source: _bmad-output/implementation-artifacts/2-12-bulle-d-activite-de-papa-et-tap-refuse-visible.md] D6, open points, Review Findings
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L342, L378, L915, L930, L936, L977
- [Source: src/client/render/views/papaView.ts, characterClips.ts (`PAPA_CONTRACT`), characterMotion.ts, characterRig.ts L150–195], [src/client/render/levelScene.ts L456–558], [src/client/boot.ts L1436]
- [Source: tools/assets/characterArt.ts, tools/blender/export_character.py, tests/architecture/characterAssets.test.ts L188–252, tests/support/testCharacters.ts]
- [Source: src/content/schemas/feedback.ts L113–215 (cues), L426–511 (characters), content/feedback.json L96–115, L538–570]
- [Source: src/sim/papa/coffee.ts, src/sim/papa/phoneCall.ts, src/sim/papa/papaSystem.ts L31–51, src/sim/events.ts L309–332], [content/levels/salon_crawler.geometry.json L80, L100], [src/shared/constants.ts L169 `ISO_YAW_DEG`, L271 `COMBO_BADGE_OFFSET_M`, L343 `SCREEN_FLASH_MIN_INTERVAL_MS`]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), in the story's worktree on `story/2-13-poses-exagerees-du-cafe-et-du-telephone`.

### Debug Log References

- `papa.blend` was read and authored headless (Blender 5.2.3, `-b … -P <scratchpad script>`), never through the live MCP session. The scripts stayed in the scratchpad (throwaway: the `.blend` is the source, D1). The authoring step started again from `git show HEAD:…/papa.blend` each time, so no edit was applied twice.
- Poses were not hand-keyed blind: a small forward-kinematics module (validated against Blender's own measure of the 7.2 poses to the millimetre) and a pattern search found the arm and hand angles that put the huge mug's rim at his lips, then Blender's flat workbench renders (never saved into the file) showed each key before the real game did.
- Two dead ends worth knowing: (1) a first mug tilt of about 65° hid the steam, which is the mug's child and tips with it, and covered his eyes; the final poses keep the cup within about 40° of upright, so the steam rises in front of his face. (2) With the handset's cups all on `art_ink`, the front view read as a black bar; the cups are in `art_paper` now (their hull gives the outline).
- `?threats=off` also drops the planned phone, so the combo-badge capture was staged differently (see « Screenshots »).

### Completion Notes List

**What is in**

- **Data and schema (T1).** `characters.papaClipFacing` (`drink` and `coffee_kick` face the camera, `on_phone` turns away from the baby) and `characters.busyProps` (sway, stretch, tilt, bob, periods, `blablaPlace`) in `feedback.json` and `CharactersSchema`, with a duplicate-clip refusal and every bound of the story; `SQUASH_EVENTS` gains `CoffeeDrunk` with a squash row (18 %, 320 ms); the cue `papa_coffee_slurp` (audio, `soundWave`, `light`) on `CoffeeStarted`. `UNIT_SUFFIX` was not touched. `content:schemas` regenerated, `tests/support/testContent.ts` and the two other fixtures that spell `characters` follow.
- **Slurp (T5).** `synthCoffeeSlurp` in `makePlaceholderAudio.ts` (seed `SEED + 50`, the next free offset after the shutter's 49): a 350 ms hiss that brightens over a wobbling, rising gurgle, unlike `papa_busy`. `papa_coffee_slurp.m4a` is 7.8 KB.
- **Contract and guards (T2).** `PAPA_CONTRACT` gains the `eyes` bone, the hidden nodes `papa_mug_steam` and `papa_blabla`, the clip `coffee_kick` and `codeDrivenNodes`; `CharacterContract` and `characterRigProblems` refuse a clip track on a code-driven node, with a failing fixture. `characterAssets.test.ts` holds: the mug ≥ 2 × 0.218 m and the handset ≥ 2 × 0.32 m (the two constants named, longest side of the box at rest), the steam above the mug in `drink`, the `eyes` scale ≥ 1.4 in `coffee_kick` and no `eyes` track in any other clip, no track on the steam, the bubble or the lids, and every clip of `papaClipFacing` in the file. All six failed on the 7.2 file before the art, and pass after it.
- **Art (T3).** `papa_mug` is 0.502 m on its longest side (×2.3, scaled in the mesh data about the handle so that the handle stays in his fist, the object only moved to put it there); `papa_handset` is a 0.671 m handset (a bar, two arms and two paper cups); `papa_mug_steam` (two wisps, `art_paper`, origin at the rim, child of the mug); `papa_blabla` (a paper bubble with a tail and three ink squiggles, child of the armature object, origin at the tail's tip, facing Blender's −Y); the `eyes` bone (child of `head`, straight up, no roll) holds the 120 white and 120 pupil polygons moved off `head`, none of them shared with the face. `drink` (60 frames, two sips, the free arm flung wide), `on_phone` (49 frames, the handset at the left ear, the right arm gesturing, a nod every 12 frames, never faster than 2.5 Hz) and the new `coffee_kick` (22 frames = 0.73 s, 5 × the 140 ms cross-fade; the eyes scale to 1.7) are authored. No new material (6), no image packed, no orphan. `papa.glb` is 59.2 KB (46.6 KB before), 4 visible draw calls and 2,600 visible triangles as before (the new nodes are hidden), 11 bones.
- **View (T4).** `papaFacingYawRad` (pure, in `characterMotion.ts`, a unit test per branch), `busyCycleAt`, the `CoffeeDrunk → coffee_kick` one-shot, `papaView` turning the body toward the facing of the clip the player sees (`rig.clipName`, so the kick keeps the camera facing once he is idle) with `pose.yawRad` untouched, the steam and bubble setters on `clockMs` (held at the rest transform under reduced motion, written only while shown), the bubble moved into `group` at creation (its geometry and its hull's freed in `dispose`), the getters, `realFxState` and `__PP__.fx()` (`papaBodyYawRad`, `papaSteamSwayDeg`, `papaBlablaTiltDeg`; `dist:check --flavor prod` still finds no debug marker). Two choices the story left open: the camera facing never depends on the baby (the carried, hiding and too-close fallbacks only apply to `awayFromBaby`, the only facing that reads him), and `createBabyView` takes only the two fields of `CharacterMotionConfig` it reads.
- **Tests (T6).** Unit: `papaView` (facing for the camera, away, back to the heading for a carried or hiding baby, the kick, the turn rate and a pause; the steam and bubble on the sim clock, held, hidden, in the group, faced, freed), `levelScene` (the setters on the sim clock, reduced motion, the squash and the kick on `CoffeeDrunk`), `characterClips`, `characterMotion`, the schema bounds. E2E on Chromium, a frozen salon through `__PP__`: `characters.spec.ts › Papa busy` (the facing and sway of the coffee, its kick and its return to the loop, the call's facing against the angle computed from the world, draw calls ≤ `DRAW_CALLS_MAX` in both) and `reducedMotion.spec.ts` (the clip, the mixer and the turn stay, the steam and the bubble hold exactly still, with a positive control). The sim's heading is asserted to differ from the wanted facing before each turn is read, so a test cannot pass for a body that never turned. Not done: a mutation run of the e2e (removing a facing row to watch a spec fail); the unit tests pin each branch instead.
- **Nothing moved (T7).** `git diff --stat main` is empty on AC 12's paths; the four bots on both levels at seed 1 give 8 reports byte-identical to `main` (one script, both checkouts); `ci:fast` passes with no golden regenerated.
- **Docs (T10).** `project-context.md` (the `codeDrivenNodes`, `papaClipFacing`, `busyProps` on the sim clock and held under reduced motion, the `eyes` bone, the slurp), the `EXPERIENCE.md` reduced-motion row, `deferred-work.md` (the coffee's sound closed; elbows and carried variants recorded as still open, D8).

**Budgets (T8, after the last art edit).** `npm run build:playtest` then `npm run dist:check -- --flavor playtest`: level payload 2,671.3 KiB (≤ 3 MiB), first-load gzip 4,350.6 KiB. `npm run e2e:dist` (12 dist specs on chromium and webkit, then `perf.spec.ts` alone, a whole salon level at speed 1, chromium): p95 frame 16.8 ms (≤ 20), draw calls max 85 (≤ 100), triangles max 15,394 (≤ 100k), 16,035 frames; both runs green on the first try, no rerun needed (the 7.3 figures were 87 draw calls and p95 16.7 ms). Prod build (`build` and `dist:check --flavor prod`) not rerun here: it belongs to `npm run ci` at the end of the epic.

**Screenshots (T9, AC 16).** In `2-13-screenshots/`, taken on a frozen salon through `__PP__` at 844 × 390 and 667 × 375: each `…-<name>.png` is the frame as played (css pixels), each `…-zoom.png` a close-up of Papa at 3× with the DOM activity bubble and the combo badge hidden, `capture-log.txt` the clip, yaw, steam, tilt and positions at each. Opened by me: the 844 close-ups of the sip (`coffee-2-sip`) and of the mid-clip (`coffee-4-mid`), `coffee-6-kick-wide` (the 667 one too), `phone-4-badge` (frame and close-up, and the 667 frame), `phone-6-baby-elsewhere`, `reduced-motion-drink`. Opened before the last edit of the bubble's size and place, so to look at again: `phone-1-baby-a`. Not opened: `coffee-1-ready`, `coffee-3-gulp`, `coffee-5-kick-early`, `coffee-7-kick-late`, `phone-2-baby-b`, `phone-3-baby-c`, and the 667 files other than the three named. Two baby positions: `phone-1-baby-a` (yaw −2.67 rad) and `phone-6-baby-elsewhere` (−1.52 rad). The badge frame (`phone-4-badge`, ×3) was staged by carrying the baby with the combo's carry tick and the cry-in-the-arms delay shortened by `setFeel` for the capture only (nothing of it is in the repo), because a threat gags and resets the combo before a normal call. **Not captured:** the bla-bla with the activity bubble *aside* (a threat that follows Papa while he is on the phone never came: the aside frame I got was after the call, with no bla-bla, so I deleted it). **Not watched:** the motion itself (the sway, the wobble, the sips between keys, the kick's timing); everything above is a frozen frame, and Geo's look is still owed.

**Tuned in T9.** `blablaPlace` went from 0.35 m / 0.8 m to 0.85 m / 0.35 m: at the first values the DOM activity bubble, drawn over the canvas, hid the bla-bla completely; at the new ones it stands at his right (screen), under the badge and clear of the bubble. The bubble mesh went from 0.42 m to 0.64 m wide and its squiggles got thicker, because 22 px was unreadable. The steam wisps grew (0.46 m tall) and the mug poses were reworked so the cup stays within about 40° of upright.

**Left for Geo / open.** The charm and the sizes (the 0.50 m mug and the 0.67 m handset on a 0.9 m Papa are a gag to judge); the steam and the bla-bla read small and pale at 844 × 390; the handset is a vertical bar hugging the head (the ear sits in the middle of it, the cups above and below), the first idea that kept both hand and ear reachable with one-bone arms; the free arm of `drink` and the nods of `on_phone` are first-pass keys. The open points of the story (the facing to drink, squiggles not letters, the slurp's place, no elbows, the sizes) are unchanged. `autoplay.spec.ts`'s frozen frame did not move (rest pose and file unchanged in view): no macOS reference was regenerated.

### File List

- `_bmad-output/implementation-artifacts/2-13-poses-exagerees-du-cafe-et-du-telephone.md` (this file)
- `_bmad-output/implementation-artifacts/2-13-screenshots/` (new: 52 captures and `capture-log.txt`)
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`
- `_bmad-output/project-context.md`
- `assets-src/blender/characters/papa.blend`
- `content/_schemas/feedback.schema.json` (regenerated)
- `content/feedback.json`
- `public/assets/audio/papa_coffee_slurp.m4a` (new)
- `public/assets/characters/papa.glb`
- `src/client/app/levelSession.test.ts`
- `src/client/app/testHost.ts`
- `src/client/boot.ts`
- `src/client/feedback/feedbackDirector.test.ts`
- `src/client/render/levelScene.ts`
- `src/client/render/levelScene.test.ts`
- `src/client/render/views/babyView.ts`
- `src/client/render/views/characterClips.ts`
- `src/client/render/views/characterClips.test.ts`
- `src/client/render/views/characterMotion.ts`
- `src/client/render/views/characterMotion.test.ts`
- `src/client/render/views/papaView.ts`
- `src/client/render/views/papaView.test.ts`
- `src/content/schemas/feedback.ts`
- `tests/architecture/characterAssets.test.ts`
- `tests/content/feedbackSchema.test.ts`
- `tests/e2e/characters.spec.ts`
- `tests/e2e/reducedMotion.spec.ts`
- `tests/e2e/support/busyPapa.ts` (new)
- `tests/e2e/support/testApi.ts`
- `tests/support/fakeTestHost.ts`
- `tests/support/testCharacters.ts`
- `tests/support/testContent.ts`
- `tests/tools/assets/characterArt.test.ts`
- `tools/assets/characterArt.ts`
- `tools/audio/makePlaceholderAudio.ts`

### Change Log

- 2026-11-04: Story 2.13 implemented: the huge mug and handset, the reauthored `drink` and `on_phone` and the new `coffee_kick` in `papa.blend` (with the steam, the bla-bla bubble and the `eyes` bone), the facing per clip and the busy props' side effects on the sim clock (held under reduced motion), the slurp cue, the contract and its guards, the tests, the captures and the docs. No sim change; 8 bot reports byte-identical to `main`. Status: review.
- 2026-11-04: Code review (3 layers): 3 decisions settled by Geo (bla-bla place kept and documented, mug leaves with the sip, `camera` facing independent of the baby with AC 9 amended), 7 patches applied (steam parent and eyes guards on the real `.glb`, dead helper, test titles, wording, story record), 7 findings deferred. Status: done.
