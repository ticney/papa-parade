---
baseline_commit: b871ec35b4a4dd358d8e72966099ab6cdd764ea6
---

# Story 1.1: Initialize the project and its guardrails

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.1 « Initialiser le projet et ses garde-fous ». Epics, GDD and architecture are in French; this file is in English (document_output_language). -->

## Story

As an AI developer agent,
I want a project initialized with the architecture's layer boundaries already checked automatically,
so that I can never mix the simulation and the rendering by mistake.

**Requirements covered:** supplementary architecture requirements (project start-up), NFR12 (logic testable in Node without rendering; content validated automatically).

## Acceptance Criteria

1. **Scaffold.** Given the `papa-parade/` folder (which already contains `_bmad/`, `_bmad-output/`, `docs/`, `.claude/` and a git repo), when the project is initialized from the Vite `vanilla-ts` template with the dependencies at the architecture's pinned versions (three 0.186.1, `@dimforge/rapier3d-deterministic-compat` 0.21.0, zod 4.6.7, typescript 7.0.2, vite 8.3.5, vitest 5.0.5, @playwright/test 1.64.1, @biomejs/biome 2.6.3, tweakpane 4.0.5, tsx 4.23.15, @types/three 0.186.0, gltfpack 1.3.0), then `npm run dev` serves a page with a full-screen canvas and no console error.
   - And `_bmad/`, `_bmad-output/`, `docs/` and `.claude/` are untouched, the existing git repo is kept (not re-initialized), and `.gitignore` covers at least `node_modules` and `dist`.
2. **TypeScript.** Given `tsconfig.json`, when inspected, then it is `strict` with `erasableSyntaxOnly` and declares the aliases `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug`, which `vite.config.ts` and Vitest resolve too.
3. **Architecture tests.** Given the empty folders `src/{shared,content,sim,bots,platform,client,debug}`, `content/`, `tools/` and `tests/{architecture,golden,e2e}`, when `npm test` runs, then:
   - `tests/architecture/simPurity.test.ts` fails if any file in `src/sim` (excluding `*.test.ts`) contains `Math.random`, `Date`, `performance`, `window`, `document`, or an import of `three` or `@capacitor/*`;
   - `tests/architecture/layerBoundaries.test.ts` fails if any rule of the "Frontières d'architecture" table is violated, and **each rule has a test case with an offending fixture file**.
4. **Lint.** Given `biome.json`, when `npm run lint` runs, then Biome applies `noRestrictedImports` per folder according to the architecture boundaries, and forbids `console.*` outside `src/shared/log.ts`.
5. **Scripts.** Given `package.json`, when listing scripts, then `dev`, `build`, `typecheck`, `lint`, `test` and `e2e` exist and pass on the empty project.
6. **CLAUDE.md.** Given `CLAUDE.md` at the repo root, when an agent reads it, then it finds the golden rule, the boundaries table, the commands, the essential naming conventions, and links to the GDD and `game-architecture.md`.
7. **Logger and Result.** Given `src/shared/log.ts` and `src/shared/result.ts`, when code uses them, then `log.<level>(channel, message, data?)` filters by level (`error`, `warn`, `info`, `debug`), writes to the console in dev, and keeps the last 200 entries of level `info` and above in a ring buffer readable via `log.buffer()`.
   - And `Result<T, E>` is the return type for I/O functions (unit tests for both modules).
8. **CI.** Given `.github/workflows/ci.yml`, when code is pushed to a remote (hosting chosen by Geo), then CI runs `typecheck` → `lint` → `content:check` → `test` → `e2e` (chromium and webkit) and stops at the first failure.
   - And while no remote exists, the same pipeline runs locally via `npm run ci`.

## Tasks / Subtasks

