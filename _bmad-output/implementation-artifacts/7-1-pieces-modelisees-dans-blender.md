---
baseline_commit: 89938978684add5a1ad50dd2253a8f764ee4f1ac
---

# Story 7.1: Pièces modélisées dans Blender

Status: done

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

- [x] **T0. Spike one multi-material piece through the whole pipeline** (AC 3, D3)
  - [x] Read the trap under « Blender access » first. Work headless, on the worktree's files.
  - [x] In a copy under the scratchpad: give `sofa` two material slots and a bevel, and give `PROP_mug_01` two slots. Export, extract, optimise, load the room in the browser.
  - [x] Check: geometry unchanged, two toon colours on the sofa, the prop drawn by its pool with two colours and no `malformed gameplay node` or `no PROP_` warning, `levelScene.test.ts` unaffected. `gltfpack` may put a node's mesh on a child, and three splits a multi-primitive mesh into child meshes named after the **mesh data**.
  - [x] If a multi-material prop fails, props stay single-colour in this story and it is noted. Do not change `levelScene.ts` or `levelNodeNames.ts` for it without asking Geo.
  - [x] Record the result in the completion notes.
- [x] **T1. Guard test** (AC 5, AC 7), before any modelling
  - [x] Add `ROOM_DRAW_CALLS_MAX = 40` and `ROOM_TRIANGLES_MAX = 20_000` to `src/shared/constants.ts`, next to `DRAW_CALLS_MAX`, with a comment saying what they reserve (D6).
  - [x] Put pure helpers in `tools/assets/roomArt.ts` and test them with fixtures in `tests/tools/assets/roomArt.test.ts`: `roomBudgetOf(json)`, `reservedHueProblems(json)`, `floorContrastProblem(json)`. Each failing rule has a failing fixture, as `layerBoundaries.test.ts` does.
  - [x] Extend `tests/architecture/levelAssets.test.ts` with the three rules on both committed `.glb` files. It reads the JSON chunk only (`parseGlb`), so CI needs no Blender.
  - [x] Run it on the greyboxes. If a greybox fails a rule, fix the rule's reading or say so; do not loosen a threshold to pass.
