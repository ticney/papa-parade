---
baseline_commit: e349bccb360cce9ea21e6a1e734aea53df787cc4
---

# Story 2.10: Accessibility settings: reduced motion and large verbs

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** NFR6, NFR7 · **UX:** UX-DR18, UX-DR19, `EXPERIENCE.md` L213, L218, L227, L232, L269, L336, **L427-439** (Reduced motion), L511, L516 (Accessibility Floor); `DESIGN.md` L252, L453, L506, L510, L541 · **Architecture:** L250, L289, L388, L957

## Story

As a player who is sensitive to motion, or who struggles with small text,
I want to soften the on-screen effects and enlarge the verbs,
so that I can play comfortably without losing anything of the game.

## Acceptance Criteria

### The save

1. **`SaveSchema` v3** (`content/schemas/save.ts`, `SAVE_VERSION = 3` in `constants.ts`): `settings` gains `reducedMotion: boolean` and `largeVerbs: boolean`, both `false` in `createDefaultSettings`. Update the describes (L61 announces this story, L72 names the version).
2. **Migration `v2 → v3`** in `SAVE_MIGRATIONS` (`saveStore.ts` L23), pure, not mutating its input: `{ ...save, version: 3, settings: { ...save.settings, reducedMotion: false, largeVerbs: false } }`, reading `save.settings` only as a record. **Trap 1:** a v2 save with no `settings` must still fail the schema and be set aside, not be repaired: `saveStore.test.ts` L124 has that case, and it stays a refused save at v2. **Trap 2:** `v1 → v2` calls `createDefaultSettings()`, which now holds the new fields; the chain must still end on a valid v3 save with the v1 calibration kept. Test both.

### The two rows

3. **`settingsScreen.ts`:** two rows between « Vibrations » and « Recalibrer » (`EXPERIENCE.md` L336, the slot 2.8 left): « Réduire les animations » (`settings.reduced_motion`) and « Grands verbes » (`settings.large_verbs`); the strings exist. Both are `role="switch"` rows, **always built**, whatever `capabilities.haptics` says. Extract one local `toggleRow(labelKey, isOn, onFlip)` from the Vibrations block (L203-232): three uses of the same DOM. `current` and `emit` (L65-76) copy the two new fields: today they list the fields by name, so a forgotten one is silently reset by the next tick of a slider. Test that.
4. Every change is saved at once through the existing `onChange` path (`boot.ts` L1321-1326), and Up/Down, A and a tap work on the two rows with no new key code (`kind: 'toggle'`). The e2e reaches both by touch and by pad at 844 × 390.

### One source of truth, reaching JS and CSS

5. **`src/client/app/accessibilitySettings.ts`** (`createAccessibilitySettings`), injected and unit-tested with fakes: `deps = { root: Pick<HTMLElement, 'dataset' | 'style'>, motionQuery: Pick<MediaQueryList, 'matches' | 'addEventListener'>, settings(): Settings, onVerbScaleChanged(): void }`. It returns:
   - `isMotionReduced(): boolean`: `settings().reducedMotion || motionQuery.matches`. It is read per frame (`boot.ts` L873): no allocation.
   - `apply(): void`: writes `root.dataset.ppMotion` (`'reduced'` or removed) and `--pp-verb-scale` (`LARGE_VERBS_SCALE` or `1`, with `style.setProperty`, never a `style` attribute: the CSP); calls `onVerbScaleChanged` **only when the scale really changed** (a slider sends many `SettingsChanged`, and a refit reads `getComputedStyle`).
   - It listens to the query's `change` event and calls `apply()`. `ui.spec.ts` L261 switches `emulateMedia` with the page open and depends on it.
6. **`boot.ts`:** L387-390 becomes one `accessibilitySettings` instance, with `motionQuery` the existing query and `onVerbScaleChanged: () => worldUi.refitVerbs()`; `prefersReducedMotion` stays the name of the local function and is `accessibility.isMotionReduced`, so that L222, L400, L873, L1080 and L1268 do not change. `apply()` runs at creation (the OS value, for what shows before the save is read), right after `await saveStore.load()` (L1725, before `appFsm.enter('start')`) and on `SettingsChanged` (next to L481). Update the comment at L388-389 and the doc of `prefersReducedMotion` at `feedbackDirector.ts` L22. **Trap:** this attribute is a real feature, in prod too: never write it through `mirror()` (`isMirrored` is off in a store build).
7. **The CSS (decision D1). This is the trap of the story.** 2.5's checklist says that changing the function's body is enough, and that is true for the JS only: the panel's fade, the still bottle, the bubble's 1 Hz pulse, the stars, the gauges and the halos live in **six `@media (prefers-reduced-motion: reduce)` blocks** of `ui.css` (L484, L620, L934, L1449, L1851, L1965) that a saved setting can never reach. Replace each block's selectors with `:where(:root[data-pp-motion="reduced"]) <selector>`, in place, in the same order. `:where` keeps the specificity of the `@media` rules exactly, so the « same selector, later rule wins » comments (L1445-1448) stay true and no other rule changes winner. After this, `prefers-reduced-motion` is read in `boot.ts` only.
8. **Toggling must not restart what is on screen.** Changing `data-pp-motion` changes `.pp-panel`'s `animation-name` (`pp-pop-in` ↔ `pp-fade-in`, L685, L1451), and a changed name restarts the animation: the panel under the player's finger would blink at each press of the switch. So the settings panel carries `pp-panel-settled` (`animation: none`, placed after the reduced block) once `onFlip` runs, set **before** `emit`. The e2e checks `panel.getAnimations()` is empty and the opacity is 1 right after the press, in both directions.

