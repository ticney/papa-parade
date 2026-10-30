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
| `npm run build` | Production build; the script pins `VITE_DEBUG_ALLOWED=false`, so the shell cannot flip it |
| `npm run build:playtest` | Playtest build; the script pins `VITE_DEBUG_ALLOWED=true` |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc --noEmit` (TypeScript 7; Vite does the transpiling) |
| `npm run lint` | `biome check .` (lint, format, import order, layer rules) |
| `npm run format` | `biome format --write .` |
| `npm test` | Vitest: unit, golden and architecture tests |
| `npm run test:coverage` | Vitest with the `src/sim` ≥ 90 % coverage thresholds; this is what CI runs instead of `npm test` |
| `npm run golden:update` | Regenerate the golden journals and references (deliberate: say so in the story) |
| `npm run sim -- --bot <id> …` | Plays headless games with a bot (`perfect`, `human`, `random`, `idle`) and writes a JSON report (`--level`, `--tier assistance\|normal\|experienced`, `--seed`, `--runs`, `--until-ms`, `--out`, `--journals`); a run lasts the level's `durationMs` (until `LevelEnded`) unless `--until-ms` caps it; `--help` lists them |
| `npm run sim:replay -- <file>` | Replays a game recorded by `npm run sim --journals` (`papa-parade.run`, strict invariants), or a journal a tester exported from the Result screen of a playtest build (`papa-parade.journal`, replayed in the invariant mode it was played in), and checks it ends in the same state (exit 0 if so). A different content hash is a warning, not a failure |
| `npm run playtest:metrics -- <dir> [--observations <csv>] [--out <md>] [--json <file>]` | Computes the 5 playtest indicators (NFR11) from `<dir>/<testerId>/*.json` (journals exported by testers; bot and invalid files are skipped and listed) and Geo's notes (`docs/playtest/observations.csv`, columns in `observations.example.csv`). The thresholds are in `content/playtest.json`. Markdown on stdout or `--out`; exit 0 even when an indicator is KO, exit 1 on an input to fix |
| `npm run e2e` | Playwright, chromium + webkit, landscape phone viewport |
| `/?autoplay=<bot>&seed=<n>&speed=<x>` | A bot (`perfect`, `human`, `random`, `idle`) plays in the browser, silent, `speed` ≤ 4 (dev and playtest builds); `window.__PP__` (dev, or `?debug=1`) drives the game from Playwright |
| `npx playwright test tests/e2e/autoplay.spec.ts --update-snapshots` | Regenerate the macOS screenshot references (deliberate: look at them, say so in the story). They are macOS only: the screenshot assertion is skipped on Linux (CI), which has no references |
| `npm run dist:check -- --flavor prod\|playtest [--dir dist]` | Inspects a built `dist/`: the CSP of `_headers`, no cross-origin URL in `index.html`, each level's `.glb` + audio ≤ 3 MiB; `prod` also proves no `src/debug` / `src/bots` chunk (the manifest lists entry chunks only) and no debug marker (`__PP__`, `copyLog`, `pp-debug-perf`…) is in the bundle, `playtest` that the debug modules and every marker are there. Prints the level payload and the first-load gzip total |
| `npm run serve:dist -- [--dir dist] [--port n] [--host]` | Serves a built folder like the host does (applies `<dir>/_headers`, `index.html` for `/`, MIME types). `--host` opens it to the LAN (a phone), but the gamepad needs HTTPS, so it does not work there |
| `npm run e2e:dist` | Playwright on the **built playtest** `dist/` (`playwright.dist.config.ts`, `tests/e2e-dist`): checks `dist/` first, then the dist specs (chromium + webkit: plays a level, no CSP violation, no other origin, `?debug=1` FPS counter), then `perf.spec.ts` alone (chromium, a whole level at speed 1, about 5 min: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles). It never builds. `PP_DIST_URL=https://…` checks a deployed build instead (dist specs only) |
| `npm run deploy:check -- <https url>` | Checks a deployed build: 200, `_headers` not published, the entry script, the CSP of `public/_headers` and `nosniff` on each response |
| `npm run content:check` | Validate `content/**` against the Zod schemas, string references and generated JSON Schemas |
| `npm run content:schemas` | Regenerate `content/_schemas/` (commit the result; never edit it by hand) |
| `npm run ci:fast` | The quick loop (a few seconds, no browser): `typecheck`, `lint`, `content:check`, `test`. Run it after every task while developing |
| `npm run ci` | Everything CI runs, in order, stopping at the first failure: `typecheck`, `lint`, `content:check`, `test:coverage`, `e2e`, `build:playtest`, `dist:check --flavor playtest`, `e2e:dist`, `build`, `dist:check --flavor prod`. `dist/` holds the **prod** build afterwards |
| `npm run story:new -- <epic>-<story>` | Agents run it themselves (see Git workflow): gives the story its worktree `.claude/worktrees/<story-key>` (inside the repo, git-ignored) on `story/<story-key>` (from `main`, full key looked up in `sprint-status.yaml`, `npm ci` there unless `--skip-install`), or finds the one that already holds the branch; last line `WORKTREE=<path>` |

**Which check, when (the full CI takes over 10 minutes; do not burn it on every change).**
- *While developing a story*: after each task, `npm run ci:fast`, plus only the e2e specs the change can touch, on Chromium alone: `npx playwright test <spec files> --project=chromium`. A change to a shared contract (the `__PP__` API, the HUD, the director, content schemas) means running the specs that pin it (`testApi.spec.ts`, `ui.spec.ts`, `feedback.spec.ts`…), not the whole suite.
- *Once per story, before the review*: one `npm run ci` on the branch, started only when `ci:fast` and the touched specs are already green. A red full CI is fixed with the failing spec alone, then the full CI is rerun once.
- *Not rerun after a review fix that touches only docs or tests already run green*: rerun what the fix touches, and the full CI once before the merge.
- `e2e:dist` and its `perf.spec.ts` (about 5 minutes of real time, one whole level at speed 1) are part of the full CI and of every playtest build; do not run them in the loop.

**Trap: check `VITE_DEBUG_ALLOWED` in your shell before `dev`, `e2e` or `ci`.** The agent shell may export `VITE_DEBUG_ALLOWED=false` (inherited from the parent process, set in no dotfile). A process env var beats `.env.development` in Vite, so the dev server has no `data-pp-*` mirrors and no `window.__PP__`, and almost every e2e spec times out on `data-pp-app="start"` (134 of 140 fail). It looks like « no WebGL » but is not. Run `env | grep VITE_` first; if it is set, run these as `(unset VITE_DEBUG_ALLOWED; npm run ci)` (same for `npx playwright test`, `npm run dev`). `npm run build`, `build:playtest` and `e2e:dist` pin or ignore the flag and are fine either way.

## Conventions

- **Units are mandatory suffixes:** `windowMs`, `glideMaxMs`, `noisePct`, `speedMps`. Bare `duration` or `speed` is a review failure.
- **Time:** `t` or `…At` is sim time; `…AtReal` is real time. Never mix them.
- **TypeScript:** `strict` + `erasableSyntaxOnly`, so no `enum`, no `namespace`, no constructor parameter properties. FSM states are string-literal unions.
- **Names:** factories are `create<Name>` in a file named after the export; files `camelCase.ts`; types PascalCase without `I`; constants `UPPER_SNAKE` in `shared/constants.ts`.
- **Events** are PascalCase past tense (`ThreatTelegraphed`); **commands** are PascalCase imperative (`PressThreat`).
- **Content:** ids are `lower_snake_case` and match the filename; JSON keys are `camelCase`; strings live in `content/strings.fr.json`.
- **Tests:** unit tests next to the code (`foo.test.ts`), e2e in `tests/e2e`, architecture in `tests/architecture`. Import `describe/it/expect` from `vitest`.
- Stack is pinned: do not add ESLint, Prettier, React or any UI/state/ECS library, and no Capacitor before E8.

## Git workflow

- **One branch per story, from creation to merge:** `story/<story-key>` (e.g. `story/1-21-le-silence-suspect`), cut from an up-to-date `main`. `create-story`, `dev-story` and `code-review` all work on it, with the usual commits (« Story X : création de la story », « Story X : <titre> », « Story X : corrections de la revue de code »).
- **`main` only receives merges.** After the review, with a green `npm run ci` on the branch and Geo's explicit OK, the agent runs `git merge --no-ff story/<story-key>`, pushes `main` and deletes the branch. No OK, no merge.
- An agent may commit on `main` only files under `_bmad-output/` (planning docs). `.claude/hooks/guard-main-commit.sh` (a `PreToolUse` hook in `.claude/settings.json`) blocks any other agent commit on `main`. Never weaken it to get a commit through.
- The BMAD side lives in `_bmad/custom/gds-{create-story,dev-story,code-review}.toml`.
- **Every story runs in its own git worktree, and the agents handle it: Geo runs no git command.** Geo starts `claude` in the main checkout and runs a workflow (`/gds-create-story 2-3`, `/gds-dev-story`, `/gds-code-review`). Before touching anything, the agent runs `npm run story:new -- <epic>-<story>` and, if the `WORKTREE=<path>` it prints is not its current folder, calls the `EnterWorktree` tool with that `path` and works there. Several agents can thus run different stories at once. A branch can be checked out in one worktree only, so two agents cannot grab the same story.
- The main checkout stays on `main`. Each worktree has its own `node_modules` (no symlink: two dev servers must not share Vite's cache) and its own e2e port: 5179 in the main checkout, a port derived from the folder's path in a worktree, or `PP_E2E_PORT` (`playwright.config.ts`). The machine is shared, so two CI runs at once may time out under load: rerun with `--maxWorkers=5` / `--workers=4` and say so.
- After the merge, the review agent leaves the worktree (`ExitWorktree`, `keep`), removes it with `git worktree remove` and deletes the branch. Two stories that touch the same files (goldens, `content/_schemas`, code) conflict at the second merge: the agent aborts it and asks Geo, except for `sprint-status.yaml` status lines and appended doc sections, which it merges itself.

## Playtest deployment

The playtest is a static build, one URL per version, sent to testers as a link (FR67). Both hosts below read `dist/_headers` (copied from `public/_headers`: the CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self'`, `nosniff`, no referrer). Never widen the CSP without asking Geo.

1. `npm run build:playtest`, then `npm run dist:check -- --flavor playtest`, then `npm run e2e:dist`. (`npm run ci` leaves the prod build in `dist/`: always rebuild the playtest first.)
2. Deploy `dist/`. Cloudflare Pages direct upload: `npx wrangler@4.154.0 pages deploy dist --project-name papa-parade --branch playtest` (Netlify alternative: `npx netlify-cli@27.15.0 deploy --dir dist --prod`). Both versions were the latest on npm on 2026-10-28; neither is a dependency of the repo. Each upload gets its own URL.
3. **Geo does the account login the first time (`npx wrangler@4.154.0 login`).** An agent never handles his credentials.
4. `npm run deploy:check -- <url>`, then `PP_DIST_URL=<url> npm run e2e:dist`.
5. Send the URL. Testers open it as is; `?debug=1` (FPS counter, `window.__PP__`) is for Geo's device pass (`docs/playtest/device-measurements.md`), which gates the playtest. After a game, a tester sends the journal of the Result screen's « Copier le journal » button (or, if the clipboard refuses, the `.json` file it downloads instead: « Télécharger le journal »). It holds no personal data (no user-agent, no date). Geo replays it with `npm run sim:replay -- <file>`. Geo saves each tester's journals in `<dir>/<testerId>/`, takes notes with `docs/playtest/observation-sheet.md`, then runs `npm run playtest:metrics -- <dir>`.

## Where to read more

- Full agent rule set: [`_bmad-output/project-context.md`](_bmad-output/project-context.md)
- Game design (source of truth for game rules): [`gdd.md`](_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md)
- Architecture (source of truth for technical decisions): [`game-architecture.md`](_bmad-output/planning-artifacts/game-architecture.md)
- UX: [`DESIGN.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md) and [`EXPERIENCE.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md)
- Epics and stories: [`epics.md`](_bmad-output/planning-artifacts/epics.md); progress: [`sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml)

When the GDD and the architecture disagree, game rules follow the GDD and technical mechanics follow the architecture. If still ambiguous, ask Geo.
