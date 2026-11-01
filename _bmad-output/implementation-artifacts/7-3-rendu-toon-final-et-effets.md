# Story 7.3: Rendu toon final et effets

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want a consistent cartoon look, with outlines and a bright palette,
so that the style holds on every screen.

**Requirements covered:** FR70. **Depends on:** the frozen rooms of 7.1, the rigs of 7.2.

**Scope:** the rendering layer only. Inverted-hull outlines on the characters and props, the final toon ramp and per-level lights as data, a reserved alert tint on the room's dangers, faceted particles, the stairs' stray blob shadow, and the WebGPU decision (ADR-008).

**Not in this story:**
- The celebration and film framings (7.4). Music (7.5).
- Any change to the sim, the bots, the goldens, the `.glb` files or the `.blend` files (AC 2).
- Outlines on the room's furniture (D2). Shadow maps, post-processing, textures.
- Final sound rings, shards, mischief drawings, the stairs slide's height, « le bébé se hisse », « Papa retire l'objet », particles anchored on the real response point: they stay deferred, and `deferred-work.md` says so (T9).

## Acceptance Criteria

The epics' criterion is: *given `src/client/render/materials/`, when the final rendering is in place, then dangers have a reserved alert tint, the performance budgets hold on the reference devices, and WebGPU is re-evaluated (ADR-008), with a decision documented in the architecture.*

1. **Outlines.** Papa, the baby and every prop show an ink outline, from inverted hulls, at both 844 × 390 and 667 × 375. The hull follows every skinned pose and the squash, and a hidden accessory hides its hull with it. Its width is `feedback.json › render.outlines.widthM` (D3, D4).
2. **The game does not move.** No file changes under `src/sim`, `src/bots`, `tests/golden/`, `content/levels/`, `content/threats/`, `content/sequences/`, `content/feel.json`, `public/_headers`, `public/assets/`, `assets-src/`. `npm run ci:fast` passes with no golden regenerated. `npm run sim` with the four bots on both levels, seed 1, gives reports identical to `main`.
3. **Nothing is revealed through walls.** Hulls and character meshes keep their depth test: a baby in `ZONE_hidden_behind_sofa` shows no outline over the sofa. A test pins `depthTest` on the hull material, and a screenshot shows it (D3).
4. **Alert tint.** While a threat whose def has `target: "anchor"` is `telegraph` or `windowOpen`, an unlit glow in `alert` (`#FFC21A`) stands on its anchor's point, and goes when it leaves those states. No other 3D element uses that hue. `hidden` silences and threats on Papa or the baby get none (D5, D6).
5. **Hidden answers stay hidden.** `dangerTint.ts` reads only `state`, `defId` and `anchorId`, never `windowOpenAt` or `feintAt`. The existing scan of `views/` gains this file. A real wake and a false alarm draw exactly the same thing (D6).
6. **Comfort.** The glow pulses at `pulseHz`, capped at 3 Hz by the schema, on the sim clock. Under « Réduire les animations » it holds steady. Reduced motion changes nothing else here (outlines and lights are not motion).
7. **Colours render as authored.** In the sun-facing band, a floor's drawn colour matches its material within a tolerance, read from pixels by T1 and recorded. Ambient and sun are per-level data, and `chambre_night` has its own night light (D7, D8).
8. **Wave contrast with the lights on.** The rule « floor ≥ 3:1 against `ink` » is computed from the **drawn** colour, using each level's lights, and passes on both levels (D8).
9. **Tunable.** The tones, lights, outline width, skipped materials, glow and stray-blob list are in `feedback.json › render`, with bounds in the schema. No golden moves for it (D9).
10. **Budgets, CI proxy.** `perf.spec.ts` on the built playtest, on both levels: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles. `dist:check --flavor playtest` passes. The numbers go in the story.
11. **Budgets, real devices.** The agent has no device and writes no number in `docs/playtest/device-measurements.md`. The story says plainly that this part of the epics' criterion is not proven until Geo's device pass (see « Open for Geo »).
12. **A restart leaks nothing.** `tests/e2e/level.spec.ts` shows the same draw calls, triangles, geometries and textures after a restart.
13. **WebGPU decided.** The architecture holds the decision and its reasons, in French, at each place that says « réévalué en E7 » (D10, T8).
14. **It plays without a human.** `/?autoplay=human&seed=1&speed=4`, with and without `&level=chambre_night`, plays with no `warn` on `assets` or `render`.
15. **Geo has seen it.** Screenshots of both rooms at both sizes are in the completion notes, the macOS references are regenerated on purpose and looked at, and the merge waits for Geo's visual OK. Every image not opened is listed as not opened.