### Reduced motion: the mapping (`EXPERIENCE.md` L427-439)

9. With the setting on (and with the OS query alone, as today), the existing variants apply. **Only the entry point is new**; do not rewrite them:
   | Effect | Where | Already built |
   |---|---|---|
   | Screen shake removed | `feedbackDirector.ts` L235 | 2.5 |
   | Perfect-camera rotation removed; zoom and pan capped at `REDUCED_MOTION_ZOOM_CAP_PCT` (50) | `cameraFx.ts` L223, L234 | 2.5 |
   | Particles at `REDUCED_MOTION_PARTICLE_KEEP_PCT` (40, so « cut by 60 % ») | `feedbackDirector.ts` L243 | 2.5 |
   | Panels and stamp as a plain fade | `ui.css` L1451, `epicStamp.ts` L54 | 1.5, 2.5 |
   | Full-screen flash → border glow | `screenFlash.ts` L46 | 2.4 |
   | Bubble « … » pulses at 1 Hz | `ui.css` L1967 | 1.21 |
   | Loading bottle still | `ui.css` L1458-1464 | 1.6 |
   | Baby hop and hair snap removed in a gag; combo pop removed; calibration ring | `boot.ts` L1080, `comboBadge.ts` L139, `calibrationScreen.ts` L243 | 1.16, 4.2, 2.7 |
10. **New: the tap marker** (`tapMarker.ts` L55, the one animation with no variant; `deferred-work.md` L122): under reduced motion its ring only fades, with no scale. `createTapMarker` (built at `worldUi.ts` L109) takes the `isMotionReduced` that `comboOptions` already carries (L104), read at each `showAt`. `tapMarkerSpec.test.ts` keeps pinning the normal keyframes.
11. **The hitstop and the slow-mos do not change.** No file of `src/sim`, `src/bots` or `tools/sim` changes. A guard in `tests/architecture` fails if `reducedMotion` or `largeVerbs` appears under `src/sim` or `src/bots` (with a failing fixture, like the others). The goldens are not regenerated: `tests/golden` has **no diff** at the end of the story; say so in the Completion Notes.
12. **`?autoplay` reads both settings (decision D2)**, unlike the tier (2.8 D5): they change no judgement, and the e2e of AC 19 needs it.

### Nothing blinks faster than 3 Hz

13. **`tests/architecture/flashRate.test.ts`** (new), pure parsing, each rule with a failing fixture, sharing `tests/architecture/designTokens.ts`'s stylesheet helpers:
    - **CSS:** a repeating animation (`infinite`) whose `@keyframes` animate `opacity` has a period ≥ `SCREEN_FLASH_MIN_INTERVAL_MS` (334 ms). Today: bubble 500 ms, gauge 1 s, halos 1400 ms, prompt 2 s.
    - **The bubble's rates against `DESIGN.md`:** with `silence-bubble.maxFlashHz` (L251) and `reducedMotionPulseHz` (L252) read from the frontmatter, `1000 / periodMs ≤ maxFlashHz` for `pp-silence-blink` (500 ms) and `1000 / periodMs ≤ reducedMotionPulseHz` for `pp-silence-pulse` (1000 ms).
    - **`content/feedback.json`:** every cue's `flash.durationMs` ≤ `SCREEN_FLASH_MIN_INTERVAL_MS` (`content:check` already refuses more: the test reads the real file, including threat, disruption and sequence cues). The screen flash's skip rule stays pinned by `feedbackDirector.test.ts` L661 and `mute.spec.ts` L89.
    - **Calibration:** `feel.calibration.bpm` in the real file gives ≤ 3 Hz (`bpm / 60`). `feelSchema.test.ts` L549 already bounds the schema; this test reads the value shipped.
