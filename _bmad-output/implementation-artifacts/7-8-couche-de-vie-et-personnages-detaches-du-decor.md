# Story 7.8: Couche de vie et personnages détachés du décor

Status: ready-for-dev

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

- [ ] **T0. Read before touching** (all ACs)
  - [ ] Read « What exists » below, then `characterRig.ts`, `characterMotion.ts`, `characterClips.ts`, `papaView.ts`, `babyView.ts`, `levelScene.ts`, `outlineHull.ts`, `toonMaterial.ts` in full. Check `env | grep VITE_` (memory: the shell exports `VITE_DEBUG_ALLOWED=false`).
  - [ ] `git worktree list`: note any open story touching `feel.json`, `feel.ts`, `content/_schemas/`, goldens, `levelScene.ts` or the views. Whichever merges second regenerates schemas and goldens after merging `main`.
- [ ] **T1. Data first** (AC 8, D1, D2)
  - [ ] `CharactersSchema` in `src/content/schemas/feel.ts` (strict, after `camera`, `describe` « Client only »), with the D1 shape, bounds and refines; `FeelSchema.characters`. `content/feel.json` and `tests/support/testFeel.json` get the block; check whether `tests/tools/vite/fixtures/feelSample.json` is a whole feel (9.2 found it is not) and update it only if it is.
  - [ ] `FeedbackSchema.characters` loses `crossFadeMs` and `turnRateDegPerSec`; `content/feedback.json`, `tests/support/testContent.ts` follow.
  - [ ] `npm run content:schemas`. `tests/content/feelSchema.test.ts`: every bound and refine pinned; the unit-suffix rule passes with D1's names (add nothing to `UNIT_SUFFIX` unless a name truly needs it, and say why in its comment, as 9.2 did).
  - [ ] `npm run ci:fast`: the goldens go red on hashes only. `npm run golden:update` once; read the diff (D2) and write the file count in the notes. Re-pin the whole-journal `PINNED` of `tests/bots/humanBotRegression.test.ts` only if it moved, with `PINNED_COMMANDS` unchanged, and say so in its comment.
- [ ] **T2. The pure kit, no Three** (AC 1-6, 11, D3-D9, D12) — each with its unit test next to it
  - [ ] `views/characterSpring.ts`: a 1-D spring stepped at `STEP_MS` with an accumulator on the sim clock (`omegaOf(reachMs, dampingRatio)`, a step, an angle variant on the unwrapped angle). Tests: no overshoot at damping 1; 90° at 0.6 overshoots within 5-10°; the cap; `dtMs` 0 holds; the same span split in 1, 3 or 7 frames with a constant target gives the same value at the end.
  - [ ] `views/characterFades.ts`: `fadeMsOf(fromTravelling, toTravelling, kind, fades)` and the ease (`smoothstep`). Travelling states as `Record<PapaState, boolean>` and `Record<BabyState, boolean>` in `characterClips.ts` (a new state is a type error).
  - [ ] `views/lifeLayer.ts`: lean (from drawn speed and body turn rate), breath (accumulated phase, period switch, held breath), stoop (from fatigue), each a pure function writing into a scratch object.
  - [ ] `views/papaGaze.ts`: the choice of D8 from inputs the caller fills (baby shown, responding, best threat point or none), the yaw relative to the body, the clamp.
- [ ] **T3. The rig** (AC 1, 11, D3, D4)
  - [ ] `createCharacterRig(asset, toon, outlines)`: no fade constant; `play(clip, timeScale, fadeMs)`, `playOnce(clip, fadeMs)`, `update(dtMs, returnFadeMs)`. The incoming track keeps a linear progress and its weight is the eased progress; the others share `1 − weight` in proportion (the 7.2 review invariant). A one-shot ends when `leftMs <= returnFadeMs`.
  - [ ] Life-layer bones: the rig records the rest quaternion of each bone the layer writes (`spine`, `head` for Papa; `spine` for the baby) and restores it **before** `mixer.update`, so that a bone no running clip keys does not accumulate (D3).
  - [ ] Tests: weights sum to 1 through A → B → C at mixed durations; the ease has zero slope at both ends; a bone with no track does not drift over 1,000 updates with an offset written each time; a keyed bone shows track × offset.
- [ ] **T4. The views** (AC 2-6, 9, D3, D5-D9)
  - [ ] `papaView.animate` / `babyView.animate` take the frame's life inputs (a scratch object the scene fills: `fatigue`, `isAlert`, `isBreathHeld`, `isMotionReduced`, the gaze target, `world.feel.characters`). Order in a frame: clip choice → restore life bones → `rig.update` → life offsets → eyelids last (D3).
  - [ ] Papa: the turn spring replaces `turnToward` (target unchanged: `papaFacingYawRad(…) ?? pose.yawRad`); lean, breath and stoop on `spine`; gaze on `head`. Baby: the turn spring on his body; `headBone.rotation.y = wrapAngleRad(pose.yawRad − bodyYawRad)` stays exact; breath on `spine`.
  - [ ] Keep every existing method and getter (`bodyYawRad`, `pose`, `setEyelids`…). Remove `turnToward` and its tests once nothing calls it; keep `wrapAngleRad`.
