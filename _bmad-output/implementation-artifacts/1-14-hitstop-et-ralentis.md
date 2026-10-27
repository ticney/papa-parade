---
baseline_commit: 65158a44d655bace1f59800e5937afbb83911e84
---


# Story 1.14: Hitstop and Slow-mo

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.14 « Hitstop et ralentis ». Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want the game to stop for a beat when I succeed, and to go into action-film slow-mo on a perfect response,
so that I feel every success.

**Requirements covered:** FR8 (hitstop 80 ms on a successful response; slow-mo ×0.3 for 1.2 s on a perfect response; the ×0.2 / 1.5 s « last threat of a wave » slow-mo is only *made possible* here, story 1.18 triggers it). Architecture: « Boucle de jeu et modèle de temps » (two clocks, `timeScale` owned by the sim, hitstop = `freezeRealMs` consumed by the client loop), ADR-002 (windows in sim time), P3 (« un ralenti parfait démarre au jugement : la glissade se fait au ralenti »), « Retours multimodaux » (time effects are decided in the sim from `feel.json`, never by the `FeedbackDirector`). UX: `EXPERIENCE.md` › « Slow-mo (perfect, wave end) — The HUD stays » and « Reduced motion — Hitstop, slow-mo: unchanged » (nothing to build for either: both already hold, see Dev Notes).

## Precondition (check first, stop if it fails)

Story 1.13 is `done` (commit `65158a4`, review fixes in). `git status` clean apart from `_bmad-output/`. Run `env | grep VITE_` (the agent shell may export `VITE_DEBUG_ALLOWED=false`, see `CLAUDE.md` › Trap), then `(unset VITE_DEBUG_ALLOWED; npm run ci)` **before the first edit** and let it finish. Note unit and e2e counts in the Debug Log. If the baseline is red, stop and say so.

## Acceptance Criteria

1. **Hitstop on a successful response** — when the sim resolves a threat with quality `success` **or** `perfect` (D1), it requests a freeze of `feel.timing.hitstopMs` real ms (80) through `ctx.requestFreezeRealMs`, at the step that emits that `ResponseResolved`. In the client no step runs during the freeze while rendering goes on (the loop already does this since story 1.4; this story proves it with the real sim). A gag requests nothing. Headless (`npm run sim`, golden tests, bots) is unaffected by the freeze.
2. **Slow-mo on a perfect response** — on `ResponseResolved{quality: 'perfect'}`, at that same step, `sim.timeScale` becomes `feel.timing.slowMoPerfect.timeScale` (0.3), holds for `slowMoPerfect.durationMs` (1200) **of sim time**, then returns to the base scale (1) over `slowMoPerfect.returnMs` of sim time with the smoothstep curve (D3). Papa's glide, started at the press, plays out under the slow-mo (it is sim-time choreography: nothing to add, test it).
3. **Overlap rule, deterministic and tested** — with several time effects active at once, the effective `timeScale` at any sim instant is the **slowest** current factor among the active effects and the base scale; a re-triggered effect of the same source keeps the slower factor and the **later** end; effects of different sources keep their own timers, so the slow-down lasts until the longest one has returned. Overlapping freezes keep the longest remaining one (already true). A freeze and a slow-mo compose: freeze first (real time), then slowed steps. Unit-tested on `src/sim/time/slowMo.ts` with a second source (`lastThreat`), including a perfect inside a running slow-mo.
4. **Windows stay in sim time (ADR-002)** — a window that opens during a slow-mo lasts exactly as many sim ms as without it (sim test), and therefore longer in real time: through the client loop with the real sim, the real time between `WindowOpened` and the window's close is `≈ windowMs / timeScale` (loop test).
5. **Determinism and replay** — the slow-mo state lives in `World` (serializable), is part of snapshots (version 4, validated on restore) and replays identically (`sim:replay`, golden tests). The golden references are regenerated **deliberately** (D9): `core_basic`, `papa_walk` and `baby_wander` change only by the world hash (new `World.time` fields), `outlet_parry` also gains the `TimeScaleChanged` events of its two perfect parries; the story's Completion Notes say so and show the event diff.
6. **Data, not code** — every number lives in `content/feel.json` (`hitstopMs`, `slowMoPerfect`, `slowMoLastThreat`, the new `returnMs`), validated by `FeelSchema`; `content/_schemas/` regenerated with `npm run content:schemas`; `tests/support/testFeel.json` updated. No `src/` literal for a duration or a scale.
7. **Nothing else moves** — no new `SimCommand`, no new `SimEvent` type, no change to `content/feedback.json`, the `FeedbackDirector`, the HUD or the camera (stories 2.5 / 2.6 react to slow-mo); `SetTimeScale` keeps its debug role (D6); every existing test passes, the e2e suite included; `npm run ci` green on the Mac.

## Tasks / Subtasks

- [x] **T0 — Baseline** (Precondition)
  - [x] `(unset VITE_DEBUG_ALLOWED; npm run ci)` green on the untouched tree; counts in the Debug Log.
- [x] **T1 — Feel: the return transition, and durations in sim time** (AC 2, 6; D2, D3)
  - [x] `src/content/schemas/feel.ts`: `slowMo(...)` gains `returnMs: delayMs('Return to the base scale after the slow-mo, in sim ms (0 = instant).')`; `durationMs` description fixed to « How long the slow-mo holds, in **sim** ms (ADR-002). » (it wrongly says real ms today). `hitstopMs` description: « Real-time freeze on a successful or perfect response, in real ms (GDD §1). »
  - [x] `content/feel.json` and `tests/support/testFeel.json`: `"slowMoPerfect": { "timeScale": 0.3, "durationMs": 1200, "returnMs": 300 }`, `"slowMoLastThreat": { "timeScale": 0.2, "durationMs": 1500, "returnMs": 300 }` (300 is an `[ASSUMPTION]`, Open points).
  - [x] `npm run content:schemas` (commit `content/_schemas/feel.schema.json`); `tests/content/feelSchema.test.ts` gains the `returnMs` cases (negative → rejected at `timing.slowMoPerfect.returnMs`; missing → rejected); `feelMerge.test.ts` stays green (partial override of `slowMoPerfect.returnMs` keeps the siblings — add that case).