- [x] **T1 — Scaffold Vite safely (AC 1)**
  - [x] Do NOT run `npm create vite@latest .` in the repo root (see Dev Notes › Scaffold trap). Scaffold into a scratch dir instead: `npm create vite@9.3.1 <scratch>/pp-scaffold -- --template vanilla-ts --no-interactive --no-immediate`.
  - [x] Copy into the repo root only: `index.html`, `package.json`, `tsconfig.json`, `_gitignore`→`.gitignore` (create-vite renames it already), `src/main.ts`, `public/favicon.svg`. Do **not** copy the demo files (`src/counter.ts`, `src/style.css`, `src/assets/*`, `public/icons.svg`).
  - [x] Before copying, check that none of these paths already exist in the root (they don't today; abort and ask Geo if one does).
  - [x] `package.json`: set `"name": "papa-parade"`, keep `"private": true`, `"type": "module"`; add `"engines": { "node": ">=22.12" }`. Add `.nvmrc` with `25.8.1`.
  - [x] Install exact versions (`--save-exact`): `npm i -E three@0.186.1 @dimforge/rapier3d-deterministic-compat@0.21.0 zod@4.6.7` and `npm i -E -D typescript@7.0.2 vite@8.3.5 vitest@5.0.5 @playwright/test@1.64.1 @biomejs/biome@2.6.3 tweakpane@4.0.5 tsx@4.23.15 @types/three@0.186.0 @types/node gltfpack@1.3.0`. The template ships `typescript ~6.0.3` and `vite ^8.3.4`: they must end up as exactly `7.0.2` and `8.3.5`. Pin `@types/node` exactly too (e.g. the current `26.x`; Vitest 5 requires `^22 || >=24`).
  - [x] `npx playwright install chromium webkit`.
  - [x] Do NOT run `git init` (a repo with history already exists). Do NOT add Capacitor, ESLint, Prettier, React or any other dependency.
- [x] **T2 — App shell: full-screen canvas, no console error (AC 1)**
  - [x] `index.html`: `lang="fr"`, `<title>Papa Parade</title>`, viewport meta, a `<canvas id="pp-canvas">` and a `<div id="pp-ui">` (UI DOM root, filled from story 1.5), script `/src/main.ts`. Favicon must resolve (no 404 → it would show as a console error).
  - [x] `src/client/ui/styles/ui.css`: `html, body` margin 0, `overflow: hidden`, full height; `#pp-canvas` `position: fixed; inset: 0; width: 100vw; height: 100vh; display: block`. Imported from `src/main.ts`. No inline `<style>`/`style=""` (a future CSP is `default-src 'self'`).
  - [x] `src/main.ts`: imports the CSS and logs `log.info('boot', 'shell ready')`. No Three.js renderer, no game loop: those belong to story 1.4.
- [x] **T3 — TypeScript config (AC 2)**
  - [x] Keep the template's bundler-mode options, then make sure these are set: `strict: true`, `erasableSyntaxOnly: true`, `noEmit: true`, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
  - [x] `types: ["vite/client", "node"]`. TS 7 loads no `@types/*` automatically.
  - [x] `paths` with **no `baseUrl`** (removed in TS 7), targets prefixed with `./`:
        `"@shared/*": ["./src/shared/*"]`, `"@content/*": ["./src/content/*"]`, `"@sim": ["./src/sim/index.ts"]`, `"@bots/*": ["./src/bots/*"]`, `"@client/*": ["./src/client/*"]`, `"@platform/*": ["./src/platform/*"]`, `"@debug/*": ["./src/debug/*"]`.
        `@sim` is exact on purpose: other layers may only use the sim's public API. There is no `@sim/*`, and inside `src/sim` imports are relative.
  - [x] `include`: `["src", "tests", "tools", "*.config.ts"]`; `exclude`: `["tests/architecture/fixtures", "node_modules", "dist"]`.
- [x] **T4 — Vite, Vitest, Playwright configs (AC 1, 2, 5)**
  - [x] `vite.config.ts`: `base: './'`, `resolve: { tsconfigPaths: true }` (built into Vite 8, no `vite-tsconfig-paths` plugin), `server: { host: true }`. Leave a comment that the `feel-writer` plugin arrives in story 2.1. `build:playtest` is created here so that CI has its last stage; story 1.24 finalizes the playtest build (CSP headers, performance budget).
  - [x] `vitest.config.ts`: `mergeConfig(viteConfig, defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], exclude: ['tests/e2e/**', 'tests/architecture/fixtures/**', 'node_modules/**'] } }))`. Import `describe/it/expect` explicitly from `vitest` (no globals).
  - [x] Add a tiny alias smoke test (for example `src/shared/result.test.ts` imports `@shared/result`) so that alias resolution is proven in Vitest, not just in `tsc`.
  - [x] `playwright.config.ts`: `testDir: 'tests/e2e'`; projects `chromium` and `webkit`; mobile landscape viewport (e.g. 844×390, `hasTouch: true`); `webServer: { command: 'npm run dev -- --port 5179 --strictPort', url: 'http://localhost:5179', reuseExistingServer: !process.env.CI }`.
  - [x] `tests/e2e/boot.spec.ts`: load `/`; assert `#pp-canvas` is visible and its bounding box equals the viewport size; collect `page.on('console')` messages of type `error` and `page.on('pageerror')`, and assert there are none.
- [x] **T5 — `src/shared/result.ts` and `src/shared/log.ts` with tests (AC 7)**
  - [x] `result.ts`: `export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E }`. Minimal `AppError` (`{ kind: string; message: string; cause?: unknown }`) and the helpers `ok(value)` and `err(error)`. No library. `result.test.ts` covers narrowing on `ok` and both helpers.
  - [x] `log.ts`: `createLogger(options?)` factory and a default exported `log` instance. API: `log.error | warn | info | debug(channel, message, data?)`, `log.enabled(level)`, `log.setLevel(level)`, `log.buffer()` (returns a **copy** of the entries, oldest first).
  - [x] `LogChannel` is a string-literal union: `boot`, `assets`, `audio`, `input`, `render`, `feedback`, `storage`, `platform`, `debug`, `content`, `sim`. Entry shape: `{ atReal: number; level; channel; message; data? }`.
  - [x] Level order: `error` < `warn` < `info` < `debug`. The threshold defaults to `debug` in dev and `info` otherwise. `enabled(level)` reflects the threshold.
  - [x] Ring buffer: a fixed capacity of 200 (a constant in `src/shared/constants.ts`, `LOG_BUFFER_SIZE = 200`). It keeps only `info`, `warn` and `error`, even when `debug` is enabled, and never grows beyond 200 (overwrite the oldest entry; no `Array.shift` loop).
  - [x] Console sink: on when `import.meta.env?.DEV !== false` (true in Vite dev; also true in Node/tsx, where `import.meta.env` is undefined, so tools still print), and off in production builds. The buffer is always on. The sink is injectable through `createLogger({ sink })` so tests stay silent.
  - [x] `log.test.ts`: level filtering; `enabled()`; `debug` never buffered; exactly the last 200 entries kept, in order, after 250 writes; `buffer()` returns a copy; the sink receives the right console method per level.
  - [x] `log.ts` is the **only** file allowed to call `console.*`. `Date.now()`/`performance.now()` for `atReal` are fine here (shared is not sim), but `log` must never be imported from `src/sim` (the sim doesn't log; see Dev Notes).
- [x] **T6 — Folder skeleton (AC 3)**
  - [x] Create `src/{shared,content,sim,bots,platform,client,debug}/`, `content/`, `tools/`, `tests/{architecture,golden,e2e}/`. Git doesn't track empty folders, so add a `.gitkeep` to each one that would otherwise be empty.
  - [x] Don't create game files ahead of their stories (no `world.ts`, `step.ts`, `feel.json`…). `src/sim/index.ts` is created by story 1.3.
- [x] **T7 — `tests/architecture/simPurity.test.ts` (AC 3)**
  - [x] Write a reusable scanner `scanSimPurity(simDir): Violation[]` in `tests/architecture/scanners.ts` (Node `fs`, recursive over `*.ts`, skipping `*.test.ts`).
  - [x] Before matching, strip comments and string/template-literal contents, but keep the import specifiers and check them separately. That way `// no Date here` doesn't trip it, while `import x from 'three'` does.
  - [x] Banned identifiers, matched as whole words: `Math.random`, `Date`, `performance`, `window`, `document`; also `setTimeout`, `requestAnimationFrame` and `localStorage`, from the boundaries table. Banned imports: `three`, `three/*`, `@capacitor/*` (static `import`/`export … from`, side-effect `import '…'`, and dynamic `import('…')`).
  - [x] Tests: run the scanner on the real `src/sim` and expect `[]`; run it on one fixture per banned item under `tests/architecture/fixtures/simPurity/<case>/…` and expect exactly that violation; add a clean fixture (comment that mentions `Date`, a `*.test.ts` that uses `Math.random`) and expect `[]`.
- [x] **T8 — `tests/architecture/layerBoundaries.test.ts` (AC 3)**
  - [x] Write the scanner `scanLayerBoundaries(rootDir): Violation[]` in the same `scanners.ts`. It parses every import specifier (static, re-export, side-effect, dynamic), resolves aliases (`@shared/*`, `@content/*`, `@sim`, `@bots/*`, `@client/*`, `@platform/*`, `@debug/*`) **and relative paths** to the target layer, and classifies bare packages (`three`, `@capacitor/*`, `@dimforge/*`, `zod`…).
  - [x] TS 7 ships no JS compiler API: use a careful regex/tokenizer and test it. Don't add a parser dependency.
  - [x] Encode the table as data (one entry per rule, with a readable message) and give each rule its own fixture directory under `tests/architecture/fixtures/layers/<rule>/src/...` (see Dev Notes › Boundary rules). Each fixture must produce exactly its expected violation.
  - [x] Add an "allowed" fixture that exercises every allowed edge and must produce `[]`: client → `@sim`, `@content/*`, `@shared/*`, `@platform/*`, `three`; `client/boot.ts` → `import('@debug/overlay')`; sim → `@shared/*` and `@content/*`; `sim/physics/rapierPhysics.ts` → `@dimforge/rapier3d-deterministic-compat`; content → `zod`. This guards against over-restriction.
  - [x] Run it on the real repo root as well and expect `[]`.
  - [x] Fixtures are excluded from `tsc` (T3), Vitest discovery (T4) and Biome (T9). They may contain imports of files that don't exist.
- [x] **T9 — Biome (AC 4)**
  - [x] Create `biome.json` with `$schema` set to `https://biomejs.dev/schemas/2.6.3/schema.json` (or run `npx biome init` and edit it).
  - [x] `vcs: { enabled: true, clientKind: "git", useIgnoreFile: true }`.
  - [x] `files.includes` excludes `_bmad/**`, `_bmad-output/**`, `.claude/**`, `docs/**`, `dist/**`, `tests/architecture/fixtures/**` and `content/_schemas/**` (Biome 2 uses `includes` with `!` negations, not `include`/`ignore`).
  - [x] Formatter: 2 spaces, single quotes, semicolons (matches the architecture's code samples), `lineWidth` 100.
  - [x] Rules: `suspicious.noConsole` = error globally, with an override for `src/shared/log.ts` that turns it off.
  - [x] `overrides`, one per layer folder (`src/shared/**`, `src/content/**`, `src/sim/**`, `src/bots/**`, `src/platform/**`, `src/client/**`), each with `noRestrictedImports` (`paths` for exact specifiers like `three`, `@sim`; `patterns` for globs like `@capacitor/*`, `@client/*`, `@debug/*`, `three/*`) following the table. Give each a message that points to `CLAUDE.md`.
  - [x] For `src/sim/**`, also set `noRestrictedGlobals` with `deniedGlobals` as a **record** (Biome 2 format) for `Date`, `performance`, `window`, `document`, `setTimeout`, `requestAnimationFrame`, `localStorage`. `Math.random` cannot be expressed this way; `simPurity.test.ts` covers it.
  - [x] Add a later override for `src/sim/physics/rapierPhysics.ts` that allows `@dimforge/*` (the rest of `src/sim/**` bans it). Verify the override precedence (see Dev Notes).
  - [x] Check the rule group names (`style.noRestrictedImports`, `style.noRestrictedGlobals`, `suspicious.noConsole`) against the 2.6.3 schema or `npx biome explain <rule>`; don't guess.
  - [x] Add `tests/architecture/biomeBoundaries.test.ts`. It pipes offending snippets through `npx biome lint --stdin-file-path=<virtual path>` (`execFileSync`) and asserts a non-zero exit for: `src/sim/x.ts` importing `three`; `src/sim/x.ts` using `Date.now()`; `src/client/x.ts` calling `console.log`; `src/client/x.ts` importing `@debug/overlay` statically. It asserts a zero exit for `src/shared/log.ts` calling `console.info` and for `src/sim/physics/rapierPhysics.ts` importing Rapier. This proves the Biome config really enforces what CLAUDE.md claims.
- [x] **T10 — `package.json` scripts (AC 5, 8)**
  - [x] `dev`: `vite --host`.
  - [x] `build`: `vite build`. Drop the template's `tsc &&`; typecheck is its own step.
  - [x] `build:playtest`: `vite build --mode playtest`, with a committed `.env.playtest` containing `VITE_DEBUG_ALLOWED=true` (and `.env` with `VITE_DEBUG_ALLOWED=false`).
  - [x] `preview`: `vite preview`.
  - [x] `typecheck`: `tsc --noEmit`.
  - [x] `lint`: `biome check .`. Also add `format`: `biome format --write .`.
  - [x] `test`: `vitest run`.
  - [x] `e2e`: `playwright test`.
  - [x] `content:check`: `tsx tools/content/checkContent.ts`, a **placeholder** that logs `log.info('content', 'no content schemas yet')` and exits 0. Story 1.2 replaces it with real validation. Mark it with a `// Replaced by story 1.2` comment.
  - [x] `ci`: `npm run typecheck && npm run lint && npm run content:check && npm run test && npm run e2e && npm run build:playtest`.
  - [x] Don't add `content:schemas`, `assets:extract`, `sim`, `sim:replay` or `playtest:metrics` yet: each story that implements them adds its script, and a script that fails is worse than a missing one.
- [x] **T11 — CI workflow (AC 8)**
  - [x] `.github/workflows/ci.yml`: on `push` and `pull_request`, `ubuntu-latest`, `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`, `npm ci`, `npx playwright install --with-deps chromium webkit`, then one step per stage in this order: typecheck, lint, content:check, test, e2e, build:playtest. Separate steps, so the first failure stops the job and the failing stage is obvious. Set `CI: true`.
  - [x] Don't create a remote or push. Geo chooses the hosting.
- [x] **T12 — `CLAUDE.md` (AC 6)**
  - [x] Write it in English (like `project-context.md`), short and scannable, around 120 lines at most. It must contain:
    1. the golden rule;
    2. the layer boundaries table (copied from the architecture, translated) plus "cross-layer imports always go through aliases; relative imports never cross a layer";
    3. the commands (every script from T10 and what it does);
    4. the essential naming conventions (unit suffixes, `create*` factories, PascalCase past-tense events, imperative commands, `lower_snake_case` content ids, no `enum`/`namespace`/parameter properties);
    5. links: GDD `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md`, architecture `_bmad-output/planning-artifacts/game-architecture.md`, `_bmad-output/project-context.md`, UX `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/{DESIGN,EXPERIENCE}.md`, epics, sprint status.
  - [x] Point to `project-context.md` for the full rule set instead of duplicating it.
- [x] **T13 — Git hygiene (AC 1)**
  - [x] `.gitignore`: the template's entries plus `.DS_Store`, `coverage/`, `test-results/`, `playwright-report/`, `blob-report/`, `.env.local`. Keep `.env` and `.env.playtest` committed (they hold no secrets).
  - [x] `.DS_Store` is currently **tracked**: untrack it with `git rm --cached .DS_Store`. The file stays on disk.
  - [x] Don't commit: leave the changes for Geo or code review, following the sprint workflow.
- [x] **T14 — Verify (all ACs)**
  - [x] `npm run ci` passes end to end.
  - [x] `npm run dev`, then open the page in the built-in browser and check for a full-screen canvas and an empty console.
  - [x] `git status` shows no change under `_bmad/`, `_bmad-output/` (apart from this story file and `sprint-status.yaml`), `docs/` or `.claude/`.
  - [x] Temporarily add `import 'three'` to a `src/sim/tmp.ts`: `npm test` and `npm run lint` both fail. Remove the file afterwards.

### Review Findings

Code review of `b871ec3..47fb4ed` (2026-10-26): Blind Hunter, Edge Case Hunter and Acceptance Auditor. 3 decision-needed (all resolved to patch), 15 patch in total, 7 deferred, 18 dismissed.

- [x] [Review][Patch] (decided 2026-10-26: option b, buffer `info` and above whatever the console threshold) The level threshold also gates the ring buffer — `write()` returns before the buffer write, so after `setLevel('error')` or `'warn'` the `info`/`warn` entries are no longer kept. AC 7 says the buffer keeps the last 200 entries of level `info` and above, and T5 says "the buffer is always on" (the test "does not buffer entries filtered out by the level threshold" locks the current behaviour in). Options: (a) keep it, the threshold is global; (b) buffer `info` and above whatever the console threshold is, so a raised level never drops diagnostics. [src/shared/log.ts:76-85]
- [x] [Review][Patch] (decided 2026-10-26: option b, keep `warn` and `error` on the console when `VITE_DEBUG_ALLOWED` is `true`) In production and playtest builds no entry reaches the console — the default sink is `null` when `import.meta.env.DEV === false` (as AC 7 and T5 specify), nothing reads `log.buffer()` yet, so every `warn` fallback ("every fallback logs a warn") is invisible in a playtest build. Options: (a) keep as specified until a debug overlay reads the buffer; (b) keep `warn` and `error` on the console when `VITE_DEBUG_ALLOWED` is `true`; (c) always send `warn` and `error` to the console. [src/shared/log.ts:43,66]
- [x] [Review][Patch] (decided 2026-10-26: option a, add `.env.development` with `VITE_DEBUG_ALLOWED=true`) `npm run dev` and the e2e `webServer` run in Vite mode `development`, which only loads `.env` (`VITE_DEBUG_ALLOWED=false`), so the debug/bots dynamic imports will be gated off in dev and e2e. Options: (a) add `.env.development` with `VITE_DEBUG_ALLOWED=true`; (b) run `dev` and the e2e server with `--mode playtest`; (c) leave it until the story that first reads the flag. [.env, .env.playtest, package.json `dev`, playwright.config.ts]
- [x] [Review][Patch] Extensionless or directory relative imports bypass every rule — `import x from '../sim'` (from client) or `'../client'` (from sim) resolve to `src/<layer>`, which `classifyZone` calls `entry`; relative imports of `src/main.ts` are not flagged for any layer; imports that escape `src` and files under an unknown `src/<dir>` are silently skipped. Treat `src/<layer>` as that layer, add a rule "nothing imports `src/main.ts`", and report unclassified directories and escaping relative imports, each with a fixture. [tests/architecture/scanners.ts:477,498-505,521]
- [x] [Review][Patch] R5, R6 and R4 are narrower than the "Frontières d'architecture" table — `bots` importing `@content`, `platform` importing `@bots`/`@content`, and any layer except `sim/physics/rapierPhysics.ts` importing `@dimforge/*` are not flagged (no Biome pattern either). Add them with one fixture each. [tests/architecture/scanners.ts:424,432,440]
- [x] [Review][Patch] R7 lets a dynamic `import('@bots/…')` through in any `client` file — the rule description, the Dev Agent Record and Biome say `client/boot.ts` only, so scanner and Biome disagree. Use `!(imp.dynamic && file.rel === 'src/client/boot.ts')` and add a fixture like `r7-client-imports-debug-dynamic-outside-boot` for bots. Also correct the Dev Agent Record claim that all decisions are "more restrictive" (the `vitest`/`node:*` exemption in `src/shared/*.test.ts` loosens R1). [tests/architecture/scanners.ts:446-450]
- [x] [Review][Patch] Biome misses imports that the scanner catches — `@shared/log.ts` (with the extension, which the project uses) is not matched by the `@shared/log` pattern; `src/platform/**` has no `@debug/**` ban; `@dimforge/**` is not banned in `content`, `bots`, `platform` and `client`; `@capacitor/**` is not banned in `content`. Add the patterns (in the `rapierPhysics.ts` override too) and the matching cases in `biomeBoundaries.test.ts`. [biome.json:193,258,322-352]
- [x] [Review][Patch] `biomeBoundaries.test.ts` proves only `Date` and `performance` among the seven denied globals, and R9 has fixtures for `bots` and `src/main.ts` only — add `window`, `document`, `setTimeout`, `requestAnimationFrame`, `localStorage` cases, and R9 fixtures for `platform`, `content` and `shared` importing `debug` statically. [tests/architecture/biomeBoundaries.test.ts:34-125, tests/architecture/fixtures/layers]
- [x] [Review][Patch] The scanners only walk `*.ts` — `.tsx`, `.mts`, `.cts`, `.js`, `.mjs` files escape both `scanSimPurity` and `scanLayerBoundaries`, and `*.spec.ts` is not treated as a test file (false R1 on `vitest`). Match `/\.[cm]?[jt]sx?$/` and `/\.(test|spec)\./`. [tests/architecture/scanners.ts:261,522]
- [x] [Review][Patch] `findImports` misses `require('three')`, `import.meta.glob('../client/*.ts')` and dynamic imports with a template substitution (`` import(`@client/${x}`) ``) — the first two are not forms the scanner knows, the last is recorded as a literal. Detect them, and fail the layer test on an unresolvable dynamic specifier. [tests/architecture/scanners.ts:239-246]
- [x] [Review][Patch] `maskSource` mistakes a division for a regex literal after a non-null assertion (`${count! / total}`) or a keyword-named property (`o.of / 2`, `x.in / n`); the swallowed `}` or backtick desynchronises `templateStack`, so the rest of the file is masked and `Date.now()` or an import after it escapes. Drop `!` from the regex-preceding characters, treat a word preceded by `.` as an identifier, and reset the stack when a regex scan swallows `}` or a backtick; add tests. [tests/architecture/scanners.ts:86-94,176-181]
- [x] [Review][Patch] `simPurity` is bypassable in trivial ways — `const { random } = Math`, `const M = Math; M.random()`, `Math?.random()` and `globalThis['Date']` are not flagged. Ban bare `Math` aliasing/destructuring and bracket access on `globalThis`/`self`, with fixtures. [tests/architecture/scanners.ts:284-290]
- [x] [Review][Patch] `createLogger` with `bufferSize` 0, negative, fractional or `NaN` writes at `NaN` or throws a `RangeError` at construction (the default `log` is built at module load). Clamp: `Math.max(1, Math.floor(size))`, fall back to `LOG_BUFFER_SIZE`; add a test. [src/shared/log.ts:65]
- [x] [Review][Patch] `buffer()` copies the array but returns the same entry objects, so a caller that mutates a returned entry (or the `data` it logged) rewrites history for the next call. Return shallow copies of the entries and document that `data` is kept by reference. [src/shared/log.ts:98-105]
- [x] [Review][Patch] `ci.yml` has no `permissions` block (default token scopes) and no `timeout-minutes` — add `permissions: { contents: read }` and a job timeout. [.github/workflows/ci.yml]
- [x] [Review][Defer] The TS type system lets `window`, `document` and Node APIs compile inside `src/sim` (`lib` has DOM, `types` has `node`) — a `src/sim/tsconfig.json` with `lib: ['ES2023']` and `types: []` would add a compile-time guard [tsconfig.json] — deferred, architectural hardening beyond story 1.1
- [x] [Review][Defer] Biome lints `*.test.ts` under `src/sim` against the purity globals while `simPurity` skips them (AC 3), so lint and architecture test disagree for sim tests [biome.json:157-220] — deferred, no sim test exists yet; decide with story 1.3
- [x] [Review][Defer] `#pp-canvas` uses `100vw`/`100vh` (as T2 specifies), which includes the area under mobile browser bars; no `100dvh`, `touch-action: none`, `overscroll-behavior` or safe-area handling [src/client/ui/styles/ui.css] — deferred, belongs to stories 1.4 (renderer) and 1.5 (UI)
- [x] [Review][Defer] No global `error` / `unhandledrejection` hook feeds `log.error`, so uncaught errors on a phone never reach the ring buffer [src/main.ts] — deferred, belongs to the composition root (story 1.4)
- [x] [Review][Defer] The `src/sim/**` and `rapierPhysics.ts` Biome overrides duplicate the whole `deniedGlobals` and pattern lists by hand and can drift apart [biome.json:157-282] — deferred, maintainability; add a drift test if the lists grow
- [x] [Review][Defer] CI never runs `npm run build` (production, `VITE_DEBUG_ALLOWED=false`) and e2e runs against the dev server, not the built bundle; `isMobile` is not emulated [.github/workflows/ci.yml, playwright.config.ts] — deferred, story 1.24 finalizes the playtest build
- [x] [Review][Defer] `public/favicon.svg` is the stock Vite logo [public/favicon.svg] — deferred, placeholder until real branding assets

## Dev Notes

### Scaffold trap (read before T1)

The architecture's command `npm create vite@latest . -- --template vanilla-ts` ("choisir « Ignore files and continue »") **cannot be run safely by an agent**:
- create-vite 9.3.1 prompts only in a TTY. In a non-TTY shell, a non-empty target directory makes it **cancel**.
- Its `--overwrite` flag means **"Remove existing files and continue"**: it would wipe `_bmad/`, `_bmad-output/`, `docs/`, `.claude/` and `.git/`. **Never pass `--overwrite` in this repo.**
- So scaffold into a scratch dir and copy the files you need (T1). The outcome is identical to "Ignore files and continue".
- Pin `create-vite@9.3.1` (verified 2026-10-26) instead of `@latest`, so the template contents match this story. The vanilla-ts template contains `_gitignore`, `index.html`, `package.json`, `tsconfig.json`, `public/{favicon,icons}.svg`, `src/{main,counter}.ts`, `src/style.css`, `src/assets/{hero.png,vite.svg,typescript.svg}`.

### Current repo state (greenfield)

- No code yet. Tracked: `.claude/skills/**` (BMad skills: don't touch), `_bmad/**`, `_bmad-output/**`, `docs/Papa Parade — Game Design Doc.pdf`, and a stray `.DS_Store`. There is no `.gitignore`, no `package.json` and no `CLAUDE.md`.
- `_bmad-output/game-architecture.md` is a pointer file only. The real architecture is `_bmad-output/planning-artifacts/game-architecture.md`.
- Toolchain on Geo's Mac: Node 25.8.1, npm 11.17.0.
- Previous story: none (this is the first). Git history is planning docs only. Commit style: short French title and body, plus a `Co-Authored-By` trailer.

### Boundary rules (the "Frontières d'architecture" table, one fixture each)

| # | Layer (files under) | Must never import | Fixture idea |
|---|---|---|---|
| R1 | `src/shared` | any other layer (`@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug`, or relative escapes); any npm package | `shared/a.ts` imports `@client/x` |
| R2 | `src/content` | `sim`, `client`, `platform`, `debug`, `three` | `content/a.ts` imports `three` |
| R3 | `src/sim` | `three`, `@capacitor/*`, `client`, `platform`, `debug`, `bots` | `sim/a.ts` imports `../client/x` (relative) |
| R4 | `src/sim` (except `physics/rapierPhysics.ts`) | `@dimforge/*` | `sim/threats/a.ts` imports Rapier |
| R5 | `src/bots` | `client`, `platform`, `three`; sim internals (only `@sim` allowed) | `bots/a.ts` imports `../sim/world` |
| R6 | `src/platform` | `sim`, `client`, `three` | `platform/a.ts` imports `@sim` |
| R7 | `src/client` | sim internals (anything but `@sim`); `debug` statically (dynamic `import()` allowed in `client/boot.ts` only); `bots` statically (dynamic `import()` only, for autoplay) | `client/a.ts` imports `@debug/overlay` statically |
| R8 | any `src/**` | `tools/**` | `client/a.ts` imports `../../tools/x` |
| R9 | any layer except `debug` | `debug` statically | covered by R7 plus one from `sim` |

Sim purity (globals and `Math.random`) is tested separately in `simPurity.test.ts`; R3 covers only its imports. The globals list in the table (`window`, `document`, `performance`, `Date`, `setTimeout`, `requestAnimationFrame`, `localStorage`, `Math.random`) is a superset of the AC's list: enforce the full table.

### Why these choices (guardrails against common mistakes)

- **TS 7 (native compiler) config gotchas:**
  - `baseUrl` is removed, so write `paths` targets as `./…`.
  - `types` defaults to `[]`, so list `vite/client` and `node` explicitly.
  - `moduleResolution: node`/`node10` is gone; use `bundler`.
  - Options deprecated in 6.0 are errors.
  - There is no JS compiler API yet, so nothing that needs `import ts from 'typescript'` (hence the hand-written import scanner). `tsc` is typecheck only; Vite (Oxc) transpiles.
- **Vite 8 aliases:** use `resolve.tsconfigPaths: true`. It only applies to files matched by the tsconfig `include`, which is why `include` covers `src`, `tests` and `tools`. Don't duplicate the aliases in `resolve.alias`: tsconfig is the single source.
- **tsx** (tools) resolves the same tsconfig `paths`. The `content:check` placeholder, which imports `@shared/log`, proves it works. If it fails, fix the tsconfig; don't add a second alias mechanism.
- **Biome, not ESLint:** typescript-eslint is incompatible with TS 7.
  - Biome 2 syntax: `files.includes` with `!` negations, `overrides[].includes`, and `noRestrictedGlobals.options.deniedGlobals` as a record.
  - Overrides are applied in order, and a later matching override wins for the options it sets. Put `rapierPhysics.ts` after `src/sim/**`, and check the result with `biomeBoundaries.test.ts` rather than assuming.
- **The logger lives in shared, but the sim never logs.** It emits `SimEvent`s, and the client logs them on the `sim` channel. Shared modules that the sim will import (`rng`, `ids`, `math`, `constants`, `invariant`, `result`) must stay global-free. `log.ts` is the one shared exception for `console`/clock, so never import it from `src/sim`. You can add a sim-side rule that bans `@shared/log` to R3; that's recommended.
- **Hot paths:** `log` must not allocate on a filtered-out call. Check `enabled` before building the entry, and use a preallocated ring buffer.
- **No GDD numbers** belong in this story. `LOG_BUFFER_SIZE` is a technical constant, so it goes in `src/shared/constants.ts`, not in `feel.json`.

### Project Structure Notes

- Files created by this story follow the "Arborescence" of the architecture:
  - root: `CLAUDE.md`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `biome.json`, `index.html`, `.gitignore`, `.nvmrc`, `.env`, `.env.playtest`, `.github/workflows/ci.yml`;
  - `src/main.ts`, `src/shared/{result,log,constants}.ts` (+ tests), `src/client/ui/styles/ui.css`;
  - `tools/content/checkContent.ts`;
  - `tests/architecture/{scanners.ts,simPurity.test.ts,layerBoundaries.test.ts,biomeBoundaries.test.ts,fixtures/**}`, `tests/e2e/boot.spec.ts`.
- These files are additions to the documented tree: `tests/architecture/scanners.ts`, `tests/architecture/biomeBoundaries.test.ts` and `tests/architecture/fixtures/`, plus `.nvmrc` and `.env*` at the root. They are test and tooling support and introduce no new top-level folder.
- `capacitor.config.ts`, `ios/` and `android/` are E8 only. `public/fonts/` arrives in story 1.5.

### Out of scope

- Three.js renderer, game loop, `timeMap`: story 1.4. Zod schemas, `feel.json`, `strings.fr.json`, real `content:check`: story 1.2. `createSim`, `rng`, `invariant`: story 1.3. Tokens and fonts: story 1.5.
- Installing MCP servers (Context7, Playwright MCP): Geo's choice, run from his own terminal. Don't modify Claude settings.
- Choosing or creating the git remote and hosting.

### Testing standards

- Vitest in Node, unit tests colocated (`src/shared/log.test.ts`), architecture tests in `tests/architecture/`, e2e in `tests/e2e/*.spec.ts`.
- Architecture tests must fail for the right reason: assert the exact violation (file and rule id), not just a non-empty result.
- Coverage tooling (`@vitest/coverage-v8`, sim ≥ 90 %) is not required yet. It arrives with the sim code (story 1.3).

### Project Context Rules

From `_bmad-output/project-context.md`:
- **Pinned stack:** do not upgrade or swap versions without an architecture change. Not used, and never to be introduced: ESLint, typescript-eslint, Prettier, React/R3F or any UI framework, Howler, any ECS or state-management library, UUID libraries. No Capacitor dependency before E8.
- **TS:** `strict` + `erasableSyntaxOnly` mean no `enum`, no `namespace`, no constructor parameter properties. Aliases: `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug`, resolved by tsconfig, Vite/Vitest and tsx.
- **Language:** code, identifiers and comments in English. The GDD and architecture are in French: the GDD is the source of truth for game rules, the architecture for technical decisions, and the UX spec for the interface.
- **Layers and boundaries:** as in the table above, enforced by Biome and the architecture tests. Don't invent new top-level folders. `client/boot.ts` is the single composition root, with no singletons except `log`.
- **Errors:** `Result` is a minimal home-made type; no `try/catch` in `src/sim`; no silent failure (every fallback emits at least a `warn`).
- **Logs:** no direct `console.*` outside `src/shared/log.ts`; nothing above `debug` in hot paths; guard expensive formatting with `log.enabled('debug')`.
- **Golden rule:** the AI writes and tests; Geo tunes the feel. Everything must stay playable end to end without a human.
- **When docs disagree:** game rules follow the GDD and technical mechanics the architecture. If something is still ambiguous, ask Geo rather than guessing.

### Latest technical information (verified 2026-10-26)

- npm registry: every pinned version exists (three 0.186.1, rapier3d-deterministic-compat 0.21.0, zod 4.6.7, typescript 7.0.2, vite 8.3.5, vitest 5.0.5, @playwright/test 1.64.1, @biomejs/biome 2.6.3, tweakpane 4.0.5, tsx 4.23.15, @types/three 0.186.0, gltfpack 1.3.0). The latest create-vite is 9.3.1, and @types/node is at 26.6.5.
- Vitest 5.0.5 peers: `vite ^6.4 || ^7 || ^8`, `@types/node ^22 || >=24`.
- TS 7: `baseUrl` removed, `types` defaults to `[]`, `strict` on by default (set it explicitly anyway), no JS compiler API until 7.1.
- Vite 8: `resolve.tsconfigPaths` (boolean, default `false`) replaces the `vite-tsconfig-paths` plugin.
- Biome 2.x: `noRestrictedImports` supports `patterns` (gitignore-style, with groups and per-entry messages) since 2.2; `noRestrictedGlobals.deniedGlobals` is a record since 2.0; `includes` replaced `include`/`ignore`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1 : Initialiser le projet et ses garde-fous]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences supplémentaires (architecture)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Initialisation du projet]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Structure du projet (Arborescence, Frontières d'architecture, Conventions de nommage)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Gestion des erreurs] and [#Logs] and [#Configuration]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Architecture de déploiement] (scripts, CI, `base: './'`)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Environnement de développement] (versions, scripts to create, first steps)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Architecture de sécurité] (CSP: no inline styles)
- [Source: _bmad-output/project-context.md] (all sections)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md] (golden rule, around line 60)
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-26-v2.md] (stories 1.1 to 1.3 can start before the UX fixes)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), via the `gds-dev-story` workflow.

