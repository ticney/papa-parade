---
baseline_commit: 15312b98c551ff38b8e5b01774bba254106c310a
---

# Story 1.3: Deterministic simulation core in headless

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.3 « Cœur de simulation déterministe en headless ». Epics, GDD and architecture are in French; this file is in English (document_output_language). -->

## Story

As an AI developer agent,
I want a pure simulation that advances in 10 ms steps and replays identically,
so that all gameplay is testable in Node, without a browser.

**Requirements covered:** NFR4 (timing windows in ms, independent of the frame rate), NFR12 (logic testable in Node without rendering). Foundation for ADR-001, ADR-002, ADR-004 and the "Modèle d'état" / "Déterminisme, journal et replay" sections of the architecture.

## Acceptance Criteria

1. **Fixed step and serializable world.** Given `createSim({ content, seed })` in `src/sim/index.ts`, when `step()` is called 100 times, then `world.time.sim` is exactly `1000` (whole ms).
   - And `World` holds only serializable data: `JSON.parse(JSON.stringify(world))` equals `world`, at creation and after 100 steps.
2. **Fixed system order.** Given `src/sim/step.ts`, when a step runs, then the systems run in the fixed order of the architecture (this story implements the first two: `applyCommands`, `advanceTime`), and each one can only write to `World` and push to `ctx.events` (plus the sanctioned hitstop request, AC 5).
   - And the order is pinned by a test, so that inserting or reordering a system is a deliberate edit.
3. **Seeded PRNG.** Given `src/shared/rng.ts` (sfc32, state in `World`), when two sims are created with the same seed and receive the same commands, then their `World` and their event sequences are identical after 10 000 steps. Two different seeds diverge.
4. **Commands and journal.** Given `src/sim/commands.ts` and `src/sim/events.ts`, when a timestamped command is enqueued with `enqueue(cmd)`, then it is applied by the first step whose game time is greater than or equal to `cmd.t` (exact rule in Dev Notes › Command timing), and it is added to the journal.
5. **Time scale and freeze.** Given `src/sim/time/`, when `timeScale` is 0.3, then each step is still 10 ms of game time, and `sim.timeScale` exposes the value to the loop.
   - And when a freeze is requested, `sim.freezeRealMs` exposes the remaining duration; `sim.consumeFreeze(realMs)` lowers it (the client loop calls it); `step()` itself never refuses to run because of a freeze (headless ignores it).
6. **Snapshot and restore.** Given `snapshot()` and `restore()`, when a snapshot is restored into a sim and the journal commands that were not applied yet at snapshot time are replayed, then the final state is identical to the original game's.
7. **Golden tests.** Given `tests/golden/golden.test.ts`, when a reference journal of `tests/golden/journals/` is replayed, then the hash of the final state and the list of event types match the recorded reference.
   - And `npm run golden:update` regenerates the references deliberately (this is the "`--update` option" of the epics).
8. **Invariants.** Given `src/shared/invariant.ts`, when `clampInvariant(ctx, v, min, max, name)` receives an out-of-bounds value, then it throws in test and dev; in prod it clamps the value and emits `InvariantViolated`.
9. **Quality gates (derived from project-context, not in the epic text).** `npm run ci` passes with the new `tests/golden` and `src/sim` tests; `tests/architecture/**` and `biome.json` are untouched; `src/sim` coverage is at least 90 % and the build fails below it.

## Tasks / Subtasks

- [x] **T1 — Shared primitives (AC 1, 3, 8)**
  - [x] `src/shared/constants.ts`: add `STEP_MS = 10` and `MIN_TIME_SCALE = 0.05` (technical floor: "pause is never `timeScale = 0`"; the slowest GDD value is 0.2). Do **not** add `MAX_STEPS_PER_FRAME` (story 1.4) nor `SNAPSHOT_EVERY_MS` (story 3.9).
  - [x] `src/shared/time.ts`: `SimMs` and `RealMs` branded numbers (`number & { readonly __unit: 'SimMs' }`), with identity casts `asSimMs(n)` and `asRealMs(n)`. Pure type-level; no logic. Test: a `// @ts-expect-error` assignment of a `RealMs` to a `SimMs` proves they cannot be mixed.
  - [x] `src/shared/rng.ts`: sfc32 with a plain serializable state. API in Dev Notes › PRNG. `createRng(seed)`, `nextUint32(rng)`, `nextFloat(rng)`, `nextInt(rng, minInclusive, maxExclusive)`; the functions mutate the state in place (no allocation).
  - [x] `src/shared/hash.ts`: `canonicalJson(value)` (sorted keys; **throws** on `undefined`, `NaN`, `±Infinity`, functions, symbols, `bigint`, `Map`/`Set`, class instances, `Date`: this is the serializability guard), `cloneJson(value)` = `JSON.parse(canonicalJson(value))`, `hashJson(value): string` (14-hex-char cyrb53 of `canonicalJson`).
  - [x] `src/shared/invariant.ts`: `invariant(condition, message): asserts condition` (throws `Error`), `InvariantViolation`, `InvariantContext`, `clampInvariant(ctx, value, min, max, name)`, `defaultStrictInvariants()`. Contract in Dev Notes › Invariants.
  - [x] Colocated tests for each (see Dev Notes › Testing standards): sfc32 against an inline reference implementation, determinism and range, JSON round-trip of the state; `canonicalJson` key-order independence and every rejected type; `hashJson` stable and different on different input; both `clampInvariant` branches, `NaN`, bounds inclusive.