14. **Sound rings are not flashes (decision D3).** `feedback.json` has `pulseIntervalMs` of 120-250 ms (L84, L102, L187, L216): 2 or 3 small rings that grow from a source, once. A naive test on that field would fail. They are a ripple of a small area, bounded at 3 (`feedback.ts` L129), not a blink. The test pins `pulses ≤ 3` and its comment says why rings are outside the rule. See open point 2.

### Large verbs

15. **`LARGE_VERBS_SCALE = 1.25`** in `constants.ts` (an accessibility value, not feel: 2.5 D6). `DESIGN.md` is changed first: `verb-label.largeVerbsScale: 1.25` in the frontmatter; `verbLabelSpec.test.ts` ties the two. Declare `--pp-verb-scale: 1` in a `:root` block of `ui.css` (never in `tokens.css`, which holds only tokens; `checkStylesheet` refuses an undeclared `var()`).
16. **Both CSS sizes follow:** `.pp-threat-verb` (L1687) and its compact rule (L1699) become `calc(var(--pp-font-verb…-size) * var(--pp-verb-scale))`, closing `deferred-work.md` L497 (the size before the first fit ignored the scale). Stay out of `.pp-type-verb` (L69-81), which is not the marker. The stroke stays `VERB_STROKE_PX` (DESIGN: 5 px): only the text grows.
17. **The fit is already there** (2.2 D9): `fitVerbFontPx` multiplies the base and the 28 px floor, and `metrics.scale()` reads the variable. On a change, `refitVerbs` (AC 5) redoes the sizes, the boxes and hence the stacking and the chip. No code changes in `verbLayout.ts` or `verbMetrics.ts`.
18. **Never truncated.** At 844 × 390 (compact, 32 → 40 px) in `tests/e2e/reducedMotion.spec.ts` or `settings.spec.ts`: force each threat of the level (`__PP__`, `ForceThreat`); each `.pp-threat-verb` has `scrollWidth ≤ offsetWidth`, no `overflow` or `text-overflow`, and its box inside the viewport. Then « POSE-LE D'ABORD ! » (longest string) by the same path as `carry.spec`. **A verb at the width limit grows less than 25 % by design** (`VERB_MAX_WIDTH_PCT` wins and the floor rises to 35 px, D4). If a box goes off-screen, nothing clamps it horizontally today (`threatMarkers.ts` `layout` only pushes up): add the smallest horizontal shift in `layout`, unit-tested, and say so in the Completion Notes.

### E2E and tests

19. **`tests/e2e/reducedMotion.spec.ts`** (new; Chromium and WebKit; no fixed sleep; `collectProblems` empty). `?autoplay=perfect&seed=<n>&speed=4`, with the setting seeded by `calibratedSaveValue({}, { reducedMotion: true })` in `addInitScript`:
    - A rAF sampler in the page records the max of `|cameraYawDeg|`, `|shakeOffsetM|` and `cameraZoom` from `__PP__.fx()`. Until 3 perfects: yaw and shake stay 0, zoom ≤ `1 + zoomPct / 200`. **Positive control:** the same sampler with the setting off sees yaw > 0 and shake > 0, or the test proves nothing.
    - `__PP__.cueLog()` has no `shake`; the perfect's flash carries the glow (class from `SCREEN_FLASH_CLASSES`).
    - **Same judgements:** the `ResponseResolved` of the first N responses (`ppEvents`: `t`, `threatId`, `response`, `quality`, `offsetMs`, `responseWindow`) are strictly equal between one run with the setting and one without, same seed. `autoplay.spec.ts` L66 already proves that an autoplay run is the headless game.
    - The CSS: `data-pp-motion="reduced"`, and the animation name of `.pp-panel` is `pp-fade-in`, the bubble's is `pp-silence-pulse`, the bottle's is `none` (with the OS query at `no-preference`, which is what proves the setting reaches the CSS).
