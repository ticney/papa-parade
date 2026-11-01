# Story 7.1: Pièces modélisées dans Blender

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want rooms modelled in the final style,
so that the world is readable and charming.

**Requirements covered:** FR70 (epics, Epic 7). **Depends on:** the pipeline of story 1.6 and the two greybox rooms of stories 1.6 and 4.10.

**Scope:** the two rooms that exist, `salon_crawler` and `chambre_night`. This is an **art swap on a frozen gameplay layout**: only visual nodes, the meshes inside `PROP_*` nodes, the `.blend` files, the shipped `.glb` files and one guard test change.

**Not in this story:**
- Characters and their animation (7.2). Papa stays a cube and the baby a sphere.
- Outlines, the final toon ramp, lights per level, WebGPU (7.3).
- Rooms of Epics 5 and 6, which do not exist yet (see D9).
- Shards, mischief drawings, real gag animations (deferred to E7 art, not this story).

## Acceptance Criteria

1. **The extracted geometry is unchanged.** Given the pipeline of story 1.6, when both final rooms replace their greyboxes, then `git diff --exit-code main -- content/levels/salon_crawler.geometry.json content/levels/chambre_night.geometry.json` reports nothing: the same colliders, grid, anchors, zones, props and bounds, byte for byte (D1).
2. **Nothing else in the game moves.** No file changes under `src/sim`, `src/bots`, `content/` or `tests/golden/`. `npm run ci:fast` passes with no golden regenerated, `geometryHash` included. `npm run content:check` passes. `tests/content/creakZones.test.ts` passes unchanged on both rooms.
3. **The naming conventions hold.** Both rooms go through `npm run assets:export -- <id>`, `assets:extract -- <id>` and `assets:optimize -- <id>` with no problem reported, and `tests/architecture/blenderConventions.test.ts` passes unchanged.
4. **The look follows the art direction.** Both rooms are low poly, round and exaggerated, in a bright limited palette, and read at a glance from the fixed isometric camera at 844 × 390 and 667 × 375. Every piece of furniture of the room inventory (D7) is recognisable on those screenshots without its marker.
5. **Gameplay colours stay reserved.** No room material sits on the hues of `parry`, `dodge` or `alert`, and the floor of each room keeps a contrast of at least 3:1 against `ink`, so that the sound waves stay visible (D3). Both are pinned by a guard test that fails on a fixture.
6. **The gameplay reads as before.** Tops of furniture match their collider, so props rest on them with no gap or overlap; every object and threat anchor still sits on its visual (D2); no decoration reveals a `ZONE_creak_*` board (D5); nothing new hides the walkable floor from the camera (D4).
7. **The performance budget holds.** `perf.spec.ts` passes on the salon (default) and on `PP_PERF_LEVEL=chambre_night`, both on the built playtest: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles. Each room alone stays within `ROOM_DRAW_CALLS_MAX` and `ROOM_TRIANGLES_MAX` (D6), pinned by the guard test. `npm run dist:check -- --flavor playtest` passes, including each level's ≤ 3 MiB payload.
8. **The bots still play.** `npm run sim` with `perfect`, `human`, `random` and `idle` on both levels gives the same results as on `main`, which follows from AC 1 and is checked once on seed 1. `/?autoplay=human&seed=1&speed=4` and the same with `&level=chambre_night` play in the browser with no `warn` on the `assets` channel.
9. **Geo has seen it.** Screenshots of both rooms are in the story's completion notes, the frozen macOS references are regenerated on purpose and looked at, and the merge waits for Geo's visual OK.

## Tasks / Subtasks

- [ ] **T0. Spike one multi-material piece through the whole pipeline** (AC 3, D3)
  - [ ] Read the trap under « Blender access » first. Work headless, on the worktree's files.
  - [ ] In a copy under the scratchpad: give `sofa` two material slots and a bevel, and give `PROP_mug_01` two slots. Export, extract, optimise, load the room in the browser.
  - [ ] Check: geometry unchanged, two toon colours on the sofa, the prop drawn by its pool with two colours and no `malformed gameplay node` or `no PROP_` warning, `levelScene.test.ts` unaffected. `gltfpack` may put a node's mesh on a child, and three splits a multi-primitive mesh into child meshes named after the **mesh data**.
  - [ ] If a multi-material prop fails, props stay single-colour in this story and it is noted. Do not change `levelScene.ts` or `levelNodeNames.ts` for it without asking Geo.
  - [ ] Record the result in the completion notes.
