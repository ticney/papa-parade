---
baseline_commit: ba93bfe
---

# Story 3.3: Exportable game journal

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 3.3 « Journal de partie exportable » (L1590-1612). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a tester,
I want to copy or download the journal of my game in one gesture,
so that Geo can analyse my playtest without me giving any personal information.

**Requirements covered:**
- **FR68 `[P]`:** the five gameplay indicators can be measured on at least 5 testers (epics L135). This story produces the data. Story 3.4 computes the indicators from it (`npm run playtest:metrics`), so the summary must carry what 3.4 needs: replays without reloading, success per threat at the first encounter, and touch vs keyboard success (epics L1614-1636).
- **NFR14:** no personal data is collected and no backend is needed (epics L154). The journal leaves the device only by hand: the tester copies or downloads it. Nothing is sent over the network.
- **UX-DR13, Result:** « Copier le journal » exists only in playtest builds (epics L238-242). `EXPERIENCE.md` L180-181, L329, L562, L566: the button confirms with « Journal copié ! ». If the clipboard API fails, it becomes « Télécharger le journal » and downloads a `.json` file (both `[ASSUMPTION]`).
- **Architecture:** « Journal de partie » with `JournalSchema` (L995). Télémétrie de playtest (L294-297). Logs: a ring buffer of the last 200 `info`+ entries, attached to the exported journal (L357). `src/client/telemetry/` (L599, L949). `npm run sim:replay -- <journal.json>` (L1066).

**What this story is not:**
- **No `playtest:metrics`, no indicator, no observation sheet.** That is story 3.4. This story only makes sure that 3.4 has every field it needs.
- **No change to the sim.** `src/sim/**` and the golden journals do not move (see « Must not change »). The sim already records everything a replay needs (`Sim.journal()`, story 1.3/1.10). This story wraps the journal, summarises the game, and teaches `sim:replay` to read the wrapper.
- **No network, no backend, no persistence.** The journal is never written to `StoragePort` and never sent anywhere.
- **No new Result-screen layout.** The 1.22/3.2 sequence, its timings and cues stay. The secondary button already has its slot (`copyLog?`, story 1.24). This story wires it and gives it its two extra labels.
- **No GDD v2.2 work.** The catastrophe gauge and the « niveau perdu » end (GDD v2.2, 2026-10-29, still waiting for `gds-correct-course`) are not in `epics.md` yet. The summary types its end reason from `LEVEL_END_REASONS`, so a later end reason flows through with no change here.

**Sources:**
- Epics `epics.md` L135 (FR68), L154 (NFR14), L238-242 (UX-DR13), L338 (NFR timing), L1590-1612 (this story), L1614-1636 (3.4, the consumer).
- Architecture `game-architecture.md` L181, L198, L234-239 (determinism, journal, replay), L294-297 (playtest telemetry), L304 (ADR-004), L355-372 (logs), L599 and L949 (`src/client/telemetry/`), L995 (`JournalSchema`), L1031-1043 (`Sim.journal()`), L1066 (`sim:replay`), L1070-1072 (security: anonymous journals, shared by hand).
- UX `EXPERIENCE.md` L180-181, L329, L562, L566.
- Deferred work `deferred-work.md` L30 (« `JournalSchema`, `contentVersion` / `levelId` in the journal … arrive with story 3.3 »), L39 (« Invariant strictness follows the build … story 3.3 should record the mode in the exported journal »), L206 (« `sim:replay` is always strict »), L207 (the run-file wrapper « 3.3 may absorb it »), L216 (« Run-file wrapper has no content hashes »).
- Previous stories: `1-24-build-de-playtest-partageable-et-budget-de-performance.md` (AC 3, the `copyLog` gate; D3, the markers; L443, the note for 3.3), `1-22-note-de-maman-et-ecran-de-fin.md` (Result screen), `3-2-variante-sieste-et-reveil-de-maman.md` (end reasons, `lostStars`), `1-12-bots-et-simulation-en-masse.md` (`runFile.ts`, `sim:replay`), `1-13-autoplay-et-api-de-test-dans-le-navigateur.md` (`TestHost`, debug block of `boot.ts`).

## Acceptance Criteria

The journal is a playtest tool. Every new runtime file under `src/` is reached only from the debug block of `boot.ts` (the `VITE_DEBUG_ALLOWED === 'true'` literal), so a store build holds none of it (story 1.24 D3).

### The export file and `JournalSchema`

1. **One file shape, one Zod schema.** `src/content/schemas/journal.ts` exports `JournalSchema` (Zod 4, like the content schemas; the content layer may import `zod` and `shared` only) and `type JournalFile = z.infer<typeof JournalSchema>`. The file is a plain JSON object with these top-level keys:
   - `kind: "papa-parade.journal"` and `version: 1` (constants `JOURNAL_FILE_KIND` and `JOURNAL_FILE_VERSION`, exported next to the schema).
   - `replay` (AC 2), `summary` (AC 3), `device` (AC 4), `diagnostics` (AC 5).
   - Nothing else: the schema is `strict` at every level that this story defines (an unknown key is a validation error). The only exceptions are the opaque fields named in AC 2 and AC 5.
   - It is **not** a content file: it is not added to `CONTENT_FILE_PATTERNS` / `contentFiles.ts`, and no JSON Schema is generated for it in `content/_schemas/`.

