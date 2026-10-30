---
baseline_commit: 485906a
---

# Story 3.4: Playtest indicators

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 3.4 « Indicateurs de playtest » (L1614-1636). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). The observation sheet it adds is in French, like the rest of `docs/playtest/`. -->

## Story

As Geo,
I want the indicators that can be computed to be computed from the testers' journals, and the others to be noted simply,
so that I can decide whether the prototype validates the concept.

**Requirements covered:**
- **FR68 `[P]`:** the five gameplay indicators can be measured on at least 5 testers (epics L135). Story 3.3 produces the data (the exported `papa-parade.journal`). This story turns a folder of those files, plus Geo's notes, into one report.
- **NFR11:** the thresholds (epics L151, GDD « Indicateurs de gameplay » L560-569):
  1. **Relaunch:** ≥ 70 % of testers start another game without being asked. *Computed.*
  2. **Perfect parry:** ≥ 4 testers of 5 spontaneously cite it as a high point. *Observed.*
  3. **Readability:** ≥ 4 testers of 5 identify the right response to **each** threat at the first encounter. *Observed* (`identifiedWithoutHelp`), with the *computed* first-encounter success rate next to it as a proxy.
  4. **Touch holds:** the success rate on touch is ≥ 80 % of the one on the keyboard. *Computed.*
  5. **Chaos is funny:** ≥ 4 testers of 5 laugh at least once during a level. *Observed.*
- **NFR14:** nothing personal. Testers are pseudonyms chosen by Geo (`T1`, `T2`…). The tool reads local files only and sends nothing.
- **Architecture:** `npm run playtest:metrics -- <dossier de journaux>` « calcule les 5 indicateurs de E1 » (`game-architecture.md` L1067, L1205); « Télémétrie de playtest » (L294-297).

**What this story is not:**
- **No change to the game, the sim or the exported journal.** `src/sim/**`, `JournalSchema`, the Result screen and the goldens do not move. 3.3 already put every field this story needs in the file (`summary.gameIndexInSession`, `summary.responses.timeline`, `summary.responses.byDevice`, `summary.autoplay`, `summary.sessionId`).
- **No GDD v2.2 indicator.** The GDD (2026-10-29) adds « Rater coûte quelque chose » (fear of missing, the « Maman rentre ! » defeat felt fair) and « La défaite est possible sans être un mur » (bot loss rates 10-30 %). Neither is in `epics.md`: they arrive through `gds-correct-course`, with the catastrophe gauge. The CSV columns are the epics' seven, no more (see Open point 2).
- **No bot work.** The deferred « the `human` bot never lifts a Firmness early » (deferred-work L417, « with the playtest indicators, story 3.4 ») is about the bots' reports, not the testers' journals. It stays deferred (T7 moves it, with that reason).
- **No network, no UI, no browser code.** This is a Node tool under `tools/`, plus two docs and a data file.

**Sources:**
- Epics `epics.md` L135 (FR68), L151 (NFR11), L154 (NFR14), L338 (« NFR11 est mesurée en fin de E3 [P] »), L1614-1636 (this story), L1590-1612 (3.3, the producer).
- GDD `gdds/gdd-papa-parade-2026-10-26/gdd.md` L560-569 (the indicator table and `[ASSUMPTION: seuils de départ, panel de 5 testeurs minimum.]`), L614 (assumption 7: thresholds and panel size).
- Architecture `game-architecture.md` L294-297, L1067, L1070-1072 (anonymous journals shared by hand), L1205.
- Previous story `3-3-journal-de-partie-exportable.md`: AC 3 (summary fields), D5 (device of a response), D6 (`sessionId`, no date), Review Findings (deferred items for 3.4).
- Deferred work `deferred-work.md` L202 (« 3.4 adds the playtest indicators »), L417 (Firmness bot), L503 (« `dominantDevice` and the per-device fail count are approximate … story 3.4 decides what it needs »).

## Acceptance Criteria

### The command

1. **`npm run playtest:metrics -- <dir> [options]`** is a new script: `tsx tools/playtest/playtestMetrics.ts`.
   - Options: `--observations <file>` (default `docs/playtest/observations.csv`), `--out <file>` (write the Markdown report there instead of stdout), `--json <file>` (also write the JSON report), `--help`.
   - Parsed with `node:util` `parseArgs`, `strict: true`, one positional (the folder), in a pure `parseMetricsArgs(argv)` returning a `Result` (pattern: `tools/sim/simArgs.ts`). A missing folder, two positionals or an unknown flag is an error with the help hint.
   - Exit 0 when the report is written, **even if indicators are KO** (a KO is a finding, not a failure). Exit 1, with a `log.error('playtest', …)` that says what to fix, on a usage error or an input error (AC 2, AC 4).
   - `--out` / `--json` targets are checked before any work (an existing folder for the parent, not a folder itself), like `outProblem` in `tools/sim/runSim.ts`. Reuse it (move it to a small shared helper under `tools/` if both need it; do not copy it).
   - When the report goes to stdout, nothing else is logged at `info` (stdout carries the report), like `runSim`.

### Reading the journals

