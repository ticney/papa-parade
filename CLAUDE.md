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
| `npm run test:coverage` | Vitest with the `src/sim` ≥ 90 % coverage thresholds; this is what `npm run ci` runs instead of `npm test` |
| `npm run golden:update` | Regenerate the golden journals and references (deliberate: say so in the story) |
| `npm run sim -- --bot <id> …` | Plays headless games with a bot (`perfect`, `human`, `random`, `idle`) and writes a JSON report (`--level` (default: the first level, `salon_kitchen`), `--tier assistance\|normal\|experienced`, `--seed`, `--runs`, `--until-ms`, `--out`, `--journals`, `--chrono-ring on\|off` (does the `human` bot see the chrono-ring, default `on`), `--compare <dir>` (adds a `comparison` with the testers' journals of `<dir>/<testerId>/*.json` to the report)); a run lasts the level's `durationMs` (until `LevelEnded`) unless `--until-ms` caps it; the report's `endsByReason` counts `timer`, `mamaWoke`, `cycleDone` and `mamaHome` (Mama came home early: the catastrophe gauge at 100 %, the only « lost level »), with `mamaHomeMeanAtMs`, `meanCatastrophePeakPct` and, per run, `mamaHomeAtMs` and `catastrophePeakPct`; the `chores` section counts the house chores (runs with a chore finished, beats by quality, mean Maison points and mean beats per run, story 9.4, and `abandoned { telegraphed, resolved, boiledOver }`, the pots of the chores left alone, story 9.5, and `byDef { <defId>: { runsCompleted, beats { perfect, success, fail }, meanBeatsMissed } }`, `meanObjectsBroken` (the plates) and `open { telegraphed, closed, gagged }` (the open dishwasher's threats), story 9.6); `finales { lastWave, cycleDone }` (the `FinaleReached` events, at most one a game, story 7.4); `visibility` (the `human` bot's only, null for the others and in a fixed-camera level, story 9.8: `telegraphs`, `seenOffscreen` (first seen through an off-screen bubble), `cappedMs` (waiting for a bubble behind the cap of 3), `neverSeen`, `meanSeenDelayMs`); `--help` lists them |
| `npm run sim:replay -- <file>` | Replays a game recorded by `npm run sim --journals` (`papa-parade.run`, strict invariants), or a journal a tester exported from the Result screen of a playtest build (`papa-parade.journal`, replayed in the invariant mode it was played in), and checks it ends in the same state (exit 0 if so). A different content hash is a warning, not a failure |
| `npm run sim:balance [-- --level <id>]` | Plays the first level (or `--level`) with `human`, `perfect` and `idle` (200 games each from seed 1 at the Normal tier: `content/playtest.json › simulated`) and prints one `OK` / `KO` line per target of the GDD's « La défaite est possible sans être un mur »: `human` loses 10-30 % of its games (`mamaHome`), fails each new mischief and lets the baby into the open dishwasher at least once; `perfect` fails nothing, never loses and finishes both chores every time; `idle` loses before the timer. Exit 1 on any `KO`: retune the waves of the level, never the targets. About a minute, CPU only; part of `npm run ci` (story 9.8) |
| `npm run playtest:metrics -- <dir> [--observations <csv>] [--out <md>] [--json <file>]` | Computes the 6 playtest indicators (NFR11) from `<dir>/<testerId>/*.json` (journals exported by testers; bot and invalid files are skipped and listed) and Geo's notes (`docs/playtest/observations.csv`, columns in `observations.example.csv`; the three of indicator 6, « Papa se lit sans sa bulle », are optional: without them it is `n/a`, story 7.12). The thresholds are in `content/playtest.json`. Markdown on stdout or `--out`; exit 0 even when an indicator is KO, exit 1 on an input to fix |
| `npm run e2e` | Playwright, chromium + webkit, landscape phone viewport, every spec (the smoke tier and the extended one, see « Where a test goes »), 4 browsers at once (`PP_E2E_WORKERS=<n>` or `--workers=<n>` to change it). The specs play in the old salon (`salon_crawler`) unless they name a level: every `page.goto` goes through `appUrl` (`tests/e2e/support/game.ts`), which adds `level=salon_crawler` to a URL that names none (story 9.8); the first level's own specs (`firstLevel.spec.ts`, `salonKitchen.spec.ts`…) name theirs or use a bare `page.goto`. Waits its turn behind any other heavy check on the machine (see « One heavy check at a time »); `npm run e2e -- <spec files> --project=chromium` runs a few specs |
| `npm run e2e:smoke` | The smoke tier alone, on Chromium (`PP_E2E_TIER=smoke`): the specs listed in `tests/e2e/support/smokeSpecs.ts`, which prove the client wiring once per layer (boot, the first launch and its save, the `__PP__` contract, the tap loop, each level to its Result as the CLI plays it, the journal, a pause in the background). About 3 min 20 s (11 files, 60 tests, measured 2026-11-08). Waits its turn like `e2e` |
| `/?autoplay=<bot>&seed=<n>&speed=<x>&level=<id>` | A bot (`perfect`, `human`, `random`, `idle`) plays in the browser, silent, `speed` ≤ 4 (dev and playtest builds); `?level=chambre_night` picks the level, with or without a bot (a production build ignores it); with none, the game's first level, `salon_kitchen`; `?bubble=off` keeps Papa's activity bubble hidden for the session (the extracts of indicator 6, story 7.12; a production build ignores it); `window.__PP__` (dev, or `?debug=1`) drives the game from Playwright |
| `npm run e2e -- tests/e2e/autoplay.spec.ts --update-snapshots` | Regenerate the macOS screenshot references (deliberate: look at them, say so in the story). They are macOS only: the screenshot assertion is skipped on Linux (CI), which has no references |
| `npm run dist:check -- --flavor prod\|playtest [--dir dist]` | Inspects a built `dist/`: the CSP of `_headers`, no cross-origin URL in `index.html`, each level's `.glb` + audio ≤ 3 MiB (5 MiB for `salon_kitchen`, NFR15); `prod` also proves no `src/debug` / `src/bots` chunk (the manifest lists entry chunks only) and no debug marker (`__PP__`, `copyLog`, `pp-debug-perf`…) is in the bundle, `playtest` that the debug modules and every marker are there. Prints the level payload and the first-load gzip total |
| `npm run serve:dist -- [--dir dist] [--port n] [--host]` | Serves a built folder like the host does (applies `<dir>/_headers`, `index.html` for `/`, MIME types). `--host` opens it to the LAN (a phone), but the gamepad needs HTTPS, so it does not work there |
| `npm run e2e:dist` | Playwright on the **built playtest** `dist/` (`playwright.dist.config.ts`, `tests/e2e-dist`): checks `dist/` first, then the dist specs (chromium + webkit: plays a level, no CSP violation, no other origin, `?debug=1` FPS counter), then `perf.spec.ts` alone (chromium, a whole level at speed 1, about 5 min: p95 frame ≤ 20 ms, ≤ 100 draw calls, ≤ 100k triangles). It never builds. `PP_DIST_URL=https://…` checks a deployed build instead (dist specs only). Waits its turn like `e2e` |
| `npm run deploy:check -- <https url>` | Checks a deployed build: 200, `_headers` not published, the entry script, the CSP of `public/_headers` and `nosniff` on each response |
| `npm run content:check` | Validate `content/**` against the Zod schemas, string references and generated JSON Schemas |
| `npm run content:schemas` | Regenerate `content/_schemas/` (commit the result; never edit it by hand) |
| `npm run ci:fast` | The quick loop (about a minute, no browser): `typecheck`, `lint`, `content:check`, `test`. Run it after every task while developing |
| `npm run ci:story` | The gate before a merge (about 4 min 20 s; the whole Chromium suite it used to play took 15 min 20 s on 2026-11-08): `ci:fast`, then the smoke tier (`npm run e2e:smoke`, so it waits its turn) |
| `npm run ci` | The full check, before a playtest link only (long: the Chromium suite alone took 15 min on 2026-11-08, before WebKit, the builds and `perf.spec.ts`), in order, stopping at the first failure: `typecheck`, `lint`, `content:check`, then, holding the heavy-check lock for the rest (`ci:heavy`), `test:coverage`, `sim:balance`, `e2e`, `build:playtest`, `dist:check --flavor playtest`, `e2e:dist`, `build`, `dist:check --flavor prod`. `dist/` holds the **prod** build afterwards |
| `npm run story:new -- <epic>-<story>` | Agents run it themselves (see Git workflow): gives the story its worktree `.claude/worktrees/<story-key>` (inside the repo, git-ignored) on `story/<story-key>` (from `main`, full key looked up in `sprint-status.yaml`, `npm ci` there unless `--skip-install`), or finds the one that already holds the branch; last line `WORKTREE=<path>` |

**Which check, when (a free game for Geo and friends: keep the checks light; Geo's call, 2026-11-01, lightened again 2026-11-08).**
- *While developing a story*: after each task, `npm run ci:fast`, and no browser. Only a task that changes the client wiring (input, a screen, the HUD, the `__PP__` API, the asset loading) also runs, on Chromium, the one or two specs that pin that change (`npm run e2e -- <spec files> --project=chromium`), never a sweep of « the specs it might touch ».
- *Once per story, after the review and before the merge*: one `npm run ci:story` (`ci:fast` and the smoke tier). dev-story does not run it. A red spec is fixed or rerun alone; when that spec is green, do not rerun the whole tier, and say what happened. After merging `main` into the branch, `ci:fast` is enough.
- *After a review fix*: `ci:fast`, plus the spec that pins the fix if it touches the client wiring.
- *`npm run ci` runs only before a playtest link*, no longer at the end of an epic. It adds the extended tier of the e2e suite, WebKit, the coverage thresholds, `sim:balance` (the first level's rhythm over 200 simulated games per bot), both builds, `e2e:dist` and `perf.spec.ts` (about 5 minutes of real time, one whole level at speed 1). A regression in these may therefore sit on `main` until the next playtest, and is fixed before the link goes out: Geo accepts that.
- *GitHub Actions* runs the `ci:fast` stages on pushes to `main`, and nobody waits for it. A red run is fixed in the next story, not chased.

**Where a test goes (Geo, 2026-11-08).** The sim is pure and deterministic, so the game is proven headless: a rule, a threat, a chore, a score, a bot's behaviour gets its tests in Vitest (sim tests, bots, goldens), never a new e2e spec. A browser spec is only for what a browser alone shows, the client wiring: a gesture that becomes a command, a screen, a mirror of the state, an asset that loads. Such a new spec is in the extended tier (it runs in `npm run ci`); `SMOKE_SPECS` changes only with Geo's OK, and `tests/architecture/e2eSmoke.test.ts` caps it at 12 files. A spec checks what the player sees, not the internals: no list of phases in order, no save version number, no field layout of `state()`. Pinned internals turned each story into a round of fixing specs it never touched (stories 3.7, 3.8).

**One heavy check at a time (Geo, 2026-11-03).** Two agents on two stories used to run their Playwright suites at once and load the Mac until specs timed out. `npm run e2e`, `e2e:smoke`, `e2e:dist`, `ci:story` (after its `ci:fast`) and `ci` (after `typecheck`, `lint`, `content:check`) now go through `tools/ci/heavyLock.sh`: one lock for the main checkout and every worktree (`.git/pp-heavy.lock`). A second run prints `heavy-lock: waiting for <command> in <worktree> …` every 30 s and starts by itself when the first ends; nothing to decide. So:
- Run e2e through `npm run e2e -- …`, never `npx playwright test` (it skips the queue), and run `ci:story`, `ci`, `e2e` and `e2e:smoke` **in the background** (`run_in_background`): the wait can last 20 min, past a foreground command's timeout. `ci:fast` and `vitest` do not queue.
- The holder keeps the Mac awake (`caffeinate -i -s`) until it ends. A lock whose holder died is taken over with a warning. After 45 min of waiting (`PP_LOCK_WAIT_MAX_S`) the run fails with exit 75: say who held the lock and rerun later; never delete `.git/pp-heavy.lock` by hand while its holder runs.

**Trap: check `VITE_DEBUG_ALLOWED` in your shell before `dev`, `e2e` or `ci`.** The agent shell may export `VITE_DEBUG_ALLOWED=false` (inherited from the parent process, set in no dotfile). A process env var beats `.env.development` in Vite, so the dev server has no `data-pp-*` mirrors and no `window.__PP__`, and almost every e2e spec times out on `data-pp-app="start"` (134 of 140 fail). It looks like « no WebGL » but is not. Run `env | grep VITE_` first; if it is set, run these as `(unset VITE_DEBUG_ALLOWED; npm run ci)` (same for `ci:story`, `npm run e2e`, `npm run e2e:smoke`, `npm run dev`). `npm run build`, `build:playtest` and `e2e:dist` pin or ignore the flag and are fine either way.

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
- **`main` only receives merges.** After the review, with a green `npm run ci:story` on the branch and Geo's explicit OK, the agent runs `git merge --no-ff story/<story-key>`, pushes `main` and deletes the branch. No OK, no merge.
- An agent may commit on `main` only files under `_bmad-output/` (planning docs). `.claude/hooks/guard-main-commit.sh` (a `PreToolUse` hook in `.claude/settings.json`) blocks any other agent commit on `main`. Never weaken it to get a commit through.
- The BMAD side lives in `_bmad/custom/gds-{create-story,dev-story,code-review}.toml`.
- **Every story runs in its own git worktree, and the agents handle it: Geo runs no git command.** Geo starts `claude` in the main checkout and runs a workflow (`/gds-create-story 2-3`, `/gds-dev-story`, `/gds-code-review`). Before touching anything, the agent runs `npm run story:new -- <epic>-<story>` and, if the `WORKTREE=<path>` it prints is not its current folder, calls the `EnterWorktree` tool with that `path` and works there. Several agents can thus run different stories at once. A branch can be checked out in one worktree only, so two agents cannot grab the same story.
- The main checkout stays on `main`. Each worktree has its own `node_modules` (no symlink: two dev servers must not share Vite's cache) and its own e2e port: 5179 in the main checkout, a port derived from the folder's path in a worktree, or `PP_E2E_PORT` (`playwright.config.ts`). The machine is shared: heavy checks queue behind each other (« One heavy check at a time » below); if a check still times out under load, rerun the failing spec alone with `--workers=1` (Vitest: `--maxWorkers=5`) and say so.
- After the merge, the review agent leaves the worktree (`ExitWorktree`, `keep`), removes it with `git worktree remove` and deletes the branch. Two stories that touch the same files (goldens, `content/_schemas`, code) conflict at the second merge: the agent aborts it and asks Geo, except for `sprint-status.yaml` status lines and appended doc sections, which it merges itself.

## Playtest deployment

The playtest is a static build, one URL per version, sent to testers as a link (FR67). Both hosts below read `dist/_headers` (copied from `public/_headers`: the CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self'`, `nosniff`, no referrer). Never widen the CSP without asking Geo.

1. `npm run ci`, then `npm run build:playtest` and `npm run dist:check -- --flavor playtest` (`npm run ci` leaves the prod build in `dist/`).
2. Deploy `dist/`. Cloudflare Pages direct upload: `npx wrangler@4.154.0 pages deploy dist --project-name papa-parade --branch playtest` (Netlify alternative: `npx netlify-cli@27.15.0 deploy --dir dist --prod`). Both versions were the latest on npm on 2026-10-28; neither is a dependency of the repo. Each upload gets its own URL.
3. **Geo does the account login the first time (`npx wrangler@4.154.0 login`).** An agent never handles his credentials.
4. `npm run deploy:check -- <url>`, then `PP_DIST_URL=<url> npm run e2e:dist`.
5. Send the URL. Testers open it as is: the link opens the big room (`salon_kitchen`, the first level since story 9.8); `?level=salon_crawler` opens the old salon and `?level=chambre_night` the bedroom; `?debug=1` (FPS counter, `window.__PP__`) is for Geo's device pass (`docs/playtest/device-measurements.md`), which gates the playtest. After a game, a tester sends the journal of the Result screen's « Copier le journal » button (or, if the clipboard refuses, the `.json` file it downloads instead: « Télécharger le journal »). It holds no personal data (no user-agent, no date). Geo replays it with `npm run sim:replay -- <file>`. Geo saves each tester's journals in `<dir>/<testerId>/`, takes notes with `docs/playtest/observation-sheet.md` (the extracts of « Papa sans sa bulle » are shown with `?bubble=off`), then runs `npm run playtest:metrics -- <dir>`.

## Where to read more

- Full agent rule set: [`_bmad-output/project-context.md`](_bmad-output/project-context.md)
- Game design (source of truth for game rules): [`gdd.md`](_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md)
- Architecture (source of truth for technical decisions): [`game-architecture.md`](_bmad-output/planning-artifacts/game-architecture.md)
- UX: [`DESIGN.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md) and [`EXPERIENCE.md`](_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md)
- Epics and stories: [`epics.md`](_bmad-output/planning-artifacts/epics.md); progress: [`sprint-status.yaml`](_bmad-output/implementation-artifacts/sprint-status.yaml)

When the GDD and the architecture disagree, game rules follow the GDD and technical mechanics follow the architecture. If still ambiguous, ask Geo.