- [ ] **T5. The scene and the gaze sight** (AC 5, 8, 9, D8)
  - [ ] `levelScene.update`: fill the life inputs from `world` each frame (`world.gauges.fatigue`, `world.gauges.catastrophePct > world.feel.catastrophe.alertPct`, `world.sequence.stealth.breathHeldAt !== null`, `bodies.isMotionReduced()`, `world.feel.characters`). Nothing allocated.
  - [ ] `LevelScene.setPapaGazeSight(isBabyShown, threatXM, threatZM, hasThreat)` (or one scratch object): boot calls it once per frame **after** `worldUi.updateThreats` and `offscreenHud.update` (`boot.ts` ~L1517-1600), from `worldUi`'s `chronoDrawOf(id)`, the markers' entries and the follow frame. The scene applies it in its next `update` (one frame later: cosmetic). The « responding » test (`world.papa.state === 'glide'` or a `respond_*` one-shot on the rig) is the scene's.
  - [ ] `realFxState()` / `__PP__.fx()`: add `papaLeanDeg`, `papaStoopDeg`, `papaHeadYawDeg`, `papaGaze` (`'baby' | 'threat' | 'ahead'`), `papaBreathDeg`, `babyBreathDeg`. Update `tests/e2e/support/testApi.ts`, `tests/support/fakeTestHost.ts`, `src/debug/testApi.test.ts`.
- [ ] **T6. Sharpness** (AC 7, D10)
  - [ ] `createToonMaterialCache(tones, options?)`: the characters' own instance, with a rim (an `onBeforeCompile` adding `rimStrength × smoothstep(1 − rimWidth, 1, 1 − normal.z)` of `PALETTE.paper` in view space, with a `customProgramCacheKey`) and a 12-texel gradient that draws 3 equal bands (4 texels each) or 4 (3 each) and is rewritten in place when the feel changes. The room's cache is untouched (no rim, 3 tones).
  - [ ] A second `OutlineKit` for the characters (`createCharacterRig` takes it), its `widthM` uniform written when `render.outlines.widthM × outlineWidthPct / 100` changes. Papa's « Z » and the « bla bla » bubble use the characters' cache and kit.
  - [ ] Uniform writes only on change; the dispose frees both caches and both kits. Unit tests: room meshes keep the room cache; character meshes never share a material with the room; the rim and the tone count follow a feel change with no new material; the number of meshes (draw calls) of a scene is the same as on `main`.
  - [ ] `content:check` (`tools/content/contentChecks.ts`): refuse `look.fourthTonePct × 2.55 >= render.toonTones[0]` (the 4th tone must be the darkest); a test.
- [ ] **T7. Guards** (AC 5, 11)
  - [ ] `tests/architecture/characterAssets.test.ts`: add the new view modules to the `VIEWS` scan, and extend its pattern to `toleranceMs`. Add a test that the new modules contain no `Math.random`, `performance`, `Date`, `world.rng`, `nowReal` or `THREE.Clock`.
  - [ ] Same file: every one-shot of both contracts lasts at least `2 × fades.returnMs` of the committed `feel.json` (closes the 7.2 deferred « one-shot no longer than `crossFadeMs` »).
  - [ ] A unit test that the gaze never picks a `hidden` threat nor a `mischiefSilent` baby, and never a threat aimed at Papa.
- [ ] **T8. Prove nothing moved** (AC 10, 11)
  - [ ] `git diff --stat main` on AC 10's paths: empty. Goldens: D2's proof. Bots on `salon_kitchen`, `salon_crawler`, `chambre_night`, seed 1, against `main`.
  - [ ] E2E on Chromium (`npm run e2e -- <specs> --project=chromium`, in the background): a new `tests/e2e/lifeLayer.spec.ts` (breath moves with sim time and holds under `freeze`; `SetFatigue` 100 stoops him and leaves the lids open; the gaze reads `baby` then `ahead` during a silence; reduced motion zeroes lean and breath), then `characters`, `reducedMotion`, `tapLatency`, `photo`, `render`, `level`, `carry`, `stealthExit`, `fatigue`, `offscreenBubble`, `salonKitchen`, `autoplay`, `testApi`, `feedback`. `characters` and `reducedMotion` check `papaBodyYawRad` against a tolerance: if the spring's settle time breaks them, wait for it to settle; never widen a tolerance without saying why.
- [ ] **T9. Close and record the debts** (see « Deferred items »)
- [ ] **T10. Performance and delivery** (AC 12, 13), after the last visual edit, under `caffeinate`
  - [ ] `npm run build:playtest`, `npm run dist:check -- --flavor playtest`, then `npm run e2e:dist` in the background (it queues; perf alone ≈ 5 min). Then `PP_PERF_LEVEL=chambre_night` by hand if time allows. Numbers in the notes.
  - [ ] `npm run e2e -- tests/e2e/autoplay.spec.ts tests/e2e/afterEffects.spec.ts --update-snapshots=all` (7.3: a plain `--update-snapshots` wrote nothing). Open all four images, say what changed.
  - [ ] `7-8-screenshots/`, at 844 × 390 unless said: each of the three rooms at start, before (from `main`) and after (rim and outline); Papa at fatigue 0 and 100 side by side; Papa mid-glide (lean); three frames of a turn (before, overshoot, settled); Papa's head toward the baby and toward a ringed threat; Papa carrying at fatigue 100 (are his hands still on the baby?); the 4th tone off and on; the same at 667 × 375 for one room. Write what you saw by eye, and what you did not open.

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
