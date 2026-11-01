---
baseline_commit: 76c6517e16d1a22d14927727fd86af951f226a41
---

# Story 7.2: Personnages riggés et animés

Status: ready-for-dev

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

- [ ] **T0. Spike one rigged character through the whole pipeline** (AC 1, D3, D4)
  - [ ] Read « Blender access » first. In a copy under the scratchpad, build a two-bone, two-material mesh with two actions and a hidden child mesh parented to a bone.
  - [ ] Export with a draft `export_character.py`, then `gltfpack`, then load it in the browser with a mixer and a `MeshToonMaterial`.
  - [ ] Check, and write in the completion notes: the exact exporter arguments on Blender 5.2.3 (read them from `bpy.ops.export_scene.gltf.get_rna_type()`, do not trust memory); that each action exports as one clip under its own name (Blender 5 actions have slots: a headless script must assign `action_slot` too); that bone and hidden node names survive `-kn`; that clips with held poses survive gltfpack's constant-track removal, or that `-ac` is needed; that 30 Hz resampling and the default 12-bit rotations keep the poses clean; that the skinned mesh is not moved or displaced by quantisation.
  - [ ] Record the final flags as `CHARACTER_GLTFPACK_FLAGS`. Do not change `GLTFPACK_FLAGS`: the rooms stay byte-identical.
- [ ] **T1. Guard test, before any modelling** (AC 9, D4, D10)
  - [ ] Add the five `CHARACTER_*` constants to `src/shared/constants.ts`, with a comment saying what they reserve.
  - [ ] `tools/assets/characterArt.ts` (pure, reuses `reservedHueProblems` and `roomMaterialProblems` of `roomArt.ts`; extend those only by parameters): `characterBudgetOf(json)`, `characterRigProblems(json, contract)`. Test in `tests/tools/assets/characterArt.test.ts`, one failing fixture per rule, including a missing clip, a missing bone, a joint with more than 4 influences if readable from the JSON, a texture, and over-budget counts.
  - [ ] `tests/architecture/characterAssets.test.ts`: runs them on both committed `.glb` files, and checks every clip named in `feedback.json › characters` and in `src/client/render/views/characterClips.ts` exists in the file.
- [ ] **T2. Pipeline** (AC 1, D3)
  - [ ] `tools/blender/export_character.py`, `tools/assets/exportCharacter.ts`, `tools/assets/optimizeCharacter.ts`, and `characterBlendPath` / `characterGlbPath` in `paths.ts`. Reuse `findBlender` and factor the `gltfpack` runner of `optimizeGlb.ts` without changing its behaviour. Scripts `assets:character:export` and `assets:character:optimize`.
  - [ ] Do not route characters through `export_level.py`: it refuses a scene with no `NAV_floor` and pins skins and animations off, and `blenderConventions.test.ts` compares it to the TypeScript rules.
- [ ] **T3. Loading** (AC 1, D11)
  - [ ] `gltf.ts`: add `parseCharacterGlb(bytes, baseUrl)` returning `{ scene, animations }`. Today `parseGlb` returns `gltf.scene` alone, so **every clip would be dropped silently**. `parseGlb` stays as it is.
  - [ ] `loadLevelAssets.ts`: `LevelAssets.characters: { papa, baby }`, with an injectable `parseCharacter`, the same magic check and the same `err` wording. The three files load in parallel. Tests for each failure.
  - [ ] `dist:check` (`tools/build/inspectDist.ts`): add both characters to every level's payload and gzip totals, report a missing file as a problem (the budget must not be vacuous), and each over `CHARACTER_GLB_MAX_BYTES` as one. Fixtures in its test.
- [ ] **T4. Data** (AC 5, D7)
  - [ ] `feedback.json › characters`: `crossFadeMs`, `turnRateDegPerSec`, `squash` (one row per trigger: `event`, `amountPct`, `durationMs`), walk clip speeds. `FeedbackSchema` first, then `npm run content:schemas`. Bounds in the schema: `amountPct` keeps the height strictly positive.