- [x] **T2. Model the salon** (AC 1, 4, 6)
  - [x] Visual nodes per D7, rules D2 to D5. Run the pipeline often and check the geometry diff at each export.
  - [x] `PROP_mug_01` and `PROP_vase_01`: new mesh, same world box to the millimetre.
  - [x] Look at it in the browser at both sizes through the autoplay, not in a Blender render (GDD: the modelling tool's render does not carry over).
- [x] **T3. Model the bedroom** (AC 1, 4, 6)
  - [x] Same rules. Night comes from the palette only (D8).
- [x] **T4. Prove nothing moved** (AC 1, 2, 3, 8)
  - [x] The `git diff --exit-code` of AC 1; `git status` shows no change under `src/sim`, `src/bots`, `content/`, `tests/golden/`.
  - [x] `npm run ci:fast`. A moved golden or geometry is a bug in the room: fix the room.
  - [x] `npm run sim -- --level <id> --bot <b> --seed 1 --out <scratchpad file>` for the four bots on both levels, on the branch and on `main`, and compare the reports.
  - [x] `npx playwright test tests/e2e/level.spec.ts --project=chromium`: the room draws within budget and a restart costs the same.
- [x] **T5. Performance** (AC 7), run under `caffeinate`, one at a time
  - [x] `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`.
  - [x] `npx playwright test -c playwright.dist.config.ts --project perf --workers=1`, then the same with `PP_PERF_LEVEL=chambre_night`. About 5 minutes each. Write both results in the story.
- [x] **T6. References and visual delivery** (AC 9)
  - [x] `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` (macOS only, deliberate). Look at both images and say so. No Linux reference, no Docker.
  - [x] Check `env | grep VITE_` first; if `VITE_DEBUG_ALLOWED` is set, wrap dev and e2e commands in `(unset VITE_DEBUG_ALLOWED; …)`.
  - [x] Screenshots of both rooms at 844 × 390 and 667 × 375, with a threat up and a sound wave on the floor. Say what you checked by eye and what only Geo can judge (the charm is his call).
- [x] **T7. Close the deferred items** (see Dev Notes › Deferred items)
  - [x] Mark them in `deferred-work.md` with what was done, and add a section for this story.
  - [x] Add one paragraph to `_bmad-output/project-context.md` on the frozen-layout rule and the room budgets.

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

Claude Opus 5.5 (`claude-opus-5-5`)

### Debug Log References

- All Blender work ran headless on the worktree's files (Blender 5.2.3). The live MCP session was neither used nor touched.
- The throwaway build scripts stayed in the scratchpad (D9). Each build started from a copy of the committed greybox, so the `.blend` was saved fresh each time and is committed once.

### Completion Notes List

**T0, spike: multi-material works, props included.** A two-material bevelled `sofa` and a two-material `PROP_mug_01` went through export, extract and optimise. The geometry was unchanged, both drew two toon colours in the browser, and there was no `malformed gameplay node` or `no PROP_` warning. `gltfpack -kn` keeps the named node and puts a single unnamed child under it, holding one mesh with one primitive per material, so props stay multi-colour. No change to `levelScene.ts` or `levelNodeNames.ts`. The prop's mesh data is named `mug` / `vase`, never `PROP_…` (D7).

**Measured results**

| AC | Check | `salon_crawler` | `chambre_night` |
|---|---|---|---|
| 1 | `git diff --exit-code main` on the geometry | identical | identical |
| 7 | Room alone (limit 40 draw calls, 20,000 triangles) | 39 / 4,924 | 37 / 4,144 |
| 7 | `perf.spec.ts`, p95 frame (limit 20 ms) | 16.7 ms | 16.7 ms |
| 7 | `perf.spec.ts`, max draw calls (limit 100) | 63 | 59 |
| 7 | `perf.spec.ts`, max triangles (limit 100k) | 6,214 | 5,700 |
| D3 | Materials (limit 12) | 12 | 11 |
| 7 | `.glb` size | 58.9 KB | 49.4 KB |

- **AC 7, rerun on the final build in the review (2026-11-01):** the salon's first perf run came before the last edit (two cushions turned into ellipsoids). After a fresh `build:playtest` and `dist:check --flavor playtest` (OK, level payload 886.6 KiB), `perf.spec.ts` on the salon gives 17,098 frames, p95 16.8 ms, 63 draw calls at most, 6,198 triangles at most: all within the budgets (the table's 16.7 ms and 6,214 are the earlier run). The « 16 triangles » I wrote for that edit was wrong: it is gltfpack's effect on `door_frame` (280 raw, 264 shipped), the same in both rooms.
- **AC 2:** `git diff --stat main` is empty on `src/sim`, `src/bots`, `content/`, `tests/golden/`, `export_level.py`, the export, extract and optimise tools, `levelNodeNames.ts` and `public/_headers`. `npm run ci:fast` passes (7476 tests, 3 skipped), with no golden regenerated. Biome's 2 warnings are in `ui.css`, which this story does not touch.
- **AC 3:** both rooms pass `assets:export`, `assets:extract` and `assets:optimize`; `blenderConventions.test.ts` passes unchanged.
- **AC 5:** the three guard rules are in `tests/architecture/levelAssets.test.ts` and pass on both rooms. They passed on the greyboxes too, with no threshold moved. `tests/tools/assets/roomArt.test.ts` has a failing fixture for each rule.
- **AC 6:** read from the final `.blend`: sofa top 0.9, coffee table 0.45, side table 0.6, counter 0.9, bed 0.5, nightstand 0.6, exact to the millimetre, and each footprint equals its collider's. The two lamps rise above their collider's top (counter, nightstand), as the room inventory asks; the surfaces stay at collider height. The prop boxes are proved by the identical geometry. Rug edges and plank lines coincide with no `ZONE_creak_*` edge. Playpen and crib stop at 0.3 m (D4).
- **AC 8:** the four bots on both levels, seed 1, give reports identical to `main` (`diff -r` empty; run before the cushion edit, which touches no gameplay data). `?autoplay=human&seed=1&speed=4`, with and without `&level=chambre_night`, played at both sizes with no `assets` warning. The only warning in that run was one `[sim] frame stall` under load, in the bedroom at 844 × 390. The logs of the final retake of the screenshots were deleted unread. **Rechecked in the review on the final built playtest** (`serve:dist`, `?autoplay=human&seed=1&speed=4`, 30 s per room and size, console read): no `assets` warning, no `malformed gameplay node`, no `no PROP_`, in the four runs. The only game warnings were a few `[sim] frame stall` (70 to 200 ms of backlog dropped, software GL under load) and the refused `navigator.vibrate` before any tap.
- **AC 9, references:** `autoplay-frozen-{chromium,webkit}-darwin.png` were regenerated on purpose and looked at: both show the new salon, the threat and its verb. `level.spec.ts` and `autoplay.spec.ts` pass on Chromium against them, and `autoplay.spec.ts` passed on WebKit while regenerating.