- [x] **T2 — Sim data types (AC 1, 4)**
  - [x] `src/sim/world.ts`: `World = { time: { sim: SimMs; scale: number }; rng: RngState; nextId: number }`, `createWorld(seed)`, `allocateId(world): number` (`return world.nextId++`). Nothing else: later stories add their slice (papa, baby, threats…) with their own FSM types.
  - [x] `src/sim/commands.ts`: `SimCommand` union with a single member for now, `{ type: 'SetTimeScale'; t: SimMs; scale: number }` (debug/test command, journaled; story 2.1's "forced `timeScale`" reuses it). Doc comment: every command carries `t` (its own timestamp, the one a judgement will use) and a later command is added together with its handler.
  - [x] `src/sim/events.ts`: `SimEvent = TimeScaleChanged | InvariantViolation`, where `TimeScaleChanged = { type: 'TimeScaleChanged'; t: SimMs; from: number; to: number }` and `InvariantViolation` is imported (type) from `@shared/invariant`.
  - [x] `src/sim/context.ts`: `StepContext`, `System`. Shape in Dev Notes › The sim at a glance.
  - [x] `src/sim/journal.ts`: `JournalEntry = { applyAt: SimMs; command: SimCommand }`, `Journal = { version: 1; seed: number; feelHash: string; entries: JournalEntry[] }`, `createJournal(seed, feelHash)`. No Zod schema here (`JournalSchema` is story 3.3).
- [x] **T3 — Clock, time scale, hitstop, command queue, step (AC 2, 4, 5)**
  - [x] `src/sim/time/clock.ts`: `advanceTime(world, ctx)` system: `world.time.sim = asSimMs(world.time.sim + STEP_MS)`, **then** handles the `SetTimeScale` commands of `ctx.commands` through `time/timeScale.ts`.
  - [x] `src/sim/time/timeScale.ts`: `setTimeScale(world, ctx, scale)`: `clampInvariant(ctx, scale, MIN_TIME_SCALE, 1, 'time.scale')`, then, only if the value changes, write `world.time.scale` and push `TimeScaleChanged`.
  - [x] `src/sim/time/hitstop.ts`: a tiny freeze state living **outside** `World` (`{ remainingMs: number }`): `requestFreeze(state, ms)` (remaining = `max(remaining, ms)`; story 1.14 owns the overlap rule) and `consumeFreeze(state, realMs)` (clamped at 0). Ignore non-finite or negative arguments with `clampInvariant`-style handling.
  - [x] `src/sim/commandQueue.ts`: `createCommandQueue()` and the `applyCommands` system. The exact `applyAt` rule and the ordering are in Dev Notes › Command timing. Pending entries live in the queue (not in `World`); `applyCommands` first empties `ctx.commands` (`length = 0`), then moves the entries due at this step into it, in `(applyAt, enqueue order)` order.
  - [x] `src/sim/step.ts`: `export const SYSTEMS: readonly System[] = [applyCommands, advanceTime]` with the full target order in a comment (Dev Notes › System order), and `step(world, ctx, systems = SYSTEMS)` using an indexed `for` loop (no iterator, no allocation).
  - [x] Tests: `clock.test.ts`, `timeScale.test.ts`, `hitstop.test.ts`, `commandQueue.test.ts` (rule table of Dev Notes), `step.test.ts` (order pinned: `SYSTEMS.map((s) => s.name)` equals `['applyCommands', 'advanceTime']`; a custom list runs in the given order).
- [x] **T4 — `createSim` and the public API (AC 1, 2, 3, 5)**
  - [x] `src/sim/createSim.ts`: `createSim(opts)` (async, per the architecture contract) and the internal `createSimWithSystems(opts, systems)` that tests use to inject a probe system. `createSim` = `createSimWithSystems(opts, SYSTEMS)`. Options: `{ content: ContentBundle; seed: number; journal?: Journal; strictInvariants?: boolean }`. `mamaMemory` arrives with story 3.8.
  - [x] The returned `Sim` is a closure-based object (no class) with: `enqueue(cmd)`, `step()`, `drainEvents()`, `world` (getter, `Readonly<World>`), `timeScale` (getter), `freezeRealMs` (getter), `consumeFreeze(realMs)`, `snapshot()`, `restore(s)`, `journal()`. Semantics in Dev Notes › The sim at a glance. `ctx.t` is a getter over the current `world` so it stays right after `restore`.
  - [x] Validate the inputs with `invariant`: `seed` is an integer in `[0, 2**32)`; when `journal` is given, `journal.version === 1`, `journal.seed === seed` and `journal.feelHash === hashJson(content.feel)`. `feelHash` is computed once at creation.
  - [x] `src/sim/index.ts`: export `createSim` and the types `Sim`, `CreateSimOptions`, `SimSnapshot`, `SimCommand`, `SimEvent`, `World`, `Journal`, `JournalEntry`, plus `replayJournal` (T5). Nothing else: this file **is** the `@sim` public API.
  - [x] `src/sim/createSim.test.ts`: AC 1 (100 steps → `1000`; JSON round-trip at creation and after 100 steps); `timeScale` getter; `drainEvents` semantics; freeze getter/consume; `step()` still advances while a freeze is pending; bad seed rejected.
  - [x] `src/sim/determinism.test.ts` (AC 3): a probe system (draws `nextInt`/`nextFloat`, calls `allocateId`, pushes an event carrying what it drew, requests a freeze now and then) injected through `createSimWithSystems`; two sims, same seed, same commands, 10 000 steps → equal `world`, equal event arrays (drain every 100 steps and concatenate), equal `hashJson`; seeds 1 and 2 give different hashes.
- [x] **T5 — Snapshot, restore, replay (AC 6)**
  - [x] `src/sim/snapshot.ts`: `SimSnapshot = { version: 1; world: World }`. `snapshot()` returns a deep copy (`cloneJson`); `restore(s)` does `invariant(s.version === 1)`, replaces the world with a deep copy, and **clears** the pending queue, the event buffers, the freeze and the journal entries (a restored sim records only what is enqueued after the restore; its `seed` and `feelHash` stay). Nothing else is part of the snapshot: freeze is a real-time artefact, the queue is rebuilt from the journal.
  - [x] `src/sim/replay.ts`: `replayJournal({ content, journal, untilSimMs, strictInvariants? }): Promise<Result<{ sim: Sim; events: SimEvent[] }, AppError>>`. Errors (kind `'journal'`) for a wrong `version` or a `feelHash` that differs from `hashJson(content.feel)`: never throw for those. Otherwise `createSim({ content, seed: journal.seed, journal })`, step while `world.time.sim < untilSimMs`, draining after each step into one array. Story 1.12's `sim:replay` reuses it.
  - [x] `src/sim/snapshot.test.ts`: the AC 6 scenario (run A with commands incl. a late one, snapshot at a step boundary mid-run, finish A; B = fresh sim, `restore`, enqueue `A.journal()` entries with `applyAt > snapshot.world.time.sim` through the public `enqueue(entry.command)`, step the same number; `hashJson(B.world) === hashJson(A.world)`, same events after the snapshot, and `B.journal().entries` equals those re-enqueued); the snapshot is a deep copy (mutating the live world or the snapshot's world does not affect the other); restore clears pending/events/freeze; a wrong version throws.
  - [x] `src/sim/replay.test.ts`: a live game (commands enqueued at chosen steps, including one whose `t` is in the past at enqueue time) and `replayJournal` of its `journal()` end with the same `hashJson(world)` and the same events; `feelHash` mismatch and `version` mismatch return `ok: false`.
- [x] **T6 — Test support and golden tests (AC 7)**
  - [x] `tests/support/testFeel.json`: a **frozen copy** of today's `content/feel.json` (keep `$schema` pointing at `../../content/_schemas/feel.schema.json`). It is a test fixture: Geo retuning `content/feel.json` must never change a golden result. Whoever adds a feel key later also adds it here.
  - [x] `tests/support/testContent.ts`: `createTestContent(): ContentBundle` (reads the fixture with `node:fs`, parses it with `parseContentFile`, `strings: {}`; throws with the problems if the fixture is invalid) and `stepN(sim, n)`. Colocated sim tests import it with a relative path (`../../tests/support/testContent.ts`): the layer scanner treats `tests/` as "not a layer" (verified), and `src/**` still cannot import `tools/` (R8).
  - [x] `tests/golden/scenarios.ts`: a `Scenario = { name; seed; untilSimMs; actions: { atStep: number; command: SimCommand }[] }` list with one scenario `core_basic` (30 s, a `SetTimeScale` to a slow value, one back to normal, one **late** command whose `t` is before the current sim time when enqueued, one future command) and `recordScenario(content, scenario)`, which drives a live sim and returns `{ journal, worldHash, events }`.
  - [x] `tests/golden/journals/<name>.json` (the recorded `Journal`) and `<name>.expected.json` (`{ untilSimMs, worldHash, eventTypes, eventsHash }`, where `eventTypes` is the ordered list of event `type`s and `eventsHash = hashJson(events)`), both committed.
  - [x] `tests/golden/golden.test.ts`, per scenario: (1) recording the scenario again gives exactly the committed journal; (2) `replayJournal` of the committed journal gives the committed `worldHash`, `eventTypes`, `eventsHash`; (3) the live run and the replay agree with each other. A missing reference file fails with "run `npm run golden:update` and commit the result".
  - [x] Update mode: `GOLDEN_UPDATE=1` rewrites the journal and expected files from a fresh recording instead of comparing; refuse to run in update mode when `process.env.CI` is set. `package.json`: `"golden:update": "GOLDEN_UPDATE=1 vitest run tests/golden"`.
- [x] **T7 — Coverage tooling, scripts, docs (AC 9)**
  - [x] Install `@vitest/coverage-v8@5.0.5` exactly (`npm i -E -D`; verified on npm, peer `vitest 5.0.5`). Add nothing else.
  - [x] `vitest.config.ts`: `coverage: { provider: 'v8', include: ['src/sim/**/*.ts'], exclude: ['**/*.test.ts'], thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 } }`. Check the option names against the 5.0.5 docs (Vitest 4 dropped `coverage.all`: uncovered files appear only through `include`).
  - [x] `package.json`: `"test:coverage": "vitest run --coverage"`, `"golden:update"`; in `ci`, replace the `npm run test` stage by `npm run test:coverage` (same position). `.github/workflows/ci.yml`: the `test` step runs `npm run test:coverage`. `npm test` stays a plain `vitest run` (a partial run must not trip the threshold).
  - [x] `CLAUDE.md`: Commands table gets `test:coverage` ("Vitest with the `src/sim` ≥ 90 % thresholds; what CI runs") and `golden:update` ("Regenerate golden journals and references; deliberate, say so in the story"). Stay under ~120 lines.
  - [x] `deferred-work.md`: add a "Resolved in story 1.3" note under the 1.1 item "Biome vs `simPurity` on sim tests": **no change**. Biome keeps linting sim tests with the purity globals; `simPurity` keeps skipping test files; a sim test that needs a clock or randomness belongs in `tests/`.
  - [x] Do not commit (the sprint workflow leaves that to Geo or the review). Leave `_bmad/`, `docs/`, `.claude/` untouched.
- [x] **T8 — Verify (all ACs)**
  - [x] `npm run ci` passes end to end (typecheck, lint, content:check, test:coverage, e2e chromium + webkit, build:playtest).
  - [x] `npm run golden:update` followed by `git status` shows no change (idempotent); flipping one command in a committed journal makes `npm test` fail with a readable message; restore it.
  - [x] Prove the coverage gate bites: temporarily move one `src/sim/**/*.test.ts` file away, confirm `npm run test:coverage` fails on the 90 % threshold, then restore it.
  - [x] Temporarily add `Math.random()` to a `src/sim` file: `npm test` (simPurity) and `npm run lint` both fail; remove it.
  - [x] `git status`: only the files of the File List changed; `tests/architecture/**` and `biome.json` are unchanged.

## Dev Notes

### What exists today (stories 1.1 and 1.2, done)

- `src/shared/{log,result,constants}.ts` with tests. `Result<T, E = AppError>`, `ok()`, `err()`, `AppError { kind; message; cause? }`. **Reuse `Result`; the sim never imports `log`** (R3b).
- `src/content/`: `ContentBundle { feel: Feel; strings: Strings }` (`contentBundle.ts`), `Feel` type (`schemas/feel.ts`), `parseContentFile`, `loadContent`, `mergeFeel`. `content/feel.json` is the live, tunable file.
- `src/sim/` holds only `.gitkeep` (delete it when the first real file lands). `tests/golden/` holds only `.gitkeep` (same).
- `tests/architecture/`: `simPurity` and `layerBoundaries` scan the real `src/sim` on every `npm test`; `biomeBoundaries` proves the Biome rules. They are strict (see traps below). `src/main.ts` still has the temporary content load.
- Imports: cross-layer through aliases without extension (`@shared/result`, `@content/contentBundle`), inside a layer relative with `.ts` (`./world.ts`). `import type` is mandatory for types (`verbatimModuleSyntax`).

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | `createSim` returns `Promise<Sim>`. | The architecture contract; Rapier's WASM init (story 1.15) is async, and a sync→async change later would break every caller. Tests `await` it. |
| D2 | `World` is `{ time: { sim, scale }, rng, nextId }` only. | "No game files ahead of their stories." The effective `Feel` is **not** in `World` yet: it is constant for a sim, passed as `ctx.feel`. When `SetFeel` arrives (story 2.1) the effective feel must move into the snapshot-complete state. |
| D3 | The journal stores `{ applyAt, command }`, not bare commands. | A command can be enqueued after its timestamp (input latency makes `t` older than "now"). Replaying "all commands upfront" would apply a late command earlier than the live game did. `applyAt` makes replay independent of when the live game happened to enqueue. |
| D4 | Pending commands, event buffers, journal, freeze and `strictInvariants` live in the sim's runtime, **outside `World`**. | `World` stays the snapshotted, hashed state. Freeze is a real-time artefact: a game recorded in the client (freeze consumed) and replayed headless (never consumed) must hash the same. |
| D5 | The only command is `SetTimeScale`; the only events are `TimeScaleChanged` and `InvariantViolated`. | The epics list no gameplay in this story, yet the queue, the journal and the golden tests need something real and deterministic to carry. `SetTimeScale` also gives AC 5 a way to reach `timeScale = 0.3`. Do not invent `PressThreat`, `TapFloor`… here. |
| D6 | Invariant strictness is injected (`strictInvariants`), defaulting to `defaultStrictInvariants()`. | Both branches (throw / clamp) must be testable in Vitest, where `import.meta.env.PROD` is false. |
| D7 | `restore()` clears pending commands, events, freeze and the journal. | The snapshot is `World` only; the journal commands still to apply are re-enqueued by the replayer from `applyAt > snapshot time`. |
| D8 | Golden tests run on a **frozen** copy of the feel (`tests/support/testFeel.json`), not on `content/feel.json`. | Golden rule: Geo tunes `feel.json` freely. A golden test tied to the live file would fail on every tuning session. |
| D9 | The "`--update` option" of the epics is `npm run golden:update` (env var `GOLDEN_UPDATE=1`). | A Vitest test cannot reliably read a custom CLI flag in a worker; an env var is inherited. Refused when `CI` is set. |
| D10 | `@vitest/coverage-v8@5.0.5` is added and CI runs `test:coverage`. | project-context requires `src/sim` coverage ≥ 90 %; story 1.1 deferred the tooling to "the sim code (story 1.3)". |
| D11 | The architecture's `createSim` option `journal?` is kept (pre-loads the entries); `mamaMemory?` is not (story 3.8). | `replayJournal` and the future `sim:replay` need it. |

### The sim at a glance (shapes, not code to copy)

```ts
// src/sim/context.ts
export interface StepContext extends InvariantContext {   // brings strictInvariants, t (getter), events
  readonly feel: Feel;                     // content.feel as given (callers pass the already merged feel)
  readonly events: SimEvent[];             // systems push here; the Sim drains it
  readonly queue: CommandQueue;            // internal: only applyCommands touches it
  readonly commands: SimCommand[];         // commands applied at THIS step, in order; reused array
  requestFreezeRealMs(ms: number): void;   // sanctioned hitstop channel (writes outside World)
}
export type System = (world: World, ctx: StepContext) => void;

// src/sim/createSim.ts
export interface CreateSimOptions {
  content: ContentBundle; seed: number; journal?: Journal; strictInvariants?: boolean;
}
export interface Sim {
  enqueue(cmd: SimCommand): void;               // deep-copies cmd, computes applyAt, records it in the journal
  step(): void;                                 // exactly one STEP_MS; never refuses because of a freeze
  drainEvents(): readonly SimEvent[];
  readonly world: Readonly<World>;              // current world (changes identity after restore)
  readonly timeScale: number;                   // world.time.scale
  readonly freezeRealMs: number;                // remaining hitstop, real ms
  consumeFreeze(realMs: number): void;          // called by the client loop; headless never calls it
  snapshot(): SimSnapshot;
  restore(s: SimSnapshot): void;
  journal(): Journal;                           // a deep copy each call
}
```

- **`drainEvents()` must not allocate an array per call** (project-context). Keep one `events` array (the stable `ctx.events`) and one `drained` array: on drain, `drained.length = 0`, copy the references over, `events.length = 0`, return `drained`. The returned array is valid until the next `drainEvents()` call (callers copy what they keep; `replayJournal` pushes the elements out immediately). Test: two consecutive drains return the same array instance, the second empty. Nothing drains automatically: a long headless run must drain regularly or events accumulate.
- **`step()`**: refresh nothing per step except through the systems; no object/array/closure literal in the step path (zero allocation). `ctx.commands` and the buffers are created once.
- **`ctx.t`** is a getter over the sim's current `world` variable (so it follows `restore`). It is the time `clampInvariant` stamps on `InvariantViolated`.
- **`enqueue`/`journal` copy their data** (`cloneJson`): a caller mutating its command after `enqueue`, or a returned journal, must never rewrite the sim's history (story 1.1 review: `buffer()` copies).
- `createSim` computes `feelHash = hashJson(content.feel)` once. `journal()` returns `{ version: 1, seed, feelHash, entries }`.

### Command timing (the rule to implement and test)

Let `T = world.time.sim` between steps. The next step **ends at** `T + STEP_MS`; after it, `world.time.sim` equals that value. A step's "game time" is its end time. All events emitted by systems during a step carry the **post-advance** `world.time.sim`; `applyCommands` runs before `advanceTime` but emits nothing (it only moves due commands into `ctx.commands`, and the handlers run in the owning system).

- `applyAt(cmd) = max(ceilToStep(cmd.t), T + STEP_MS)` with `ceilToStep(t) = Math.ceil(t / STEP_MS) * STEP_MS`. `cmd.t` may be fractional (`event.timeStamp` is) or in the past.
- `applyCommands` applies, in this step, the pending entries with `applyAt <= T + STEP_MS`, ordered by `(applyAt, enqueue order)`.
- Invariant: after `N` steps from a fresh sim, every command with `t <= 10 * N` that was enqueued before step `N` has been applied.
- Rule table (fresh sim, `T = 0`, enqueued before the first step; each row is a test):

| `cmd.t` | `applyAt` | Applied by |
|---|---|---|
| `250` | `250` | step 25 |
| `251` | `260` | step 26 |
| `250.4` | `260` | step 26 |
| `0`, `-30` | `10` | step 1 |
| `1005` (sim at `T = 1000`) | `1010` | next step |
| `980` (sim at `T = 1000`, "late") | `1010` | next step |
| `1012` (sim at `T = 1000`) | `1020` | second step |

- Two commands with the same `applyAt` run in the order they were enqueued. A snapshot taken at a step boundary then replayed by re-enqueueing `applyAt > snapshotTime` entries in journal order reproduces the original `applyAt`s exactly (this is why `applyAt` sits on the step grid); the snapshot test proves it, include a command with `t` strictly between two step ends.
- The judgement of a future `PressThreat` (story 1.10) uses `cmd.t`, not `applyAt`: the `ctx.commands` handlers read `command.t`.

### System order

Fixed order of the architecture (project-context: "commands → time → director → baby → threats → papa → physics → gauges → instinct → scoring → flow"):

```
applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa, runPhysics, runGauges, runInstinct, runScoring, runFlow
```

This story implements the first two. Write the full list as a comment above `SYSTEMS`; each later story inserts its system at its slot, edits the pinned order test and, if behaviour changes, regenerates the goldens and says so. Systems never call each other.

### Invariants (`src/shared/invariant.ts`)

`shared` imports nothing from other layers, so the context is structural and the event type lives here:

```ts
export interface InvariantViolation { type: 'InvariantViolated'; t: SimMs; name: string; value: number }
export interface InvariantContext {
  readonly strictInvariants: boolean;
  readonly t: SimMs;
  readonly events: { push(event: InvariantViolation): unknown };   // a SimEvent[] satisfies it
}
```

- `clampInvariant(ctx, value, min, max, name)`: in bounds (inclusive) → returns `value` untouched. Out of bounds or `NaN`: strict → `throw new Error(...)` naming `name` and the value; not strict → push `InvariantViolated` and return the clamped value (`NaN` becomes `min`).
- `defaultStrictInvariants()`: `import.meta.env?.PROD !== true` (same optional-chaining trick as `log.ts`: `import.meta.env` is undefined under `tsx`, so tools are strict; Vitest is strict; any `vite build` flavour clamps, playtest included, because "we never crash mid-level").
- `invariant()` is for programmer errors (bad seed, wrong snapshot version): it always throws. **No `try/catch` anywhere in `src/sim`.**

### PRNG (`src/shared/rng.ts`)

- State: `{ a: number; b: number; c: number; d: number }` (four int32), stored as `world.rng`; JSON-safe.
- sfc32 step (public-domain, bryc), all in int32 arithmetic:
  `t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11); c = c + t | 0; return t >>> 0`. `nextFloat = nextUint32 / 4294967296` (in `[0, 1)`).
- Seeding: `a = 0x9E3779B9 | 0`, `b = 0x243F6A88 | 0`, `c = 0xB7E15162 | 0`, `d = seed | 0`, then discard 15 outputs. `seed` is an integer in `[0, 2**32)` (`invariant`). A decision of this story, so a different scheme later would invalidate every golden.
- `nextInt(rng, min, max)`: integers, `min < max`, `min + Math.floor(nextFloat * (max - min))`.
- Test against an **inline closure-style reference sfc32** (same initial state, 1000 outputs): no magic constants, independent check. Never `-0` in the state (`|0` cannot produce it; `toEqual` distinguishes `-0` from `0`).

### Hash (`src/shared/hash.ts`)

- `canonicalJson`: objects with keys sorted (`Object.keys(...).sort()`), arrays in order, numbers via `String(n)` after rejecting non-finite (`-0` → `"0"`), strings via `JSON.stringify`. Plain-object check as in `feelMerge.ts` (`prototype === Object.prototype || null`).
- `hashJson`: cyrb53 over the canonical text (public domain, bryc): two 32-bit lanes seeded `0xdeadbeef` / `0x41c6ce57`, `Math.imul` with `2654435761` / `1597334677`, final avalanche with `2246822507` / `3266489909`, result `4294967296 * (2097151 & h2) + (h1 >>> 0)`, rendered `toString(16).padStart(14, '0')`. Algorithm self-pinned by one known-answer test; collisions are irrelevant here.
- The golden world hash is `hashJson(sim.world)`: it is the reason `World` may contain nothing `canonicalJson` rejects.

### Architecture guardrails and traps (read before coding)

- **Purity scanner (`simPurity`) strips comments and strings, then bans whole words in `src/sim` (non-test files):** `Math.random`, `Date`, `performance`, `window`, `document`, `setTimeout`, `requestAnimationFrame`, `localStorage`, `globalThis`/`self` bracket access, **bare `Math`** (only `Math.<member>` is accepted: no `const { floor } = Math`). Even a property named `window` or `performance` is flagged: names carry unit suffixes (`windowMs`). `Math.floor`, `Math.max`, `Math.ceil` are fine.
- **Not caught by tooling, still forbidden:** `process`, `Buffer`, `node:*` imports (`fs`…). `types: ["vite/client", "node"]` lets them compile (deferred 1.1 item): do not use them in `src/sim`. For deep copies use `cloneJson`, not `structuredClone` (which silently accepts `undefined`, `-0` and class instances).
- **Layers:** `src/sim` may import `@shared/*` (not `@shared/log`) and **types** of `@content/*`. Use `import type`; never import a Zod schema or `loadContent` value into the sim (it would drag `zod` into the sim bundle). No `three`, `@capacitor/*`, `@client`, `@platform`, `@debug`, `@bots`, no `@dimforge/*` (Rapier is story 1.15, `physics/rapierPhysics.ts` only). Inside `src/sim` imports are relative; `src/sim/index.ts` is the only public file (`@sim`).
- **`src/shared` accepts no npm package and no other layer:** `time.ts`, `rng.ts`, `hash.ts`, `invariant.ts` import only each other (relative). Their tests may import `vitest`.
- **Units and names:** `…Ms` suffixes (`untilSimMs`, `realMs`), `t`/`…At` for sim time (`applyAt`), `…AtReal` never appears in the sim. Events PascalCase past tense with `type` and `t`; commands PascalCase imperative. FSM rule not exercised yet (no FSM), but do not add `enum`/`namespace`/parameter properties.
- **No GDD number in code.** `STEP_MS` and `MIN_TIME_SCALE` are technical constants in `shared/constants.ts`. The slow-mo values (0.3, 1200 ms…) stay in `feel.json`; tests pass their own literals as inputs.
- **Hot path:** nothing allocates in `step()`. Events are the one allocation (they are rare). `log` is never used.
- **Do not weaken** `tests/architecture/**` or `biome.json` to make code pass.

### Technical notes

- **TS 7 / Vite 8 / tsx:** no `baseUrl`; aliases from `tsconfig.json` are resolved by Vitest (`resolve.tsconfigPaths`) and `tsx`. Tests import `@sim`, `@shared/*`, `@content/*` the same way the app does.
- **Vitest 5.0.5:** `describe/it/expect` imported from `vitest`. Coverage via `@vitest/coverage-v8@5.0.5` (peer `vitest 5.0.5`, verified on npm 2026-10-26). `coverage/` is already in `.gitignore`.
- **Time in tests** is expressed in steps: `stepN(sim, 120)` = 1200 ms of game time. No `setTimeout`, no fake timers.
- **`JSON.parse(JSON.stringify(...))` of fractional timestamps** round-trips exactly (shortest-round-trip number printing), which journals rely on.

### Testing standards

- Unit tests colocated in `src/sim/**` and `src/shared/**`; golden tests in `tests/golden/`; shared fixtures in `tests/support/`. Sim tests run in Node with `createSim`/`createSimWithSystems` and typed commands only: assert on `World`, `hashJson(world)` and drained events, never on internals.
- **Never pin tunable values.** Tests of the sim use `tests/support/testFeel.json` (frozen) and pass explicit literals for what they send (`scale: 0.3` as a command input is fine). The only value pinned on purpose is the algorithm self-pin of the hash and the rule table of command timing.
- Make each test really exercise what its name claims (story 1.2 review: a test named "does not throw when the source rejects" never rejected). In particular: the prod branch of `clampInvariant` needs `strictInvariants: false`; the "late command" replay case needs a command whose `t` really is older than the sim time at `enqueue`.
- Coverage target: `src/sim` ≥ 90 % lines, functions, branches, statements.
- Golden update workflow: `npm run golden:update`, review the diff, say in the Completion Notes that the references were regenerated and why. Never loosen a comparison.

### Project Structure Notes

- New files follow the architecture tree: `src/shared/{rng,hash,invariant}.ts`, `src/sim/{index,world,step,commands,events,snapshot,journal}.ts`, `src/sim/time/{clock,timeScale,hitstop}.ts`, `tests/golden/{golden.test.ts,journals/*.json}`.
- Small additions to the documented tree (same layers, no new top-level folder): `src/shared/time.ts`, `src/sim/{createSim,context,commandQueue,replay}.ts`, `tests/golden/scenarios.ts`, `tests/support/{testContent.ts,testFeel.json}`. `src/shared/ids.ts` (branded entity ids) is **not** created now: nothing needs a typed id yet.
- `tests/support/` is new; a src test importing from it uses a relative path, which the scanners accept (`tests/` is outside the layers). Delete `src/sim/.gitkeep` and `tests/golden/.gitkeep`.

### Previous story intelligence (1.1, 1.2)

- Reviews found the same classes of defect each time: **unvalidated inputs** (a `bufferSize` of `NaN`), **aliasing** (returning internal objects), **tests that do not exercise what they claim**, **tunable values pinned in tests**, **planned end-to-end tests replaced by weaker ones**. This story's seed/scale/snapshot validation, deep copies, the strict/non-strict and late-command tests and the frozen fixture answer those directly.
- The scanners are strict and hand-written (no TS compiler API in TS 7): run `npm test` and `npm run lint` after the first sim file, not at the end.
- `log.buffer()` keeps `info`+; irrelevant here (the sim never logs), but the client will log `InvariantViolated` as `warn` (story 1.4).
- Run `npm run format` after writing JSON/TS; Biome 2.6 also formats JSON fixtures under `tests/`.
- Commit style so far: one implementation commit and one review-fix commit per story, short French title (`Story 1.3 : …`) + `Co-Authored-By`. Changes are left uncommitted by the dev workflow.
- Deferred and still deferred: type-level isolation of the sim (`src/sim/tsconfig.json` with `lib: ['ES2023']`, `types: []`), global error hook and player-facing fallback (story 1.4), duplicated Biome lists. Do not fix them here.

### Git intelligence

- `15312b9` Story 1.2 review fixes; `b44451b` Story 1.2 content pipeline (adds `src/content`, `tests/content`, `tools/content`); `625a94b` / `47fb4ed` Story 1.1. Tool and content tests that need real files live in `tests/` (R8); pure helpers are colocated. Same split here: fixture-reading helpers in `tests/support/`.
- Dependencies added so far are exact-pinned (`--save-exact`); keep that for `@vitest/coverage-v8`.

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests the systems; Geo plays and tunes the feel. Anything tweakable is data. Everything stays playable end to end without a human (bots, headless sim): this story is that foundation.
- **Sim:** fixed `STEP_MS = 10`; `timeScale` changes how many steps run per real second, never the step; hitstop is a real-time freeze the sim only requests; pause is never `timeScale = 0`. `World` is plain serializable data (no classes, functions, `Map`/`Set` with object keys, Three refs). Systems are `(world, ctx) => void` in a fixed order and never call each other. Randomness only from `world.rng`, ids only from `world.nextId++`. State machines via `enter…State()` (none yet).
- **Commands/time:** the sim only receives typed, timestamped `SimCommand`s; every command is judged on its own `t` (never on `step()` time); live tuning later through the journaled `SetFeel`.
- **Errors:** `Result` for I/O-like boundaries (`replayJournal`), `invariant()` / `clampInvariant(ctx, …)` inside the sim, no `try/catch` in `src/sim`, no silent failure.
- **Naming:** units as suffixes; `t`/`…At` = sim time; branded `SimMs`/`RealMs`; events PascalCase past tense; commands PascalCase imperative; constants `UPPER_SNAKE` in `shared/constants.ts`; factories `create<Name>` in a file named after the export (`createSim.ts`, `createCommandQueue` in `commandQueue.ts`).
- **Testing:** Vitest in Node, `describe/it/expect` from `vitest`, time in steps, golden tests compare final-state hash + event sequence, regenerate deliberately and say so, `src/sim` coverage ≥ 90 %, architecture tests are guardrails.
- **Stack pinned:** no ESLint/Prettier/React/ECS/state libs, no Capacitor before E8; the only addition allowed here is `@vitest/coverage-v8@5.0.5`.
- **When docs disagree:** game rules follow the GDD, technical mechanics the architecture; if still ambiguous, ask Geo.

### Out of scope (belongs to other stories)

- Client loop, `timeMap`, pause (1.4); `PauseRequested`, global error hook (1.4/1.5).
- Papa, baby, nav, threats, director, gauges, scoring, flow, physics/Rapier and its snapshot (1.7 → 1.22); the `Sim` snapshot gets a Rapier blob in 1.15 and bumps `SimSnapshot.version`.
- Gameplay commands (`PressThreat`, `Release`, `TapFloor`…): each arrives with its handler.
- `SetFeel` and feel-in-`World` (2.1); `JournalSchema`, `contentVersion`/`levelId` in the journal, export (3.3); periodic 5 s snapshots and `SNAPSHOT_EVERY_MS` (3.9); bots and `npm run sim` / `sim:replay` CLI (1.12, they reuse `replayJournal`); `window.__PP__` (1.13).
- Slow-mo durations: `feel.json` documents `slowMo*.durationMs` as real ms, but the sim has no real clock. Story 1.14 decides the counting (for example summing `STEP_MS / timeScale` per step) and the overlap rule; here `timeScale` is just a value set by a command.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3 : Cœur de simulation déterministe en headless]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences supplémentaires (architecture) › Simulation et temps; Entrées]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Boucle de jeu et modèle de temps], [#Modèle d'état], [#Déterminisme, journal et replay], [#Système d'événements], [#Gestion des erreurs], [#Configuration]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Arborescence] (`src/sim/`, `src/shared/`, `tests/golden/`) and [#Frontières d'architecture]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Contrats d'API (internes)] (`Sim`, `createSim`) and [#Patterns d'état], [#Patterns de communication], [#Règles de cohérence]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#P3 — Jugement à l'appui, chorégraphie ensuite] (why `cmd.t` is kept), [#P6 — Réglage à chaud du feeling] (`SetFeel`, journaled)
- [Source: _bmad-output/project-context.md] (Engine-Specific Rules › Simulation core; Testing Rules; Critical Don't-Miss Rules)
- [Source: _bmad-output/implementation-artifacts/1-1-initialiser-le-projet-et-ses-garde-fous.md] (scanners, deferred items) and [1-2-pipeline-de-contenu-et-fichier-de-feeling.md] (review findings, `tests/` vs `src/` split)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] (Biome vs `simPurity` on sim tests; type-level isolation)

### Open points for Geo (do not block the dev)

1. D5: `SetTimeScale` is the single command of this story; it doubles as story 2.1's "forced `timeScale`". Say so if you would rather name it differently.
2. D8: golden tests use a frozen copy of the feel. The price is that a story adding a `feel.json` key also updates `tests/support/testFeel.json` (the TypeScript and schema errors point at it).
3. D1: `createSim` stays async to avoid a breaking change when Rapier arrives.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), via the `gds-dev-story` workflow.