2. **One folder per tester.** The layout is `<dir>/<testerId>/*.json`. Geo saves each tester's files (a pasted « Copier le journal » text, or the downloaded file) into the folder named after the pseudonym he gave that tester.
   - `testerId` is the folder name. It must match `TESTER_ID_PATTERN` = `/^[A-Za-z0-9_-]{1,32}$/` (in `tools/playtest/`, not `shared/constants.ts`: no `src` code uses it). A folder that does not match is an input error that names it.
   - A `.json` file directly in `<dir>` (not in a tester folder) is an input error: « put each tester's journals in a folder named after their testerId ». Non-`.json` files and dot-files are ignored silently (a `.DS_Store`, a note).
   - Subfolders deeper than one level are ignored with a `warn`.
   - An empty `<dir>`, or one where no tester has a usable game (below), is an input error.
   - Folders and files are read in sorted order (by name, `localeCompare` with `'en'`), so the report never depends on the file system's order.

3. **Each file is validated, and only human games count.**
   - A file is parsed with `JSON.parse`, then with `JournalSchema` from `@content/schemas/journal` (reuse `parseJournalFile` from `tools/sim/replaySim.ts`: it already prints Zod paths). A file that fails is **skipped**, not fatal (3.3 D4: a slightly off file is still the tester's game). It is listed in the report's « Skipped files » section with the reason, and logged as a `warn`.
   - A `papa-parade.run` file (from `npm run sim --journals`) is skipped with the reason « a bot run file, not a playtest journal ».
   - A journal with `summary.autoplay !== null` is skipped with the reason « played by the <bot> bot ».
   - **Duplicates:** two files of one tester with the same `(sessionId, gameIndexInSession)` and the same `replay.worldHash` are one game (the tester sent it twice): keep the first by name, `warn` about the second. The same pair with a different `worldHash` is an input error that names both files (two games cannot have one index in one session).
   - The same `sessionId` in two tester folders is an input error (a page visit belongs to one person).
   - The content hash and the level id are not checked: a journal from an older build is still a tester's game. The report lists the distinct `levelId`s and `contentHash`es it read, so that Geo sees a mix.

### Reading the observations

4. **`docs/playtest/observations.csv`: the notes Geo takes during a playtest** (epics L1633).
   - Columns, exactly these names (order free): `testerId, sessionId, threatId, identifiedWithoutHelp, perfectCitedSpontaneously, laughs, comment`.
   - **A missing column is an input error** that names every missing column and the file. An extra column is a `warn` that names it (its values are ignored).
   - Parsing (a small pure parser in `tools/playtest/csv.ts`, no new dependency): RFC 4180 quotes (a comma, a quote `""` or a newline inside a quoted field), `\n` and `\r\n`, a UTF-8 BOM stripped, blank lines skipped. The delimiter is `,`, or `;` when the header line has no `,` and has `;` (a French spreadsheet exports `;`). An unterminated quote or a row with the wrong number of fields is an error with its line number.
   - **Values**, trimmed. Every error names the file, the line and the column:
     - `testerId`: required, matches `TESTER_ID_PATTERN`.
     - `sessionId`: empty, or 8 lowercase hex chars (as in the journal). Empty means « this tester, whichever session »: Geo does not know the `sessionId` while he watches; he can add it later from the journal (the downloaded file's name carries it).
     - `threatId`: empty (a row about the whole game: the perfect parry, laughs, a comment), or a `lower_snake_case` id. An id that is not a threat def in `content/threats/` is a `warn`, not an error (a later build may have renamed it).
     - `identifiedWithoutHelp`: `O` or `N` (case-insensitive) when `threatId` is set; it must be empty when `threatId` is empty.
     - `perfectCitedSpontaneously`: `O`, `N` or empty.
     - `laughs`: empty or a whole number ≥ 0.
     - `comment`: free text, kept as is.
   - Two rows with the same `(testerId, sessionId, threatId)` and a non-empty `threatId` are an error (one judgment per threat and session).
   - **No observations file** at the default path: a `warn`, and the three observed indicators are `n/a` (Geo may want the computed ones first). An explicit `--observations` path that does not exist is an input error.
   - A tester who appears only in the CSV (no journal) counts for the observed indicators, with a `warn`. A tester with journals and no row counts for the computed ones only. A row whose `sessionId` is not one of that tester's journals is a `warn`.

5. **The example and the sheet** (epics L1631-1633).
   - `docs/playtest/observations.example.csv`: a header and about eight rows for two testers that exercise every rule of AC 4 (a general row, an `N`, an empty `sessionId`, a quoted comment with a comma). `npm run playtest:metrics -- <fixture dir> --observations docs/playtest/observations.example.csv` must accept it (a test does, AC 10).
   - `docs/playtest/observation-sheet.md`, in French, for Geo during a session. It holds:
     - **le protocole:** ouvrir le lien sans `?debug=1`; ne pas expliquer les menaces; **ne jamais demander de relancer** (NFR11: « sans qu'on le leur demande »); if Geo needs another game for another reason, he reloads the page first, so that `gameIndexInSession` starts again at 1 and that game does not count as a relaunch; à la fin, demander « Copier le journal » et l'envoyer;
     - **la grille:** one line per threat met (`threatId` from the list of the prototype's threats: `outlet`, `stairs`, `coffee_table_object`, `silence_mischief`, `papa_microsleep`), with « a trouvé seul la bonne réponse O/N », a tally of laughs, and one line for the whole game (« a cité la parade parfaite spontanément O/N », comments). What counts: « spontanément » means before any question about it; a laugh is an audible laugh or a clear smile-and-sound, counted once per burst;
     - **le report:** how a sheet becomes CSV rows (one row per threat line, one general row), and where the files go (`<dossier>/<testerId>/` for the journals, `docs/playtest/observations.csv` for the notes; Open point 3);
     - the five indicators and their thresholds, read from `content/playtest.json` (named, not copied, so that the sheet does not drift).

### The thresholds are data

6. **`content/playtest.json`**, validated by `PlaytestSchema` (`src/content/schemas/playtest.ts`, `z.strictObject`), registered in `CONTENT_FILES` as `PLAYTEST_FILE` (so `content:check` validates it and `content:schemas` emits `content/_schemas/playtest.schema.json`; commit the generated file).
   - Keys (all `…Pct` integers in `[0, 100]`, except the panel): `panelMinTesters` (5), `relaunchMinPct` (70), `perfectCitedMinPct` (80), `identifiedMinPct` (80), `firstEncounterSuccessMinPct` (80), `touchVsKeyboardMinPct` (80), `laughedMinPct` (80). « 4 sur 5 » is 80 %. Each key has a `.describe()` (the JSON Schema shows it in the editor).
   - These are the GDD's « seuils de départ » (assumption 7): Geo retunes them here, never in code (golden rule).
   - **It is a tool-only file.** It is **not** added to `loadContent` or `ContentBundle` (the game never reads it, and adding it would move the `contentHash` of every 3.3 journal for nothing). `src/client/assets/browserContentSource.ts` globs `content/**/*.json`: add `'!../../../content/playtest.json'` to its exclusions, with a comment, so that it is not inlined in the bundle. A test proves the exclusion. `browserContentSource.ts` has no test today: add `src/client/assets/browserContentSource.test.ts` (Vitest runs Vite's transform, so the eager `import.meta.glob` works there): `read('playtest.json')` is an `err` (« is not bundled ») and `read('feel.json')` is an `ok`.
   - `tools/playtest/` loads it with `parseContentFile` and the Node content source (`tools/content/nodeContentSource.ts`), the way `loadSimLevel` loads content.

### Computing the indicators

7. **Pure computation** in `tools/playtest/computeMetrics.ts`: `computeMetrics({ testers, observations, thresholds })` returns a `PlaytestReport`, reads no file and no clock. The games of a tester are ordered by session, then by `gameIndexInSession`. **Session order:** the order in which the tester's `sessionId`s first appear in the CSV, then the remaining ones sorted by id, with one `warn` per tester that has more than one session and no CSV order for some (« session order unknown: first encounters may be wrong »). A session whose game 1 is missing gets a `warn` too (its first encounters may be later games').

   **Per tester** and **global**, each with its value, the threshold, the count it is computed on, and a status:
   - **Relaunch (computed).** Per tester: games, highest `gameIndexInSession`, `relaunched` = highest ≥ 2 (a lone journal of game 2 still proves a relaunch). Global: % of testers with at least one human game who relaunched, vs `relaunchMinPct`.
   - **First-encounter success per threat (computed, the proxy of indicator 3).** Per tester and threat def: the first `responses.timeline` entry of that `threatDefId` in game order; success = `quality` `perfect` or `success`. A threat never resolved by the tester is absent (not a fail). Global, per threat: % of testers who met it and succeeded, vs `firstEncounterSuccessMinPct`. The overall status is OK only if every threat is OK.
   - **Touch vs keyboard (computed).** Success rate of a device = (`perfect` + `success`) / all, summed over `summary.responses.byDevice[device]` of the human games. Per tester: the rate of each device used (`touch`, `mouse`, `keyboard`, `gamepad`), and the ratio when the tester used both touch and keyboard. Global: pooled over every response of every tester, ratio = touch rate / keyboard rate, vs `touchVsKeyboardMinPct`. `mouse`, `gamepad` and `none` are shown for information and never enter the ratio (3.3 D5: a desktop click is not touch).
   - **Identification (observed, indicator 3).** Per tester and threat: `identifiedWithoutHelp` (O/N; with several sessions, the row of the first session in the order above, or the row with an empty `sessionId`). Global, per threat: % of testers with a row who said O, vs `identifiedMinPct`; overall OK only if every threat is OK.
   - **Perfect parry cited (observed, indicator 2).** Per tester: O if any row says O, N if rows say only N, `n/a` if every row is empty. Global: % of testers with O or N who said O, vs `perfectCitedMinPct`.
   - **Laughed (observed, indicator 5).** Per tester: the sum of `laughs`; `laughed` = sum ≥ 1; `n/a` if every row's `laughs` is empty. Global: % of testers with a value who laughed, vs `laughedMinPct`.
   - **Panel.** The number of testers in the report (with a game or a row), vs `panelMinTesters` (FR68). Below it, the status is KO and the report says the panel is too small; the other statuses are still computed.

   **Status rules.** `OK` when the value meets the threshold, `KO` when it does not, `n/a` when the count is 0 (no data: never OK). Compare with integers, never floats: `hits * 100 >= minPct * count` (so 4 of 5 vs 80 is OK exactly). Percentages are printed rounded to one decimal, but the status uses the exact comparison.

### The report

8. **Markdown on stdout (or `--out`), JSON with `--json`.** `tools/playtest/renderMetrics.ts`, pure.
   - **Markdown** (English, like every tool's output; the indicator names carry their NFR11 number):
     - a summary table: indicator, value, threshold, testers counted, status (`OK` / `KO` / `n/a`), in the order of NFR11 above, with the panel first;
     - the per-threat tables for indicator 3 (identified, first-encounter success): one row per threat, one column per tester (`✓` / `✗` / `—`) and the global %;
     - one section per tester: games (session, index, level, end reason, stars), relaunch, success rate per device, the observed values, and the CSV comments;
     - « Inputs »: the folder, the CSV path (or « none »), the distinct `levelId`s and `contentHash`es, the counts of files read and skipped; « Skipped files » and « Warnings » lists.
   - **JSON:** the same `PlaytestReport` (`JSON.stringify(report, null, 2)` and a final newline), with `version: 1` and `kind: 'papa-parade.playtest-metrics'`. No date in it (the same inputs give the same bytes).
   - Nothing from the journals' `diagnostics.logs` and nothing from `device` beyond what the report needs (the device type and platform may appear per tester, for context).

### The deferred items of 3.3 about the device

9. **3.4 decides what it needs from the device data** (deferred-work L503), and writes it down:
   - Only `responses.byDevice` and the timeline's `device` are used. `dominantDevice` is not used (its no-response approximation does not matter).
   - A timeout fail credited to the device in use is the right denominator for a success rate (3.3 D5). `lastPointerType` not reset between games only matters for a tester who switches device between games, which the protocol does not do.
   - Close L503 in `deferred-work.md` with a « Resolved in story 3.4 » note that says this. Move L417 (Firmness bot) under a « Deferred from: story 3-4 » section with its new reason (bots, not journals; with the GDD v2.2 bot indicator).

### Tests and docs

10. **Tests** in `tests/tools/playtest/` (import `describe/it/expect` from `vitest`):
    - `csv.test.ts`: quotes, `""`, a newline in a quoted field, CRLF, BOM, `;` detection, blank lines, an unterminated quote and a short row (with the line number).
    - `observations.test.ts`: every value rule of AC 4, the missing-column error (it names **each** missing column), the extra-column warn, the duplicate-row error; the committed `docs/playtest/observations.example.csv` parses with no error and no warn.
    - `computeMetrics.test.ts`, on small synthetic journals built by a helper that returns a `JournalFile` passing `JournalSchema` (assert it in the helper): relaunch with game 2 only; first encounter in game 2 when game 1 lacks the threat; session order from the CSV and the unknown-order warn; a tester who used touch only (no ratio) and the pooled ratio; `mouse` and `none` outside the ratio; 4 of 5 at 80 → OK and 3 of 5 → KO (exact); 0 testers → `n/a`; the panel below `panelMinTesters`. **Exact values** everywhere (counts, percentages, statuses), never « at least » (the reviews of 3.1-3.3 caught vacuous tests).
    - `loadJournals.test.ts` (temp dir): the folder layout errors (root `.json`, bad tester folder name), skipped invalid / run / autoplay files with their reasons, the duplicate rules, the same `sessionId` in two folders, sorted order.
    - `playtestMetrics.test.ts`, end to end: two **real** headless games on `salon_crawler` exported through 3.3's own builders (`createGameSummary` with `autoplay: null` and devices fed by the test, `buildJournalFile`), as `tests/tools/sim/journalReplay.test.ts` does, written to `T1/` and `T2/` in a temp dir, then the CLI (`spawnSync` of `npx tsx tools/playtest/playtestMetrics.ts`, as `cli.test.ts` does) with the example CSV: exit 0, the Markdown has the summary table, `--json` parses and its statuses match `computeMetrics`. A missing CSV column gives exit 1 and the column name on stderr.
    - `PlaytestSchema` gets a test next to it (a valid file, an unknown key, a `Pct` above 100) and is covered by `tests/content/jsonSchema.test.ts` through `CONTENT_FILES`.

11. **Docs and CI.**
    - CLAUDE.md, Commands table: a `npm run playtest:metrics -- <dir>` row (the layout, `--observations`, `--out`, `--json`, exit codes in one line). Playtest deployment, step 5: « Geo saves each tester's journals in `<dir>/<testerId>/`, takes notes with `docs/playtest/observation-sheet.md`, then runs `npm run playtest:metrics -- <dir>` ».
    - `_bmad-output/project-context.md`: one line next to the telemetry rule (3.3's line) on `playtest:metrics` and its thresholds in `content/playtest.json`.
    - `deferred-work.md` as in AC 9.
    - `npm run ci:fast` after each task; one `(unset VITE_DEBUG_ALLOWED; npm run ci)` before the review. No e2e spec is touched by this story, but the bundle glob changes (AC 6), so the full CI's `dist:check` runs matter.

## Tasks / Subtasks

- [x] **T1. Thresholds as data** (AC 6)
  - [x] `src/content/schemas/playtest.ts` (`PlaytestSchema`, `type PlaytestThresholds`), with its `.test.ts`.
  - [x] `PLAYTEST_FILE` in `src/content/contentFiles.ts` `CONTENT_FILES` (not in `loadContent`).
  - [x] `content/playtest.json` with the GDD values; `npm run content:schemas`; commit `content/_schemas/playtest.schema.json`.
  - [x] `browserContentSource.ts`: exclude `content/playtest.json`, plus the test.
- [x] **T2. CSV and observations** (AC 4, 5) `tools/playtest/csv.ts`, `tools/playtest/observations.ts` (`parseObservations(text, file, knownThreatIds)` → `Result<{ rows, warnings }, string[]>`), tests; `docs/playtest/observations.example.csv`.
- [x] **T3. Journals** (AC 2, 3) `tools/playtest/loadJournals.ts` (`loadJournals(dir)` → `Result<{ testers, skipped, warnings, levels, contentHashes }, string[]>`), reusing `parseJournalFile`; tests with temp dirs.
- [x] **T4. Computation** (AC 7, 9) `tools/playtest/computeMetrics.ts` and its synthetic-journal helper (`tests/tools/playtest/support.ts`); tests.
- [x] **T5. Report and CLI** (AC 1, 8) `tools/playtest/renderMetrics.ts`, `tools/playtest/metricsArgs.ts` (`parseMetricsArgs`, `METRICS_HELP`), `tools/playtest/playtestMetrics.ts` (`main`), the `playtest:metrics` script in `package.json`; the shared `outProblem` helper; the end-to-end test (AC 10).
- [x] **T6. The sheet** (AC 5) `docs/playtest/observation-sheet.md` in French.
- [x] **T7. Docs** (AC 9, 11) CLAUDE.md (2 places), `project-context.md`, `deferred-work.md`.
- [x] **T8. CI** `env | grep VITE_`, `npm run ci:fast` after each task, then `(unset VITE_DEBUG_ALLOWED; npm run ci)` once. Run the command by hand once on the end-to-end fixture and paste its Markdown summary table in the Debug Log.

## Dev Notes

### Decisions (D1-D7)

| # | Decision | Why |
|---|---|---|
| D1 | **A tester is a folder.** `<dir>/<testerId>/*.json`. | The journal holds no tester identity on purpose (3.3 D6: a random `sessionId` per page load). A tester may reload and get two sessions. Geo knows who sent which file when he saves it, so the folder is the cheapest reliable mapping. The CSV's `sessionId` stays optional, because Geo does not see it while he watches. |
| D2 | **Only human games count; invalid files are skipped, not fatal.** | `autoplay` is in the summary for this (3.3 AC 3). A schema failure was a bug at export time (3.3 D4): the rest of the panel is still worth a report. Every skip is listed, so nothing disappears silently. |
| D3 | **First encounter = first resolved response of that def, in session-then-index order.** | There is no real date in the journal (3.3 D6), so the order of two sessions is unknown unless the CSV gives it. A threat never resolved is not counted as a fail: the tester did not meet it. |
| D4 | **The computed first-encounter success is a proxy, shown next to the observed identification.** | The GDD criterion is « identifie la bonne réponse sans explication », which only an observer sees (a lucky tap is not understanding, a late tap after understanding is a fail). Both use the same 4-of-5 threshold; the summary table marks the observed one as indicator 3 and the computed one as its proxy. |
| D5 | **Touch vs keyboard is pooled over responses; `mouse` and `gamepad` stay out.** | NFR11 says « taux de réponses réussies sur mobile ≥ 80 % de celui au clavier »: a rate of responses, not of testers. Testers rarely use both, so a per-tester ratio is mostly `n/a`; the pooled one is the indicator. A mouse is a desktop pointer, not the mobile tap the criterion is about. |
| D6 | **Thresholds in `content/playtest.json`, outside the game bundle.** | Geo tunes them (golden rule, GDD assumption 7). `content:check` refuses an unregistered file, so it is registered in `CONTENT_FILES` (validated, JSON Schema) but not loaded by `loadContent`, and excluded from the browser glob: the game neither needs nor ships it, and the 3.3 journals' `contentHash` does not move. |
| D7 | **Exit 0 with KOs, exit 1 only for inputs Geo must fix.** Integer comparisons for the status. | The report is a decision aid: a KO is its answer. `hits * 100 >= minPct * count` makes 4/5 at 80 % exactly OK, with no float edge. |

### Current state of the files this story reads or changes

- **`src/content/schemas/journal.ts`** (read only). `JournalSchema`, `JournalFile`, `JOURNAL_FILE_KIND`. Summary fields used: `sessionId`, `gameIndexInSession`, `autoplay`, `endReason`, `score.stars`, `responses.timeline[] { t, threatDefId, quality, reason, offsetMs, device }`, `responses.byDevice.{touch,mouse,keyboard,gamepad,none} { perfect, success, fail }`. `replay.levelId`, `replay.contentHash`, `replay.worldHash` (duplicates). `device.type`, `device.platform`.
- **`src/client/telemetry/gameSummary.ts`** (read only). How the summary is built: the def id comes from the `kind` of `ThreatTelegraphed` / `ThreatHidden`, else `threat_<id>`; every `ResponseResolved` is one timeline entry. A missed threat resolves as `fail` with `reason: 'late'` (`FailReason` = `'early' | 'late' | 'wrongResponse' | 'released'`, `src/sim/events.ts` L23). A threat still open at `LevelEnded` has no entry.
- **`tools/sim/replaySim.ts`.** `parseJournalFile(json)` → `Result<JournalFile, string>` with Zod paths: reuse it, do not re-validate by hand. Do not change its behaviour.
- **`tools/sim/runSim.ts`.** `main()` pattern: `fail()` logs `log.error` and sets `process.exitCode = 1`; `outProblem(path)` (L130-145) checks an output path; stdout carries the report, so no `info` log then. `writeText` / `makeDir` return `Result`.
- **`tools/sim/simArgs.ts`.** `parseArgs` with `strict: true`, errors as `Result`, `SIM_HELP` text. Follow it for `metricsArgs.ts` (with `allowPositionals: true` and exactly one positional).
- **`tools/sim/loadSimLevel.ts`, `tools/content/nodeContentSource.ts`, `src/content/parseContentFile.ts`.** How a tool reads a content file in Node, with `ContentProblem`s formatted by `formatContentProblem`.
- **`src/content/contentFiles.ts`.** `CONTENT_FILES` is the registry for `content:check` and `content:schemas` (`tools/content/contentChecks.ts` L854-912 refuses a file with no entry). `loadContent` loads four named files, not the whole list: adding `PLAYTEST_FILE` to the list does not add it to `ContentBundle`. Update the list's doc comment, which says « single source for `loadContent` », to say a tool-only file is registered but not loaded.
- **`src/client/assets/browserContentSource.ts`** L6-14. The eager glob of `content/**/*.json` minus `_schemas/**` and `*.geometry.json`. Add the `playtest.json` exclusion there.
- **`tests/tools/sim/journalReplay.test.ts`** (pattern). Plays a real game on `salon_crawler` and builds the exported file with `createGameSummary` + `buildJournalFile`. Reuse its approach (and its helper if it can be shared without coupling the two test files; otherwise a small copy in `tests/tools/playtest/support.ts` is fine).
- **`tests/tools/sim/cli.test.ts`** (pattern). Runs a CLI with `spawnSync` and checks exit code and output.
- **`docs/playtest/device-measurements.md`** (style). French, short sections, « rempli par Geo, jamais par l'agent de dev ». The sheet follows the same tone and states that the agent never fills it.

### Must not change

- `src/sim/**`, `JournalSchema` and the exported file, the Result screen, every golden (`npm run golden:update` must not be needed).
- `src/shared/log.ts` beyond the one new channel.
- `loadContent`, `ContentBundle`, `testContent.ts`: the thresholds are not part of the bundle (D6).
- `tools/sim/*` behaviour (`sim`, `sim:replay`); moving `outProblem` to a shared helper must keep `runSim` identical.
- The CSP and `public/_headers`.

### Architecture compliance

- **Layers.** Everything new runs in Node under `tools/` (anything allowed, never imported by `src/`). `src/content/schemas/playtest.ts` imports `zod` and `../zodConfig.ts` only (like `journal.ts`). `tools/playtest/*` may import `@content/*`, `@shared/*` and `tools/sim/replaySim.ts`.
- **No `console.*`:** `log.warn('playtest', …)` / `log.error('playtest', …)`; the report goes to `process.stdout.write`. `LogChannel` in `src/shared/log.ts` (L5-16) is a closed union with no `'playtest'`: add `| 'playtest'` there (one line) rather than reusing `'sim'`.
- **Results, no silent catch.** File reads return `Result`; every skip or fallback logs a `warn` and appears in the report.
- **Units and names:** `…Pct`, `…Ms`; files camelCase named after their export; the factory-free pure functions are verbs (`computeMetrics`, `parseObservations`, `loadJournals`, `renderMetrics`); types PascalCase (`PlaytestReport`, `ObservationRow`, `TesterGames`).
- **Content conventions:** JSON keys camelCase; the file name is the id (`playtest.json`).

### Library and framework notes

- No new dependency: `node:util` `parseArgs`, `node:fs/promises` (`readdir` with `withFileTypes`), Zod 4 for `PlaytestSchema` and for the CSV row values if it helps (tools may import `zod`). No CSV library: the parser is ~60 lines and its tests pin it.
- Node's `readdir` order is not guaranteed: always sort (AC 2).

### File structure

New:
- `content/playtest.json`, `content/_schemas/playtest.schema.json` (generated)
- `src/content/schemas/playtest.ts`, `playtest.test.ts`
- `tools/playtest/playtestMetrics.ts`, `metricsArgs.ts`, `csv.ts`, `observations.ts`, `loadJournals.ts`, `computeMetrics.ts`, `renderMetrics.ts`
- `tests/tools/playtest/csv.test.ts`, `observations.test.ts`, `loadJournals.test.ts`, `computeMetrics.test.ts`, `metricsArgs.test.ts`, `playtestMetrics.test.ts`, `support.ts`
- `docs/playtest/observation-sheet.md`, `docs/playtest/observations.example.csv`

Updated:
- `package.json` (the script), `src/shared/log.ts` (the `'playtest'` channel), `src/content/contentFiles.ts`, `src/client/assets/browserContentSource.ts` (+ its new `.test.ts`)
- `tools/sim/runSim.ts` only if `outProblem` moves to a shared helper
- `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`

### Testing

- Synthetic journals for the computation (fast, exact), real headless games only for the one end-to-end test (it proves the files 3.3 really writes are read). The end-to-end test reads live content: assert structure and agreement with `computeMetrics`, not tuned values.
- Temp dirs with `mkdtempSync(join(tmpdir(), 'pp-metrics-'))`, removed in `afterAll`.
- The CLI test may take a few seconds (two 3-min games headless): give it a timeout like `journalReplay.test.ts` (`120_000`).
- `src/sim` coverage cannot move (no sim change); `tools/` is outside the coverage thresholds.

### Previous story intelligence (3.3, 3.2, 1.12)

- **3.3** (merged `485906a`). It built the file this story reads and named what 3.4 needs. Its review left: `dominantDevice` approximate (closed here, AC 9); logs not scoped to a game (irrelevant here: logs are not read); `autoplay` fixed at boot (a bot started through `__PP__` shows `autoplay: null`: only Geo's test-API games, never a tester's). Its review also asked for exact assertions and Completion Notes that match the commits.
- **3.2.** `endReason` is `'timer' | 'mamaWoke'`; show it per game in the tester section (a woken Mama is useful context for « was it fun »).
- **1.12.** `runSim` / `simArgs` / `cli.test.ts` are the CLI pattern. A run file is `papa-parade.run` (AC 3 skips it).

### Git intelligence

- Recent: `485906a` (3.3 merged), `474f27b` (2.4 merged), `c77414f` (GDD v2.2 update: the two extra indicators, out of scope here), `2c52d53` (`ci:fast` and the « which check, when » rules in CLAUDE.md).
- This story is on `story/3-4-indicateurs-de-playtest`, in `.claude/worktrees/3-4-indicateurs-de-playtest`.
- It touches no file another open story is likely to touch, except `CLAUDE.md`, `project-context.md` and `deferred-work.md` (appended sections: the merge agent merges those itself).

### Project Structure Notes

- `tools/playtest/` is a new folder beside `tools/sim/`, as the architecture's CLI list implies (L1065-1067). Tests mirror it in `tests/tools/playtest/`.
- **Variance with the architecture (by design):** the architecture says « Le CLI `sim` sait relire ces journaux pour calculer les 5 indicateurs » (L297), but also names a separate `playtest:metrics` command (L1067); this story follows the epics and L1067 (its own command, reusing `sim:replay`'s parser). Only 3 of the 5 indicators can be computed; the other 2, and the observed half of the third, come from the CSV, as the epics say.

### Project context rules (from `_bmad-output/project-context.md`)

- Layers as in CLAUDE.md; `tools/` is Node only and never imported by `src/`.
- No `console.*` outside `shared/log.ts`; I/O returns `Result`; every fallback logs a `warn`.
- Anything Geo might tweak is data: the thresholds (`content/playtest.json`).
- Content ids are `lower_snake_case`, keys camelCase; generated schemas are committed, never edited by hand.
- No personal data, no network (NFR14): testers are pseudonyms; the CSV holds Geo's notes, not names.
- Shell trap: `env | grep VITE_` before `ci`; run `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Open points for Geo

1. **Report language.** The report is in English, like every tool's output, with the NFR11 numbers on each line. Say so if you want it in French (only `renderMetrics.ts` changes).
2. **The GDD v2.2 indicators** (fear of missing, the defeat felt fair, bot loss rates) are not here: they need `gds-correct-course` to land in `epics.md`. A CSV column `fearedMissing (O/N)` would be the natural extension then.
3. **Where the real data lives.** The command takes any folder. The journals hold no personal data, but the CSV comments are your notes about real people (by pseudonym). Default proposal: keep the journals folder outside the repo, and do not commit `docs/playtest/observations.csv` (only the example is committed). Say if you want them versioned, or git-ignored explicitly.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4 : Indicateurs de playtest (L1614-1636)]
- [Source: _bmad-output/planning-artifacts/epics.md (L135, L151, L154, L338)]
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Indicateurs de succès (L551-569), Hypothèses (L614)]
- [Source: _bmad-output/planning-artifacts/game-architecture.md (L294-297, L1065-1072, L1205)]
- [Source: _bmad-output/implementation-artifacts/3-3-journal-de-partie-exportable.md (AC 3, D4-D6, Review Findings)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md (L202, L417, L503)]
- [Source: src/content/schemas/journal.ts, src/client/telemetry/gameSummary.ts, src/content/contentFiles.ts, src/content/loadContent.ts, src/client/assets/browserContentSource.ts, tools/sim/replaySim.ts, tools/sim/runSim.ts, tools/sim/simArgs.ts, tests/tools/sim/journalReplay.test.ts, docs/playtest/device-measurements.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Implementation Plan

- **T1.** `PlaytestSchema` is a `z.strictObject` of seven integer keys (`…MinPct` in [0, 100], `panelMinTesters` ≥ 1), each with a `.describe()`. `PLAYTEST_FILE` is added to `CONTENT_FILES` only (the comment on the list now says a tool-only file is registered, not loaded); `loadContent` and `ContentBundle` are untouched, so no 3.3 `contentHash` moves. The browser glob excludes `content/playtest.json`, with a test (`browserContentSource.test.ts`).
- **T2.** `csv.ts` is a small state machine (quotes, `""`, quoted newlines, CRLF, BOM, `;` detection, blank lines skipped, line numbers of a record, error on an unterminated quote / a short row / text after a closing quote). `observations.ts` validates each cell with the rule of AC 4 and returns **all** errors of the file (each `file:line column name: …`), warnings for an extra column and an unknown threat id.
- **T3.** `loadJournals.ts` reads `<dir>/<testerId>/*.json` in `localeCompare('en')` order. A bad file is skipped with its reason (invalid JSON, `JournalSchema` path list from `parseJournalFile`, `papa-parade.run`, autoplay); layout errors (root `.json`, bad folder name, one session under two testers, one `(sessionId, gameIndex)` with two world hashes) are returned together.
- **T4.** `computeMetrics.ts` is pure. Status = `hits * 100 >= minPct * count` on integers; the touch/keyboard ratio is cross-multiplied the same way (`touch.hits * kb.total * 100 >= min * kb.hits * touch.total`) so 4/5 against 5/5 at 80 is exactly OK. Percentages in the report are rounded to one decimal after the status is decided.
- **T5.** `metricsArgs.ts` (`parseArgs`, strict, one positional), `renderMetrics.ts` (Markdown + `renderJson`), `playtestMetrics.ts` (`main`), `package.json` script. `outProblem` and `writeText` moved to `tools/outputFile.ts`; `runSim` imports them and behaves as before. `LogChannel` gets `'playtest'`.
- **T6-T7.** `docs/playtest/observation-sheet.md` (French), CLAUDE.md (Commands row and Playtest deployment step 5), `project-context.md`, `deferred-work.md` (L503 resolved, L417 moved to a « Deferred from: story 3-4 » section).

Decisions where the story left room:
- **Identification with several sessions** (AC 7): a row with an empty `sessionId` wins over a row with a session, else the earliest session in the order of the notes.
- **Keyboard rate 0**: the touch/keyboard ratio is undefined, so the status is `n/a` (not `OK`), the value `null`.
- **Warnings** from the computation (no game 1 in a session, session order unknown, a note for a session that is not the tester's, a tester with notes and no journal, a panel too small) are in `report.warnings`, after the readers' warnings.
- **`--out` still prints one `done` log line on stdout** (same as `runSim`); the report itself goes to the file only.

### Debug Log References

- `env | grep VITE_` printed nothing; `(unset VITE_DEBUG_ALLOWED; npm run ci)` was used all the same.
- A first run of the end-to-end test failed because I asserted an empty stdout with `--out`; the `info` log line `done` goes to stdout like `runSim`'s. The assertion now says the report is not on stdout.
- Two computation tests first expected only the « panel too small » warning; a lone game 2 also (rightly) raises « session … has no game 1 ». The expectations were corrected, not the code.
- Command run by hand on a synthetic fixture (3 journals for T1/T2, `docs/playtest/observations.example.csv`):

```
| Indicator | Value | Threshold | Counted on | Status |
| --- | --- | --- | --- | --- |
| Panel (FR68) | 2 testers | ≥ 5 | 2 | KO |
| 1. Relaunch, without being asked (computed) | 50 % (1/2) | ≥ 70 % | 2 | KO |
| 2. Perfect parry cited as a high point (observed) | 50 % (1/2) | ≥ 80 % | 2 | KO |
| 3. Readability: identified without help, each threat (observed) | lowest: coffee_table_object 0 % (0/1) | ≥ 80 % | 1–2 | KO |
| 3 (proxy). First-encounter success, each threat (computed) | lowest: silence_mischief 0 % (0/1) | ≥ 80 % | 1–2 | KO |
| 4. Touch success rate vs keyboard (computed) | 80 % (touch 80 %, keyboard 100 %) | ≥ 80 % | 5 touch + 3 keyboard responses | OK |
| 5. Laughed at least once (observed) | 50 % (1/2) | ≥ 80 % | 2 | KO |
```

### Completion Notes List

- Added `npm run playtest:metrics -- <dir>`: reads `<dir>/<testerId>/*.json` (exported journals) and Geo's notes CSV, prints the five NFR11 indicators per tester and overall (Markdown on stdout or `--out`, JSON with `--json`). A KO exits 0; an input to fix exits 1 with the file, line and column.
- Thresholds are data in `content/playtest.json` (validated, JSON Schema committed), tool-only: not in `ContentBundle`, excluded from the browser glob. The game, the sim, `JournalSchema`, the Result screen and the goldens did not change.
- New tests (`tests/tools/playtest/`: csv, observations, loadJournals, computeMetrics, renderMetrics, metricsArgs, playtestMetrics end to end on two real headless `salon_crawler` games exported through 3.3's builders), `playtest.test.ts` and `browserContentSource.test.ts`. Assertions use exact counts, percentages and statuses.
- I wrote each task's tests together with its code rather than watching them fail first; the exact-value assertions (4/5 at 80 OK, 3/5 KO, 0 testers n/a, ratio 80 vs 60) are what pin the behaviour.
- `npm run ci:fast` green (249 files, 4543 tests). Full `(unset VITE_DEBUG_ALLOWED; npm run ci)` green on the branch (exit 0): typecheck, lint, content:check, test:coverage, e2e (404 passed), build:playtest + dist:check, e2e:dist (dist specs and perf), build + dist:check prod.
- Open points for Geo are unchanged from the story (report language, GDD v2.2 indicators, where the real data lives).

### File List

New:
- `content/playtest.json`, `content/_schemas/playtest.schema.json`
- `src/content/schemas/playtest.ts`, `src/content/schemas/playtest.test.ts`
- `src/client/assets/browserContentSource.test.ts`
- `tools/outputFile.ts`
- `tools/playtest/csv.ts`, `testerId.ts`, `observations.ts`, `loadJournals.ts`, `computeMetrics.ts`, `renderMetrics.ts`, `metricsArgs.ts`, `playtestMetrics.ts`
- `tests/tools/playtest/csv.test.ts`, `observations.test.ts`, `loadJournals.test.ts`, `computeMetrics.test.ts`, `renderMetrics.test.ts`, `metricsArgs.test.ts`, `playtestMetrics.test.ts`, `support.ts`
- `docs/playtest/observation-sheet.md`, `docs/playtest/observations.example.csv`

Modified:
- `package.json` (`playtest:metrics`), `src/shared/log.ts` (`'playtest'` channel), `src/content/contentFiles.ts`, `src/client/assets/browserContentSource.ts`, `tools/sim/runSim.ts` (`outProblem`, `writeText` moved)
- `CLAUDE.md`, `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, this story file

### Change Log

- 2026-10-30: Story created (ready-for-dev).
- 2026-10-30: Implemented T1-T7 (thresholds as data, CSV and notes parser, journal loader, pure computation, report and CLI, French observation sheet, docs). `ci:fast` green.
- 2026-10-30: Full CI green; status → review.
