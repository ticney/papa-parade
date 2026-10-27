# Story 1.12: Bots and Mass Simulation

Status: ready-for-dev

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.12 « Bots et simulation en masse ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As an AI developer agent,
I want automatic players and a CLI that play hundreds of games headless,
so that I can validate every change and balance the game without a human.

**Requirements covered:** FR66 (the game can be launched and played end to end without human intervention), plus the architecture's « Automatisation » decision (`npm run sim`, bots `perfect | human | random | idle`, `npm run sim:replay`). This story is **headless only**: the browser side (`?autoplay=`, `window.__PP__`) is story 1.13, which reuses the bots built here.

## Precondition (check first, stop if it fails)

Story 1.11 is in `review` at the time of writing (commit `5e1bd53`). Start only when 1.11 is `done` in `sprint-status.yaml` and its review fixes are committed (`git status` clean apart from `_bmad-output/`), then run `npm run ci` green **before the first edit** and let it finish before editing anything (1.11's baseline was spoiled by editing while e2e ran). If the 1.11 review renamed something this story names (`ThreatInstance`, `responseWindow`, `windowOpenAt`, `PendingPress`, `replayJournal`…), follow the code, not this file. If not, stop and tell Geo.

## Acceptance Criteria

1. **Bots** — `src/bots/` holds `perfectBot`, `humanBot` (reaction time and Gaussian jitter from `content/bots.json` or from options), `randomBot` and `idleBot`, behind one `Bot` interface. A bot receives the `World` read-only and produces only `SimCommand`s, exactly as the client does: it never mutates the world, never calls `sim.step()`, never touches `world.rng`. It imports only `@sim` and `@shared` (Biome + `layerBoundaries` already enforce it; do not touch the rules).
2. **Determinism** — a bot is a pure function of (its setup, its seed, the worlds it is shown). The same level, seed and bot give the same journal and the same final world hash, run after run, and `Math.random` / `Date` / `performance` are never used in `src/bots` or `tools/sim`.
3. **`npm run sim`** — `npm run sim -- --level <id> --seed 42 --bot perfect --runs 100 --out report.json` runs through `tsx`, plays 100 headless games and writes a JSON report: mean score (see D9), distribution of response qualities per threat, gags. Same arguments → byte-identical report.
4. **CLI errors** — an unknown level id or bot id gives a clear message naming the valid choices, and a non-zero exit code. A malformed number (`--seed abc`, `--runs 0`) does too. No stack trace for a user error.
5. **`npm run sim:replay`** — `npm run sim:replay -- <file>` replays a recorded game (written by `npm run sim … --journals <dir>`) and reproduces the same final state: it prints the hash and exits 0 when it matches, exits ≠ 0 with a clear message when it does not, or when the file cannot be replayed with the current content (feel, geometry or level changed).
6. **Perfect bot test** — a Vitest test plays 100 games of the `perfect` bot on the test level (frozen fixtures, outlet planned) and asserts that **every** response to the outlet is `perfect` (and at least one per game, no gag).
7. **No sim change** — `src/sim/**` is untouched: no golden journal or expected file is regenerated, coverage thresholds hold. `npm run ci` is green.

## Tasks / Subtasks

- [ ] **T0 — Baseline** (Precondition)
  - [ ] `npm run ci` green on the untouched tree; note the unit test count and duration in the Debug Log.
  - [ ] Measure the cost of a headless step: a throwaway script (not committed) running `createSim` on the live level for 18 000 steps; note steps/s in the Debug Log. It sizes AC 6's test and the CLI's progress logging.
- [ ] **T1 — Bot settings as content** (AC 1; D2)
  - [ ] `src/content/schemas/bots.ts`: `BotsSchema` (strict, every key described, units in the names, no default/optional), shape in Dev Notes › `content/bots.json`. Export `type BotSettings = z.infer<…>`.
  - [ ] `content/bots.json` with the starting values of the Dev Notes; register `BOTS_FILE` in `src/content/contentFiles.ts` (`CONTENT_FILES`), add `bots: BotSettings` to `ContentBundle`, load it in `loadContent` like `feedback`.
  - [ ] `npm run content:schemas` → commit `content/_schemas/bots.schema.json` (generated, never by hand).
  - [ ] `tests/support/testContent.ts`: `createTestContent()` adds an inline `createTestBots()` (same pattern as `createTestFeedback`: not hashed by the sim, so no golden moves). Update the content tests that enumerate `CONTENT_FILES` or build a `ContentBundle` by hand (`tests/content/*`, client tests that build bundles) — list each in the Completion Notes.
  - [ ] Schema tests in `tests/content/botsSchema.test.ts` (valid file, unknown key refused, `tapMs ≥` nothing silly: `tapMs > 0`, `jitterSdMs ≥ 0`, `pressChancePct` in [0, 100]…).
- [ ] **T2 — The `Bot` contract and the runner** (AC 1, 2; D1, D3, D4)
  - [ ] `src/bots/bot.ts`: `BOT_IDS`, `BotId`, `Bot`, `BotSetup`, `BotResponse` (Dev Notes › Contract).
  - [ ] `src/bots/createBot.ts`: `createBot(id: string, setup): Result<Bot, AppError>`; an unknown id is an `err` whose message lists `BOT_IDS`. Validates the setup (`tapMs < holdMinMs`, finite numbers) → `err`, never a throw.
  - [ ] `src/bots/playGame.ts`: `playGame(sim, bot, untilSimMs, onEvent?)`: the loop of Dev Notes › Runner (act → enqueue → step → drain). Allocation-free per step (one reused `out` array). Returns nothing; the caller reads `sim`.
  - [ ] `src/bots/gaussian.ts`: `nextGaussian(rng: RngState): number` (Box–Muller on `@shared/rng`'s `nextFloat`, standard normal), with `gaussian.test.ts` colocated (determinism, mean ≈ 0 and sd ≈ 1 over 20 000 draws within a stated tolerance, never `NaN` / `±Infinity`).
- [ ] **T3 — The four bots** (AC 1, 2, 6; D5–D8)
  - [ ] `src/bots/idleBot.ts`, `perfectBot.ts`, `humanBot.ts`, `randomBot.ts`, each `create<Name>Bot(setup)`; behaviour exactly as Dev Notes › The four bots.
  - [ ] Bot tests in `tests/bots/` (they need the frozen fixtures of `tests/support/`, which `src/bots` may not import): one file per bot plus `tests/bots/botContract.test.ts` (Dev Notes › Testing).
  - [ ] **AC 6** in `tests/bots/perfectBot.test.ts`: 100 games, seeds 0–99, frozen test level with the outlet, every `ResponseResolved` of the outlet `perfect`, ≥ 1 per game, zero `GagTriggered`. Keep the test under ~10 s on the dev Mac (size `untilSimMs` from T0; see Dev Notes › Testing).
- [ ] **T4 — `npm run sim`** (AC 3, 4; D9–D12)
  - [ ] `tools/sim/loadSimLevel.ts`: loads `ContentBundle`, `LevelContent` and the geometry of a level from a content folder (node content source, same parsers and schemas as the game), plus `listLevelIds(contentDir)`. An unknown level → an error naming the known ids.
  - [ ] `tools/sim/simArgs.ts`: `parseSimArgs(argv): Result<SimArgs, string>` with `node:util` `parseArgs` (`strict: true`); defaults and checks in Dev Notes › CLI.
  - [ ] `tools/sim/simReport.ts`: `createRunSummary(sim, …)` and `summarizeRuns(…)`: pure, the report shape of Dev Notes › Report.
  - [ ] `tools/sim/runSim.ts`: exported `runSim(args, loaded): Promise<Result<SimReport, string>>` (pure of I/O, testable with the frozen fixtures) and a `main()` behind the `import.meta.url === pathToFileURL(process.argv[1]).href` guard (same as `extractLevelGeometry.ts`), which parses, loads, runs, writes the report (`--out`) and the recorded games (`--journals`).
  - [ ] `package.json`: `"sim": "tsx tools/sim/runSim.ts"`, `"sim:replay": "tsx tools/sim/replaySim.ts"`. Do not add them to `npm run ci`.
- [ ] **T5 — `npm run sim:replay`** (AC 5; D10)
  - [ ] `tools/sim/runFile.ts`: the recorded-game file (Dev Notes › Recorded game file): `toRunFile(…)` and `parseRunFile(json): Result<RunFile, string>` (shape checks; the journal itself is checked by `replayJournal`).
  - [ ] `tools/sim/replaySim.ts`: exported `replayRunFile(file, loaded): Promise<Result<{ worldHash }, string>>` and a guarded `main()`: read, parse, load the live content of `file.levelId`, `replayJournal` to `untilSimMs` (strict invariants), compare `hashJson(sim.world)` with `worldHash`.
- [ ] **T6 — Tool tests** (AC 3–5)
  - [ ] `tests/tools/sim/simArgs.test.ts`, `simReport.test.ts`, `runSim.test.ts`, `runFile.test.ts`, `replaySim.test.ts` (Dev Notes › Testing), with the frozen fixtures.
  - [ ] `tests/tools/sim/cli.test.ts`: spawns the two real commands (`npx tsx …` via `node:child_process` `spawnSync`) for the exit-code paths only: unknown bot, unknown level, `--runs 0`, a valid 1-run game into a temp dir (`os.tmpdir()` + `mkdtempSync`) then `sim:replay` of its recorded game → exit 0, then the same file with its `worldHash` altered → exit ≠ 0. Remove the temp dir in `afterAll`.
- [ ] **T7 — Docs and status**
  - [ ] `CLAUDE.md` › Commands: add the two rows (`npm run sim`, `npm run sim:replay`) in the existing table style. Do not touch anything else in it.
  - [ ] `deferred-work.md`: Dev Notes › Deferred items this story touches / Deferred by this story.
  - [ ] Final `npm run ci` green; run once by hand `npm run sim -- --level salon_crawler --seed 42 --bot perfect --runs 100 --out <tmp>/report.json` and `--bot human`, `--bot idle`, `--bot random` (10 runs each) and paste the headline numbers and the wall time in the Debug Log.

## Dev Notes

### What exists today (stories 1.3 to 1.11)

- **Sim API (`@sim`, `src/sim/index.ts`)**: `createSim({ content, geometry, level, seed, journal?, strictInvariants? }): Promise<Sim>`; `Sim` = `enqueue(cmd)`, `step()` (exactly 10 ms of sim time), `drainEvents()` (**reused array: copy what you keep**), `world` (read-only view, a different object after `restore`), `journal()`, `snapshot()`, `restore()`. `replayJournal({ content, geometry, level, journal, untilSimMs, strictInvariants? })` returns `Result<{ sim, events }, AppError>` and already refuses a journal recorded with another feel / geometry / level (`feelHash`, `geometryHash`, `levelHash`) or not from 0. Exported types: `World`, `ThreatInstance` (`id`, `defId`, `anchorId`, `xM`, `zM`, `state`, `enteredAt`, `windowOpenAt`, `responseWindow: { windowMs, perfectMs, toleranceMs, bufferMs } | null`, `press`), `ThreatState` (`'idle' | 'telegraph' | 'windowOpen' | 'resolved' | 'gag'`), `PapaSlice`, `BabySlice`, `SimCommand`, `SimEvent`, `ResponseQuality`, `FailReason`, `GAG_IDS`, `GagId`, `Journal`, `JournalEntry`.
- **Commands** (`src/sim/commands.ts`): `SetTimeScale`, `TapFloor{xM, zM}`, `Move{dirX, dirZ}` (not (0, 0)), `MoveStop`, `PressThreat{threatId}` (integer ≥ 1), `Release` (names no threat: ends every press with `press.t ≤ t`). `sim.enqueue` validates the shape and **throws** on a malformed command (`invariant`). `applyAt = max(ceil(t / STEP_MS) × STEP_MS, simNow + STEP_MS)`: a command is applied at the next step at the earliest, and judged on its own `t`.
- **Judgement** (`sim/timing/judge.ts`): `centre = windowOpenAt + windowMs / 2`; `perfect` iff `|t − centre| ≤ perfectMs / 2`; `early` iff `t − centre < −(windowMs / 2 + toleranceMs) − bufferMs`; `late` iff `t − centre > windowMs / 2 + toleranceMs`; else `success`. `classifyPress`: released `< holdMinMs` after the press → `parry`, held `≥ holdMinMs` (or no release by then) → `firm` → gag `wrongResponse` on the outlet. `earlyPress: 'fail'` (live and test feel) → an early press is a gag `early`.
- **Threat cycle** (outlet): director telegraphs the first due idle threat when the baby is free → `telegraph` (window frozen, `windowOpenAt = now + telegraphDelayMs`) → `windowOpen` → `resolved` / `gag` → after `cooldownMs` → `idle`. `ThreatTelegraphed.kind` is the def id; `ResponseResolved` has `threatId`, `response`, `quality`, `reason?`, `offsetMs`; `GagTriggered` has `gag`, `reason`. One outlet cycle on the test level is roughly 1.2 s telegraph + window + 6 s cooldown + the baby freeing itself: about 8 s.
- **Content**: `ContentBundle { feel, feedback, strings }` from `loadContent(source)`; `LevelContent { level, threats }` from `loadLevelContent(source, id)`; geometry via `parseContentFile(…, LEVEL_GEOMETRY_PATTERN.schema)` on `levels/<id>.geometry.json`. `tools/content/nodeContentSource.ts` is the Node `ContentSource`. The live level `salon_crawler` plans `outlet` at `outlet_01`, `fromMs: 4000`. There is **no level duration** yet (story 1.18 adds `durationMs`).
- **Test fixtures** (`tests/support/testContent.ts`): `createTestContent()` (frozen `testFeel.json`, inline feedback), `createTestGeometry()`, `createTestOutlet()`, `createTestLevel(entries)`, `outletEntry(fromMs)`, `stepN(sim, n)`. `tests/threats/threatCatalog.test.ts` and `tests/golden/*` show how to drive a sim headless from `tests/`.
- **`src/bots/`** holds only `.gitkeep` (delete it). Biome (`src/bots/**` override) and `tests/architecture/layerBoundaries.test.ts` (R5) already forbid `three`, `@sim/**` deep paths, `@client`, `@platform`, `@debug`, **`@content`** and Rapier in bots. `tsconfig.json` already maps `@bots/*`.
- **Tools pattern**: Node scripts in `tools/` run through `tsx`, log with `log.<level>(channel, …)` (no `console`, Biome `noConsole` everywhere but `src/shared/log.ts`), set `process.exitCode = 1` on failure, and guard `main()` with the `pathToFileURL(process.argv[1])` check so tests can import them (`tools/assets/extractLevelGeometry.ts`). Their tests live in `tests/tools/<area>/`. Log channel for this story: `'sim'`.
- `@shared/rng`: `createRng(seed)` (seed an integer in `[0, 2**32)`), `nextUint32`, `nextFloat` (`[0, 1)`), `nextInt`. `@shared/hash`: `hashJson`, `canonicalJson`, `cloneJson`. `@shared/result`: `ok`, `err`, `Result`, `AppError`. `@shared/time`: `asSimMs`, `SimMs`. `@shared/constants`: `STEP_MS`, `UINT32_RANGE`, `DEFAULT_LEVEL_ID`.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | **The sim does not change.** Bots read `World` through the existing `@sim` types and write through `sim.enqueue`. No new command, event or world field; no golden regenerated. If a bot seems to need sim data that `World` lacks, stop and ask rather than adding it. | AC 7. The sim already exposes the window (`windowOpenAt`, `responseWindow`) and the threat state: that is all a bot needs in E1. |
| D2 | Bot settings live in **`content/bots.json`** (`BotsSchema`, in `ContentBundle.bots`), **not in `feel.json`**. The bots themselves never import content: they take plain options (`BotSetup`), filled by whoever creates them (the CLI here, autoplay in 1.13) from `content.bots`. | The epic allows « `feel.json` ou options ». A `bots` key in the feel would enter `feelHash`: retuning the human bot would make every recorded journal (and every golden, through `testFeel.json`) unreplayable, for a value the game never reads. Like `feedback`, `bots` is outside the sim's hashes. And R5 forbids `@content` in `src/bots`. Open point 1. |
| D3 | **Contract**: a bot is asked once **before each step**, with the world as it is at `now = world.time.sim`, and pushes into `out` the commands whose `t` falls in `[now, now + STEP_MS)`, each with that exact `t`. It never sends a `t` in the past (`< now`) or beyond the coming step. | A real input lands between two steps and is judged on its own `t`; this is the same thing for a bot. With `t ∈ [now, now + 10)`, `applyAt` is `now + 10`: the command is applied by the very next step, as a fresh tap would be. It keeps bot journals indistinguishable from player journals. |
| D4 | **Each bot owns its own RNG** (`createRng(botSeed(runSeed))`, `botSeed = (runSeed ^ BOT_SEED_SALT) >>> 0`, `BOT_SEED_SALT` in `shared/constants.ts`), plain state inside the bot closure. `world.rng` is never read nor advanced. | A bot that drew from `world.rng` would change the baby's wanders and the game it is testing. Salting avoids the bot's stream being the world's stream (same sfc32, same seed). |
| D5 | **`perfect`**: for every threat in `telegraph` or `windowOpen` with `press === null` that it has not pressed in this cycle, it presses at `max(centre, now)` (`centre = windowOpenAt + responseWindow.windowMs / 2`), and releases `tapMs` later. A cycle is identified by `(threat.id, threat.enteredAt of its telegraph)`. | Offset 0 → `perfect` whatever the feel's `perfectMs`. `max(…, now)` covers a bot created mid-window. |
| D6 | **`human`**: when it first sees a threat in `telegraph`, it plans one press at `round(max(telegraphAt + reactionMs, centre + aimOffsetMs + jitterSdMs × N(0, 1)))`, `telegraphAt = threat.enteredAt`, one Gaussian draw per cycle; then presses and releases `tapMs` later as `perfect` does. A press that lands early or late is a gag, as for a player. | « Temps de réaction et gigue gaussienne »: the reaction time is a floor (nobody presses before having seen the telegraph), the jitter is the timing spread around the aimed instant. Rounded to the ms so journals stay readable. Open point 2. |
| D7 | **`random`**: a fuzzer. Each step, with probability `actionsPerSec × STEP_MS / 1000`, one action drawn uniformly among: `TapFloor` at a point within `floorReachM` of Papa (the sim snaps it), `Move` in a random non-zero direction, `MoveStop`, `PressThreat` on a uniformly chosen threat **of any state** (the sim ignores a press on an idle threat) held a uniform `[0, maxHoldMs]` then released. At most one held press at a time. | It must exercise every command, including presses the sim must ignore, Firmness by holding (gag `wrongResponse`) and double actions, with strict invariants on. It does not try to play well. |
| D8 | **`idle`**: never sends anything. | Every threat ends `late`; story 1.18 / 1.19 / 1.22 tests (« le bot `idle` échoue ») lean on it. |
| D9 | **No score yet.** The report has `meanScore: null` and `scoreNote` saying Mama's score arrives with story 1.22; it reports per-threat quality counts and percentages, fail reasons, gag counts, and `meanSuccessPct` (perfect + success over all responses). Do not invent a scoring formula. | The score is a game rule (GDD § Note de Maman) implemented in 1.22; a provisional formula here would be a second, diverging one. Open point 3. |
| D10 | **A run lasts `--until-ms`** (sim ms; default `SIM_CLI_DEFAULT_UNTIL_MS = 180000` in `shared/constants.ts`, the GDD's 3-minute level). Story 1.18 replaces the default with the level's `durationMs` (note it in `deferred-work.md`). | There is no level duration and no end of level before 1.18 / 1.22. |
| D11 | **Run seeds**: run `i` (0-based) uses `(seed + i) % 2**32`. Each run gets a fresh sim and a fresh bot. The report lists every run's seed and final world hash. | Reproducing one bad run of a batch = `--seed <its seed> --runs 1`. |
| D12 | **Recorded games** (`--journals <dir>`): one file per run, `<level>_<bot>_<seed>.journal.json`, holding the journal plus what a replay needs and the journal does not carry: `levelId`, `untilSimMs`, `worldHash` (Dev Notes › Recorded game file). `sim:replay` takes such a file. | `Journal` has no level id (deferred to story 3.3's `JournalSchema`) and no end time; « même état final (hash identique) » needs the recorded hash to compare with. |
| D13 | The CLI and the replay run with **`strictInvariants: true`**: an invariant violation is a crash with a non-zero exit, logged with the run's seed. | A mass run is a test; a clamped violation would hide a bug. |
| D14 | Output goes **only where asked**: `--out` (report) and `--journals` (folder, created if missing). Without `--out`, the report JSON is written to stdout with `process.stdout.write` and nothing else is logged at `info` (errors still go through `log.error`). Never write inside the repo by default. | Keeps `npm run sim … > report.json` usable and the tree clean. |

### Contract (`src/bots/bot.ts`)

```ts
import type { SimCommand, SimEvent, World } from '@sim';

export const BOT_IDS = ['perfect', 'human', 'random', 'idle'] as const;
export type BotId = (typeof BOT_IDS)[number];

/** What a threat asks for, as the sim names it (`'parry'` in E1). Derived from `@sim`, never from `@content`. */
export type BotResponse = Extract<SimEvent, { type: 'ResponseResolved' }>['response'];

/** Everything a bot is told at creation. Plain data: the CLI fills it from the level and `content/bots.json`. */
export interface BotSetup {
  /** The run's seed; the bot salts it for its own RNG (D4). */
  seed: number;
  /** `feel.input.holdMinMs`: a tap must be released before it to be a Parry. */
  holdMinMs: number;
  /** The response each threat def of the level asks for, by def id (`ThreatInstance.defId`). */
  responses: Readonly<Record<string, BotResponse>>;
  /** `content/bots.json`, mapped field by field (the bots may not import its type). */
  settings: BotOptions;
}

export interface Bot {
  readonly id: BotId;
  /** Called once before each `sim.step()`. Pushes the commands to enqueue now (D3); never mutates `world`. */
  act(world: Readonly<World>, out: SimCommand[]): void;
}
```

`BotOptions` is declared in `bot.ts` with the same shape as `BotSettings` (structural typing lets the CLI pass `content.bots`; `tests/bots/botContract.test.ts` has a compile-time check that `BotSettings` is assignable to `BotOptions`, so the two cannot drift). A threat whose response a bot cannot produce (impossible in E1: `BotResponse` is `'parry'`) is handled by an exhaustive `switch` with a `never` check, so story 1.23 (`firm`) fails to typecheck until the bots learn it. `createBot` cannot see the world's threats: a threat whose `defId` is missing from `responses` is skipped by the bot (never pressed), and a `runSim` test pins that the CLI always fills `responses` with every def of the level.

### Runner (`src/bots/playGame.ts`)

```ts
export function playGame(sim: Sim, bot: Bot, untilSimMs: number, onEvent?: (event: SimEvent) => void): void {
  const out: SimCommand[] = [];
  while (sim.world.time.sim < untilSimMs) {
    out.length = 0;
    bot.act(sim.world, out);
    for (let i = 0; i < out.length; i++) sim.enqueue(out[i] as SimCommand);
    sim.step();
    const events = sim.drainEvents();
    if (onEvent !== undefined) for (let i = 0; i < events.length; i++) onEvent(events[i] as SimEvent);
  }
}
```

No closure or array per step. Story 1.13's autoplay will call `bot.act` from the client loop instead (once per step, before it), so keep `act` independent of `playGame`.

### The four bots

- Shared helpers (e.g. `src/bots/threatTiming.ts`): `centreOf(threat)`, `isPressable(threat)` (`telegraph` / `windowOpen`, `responseWindow !== null`, `press === null`), `dueThisStep(t, now)` (`now ≤ t < now + STEP_MS`). A small per-bot scheduler of pending `{ t, command }` (press, then release) emitted when due, in `t` order; plain arrays reused, no per-step allocation except when planning.
- **Cycle memory**: a bot remembers the cycles it has planned by `threat.id → enteredAt of the telegraph`; a threat whose `enteredAt` changed (new telegraph after a re-arm) is a new cycle. It must never press twice in one cycle (a second press is ignored by the sim, but it would pollute journals and the `random` bot is the only one meant to do that).
- **Release**: always `tapMs` after the press, `tapMs < holdMinMs` (checked by `createBot`). Two overlapping threats: a release ends every press made before it; with the perfect bot both are still Parries (each quality is fixed at its press). Leave it; note it.
- **Random**: `floorReachM` around Papa's current `xM / zM`; direction from `nextFloat × 2π` (`Math.cos` / `Math.sin` are fine: pure). Uniform choices via `nextInt`. `Move` with a direction that rounds to (0, 0) is impossible with unit vectors, but guard it anyway (the sim throws on it).

### `content/bots.json` (starting values, Geo tunes them)

```json
{
  "$schema": "./_schemas/bots.schema.json",
  "tapMs": 80,
  "human": { "reactionMs": 250, "aimOffsetMs": 0, "jitterSdMs": 60 },
  "random": { "actionsPerSec": 2, "floorReachM": 3, "maxHoldMs": 800 }
}
```

Every key described in the schema with its unit (« How long a bot holds a tap, in ms; must stay under `feel.input.holdMinMs` », « Standard deviation of the human bot's press around its aim, in ms »…). `tapMs < holdMinMs` crosses two files: check it in `createBot` (an `err`) **and** in `content:check` (`tools/content/contentChecks.ts`, a cross-file rule naming `bots.json › tapMs`), with a fixture test in `tests/content/checkContent.test.ts`. `maxHoldMs` is deliberately above `holdMinMs` (the fuzzer must also produce Firmness).

With these values on the live feel (window 300, tolerance 60, perfect 100), the human bot's 60 ms spread gives roughly 60 % perfect, 40 % success and almost no gag on the outlet: a plausible attentive player. Report the real numbers in the Debug Log (T7).

### CLI (`tools/sim/simArgs.ts`, `runSim.ts`)

| Flag | Default | Check (else exit ≠ 0 with this message) |
|---|---|---|
| `--level <id>` | `DEFAULT_LEVEL_ID` | must be a level of `content/levels/` (« unknown level "x": known levels are salon_crawler ») |
| `--bot <id>` | none: required | one of `BOT_IDS` (« unknown bot "x": choose perfect, human, random or idle ») |
| `--seed <n>` | `1` | integer in `[0, 2**32)` |
| `--runs <n>` | `1` | integer ≥ 1 |
| `--until-ms <n>` | `SIM_CLI_DEFAULT_UNTIL_MS` | number > 0; rounded up to the step grid |
| `--out <file>` | stdout (D14) | parent folder must exist |
| `--journals <dir>` | none | created if missing |

`parseArgs` with `strict: true` turns an unknown flag into an error: catch that one `TypeError` (`ERR_PARSE_ARGS_*`) at the boundary and turn it into the same `err` message path (no silent catch: it becomes the `Result` error). `npm run sim -- --help` prints the table above (via `process.stdout.write`) and exits 0. Progress: when `--out` is given, `log.info('sim', …)` once per 10 % of the runs at most, then a one-line summary.

### Report (`tools/sim/simReport.ts`)

```jsonc
{
  "level": "salon_crawler", "bot": "perfect", "seed": 42, "runs": 100, "untilSimMs": 180000,
  "hashes": { "feel": "…", "geometry": "…", "level": "…", "bots": "…" },
  "meanScore": null, "scoreNote": "Mama's score arrives with story 1.22",
  "meanSuccessPct": 100,
  "threats": {
    "outlet": {
      "responses": 2100, "perfect": 2100, "success": 0, "fail": 0,
      "perfectPct": 100, "successPct": 0, "failPct": 0,
      "failReasons": { "early": 0, "late": 0, "wrongResponse": 0 },
      "meanAbsOffsetMs": 0
    }
  },
  "gags": { "total": 0, "meanPerRun": 0, "byGag": {} },
  "runList": [ { "seed": 42, "worldHash": "…", "responses": 21, "gags": 0, "commands": 42 } ]
}
```

Per threat = per **def id** (map `ResponseResolved.threatId` → `world.threats[…].defId`). Percentages rounded to 0.1, never `NaN` (a threat with 0 responses reports 0 % and `meanAbsOffsetMs: null`). `byGag` keys sorted. No wall-clock time in the report (AC 3: byte-identical); wall time goes to the log only. Written with `JSON.stringify(report, null, 2)` + `\n`.

### Recorded game file (`tools/sim/runFile.ts`)

```jsonc
{ "kind": "papa-parade.run", "version": 1, "levelId": "salon_crawler", "bot": "human",
  "untilSimMs": 180000, "worldHash": "…", "journal": { /* sim.journal(), version 3 */ } }
```

`parseRunFile` checks `kind`, `version`, the field types, `untilSimMs` finite > 0; it does **not** re-check the journal (`replayJournal` does, and gives the feel / geometry / level messages). `sim:replay` messages: OK → `log.info('sim', 'replay matches', { worldHash })`, exit 0; mismatch → `log.error` with both hashes, exit 1; refused journal → the `replayJournal` message plus « was the content changed since it was recorded? », exit 1.

### Testing

- **`tests/bots/botContract.test.ts`** (all four bots, `describe.each(BOT_IDS)`): on the frozen test level with the outlet, 60 s of sim: (a) the world's `hashJson` is the same before and after every `act` (a bot never mutates the world; check on a sample of steps, not all, to keep it fast); (b) every command a bot pushes has `t ∈ [now, now + STEP_MS)` (D3) and passes `sim.enqueue` with strict invariants; (c) the same seed twice → identical `sim.journal()` and final `hashJson(world)`; (d) the live game's final `hashJson(world)` equals the one `replayJournal` gives for its journal (the replay runs no bot: a bot that mutated the world or advanced `world.rng` would make them differ); (e) the type check `BotSettings` → `BotOptions`.
- **`perfectBot.test.ts`**: AC 6 (100 seeds); plus a mid-window creation case (centre already past: presses `now`, still judged on `now`, quality per the judge); never two presses per cycle.
- **`humanBot.test.ts`**: `jitterSdMs: 0`, `reactionMs: 0`, `aimOffsetMs: 0` → every response `perfect` (the model reduces to the perfect bot); `reactionMs` larger than `telegraphDelayMs + windowMs / 2 + toleranceMs` → every response `fail` `late`; `aimOffsetMs` far negative with no jitter → `fail` `early`; the default settings over 50 seeds → no `wrongResponse`, a mix that the test pins loosely (≥ 1 perfect, ≥ 1 success over all runs) — never exact percentages.
- **`randomBot.test.ts`**: 20 seeds × 60 s with strict invariants: no throw; over all runs it produced each command type at least once and at least one `wrongResponse` gag (a held press); deterministic per seed.
- **`idleBot.test.ts`**: zero commands, every outlet `ResponseResolved` is `fail` `late`, `journal().entries` empty.
- **Speed**: AC 6 runs 100 games; pick `untilSimMs` from T0's steps/s so the file stays under ~10 s (e.g. 30 s of sim ≈ 3 outlet cycles if a step costs ~3 µs… measure, do not guess). Note the chosen value and the measured duration. The other bot tests use fewer seeds.
- **Tools**: `simArgs` (defaults, every check and message, unknown flag, `--help`); `simReport` (counts, percentages, 0-response threat, sorted keys, determinism); `runSim` with the frozen fixtures (2 runs → two seeds `seed`, `seed + 1`; byte-identical JSON twice; seed wraps at `2**32`); `runFile` (round trip, each malformed field); `replaySim` (a recorded run replays to its hash; altered hash → `err`; another feel → the `replayJournal` refusal); `cli.test.ts` (T6, the only spawning test; mark it with a generous `timeout`).
- **Existing tests that must pass unchanged**: every sim test and golden, `threatCatalog`, `layerBoundaries`, `simPurity`, `biomeBoundaries`, all client tests except those that build a `ContentBundle` by hand (they gain `bots`), all e2e specs. List every edited existing test with its reason.

### Previous story intelligence (1.9 to 1.11 and their reviews)

- **Copy what you keep from `drainEvents()`**: the array is reused (1.3). `playGame`'s `onEvent` hands events one by one; a summary keeps counts, not event objects.
- **Frozen fixtures for anything judged**: tests never read `content/feel.json` or the live level (1.10). `createTestContent()` is the bundle; the live files are only read by the CLI and by `content:check`.
- **No template string in a hot loop** (`invariant` messages, logs): test the condition first (1.8 / 1.10 reviews). `playGame` and `act` run 18 000 times per game.
- **Errors are `Result`s at the boundary, invariants inside**: `createBot` and the CLI return `err` with a human message; a sim invariant inside a run is a crash (D13).
- **The 1.10 review rule**: a press on a non-idle threat always replans Papa's glide. Bots pressing in `telegraph` make Papa glide early: expected, not a bug.
- **Story 1.11 D12**: `?threats=off` exists for e2e; nothing here touches the client loop. Keep the client untouched apart from `ContentBundle` gaining `bots` (the browser loads it via `loadContent`; nothing reads it until 1.13).
- **Commits**: the dev workflow leaves changes uncommitted; one implementation commit and one review-fix commit per story, French title `Story 1.12 : …`, by Geo.

### Architecture guardrails and traps

- **Bots import `@sim` and `@shared` only.** Not `@content` (not even `import type`), not `src/sim/...`. The `BotSettings` ↔ `BotOptions` link is checked from `tests/`, never from `src/bots`.
- **No `Math.random`, `Date`, `performance`, `setTimeout`** in `src/bots` or `tools/sim` (determinism; Biome only enforces it in `src/sim`, so this is review + `botContract` (c)). Wall time for the log only, in `main()`, via `performance.now()` is acceptable there **only** in the guarded `main()` and never in the report.
- **Never read or write `world.rng`; never mutate `world`** (`Readonly<World>` is shallow: the type will not stop `world.threats[0].press = …`).
- **Judge on `t`**: a bot never relies on the step that processes its command; it sets `t` precisely (D3).
- **`tools/` is never imported by `src/`** (R8). `src/bots/playGame.ts` is the shared runner; the CLI imports it, not the other way round.
- **No new dependency**: `node:util` `parseArgs`, `node:fs/promises`, `node:child_process` are built in (Node 25.8.1). No commander/yargs.
- **Units in names** (`untilSimMs`, `tapMs`, `reactionMs`, `jitterSdMs`, `floorReachM`, `actionsPerSec`, `maxHoldMs`); constants `UPPER_SNAKE` in `shared/constants.ts` (`BOT_SEED_SALT`, `SIM_CLI_DEFAULT_UNTIL_MS`).

### Project Structure Notes

- New (all in the architecture tree: `src/bots/bot.ts` and `perfectBot.ts, humanBot.ts, randomBot.ts, idleBot.ts`, `tools/sim/runSim.ts`): `src/bots/{bot,createBot,playGame,gaussian,threatTiming,perfectBot,humanBot,randomBot,idleBot}.ts` (+ `gaussian.test.ts`), `src/content/schemas/bots.ts`, `content/bots.json`, `content/_schemas/bots.schema.json` (generated), `tools/sim/{loadSimLevel,simArgs,simReport,runSim,runFile,replaySim}.ts`, `tests/bots/*.test.ts`, `tests/tools/sim/*.test.ts`, `tests/content/botsSchema.test.ts`.
- Variance, stated: the architecture names one CLI file (`runSim.ts`) and lists `sim:replay` without a file; this story adds `replaySim.ts` and splits args, report, loading and the recorded-game file into their own modules so each is unit-tested. `playtestMetrics.ts` (same folder) is story 3.4. `content/bots.json` is a new content file the architecture does not list (D2).
- Modified: `src/content/{contentFiles,contentBundle,loadContent}.ts`, `src/shared/constants.ts`, `tools/content/contentChecks.ts` (cross-file `tapMs` rule), `tests/support/testContent.ts`, `package.json` (two scripts), `CLAUDE.md` (two command rows), the tests that build a `ContentBundle` by hand, `deferred-work.md`, `sprint-status.yaml`. Deleted: `src/bots/.gitkeep`.
- Not in this story: `?autoplay=`, `window.__PP__`, the autoplay e2e (1.13); level duration and waves (1.18); Mama's score (1.22); `playtest:metrics` and the exported player journal schema (3.3, 3.4); a perf spec with the human bot (1.24).

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** everything must stay playable end to end without a human — this story is that rule's headless half. Anything Geo may tweak is data: the bot settings (`content/bots.json`), never numbers in the bots.
- **Sim:** pure and deterministic; it is not modified here. Bots produce `SimCommand`s exactly like the client; the sim only receives typed, timestamped commands and judges on their `t`.
- **Layers:** `bots` → `@sim` (public API) + `@shared`; `tools/` → anything, Node only, never imported by `src/`. Cross-layer imports through aliases only.
- **Errors and logs:** `Result` at I/O boundaries, no silent `catch`, every fallback logs a `warn`; `log.<level>('sim', …)`, no `console.*`.
- **Naming:** factories `create<Name>`, files named after their main export, unit suffixes mandatory, constants in `shared/constants.ts`, content keys camelCase, `content/_schemas/` generated only.
- **Tests:** `describe/it/expect` from `vitest`; time in steps; frozen fixtures; never weaken a guardrail test.
- **Stack pinned:** no new npm dependency (TypeScript 7, `tsx` 4.23.15, Node 25.8.1, Vitest 5.0.5). Nothing outside the pinned stack is used, so no web research was needed; `node:util` `parseArgs` (stable since Node 20) is the only API worth a check: `strict: true`, `allowPositionals` for `sim:replay`'s file argument.

### Deferred items this story touches (update `deferred-work.md`)

- 1.3, « `JournalSchema`, `contentVersion` / `levelId` in the journal » (story 3.3): **still open**; the recorded-game wrapper (D12) carries `levelId` and `untilSimMs` for the CLI only. Note that 3.3 may absorb it.
- 1.3, « Invariant strictness follows the build »: **still open**; the CLI and the replay are always strict (D13), so a playtest journal recorded with clamping may diverge in `sim:replay`. Add that sentence.
- 1.11, « `?threats=off` is a test switch »: untouched (1.13).

### Deferred by this story

- **Run duration** is a CLI default (`SIM_CLI_DEFAULT_UNTIL_MS`, D10): story 1.18 gives the level a `durationMs` and the CLI should default to it.
- **`meanScore` is `null`** (D9): story 1.22 fills it from Mama's score; 3.4 adds the playtest indicators.
- **Overlapping presses**: a bot's `Release` ends every pending press (the sim's rule); fine while one threat is active at a time. Story 1.16 / 1.18 (two threats at once), with the multi-touch item of 1.11.
- **Bots know only Parry** (`BotResponse` = `'parry'`): story 1.23 (Firmness) extends the exhaustive switch; 4.6 / 4.9 (`wait`, `nothing`) likewise.

### Open points for Geo (do not block the dev)

1. **Bot settings in `content/bots.json`** rather than `feel.json` (D2): so that tuning the bot never invalidates recorded journals. OK?
2. **Human bot model** (D6): reaction 250 ms as a floor after the telegraph, aim at the window centre, 60 ms Gaussian spread. Does that look like the playtester you want to simulate (roughly 60 % perfect)?
3. **No score in the report** until story 1.22 (D9): the report gives quality counts and a success rate instead. Enough for balancing in E1?
4. **Default run length 3 min** of sim time (D10) until levels have a duration.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.12 : Bots et simulation en masse], and around it [#Story 1.13] (autoplay reuses the bots), [#Story 1.18] (`npm run sim -- --bot idle`), [#Story 1.19] (idle bot), [#Story 1.22] (score), [#Story 1.24] (perf with the human bot), [#Exigences › FR66], [#Exigences supplémentaires (architecture)] (CLI `sim`, `sim:replay`)
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Automatisation], [#Déterminisme, journal et replay], [#Chaîne d'entrées] (commands, « Les bots produisent directement ces commandes »), [#Contrats d'API (internes)] (`Sim`, CLI), [#Frontières d'architecture] (bots row), [#Arborescence] (`src/bots/`, `tools/sim/runSim.ts`), [#Conventions de nommage], ADR-001, ADR-004
- [Source: _bmad-output/project-context.md] (Testing Rules › Bots, Critical Don't-Miss Rules, Code Organization Rules)
- [Source: _bmad-output/implementation-artifacts/1-10-premiere-menace-jugee-en-headless-la-prise-electrique.md] (judgement, cycle, glide on every press), [1-11-parer-la-prise-electrique-au-tap.md] (D5 release rule, D12 `?threats=off`), [deferred-work.md]
- Code: `src/sim/{index,createSim,commands,commandQueue,journal,replay,world,events}.ts`, `src/sim/timing/{judge,classifyPress}.ts`, `src/sim/threats/{threatSystem,threatFsm}.ts`, `src/sim/director/directorSystem.ts`, `src/shared/{rng,hash,constants}.ts`, `src/content/{contentFiles,contentBundle,loadContent,loadLevelContent}.ts`, `tools/content/{nodeContentSource,checkContent,contentChecks}.ts`, `tools/assets/extractLevelGeometry.ts` (CLI pattern), `tests/support/testContent.ts`, `tests/threats/threatCatalog.test.ts`, `tests/golden/{golden.test,scenarios}.ts`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-10-27: Story 1.12 created (ready-for-dev). Ultimate context engine analysis completed - comprehensive developer guide created.