- [x] **T2 — The slow-mo state and the overlap rule** (AC 2, 3, 5; D4, D5, D6)
  - [x] `src/sim/world.ts`: `World.time` gains `baseScale: number` and `slowMos: SlowMo[]`; export `SlowMo` and `SlowMoSource` (Dev Notes › World). `createWorld`: `baseScale: 1`, `slowMos: []`.
  - [x] New `src/sim/time/slowMo.ts` (Dev Notes › slowMo.ts): `startSlowMo`, `updateTimeScale`, `slowMoFactorAt`, and the private smoothstep. Allocation only in `startSlowMo` for a new source.
  - [x] `src/sim/time/timeScale.ts`: unchanged API (`setTimeScale` stays the single writer of `world.time.scale` and the single emitter of `TimeScaleChanged`).
  - [x] `src/sim/time/clock.ts`: `SetTimeScale` now writes `world.time.baseScale` (clamped like today, through `clampInvariant(…, 'time.scale')`), then `updateTimeScale(world, ctx)` runs once per step after the clock advanced (Dev Notes › Order inside a step).
  - [x] `src/sim/time/slowMo.test.ts` (Node, pure functions over a hand-built `World` slice + a fake `StepContext` like `hitstop.test.ts`): Dev Notes › Testing › slowMo.
  - [x] `src/sim/time/timeScale.test.ts`: the four existing cases stay green unchanged (SetTimeScale behaviour is identical when no slow-mo runs). Add: SetTimeScale 0.5 then a slow-mo 0.3 → 0.3, and back to 0.5 (not 1) after it.
- [x] **T3 — Trigger on the judgement** (AC 1, 2; D1, D7)
  - [x] `src/sim/threats/threatFsm.ts` › `resolveThreat`: after pushing `ResponseResolved`, call `ctx.requestFreezeRealMs(ctx.feel.timing.hitstopMs)`; if `quality === 'perfect'`, `startSlowMo(world, ctx, 'perfect', ctx.feel.timing.slowMoPerfect)`. `gagThreat` unchanged. Update both doc comments.
  - [x] `src/sim/threats/threatSystem.test.ts` (or a new colocated `src/sim/threats/timeEffects.test.ts` if it reads better): Dev Notes › Testing › threats.
- [x] **T4 — Snapshot** (AC 5; D8)
  - [x] `src/sim/snapshot.ts`: `version: 4` (comment: « 4 since story 1.14: `World.time` carries the base scale and the slow-mos »), `worldProblem` validates `time.baseScale` and `time.slowMos` (Dev Notes › Snapshot). The stale « Story 1.15 adds the Rapier blob and bumps `version` » comment becomes « Story 1.15 adds the Rapier blob and bumps `version` again ».
  - [x] `src/sim/snapshot.test.ts`: a snapshot taken mid slow-mo (hold and ramp) restores and continues to the same world hash as an uninterrupted run; each malformed field of Dev Notes › Snapshot is refused with its path; version 3 is refused.
- [x] **T5 — Client proof with the real sim** (AC 1, 4)
  - [x] `src/client/loop.test.ts`: the `createSimDouble` comment (« `@sim` has no way to request a hitstop yet (story 1.14) ») becomes « … the double lets a test hold an arbitrary freeze; the real sim requests one on a successful response (story 1.14) ». Add the cases of Dev Notes › Testing › loop. Every existing case passes unchanged. **No change to `src/client/loop.ts`** is expected; if one seems needed, stop and write why in the Debug Log first.
- [x] **T6 — E2E** (AC 1, 2, 7)
  - [x] New `tests/e2e/timeEffects.spec.ts` (chromium and webkit), through `window.__PP__` helpers of `tests/e2e/support/testApi.ts`: Dev Notes › Testing › e2e.
  - [x] Run the whole suite: `threat.spec.ts`, `autoplay.spec.ts`, `tapLatency.spec.ts` must stay green (Dev Notes › Regression traps). The screenshot references must **not** change (the frozen frame is taken after `loadLevel` + `advance`, before any response).
- [x] **T7 — Goldens** (AC 5; D9)
  - [x] `npm run golden:update`; review the diff: only the hashes change in `core_basic`, `papa_walk`, `baby_wander`; `outlet_parry.expected.json` gains `TimeScaleChanged` entries right after each of the two perfect `ResponseResolved` (one to 0.3, then one per ramp step back to 1) and nothing else. Paste the event-type diff summary in the Completion Notes. If any other event moved, stop: something changed behaviour.
  - [x] `npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3` and `npm run sim:replay` on a recorded journal (`--journals`) still exit 0; the report's quality distribution is unchanged from the baseline (the slow-mo changes no judgement).
- [x] **T8 — Docs and status**
  - [x] `_bmad-output/project-context.md` › the `timeScale` bullet: add « effective scale = min(base scale set by `SetTimeScale`, every active slow-mo); slow-mos are `World.time.slowMos`, one per source, see `src/sim/time/slowMo.ts` ». Nothing else.
  - [x] `deferred-work.md`: Dev Notes › Deferred by this story.
  - [x] Final `(unset VITE_DEBUG_ALLOWED; npm run ci)` green. By hand: `npm run dev`, open `/?autoplay=perfect&seed=42` and note in the Debug Log what you saw (freeze beat, slow glide, return).

## Dev Notes

### What exists today (stories 1.3 to 1.13)

