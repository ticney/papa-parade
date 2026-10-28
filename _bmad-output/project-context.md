---
project_name: 'papa-parade'
user_name: 'Geo'
date: '2026-10-26'
sections_completed:
  ['technology_stack', 'engine_rules', 'performance_rules', 'organization_rules', 'testing_rules', 'platform_rules', 'anti_patterns']
status: 'complete'
rule_count: 101
optimized_for_llm: true
existing_patterns_found: 11
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing game code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

Pinned versions (verified on npm 2026-10-26). Do NOT upgrade or swap without an architecture change.

- **Runtime:** `three@0.186.1` (r186, `WebGLRenderer` only — no WebGPU before E7), `@dimforge/rapier3d-deterministic-compat@0.21.0` (the *deterministic* build — never `@dimforge/rapier3d` or `-compat` non-deterministic), `zod@4.6.7` (Zod 4 API: `z.toJSONSchema`, not `zod-to-json-schema`).
- **Dev:** `typescript@7.0.2` (native compiler; `tsc` is typecheck only — Vite transpiles), `vite@8.3.5`, `vitest@5.0.5`, `@playwright/test@1.64.1` (chromium + webkit), `@biomejs/biome@2.6.3`, `tweakpane@4.0.5`, `tsx@4.23.15`, `@types/three@0.186.0`, `gltfpack@1.3.0`.
- **Mobile (E8 only):** `@capacitor/core|cli|ios|android@8.5.3`, `@capacitor/haptics@8.0.2`, `@capacitor/app@8.1.2`, `@capacitor/preferences@8.0.1`. Do not add Capacitor deps before E8 (haptics via `navigator.vibrate` until then).
- **Toolchain:** Node 25.8.1 (Vite 8 needs ≥ 22.12), Blender 5.2.3 LTS (driven via Blender MCP).
- **Not used — do not introduce:** ESLint/typescript-eslint (incompatible with TS 7 → Biome), Prettier, React/R3F or any UI framework, Howler (unmaintained), any ECS library, any state-management lib, UUID libs.
- **TS config:** `strict` + `erasableSyntaxOnly` → no `enum`, no `namespace`, no constructor parameter properties. Import aliases: `@shared`, `@content`, `@sim`, `@bots`, `@client`, `@platform`, `@debug` (resolved by `tsconfig.json`, `vite.config.ts`/Vitest, and `tsx` for `tools/`).
- **Language:** code, identifiers, comments and this file in English; GDD and architecture docs are in French (GDD = source of truth for game rules, `_bmad-output/planning-artifacts/game-architecture.md` = source of truth for technical decisions).

## Critical Implementation Rules

### Engine-Specific Rules

**Simulation core (`src/sim`) — pure, deterministic, headless**
- Fixed step `STEP_MS = 10` of *sim time*; client loop = rAF + accumulator, max `MAX_STEPS_PER_FRAME = 10`, render interpolated with `alpha`.
- `timeScale` (slow-mo ×0.3 perfect, ×0.2 last threat, ×0.8 instinct) changes how many steps run per real second — never the step size. Every step is always 10 ms of `simTime`. Effective scale = min(base scale set by `SetTimeScale`, every active slow-mo); slow-mos are `World.time.slowMos`, one per source, see `src/sim/time/slowMo.ts`.
- Hitstop is a *real-time freeze*: sim sets `freezeRealMs`, client loop consumes it (no steps, render keeps going). Sim never reads real time; in headless, freeze is a no-op.
- Pause = loop stops stepping; resume after a 3 s real-time countdown. Never "pause" by setting `timeScale = 0`.
- `World` is plain serializable data: no classes, functions, Maps with object keys, or Three.js refs. Systems are `(world, ctx) => void` run in the fixed order in `step.ts` (commands → time → director → baby → threats → papa → physics → gauges → instinct → scoring → flow). Systems never call each other; they read/write `World` and push `SimEvent`s to `ctx.events`.
- The wave director (`sim/director`) picks the next threat from `world.rng` among the idle threats of the waves started so far (waves are cumulative); `World.flow` ends the level at the level's `durationMs` (`LevelEnded`), after which a step runs only `applyCommands` and `advanceTime` (`ENDED_SYSTEMS`) so the clock still advances. The last success of a closed wave also starts the `lastThreat` slow-mo (`isLastOfWave`). The level file holds `variant`, `durationMs`, `waves[]` and `feelOverrides` (merged by the client and the CLI before `createSim`).
- Randomness only from `world.rng` (seeded sfc32). IDs only from `world.nextId++`.
- State machines: `state` is a string-literal union + `enteredAt` (sim time). Change state only via `enter…State()`, which emits the event. Measure durations as `world.time.sim - enteredAt`, never frame counters.
- Rapier lives beside `World` behind `PhysicsPort`; only `physics/rapierPhysics.ts` imports Rapier. Rapier = free props only; papa and baby are kinematic on the nav grid. Gameplay consequences come from contact events filtered by impulse threshold. Props are mirrored every step into `World.props` (poses, `isBroken`, `isOnFloor`) and `World.mess`; the Rapier state rides in `SimSnapshot.physics` (base64); `Sim.dispose()` frees it; the room is closed (floor, walls, ceiling) and a push is clamped to `feel.physics.maxPushImpulseNs`. Sim never loads `.glb` — it reads `<level>.geometry.json`.

