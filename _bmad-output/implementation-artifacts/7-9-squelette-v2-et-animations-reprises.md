# Story 7.9: Squelette v2 et animations reprises

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want Papa and the baby to bend their elbows and knees, and their gestures to have anticipation and follow-through,
so that their movements are supple and expressive.

**Requirements covered:** FR79 (the v2 skeleton, the forelock, the retaken clips), FR70. **Depends on:** the rigs, kit and pipeline of 7.2, the hulls and toon look of 7.3 / 7.8, the life layer of 7.8 (`feel.json › characters`, the springs, the frame order), the look of 3.7.

**Scope:** the two `.blend` files get the v2 skeleton (Papa 11 → 22 bones, the baby 9 → 19), new weights, two eyebrows each and Papa's forelock, at no more triangles and no more draw calls; all 30 clips (16 + 14) are retaken on it under their own names with anticipation, overshoot and arcs; the client gains the forelock's lag (a pendulum on the sim clock, `feel.json › characters.forelock`) and the guards on the new files. The eyebrows stay neutral (at rest) until 7.10.

**Not in this story:**
- Expressions and anything that moves the eyebrows (7.10). Starts, stops, idles, tiptoe, puffed cheeks (7.11). New clips of any kind (7.11 to 7.15; `victory_dance` and `collapse` are 7.4's, see D12).
- Moving the life layer to `pelvis` or `neck` (D2). The shuffling walk (7.14). Mama, the dog, the children.
- Any change to `src/sim`, `src/bots`, the rooms (`assets-src/blender/*.blend` at the top level, `public/assets/levels/`, `content/levels/`), `content/threats/`, `content/sequences/`, `public/_headers`, `tools/blender/export_level.py`.
- Renaming `eyes_open` (the deferred name question of 7.2 stays open: the clip keeps its name, D5).

## Acceptance Criteria

The epics' criteria (`epics.md › Story 7.9`), made testable. The decisions D1-D14 below are part of them.

1. **Skeleton v2.** `papa.glb` has the 22 bones and `baby.glb` the 19 bones of D1, with the parents of D1, in one skin each, at most 4 influences a vertex. `CHARACTER_BONES_MAX` (32) does not change. Every bone of both files has an identity rest rotation and a unit rest scale (the rule the code's axes and absolute writes rely on; closes the 7.2 deferred item « code-driven bones assume an identity rest rotation »).
2. **No more triangles, no more draw calls.** Papa: at most 2,600 visible triangles and 4,416 in all (hidden accessories included); the baby: at most 2,516. At most 4 draw calls each (today's count), no new material (Papa stays at 6 = `CHARACTER_MATERIALS_MAX`). The eyebrows and the forelock are in `art_ink`, inside the body mesh (D4).
3. **Every clip retaken, same names.** The 16 clips of `PAPA_CONTRACT.clips` and the 14 of `BABY_CONTRACT.clips` are re-keyed on the v2 skeleton with anticipation, overshoot and arcs (D6, the retake sheet). In `characterClips.ts`, `PAPA_LOOPS`, `BABY_LOOPS`, the `*_TRAVELLING` records, `papaClipOf`, `babyClipOf`, `papaOneShotOf`, `babyOneShotOf`, `responseClipOf` and `babyLidsAfter` do not change; only the two contracts gain the v2 bones, the code-driven bones and the marker node. Loops keep their exact frame range; a one-shot keeps its own or grows by at most 4 frames (D5). Each clip's duration before and after is in the completion notes.
4. **The gameplay silhouettes hold (D8 of 7.2).** Every existing test of `tests/architecture/characterAssets.test.ts` passes on the new files (Papa's height and width, no clip sinks him, the baby's size and centre, no clip lifts him above the 0.9 m sofa, the mug, the handset, the hair, the mash, the inside-out shirt, the eyes of `coffee_kick` only, the one-shots at least `2 × fades.returnMs`). New ones, which pass on today's files too: every loop but the baby's `carried` (and `gag_shock`, also a one-shot) keeps his lowest point within ±0.03 m of the floor at 9 samples (« pieds au sol »); in `carry_idle` and `carry_walk` both `hand_*` bones stay within 0.35 m of the carried baby's centre (`BABY_CARRIED_FORWARD_M`, `BABY_CARRIED_HEIGHT_M`) at 9 samples (today 0.26 to 0.30 m); elbows and knees bend one way only (D6); the inside-out shirt stays on the shirt in `drink` too (its elbow bends).
5. **Code-driven bones have no track.** `codeDrivenBones` is `eyelids`, `brow_l`, `brow_r`, `forelock` for Papa and `head`, `eyelids`, `brow_l`, `brow_r` for the baby; `characterRigProblems` refuses a clip track on any of them, and `characterAssets.test.ts`' « keys nothing the code moves » names them too. Nothing in the client writes a brow in this story: a unit test finds both brows of both characters at their rest after a run of frames with every life input set (D3).
6. **The forelock.** Papa's forelock trails his head's motion, whatever moves it (his clip, the life layer, the walk, a glide, the squash): it is a pendulum stepped at `STEP_MS` on the sim clock, its tip chasing where it would be if rigid, through `forelock.reachMs` and `forelock.dampingRatio`, its turn from rest capped at `forelock.maxDeg`, written after the gaze (D7). A still head brings it back to rest (within 0.5° after `5 × reachMs`); a `dtMs` of 0 holds it; under reduced motion it stays at rest; a restart, a replay moment (`resetFx`) and his return from `setAway` put it at rest with no swing. It hangs: its tip at rest points at least 45° below the horizontal, and the schema caps `maxDeg` at 40, so it never stands up. It is not the hair on end of the outlet gag: a different node (`papa_hair` is untouched), always shown, at the front of the head, clear of the brows and the eyes (D8).
7. **Data, hot.** `forelock { reachMs, dampingRatio, maxDeg }` lives in `feel.json › characters` (client only), with Zod bounds and `describe`s, the regenerated `content/_schemas/feel.schema.json`, and is read from `world.feel.characters` every frame (`LifeInputs.characters`), so the feel panel changes it on the next frame.
8. **Budgets.** Each `.glb` stays under `CHARACTER_GLB_MAX_BYTES` (300 KiB). `npm run dist:check -- --flavor playtest` passes, so every level's payload holds NFR15 (D14: `salon_crawler` binds, with about 306 KiB of room for both characters together). `perf.spec.ts` passes on the built playtest (`npm run e2e:dist`): p95 ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles, with the numbers in the notes. Nothing in the rAF path allocates.
9. **The game does not move.** No file changes under the paths of « Not in this story ». `npm run golden:update` is run once, deliberately: only the `feelHash` and `worldHash` lines of `tests/golden/journals/` move, with the proof of D9. `npm run sim` with the four bots on `salon_kitchen`, `salon_crawler` and `chambre_night`, seed 1, gives the same reports as `main` apart from the hashes. `tests/bots/humanBotRegression.test.ts`: its whole-journal `PINNED` is re-pinned only if it moved, with `PINNED_COMMANDS` unchanged.
10. **Reproducible, nothing hidden.** The forelock reads only the sim clock and the drawn bones: no real time, `Math.random`, `Date`, `performance`, `world.rng` (the scans of `characterAssets.test.ts` cover its module). The same frames give the same forelock angle. No retaken clip moves before its own event (anticipation lives inside the clip, after the event that starts it), and the loops that play during the bedtime duel, the stealth exit and the feints stay calm and regular (D6). The `windowOpenAt` / `feintAt` / `realWakePct` / `toleranceMs` scan covers the new module.
11. **Geo can edit and re-export.** The committed `.blend` files are the source: rig, weights, eyebrows, forelock, the `papa_forelock_tip` marker, and every action with its slot and fake user. At the end, `npm run assets:character:export -- <id>` then `npm run assets:character:optimize -- <id>` on the committed `.blend` give the committed `.glb` (`git diff --stat` on `public/assets/characters/` is empty; if the exporter is not byte-stable, say so and show that every test passes on the re-export).
12. **Geo has seen it.** Before / after captures of each character in `7-9-screenshots/` (D11), the macOS references of `autoplay.spec.ts` and `afterEffects.spec.ts` regenerated deliberately (`--update-snapshots=all`, Chromium and WebKit), opened, and said so. Every image not opened is listed as not opened. The look of the joints, the retakes and the forelock are Geo's call; the merge waits for his visual OK.

## Tasks / Subtasks

- [ ] **T0. Before touching anything** (AC 3, 11, 12, D10-D12)
  - [ ] Read « Blender access » and « What exists » below, then `characterClips.ts`, `characterArt.ts`, `characterAssets.test.ts`, `papaView.ts`, `characterSpring.ts`, `lifeLayer.ts`, `tests/support/testCharacters.ts` in full. `env | grep VITE_` (memory: the shell may export `VITE_DEBUG_ALLOWED=false`).
  - [ ] `git log --oneline main -5` and `git worktree list`: is story 7.4 merged, under way on `story/7-4-celebration-finale-et-cadrages-parodiques`, or not started? Apply D12 before T3.
  - [ ] **The « before » captures, on the untouched files** (D11): the in-game set and the two pose sheets. Nothing of them can be redone once the `.glb` files are replaced, except from the main checkout.
  - [ ] Spike in the scratchpad, on a copy of `papa.blend`: an empty parented to a bone survives `export_character.py` + `CHARACTER_GLTFPACK_FLAGS` (`-cc -kn`) as a named node with its translation; a bone added in edit mode headless keeps an identity rest rotation in the `.glb`; Workbench renders headless (`-b`) on this Mac. Write what you found in the notes.
- [ ] **T1. Guards first, red on today's files where they should be** (AC 1, 2, 4, 5, D1, D3, D4)
  - [ ] `CharacterContract` gains `markerNodes: readonly string[]` (empty nodes the code reads a place from: no mesh, never drawn). `characterRigProblems` refuses a missing marker, a marker with a mesh, and a joint with a rest rotation or scale that is not identity. One failing fixture each in `tests/tools/assets/characterArt.test.ts` (its `CONTRACT` gains `markerNodes`).
  - [ ] `PAPA_CONTRACT` / `BABY_CONTRACT`: the v2 bones of D1, `codeDrivenBones` of AC 5, `markerNodes: ['papa_forelock_tip']` / `[]`. Nothing else of `characterClips.ts` changes (AC 3).
  - [ ] `characterAssets.test.ts`: the hierarchy of D1 (each bone's parent); the triangle and draw-call ceilings of AC 2 as named constants (`*_7_8`, « the counts before the v2 skeleton »), visible through `characterBudgetOf(json, hiddenNodes)` and in all through `characterBudgetOf(json, [])`; the floor contact of loops, the carry reach and the hinge test of AC 4 (D6) — the loops are the contract's clips that none of the one-shot lists names (the file already derives `papaOneShots` / `babyOneShots` from the source; `PAPA_LOOPS` is not exported and stays so), minus the baby's `carried`, so `gag_shock` is held to the one-shot rule; the inside-out shirt in `drink`; the forelock tip (parent `forelock`, length 0.02 to 0.12 m, at least 45° below the horizontal); the « keys nothing the code moves » regex with the brows and the forelock. Check that the new floor and carry tests pass on today's files before any art (they were measured on them).
- [ ] **T2. Data** (AC 7, 9, D7, D9)
  - [ ] `CharactersSchema.forelock` in `src/content/schemas/feel.ts`, after `stoop` (strict, `reachMs()` 50-1000, `dampingRatio` 0.3-1, `maxDeg` via `lifeDeg(40)`, `describe`s). `content/feel.json`, `tests/support/testFeel.json` and `tests/tools/vite/fixtures/feelSample.json` (a whole feel since 7.8) get the block with D7's starting values. `npm run content:schemas`. `tests/content/feelSchema.test.ts`: the bounds, and the unit-suffix rule passes with these names.
  - [ ] `npm run ci:fast`: the goldens go red on hashes only. `npm run golden:update` once; D9's proof; `humanBotRegression` as AC 9 says.
- [ ] **T3. Papa in Blender** (AC 1-6, 11, D1, D3-D6, D8, D10)
  - [ ] Headless, in this worktree, never in Geo's live MCP session. Add the bones of D1 in edit mode (straight up, no roll, like the others), re-parent `hand_*` under `forearm_*`, `spine` and the legs under `pelvis`, `head` under `neck`.
  - [ ] Weights: blend two bones across each new joint, ≤ 4 influences, normalised; `papa_body` (legs, feet, hands, head), `papa_shirt` and `papa_look_shirt` (the sleeves: same weights on both, since one replaces the other).
  - [ ] The eyebrows and the forelock: small `art_ink` pieces joined into `papa_body` (no new primitive), weighted 100 % to `brow_l`, `brow_r`, `forelock`. The lock hangs from the front hairline at one side of the forehead, clear of the brows and eyes (D8). The empty `papa_forelock_tip` at the lock's tip, parented to the `forelock` bone. Pay for the new pieces and joint rings by thinning elsewhere until AC 2 holds (D4).
  - [ ] Retake the 16 clips on the sheet (D5, D6). Each action keeps its name, slot and fake user; no key on `eyelids`, `brow_*`, `forelock`, `papa_mug_steam`, `papa_blabla`; `eyes` keyed by `coffee_kick` only.
  - [ ] Purge orphans, pack no image, save. `npm run assets:character:export -- papa`, `npm run assets:character:optimize -- papa`. T1's tests on the new file.
- [ ] **T4. The baby in Blender** (AC 1-5, 11, D1, D3-D6, D10)
  - [ ] Same steps: bones of D1 (no pelvis), weights (`baby_body`), the brows in `art_ink` joined into `baby_body`, triangles paid, the 14 clips retaken. No key on `head` (the gaze), `eyelids`, `brow_*`; his head's gestures stay on `neck`.
  - [ ] Export, optimise, T1's tests.
- [ ] **T5. The forelock in the client** (AC 6, 7, 10, D7, D13)
  - [ ] `src/client/render/views/forelock.ts` (pure, no Three): the tip's state as three `Spring`s of `characterSpring.ts` (x, y, z in world metres), `createForelockState`, `resetForelock(state, x, y, z)`, `stepForelock(state, restX, restY, restZ, dtMs, reachMs, dampingRatio)`. Tests next to it: a held target settles; 1, 3 or 7 frames over the same span with a held target give the same tip; `dtMs` 0 holds.
  - [ ] `papaView.ts`: after the gaze, `head.updateWorldMatrix(true, false)`; the rest tip in world = head's matrix × (forelock bone position + `papa_forelock_tip` position, read once at creation); step; the tip back into head space; `forelock.quaternion` = the rotation from the rest direction to it, capped at `maxDeg` (scratch `Vector3` / `Quaternion` / `Matrix4`, made once). Reduced motion, the first frame, `resetAnimation()` and the frame after `setAway(false)` put the tip on its rest (identity). Getter `forelockDeg`.
  - [ ] `tests/support/testCharacters.ts`: in `createTestPapa`, put `forelock` under `head` and the marker under `forelock` at about (0, −0.04, 0.03) m (as the steam goes under the mug). `papaView.test.ts`: still → rest within 0.5° after `5 × reachMs`; Papa moved along +x trails the tip toward −x (sign pinned), then settles; a big jump stops at `maxDeg`; reduced motion 0°; `dtMs` 0 with a still head holds; restart and return from away start at 0; a held gaze turn settles at 0; both characters' brows stay at rest (AC 5).
  - [ ] `realFxState()` / `__PP__.fx()`: `papaForelockDeg`. Update `tests/e2e/support/testApi.ts`, `tests/support/fakeTestHost.ts`, `src/debug/testApi.test.ts`.
  - [ ] `characterAssets.test.ts`: `forelock` joins `LIFE_VIEWS` (both scans).
- [ ] **T6. Prove nothing moved** (AC 9, 10, 11)
  - [ ] `git diff --stat main` on the paths of « Not in this story »: empty. D9's proof of the goldens. The bots on the three levels against `main`.
  - [ ] Re-export both characters from the committed `.blend` files (AC 11).
  - [ ] `npm run ci:fast`. Then on Chromium, in the background: `npm run e2e -- tests/e2e/characters.spec.ts tests/e2e/lifeLayer.spec.ts --project=chromium` (the clips after the pick-up and the coffee: D5).
- [ ] **T7. Performance and delivery** (AC 8, 12), after the last art edit, under `caffeinate`
  - [ ] `npm run build:playtest`, `npm run dist:check -- --flavor playtest` (payload numbers in the notes, D14), then `npm run e2e:dist` in the background (it queues; perf alone ≈ 5 min). Numbers in the notes.
  - [ ] `npm run e2e -- tests/e2e/autoplay.spec.ts tests/e2e/afterEffects.spec.ts --update-snapshots=all` (both browsers; `autoplay` is in the smoke tier, so `ci:story` fails without it). Open all four images, say what changed.
  - [ ] The « after » captures of D11, same frames as the « before ». Write what you saw by eye, and what you did not open.
- [ ] **T8. Close and record the debts** (see « Deferred items »); `project-context.md › Rigged characters`: the v2 bones, `codeDrivenBones`, `markerNodes`, the forelock, the new guards. Check `EXPERIENCE.md`'s reduced-motion row (« breathing, lean, forelock — removed ») matches what ships.

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Bone names and parents** (tables in « The v2 contract »). Existing bones keep their names and meaning (`arm_*` is the upper arm, `leg_*` the thigh, `hand_*` the wrist), so the life layer, the accessories and the tests keep finding them. New: Papa `pelvis`, `neck`, `forearm_*` (elbow), `shin_*` (knee), `foot_*` (ankle), `forelock`, `brow_l`, `brow_r`; the baby `forearm_*`, `hand_*`, `shin_*`, `foot_*`, `brow_l`, `brow_r` (his `neck` exists since 7.2). Papa 22, the baby 19: « une vingtaine », ≤ 32. Every bone straight up with no roll, as today. | The GDD's list (« Besoins en assets », v2.4) and the epics' AC. Renaming a 7.2 bone would move every clip, `PAPA_LIFE_BONES` and the accessory parents for nothing. Straight bones with no roll keep glTF's axes on every bone (X his left, Y up, Z forward), which the lean, the gaze and their sign tests rely on (project-context). |
| D2 | **The life layer stays where 7.8 put it:** Papa's lean, breath and stoop on `spine`, his gaze on `head`; the baby's breath on `spine`. `PAPA_LIFE_BONES` and `BABY_LIFE_BONES` do not change. | 7.8 noted « 7.9 may redistribute » (architecture: « bassin, buste, cou, tête »). Splitting the gaze over `neck` and `head`, or the lean over `pelvis`, changes 7.8's tuned and tested feel (`papaHeadYawDeg`, `papaLeanDeg`) for a gain nobody has judged. Recorded as an option for Geo in `deferred-work.md`. |
| D3 | **Code-driven bones** (AC 5): Papa `eyelids`, `brow_l`, `brow_r`, `forelock`; the baby `head`, `eyelids`, `brow_l`, `brow_r`. No clip keys them (`export_optimize_animation_keep_anim_armature=False` drops a constant track, but never insert a key on them anyway). **The brows are neutral = their rest pose:** no code writes them before 7.10, which will. Brows and forelock are children of `head`, siblings of `eyelids` (never under `eyelids`, whose scale would squash them, nor under `eyes`, which `coffee_kick` scales). Identity rest rotation and scale on every bone (AC 1) closes the 7.2 deferred item. | Architecture « Ordre dans une frame »: code-driven bones are written last and no clip has a track on them. 7.10 needs the brows in place and still. |
| D4 | **Pay for the joints in the same budget.** Today: Papa `papa_body` 2,112 + `papa_shirt` 488 = 2,600 visible (4 primitives: body ink / skin / paper, shirt), 4,416 with the hidden `papa_look_shirt` (500), mug (188), handset (108), hair (100), mash (300), steam (120), bla-bla (500); the baby `baby_body` 2,516 (4 primitives: onesie, skin, ink, paper). Elbow and knee rings, brows and the lock cost triangles: take them back where they do not read at 40 px (sphere segments of the head, hands and feet, the backs of parts the camera never sees, the hidden props). `art_ink` already exists in both bodies: brows and lock add no primitive, so no draw call (hulls are per mesh, so no hull call either). | The AC: « le nombre de triangles d'un personnage ne dépasse pas celui d'aujourd'hui ». The GDD: at 40 px, polygons do not read; silhouette, poses and timing do. Papa is at the material ceiling (6). |
| D5 | **Durations.** Loops keep their exact frame range (30 fps): the travelling ones (`walk`, `carry_walk` 17 f, `crawl` 17 f, `sneak` 23 f) keep `feedback.json › characters.clipSpeeds` true, and a loop's first and last keys are equal (seamless). A one-shot keeps its range or grows by at most 4 frames (133 ms) where its anticipation needs it, never under 10 frames (the `2 × returnMs` guard). Two e2e checks read one-shot ends: `characters.spec.ts` L69-71 reads `carried` 1 s after the pick-up, so `laugh` stays ≤ 24 frames; L226-228 reads `idle` 2 s after `coffee_kick`. The names stay, `eyes_open` included. | `characterClips.ts` does not change (AC 3), so the names are the contract. A longer one-shot holds the player's eye longer on a pose that is not the state's: small growth only. |
| D6 | **Retake principles.** Each clip gains, where it has a gesture: *anticipation* (a small counter-move before the action, inside the clip), *overshoot* (the main mover passes its end pose and settles), *follow-through and overlap* (the forearm and hand lag the upper arm by a frame or two, the head lags the spine), *arcs* (hands, head and feet travel on curves, which the hinges give for free; a root translation, as in `respond_perfect`, moves on an arc too). Bezier keys, sampled at 30 Hz by the exporter (`export_force_sampling`). **Hinges:** a `forearm_*` and a `shin_*` turn about their own local X (their rest is identity, so their local quaternion is the joint's turn): split it into a twist about X and a swing (swing–twist decomposition, not Euler angles); the swing stays within 15°, and the twist stays on the bending side, the elbow from −160° to +10° (a negative turn about X brings a hanging forearm forward), the knee from −10° to +160° (a positive turn sends a hanging shin back). Pin both signs with a unit test on a hand-made pose before trusting the test on the files, as 7.8 pinned the lean's. **What a retake must not do:** look like a telegraph (no yawn in Papa's loops, his lids are code; no reaching up, no fixed stare, no sudden speed-up of the baby outside `locked` and `act`), or add any stir, peek or kick to the loops that play during the duel, the stealth exit and the feints (`carried` is also the laid baby's loop: keep it calm and regular). | GDD « Animation des personnages », production order (2): « en soignant l'anticipation, le dépassement et les trajectoires en arc »; principles 4 and 5; D9 of 7.2. The hinge test catches the commonest scripted-rig fault (a joint bent backwards) with no human. |
| D7 | **The forelock is a pendulum on the head.** Its tip is a point stepped at `STEP_MS` by three springs (x, y, z, world metres; `stepSpring` of `characterSpring.ts`, `reachMs` and `dampingRatio` of `feel.json › characters.forelock`, no overshoot cap) toward where the tip would be if the lock were rigid: head's world matrix × (the `forelock` bone's position + the `papa_forelock_tip` marker's position, read once). The bone's rotation is the one from the rest direction to the lagged tip in head space, capped at `maxDeg`. Written after the gaze (so the rest follows the turned head), before the frame is drawn; absolute (identity rest). **Starting values `[ASSUMPTION]`:** `reachMs` 200, `dampingRatio` 0.4 (a little bounce), `maxDeg` 30. The marker keeps the lock's shape in the `.blend`: Geo can move it with the lock and re-export. | The AC: « sa mèche les suit avec un temps de retard (réglé dans `feel.json › characters`) ». A point that trails the head covers everything that moves it (clip, lean, gaze, walk, glide, squash) with three numbers; an angle driven by accelerations would need a gain per cause. Springs at `STEP_MS` are the architecture's rule (« les ressorts (demi-tour, élan, mèche) »). |
| D8 | **The lock is not the hair on end.** `papa_hair` (the spikes of the outlet gag and of the look, hidden, scaled by `setHair` / `setLook`) is untouched. The lock is one small hanging piece at the front hairline, always shown, about a fifth of the spikes' height, to one side so the brows and eyes stay clear. It hangs at least 45° below the horizontal and turns at most 40° (schema), so its tip never rises above its root: it can swing, never stand up. A capture shows him with both. | The AC: « elle ne se confond pas avec les cheveux en pétard du gag de la prise ». The hair on end is a look part that scores (story 3.7): a lock that stood up would read as a gag that did not happen. |
| D9 | **Goldens: `feelHash` and `worldHash` move, and only they**, as 7.8's D2: `tests/golden/scenarios.ts` hashes the world, which carries its feel. Prove it: for the regenerated journals, hash the final world without its `feel` key and the events on `main` and on the branch (a throwaway test in the scratchpad or deleted after), and compare; write the file count and the result. The `.glb` files are in none of `feelHash`, `geometryHash`, `levelHash`. | Same procedure as 7.8 (72 files, 144 lines). A golden whose events move means something in the sim reads the new keys: stop and look. |
| D10 | **The agent authors the rig and keyframes, headless, and Geo can redo any of it** (7.2's D3). No generated mesh, bought rig or mocap; throwaway scripts stay in the scratchpad; the `.blend` is the source (AC 11). Commit each `.blend` once, at the end of its task. | GDD « Personnages, rig et animations faits à la main » (read by the coach on 2026-11-08 as hand-authored keyframes in Blender, the life layer on top). |
| D11 | **Captures** in `7-9-screenshots/`, all « before » taken at T0 on the untouched files. *In game*, 844 × 390, `salon_crawler` (and one at 667 × 375), frozen with `__PP__.freeze` / `advance`, same seed and frames before and after: Papa idle, mid-stride, carrying, drinking, on the phone; the baby crawling, babbling, carried; Papa with his hair on end (`setPapaLook`) next to the lock. *Pose sheets* (Workbench, orthographic, the game camera's angle: yaw 45°, pitch 35.264°; one sheet per character and per state, `papa_sheet_before.png`, `papa_sheet_after.png`, `baby_sheet_*`): one row per clip, five frames (first, anticipation, action, overshoot, last), composed with the numpy bundled in Blender. If Workbench does not render headless, say so and capture the one-shots in game instead. A `notes.txt` gives each in-game frame's clip and `papaForelockDeg`. | The AC: « des captures avant / après de chaque personnage, permettent à Geo de juger à l'œil ». A frozen game frame cannot show anticipation or overshoot; a pose sheet can. The modelling tool's render is not the game's look (GDD), so the sheets are for timing and poses, the in-game frames for the look. |
| D12 | **Story 7.4 and the binary files.** 7.4 is `ready-for-dev` on its own branch and adds `victory_dance` and `collapse` to `papa.blend` / `papa.glb` and to Papa's contract; its D14 says « if 7.9 lands first, author both clips on its skeleton; otherwise 7.9 retakes them ». A `.blend` or `.glb` cannot merge. Before T3: if 7.4 is merged into `main`, merge `main` into this branch first and retake its two clips with the others (18 Papa clips then); if its development has started and is not merged, stop and ask Geo which goes first; if it has not started, go on, and note in `deferred-work.md` that 7.4 authors its clips on v2. | Git workflow: two stories touching the same binary files conflict at the second merge, and only Geo orders them. |
| D13 | **`papaForelockDeg` in `fx()`**: the lock's turn from rest, in degrees. For the capture notes and the debug overlay; no new e2e spec (the lock is proven in Vitest, CLAUDE.md › Where a test goes). | 7.8 did the same for every life-layer angle. |
| D14 | **The payload that binds is `salon_crawler`'s.** Built today: its `.glb` 58,800 B + `papa.glb` 59,152 + `baby.glb` 35,488 + all audio 2,678,557 = 2,831,997 B (2,765.6 KiB) of 3,145,728 (3 MiB): about 306 KiB for both characters' growth together. `salon_kitchen` (2,788.5 KiB) has 5 MiB. Aim for each file under ~150 KiB; `dist:check` is the judge. The comment on `CHARACTER_GLB_MAX_BYTES` (« two at this limit still fit each level ») has not been true since the audio grew: correct it to say `dist:check` is the guard. | More bones keyed on every clip grow the animation data, which dominates a character file. |

### The v2 contract

Bones stand straight up with no roll; « new » are v2. The test of T1 pins the parents.

**Papa (22)**

| Bone | Parent | | Role |
|---|---|---|---|
| `root` | — | | On the floor, under his feet |
| `pelvis` | `root` | new | Hips: the walk's bob and sway; parent of the spine and both legs |
| `spine` | `pelvis` (was `root`) | | Torso; the life layer's lean, breath and stoop (D2) |
| `neck` | `spine` | new | |
| `head` | `neck` (was `spine`) | | The gaze (life layer) |
| `eyes` | `head` | | Keyed by `coffee_kick` only |
| `eyelids` | `head` | | Code |
| `brow_l`, `brow_r` | `head` | new | Code (7.10); at rest now |
| `forelock` | `head` | new | Code: the pendulum (D7) |
| `arm_l`, `arm_r` | `spine` | | Upper arm, from the shoulder |
| `forearm_l`, `forearm_r` | `arm_*` | new | Elbow hinge |
| `hand_l`, `hand_r` | `forearm_*` (was `arm_*`) | | Wrist; `papa_handset` hangs on `hand_l`, `papa_mug` on `hand_r` |
| `leg_l`, `leg_r` | `pelvis` (was `root`) | | Thigh, from the hip |
| `shin_l`, `shin_r` | `leg_*` | new | Knee hinge |
| `foot_l`, `foot_r` | `shin_*` | new | Ankle |

Nodes: `papa_body`, `papa_shirt` visible; `papa_mug`, `papa_mug_steam`, `papa_handset`, `papa_blabla`, `papa_hair`, `papa_look_mash`, `papa_look_shirt` hidden, as today; marker `papa_forelock_tip` (empty, child of `forelock`, at the lock's tip). Code-driven nodes: `papa_mug_steam`, `papa_blabla`, as today.

**The baby (19)**

| Bone | Parent | | Role |
|---|---|---|---|
| `root` | — | | |
| `spine` | `root` | | Torso; the life layer's breath |
| `neck` | `spine` | | His head's gestures (clips) |
| `head` | `neck` | | Code: the gaze, written absolute every frame |
| `eyelids` | `head` | | Code |
| `brow_l`, `brow_r` | `head` | new | Code (7.10); at rest now |
| `arm_l`, `arm_r` | `spine` | | Upper arm |
| `forearm_l`, `forearm_r` | `arm_*` | new | Elbow hinge |
| `hand_l`, `hand_r` | `forearm_*` | new | Hands (on the floor when he crawls) |
| `leg_l`, `leg_r` | `root` | | Thigh |
| `shin_l`, `shin_r` | `leg_*` | new | Knee hinge |
| `foot_l`, `foot_r` | `shin_*` | new | |

Nodes: `baby_body` visible, no hidden node, no marker.

Rest positions (Blender, Z up, metres) to place the new joints where the meshes bend: Papa's shoulder at z 0.53 and wrist at 0.25 (elbow about halfway), hip at 0.27 (knee about 0.14, ankle near 0.04), pelvis about 0.26, neck about 0.52, head bone at 0.56; the baby's shoulder at 0.145, hip at 0.06, neck 0.15. Read them from the file rather than from here.

### The retake sheet

Frames at 30 fps, read from the `.blend` today. « Keep » = constraint a test or a spec checks.

**Papa**

| Clip | Kind | Frames | v2 should show | Keep |
|---|---|---|---|---|
| `idle` | loop | 61 | Weight shift on the pelvis, soft knees, arms hanging with soft elbows; breath is the life layer's | No yawn, nothing like the micro-sleep's telegraph |
| `walk` | loop | 17 | Knees bend on the passing pose, heel then toe, pelvis down on contact and up on passing, hips and shoulders counter-rotate, arms swing in arcs with bent elbows | Cadence (`clipSpeeds` walk 3 m/s); floor ±0.03 |
| `glide` | loop | 13 | A fast scoot: knees bent, weight forward, arms trailing (the life layer adds its lean) | Floor ±0.03 |
| `drink` | loop | 60 | Elbow brings the mug to the mouth on an arc, a small tip of the head, the other arm relaxed | Mug centre above 0.45 m, touching his box; faces the camera (`papaClipFacing`) |
| `asleep` | loop | 61 | Slumped standing sleep: knees give, head sags and bobs, arms dangle from the elbows | Lids are code; the « Z » is code |
| `on_phone` | loop | 49 | Elbow up, handset at the ear; the free hand gestures in arcs | Handset centre above 0.55 m, touching his box |
| `carry_idle` | loop | 61 | Elbows wrapped under the baby, a gentle rock from the knees | Hands within 0.35 m of the carried centre |
| `carry_walk` | loop | 17 | The walk's legs, arms held | Same as `walk` and `carry_idle` |
| `gag_shock` | loop and gag one-shot | 27 | Electrified: stiff limbs, jitter from shoulders and knees, then a sag | Loops seamlessly (the `electrified` state) and reads as a one-shot; the hair is `papa_hair`, not a clip |
| `respond_parry` | one-shot | 17 | Wind-up back, the block forward on an arc, overshoot, settle | The Parry silhouette (arm forward) |
| `respond_firm` | one-shot | 22 | A small lean back, then the « stop » hand pushed out and held, elbow locking | The Firmness silhouette |
| `respond_perfect` | one-shot | 28 | Crouch on the knees, the hop on an arc, landing absorbed by the knees, overshoot | May leave the floor (today up to 0.09 m) |
| `gag_hit` | one-shot | 22 | Snap back from the hit, arms flung, overshoot, recover | |
| `stumble` | one-shot | 15 | Trip forward, a catching step with a foot, recover | ≥ 10 frames |
| `snore` | one-shot | 32 | Head drops back, the big snore, a jolt | |
| `coffee_kick` | one-shot | 22 | The jolt upright, shoulders up, the eyes widen mid-clip | `eyes.scale` ≥ 1.4 at its peak, rest at both ends, in this clip only; faces the camera; idle 2 s after |

**The baby**

| Clip | Kind | Frames | v2 should show | Keep |
|---|---|---|---|---|
| `babble` | loop | 53 | Sitting, arms waving from the elbows, head bobbing on `neck` | No reach up, no stare |
| `crawl` | loop | 17 | Hands and knees, opposite limbs together, elbows soft, head up | Cadence (`crawl` 0.6 m/s); floor ±0.03 |
| `sneak` | loop | 23 | A low, slow crawl | Cadence (`sneak` 1.2 m/s); floor ±0.03 |
| `locked` | loop | 31 | The telegraph: he fixes on his target (allowed here only) | |
| `act` | loop | 13 | The mischief itself | ≥ 10 frames |
| `carried` | loop | 51 | In the arms: legs dangling from the knees, a slow sway of the feet, calm and regular | Also the laid baby's loop (bomb drop, stealth exit): no stir, no kick, no peek |
| `cry` | loop | 16 | Fists from the elbows, legs kicking from the knees | |
| `gag_delight` | one-shot | 26 | Delight: arms up on arcs, a bounce | May leave the floor (today 0.04 m) |
| `eyes_peek` | one-shot | 16 | The feint: a small neck move | Lids are code (`babyLidsAfter`) |
| `eyes_open` | one-shot | 15 | The signal: neck and spine settle | The name stays; lids are code |
| `sat_up` | one-shot | 24 | Sits up: anticipation down, up, overshoot | |
| `stir` | one-shot | 13 | A stir | ≥ 10 frames |
| `wake` | one-shot | 22 | Wakes: stretch from the elbows, overshoot | |
| `laugh` | one-shot | 20 | A laugh: shoulders and head bounce | ≤ 24 frames (`characters.spec.ts`) |

### What exists, and what must keep working

- **`characterClips.ts`:** clip maps and choices (unchanged), `PAPA_CONTRACT` / `BABY_CONTRACT` (bones, visible, hidden, clips, `codeDrivenBones`, `codeDrivenNodes`). The architecture test slices the file at `"/** Papa's contract"`: keep the contracts last and that comment as is.
- **`tools/assets/characterArt.ts`:** `characterBudgetOf` (visible nodes, draw calls = primitives, triangles = `indices.count / 3`), `characterRigProblems` (budget, materials and hues through `roomArt.ts`, one skin, bones, nodes, clips, code-driven tracks, > 4 influences). **Add** markers and identity rest (T1).
- **`characterAssets.test.ts`:** reads the committed `.glb` with no Blender (`parseGlb` for the JSON, `parseCharacterGlb` for posed checks with three's `AnimationMixer` in Node). Its `drawnBox`, `eachClipPose` (3 samples: extend to 9 for the new tests, not the old ones), the accessory boxes, the eyes test, the one-shot length test, the D9 scans. The posed checks call `mixer.setTime` on one clip at a time.
- **`papaView.ts` › `animate`:** clip choice → body spring → `rig.update` (restores `spine` and `head` to what the clips gave, D3 of 7.8) → lean, breath, stoop on `spine` → gaze on `head`. **Add** the forelock after the gaze. `setAway` hides the group; `resetAnimation` resets the springs; `setHair` / `setLook` drive `papa_hair` (`scale.y`); the eyelids are written in `setEyelids` / `setAsleep`.
- **`babyView.ts`:** `headBone.rotation.y = wrapAngleRad(pose.yawRad − bodyYawRad)` every frame, absolute: needs the identity rest of AC 1. Untouched here.
- **`characterRig.ts`:** `lifeBones` restore and capture; the mixer writes only keyed bones (`PropertyMixer.apply` writes on change), so a code-driven bone with no track keeps whatever the code wrote. `reset()` stops every action; `dispose()` frees each skeleton's bone texture.
- **`characterSpring.ts`:** `createSpring`, `resetSpring`, `stepSpring(spring, target, dtMs, reachMs, zeta, overshootMax)` (steps at `STEP_MS` with an accumulator, draws by the leftover, `dtMs` 0 holds), `omegaOf`, the 95 % reach time.
- **`tests/support/testCharacters.ts`:** builds a skinned box with every bone of a contract, **all under `root`**, every visible vertex on bone 0, every clip a 1 s track on `spine`. New bones appear in it by themselves; T5 moves `forelock` under `head` and adds the marker.
- **`levelScene.ts`:** creates the rigs (`PAPA_LIFE_BONES`, `BABY_LIFE_BONES`), fills `LifeInputs` from `world` each frame (`life.characters` is `world.feel.characters`), `resetFx` resets the views, `realFxState()` lists the life-layer angles (add `papaForelockDeg`).
- **Pipeline:** `npm run assets:character:export -- <id>` (`tools/blender/export_character.py`: `ACTIONS` mode, force sampling, `keep_anim_armature=False`, 4 influences, no leaf bones, no def-bones filter), then `npm run assets:character:optimize -- <id>` (`CHARACTER_GLTFPACK_FLAGS = ['-cc', '-kn']`). Neither needs a change. Blender 5 actions need a slot (`action.slots.new(id_type='OBJECT', …)`, `animation_data.action_slot`) and a fake user (7.2 T0).
- **E2E that read clips:** `characters.spec.ts` (D5). The two macOS references change with any art change.

**Expected changes:** `assets-src/blender/characters/{papa,baby}.blend`, `public/assets/characters/{papa,baby}.glb`, `src/client/render/views/{characterClips,papaView}.ts` and `papaView.test.ts`, new `forelock.ts` and `forelock.test.ts`, `src/client/render/levelScene.ts`, `src/client/app/testHost.ts`, `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json`, `src/shared/constants.ts` (one comment, D14), `tools/assets/characterArt.ts`, `tests/tools/assets/characterArt.test.ts`, `tests/architecture/characterAssets.test.ts`, `tests/content/feelSchema.test.ts`, `tests/support/{testFeel.json,testCharacters.ts,fakeTestHost.ts}`, `tests/tools/vite/fixtures/feelSample.json`, `tests/e2e/support/testApi.ts`, `src/debug/testApi.test.ts`, `tests/golden/journals/*` (hashes), possibly `tests/bots/humanBotRegression.test.ts`, the four darwin references, `_bmad-output/project-context.md`, `deferred-work.md`, `sprint-status.yaml`, `7-9-screenshots/`, this file.

### Blender access: read this first

- **The live Blender MCP session belongs to Geo's main checkout and may hold unsaved work:** never save, reload, open another file or export in it. Its docs tools (`search_api_docs`, `get_python_api_docs`) are safe.
- **Work headless, in this worktree:** `/Applications/Blender.app/Contents/MacOS/Blender -b <worktree>/assets-src/blender/characters/<id>.blend -P <scratchpad script> -- <args>` (Blender 5.2.3 LTS). The worktree's shell refuses compound commands it cannot check: one command per call, scripts written to the scratchpad with the Write tool.
- Run Python only on the project's `.blend` files; never open or import a third-party asset.
- Read operator arguments from the running version (`bpy.ops.<op>.get_rna_type()`), not from memory. Useful: edit bones need the armature active and `mode_set(mode='EDIT')`; `vertex_group_limit_total(limit=4)` and `vertex_group_normalize_all()` on the mesh in weight mode or through the data API.
- Purge orphans before saving, pack no image, commit each `.blend` once.

### Deferred items

Close in `deferred-work.md`, each with what happened:
- « Rigid parts, no elbows » (7.2, L930): elbows, knees, feet, neck, pelvis; the clips retaken.
- « Code-driven bones assume an identity rest rotation » (7.2 review, L940): `characterRigProblems` checks every joint of the committed files.
- « The forelock (7.9: needs the v2 skeleton) » (7.8, L1208): done.

Leave open, and say so: « The clip `eyes_open` … » (L928: the name stays), « Only `idle` and `walk` have carried variants » (L936), « The baby's head is not limited against his body » (L935), the squash restart (L934). New: the life layer on `pelvis` / `neck` (D2), Geo's option; D12's outcome for 7.4.

### Testing

- **Unit:** `forelock.ts`; `papaView.test.ts` on the fixture (the forelock, the brows at rest); `characterArt.test.ts` (markers, identity rest); `feelSchema.test.ts`.
- **Architecture:** `characterAssets.test.ts` on the committed files (T1), with no Blender in CI.
- **Goldens:** `npm run golden:update` once, deliberately (D9). Never twice to « make it green ».
- **E2E:** no new spec. `characters` and `lifeLayer` on Chromium (T6); `autoplay` and `afterEffects` to regenerate the references (T7); `perf.spec.ts` through `npm run e2e:dist` (T7). All through `npm run e2e`, in the background, never `npx playwright test`. `ci:story` is the review's gate, not dev-story's.

### Project Structure Notes

- New module in `src/client/render/views/` (the life layer's home), pure maths with no Three; Three only in `papaView.ts`, where it touches bones.
- **Variance:** the epics say « `characterClips.ts` ne change pas »; its contracts must gain the v2 bones (AC 3 reads it as the clip choice only). The architecture names `characterArt.ts` as the contract's home; the contracts live in `characterClips.ts` since 7.2 and stay there.
- **Variance:** the epics' « seules les empreintes `feelHash` » is read as D9 (`worldHash` too), as 7.8 did.

### Project Context Rules

- **Layers:** `client` may import `three`, `@sim`, `@content`, `@shared`; `src/` never imports `tools/`; `tests/architecture` may import both.
- **Golden rule:** every number Geo may touch is data (`feel.json › characters.forelock`); constants in `shared/constants.ts`, `UPPER_SNAKE`, with a unit suffix.
- **Sim boundary:** the client only reads `world`; never read a gameplay value from a bone or a mixer.
- **Zero allocation** in the rAF path: scratch vectors, quaternions and matrices made once; no closures or literals per frame.
- **Budgets:** ≤ 100 draw calls, ≤ 100k triangles, no texture in a character, blob shadows, no shadow map. Level payload NFR15 (`dist:check`).
- **No `console.*`:** `log.warn('render', …)`; every fallback warns once (`rig.node` already does for a missing node). Units as suffixes (`reachMs`, `maxDeg`). `describe/it/expect` from `vitest`.
- **Git:** this worktree, branch `story/7-9-squelette-v2-et-animations-reprises`. Commit « Story 7.9 : squelette v2 et animations reprises ». Merge only after the review, a green `ci:story` and Geo's visual OK. A `.blend` / `.glb` touched by another open story cannot merge: stop and ask Geo (D12).
- **Heavy checks:** `npm run e2e`, `e2e:dist`, `ci:story` queue on `tools/ci/heavyLock.sh`; run them in the background. Wrap long runs in `caffeinate`; a 30 s timeout failing after minutes means the Mac slept.

### Previous story intelligence

- **7.8:** three writes a bone only when its value changed, so life bones go back to « what the clips last gave », not to the rest (its debug log); keyframes are `Float32`, about 3e-4 rad off when read back; `--update-snapshots=all` is needed (a plain `--update-snapshots` wrote nothing in 7.3); `afterEffects.spec.ts` times out under load and passes alone (memory); the e2e that read the drawn yaw wait for the spring to settle. Its D2 procedure for the goldens. **Never claim a visual check you did not make**: list what you did not open.
- **7.2:** the T0 spike settled the exporter arguments, the action slots, `-kn` keeping named nodes (a mesh lands in an unnamed child of its named node: toggle the named node), held poses surviving gltfpack, quantisation not moving the skinned mesh. Mesh data never gets a gameplay-looking name (`geo_*`). The `head`, `neck` and `eyelids` rest rotations were read as identity.
- **2.13:** the props doubled in size, `coffee_kick` is the only clip on `eyes`, the steam and bla-bla are code-moved nodes.
- **3.9 (replay):** `resetFx()` runs before each replay moment: the forelock must start at rest there.
- **Recent commits:** 7.8 (life layer) merged; « E2E étendu vert » (Vite ignores `.claude/`, which had destroyed contexts); « CI allégée » (the smoke tier, `ci:story`, `npm run ci` only before a playtest link).

### Latest technical information

No new dependency: `three@0.186.1`, `gltfpack@1.3.0`, Blender 5.2.3 are pinned, so no web research applies. Read in `node_modules/three` rather than from memory: `Object3D.updateWorldMatrix(updateParents, updateChildren)`, `Object3D.worldToLocal`, `Quaternion.setFromUnitVectors`, `Quaternion.angleTo`, `Quaternion.slerp` (the cap). Blender facts (Workbench headless on macOS, empties under bones through `-kn`) are T0's spike, not assumed.

### Open for Geo

1. **Bone names (D1):** `forearm_*`, `shin_*`, `foot_*`, `pelvis`, `neck`, `forelock`, `brow_*`, with the 7.2 names kept. Say if you want others before T3.
2. **The forelock (D7, D8):** a hanging lock at one side of the forehead, on a pendulum (200 ms, a little bounce, 30° at most). Its look and swing are yours in the panel.
3. **Story 7.4 (D12):** both stories change `papa.blend`. Which goes first is your call if both are started.
4. **The life layer (D2)** stays on `spine` and `head`; spreading it over `pelvis` and `neck` is an option for later.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.9, #Story 7.8, #Story 7.10, Epic 7]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Animation des personnages L542-609, #Besoins en assets L640-646]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Animation des personnages (v2.4) L275-293, #Mouvement réduit L254]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08.md#§2 conflicts, §3, §4.6]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#Reduced motion L450-470]
- [Source: _bmad-output/implementation-artifacts/7-2-personnages-rigges-et-animes.md (D3, D4, D8, D9, D10, T0), 7-8-couche-de-vie-et-personnages-detaches-du-decor.md (D2, D3, D5, debug log), deferred-work.md L920-940, L1195-1220]
- [Source: _bmad-output/project-context.md#Rigged characters L191, #Performance Rules, #Testing Rules]
- [Source: story/7-4-celebration-finale-et-cadrages-parodiques:_bmad-output/implementation-artifacts/7-4-celebration-finale-et-cadrages-parodiques.md (AC 18-20, D14)]
- [Source: src/client/render/views/{characterClips,characterRig,characterSpring,lifeLayer,papaView,babyView}.ts, src/client/render/levelScene.ts, tools/assets/{characterArt,exportCharacter,optimizeCharacter}.ts, tools/blender/export_character.py, tests/architecture/characterAssets.test.ts, tests/support/testCharacters.ts, tests/e2e/characters.spec.ts L60-71 and L220-228, src/content/schemas/feel.ts L881-1021, src/shared/constants.ts L115-127 and L267, assets-src/blender/characters/{papa,baby}.blend (bones, meshes, actions read headless), public/assets/characters/{papa,baby}.glb (bones, clips, budgets, floor contact and carry reach probed on 2026-11-08)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