- **The plumbing is already there; this story connects it.** `src/sim/time/hitstop.ts` (`FreezeState` outside `World`, `requestFreeze` keeps the longest, rejects negative / non-finite with `clampInvariant`, `consumeFreeze`), `StepContext.requestFreezeRealMs(ms)` (the sanctioned channel, `createSim.ts`), `Sim.freezeRealMs` / `Sim.consumeFreeze`. **Nothing in the sim calls `requestFreezeRealMs` yet** (only tests inject a system that does).
- `src/sim/time/timeScale.ts` › `setTimeScale(world, ctx, scale)`: clamps to `[MIN_TIME_SCALE (0.05), 1]` with `clampInvariant(…, 'time.scale')`, writes `world.time.scale`, emits `TimeScaleChanged{from, to}` only on a change. `src/sim/time/clock.ts` › `advanceTime`: `time.sim += STEP_MS`, then applies this step's `SetTimeScale` commands. `Sim.timeScale` reads `world.time.scale`.
- `SetTimeScale` is a journaled **debug / test** command (`commands.ts`: « Story 2.1's "forced timeScale" reuses it »), used by the golden `core_basic` scenario, many sim tests and `loop.test.ts`.
- **Client loop** (`src/client/loop.ts`) already does everything the client needs: per running frame, sped-up real dt pays off `sim.freezeRealMs` first (`consumeFreeze`), the rest × `sim.timeScale` goes to the accumulator, the step loop re-checks `sim.freezeRealMs === 0` before **every** step (a hitstop requested by step k stops step k+1), a pending freeze keeps an owed backlog instead of dropping it, render runs every frame, and the time map records `simPerRealMs = freeze ? 0 : timeScale × speed`. `timeScale` is read once per frame: a scale set by a step applies to the next frame's accumulation, which is exact here because the same step also requests a freeze that stops the step loop.
- **Judgement and glide (1.10, 1.11):** `PressThreat` starts Papa's glide (`papa/glide.ts`, sim-time `arriveAt ≤ glideMaxMs` 600 later) whatever the judgement; the threat is **resolved later**, when the press is classified (`classifyPress`: at `Release`, or at `holdMinMs` 400 of holding) — `runThreats` → `resolveThreat` (`threatFsm.ts`) pushes `ResponseResolved{quality: 'perfect' | 'success'}`; failures go through `gagThreat`. So for a tap, slow-mo starts at the release, during the glide (≤ 600 sim ms, entirely inside the 1200 ms hold): « la glissade se fait au ralenti » holds with no glide change.
- **Render clock:** `levelScene.update(world, alpha)` drives every VFX from `world.time.sim + alpha × STEP_MS`, so world VFX slow down with the sim and stop during a freeze. CSS animations (threat pulse, chevron bounce) stay real-time — accepted, not this story's concern.
- **Feel:** `content/feel.json` already has `timing.hitstopMs: 80`, `slowMoPerfect {timeScale 0.3, durationMs 1200}`, `slowMoLastThreat {0.2, 1500}` (schema `slowMo(...)` in `src/content/schemas/feel.ts`, `strictObject`, no defaults: every key written in the file).
- **Feedback:** `content/feedback.json` maps `ResponseResolved` (via the threat's `feedback.success / perfect` cue ids); `FeedbackDirector.handle('TimeScaleChanged', …)` is a no-op (tested). Nothing to change.
- **Snapshots** (`snapshot.ts`): `version: 3`, `worldProblem` validates `time.sim` and `time.scale` (finite numbers) — extend it; `restore` already clears the freeze.

### Decisions pinned by this story

| # | Decision | Why |
|---|---|---|
| D1 | **Hitstop on every successful response, perfect included.** `resolveThreat` requests `hitstopMs` for `success` and `perfect`; a perfect gets the freeze **and** the slow-mo (freeze first, then slowed steps). | FR8 says « hitstop sur réponse réussie »; a perfect is a successful response, and `EXPERIENCE.md` › Journey climax reads « Hitstop, ×0.3 slow-mo ». The epic AC names `success` only as the case it tests. Open point 1 for Geo. |
| D2 | **Slow-mo durations are sim ms.** `durationMs` (hold) and `returnMs` (ramp) count sim time; 1200 sim ms at ×0.3 ≈ 4 s of real time. The schema description that says « real ms » is a bug and is fixed. | The epic AC: « pendant 1200 ms de temps de jeu ». The sim never reads real time, and the whole glide (≤ 600 sim ms) then plays in slow-mo (P3). Open point 2 (the real-time feel is Geo's to judge). |
| D3 | **Return transition:** entry is instant (cut, masked by the hitstop); after the hold, the factor goes from `scale` to 1 over `returnMs` sim ms along **smoothstep** `u²(3 − 2u)`, `u = (t − holdUntil) / returnMs`. `returnMs = 0` → instant. Only `+ − × ÷`, so bit-for-bit deterministic on every platform. The curve is fixed in code (one curve, no enum); `returnMs` is data. | « revient à 1 avec une transition définie dans `feel.json` ». An easing enum is scope Geo has not asked for; adding one later is a schema change, not a redesign. |
| D4 | **State in `World.time`:** `baseScale` (what `SetTimeScale` set, default 1) and `slowMos: SlowMo[]` (`{ source, scale, startedAt, holdUntil, endsAt }`, at most one per source, in start order). `world.time.scale` stays the **effective** scale the loop reads (`Sim.timeScale` unchanged). | The scale changes what the client does and must replay and snapshot like the rest of the game; the freeze stays outside `World` because it is a real-time artefact (already decided in 1.3). |
| D5 | **Overlap rule:** effective scale at `t` = `min(baseScale, slowMoFactorAt(m, t) for every m)`. Re-triggering a source already active: `scale = min(old, new)`, `holdUntil = max(old, new)`, `endsAt = max(old, new)` (and `startedAt` kept). Different sources: independent entries. An entry is removed at the first step where `t ≥ endsAt`. Freezes: longest remaining wins (`hitstop.ts`, unchanged). | The epic: « le facteur le plus lent l'emporte, et la durée la plus longue est conservée ». Per-source timers keep instinct's 4 s ×0.8 (2.9) from turning into 4 s of ×0.3 when it overlaps a perfect, while still honouring « slowest wins, longest kept ». Stories 1.18 and 2.9 only call `startSlowMo` with their source. |
| D6 | **`SetTimeScale` becomes the base scale.** It writes `world.time.baseScale` (same clamp, same invariant name `time.scale`); the effective scale is then recomputed. With no slow-mo, behaviour and events are identical to today (all existing tests stay green unchanged). | Story 2.1's « forcer `timeScale` » keeps working and composes with gameplay slow-mos instead of being overwritten by them. |
| D7 | **The trigger lives in `resolveThreat`** (the owner of the `→ resolved` transition), not in a new system that would read this step's events. Order inside the call: `ResponseResolved` pushed, then `requestFreezeRealMs`, then `startSlowMo` (which may push `TimeScaleChanged`). | One place decides « a response succeeded »; systems never read `ctx.events` to react (project-context: systems never call each other, and the architecture says time effects are decided in the sim). Firmness (1.23) resolves through the same function and gets the same feel for free. |
| D8 | **Snapshot version 4.** `World` gained fields; a version 3 snapshot is refused (nothing persists snapshots yet: journals hold commands only). | The established pattern (1.10 bumped to 3). |
| D9 | **Goldens regenerated on purpose** (`npm run golden:update`): the world hash of every scenario moves (new `World.time` fields); `outlet_parry` also gains `TimeScaleChanged` events. No other event may move. | project-context › Testing Rules: « regenerate the golden journal explicitly and say so in the story ». |
| D10 | **`TimeScaleChanged` is emitted on every change of the effective scale, ramp steps included** (≈ `returnMs / STEP_MS` = 30 events per perfect). No new event type: stories 2.5 (camera) and 2.6 (music) key the start on `ResponseResolved{perfect}` and the end on `timeScale` back to its base. | Keeps the existing contract (« only when the value changes ») honest and the debug timeline (2.1) gets the curve for free. Volume is trivial (the test API log caps at 50 000). |

### World (`src/sim/world.ts`)

```ts
/** What started a slow-mo. Story 1.18 triggers `lastThreat`; story 2.9 adds `instinct`. */
export type SlowMoSource = 'perfect' | 'lastThreat';

/** A slow-mo: `scale` from `startedAt` to `holdUntil`, then a smoothstep back to 1 by `endsAt` (sim ms). */
export interface SlowMo {
  source: SlowMoSource;
  scale: number;
  startedAt: SimMs;
  /** `startedAt + durationMs`; may be off the step grid. */
  holdUntil: SimMs;
  /** `holdUntil + returnMs`; the entry is removed at the first step at or after it. */
  endsAt: SimMs;
}

// World.time
time: {
  sim: SimMs;
  /** The effective `timeScale` the client loop reads: min(baseScale, every slow-mo). Never 0. */
  scale: number;
  /** The scale outside any slow-mo: 1, or what the debug `SetTimeScale` set. */
  baseScale: number;
  /** Active slow-mos, at most one per source, in start order. */
  slowMos: SlowMo[];
};
```

Also export `SlowMo` and `SlowMoSource` from `src/sim/index.ts` (types only), next to `World`. Keep a `SLOW_MO_SOURCES` const array with the same `satisfies` + completeness trick as `THREAT_STATES` (snapshot validation needs the list as data).

### `slowMo.ts` (`src/sim/time/slowMo.ts`)

```ts
/** The feel of one slow-mo (`feel.timing.slowMoPerfect`, `slowMoLastThreat`). */
type SlowMoFeel = Feel['timing']['slowMoPerfect'];

/** Starts (or extends, D5) the slow-mo of `source` at the current sim time, then republishes the scale. */
export function startSlowMo(world: World, ctx: StepContext, source: SlowMoSource, feel: SlowMoFeel): void;

/** The factor of one slow-mo at sim time `t`: `scale` while held, smoothstep to 1 during the return, 1 after. */
export function slowMoFactorAt(slowMo: Readonly<SlowMo>, t: number): number;

/** Drops the slow-mos that ended by now, then publishes min(baseScale, every factor) through `setTimeScale`. */
export function updateTimeScale(world: World, ctx: StepContext): void;
```

- `startSlowMo`: `holdUntil = now + durationMs`, `endsAt = holdUntil + returnMs` (wrap with `asSimMs`); merge into an existing same-source entry (D5) or push a new one; then `updateTimeScale`.
- `slowMoFactorAt`: `t < holdUntil` → `scale`; `t ≥ endsAt` → 1; else `scale + (1 − scale) × s(u)` with `u = (t − holdUntil) / (endsAt − holdUntil)`. Guard `endsAt === holdUntil` (returnMs 0) before dividing.
- `updateTimeScale`: remove ended entries **in place** (index loop + `splice`, or compaction; no `filter` allocation per step), compute the min, call `setTimeScale(world, ctx, min)`. `setTimeScale`'s clamp still guards `[MIN_TIME_SCALE, 1]`; the feel schema already forbids 0 and > 1.
- Float note: the ramp values are not « round » (0.3 + 0.7 × s(u)); that is fine — they are the same on every run and platform, and nothing compares them to literals except tests that compute the expectation with the same formula or check monotonicity and bounds.

### Order inside a step

`applyCommands` → **`advanceTime`** (sim += 10; apply `SetTimeScale` → `baseScale`; **then `updateTimeScale`** at the new `t`) → `runDirector` → `runBaby` → **`runThreats`** (a perfect resolution calls `startSlowMo` → scale 0.3 at this same step, `TimeScaleChanged` after `ResponseResolved`) → `runPapa`. The `SYSTEMS` array and its pinned order test do **not** change: `updateTimeScale` is called from `advanceTime`, not registered as a system.

### Snapshot (`src/sim/snapshot.ts`)

`worldProblem` additionally refuses (with the path as message, like today):
- `world.time.baseScale`: not a finite number in `[MIN_TIME_SCALE, 1]`;
- `world.time.scale`: not in `[MIN_TIME_SCALE, 1]` (today only « finite » is checked);
- `world.time.slowMos`: not an array; an entry that is not an object (`world.time.slowMos[i]`), whose `source` is not in `SLOW_MO_SOURCES` (`.source`), whose `scale` is not finite in `(0, 1]` (`.scale`), whose `startedAt` / `holdUntil` / `endsAt` are not finite or not ordered `startedAt ≤ holdUntil ≤ endsAt` (`.holdUntil`, `.endsAt`); two entries with the same source (`world.time.slowMos`).

### Testing

Follow the established style: Node sim tests with `createSim` + typed commands + `stepN`; express time in sim ms or steps; derive expected numbers from `createTestContent().feel` (no new magic numbers: `loop.test.ts` › « the only magic number of this file » rule).

**slowMo (`src/sim/time/slowMo.test.ts`)**
- `slowMoFactorAt`: before `holdUntil` → `scale`; at `holdUntil` → `scale`; at the ramp middle → `scale + (1 − scale) / 2` (smoothstep(0.5) = 0.5); strictly increasing over the ramp; at and after `endsAt` → 1; `returnMs = 0` → `scale` then 1, no `NaN`.
- `startSlowMo` + `updateTimeScale`: perfect alone → 0.3 immediately (`TimeScaleChanged{from: 1, to: 0.3}`), entry removed and scale exactly 1 at the first step ≥ `endsAt`.
- Overlap (AC 3): same source re-triggered mid-hold → one entry, later `holdUntil`/`endsAt`, `startedAt` kept; re-triggered mid-ramp → back to `scale` at once; `perfect` (0.3, 1200) + `lastThreat` (0.2, 1500) started 500 ms apart → 0.2 while `lastThreat` holds, then its ramp vs `perfect`'s: the min at each step; scale is 1 only after the later `endsAt`; the result is identical when the two starts are swapped in order within the same step (determinism of the min).
- Base scale: `baseScale` 0.5 with no slow-mo → 0.5; with a 0.3 slow-mo → 0.3 then back to 0.5; `baseScale` 0.2 under a 0.3 slow-mo → 0.2 throughout.
- No allocation per step: not asserted by a test (style of the repo), but review the loop.

**threats (`threatSystem.test.ts` or `timeEffects.test.ts`)** — use the existing helpers (`newSim`, `telegraphed`, `runTo`, `only`, `threatOf`) and a system injected with `createSimWithSystems` where a freeze must be observed (`sim.freezeRealMs` after the resolving step):
- perfect parry (press at the window centre, release 50 ms later) → at the resolving step: `ResponseResolved{perfect}`, then `TimeScaleChanged{to: 0.3}`; `sim.freezeRealMs === hitstopMs`; scale stays 0.3 until `t + durationMs`, ramps, is 1 at `t + durationMs + returnMs` (rounded up to the step grid).
- success parry (press in the window, outside the perfect band) → freeze `hitstopMs`, **no** `TimeScaleChanged`, scale 1.
- early gag / late gag / wrong response → no freeze, no scale change.
- `hitstopMs: 0` in a feel override → no freeze (`requestFreeze(0)` is a no-op), the slow-mo still runs.
- the glide under slow-mo: after a perfect, `papa.glide.arriveAt − papa.glide.startedAt` is unchanged by the slow-mo (sim time), and `PapaArrived` happens while `sim.timeScale < 1`.
- AC 4 in the sim: with a feel override `slowMoPerfect.durationMs` long enough to cover the outlet's next cycle (`cooldownMs` + `telegraphDelayMs`, read from the def, not literals), the next `WindowOpened − ThreatTelegraphed` is still `telegraphDelayMs`, the window still closes `windowMs + toleranceMs` after it opens (late gag timing), and `sim.timeScale` was `< 1` at that `WindowOpened`.

**loop (`src/client/loop.test.ts`)** — build a rig on a **real** sim with `createTestLevel([outletEntry(…)])` (the rig today uses an empty level; add a variant, do not change existing cases). Drive it with fake frames of `FRAME_MS`; enqueue the perfect press/release at sim times read from the world (`windowOpenAt` + half the window).
- Hitstop: after the frame whose steps emit `ResponseResolved`, the next frames run **0 steps** until `hitstopMs` of real time has been paid, `render` is still called every frame, then steps resume at `timeScale` 0.3 (≈ 3 steps per 100 ms of real time; assert with the accumulator arithmetic, not a tolerance band).
- AC 4: under a long slow-mo override, real time between the frame that delivered `WindowOpened` and the frame that delivered the window's late `ResponseResolved{fail}` is `(windowMs + toleranceMs) / scale` within one frame plus the hitstop-free path (no hitstop on a gag).
- Speed: at `speed: 4` the 80 ms hitstop takes 20 ms of real frames (sped-up time, the 1.13 review decision); keep that test, add none.

**e2e (`tests/e2e/timeEffects.spec.ts`, chromium and webkit)** — deterministic through `__PP__` only:
1. `ppFreeze(true)`, `ppLoadLevel('salon_crawler', 42)`, `ppAdvance` until the outlet is `windowOpen` (read `ppState`), `ppSend` a `PressThreat` at `windowOpenAt + windowMs / 2` and a `Release` 50 ms later (sim times from `ppState().threats[0]` and the def / feel read in the page or from `content/`), `ppAdvance` a few steps → `ppState().time.scale` equals `slowMoPerfect.timeScale` and `ppEvents()` holds `ResponseResolved{perfect}` followed by `TimeScaleChanged`.
2. `ppAdvance` past `durationMs + returnMs` → `time.scale === 1`, `time.slowMos` empty.
3. `collectProblems(page)` is empty. No screenshot.
(`advance` ignores and does not consume the freeze, D5 of 1.13, so the hitstop itself is covered by the loop test, not here.)

### Regression traps

- **Goldens:** `tests/golden/golden.test.ts` and `outletParry.test.ts` compare hashes and event sequences: regenerate (T7), never loosen. `core_basic` exercises `SetTimeScale` heavily: its events must be identical (D6).
- **`timeScale.test.ts` existing cases** assert exact event lists for `SetTimeScale`: with no slow-mo running, `updateTimeScale` must produce exactly the old events (one `TimeScaleChanged` per real change, none when the value is the same).
- **`createSim.test.ts` / `determinism.test.ts` / `snapshot.test.ts`** inject systems that push a fake `TimeScaleChanged` or call `requestFreezeRealMs`: they keep working; only snapshot tests that assert `version: 3` or build a world by hand need the new fields / version.
- **e2e timing:** after a perfect the real game is ~4–5 s slower in real time. `threat.spec.ts` resolves at most one response per test and waits on mirrors with derived timeouts (fine); `autoplay.spec.ts` compares world hashes with the CLI at a sim time `T` (unaffected: slow-mo changes how fast, not what) and its `FIRST_RESPONSE_TIMEOUT_MS` targets the first response (fine). If a spec times out, raise its bound from the feel (`durationMs / timeScale + returnMs …`), never with a bare literal.
- **Bots:** `perfectBot` / `humanBot` plan in sim time; nothing changes. `npm run sim` reports must keep the same quality distribution.
- **`classifyPress` resolves at the release:** do not move the slow-mo start to the press (D7 / P3 say « au jugement »).

### Previous story intelligence (1.10 to 1.13 and their reviews)

- Reviews hunt for: docs that disagree with code (fix comments you touch — e.g. the feel schema's « real ms »), unguarded edge values (`0`, `NaN`, `Infinity`: `returnMs = 0` must not divide by zero), allocation in per-step paths, and tests asserting with tolerance where arithmetic is exact.
- 1.13 review decided **the hitstop is paid in sped-up time** (`dtSpedMs`) at `?speed=4`, with a test; do not revisit it.
- 1.13 deferred: « frozen-frame interpolation alpha » (screenshots only after `loadLevel`) — the new e2e takes no screenshot.
- 1.12 / 1.13: `SetTimeScale` is the only time command; `__PP__.send` takes any `SimCommand` with optional `t`.
- Pattern for data-as-list + completeness proof: `SIM_EVENT_TYPES` / `THREAT_STATES` (copy it for `SLOW_MO_SOURCES`).
- Commit message style: « Story 1.14 : … » (French), one implementation commit, then review fixes.

### Architecture guardrails and traps

- `src/sim` never reads real time: hitstop is **requested** in real ms but never measured in the sim; slow-mo is measured in sim ms only.
- Time effects are decided in the sim from `feel.json`; the `FeedbackDirector` and `feedback.json` must not touch time (architecture › Retours multimodaux).
- Reduced motion (2.10) must never change hitstop or slow-mo: nothing in this story reads a setting.
- Never set `timeScale` to 0 for a freeze or a pause (`MIN_TIME_SCALE`); the freeze is the only « 0 ».
- No `Math.random`, `Date`, `performance` in `src/sim`; `import type { Feel } from '@content/schemas/feel'` is allowed (types).
- Units in names: `durationMs`, `returnMs`, `holdUntil` / `endsAt` (`…At`/`…Until` are sim instants; no `…AtReal` here).

### Project Structure Notes

- New: `src/sim/time/slowMo.ts`, `src/sim/time/slowMo.test.ts`, `tests/e2e/timeEffects.spec.ts`.
- Modified: `src/sim/world.ts`, `src/sim/index.ts`, `src/sim/time/clock.ts`, `src/sim/time/timeScale.test.ts`, `src/sim/threats/threatFsm.ts`, `src/sim/threats/threatSystem.test.ts`, `src/sim/snapshot.ts`, `src/sim/snapshot.test.ts`, `src/content/schemas/feel.ts`, `content/feel.json`, `content/_schemas/feel.schema.json` (generated), `tests/support/testFeel.json`, `tests/content/feelSchema.test.ts`, `tests/content/feelMerge.test.ts`, `src/client/loop.test.ts`, `tests/golden/journals/*.expected.json` (generated), `_bmad-output/project-context.md`, `deferred-work.md`.
- Matches the architecture tree: `src/sim/time/` = `clock.ts`, `timeScale.ts`, `hitstop.ts` (+ `slowMo.ts`, the slow-mo half of « échelle de temps »).
- No change expected in `src/client/**` except tests, none in `src/bots/**`, `src/debug/**`, `tools/**`.

### Project Context Rules

- Golden rule: the AI writes and tests; Geo tunes. Every number in `feel.json` (`returnMs` included).
- Layer rules: `sim` imports `shared` and `content` types only; cross-layer imports via aliases; relative imports inside `src/sim`.
- `strict` + `erasableSyntaxOnly`: string-literal unions (`SlowMoSource`), no enum.
- No `console.*`; the sim emits events and `InvariantViolated`, never logs.
- `World` plain serializable data; systems in the fixed order; never call one system from another (`updateTimeScale` is a helper called by `advanceTime`, `startSlowMo` a helper called by an FSM transition — both like `setTimeScale` today).
- Tests: colocated units, `describe/it/expect` from `vitest`, sim tests in Node, `src/sim` coverage ≥ 90 % (`npm run test:coverage`).
- `VITE_DEBUG_ALLOWED` trap before `dev` / `e2e` / `ci`.

### Deferred by this story (add to `deferred-work.md`)

- **`slowMoLastThreat` exists but nothing triggers it**: story 1.18 calls `startSlowMo(world, ctx, 'lastThreat', feel.timing.slowMoLastThreat)` on the last threat of a wave.
- **Instinct (2.9)** adds `'instinct'` to `SlowMoSource` (and `SLOW_MO_SOURCES`), and its window bonus separately; the overlap test of 2.9 builds on `slowMo.test.ts`.
- **Camera and music under slow-mo** (2.5, 2.6): start on `ResponseResolved{perfect}`, end when `timeScale` returns to its base (D10).
- **Easing curve is fixed (smoothstep)**: an easing key in `feel.json` if Geo asks for another shape.

### Open points for Geo (do not block the dev)

1. **Hitstop on a perfect too?** D1 gives a perfect the 80 ms freeze **and** the slow-mo (FR8 « réponse réussie », journey climax « Hitstop, ×0.3 slow-mo »). If you want the perfect to cut straight to slow-mo, it is one condition in `resolveThreat`.
2. **1.2 s of game time ≈ 4 s of real time.** The epic says « 1200 ms de temps de jeu » (D2), which makes the whole glide play in slow-mo but stretches a perfect to ~4 s on screen. Tune `slowMoPerfect.durationMs` (or ask for real-time durations) after playing.
3. **`returnMs: 300`** (sim ms, ≈ 0.5 s real on the way back from ×0.3) is a guess: tune in `feel.json`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md › Story 1.14 « Hitstop et ralentis »; Story 1.18 (last-threat slow-mo, « règle de chevauchement de la story 1.14 »); Story 2.5; Story 2.6; Story 2.9; Story 2.10]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md › timing table (« Hitstop sur réponse réussie 80 ms », « Ralenti sur réponse parfaite ×0,3 pendant 1,2 s », « Temps de référence : temps de jeu »)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md › Boucle de jeu et modèle de temps; ADR-002; P3 « Jugement à l'appui, chorégraphie ensuite »; Retours multimodaux; Contrats d'API (`Sim.timeScale`, `Sim.freezeRealMs`)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md › HUD « Slow-mo (perfect, wave end): The HUD stays »; Reduced motion « Hitstop, slow-mo: Unchanged »]
- [Source: _bmad-output/project-context.md › Time model, Testing Rules]
- [Source: src/sim/time/*.ts, src/sim/threats/threatFsm.ts, src/client/loop.ts, src/sim/snapshot.ts, content/feel.json]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5-5

### Debug Log References

- **Baseline (T0)**, `(unset VITE_DEBUG_ALLOWED; npm run ci)` on the untouched tree (`VITE_DEBUG_ALLOWED=false` was exported in the shell): 150 test files, 2093 unit tests, 172 e2e (chromium + webkit), green.
- **Final**, same command: 152 test files, 2130 unit tests (+37), 174 e2e (+2, `timeEffects.spec.ts`), green; `src/sim` coverage 97.7 % statements / 100 % functions.
- `drainEvents()` returns a reused array that the next call empties: the new sim tests copy it (`[...sim.drainEvents()]`) before stepping again.
- `src/client/loop.ts` was **not** touched (T5): the loop already pays the freeze first and re-checks it before every step; the new tests prove it against the real sim.
- Mutation check: with the two time-effect lines of `resolveThreat` commented out, 10 of the new or updated tests fail (loop, `threatFsm`, `timeEffects`); restored afterwards.
- **By hand (T8)**, headless chromium on `npm run dev`, `/?autoplay=perfect&seed=42` (real time, speed 1), sampling `__PP__.state()` every frame: after the perfect parry, sim time stood still for ~65 to 80 ms (the hitstop, at frame granularity), then `timeScale` was 0.3 (measured 0.301 sim ms per real ms mid slow-mo), and the whole slow-mo (1200 ms hold + 300 ms return) took ~4.6 s of real time for 1500 sim ms, ending exactly on scale 1. I could not judge the look and feel itself: that is Geo's to play (open points 1 to 3).

### Completion Notes List

- **Feel (T1):** `slowMo(...)` gains `returnMs` (sim ms, 0 = instant); `durationMs` is documented as sim ms (it said real ms) and `hitstopMs` as a real-time freeze on a successful or perfect response. `content/feel.json` and `tests/support/testFeel.json` carry `returnMs: 300` for both slow-mos (`[ASSUMPTION]`, open point 3); `content/_schemas/feel.schema.json` regenerated. Schema tests: negative and missing `returnMs`; merge test: a partial `returnMs` override keeps its siblings.
- **Slow-mo state (T2):** `World.time` gains `baseScale` and `slowMos: SlowMo[]` (`SlowMoSource`, `SLOW_MO_SOURCES` with its completeness proof, exported from `@sim`). New `src/sim/time/slowMo.ts`: `startSlowMo` (new entry, or merge into the running one of the same source: slower scale, later hold and end, `startedAt` kept), `slowMoFactorAt` (hold, smoothstep return, `returnMs = 0` guarded), `updateTimeScale` (in-place compaction of ended entries, then `setTimeScale(min(baseScale, factors))`, which stays the single writer of `world.time.scale` and the single emitter of `TimeScaleChanged`). `advanceTime` now writes `SetTimeScale` into `baseScale` (same clamp and `time.scale` invariant) and calls `updateTimeScale` once per step; `SYSTEMS` is unchanged. Tests: `slowMo.test.ts` (factor curve, lifecycle, one event per change, same-source re-trigger mid-hold and mid-return, two sources incl. the `perfect` + `lastThreat` overlap checked step by step, the same result whichever starts first, base scale cases) and `timeScale.test.ts` (the four old cases untouched; `SetTimeScale` 0.5 under a 0.3 slow-mo returns to 0.5, not 1).
- **Trigger (T3):** `resolveThreat` requests `hitstopMs` after pushing `ResponseResolved` and starts the `perfect` slow-mo for a perfect; `gagThreat` requests nothing. Tests in `threatFsm.test.ts` (calls and order) and the new `src/sim/threats/timeEffects.test.ts`: perfect (event order, freeze, hold / return / 1 at the end on the step grid), success (freeze, no scale change), early / late / wrong-response gags (nothing), `hitstopMs: 0` (no freeze, slow-mo still runs), the glide (sim-time arrival, `PapaArrived` under scale < 1), and AC 4 in the sim (the next window opens `telegraphDelayMs` after its telegraph and closes `windowMs + toleranceMs` later, under a slow-mo long enough to cover the cycle).
- **Snapshot (T4):** `version: 4`; `worldProblem` validates `time.scale` and `time.baseScale` in `[MIN_TIME_SCALE, 1]` and every `time.slowMos` field with its path (non-array, non-object entry, unknown source, scale outside `(0, 1]`, non-finite or unordered `startedAt ≤ holdUntil ≤ endsAt`, duplicated source). Tests: a snapshot taken while holding and while returning restores to the uninterrupted world hash and events; each malformed field is refused; version 3 is refused.
- **Loop (T5):** a new real-sim rig (outlet level) in `loop.test.ts`: after a perfect response the next 8 frames of 10 ms run 0 steps while `render` still runs each frame (the freeze drains by exactly one frame each), then 10 frames give `floor(10 × 10 × 0.3 / 10) = 3` steps; no freeze and no scale change after a gag; under a slow-mo covering the next cycle, the real time from `WindowOpened` to the late `ResponseResolved{fail}` is `simMs / timeScale` within one frame. The `createSimDouble` comment is updated; existing cases unchanged.
- **E2E (T6):** `tests/e2e/timeEffects.spec.ts` (chromium and webkit): frozen level, perfect parry sent through `__PP__` at sim times read from the world, `time.scale` equals `slowMoPerfect.timeScale`, `ResponseResolved{perfect}` then `TimeScaleChanged`, then after `durationMs + returnMs` `time.scale === 1` and `slowMos` empty; `collectProblems` empty, no screenshot. The screenshot references did not change, and `threat`, `autoplay` and `tapLatency` specs stay green.
- **Goldens (T7, D9), regenerated on purpose with `npm run golden:update`:** `core_basic`, `papa_walk`, `baby_wander`: only `worldHash` changes (new `World.time` fields); their event types are identical (`core_basic` keeps its 5 `TimeScaleChanged`). `outlet_parry`: `worldHash` and `eventsHash` change; the event types are identical once `TimeScaleChanged` is removed, and 62 `TimeScaleChanged` are added = 2 perfect parries × (1 entry to 0.3 right after `ResponseResolved` + 30 ramp steps of `returnMs / STEP_MS` back to 1). **One thing the story did not announce:** the four journals' `feelHash` also changed (`11bc9630ab0d27` → `129be1216e2b4c`), because `tests/support/testFeel.json` gained `returnMs`; the journal bodies are otherwise identical. `npm run sim -- --bot perfect --level salon_crawler --seed 42 --runs 3`: the per-threat quality distribution is identical to the baseline (72 perfect, 0 success, 0 fail; only the hashes differ); `npm run sim:replay` on a recorded journal exits 0.
- **Docs (T8):** `project-context.md` › `timeScale` bullet (effective scale rule); `deferred-work.md` gets the story's deferred items plus the real-time-feel and CSS-animation notes.
- **Decisions held as written:** D1 to D10, unchanged. Nothing outside the story's list moved: no new command or event type, no change to `feedback.json`, the `FeedbackDirector`, the HUD, the camera, bots, tools or `src/client` (except `loop.test.ts`).

### File List

**New**
- `src/sim/time/slowMo.ts`
- `src/sim/time/slowMo.test.ts`
- `src/sim/threats/timeEffects.test.ts`
- `tests/e2e/timeEffects.spec.ts`

**Modified**
- `src/content/schemas/feel.ts`
- `content/feel.json`
- `content/_schemas/feel.schema.json` (generated)
- `tests/support/testFeel.json`
- `tests/content/feelSchema.test.ts`
- `tests/content/feelMerge.test.ts`
- `src/sim/world.ts`
- `src/sim/index.ts`
- `src/sim/time/clock.ts`
- `src/sim/time/timeScale.test.ts`
- `src/sim/threats/threatFsm.ts`
- `src/sim/threats/threatFsm.test.ts`
- `src/sim/snapshot.ts`
- `src/sim/snapshot.test.ts`
- `src/client/loop.test.ts`
- `tests/golden/journals/core_basic.json`, `core_basic.expected.json`
- `tests/golden/journals/papa_walk.json`, `papa_walk.expected.json`
- `tests/golden/journals/baby_wander.json`, `baby_wander.expected.json`
- `tests/golden/journals/outlet_parry.json`, `outlet_parry.expected.json`
- `_bmad-output/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-14-hitstop-et-ralentis.md` (this file)

### Review Findings

Code review of 2026-10-27 (Blind Hunter, Edge Case Hunter, Acceptance Auditor): 2 `decision_needed` (both resolved as « keep », so dismissed), 7 `patch`, 4 `defer`, 12 dismissed as noise.

- [x] [Review][Decision] (resolved 2026-10-27: option 1, keep the cut; dismissed, no code change) Re-triggering a slow-mo during its return phase snaps the scale back down — `startSlowMo` merges in place (`scale = min`, `holdUntil = max`, `endsAt = max`), so a second perfect landing at `holdUntil <= t < endsAt` jumps from e.g. 0.65 (mid-return) straight back to 0.3, with one `TimeScaleChanged` 0.65 → 0.3. This follows D5 literally and is covered by the « re-trigger mid-return » test, but the spec never says whether a jump is wanted. Options: (1) keep the cut (a new perfect re-enters slow-mo as sharply as the first one, masked by the 80 ms hitstop); (2) continue from the current factor (smooth, needs a `fromScale` or a restart of the ramp). Also: with different `returnMs` per trigger the merged `holdUntil` / `endsAt` match neither trigger's ramp. [src/sim/time/slowMo.ts:35-42]
- [x] [Review][Decision] (resolved 2026-10-27: option 1, keep one event per step; dismissed, no code change) One `TimeScaleChanged` per step during every return ramp — the factor is a pure function of sim time yet is published as an event on each 10 ms step: 30 events per perfect (62 added to `outlet_parry.expected.json`), `returnMs: 2000` would mean 200. Stories 2.5 / 2.6 (camera, music) will consume it and the golden diffs are noisy. AC7 forbids a new event type, so the options are: (1) keep it (simple, one source of truth, consumers read `timeScale`); (2) publish only when the change exceeds a `feel` threshold, or only the entry and the end of the ramp, and let the client read `sim.timeScale` each frame. [src/sim/time/timeScale.ts:11-12, tests/golden/journals/outlet_parry.expected.json]
- [x] [Review][Patch] `feel.timing.slow*.timeScale` accepts values below `MIN_TIME_SCALE` — the schema uses `gt(0).max(1)` but `setTimeScale` clamps to `[0.05, 1]` (an `InvariantViolated` on every step of the slow-mo in production, a throw in dev/test), and the snapshot rejects it too (spec said `(0, 1]`, code says `[MIN_TIME_SCALE, 1]`). `content:check` passes with `0.01`. Use `z.number().min(MIN_TIME_SCALE).max(1)` for the slow-mo scales (from `@shared/constants`), regenerate the JSON schemas, add a schema test at `0.01`. [src/content/schemas/feel.ts:19]
- [x] [Review][Patch] AC4 and AC2 tests have no control run — the window test only asserts absolute values (`gag.t === second.t + gridCeil(windowMs + toleranceMs) + STEP_MS`, the `+ STEP_MS` is unexplained) and the glide test only asserts `arriveAt - startedAt <= glideMaxMs`. Run the same scenario at scale 1 and compare the sim durations (window length, glide `arriveAt - startedAt`), and comment or derive the `STEP_MS` slack. [src/sim/threats/timeEffects.test.ts]
- [x] [Review][Patch] Weak snapshot tests — `expect(resolvedAt).toBeGreaterThan(0)` is only there to use the variable; the `broken` table discards its labels (`for (const [, mutate, message]`), so a failure does not name its case; non-finite `holdUntil` and `endsAt` are not covered (only `startedAt`) while the notes say « each malformed field is refused »; add `scale` 0.01 (below `MIN_TIME_SCALE`) once the schema bound is fixed. [src/sim/snapshot.test.ts]
- [x] [Review][Patch] Inaccurate comments in `slowMo.ts` — the `smoothstep` comment says « only + − × » but `slowMoFactorAt` divides just before (IEEE division is deterministic, say that); the `SlowMo.endsAt` comment (hold « until holdUntil, included ») disagrees with `returnMs = 0` where `t === holdUntil` already returns 1: state one edge rule in both places. [src/sim/time/slowMo.ts:11-13,20-26, src/sim/world.ts]
- [x] [Review][Patch] Magic numbers in the new tests — `+ 3000`, `+ 2000 + 5000`, the `50` release offsets (loop, snapshot, timeEffects), `30`, `200`, `5`; `RELEASE_AFTER_MS` exists only in the e2e spec. Derive from the feel or share one named constant in `tests/support`, as the story's own Testing section asks. [src/sim/threats/timeEffects.test.ts, src/sim/snapshot.test.ts, src/client/loop.test.ts]
- [x] [Review][Patch] e2e `timeEffects.spec.ts` — the header says sim times come from « the live feel » but the spec reads `content/feel.json` from disk; the order check is `indexOf(TimeScaleChanged) > indexOf(ResponseResolved)` (AC T6 asks for « followed by » it: assert the neighbour); `ppEvents(page)` is called twice, check it does not drain. [tests/e2e/timeEffects.spec.ts]
- [x] [Review][Patch] `deferred-work.md` contradicts itself — « Slow-mo duration unit… Story 1.14 decides » (§ story 1.3) and « Glide start under slow-mo or hitstop… story 1.14 decides whether the client must predict the glide » (§ story 1.11) now read as pending. Mark both as resolved by 1.14 (sim ms, D2; the glide plays out under the slow-mo, no client prediction). [_bmad-output/implementation-artifacts/deferred-work.md:32,183]
- [x] [Review][Defer] Snapshot validation does not cross-check the time slice (`scale` vs `min(baseScale, factors at sim)`, `startedAt <= sim`, no entry with `endsAt <= sim`) [src/sim/snapshot.ts:~252-280] — deferred, hardening for hand-edited snapshots; self-produced ones are consistent and the next `advanceTime` republishes
- [x] [Review][Defer] `loop.advance(steps)` never consumes `sim.freezeRealMs` [src/client/loop.ts:218-226] — deferred, debug stepping only; after a perfect stepped with `advance`, the next real frames spend up to 80 ms doing nothing
- [x] [Review][Defer] Slow-mo scale is read once per frame (`accumulatorMs += dtSpedMs * sim.timeScale`) [src/client/loop.ts:~164] — deferred, only visible after a frame hitch (the n−k remaining catch-up steps of that frame run unscaled); negligible at 60 fps
- [x] [Review][Defer] No upper bound on `hitstopMs`, `durationMs`, `returnMs` in `FeelSchema` [src/content/schemas/feel.ts] — deferred, a typo (`1e9`) freezes the client or makes `endsAt` infinite; needs bounds chosen with Geo for all timing keys, not just these three

## Change Log

- 2026-10-27: Story 1.14 created (ready-for-dev).
- 2026-10-27: Story 1.14 implemented: hitstop on every successful response, perfect slow-mo with a smoothstep return (`slowMo.ts`, `World.time.baseScale` / `slowMos`), snapshot version 4, goldens regenerated on purpose (D9), loop and e2e proofs. Status → review.
- 2026-10-27: Code review of story 1.14: 7 patches applied (slow-mo scale bound in `FeelSchema`, control runs for the window and glide tests, snapshot test fixes, comments, shared test constants in `tests/support/timeEffects.ts`, e2e spec, stale deferred items), 2 decisions kept as is, 4 deferred. `npm run ci` green. Status → done.