- [ ] **T5. The character kit, with no art** (AC 3, 4, 5, 10)
  - [ ] `src/client/render/views/characterClips.ts`: `papaClipOf(papa, baby)`, `babyClipOf(baby)`, the two `Record`s, the clip names. Pure, no Three.
  - [ ] `src/client/render/views/characterRig.ts`: `createCharacterRig(asset, toon)`: swaps materials through the toon cache by colour, sets `frustumCulled = false`, makes one mixer with every action created up front, `play(clip)`, `playOnce(clip)`, `update(dtMs)`, `dispose()`. A test fixture builds a small skinned mesh in code (`tests/support` or next to the test).
  - [ ] `squashScaleAt(amountPct, elapsedMs, durationMs, out)` pure, volume-preserving (`y = s`, `x = z = 1 / √s`), back to exactly 1 at the end, in `src/client/render/views/squash.ts`.
  - [ ] Allocation check: nothing in `update` allocates once the clips have played once. Existing rule; prove it by reading, and let `perf.spec.ts` confirm.
- [ ] **T6. Model and animate Papa** (AC 6, 8, D3, D8)
  - [ ] Inventory under « Character contract ». Look in the browser at both sizes through the autoplay, not in a Blender render (GDD: the modelling tool's render does not carry over).
- [ ] **T7. Model and animate the baby** (AC 6, D3, D8)
  - [ ] Huge head, big eyes, readable gaze from the fixed camera. White alone fails on the pale safe-zone floors (7.1 review): give him a colour that keeps him apart.
- [ ] **T8. Wire the views** (AC 3, 4, 6, 7)
  - [ ] Rewrite `papaView.ts` and `babyView.ts` on the kit: **every method keeps its signature and its meaning**. Remove the cube, the sphere and the code that only they used. `PAPA_HEIGHT_M` and `BABY_CARRIED_*` stay, since UI and input read them.
  - [ ] `levelScene.ts`: pass `assets.characters`; advance both mixers with the sim-clock delta (D6); `resetFx` clears one-shots and squash; `dispose` frees skeletons (D11). Add `playCharacterEvent` to `LevelFx`, called from `onSimEvent` in `boot.ts`, skipped for squash under reduced motion like `noLiftFx`.
  - [ ] Response clips follow P3: the sound fires at judgement, and the clip plays on arrival (`PapaArrived`, through `responseChoreography.ts`). A gag during a glide plays in parallel, on the upper body or as squash; it must never stop the glide.
  - [ ] `gags.ts`: `GagPresentation` gains `papaClip` and `babyClip` (`string | null`). Replace the « until E7 » comments that this resolves.
  - [ ] Smooth Papa's body turn (shortest arc, `turnRateDegPerSec`). `pose.yawRad` stays the sim's: whatever reads it must not lag. **The baby's gaze stays immediate**, since the eyes are what the player reads.
  - [ ] `realFxState()` and `__PP__.fx()` gain `papaClip`, `babyClip`; `testHost` gains a debug `setPapaLook`. Check `dist:check`'s prod markers still pass.
- [ ] **T9. Prove nothing moved** (AC 2, 6, 7, 11)
  - [ ] `git diff --stat main` on the paths of AC 2 is empty; `npm run ci:fast`; the four bots on both levels against `main` with `--seed 1`.
  - [ ] Update unit tests that pinned the cube (`levelScene.test.ts`, `papaView.test.ts`, `babyView.test.ts`, `layDown.test.ts`) to the same behaviour on the fixture rig. An assertion may change its subject, never lose its meaning; say which ones changed.
  - [ ] `tests/e2e/characters.spec.ts` (clips change, a hitstop freezes the mixer's time, a pause too, the look shows). Run on Chromium with the specs that pin the views: `level`, `carry`, `feedback`, `autoplay`, `testApi`, plus whichever covers the sequences.
- [ ] **T10. Performance and delivery** (AC 9, 12), under `caffeinate`, one at a time
  - [ ] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, then `npx playwright test -c playwright.dist.config.ts --project perf --workers=1`, then with `PP_PERF_LEVEL=chambre_night`. Write the numbers in the story.
  - [ ] `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` (macOS only, deliberate). Look at the images and say so.
  - [ ] Screenshots in `_bmad-output/implementation-artifacts/7-2-screenshots/`: each character walking, carrying, asleep, on the phone, in a gag, and each look part. **State what you saw by eye and what you did not capture.**
- [ ] **T11. Close the deferred items and record the debts** (see Dev Notes)

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
