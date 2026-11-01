---
baseline_commit: 76c6517e16d1a22d14927727fd86af951f226a41
---

# Story 7.2: Personnages riggés et animés

Status: done

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want to see Papa and the baby animated with squash and stretch,
so that gags and successes are expressive.

**Requirements covered:** FR70 (partly, see D1). **Depends on:** the pipeline of story 1.6, the frozen rooms and budgets of story 7.1.

**Scope:** the two characters that exist in the world. Two rigged `.glb` files replace the cube and the sphere, one `AnimationMixer` per view plays clips chosen from the sim's states and events, and Papa's view gains the three parts of his look, ready for story 3.7 to drive.

**Not in this story:**
- Mama, the dog and the children: no entity, no view (D1).
- `World.papa.look`, `lookChange` and their Laugh points: story 3.7 (D2).
- Any change to the sim, the bots, the goldens or the gameplay layout (AC 2).
- Outlines, the final toon ramp, lights, WebGPU (7.3). Celebration and film framings (7.4).
- Shards, mischief drawings, the stairs slide with real height, « Papa removes the object » (still deferred).

## Acceptance Criteria

The epics' criterion is: *given rigged `.glb` files in `public/assets/characters/`, when the views load them, then one `AnimationMixer` per view plays the animations triggered by the sim's events and states, and Papa's look (`World.papa.look`) changes his appearance.* D1 and D2 narrow it, as follows.

1. **The characters load with the level.** `public/assets/characters/papa.glb` and `baby.glb` load behind the loading screen, in parallel with the level. A missing, HTML or corrupt file is an `err` of kind `assets` naming the file, with one `warn`, and reaches the existing error screen. Nothing loads during play.
2. **The game does not move.** No file changes under `src/sim`, `src/bots`, `tests/golden/`, `content/levels/`, `content/threats/`, `content/sequences/`, `content/feel.json`, `public/_headers`, `tools/blender/export_level.py` or `public/assets/levels/`. `npm run ci:fast` passes with no golden regenerated. `npm run sim` with the four bots on both levels, seed 1, gives reports identical to `main`.
3. **One mixer per view, chosen from the sim.** Each view owns one `AnimationMixer`. Its looping clip follows the state read every frame, through a `Record<PapaState, …>` and a `Record<BabyState, …>`, so a new state with no clip is a type error. One-shot clips come from sim events, and every `GagId` declares its clips in `GAG_PRESENTATIONS` (D5).
4. **The sim clock drives the mixers.** A pause and a hitstop freeze them, a slow-mo slows them, speed × 4 speeds them up, and a restart starts them over (D6). No frame reads real time for them.
5. **Squash and stretch.** The events listed in `feedback.json › characters.squash` squash and stretch the character on a pure curve that preserves volume. The amounts and durations are data. Under « Réduire les animations » the squash stays at rest and the clips still play (D7).
6. **The player reads the same game.** Every existing call of both views still shows: eyelids, « Z », mug, handset, hair, away, the carried baby, the lowering of the bomb drop, the lift, the slide, the baby's gaze. Papa fits `PAPA_HEIGHT_M` and the baby's carried and laid heights still hold, so markers and hit tests do not move. A hiding baby stays hidden behind the sofa (D8).
7. **No animation gives away a hidden answer.** No clip or expression reads `windowOpenAt` or `feintAt` of a `wait` threat, nor anything that tells a real wake from a false alarm before its own telegraph. Eyes in a duel change only on what the player is already told: `isFeintGiven`, the signal, the gag (D9). A test pins it.
8. **Papa's look is ready.** `papaView.setLook(look)` shows or hides each of the three parts independently (mash on the cheek, hair on end, shirt inside out). `__PP__` can set it in debug builds, and a screenshot shows each one. Nothing in a game sets it until story 3.7, and `deferred-work.md` says so (D2).
9. **The budgets hold.** Each character stays within `CHARACTER_DRAW_CALLS_MAX`, `CHARACTER_TRIANGLES_MAX`, `CHARACTER_BONES_MAX`, `CHARACTER_MATERIALS_MAX` and `CHARACTER_GLB_MAX_BYTES`, pinned by a guard test that fails on a fixture (D4, D10). `perf.spec.ts` passes on both levels on the built playtest: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles. `npm run dist:check -- --flavor playtest` passes, with both characters counted in each level's ≤ 3 MiB payload.
10. **A restart leaks nothing.** `tests/e2e/level.spec.ts` shows the same draw calls, triangles, geometries and textures after a restart; each skeleton's bone texture is freed (D11).
11. **It plays without a human.** `/?autoplay=human&seed=1&speed=4`, with and without `&level=chambre_night`, plays with no `warn` on the `assets` or `render` channel. `tests/e2e/characters.spec.ts` sees Papa and the baby change clips through `__PP__.fx()`.
12. **Geo has seen it.** Screenshots of both characters in both rooms at 844 × 390 and 667 × 375 are in the completion notes, the frozen macOS references are regenerated on purpose and looked at, and the merge waits for Geo's visual OK. Charm and the feel of the squash are his call.

## Tasks / Subtasks

- [x] **T0. Spike one rigged character through the whole pipeline** (AC 1, D3, D4)
  - [x] Read « Blender access » first. In a copy under the scratchpad, build a two-bone, two-material mesh with two actions and a hidden child mesh parented to a bone.
  - [x] Export with a draft `export_character.py`, then `gltfpack`, then load it in the browser with a mixer and a `MeshToonMaterial`.
  - [x] Check, and write in the completion notes: the exact exporter arguments on Blender 5.2.3 (read them from `bpy.ops.export_scene.gltf.get_rna_type()`, do not trust memory); that each action exports as one clip under its own name (Blender 5 actions have slots: a headless script must assign `action_slot` too); that bone and hidden node names survive `-kn`; that clips with held poses survive gltfpack's constant-track removal, or that `-ac` is needed; that 30 Hz resampling and the default 12-bit rotations keep the poses clean; that the skinned mesh is not moved or displaced by quantisation.
  - [x] Record the final flags as `CHARACTER_GLTFPACK_FLAGS`. Do not change `GLTFPACK_FLAGS`: the rooms stay byte-identical.
- [x] **T1. Guard test, before any modelling** (AC 9, D4, D10)
  - [x] Add the five `CHARACTER_*` constants to `src/shared/constants.ts`, with a comment saying what they reserve.
  - [x] `tools/assets/characterArt.ts` (pure, reuses `reservedHueProblems` and `roomMaterialProblems` of `roomArt.ts`; extend those only by parameters): `characterBudgetOf(json)`, `characterRigProblems(json, contract)`. Test in `tests/tools/assets/characterArt.test.ts`, one failing fixture per rule, including a missing clip, a missing bone, a joint with more than 4 influences if readable from the JSON, a texture, and over-budget counts.
  - [x] `tests/architecture/characterAssets.test.ts`: runs them on both committed `.glb` files, and checks every clip named in `feedback.json › characters` and in `src/client/render/views/characterClips.ts` exists in the file.