**Time & input judgement (ADR-002/003/010)**
- Timing windows are in **sim time** (slow-mo stretches them). Calibration offset is applied in **real time**, then converted via `client/timeMap.ts` (2 s ring buffer of `(realTime, simTime)` pairs; older timestamps clamp with a `warn`).
- Judge on the *press* timestamp: `event.timeStamp - calibration.visualOffsetMs` → `timeMap.realToSim()`. Never judge at `step()` time or on papa's arrival. Papa's glide (≤ `glideMaxMs` 600) is choreography only; the result is known before he arrives.
- Release < `holdMinMs` (400) = Parry, ≥ 400 = Firmness; decided on release or at 400 ms held. No other threshold (`tapMaxMs` is unused).
- Keyboard / gamepad targeting (story 1.17): the client picks the target, never the sim. `client/input/autoTarget.ts` takes the threat whose window closes first (`windowOpenAt + responseWindow.windowMs`, ties to the lower id) inside the cone (`feel.input.autoTargetConeDeg`) around the held move direction from Papa, falling back to the most urgent overall. Space / A with no threat active sends `TapObject{objectId}` for the nearest of `level.objects` within `feel.input.contextReachM`; the sim walks Papa to its anchor and emits `ObjectTapped`. A pad that goes away is a UI flag plus a pause (`requestPause('gamepadDisconnected')`), never a new pause reason, and never blocks a resume.
- Effective window = base × difficulty tier × fatigue mod × instinct mod, then ± hidden tolerance — fixed order, implemented only in `sim/timing/effectiveWindow.ts`.
- Early press follows `feel.earlyPress` (`'fail'` default → gag; `'guard'` → no judgement). Exception: `wait` threats always gag on early press.
- "Do nothing" / "Wait" responses are judged on the *absence* of commands **targeting that threatId** — commands on other threats/floor/objects must not trigger a fail. `perfect` exists for `wait`, not for `nothing`.
- The sim only receives typed, timestamped `SimCommand`s (`PressThreat`, `Release`, `TapFloor`, `TapObject`, `Swipe`, `SetFeel`…). Every command targets one explicit `threatId`; target selection (hit-test priority threat > object > floor, auto-target for keyboard/gamepad) happens in the client — the sim never guesses.

