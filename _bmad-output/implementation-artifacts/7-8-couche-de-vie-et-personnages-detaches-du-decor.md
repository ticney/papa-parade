---
baseline_commit: 3d5b4c6d1fe2784ce88f68e34cda54bdcbbcf010
---

# Story 7.8: Couche de vie et personnages détachés du décor

Status: review

<!-- Ultimate context engine analysis completed - comprehensive developer guide created. -->

## Story

As a player,
I want Papa and the baby to move all the time, with weight and momentum, and to stand out from the room,
so that they look alive and read at a glance on a phone.

**Requirements covered:** FR79 (the life layer and the sharpness parts), NFR2. **UX:** UX-DR18 (reduced motion). **Depends on:** the rigs and kit of 7.2, the hulls and toon ramp of 7.3, the follow camera and off-screen bubbles of 9.2 / 9.3, the look of 3.7.

**Scope:** client only. A procedural « life layer » on top of the mixer (eased fades per passage, a damped turn that overshoots, Papa's lean, breathing, Papa's gaze, the fatigue stoop), the characters' own toon materials (a light rim, an optional 4th tone) and a thicker outline. Every number in `feel.json › characters`, hot in the feel panel. **No new asset, no `.blend`, no `.glb`.**

**Not in this story:**
- The forelock (7.9: needs the v2 skeleton). The shuffling walk above 70 fatigue (7.14). Eyebrows and expressions (7.10). Starts, stops, idles (7.11).
- Any change to `src/sim`, `src/bots`, the `.blend` / `.glb` files, `public/_headers`, `content/levels/`, `content/threats/`, `content/sequences/`.
- Mama, the dog, the children (no entity yet).
- The tighter framing of the big salon (`feel.camera.frameWidthM`): Geo's to try in the panel, no story.

## Acceptance Criteria

The epics' criteria (`epics.md › Story 7.8`), made testable. The decisions D1-D12 below are part of them.