### Debug Log References

- `npm run ci` (typecheck, lint, content:check, test, e2e chromium + webkit, build:playtest): exit 0. Vitest: 5 files, 94 tests. Playwright: 2 tests.
- Guardrail check (T14): a temporary `src/sim/tmp.ts` containing `import 'three'` made both `npm test` (`simPurity` and `layerBoundaries`) and `npm run lint` (`noRestrictedImports`) fail; the file was removed afterwards and the suite is green again.
- `git status`: nothing changed under `_bmad/`, `docs/` or `.claude/`; under `_bmad-output/` only this story file and `sprint-status.yaml`.

### Completion Notes List

- **Scaffold.** `create-vite@9.3.1` was run in the scratchpad (never in the repo root); only `.gitignore` and `public/favicon.svg` were copied, and `package.json`, `tsconfig.json`, `index.html` and `src/main.ts` were rewritten for the project (no demo files). All dependencies are installed with exact versions as pinned (`@types/node` 26.6.5). No `git init`, no Capacitor, ESLint or Prettier. npm prints an `allow-scripts` warning for esbuild's postinstall; `tsx` and Vite work without it.
- **TS 7 / Vite 8.** `paths` without `baseUrl`, `types: ["vite/client", "node"]`, `resolve.tsconfigPaths: true` (tsconfig is the single alias source, also resolved by Vitest and `tsx`; the `content:check` placeholder imports `@shared/log` through it).
- **Logger and Result.** `createLogger` with an injectable console sink, a preallocated 200-slot ring buffer (info and above only, `buffer()` returns a copy, no allocation for filtered-out calls). The level threshold filters both the console and the buffer. `createConsoleSink` is exported so the level-to-console-method mapping is unit tested.
- **Architecture tests.** `tests/architecture/scanners.ts` masks comments, strings and regex literals, then extracts static, re-export, side-effect and dynamic imports. 17 offending fixtures for `simPurity`, 27 for the 10 boundary rules (R1 to R9 plus R3b), plus "clean" and "allowed" fixtures that guard against over-restriction. Tests assert the exact file, rule id and specifier.
- **Decisions beyond the story text** (in the direction of "more restrictive", except the `vitest`/`node:*` exemption in `src/shared` tests; none changes a documented rule):
  - R3b: `src/sim` may not import `@shared/log` (recommended in Dev Notes).
  - R9 does not fire for `sim` (R3 already covers `debug` there), so each fixture yields exactly one violation.
  - Dynamic `import()` of `bots` is allowed only in `client/boot.ts`, like `debug`, so Biome (which cannot tell static from dynamic) and the scanner agree. Static imports of either are still caught by the scanner everywhere in `client`.
  - In `*.test.ts` files under `src/shared`, the packages `vitest` and `node:*` are allowed (R1).
  - A bare `window` property key in `src/sim` is flagged by `simPurity` (names carry unit suffixes, e.g. `windowMs`).