- [x] **T2. Pipeline** (AC 1, D3)
  - [x] `tools/blender/export_character.py`, `tools/assets/exportCharacter.ts`, `tools/assets/optimizeCharacter.ts`, and `characterBlendPath` / `characterGlbPath` in `paths.ts`. Reuse `findBlender` and factor the `gltfpack` runner of `optimizeGlb.ts` without changing its behaviour. Scripts `assets:character:export` and `assets:character:optimize`.
  - [x] Do not route characters through `export_level.py`: it refuses a scene with no `NAV_floor` and pins skins and animations off, and `blenderConventions.test.ts` compares it to the TypeScript rules.
- [x] **T3. Loading** (AC 1, D11)
  - [x] `gltf.ts`: add `parseCharacterGlb(bytes, baseUrl)` returning `{ scene, animations }`. Today `parseGlb` returns `gltf.scene` alone, so **every clip would be dropped silently**. `parseGlb` stays as it is.
  - [x] `loadLevelAssets.ts`: `LevelAssets.characters: { papa, baby }`, with an injectable `parseCharacter`, the same magic check and the same `err` wording. The three files load in parallel. Tests for each failure.
  - [x] `dist:check` (`tools/build/inspectDist.ts`): add both characters to every level's payload and gzip totals, report a missing file as a problem (the budget must not be vacuous), and each over `CHARACTER_GLB_MAX_BYTES` as one. Fixtures in its test.
- [x] **T4. Data** (AC 5, D7)
  - [x] `feedback.json › characters`: `crossFadeMs`, `turnRateDegPerSec`, `squash` (one row per trigger: `event`, `amountPct`, `durationMs`), walk clip speeds. `FeedbackSchema` first, then `npm run content:schemas`. Bounds in the schema: `amountPct` keeps the height strictly positive.
- [x] **T5. The character kit, with no art** (AC 3, 4, 5, 10)
  - [x] `src/client/render/views/characterClips.ts`: `papaClipOf(papa, baby)`, `babyClipOf(baby)`, the two `Record`s, the clip names. Pure, no Three.
  - [x] `src/client/render/views/characterRig.ts`: `createCharacterRig(asset, toon)`: swaps materials through the toon cache by colour, sets `frustumCulled = false`, makes one mixer with every action created up front, `play(clip)`, `playOnce(clip)`, `update(dtMs)`, `dispose()`. A test fixture builds a small skinned mesh in code (`tests/support` or next to the test).
  - [x] `squashScaleAt(amountPct, elapsedMs, durationMs, out)` pure, volume-preserving (`y = s`, `x = z = 1 / √s`), back to exactly 1 at the end, in `src/client/render/views/squash.ts`.
  - [x] Allocation check: nothing in `update` allocates once the clips have played once. Existing rule; prove it by reading, and let `perf.spec.ts` confirm.
