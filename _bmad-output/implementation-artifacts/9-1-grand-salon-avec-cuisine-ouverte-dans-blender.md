# Story 9.1: Grand salon avec cuisine ouverte dans Blender

Status: ready-for-dev

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want a bigger room with a kitchen corner,
so that the living room is less crowded and Papa has things to do.

**Requirements covered:** FR77 (the room only), NFR15 (epics, Epic 9). **Depends on:** the pipeline of story 1.6, the final-art rules of story 7.1, the lights and outlines of story 7.3, and the v2.3 catch-up (2.11, 2.12, 3.12, 3.13, done).

**Scope:** a **new** room, `salon_kitchen`, modelled in the final style, with its gameplay nodes, a level JSON that plays the salon's existing gameplay in it, the NFR15 budget in `dist:check`, and the tests that pin the room. It is reached with `?level=salon_kitchen`. `salon_crawler` stays the default level and is not touched.

**Not in this story:**
- The follow camera, `level.camera`, `feel.camera`, the hit-test through a moving camera (9.2). Here the camera is the fixed one, which fits the whole room, so the characters look smaller than in the salon. That is expected and is not fixed here.
- The off-screen bubble (9.3).
- Chores, `content/chores/`, `TapObject` on a station, the Maison row (9.4 to 9.6). The stations get their anchors and their furniture here, nothing else.
- The new mischiefs of the GDD's candidate list (9.7, after Geo sorts them). Their places get anchors here; no threat def, no gag, no animation.
- Making `salon_kitchen` the first level of the baby age, its own waves, the 200-game indicators (9.8).

## Acceptance Criteria

