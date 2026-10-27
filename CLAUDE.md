# Papa Parade

Mobile-first browser game (TypeScript, Vite, Three.js). The player guides Papa to parry the threats around a baby. Code, identifiers and comments are in English; the GDD and architecture docs are in French.

## Golden rule

**The AI writes and tests the systems; Geo plays and tunes the feel.** Everything must stay playable end to end without a human (bots, headless sim, autoplay). Anything Geo might want to tweak is data (`content/feel.json`, `content/**.json`), never a hard-coded number.

## Layer boundaries

Enforced by Biome (`noRestrictedImports`, `noConsole`) and by `tests/architecture/`. Never weaken a guardrail to make code pass.

| Layer (`src/`) | May import | Must never import |
|---|---|---|
| `shared` | std lib only | any other layer, any npm package |
| `content` | `shared`, `zod` | `sim`, `client`, `platform`, `debug`, `three` |
| `sim` | `shared` (not `log`), `content` (types + bundle passed in), Rapier in `physics/rapierPhysics.ts` only | `three`, `@capacitor/*`, `client`, `platform`, `debug`, `bots`; globals `window`, `document`, `performance`, `Date`, `setTimeout`, `requestAnimationFrame`, `localStorage`, `Math.random` |
| `bots` | `@sim` (public API), `shared` | `client`, `platform`, `three`, sim internals |
| `platform` | `shared`, `@capacitor/*` | `sim`, `client`, `three` |
| `client` | `@sim`, `content`, `shared`, `platform`, `three` | sim internals, `debug` and `bots` (only a dynamic `import()` in `client/boot.ts`) |
| `debug` | anything | nobody imports it statically |
| `tools/` | anything (Node only) | never imported by `src/` |

- Cross-layer imports always go through the aliases `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug`. Relative imports never cross a layer.
- `@sim` is `src/sim/index.ts` only; there is no `@sim/*`. Inside `src/sim`, imports are relative.
- The sim never logs (it emits `SimEvent`s) and never reads real time or randomness except `world.rng`.
- No `console.*` outside `src/shared/log.ts`: use `log.<level>(channel, message, data?)`.
- I/O functions return `Result<T, E>` from `@shared/result`; no silent `catch`, every fallback logs a `warn`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (`--host`) |
| `npm run build` | Production build (`VITE_DEBUG_ALLOWED=false`) |
| `npm run build:playtest` | Playtest build (`VITE_DEBUG_ALLOWED=true`) |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc --noEmit` (TypeScript 7; Vite does the transpiling) |
| `npm run lint` | `biome check .` (lint, format, import order, layer rules) |
| `npm run format` | `biome format --write .` |
| `npm test` | Vitest: unit, golden and architecture tests |
| `npm run test:coverage` | Vitest with the `src/sim` ≥ 90 % coverage thresholds; this is what CI runs instead of `npm test` |
| `npm run golden:update` | Regenerate the golden journals and references (deliberate: say so in the story) |
| `npm run sim -- --bot <id> …` | Plays headless games with a bot (`perfect`, `human`, `random`, `idle`) and writes a JSON report (`--level`, `--seed`, `--runs`, `--until-ms`, `--out`, `--journals`); `--help` lists them |
| `npm run sim:replay -- <file>` | Replays a game recorded by `npm run sim --journals` and checks it ends in the same state (exit 0 if so) |
| `npm run e2e` | Playwright, chromium + webkit, landscape phone viewport |
| `/?autoplay=<bot>&seed=<n>&speed=<x>` | A bot (`perfect`, `human`, `random`, `idle`) plays in the browser, silent, `speed` ≤ 4 (dev and playtest builds); `window.__PP__` (dev, or `?debug=1`) drives the game from Playwright |
| `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` | Regenerate the macOS screenshot references (deliberate: look at them, say so in the story); the Linux ones (CI) with the Docker command of story 1.13 › Screenshots (it mounts the `pp-node-modules` volume so the Mac's `node_modules` stays intact) |
| `npm run content:check` | Validate `content/**` against the Zod schemas, string references and generated JSON Schemas |
| `npm run content:schemas` | Regenerate `content/_schemas/` (commit the result; never edit it by hand) |
| `npm run ci` | Everything CI runs, in order, stopping at the first failure |

**Trap: check `VITE_DEBUG_ALLOWED` in your shell before `dev`, `e2e` or `ci`.** The agent shell may export `VITE_DEBUG_ALLOWED=false` (inherited from the parent process, set in no dotfile). A process env var beats `.env.development` in Vite, so the dev server has no `data-pp-*` mirrors and no `window.__PP__`, and almost every e2e spec times out on `data-pp-app="start"` (134 of 140 fail). It looks like « no WebGL » but is not. Run `env | grep VITE_` first; if it is set, run these as `(unset VITE_DEBUG_ALLOWED; npm run ci)` (same for `npx playwright test`, `npm run dev`). `npm run build` wants `false` and is fine either way.

## Conventions

- **Units are mandatory suffixes:** `windowMs`, `glideMaxMs`, `noisePct`, `speedMps`. Bare `duration` or `speed` is a review failure.
- **Time:** `t` or `…At` is sim time; `…AtReal` is real time. Never mix them.
- **TypeScript:** `strict` + `erasableSyntaxOnly`, so no `enum`, no `namespace`, no constructor parameter properties. FSM states are string-literal unions.
- **Names:** factories are `create<Name>` in a file named after the export; files `camelCase.ts`; types PascalCase without `I`; constants `UPPER_SNAKE` in `shared/constants.ts`.
- **Events** are PascalCase past tense (`ThreatTelegraphed`); **commands** are PascalCase imperative (`PressThreat`).
- **Content:** ids are `lower_snake_case` and match the filename; JSON keys are `camelCase`; strings live in `content/strings.fr.json`.
- **Tests:** unit tests next to the code (`foo.test.ts`), e2e in `tests/e2e`, architecture in `tests/architecture`. Import `describe/it/expect` from `vitest`.
- Stack is pinned: do not add ESLint, Prettier, React or any UI/state/ECS library, and no Capacitor before E8.

## Where to read more

- Full agent rule set: [`_bmad-output/project-context.md`](_bmad-output/project-context.md)
- Game design (source of truth for game rules): [`gdd.md`](_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md)
- Architecture (source of truth for technical decisions): [`game-architecture.md`](_bmad-output/planning-artifacts/game-architecture.md)
- UX: [`DESIGN.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md) and [`EXPERIENCE.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md)
- Epics and stories: [`epics.md`](_bmad-output/planning-artifacts/epics.md); progress: [`sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml)

When the GDD and the architecture disagree, game rules follow the GDD and technical mechanics follow the architecture. If still ambiguous, ask Geo.