**Screenshots** (in `_bmad-output/implementation-artifacts/7-1-screenshots/`): `7-1-<level>-<size>-play.png` (mid-game with the `human` bot) and `-wave.png` (frozen on the first gag of the `idle` bot; **no ring is visible on the floor in any of the four**, see the review), for both rooms at 844 × 390 and 667 × 375.

**What I checked by eye:** every piece of the inventory reads at 844 × 390, and the screenshots at 667 × 375 show the same rooms closer. Papa, the baby and the threat markers stand out in both rooms. I did not see a sound wave in the `-wave.png` frames (corrected in the review): the wave on the floor, in either room, is for Geo to judge in play. The floor passes the 3:1 rule by the numbers only.

**What I could not settle, for Geo:**
- The charm and the palette: that is Geo's call, in play. The room colours render about 20 % darker than their material values, because of the shared lights, so « bright » is what 7.3's lights will settle.
- In the bedroom's wave frame the gag has the lights down, so the ring is hard to read there. The floor passes 3:1 by the numbers, but I did not capture a wave on the night floor with the lights on.
- The phone, the outlet and the mug are small at phone size: they are recognisable by shape and colour only when looked for. Their boxes are frozen, and their markers carry them in play.
- The wardrobe's doors face +X, towards the camera, not into the room: a cheat so that it reads as a wardrobe from the fixed view.
- A mobile hangs over the crib at about 2 m, above Papa's 0.9 m + 0.35 m hair, from the side wall. It is the one addition that sits over the +Z half (D4), and it projects onto the wall, not onto the crib. It is the first to drop if it bothers.

**For 7.3:** `COL_stairs` has no visual, as in the greybox, so its blob shadow shows as a lone smudge on the floor near the stairs. It is the deferred blob heuristic; I reported it and did not touch the code.

**Merged nodes (D7):** `wall_side` is joined into `wall_back`, and `stairs_step_1..3` into `stairs`, to stay within the budget. New visual node: `crib_mobile`.

### File List