### Debug Log References

- `npm run ci` passes end to end: typecheck, lint (Biome, 90 files, 0 diagnostics), `content:check`, `test:coverage` (29 files, 379 tests), Playwright (6 tests, chromium and webkit), `build:playtest`. `src/sim` coverage: 100 % statements, functions and lines, 96 % branches (threshold 90 %).
- Negative checks (T8): editing one command of the committed journal makes the two journal-based golden tests fail; a missing reference file fails with the "run `npm run golden:update`" message; moving `replay.test.ts` away makes `test:coverage` fail on the 90 % branches threshold; a `Math.random()` in `src/sim` fails `simPurity` (Biome does not express `Math.random`, as documented); `npm run golden:update` is idempotent (same checksums twice).
- Two test mistakes found on first run and fixed in the tests, not in the code: a `timeScale` test enqueued two commands that both landed on step 1 (`t=0` and `t=10` share `applyAt = 10`), and the self-pinned `hashJson` value was recorded after cross-checking it against an independent cyrb53 reference run in Node.

### Completion Notes List

- **Approach.** `src/shared` got the pure primitives (`time`, `rng` sfc32, `hash` with `canonicalJson`/`cloneJson`/`hashJson`, `invariant`). `src/sim` holds `World` (`time`, `rng`, `nextId` only), the command queue with the pinned `applyAt` rule, `time/{clock,timeScale,hitstop}`, `step` with `SYSTEMS = [applyCommands, advanceTime]`, `createSim`/`createSimWithSystems`, `snapshot`, `journal`, `replayJournal`, and the `@sim` public API (`index.ts`).
- **Decisions D1 to D11 of the story were followed as written.** `createSim` is async; pending commands, event buffers, journal, freeze and strictness live outside `World`; the journal stores `{ applyAt, command }`; `SetTimeScale` is the only command; golden tests use the frozen `tests/support/testFeel.json`; `golden:update` uses `GOLDEN_UPDATE=1` and is refused when `CI` is set; coverage is gated by `@vitest/coverage-v8@5.0.5` and CI runs `test:coverage`.
- **Small choices inside the story's room.** `requestFreeze(state, ctx, ms)` takes the invariant context so that a NaN, negative or infinite request goes through `clampInvariant` (`freeze.requestMs`, bounds `[0, Number.MAX_VALUE]`); `consumeFreeze` silently ignores a non-positive or NaN duration (the client passes frame deltas). `drainEvents()` reuses one array (valid until the next call) and `ctx.events` stays a stable array. `restore()` also empties `ctx.commands`. The commands/events union types are a single-member union (`SimCommand`) and a two-member union (`SimEvent`), as planned.
- **Probe system in tests.** No gameplay system exists, so the determinism test injects a probe through `createSimWithSystems` that uses the rng, ids, an event and a freeze; its events borrow the `TimeScaleChanged` shape to carry what it drew. The golden scenario `core_basic` covers time and commands only (including an off-grid `t`, a late command and a future one); the first gameplay golden arrives with story 1.10.
- **Golden references were generated in this story** (first time): `tests/golden/journals/core_basic.json` and `core_basic.expected.json`.
- **No guardrail touched.** `tests/architecture/**` and `biome.json` are unchanged; the layer scanner accepts the relative imports of `tests/support/*` from `src/sim/*.test.ts` as predicted.
- **Not verified here:** nothing was run in a browser (this story has no client part), and nothing was committed. `package-lock.json` changed only for `@vitest/coverage-v8`.

