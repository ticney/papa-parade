# Story 2.2: Verb label and colour + shape icons

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

**Requirements:** FR53, FR54, NFR6, NFR8 · **UX:** UX-DR10 (mockup `mockups/key-hud-level.html`, states A and B)

## Story

As a player who discovers the game,
I want to see in big letters what I must do on each threat,
so that I understand without a tutorial, even if I am colour-blind.

## Acceptance Criteria

### Content

1. **`ThreatDef` gains three required keys** (`src/content/schemas/threat.ts`, in `baseShape`, so every variant has them):
   - `verbKey`: a string key of `content/strings.fr.json` in the `verb.` group (regex `^verb\.[a-z0-9_]+$`), or `null`. `null` means « the default verb of the response » and is accepted **only** for a `dodge` response (none exists before story 5.1, so today every def writes a key). This is the project's `…Key` convention (D1): the architecture example's literal `"verb": "SOULÈVE !"` is not followed.
   - `iconShape`: `'circle' | 'triangle'`.
   - `color`: `'parry' | 'dodge'` (the DESIGN.md token names, D2).
   - A `superRefine` rule: `circle` goes with `parry` and `triangle` with `dodge` (the pair is the signal, NFR8); a `parry` or `firm` response needs `circle` + `parry`. With no `dodge` response yet, `triangle` / `dodge` is refused with a message saying it joins with the dodge response (story 5.1).
2. **`npm run content:check` fails** when a threat file lacks `verbKey`, `iconShape` or `color` (strict object, no default), when `verbKey` names a key missing from `strings.fr.json` (the existing `…Key` reference check), and when the pair or the response rule of AC 1 is broken. Each case has a test in `tests/content/threatSchema.test.ts` or `tests/content/checkContent.test.ts`.
3. **The five threat files** get their keys (all `circle` + `parry`):

   | File | `verbKey` | Text |
   |---|---|---|
   | `outlet.json` | `verb.lift` (exists) | SOULÈVE ! |
   | `stairs.json` | `verb.catch` (new) | RATTRAPE ! |
   | `coffee_table_object.json` | `verb.remove` (new) | RETIRE ! |
   | `papa_microsleep.json` | `verb.wake_up` (new) | RÉVEILLE-TOI ! |
   | `silence_mischief.json` | `verb.lift` (exists) | SOULÈVE ! |

   The new strings follow the existing `VERB_SHAPE` rule (uppercase, ends with « ! »). The frozen test copies of threat defs (`tests/support/*.threat.json`, `tests/threats/fixtures/*.json`, inline defs in `.test.ts` files) get the keys too. `content/_schemas/` is regenerated with `npm run content:schemas`, never edited by hand.
4. **The two deferred `…Key` items are closed** (`deferred-work.md` L20, L23): a « reference to a missing string » test goes through `loadContent` **and** `checkContent` end to end with a threat whose `verbKey` is missing from the strings. Mark both items resolved in `deferred-work.md` (the « narrow detection » one: `verbKey` is a singular `…Key` and is detected; arrays and `hotKey`-style false positives stay open, say so).

### Verb label (client)

