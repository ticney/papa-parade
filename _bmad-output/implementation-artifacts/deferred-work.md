# Deferred work

## Deferred from: code review of story 1-1-initialiser-le-projet-et-ses-garde-fous (2026-10-26)

- **Type-level isolation of the sim.** `tsconfig.json` gives `src/sim` the DOM `lib` and the Node `types`, so `window`, `document`, `process` or `Buffer` compile there; only Biome and the `simPurity` scanner stop them. A `src/sim/tsconfig.json` with `lib: ['ES2023']` and `types: []` would add a compile-time guard. Beyond story 1.1.
- **Biome vs `simPurity` on sim tests.** Biome lints `*.test.ts` under `src/sim` with the purity globals while `simPurity` skips them (AC 3). Decide with story 1.3, when the first sim test exists.
- **Mobile canvas CSS.** `#pp-canvas` uses `100vw`/`100vh` as T2 specifies; the area under mobile browser bars is included. Missing: `100dvh`, `touch-action: none`, `overscroll-behavior`, safe-area insets. Stories 1.4 and 1.5.
- **Global error hook.** No `error` / `unhandledrejection` listener feeds `log.error`, so uncaught errors on a phone never reach the ring buffer. Composition root, story 1.4.
- **Duplicated Biome override lists.** `src/sim/**` and `src/sim/physics/rapierPhysics.ts` repeat the whole `deniedGlobals` and import pattern lists by hand. Add a drift test if the lists grow.
- **Build coverage in CI.** CI never runs `npm run build` (production, `VITE_DEBUG_ALLOWED=false`) and e2e runs against the dev server, not the built bundle; `isMobile` is not emulated. Story 1.24.
- **Placeholder favicon.** `public/favicon.svg` is the stock Vite logo. Replace with real branding assets.