2. **`replay`: what `sim:replay` needs to rebuild the game.**
   - `levelId`: the level's id (`snake_case`).
   - `contentHash`: `hashJson` of the **base** `ContentBundle` the page loaded (`testHost.content`, before any level `feelOverrides`). This is the epics' « version du contenu ».
   - `strictInvariants`: the invariant mode the live sim ran with (`defaultStrictInvariants()` from `@shared/invariant`: `false` in a playtest build, `true` in dev). This closes deferred-work L39.
   - `endSimMs`: `sim.world.time.sim` when the journal is built.
   - `worldHash`: `hashJson(sim.world)` at the same moment.
   - `journal`: `sim.journal()` as is: `{ version: 3, seed, feelHash, geometryHash, levelHash, startSimMs, entries }`. `feelHash` is the hash of the feel the sim was created with (feel.json with the level's overrides; `levelSession.ts` L431-455). The live tuning (« changements de feeling ») is in `entries` as journaled `SetFeel` commands (story 2.1 P6), including the remembered tweaks enqueued at `t = 0`.
   - In the schema, `journal` checks the envelope: version 3, an integer seed in `[0, 2**32)`, string hashes, finite `startSimMs`, and entries of `{ applyAt: integer, multiple of STEP_MS; command: object with a string type }`. The command itself stays opaque in Zod (the content layer cannot import `@sim`). `replayJournal` → `journalProblem` / `commandProblem` checks the commands deeply when the file is replayed.
   - A compile-time test proves the two-way assignability of `JournalFile['replay']['journal']` and `Journal` from `@sim` (put it in `tests/tools/sim/` or in a `src/client/telemetry/*.test.ts`, which may import both). A change to `Journal` then fails to typecheck until the schema follows.

3. **`summary`: what story 3.4 computes from.** All of it is built from the `SimEvent`s the client received for this level, and from the client's own state. Nothing is recomputed from the world.
   - `sessionId`: 8 lowercase hex chars, drawn **once per page load** with `crypto.getRandomValues`. It is never persisted and never derived from the device. 3.4 groups the journals of one sitting with it (its CSV has a `sessionId` column, epics L1633). See D6.
   - `gameIndexInSession`: 1 for the first level started since the page loaded, +1 at each later start (« Rejouer », « Recommencer », Oops retry, `__PP__.loadLevel`), with no reload. It is the index of the game the Result screen shows.
   - `autoplay`: the bot's id when `?autoplay=<bot>` played this game, else `null`. 3.4 must be able to drop bot games.
   - `endReason`: from `LevelEnded.reason` (typed from `LEVEL_END_REASONS`).
   - `score`: the `LevelScored` payload without `type` and `t`: `laughPoints`, `babyStatePoints`, `sighPoints`, `screamPoints`, `scorePoints`, `stars`, `lostStars`.
   - `responses.byQuality`: `{ perfect, success, fail }` counts over every `ResponseResolved`.
   - `responses.byThreat`: `{ [threatDefId]: { perfect, success, fail } }`. The def id comes from the `kind` of the `ThreatTelegraphed` / `ThreatHidden` event that named the `threatId` (`threatFsm.ts` L79, L105: `kind` is `threat.defId`). An id never named falls back to `threat_<id>`, like `tools/sim/simReport.ts`.
   - `responses.timeline`: each `ResponseResolved` in order, as `{ t, threatDefId, quality, reason (or null), offsetMs (or null), device }`. 3.4 reads « first encounter » from it.
   - `responses.byDevice`: `{ touch, mouse, keyboard, gamepad, none }`, each `{ perfect, success, fail }`, with the same device as the timeline (below).
   - `dominantDevice`: `'touch' | 'mouse' | 'keyboard' | 'gamepad' | 'none'`. It is the device with the most timeline entries. A tie goes to the device used last among the tied ones. With no response, it is the device of the last input of the level, or `'none'`.
   - **Device of a response** (D5): the client's last input device when the `ResponseResolved` is handled (`inputMapper.lastDevice`, exposed to the debug code through `TestHost`). `pointer` is split by the `pointerType` of the last `pointerdown` on the window: `mouse` gives `'mouse'`, `touch` and `pen` give `'touch'`. `null` gives `'none'`, and so does an autoplay game (the player's input is blocked).
   - The epics' « tactile, clavier ou manette » is the set `touch` / `keyboard` / `gamepad`. `mouse` is kept apart so that a desktop tester's clicks never count as touch in 3.4's touch vs keyboard ratio.

4. **`device`: the type and the platform, nothing more** (NFR14, epics « ni identifiant, ni user-agent complet »).
   - `type`: `'phone' | 'tablet' | 'desktop'`.
   - `platform`: `'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other'`.
   - `target`: `platform.capabilities.target` (`'web'` today).
   - A pure function `describeDevice(probe)` in `src/client/telemetry/` maps a probe `{ userAgent, uaDataPlatform, maxTouchPoints, isCoarsePointer, shortSidePx }` to `{ type, platform }`. iPadOS reports a Mac user-agent: a Mac with `maxTouchPoints > 1` is `ios`. `type` comes from `isCoarsePointer` and `shortSidePx`: coarse with a short side under `JOURNAL_PHONE_MAX_SHORT_SIDE_PX` (600, in `shared/constants.ts`: a classification bound, not a feel value) is `phone`, coarse otherwise is `tablet`, fine is `desktop`.
   - The user-agent string, the screen size, the language, the time zone and every real date are **never** written to the file. A unit test builds a file from a probe with a recognisable user-agent and asserts that the serialized JSON contains no part of it.

5. **`diagnostics.logs`: the last 200 log entries of level `info` and above.** This is `log.buffer()` (`LOG_BUFFER_SIZE` = 200, `shared/log.ts`), oldest first, as `{ atReal, level, channel, message, data? }`.
   - `data` is opaque in the schema, but it is made JSON-safe first by a pure `toJsonSafe(value)` in `src/client/telemetry/`:
     - an `Error` becomes `{ name, message }`;
     - a cycle becomes `"[cycle]"`;
     - `undefined`, a function, a symbol and a `bigint` are dropped (an array slot holding one becomes `null`);
     - a non-finite number becomes its string;
     - a class instance (`Map`, DOM node…) becomes `"[<constructor name>]"`;
     - a string longer than `JOURNAL_LOG_STRING_MAX_CHARS` (500) is cut with `…`;
     - a whole `data` whose JSON is longer than `JOURNAL_LOG_DATA_MAX_CHARS` (2000) becomes `"[truncated]"`.
   - `canonicalJson` throws on all of these by design, so it cannot be used here. The two limits go in `shared/constants.ts`.
   - Nothing in the log is personal today: no message logs the user-agent, a URL with credentials or an identifier. The story checks the existing `log.*` calls once (grep `navigator`, `location`, `userAgent` under `src/client` and `src/platform`) and records the result in the Completion Notes.

### The button on the Result screen (playtest builds)

6. **The copy action is wired in every playtest build, with or without `?debug=1`.** Testers open the plain URL (CLAUDE.md › Playtest deployment, step 5).
   - In the `VITE_DEBUG_ALLOWED === 'true'` block of `boot.ts`, a literal dynamic `import('@debug/playtestJournal')` loads `installPlaytestJournal(testHost, deps)`. It is installed **at boot**, not on press, so the press never waits for a chunk. The test API gate (`isTestApiEnabled`) does not apply to it.
   - `installPlaytestJournal` returns a `PlaytestJournal` with `copyLog(): Promise<CopyLogOutcome>`. `boot.ts` passes it as `copyLog` to `createResultScreen` (the `result:` factory, `boot.ts` ≈ L934-975).
   - A module that fails to load logs a `warn` and the Result screen simply has no copy button. The game must not go to « Oups ».
   - In a production build, none of this exists: `resultScreen.ts` keeps its literal gate (story 1.24 AC 3), and `boot.ts` passes `copyLog` only from inside the flagged block.

7. **One gesture copies a validated JSON.** On press, the action:
   1. builds the `JournalFile` **synchronously** from the active level (`levelSession.active`, which `finish()` keeps readable on the Result screen);
   2. checks it with `JournalSchema.safeParse`;
   3. serializes it with `JSON.stringify(file, null, 2)`;
   4. calls `navigator.clipboard.writeText(text)` with **no `await` before it** in the press handler.

   iOS Safari and Chrome on Android grant the clipboard only inside the user gesture (transient activation). `bindPressButton` runs the action on `pointerup` inside the button, and on `click` for the keyboard and a pad's A. That is a gesture for touch and the keyboard. For a mouse, the `pointerdown` activation is still fresh.

   When `writeText` resolves, the outcome is `'copied'` and the button label becomes « Journal copié ! » (`result.log_copied`). The button stays pressable: a second press copies again.