**Content & feel**
- No GDD number hard-coded anywhere. Tunables live in `content/feel.json` (per-level `feelOverrides`), content in `content/**.json`, all validated by Zod schemas in `src/content/schemas/` (types via `z.infer` — don't hand-write duplicate types).
- Only `loadContent()` reads content JSON; the sim gets a `ContentBundle` in `createSim()` and the effective `Feel` in `ctx.feel`. Never `import x from '../../content/…json'`.
- `null` in a threat def (e.g. `windowMs: null`) means "use the `feel.json` default".
- Live tuning goes through the `SetFeel{patch, t}` command (journaled), never by mutating `ctx.feel` directly.
- New threat = new JSON (+ maybe a gag), never a new class. Cross-references (threat→anchor, threat→feedback key, gag ids) must pass `content:check`.
- A gag's sim consequences (near miss, pushed prop) live in `sim/threats/gags.ts` (`applyGag`, one entry per `GagId`); its presentation in `client/render/gags.ts` (`GAG_PRESENTATIONS`); a threat's marker glyph is its def's `icon` (`THREAT_ICONS`, one glyph per entry in `threatMarkers.ts`).

**Feedback, rendering, UI**
- Sim emits domain events (PascalCase past tense, `type` discriminant, `t` in sim time). Client drains them after each step → `FeedbackDirector` → `content/feedback.json`. Every entry with `audio` MUST also have `visual` and `haptic`. Time-altering effects (hitstop, slow-mo) are decided in the sim, not in feedback.
- Response sound + haptic fire at judgement; final pose animation plays at papa's arrival (`arriveAt`).
- Rendering: `MeshToonMaterial` (3-tone ramp) + inverted-hull outlines; no heavy post-processing. Views are reconciled from `World` each frame by a `ViewRegistry` with pools.
- UI is vanilla DOM + CSS (`pp-` prefixed kebab-case classes); world-anchored labels via `CSS2DRenderer`. No WebGL UI, no framework.
- **UX spec is the source of truth for the interface:** `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md` (tokens, components) and `EXPERIENCE.md` (flows, states, strings, inputs, accessibility). `tokens.css` mirrors the DESIGN.md frontmatter 1:1 (test-enforced); never hard-code a colour, size or UI string — strings live in `content/strings.fr.json` and go through `t(key)`. Reduced motion is client-only: it must never change sim timing (hitstop, slow-mo, windows).
- Audio: hand-rolled Web Audio (buses music/sfx/voice/ui, pre-decoded buffers, unlock on first tap). The baby's babble must loop continuously while `baby.babbling` — its stop *is* the silence telegraph.

### Performance Rules

- **Targets:** 60 FPS stable on iPhone 12 / 2021 Android over a full 5-min level; frame ≤ 16.6 ms with sim ≤ 2 ms (up to 10 steps) and render ≤ 10 ms; tap → visual feedback ≤ 50 ms.
- **Zero allocation in hot paths** (rAF loop, `sim.step()`, systems, view `update`): reuse scratch vectors, no closures/arrays/object literals per frame, no `new Mesh`/`new Vector3` outside pools. `drainEvents()` must not allocate a new array per frame either.
- **Input handlers do almost nothing:** `pointerdown` → timestamp, hit-test, enqueue command, trigger highlight. Visual feedback (highlight + glide start) must appear on the next frame — never wait for the next sim step or papa's arrival.
- **Render budgets:** ≤ 100 draw calls (instance identical props, static furniture merged at export), ≤ 100k on-screen triangles, shared materials, one 256 px palette texture or vertex colors, no texture > 1024 px, blob shadows only (no shadow maps), outlines only on characters / active threats / salient props.
- **DPR:** `min(devicePixelRatio, 2)`, stepping down 2 → 1.5 → 1 if mean frame time > 18 ms for 2 s.
- **Loading:** whole level (`.glb` + decoded audio) preloaded behind the loading screen; nothing loads during play. Level payload ≤ 3 MB compressed (< 5 s on 4G); memory ≤ 300 MB JS + GPU.
- **Logging in hot paths:** nothing above `debug`, and guard expensive formatting with `if (log.enabled('debug'))`.
- `renderer.info` is shown in the debug overlay; perf regressions are caught by `tests/e2e/perf.spec.ts` (bot `human`, full level, fails if p95 frame > 20 ms).

### Code Organization Rules

**Layers (top-level of `src/`) and allowed imports — enforced by Biome `noRestrictedImports` + `tests/architecture/layerBoundaries.test.ts`:**

| Layer | May import | Must never import |
|---|---|---|
| `shared` | std lib only | any other layer |
| `content` | `shared`, `zod` | `sim`, `client`, `platform`, `debug`, `three` |
| `sim` | `shared`, `content` (types + bundle passed in), Rapier (only in `physics/rapierPhysics.ts`) | `three`, `@capacitor/*`, `client`, `platform`, `debug`, `bots`; globals `window`, `document`, `performance`, `Date`, `setTimeout`, `requestAnimationFrame`, `localStorage`, `Math.random` |
| `bots` | `sim` public API, `shared` | `client`, `platform`, `three` |
| `platform` | `shared`, `@capacitor/*` | `sim`, `client`, `three` |
| `client` | `@sim` (= `src/sim/index.ts` only), `content`, `shared`, `platform` interface, `three` | `debug` (except guarded dynamic `import()` in `boot.ts`), `bots` (except autoplay, dynamic import) |
| `debug` | anything | — nobody imports it statically |
| `tools/` | anything, Node only | — never imported by `src/` |

- Inside layers, organize by game domain (`sim/threats`, `sim/baby`, `client/input`…); follow the tree in the architecture doc ("Arborescence") — don't invent new top-level folders.
- `client/boot.ts` is the single composition root: dependencies are injected explicitly; no singletons or service locators (only exception: `log`).
- Factories are `create<Name>` and the file is named after its main export (`waveDirector.ts` → `createWaveDirector`). Files `camelCase.ts`; folders lowercase, one word if possible.
- Content: filename = id (`content/threats/outlet.json` ↔ `"id": "outlet"`); content ids `lower_snake_case`; JSON keys `camelCase`; cross-cutting files kebab-case (`mama-lines.json`); generated files `*.geometry.json` and `content/_schemas/` — never edit by hand.

**Naming conventions agents get wrong:**
- **Units are mandatory suffixes:** `windowMs`, `glideMaxMs`, `noisePct`, `speedMps`, `fatiguePerSec`. A bare `duration`/`speed` is a review failure.
- **Time instants:** `t` or `…At` = sim time; `…AtReal` = real time (`pressedAtReal`). Use branded `SimMs` / `RealMs` types; never mix them.
- FSM states: camelCase string-literal unions (`'telegraph' | 'windowOpen' | 'resolved'`), never `enum`. Events: PascalCase past tense, subject first (`ThreatTelegraphed`). Commands: PascalCase imperative (`PressThreat`). Booleans: `is`/`has`/`can`. Constants: `UPPER_SNAKE` in `shared/constants.ts` only. Types: PascalCase, no `I` prefix.
- **Blender (`.glb`) nodes:** `COL_<name>` static collider, `NAV_floor` / `NAV_block_<name>`, `ANCHOR_<anchorId>`, `PROP_<kind>_<nn>` (Rapier prop), `ZONE_hidden_|safe_|creak_<name>`; visual meshes unprefixed; lower_snake_case after prefix; meters, Y-up.
- **Audio:** `public/assets/audio/<category>_<name>.m4a`, categories `tel`, `resp`, `gag`, `baby`, `papa`, `env`, `ui`, `music`.

**Errors & logging:**
- I/O (assets, storage, audio unlock, haptics) returns `Result<T, E>` from `@shared/result` (`{ ok: true, value } | { ok: false, error }`) — no library, no throwing.
- Sim invariants use `invariant()` / `clampInvariant(ctx, value, min, max, name)`: throws in dev/test; in prod clamps and emits `InvariantViolated` (client logs `warn`). No `try/catch` in `src/sim`.
- Every fallback emits at least a `warn` — no silent failure. Uncaught errors → global handler → "Oups" screen + level restart.
- Logging: `log.<level>(channel, message, data?)` from `@shared/log`; channels `boot|assets|audio|input|render|feedback|storage|platform|debug|content|sim`. No `console.*` outside `src/shared/log.ts` (lint rule). The sim never logs — it emits events.

### Testing Rules

- **Unit tests colocated:** `src/sim/timing/judge.test.ts` next to `judge.ts`. E2E in `tests/e2e/*.spec.ts`; architecture tests in `tests/architecture/`; golden journals in `tests/golden/journals/*.json`.
- **Sim tests run in Node** with `createSim({ content, seed })` + typed `SimCommand`s and `sim.step()` — never a DOM, Three.js or real timers. Assert on `World` state and drained `SimEvent`s.
- **Mandatory coverage:** every function in `sim/timing` and every FSM has unit tests; every threat has a generated "perfect / success / too early / too late" test from its JSON; `src/sim` coverage ≥ 90 %.
- **Golden tests:** replay a reference journal and compare final-state hash + event sequence. If a change intentionally alters behaviour, regenerate the golden journal explicitly and say so in the story — never loosen the comparison.
- **Architecture tests are guardrails, not obstacles:** `simPurity.test.ts`, `layerBoundaries.test.ts` (each rule has a failing fixture), `feedbackEquivalence.test.ts`. Never weaken or skip them to make code pass.
- **Express time in sim steps / sim ms** (e.g. `stepN(sim, 120)` = 1200 ms), never `setTimeout`/fake timers inside sim tests.
- **Content tests:** `npm run content:check` validates schemas *and* cross-references; a new JSON file isn't done until it passes.
- **E2E (Playwright, chromium + webkit, landscape mobile viewport):** drive the game via `window.__PP__` (`state`, `events`, `send`, `advance`, `freeze`, `setFeel`, `loadLevel`) or `?autoplay=<bot>&seed=&speed=`. Use `freeze()` + `advance(n)` for stable screenshots — never `waitForTimeout` to "let the game play". `window.__PP__` exists from story 1.13 onward; until story 2.1, `setFeel` restarts the level (same id and seed) instead of sending the `SetFeel` command.
- **Bots** (`perfect`, `human`, `random`, `idle`) produce `SimCommand`s exactly like the client; use `npm run sim -- --level <id> --seed <n> --bot <b> --runs <n>` for balancing / regression checks.
- **Real-device checks** (60 FPS p95, tap latency filmed at 240 fps) are manual with `?debug=1` and gate the playtest (story 1.24); CI perf tests don't replace them.

### Platform & Build Rules

- **Targets:** browser first (mobile + desktop, playtest by link); iOS/Android via Capacitor in E8. Inputs: touch, keyboard, gamepad — every action must be doable with all three (keyboard/gamepad use auto-targeting of the most urgent threat in the aimed direction, cone `feel.autoTargetConeDeg`).
- **Platform code only behind `Platform`** (`src/platform/platform.ts`: `storage`, `haptics`, `lifecycle`, `capabilities`), chosen by `createPlatform(import.meta.env.VITE_TARGET)` (`web | ios | android`). Never branch on user agent in game code; never call `navigator.vibrate`/localStorage/`@capacitor/*` outside `src/platform`. Haptics are a no-op when unsupported.
- **Input capture:** Pointer Events on the canvas (not mouse/touch events), keyboard, Gamepad API polled each frame; always keep `event.timeStamp` (same timebase as `performance.now()`). Bind keys by `KeyboardEvent.code` (physical position: ZQSD/WASD both work), never `event.key`. Hit-test priority: threat > baby > object > floor.
- **Lifecycle:** going to background = pause (exact resume with 3 s countdown). Audio context is unlocked on the first tap ("Touch to start" screen) — never assume audio plays before that.
- **Landscape only:** locked by Capacitor config on native; on web a "Turn your phone" screen in portrait. Respect `env(safe-area-inset-*)`; touch targets ≥ 44 × 44 pt; HUD uses fixed zones.
- **Persistence:** single versioned save `save.v{n}` under key `papa-parade.save` via `StoragePort` (async, JSON, `Result`). Every schema change adds a migration `v{n-1} → v{n}`; invalid data is set aside and replaced with defaults (with `warn`), never crashes.
- **Build flavors:** `npm run dev` (debug + feel panel + `feel-writer` plugin), `build:playtest` (`VITE_DEBUG_ALLOWED=true`, debug via `?debug=1`, F1 or 3-finger tap), `build` (store/prod: `VITE_DEBUG_ALLOWED=false`). Debug code must sit behind `if (import.meta.env.VITE_DEBUG_ALLOWED)` + dynamic `import()` so it's tree-shaken from store builds (no `window.__PP__`, cheats or panel).
- **`feel-writer` Vite plugin** exists only on the dev server and writes only `content/feel.json` — reject any other path.
- **Static hosting:** `base: './'` (same build works under any path and in Capacitor); strict CSP with `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (Rapier WASM) and `font-src 'self'` (self-hosted woff2); HTTPS. No backend, no network calls, no accounts, no personal data — telemetry is a local journal the tester copies/downloads manually.
- **CI pipeline (also `npm run ci` locally):** `typecheck` → `lint` → `content:check` → `test:coverage` (Vitest, golden, architecture; `src/sim` ≥ 90 %) → `e2e` (chromium + webkit) → `build:playtest`; fail on first error. Node scripts in `tools/` run via `tsx` (alias resolution).
- **Assets:** `.blend` (in `assets-src/blender/`, versioned in git) → `tools/blender/export_level.py` → `.glb` → gltfpack (meshopt) → `public/assets/`; `npm run assets:extract` produces `content/levels/<id>.geometry.json`. Blender MCP runs AI Python unguarded: only on project `.blend` files under git, never third-party files.

### Critical Don't-Miss Rules

- ❌ `Math.random()`, `Date.now()`, `performance.now()`, `setTimeout`, `crypto.randomUUID()` anywhere in `src/sim` (incl. "just for an id" or "just for debug").
- ❌ Importing `three` (even types like `Vector3`) into `src/sim` — use `@shared/math/vec2|vec3`.
- ❌ Reading or mutating `sim.world` from the client to change gameplay — the client only **reads** `world` (readonly) and **writes** via `sim.enqueue(cmd)`. Same for debug cheats and the feel panel (`SetFeel`).
- ❌ Importing from `src/sim/...` deep paths in client/bots — only `@sim`.
- ❌ Hard-coding a GDD value "for now" (window 300, buffer 100, tolerance 60, hitstop 80, glide 600, thresholds…) — put it in `feel.json` even in a prototype.
- ❌ Judging a response when papa *arrives*, or when the command is *processed* by `step()` — judge on the command's `t`.
- ❌ Real-time vs sim-time confusion: calibration in real time, windows in sim time. Slow-mo widens windows on purpose — don't "fix" it.
- ❌ A "do nothing" threat failing because the player tapped the floor or another threat.
- ❌ Adding an `audio` feedback without `visual` + `haptic` (pillar 3; test will fail).
- ❌ Writing `state = 'x'` directly, or counting frames for durations.
- ❌ Non-serializable data in `World` (class instances, closures, `Map`/`Set`, Three/Rapier handles) — breaks snapshots, replay and golden tests.
- ❌ Calling one sim system from another, or reordering `SYSTEMS` without updating golden tests and justifying it.
- ❌ Inventing a threat target in the sim when several are active — the command carries `threatId`.
- ❌ `enum`, `namespace`, constructor parameter properties (`erasableSyntaxOnly` will reject them).
- ❌ Bare `console.log`, silent `catch {}`, or `try/catch` in the sim.
- ❌ Static import of `src/debug/**` or `src/bots/**` from client code (ships debug to stores).
- **Edge cases to always handle:** multiple simultaneous threats; papa already gliding toward another threat (new command still judged on its own timestamp, choreography chains); gag on threat B during glide to A plays in parallel; press timestamp older than `timeMap` history (clamp + `warn`); Firmness released before `holdUntilMs` = gag; wrong response type inside the window = gag; perfect slow-mo starts at judgement (glide plays in slow-mo); system-spawned threats (e.g. `papa_microsleep` from `fatigue.ts` above 70 fatigue) follow the same FSM and judgement.
- **When the GDD and architecture disagree:** game rules follow the GDD (v2.1), technical mechanics follow the architecture; ADR-010 (single 400 ms threshold) and ADR-002 (windows in sim time) are already reflected in GDD v2.1. If something is still ambiguous, ask Geo rather than guessing.
- **Golden rule:** the AI writes and tests; Geo tunes the feel. Anything Geo might want to tweak must be data, and every feature must stay playable end-to-end without a human (bots, headless CLI, autoplay).

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any game code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-10-26