- [x] **T6. Model and animate Papa** (AC 6, 8, D3, D8)
  - [x] Inventory under « Character contract ». Look in the browser at both sizes through the autoplay, not in a Blender render (GDD: the modelling tool's render does not carry over).
- [x] **T7. Model and animate the baby** (AC 6, D3, D8)
  - [x] Huge head, big eyes, readable gaze from the fixed camera. White alone fails on the pale safe-zone floors (7.1 review): give him a colour that keeps him apart.
- [x] **T8. Wire the views** (AC 3, 4, 6, 7)
  - [x] Rewrite `papaView.ts` and `babyView.ts` on the kit: **every method keeps its signature and its meaning**. Remove the cube, the sphere and the code that only they used. `PAPA_HEIGHT_M` and `BABY_CARRIED_*` stay, since UI and input read them.
  - [x] `levelScene.ts`: pass `assets.characters`; advance both mixers with the sim-clock delta (D6); `resetFx` clears one-shots and squash; `dispose` frees skeletons (D11). Add `playCharacterEvent` to `LevelFx`, called from `onSimEvent` in `boot.ts`, skipped for squash under reduced motion like `noLiftFx`.
  - [x] Response clips follow P3: the sound fires at judgement, and the clip plays on arrival (`PapaArrived`, through `responseChoreography.ts`). A gag during a glide plays in parallel, on the upper body or as squash; it must never stop the glide.
  - [x] `gags.ts`: `GagPresentation` gains `papaClip` and `babyClip` (`string | null`). Replace the « until E7 » comments that this resolves.
  - [x] Smooth Papa's body turn (shortest arc, `turnRateDegPerSec`). `pose.yawRad` stays the sim's: whatever reads it must not lag. **The baby's gaze stays immediate**, since the eyes are what the player reads.
  - [x] `realFxState()` and `__PP__.fx()` gain `papaClip`, `babyClip`; `testHost` gains a debug `setPapaLook`. Check `dist:check`'s prod markers still pass.
- [x] **T9. Prove nothing moved** (AC 2, 6, 7, 11)
  - [x] `git diff --stat main` on the paths of AC 2 is empty; `npm run ci:fast`; the four bots on both levels against `main` with `--seed 1`.
  - [x] Update unit tests that pinned the cube (`levelScene.test.ts`, `papaView.test.ts`, `babyView.test.ts`, `layDown.test.ts`) to the same behaviour on the fixture rig. An assertion may change its subject, never lose its meaning; say which ones changed.
  - [x] `tests/e2e/characters.spec.ts` (clips change, a hitstop freezes the mixer's time, a pause too, the look shows). Run on Chromium with the specs that pin the views: `level`, `carry`, `feedback`, `autoplay`, `testApi`, plus whichever covers the sequences.
- [x] **T10. Performance and delivery** (AC 9, 12), under `caffeinate`, one at a time
  - [x] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, then `npx playwright test -c playwright.dist.config.ts --project perf --workers=1`, then with `PP_PERF_LEVEL=chambre_night`. Write the numbers in the story.
  - [x] `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` (macOS only, deliberate). Look at the images and say so.
  - [x] Screenshots in `_bmad-output/implementation-artifacts/7-2-screenshots/`: each character walking, carrying, asleep, on the phone, in a gag, and each look part. **State what you saw by eye and what you did not capture.**
- [x] **T11. Close the deferred items and record the debts** (see Dev Notes)

## Dev Notes

### Blender access: read this first

**The live Blender MCP session belongs to Geo's main checkout, and it may hold unsaved work.** Same trap as 7.1.

- **Never save, reload or open another file in that session, and never export from it.** Its docs tools (`search_api_docs`, `get_python_api_docs`) are safe.
- **Work headless, in the worktree:** `/Applications/Blender.app/Contents/MacOS/Blender -b <worktree>/assets-src/blender/<id>.blend -P <scratchpad script>`. Blender 5.2.3 LTS is installed.
- Run Python only on the project's `.blend` files; never open or import a third-party asset (architecture › security).
- **Commit each `.blend` once, at the end.** Purge orphan data before saving, and pack no image.

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Only Papa and the baby this story.** Mama, the dog and the children get their `.glb` and view with the story that makes them exist: Mama with 3.5 / 3.7, the dog with 6.1, the children with 6.4 to 6.8. `deferred-work.md` records each. This story's pipeline and kit must make those additions one file and one view each. | The epics' list names five characters, but only two are entities: `src/` holds no Mama view or dog (`MamaWoke` is an event and a Result header), and Epic 6 is backlog, « à réviser après playtest ». A view of nothing cannot be triggered by the sim, so the AC could not be tested, and unused files would count against the 3 MiB payload. **Geo may overrule this: see the question at the end of the workflow.** |
| D2 | **The look stops at the view.** `PapaLook = { hasMashOnCheek, hasHairOnEnd, isShirtInsideOut }` is a client type; `setLook` shows the parts. No `World.papa.look`, no `lookChange`, no snapshot version. Story 3.7 adds them with their Laugh points, and needs one line in `levelScene.update`. A look's hair and the outlet gag's hair share one mesh, drawn at the greater of the two amounts. | `World.papa.look` does not exist: the epics assign it to story 3.7, still backlog. Adding it here changes the snapshot (version 27) and the sim's scoring, and those belong to a design story with its own `feel.json` weights. |
| D3 | **First-pass rig and keyframes authored by the agent, headless, with Geo able to edit them.** No generated mesh, no bought or downloaded rig, no mocap. The `.blend` is the source and the throwaway scripts stay in the scratchpad, as 7.1 D9. Assets live in `assets-src/blender/characters/<id>.blend`. | GDD L514 says « personnages, rig et animations faits à la main », and no human is scheduled to do it. Scripted keyframes are authored by hand in spirit, and the code's contract does not care who made them: Geo can replace any file and rerun the two commands. **Flagged to Geo at the end of the workflow.** |
| D4 | **Colour as in 7.1:** one material per colour, base colour only, no vertex colours, textures, transparency, emissive or second UV. Rigid accessories (mug, handset, hair, look parts) are hidden meshes in the `.glb`, weighted to or parented under one bone. **No shape keys:** eyelids are a bone scaled by code, after `mixer.update`, and no clip has a track on it. | `createLevelScene`'s toon swap keeps only `color`. A hidden mesh costs no draw call. A clip track on the eyelid bone would fight `setEyelids`, which follows the micro-sleep's telegraph. |
| D5 | **State picks the loop, events pick the one-shots.** Loops are read every frame from `world.papa.state` and `world.baby.state`. One-shots: `ResponseResolved` (`perfect` differs from `success`), `GagTriggered` through `GAG_PRESENTATIONS`, `BabyPickedUp`, `BabyPutDown`, `PapaBlocked`, `WaitFeintGiven`, `WaitSignalGiven`, `BabyWoke`, `BabyStirred`, `PapaSnored`. A one-shot ends by fading back to whatever the state says **now**. The carried variants of Papa's loops read `baby.state === 'carried'`, the single source of truth; there is no `papa.carrying`. | A replay, a restart or a skipped frame can never leave a wrong loop playing, since the state is reread each frame. The existing `Record<GagId, …>` makes a new gag with no presentation a type error. |
| D6 | **`dtMs = max(0, clockMs − lastClockMs)`, where `clockMs` is `world.time.sim + alpha × STEP_MS`, as `levelScene.update` already computes.** The mixer never uses `THREE.Clock`, `performance.now` or `nowReal`. Actions are never paused for a hitstop: a dt of 0 does it. | `clockMs` stands still in a hitstop and a pause, and slows in a slow-mo, which is how the architecture wants choreography played (P3: the glide plays in slow-mo). `alpha` can step back at a boundary, and a negative dt would run a clip backwards. |
| D7 | **Squash is a scale on a group above the rig, not in the clips.** Reduced motion keeps the amount at 0 and keeps the clips. Nothing flashes. | A clip's scale tracks cannot be tuned or switched off as data, and gltfpack quantises them. `EXPERIENCE.md`'s table has no row for clips; keeping them is the same call as « hitstop and slow-mo unchanged », since a pose carries state (asleep, on the phone). Add the row to `EXPERIENCE.md` as `[ASSUMPTION]`. |
| D8 | **Silhouettes are gameplay.** Papa: feet at y = 0, top of his head at `PAPA_HEIGHT_M` (0.9), about `2 × papaRadiusM` wide (0.5) with arms down. Baby: floor-standing height about `2 × bodyRadiusM` (0.4) with the head as the bulk, centre of mass where the sphere's centre was. Carried, his centre stays at `BABY_CARRIED_HEIGHT_M` and `BABY_CARRIED_FORWARD_M`, because the tap aims there (`inputMapper`); Papa's arms go to that point. Laid, at `bombDrop.laidHeightM`. No clip lifts the baby above the 0.9 m sofa. Author at real size and do **not** rescale from the feel: the radii are tuning values for physics, and a `SetFeel` applies at the next level anyway. If they move far, the view logs nothing and the silhouette is Geo's to judge. | `ZONE_hidden_behind_sofa` depends on the baby being hidden. Markers read `PAPA_HEIGHT_M` (`threatMarkers`, `comboBadge`, `papaHint`, `beatRing`, `breathRing`). The camera is fixed: yaw 45°, pitch 35.264°, and the front of a character faces it only part of the time, so eyes must read from above and three-quarters. |
| D9 | **Readers of hidden answers are refused.** `characterClips.ts` and the views take only `papa`, `baby` and event arguments, never a threat. `eyelidsAmountAt` keeps its check on `microSleepDefId`, and `layDownPctAt` its check on release defs. A test scans those files for `windowOpenAt` and `feintAt`, allowing the two existing helpers. In the stealth step, the baby stays inert and looks the same until the alert's own telegraph. | GDD pillar 1, stories 4.6 and 4.7: « the client must never read `windowOpenAt` of a `wait` threat for anything visible ». A pre-blink before the signal would hand the duel to anyone watching. `realWakePct` is read by no code outside `stealthExit.ts`. |
| D10 | **Budgets:** per character, `CHARACTER_DRAW_CALLS_MAX = 6`, `CHARACTER_MATERIALS_MAX = 6`, `CHARACTER_TRIANGLES_MAX = 4_000`, `CHARACTER_BONES_MAX = 32`, `CHARACTER_GLB_MAX_BYTES = 300 × 1024`, at most 4 influences a vertex. Count as `roomBudgetOf` does, **visible nodes only**: hidden accessories have to be listed by the contract, since glTF has no hidden flag (three hides them by name in the view). | 7.1 played at 63 draw calls with 39 for the room, so 24 are the rest, of which 5 are today's characters. Two characters at 6 is +7, about 70. 7.3's outlines double the characters' calls, about 82, and stay under 100. The level payload was 886.6 KiB at 7.1, so two files at the limit still fit in 3 MiB. |
| D11 | **Disposal is explicit.** `rig.dispose()` calls `mixer.stopAllAction()`, `mixer.uncacheRoot(root)` and `skeleton.dispose()`, then frees geometry. The scene's `disposeObject` handles only `Mesh` geometry and materials, so it does not reach a skeleton's bone texture. Each level load parses its own copy, as today (no cache: the deferred « cache of parsed assets » stays open). `SkeletonUtils.clone` is not needed for one instance a character; it will be for several children. | A leaked bone texture grows on every « Recommencer » and is exactly what `level.spec.ts`'s equal-counts check catches. |
| D12 | **`frustumCulled = false` on skinned meshes.** | Three's bounds come from the rest pose, and a clip can move the mesh out of them. The characters are always in the fixed room, so culling saves nothing. |

### Character contract

Lower_snake_case. `characterArt.ts` checks these on the committed files.

**Papa** (`assets-src/blender/characters/papa.blend`). Shirt in `primary` `#6D3FE0`, so he stays « the purple one » for players of the prototypes.
- **Bones:** at least `root`, `spine`, `head`, `eyelids`, `arm_l`, `hand_l`, `arm_r`, `hand_r`, `leg_l`, `leg_r`.
- **Hidden nodes:** `papa_mug` (`hand_r`), `papa_handset` (`hand_l`), `papa_hair`, `papa_look_mash`, `papa_look_shirt` (shirt inside out, skinned like the shirt, shown instead of it). Names match what `levelScene.test.ts` already pins where they exist. The « Z » stays a code-made mesh in the view.
- **Loops:** `idle`, `walk`, `glide`, `drink`, `asleep`, `on_phone`, `carry_idle`, `carry_walk`. `walkDir` and `walkPath` both use `walk`, with the clip's speed from `feedback.json` (the sim's walk speed changes with the need and the stealth step). `onToilet` needs no clip: `setAway` hides him, and the `Record` entry says `idle`.
- **One-shots:** `respond_parry`, `respond_firm`, `respond_perfect`, `gag_hit`, `gag_shock`, `stumble`, `snore`.
- **Mug and machine:** the mug must be visible from the camera (deferred: today it hides behind him).

**Baby** (`assets-src/blender/characters/baby.blend`). Colour apart from the bedroom's and salon's near-white safe floors (7.1 review), and never within the reserved hues.
- **Bones:** at least `root`, `spine`, `head`, `eyelids`, `arm_l`, `arm_r`, `leg_l`, `leg_r`. `head` turns to the gaze, every frame, directly: it replaces `baby_gaze`. Keep an obvious gaze from above: big eyes, and the marker's replacement must pass Geo's look.
- **Loops:** `babble`, `crawl`, `locked`, `act`, `sneak`, `carried`, `cry`. The `Record<BabyState, …>` maps `wander` to `crawl`, `approach` to `crawl`, `targetLocked` to `locked`, `mischiefSilent` to `sneak`. `cry` overlays any state while `baby.cryEndsAt !== null` (a parallel timer, not a state, so it can overlap wandering).
- **One-shots:** `gag_delight`, `eyes_peek` (`WaitFeintGiven`), `eyes_open` (`WaitSignalGiven`), `sat_up`, `stir`, `wake`, `laugh`.
- **Laid:** no `laid` loop in the `Record`; the bomb drop stays `carried`, and `update`'s `layDownPct` lowers him, as today.

### What exists, and what must keep working

- **`papaView.ts`:** `update`, `pose`, `setEyelids`, `setAsleep`, `setDrinking`, `setOnPhone`, `setAway`, `setHair`, `dispose`. **Current:** a toon box plus code-made parts. **Changes:** the body and accessories come from the rig. **Preserved:** every signature, the `papaPoseAt` export, `PAPA_HEIGHT_M`, `PAPA_HAIR_HEIGHT_M`, the blob shadow that does not turn, node names `papa_group`, `papa`, `papa_hair`, `papa_mug`, `papa_handset`.
- **`babyView.ts`:** `update(baby, alpha, papa?, layDownPct?)`, `setLiftM`, `setSlideM`, `dispose`, `layDownProgressPct`, `babyPoseAt`. **Current:** a sphere and a gaze cone. **Preserved:** the height logic of `carried` (never under his resting height), the hop that adds to the carried lift, the slide that holds across updates, `baby_group`.
- **`levelScene.ts`:** `createLevelScene(assets, bodies)`. **Changes:** the view factories take rigs; mixers advance in `update`; `dispose` frees rigs. **Preserved:** `eyelidsAmountAt`, `layDownPctAt`, the order of `update`, and the shared toon cache (**the toon swap loop only traverses the room model, so a rig must do its own**). `isHiddenInGame` must not be run on a character: `parseNodeName` would reject or hide names like `col…`.
- **`gags.ts`:** `createGagFx` keeps its stage. `hairAmountAt` still raises the hair through `setHair`; the mixer does not touch it.
- **`loadLevelAssets.ts` / `gltf.ts`:** see T3. `gltf.ts` stays the only importer of `GLTFLoader`, reached by dynamic import, so the loader stays out of the main chunk.
- **`responseChoreography.ts`:** already sequences what plays at arrival: `onEvent` fires `liftBaby` on `PapaArrived`, or at once when there is no glide to wait for. Read it first, and hang the response clip on the same moment rather than writing a second queue. Under reduced motion `boot.ts` hands it `noLiftFx`, so the response clip must not go through that same object, or it would vanish with the hop (D7 keeps clips).
- **`boot.ts › onSimEvent`:** the place events reach the scene (`choreography.onEvent`, `fx.gag`). `noLiftFx` is how it drops motion under reduced motion.
- **`inspectDist.ts`:** payload = level `.glb` + all audio, today. See T3.
- **CSP:** `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`. With no images in the `.glb`, the loader needs no `blob:`. A texture in a character would fail in production only, which is one more reason for D4.
- **Must not change:** see AC 2, plus `GLTFPACK_FLAGS`, `src/content/levelNodeNames.ts`, `tests/architecture/blenderConventions.test.ts`.

**Expected changes:** `assets-src/blender/characters/{papa,baby}.blend`, `public/assets/characters/{papa,baby}.glb`, `tools/blender/export_character.py`, `tools/assets/{exportCharacter,optimizeCharacter,characterArt,paths}.ts`, `tools/assets/optimizeGlb.ts` (a factored runner only), `tools/build/inspectDist.ts` and its test, `package.json` scripts, `src/shared/constants.ts`, `src/content/schemas/feedback.ts`, `content/feedback.json`, `content/_schemas/`, `src/client/assets/{gltf,loadLevelAssets}.ts`, `src/client/render/levelScene.ts`, `src/client/render/gags.ts`, `src/client/render/views/{papaView,babyView,characterRig,characterClips,squash}.ts` and tests, `src/client/boot.ts`, `src/client/app/testHost.ts`, `tests/architecture/characterAssets.test.ts`, `tests/tools/assets/characterArt.test.ts`, `tests/e2e/characters.spec.ts`, the darwin screenshot references, `deferred-work.md`, `project-context.md`, `EXPERIENCE.md` (one row).

The sim's journal hashes are `feelHash`, `geometryHash` and `levelHash` (`createSim.ts:654`), so a new `feedback.json` key should move no golden; `createSim` reads only `feedback.beatTracks`. If a golden moves anyway, stop: none may move for this story (AC 2). The exported journal's `contentHash` will differ from older journals, and `sim:replay` treats that as a warning.

### Deferred items

Close these in `deferred-work.md`, each with what happened:
- « Papa's yaw has no smoothing » (1.7): done, the view only.
- « Smoothed turning of the gaze marker and any crawl animation » (1.8): the crawl is done; the gaze stays immediate on purpose (D9 and readability).
- « The mug Papa holds while he drinks is nearly invisible » (coffee machine marker branch): done.
- « Inverted-hull outline on Papa and the baby »: hand to 7.3; meshes are closed with outward normals for it.
- « The baby's eyes » comments in `gags.ts` (4.6, 4.7, 4.8): done by clips.

Record as open:
- **Mama, the dog and the children have no model** (D1), with the owning story of each.
- **Story 3.7 wires `setLook`** and adds `World.papa.look`, `lookChange` and the Laugh weights (D2).
- « Le bébé se hisse », « Papa retire l'objet », the stairs slide's height, shards and mischief drawings: untouched, and say so.

### Testing

- **Unit:** `characterClips`, `squash` (exactly 1 at both ends, volume constant within a rounding), `characterRig` on a code-built skinned fixture (crossfade, one-shot returns to the current state's loop, `dt` 0 holds the pose, dispose frees the skeleton), the views' existing behaviour, `loadLevelAssets`, `inspectDist`.
- **Architecture:** `characterAssets.test.ts` on the committed files, with no Blender needed in CI (it reads the JSON chunk through `parseGlb` of `tools/assets/glb.ts`, as `levelAssets.test.ts` does). `gltfpack`-compressed buffers are not readable there, so counts come from accessors and clip names from the JSON.
- **E2E:** `characters.spec.ts`, then `level`, `carry`, `feedback`, `autoplay`, `testApi` on Chromium. **Check `env | grep VITE_` first: this shell exports `VITE_DEBUG_ALLOWED=false`, so wrap dev and e2e commands in `(unset VITE_DEBUG_ALLOWED; …)`.**
- **Before the merge:** one `npm run ci:story`, after the review. `npm run ci` is not needed unless Geo closes Epic 7 with this merge; T10 covers the perf this story asks for.
- `npm run golden:update` here is a mistake.

### Project Structure Notes

- The architecture's tree lists `public/assets/characters/` with `papa.glb`, `baby.glb`, `mama.glb`, `dog.glb`. Two of the four come here (D1).
- **Variance:** `assets-src/blender/characters/` is a new sub-folder, since a `.blend` at the top of `assets-src/blender/` reads as a level by `blendPath`. `levelIds` are read from `content/levels/`, so nothing scans the folder, but keep them apart.
- **Variance:** the architecture's P3 says « papaView la joue à l'arrivée »; `responseChoreography.ts` is what sequences it today. Keep it the one place.
- `src/client/render/views/` is the existing home; `characterClips.ts` imports types from `@sim` only.

### Project Context Rules

- **Layers:** `client` may import `three`, `@sim` and `@content`. `src/` never imports `tools/`. `tools/` is Node only; `tests/architecture` may import both.
- **Golden rule:** the AI writes and tests, Geo plays and judges. Anything he may tune is data; constants in `shared/constants.ts`, `UPPER_SNAKE`, with a unit suffix.
- **Sim boundary:** the client only reads `world`. Never read a gameplay value from a mixer or a bone.
- **Zero allocation** in the rAF path: no closures, arrays or literals per frame, actions made up front, scratch objects reused. **Nothing loads during play.**
- **Budgets:** ≤ 100 draw calls, ≤ 100k triangles, no texture over 1024 px, blob shadows only, no shadow map, level payload ≤ 3 MB.
- **I/O** returns `Result`; every fallback logs a `warn`; no `console.*`. Channels `assets`, `render`.
- **Files:** `camelCase.ts`, factories `create<Name>`, booleans `is`/`has`/`can`, units as suffixes (`crossFadeMs`, `amountPct`). `describe/it/expect` from `vitest`.
- **Git:** this worktree, branch `story/7-2-personnages-rigges-et-animes`. Commit « Story 7.2 : personnages riggés et animés ». Merge only after the review, a green `ci:story` and Geo's OK. Two stories touching one `.blend` or `.glb` cannot merge: stop and ask Geo.
- **Shared machine:** wrap long runs in `caffeinate`; a 30 s timeout failing after minutes means the Mac slept. Run the perf spec alone.

### Previous story intelligence

- **7.1 reports:** rooms at 39 / 4,924 and 37 / 4,144; `perf.spec.ts` max 63 and 59 draw calls, p95 16.7 ms; payload 886.6 KiB. Its « wave » screenshots turned out to show no ring, and the notes claimed they did: **never claim a visual check you did not make.** Its AC 7 and 8 had to be rerun because the last edit came after them: run T9 and T10 **after** the last art edit.
- **7.1 found:** `-kn` keeps a named node and puts a single unnamed child under it, holding one mesh with one primitive per material. Three then splits primitives into child meshes named after the mesh data, so **never give mesh data a gameplay-looking name**. A traversal by node name must allow for that child; hidden accessories should be toggled on the named node, not the mesh.
- **7.1 review:** the baby is near-white, and the safe-zone floors `art_butter` and `art_moon` are about 1.2:1 against white. Rendered colours come out about 20 % darker than the material, because of the shared lights.
- **7.1 deferred:** `ROOM_DRAW_CALLS_MAX` assumes outlines « double what they cover »; D10's arithmetic answers this for the characters.
- **4.8 and 4.9** keep the carried baby's lowering motion-essential under reduced motion: do not gate it.
- **Recent commits** are 7.1 and 4.10, and touch no view code beyond `levelScene` wiring.

### Latest technical information

No new dependency: `three@0.186.1`, `gltfpack@1.3.0`, Blender 5.2.3 are pinned, so no web research is relevant. Checked locally:
- `gltfpack -h`: `-at` 16, `-ar` 12, `-as` 16 bits, `-af` 30 Hz by default (`0` disables resampling); **`-ac` keeps constant tracks that do not modify the node**; `-kn` keeps named nodes; `-mm` is not wanted here.
- `three/examples/jsm/utils/SkeletonUtils.js` exists in the pinned version; `Skeleton.dispose()` frees `boneTexture`.
- That a shared `MeshToonMaterial` draws a `SkinnedMesh` correctly is not assumed: T0 proves it in the browser.
- Exporter argument names and Blender 5's action slots are not assumed: T0 reads them from the running version.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2, #Story 3.7, #Story 6.1, Epic 7]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Style visuel L476, #Besoins en assets L514, FR37 via L437]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#P3 L758-776, tree L553, E7 table L977, E3 table L960, #Assets de jeu L637, budgets]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#Reduced motion L427]
- [Source: _bmad-output/project-context.md#Performance Rules, #Final rooms on a frozen layout, stories 4.1, 4.6, 4.7, 4.8, 4.9]
- [Source: _bmad-output/implementation-artifacts/7-1-pieces-modelisees-dans-blender.md, deferred-work.md]
- [Source: src/client/render/levelScene.ts, gags.ts, views/papaView.ts, views/babyView.ts, src/client/assets/gltf.ts, loadLevelAssets.ts, src/client/boot.ts L1287-1326, tools/assets/optimizeGlb.ts, exportLevel.ts, tools/blender/export_level.py, tools/build/inspectDist.ts L214-226, src/sim/world.ts, src/sim/papa/papaFsm.ts, src/sim/baby/babyFsm.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- A first `perf.spec.ts` on the salon gave p95 33.3 ms (mean 18.72), failed. The machine's load average was about 15 at that time. Rerun alone, with no change: p95 16.7 ms. The bedroom, between the two, gave 16.8 ms. Both figures are reported below; the first is load, on this evidence, not proved otherwise.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

**T0, the spike (Blender 5.2.3, read from `get_rna_type()`, not memory).**
- Exporter arguments used: `export_animation_mode='ACTIONS'`, `export_force_sampling=True`, `export_frame_step=1`, `export_anim_slide_to_zero=True`, `export_optimize_animation_size=True`, `export_optimize_animation_keep_anim_armature=False`, `export_skins=True`, `export_influence_nb=4`, `export_def_bones=False`, `export_leaf_bone=False`, `export_morph=False`.
- Each action exports as one clip under its own name. A headless script does need `action.slots.new(id_type='OBJECT', …)` and `animation_data.action_slot`; `use_fake_user` keeps the action.
- Bone and hidden node names survive `-kn`. A skinned or accessory mesh lands in an unnamed child of its named node (`mesh_0`), as 7.1 found: the code toggles the named node.
- Held poses survive with no `-ac`; a track equal to the rest pose is dropped, which is safe since the mixer restores a bone no clip holds. `CHARACTER_GLTFPACK_FLAGS = ['-cc', '-kn']`, `GLTFPACK_FLAGS` untouched.
- 30 Hz and 12-bit rotations keep the poses, and quantisation neither moves nor displaces the skinned mesh: the spike's bounds at the rest pose and mid-clip in each clip were identical to 3 decimals between the raw and the packed file, moved and scaled under a parent too.
- With `keep_anim_armature=False`, a bone no action keys has no track. The guard reads this on the committed files.
- A shared `MeshToonMaterial` draws a `SkinnedMesh` correctly: seen in the browser, in the game itself, not in a separate spike page.

**What changed.** Two rigged `.glb` files replace the cube and the sphere; the kit is `characterRig.ts`, `characterClips.ts`, `characterMotion.ts` (not in the story's list: the pacing and turn helpers, shared by both views) and `squash.ts`. `createBabyView` no longer takes the toon cache, since he has no code-made mesh. Both views gained `animate`, `playOnce`, `clipName`, `setSquash`, `resetAnimation`; every existing method keeps its signature and meaning.

**Decisions taken beyond the story.**
- **Lids of the baby:** D4 says no clip has a track on them, so `eyes_peek` and `eyes_open` cannot move them. `babyLidsAfter` does, from events alone: half on the feint, shut on the signal, open on a telegraph, gag, wake or sequence end. The signal *closes* his eyes (4.6, 4.7), so the contract's name `eyes_open` is misleading: kept, recorded in `deferred-work.md`, for Geo.
- **`neck` bone on the baby:** `head` is written by code every frame, so its gestures needed a bone of their own. `head` is in `codeDrivenBones`.
- **`papa_shirt`** is a node of its own, so that the inside-out shirt can replace it (`visibleNodes` in the contract).
- **`__PP__` gained `setPapaLook`** (thirteen methods now) and `fx()` gained `papaClip`, `babyClip`, `papaMixerMs`.
- **`UNIT_SUFFIX` of `feedbackSchema.test.ts` gained `Mps` and `DegPerSec`:** real units of the project's convention, new to this file. It rejects as before anything else.

**Tests that changed subject, with the same meaning.** `papaView.test.ts`: the cube's size and colour became the rig's parts shown and not culled; the eyelids' mesh became the `eyelids` bone's scale; « hair on top of the cube, one geometry » and « handset against the cube » went, being facts of code-made meshes: the silhouette tests of `characterAssets.test.ts` and the screenshots replace them. `babyView.test.ts`, `layDown.test.ts`, `levelScene.test.ts`: `baby`'s y is now his feet, so the carried and laid assertions read `y + radius`, the same centre; `baby_gaze_group` became body yaw plus head yaw. `gags.test.ts`: `toEqual` became `toMatchObject` on the stage flags. The mischiefs' title no longer says « until E7 ». `testApi.spec.ts`: thirteen methods.

**Proof that the game did not move (AC 2, after the last art edit).** `git diff --stat main` on the AC's paths is empty. `npm run sim` with the four bots on both levels, seed 1: all 8 reports byte-identical to `main` at 76c6517. No golden regenerated.

**Performance (AC 9), built playtest, after the last art edit.** `dist:check --flavor playtest`: OK, level payload 966.7 KiB, first load 2678.2 KiB gzip.

| Level | Frames | p95 | Mean | Draw calls max | Triangles max |
|---|---|---|---|---|---|
| `salon_crawler` | 17110 | 16.7 ms | 16.68 | 68 | 11210 |
| `chambre_night` | 11319 | 16.8 ms | 17.84 | 64 | 10712 |

Files: `papa.glb` 46.6 KB, `baby.glb` 35.5 KB. See the debug log for the salon's first, failed run.

**E2E, Chromium, last run of the view specs:** `characters`, `level`, `carry`, `feedback`, `autoplay`, `testApi`, `sequence`, `bombDrop`, `bedtimeDuel`, `fakeSleep`, `stealthExit`, `reducedMotion`, `baby`, `fatigue`, `phone`, `toilet`, `chambreNight`: 166 passed, 2 failed, both expected and fixed then: the screenshot reference (regenerated) and the method list of `testApi.spec.ts` (updated, rerun in the last check). `ci:story` is the review's, as the workflow says. That run came after the last art edit. After the last code edit: `npm run ci:fast` passes (7608 tests, no golden regenerated), and `characters`, `testApi`, `autoplay` on Chromium: 22 passed.

**What I saw by eye (AC 12), screenshots in `7-2-screenshots/`.**
- Opened on the final art: Papa drinking (the mug reads), on the phone (the handset sits above his hand, near the head; passable), asleep (slumped, with the « Z »), in the outlet gag (arms out, hair up, lights down), with mash on the cheek (small, beside the eye: Geo may want it bigger); the baby babbling and crawling (the bonnet reads from behind); both carrying (the baby is partly behind Papa on this heading); `salon_crawler_844_start`, `salon_crawler_667_carrying`, `chambre_night_844_start`, `chambre_night_667_carrying`. The frozen references, chromium and webkit: Papa, and the baby in the playpen.
- Opened on the art just before it (Papa's body did not change after): idle, walking, hair on end, shirt inside out.
- **Not seen, or not fully:**
  - The baby's lids shut at the signal: the marker stands over him in `duel_eyes_shut_at_signal.png`. Only unit tests pin it.
  - `salon_crawler_844_carrying`, `salon_crawler_667_start`, `chambre_night_844_carrying`, `chambre_night_667_start`, and the regenerated `papa_idle`, `papa_walking`, `papa_look_hair`, `papa_look_shirt_inside_out`, `baby_gag_outlet`, `both_carry_walking`: generated, not opened.
  - The motion itself: walk cycle, crossfades, squash and the one-shots were seen only as frozen frames or through the clip names. **No one has watched them move:** the feel of the squash and the timing are entirely unjudged.
  - `respond_*`, `stumble`, `snore`, `sat_up`, `wake`, `laugh`, `stir`, `cry`, `act`, `locked`, `sneak`: no capture. Their bounds are tested, their look is not.
  - The first capture of `papa_asleep` showed a white mass over him: the gag's particles, gone 1.5 s later in a second capture. Its name in `7-2-screenshots/` is that later one.
  - A real phone, and the whole under `?debug=1`: not done, no device here.

**For Geo.** D1 (only Papa and the baby) and D3 (first-pass rig and keyframes scripted by the agent) were applied as written; the throwaway scripts stayed in the scratchpad and the `.blend` files are the source. Charm, squash and the merge are his call (AC 12).

### File List

**New**
- `assets-src/blender/characters/papa.blend`, `assets-src/blender/characters/baby.blend`
- `public/assets/characters/papa.glb`, `public/assets/characters/baby.glb`
- `tools/blender/export_character.py`, `tools/assets/exportCharacter.ts`, `tools/assets/optimizeCharacter.ts`, `tools/assets/characterArt.ts`
- `src/client/render/views/characterClips.ts`, `characterClips.test.ts`, `characterMotion.ts`, `characterMotion.test.ts`, `characterRig.ts`, `characterRig.test.ts`, `squash.ts`, `squash.test.ts`
- `tests/architecture/characterAssets.test.ts`, `tests/tools/assets/characterArt.test.ts`, `tests/support/testCharacters.ts`, `tests/e2e/characters.spec.ts`
- `_bmad-output/implementation-artifacts/7-2-screenshots/` (24 images)

**Modified**
- `package.json`, `content/feedback.json`, `content/_schemas/feedback.schema.json`, `src/content/schemas/feedback.ts`, `src/shared/constants.ts`
- `tools/assets/optimizeGlb.ts` (the runner exported, nothing else), `tools/assets/paths.ts`, `tools/assets/roomArt.ts` (a parameter), `tools/build/inspectDist.ts`
- `src/client/assets/gltf.ts`, `src/client/assets/loadLevelAssets.ts`, `src/client/assets/loadLevelAssets.test.ts`
- `src/client/render/levelScene.ts`, `levelScene.test.ts`, `src/client/render/gags.ts`, `gags.test.ts`, `src/client/render/materials/toonMaterial.ts`
- `src/client/render/views/papaView.ts`, `papaView.test.ts`, `babyView.ts`, `babyView.test.ts`, `layDown.test.ts`
- `src/client/feedback/responseChoreography.ts`, `responseChoreography.test.ts`, `feedbackDirector.test.ts`, `feedbackTwins.test.ts`
- `src/client/app/levelSession.ts`, `levelSession.test.ts`, `src/client/app/testHost.ts`, `src/client/boot.ts`, `src/debug/testApi.ts`, `src/debug/testApi.test.ts`
- `tests/support/fakeTestHost.ts`, `tests/support/testContent.ts`, `tests/content/feedbackSchema.test.ts`, `tests/tools/build/checkDist.test.ts`, `tests/e2e/support/testApi.ts`, `tests/e2e/testApi.spec.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-chromium-darwin.png`, `autoplay-frozen-webkit-darwin.png` (regenerated on purpose, looked at)
- `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, `_bmad-output/project-context.md`, `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`

## Change Log

- 2026-11-01: Story 7.2 implemented: Papa and the baby rigged and animated, kit and pipeline, look ready for story 3.7. Set to review; the merge waits for the review, `ci:story` and Geo's visual OK.

### Review Findings

Code review of 2026-11-01 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; the 5,348-line code diff in one block, the planning-docs diff to the Auditor alone). No acceptance criterion is violated. Re-derived and conforming: no file changed under the paths of AC 2 (`git diff main...HEAD`, empty); `PAPA_LOOPS` and `BABY_LOOPS` are exhaustive `Record`s and all 12 `GagId`s carry `papaClip` / `babyClip`; `dtMs` reads the sim clock only (D6); the squash is pure, volume-preserving and exactly 1 at both ends (D7); the committed `.glb` files hold the contract's clips (15 and 14), no track on `eyelids` nor on the baby's `head`, no texture, and sit within the budgets (4 draw calls and 2,600 / 2,516 visible triangles); the `head`, `neck` and `eyelids` bones have an identity rest rotation. Not run in this review: the sim reports against `main`, `perf.spec.ts`, `dist:check --flavor prod` (the playtest flavour is the one recorded). Only the numbers and screenshots of the notes stand for AC 9 and AC 12.

- [x] [Review][Decision] **Resolved (a), keep the name: the entry in `deferred-work.md` stays open.** The baby's clip `eyes_open` plays on `WaitSignalGiven`, and the signal shuts his eyes — `babyLidsAfter` sets the lids to 1 on the signal (stories 4.6 and 4.7) while the clip, which only moves his neck and spine, is named for the opposite; the notes already record it as open for Geo. Options: (a) keep the name and the entry in `deferred-work.md`; (b) rename the action to `eyes_shut` in `baby.blend`, re-export, and change `BABY_CONTRACT`, `babyOneShotOf` and the tests (one action and a few lines); (c) also re-time the clip to the shutting of the lids [src/client/render/views/characterClips.ts:70]
- [x] [Review][Patch] An interrupted crossfade drops the summed weight below 1 — `fadeTo` sets every live track's target to 0 and `stepWeights` moves each at the same fixed rate `dtMs / crossFadeMs`, so with three live tracks (walk, then idle, then a response clip inside 140 ms; or a new one-shot during a one-shot's fade back to the loop) the sum falls to about 0.5 and three.js fills the rest from the bind pose: the character dips toward it for a few frames. Keep the incoming track's weight and scale the fading ones so the sum stays 1; add an A → B → C interruption test (the only crossfade test is one clean A → B) [src/client/render/views/characterRig.ts:102]
- [x] [Review][Patch] Assertions of the cube's tests lost their subject with no replacement — the old `papaView.test.ts` pinned the shirt to `PALETTE.primary`, the handset against his head and the hair on top of it; the notes say the silhouette tests replace them, but `drawnBox` skips every hidden node (`hiddenNodes.includes(node.name)`), so nothing checks where `papa_mug`, `papa_handset`, `papa_hair`, `papa_look_mash` and `papa_look_shirt` sit, nor the shirt's colour (the committed file happens to be `#6D3FE0`). Add a check that each accessory, shown, lies within the body's box plus a slack, and one that `art_shirt` is `PALETTE.primary` [tests/architecture/characterAssets.test.ts:114]
- [x] [Review][Patch] D11 is only partly pinned — `dispose()` calls `mixer.stopAllAction()` and `mixer.uncacheRoot(root)`, but the tests spy on the skeletons' and the geometries' `dispose` only, and a leaked mixer cache would not show in `level.spec.ts`'s geometry and texture counts. Spy on both mixer calls [src/client/render/views/characterRig.test.ts:169]
- [x] [Review][Patch] `gags.test.ts` went from `toEqual` to `toMatchObject` on the stage flags — an extra flag can now be added unnoticed, and the new `papaClip` / `babyClip` of `outlet_hair`, `stairs_slide` and `table_object_fall` are pinned by no value. Put `toEqual` back with the clips in the expected objects [src/client/render/gags.test.ts:31]
- [x] [Review][Patch] `feedback.json › characters` accepts duplicates — two `squash` rows with the same event and character (the later one wins) or two `clipSpeeds` rows with the same clip (the first wins): one of Geo's edits then does nothing, with no message. Add a `superRefine` rejecting both; and a test that every `SQUASH_EVENTS` entry is a real `SimEvent` type, so that a typo cannot silence a squash [src/content/schemas/feedback.ts:344]
- [x] [Review][Patch] Leftovers of the cube — `PAPA_HAIR_HEIGHT_M` is exported and read by nothing (the hair's height is in the `.glb`), `EYELIDS_OPEN_SCALE = 0.02` is declared in both views with the same comment, `papaView.test.ts` « keeps the height the markers read » compares `PAPA_HEIGHT_M` to itself (the silhouette test measures the real mesh), and the comment « Art constants (Geo tunes them here) » is no longer true of the mesh. Delete the dead export and the tautological test, share one `EYELIDS_OPEN_SCALE`, fix the comment [src/client/render/views/papaView.ts:17]
- [x] [Review][Patch] `SQUASH_CURVE_PEAK = 0.7638` is not the peak of `sin(2πu)(1 − u)` — 100,000 points give 0.76625 at u ≈ 0.218, so `amountPct` -30 reaches -30.1 %, not -30; `squash.test.ts` uses `toBeCloseTo(.., 2)` and cannot tell. Use 0.7662 (or compute it once at load) and assert the extreme to 3 digits [src/client/render/views/squash.ts:2]
- [x] [Review][Patch] `__PP__.setPapaLook(look)` forwards anything — `null` throws a bare `TypeError`, a look with a missing boolean hides parts silently, where `send`, `freeze` and `advance` check their argument and throw `__PP__.<method>: …`. Check an object with three booleans and throw the same way; add the case to `testApi.test.ts` [src/debug/testApi.ts:289]
- [x] [Review][Defer] A squash restarted mid-run snaps back to scale 1 — a second event on the same character (`PapaArrived` then a gag, `BabyWoke` then `BabyStirred`) sets `startAt` again and the curve begins at 1 from wherever it stood; a few percent when the events are a step apart [src/client/render/levelScene.ts:447] — deferred: keep the larger, blend or ignore is a feel call, for Geo once he has watched it move
- [x] [Review][Defer] The baby's head is not limited against his body — `headBone.rotation.y = wrapAngleRad(pose.yawRad - bodyYawRad)` can show up to 180° of twist for the 250 ms or so his body (720°/s) takes to catch up with a gaze that flips [src/client/render/views/babyView.ts:180] — deferred: the gaze is immediate on purpose (D9, readability) and a limit would delay it; judge it in play
- [x] [Review][Defer] Only `idle` and `walk` have carried variants — `glide`, `drink`, `asleep` and `on_phone` while `baby.state === 'carried'` play the arms-free clip, so the baby floats in front of a Papa whose arms are elsewhere [src/client/render/views/characterClips.ts:31] — deferred: the contract lists `carry_idle` and `carry_walk` only; Geo's call on what the first-pass art needs
- [x] [Review][Defer] Feel numbers left in code — `BABY_LIDS_PEEK = 0.5` and the travelling clips' speed clamp `CLIP_TIME_SCALE_MIN` / `MAX` = 0.3 / 2.5 [src/client/render/views/characterClips.ts:88] — deferred: the story asked for the four data entries it has; move these to `feedback.json › characters` when Geo asks to tune them
- [x] [Review][Defer] `responseClipOf(response: string, quality: string)` and the choreography's queued strings are untyped — a new response kind or a renamed quality silently plays `respond_parry` [src/client/render/views/characterClips.ts:81] — deferred: no new response kind is planned; type them from `ResponseResolved` when one is added
- [x] [Review][Defer] A one-shot ends at its first update when it is no longer than `crossFadeMs` — `update` ends it at `leftS × 1000 <= crossFadeMs` and the schema has no upper bound on `crossFadeMs`; the shortest clips (`stir` 0.40 s, `stumble` 0.47 s) are three times the 140 ms fade today [src/client/render/views/characterRig.ts:170] — deferred: only if Geo raises `crossFadeMs` past a third of the shortest clip; add a bound then
- [x] [Review][Defer] The code writes `head.rotation.y` and the lids' `scale.y` as absolute values [src/client/render/views/babyView.ts:180] — deferred: fine for the committed files (identity rest rotation, read from the JSON), but nothing checks it for a re-export; add the check to `characterAssets.test.ts` with the next Blender export

Dismissed as noise (27): `NaN` or negative `dt` on the public APIs (the sim's values are finite and `levelScene.update` clamps); `lastClockMs` after an `alpha` step back (no step back in practice; the e2e keeps the mixer within two steps of the sim for a whole run); `resetAnimation` not resetting the yaw (each start builds a new scene and disposes the old one: `levelSession.ts:516`); « the baby cries forever » (`runBabyCry` nulls `cryEndsAt` at its end); `clipTimeScaleOf(.., 0)` returning 1 (documented: a clip that does not move plays at its own pace); the gate on Papa's one-shots during a glide (`PapaBlocked` and `PapaSnored` cannot happen in a glide); the budget not counting hidden accessories (D10 says so); the characters parsed again on each level load (D11 keeps the cache deferred); the radii that no longer scale the mesh (D8); `D1` « one file and one view each » (wording); the tooling nits of `optimizeCharacter.ts`, `exportCharacter.ts` and `export_character.py` (developer commands, Blender pinned at 5.2.3); the regex-based architecture tests, the fixture rig's single 1 s clips, the console filter of `characters.spec.ts`, the coarse hitstop assertion (the clock-offset loop is what catches a mixer on real time); the lids reopening on any `ThreatTelegraphed` or gag (public cues, nothing hidden); the missing prod `dist:check` and the e2e list without `pauseResume`, `ui` and `move` (`ci:story` runs them).

- 2026-11-01: Code review. A crossfade cut short by a third clip keeps the weights adding up to 1 (the incoming clip gains `dtMs / crossFadeMs` and the others share the rest), with a test on flat clips over a bind pose that dips without it; Papa's shirt colour and the place of the mug, handset, hair, mash and inside-out shirt are pinned again in `characterAssets.test.ts`; `dispose` is pinned on `stopAllAction` and `uncacheRoot`; `gags.test.ts` is back on `toEqual` with the clips; `feedback.json › characters` refuses a second squash row for the same event and character and a second speed for the same clip, and a test checks `SQUASH_EVENTS` against `SIM_EVENT_TYPES`; `SQUASH_CURVE_PEAK` is 0.76625 and the test asserts the extreme to 4 digits; `__PP__.setPapaLook` checks its three booleans; the dead `PAPA_HAIR_HEIGHT_M`, the second `EYELIDS_OPEN_SCALE` and the self-comparing height test are gone. `ci:fast` passes (7,619 tests, no golden regenerated); `characters`, `testApi`, `autoplay`, `level`, `carry` and `feedback` pass on Chromium (51). Not rerun: the sim reports against `main` (no `src/sim` file changed) and the screenshot references (the frozen-frame spec still matches them). `ci:story`: a first run gave 366 passed and 18 failed, 30 s timeouts in 14 unrelated spec files, while another session ran its own Playwright suite (load average 100 to 130); those 18 rerun alone on Chromium with 2 workers: 18 passed, so the whole suite was not rerun.