8. **The clipboard fails: download instead, in the same gesture.** When `navigator.clipboard` or `writeText` is missing, throws or rejects:
   - the action logs one `warn` (`'debug'` channel, with the error's name);
   - it downloads the same text as a file: a `Blob` of type `application/json`, an object URL, a temporary `<a download>` clicked and removed, and `URL.revokeObjectURL` after the click (on the next task, so that WebKit has read it);
   - the file name is `papa-parade-journal-<levelId>-<sessionId>-<gameIndexInSession>.json`. It contains no date (D6);
   - the outcome is `'downloaded'`, and the label becomes « Télécharger le journal » (`result.download_log`);
   - from then on, every press of that button downloads directly and never tries the clipboard again (for the life of the page).

   If the download itself throws, the action logs a `warn`, the outcome is `'failed'`, and the label does not change. A press with no active level (a bug) logs a `warn` and gives `'failed'`. A validation failure in step 2 is a bug: it logs an `error` with the Zod issues, and the file is still copied or downloaded (D4).

9. **The Result screen shows the outcome and stays safe.** `ResultScreenOptions.copyLog` becomes `() => Promise<CopyLogOutcome>`, with `CopyLogOutcome = 'copied' | 'downloaded' | 'failed'` exported from `resultScreen.ts`.
   - The screen sets the label and the `aria-label` from the outcome. A press while a copy is pending is ignored.
   - An outcome that arrives after `dispose()` is dropped (a rebuilt screen after the portrait overlay starts again at « Copier le journal »).
   - Every 1.22/3.2 rule still holds: the input grace (`inputGraceMs`), « a skip never presses a button », the focus on « Rejouer » and the pad's A on « Rejouer ».
   - The copy button never takes the initial focus.
   - The two existing gate tests stay (`resultScreen.test.ts` L509-530).
   - The label strings already exist in `content/strings.fr.json` L73-75: no new string.

### Replay

10. **`npm run sim:replay -- <exported journal>` ends in the same state.** `tools/sim/replaySim.ts` reads either kind of file:
    - `papa-parade.run`: unchanged, through `parseRunFile`, strict invariants, as today.
    - `papa-parade.journal`: parsed with `JournalSchema` (a Zod error is printed with its paths and exits 1). It is mapped onto the existing path: `levelId`, `untilSimMs = replay.endSimMs`, `worldHash = replay.worldHash`, `journal = replay.journal`, `bot = summary.autoplay ?? 'player'`. It is replayed with the **recorded** `strictInvariants` (D3), not always `true`.
    - `checkFeelPatches` still runs first, for both kinds.
    - `replay.contentHash` is compared with `hashJson` of the base bundle of the checkout. `loadSimLevel` exposes it as a new `contentHash` field, computed **before** the level's overrides are merged. A difference is a `warn` that names both hashes, never a failure: strings and cues do not change the sim, and the sim's three hashes (feel, geometry, level) are already the gate inside `replayJournal`.
    - On success it logs `replay matches` with the world hash and exits 0, as today. On a different state it exits 1 with the existing message.
    - `--help` names both kinds.

11. **Proved end to end, from the browser.**
    - **Node test** (`tests/tools/sim/`): a headless game on `salon_crawler` with a bot (`playGame` / `createBot`, as `runSim` does) ends on `LevelEnded`. The test builds the file with the same pure builder the browser uses, writes it to a temp dir, and replays it through `replayRunFile` (and once through the CLI, like `cli.test.ts`). The replay matches. A second case changes one entry and gets the « another state » or refusal error. A third case is a file with `strictInvariants: false` that is replayed non-strict.
    - **e2e** (`tests/e2e/journal.spec.ts`, chromium **and** webkit): open the Result screen like `result.spec.ts` (`openResult`, `advanceToEnd`), press « Copier le journal », and get the text:
      - chromium: `context.grantPermissions(['clipboard-read', 'clipboard-write'])`, then read it back with `navigator.clipboard.readText()`;
      - webkit, or where reading is refused: stub `navigator.clipboard.writeText` with `page.addInitScript` to capture the text and resolve.

      Then, in the spec:
      - assert « Journal copié ! »;
      - parse the text with `JournalSchema`;
      - assert `summary.endReason`, `summary.score` equal to the `LevelScored` event, `summary.gameIndexInSession === 1`, and `device` with only its three keys;
      - write the text to `testInfo.outputPath()` and run `npx tsx tools/sim/replaySim.ts <file>` with `execFileSync`: exit 0 and `replay matches`, with no `contentHash` warning.

      Doing this on webkit too proves that a JavaScriptCore game replays in Node. The architecture only promises « la même plateforme »: if webkit diverges, stop and tell Geo (Open point 1). Do not loosen the comparison.
    - **e2e, the fallback:** stub `writeText` to reject. One press downloads (`page.waitForEvent('download')`). The file name follows AC 8, the content passes `JournalSchema`, and the label is « Télécharger le journal ». A second press downloads again without calling the stub.
    - **e2e, the counter:** « Rejouer », then end the second level. The journal says `gameIndexInSession === 2` with the same `sessionId`.

### Build guardrails

12. **The store build proves the absence, the playtest build the presence.**
    - In `tools/build/inspectDist.ts`, `PLAYTEST_REQUIRED_SOURCES` gains `src/debug/playtestJournal.ts`, and `PROD_FORBIDDEN_MARKERS` gains `installPlaytestJournal` and `papa-parade.journal` (the file kind). The marker `copyLog` stays.
    - `tests/tools/build/checkDist.test.ts` follows.
    - `npm run build && npm run dist:check -- --flavor prod` and `npm run build:playtest && npm run dist:check -- --flavor playtest` both pass (`npm run ci` runs both).
    - `src/client/telemetry/*` is imported only by `src/debug/playtestJournal.ts` and by tests and tools: no static import from `boot.ts` or any other client module (D2).
    - The CSP is unchanged: a download through an object URL and `<a download>` needs no new directive, and the e2e:dist run proves it (no CSP violation, `tests/e2e-dist/dist.spec.ts`).
    - If `dist.spec.ts` already reaches the Result screen, it also asserts that « Copier le journal » is there **without** `?debug=1`. Otherwise, add that check in the smallest way the spec allows (or say why not in the Completion Notes).

13. **Docs.**
    - CLAUDE.md, Commands table, the `sim:replay` row: it also reads a journal exported from the Result screen (`papa-parade.journal`).
    - CLAUDE.md › Playtest deployment, step 5: testers send the journal with « Copier le journal » (or the downloaded file), and Geo replays it with `npm run sim:replay -- <file>`.
    - `_bmad-output/project-context.md`: one line under the telemetry rule (L145) on what the journal holds and that it holds nothing personal.
    - `deferred-work.md`: close L30, L39, L206, L207 and L216 with a « Resolved in story 3.3 » note that says what closed each one.
    - CI: `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T1. Schema and constants** (AC 1, 2, 4, 5)
  - [x] `src/shared/constants.ts`: `JOURNAL_PHONE_MAX_SHORT_SIDE_PX` (600), `JOURNAL_LOG_STRING_MAX_CHARS` (500), `JOURNAL_LOG_DATA_MAX_CHARS` (2000), each with a one-line doc.
  - [x] `src/content/schemas/journal.ts`: `JOURNAL_FILE_KIND`, `JOURNAL_FILE_VERSION`, `JournalSchema` (strict objects; enums for quality, device, type, platform; `endReason` as a string here, checked against `LEVEL_END_REASONS` in the client test, because content cannot import `@sim`), `JournalFile`. Use the project's Zod setup (`zodConfig.ts`, `jitless`: no `eval`, because of the CSP).
  - [x] `src/content/schemas/journal.test.ts`: a valid file passes; an unknown key, a wrong kind or version, an off-grid `applyAt`, a seed ≥ 2**32 and a device with an extra key all fail with a path.
- [x] **T2. Pure telemetry** (AC 2-5) in `src/client/telemetry/`:
  - [x] `describeDevice.ts` (+ test: iPhone, iPad as a Mac with touch, Android phone and tablet, Windows, macOS, Linux, unknown, and « the JSON has no part of the UA »).
  - [x] `toJsonSafe.ts` (+ test for each rule of AC 5).
  - [x] `gameSummary.ts`: `createGameSummary({ sessionId, gameIndexInSession, autoplay })` with `onEvent(event, device)` and `onInput(device)`, plus `summary()`. It is a pure recorder; the device is passed in. (+ test: def id from `kind`, fallback `threat_<id>`, tie rule of `dominantDevice`, `'none'` with no input, score from `LevelScored`.)
  - [x] `buildJournalFile.ts`: `buildJournalFile({ sim, levelId, baseContent, strictInvariants, summary, device, target, logs })` returns a `JournalFile`. It reads `sim.world`, `sim.journal()` and `hashJson`, and draws no real time and no randomness. (+ test with a real `createSim` on `createTestLevel`: the result passes `JournalSchema`, `worldHash` equals `hashJson(sim.world)`, and the compile-time `Journal` ↔ schema proof of AC 2.)
- [x] **T3. Debug installer** (AC 6-8) `src/debug/playtestJournal.ts`: `installPlaytestJournal(host, deps)`, where `deps` holds the clipboard, a download function, the `crypto` source, the device probe, `log.buffer` and `defaultStrictInvariants`. All are injectable for the unit test, with browser defaults.
  - [x] It draws the `sessionId` once.
  - [x] It subscribes to `host.onLevelStarted` (new recorder, `gameIndexInSession++`) and `host.onSimEvent` (feed the recorder with `host.lastInputDevice()`, split by the last `pointerType`).
  - [x] It listens to `pointerdown` on `window` (capture, passive) for the `pointerType`.
  - [x] `copyLog()` follows AC 7 and 8, with the « download from now on » flag.
  - [x] Test `src/debug/playtestJournal.test.ts`: copy ok; copy rejects → download, then a second press downloads without the clipboard; download throws → `failed`; no active level → `failed`; the file name; `writeText` is called before any `await` (assert it is called synchronously inside `copyLog()`, before the returned promise settles).
- [x] **T4. Client wiring** (AC 6, 9)
  - [x] `src/client/app/testHost.ts`: add `lastInputDevice(): InputDevice | null`, documented as read-only. Update the fakes in the debug tests that build a `TestHost`.
  - [x] `src/client/boot.ts`: implement it from `inputMapper.lastDevice`. In the flagged block, load and install the journal at boot (try/catch → `warn`). Hold the result in a `let playtestJournal` that the `result:` factory reads (`copyLog: playtestJournal?.copyLog`).
  - [x] `src/client/ui/screens/resultScreen.ts`: the `copyLog` signature, `CopyLogOutcome`, the label update, the pending guard, the dispose guard. Update the doc comment and the 1.24 note (« Story 3.3 wires… ») to say it is done.
  - [x] `resultScreen.test.ts`: the label after each outcome, a press while pending is ignored, an outcome after dispose changes nothing, the grace still applies to the copy button, focus is still on « Rejouer ».
- [x] **T5. Replay CLI** (AC 10): `tools/sim/replaySim.ts` (two kinds, the recorded strictness, the `contentHash` warn, the help text) and `tools/sim/loadSimLevel.ts` (`contentHash` of the base bundle). Tests in `tests/tools/sim/` (AC 11, Node part).
- [x] **T6. e2e** (AC 11): `tests/e2e/journal.spec.ts` (copy and replay, fallback download, counter). Reuse `tests/e2e/support` helpers (`openResult`-style, `advanceToEnd`, `ppEvents`). Never `waitForTimeout`.
- [x] **T7. Build guardrails** (AC 12): `inspectDist.ts`, `checkDist.test.ts`, `dist.spec.ts` (copy button without `?debug=1`).
- [x] **T8. Docs** (AC 13): CLAUDE.md (2 places), `project-context.md`, `deferred-work.md` (close 5 items, add a « Deferred from: story 3.3 » section if anything is left).
- [x] **T9. CI:** `env | grep VITE_`, then `(unset VITE_DEBUG_ALLOWED; npm run ci)`. Then `npm run build:playtest` and copy a real journal by hand once in `npm run preview` (or `serve:dist`), and replay it. Put the output in the Debug Log.

## Dev Notes

### Decisions (D1-D7)

| # | Decision | Why |
|---|---|---|
| D1 | **The exported file wraps the sim's `Journal`; the sim does not change.** `replay.journal` is `sim.journal()` verbatim, and the wrapper adds `levelId`, `contentHash`, `strictInvariants`, `endSimMs`, `worldHash`. | The sim's journal already holds the seed, the hashes and the commands, `SetFeel` included (stories 1.3, 1.10, 2.1). `tools/sim/runFile.ts` already proves that a replay needs exactly `levelId`, `untilSimMs` and `worldHash` beside it. Changing `Journal` (version 4) would move every golden journal for no gain. |
| D2 | **Pure builders in `src/client/telemetry/`, wiring in `src/debug/playtestJournal.ts`.** Only the debug module imports telemetry. | The architecture puts telemetry in `src/client/telemetry/` (L599). The 1.24 rule wants no journal code in the store bundle: debug code reaches the bundle only through the flagged dynamic import in `boot.ts`, and `dist:check` proves it by manifest and markers. A static import of telemetry from `boot.ts` would ship it in prod. |
| D3 | **The file records the invariant mode, and `sim:replay` replays a player's journal in that mode.** Run files from the CLI stay strict. | A playtest build clamps (`PROD`) what dev throws on (deferred-work L39, L206). A strict replay of a clamped game would throw where the game went on, and the AC asks for « l'état final est identique ». An `InvariantViolated` during the live game is already in `diagnostics.logs` (`logSimEvent` logs it as `warn`). |
| D4 | **A file that fails `JournalSchema` is still exported, with an `error` in the log.** | A schema failure is our bug, found by the unit and e2e tests that parse every built file. At playtest time, the tester's game is worth more than the check: Geo can still read and fix a slightly off file. Losing it to an error toast would waste a session. |
| D5 | **The device of a response is the last input device when it resolves. `pointer` is split into `touch` and `mouse` by `pointerType`.** | Commands do not carry a device, and adding one would change the sim's commands and journals. The last input device is what the auto-target already uses (`inputMapper.lastDevice`). A tester switches device rarely within a 3-min game. 3.4's « tactile comparé au clavier » must not count a mouse as touch, so `mouse` is its own bucket. A timeout fail goes to the device the player was using, which is the right denominator for a success rate. |
| D6 | **A random `sessionId` per page load, no real date, no user-agent.** | 3.4 needs to group the journals of one sitting (`sessionId` in its CSV) and to count replays without reloading (`gameIndexInSession`). A value drawn at each load, never stored, identifies a page visit, not a person or a device. A date or a time zone adds nothing that 3.4 needs, and the file name would leak it. Geo confirms (Question 1). |
| D7 | **Clipboard first, download as the fallback, decided in the same gesture.** After one failure, the button downloads for the rest of the page. | UX `EXPERIENCE.md` L329/L566. Retrying a clipboard that just refused would make the tester press twice for nothing. The text is built synchronously so that `writeText` runs inside the gesture: iOS refuses it after an `await`. |

### Current state of the files this story changes (read before editing)

- **`src/sim/journal.ts`** (read only). `Journal` v3 `{ version, seed, feelHash, geometryHash, levelHash, startSimMs, entries: { applyAt, command }[] }`. `journalProblem` and `entryProblem` are the handwritten runtime checks. `Sim.journal()` returns a deep copy (`createSim.ts` L613). It is exported as a type from `@sim` (`index.ts`).
- **`src/sim/replay.ts`** (read only). `replayJournal({ content, geometry, level, journal, untilSimMs, strictInvariants })` checks the shape, then `feelHash`, `geometryHash` and `levelHash` against the given content, then `startSimMs === 0`. It steps while `world.time.sim < untilSimMs` and returns `{ sim, events }`; the caller disposes the sim.
- **`tools/sim/replaySim.ts`.** `checkFeelPatches` validates each `SetFeel` against the level feel. `replayRunFile(file, loaded)` always passes `strictInvariants: true` and compares `hashJson(world)` with `file.worldHash`. `main()` reads one path, `JSON.parse`, `parseRunFile`, `loadSimLevel`, `replayRunFile`. Keep `replayRunFile`'s signature usable by the existing `cli.test.ts`. Add the strictness as an option, defaulting to `true`.
- **`tools/sim/runFile.ts`.** `RunFile { kind 'papa-parade.run', version 1, levelId, bot, untilSimMs, worldHash, journal }`. `untilSimMs` is bounded by `SIM_CLI_MAX_UNTIL_MS` (1 h). Do not change the format: `npm run sim --journals` keeps writing it.
- **`tools/sim/loadSimLevel.ts`.** It returns `{ levelId, content (feel merged with the level's overrides), level, geometry }`. Add `contentHash` = `hashJson(content.value)` before the merge.
- **`src/client/app/levelSession.ts`** (read only). The sim gets feel.json with the overrides (`effectiveFeel`). Remembered tweaks are enqueued as `SetFeel` at `t = 0`. `finish()` stops the loop and keeps `active` (and so the frozen sim) readable until the next `start()`. `onLevelStarted` fires once per started level, before `appFsm.enter('level')`.
- **`src/client/boot.ts`** (1281 lines).
  - L87-98: `logSimEvent` (it logs `LevelEnded` as `info` and `InvariantViolated` as `warn`).
  - L216-221: `isMirrored` / `params`.
  - L590-618: `createLevelSession({ … onLevelStarted })`, with `levelStartedListeners` called last.
  - L846-866: the debug `simEventListeners` run **before** `LevelEnded` / `LevelScored` are handled, then `LevelScored` → `levelSession.finish()` → `appFsm.enter('result')`.
  - L934-975: the `result:` factory (`createResultScreen`), with no `copyLog` today.
  - L1179-1232: the flagged block (`testHost`, autoplay, perf HUD).
  - L1251-1274: the test API and the overlay behind `isTestApiEnabled`. Install the journal in the flagged block **before** `appFsm.enter('start')`, not behind `isTestApiEnabled`.
  - `inputMapper.lastDevice` is `'pointer' | 'keyboard' | 'gamepad' | null` (`inputMapper.ts` L80, L111).
- **`src/client/app/testHost.ts`.** The interface the debug modules get. No logic. Every debug test builds a fake of it: add the new method to those fakes (`grep -rn "TestHost" src/debug tests`).
- **`src/client/ui/screens/resultScreen.ts`** (453 lines).
  - L53-55: `copyLog?: () => void`.
  - L225-235: the button, built only under `import.meta.env.VITE_DEBUG_ALLOWED === 'true' && options.copyLog !== undefined` (keep that literal: Vite folds it), with `bindPressButton(copy, options.copyLog)` and `unbindCopy` in `dispose`.
  - The action has no grace check today. Apply the same `isGraceOver()` and `heldSkipKey === null` rule as « Rejouer », so that a skip or a mashing finger never copies.
- **`src/client/ui/pressButton.ts`.** `bindPressButton(button, onActivate)`: the action runs on `pointerup` inside the button, or on `click` with `detail === 0` (keyboard, assistive tech). Do not change it.
- **`src/shared/log.ts`.** `log.buffer()` returns copies of the ring (`info`+, 200), oldest first. `data` is kept by reference and may be anything (an `Error`, a DOM event…): hence `toJsonSafe`.
- **`src/shared/hash.ts`.** `hashJson` (cyrb53 over `canonicalJson`) and `canonicalJson` (it throws on anything that is not plain JSON).
- **`src/shared/invariant.ts`.** `defaultStrictInvariants()` returns `import.meta.env?.PROD !== true`.
- **`tools/build/inspectDist.ts`** L64-92: `PROD_FORBIDDEN_MARKERS`, `PLAYTEST_REQUIRED_SOURCES`.
- **`content/strings.fr.json`** L73-75: `result.copy_log`, `result.log_copied`, `result.download_log`. They are already there; add nothing.

### Must not change

- `src/sim/**`, the `Journal` type and version, the snapshot version, and every golden journal and hash (`tests/golden/journals/*`). `npm run golden:update` must not be needed. If it is, something in the sim moved: stop.
- The `papa-parade.run` format and the strict replay of run files (`npm run sim --journals` / `sim:replay` on them).
- The Result-screen sequence, its timings, cues, grace and focus rules (1.22, 3.2).
- The 1.24 gate in `resultScreen.ts` and every existing `PROD_FORBIDDEN_MARKERS` entry.
- The CSP in `public/_headers` (never widen it without Geo).

### Architecture compliance

- **Layers.**
  - `src/content/schemas/journal.ts` imports `zod` and `@shared/*` only.
  - `src/client/telemetry/*` imports `@sim` (public API: types, `LEVEL_END_REASONS`), `@content`, `@shared`. It never imports sim internals, and it may not import `@debug`.
  - `src/debug/playtestJournal.ts` may import anything; it is loaded only by the literal dynamic `import()` in `boot.ts` (rule R7, `tests/architecture/layerBoundaries.test.ts`).
  - `tools/` may import `@content/schemas/journal` and `@client/telemetry/*` for the Node test.
- **No `console.*`**: use `log.warn('debug', …)`. Fallbacks log a `warn` (CLAUDE.md). I/O helpers (clipboard, download) return a `Result` or an outcome, never a silent `catch`.
- **Units:** `endSimMs`, `offsetMs`, `shortSidePx`, `…MaxChars`. `t` is sim time; `atReal` (logs) is real time.
- **Names:** factories `create…` (`createGameSummary`); files named after their export, camelCase; types PascalCase; constants `UPPER_SNAKE` in `shared/constants.ts`.
- **Privacy (NFR14):** no network call anywhere (CSP `default-src 'self'` would block one anyway), no `StoragePort` write, no identifier, no user-agent string, no date.
- **Platform APIs:** `navigator.clipboard`, `URL.createObjectURL` and `matchMedia` are plain web APIs. Only `navigator.vibrate` is restricted to `src/platform` (`tests/architecture/platformApis.test.ts`), so using them in `src/debug` is fine. Keep every `navigator`/`window` read inside the injectable defaults of `installPlaytestJournal`, so that the unit test never needs a DOM.

### Library and framework notes

- No new dependency. Zod 4 (`z.strictObject`, `z.enum`, `z.int()`, `z.unknown()`), built with the project's `zodConfig` (`jitless`, because of the CSP; story 1.24).
- `navigator.clipboard.writeText` needs a secure context: HTTPS, or `localhost` for dev, preview and e2e. On a LAN `http://` address (`serve:dist --host`) the clipboard is `undefined`, so the fallback downloads. That is expected, and it is a good manual check of AC 8.
- Playwright: chromium supports `grantPermissions(['clipboard-read', 'clipboard-write'])`. WebKit in Playwright does not grant clipboard reads reliably, so capture the text by stubbing `writeText` there (`page.addInitScript`). `page.waitForEvent('download')` and `download.suggestedFilename()` work on both engines.

### File structure

New:
- `src/content/schemas/journal.ts`, `journal.test.ts`
- `src/client/telemetry/describeDevice.ts`, `toJsonSafe.ts`, `gameSummary.ts`, `buildJournalFile.ts`, each with its `.test.ts`
- `src/debug/playtestJournal.ts`, `playtestJournal.test.ts`
- `tests/tools/sim/journalReplay.test.ts` (or extend `cli.test.ts`)
- `tests/e2e/journal.spec.ts`

Updated:
- `src/shared/constants.ts`
- `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/ui/screens/resultScreen.ts`, `resultScreen.test.ts`
- the debug tests' `TestHost` fakes
- `tools/sim/replaySim.ts`, `tools/sim/loadSimLevel.ts`, `tools/build/inspectDist.ts`, `tests/tools/build/checkDist.test.ts`, `tests/e2e-dist/dist.spec.ts`
- `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`

### Testing

- Unit tests sit next to the code and import `describe/it/expect` from `vitest`. Sim-backed tests use `createTestLevel` and the frozen `tests/support/testFeel.json`, never the live `content/feel.json`. The Node replay test of AC 11 is the exception: it plays the real `salon_crawler` through `loadSimLevel`, like `cli.test.ts`, because it proves the CLI on real content.
- Assert exact values, not « at least »: exact counts per quality in the summary, the exact file name, `writeText` called exactly once, the download called exactly once. The reviews of 3.1 and 3.2 caught vacuous tests and missing upper bounds.
- `resultScreen.test.ts` stubs the flag with `vi.stubEnv('VITE_DEBUG_ALLOWED', 'true')` / `vi.unstubAllEnvs()` (pattern at L509-530).
- Run `npm run test:coverage`: `src/sim` coverage must not drop, and it will not, since the sim does not change.
- e2e: chromium and webkit. If two worktrees run CI at once and Playwright times out, rerun with `--workers=4` and say so.

### Previous story intelligence (3.2, 1.24, 1.22, 1.13, 1.12)

- **3.2** (last merged, `ba93bfe`). `LevelEnded.reason` is `'timer' | 'mamaWoke'` (`LEVEL_END_REASONS` from `@sim`). `LevelScored` carries `lostStars`. `boot.ts` stores `resultEndReason` and `resultScore`. Its review caught: the story file drifting from the commits (keep the Completion Notes true), duplicated test seeds, dead test code, comments that claim more than the assertions.
- **1.24.** It built the `copyLog` gate and the `dist:check` markers, and left a note for this story (« wire `copyLog` from the debug block of `boot.ts` »). D3: the label « Copier le journal » is in the prod bundle through `strings.fr.json`, so the check looks for the wiring (`copyLog`), not the label. The same goes for « Journal copié ! » and « Télécharger le journal ». The playtest check requires every marker to be present, so a new marker must really be in the playtest bundle.
- **1.22.** The Result screen reads only the `LevelScored` payload. The input grace and « a skip never presses a button » are tested: extend those tests to the copy button.
- **1.13.** `TestHost` is the only door from the debug code into the app. Debug modules are loaded by a literal dynamic import inside the flagged block, and a failed load is a `warn`, never « Oups ».
- **1.12.** `runFile.ts` / `replaySim.ts` / `cli.test.ts` are the pattern for the Node replay test. Deferred L216 (« no content hashes in the run file ») is closed here by `contentHash` in the new kind. The run file itself keeps the sim's three hashes inside `journal`.

### Git intelligence

- Recent: `ba93bfe` (3.2 merged), `f08aad4` and `275e184` (3.2 golden and merge of 2.1/2.2), `52cbdc8` (2.2 merged), `ee531f1` (Linux screenshot references dropped: screenshot assertions are macOS only).
- This story is on `story/3-3-journal-de-partie-exportable`, in its worktree `.claude/worktrees/3-3-journal-de-partie-exportable`.
- 1.24 is the closest in shape (build flag, dist markers, dist e2e). 1.12 is the closest on the CLI side.

### Project Structure Notes

- The telemetry lives where the architecture says (`src/client/telemetry/`, L599). The schema lives with the other Zod schemas (`src/content/schemas/`), as the architecture's data table implies (`JournalSchema`, L995), even though it is not content.
- **Variance with the architecture (by design):**
  - the architecture's « Copier / Télécharger » is one button that falls back, as the UX says;
  - the « summary » adds `sessionId`, `autoplay`, `responses.timeline` and a split `mouse` device, which 3.4 needs;
  - the export is wired from `src/debug/`, not from `src/client/telemetry/` alone, to keep it out of the store bundle (D2).

### Project context rules (from `_bmad-output/project-context.md`)

- Layers as in CLAUDE.md. Cross-layer imports go through the aliases. There is no `@sim/*`.
- The sim never logs and never reads real time or randomness. This story leaves the sim untouched.
- No `console.*` outside `shared/log.ts`. I/O returns a `Result` or an outcome. Every fallback logs a `warn`.
- No hard-coded tunable: the three journal limits are classification and size bounds in `shared/constants.ts`, not game feel. The label strings are in `strings.fr.json`.
- Static hosting, strict CSP, no network, no personal data: telemetry is a local journal the tester copies or downloads by hand (L145).
- Tests sit next to the code; e2e in `tests/e2e`; never `waitForTimeout` to let the game play.
- Shell trap: run `env | grep VITE_` before `dev`, `e2e` or `ci`. The agent shell exports `VITE_DEBUG_ALLOWED=false`. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Open points for Geo (decide after playing or after the device pass)

1. **Browser → Node determinism.** The architecture promises a replay « sur la même plateforme ». The e2e of AC 11 replays a chromium game and a webkit game in Node. If the webkit one diverges, the playtest journals of iPhone testers will not replay in `sim:replay`. The dev stops and reports instead of loosening the check. The fix (a sim-side math audit, or replaying in a headless WebKit) would be its own story.
2. **iOS clipboard in a real gesture.** `bindPressButton` acts on `pointerup`. Desktop WebKit in Playwright does not prove what iOS Safari accepts. Add one line to `docs/playtest/device-measurements.md` for Geo's device pass: « Copier le journal » on the iPhone → « Journal copié ! » (else « Télécharger le journal » and a file in Files).
3. **The confirmation stays on the button.** « Journal copié ! » does not go back to « Copier le journal » after a delay (no timing to tune). Say so if it should.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3 : Journal de partie exportable (L1590-1612)]
- [Source: _bmad-output/planning-artifacts/epics.md (L135, L154, L238-242, L1614-1636)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md (L181, L198, L234-239, L294-297, L304, L355-372, L599, L949, L995, L1031-1043, L1066, L1070-1072)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md (L180-181, L329, L562, L566)]
- [Source: _bmad-output/implementation-artifacts/1-24-build-de-playtest-partageable-et-budget-de-performance.md (AC 3, D3, L443)]
- [Source: _bmad-output/implementation-artifacts/3-2-variante-sieste-et-reveil-de-maman.md (D3, Review Findings)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L30, L39, L206, L207, L216)]
- [Source: _bmad-output/project-context.md (L66, L124-131, L145)]
- [Source: src/sim/journal.ts, src/sim/replay.ts, tools/sim/replaySim.ts, tools/sim/runFile.ts, tools/sim/loadSimLevel.ts, src/client/ui/screens/resultScreen.ts, src/client/boot.ts, src/client/app/levelSession.ts, src/shared/log.ts, tools/build/inspectDist.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`), in the story's worktree on `story/3-3-journal-de-partie-exportable`.

### Debug Log References

- **First full CI run: red at the e2e step (4 failures, 2 specs, chromium and webkit). Two different causes.**
  - `result.spec.ts` asserted `getByText('Copier le journal')` has count 0. True before this story, false now: a debug build (dev, playtest) shows the button. Replaced by "the button is there, never focused, at least 44 × 44". That the store build has none is `dist:check`'s job.
  - `mamaWoke.spec.ts › fits 750 × 340 with the header, without scrolling`: the panel overflowed by 11 px. Cause (measured): the 360 px panel gives each of the two buttons 157 px, so « Copier le journal » wrapped on two lines and the actions row went from 44 px to 60 px. Fix in `ui.css` only: `.pp-result-actions .pp-button-secondary { flex: 0 1 auto; padding-inline: var(--pp-spacing-3); white-space: nowrap; }`. Measured after the change at 750 × 340 and 844 × 390, woken and timer end, for both labels (« Copier le journal » 158 | 156 px, « Télécharger le journal » 118 | 196 px): row 44 px, no vertical or horizontal overflow. `journal.spec.ts` now pins it (both viewports, both labels, one line, no scroll).
- **Second full CI run: green.** `typecheck`, `lint`, `content:check`; `test:coverage` 236 files / 4285 tests (`src/sim` 97.83 % statements, 99.27 % lines: the sim did not change); `e2e` 400 passed (chromium + webkit, 4.8 min); `build:playtest` + `dist:check --flavor playtest`; `e2e:dist` 10 passed (1.5 min) and `perf` 1 passed (`17117 frames, p95 16.7 ms, draw calls max 34, triangles max 890`); `build` + `dist:check --flavor prod` OK. No timeout, so no `--maxWorkers` / `--workers` override was needed.
- **T9, the built playtest bundle (not hand-clicked on a device).** `npm run build:playtest`, `dist:check` OK, `npm run serve:dist -- --port 5890`, then a throwaway Playwright script (kept in the session scratchpad, not in the repo) opened `/?autoplay=human&seed=7&speed=4` with **no `?debug=1`**, waited for the Result screen and its input grace, pressed « Copier le journal » and read the real clipboard (chromium, `clipboard-read` granted):
  - button `Copier le journal` → `Journal copié !`; 29 404 bytes; score 83, 4 stars.
  - the file: `kind papa-parade.journal`, `version 1`, top-level keys `kind, version, replay, summary, device, diagnostics`; `levelId salon_crawler`, **`strictInvariants false`** (a `vite build`, `PROD`), `endSimMs 180000`, `worldHash 08f8c21aa4eebb`, `contentHash 1de98e49815fec`, 108 journal entries, `autoplay human`, `endReason timer`, `gameIndexInSession 1`, `byQuality {perfect 33, success 16, fail 0}`, 7 log entries, `device {type phone, platform macos, target web}` (the script emulates touch on a Mac).
  - `npm run sim:replay -- real-journal.json` → `[sim] replay matches { worldHash: '08f8c21aa4eebb' }`, exit 0, no content warning. This is the one run where the browser's sim ran in the non-strict mode a tester's does, and Node replayed it non-strict.
- The first Node/test run of each new unit and the e2e spec passed at once except: `toJsonSafe` at-the-limit test (my fixture was cut by the 500-char string limit first: rebuilt with strings under it); the e2e fallback test (the second download's `diagnostics` legitimately holds the first refusal's `warn`, and webkit adds a pre-existing `input` warn from `setPointerCapture`: compare the file without `diagnostics`, and look at the `debug` channel only).

### Completion Notes List

**What is done (all 13 ACs, T1-T9).**

- **File and schema (AC 1-5).** `JournalSchema` (`src/content/schemas/journal.ts`, `z.strictObject` at every level, imports `../zodConfig.ts` so it parses without `eval` under the CSP) and `JournalFile`. `kind: papa-parade.journal`, `version: 1`; `replay`, `summary`, `device`, `diagnostics`. Not a content file (no `contentFiles.ts` entry, no JSON Schema). `src/client/telemetry/`: `describeDevice` (type and platform only; iPadOS-as-Mac handled), `toJsonSafe` (every rule of AC 5), `createGameSummary` (pure recorder; `summary()` is `null` until `LevelEnded` and `LevelScored` are in), `buildJournalFile` (pure; reads `sim.world`, `sim.journal()`, `hashJson`). Constants in `shared/constants.ts`: `JOURNAL_PHONE_MAX_SHORT_SIDE_PX` 600, `JOURNAL_LOG_STRING_MAX_CHARS` 500, `JOURNAL_LOG_DATA_MAX_CHARS` 2000.
- **Installer and wiring (AC 6-9).** `src/debug/playtestJournal.ts` (`installPlaytestJournal(host, deps)` → `{ copyLog, dispose }`; every browser read is an injectable default). `boot.ts` loads it at boot in the flagged block (after the autoplay install, before `appFsm.enter('start')`, behind a `try/catch` that logs a `warn`), and passes `copyLog` to the Result screen only through `import.meta.env.VITE_DEBUG_ALLOWED === 'true' && playtestCopyLog !== null ? { copyLog } : {}`, so the literal folds in a store build. `TestHost.lastInputDevice()` (read-only) added; `fakeTestHost` has `setLastInputDevice`. `resultScreen.ts`: `copyLog: () => Promise<CopyLogOutcome>`, `CopyLogOutcome`, the label and `aria-label` from the outcome, a pending guard, a dispose guard, the same grace and held-skip-key rules as « Rejouer », a rejection or a synchronous throw counts as `failed` (with a `warn`).
- **Replay (AC 10-11).** `tools/sim/replaySim.ts` reads both kinds: `parseJournalFile`, `journalFileToRunFile` (`bot` = `summary.autoplay ?? 'player'`), `replayJournalFile` (recorded strictness, a `warn` naming both hashes when the content hash differs, a refusal above `SIM_CLI_MAX_UNTIL_MS`). `replayRunFile` gained an optional `{ strictInvariants }` defaulting to `true`: run files and `cli.test.ts` are untouched. `loadSimLevel` exposes `contentHash` (hash of the base bundle, before the overrides). `--help` names both kinds.
- **Guardrails and docs (AC 12-13).** `inspectDist.ts`: `src/debug/playtestJournal.ts` required in playtest; `installPlaytestJournal` and `papa-parade.journal` forbidden in prod (both present in the playtest bundle: checked by the real build). `dist.spec.ts` gained a test that reaches the Result screen on the plain URL (no `?debug=1`), checks the button, forces the download fallback and asserts no CSP violation. `CLAUDE.md` (2 places), `project-context.md`, `deferred-work.md` (5 items closed, each saying how), `docs/playtest/device-measurements.md` (Open point 2).

**Verified, not assumed.**

- **Open point 1 (browser → Node determinism) is settled for now:** a chromium game and a webkit game (JavaScriptCore), both exported through the real button, replay in Node to the same world hash (`journal.spec.ts`, 2 engines), and so does the built non-strict playtest bundle (above). Nothing loosened.
- **Privacy audit (AC 5).** `grep` over `src` for a `log.error|warn|info` call that mentions `userAgent`, `navigator.(user|platform|language)`, `window.location`, `location.(href|search|origin)`, `.href` or `referrer`: no match. The only `navigator.userAgent` read in `src` is the probe in `src/debug/playtestJournal.ts`, whose only consumer is `describeDevice`. No `Date`, `Intl` or time-zone read under `src/client`, `src/platform` or `src/debug`. `buildJournalFile.test.ts` serialises a file built from a probe with a recognisable user-agent and a 391 px side and asserts none of its parts is in the JSON; `playtestJournal.test.ts` asserts no date pattern.
- **Nothing in the sim moved.** `src/sim/**` and `tests/golden/**` are untouched; `npm run golden:update` was not run.

**Deviations and choices the review should look at.**

1. **AC 2, compile-time proof is one-way for the entries.** The command is opaque in Zod (the content layer cannot import `@sim`) and `SimMs` is branded, so `JournalFile['replay']['journal']` and `Journal` cannot be assignable both ways. `buildJournalFile.test.ts` proves: the envelope (`Omit<…, 'entries'>`) mutually assignable, the entry keys identical, and `Journal['entries']` assignable to the schema's. A field added to `Journal` fails to typecheck there; a change in a command's shape does not (that is `commandProblem` at replay).
2. **AC 3, the recorder's `onInput` is fed with the current device on every sim event** (the story gave no other input hook for keyboard and gamepad), so « the device of the last input of the level » is the device in use at the last event. Only matters for a level with no response at all.
3. **AC 3, `pointer` with no `pointerdown` seen is `none`**, not `touch` or `mouse` (cannot happen once installed at boot; it avoids inflating either).
4. **AC 8, the clipboard-rejection fallback runs after a microtask**, not strictly inside the press: only a missing or synchronously throwing `navigator.clipboard` downloads inside the gesture. Transient activation outlasts a microtask in every engine the e2e covers.
5. **Result screen CSS (not in the story's task list, forced by the first CI run).** The secondary button no longer shares the row in equal halves (see the Debug Log). It changes the playtest builds' Result layout by a few px of button width and nothing in a store build.
6. **`result.spec.ts` assertion reversed** (no button → button present), and **`prodInput` in `checkDist.test.ts` also filters `debugOverlay` / `playtestJournal` files** (the old filter left the overlay chunk in the prod fixture; harmless, now accurate).
7. **`waitForResultActions`** added to `tests/e2e/support/game.ts` (waits on the page's own clock for the input grace, no `waitForTimeout`) and used by `journal.spec.ts` and `dist.spec.ts`. `result.spec.ts` and `mamaWoke.spec.ts` keep their own `waitForTimeout` helper, untouched.
8. `dist.spec.ts` does **not** replay the downloaded file: `PP_DIST_URL` also checks a deployed build, and a checkout that moved on from that build would fail the replay for the wrong reason.

**Left for Geo (Open points 2-3 of the story).** The iPhone Safari gesture check is a line and two table rows in `docs/playtest/device-measurements.md`, empty on purpose (the document says an agent never fills it). The confirmation stays on the button, with no timer.

### File List

New:
- `src/content/schemas/journal.ts`, `src/content/schemas/journal.test.ts`
- `src/client/telemetry/describeDevice.ts`, `describeDevice.test.ts`, `toJsonSafe.ts`, `toJsonSafe.test.ts`, `gameSummary.ts`, `gameSummary.test.ts`, `buildJournalFile.ts`, `buildJournalFile.test.ts`
- `src/debug/playtestJournal.ts`, `src/debug/playtestJournal.test.ts`
- `tests/tools/sim/journalReplay.test.ts`
- `tests/e2e/journal.spec.ts`

Modified:
- `src/shared/constants.ts`
- `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/screens/resultScreen.test.ts`, `src/client/ui/styles/ui.css`
- `tools/sim/replaySim.ts`, `tools/sim/loadSimLevel.ts`, `tools/build/inspectDist.ts`
- `tests/support/fakeTestHost.ts`, `tests/support/simSupport.ts`, `tests/tools/sim/loadSimLevel.test.ts`, `tests/tools/build/checkDist.test.ts`
- `tests/e2e/result.spec.ts`, `tests/e2e/support/game.ts`, `tests/e2e-dist/dist.spec.ts`
- `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `docs/playtest/device-measurements.md`

### Change Log

- 2026-10-29: Story created (ready-for-dev).
- 2026-10-29: Story implemented (T1-T9): exportable `papa-parade.journal` with `JournalSchema`, the pure telemetry builders, the playtest installer wired from `boot.ts`, « Copier le journal » / « Télécharger le journal » on the Result screen, `sim:replay` reading both kinds, dist guardrails, docs. Full `npm run ci` green. Status → review.