### File List

New:
- `src/shared/time.ts`, `src/shared/time.test.ts`
- `src/shared/rng.ts`, `src/shared/rng.test.ts`
- `src/shared/hash.ts`, `src/shared/hash.test.ts`
- `src/shared/invariant.ts`, `src/shared/invariant.test.ts`
- `src/sim/index.ts`, `src/sim/world.ts`, `src/sim/commands.ts`, `src/sim/events.ts`, `src/sim/context.ts`, `src/sim/journal.ts`
- `src/sim/commandQueue.ts`, `src/sim/commandQueue.test.ts`
- `src/sim/step.ts`, `src/sim/step.test.ts`
- `src/sim/createSim.ts`, `src/sim/createSim.test.ts`, `src/sim/determinism.test.ts`
- `src/sim/snapshot.ts`, `src/sim/snapshot.test.ts`
- `src/sim/replay.ts`, `src/sim/replay.test.ts`
- `src/sim/time/clock.ts`, `clock.test.ts`, `timeScale.ts`, `timeScale.test.ts`, `hitstop.ts`, `hitstop.test.ts`
- `tests/support/testContent.ts`, `tests/support/testFeel.json`
- `tests/golden/golden.test.ts`, `tests/golden/scenarios.ts`
- `tests/golden/journals/core_basic.json`, `tests/golden/journals/core_basic.expected.json`

Modified:
- `src/shared/constants.ts` (`STEP_MS`, `MIN_TIME_SCALE`)
- `package.json`, `package-lock.json` (`@vitest/coverage-v8@5.0.5`, scripts `test:coverage`, `golden:update`, `ci`)
- `vitest.config.ts` (coverage thresholds on `src/sim`)
- `.github/workflows/ci.yml` (test step runs `test:coverage`)
- `CLAUDE.md` (two commands)
- `_bmad-output/implementation-artifacts/deferred-work.md` (resolution note), `sprint-status.yaml` (story status)

Deleted:
- `src/sim/.gitkeep`, `tests/golden/.gitkeep`

## Change Log

- 2026-10-26: Story 1.3 created (ready-for-dev).
- 2026-10-26: Story 1.3 implemented. Deterministic sim core (`World`, fixed 10 ms step, command queue with `applyAt`, time scale and freeze, seeded sfc32 rng, invariants, snapshot/restore, journal and `replayJournal`), golden tests on a frozen feel, `src/sim` coverage gate. Status → review.