- **Biome.** Rule names verified with `biome explain`. `noRestrictedImports` patterns use `/**` because `/*` does not match deep paths (found by the Biome test with `three/examples/...`). Overrides per layer; `rapierPhysics.ts` has its own override that allows `@dimforge/*`. `biome lint --stdin-file-path` does not report diagnostics, so `biomeBoundaries.test.ts` lints real files in a temporary directory with a copy of `biome.json` (and checks the rule name in the output). Biome 2.6 also formats Markdown and SVG: `**/*.md` and `public/` are excluded.
- **CI.** `.github/workflows/ci.yml` has one step per stage in the required order; not run remotely (no remote exists). `npm run ci` is the local equivalent and passes.
- **Verification of "full-screen canvas, no console error".** Checked by `tests/e2e/boot.spec.ts` against `npm run dev` (Playwright `webServer`) in chromium and webkit: canvas bounding box equals the viewport, no `console.error`, no `pageerror`. I did not open the built-in browser pane, because starting it needs a `.claude/launch.json` and `.claude/` must stay untouched.
- Nothing is committed (T13). `.DS_Store` is untracked with `git rm --cached` (staged deletion), the file stays on disk.

### File List

New:
- `.env`, `.env.development`, `.env.playtest`, `.gitignore`, `.nvmrc`
- `.github/workflows/ci.yml`
- `CLAUDE.md`
- `biome.json`
- `index.html`
- `package.json`, `package-lock.json`
- `playwright.config.ts`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`
- `public/favicon.svg`
- `src/main.ts`
- `src/client/ui/styles/ui.css`
- `src/shared/constants.ts`, `src/shared/log.ts`, `src/shared/log.test.ts`, `src/shared/result.ts`, `src/shared/result.test.ts`
- `src/content/.gitkeep`, `src/sim/.gitkeep`, `src/bots/.gitkeep`, `src/platform/.gitkeep`, `src/debug/.gitkeep`
- `content/.gitkeep`, `tests/golden/.gitkeep`
- `tools/content/checkContent.ts`
- `tests/e2e/boot.spec.ts`
- `tests/architecture/scanners.ts`, `simPurity.test.ts`, `layerBoundaries.test.ts`, `biomeBoundaries.test.ts`
- `tests/architecture/fixtures/simPurity/**` and `tests/architecture/fixtures/layers/**` (offending, clean and allowed fixtures)

Modified:
- `_bmad-output/implementation-artifacts/1-1-initialiser-le-projet-et-ses-garde-fous.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

Deleted from the index (file kept on disk):
- `.DS_Store`

### Change Log

- 2026-10-26: Code review (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 15 patches applied, 7 items deferred (see `deferred-work.md`), 18 dismissed. Logger: the ring buffer keeps `info` and above whatever the sink threshold, `bufferSize` is clamped, `buffer()` returns copies, playtest builds print `warn` and `error` (`createDefaultSink`); `.env.development` added. Scanners: bare `src/<layer>` imports, `src/main.ts` (R10), unknown folders and unresolved imports (`LAYOUT`, `UNRESOLVED`), `require`, `import.meta.glob`, template imports, all source extensions, R4/R5/R6/R7 aligned with the table, sturdier regex masking and `Math` alias detection. Biome: matching patterns for every new rule plus an `src/main.ts` override, and 31 more `biomeBoundaries` cases. CI: read-only token and a 20 minute timeout. `npm run ci`: 159 tests, e2e and playtest build green.
- 2026-10-26: Story 1.1 implemented. Vite vanilla-ts shell with pinned stack, TS 7 strict config with layer aliases, `Result` and `log` with tests, layer skeleton, `simPurity` / `layerBoundaries` / `biomeBoundaries` architecture tests with fixtures, per-layer Biome rules, scripts, CI workflow, `CLAUDE.md`. Status set to review.