## Tasks / Subtasks

- [ ] **T0. Spike the hull on one rig, one prop** (AC 1, 3, D3, D4)
  - [ ] In a throwaway branch of the code, hull Papa and a mug with the `ShaderMaterial` of D3, and look at it in the browser at both sizes.
  - [ ] Check and write in the notes: the width is right despite the node scale (`6.4e-5`), a clip moves the hull with the body, the squash too, and no crack shows on a prop with hard edges.
  - [ ] Look hard at three places: the eyes, the collapsed eyelids (`EYELIDS_OPEN_SCALE` 0.02, D4) and the joints of overlapping parts (7.2's rigid parts). Settle `skipMaterials`.
- [ ] **T1. Data and lights** (AC 7, 8, 9, D7, D8, D9)
  - [ ] `FeedbackSchema` gains `render`, then `npm run content:schemas`. `content:check` refuses a `lights.byLevel` key that is not a level.
  - [ ] `createToonMaterialCache(tones)` reads `render.toonTones`; `TOON_TONES` goes.
  - [ ] `createLevelScene` picks the level's lights from `SceneBodies`. `AMBIENT_INTENSITY`, `SUN_INTENSITY` and `SUN_OFFSET_M` go. **`setLightsFactor` must multiply the level's own values**, or the outlet gag brings the salon's lights into the bedroom.
  - [ ] Read a sun-facing floor pixel at 1:1 (screenshot) and compare it to the material. Write both values in the notes.
  - [ ] `tools/assets/roomArt.ts`: the floor-contrast check takes the level's lights by parameter (pure, same formula as D7). `levelAssets.test.ts` calls it with the live values. Run the light colours through `reservedHueProblems` with a fixture document, so that no light is vivid on a reserved hue.
- [ ] **T2. `materials/outlineHull.ts`** (AC 1, 3, D3, D4)
  - [ ] `createOutlineKit(render.outlines)`: one shared `ShaderMaterial`, `addOutlineHulls(root, kit)`, `dispose()`. Pure normals helper `weldedNormals(geometry)`, unit-tested on a split-normal cube (each corner's three copies get one averaged normal).
  - [ ] Collect meshes **before** adding anything: adding during `traverse` would hull the hulls.
- [ ] **T3. Wire the hulls** (AC 1, 12)
  - [ ] `createCharacterRig`: add hulls, reading material names **before** `swapToToon`, which loses them. The hull is the mesh's **sibling** with the same local transform, so toggling a named node (`papa_mug`, `papa_shirt`…) hides both. `SkinnedMesh`: `hull.bind(mesh.skeleton, mesh.bindMatrix)`, `frustumCulled = false`.
  - [ ] `dispose`: `rig.dispose()` already frees geometry through `root.traverse`, so hulls are covered. Do not dispose the skeleton twice: only the originals stay in `skinned`.
  - [ ] Props: hull the **template** in `createLevelScene` before the first `poolOf`, so that `template.clone(true)` carries it. The templates' geometry is freed through `propNodes`, already.
  - [ ] Update the tests that count children or meshes (`characterRig.test.ts`, `levelScene.test.ts`, `papaView.test.ts`). Say which assertions changed subject.
- [ ] **T4. `vfx/dangerTint.ts`** (AC 4, 5, 6, D5, D6)
  - [ ] Sprites made up front, one per threat instance with an anchor target, sharing one radial texture (reuse `blobAlpha`). `update(world, clockMs, isMotionReduced)` allocates nothing. Added under `content_root`, so that a shake moves it.
  - [ ] `SceneBodies.anchorThreatDefIds` beside `layDownDefIds`, from the same place in `levelSession.ts`. Heights come from `geometry.anchors`; a threat whose anchor is missing logs one `warn` and shows nothing.
  - [ ] Add `PALETTE.alert` with a test tying it to `DESIGN.md` (`colourToken`). An architecture test: only `dangerTint.ts` under `src/client/render/` names `PALETTE.alert`, `parry` or `dodge`.
  - [ ] `resetFx` hides them; `dispose` frees them. `realFxState()` and `__PP__.fx()` gain `dangerTintsShown`.
- [ ] **T5. Particles** (D11)
  - [ ] `particles.ts`: `OctahedronGeometry` for the `BoxGeometry`. Same pool, same draw call. Replace its « provisional » comment.
- [ ] **T6. The stray blob** (D9)
  - [ ] `addBlobShadows(parent, colliders, skipIds)`, from `render.blobSkipColliderIds: ["stairs"]`. The height heuristic stays for everything else, and `deferred-work.md` says the rest of it is unchanged.
- [ ] **T7. Prove nothing moved** (AC 2, 3, 5, 12, 14)
  - [ ] `git diff --stat main` on the paths of AC 2 is empty; `npm run ci:fast`; the four bots on both levels against `main` with `--seed 1`.
  - [ ] `tests/e2e/render.spec.ts` (new): a forced anchor threat raises `dangerTintsShown` to 1, then back to 0 once resolved; `ForceThreat` on a threat of another target leaves it at 0; the behind-the-sofa screenshot of AC 3.
  - [ ] On Chromium: `render`, `level`, `characters`, `feedback`, `reducedMotion`, `autoplay`, `testApi`, `chambreNight`.
- [ ] **T8. WebGPU** (AC 13, D10)
  - [ ] Timebox: one hour, in the scratchpad, nothing committed. In a throwaway Vite entry on the pinned `three@0.186.1`, measure the gzip size added by `three/webgpu`, and read in its source whether `ShaderMaterial` and `MeshToonMaterial` with a `gradientMap` carry over. **Do not upgrade `three`**, even though 0.187.0 is out.
  - [ ] Check Apple's own docs on WebGPU in `WKWebView`, which matters for E8. Write what could not be established as such.
  - [ ] Write the decision in French in `game-architecture.md`: the Rendu row (L188), the Différé row (L200), ADR-008 (L308), the E7 row (L978), L1149. Update `project-context.md` where it says « no WebGPU before E7 » (L23).
- [ ] **T9. Close and record the debts**, see « Deferred items ».
- [ ] **T10. Performance and delivery** (AC 10, 15), under `caffeinate`, alone on the machine, **after the last visual edit**
  - [ ] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, `npx playwright test -c playwright.dist.config.ts --project perf --workers=1`, then with `PP_PERF_LEVEL=chambre_night`.
  - [ ] `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots`. Open the images and say so.
  - [ ] Screenshots in `_bmad-output/implementation-artifacts/7-3-screenshots/`: both rooms at both sizes, a telegraphed outlet, stairs and coffee table, the baby behind the sofa, the eyes close up, the gag with the lights down in the bedroom, a wave on the bedroom floor with the lights on (never captured in 7.1).

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The look lives in the client and in `feedback.json`.** No new asset, no re-export. | 7.1 and 7.2 froze the files, and the epics' criterion is about `materials/`. |
| D2 | **Outlines on characters and props, not on the furniture.** `ROOM_DRAW_CALLS_MAX` stays 40; correct its comment and `CHARACTER_DRAW_CALLS_MAX`'s, which say outlines « double what they cover ». Threats have no mesh of their own (`COL_stairs` has no visual), so an active threat's outline is its marker's existing ink outline, and its tint is D5. | The architecture says « personnages, menaces actives, props saillants ». Doubling the room gives 102 draw calls. |
| D3 | **A view-space hull in metres, in a shared `ShaderMaterial`.** `side: BackSide`, flat colour `PALETTE.ink`, depth test and write on. Vertex: three's chunks `skinning_pars_vertex`, `beginnormal`, `skinbase`, `skinnormal`, `defaultnormal`, `begin`, `skinning`, `project`, then `gl_Position = projectionMatrix * (mvPosition - vec4(normalize(transformedNormal).xy * widthM, 0., 0.))`. **The minus is deliberate:** `BackSide` defines `FLIP_SIDED`, and `defaultnormal_vertex` then negates `transformedNormal`, so a plus would push the hull inward, where it never shows (checked in the pinned three). Unskinned meshes work with the same source: the skin chunks are guarded by `USE_SKINNING`. | **`position += normal * width` in object space is wrong here:** gltfpack quantises, so every mesh node has a scale near `6e-5` (read from the files), and the outline would vanish. Likewise a `MeshBasicMaterial` patch: `transformedNormal` exists there only under `USE_SKINNING` (`meshbasic.glsl.js`), so props would not compile. The camera is orthographic (`isoCamera.ts`), so metres in view space are constant on screen, need no resolution uniform and no DPR handling, ignore the squash's scale and follow the perfect's zoom. |
| D4 | **Welded normals, skipped materials.** A hull's geometry shares `position`, `index`, `skinIndex` and `skinWeight` with its source, and has its own `normal`, averaged over vertices at the same quantised position (compare integers through `getX`, which also reads interleaved attributes). `outlines.skipMaterials` starts at `["art_ink"]`: thickening what is already ink would close the eyes. T0 decides on `art_paper` and how the lids behave. | Hard edges split normals (a room box is 24 vertices, 12 triangles), and a hull opens at each split. Shared buffers cost no memory. They are disposed together with the level, and three recreates any buffer still in use. **If the lids show as ink dots** (a mesh collapsed by a 0.02 scale, then pushed out by `widthM`), say so and choose: skip that part or ask Geo; do not edit the `.glb`. |
| D5 | **The tint is a pooled `Sprite`, unlit, at the anchor's real point.** `depthTest: false`, `depthWrite: false`, no fog. Radius, opacities and `pulseHz` are data. | A floor decal fails: under the coffee-table anchor it would be hidden by the table, and the outlet is on a wall. A sprite reads the same on all three. Unlit, so the outlet gag's lights-out does not put it out. It costs one draw call per threat up, only while up. |
| D6 | **Only `target: "anchor"`.** Threats on Papa and the baby already have a marker with the alert halo on them; `hiddenZone` is a secret until found. | GDD pillar 1, stories 4.6, 4.7, 4.9. `real_wake` and `false_alarm_sigh` both target the baby, so no code here can tell them apart. Never read `realWakePct`. |
| D7 | **Lights: `ambientIntensity + sunIntensity = π` is the salon's starting point.** Start at about 1.1 and 2.04, sun colour white. The drawn linear colour is `material × (ambient + sun × tone) / π`, where `tone` is the band's ramp value and the bands split `N·L` in thirds. | Today's 0.9 + 1.3 gives 0.70 linear, or 0.85 in sRGB: the « 20 % darker » 7.1 reported. With the sun at `[5, 9, 7]`, `N·L` is 0.72 on a floor (top band), 0.56 on the back wall and 0.40 on the side wall (middle band). So walls stay one band down, which is the toon look. This formula is my reading of three, consistent with 7.1's measure: T1 proves it by pixel, and if it differs, trust the pixel and fix this note. |
| D8 | **Night is light plus palette.** `chambre_night` gets a cooler, dimmer row, with whatever values keep the floor at 3:1 (AC 8). The salon's values are not the bedroom's. | 7.1 D8 and 4.9's open point 9. The `art_wood` slab side at 3.20:1 is not walkable, so judge the walkable planks. Dimming the room lowers contrast against ink: that is why AC 8 exists. |
| D9 | **All of it in `feedback.json › render`, never in `feel.json` or the level JSON.** `{ toonTones: [96, 178, 255], lights: { default, byLevel }, sunOffsetM, outlines: { widthM, skipMaterials }, dangerTint: { radiusM, minOpacityPct, peakOpacityPct, pulseHz }, blobSkipColliderIds }`. Tones ascending, within 0-255; `pulseHz` ≤ 3; `widthM` > 0. | **`feel.json` and the level JSON are hashed into the journal (`feelHash`, `levelHash`, `createSim.ts`) and would move every golden.** The sim reads only `feedback.beatTracks`. Older journals get the usual content-hash warning in `sim:replay`. Start `widthM` near 0.025: about 2 CSS px by my estimate of 80 px/m at 844 wide; measure. |
| D10 | **WebGPU: recommended outcome is « stay on `WebGLRenderer` », to confirm by T8.** Re-evaluate only if E8 or a device pass finds a budget a WebGL renderer cannot hold. | The budgets hold at 68 draw calls and p95 16.7 ms, so there is no bottleneck to fix. Support is partial on the targets: iOS 26 and later, and on Android Chrome 121+ with Android 12 and Qualcomm or ARM GPUs (web.dev). Unverified: `WKWebView` (E8's shell), and the share of phones. Blogs quote 70-80 % of mobile and conflicting speed gains; do not cite them as facts. Fallback means two renderers to test, and D3's material would need a node-material twin (check). |
| D11 | **Particles: only the shape changes.** Faceted, one draw call, same colours (ink, paper, cream). Their constants stay in code. | « Final art » for particles is low-cost here. `feel.fx` holds their intensities and is hashed, so moving `PUFF_*` there would move goldens: if Geo retouches them, they go to `feedback.json`. The earlier deferred note says `feel.fx`: correct it. |

### Draw-call arithmetic (AC 10)

Measured on `main`: 68 in the salon, 64 in the bedroom (7.2). Adding about 6 for two characters (4 visible primitives each, minus `art_ink`), up to 2 for a shown accessory, about 5-10 for the props (count their primitives in T0), and 1 per threat up. Expect the mid 80s. **Triangles** roughly gain the outlined share: well under 100k from 11,210. If the salon goes over 100, report it; never raise a budget.

### What exists, and what must keep working

- **`toonMaterial.ts`:** `swapToToon` keeps only `color` and loses the material's name, so T3 reads names first. The deferred « toon swap keeps only `color` » stays true by design: close it with that reason.
- **`characterRig.ts`:** `root.traverse` swaps materials and collects `skinned`. **Preserved:** every method, `frustumCulled = false`, `node()` by name. 7.1 found that a named node holds an unnamed child with the mesh, and three splits multi-material meshes into children: hence a sibling hull.
- **`papaView.ts` / `babyView.ts`:** they toggle `papa_mug`, `papa_handset`, `papa_hair`, `papa_look_mash`, `papa_shirt`, `papa_look_shirt` and scale `eyelids`. Nothing changes in them if hulls are siblings. The « Z » gets no hull.
- **`propView.ts`:** `template.clone(true)` shares geometry and material; a broken prop's squash is `body.scale.y`, which the hull follows.
- **`levelScene.ts`:** order matters. The model's toon swap runs, then `takePropNodes`, then pools. Hidden nodes are already gone. `disposeObject(scene)` calls `dispose` on the shared hull material, which is harmless; the kit still disposes it last.
- **`gags.ts`:** `createGagFx`'s stage is unchanged. Update the « until E7 » comments on what this story resolves: lights in `levelScene.ts`, the ramp in `toonMaterial.ts`, particles. Others stay, with a pointer to what still owns them.
- **`renderer.ts`, `isoCamera.ts`, `adaptivePixelRatio.ts`:** no change expected.
- **Existing guards:** `levelAssets.test.ts` and `characterAssets.test.ts` keep materials off the reserved hues; `designTokens.ts`'s `colourToken` reads `DESIGN.md`. Reuse them.
- **Reduced motion:** `bodies.isMotionReduced()` is read per frame for the door; the tint does the same. The burst's -60 % is already in `feedbackDirector.ts`.

**Expected changes:** `src/client/render/materials/{outlineHull,toonMaterial,palette}.ts`, `src/client/render/vfx/{dangerTint,particles}.ts`, `src/client/render/blobShadow.ts`, `src/client/render/levelScene.ts`, `src/client/render/views/characterRig.ts`, their tests, `src/client/app/{levelSession,testHost}.ts`, `src/debug/testApi.ts`, `src/content/schemas/feedback.ts`, `content/feedback.json`, `content/_schemas/`, `src/shared/constants.ts` (comments), `tools/assets/roomArt.ts`, `tests/architecture/levelAssets.test.ts`, a reserved-hue architecture test, `tests/support/testContent.ts`, `tests/e2e/render.spec.ts`, the darwin references, `game-architecture.md`, `project-context.md`, `deferred-work.md`.

### Deferred items

Close, each with what happened:
- « Inverted-hull outline on Papa and the baby » (L111, L129, L911).
- « Night: per-level lights go to 7.3 » (L870), « colours render 20 % darker » (L888), « contrast guard reads material values » (L894), `ROOM_DRAW_CALLS_MAX`'s assumption (L895).
- « `COL_stairs` lone smudge » (L887); the heuristic itself (L105) stays open, with its reason.
- « The toon swap keeps only `color` » (L104): by design, final.
- « The particles are provisional boxes » (L557): the shape is done, the response point stays open.

Leave open, and say so: final sound rings (L148), shards and mischief drawings (L264, L276, L393, L890), the stairs slide, « se hisse », « retire l'objet », the safe floors against the baby (L897: look, and report).

### Testing

- **Unit:** `weldedNormals`, `addOutlineHulls` (a hull per unskipped mesh, sibling, same skeleton, none for a skipped material, nothing hulled twice), `dangerTint` (each state, each target, the pulse, reduced motion, a pause holding it), the schema's bounds, lights in `levelScene`, the gag on per-level values.
- **E2E:** see T7. **Check `env | grep VITE_` first: this shell exports `VITE_DEBUG_ALLOWED=false`; wrap dev and e2e in `(unset VITE_DEBUG_ALLOWED; …)`.**
- **Before the merge:** one `npm run ci:story`, after the review. `npm run ci` is not needed: 7.4 and 7.5 still open the epic.
- `npm run golden:update` here is a mistake.

### Project Structure Notes

- The architecture's tree names `materials/outlineHull.ts`, `toonMaterial.ts`, `palette.ts`, and `vfx/particles.ts`. It says `screenShake.ts` where the code has `shake.ts`: leave it.
- **Variance:** `vfx/dangerTint.ts` is new to the tree; add it in T8's edit.
- **Variance:** the architecture says outlines on « menaces actives »; D2 explains why that is the marker's.

### Project Context Rules

- **Layers:** `client` may import `three`, `@sim`, `@content`. `src/` never imports `tools/`.
- **Golden rule:** Geo tunes the feel; anything he may tweak is data.
- **Zero allocation** in the rAF path; nothing is built during play; **nothing loads during play**.
- **Budgets:** ≤ 100 draw calls, ≤ 100k triangles, no shadow map, no post-process.
- **UX:** `parry`, `dodge` and `alert` keep their signal meaning everywhere. Nothing flashes above 3 Hz.
- **No `console.*`:** `log.warn('render', …)`; every fallback warns. Units as suffixes (`widthM`, `pulseHz`, `peakOpacityPct`). `describe/it/expect` from `vitest`.
- **Git:** this worktree, branch `story/7-3-rendu-toon-final-et-effets`. Commit « Story 7.3 : rendu toon final et effets ». Merge only after the review, a green `ci:story` and Geo's OK.
- **Shared machine:** wrap long runs in `caffeinate`; run the perf spec alone (7.2's first salon run gave p95 33.3 ms at load average 15, then 16.7 ms alone).
- **Blender:** not needed. Do not open the live MCP session's file.

### Previous story intelligence

- **7.2:** 68 / 11,210 and 64 / 10,712 at p95 16.7 and 16.8. `papa.glb` has 11 primitives, of which 4 are visible; `baby.glb` has 4. Parts overlap, and 7.2 asks for the joints to be checked.
- **7.1:** « never claim a visual check you did not make »; its « wave » images showed no ring. Run T7 and T10 after the last visual edit, or rerun them.
- **7.1:** 3-band toon was subtle on pale floors; expect to retune the tones by eye, and report.
- **Recent commits:** 7.2's merge and 3.5's door. `doorView.ts` draws a code-made panel with a toon material: no hull, it is scenery.

### Latest technical information

No new dependency. Pinned `three@0.186.1`; npm's latest is 0.187.0, and this story does not move to it. Checked locally: `meshbasic.glsl.js`, the `.glb` JSON (`KHR_mesh_quantization`, `EXT_meshopt_compression`, byte normals, uint16 positions, node scales), the camera.

Web, 2026-11-01: [web.dev on WebGPU support](https://web.dev/blog/webgpu-supported-major-browsers) is the one authoritative source found. Blog figures on mobile coverage and speed disagree with each other and were not verified.

### Open for Geo

1. **Real devices (AC 11).** The epics ask for the budgets on iPhone 12 and a 2021 Android. Only you can measure that. As written, the story can merge on the CI proxy, and the device pass stays the playtest's barrier, as it already is.
2. **Outlines on furniture (D2).** Characters and props only. The room's silhouettes stay outline-free for the budget; say if the look needs some of them.
3. **WebGPU (D10).** Recommended: stay on WebGL. It is your call once T8 reports.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3, Epic 7]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Style visuel L474-481]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Performances L1079-1098, ADR-008 L308, L188, L200, L250, L978, L1149]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md#colors L25-27, L378, L395, L550]
- [Source: _bmad-output/project-context.md#Performance Rules, #Rigged characters, #Final rooms on a frozen layout, stories 4.6, 4.7, 4.9]
- [Source: _bmad-output/implementation-artifacts/7-1-pieces-modelisees-dans-blender.md, 7-2-personnages-rigges-et-animes.md, deferred-work.md]
- [Source: src/client/render/levelScene.ts, materials/toonMaterial.ts, views/characterRig.ts, views/propView.ts, views/papaView.ts, vfx/particles.ts, blobShadow.ts, isoCamera.ts, src/client/ui/world/threatMarkers.ts, tools/assets/roomArt.ts, tests/e2e-dist/perf.spec.ts, docs/playtest/device-measurements.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