- [ ] **T1. Guard test** (AC 5, AC 7), before any modelling
  - [ ] Add `ROOM_DRAW_CALLS_MAX = 40` and `ROOM_TRIANGLES_MAX = 20_000` to `src/shared/constants.ts`, next to `DRAW_CALLS_MAX`, with a comment saying what they reserve (D6).
  - [ ] Put pure helpers in `tools/assets/roomArt.ts` and test them with fixtures in `tests/tools/assets/roomArt.test.ts`: `roomBudgetOf(json)`, `reservedHueProblems(json)`, `floorContrastProblem(json)`. Each failing rule has a failing fixture, as `layerBoundaries.test.ts` does.
  - [ ] Extend `tests/architecture/levelAssets.test.ts` with the three rules on both committed `.glb` files. It reads the JSON chunk only (`parseGlb`), so CI needs no Blender.
  - [ ] Run it on the greyboxes. If a greybox fails a rule, fix the rule's reading or say so; do not loosen a threshold to pass.
- [ ] **T2. Model the salon** (AC 1, 4, 6)
  - [ ] Visual nodes per D7, rules D2 to D5. Run the pipeline often and check the geometry diff at each export.
  - [ ] `PROP_mug_01` and `PROP_vase_01`: new mesh, same world box to the millimetre.
  - [ ] Look at it in the browser at both sizes through the autoplay, not in a Blender render (GDD: the modelling tool's render does not carry over).
- [ ] **T3. Model the bedroom** (AC 1, 4, 6)
  - [ ] Same rules. Night comes from the palette only (D8).
- [ ] **T4. Prove nothing moved** (AC 1, 2, 3, 8)
  - [ ] The `git diff --exit-code` of AC 1; `git status` shows no change under `src/sim`, `src/bots`, `content/`, `tests/golden/`.
  - [ ] `npm run ci:fast`. A moved golden or geometry is a bug in the room: fix the room.
  - [ ] `npm run sim -- --level <id> --bot <b> --seed 1 --out <scratchpad file>` for the four bots on both levels, on the branch and on `main`, and compare the reports.
  - [ ] `npx playwright test tests/e2e/level.spec.ts --project=chromium`: the room draws within budget and a restart costs the same.
- [ ] **T5. Performance** (AC 7), run under `caffeinate`, one at a time
  - [ ] `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`.
  - [ ] `npx playwright test -c playwright.dist.config.ts --project perf --workers=1`, then the same with `PP_PERF_LEVEL=chambre_night`. About 5 minutes each. Write both results in the story.
- [ ] **T6. References and visual delivery** (AC 9)
  - [ ] `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` (macOS only, deliberate). Look at both images and say so. No Linux reference, no Docker.
  - [ ] Check `env | grep VITE_` first; if `VITE_DEBUG_ALLOWED` is set, wrap dev and e2e commands in `(unset VITE_DEBUG_ALLOWED; …)`.
  - [ ] Screenshots of both rooms at 844 × 390 and 667 × 375, with a threat up and a sound wave on the floor. Say what you checked by eye and what only Geo can judge (the charm is his call).
- [ ] **T7. Close the deferred items** (see Dev Notes › Deferred items)
  - [ ] Mark them in `deferred-work.md` with what was done, and add a section for this story.
  - [ ] Add one paragraph to `_bmad-output/project-context.md` on the frozen-layout rule and the room budgets.

## Dev Notes

### Blender access: read this first

**The live Blender MCP session is on the wrong file.** On 2026-11-01 it was attached to the **main checkout**, `/Users/geoffroychampetier/Development/papa-parade/assets-src/blender/salon_crawler.blend`, with `is_dirty: true` and 37 objects. It looks older than the committed room: it has no `playpen`, no `ZONE_safe_playpen`, no `ZONE_creak_*`, no `PROP_vase_01` and no `toilet_door`.

- **Never save, reload or open another file in that session.** Geo may have unsaved work in it.
- **Never run `export_level.py` there.** `repo_root()` derives from `bpy.data.filepath`, so it would write `public/assets/levels/salon_crawler.glb` in the main checkout, from a stale scene.
- **Work headless, in the worktree:** `/Applications/Blender.app/Contents/MacOS/Blender -b <worktree>/assets-src/blender/<id>.blend -P <scratchpad script>`, then save with `bpy.ops.wm.save_mainfile()`. Blender 5.2.3 LTS is installed and `npm run assets:export` already takes that route (`findBlender`). Story 4.10 built the bedroom this way.
- **Use the MCP only** if Geo confirms the session can be switched, and then only after `bpy.data.filepath` shows the worktree's file. Its docs tools (`search_api_docs`, `get_python_api_docs`) are safe at any time.
- Run Python only on the project's `.blend` files; never open a third-party one (architecture › security).

**Commit each `.blend` once, at the end**, not at every iteration: they are binary and stay in the history. Purge orphan data before saving, and pack no image. Two stories touching a `.blend` cannot merge: stop and ask Geo.

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The geometry files stay byte-identical, bounds included.** The union of the visual boxes must remain: salon `[-4.2, -0.8, -3.2]` to `[4.9, 2.5, 3]`, bedroom `[-3.2, -0.1, -2.7]` to `[3.2, 2.5, 2.5]`. Keep the current nodes that set each extreme, or make new ones reach exactly the same values. If a design truly needs other bounds, stop and ask Geo. | `boundsMinM` / `boundsMaxM` are computed from **visual** nodes and read by the sim: `rapierPhysics.ts` builds the room's walls and ceiling from them. A chair leg past a wall changes the physics, `geometryHash` and every golden of that level, and `roomOf` moves the camera, so also every marker. This is the one way a purely visual edit breaks the sim. |
| D2 | **Gameplay nodes are not touched:** `COL_*`, `NAV_*`, `ANCHOR_*`, `ZONE_*` keep their transforms and meshes. A visual fits **inside its collider's box**, and a surface something rests on matches the collider's top within 5 mm: coffee table 0.45, side table 0.6, counter 0.9, bedroom nightstand 0.6. A `PROP_*` keeps its node name and its exact world box (mug half extents 0.05, vase 0.08 × 0.15 × 0.08), reaching each face of it. Anchored visuals stay on their anchor: `coffee_machine`, `phone`, `outlet_plate`, `door_frame`, `toilet_door`, the stairs. **A new piece has no collider and no `NAV_block_`, so it never stands on a walkable cell:** it hangs on a wall, sits on furniture or is painted in the floor (D5). | The extractor takes a prop's box from its mesh, and the sim's rigid body from that. A top lower than the collider makes the mug float; a footprint wider than the collider, or a new floor-standing piece, lets Papa walk through it, since he walks the grid. Markers are placed from anchors. |
| D3 | **Colour is one Blender material per colour, base colour only.** No vertex colours, no textures, no transparency, no emissive, no second UV. At most 12 materials per room, shared between objects. **Reserved:** no material within 15° of hue of `parry` `#1F6BFF`, `dodge` `#F0353D` or `alert` `#FFC21A` while saturation and value are both ≥ 0.6 (HSV of the sRGB value; glTF stores linear, so convert; a material with no `baseColorFactor` is white). **Floor:** every material on node `floor` has a contrast of at least 3:1 against `ink` `#2A2140`. Also keep walls and floor apart from `primary` `#6D3FE0` (Papa) and white (the baby). | `createLevelScene` keeps only `material.color` and swaps in a shared toon material, so a `MeshToonMaterial` without `vertexColors` would ignore vertex colours silently, and the deferred note says emissive and opacity are lost. The export already has `export_texcoords=False` and `export_image_format="NONE"`, and the CSP has no `blob:`. The GDD reserves the alert hue for dangers, blue for parry, red for dodge. The sound waves are drawn in `PALETTE.ink` on the floor (`createSoundWaves(content, PALETTE.ink)`), and they are the visual twin of sound, pillar 3. A shared 256 px palette texture would also fit the architecture but needs code; it is not needed here. |
| D4 | **The camera keeps its view.** It looks from the +X +Z side (yaw 45°, pitch 35.264°). No decoration taller than 0.3 m on the +X or +Z half of the room's open floor; the greybox's tall pieces stay in place at their height. Walls stay on the back and side only. The sofa's top stays 0.9. | Occlusion is gameplay: a new tall piece hides threats and Papa, and `ZONE_hidden_behind_sofa` depends on the sofa's height being what it is. |
| D5 | **Floor decoration is painted in the floor mesh, at y = 0, with no thickness.** Rugs and planks are faces of `floor` with their own material slot. No planks or pattern may single out a `ZONE_creak_*` board: if the floor has planks, they are uniform over the whole floor. | Blob shadows float at 4 mm (`BLOB_LIFT_M`) and rings at 6 mm (`SOUND_WAVE_LIFT_M`), so a 1 cm rug would swallow them. The boards are to be memorised (GDD L307; story 4.9 put no marker on them), so a visible board would remove the game. Hit-tests use the plane y = 0 (`hitTest.ts`), so meshes do not affect them. |
| D6 | **Each room: ≤ 40 draw calls and ≤ 20,000 triangles** (`ROOM_DRAW_CALLS_MAX`, `ROOM_TRIANGLES_MAX`), counted from the `.glb` JSON: one draw call per primitive and `indices.count / 3` triangles per primitive, over every drawn node (visual and `PROP_*`, whole subtree; not `COL_`, `NAV_`, `ZONE_`, `ANCHOR_`). One object = one draw call **per material it uses**. Join small details into their furniture; if over 40, join by material. | The bedroom's whole frame was 35 draw calls and 1,748 triangles at 4.10. 7.2 adds rigged characters and 7.3 adds outlines, which double what they cover. `GLTFPACK_FLAGS` has `-kn`, which keeps every named node apart, so **nothing merges for you**: « static furniture merged at export » has to be done in Blender. |
| D7 | **Room inventory** (below): the existing pieces get final models, and a few additions give the charm. Names stay lower_snake_case, mesh data named after its object and never with a gameplay-looking prefix. Nothing in `src/` refers to a visual node by name, so visual nodes may be renamed or joined. | Three names a split mesh's children after the mesh data; a child named like `PROP_mug_01_1` or `col_x` trips `isHiddenInGame`. |
| D8 | **Night comes from the palette only.** `chambre_night` uses cooler, muted colours, a moon in a window, within D3's floor contrast. No per-level light. | `AMBIENT_INTENSITY` and `SUN_INTENSITY` are shared code constants, and lights belong to 7.3. This answers open point 9 of story 4.9 as far as this story can. |
| D9 | **Keep the Blender workflow manual.** Scripts stay in the scratchpad; the `.blend` is the source, as since 1.6. No generator is committed. The later rooms of Epics 5 and 6 follow this story's rules when they are built. | Geo edits the rooms in Blender and reruns the three commands. A generator would drift the moment he does. |

### Room inventory

Keep each anchor's piece where it is. The additions are suggestions: drop any that does not read at phone size.

**`salon_crawler`** (bounds in D1). Colliders: `sofa` centre (0.5, -1.75) half (1.1, 0.45); `coffee_table` (0.5, -0.6) half (0.6, 0.3); `side_table` (-1.3, -1.2) half 0.25; `counter` (-3.6, -1.8) half (0.4, 0.8); `stairs` (3.7, -1.25) half (0.3, 0.75); walls back and side.
- Existing: `floor`, `wall_back`, `wall_side`, `sofa`, `coffee_table`, `side_table`, `phone`, `counter`, `coffee_machine`, `door_frame`, `toilet_door`, `outlet_plate`, `playpen`, `stairs_step_1..3`, `PROP_mug_01`, `PROP_vase_01`.
- `toilet_door` becomes a real door, in a colour that differs from the wall, with its pictogram or handle (deferred from 4.3).
- `playpen` reads as a playpen: bars, round corners. It covers `ZONE_safe_playpen`, centre (-2, 1.6), half 0.7. It has no collider, so Papa and the baby walk into it: keep its bars low and the inside visible.
- Additions: a wall lamp, or a lamp on the counter's free end, since « the lamp goes out » is the outlet's gag (mesh only; the lights stay as they are; not on the floor, see D2); a rug painted in the floor; a framed picture and a window on the back wall; baseboards; a cushion on the sofa.

**`chambre_night`** (bounds in D1). Colliders: `bed` (-0.2, -1.7) half 0.8; `nightstand` (-1.3, -2.15) half 0.25; `wardrobe` (2.65, -0.4) half (0.35, 0.7), height 2; walls back and side.
- Existing: `floor`, `wall_back`, `wall_side`, `bed`, `pillow`, `nightstand`, `wardrobe`, `crib`, `door_frame`, `toilet_door`, `outlet_plate`, `PROP_mug_01`.
- `crib` reads as a crib, and the baby is laid at `feedback.json › bombDrop.laidHeightM` over `ZONE_safe_crib`, centre (-1.8, 1.4), half 0.7. No collider: same remark as the playpen.
- `PROP_mug_01` sits on the middle of the nightstand; a lamp there goes in a corner of its 0.5 m top and must not touch the mug's box.
- Additions: a moon window on the back wall, a mobile over the crib (below 2.5 m), a rug painted in the floor, baseboards, a duvet fold on the bed.

### Modelling hints

- **Round without many faces:** a bevel modifier with 1 or 2 segments, smooth shading on curved parts, exaggerated proportions. `export_apply=True` applies modifiers at export, and a bevel does not grow the box. Check box-defining nodes anyway.
- **Keep meshes closed with outward normals** and no hidden internal faces (joined bits are fine). The inverted-hull outlines of 7.3 will need it.
- Visuals may have any rotation or scale: the extractor is strict only on gameplay nodes. Apply scales anyway.
- Materials from the greybox are named after tokens (`cream`, `ink_soft`, `fridge`…). Reusing or adding is fine; names do not reach the game.

### What exists, and what must keep working

- **`tools/blender/export_level.py`**, **`tools/assets/{exportLevel,extractLevelGeometry,optimizeGlb,glb,paths}.ts`**: complete pipeline, order `export → extract → optimize`, all on the same `public/assets/levels/<id>.glb`. `extract` refuses an optimised file, so always re-export first. **No change expected.** Do not reinvent any of it.
- **`src/client/render/levelScene.ts`**: removes non-visual nodes, swaps each mesh's material for a toon one by colour, takes `PROP_*` as templates of pooled views, adds blob shadows from `geometry.colliders`. **No change expected.** It handles multi-primitive meshes because `traverse` reaches each child mesh; T0 proves it.
- **`src/client/render/blobShadow.ts`**: blobs follow colliders, which do not move. Leave `BLOB_MAX_TOP_M` alone.
- **`src/client/render/views/propView.ts`**: a prop clones its template, squashes it around the box from the geometry. It works on a group as well as a mesh.
- **`tests/architecture/levelAssets.test.ts`**: `holdsMesh` already handles gltfpack moving a mesh to a child. Reuse that walk.
- **`tests/e2e/level.spec.ts`**: pins `DRAW_CALLS_MAX`, `TRIANGLES_MAX` and equal counts after a restart.
- **Must not change:** every file of `src/sim`, `src/bots`, `content/`, `tests/golden/`, `tools/assets/*`, `tools/blender/export_level.py`, `src/content/levelNodeNames.ts`, `public/_headers`.

**Expected changes:** `assets-src/blender/{salon_crawler,chambre_night}.blend`, `public/assets/levels/{salon_crawler,chambre_night}.glb`, `src/shared/constants.ts`, `tools/assets/roomArt.ts`, `tests/tools/assets/roomArt.test.ts`, `tests/architecture/levelAssets.test.ts`, the two darwin screenshot references, `deferred-work.md`, `project-context.md`.

### Deferred items

Close these in `deferred-work.md`, each with what happened:
- « The toilet door is a flat greybox slab » (4.3): drawn here.
- « Open point 9, the room has no night look » (4.9): partly, by palette; lights go to 7.3.
- « A real lamp in the room » (1.11): the mesh only; the light stays global, and its gag animation stays deferred.
- « The toon swap keeps only `color` » (1.6): still true, and D3 lives within it. 7.3 owns it.
- « Blob shadow eligibility is a height heuristic » (1.6): unchanged, since colliders are frozen. Hand it to 7.3.
- « No drift check between the `.blend` / raw export and the committed geometry » (1.6): AC 1's diff covers this story; the general check stays open.
- « Collision, navigation, zone and anchor nodes still ship in the `.glb` »: stays open, and the room's size does not make it urgent.

### Testing

- **Unit:** `tests/tools/assets/roomArt.test.ts`, fixtures only, one failing fixture per rule, including a material with no `baseColorFactor`, a linear value on the edge of a threshold and a mesh under a child node.
- **Architecture:** three new rules per committed level.
- **E2E:** `level.spec.ts` and `autoplay.spec.ts` on Chromium while developing. The screenshot assertion runs on macOS only.
- **Before the merge:** one `npm run ci:story`, after the review. **`npm run ci` is not needed** unless this merge completes Epic 7's stories, and T5 covers the perf this story's AC asks for.
- Golden tests are expected to pass **with no regeneration**. Running `npm run golden:update` here is a mistake.

### Project Structure Notes

- Paths follow the architecture: `assets-src/blender/`, `public/assets/levels/`, `tools/assets/`.
- **Variance:** the architecture names `tools/blender/export.py` in one place and `export_level.py` in the tree; `export_level.py` is the real file.
- **Variance:** the architecture also lists collections `level`, `colliders`, `nav`, `anchors`, `props`. The committed scene keeps gameplay nodes in them with a few exceptions (`ZONE_hidden_behind_sofa` sits in `anchors` in the stale session). The extractor reads names, not collections; do not reorganise.
- `tools/assets/roomArt.ts` is a new tool module with a test in `tests/tools/assets/`, since `vitest.config.ts` only includes `src/**` and `tests/**`.

### Project Context Rules

- **Layers:** `src/` never imports `tools/`. `tests/architecture` may import both, as it does already.
- **Golden rule:** the AI writes and tests; Geo plays and judges. Thresholds of the guard are named constants, not inline numbers. The guard test reads the `parry`, `dodge`, `alert` and `ink` values through the existing DESIGN.md reader, `tests/architecture/designTokens.ts`, instead of retyping them; `roomArt.ts` takes them as arguments, since a tool does not import a test helper.
- **Files:** `camelCase.ts`, factories `create<Name>`, constants `UPPER_SNAKE` in `shared/constants.ts`, suffix units (`…M`, `…Pct`). Import `describe/it/expect` from `vitest`. No `console.*` in tools outside `@shared/log`.
- **Rendering budgets:** ≤ 100 draw calls, ≤ 100k triangles, no texture > 1024 px, blob shadows only, no shadow map, level payload ≤ 3 MB.
- **Blender nodes:** `COL_<name>`, `NAV_floor`, `NAV_block_<name>`, `ANCHOR_<id>`, `PROP_<kind>_<nn>`, `ZONE_hidden_|safe_|creak_<name>`; visual meshes unprefixed; lower_snake_case; metres, Y up. A `.001` suffix is refused: rename what Blender duplicates.
- **Git:** this worktree, branch `story/7-1-pieces-modelisees-dans-blender`. Commit « Story 7.1 : <titre> ». Merge only after the review, a green `ci:story` and Geo's OK.
- **Shared machine:** wrap long runs in `caffeinate`; a 30 s timeout failing after minutes means the Mac slept. Run the perf spec alone.

### Previous story intelligence

- **4.10 built `chambre_night` headless** with a throwaway script from the salon's `.blend`; `/Applications/Blender.app` works with `-b -P`. It measured the bedroom by hand with `PP_PERF_LEVEL=chambre_night`: p95 16.8 ms, 35 draw calls, 1,748 triangles, payload 853.4 KiB, of which the `.glb` is 17.5 KiB.
- **4.9 and 4.10 moved creak boards twice**, because `creakZones.test.ts` proves the routes on the live geometry. This story must not need that: boards are frozen.
- **1.6 said what to report:** « never claim a visual check you did not make ». It found the blobs mostly hidden by furniture and the toon bands subtle on a pale floor. Expect similar, and report it for 7.3 rather than touching code.
- **4.3's** open remark: at 844 × 390 the outlet's verb can sit over the toilet's marker. Markers are not in scope; do not move anchors for it.
- **Recent commits** are all story 4.x and touch no art, so nothing conflicts with the `.blend` files today. Other agents may be running: check `git worktree list` if a `.blend` merge is near.

### Latest technical information

No new dependency. The stack is pinned (`three@0.186.1`, `gltfpack@1.3.0`, Blender 5.2.3 LTS), and the export script already runs on that Blender, so no web research was needed. The points that depend on behaviour of these tools (mesh moved to a child by `gltfpack -kn`, primitive children named by three's `GLTFLoader`) are proved by T0 rather than assumed.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Direction artistique et audio, #Besoins en assets, L307]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Gestion des assets, #Assets de jeu, ADR-009, security notes on Blender MCP, budgets table]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md#colors]
- [Source: _bmad-output/project-context.md#Performance Rules, #Naming conventions, #Platform & Build Rules]
- [Source: _bmad-output/implementation-artifacts/1-6-salon-greybox-depuis-blender.md, 4-9-sortie-en-infiltration-reponse-ne-rien-faire.md, 4-10-niveau-chambre-de-nuit-et-playtest-du-deuxieme-prototype.md, deferred-work.md]
- [Source: tools/blender/export_level.py, tools/assets/*, src/client/render/levelScene.ts, src/client/render/blobShadow.ts, src/client/render/vfx/soundWaves.ts, src/client/render/views/propView.ts, src/client/input/hitTest.ts, src/sim/physics/rapierPhysics.ts, tests/architecture/levelAssets.test.ts]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