5. **A threat in `telegraph` or `windowOpen` shows its verb above its icon** (`verb-label`, in the `CSS2DRenderer` layer, part of the threat's marker): the translated text of `verbKey` (« ESQUIVE ! », `verb.dodge`, for a `dodge` def whose `verbKey` is `null`), in `{typography.verb}` on the regular surface and `{typography.verb-compact}` on the compact one (`:root[data-pp-surface="compact"]`), uppercase, fill `{colors.paper}`, **5 px** visible `{colors.ink}` outline (`paint-order: stroke fill`), hard ink shadow. It appears and disappears with the icon (same rule as today's markers: shown while the threat is `telegraph`, `windowOpen`, or the pressed one), and never takes pointer events (the hit test is unchanged).
6. **A long verb shrinks, never truncates.** Its font size is `min(base, base × maxWidth / naturalWidth)`, never under **28 px** (DESIGN `verb-label.minFontSize`); at 28 px a still-too-wide verb overflows instead of being cut (no `overflow: hidden`, no ellipsis, no wrapping inside a word). `maxWidth` is `VERB_MAX_WIDTH_PCT` % of the world layer's width (D5). The size is recomputed when the surface changes, when the layer is resized, and once the display font is loaded; never per frame.
7. **The icon's colour and shape come from the def** (`threat-icon`): `circle` + `parry` is today's `{colors.parry}` disc with the ink outline; `triangle` + `dodge` is a `{colors.dodge}` triangle with the ink outline and the hard ink shadow (mockup `icon-dodge`), at the same 56 / 64 px sizes. The triangle style is built and unit-tested now (with a hand-made entry), used from story 5.1. Halo, highlight, hold-ring and glyph are unchanged for both shapes.
8. **The `target-highlight` chevron sits above the verb**, not above the icon (DESIGN › target-highlight; mockup state B), and **the glyph chip sits beside the verb** of the auto-targeted threat (DESIGN › glyph-chip, EXPERIENCE › glyph-chip: « beside the auto-targeted threat's verb »), following the verb's stacking offset (AC 9). A threat with no verb text (unknown def, AC 12) keeps both beside / above its icon as today.

### Overlap

9. **When verbs of several active threats would overlap on screen, they are offset to stay readable, and the most urgent threat is in front.** Urgency is the auto-target's rule (story 1.17): the threat whose window closes first (`windowOpenAt + responseWindow.windowMs`), ties to the lower id, extracted into one shared helper used by `pickAutoTarget` and the layout (no second copy of the rule). The most urgent verb stays at its place; each less urgent one is pushed up (screen space) by the smallest step that clears every verb already placed, plus `VERB_STACK_GAP_PX`. Its whole marker (icon included) gets a higher `z-index` the more urgent it is. Layout runs once per frame in `worldUi.render(camera)` before the `CSS2DRenderer`, from the projected icon points; it allocates nothing and writes the DOM only when an offset (whole px) or a rank changes.

### Tests and checks

10. **Unit tests** (Vitest, next to the code): the verb fitting (short, exactly at max, long, floor at 28 px, both surfaces, the `--pp-verb-scale` multiplier of D9), the stacking (no overlap, two, three, an already clear pair stays at 0, urgency order and ties, ranks), the entries (verb text from `verbKey`, `null` on a `dodge` def → `verb.dodge`, shape and colour copied, unknown def → no verb, `bolt`, circle/parry, one `warn`), the marker DOM (classes per shape, verb text, label hidden with its marker, chevron and chip placement), and the urgency helper (and `autoTarget.test.ts` still green).
11. **DESIGN drift test** `tests/architecture/verbLabelSpec.test.ts` (pattern of `holdRingSpec.test.ts`): `VERB_MIN_FONT_PX` = `verb-label.minFontSize`, `VERB_STROKE_PX` = `verb-label.strokeWidth`, `verb-label` uses `{colors.paper}` / `{colors.ink}` and `paint-order: stroke`, `threat-icon` maps `parry`→`circle`, `dodge`→`triangle` (the schema's pairs), and the typography sizes in `tokens.css` match `typography.verb` / `verb-compact` (already covered by `designTokens.test.ts`: do not duplicate).
12. **e2e** (`tests/e2e/threats.spec.ts`, chromium + webkit, landscape phone viewport): each of the three planned threats, once telegraphed, shows its verb text (read from `strings.fr.json`, not hard-coded in the spec), a computed `font-size` ≥ 28 px, a `circle` icon, and the full text rendered (`textContent` equals the string, computed `text-overflow` is not `ellipsis`, no `overflow: hidden` on the label). A second test makes two threats active at once (`__PP__` freeze + `ForceThreat` + advance, no `waitForTimeout`), and checks their verb boxes (`getBoundingClientRect`) do not intersect and the most urgent marker has the higher `z-index`. The micro-sleep's verb follows Papa like its icon.
13. **Screenshots:** the frozen autoplay frame now shows a verb. Refresh `autoplay-frozen-{chromium,webkit}-darwin.png`, look at them, and say so in the Completion Notes. The `linux` ones are already stale since story 3.1 (`deferred-work.md` L435, Geo's call pending): do not try to regenerate them without Docker; report it again.
14. **No sim change.** The sim never reads `verbKey`, `iconShape` or `color`; goldens and `npm run sim` results are unchanged. If a golden hash moves, stop and find out why: do not run `golden:update` to make it pass.
15. **`(unset VITE_DEBUG_ALLOWED; npm run ci)` is green** (`dist:check` passes for both flavours, `perf.spec.ts` within budget: a verb is one DOM node per marker, no per-frame allocation).

## Tasks / Subtasks

- [ ] **T1. Content and schemas** (AC 1-4)
  - [ ] `threat.ts`: `THREAT_ICON_SHAPES`, `THREAT_COLORS` (`as const` + types, like `THREAT_ICONS`), `verbKey`, `iconShape`, `color` in `baseShape` with `.describe(...)`; the `superRefine` rules of AC 1 next to the `holdUntilMs` one. Update the doc comment that says « Story 2.2 adds the verb, shape and colour ».
  - [ ] `strings.fr.json`: `verb.catch`, `verb.remove`, `verb.wake_up`.
  - [ ] The five `content/threats/*.json`, the frozen copies in `tests/`, inline test defs; `npm run content:schemas`.
  - [ ] Schema tests (missing key ×3, wrong regex, null on a parry def, mismatched pair, triangle refused today) and the end-to-end missing-string tests in `loadContent.test.ts` and `checkContent.test.ts`; close the two `deferred-work.md` items.
- [ ] **T2. Constants** (AC 6, 9, 11): in `src/shared/constants.ts`: `VERB_MIN_FONT_PX = 28`, `VERB_STROKE_PX = 5`, `VERB_MAX_WIDTH_PCT = 45`, `VERB_STACK_GAP_PX = 4`, each with a one-line doc saying where it comes from (DESIGN, or `[ASSUMPTION]` tuned after playtest). `verbLabelSpec.test.ts`.
- [ ] **T3. Urgency helper** (AC 9): move the « closes first, ties to lower id » rule out of `pickAutoTarget` into one exported function (e.g. `compareUrgency(a, b)` / `threatCloseAt(threat)` in `src/client/input/urgency.ts`), used by both. `autoTarget.test.ts` unchanged and green.
- [ ] **T4. Entries** (AC 5, 7, 12): `ThreatMarkerEntry` gains `readonly verb: string` (translated once at build; `''` when unknown), `readonly iconShape`, `readonly color`. `threatMarkerEntries` takes the defs' `verbKey | iconShape | color | response` and a `Translator`; `levelSession.ts` passes `t` (add it to its deps if it lacks it). Fallbacks: unknown def → `verb: ''`, `circle`, `parry`, with the existing single `warn`.
- [ ] **T5. Marker DOM and CSS** (AC 5, 7, 8)
  - [ ] `threatMarkers.ts`: a verb stack (chevron + `.pp-threat-verb`) above the icon; the icon's shape and colour from the entry (modifier classes, e.g. `pp-threat-icon--triangle`, and `--pp-threat-color: var(--pp-color-dodge)`); the triangle drawn as an SVG polygon with the ink stroke (a CSS `border` cannot follow a `clip-path`). Add the new classes to `THREAT_CLASSES`.
  - [ ] `ui.css`: `.pp-threat-verb` (the `pp-type-verb` family; compact size under `:root[data-pp-surface="compact"]`; `white-space: nowrap`; `text-transform: uppercase`; `color: var(--pp-color-paper)`; `paint-order: stroke fill`; `text-shadow` hard ink like the mockup), `font-size: calc(var(--pp-verb-fit-px) * var(--pp-verb-scale, 1))`-style hook (D9); chevron moved; no `overflow`/`text-overflow` on the label. The stroke width is set inline from `VERB_STROKE_PX` (`-webkit-text-stroke: 2 × 5 px`, since `paint-order` hides the inner half), like the hold-ring takes its sizes from constants.
- [ ] **T6. Fit and layout** (AC 6, 9): a pure, allocation-free `src/client/ui/world/verbLayout.ts` (`fitVerbFontPx(naturalWidthPx, basePx, maxWidthPx)` and a stacker over preallocated rect arrays); `ThreatMarkers` gains a `layout(camera, widthPx, heightPx)` (or equivalent) called from `worldUi.render` before `renderer.render`, and a refit on `setSize`, on the surface change, and after fonts load. Measure text widths with a single offscreen canvas `measureText` (font string per surface, built at refit, not per frame) rather than `offsetWidth` (the markers are `display: none` until shown).
- [ ] **T7. Glyph chip** (AC 8): `showAt` places the chip beside the verb of the targeted marker (its offset and width), or beside the icon when the marker has no verb. Update `glyphChip.test.ts` and the `boot.ts` call.
- [ ] **T8. Unit tests** (AC 10) in `threatMarkers.test.ts`, `verbLayout.test.ts`, `glyphChip.test.ts`, `worldUi.test.ts`, `levelSession.test.ts`, `urgency.test.ts`.
- [ ] **T9. e2e** (AC 12, 13): extend `tests/e2e/threats.spec.ts`; refresh the darwin screenshots of `autoplay.spec.ts` and look at them.
- [ ] **T10. Docs**: `deferred-work.md` (closed items, new open points: verb positions near the room edge, the chip's flip, the verb set), `project-context.md` only if a new rule emerges.
- [ ] **T11. CI** (AC 15): `env | grep VITE_` first, then `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

## Dev Notes

### Decisions (D1-D9)

- **D1. `verbKey`, not `verb`.** `project-context.md` (« strings live in `content/strings.fr.json` and go through `t(key)` »), `stringRefs.ts` (« a literal UI string in a content file is a review failure ») and `deferred-work.md` L20/L23 (« the verb is `verbKey`, story 2.2 ») all agree; the architecture's JSON example (`game-architecture.md` › Menaces › Définition) predates that rule. Strings already exist: `verb.lift`, `verb.firm`, `verb.swap`, `verb.put_down_first`, `verb.dodge`, and `StringsSchema` already enforces `VERB_SHAPE` on the `verb.` group. The reconciliation of « content:check fails without a verb » (epics AC 3) and « a dodge threat with no verb of its own shows ESQUIVE ! » (epics AC 1): the key is always written; `null` is the explicit « default of the response », the same convention as `windowMs: null` = « the feel.json value ». A missing key fails.
- **D2. `color` uses the DESIGN token names** (`parry`, `dodge`), not the architecture's `parryBlue`: the client maps it straight to `--pp-color-<color>` from `tokens.css`, which `designTokens.test.ts` already ties to DESIGN.md. Shape and colour are both stored (architecture P1, epics AC 3) even though one implies the other: the schema forbids a mismatched pair.
- **D3. Triangle is ready, not reachable from content.** `THREAT_RESPONSES` only accepts what the sim judges (`parry`, `firm`); `dodge` joins in 5.1. The client's triangle and the `verb.dodge` default are tested with hand-made entries; the schema refuses `triangle` / `dodge` until then, with a message pointing to 5.1.
- **D4. The verb is part of the threat's marker**, not a separate `CSS2DObject`: it shows and hides with the icon by construction, follows Papa for the micro-sleep with no extra code, and needs no new reconciliation. The architecture's file list names `verbLabel.ts` / `threatIcon.ts` (`game-architecture.md` › structure, L521, L953): put the pure verb logic (fit, stacking) in `verbLayout.ts`, and keep the DOM in `threatMarkers.ts`; splitting `threatMarkers.ts` (392 lines) into `threatIcon.ts` + `verbLabel.ts` is welcome if it reads better, but is not required.
- **D5. Max width = 45 % of the world layer's width** (`VERB_MAX_WIDTH_PCT`), `[ASSUMPTION]`: neither DESIGN nor EXPERIENCE gives one. On an 844 px landscape phone that is ≈ 380 px; « POSE-LE D'ABORD ! » (the longest verb, E4) at 32 px stays above 28 px. EXPERIENCE › i18n asks layouts to tolerate +30 % string length without truncation: the fit is what delivers it.
- **D6. Stacking moves verbs up, never down or sideways**, so a verb never covers its own icon or the halo; the most urgent is at offset 0 and in front. Greedy in urgency order is enough for the 2-3 threats the prototype shows at once (`maxSimultaneous`). Known limit: near the top edge a pushed verb can leave the screen: log it in `deferred-work.md`, do not solve it now (same family as « the glyph chip never flips », L318).
- **D7. Urgency has one definition.** `pickAutoTarget` already defines « most urgent » (window closes first, ties to lower id; story 1.17 D3). Duplicating it in the layout would let them drift: extract it.
- **D8. Layout runs in `worldUi.render(camera)`** because it needs the camera (screen-space overlap). `render` already returns early when nothing is visible: keep that. One `Vector3` and preallocated arrays sized at `mount` (the level's marker count); no `sort` with a closure per frame (an insertion sort over a preallocated index array is fine for ≤ 10 markers).
- **D9. Hook for « Grands verbes » (story 2.10), not the setting.** The fit reads a scale (`--pp-verb-scale`, default 1; 2.10 sets 1.25) and multiplies both the base size and the 28 px floor (fit = `max(28 × scale, min(base × scale, base × scale × maxWidth / naturalWidth))`), so 2.10 only flips the variable and calls refit. Do not add the setting, the save field or the string here.

### Current state of the files this story changes (read before editing)

- **`src/content/schemas/threat.ts`**: `baseShape` (id, response, telegraphDelayMs, windowMs, holdUntilMs?, icon, feedback, cooldownMs, gagCryMs?), two strict variants (`anchor`/`papa` with `gag`; `hiddenZone` with `findMaxMs`, `surpriseGags`), a `superRefine` for `holdUntilMs`. `ThreatDef`, `ThreatGagIds`. Preserve: strictness, every existing rule, `ThreatIcon` (the glyph stays a separate key from the shape).
- **`content/threats/*.json`**: five parry defs; none has a string field yet. `"$schema"` first.
- **`src/content/stringRefs.ts`**: finds every `…Key` string anywhere in content and checks it against the strings. `verbKey` is picked up with no change. `null` is not a string, so a `null` `verbKey` is skipped (correct).
- **`src/client/ui/world/threatMarkers.ts`**: `ThreatMarkerEntry` (threatId, mutable xM/zM for `followsPapa`, yM, icon, followsPapa), `threatMarkerEntries` (built once per level in `levelSession.ts` L458 from `levelPlan.threats`), `THREAT_CLASSES`, `THREAT_ICON_PATHS`, `createMarker` (root > halo, hold, highlight, chevron, icon), `updateHoldRing`, `createThreatMarkers` (`mount`/`unmount`/`update`/`isAnyVisible`/`entries`/`dispose`). `update` is allocation-free, writes the DOM on change only, returns the press-latency mark. Preserve all of it: the hit test (`hitTest.ts`) and `__PP__.threatScreenPoints` read `entries` (same objects, never copied); `tapLatency.spec.ts` relies on the return value of `update`.
- **`src/client/ui/world/glyphChip.ts`**: one `CSS2DObject`, `showAt(entry, text)` places it at the icon point; the CSS hangs the chip to the right of the icon (`left: calc(var(--pp-threat-size) / 2 + spacing-2)`).
- **`src/client/ui/world/worldUi.ts`**: owns the `CSS2DRenderer` (`sortObjects = false`: it allocates), the tap marker, threat markers, chip, object markers; `render` skips the DOM renderer when nothing is visible.
- **`src/client/ui/styles/ui.css`** L990-1220: `--pp-threat-size` 64 / 56 px by surface, `.pp-threat-icon` (parry disc hard-coded), halo, highlight, hold-ring, chevron (`bottom: calc(100% + size × 0.3 + 2px)`), glyph chip, the reduced-motion block (L1209+: halo, chevron, hold pop stop animating; the verb has no animation, keep it so). `.pp-type-verb` / `.pp-type-verb-compact` exist (L69-81).
- **`src/client/ui/styles/tokens.css`**: `--pp-color-parry`, `--pp-color-dodge`, `--pp-font-verb-*`, `--pp-font-verb-compact-*` (mirrors DESIGN 1:1; test-enforced). Do not add a non-DESIGN token there; component sizes go in `constants.ts`.
- **`src/client/app/surface.ts`**: keeps `data-pp-surface` (`compact` under a 430 px short side) on the root.
- **`src/client/input/autoTarget.ts`**: `pickAutoTarget` with the urgency rule inline (L44-50).
- **`src/client/boot.ts`**: `showGlyphChip` (L504-539) finds the targeted entry by index and calls `showAt`; the frame (L645-672) calls `updateThreats` then `showGlyphChip` then `worldUi.render(camera)`.
- **`src/client/ui/fonts.ts`**: `loadFonts` (Baloo 2, Nunito) with a timeout and a `warn`; refit after it resolves (a fallback font measures differently).

### Must not change

- The sim and its goldens (AC 14), the hit test priority and radius, the auto-target's choice (only its code moves), the press-latency mark, the hold-ring, the halo's 0.7 Hz pulse (nothing flashes above 3 Hz, UX-DR12 / story 2.10), the object markers, the tap marker.
- `ThreatIcon` glyphs stay as they are (E7 redraws them).
- No literal colour, size or French string in TS or CSS: colours via `--pp-color-*`, sizes via `constants.ts` or tokens, verbs via `t(verbKey)`. `tests/architecture/uiStrings.test.ts` scans for literals.

### Architecture compliance

- Layers: content schema in `src/content` (imports `zod`, `@shared` only); markers in `src/client/ui/world`; nothing in `src/sim`. Cross-layer imports through `@content`, `@shared`, `@sim`.
- No `console.*`: `log.warn('render', …)` for fallbacks. No silent `catch`.
- Allocation-free per frame (architecture › performance; `perf.spec.ts` budgets: p95 frame ≤ 20 ms, ≤ 100 draw calls; the CSS2D layer adds no draw call).
- World-anchored UI is DOM via `CSS2DRenderer` (project-context L73); no WebGL text.

### Library and framework notes

- **three `CSS2DRenderer`** (`three/addons/renderers/CSS2DRenderer.js`): it writes `transform: translate(-50%,-50%) translate(x px, y px)` and `display` on each object's element; with `sortObjects = false` it never writes `zIndex`, so writing `zIndex` yourself on the marker root is safe. Apply the stacking offset to an inner element (the verb stack), never to the root's `transform` (the renderer owns it).
- **`paint-order` on HTML text**: supported by Chromium (since 123) and WebKit; with `-webkit-text-stroke` the stroke is centred on the glyph edge, so a visible 5 px outline needs a 10 px stroke painted under the fill (the mockup does exactly that). Check both browsers in the e2e screenshot.
- **Canvas `measureText`** gives the advance width for a `font` string such as `800 40px "Baloo 2"`; add the stroke (`VERB_STROKE_PX` per side) to the width. Measure only after `document.fonts` has the face, otherwise the fallback width is used.

### File structure

| File | Change |
|---|---|
| `src/content/schemas/threat.ts` | UPDATE: keys, enums, rules |
| `content/threats/*.json` (5), `content/strings.fr.json` | UPDATE |
| `content/_schemas/threat.schema.json` | REGENERATED |
| `src/shared/constants.ts` | UPDATE: four `VERB_*` constants |
| `src/client/input/urgency.ts` (+ test) | NEW: shared urgency rule |
| `src/client/input/autoTarget.ts` | UPDATE: uses it |
| `src/client/ui/world/verbLayout.ts` (+ test) | NEW: fit and stacking, pure |
| `src/client/ui/world/threatMarkers.ts` (+ test) | UPDATE: verb stack, shape/colour, layout |
| `src/client/ui/world/glyphChip.ts`, `worldUi.ts` (+ tests) | UPDATE |
| `src/client/app/levelSession.ts` (+ test), `src/client/boot.ts` | UPDATE: translator, chip call, refit hooks |
| `src/client/ui/styles/ui.css` | UPDATE |
| `tests/architecture/verbLabelSpec.test.ts` | NEW |
| `tests/content/threatSchema.test.ts`, `checkContent.test.ts`, `loadContent.test.ts` | UPDATE |
| `tests/support/*.threat.json`, `tests/threats/fixtures/*.json` | UPDATE |
| `tests/e2e/threats.spec.ts`, `tests/e2e/__screenshots__/autoplay.spec.ts/*-darwin.png` | UPDATE |
| `_bmad-output/implementation-artifacts/deferred-work.md` | UPDATE |

### Testing

- Vitest with a DOM double (see `threatMarkers.test.ts`: `doc` is injected); `describe/it/expect` from `vitest`. The fit and the stacking are pure functions: test them exhaustively there, not through the DOM.
- e2e helpers already exist: `ppFreeze`, `ppAdvance`, `ppWorld`, `stepToFirstTelegraph`, `waitFrames`, `ForceThreat` via the test API (story 1.21 D10). No `waitForTimeout`.
- Coverage thresholds apply to `src/sim` only, but every new client function gets a unit test.
- **Trap:** the shell exports `VITE_DEBUG_ALLOWED=false`. Run e2e and CI as `(unset VITE_DEBUG_ALLOWED; …)`, or 134 of 140 specs time out on `data-pp-app="start"`.

### Previous story intelligence (1.11, 1.17, 1.23, 2.1, 3.1)

- **1.11** built the icon, halo and highlight (UX-DR10 state A) and the press-latency mark; keep `tapLatency.spec.ts` green.
- **1.17** built the auto-target and the single glyph chip (state B); « exactly one chip » is true by construction, keep it.
- **1.23** took the hold-ring's pixel sizes from `constants.ts` with a DESIGN drift test: copy that pattern for the verb.
- **2.1**: the overlay's DOM is built lazily so the boot screenshots stay untouched; a guardrail scanner refused a field named `window` in the sim (not relevant here: no sim change). The feel panel edits `feel.json` only: the verb constants are not feel values.
- **3.1**: the darwin screenshots were refreshed and the Linux ones were not (no Docker); Geo merged anyway and doubts the visual test is worth its upkeep (`deferred-work.md` L435).

### Git intelligence

Recent work on `main`: story 2.1 (debug overlay, `SetFeel`, feel-writer plugin, snapshot 13), story 3.1 (noise gauge), story 1.24 (playtest build). None touches `threatMarkers.ts` or `threat.ts` except 3.1's `gagCryMs` (keep it). The branch `story/2-2-verbe-affiche-et-icones-couleur-forme` was fast-forwarded to `main` (`ad9e983`) before this story was written.

### Project Structure Notes

- New files follow the conventions: `camelCase.ts`, factories `create<Name>`, constants `UPPER_SNAKE` in `shared/constants.ts`, units as suffixes (`…Px`, `…Pct`).
- Variance from the architecture, with reasons: `verbKey` instead of `verb` (D1); `color: 'parry' | 'dodge'` instead of `parryBlue` (D2); the verb lives inside the marker (D4).

### Project context rules (from `_bmad-output/project-context.md`)

- UI is vanilla DOM + CSS, `pp-` prefixed kebab-case classes; world labels via `CSS2DRenderer`; no framework.
- `tokens.css` mirrors DESIGN.md 1:1 (test-enforced); never hard-code a colour, size or UI string.
- Content ids `lower_snake_case`, JSON keys `camelCase`, strings in `content/strings.fr.json` behind `…Key` properties.
- Reduced motion is client-only and never changes sim timing.
- `strict` + `erasableSyntaxOnly`: no `enum`; string-literal unions from `as const` arrays.
- Never weaken a guardrail (Biome rules, architecture tests) to make code pass.

### Open points for Geo (tune or decide after playing)

1. **The verbs** of the three threats and the two Papa-side ones are a proposal (AC 3): RATTRAPE ! (stairs), RETIRE ! (coffee table; « ÉCHANGE ! » is kept for the swap of E6), RÉVEILLE-TOI ! (micro-sleep, two words, the hyphen keeps it one block), SOULÈVE ! (silence found). Change the strings, not the code.
2. **`VERB_MAX_WIDTH_PCT` (45 %) and `VERB_STACK_GAP_PX` (4 px)** are assumptions; they are constants (DESIGN-level layout, like the hold-ring), not `feel.json` values. Say if you want them in the feel panel instead.
3. **The verb near the top or a side of the screen** is not kept on screen (D6); to check on a phone in the playtest.

### References

- [Source: _bmad-output/planning-artifacts/epics.md › Story 2.2 : Verbe affiché et icônes couleur + forme; FR53, FR54, NFR6, NFR8, UX-DR10]
- [Source: _bmad-output/planning-artifacts/epics.md › Story 2.10 (Grands verbes +25 %, the scale hook of D9)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md › Menaces › Définition (exemple), structure `src/client/ui/world/`, table E2 « Verbe affiché, code couleur + forme »]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md › Lisibilité (verbes façon WarioWare, daltonisme), Menaces du prototype]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md › frontmatter `typography.verb`, `verb-compact`, `components.verb-label`, `threat-icon`, `target-highlight`, `glyph-chip`; Color (reserved signals); Typography (28 px floor); Surfaces; World-anchored text]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md › Canonical strings (verbs, « ESQUIVE ! » default), Component behaviour (verb-label, glyph-chip), i18n (+30 %, never truncated), Accessibility floor]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/mockups/key-hud-level.html › `.verb`, `.icon-dodge`, states A and B]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md L20, L23 (`…Key`), L318 (chip never flips), L435 (Linux screenshots)]
- [Source: _bmad-output/implementation-artifacts/1-17-ciblage-automatique-au-clavier-et-a-la-manette.md (urgency, glyph chip)]
- [Source: _bmad-output/implementation-artifacts/1-23-fermete-optionnelle.md (hold-ring constants + DESIGN drift test)]
- [Source: _bmad-output/project-context.md (UI rules, strings, tokens)]

## Dev Agent Record

### Agent Model Used

### Implementation Plan

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-29: Story created (ready-for-dev).
