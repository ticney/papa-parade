# Deferred work

## Deferred from: code review of story 1-1-initialiser-le-projet-et-ses-garde-fous (2026-10-26)

- **Type-level isolation of the sim.** `tsconfig.json` gives `src/sim` the DOM `lib` and the Node `types`, so `window`, `document`, `process` or `Buffer` compile there; only Biome and the `simPurity` scanner stop them. A `src/sim/tsconfig.json` with `lib: ['ES2023']` and `types: []` would add a compile-time guard. Beyond story 1.1.
- **Biome vs `simPurity` on sim tests.** Biome lints `*.test.ts` under `src/sim` with the purity globals while `simPurity` skips them (AC 3). Decide with story 1.3, when the first sim test exists.
- **Mobile canvas CSS.** `#pp-canvas` uses `100vw`/`100vh` as T2 specifies; the area under mobile browser bars is included. Missing: `100dvh`, `touch-action: none`, `overscroll-behavior`, safe-area insets. Stories 1.4 and 1.5.
- **Global error hook.** No `error` / `unhandledrejection` listener feeds `log.error`, so uncaught errors on a phone never reach the ring buffer. Composition root, story 1.4.
- **Duplicated Biome override lists.** `src/sim/**` and `src/sim/physics/rapierPhysics.ts` repeat the whole `deniedGlobals` and import pattern lists by hand. Add a drift test if the lists grow.
- **Build coverage in CI.** CI never runs `npm run build` (production, `VITE_DEBUG_ALLOWED=false`) and e2e runs against the dev server, not the built bundle; `isMobile` is not emulated. Story 1.24.
- **Placeholder favicon.** `public/favicon.svg` is the stock Vite logo. Replace with real branding assets.

## Deferred from: creation of story 1-2-pipeline-de-contenu-et-fichier-de-feeling (2026-10-26)

- **Armed label of "Quitter vers le frigo".** The canonical string « Sûr ? Le niveau sera perdu. » (`EXPERIENCE.md` › Canonical on-screen strings) contains « perdu », which Voice and Tone and NFR9 forbid. It is not seeded in `content/strings.fr.json`. Geo reformulates it before story 3.11 (decision of 2026-10-26: later).

## Deferred from: code review of story 1-2-pipeline-de-contenu-et-fichier-de-feeling (2026-10-26)

- **`loadContent` does not loop over `CONTENT_FILES`.** It hard-codes `FEEL_FILE` and `STRINGS_FILE` and reference-checks only `feel`. The bundle is typed `{ feel, strings }`, so a registry loop only pays off with the third file. Revisit with the threat files (story 1.6).
- **`…Key` reference detection is narrow.** `KEY_PROPERTY` matches a singular `…Key` string: arrays of keys (`labelKeys`) are not checked, and names like `hotKey` or `apiKey` would be false positives. Revisit when the first threat file arrives.
- **Browser content source inlines every `content/**/*.json` in the main bundle** and derives the relative key with `lastIndexOf('/content/')`. Bundle size belongs to the performance budget (story 1.24); a nested `content/` folder is hypothetical.
- **No unused-string-key check.** Dead strings cannot be told from "not wired yet" until the client reads strings (stories 1.5+).
- **End-to-end test of `…Key` references.** The wiring in `loadContent` and `checkContent` is only covered through the `checkStringReferences` helper: `FeelSchema` is strict and no content file has a `…Key` field yet. Add the "reference to a missing string" test to both when the first threat file (story 1.6) has a `verbKey`.
- **Player-facing fallback when content fails outside dev.** `main.ts` only logs, so a playtest build with bad content shows an empty page (the `oops.message` / `oops.retry` strings are unused, and `void main()` drops any rejection). Story 1.4 (composition root), with the global error hook deferred from story 1.1.
- **Feel bounds are loose on purpose.** `windowMultiplier` accepts 0, `windowPenaltyPct` can reach 100, `earlyWakePenaltyStars` has no max of 5, `microSleepMinMs` accepts 0, and nothing checks that the Mama score can reach the top star threshold. Geo keeps them loose to experiment; tighten when the sim reads these values (story 1.6 onwards).