1. **The room exists and goes through the pipeline.** Given Blender (pipeline of 1.6, rules of 7.1), when `assets-src/blender/salon_kitchen.blend` goes through `npm run assets:export -- salon_kitchen`, `npm run assets:extract -- salon_kitchen` and `npm run assets:optimize -- salon_kitchen`, then each reports no problem, and `public/assets/levels/salon_kitchen.glb` and `content/levels/salon_kitchen.geometry.json` are committed. `tests/architecture/blenderConventions.test.ts` passes unchanged.
2. **The plan is the GDD's.** The walkable floor (`nav.cols × cellM` by `nav.rowCount × cellM`) measures 13 to 14 m by 6.5 to 7.5 m. It has a living corner (sofa, coffee table, stairs, outlet), a dining corner (a table with a tablecloth) and an open kitchen (a hob, a dishwasher, low cabinets, a bin). Each piece that stands on the floor has its `COL_` and its `NAV_block_` (D5). Pinned by a new `tests/content/salonKitchen.test.ts` on the live geometry.
3. **The anchors are there.** The geometry has the three required anchors (`papa_spawn`, `baby_spawn`, `door`), every anchor, zone and prop id the salon's gameplay uses (D4), and the E9 anchors `stove`, `dishwasher`, `dining_table`, `low_cabinet`, `bin` and `plant`. Each E9 anchor has a walkable nav cell within `feel.input.contextReachM` of its floor point. Pinned by `salonKitchen.test.ts`.
4. **Every anchor the JSON cites exists.** Given `content/levels/salon_kitchen.json` (D7), when `npm run content:check` runs, then it passes: every threat anchor, hidden zone, object anchor and the rush's `spillAnchor` is in `salon_kitchen.geometry.json`. `npm run content:schemas` leaves `content/_schemas/` unchanged (no schema change in this story).
5. **The art rules of 7.1 hold, and the guards pass.** `tests/architecture/levelAssets.test.ts` passes on the new `.glb` with no threshold moved: ≤ `ROOM_DRAW_CALLS_MAX` (40) draw calls, ≤ `ROOM_TRIANGLES_MAX` (20,000) triangles, ≤ `ROOM_MATERIALS_MAX` (12) materials, no reserved hue, the floor at 3:1 against `ink` as authored and as drawn. Visuals sit inside their collider, tops match colliders within 5 mm, props keep their exact boxes, floor decoration is painted at y = 0, no pattern singles out a creak board, no tall piece on the +X / +Z half of the open floor (7.1 D2 to D5).
6. **The render budget holds** (NFR1). `perf.spec.ts` on the built playtest with `PP_PERF_LEVEL=salon_kitchen`: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100,000 triangles. The numbers are in the completion notes.
7. **NFR15 is in `dist:check`.** A level's payload budget is 3 MiB, except `salon_kitchen`: 5 MiB (D6). `tests/tools/build/checkDist.test.ts` has a fixture where the same 4 MiB payload passes for `salon_kitchen` and fails for another level. `npm run dist:check -- --flavor playtest` passes; the payload it prints is in the completion notes.
8. **The bots play the new room.** `npm run sim -- --level salon_kitchen --bot <b> --runs 20` for `perfect`, `human`, `random`, `idle`: every run ends on `LevelEnded`, with no invariant failure, and `perfect` misses nothing (ADR-011 spaces the windows by the level's `glideMaxMs`). `tests/content/creakZones.test.ts` and `tests/content/liveProps.test.ts` pass with a `salon_kitchen` entry. The four reports' headline numbers are in the completion notes.
9. **It plays in the browser.** A new `tests/e2e/salonKitchen.spec.ts` (Chromium while developing): `?level=salon_kitchen` shows the room (`data-pp-level`) within `DRAW_CALLS_MAX` / `TRIANGLES_MAX`; a real tap parries the outlet on the fixed camera; `?autoplay=perfect` reaches the Result with no `warn` on the `assets` channel.
10. **Nothing else moves.** No change under `src/sim`, `src/bots`, `src/client`, `tests/golden/`, and none to `salon_crawler.*`, `chambre_night.*` (`.blend`, `.glb`, `.json`, `.geometry.json`), `DEFAULT_LEVEL_ID`, `export_level.py`, `tools/assets/*`, `levelNodeNames.ts`, `public/_headers`, the darwin screenshot references. `npm run ci:fast` passes with no golden regenerated.
11. **Geo has seen it.** Screenshots of the room at 844 × 390 and 667 × 375 (one mid-game with the `human` bot, one frozen on a threat) are in `_bmad-output/implementation-artifacts/9-1-screenshots/`, with what was checked by eye and what only Geo can judge. The merge waits for Geo's visual OK.

## Tasks / Subtasks

- [ ] **T0. Pre-flight** (all ACs)
  - [ ] Read « Blender access » below. Work headless, on the worktree's files.
  - [ ] `env | grep VITE_`: if `VITE_DEBUG_ALLOWED` is set, wrap `dev` and `e2e` commands in `(unset VITE_DEBUG_ALLOWED; …)`.
  - [ ] `git worktree list`: note any other story that touches `src/shared/constants.ts`, `tools/build/inspectDist.ts`, `creakZones.test.ts` or `liveProps.test.ts` (merge order, not a blocker).
- [ ] **T1. NFR15 in `dist:check`** (AC 7), before any modelling
  - [ ] `src/shared/constants.ts`: next to `LEVEL_PAYLOAD_MAX_BYTES`, add `LEVEL_PAYLOAD_MAX_BYTES_BY_ID: Readonly<Record<string, number>> = { salon_kitchen: 5 * 1024 * 1024 }`, with a comment citing NFR15 and its open assumption (5 MB to confirm with E9's real audio).
  - [ ] `tools/build/inspectDist.ts`: each level's budget is `LEVEL_PAYLOAD_MAX_BYTES_BY_ID[id] ?? LEVEL_PAYLOAD_MAX_BYTES` (`Object.hasOwn`, not a bare lookup); the problem message prints the budget it used. No other rule changes.
  - [ ] `tests/tools/build/checkDist.test.ts`: one fixture with a payload between the two budgets, passing for `salon_kitchen`, failing for `salon_crawler`; one at exactly 5 MiB passing.
- [ ] **T2. Model the room** (AC 1, 2, 3, 5)
  - [ ] Copy `assets-src/blender/salon_crawler.blend` to `assets-src/blender/salon_kitchen.blend` with a scratchpad script (D2). Never edit the salon's file.
  - [ ] Lay out the plan of D3, the nodes of D4 and D5, the art rules of D8. Run the three commands often and read the geometry at each export.
  - [ ] Join static furniture by material to stay within 40 draw calls; keep the pieces of D5 › « moving later » as their own visual nodes.
  - [ ] Look at it in the browser through `?level=salon_kitchen&autoplay=human&seed=1&speed=4` at both sizes, not in a Blender render.
- [ ] **T3. Level JSON** (AC 4, 8)
  - [ ] `content/levels/salon_kitchen.json` per D7. `npm run content:check`.
- [ ] **T4. Tests on the live room** (AC 2, 3, 8)
  - [ ] `tests/content/salonKitchen.test.ts` (D9).
  - [ ] `creakZones.test.ts`: a `salon_kitchen` entry (`safeZone: 'playpen'`, a clean route found with a throwaway A* in the scratchpad, as 4.9 and 4.10 did). If the plain walk from the playpen to the door crosses no board, move a board in Blender, not the test.
  - [ ] `liveProps.test.ts`: a `salon_kitchen` entry (`anchor: 'coffee_table'`, the props that stand on it).
  - [ ] `npm run ci:fast`.
- [ ] **T5. Bots** (AC 8)
  - [ ] `npm run sim -- --level salon_kitchen --bot <b> --runs 20 --out <scratchpad>/<b>.json` for the four bots. A `perfect` miss is a room bug first (an anchor too far from walkable floor, a board on the only path): look at the journal (`--journals`) before anything else. Do not tune waves or `feel.json` here (9.8). If it is not the room, stop and tell Geo.
- [ ] **T6. Browser** (AC 9, 11)
  - [ ] `tests/e2e/salonKitchen.spec.ts`, modelled on `chambreNight.spec.ts` (`startLevel`, `ppLoadLevel`, `threatIconPoint`, `collectProblems`, `OWN_WARNINGS`), three tests. Run `npm run e2e -- tests/e2e/salonKitchen.spec.ts tests/e2e/level.spec.ts tests/e2e/chambreNight.spec.ts --project=chromium` in the background.
  - [ ] Screenshots into `_bmad-output/implementation-artifacts/9-1-screenshots/` (`9-1-salon_kitchen-<size>-play.png`, `-threat.png`). Say what you saw and what you did not.
- [ ] **T7. Performance and payload** (AC 6, 7), one at a time, in the background
  - [ ] `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`.
  - [ ] `PP_PERF_LEVEL=salon_kitchen bash tools/ci/heavyLock.sh npx playwright test -c playwright.dist.config.ts --project perf --workers=1` (about 5 min; through the lock, never a bare `npx playwright test`). Write the numbers in the story.
- [ ] **T8. Docs**
  - [ ] `CLAUDE.md`, row `dist:check`: « each level's `.glb` + audio ≤ 3 MiB (5 MiB for `salon_kitchen`, NFR15) ».
  - [ ] `_bmad-output/project-context.md`: the « Loading » line of Performance Rules gets the NFR15 exception; one short paragraph after « Final rooms on a frozen layout » on `salon_kitchen` (a new room, not frozen until 9.8; the E9 anchors and moving pieces; fixed camera until 9.2).
  - [ ] `deferred-work.md`: a section for this story (see Dev Notes › Deferred items).

## Dev Notes

### Blender access: read this first

- **Do not use the live Blender MCP session unless you have checked its file.** On 2026-11-01 it was attached to the **main checkout's** `salon_crawler.blend`, dirty, older than the committed room. Geo may have unsaved work in it. Never save, reload or open another file there. Never run `export_level.py` in it: `repo_root()` comes from `bpy.data.filepath`, so it would write into the main checkout.
- **Work headless, in the worktree:** `/Applications/Blender.app/Contents/MacOS/Blender -b <worktree>/assets-src/blender/salon_kitchen.blend -P <scratchpad script>`, then `bpy.ops.wm.save_mainfile()`. Blender 5.2.3 LTS; `npm run assets:export` already takes that route (`findBlender`). Stories 4.10 and 7.1 built their rooms this way. The MCP's docs tools (`search_api_docs`, `get_python_api_docs`) are safe at any time.
- Run Python only on the project's `.blend` files (architecture › security).
- **Scripts stay in the scratchpad** (7.1 D9: the `.blend` is the source, Geo edits it by hand). **Commit the `.blend` once, at the end**, after purging orphan data, with no packed image.

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A new level beside the salon, not a replacement.** `DEFAULT_LEVEL_ID` stays `salon_crawler`; `salon_kitchen` is played with `?level=salon_kitchen`, by `npm run sim -- --level`, and by `PP_PERF_LEVEL`. No existing e2e spec changes level. The fixed camera fits the whole room (`fitIsoCamera` over `roomOf(geometry)`), so Papa and the baby look about three quarters of their salon size. Leave it: 9.2 brings the follow camera, and the GDD's « characters keep their size » is its AC. | Replacing the first level is 9.8's AC. Every spec and golden runs on the salon; switching now would move them all for a room with no camera of its own yet. The level list is discovered from `content/levels/` (`isBundledLevel`, `checkDist`, `levelAssets.test.ts`, `threatCatalog.test.ts`), so there is no registry to update. |
| D2 | **Start from a copy of `salon_crawler.blend`.** Keep its final models (sofa, coffee table, side table, phone, stairs, playpen, doors, outlet plate, lamp, props) and its materials, move them into the new plan, then add the dining corner and the kitchen in the same style. Rename what Blender duplicates (`.001` is refused). | The salon already passed 7.1 and 7.3 (bevels, palette, outlines skip, drawn floor contrast). A fresh room would redo that work and drift from the art direction. 4.10 built the bedroom from the salon the same way. |
| D3 | **Plan (a starting point; Geo validates it in play).** Walkable floor about 13.5 × 7 m, e.g. x ∈ [-6.75, 6.75], z ∈ [-3.5, 3.5]. Walls only on the back (-z) and the side (-x), as in the salon: the camera looks from +X +Z. **Kitchen** at the -x end, along the side wall and the back wall (an L of low cabinets with the hob, the dishwasher and the coffee machine on the worktop; the bin on the floor at the end of the run). **Dining corner** in the middle (table with tablecloth, chairs tucked inside the table's collider). **Living corner** at the +x end: sofa back to the back wall with the gap for `ZONE_hidden_behind_sofa`, coffee table in front, side table with the phone, stairs at the +x end against the back wall, the outlet on the back wall, the plant in a corner. `door` and the toilet door on the back wall. The playpen near the front (+z) of the living corner, three creak boards between it and the door. | The GDD (Cadre de level design) fixes only the size and the three corners, with « dimensions et plan à valider dans Blender ». Kitchen against the walls keeps tall cabinets off the open +X / +Z half (7.1 D4). Long axis on x keeps the room's two walls where the salon's are. Moving the plan later is cheap until 9.8 freezes it. |
| D4 | **Gameplay ids reuse the salon's.** Anchors `papa_spawn`, `baby_spawn`, `door`, `outlet_01`, `stairs_top`, `coffee_table`, `phone`, `coffee_machine`, `toilet`; zones `ZONE_hidden_behind_sofa`, `ZONE_safe_playpen`, `ZONE_creak_board_01..03`; colliders `COL_sofa`, `COL_coffee_table`, `COL_side_table`, `COL_stairs`, `COL_counter` (the run along the side wall, under the coffee machine), `COL_wall_back`, `COL_wall_side`; props `PROP_book_01`, `PROP_mug_01`, `PROP_mug_02`, `PROP_toy_01` on the coffee table and `PROP_vase_01`, same kinds and exact boxes as the salon's. **New E9 ids:** anchors `ANCHOR_stove` (hob, 9.5), `ANCHOR_dishwasher` (station 9.6 and the « open dishwasher » mischief), `ANCHOR_dining_table` (tablecloth), `ANCHOR_low_cabinet`, `ANCHOR_bin`, `ANCHOR_plant`; colliders `COL_counter_back` (the run along the back wall), `COL_dining_table`, `COL_bin`, `COL_plant`. « Papa's mug set too low » uses `coffee_table` (no new anchor). | Same ids mean `salon_kitchen.json` is the salon's gameplay with a new id (D7), and every test that reads a threat at its anchor works unchanged. `COL_stairs` keeps `feedback.json › render.blobSkipColliderIds: ["stairs"]` effective. The E9 anchors let 9.4 to 9.7 add JSON without reopening the room; 9.7 may still add one (re-exporting is cheap until 9.8). |
| D5 | **What stands on the floor has a collider and a nav block; what moves later is its own node.** Dining table, bin and plant pot each get a `COL_` and a `NAV_block_`, and their visual fits inside the collider (7.1 D2). Colliders are axis-aligned boxes, so the L of the kitchen is two: `COL_counter` + `NAV_block_counter` along the side wall and `COL_counter_back` + `NAV_block_counter_back` along the back wall, both topped at 0.9 m, with no gap and no overlap the nav grid would read as a hole. **Moving later** (own visual nodes, lower_snake_case, mesh data named after the object): `dishwasher_door`, `low_cabinet_door`, `tablecloth`, `pan`, `bin_lid`, `plant`. Nothing in `src/` reads them in this story. Everything else static is joined by material. | Papa and the baby walk the nav grid, so a floor piece with no block is walked through. 9.5 to 9.7 will open the dishwasher, the cabinet and the bin, pull the cloth and stir the pan: a joined mesh would have to be split again in Blender. Six extra nodes at one or two materials each cost about ten draw calls, which the 40 budget allows only if the rest is joined (`GLTFPACK_FLAGS` has `-kn`: nothing merges at export). |
| D6 | **NFR15: a per-level budget, data in `constants.ts`.** `LEVEL_PAYLOAD_MAX_BYTES_BY_ID = { salon_kitchen: 5 MiB }`, every other level `LEVEL_PAYLOAD_MAX_BYTES` (3 MiB). MiB, like the existing budget. | NFR15 (v2.3) and the architecture's budget table: 3 MB per level, 5 MB for the big room, checked by `dist:check`. `DEFAULT_LEVEL_ID` already puts a level id in `constants.ts`. The payload counts all the audio and both characters for every level (`inspectDist`), so the room's `.glb` alone will stay far under either budget today (salon 58.9 KB, payload 2,634.9 KiB at 7.3); the exception is for the sounds of 9.5 to 9.7. |
| D7 | **`salon_kitchen.json` is the salon's gameplay.** Copy `salon_crawler.json`: same `variant`, `durationMs`, waves, objects, gauges, `carry`, `sequences`, `finalRush` (`spillAnchor: "coffee_table"`). Change `id`, and set `feelOverrides: { "movement": { "glideMaxMs": 900 } }`. No `cycle`, no chores, no new threat, no `camera` key. | The GDD and the architecture put the big room's glide cap at 900 ms (`feelOverrides`); the director's travel equity (ADR-011) reads it, so the room is fair from its first game. With the salon's gameplay, a bot report on the new room says what the room itself changes (distances, paths). 9.2 checks the 900 ms glide in play; 9.8 writes the real waves. **If 3.15 or 3.16 merges first and adds a level field, add it here the same way as in `salon_crawler.json`.** |
| D8 | **The art rules of 7.1 and 7.3 apply as written** (project-context › « Final rooms on a frozen layout »), except the « frozen » part: this room's geometry is new, so its `geometry.json` is expected to change while you work. One material per colour, base colour only, ≤ 12 materials shared over the room, no texture, no vertex colour, no emissive, no alpha. No material within 15° of `parry`, `dodge` or `alert` at S and V ≥ 0.6. Floor ≥ 3:1 against `ink`, drawn and authored. Kitchen tiles or planks are faces of `floor` at y = 0, uniform over the creak boards. Default lights (`feedback.json › render.lights.default`), no `byLevel` entry. | These are what `levelAssets.test.ts` and `roomArt.ts` already enforce on every committed level; the new room inherits them by being in `content/levels/`. A stove top in alert yellow or a red dishwasher light would break the reserved hues: pick other colours. |
| D9 | **`salonKitchen.test.ts` reads the live geometry and feel** (like `creakZones.test.ts`): floor size from the nav grid (13 ≤ cols × cellM ≤ 14, 6.5 ≤ rowCount × cellM ≤ 7.5); the colliders `sofa`, `coffee_table`, `stairs`, `counter`, `counter_back`, `dining_table`, `bin`, `plant` exist; the anchors of D4 exist; each E9 anchor has a walkable cell within `feel.input.contextReachM` of `(x, z)`; the zones of D4 exist with their kinds. Thresholds are named constants at the top of the test, citing the GDD. | AC 2 and 3 become a test instead of a claim, and it keeps saying so when Geo moves furniture in Blender. Reachability is what the chores of 9.4 need (a contextual interaction within reach). |

### What exists, and what must keep working

- **Pipeline:** `tools/blender/export_level.py`, `tools/assets/{exportLevel,extractLevelGeometry,optimizeGlb,glb,paths}.ts`. Order `export → extract → optimize`, on `public/assets/levels/<id>.glb`; `extract` refuses an optimised file, so re-export first. Each takes the level id as argument. **No change.**
- **Extraction:** `boundsMinM` / `boundsMaxM` are the union of the **visual** boxes, and `rapierPhysics.ts` builds the floor, four walls and ceiling from them. On the open sides (+x, +z), keep visuals within the floor's edge, or the physics walls move out with them. The nav grid is `NAV_floor` minus every `NAV_block_*`, at `NAV_CELL_M` 0.25 (about 54 × 28 cells here; A* stays cheap).
- **`src/client/render/levelScene.ts`:** removes non-visual nodes, swaps materials for toon ones by colour, takes the first `PROP_<kind>` node as the template of that kind's pooled view, adds blob shadows from colliders (not `stairs`), hulls props (`addOutlineHulls`). No change.
- **Content checks (`tools/content/contentChecks.ts`):** a threat anchor must be an anchor, a `hiddenZone` threat must name a hidden zone, an object anchor must exist, the toilet must not stand in a hidden zone, the rush needs `doorSpillCount` unbreakable props within reach of `spillAnchor` (`finalRushProblems`). These make AC 4 hold; read their messages if `content:check` fails.
- **Tests that discover levels by themselves:** `levelAssets.test.ts`, `threatCatalog.test.ts`, `checkDist.ts`. Tests that list levels by hand: `creakZones.test.ts`, `liveProps.test.ts` (add an entry), `checkCycle.test.ts` (cycle levels only: not this one).
- **`perf.spec.ts`** reads `PP_PERF_LEVEL`; CI keeps the salon. `dist.spec.ts` needs no new test.
- **Must not change:** see AC 10.

**Expected changes:** new `assets-src/blender/salon_kitchen.blend`, `public/assets/levels/salon_kitchen.glb`, `content/levels/salon_kitchen.json`, `content/levels/salon_kitchen.geometry.json`, `tests/content/salonKitchen.test.ts`, `tests/e2e/salonKitchen.spec.ts`, `_bmad-output/implementation-artifacts/9-1-screenshots/*`; modified `src/shared/constants.ts`, `tools/build/inspectDist.ts`, `tests/tools/build/checkDist.test.ts`, `tests/content/creakZones.test.ts`, `tests/content/liveProps.test.ts`, `CLAUDE.md`, `_bmad-output/project-context.md`, `deferred-work.md`, `sprint-status.yaml`, this story.

### Deferred items

Add a section for 9.1 in `deferred-work.md`:
- « The fixed camera shrinks the characters in `salon_kitchen` »: for 9.2.
- « The E9 moving pieces are static nodes »: for 9.5 to 9.7.
- « 5 MiB is an assumption » (NFR15): to confirm with E9's real audio.
- Anything the review of the screenshots leaves for Geo.
- Still open from 1.6 and 7.1, unchanged: no drift check between the `.blend` and the committed geometry; gameplay nodes still ship in the `.glb`.

### Testing

- **Unit / content:** `salonKitchen.test.ts` (D9), the two new entries, the two `checkDist` fixtures. Every threshold is a named constant.
- **Architecture:** `levelAssets.test.ts` and `blenderConventions.test.ts`, unchanged, now also on the new room.
- **E2E:** `salonKitchen.spec.ts`, plus `level.spec.ts` and `chambreNight.spec.ts` as neighbours, on Chromium, through `npm run e2e -- …`, in the background.
- **Perf:** T7, by hand on the built playtest; CI does not run the new room.
- **Goldens:** pass with **no regeneration**. Running `npm run golden:update` here is a mistake.
- **Before the merge:** one `npm run ci:story`, after the review. `npm run ci` is not needed: this merge does not complete Epic 9.

### Project Structure Notes

- Paths follow the architecture: `assets-src/blender/`, `public/assets/levels/salon_kitchen.glb`, `content/levels/salon_kitchen.json` (architecture › correspondance des epics, row E9 9.1).
- **Variance:** the architecture names `tools/blender/export.py` in one place; the real file is `export_level.py`.
- **Variance:** the architecture lists Blender collections (`level`, `colliders`, `nav`, `anchors`, `props`); the extractor reads names, not collections. Keep the salon's collections as they are in the copy; do not reorganise.
- **Variance:** the architecture writes the NFR15 budget in « Mo »; the code's budget is in MiB (`3 * 1024 * 1024`). Keep MiB for both budgets.

### Project Context Rules

- **Golden rule:** the AI models, exports and tests; Geo plays and judges the look and the plan. Anything Geo may tune is data (`feelOverrides` in the level JSON), never a hard-coded number.
- **Layers:** `src/` never imports `tools/`; `tests/` may import both. No `console.*` (tools log through `@shared/log`).
- **Blender nodes:** `COL_<name>`, `NAV_floor`, `NAV_block_<name>`, `ANCHOR_<id>`, `PROP_<kind>_<nn>`, `ZONE_hidden_|safe_|creak_<name>`; visual meshes unprefixed, lower_snake_case; metres, Y up; `.001` refused.
- **Content:** ids `lower_snake_case`, equal to the file name; JSON keys camelCase; `"$schema": "../_schemas/level.schema.json"`.
- **Naming:** constants `UPPER_SNAKE` in `shared/constants.ts` with unit suffixes; test files `camelCase.test.ts`; import `describe/it/expect` from `vitest`.
- **Render budgets:** ≤ 100 draw calls, ≤ 100k triangles, no shadow map, blob shadows only, no texture.
- **Checks:** `ci:fast` after each task; the touched e2e specs on Chromium; `ci:story` once before the merge; heavy runs in the background, through the lock.
- **Git:** this worktree, branch `story/9-1-grand-salon-avec-cuisine-ouverte-dans-blender`. Commits « Story 9.1 : <titre> ». Merge only after the review, a green `ci:story` and Geo's OK.

### Previous story intelligence

- **7.1** set the art rules and the guards this room inherits, and learned: `gltfpack -kn` keeps each named node, so join in Blender; a multi-material prop works (one unnamed child, one primitive per material); room colours render about 20 % darker than their values under the shared lights; « never claim a visual check you did not make » (the review caught screenshots said to show a sound wave that did not). Salon: 39 draw calls, 4,924 triangles, 12 materials, 58.9 KB `.glb`.
- **7.3** added outlines on characters and props (not furniture), the drawn floor contrast check, the danger tint. Salon at 87 draw calls and 15,584 triangles in play, p95 16.7 ms; payload 2,634.9 KiB. With a room near 40 draw calls the frame sits near 90: watch it.
- **4.10** built a room headless from the salon's `.blend`, added it as a level with `?level=` and measured it with `PP_PERF_LEVEL`; it moved creak boards until `creakZones.test.ts` passed on the live geometry.
- **2.13 and 3.14** (the last merges) touched characters and bots, not rooms: no conflict on the room files. Other worktrees open today: 3.15, 3.7, 7.4.

### Git intelligence

Recent commits (`fce389d` 2.13 merge, `5572c36` 3.14 merge) change `assets-src/blender/characters/`, `src/client`, `src/bots`, `content/bots.json`. Nothing touched `assets-src/blender/*.blend` rooms since 3.5 (`c21c43a`, furniture joined for 7.1's budget). The pattern to follow for a new level is commit `1f2e99a` (4.10).

### Latest technical information

No new dependency. The stack is pinned (`three@0.186.1`, `gltfpack@1.3.0`, Blender 5.2.3 LTS) and the export already runs on that Blender, so no web research was needed. Behaviours of these tools that matter here (meshes moved to a child by `gltfpack -kn`, primitive children named by three's `GLTFLoader`) were proved by 7.1's spike.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 9.1, #Epic 9, FR77, NFR15]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md#4.5, #4.8, #4.10]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Cadre de level design (grand salon), #Nouvelles bêtises du grand salon, #Besoins en assets (poids d'un niveau), mécanique 3 (glissade 0,9 s)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Gestion des assets, #IA du bébé et navigation, #Assets de jeu, #Format du niveau (v2.3), budgets table (NFR15), correspondance des epics E9]
- [Source: _bmad-output/project-context.md#Performance Rules, #Platform & Build Rules (Assets, Final rooms on a frozen layout)]
- [Source: _bmad-output/implementation-artifacts/7-1-pieces-modelisees-dans-blender.md, 7-3-rendu-toon-final-et-effets.md, 4-10-niveau-chambre-de-nuit-et-playtest-du-deuxieme-prototype.md, deferred-work.md]
- [Source: tools/blender/export_level.py, tools/assets/*, tools/build/inspectDist.ts, tools/content/contentChecks.ts, src/content/levelNodeNames.ts, src/client/render/{levelScene,isoCamera}.ts, src/sim/physics/rapierPhysics.ts, tests/architecture/levelAssets.test.ts, tests/content/{creakZones,liveProps}.test.ts, tests/e2e/chambreNight.spec.ts, tests/e2e-dist/perf.spec.ts]

### Questions for Geo (do not block the dev)

1. The plan of D3 (kitchen at the -x end, living corner at +x) is a proposal: say if you want the kitchen elsewhere.
2. The epic plans E9 after the playtest of the catch-up, and 3.15 and 3.16 are still in backlog. This story can be built before them; the level JSON follows their fields when they merge (D7).
3. D7 puts the 900 ms glide cap in this story's JSON so the room is fair now; 9.2 checks it in play.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-11-04 | Story created (`gds-create-story`), status `ready-for-dev`. Ultimate context engine analysis completed: comprehensive developer guide created. |