20. **`tests/e2e/settings.spec.ts`:** both rows flip, save at once, and survive a reload and a portrait round trip; the switch applies with no reload (`data-pp-motion` and the verb of a mounted marker refits from 32 to 40 px, without leaving the settings); AC 8. The pad walk (L499) and row walks gain the two rows, including on WebKit, which has no vibration row. L355 and L666 expect version 3; L682's future save is version 4; the seeded v2 save migrates, its other settings kept.
21. **Coverage guard** (`deferred-work.md` L86), in `tests/architecture/designTokens.ts` with failing fixtures: **no `prefers-reduced-motion` in any stylesheet** (AC 7), and every selector with an `animation` outside a reduced rule has a reduced rule of its own. All 14 rules are covered today (L450, L462, L655, L685, L1171, L1198, L1249, L1283, L1311, L1620, L1655, L1710, L1844, L1896), so no exemption list. This guard is what catches an animation a later story or the merge of 2.9 adds.
22. **Unit:** `accessibilitySettings.test.ts` (setting only, OS only, both, none; the attribute; the variable; one refit per real change; the query's `change`), `settingsScreen.test.ts` (rows, indices of `panel.children` L96-107 move, fields kept, settled class before `emit`), `saveStore.test.ts` (L13, L124, future version 4, AC 2), `save.test.ts` (L36, L50-52), `tapMarker` keyframes.
23. **Test support:** `tests/e2e/support/calibratedSave.ts` becomes a v3 save (L21); `tests/content/calibratedSave.test.ts` follows; `calibration.spec.ts` L119 expects 3. The existing `emulateMedia` specs (`juice`, `silence`, `sequence`, `mamaWoke`, `result`, `ui`) stay as they are and now pin the OS path through the attribute: they must pass unchanged.

### Docs and hygiene

24. **Guards.** No new dependency, CSP unchanged, no Capacitor, no sim change. The string keys exist, so `stringsSchema` needs nothing.
25. **Docs.** `project-context.md`: L82 (« story 2.10 plugs the setting there » becomes what it does), L86, L142 (v3), L154 (save v3), and a new line: `prefers-reduced-motion` is read in one place, the CSS reads `data-pp-motion` through `:where`. `deferred-work.md`, dated section: close L70 (rest → 3.11), L86, L122 (the reduced half; the pause half moves), L147, L497, L537, L559.
26. **Deferred, to record** (`deferred-work.md` promises these to « the accessibility pass, story 2.10 », and they are not in this story's ACs; they must not silently vanish, see open point 3):
    - L82: focus restore, Tab trap, focus of the countdown, roles.
    - L85: the `pressButton.ts` state machine has no unit test.
    - L103: loading screen polish (`aria-live` re-announcing, the literal 5 s).
    - L121: `#pp-world` and the canvas rect with safe areas.
    - L122, L186: the tap marker and the halos keep running behind the pause.
    - L683: returning from Crédits or Recalibrer loses focus and scroll (longer now, with two more rows).
27. **Checks.** `env | grep VITE_` first. Merge `main` if 2.9 has landed. `ci:fast` after each task. Touched specs on Chromium: `reducedMotion`, `settings`, `juice`, `silence`, `sequence`, `mamaWoke`, `result`, `ui`, `mute`, `calibration`, `threat`, `carry`, `testApi`. `(unset VITE_DEBUG_ALLOWED; npm run ci)` once, green, before the review. Report `perf.spec.ts` next to 2.8's (p95 16.8 ms, 42 draw calls, 1526 triangles).

## Tasks / Subtasks

- [x] **T1. Save** (AC 1-2): v3, migration, both traps; tests first.
- [x] **T2. Source of truth** (AC 5-6, 12): `accessibilitySettings`, the boot wiring, `SettingsChanged`.
- [x] **T3. CSS** (AC 7, 21): the six blocks, the coverage guard. Run the `emulateMedia` specs at once: they must not move.
- [x] **T4. Rows** (AC 3-4, 8): `toggleRow`, the two switches, `pp-panel-settled`.
- [x] **T5. Tap marker** (AC 10).
- [x] **T6. Large verbs** (AC 15-18): `DESIGN.md` first, the constant, the variable, the CSS sizes, the off-screen check.
- [x] **T7. Guards** (AC 11, 13-14): sim guard, `flashRate.test.ts`.
- [x] **T8. e2e** (AC 19-20, 23): `reducedMotion.spec.ts` with its positive control, `settings.spec.ts`, v3 fixtures.
- [x] **T9. Docs** (AC 25-26).
- [x] **T10. CI** (AC 27).

## Dev Notes

### Decisions

- **D1. One root attribute, read through `:where`.** A `@media` query cannot read a save. Rejected: duplicating each block (`@media` plus attribute), since every later animation would need both and one would rot; and a JS class per effect. Plain `:root[data-…] .x` was rejected too: it raises the specificity by two, and those blocks rely on « same selector, later wins ». `:where` is in Safari 14 and Chromium 88, below our floor of iPhone 12 (and is covered by the Chromium and WebKit e2e). `calibrationScreen`'s `pp-calibration-reduced` stays as it is: it already reads the function.
- **D2. Autoplay reads the comfort settings, not the tier.** 2.8 D5 ignored the tier because a seeded run must stay reproducible. These two change no sim value, so a run stays the same game (AC 19 proves it).
- **D3. A blink is an on/off of an area; a ring is not.** See AC 14 and open point 2.
- **D4. The width limit beats +25 %.** `VERB_MAX_WIDTH_PCT` (45) keeps verbs from crossing the screen; a verb already at the limit keeps its size, and the raised floor (35 px) lets it overflow rather than shrink. Most verbs grow by the full 25 % on a phone in landscape (by estimate, « RÉVEILLE-TOI ! » at 40 px fits in the 370 px of an 844 px screen and « POSE-LE D'ABORD ! » is at the edge; AC 18 measures them). Widening the limit would make simultaneous verbs collide more; to judge in play.
- **D5. `LARGE_VERBS_SCALE` is a constant, tied to `DESIGN.md`.** An accessibility rule, not a feel value (2.5 D6, 2.4 D4).
- **D6. Saved `false` means « follow the OS », the switch shows the saved value.** `settings || OS` is what the architecture (L250) and 2.5 AC 10 give. See open point 1.
- **D7. No `reducedMotion` in the sim's world or in a journal.** A tester's journal does not say whether the setting was on; `playtest:metrics` does not split by it. Nothing needs it today.

### Current state of the files this story changes

- **`src/client/boot.ts`** (1764 lines): `createWorldUi` L220-223, `saveStore` L336, motion query L387-390, director deps L392-400, `SettingsChanged` L481, camera L873, gags L1080, calibration flow L1268, settings builder L1321-1326, `load()` L1725.
- **`src/client/ui/screens/settingsScreen.ts`**: `current` L65-69, `emit` L70-76 (fields named one by one), toggle block L203-232, `Row.kind: 'toggle'` handled by `moveFocus` and `activate`, needs no change.
- **`src/client/save/saveStore.ts`**: `SAVE_MIGRATIONS` L23-28; `migrateSave` checks each step's version.
- **`src/client/ui/styles/ui.css`**: the six blocks; `.pp-threat-verb` L1686 and compact L1698; `.pp-panel` L671-686.
- **`src/client/ui/world/verbMetrics.ts`, `verbLayout.ts`, `threatMarkers.ts`**: the scale hook is built and tested (`threatMarkers.test.ts` L1057, `verbMetrics.test.ts` L42); the only gap is that nothing sets the variable or calls `refitVerbs` (`boot.ts` L236 calls it for the fonts).
- **`tests/architecture/designTokens.ts`**: `checkStylesheet` L288. `:where(:root[data-pp-motion="reduced"]) .pp-panel` was run through it when this story was written: no problem reported.

### Must not change

- `src/sim`, `src/bots`, `tools/sim`, `tests/golden`, `feel.json`, `feedback.json`, the reduced constants.
- The names of the effects' `isMotionReduced` arguments and `FeedbackDirectorDeps.prefersReducedMotion`: renaming them is churn across the feedback and effect tests.
- 2.8's settings detour, tier flow and volumes; a toggle must not leave `settings` or resume the game.
- Audio and haptics under reduced motion (`EXPERIENCE.md`: the mapping is visual only).
- The normal rendering: with both switches off and no OS setting, every screenshot reference stays valid (`--update-snapshots` is not part of this story).

### Coordination with story 2.9

`story/2-9-instinct-paternel` is marked done on its branch, and was not merged into `main` when this story was written. It touches `boot.ts` (the vignette, in other regions), the header comment of `ui.css` and adds a rule to it, and `sprint-status.yaml`. Its `.pp-instinct-vignette` is a 200 ms `transition`, on purpose unchanged under reduced motion, so AC 21 (which looks at `animation`) does not flag it. It touches neither the save nor the settings screen. Whichever merges second merges `main` and reruns the checks; the `sprint-status` line is merged by the agent, the rest asks Geo only on a real code conflict (`CLAUDE.md`).

### Architecture compliance

- `client` only. `accessibilitySettings.ts` imports `@content/schemas/save` (a type) and `@shared/constants`. `create<Name>` in a file named after it. The DOM is injected, like `verbMetrics`.
- `client` reaches storage through `saveStore` only; strings through `t`; CSS by tokens, `pp-` prefix; ≥ 44 pt on the rows.
- Hot path: `isMotionReduced` allocates nothing; `getComputedStyle` only in a refit, never per frame.
- `boot.ts` stays the single composition root.

### Previous story intelligence

- **2.8:** a screen holds no state of its own, portrait rebuilds it from the save; never `setAttribute('style', …)`; WebKit has no vibration row, so rows and pad walks differ per project; `tests/e2e` play from `calibratedSave`; a second run under load may time out (`makePlaceholderAudio.test.ts` once took 6.4 s), rerun once and say so.
- **2.5:** the sampler must have a positive control: polling misses short effects at speed 4, hence a rAF sampler and `data-pp-*-count` mirrors. Query reduced motion live, not at boot.
- **2.4:** `ui.spec.ts` skips the full-screen overlay in its HUD node count.
- **2.2 D9 and its review:** the variable alone does nothing without `refitVerbs` and the CSS `calc`.
- **1.5 D14:** `bindPressButton` cancels the compat mouse events.

### Git

Branch `story/2-10-reglages-d-accessibilite-mouvement-reduit-et-grands-verbes` in `.claude/worktrees/2-10-reglages-d-accessibilite-mouvement-reduit-et-grands-verbes`. Commit « Story 2.10 : réglages d'accessibilité : mouvement réduit et grands verbes », then « Story 2.10 : corrections de la revue de code ». Never on `main`.

### Web research

None needed: no new library and the stack is pinned. `:where()` and `MediaQueryList.addEventListener('change')` are checked by the Chromium and WebKit e2e runs.

### Open points for Geo

1. **OS setting on, switch off.** A player whose phone already asks for reduced motion sees « Réduire les animations » off while the effects are reduced, and flipping it changes nothing visible. Not built: a hint (« Déjà actif sur cet appareil »), which needs one string and one option. Worth adding?
2. **The sound rings.** 2 or 3 rings at 120-250 ms intervals are treated as a ripple, not a blink (D3), and stay as they are under reduced motion. Look at them with the setting on: if they read as flicker, the fix is one ring under reduced motion.
3. **The « accessibility pass ».** `deferred-work.md` sends six items to this story that are not in its ACs (AC 26). I keep them out to hold the scope, and no later story owns them. Decide at the epic 2 retrospective: a dedicated story, or into 3.11.
4. **+25 % on a long verb** is capped by the width limit (D4). To judge in play on the smallest phone.

### Project Structure Notes

- New: `src/client/app/accessibilitySettings.ts` (+ test), `tests/architecture/flashRate.test.ts`, `tests/e2e/reducedMotion.spec.ts`. No other new folder.
- Variance: `tests/architecture/designTokens.ts` gains the coverage guard rather than a new file, as `deferred-work.md` L86 asks.

### Project Context Rules

- Reduced motion is client-only and never changes sim timing; goldens are identical with or without it (`project-context.md` L86).
- Never hard-code a colour, size or UI string; `tokens.css` mirrors `DESIGN.md` 1:1, and `DESIGN.md` changes first.
- Every schema change adds a migration; invalid data is set aside with a `warn`, never repaired.
- No `console.*`, no silent `catch`; `Result` on I/O; zero allocation in hot paths; units as suffixes; booleans `is`/`has`.
- Debug-only code behind `isMirrored`; this story's attribute is **not** debug-only.
- Never weaken a guardrail: `checkStylesheet` and the layer tests stay as strict.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.10], [#Story 2.5] AC « mouvement réduit », UX-DR18 (L250), UX-DR19 (L251), NFR6-7 (L146-147)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L213, L218, L227, L232, L336, L427-439, L511, L516
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md] L252, L453, L506, L510, L541
- [Source: _bmad-output/planning-artifacts/game-architecture.md] L250, L289, L388, L957
- [Source: _bmad-output/project-context.md] L81-82, L86, L142, L154-155
- [Source: _bmad-output/implementation-artifacts/2-5-effets-de-feeling-a-l-ecran.md] AC 10, D6, Completion Notes (reduced-motion checklist)
- [Source: _bmad-output/implementation-artifacts/2-2-verbe-affiche-et-icones-couleur-forme.md] D9, review finding L312
- [Source: _bmad-output/implementation-artifacts/2-8-paliers-de-difficulte-et-reglages.md] AC 9, AC 19, D5, review findings
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L70, L82, L85-86, L103, L121-122, L147, L186, L497, L537, L559, L683

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Debug Log References

- `main` (with story 2.9) was merged into the branch before the first edit; the only conflict was the two status lines of `sprint-status.yaml`, merged by hand (2-9 `done`, 2-10 `in-progress`).
- **The OS query's `change` event never reached `boot.ts`** (found while running `ui.spec.ts` and `mamaWoke.spec.ts` after T3). The `emulateMedia` specs failed in a group and passed alone. A probe query created next to boot's received the event, boot's did not, even with a listener added from the test. Cause: the game asks `isMotionReduced()` at every frame, and reading `MediaQueryList.matches` between the change and its event makes Chromium drop the notification. The first fix tried (read `.matches` once before listening) did not help; the one kept reads the OS value once, follows it only through `change`, and `isMotionReduced` returns a cached boolean. A unit test pins « one read at creation, none per frame ».

### Completion Notes List

- **T1 Save v3.** `SAVE_VERSION = 3`, `settings.reducedMotion` and `settings.largeVerbs` (both `false`). `v2 → v3` spreads `save.settings` read as a record (`asRecord`), so a v2 save with no usable `settings` still fails the schema and is set aside as it was (trap 1); `v1 → v2` still ends on a valid v3 save with the calibration kept (trap 2). Both are tested, and a v2 save is also seeded and migrated in `settings.spec.ts`.
- **T2 One source of truth.** `client/app/accessibilitySettings.ts` (see the debug log for the cached OS value). `apply()` writes `data-pp-motion` and `--pp-verb-scale` (`style.setProperty`, never through `mirror()`) and calls `onVerbScaleChanged` once per real change; `boot.ts` runs it at creation, after `saveStore.load()` and on `SettingsChanged`. `prefersReducedMotion` is `accessibility.isMotionReduced`, so no other call site moved. `?autoplay` reads both settings (D2) without any code: `apply()` does not look at the autoplay flag.
- **T3 CSS.** The six `@media (prefers-reduced-motion)` blocks of `ui.css` are `:where(:root[data-pp-motion="reduced"]) <selector>` rules, in place and in the same order. `checkReducedMotion` (in `tests/architecture/designTokens.ts`, with failing fixtures) refuses any `prefers-reduced-motion`, an animated selector with no reduced rule of its own, and a reduced rule placed before its animation; it runs on every stylesheet of `src`. Moving the blocks out of `@media` made Biome's `noDescendingSpecificity` warn twice (`.pp-toggle-thumb`, `.pp-button`); both are suppressed with a reason, because the rules they « lose » to set no `transition`.
- **T4 Rows.** `toggleRow(labelKey, isOn, onFlip)` serves Vibrations and the two new switches (always built). `pp-panel-settled` is added before `onFlip` reports, so the changed animation name (`pp-pop-in` ↔ `pp-fade-in`) does not restart the panel; a mutation check (the line commented out) turns the e2e test red (`animations: 1`). `current` and `emit` copy both new fields; a unit test flips a switch, then a slider and a tier, and checks nothing is reset.
- **T5 Tap marker.** `tapMarkerKeyframes(isMotionReduced)` gives `[{opacity: 1}, {opacity: 0}]`; `createTapMarker` reads `comboOptions.isMotionReduced` at each `showAt`. `tapMarkerSpec.test.ts` is untouched and still pins the normal keyframes.
- **T6 Large verbs.** `DESIGN.md` first (`verb-label.largeVerbsScale: 1.25`), then `LARGE_VERBS_SCALE`, `--pp-verb-scale: 1` in `ui.css`'s first `:root`, and both `.pp-threat-verb` sizes as `calc(... * var(--pp-verb-scale))`. **Measured, not guessed (AC 18):** at 844 × 390 every verb of `salon_crawler` (forced one at a time, the micro-sleep brought on with `SetFatigue`) and the hint « POSE-LE D'ABORD ! » is whole, not wider than its box and inside the viewport, on Chromium and WebKit. `threatMarkers` `layout` therefore got **no horizontal shift**. `silence_mischief` has no marker until the silence is found; its verb text is the outlet's. A verb at the width limit may still grow by less than 25 % (D4), for Geo to judge on the smallest phone.
- **T7 Guards.** `comfortSettings.test.ts` fails if `reducedMotion`, `largeVerbs` (or their snake_case) appear under `src/sim`, `src/bots` or `tools/sim`, tests included, with four failing fixtures. `flashRate.test.ts` covers the CSS repeating animations of opacity (bubble 500 ms, gauge 1 s, halos 1400 ms, prompt 2 s, all ≥ 334 ms), the bubble's two rates against `DESIGN.md`, every cue's `flash.durationMs`, the sound rings (`pulses ≤ 3`, D3) and the calibration tempo (≤ 3 Hz). **No `src/sim`, `src/bots` or `tools/sim` file changed, and `tests/golden` has no diff; the goldens were not regenerated.**
- **T8 e2e.** `reducedMotion.spec.ts` (new): the rAF sampler with its positive control (setting on: yaw 0, shake 0, zoom ≤ `1 + zoomPct / 200`; setting off: yaw, shake and the larger zoom are seen), the glow class of a perfect's flash and the absence of `shake` in `cueLog` (each with a control), the same first five `ResponseResolved` with and without the setting (same seed), the CSS probes (`pp-fade-in`, `pp-silence-pulse`, the still bottle) with the OS at `no-preference`, and the large-verbs checks. `settings.spec.ts`: both rows by touch and by pad, reload, portrait round trip, a v2 save migrated, version 3, a future save at version 4, the switch applying with no reload, the verb of a mounted marker refitting from 32 to 40 px without leaving the settings, and the panel check of AC 8 in both directions. Chromium and WebKit.
- **Existing specs touched.** `ui.spec.ts` and `mamaWoke.spec.ts` switch the OS preference with the page open, and read the style right after: with the CSS now reading an attribute that the media query's `change` event sets at the next rendering step, they could read the old style. They use the new `emulateReducedMotion(page)` of `support/game.ts` (emulate, then wait for `data-pp-motion`). `juice`, `silence`, `sequence` and `result` emulate before the page loads and are unchanged. `calibration.spec.ts` expects version 3; `calibratedSave.ts` and its test are a v3 save.
- **T9 Docs.** `project-context.md` (the setting plugged into `isMotionReduced`, the new « read in one place » rule, the v3 fixture, save v3), `deferred-work.md` (a dated section: what is closed, the six entries moved to the accessibility pass, the new items), `DESIGN.md` (`largeVerbsScale`).
- **Not built, on purpose.** The hint « Déjà actif sur cet appareil » (open point 1), one ring under reduced motion (open point 2), and the accessibility pass (open point 3): see `deferred-work.md`.
- **Checks.** `ci:fast` after each task; the touched specs on Chromium while developing; the full CI once at the end. **`perf.spec.ts` (built playtest, a whole level at speed 1): p95 16.8 ms, 43 draw calls, 1538 triangles, next to 2.8's 16.8 ms, 42, 1526.** `tests/golden` has no diff.
- **The full CI needed reruns, for reasons outside the code (say so, per CLAUDE.md).** (1) The first `npm run ci` ran under a load average of about 22 on the shared machine: the dev server became unreachable during the WebKit run (173 × « Could not connect to the server », plus one Chromium countdown timing in `ui.spec.ts:103`, which passes alone). The `e2e` step was rerun with `--workers=4`. (2) That rerun had one failure, `carry.spec.ts:128` on WebKit (« audio is still suspended … resuming on this gesture », 3 times out of 6 when repeated alone): `carry.spec.ts`'s `openFrozen` did not wait for the audio context to be `running`, as `toilet.spec.ts` does. I added that one wait (test-only, 32/32 afterwards on WebKit). (3) `e2e:dist` failed with `ERR_UNSAFE_PORT`: this worktree's derived dist port is 6666, which Chromium blocks; rerun with `PP_E2E_DIST_PORT=6391` (10 specs and the perf spec pass), then `build` and `dist:check --flavor prod`. Typecheck, lint, `content:check` and `test:coverage` passed in the first run (297 files, 5916 tests); the later steps were run from `e2e` on, in order, across the reruns. A port derived from a path can land on a browser-blocked port: worth a deny-list in `e2ePort.ts`, left alone here (Geo's call).

### File List

- `_bmad-output/implementation-artifacts/2-10-reglages-d-accessibilite-mouvement-reduit-et-grands-verbes.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md`
- `_bmad-output/project-context.md`
- `src/shared/constants.ts`
- `src/content/schemas/save.ts`
- `src/content/schemas/save.test.ts`
- `src/client/save/saveStore.ts`
- `src/client/save/saveStore.test.ts`
- `src/client/app/accessibilitySettings.ts` (new)
- `src/client/app/accessibilitySettings.test.ts` (new)
- `src/client/boot.ts`
- `src/client/feedback/feedbackDirector.ts`
- `src/client/ui/screens/settingsScreen.ts`
- `src/client/ui/screens/settingsScreen.test.ts`
- `src/client/ui/styles/ui.css`
- `src/client/ui/world/tapMarker.ts`
- `src/client/ui/world/tapMarker.test.ts`
- `src/client/ui/world/worldUi.ts`
- `tests/architecture/comfortSettings.test.ts` (new)
- `tests/architecture/fixtures/comfortSettings/` (new: `clean`, `in-a-test`, `large-verbs`, `reduced-motion`, `snake-case`)
- `tests/architecture/flashRate.test.ts` (new)
- `tests/architecture/designTokens.ts`
- `tests/architecture/designTokens.test.ts`
- `tests/architecture/verbLabelSpec.test.ts`
- `tests/content/calibratedSave.test.ts`
- `tests/e2e/reducedMotion.spec.ts` (new)
- `tests/e2e/settings.spec.ts`
- `tests/e2e/calibration.spec.ts`
- `tests/e2e/ui.spec.ts`
- `tests/e2e/carry.spec.ts`
- `tests/e2e/mamaWoke.spec.ts`
- `tests/e2e/support/calibratedSave.ts`
- `tests/e2e/support/game.ts`

### Change Log

- 2026-10-31: Story 2.10 implemented. Save v3 with `reducedMotion` and `largeVerbs`; `accessibilitySettings` as the single source for the JS function and the CSS attribute; the six reduced-motion blocks of `ui.css` read `data-pp-motion` through `:where`; two settings rows; the tap marker fades without scale under reduced motion; `LARGE_VERBS_SCALE` and `--pp-verb-scale`; guards for the 3 Hz rule and the sim; e2e on Chromium and WebKit.
