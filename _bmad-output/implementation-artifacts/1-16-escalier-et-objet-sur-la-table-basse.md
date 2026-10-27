---
baseline_commit: e55feca
---


# Story 1.16: The Stairs and the Object on the Coffee Table

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.16 « Escalier et objet sur la table basse ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want two new threats with clearly distinct telegraphs,
so that I have to read before I act and choose what to deal with.

**Requirements covered:** FR26, FR27 (the prototype's three threats: outlet, stairs, object on the coffee table). GDD › Catalogue des menaces (gdd.md L232-237):

| Threat | Telegraph | Delay | Response | Window | Gag |
|---|---|---|---|---|---|
| Escalier | the baby speeds up, a halo on the step | 1.0 s | Parry: intercept | 300 ms | missed dive: the baby slides down on its bottom, delighted |
| Objet sur la table basse | the baby pulls itself up, an object icon | 1.5 s | Parry: remove the object or distract with a toy | 300 ms | the object falls, bounces, breaks something else |

Architecture: P1 (L672-690: « ajouter une menace, c'est ajouter un JSON (et éventuellement un gag) », and `gags.ts` « applique les conséquences d'un échec (bruit, bazar, presque-accident, dégaine de papa) »), threat ids (L537, L630), anchors (L641). GDD › Note de Maman (L386-399): a gag costs « un presque-accident (hurlement) ».

**Downstream consumers. Design the events and the gag code for them; none of them may need to change this story's code:**
- 1.17 (auto-target): picks among active threats by `windowOpenAt`; it reads `world.threats` only.
- 1.18 (waves): replaces `runDirector` and `content/levels/salon_crawler.json` › `threats` with waves of `{def, anchor}`. Our three defs and their anchors are exactly the architecture's wave example (L1017-1018).
- 1.22 (Mama's score): « Hurlement » counts the near misses, so it reads `NearMiss`; « Soupir » reads `world.mess` (1.15).
- 3.1 (noise): reads only `PropImpact` (1.15), so the coffee-table gag makes noise through the falling prop with no change here.
- 3.8 / 3.9 (Mama's memory, highlights): tag gags by `GagTriggered.gag` and score « presque-accident (2) » from `NearMiss`.

## Precondition (check first, stop if it fails)

Story 1.15 is `done`, or `review` with its review fixes committed: this story calls its `pushProp`. When this story was written, 1.15's code review had just listed open findings on exactly that path: a `Number.isFinite` guard in `pushProp`, a possible `feel.physics.maxPushImpulseNs` clamp, and `try/finally` around `onImpact`'s module state (`1-15-…md` › Review Findings). If they are still unchecked, stop and tell Geo. Once they land, re-read `propsSystem.ts`. If a push clamp exists, check that it is ≥ `feel.gags.tableObjectFall.pushImpulseNs` (0.72), or the chain of D4 breaks silently. `git status` is clean apart from `_bmad-output/`. Run `env | grep VITE_`; the agent shell may export `VITE_DEBUG_ALLOWED=false` (see `CLAUDE.md` › Trap). Then run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note the unit and e2e counts in the Debug Log. The 1.15 final run was 159 test files, 2302 unit tests and 178 e2e. If the baseline is red, stop and say so.

## Acceptance Criteria

1. **The stairs threat, as data.** `content/threats/stairs.json` is valid (`ThreatDefSchema`): `response: "parry"`, `telegraphDelayMs: 1000`, `windowMs: null` (the feel's 300 ms), `gag: "stairs_slide"`, `icon: "stairs"`, its own `tel_stairs` and `gag_stairs` cues, the shared `resp_parry` / `resp_parry_perfect`, `cooldownMs: 6000`.
   - When the director targets it at `stairs_top`, the baby locks on, then crawls there (the generic approach: it speeds up to arrive by the window, up to `MAX_CRAWL_SPEED_MPS`), and the client shows the threat's icon with its pulsing `{colors.alert}` halo on the step, and plays `tel_stairs` (sound, ring, haptic).
   - A successful response plays the existing success choreography (Papa glides there and lifts the baby: « intercepte »).
   - A miss emits, at the same step and in this order, `ResponseResolved{fail}`, `GagTriggered{gag: "stairs_slide"}` and **`NearMiss{t, threatId, gag}`**. The client plays `gag_stairs` and the provisional slide: the baby sphere slides away from the stairs and back (D6), and stays in `act` (« ravi ») for `feel.baby.actMs`.
2. **The coffee-table threat, as data.** `content/threats/coffee_table_object.json`: `response: "parry"`, `telegraphDelayMs: 1500`, `windowMs: null`, `gag: "table_object_fall"`, `icon: "mug"`, cues `tel_coffee_table` and `gag_coffee_table`, the shared response cues, `cooldownMs: 6000`.
   - When it is targeted at `coffee_table`, the baby crawls to the table and the client shows the **object icon** (a mug) with the halo, and plays `tel_coffee_table`.
   - A successful response plays the success choreography; the object does not move (D5).
   - A miss emits `ResponseResolved{fail}` then `GagTriggered{gag: "table_object_fall"}`, and **in the same step** `gags.ts` pushes, through 1.15's `pushProp`, the nearest unbroken prop that is off the floor within `feel.gags.tableObjectFall.propReachM` of the anchor, horizontally away from the anchor with `feel.gags.tableObjectFall.pushImpulseNs` (D4). In the salon, that is the mug: it leaves the table, falls, and can break the vase (`PropImpact`, `PropBroken`, `world.mess` from 1.15). With no such prop, the gag is only its events.
3. **Gag consequences only in `gags.ts`.**
   - `GAG_IDS` is `['outlet_hair', 'stairs_slide', 'table_object_fall']`.
   - `gags.ts` exports `applyGag(world, ctx, threat, gag)`, a dispatch over a `Record<GagId, …>` of module-level functions (no closure per call), and `gagThreat` calls it right after pushing `GagTriggered`.
   - `outlet_hair` has no sim consequence.
   - No other sim file names a threat, a gag or an anchor id (the existing architecture test is not weakened; grep the diff).
4. **The three threats in one test level, four cases each.**
   - `tests/threats/threatCatalog.test.ts` builds, from the frozen room, a level that plans **every** def of `content/threats/` at the anchor where a live level plans it: the def under test from 0 ms, the others after the case's horizon.
   - For each def it runs the four generated cases (perfect, success, too early, too late) and they pass.
   - The anchor and the release are derived from the data (the deferred item at `deferred-work.md:178`); the file names no threat.
   - A def planned by no live level fails the catalogue with its id.
5. **The live level plays all three.** `content/levels/salon_crawler.json` plans `outlet` (4000 ms), `stairs` at `stairs_top` (10 000 ms) and `coffee_table_object` at `coffee_table` (16 000 ms), in that order, so the first threat of a game stays the outlet (D8). `npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3` reports all three defs, all `perfect`, and `--bot idle` reports gags for all three, `NearMiss` included.
6. **Icons, as data.**
   - `ThreatDefSchema` gains `icon`, one of `THREAT_ICONS = ['bolt', 'stairs', 'mug']` (data list + type, like `THREAT_RESPONSES`).
   - The client draws each marker with its def's glyph, from a `Record<ThreatIcon, …>` in `threatMarkers.ts` (a missing glyph is a type error, like `GAG_PRESENTATIONS`).
   - `content/_schemas/threat.schema.json` is regenerated, and `outlet.json` and its frozen copy get `"icon": "bolt"`.
7. **Distinct sounds that every sense receives.**
   - Four new placeholder clips, `tel_stairs`, `tel_coffee_table`, `gag_stairs` and `gag_coffee_table`, are synthesized by `npm run assets:audio` (`tools/audio/makePlaceholderAudio.ts`) and sound clearly unlike the outlet's.
   - Their cues in `content/feedback.json` each have `audio`, `visual` and `haptic` (`feedbackEquivalence.test.ts`).
   - `audioAssets.test.ts` (M4A, not a stub, payload ≤ 3 MB) and `content:check` pass.
8. **Nothing else breaks.**
   - Every golden scenario keeps **exactly** its event sequence. Only `feelHash` moves for all of them (the feel gains `gags`), plus `levelHash` for `outlet_parry` (the outlet gains `icon`).
   - A new golden `threat_trio` pins the three threats unanswered in the frozen room (D10).
   - The autoplay e2e (world hash browser = Node) stays green in chromium and webkit, and `npm run ci` is green on the Mac.

## Tasks / Subtasks

- [x] **T0: Baseline** (Precondition)
  - [x] `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green on the untouched tree; counts go in the Debug Log.
- [x] **T1: Schemas and feel** (AC 2, 6; D4, D7)
  - [x] `src/content/schemas/threat.ts`: add `THREAT_ICONS = ['bolt', 'stairs', 'mug'] as const`, `ThreatIcon`, and the required key `icon: z.enum(THREAT_ICONS)`, described as « Glyph drawn in the threat's marker (the client has one per entry) ». Update `tests/content/threatSchema.test.ts`: refuse an unknown icon and a missing one, each at its path.
  - [x] `content/threats/outlet.json` and `tests/support/testOutlet.threat.json`: `"icon": "bolt"`.
  - [x] `src/content/schemas/feel.ts`: add `gags: strictObject({ tableObjectFall: strictObject({ pushImpulseNs, propReachM }) })` to `FeelSchema`, using the file's rules (no `.default`, `.optional` or `.transform`), both `> 0`, each with a description that states its unit. Values in Dev Notes › Feel.
  - [x] `content/feel.json` and `tests/support/testFeel.json` get the values. Update `tests/content/feelSchema.test.ts` (refuse 0 and a missing key at their paths; the unit-suffix check already knows `Ns` and `M`).
  - [x] `npm run content:schemas` and commit `content/_schemas/{threat,feel}.schema.json`.
- [x] **T2: Sim: event and gags** (AC 1, 2, 3; D1-D5)
  - [x] `src/sim/events.ts`: add `NearMiss` to the union (doc comment: « a gag that was nearly an accident; Mama's « Hurlement » (1.22) counts these; never an injury (NFR9) ») and to `SIM_EVENT_TYPES` (keep it sorted). Update `events.test.ts`.
  - [x] `src/sim/threats/gags.ts`:
    - `GAG_IDS` gains `stairs_slide` and `table_object_fall`;
    - add `applyGag(world, ctx, threat, gag)` over a `GAG_CONSEQUENCES: Readonly<Record<GagId, GagConsequence>>` of module-level functions;
    - `stairs_slide` pushes `NearMiss`;
    - `table_object_fall` runs D4 and calls `pushProp` (import it from `../physics/propsSystem.ts`; it is a helper, not a system);
    - `outlet_hair` is a no-op;
    - rewrite the file's doc comment: the sim applies the consequences that need the sim (near miss, a pushed prop), the rest (noise 3.1, mess 1.22) comes from the events and `World`.
  - [x] `src/sim/threats/threatFsm.ts`: `gagThreat` calls `applyGag(world, ctx, threat, gagIdOf(def.gag))` after pushing its two events (compute `gagIdOf` once).
  - [x] Create `src/sim/threats/gags.test.ts` (Dev Notes › Testing › gags).
  - [x] `threatFsm.test.ts`: the event order of a stairs gag (`ResponseResolved`, `GagTriggered`, `NearMiss`, same `t`), and an outlet gag emits no `NearMiss`.
- [x] **T3: Content: the two threats and the live level** (AC 1, 2, 5; D7, D8)
  - [x] Create `content/threats/stairs.json` and `content/threats/coffee_table_object.json` (Dev Notes › Threat files), with `"$schema": "../_schemas/threat.schema.json"`.
  - [x] Frozen copies for tests: `tests/support/testStairs.threat.json` and `tests/support/testCoffeeTableObject.threat.json` (same values, `$schema` path `../../content/_schemas/threat.schema.json`, as `testOutlet.threat.json`).
  - [x] `tests/support/testContent.ts`:
    - `createTestThreats()` returns the three frozen defs by id;
    - `createTestLevel(entries)` resolves every entry's def from it (today it only knows the outlet);
    - add `stairsEntry(fromMs)` (`stairs_top`) and `coffeeTableEntry(fromMs)` (`coffee_table`) beside `outletEntry`.
  - [x] `content/levels/salon_crawler.json`: plan the three (AC 5).
  - [x] `npm run content:check` is green.
- [x] **T4: Catalogue test** (AC 4; D9)
  - [x] Rewrite `tests/threats/threatCatalog.test.ts` as in Dev Notes › Catalogue.
  - [x] Close `deferred-work.md:178`.
- [x] **T5: Sounds and cues** (AC 7; D7)
  - [x] `tools/audio/makePlaceholderAudio.ts`: add four synthesized clips (Dev Notes › Sounds), named with units like the existing constants; update the file's header comment (stories 1.9, 1.11 and 1.16).
  - [x] Run `npm run assets:audio` (macOS, `afconvert`) and commit the four `.m4a` files. The tool rewrites every clip: check with `git status` that the seven existing clips are byte-identical (same seed). If they are not, stop and find out why.
  - [x] `content/feedback.json`: add the four cues (Dev Notes › Cues).
  - [x] Listen to each clip once (`afplay public/assets/audio/tel_stairs.m4a`, …) and write one line per clip in the Debug Log.
- [x] **T6: Client** (AC 1, 2, 6; D5, D6)
  - [x] `src/client/ui/world/threatMarkers.ts`:
    - `ThreatMarkerEntry` gains `icon: ThreatIcon`;
    - `threatMarkerEntries(threats, anchors, defs)` reads each threat's def (`defs` is the level's `LevelContent.threats`); an unknown def gets `bolt` with a `warn`;
    - `createMarker` draws the glyph of `THREAT_ICON_PATHS[entry.icon]` (Dev Notes › Icons);
    - update the doc comments that say « a bolt »;
    - fix the caller, `src/client/app/levelSession.ts:315`, which has the level's `LevelContent` at hand.
  - [x] `threatMarkers.test.ts`: each entry carries its def's icon, each marker's `path` has its glyph's `d`, and an unknown def falls back with a `warn`.
  - [x] `src/client/render/gags.ts`:
    - `GagPresentation` gains `babySlide: boolean`;
    - `GAG_PRESENTATIONS`: `outlet_hair` `{lightsOff: true, hair: true, babySlide: false}`, `stairs_slide` `{false, false, true}`, `table_object_fall` `{false, false, false}` (the falling prop is its show);
    - add `slideOffsetAt(elapsedMs)` and art constants `GAG_SLIDE_M`, `GAG_SLIDE_OUT_MS`, `GAG_SLIDE_HOLD_MS`, `GAG_SLIDE_BACK_MS` (D6);
    - `GagStage` gains `setBabySlide(offsetXM, offsetZM)`;
    - `GagFx.start` takes the slide direction (D6);
    - reduced motion drops the slide, as it drops the hair.
  - [x] `gags.test.ts` (client): the curve's ends and peak, the reduced-motion drop, and the stage written only while it runs.
  - [x] `levelScene.ts`:
    - `LevelFx.gag(…)` gains the direction (D6);
    - the stage's `setBabySlide` offsets the baby view's position (add `setSlideM(xM, zM)` to `babyView`, next to `setLiftM`, applied in `update` after the interpolation, with no allocation).
  - [x] `boot.ts` (L474): on `GagTriggered`, compute the direction from the threat (`world.threats` by `event.threatId`) and the baby (D6), and pass it.
  - [x] `responseChoreography.ts`: no behaviour change (one active threat at a time, D11). Fix its comment, which says « story 1.16 needs more »: say that 1.18 decides.
- [x] **T7: Goldens, bots, determinism** (AC 5, 8; D10)
  - [x] `tests/golden/scenarios.ts`: add `threat_trio` (D10) and `tests/golden/threatTrio.test.ts`, which pins the behaviour like `propFall.test.ts`.
  - [x] `npm run golden:update`, then review the diff:
    - every existing scenario changes only `feelHash`, plus `levelHash` for `outlet_parry` (its journal too); `eventTypes` and `eventsHash` stay identical;
    - paste that check in the Completion Notes;
    - if an event moved in any of them, stop: a gag consequence leaks into a scenario that has no gag of the new kinds.
  - [x] `tests/bots/perfectBot.test.ts`: add a case on a test level with the three threats (fromMs 0, 0, 0), where every `ResponseResolved` is `perfect` over 60 s of sim and every def is answered at least once.
  - [x] Add a case to `tests/bots/idleBot.test.ts` (or a new colocated test if it does not fit): over 60 s, the idle bot sees one `GagTriggered` of each gag and at least one `NearMiss`.
  - [x] `src/sim/determinism.test.ts`: a 10 000-step run of the three-threat test level with the random bot (or periodic presses) is identical twice.
  - [x] Run `npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3 --journals`, then `--bot idle`, then `npm run sim:replay` on a journal. Paste the per-def summary in the Debug Log.
- [x] **T8: E2E** (AC 1, 2, 5, 8)
  - [x] Create `tests/e2e/threats.spec.ts` (chromium and webkit), through `tests/e2e/support/testApi.ts` only, with no `waitForTimeout`:
    1. `ppLoadLevel`, `ppFreeze(true)`;
    2. advance (in chunks, reading `ppWorld()`) until `stairs` has been telegraphed;
    3. check that its marker is shown at the stairs with the stairs glyph (read the DOM of the shown `.pp-threat`);
    4. let it expire, then check `GagTriggered{gag: 'stairs_slide'}`, `NearMiss` and `data-pp-gag="stairs_slide"`;
    5. advance until `coffee_table_object` has gagged, then check a `PropImpact` for `mug_01` within 1 s of sim;
    6. `collectProblems` is empty;
    7. draw calls ≤ 100 (`data-pp-draw-calls`, as `props.spec.ts` checks it).
  - [x] Run the whole suite. The live level now plans three threats. A spec that assumed the outlet is the only threat (`threat.spec.ts`, `timeEffects.spec.ts`, `autoplay.spec.ts`, `feedback.spec.ts`, `baby.spec.ts`) must still pass, because the outlet stays first (D8). If one fails, fix the spec's assumption (by index → by `defId`), never the order of the level; say which in the Debug Log.
  - [x] Screenshots `autoplay-frozen-*`: the frame is the first outlet telegraph, so it should not change. If it does, regenerate (darwin with `--update-snapshots=all`, linux with the Docker command of story 1.13 › Screenshots and the `pp-node-modules` volume), **look at them** and say why they moved.
- [x] **T9: By hand, measure, document**
  - [x] By hand: `(unset VITE_DEBUG_ALLOWED; npm run dev)`, open `/?debug=1`, play to 30 s without answering, then once answering. Write in the Debug Log what you saw: the stairs icon and halo on the step, the mug icon over the table, three distinct telegraph sounds, the slide, the mug falling and the vase. Use a Playwright script with screenshots if you cannot look live, as 1.15 did, and say so.
  - [x] `_bmad-output/project-context.md` › « Content & feel »: add « a gag's sim consequences (near miss, pushed prop) live in `sim/threats/gags.ts` (`applyGag`, one entry per `GagId`); its presentation in `client/render/gags.ts` (`GAG_PRESENTATIONS`); a threat's marker glyph is its def's `icon` ».
  - [x] `deferred-work.md`: Dev Notes › Deferred by this story; close L178 and the « near miss » part of L166.
  - [x] Final `(unset VITE_DEBUG_ALLOWED; npm run ci)` green; counts in the Debug Log.

## Dev Notes

### What exists today (stories 1.10 to 1.15)

- **Threat pipeline** (one generic FSM, data per threat):
  - `content/threats/<id>.json` → `ThreatDefSchema` (`src/content/schemas/threat.ts`), with `response` (only `parry`), `telegraphDelayMs` / `windowMs` (`null` = feel default), `gag` (checked against `GAG_IDS` by `createSim` and `content:check`), `feedback` (four cue ids), `cooldownMs`.
  - `content/levels/salon_crawler.json` (`LevelSchema`) plans `[{def, anchor, fromMs}]`.
  - `createSim` builds `world.threats` index-aligned with `ctx.level.threats` (`createSim.ts:121-180`; the anchor's x/z go in the instance).
- **`runDirector`** (`directorSystem.ts`, minimal, replaced in 1.18): when the baby is `wander`/`babble` and no threat is `telegraph`/`windowOpen`, it telegraphs the **first idle** threat in level order whose `fromMs` has passed. So **only one threat is ever active at a time** in this story.
- **`runBaby`** (`babySystem.ts`): it locks on the active threat (`targetLocked`, stares for `lockMs` 300), then `approach`es it on its nav grid. Its speed is `max(approachSpeedMps, distance / time left to the window)`, capped at `MAX_CRAWL_SPEED_MPS`: the stairs' 1000 ms delay makes it visibly faster. That is the GDD's « bébé accélère », with no per-threat code. An anchor inside a nav block (`stairs_top` at x 3.9 is inside `COL_stairs`, x 3.4 to 4.0; `coffee_table` is inside the table) snaps to the nearest open cell (`planApproach`). After a gag the baby plays `act` for `actMs` (1500), then babbles.
- **`runThreats` → `threatFsm.ts`:** `gagThreat` pushes `ResponseResolved{fail, reason}` then `GagTriggered{gag, reason}`. `runThreats` runs **before** `runPapa` and `runPhysics` in `SYSTEMS`, so a `pushProp` from a gag counts in the same step (`propsSystem.ts:14-18` says exactly that).
- **`pushProp(world, ctx, propIndex, xNs, yNs, zNs)`** (`propsSystem.ts`): an impulse at the centre of mass that wakes the body, and does nothing for a broken or unknown prop. `world.props[i]` carries the pose, `isOnFloor` and `isBroken`.
- **Frozen room** (`tests/support/testLevel.geometry.json`, a byte copy of the salon):
  - anchors `stairs_top` (3.9, 0, -1.25) and `coffee_table` (0.5, 0.45, -0.6);
  - `mug_01` resting on the table at (0.7, 0.5, -0.6), so 0.2 m along +x from the `coffee_table` anchor;
  - `vase_01` on the floor at (1.3, 0.15, -0.6).
  - 1.15 calibrated a +x push of **0.72 N·s** on the mug: it lands on the vase and breaks it (vase `breakImpulseNs` 0.35) at every step phase tried (1.15 Debug Log › Calibration).
- **Client:**
  - `threatMarkers.ts` draws **every** marker with the bolt (`BOLT_PATH`): halo, highlight and chevron are generic.
  - `client/render/gags.ts` has `GAG_PRESENTATIONS: Record<GagId, GagPresentation>` (lights, hair) and `createGagFx(stage)`.
  - `boot.ts:474` calls `currentLevel.fx.gag(event.gag, event.t, isMotionReduced)`.
  - `responseChoreography.ts` lifts the baby at Papa's arrival on any success.
  - `threatFeedback.ts` plays the def's cues by event.
  - `data-pp-gag` is mirrored from `GagTriggered` (`boot.ts:360`).
- **Bots** answer any `parry` threat from `world.threats` and the defs' responses (`src/bots/threatTiming.ts`), with no threat names.
- **Catalogue test** (`tests/threats/threatCatalog.test.ts`): it reads every live `content/threats/*.json`, but plans each alone at `outlet_01` with a hard-coded Parry release.
- **Audio:** `tools/audio/makePlaceholderAudio.ts` synthesizes every clip from a fixed seed (macOS `afconvert`, never in CI). `audioAssets.test.ts` checks every clip `feedback.json` names. Audio naming: `public/assets/audio/<category>_<name>.m4a`.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | Gag consequences live in `src/sim/threats/gags.ts`: `applyGag(world, ctx, threat, gag)` dispatches on `GAG_CONSEQUENCES: Readonly<Record<GagId, (world, ctx, threat) => void>>`, functions defined once at module scope. `gagThreat` calls it after `GagTriggered`. | Architecture P1 (L681). A `Record` makes a new `GagId` without a consequence a type error. AC « sans code propre à une menace hors de `gags.ts` ». No closure per call. |
| D2 | New event `NearMiss{t: SimMs, threatId: number, gag: GagId}`, emitted only by gags whose GDD failure is a near accident: `stairs_slide` today. There is no `World` counter: 1.22's scoring counts the events (systems may read `ctx.events` of their step, as 3.1 does with `PropImpact`). | The epic names `NearMiss`. The GDD counts near misses in « Hurlement ». An event is what 3.8 and 3.9 tag. A counter now would be a slice with no reader. |
| D3 | `outlet_hair` keeps no sim consequence (its lights and hair are client-only). It is **not** a near miss: the GDD gag is a cartoon jolt. | Keep 1.10's goldens' event sequences unchanged. Geo can change his mind by adding one line to `GAG_CONSEQUENCES` (Open points). |
| D4 | `table_object_fall`: among `world.props`, pick the prop that is `!isBroken && !isOnFloor` and whose horizontal (x/z) distance to the threat's anchor (`threat.xM`, `threat.zM`) is ≤ `feel.gags.tableObjectFall.propReachM`; the nearest one, ties to the lower index. Push it with `pushProp` along the unit horizontal vector from the anchor to the prop, times `pushImpulseNs` (y = 0). If the prop sits exactly on the anchor (distance not > 0), push along the baby's gaze (`gazeX`, `gazeZ`). No prop in reach: no push. Use only `Math.sqrt`, no trigonometry. | Generic (no prop id or level in code): the object « on » the table is the off-floor prop next to its anchor. Pushed outward, it falls off the nearest edge. In the salon that is exactly 1.15's calibrated +x push, so the vase breaks. A mug already on the floor is not « on the table »: a later gag of the same threat pushes nothing. |
| D5 | A **success** changes nothing physical: the object stays where it is. The client plays the existing lift choreography (« Papa intercepte / retire »). | The GDD allows « détourner avec un jouet ». Moving a Rapier body by hand needs a new `PhysicsPort` method and changes determinism, for no gameplay gain while the director replays the threat anyway. A real « take the object away » animation is E7. |
| D6 | The stairs slide is **client-only, provisional**. The baby view is offset along the horizontal unit vector from the threat's anchor to the baby at the gag (zero length: minus the baby's gaze): out to `GAG_SLIDE_M` (0.6) over `GAG_SLIDE_OUT_MS` (500, ease-out), held for `GAG_SLIDE_HOLD_MS` (500), back over `GAG_SLIDE_BACK_MS` (400). It runs on the sim clock, and reduced motion drops it. The sim baby does not move. | A sim teleport would be a one-step jump and would touch the baby slice from a threat helper. The greybox has a flat floor, so « en bas » has no height to slide down. E7 replaces it with an animation, like the lift. |
| D7 | Each new threat gets its own telegraph and gag clips (`tel_stairs`, `gag_stairs`, `tel_coffee_table`, `gag_coffee_table`); success and perfect reuse `resp_parry` / `resp_parry_perfect` (same verb). The icon is a def key (`icon`) from a closed list, with one glyph per entry on the client. | « Télégraphes bien distincts » (story statement). The same response must sound the same everywhere. Story 2.2 adds `verb`, `iconShape` and `color` to the def in the same way. |
| D8 | The live level plans `outlet` 4000, `stairs` 10 000, `coffee_table_object` 16 000, in that order. | Geo plays the three in the first 20 s. The outlet stays the first threat of every game, so the specs and the screenshot that read « the first outlet » hold. |
| D9 | The catalogue derives each def's anchor from the live levels and its release from its `response` (an exhaustive `switch`: a new response breaks the typecheck until the catalogue knows it). Each case plans all the defs, so the three threats are in one level. | Closes `deferred-work.md:178`. Follows the epic's AC 3 literally. |
| D10 | Golden `threat_trio`: frozen room, seed 42, the three threats planned at 0 ms in the live order, no input, until 40 000 sim ms. | It pins the director cycling through three defs, both new gags and the chain: the mug's `PropImpact`, the vase's `PropBroken`, and `NearMiss` after the stairs gag. |
| D11 | The minimal director still runs one threat at a time. Multi-touch, overlapping presses and `responseChoreography`'s single queue stay deferred to 1.18. | Two simultaneous threats first exist with the waves (1.18). |

### Threat files

```json
{
  "$schema": "../_schemas/threat.schema.json",
  "id": "stairs",
  "response": "parry",
  "telegraphDelayMs": 1000,
  "windowMs": null,
  "gag": "stairs_slide",
  "icon": "stairs",
  "feedback": { "telegraph": "tel_stairs", "success": "resp_parry", "perfect": "resp_parry_perfect", "gag": "gag_stairs" },
  "cooldownMs": 6000
}
```

```json
{
  "$schema": "../_schemas/threat.schema.json",
  "id": "coffee_table_object",
  "response": "parry",
  "telegraphDelayMs": 1500,
  "windowMs": null,
  "gag": "table_object_fall",
  "icon": "mug",
  "feedback": { "telegraph": "tel_coffee_table", "success": "resp_parry", "perfect": "resp_parry_perfect", "gag": "gag_coffee_table" },
  "cooldownMs": 6000
}
```

- `windowMs: null` = `feel.timing.windowMs` (300, the GDD's value for both).
- `cooldownMs` 6000, like the outlet: an `[ASSUMPTION]` that Geo tunes.
- Format the JSON as Biome formats it (`npm run format`), which expands the `feedback` object.

### Feel (`content/feel.json` › `gags`)

```json
"gags": {
  "tableObjectFall": { "pushImpulseNs": 0.72, "propReachM": 0.5 }
}
```

- 0.72 is 1.15's calibrated push: it reproduces the mug-on-vase chain. 0.5 m reaches the mug (0.2 m from the anchor) and not the vase (0.8 m, and it is on the floor anyway).
- The tunables of the other gags come with their gags. A gag with nothing to tune has no key (no empty objects).

### Sounds (`tools/audio/makePlaceholderAudio.ts`)

They are synthesized like the existing clips: constants with units at the top, the same seeded RNG, the same `afconvert`. They must not be confused with `tel_outlet` (a rising 220 → 660 Hz buzz with a 55 Hz flutter) or `gag_outlet` (a crackle and a falling bzzt).
- `tel_stairs`: quick pattering, the baby speeding up. About 4 to 6 short knocks (60 to 120 Hz thumps with a click), closer and closer, about 400 ms in all.
- `tel_coffee_table`: a creak and a wobble. A slow pitch-modulated tone (about 150 to 250 Hz, 8 Hz wobble) with a scrape of filtered noise, about 500 ms.
- `gag_stairs`: a bumpy slide down. 4 or 5 descending « bdoum » thumps over about 600 ms, ending in a short high « hi! » chirp (two sines around 900 to 1200 Hz).
- `gag_coffee_table`: a falling whistle (1200 → 400 Hz glide over about 350 ms). There is no crash: the vase's break sound belongs to `PropBroken` (deferred to 2.3).
- Peaks like `PEAK_LOUD`. Keep each clip short: the payload test sums the `.glb` and every clip.

### Cues (`content/feedback.json` › `cues`)

```json
"tel_stairs": { "audio": { "clip": "tel_stairs", "bus": "sfx", "gainPct": 90 }, "visual": { "kind": "soundWave", "anchor": "threat", "maxRadiusM": 0.6, "durationMs": 400 }, "haptic": "light" },
"gag_stairs": { "audio": { "clip": "gag_stairs", "bus": "sfx", "gainPct": 100 }, "visual": { "kind": "soundWave", "anchor": "threat", "maxRadiusM": 1.0, "durationMs": 500 }, "haptic": "heavy" },
"tel_coffee_table": { "audio": { "clip": "tel_coffee_table", "bus": "sfx", "gainPct": 90 }, "visual": { "kind": "soundWave", "anchor": "threat", "maxRadiusM": 0.6, "durationMs": 400 }, "haptic": "light" },
"gag_coffee_table": { "audio": { "clip": "gag_coffee_table", "bus": "sfx", "gainPct": 100 }, "visual": { "kind": "soundWave", "anchor": "threat", "maxRadiusM": 1.0, "durationMs": 500 }, "haptic": "heavy" }
```

These are the outlet's starting values (Geo tunes them). Story 2.4 makes telegraphs distinct in vision and touch as well. Here the haptics are the same light/heavy as the outlet's, and the icon carries the visual difference.

### Icons (`threatMarkers.ts`)

- `THREAT_ICON_PATHS: Readonly<Record<ThreatIcon, string>>`, with `bolt` = today's `BOLT_PATH`.
- Each new glyph is **one** SVG path in the same 24 × 24 view box, paper fill and 2 px ink stroke like the bolt, readable at 56 px. For example:
  - `stairs`: three steps rising to the right, a filled polygon like `M2.5 21.5V16h5.5v-5.5h5.5V5h8v16.5z`;
  - `mug`: a cup body with a handle drawn as a ring with a hole (`fill-rule="evenodd"` on the path, or a body path whose outline includes the handle).
- Check them in a screenshot (T9) and adjust. There is no `{colors.*}` change and no new token.

### Catalogue (`tests/threats/threatCatalog.test.ts`)

- **Defs:** read every `content/threats/*.json`, as today.
- **Anchors:** read every `content/levels/*.json` that `LevelSchema` parses (skip `*.geometry.json`). For each def, take the anchor of the first entry that plans it. A def with no such entry fails a named test: `"<id>" is planned by no level`.
- **Level of a case:** the frozen room (`createTestGeometry()`). It plans every def at its anchor, the def under test with `fromMs: 0` and every other one with `fromMs: CATALOG_OTHERS_FROM_MS` (a test constant, e.g. 600 000, beyond every case's horizon). The threats map holds every def. The threat under test is the instance whose `defId` is the def, not the hard-coded id 1.
- **Release:** `releaseOffsetMs(response: ThreatResponse): number`, an exhaustive `switch`: for `parry`, `holdMinMs / 2`.
- **The four cases keep their current assertions.** Their expected `GagTriggered.gag` is `def.gag`. Gag consequences are not asserted here (`gags.test.ts`, `threatTrio`).
- Keep `it('only names gags the sim knows')`. Add `it('only names icons the client draws')` only if it adds a check beyond the schema; otherwise skip it.

### Testing

- **`src/sim/threats/gags.test.ts`** (Node). Derive every number from `createTestContent().feel`, never from magic numbers.
  - `applyGag` for `outlet_hair` pushes no event and touches no prop.
  - `stairs_slide` pushes exactly one `NearMiss{t: world.time.sim, threatId, gag}`.
  - `table_object_fall` on the frozen room through `createSim` (real Rapier):
    - the mug gets the impulse: after one step its `xM` grew and `zM` did not change; after 1 s it is `isOnFloor`;
    - the vase is not pushed;
    - a broken mug is skipped;
    - a mug already on the floor is skipped (nothing pushed: no prop wakes);
    - with `propReachM` below 0.2 nothing is pushed;
    - a prop exactly at the anchor is pushed along the baby's gaze (a hand-built geometry, or a scripted `PhysicsPort` double that records `applyImpulse` calls; `propsSystem.test.ts` has one);
    - ties go to the lower index.
  - Every `GagId` has an entry (compile-time via the `Record`; a runtime `it.each(GAG_IDS)` that `applyGag` does not throw).
- **`threatFsm.test.ts`:** the event order (T2).
- **Catalogue:** 3 defs × 4 cases, plus the « planned by no level » check (prove it once by hand with a temporary def; do not commit it).
- **Golden `threat_trio`** (`tests/golden/threatTrio.test.ts`, like `propFall.test.ts`). It pins:
  - three `ThreatTelegraphed` with `kind` `outlet`, `stairs`, `coffee_table_object` in that order;
  - three `GagTriggered` with their gags;
  - one `NearMiss` right after the stairs' `GagTriggered` (same `t`);
  - a `PropImpact` for `mug_01` after the table gag, and the vase's `PropBroken`;
  - final `mess` = `{propsOnFloor: 1, propsBroken: 1}`;
  - bit-identical replay.
  - If the vase does not break at the gag's step phase, **do not** retune the vase. Note the impulses in the Debug Log, adjust `pushImpulseNs` within 1.15's 0.68 to 0.78 window, say so, and keep `tests/support/testFeel.json` and `content/feel.json` equal for this key.
- **Mutation checks** (Debug Log, as 1.14 and 1.15 did): comment out the `pushProp` call of `table_object_fall`, then the `NearMiss` push; each must fail tests. Restore.
- **Coverage:** `src/sim` stays ≥ 90 % (`npm run test:coverage`).
- **Client:** `threatMarkers.test.ts`, `gags.test.ts` (client), `levelScene.test.ts` (`setBabySlide` moves the baby view and allocates nothing per frame), `babyView.test.ts` (`setSlideM`).
- **e2e:** T8. Follow `props.spec.ts` / `timeEffects.spec.ts`: `__PP__` only, `collectProblems`, no screenshot.

### Regression traps

- **Golden hashes move for every scenario** (`feelHash`: the feel gains `gags`), and `outlet_parry` also moves `levelHash` (the outlet def gains `icon`, and `levelHash = hashJson(level)` includes the defs, `createSim.ts:160`). Event sequences must not move. Explain this in the Completion Notes, as 1.14 and 1.15 did.
- **`tests/support/testFeel.json` must gain `gags`**, or every sim test fails `FeelSchema`. `testOutlet.threat.json` must gain `icon`.
- **`createTestLevel` callers** that pass outlet entries keep working. Only its def lookup widens.
- **Bots:** `responseOf` and `threatTiming` must need no change. If one does, a threat name leaked into them.
- **The live level now has three threats:** `npm run sim` reports and the autoplay world hash change. Both sides compute the hash live, so nothing pinned moves. Specs that index `world.threats[0]` still see the outlet (D8).
- **`threatMarkerEntries` signature change:** grep every caller, including `src/debug/**` and the e2e support.
- **Event order inside a gag step:** `ResponseResolved`, `GagTriggered`, `NearMiss` (from `runThreats`), then the prop events (from `runPhysics`, later steps). The client's `threatFeedback` plays the gag cue on `GagTriggered` only, so `NearMiss` plays nothing (it is not in `feedback.json` › `events`, D7). Adding it there would make a miss sound twice.
- **`SIM_EVENT_TYPES`** stays sorted: `NearMiss` goes between `InvariantViolated` and `PapaArrived`. `content:check` validates `feedback.json` event names against it.
- **`loop.ts`, `testApi.ts`, `biome.json`, `tests/architecture/**`, `runDirector`, `runBaby`, `propsSystem.ts` and `rapierPhysics.ts`** need **no** change. If one seems needed, stop and write why in the Debug Log first.
- **Copy `drainEvents()`** before stepping again (it is a reused array).
- **Payload:** four short clips must keep `.glb` + clips ≤ `LEVEL_PAYLOAD_MAX_BYTES` (the test sums them).

### Previous story intelligence (1.13 to 1.15 and their reviews)

- **Review hunts:**
  - comments that disagree with the code (fix every comment that names 1.16: `gags.ts:5`, `propsSystem.ts:15`, `responseChoreography.ts:7`, `deferred-work.md`);
  - edge values (prop exactly on the anchor, no prop, reach 0);
  - allocation in per-step and per-frame paths (`applyGag` allocates only its events; the slide offset writes into existing vectors);
  - exact comparisons where the arithmetic is exact (hash equality for replay, never `toBeCloseTo` on Rapier poses);
  - every client fallback logs a `warn`.
- **Patterns to copy:**
  - a data list plus a completeness proof for new unions (`THREAT_ICONS`; `GAG_IDS` keeps its role);
  - frozen test fixtures for every live content file a test reads (feel, geometry and now the three threats), except where a test exists to prove the live file (the catalogue);
  - a by-hand check in the Debug Log;
  - one implementation commit `Story 1.16 : …` (in French) that also touches the story file, `sprint-status.yaml`, `deferred-work.md` and `project-context.md`.
- **1.15 calibration:** the contact impulse varies by about ±30 % with the phase of the push in the 10 ms grid; 0.72 N·s worked at every phase tried. The gag's push lands wherever the window expires, so check the golden's numbers rather than assuming.
- **1.15 Rapier quirk:** a prop–prop contact can be reported as `otherPropId: null` for the lighter prop when its floor contact dominates. Do not assert `otherPropId` in `threatTrio` beyond what the golden shows.
- **1.13:** the screenshot references are per OS; any visual change means refreshing both (memory: the Docker command mounts the `pp-node-modules` volume).
- **1.12:** `simReport`'s threat → def map is built at `createSim`. With three planned threats it is complete; there is no dynamic spawn yet.

### Project Structure Notes

- **New files:**
  - `content/threats/stairs.json`, `content/threats/coffee_table_object.json`;
  - `tests/support/testStairs.threat.json`, `tests/support/testCoffeeTableObject.threat.json`;
  - `src/sim/threats/gags.test.ts`;
  - `tests/golden/threatTrio.test.ts`, `tests/golden/journals/threat_trio{,.expected}.json` (generated);
  - `tests/e2e/threats.spec.ts`;
  - `public/assets/audio/{tel_stairs,gag_stairs,tel_coffee_table,gag_coffee_table}.m4a` (generated).
- **Modified files:**
  - `src/sim/threats/{gags,threatFsm}.ts`, `src/sim/events.ts` (+ tests);
  - `src/content/schemas/{threat,feel}.ts`, `content/_schemas/{threat,feel}.schema.json` (generated), `content/feel.json`, `content/feedback.json`, `content/threats/outlet.json`, `content/levels/salon_crawler.json`;
  - `tests/support/{testFeel.json,testOutlet.threat.json,testContent.ts}`;
  - `tests/threats/threatCatalog.test.ts`, `tests/content/{threatSchema,feelSchema}.test.ts`, `tests/bots/{perfectBot,idleBot}.test.ts`, `src/sim/determinism.test.ts`;
  - `tests/golden/scenarios.ts`, every `tests/golden/journals/*.json` (regenerated: hashes only);
  - `src/client/ui/world/threatMarkers.ts`, `src/client/render/{gags,levelScene}.ts`, `src/client/render/views/babyView.ts`, `src/client/boot.ts`, `src/client/app/levelSession.ts`, `src/client/feedback/responseChoreography.ts` (comment) (+ tests);
  - `tools/audio/makePlaceholderAudio.ts`;
  - `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, this file.
- **No change** to:
  - `biome.json`, `tests/architecture/**`, `loop.ts`, `testApi.ts`;
  - `runDirector`, `runBaby`, `propsSystem.ts`, `rapierPhysics.ts`;
  - `snapshot.ts` (`World` gains no field, so the snapshot stays version 5);
  - the bots' source;
  - the `.blend` and the geometry (the anchors and props already exist).

### Project Context Rules

- New threat = new JSON (+ maybe a gag), never a class. Cross-references (threat → anchor, → cues, gag ids) pass `content:check`.
- The sim:
  - is pure and deterministic, with no `Math.random`, `Date` or trigonometry need (only `Math.sqrt` here);
  - never logs and never uses `try/catch`;
  - only allocates for events in the gag path.
- Systems never call each other. `applyGag` and `pushProp` are helpers called inside `runThreats`. Change state only through `enter…State`, and `gags.ts` writes no state.
- Every tunable is in `feel.json` and validated by Zod, with unit suffixes (`pushImpulseNs`, `propReachM`). Art constants live at the top of the client file that uses them (`GAG_SLIDE_M`, …), as in `gags.ts` and `liftHop.ts`.
- Events are PascalCase past tense with `type` and `t`. `NearMiss` is a noun phrase like the epic's name; it is kept because the epic and 1.22 name it so. Mention it in the Completion Notes.
- Every feedback entry with `audio` has `visual` and `haptic`. Reduced motion is client-only and never touches sim timing.
- e2e drives the game through `__PP__` only, with `freeze` + `advance` and no `waitForTimeout`. Goldens are never loosened, and regenerated references are named in the story.
- Run `dev`, `e2e` and `ci` with `VITE_DEBUG_ALLOWED` unset (memory, `CLAUDE.md` › Trap).

### Deferred by this story (add to `deferred-work.md`)

- **« Le bébé se hisse »**: the baby sphere does not rise against the table; the approach ends at the nearest open cell. Pose for E7 (with the lift).
- **« Papa retire l'objet »**: a success leaves the prop in place (D5). An E7 animation, or a `PhysicsPort.setPose` if a later gag needs it.
- **The stairs slide is a view offset** (D6), with no height and no `ANCHOR_stairs_bottom`. E7.
- **`outlet_hair` is not a near miss** (D3). Geo decides (Open points).
- **The coffee-table threat is still targeted when no object is left on the table** (the mug fell): its gag then pushes nothing. Story 1.18's wave director may skip a threat whose gag has no target.
- **Distinct haptics and visuals per telegraph** beyond the icon: story 2.4.
- **Still open from 1.10 to 1.12:** multi-touch, overlapping presses, `responseChoreography`'s single queue, anchor kinds (`deferred-work.md` L176, L184, L195, L203). They need two simultaneous threats: story 1.18.

### Open points for Geo (do not block the dev)

1. Should the outlet's gag also count as a near miss (« Hurlement »)? It is one line in `gags.ts`.
2. A success on the coffee table leaves the mug on the table (D5). Do you want Papa to actually take it away, so the threat cannot come back?
3. The four sounds and the two glyphs are placeholders made by the dev. Listen to them and look at them.
4. `cooldownMs` 6000 and the `fromMs` 4000 / 10 000 / 16 000 of the live level are guesses.

### References

- `_bmad-output/planning-artifacts/epics.md` › Story 1.16 (L936-958); 1.18 (L1001-1031); 1.22 (L1118-1151); 2.2 (L1246-1270); FR26, FR27.
- `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md` › Catalogue des menaces (L228-237), Note de Maman (L386-399), prototype scope (L494).
- `_bmad-output/planning-artifacts/game-architecture.md` › P1 (L672-690), level example (L1005-1021), naming (L537, L630, L641), event naming (L400).
- `_bmad-output/project-context.md` › Content & feel, Feedback, Testing Rules, Critical Don't-Miss Rules.
- `_bmad-output/implementation-artifacts/1-15-physique-legere-des-objets.md` (`pushProp`, calibration, Rapier quirks), `1-10-…` (threat FSM, catalogue), `1-11-…` (markers, gags presentation, cues), `1-13-…` › Screenshots, `deferred-work.md` L166, L176, L178, L184, L195, L203, L213.
- Code: `src/sim/threats/{gags,threatFsm,threatSystem}.ts`, `src/sim/director/directorSystem.ts`, `src/sim/baby/babySystem.ts`, `src/sim/physics/propsSystem.ts`, `src/sim/createSim.ts:108-180`, `src/client/ui/world/threatMarkers.ts`, `src/client/render/gags.ts`, `src/client/boot.ts:355-365,470-480`, `tests/threats/threatCatalog.test.ts`, `tests/support/testContent.ts`, `tools/audio/makePlaceholderAudio.ts`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), via the `gds-dev-story` workflow.

### Debug Log References

- **T0 baseline** (`(unset VITE_DEBUG_ALLOWED; npm run ci)`, untouched tree; the shell did export `VITE_DEBUG_ALLOWED=false`): 159 test files, 2319 unit tests, 178 e2e. Green.
- **Precondition:** 1.15 is `done`, no unchecked review finding; `pushProp` has its `Number.isFinite` guard, the `feel.physics.maxPushImpulseNs` clamp (3 N·s, above the 0.72 N·s push, so D4's chain holds) and `try/finally` around `onImpact`.
- **Final run** (`npm run ci`, after the last code change; only docs changed since): 161 test files, 2393 unit tests, 180 e2e (178 + the 2 of `threats.spec.ts`), `src/sim` coverage above its 90 % thresholds (all files 97.9 % statements), typecheck, lint, `content:check` and `build:playtest` green.
- **Unit-suffix test:** `propReachM` is a bare `M` ending, which `feelSchema.test.ts` refuses (« a length is spelled out »; the story assumed it was known). Added `ReachM` to its list beside `RadiusM` and `DistM`, with an assertion.
- **A real bug found by the new clip test:** `addThump` of `makePlaceholderAudio.ts` broke out of its loop on its first sample (the attack envelope is 0 there), so no thump was written and only the clicks sounded. The « no two clips alike » correlation test returned NaN on the silent clip. Fixed (`THUMP_ATTACK_MS`, `THUMP_AUDIBLE_FLOOR`).
- **`assets:audio` is not reproducible byte for byte (the story said to stop if the seven existing clips change; here is why).** Two consecutive runs on the same tree differ: `afconvert` writes a creation time into the `.m4a` header (12 bytes at offset 51), and for `baby_babble_loop` the decoded PCM differs between runs (201 bytes between two runs), while `music_crawler_calm` differs from the committed file by about 2000 of 700 000 PCM bytes. The five short clips decode to identical PCM. The existing synthesis is untouched (separate seeds, `makePlaceholderAudio.test.ts` checks determinism). I restored the seven existing files from git (`git checkout -- public/assets/audio`) and kept only the four new ones. Noted in `deferred-work.md`.
- **The sounds were measured, not listened to** (I cannot hear). Measured on the shipped `.m4a`, decoded with `afconvert`:
  - `tel_stairs`: 400 ms, 5 attacks, 70 to 110 Hz thumps (the outlet's telegraph is one rising buzz, 260 → 550 Hz, 1 attack);
  - `tel_coffee_table`: 500 ms, one swelling tone wobbling between 160 and 240 Hz over a scrape;
  - `gag_stairs`: 600 ms, 5 thumps falling 170 → 80 Hz, then a ~990 Hz chirp;
  - `gag_coffee_table`: 350 ms, one whistle gliding 1130 → 500 Hz (no crash);
  - for contrast `gag_outlet`: 500 ms, a crackle then a bzzt falling 1390 → 150 Hz.
  `makePlaceholderAudio.test.ts` also checks that no two telegraph or gag clips correlate above 0.5. **Geo: please listen to them** (Open point 3).
- **Calibration:** none needed. In `threat_trio` the first coffee-table gag (t = 7860) pushes the mug at 0.72 N·s; the mug hits the vase at t = 8280 with 0.3997 N·s (the vase breaks at 0.35), the vase's own floor impact follows, and the mug lands at 8640. No retuning of the vase or of `pushImpulseNs`.
- **Golden diff** (checked by script against `HEAD`): `baby_wander`, `core_basic`, `papa_walk`, `prop_fall` change only `feelHash`; `outlet_parry` changes `feelHash` and `levelHash`. The five `*.expected.json` files are untouched, so `eventTypes`, `eventsHash` and the world hash are identical. New: `threat_trio.json` and `threat_trio.expected.json`.
- **Mutation checks:**
  - `pushProp` of `table_object_fall` commented out: 10 tests fail (`gags.test.ts` × 7, `threatTrio.test.ts` × 2, the `threat_trio` golden replay);
  - `NearMiss` push removed: 6 tests fail (`gags.test.ts`, `threatFsm.test.ts`, `threatTrio.test.ts`, `idleBot.test.ts`, the golden replay, the determinism run).
  Both restored (`diff` against a copy: identical).
- **Catalogue test by hand:** a temporary `content/threats/ghost.json` (planned by no level) fails with `"ghost" is planned by no level`; deleted.
- **`npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3 --until-ms 60000`:** the three defs, all `perfect` at offset 0 (outlet 24 responses, stairs 21, coffee_table_object 18), 0 gags, 100 % success. **`--bot idle`:** 51 gags in 3 runs (`outlet_hair` 18, `stairs_slide` 18, `table_object_fall` 15), every response `fail` / `late`. `sim:replay` on a perfect and an idle journal: `replay matches`.
- **By hand (Playwright script with screenshots, not a live session; Chromium, 844 × 390, `/?debug=1`, frozen level advanced by steps):**
  - at the stairs' telegraph: the stairs glyph (three steps) in the blue circle with the yellow pulsing halo, on the step at the right of the room;
  - at the coffee table's telegraph: the mug glyph (a cup with its handle) with the halo over the table;
  - after the stairs gag: the baby sphere is away from the stairs toward the room (the slide), then comes back;
  - after the table gag: the mug leaves the table, the vase is broken (`mess` = `{propsOnFloor: 1, propsBroken: 1}`), the mug on the floor at x = 1.63;
  - no console error or page error.
  I did not play it live with sound: three distinct telegraph sounds are verified by measurement only (above).
- **E2E:** the existing specs that assumed the outlet is the only threat (`threat.spec.ts`, `timeEffects.spec.ts`, `autoplay.spec.ts`, `feedback.spec.ts`, `baby.spec.ts`) all passed unchanged, because the outlet stays first (D8). `autoplay-frozen-*` screenshots did not move (the frame is the first outlet telegraph): **no reference regenerated**, on either OS.
- **In `threats.spec.ts`:** the CSS2D renderer only attaches a marker to the DOM the first time it is shown, so the spec reads the glyph of the one visible marker at each telegraph (outlet, stairs, mug) and checks that the three differ, rather than counting three elements.

### Completion Notes List

- **Schemas and feel (T1):** `THREAT_ICONS = ['bolt', 'stairs', 'mug']` and the required `icon` of `ThreatDefSchema`; `feel.gags.tableObjectFall.{pushImpulseNs 0.72, propReachM 0.5}`, in `feel.json` and the frozen fixture; `content/_schemas/{threat,feel}.schema.json` regenerated; `ReachM` added to the unit-suffix test.
- **Sim (T2):** `NearMiss{t, threatId, gag}` event (sorted in `SIM_EVENT_TYPES`); `gags.ts` gains `stairs_slide` and `table_object_fall`, `applyGag` over `GAG_CONSEQUENCES: Readonly<Record<GagId, …>>` of module-level functions; `gagThreat` calls it after `GagTriggered`, so the order is `ResponseResolved`, `GagTriggered`, `NearMiss` at the same `t`. `table_object_fall` picks the nearest unbroken off-floor prop within `propReachM` of the anchor (ties to the lower index) and calls 1.15's `pushProp` along the horizontal unit vector away from the anchor (the baby's gaze when the prop is exactly on it), with `Math.sqrt` only. `outlet_hair` stays a no-op (D3). No other sim file names a threat, a gag or an anchor (`git diff src/sim`: only `events.ts`, `gags.ts`, `threatFsm.ts` and tests).
- **Content (T3):** `stairs.json`, `coffee_table_object.json` and their frozen copies; `createTestThreats()`, `createTestStairs()`, `createTestCoffeeTableObject()`, `stairsEntry`, `coffeeTableEntry`; `createTestLevel` now resolves every entry's def from the three frozen ones and throws on an unknown def (it used to drop it silently); `salon_crawler.json` plans outlet 4000, stairs 10 000, coffee table 16 000.
- **Catalogue (T4):** every def planned at the anchor a live level plans it, the def under test from 0 ms and the others at 600 000 ms; the release comes from an exhaustive `switch` on `response`; the threat under test is found by `defId`. 3 defs × 4 cases, plus `"<id>" is planned by a live level`. `deferred-work.md:178` closed.
- **Sounds and cues (T5):** four synthesized clips and four cues, each with `audio`, `visual` and `haptic`.
- **Client (T6):**
  - `THREAT_ICON_PATHS: Record<ThreatIcon, string>` and `threatMarkerEntries(threats, anchors, defs)` (a def the level lacks draws a bolt, with a `warn`);
  - `GAG_PRESENTATIONS` gains `babySlide`; `slideOffsetAt`, `slideDirection`, the `GAG_SLIDE_*` art constants, `GagStage.setBabySlide`, `GagFx.start(…, slideDirX, slideDirZ)`; reduced motion drops the slide;
  - `babyView.setSlideM` (applies the offset at once and again in `update`, no allocation); `LevelFx.gag` takes the direction; `boot.ts` computes it from the threat's anchor and the baby into one reused object;
  - `responseChoreography.ts` comment now says that 1.18 decides.
- **Goldens, bots, determinism (T7):** `threat_trio` (frozen room, seed 42, 40 s, three defs planned at 0 ms, no input) and `threatTrio.test.ts`; existing goldens moved only as described in the Debug Log; `perfectBot` and `idleBot` cases on a three-threat level (`botSupport` gains `botTrioLevel` and a `level` option, and derives the bots' `responses` from the frozen defs with `botResponsesOf`); a 10 000-step determinism run of the three threats with periodic presses and taps.
- **`NearMiss` name:** a noun phrase, not past tense, kept because the epic and story 1.22 call it that.
- **Not done, on purpose (the story's no-change list):** `loop.ts`, `testApi.ts`, `biome.json`, `tests/architecture/**`, `runDirector`, `runBaby`, `propsSystem.ts`, `rapierPhysics.ts`, the bots' source and `snapshot.ts` are untouched.
- **`--bot idle` and `NearMiss`:** the sim report counts gags by `GagId`, not `NearMiss` as an event; the 18 `stairs_slide` gags are the near misses, and the tests check one `NearMiss` per such gag. A dedicated counter waits for 1.22 (`deferred-work.md`).
- **Open points for Geo (from the story, unchanged):** should the outlet's gag be a near miss; should a success on the coffee table really take the object away; listen to the four sounds and look at the two glyphs (both placeholders); `cooldownMs` 6000 and the 4000 / 10 000 / 16 000 `fromMs` are guesses.

### File List

**New**
- `content/threats/stairs.json`, `content/threats/coffee_table_object.json`
- `tests/support/testStairs.threat.json`, `tests/support/testCoffeeTableObject.threat.json`
- `src/sim/threats/gags.test.ts`
- `tests/golden/threatTrio.test.ts`, `tests/golden/journals/threat_trio.json`, `tests/golden/journals/threat_trio.expected.json`
- `tests/e2e/threats.spec.ts`
- `public/assets/audio/tel_stairs.m4a`, `public/assets/audio/gag_stairs.m4a`, `public/assets/audio/tel_coffee_table.m4a`, `public/assets/audio/gag_coffee_table.m4a`

**Modified**
- Sim: `src/sim/events.ts`, `src/sim/events.test.ts`, `src/sim/threats/gags.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/threats/threatFsm.test.ts`, `src/sim/determinism.test.ts`
- Content: `src/content/schemas/threat.ts`, `src/content/schemas/feel.ts`, `content/_schemas/threat.schema.json`, `content/_schemas/feel.schema.json`, `content/feel.json`, `content/feedback.json`, `content/threats/outlet.json`, `content/levels/salon_crawler.json`
- Client: `src/client/ui/world/threatMarkers.ts`, `src/client/render/gags.ts`, `src/client/render/levelScene.ts`, `src/client/render/views/babyView.ts`, `src/client/boot.ts`, `src/client/app/levelSession.ts`, `src/client/feedback/responseChoreography.ts`
- Client tests: `src/client/ui/world/threatMarkers.test.ts`, `src/client/ui/world/worldUi.test.ts`, `src/client/render/gags.test.ts`, `src/client/render/levelScene.test.ts`, `src/client/render/views/babyView.test.ts`, `src/client/app/levelSession.test.ts`, `src/client/input/hitTest.test.ts`, `src/client/input/inputMapper.test.ts`
- Tests and support: `tests/support/testContent.ts`, `tests/support/testFeel.json`, `tests/support/testOutlet.threat.json`, `tests/support/botSupport.ts`, `tests/threats/threatCatalog.test.ts`, `tests/content/threatSchema.test.ts`, `tests/content/feelSchema.test.ts`, `tests/bots/perfectBot.test.ts`, `tests/bots/idleBot.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`
- Goldens: `tests/golden/scenarios.ts`, `tests/golden/journals/{baby_wander,core_basic,outlet_parry,papa_walk,prop_fall}.json` (hashes only)
- Tools: `tools/audio/makePlaceholderAudio.ts`
- Docs: `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file

## Change Log

- 2026-10-27: story created (create-story).
- 2026-10-27: implemented (dev-story): the stairs and the coffee-table object as data, `NearMiss` and `applyGag`, the icons, four placeholder sounds and their cues, the `threat_trio` golden, bot and determinism cases, `threats.spec.ts`. Status → review.