1. **Fades per passage.** When a view changes clip, the incoming clip's weight follows an ease-in-out curve (zero slope at both ends) over the passage's own duration: `fades.startMs` (100) from a still loop to a travelling one, `fades.stopMs` (200) from a travelling loop to a still one, `fades.returnMs` (150) from a one-shot back to the loop, `fades.otherMs` (100) for anything else (into a one-shot, still → still, travelling → travelling) `[ASSUMPTION]`. The weights still add up to 1 at every update, however the fades are cut short (7.2 review). `feedback.json › characters.crossFadeMs` is gone (D4).
2. **Damped turn.** When Papa's or the baby's wanted yaw changes, the drawn body turns on an under-damped spring: it starts and stops smoothly, first reaches the target after about `turn.reachMs` (250), and overshoots a 90° turn by 5 to 10° (never more than `turn.overshootMaxDeg`, 10) before settling. `pose.yawRad`, the sim's heading and every marker stay as they are, and the baby's head keeps his gaze exact while his body springs. `turnRateDegPerSec` and `turnToward` are gone (D5).
3. **Lean.** Papa's torso (the `spine` bone) leans up to `lean.maxAccelDeg` (10) along his drawn acceleration or braking, and up to `lean.maxTurnDeg` (8) toward the inside of a turn, smoothed, and back to 0 when his drawn speed and heading are steady (D6).
4. **Breathing.** Papa and the baby breathe over their clip on a `breath.periodMs` (3000) cycle, which becomes `breath.alertPeriodMs` (1500) while `world.gauges.catastrophePct` is above `feel.catastrophe.alertPct` (70); the phase never jumps when the period changes. Papa's breath stops while `world.sequence.stealth.breathHeldAt !== null` (story 4.9) and resumes after (D7).
5. **Gaze.** Papa's head (the `head` bone, relative to his body, clamped to ±`gaze.maxYawDeg`, 60) follows, in this order: the baby when he is drawn on screen (not off the follow frame, not `mischiefSilent`) and Papa is not responding; else the visible telegraphed threat whose chrono-ring is the most advanced (ties: the lowest threat id); else straight ahead. It never follows the suspicious silence. A test scans the gaze modules for `windowOpenAt`, `feintAt`, `realWakePct` and `toleranceMs` and finds none (D8).
6. **Fatigue stoop.** Papa's `spine` pitches forward by `stoop.maxDeg` (15) × `fatigue / 100`, on top of the look's parts (mash, hair on end, shirt inside out). His eyelids move only for the micro-sleep and sleep, as today: a unit test at fatigue 100 with no micro-sleep finds them open (D9).
7. **Standing out.** Papa and the baby get their own toon materials (not the room's cache): a light rim on their silhouette (`look.rimStrengthPct`, `look.rimWidthPct`, in `PALETTE.paper`), and a hull `look.outlineWidthPct` (150) % as wide as the furniture's and props' (`feedback.json › render.outlines.widthM`). A 4th shading tone is tried through `look.isFourthToneOn` (`false`) and `look.fourthTonePct`. No draw call is added (D10).
8. **Data, hot.** Every value of this story lives in `feel.json › characters` (client only, like `camera`), with Zod bounds and `describe`s, regenerated `content/_schemas/feel.schema.json`, and is read from `world.feel.characters` every frame, so a change in the feel panel shows on the next frame. `crossFadeMs` and `turnRateDegPerSec` leave `feedback.json`; `squash`, `clipSpeeds`, `papaClipFacing`, `busyProps` stay there (D1).
9. **Reduced motion.** Breathing and lean are 0, and the turn uses a damping of 1 (no overshoot). The fades, the gaze, the stoop, the rim, the outline and every pose that carries a state stay. `EXPERIENCE.md`'s table already has the two rows (correct-course of 2026-11-08): check they match what ships and fix them if not (D11).
10. **The game does not move.** No file changes under `src/sim`, `src/bots`, `content/levels/`, `content/threats/`, `content/sequences/`, `public/`, `assets-src/`. `npm run golden:update` is run once, deliberately: **`feelHash` and `worldHash` move in `tests/golden/journals/`, nothing else** — no `eventTypes`, no `eventsHash`, and the world without its `feel` hashes as before (D2). `npm run sim` with the four bots on the three levels, seed 1, gives the same reports as `main` except for content-hash fields.
11. **Reproducible.** Nothing in the life layer reads real time, `Math.random`, `Date`, `performance` or `world.rng`; everything advances on the sim clock (D6 of 7.2) and the springs step at `STEP_MS`. The same sequence of frames gives the same bone rotations; a frozen clock (`__PP__.freeze`, a pause, a hitstop, the end photo) holds the pose (D12).
12. **Budgets and latency.** `tapLatency.spec.ts` passes (a tap's visual stays ≤ 50 ms). `perf.spec.ts` passes on the built playtest (`npm run e2e:dist`): p95 ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles, with the numbers in the notes. Nothing in the rAF path allocates.
13. **Geo has seen it.** Screenshots in `7-8-screenshots/` (list in T10), the two sets of macOS references (`autoplay`, `afterEffects`) regenerated deliberately, opened, and said so. Every image not opened is listed as not opened. The feel of the motion, the rim and the 4th tone are Geo's call; the merge waits for his visual OK.

## Tasks / Subtasks

- [x] **T0. Read before touching** (all ACs)
  - [x] Read « What exists » below, then `characterRig.ts`, `characterMotion.ts`, `characterClips.ts`, `papaView.ts`, `babyView.ts`, `levelScene.ts`, `outlineHull.ts`, `toonMaterial.ts` in full. Check `env | grep VITE_` (memory: the shell exports `VITE_DEBUG_ALLOWED=false`).
  - [x] `git worktree list`: note any open story touching `feel.json`, `feel.ts`, `content/_schemas/`, goldens, `levelScene.ts` or the views. Whichever merges second regenerates schemas and goldens after merging `main`.
- [x] **T1. Data first** (AC 8, D1, D2)
  - [x] `CharactersSchema` in `src/content/schemas/feel.ts` (strict, after `camera`, `describe` « Client only »), with the D1 shape, bounds and refines; `FeelSchema.characters`. `content/feel.json` and `tests/support/testFeel.json` get the block; check whether `tests/tools/vite/fixtures/feelSample.json` is a whole feel (9.2 found it is not) and update it only if it is.
  - [x] `FeedbackSchema.characters` loses `crossFadeMs` and `turnRateDegPerSec`; `content/feedback.json`, `tests/support/testContent.ts` follow.
  - [x] `npm run content:schemas`. `tests/content/feelSchema.test.ts`: every bound and refine pinned; the unit-suffix rule passes with D1's names (add nothing to `UNIT_SUFFIX` unless a name truly needs it, and say why in its comment, as 9.2 did).
  - [x] `npm run ci:fast`: the goldens go red on hashes only. `npm run golden:update` once; read the diff (D2) and write the file count in the notes. Re-pin the whole-journal `PINNED` of `tests/bots/humanBotRegression.test.ts` only if it moved, with `PINNED_COMMANDS` unchanged, and say so in its comment.
- [x] **T2. The pure kit, no Three** (AC 1-6, 11, D3-D9, D12) — each with its unit test next to it
  - [x] `views/characterSpring.ts`: a 1-D spring stepped at `STEP_MS` with an accumulator on the sim clock (`omegaOf(reachMs, dampingRatio)`, a step, an angle variant on the unwrapped angle). Tests: no overshoot at damping 1; 90° at 0.6 overshoots within 5-10°; the cap; `dtMs` 0 holds; the same span split in 1, 3 or 7 frames with a constant target gives the same value at the end.
  - [x] `views/characterFades.ts`: `fadeMsOf(fromTravelling, toTravelling, kind, fades)` and the ease (`smoothstep`). Travelling states as `Record<PapaState, boolean>` and `Record<BabyState, boolean>` in `characterClips.ts` (a new state is a type error).
  - [x] `views/lifeLayer.ts`: lean (from drawn speed and body turn rate), breath (accumulated phase, period switch, held breath), stoop (from fatigue), each a pure function writing into a scratch object.
  - [x] `views/papaGaze.ts`: the choice of D8 from inputs the caller fills (baby shown, responding, best threat point or none), the yaw relative to the body, the clamp.
- [x] **T3. The rig** (AC 1, 11, D3, D4)
  - [x] `createCharacterRig(asset, toon, outlines)`: no fade constant; `play(clip, timeScale, fadeMs)`, `playOnce(clip, fadeMs)`, `update(dtMs, returnFadeMs)`. The incoming track keeps a linear progress and its weight is the eased progress; the others share `1 − weight` in proportion (the 7.2 review invariant). A one-shot ends when `leftMs <= returnFadeMs`.
  - [x] Life-layer bones: the rig records the rest quaternion of each bone the layer writes (`spine`, `head` for Papa; `spine` for the baby) and restores it **before** `mixer.update`, so that a bone no running clip keys does not accumulate (D3).
  - [x] Tests: weights sum to 1 through A → B → C at mixed durations; the ease has zero slope at both ends; a bone with no track does not drift over 1,000 updates with an offset written each time; a keyed bone shows track × offset.
- [x] **T4. The views** (AC 2-6, 9, D3, D5-D9)
  - [x] `papaView.animate` / `babyView.animate` take the frame's life inputs (a scratch object the scene fills: `fatigue`, `isAlert`, `isBreathHeld`, `isMotionReduced`, the gaze target, `world.feel.characters`). Order in a frame: clip choice → restore life bones → `rig.update` → life offsets → eyelids last (D3).
  - [x] Papa: the turn spring replaces `turnToward` (target unchanged: `papaFacingYawRad(…) ?? pose.yawRad`); lean, breath and stoop on `spine`; gaze on `head`. Baby: the turn spring on his body; `headBone.rotation.y = wrapAngleRad(pose.yawRad − bodyYawRad)` stays exact; breath on `spine`.
  - [x] Keep every existing method and getter (`bodyYawRad`, `pose`, `setEyelids`…). Remove `turnToward` and its tests once nothing calls it; keep `wrapAngleRad`.
- [x] **T5. The scene and the gaze sight** (AC 5, 8, 9, D8)
  - [x] `levelScene.update`: fill the life inputs from `world` each frame (`world.gauges.fatigue`, `world.gauges.catastrophePct > world.feel.catastrophe.alertPct`, `world.sequence.stealth.breathHeldAt !== null`, `bodies.isMotionReduced()`, `world.feel.characters`). Nothing allocated.
  - [x] `LevelScene.setPapaGazeSight(isBabyShown, threatXM, threatZM, hasThreat)` (or one scratch object): boot calls it once per frame **after** `worldUi.updateThreats` and `offscreenHud.update` (`boot.ts` ~L1517-1600), from `worldUi`'s `chronoDrawOf(id)`, the markers' entries and the follow frame. The scene applies it in its next `update` (one frame later: cosmetic). The « responding » test (`world.papa.state === 'glide'` or a `respond_*` one-shot on the rig) is the scene's.
  - [x] `realFxState()` / `__PP__.fx()`: add `papaLeanDeg`, `papaStoopDeg`, `papaHeadYawDeg`, `papaGaze` (`'baby' | 'threat' | 'ahead'`), `papaBreathDeg`, `babyBreathDeg`. Update `tests/e2e/support/testApi.ts`, `tests/support/fakeTestHost.ts`, `src/debug/testApi.test.ts`.
- [x] **T6. Sharpness** (AC 7, D10)
  - [x] `createToonMaterialCache(tones, options?)`: the characters' own instance, with a rim (an `onBeforeCompile` adding `rimStrength × smoothstep(1 − rimWidth, 1, 1 − normal.z)` of `PALETTE.paper` in view space, with a `customProgramCacheKey`) and a 12-texel gradient that draws 3 equal bands (4 texels each) or 4 (3 each) and is rewritten in place when the feel changes. The room's cache is untouched (no rim, 3 tones).
  - [x] A second `OutlineKit` for the characters (`createCharacterRig` takes it), its `widthM` uniform written when `render.outlines.widthM × outlineWidthPct / 100` changes. Papa's « Z » and the « bla bla » bubble use the characters' cache and kit.
  - [x] Uniform writes only on change; the dispose frees both caches and both kits. Unit tests: room meshes keep the room cache; character meshes never share a material with the room; the rim and the tone count follow a feel change with no new material; the number of meshes (draw calls) of a scene is the same as on `main`.
  - [x] `content:check` (`tools/content/contentChecks.ts`): refuse `look.fourthTonePct × 2.55 >= render.toonTones[0]` (the 4th tone must be the darkest); a test.
- [x] **T7. Guards** (AC 5, 11)
  - [x] `tests/architecture/characterAssets.test.ts`: add the new view modules to the `VIEWS` scan, and extend its pattern to `toleranceMs`. Add a test that the new modules contain no `Math.random`, `performance`, `Date`, `world.rng`, `nowReal` or `THREE.Clock`.
  - [x] Same file: every one-shot of both contracts lasts at least `2 × fades.returnMs` of the committed `feel.json` (closes the 7.2 deferred « one-shot no longer than `crossFadeMs` »).
  - [x] A unit test that the gaze never picks a `hidden` threat nor a `mischiefSilent` baby, and never a threat aimed at Papa.
- [x] **T8. Prove nothing moved** (AC 10, 11)
  - [x] `git diff --stat main` on AC 10's paths: empty. Goldens: D2's proof. Bots on `salon_kitchen`, `salon_crawler`, `chambre_night`, seed 1, against `main`.
  - [x] E2E on Chromium (`npm run e2e -- <specs> --project=chromium`, in the background): a new `tests/e2e/lifeLayer.spec.ts` (breath moves with sim time and holds under `freeze`; `SetFatigue` 100 stoops him and leaves the lids open; the gaze reads `baby` then `ahead` during a silence; reduced motion zeroes lean and breath), then `characters`, `reducedMotion`, `tapLatency`, `photo`, `render`, `level`, `carry`, `stealthExit`, `fatigue`, `offscreenBubble`, `salonKitchen`, `autoplay`, `testApi`, `feedback`. `characters` and `reducedMotion` check `papaBodyYawRad` against a tolerance: if the spring's settle time breaks them, wait for it to settle; never widen a tolerance without saying why.
- [x] **T9. Close and record the debts** (see « Deferred items »)
- [x] **T10. Performance and delivery** (AC 12, 13), after the last visual edit, under `caffeinate`
  - [x] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, then `npm run e2e:dist` in the background (it queues; perf alone ≈ 5 min). Then `PP_PERF_LEVEL=chambre_night` by hand if time allows. Numbers in the notes.
  - [x] `npm run e2e -- tests/e2e/autoplay.spec.ts tests/e2e/afterEffects.spec.ts --update-snapshots=all` (7.3: a plain `--update-snapshots` wrote nothing). Open all four images, say what changed.
  - [x] `7-8-screenshots/`, at 844 × 390 unless said: each of the three rooms at start, before (from `main`) and after (rim and outline); Papa at fatigue 0 and 100 side by side; Papa mid-glide (lean); three frames of a turn (before, overshoot, settled); Papa's head toward the baby and toward a ringed threat; Papa carrying at fatigue 100 (are his hands still on the baby?); the 4th tone off and on; the same at 667 × 375 for one room. Write what you saw by eye, and what you did not open.

## Dev Notes

### Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`feel.json › characters`, after `camera`, client only.** Starting values (each an `[ASSUMPTION]` of the GDD, to tune in play): `fades { startMs 100, stopMs 200, returnMs 150, otherMs 100 }`; `turn { reachMs 250, dampingRatio 0.6, overshootMaxDeg 10 }`; `lean { maxAccelDeg 10, maxTurnDeg 8, fullAccelMps2 8, fullTurnDegPerSec 360, reachMs 120 }`; `breath { periodMs 3000, alertPeriodMs 1500, papaAmplitudeDeg 1.5, babyAmplitudeDeg 2 }`; `gaze { maxYawDeg 60, reachMs 200 }`; `stoop { maxDeg 15 }`; `look { outlineWidthPct 150, rimStrengthPct 35, rimWidthPct 30, isFourthToneOn false, fourthTonePct 24 }`. Suggested bounds: fades 0-400 (`returnMs` ≤ 200), `reachMs` 50-1000, `dampingRatio` 0.3-1 (like `camera`), angles 0-45 (`maxYawDeg` 0-90), `periodMs` and `alertPeriodMs` ≥ `SCREEN_FLASH_MIN_INTERVAL_MS` with a refine `alertPeriodMs ≤ periodMs`, `outlineWidthPct` 50-300, `%` 0-100. **The alert threshold is `feel.catastrophe.alertPct`**, not a second 70: one number for the music, the face and the breath. | The AC and the architecture (« Réglages ») put them in `feel.json` so that the panel shows them (it is built from the schema: nothing to add in `src/debug/`). The sim never reads `characters`. `crossFadeMs` and `turnRateDegPerSec` were in `feedback.json` only because 7.2 avoided moving goldens; Geo chose option A (proposal of 2026-11-08: feel, and the hashes move). Read `world.feel.characters` per frame, never a copy taken at level start, or a `SetFeel` would wait for the next level. |
| D2 | **Goldens: `feelHash` and `worldHash` move, and only they.** The epics say « seules leurs empreintes `feelHash` » but `tests/golden/scenarios.ts` hashes `hashJson(sim.world)`, and `world.feel` carries the new block, so `worldHash` moves too, as in 3.6 and 9.2. What must not move: `eventTypes`, `eventsHash`, and the world outside `feel`. **Prove it** in the notes: for the regenerated journals, hash the final world without its `feel` key on `main` and on the branch and compare (a throwaway script in the scratchpad). | Same procedure as 9.2 (54 then 66 files). A golden whose events move means something in the sim reads the new keys: stop and look. |
| D3 | **Frame order, and rest before the mixer.** In `animate`: choose the loop → restore each life bone to its rest quaternion → `rig.update(dtMs, …)` → multiply the life offsets onto those bones (`bone.quaternion.multiply(offset)`) → eyelids (absolute, as today). Axes (project-context, 7.2): bones stand straight up with no roll, local X is his left, Y up, Z forward; a positive rotation about X pitches the top forward, about Y turns the head toward his left, about Z leans toward his right. Pin the signs with tests on the fixture rig. | Three's mixer rewrites only the bones a running action keys. Papa's `spine` and `head` are keyed by 15 of his 16 clips and the baby's `spine` by 10 of 14 (read from the committed `.glb`): an offset multiplied without the restore would accumulate on a frame where no clip keys the bone. The architecture fixes this order (« Ordre dans une frame »). |
| D4 | **Which passage a fade is.** Travelling states: Papa `walkPath`, `walkDir`, `glide`; baby `wander`, `approach`, `mischiefSilent` (`Record`s in `characterClips.ts`). The view gives the rig the duration: loop change → `startMs` (still → travelling), `stopMs` (travelling → still), `otherMs` (else); a one-shot in → `otherMs`; its return → `returnMs`. Ease: `smoothstep(p) = p²(3 − 2p)` on the incoming track's linear progress `p += dtMs / fadeMs`; a `fadeMs` of 0 is a cut. | The AC names three passages; a fourth duration is needed for the rest. 100 keeps it no longer than the start fade, which the architecture names « le plus long admis » for NFR2. Classifying by state, not by `clipSpeeds`, keeps `glide` (which has no speed row on purpose) a travelling loop. |
| D5 | **The turn is a spring on the drawn yaw.** Angle unwrapped toward the target (`current + wrapAngleRad(target − current)`), ω from `reachMs` and the damping (time to first reach the target), stepped at `STEP_MS` with an accumulator on `dtMs`; the excess past the target is clamped to `overshootMaxDeg`. Reduced motion: damping 1, same `reachMs`. Starting values give ≈ 8.5° on a 90° turn and ≈ 17° on 180°, clamped to 10. | `followCamera.ts` has the same kind of spring for the camera (`stepFollow`, `reachTau`): read it, reuse its maths rather than invent another, but keep the characters' spring in `views/` (it needs no `shared`). Stepping at `STEP_MS` is the architecture's « Reproductible » rule. |
| D6 | **Lean from what is drawn.** Speed from `stepSpeedMpsOf(papa)` along his drawn heading; acceleration from its change between the sim steps the view saw (keep the last speed and its `world.time.sim`); turn rate from the body spring's velocity. Target pitch = `clamp(accel / fullAccelMps2) × maxAccelDeg`, target roll = `clamp(turnRate / fullTurnDegPerSec) × maxTurnDeg` toward the inside, each through a spring of `lean.reachMs` and damping 1. Under reduced motion the targets are 0. **No special case while carrying:** the carried baby's point is gameplay and does not move (7.2 D8), and the screenshot of T10 shows whether his hands leave the baby; if they do, report it for Geo. | Glides start and stop at once in the sim, so a raw acceleration would be a spike: the spring is what makes it read as weight. |
| D7 | **Breath is an accumulated phase.** `phase += dtMs / periodMs` (period from the alert flag each frame), offset `sin(2π phase) × amplitude` on `spine` pitch, times an envelope that moves toward 1 or 0 at `4 / periodMs` per ms: 0 under reduced motion, and for Papa while his breath is held. | A sine of `clockMs / periodMs` jumps when the period changes; an accumulated phase does not. The held breath of the stealth exit is public (its breath ring is on screen), so reading `breathHeldAt` hides nothing. |
| D8 | **Gaze: the screen decides what is seen, the scene decides where to look.** Boot knows the screen (markers, follow frame, bubbles); the scene knows the rig. *Baby shown:* `baby.state !== 'mischiefSilent'` and, in a follow level, his drawn point inside the follow frame (`followFramePointOf` + `isInFollowFrame` of `shared/followVisibility.ts`, insets 0; a fixed level always shows him). A carried baby is shown. *Threat candidates:* entries whose `chronoDrawOf(id)` is not null this frame, not `followsPapa`, and with no off-screen bubble; the highest `permille` wins, ties to the lowest id. *Responding:* `glide`, or a `respond_*` one-shot on the rig. Then baby (not responding) → threat → ahead. The head yaw relative to the body is clamped to ±`maxYawDeg` and smoothed (spring, damping 1, `gaze.reachMs`); `state === 'asleep'` looks ahead. | GDD principle 5 and the architecture's « Information cachée »: the ring's per-mille is what the screen drew, so the gaze never computes it from `windowOpenAt` (`chronoRing.ts` may; the gaze may not). `wait` threats have no ring, so the duel and the fake sleep give the gaze nothing. A silence in `hidden` draws no marker. The one-frame lag (boot runs after `level.update`) is 16 ms of a cosmetic head turn. |
| D9 | **Stoop is fatigue, and fatigue only.** `fatigue` is `world.gauges.fatigue` (0-100, shown on the HUD). Kept under reduced motion (it carries a state). It never touches `eyelids`: they stay on `eyelidsAmountAt` (micro-sleep telegraph) and `setAsleep`. | GDD principle 4: outside a micro-sleep his lids never drop. |
| D10 | **The characters' own look, no new draw call.** A second `ToonMaterialCache` and a second `OutlineKit`, created in `createLevelScene` and handed to both rigs and to `papaView`'s code-made meshes. Rim in view space (`1 − normal.z`: the camera is orthographic, so the view direction is constant). The 4th tone through a 12-texel gradient (`NearestFilter`): thirds are 4 texels, quarters 3, so switching rewrites the data and sets `needsUpdate` with no new texture. Rim colour: `PALETTE.paper`, a token in code; only strength and width are feel. | Each primitive is already its own draw call: a material per character colour adds programs, not calls. Program caching: give the rim material a `customProgramCacheKey`, or three may hand it the plain toon program. `reservedHues.test.ts` must still pass (paper is no reserved hue). The rim will also catch the top of a baby hidden behind the sofa (7.3 AC 3, accepted by Geo then): note it for him, change nothing. |
| D11 | **Reduced motion, as `EXPERIENCE.md` says:** life layer's breath and lean removed, the turn does not overshoot; fades, gaze, stoop, look, clips and state poses stay. Read through `bodies.isMotionReduced()` each frame, as the door and the danger tint do. Squash stays as 7.2 (off). | UX-DR18. The rows were added by the correct-course on 2026-11-08; the forelock row is for 7.9. |
| D12 | **Reproducible, interruptible.** Only `dtMs` (sim clock) and world state drive the layer; no PRNG at all (nothing here chooses). Springs step at `STEP_MS`; with a constant target the result does not depend on how frames split the time. The end photo calls `level.update(snapshot.world, 1, now)`: it holds the pose to within the last sub-step, which is the mixers' behaviour since 7.2; do not add a special photo path. A tap or a state change needs no handling here: the layer has no « busy » pose to cut. | Architecture « Reproductible » and « Interruption ». |

### What exists, and what must keep working

- **`characterRig.ts`** (225 lines): one mixer, actions made up front, `fadeTo` / `stepWeights` with weights summing to 1 (7.2 review), `play`, `playOnce`, `update`, `clipName`, `isClipRunning`, `mixerTimeMs`, `reset`, `dispose` (frees skeletons, `uncacheRoot`). **Changes:** fade durations per call, eased weights, rest restore of life bones. **Preserved:** every getter, the « first clip plays at once », the warn-once on a missing clip or node, `EYELIDS_OPEN_SCALE`, D11 of 7.2.
- **`characterMotion.ts`:** `stepSpeedMpsOf`, `clipTimeScaleOf`, `wrapAngleRad`, `papaFacingYawRad`, `busyCycleAt` stay; `turnToward` goes with its tests.
- **`papaView.ts`:** `animate(papa, baby, dtMs)` turns the body with `turnToward(…, motion.turnRateDegPerSec, dtMs)`; `CharacterMotionConfig.turnRateDegPerSec` goes. `pose.yawRad` is the sim's heading and markers read it: never the spring's. The blob shadow does not turn. Facing rows (`drink`, `coffee_kick` → camera; `on_phone` → away from the baby) stay the spring's target.
- **`babyView.ts`:** body yaw toward the gaze, `head` written every frame as `pose.yawRad − bodyYawRad` (D9 of 7.2: the gaze is immediate). Keep that line exact; only the body springs. Carried height logic, hop, slide, lay-down untouched.
- **`levelScene.ts`:** `bodies.characters` (from `feedback.json`, once per level) feeds `createCharacterRig(…, crossFadeMs, …)` and `motion`. `update` computes `clockMs = world.time.sim + alpha × STEP_MS` and `dtMs = max(0, clockMs − lastClockMs)` (D6 of 7.2); keep that. `resetFx` resets the rigs: reset the springs, phases and envelopes there too (a restart starts at rest). `dispose` frees the new cache and kit.
- **`outlineHull.ts`:** `createOutlineKit(outlines)`, shared `widthM` uniform, `materialFor(mesh)`, `isHull`, `addOutlineHulls` (idempotent since 7.3's review). The hull is a child of the mesh: it follows skinning, squash and the life offsets for free.
- **`toonMaterial.ts`:** `createToonMaterialCache(tones)`, `swapToToon`. The room keeps calling it as is.
- **`boot.ts`:** ~L1500-1610 is `onLevelFrame`: `worldUi.updateThreats` (markers and rings), then `offscreenHud.update` (bubbles). Put the gaze sight after both. The `chronoDrawOf` record is « rewritten at each call: read it at once ».
- **`threatMarkers.ts`:** `entries` (`followsPapa`, `followsBaby`, `xM`, `zM`, `hasChronoRing`) and `chronoDrawOf(threatId)`.
- **`shared/followVisibility.ts`:** `followFramePointOf`, `isInFollowFrame` (the bot's sight and the bubbles use them); `followRig` holds the frame and centre.
- **Tests that read the old names:** `levelScene.test.ts`, `papaView.test.ts`, `babyView.test.ts`, `layDown.test.ts`, `characterRig.test.ts`, `levelSession.test.ts`, `tests/support/testContent.ts`, `tests/support/testCharacters.ts`, `tests/content/feedbackSchema.test.ts`. An assertion may change its subject, never lose its meaning; list the ones that changed.
- **E2E that read the drawn yaw:** `characters.spec.ts` L199-245 and `reducedMotion.spec.ts` L598-633 (`papaBodyYawRad` within `YAW_TOLERANCE_RAD`).

**Expected changes:** `src/content/schemas/{feel,feedback}.ts`, `content/{feel,feedback}.json`, `content/_schemas/{feel,feedback}.schema.json`, `src/client/render/views/{characterRig,characterMotion,characterClips,papaView,babyView}.ts` + new `{characterSpring,characterFades,lifeLayer,papaGaze}.ts` and their tests, `src/client/render/materials/toonMaterial.ts`, `src/client/render/levelScene.ts`, `src/client/boot.ts`, `src/client/app/{levelSession,testHost}.ts`, `src/debug/testApi.ts`, `tools/content/contentChecks.ts`, `tests/architecture/characterAssets.test.ts`, `tests/content/{feel,feedback}Schema.test.ts`, `tests/support/{testFeel.json,testContent.ts,testCharacters.ts,fakeTestHost.ts}`, `tests/e2e/lifeLayer.spec.ts`, `tests/e2e/support/testApi.ts`, `tests/golden/journals/*` (hashes), possibly `tests/bots/humanBotRegression.test.ts`, the four darwin references, `_bmad-output/project-context.md` (« Rigged characters »: `turnRateDegPerSec`, `crossFadeMs`), `deferred-work.md`, `sprint-status.yaml`, this file.

### Deferred items

Close in `deferred-work.md`, each with what happened:
- « A one-shot no longer than `crossFadeMs` ends at its first update » (L939): `returnMs` is bounded and T7's test ties it to the shortest one-shot.
- « Papa's yaw has no smoothing » (L913): its note names `turnRateDegPerSec`; update it to the spring.

Leave open, and say so: « A squash restarted mid-run » (L934), « The baby's head is not limited against his body » (L935: still true with the spring, judge in play), « Only `idle` and `walk` have carried variants » (L936), the forelock (7.9), the shuffling walk (7.14).

### Testing

- **Unit:** the four pure modules (T2), the rig (T3), the views on the fixture rig (`tests/support/testCharacters.ts`), the scene's life inputs and gaze sight, the toon cache's rim and tones, the schemas.
- **Architecture:** `characterAssets.test.ts` (T7). The existing `layerBoundaries` / Biome rules already keep `three` out of `shared`.
- **E2E (Chromium, through `npm run e2e`, in the background):** T8's list. `ci:story` is the review's.
- **Goldens:** `npm run golden:update` once, deliberately (D2). Never twice to « make it green ».

### Project Structure Notes

- New modules in `src/client/render/views/` (the architecture names it as the home of the life layer). They import `three` only where they touch bones; the maths stays pure.
- **Variance:** the architecture lists « bassin, buste, cou, tête »; Papa has no `pelvis` or `neck` until 7.9, so this story uses `spine` and `head`. 7.9 may redistribute.
- **Variance:** the epics' « seules les empreintes `feelHash` » is read as D2.

### Project Context Rules

- **Layers:** `client` may import `three`, `@sim`, `@content`, `@shared`; `src/` never imports `tools/`. `@sim` is `src/sim/index.ts` only.
- **Golden rule:** Geo tunes the feel; every number he may touch is data. Constants in `shared/constants.ts`, `UPPER_SNAKE`, unit suffix.
- **Zero allocation** in the rAF path: scratch objects, no closures or literals per frame, quaternions made once.
- **Budgets:** ≤ 100 draw calls, ≤ 100k triangles, no shadow map, no post-process. Nothing flashes above 3 Hz.
- **No `console.*`:** `log.warn('render', …)`; every fallback warns. Units as suffixes (`reachMs`, `maxYawDeg`, `rimStrengthPct`). `describe/it/expect` from `vitest`.
- **Git:** this worktree, branch `story/7-8-couche-de-vie-et-personnages-detaches-du-decor`. Commit « Story 7.8 : couche de vie et personnages détachés du décor ». Merge only after the review, a green `ci:story` and Geo's visual OK.
- **Heavy checks:** `npm run e2e`, `e2e:dist`, `ci:story` queue on `tools/ci/heavyLock.sh`; run them in the background, never `npx playwright test`. Wrap long runs in `caffeinate`.
- **Blender:** not needed. Never touch the live MCP session.

### Previous story intelligence

- **7.2:** the kit, D5-D9, the weights-sum invariant (review), « never claim a visual check you did not make »; nobody watched the characters move at the time. The 7.2 review read an identity rest rotation on the baby's `head` and `neck` and on both `eyelids`, and on no other bone: the rest restore (D3) records each bone's own rest quaternion, never assumes identity.
- **7.3:** the hull is the mesh's child; two hull materials (skinned / static) sharing uniforms; `--update-snapshots` needed `=all`; the baby's head shows above the sofa (accepted). Draw calls were 87 / 79 on the old rooms.
- **9.2 / 9.3:** a feel block, hashes regenerated (66 files), `humanBotRegression` re-pinned; `chronoDrawOf` exists for the bubbles.
- **3.7 / 3.8 (latest merges):** the look is world state (`world.papa.look`), merged with the debug overlay in `levelScene`; this story only adds on top of it.

### Latest technical information

No new dependency. Pinned `three@0.186.1`: `AnimationMixer` binds and rewrites only keyed properties (D3); `MeshToonMaterial` reads `gradientMap` with `NearestFilter`; `onBeforeCompile` with `customProgramCacheKey` is the supported way to patch a built-in material. Read them in `node_modules/three` rather than from memory.

### Open for Geo

1. **Starting values (D1)** are the GDD's « valeurs de départ ». The overshoot, the rim and the 4th tone are yours to judge in the panel.
2. **The gaze's « visible » threat (D8)** is read as « its ring is drawn on screen » (off-screen bubbles excluded). Say if a threat in a bubble should turn his head too.
3. **Carrying (D6):** no special case; if the stoop or the lean pull his hands off the baby, choose between a cap while carrying and nothing.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.8, #Story 7.9 to 7.15, Epic 7]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Animation des personnages (L542-609)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Animation des personnages (v2.4) L275-293, #Mouvement réduit L254, #Contenu et feeling L266, E7 table L1024]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-11-08.md#1, #2 (conflicts, goldens option A), #4.6, #4.7]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#Reduced motion L450-470]
- [Source: _bmad-output/implementation-artifacts/7-2-personnages-rigges-et-animes.md, 7-3-rendu-toon-final-et-effets.md, 9-2-camera-qui-suit-papa.md, deferred-work.md L913-939]
- [Source: _bmad-output/project-context.md#Rigged characters L189, #Performance Rules, #Testing Rules]
- [Source: src/client/render/views/{characterRig,characterMotion,characterClips,papaView,babyView}.ts, src/client/render/levelScene.ts, materials/{toonMaterial,outlineHull,palette}.ts, src/client/ui/world/{threatMarkers,chronoRing}.ts, src/shared/{followCamera,followVisibility}.ts, src/client/boot.ts L1500-1610, src/content/schemas/feel.ts L805-1030, tests/architecture/characterAssets.test.ts L393-432, tests/golden/scenarios.ts L966, public/assets/characters/{papa,baby}.glb (bones and keyed tracks)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), dev-story, 2026-11-08.

### Debug Log References

- **Three writes a bone only when its value changed** (`PropertyMixer.apply`, `node_modules/three/src/animation/PropertyMixer.js:231`). D3 said « restore each life bone to its **rest** quaternion before `mixer.update` »: on a held clip or a frozen clock (`__PP__.freeze`, a pause, the end photo) the mixer writes nothing, so the bone would have stayed at the rest and lost the clip's pose (a unit test caught it: 30° of keyed spine read as 0°). The rig instead puts each life bone back to **what the clips last gave it** (`base`, captured right after `mixer.update`), which is the rest until a clip keys it. Same effect as D3 on an unkeyed bone (no pile-up over 1,000 updates, tested), right on a keyed one (clip × offset, tested, also on a frozen clock). The restore also runs before any `play()`: three saves a bone's « original » when a clip first binds it, and it must not save last frame's offset (tested).
- **Float32 keyframes**: a keyed quaternion read back is ~3e-4 rad off the value written (three stores tracks in `Float32Array`); the « clip × offset » test uses 1e-3 rad and says why. It does not grow over 50 frames.
- **`characters.spec.ts` « on the phone »** failed once after T8's change: waiting 1,250 ms for the spring put the two reads an eighth of a wobble apart on either side of a crest, so they read the same tilt. Fixed by keeping the original phase (300 ms into the call, modulo the period) after the settle; no tolerance changed.
- **`afterEffects.spec.ts`**: 3 timeouts at 30 s while regenerating the references with both browsers in parallel (the known load-flaky case, memory). Rerun alone with `--workers=4`: 22/22 green, Chromium and WebKit, against the new references.

### Completion Notes List

**What was built (AC 1-9, 11).**
- `feel.json › characters` (D1): `fades`, `turn`, `lean`, `breath`, `gaze`, `stoop`, `look`, with the starting values of D1, Zod bounds, refines (`alertPeriodMs ≤ periodMs`, periods ≥ `SCREEN_FLASH_MIN_INTERVAL_MS`, `returnMs ≤ 200`) and `describe`s; schemas regenerated. `feedback.json › characters` lost `crossFadeMs` and `turnRateDegPerSec`. The views read `world.feel.characters` every frame; one-shots started outside `update` read it through `SceneBodies.liveCharacters()` (a function over the live sim world, never a copy; a session test pins that it returns `sim.world.feel.characters`).
- Pure kit (no Three): `characterSpring.ts` (the camera's maths: ω from a 95 % reach time, exact transition, stepped at exactly `STEP_MS` with an accumulator, drawn between its last two steps by the leftover; overshoot cap; angle variant on the shortest arc, re-wrapped), `characterFades.ts` (`fadeMsOf`, `smoothstep`), `lifeLayer.ts` (lean, breath, stoop, `LifeInputs`), `papaGaze.ts` (the D8 choice, the threat pick, the clamp). `PAPA_TRAVELLING` / `BABY_TRAVELLING` are `Record`s in `characterClips.ts`.
- Rig: `play(clip, timeScale, fadeMs)`, `playOnce(clip, fadeMs)`, `update(dtMs, returnFadeMs)`, eased weights (linear progress, `smoothstep` weight, the others share `1 − w` in proportion: the 7.2 invariant holds through A → B → C at mixed durations, tested), `weightOf`, life bones (see the debug log).
- Views: the turn spring replaces `turnToward` (removed with its tests; `wrapAngleRad` kept); damping 1 under reduced motion. Papa: lean + breath + stoop on `spine`, gaze on `head` (spring, damping 1, `gaze.reachMs`); the baby: breath on `spine`, his `head` stays exactly on the gaze while his body springs (tested every frame of the swing). Eyelids last, untouched by the stoop (unit test and e2e at fatigue 100).
- Scene and screen: `levelScene.update` fills one scratch `LifeInputs` (fatigue, `catastrophePct > feel.catastrophe.alertPct`, `breathHeldAt !== null`, reduced motion, responding = `glide` or a `respond_*` clip, the baby's drawn point, the gaze sight). Boot, after the markers and the bubbles, picks the threat from `chronoDrawOf` (the ring as drawn), drops markers on Papa and markers off the follow frame (`offscreenHud.isOffscreen`, new), checks the baby on screen (`offscreenHud.isPointOnScreen`, new, no inset) and calls `LevelScene.setPapaGazeSight`; applied at the next update (one frame late). `fx()` gains `papaLeanDeg`, `papaStoopDeg`, `papaHeadYawDeg`, `papaGaze`, `papaBreathDeg`, `babyBreathDeg`, and `papaEyelidsPct` (added for T8's « lids stay open » e2e: the lids had no reader).
- Look (D10): `createToonMaterialCache(tones, { isCharacters: true })` adds a paper rim (`onBeforeCompile`, one `customProgramCacheKey`, one shared set of uniforms) and a `lcm(n, n + 1)`-texel ramp (12 for 3 tones) drawing 3 or 4 bands, rewritten in place by `setLook`; `OutlineKit.setWidthM` for the characters' own kit. Papa, the baby, the « Z » and the bla-bla use the characters' cache and kit; the room's are untouched. `content:check` refuses `fourthTonePct × 2.55 ≥ toonTones[0]`, on or off.

**Deviations, said plainly.**
- D3's « rest » became « the clips' last pose » (debug log): needed for held clips and frozen clocks.
- D6: the acceleration is the rate of change of a spring on the drawn speed (`lean.reachMs`, damping 1), then the pitch and roll springs. A raw step difference is one 10 ms spike that a damped spring barely shows. One `reachMs` serves both springs (deferred-work).
- D5: `turn.reachMs` is the time to cover 95 % (the camera's definition). The first crossing of a 90° turn comes at ~270 ms with the starting values (unit test: 230-300 ms), the overshoot is 8.5° (in the game, captured: 98.5° on a 90° turn).
- Reduced motion zeroes the breath and the lean at once, not over the envelope's quarter breath.
- `tests/tools/vite/fixtures/feelSample.json` is a whole feel today (the feel writer validates it): it got the block.

**AC 10, the game did not move.**
- `git diff --stat main -- src/sim src/bots content/levels content/threats content/sequences public assets-src`: empty.
- `npm run golden:update`, once: **72 files, 144 changed lines, all `feelHash` or `worldHash`** (classified by a diff filter; one file's `eventTypes` was rewritten on several lines by the writer and put back by `biome format`, same content). D2's proof (a throwaway test, deleted): the 36 scenarios played with main's test feel (and main's `crossFadeMs` / `turnRateDegPerSec`) and with the branch's give the **same hash of the final world without `feel` and the same events hash**, 36/36.
- `tests/bots/humanBotRegression.test.ts`: whole-journal `PINNED` re-pinned (the feel hash in the header), `PINNED_COMMANDS` untouched and passing; comment added.
- `npm run sim` with `perfect`, `human`, `random`, `idle` on `salon_kitchen`, `salon_crawler`, `chambre_night`, seed 1, 10 runs, on this branch and on the main checkout (`main` at cbbd2b8: 3.9 and « CI allégée » merged since this branch was cut, neither touches `src/sim`, `src/bots` or the levels): **12/12 reports identical** apart from `hashes` and each run's `worldHash`.

**Checks.**
- `npm run ci:fast`: green (454 files, 10,060 tests) before the last e2e edits; rerun at the end, see below.
- E2E Chromium, T8's list (`lifeLayer` new, `characters`, `reducedMotion`, `tapLatency`, `photo`, `render`, `level`, `carry`, `stealthExit`, `fatigue`, `offscreenBubble`, `salonKitchen`, `autoplay`, `testApi`, `feedback`): 144 passed, 1 failed (the phone phase above), `characters.spec.ts` rerun alone after the fix: 8/8. `tapLatency.spec.ts` green (AC 12).
- `characters.spec.ts` and `reducedMotion.spec.ts` read `papaBodyYawRad` after `TURN_SETTLE_MS` (5 × the live `turn.reachMs`, in `support/busyPapa.ts`) instead of 300 ms: the spring settles to ~0.002 rad by then. `YAW_TOLERANCE_RAD` unchanged.
- `npm run build:playtest` + `dist:check --flavor playtest`: OK (level payload 2,788.5 KiB, first load gzip 4,457.1 KiB).
- `npm run e2e:dist` on the rebuilt playtest (after the last code edit): 12 dist specs passed (Chromium + WebKit: a level, no CSP violation, no other origin, `?debug=1` FPS counter), then **`perf.spec.ts`: 16,741 frames, p95 16.7 ms (mean 16.68, max 133.3), draw calls max 90, triangles max 18,472** — within ≤ 20 ms, ≤ 100 calls, ≤ 100k triangles (AC 12). That run is the default level (`salon_kitchen`); `PP_PERF_LEVEL=chambre_night` was **not** run. No mesh was added (unit test: each character mesh has its one hull, as before), so the call count moves only with the room. Nothing in the rAF path allocates: scratch objects, quaternions and Eulers made once; the only per-frame object built is in `realFxState()` (debug, as before).

**AC 13, what Geo will see.** References regenerated deliberately with `--update-snapshots=all` and opened, all four: `autoplay-frozen` and `penombre-threat-up`, Chromium and WebKit. What changed: the characters' outline is visibly thicker (150 %), their poses differ by the life layer's offsets (Papa's head, a slight stoop/breath); the room is pixel-for-pixel the same to the eye. The white puff by the baby in the WebKit pénombre image is the particles (real time), present on `main` too in another shape: checked on a 4× crop of both.
Screenshots in `7-8-screenshots/` (20 PNG + `notes.txt` with each close-up's lean, stoop, head, body yaw and breath). « Before » is this build with main's look forced through `SetFeel` (`rimStrengthPct 0`, `outlineWidthPct 100`), not a build of `main`; the life layer is at rest in those frozen frames. **Opened:** `salon_crawler_844_before`, `salon_crawler_844_after`, `salon_kitchen_844_after`, `chambre_night_844_after`, `salon_crawler_667_after`, `papa_fatigue_0`, `papa_fatigue_100`, `papa_carrying_fatigue_100`, `papa_mid_glide`, `turn_2_overshoot`, `fourth_tone_on`. **Not opened:** `salon_kitchen_844_before`, `chambre_night_844_before`, `salon_crawler_667_before`, `turn_1_before`, `turn_3_settled`, `gaze_baby`, `gaze_ringed_threat`, `fourth_tone_off`.
What I saw: the stoop reads clearly at fatigue 100 (head and shoulders forward); the glide leans him forward (4.7° in the notes); the overshoot shows as his body past the walk's direction; the 4th tone darkens the shaded side of his face; the thicker outline detaches both characters from the floor in all three rooms. **The rim is barely visible at 844 × 390** at 35 %: Geo's call in the panel. Carrying at fatigue 100: the baby sits at his shoulder and Papa's hands stay at the baby in this frame; judge it moving.
`gaze_ringed_threat` shows him looking at the **baby**, not the outlet: in a fixed room the baby is always shown, and the baby wins unless Papa responds (D8). His head on a ringed threat is in `papa_mid_glide` (`papaGaze: threat`, head −60°, the clamp).

**For Geo.** The starting values (D1), the overshoot, the rim strength (hard to see now) and the 4th tone are yours in the feel panel. Open questions of the story still open: a threat in an off-screen bubble does not turn his head (one line in `boot.ts` if you want it to); carrying with the stoop and lean has no cap. New deferred items (`deferred-work.md`): the rim is unlit (bright in the pénombre), the gaze is one frame late, the lean's two springs share one reach.

### File List

New:
- `src/client/render/views/characterSpring.ts`, `characterSpring.test.ts`
- `src/client/render/views/characterFades.ts`, `characterFades.test.ts`
- `src/client/render/views/lifeLayer.ts`, `lifeLayer.test.ts`
- `src/client/render/views/papaGaze.ts`, `papaGaze.test.ts`
- `tests/e2e/lifeLayer.spec.ts`
- `_bmad-output/implementation-artifacts/7-8-screenshots/` (20 PNG, `notes.txt`)

Modified:
- `content/feel.json`, `content/feedback.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`
- `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`
- `src/client/render/views/characterRig.ts`, `characterRig.test.ts`, `characterMotion.ts`, `characterMotion.test.ts`, `characterClips.ts`, `characterClips.test.ts`, `papaView.ts`, `papaView.test.ts`, `babyView.ts`, `babyView.test.ts`, `layDown.test.ts`
- `src/client/render/materials/toonMaterial.ts`, `toonMaterial.test.ts`, `outlineHull.ts`
- `src/client/render/levelScene.ts`, `levelScene.test.ts`
- `src/client/ui/hud/offscreenHud.ts`, `offscreenHud.test.ts`
- `src/client/boot.ts`, `src/client/app/levelSession.ts`, `levelSession.test.ts`, `src/client/app/testHost.ts`
- `src/debug/testApi.test.ts`
- `tools/content/contentChecks.ts`
- `tests/architecture/characterAssets.test.ts`, `tests/bots/humanBotRegression.test.ts`
- `tests/content/feelSchema.test.ts`, `feedbackSchema.test.ts`, `checkContent.test.ts`
- `tests/support/testFeel.json`, `testContent.ts`, `testCharacters.ts`, `fakeTestHost.ts`, `tests/tools/vite/fixtures/feelSample.json`
- `tests/e2e/characters.spec.ts`, `reducedMotion.spec.ts`, `support/busyPapa.ts`, `support/testApi.ts`
- `tests/e2e/__screenshots__/autoplay.spec.ts/autoplay-frozen-{chromium,webkit}-darwin.png`, `tests/e2e/__screenshots__/afterEffects.spec.ts/penombre-threat-up-{chromium,webkit}-darwin.png`
- `tests/golden/journals/*` (72 files: `feelHash` and `worldHash` only)
- `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this file

### Change Log

- 2026-11-08: Story 7.8 implemented: the life layer (eased per-passage fades, damped turn, lean, breath, gaze, fatigue stoop) and the characters' own look (rim, optional 4th tone, 150 % outline), all in `feel.json › characters`; `crossFadeMs` and `turnRateDegPerSec` left `feedback.json`; goldens' `feelHash` / `worldHash` regenerated once; macOS references regenerated; screenshots for Geo.