- `_bmad-output/implementation-artifacts/7-1-pieces-modelisees-dans-blender.md`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-salon_crawler-844x390-play.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-salon_crawler-844x390-wave.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-salon_crawler-667x375-play.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-salon_crawler-667x375-wave.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-chambre_night-844x390-play.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-chambre_night-844x390-wave.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-chambre_night-667x375-play.png`
- `_bmad-output/implementation-artifacts/7-1-screenshots/7-1-chambre_night-667x375-wave.png`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/project-context.md`
- `assets-src/blender/salon_crawler.blend`
- `assets-src/blender/chambre_night.blend`
- `public/assets/levels/salon_crawler.glb`
- `public/assets/levels/chambre_night.glb`
- `src/shared/constants.ts`
- `tests/architecture/levelAssets.test.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-chromium-darwin.png`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-webkit-darwin.png`
- `tests/tools/assets/roomArt.test.ts`
- `tools/assets/roomArt.ts`

### Change Log

- 2026-11-01: Final models for `salon_crawler` and `chambre_night` on the frozen layout, with the room budgets and the colour guard test. Status set to review.

### Review Findings

Code review of 2026-11-01 (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Geometry byte-identical (re-exported from the committed `.blend` files and re-extracted: same file), budgets 39 / 4,924 and 37 / 4,144, materials 12 and 11, no texture / emissive / vertex colour / alpha in either `.glb`: all re-derived and conforming.

- [x] [Review][Decision] The `-wave.png` screenshots show no sound wave — the completion notes said « The wave shows clearly on the salon's planks » and that the frames show « its sound wave »; in the salon frames (844 × 390 and 667 × 375) and in the bedroom frames no ring is visible (AC 9 / T6). **Resolved (a):** the notes are corrected; the wave on the floor is for Geo to judge in play. Recapturing without a way to catch the ring costs more than it gives.
- [x] [Review][Decision] **Resolved, leave it (b), for Geo's play check.** The playpen's floor patch ends at x = -1.40, 5 cm from the edge of `ZONE_creak_board_01` (x = -1.35, z 1.0 to 1.45), and the central rug crosses boards 02 and 03 but not board 01 (D5 / AC 6) — nothing coincides within 1 cm, but 5 cm is about one pixel at phone size and reads as one continuous edge. Options: move the patch edge (Blender, geometry stays identical), or leave it and look at it in play.
- [x] [Review][Decision] **Resolved, leave it (c): Geo judges in play, noted in `deferred-work.md`.** « Keep walls and floor apart from `primary` and white » (D3) is pinned by no test — the bedroom planks `art_plank_a/b` (#b3afcf / #a6a2c4) sit at hue 247-248° against `primary` at about 255° (low saturation, 0.15-0.17), and the baby's safe-zone floors `art_butter` (#fce7a8) and `art_moon` (#fff1b8) are near-white (about 1.2:1 against white): only the shading of the sphere separates the baby from them. Options: add a guard with thresholds (to choose), recolour the two safe-zone floors, or leave it and judge in play.
- [x] [Review][Patch] AC 7 and AC 8 rest on runs made before the last edit — the salon's `perf.spec.ts` and the `assets`-warning check ran before the cushion edit, and the final retake's logs were deleted unread. Also the note « that edit lowered the salon by 16 triangles » is wrong: the 16 is gltfpack's effect on `door_frame` (280 raw, 264 shipped), in both rooms. Rebuild the playtest, rerun the salon's perf run and one autoplay per room reading the `assets` channel, and correct the notes [_bmad-output/implementation-artifacts/7-1-pieces-modelisees-dans-blender.md:222]
- [x] [Review][Patch] `roomArt.ts` validates nothing and can pass vacuously — `channelsOf` reads `#RGB`, `rgb(...)` or a bad token as NaN/0, so the hue test and the contrast test return no problem (throw unless `/^#[0-9a-f]{6}$/i`); `roomBudgetOf` double-counts when the scene has no `nodes` (every node a root and a child), counts 0 triangles for a missing accessor, ignores `mode`, and returns a fraction when `count % 3 !== 0` (throw on each); messages print `material "undefined"` for an unnamed material (fall back to the index) [tools/assets/roomArt.ts:94]
- [x] [Review][Patch] D3's own rules are not guarded — « at most 12 materials per room » (the salon sits exactly at 12), no textures or images, no emissive, no `alphaMode` other than opaque, no alpha below 1, no `COLOR_0`, no `TEXCOORD_n`: `project-context.md` states them as rules and nothing enforces them. Add a `roomMaterialProblems` rule with a named constant for the cap, run on both `.glb` files, with a failing fixture each [tools/assets/roomArt.ts, tests/architecture/levelAssets.test.ts:96]
- [x] [Review][Patch] The guard tests are thinner than their titles — no fixture takes `roomBudgetOf` over `ROOM_DRAW_CALLS_MAX` / `ROOM_TRIANGLES_MAX`; none has an unparseable gameplay-looking node name (`COL_` with no suffix) for `looksLikeGameplayNode`, nor a drawn child under a hidden parent, a hue distance of exactly 15°, or a material with alpha; the comment « a hue of 6° is 8° from the dodge red, at 358° » is wrong (6.4° against 357.4°, so 9°), and « a grey of sRGB 111 » is not the fixtures' 112 and 105 [tests/tools/assets/roomArt.test.ts:107]
- [x] [Review][Defer] The floor contrast reads material values, not what is drawn — deferred, lights are 7.3's; the walkable planks pass with a wide margin (the 3.20 of the bedroom's `art_wood` is on the slab's sides), so no wave is lost today
- [x] [Review][Defer] `ROOM_DRAW_CALLS_MAX = 40` assumes the outlines of 7.3 « double what they cover »: the salon plays at 63 with 39 in the room, so doubling the whole room gives 102 — deferred, depends on what 7.3 outlines (characters and props, or furniture too)
- 2026-11-01: Code review. The guards of `roomArt.ts` refuse a malformed colour, a file the budget cannot count exactly and a room that breaks D3's material rules (new `roomMaterialProblems`, `ROOM_MATERIALS_MAX`); the guard tests gain their over-limit and boundary fixtures; the AC 7 and AC 8 checks were rerun on the final build; the notes on the wave screenshots and on the 16 triangles are corrected.
