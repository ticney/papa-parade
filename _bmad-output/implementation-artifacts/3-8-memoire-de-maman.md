---
baseline_commit: d8709a1
---

# Story 3.8: Mémoire de Maman

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player who plays again,
I want Mama to remember my past disasters,
so that I laugh at her « *Encore* l'escalier ?! ».

Requirements: FR36 `[V1]` (« les répliques de Maman se souviennent des parties précédentes »), UX-DR13 (the `mum-bubble`). It builds on 3.7 (Mama's reactions: `mamaReactionsOf`, the `mama` phase of the Result screen, the `mum-bubble`, five fixed placeholder lines), 3.6 (`NearMissFrozen`), 2.7 / 2.8 / 2.10 (the versioned save, now at **v3**), 3.3 (the exported journal) and 3.16 (`mamaHome`). This story replaces 3.7's fixed lines; 3.9 (replay) and 3.11 (`progress`, stars per level) come after it.

**Scope in one line:** the save gets `mamaMemory.counts` (v3 → v4), the client adds the run's gag tags to it at the end of each level, and Mama's line for each reaction is now picked from a new `content/mama-lines.json` by a pure `@sim` function: the most specific line whose condition holds wins, a seeded draw breaks ties, and a generic line of the reaction is the fallback.

## Acceptance Criteria

### Tags and memory

1. **A tag is a gag id (D2).** The memory's tags are the sim's `GagId`s (`GAG_IDS`, `src/sim/threats/gags.ts:23`). There is no new `tags` field on `ThreatDef` and no content hash moves. The run's tags are the distinct `gag` of every `GagTriggered` (`src/sim/events.ts:323`) and every `NearMissFrozen` (`:335`; a near miss frozen on the photo has no `GagTriggered`) of the level. `NearMiss` (`:328`) always follows a `GagTriggered` with the same `gag`, so it adds nothing; counting it is harmless. A hidden-zone def (`silence_mischief`) gives the gag its draw picked (`tissues_everywhere` or `crayon_scribbles`).
2. **Pure helpers in the sim.** New `src/sim/scoring/mamaMemory.ts`, exported from `@sim` (`src/sim/index.ts`, beside `mamaReactionsOf` L58):
   - `mamaTagOf(event: SimEvent): GagId | null`: the `gag` of a `GagTriggered`, `NearMiss` or `NearMissFrozen`, otherwise `null`.
   - `addRunToMamaMemory(memory: Readonly<MamaMemory>, runTags: ReadonlySet<string>): MamaMemory`: a new object, `+1` per distinct tag of the run. It counts **games in which the tag happened**, not occurrences: five stair slides in one game add 1 (D3). The input is not changed, and a tag the content no longer knows is kept as it is.
   - `chooseMamaLines(...)`: AC 7.
   No `world` access, no `world.rng`, no event, no module state.
3. **Save v4 (D4).** `SAVE_VERSION` goes from **3 to 4** (`src/shared/constants.ts:622`). `SaveSchema` (`src/content/schemas/save.ts:69-79`) gains `mamaMemory: MamaMemorySchema`:
   - `MamaMemorySchema` is `strictObject({ counts: z.record(<snake id>, z.number().int().min(1)) })` (`SNAKE_ID_PATTERN` from `content/levelNodeNames.ts`). Its `.describe()` says « games in which each gag happened (story 3.8) ».
   - It is strict and has no `.optional()` or `.default()`, per the file's rule (L9-13).
   - The `SaveSchema` description names version 4. `createDefaultSave()` starts with `mamaMemory: { counts: {} }`.
   - Export the `MamaMemory` type from `@content`; the sim may import content types.
   - `SAVE_MIGRATIONS` (`src/client/save/saveStore.ts:32-60`) gains `{ from: 3, migrate }`: it keeps the calibration and every setting, adds `mamaMemory: { counts: {} }`, and writes its literal shape (never `createDefaultSave()`), like the two steps before it. A v1 save goes 1 → 2 → 3 → 4.
4. **Writing it.** `SaveStore` gains `recordMamaMemory(memory: MamaMemory): Promise<void>`, after `setSettings` (L242): it updates memory at once, then `write()`. Same failure path: warn once while the storage fails, and no write while read-only (a save from the future). The in-memory memory still grows in a read-only session, so « Encore » works within it.
5. **When a level ends (boot).**
   - `src/client/boot.ts` keeps `runMamaTags: Set<string>`. It is cleared in `onLevelStarted` (L1245) and on `AppStateChanged → loading` (L2296-2300, beside `resultScore = null`), and fed from `onSimEvent` with `mamaTagOf(event)`.
   - At `LevelScored` (L1794), before `appFsm.enter('result')`, boot does three things, in this order:
     1. It computes `resultMamaLines = chooseMamaLines({ reactions: mamaReactionsOf(score, resultEndReason), … memory: saveStore.current().mamaMemory, seed })`. That is the memory **before** this game, and `seed` is the level's seed (`StartedLevel.seed`, `levelSession.ts:151`).
     2. It calls `saveStore.recordMamaMemory(addRunToMamaMemory(before, runMamaTags))`. This is fire-and-forget, as `setSettings` is; its failure only warns.
     3. It hands `resultMamaLines` to the Result screen. `boot.ts:2058` no longer calls `mamaReactionsOf` itself.
   - A rebuilt Result screen (the portrait overlay) reuses `resultMamaLines`: the same lines, and no second count.
   - `resultMamaLines` is reset with `resultScore` on loading.
   - A level left before its end (pause → quit, restart) has no `LevelScored`, so nothing is counted.
   - **`?autoplay` neither reads nor writes the memory.** It picks from an empty memory and records nothing, with the same `isAutoplaying` check as `sendDifficultyTier` (L1194-1199, « `?autoplay` ignores the player's save »).

### Lines

6. **`content/mama-lines.json` and `MamaLinesSchema` (D5).** New `src/content/schemas/mamaLines.ts`: `MamaLinesSchema = strictObject({ $schema?, lines: array(MamaLineSchema).min(1) })`. `$schema` follows how the other single files declare it (`content/bots.json` L2). `MamaLineSchema` is a `strictObject`:
   - `id`: lower_snake, unique, through a local `idSchema(...)` like the other schema files declare one (e.g. `threat.ts:13`; each file has its own).
   - `reaction`: `z.enum(MAMA_REACTIONS)` (`shared/constants.ts:509`).
   - `text`: the same refinements as a UI string. **Export `StringValueSchema`** from `src/content/schemas/strings.ts:22`, and do not copy it: it is non-blank, never names failure, and uses tutoiement. On top of those, `text` is at most **60 characters** (`[ASSUMPTION]`, so the bubble fits 750 × 340) and has an **even number of `*`** (emphasis, AC 9).
   - `when` (optional): `strictObject({ tag?: snake id, minPrevious?: int ≥ 0, endReason?: string })`. It needs at least one key, and `minPrevious` only with `tag` (a refine with a clear message).
   - Each field has a `.describe()`.
   Register it as `MAMA_LINES_FILE` (`file: 'mama-lines.json'`, `schemaName: 'mamaLines'`) in `src/content/contentFiles.ts` (L23-69, and the `CONTENT_FILES` registry). Add `mamaLines: MamaLines` to `ContentBundle` (`src/content/contentBundle.ts:12`), with a doc comment: client-only through `chooseMamaLines`, outside every hash. Load it in `loadContent` (`src/content/loadContent.ts:37-70`) beside the four others. `npm run content:schemas` writes `content/_schemas/mamaLines.schema.json`. The browser source ships it with no change (`browserContentSource.ts` globs `content/**/*.json`).
7. **Which line (D6).** `chooseMamaLines({ reactions, endReason, runTags, memory, lines, seed }): readonly MamaReactionLine[]` returns, for each reaction in order, `MamaReactionLine = MamaReaction & { lineId: string; text: string }`.
   - **Candidates:** a line is a candidate for a reaction when its `reaction` matches and its `when` holds. A line with no `when` always holds. With `tag`, the tag must be in `runTags` and `memory.counts[tag] ?? 0` must be at least `minPrevious ?? 0`; `minPrevious` counts the *previous* games. With `endReason`, it must equal the level's end reason.
   - **Specificity:** the number of conditions (`tag`, `endReason`: 0, 1 or 2) first, then the larger `minPrevious`. The most specific candidates win.
   - **Tie-break:** among equals in file order, one is drawn with a **local** `createRng((seed ^ MAMA_LINES_SEED_SALT) >>> 0)` (`@shared/rng`; the salt in `shared/constants.ts`, beside `BOT_SEED_SALT` L383). There is one stream per call, drawn in reaction order and only when there are two or more equals. Never `world.rng`, never stored.
   - **Fallback:** with no candidate, the reaction's generic lines (no `when`) are the candidates. `content:check` guarantees there is at least one per reaction (AC 8), so the function never returns an empty line; it still `invariant`s on it.
   - The same inputs give the same lines.
8. **`content:check` (FR36 AC 3).** A new `checkMamaLineReferences` in `tools/content/contentChecks.ts`, called from `checkContent` (L1706-1849) with the other cross-references (L1817-1842), fails with a message that names the line's id and its JSON path when:
   - a `when.tag` is not in `GAG_IDS`, which is imported from `@sim` as the threat-gag check does (L393-399). Model the message on `checkLevelReferences` (L1349-1374);
   - a `when.endReason` is not in `LEVEL_END_REASONS` (`src/sim/events.ts:67`);
   - two lines share an `id`;
   - a reaction of `MAMA_REACTIONS` has no generic line.
   The schema-level failures (text rules, `*` parity, length, the `when` refines) come from `parseContentFile` as usual.
9. **The emphasis.** `*word*` in a line's text is shown as `<em>word</em>` in the bubble. A small client helper (e.g. `src/client/ui/emphasis.ts`, `appendEmphasizedText(parent, text, doc)`) builds text nodes and `em` elements, **never `innerHTML`**: the line is content, and the bubble is a live region. The `*` themselves are never shown. The bubble's accessible text is the line without the asterisks, plus the value (3.7's `pp-mum-bubble-value`). `em` is styled in `ui.css` with tokens only (`designTokens.test.ts`). Italic is enough; no colour for `mama-sigh` text (3.7 trap: contrast).
10. **The Result screen.** `ResultScreenOptions.reactions` (`resultScreen.ts:83`) becomes `readonly MamaReactionLine[]`. `lineKeyOf` (L310-316) is removed, and `showReaction` (L355-375) writes `reaction.text` through the helper of AC 9. Everything else about the `mama` phase stays as 3.7 left it: the order, the hold, the chip, the skip, the rebuild, the cues.
11. **The live content (D7).** `content/mama-lines.json` holds at least:
   - **3.7's five lines, moved.** `laugh_any` « Ha ha ! Tous les deux, alors… », `sigh_any` « Bon… qui range ? », `scream_woke` (`endReason: "mamaWoke"`) « Qui fait tout ce bruit ?! », `scream_home` (`endReason: "mamaHome"`) « Mais qu'est-ce qui s'est passé ici ?! », and `stairs_first` (`tag: "stairs_slide"`, `minPrevious: 0`) « Pas si près de l'escalier ! ».
   - **A new generic Scream,** `scream_any`, that names no place (`[ASSUMPTION]`, e.g. « Attention, voyons ! »). This closes `deferred-work.md` L1171.
   - **At least one `minPrevious: 1` line per reaction:** `stairs_again` (scream, `stairs_slide`) « *Encore* l'escalier ?! », `outlet_again` (laugh, `outlet_hair`) « *Encore* ce brushing ?! », and `tablecloth_again` (sigh, `dishes_on_floor`) « *Encore* la nappe ?! ».
   - **A few first-time tag lines,** e.g. `outlet_first` (laugh) « Joli brushing ! », `asleep_first` (laugh, `papa_asleep`) « Tu dormais debout ? », `dishwasher_first` (sigh, `baby_in_dishwasher`) « Le bébé… dans le lave-vaisselle ? », and `plant_again` (sigh, `soil_on_rug`, 1) « *Encore* ma plante ?! ».

   Every line is exasperated and loving. None shames the parent or names failure (EXPERIENCE › Voice and Tone, NFR9), and none repeats the headers « Maman s'est réveillée ! » / « Maman est rentrée plus tôt ! ». They are placeholders Geo rewrites: data, no comment in the JSON. The five keys `result.mama_line_*` are **removed** from `content/strings.fr.json` (L86-90; keep `result.mama_value_gain|loss`), along with every reference to them (`resultScreen.ts`, `resultScreen.test.ts`, `tests/content/stringsSchema.test.ts`, `tests/e2e/mamaReactions.spec.ts`).

### Test handle and docs

12. **The test API.** `__PP__` gains `mamaLines(): readonly MamaReactionLine[] | null`: the lines of the current Result, `null` before the first `LevelScored` and after loading. Wire it through `testHost.ts` and `debug/testApi.ts` like the other readers, and `tests/support/fakeTestHost.ts`. Specs assert the bubble against it, and pin known lines independently (AC 13), so the e2e no longer copies the product logic (3.7 Review › Defer: `lineKeyOf` in `mamaReactions.spec.ts`). There is no new `data-pp-*` mirror.
13. **E2E proof (Chromium), new `tests/e2e/mamaMemory.spec.ts`,** on `salon_crawler`, with a fixed `?seed`, letting the stairs threat time out (no press) until `events()` holds a `GagTriggered` `stairs_slide`, then ending the level as the 3.7 specs do:
    - a. **First time.** From the default (v4, empty memory) save, the Scream bubble reads « Pas si près de l'escalier ! » (no `<em>`). After the Result shows, `localStorage['papa-parade.save'].mamaMemory.counts.stairs_slide === 1`.
    - b. **Again.** With a save seeded with `{ stairs_slide: 1 }`, or by playing a second game in the same page, the bubble reads « Encore l'escalier ?! » with `Encore` inside an `em`, and the count becomes 2.
    - c. **Migration.** A seeded v3 save (calibration and settings of the old `calibratedSave`) loads as v4 with `counts: {}`, the calibration and settings kept.
    - d. **Rebuild.** A portrait rebuild of the Result shows the same line, and the count is unchanged.
    - e. **Autoplay.** An `?autoplay=idle` game writes no `mamaMemory` change.
14. **Docs.**
    - **Architecture** (`game-architecture.md`):
      - « Persistance » (L289-297): save v4, `mamaMemory` counts games per gag id.
      - P7 « Mémoire de Maman » (L843-847): tags are gag ids, the selection is a pure `@sim` function the client calls, with the local seeded draw. Fix the example to `stairs_slide` / « *Encore* l'escalier ?! ».
      - The data table L1024-1026: `mama-lines.json` is « sim (sélection, fonction pure), client », and the save row no longer says « mémoire de Maman passée à `createSim` ».
      - The `createSim` contract L1069: drop `mamaMemory?`.
      - Each with « (story 3.8, D1) ».
    - **`project-context.md`:**
      - « Persistence » (L178): **Save v4 (story 3.8)**.
      - The storageState line (L161): a v4 save.
      - A new « Mama's memory (story 3.8) » section: tags, when they are counted, `chooseMamaLines` and its rule, the content file and its checks, `?autoplay`, `__PP__.mamaLines()`.
    - **GDD** › Note de Maman L502: one sentence on the rule (most specific line, games counted per gag, tie drawn).
    - **EXPERIENCE** L175 and L237 already say it: keep them, and replace « l'étagère » by « l'escalier » where the game line is cited (L589 stays illustrative).
    - **`deferred-work.md`:** close L1163 (the lines part) and L1171.
    - **`decision-log.md`** (GDD): D1, D3 and D6.

## Tasks / Subtasks

- [x] Task 1: Memory and lines, pure (AC: 1, 2, 7)
  - [x] `MAMA_LINES_SEED_SALT` in `shared/constants.ts`; `src/sim/scoring/mamaMemory.ts` (`mamaTagOf`, `addRunToMamaMemory`, `chooseMamaLines`, `MamaReactionLine`) and its test; export from `src/sim/index.ts`
- [x] Task 2: Content (AC: 6, 8, 11)
  - [x] `src/content/schemas/mamaLines.ts`; export `StringValueSchema`; `MAMA_LINES_FILE`; `ContentBundle.mamaLines`; `loadContent`; `createTestContent` (`tests/support/testContent.ts:183`) gets a small fixture with one generic line per reaction
  - [x] `content/mama-lines.json`; drop the five `result.mama_line_*` keys; `npm run content:schemas`
  - [x] `checkMamaLineReferences` and its tests in `tests/content/checkContent.test.ts`; a schema test file `tests/content/mamaLinesSchema.test.ts`
- [x] Task 3: Save v4 (AC: 3, 4)
  - [x] `SAVE_VERSION` 4, `MamaMemorySchema`, `createDefaultSave`; `{ from: 3 }` migration; `recordMamaMemory`
  - [x] `saveStore.test.ts` (a v3 → v4 describe beside L424, v1 → v4 in one load, `recordMamaMemory` write / warn-once / read-only), `save.test.ts` (refuses 3 and 5, a bad count, a non-snake key), `calibratedSave.ts` → v4 with `mamaMemory` (a third parameter `counts`), `tests/content/calibratedSave.test.ts`
- [x] Task 4: Boot and the Result screen (AC: 5, 9, 10, 12)
  - [x] `runMamaTags`, `resultMamaLines`, the `LevelScored` order, the `?autoplay` guard, the rebuild reuse
  - [x] The emphasis helper and its unit test (no `innerHTML`, asterisks gone, accessible text); `ui.css` `em`
  - [x] `resultScreen.ts`: `MamaReactionLine`, no `lineKeyOf`; `resultScreen.test.ts` passes lines with text (an emphasized one too) and keeps its other assertions
  - [x] `__PP__.mamaLines()` in `testHost.ts`, `debug/testApi.ts` (+ test), `fakeTestHost.ts`, `tests/e2e/support/testApi.ts`
- [x] Task 5: Integration and e2e (AC: 13 and all)
  - [x] A headless two-game test with the live content (`tests/bots/mamaMemoryLive.test.ts`, see Testing)
  - [x] `tests/e2e/mamaMemory.spec.ts`; adapt `mamaReactions.spec.ts` (its `lineKeyOf` and `STRINGS['result.mama_line_*']` go, the bubble is checked against `mamaLines()`)
  - [x] Screenshots in `_bmad-output/implementation-artifacts/3-8-screenshots/`: the first-time and « Encore » bubbles (with the `em`) at 844 × 390 and 750 × 340
- [x] Task 6: Docs (AC: 14)
  - [x] `npm run ci:fast` after each task, plus the touched specs on Chromium

## Dev Notes

### Decisions

- **D1. The selection is a pure `@sim` function the client calls, not world state (deviation from the architecture's `createSim({ mamaMemory })`).** The architecture (L1026, L1069) passes the memory to `createSim` and says the sim selects. Taken literally, that costs a lot:
  - The memory would have to enter the replay: a journaled `SetMamaMemory` command, or journal v4.
  - The world would need the run's tags and the chosen lines: snapshot 34 → 35 and every golden `worldHash`.
  - A `world.rng` draw at the end would move every golden that reaches the end.
  - A new event would be needed too.
  All of that is for a choice that changes no gameplay and happens after `LevelScored`, when the level is frozen. 3.7 D1 left this call to 3.8. The memory is the player's save (the client's), and the reactions are already a pure reading of the note (`mamaReactionsOf`). So the selection is `chooseMamaLines`, in `src/sim/scoring/mamaMemory.ts`, where the architecture tree puts it (L510). It is called by boot with the save's memory, the run's tags (read from the events boot already sees) and the level's seed. **No `createSim` option, no command, no event, no snapshot version, no journal change, and no golden moves.** If one does, it is a bug. **Geo confirmed it on 2026-11-07** (open point 1); the architecture text is updated (AC 14).
- **D2. Tags are gag ids.** The sim already has a closed, checked list (`GAG_IDS`), every gag and near-miss event carries one, and nothing hashed changes. A new `tags` field on `ThreatDef` would change every `levelHash` (`createSim.ts:885-887` hashes the whole `LevelContent`) and so every golden, for no gain today. Grouping several gags under one tag (« tous les bazars du silence ») can come later as data. The GDD's « étagère » is the stairs in this game (`frozenNearMiss.ts`: « en haut de l'étagère » se lit « au haut de l'escalier »), so the GDD's example becomes `stairs_slide` / « *Encore* l'escalier ?! ».
- **D3. A count is a number of games.** « *Encore* » means « again, like last time », not « for the fifth time today ». `addRunToMamaMemory` adds 1 per tag per game, whatever the number of times it happened in the game. Every end counts (`timer`, `cycleDone`, `mamaWoke`, `mamaHome`); a quit does not (no `LevelScored`).
- **D4. Save v4, not v2.** The epic says « v1 → v2 si nécessaire »; the save is at v3 since 2.10. The field comes with its migration, as the architecture asks (« chaque champ est ajouté par la story qui l'utilise »). `progress` (stars per level) is 3.11's and is **not** added here.
- **D5. `text` in the file, checked like a UI string.** The architecture's example and the epic put `text` in `mama-lines.json`, not a `strings.fr.json` key. The project rule « strings live in `strings.fr.json` » is about the UI chrome; Mama's lines are content Geo writes with their conditions, and keeping each line beside its condition is what makes the file editable. The trade-off is localisation: a later `mama-lines.<lang>.json` is the path, and it is not this story's. To keep one standard, `text` reuses `StringValueSchema` (failure words, tutoiement).
- **D6. Specificity = conditions, then `minPrevious`, then a seeded draw.** A line about this game's stairs beats a generic one. « *Encore* » (`minPrevious: 1`) beats « first time » (`minPrevious: 0`) once the memory has it. An end-reason line and a tag line have equal weight, so a woken Mama who also saw a stair slide picks one of the two at random; a line with both conditions beats both. The draw is a local stream from the level's seed (D1): reproducible from a journal's seed and memory, and off `world.rng`. Geo shapes all of it with data (add a both-conditions line to force one).
- **D7. The placeholder lines.** 3.7's five lines move into the file with their conditions, so every 3.7 case reads the same as before, except the generic Scream. « Pas si près de l'escalier ! » played for any near miss (`deferred-work.md` L1171); it becomes the `stairs_slide` line, and a neutral generic Scream takes its place. One « *Encore* » line per reaction lets each reaction remember.

### Current state of the files this story changes

Line numbers checked on 2026-11-07 on `main` d8709a1 (3.7 merged).

- **`src/sim/scoring/mamaReactions.ts`** (37 lines): `MamaReaction { reaction; points }` and `mamaReactionsOf(score, reason)`. It is pure and is not changed. `MamaReactionLine` extends `MamaReaction`.
- **`src/sim/threats/gags.ts`**:
  - `GAG_IDS` (L23-43) and `GagId` (L45).
  - `NEAR_MISS_GAGS` (~L180): only `stairs_slide` is a near miss.
  - `outlet` has `catastrophe: "nearMiss"`, but its gag `outlet_hair` is not a near miss (« D3: not a near miss », L70). It still enters the memory through its `GagTriggered`.
- **`src/sim/events.ts`**: `LEVEL_END_REASONS` (L67), `GagTriggered` (L323), `NearMiss` (L328), `NearMissFrozen` (L335, between `LevelEnded` and `LevelScored`), `LevelScored` (L579). The events carry the instance `threatId` and the `gag`, never the def id.
- **`src/content/schemas/save.ts`**: `SaveSchema` (L69-79, version 3: calibration + settings), `createDefaultSave` (L102), and the no-optional rule (L9-13).
- **`src/client/save/saveStore.ts`**: `SAVE_MIGRATIONS` (L32-60: 1→2, 2→3, literal shapes), `migrateSave` (L75-127), `createSaveStore` (L154), `write()` (L165: read-only no-op, warn once), `setSettings` (L242: the model for `recordMamaMemory`). `load()` sets aside unusable data under `papa-parade.save.invalid`, keeps a future save read-only, and writes back a migrated one.
- **`src/client/boot.ts`**:
  - `createSaveStore` (L466) and `await saveStore.load()` (L2480).
  - `isAutoplaying` and `sendDifficultyTier` (L1191-1199).
  - `onLevelStarted` (L1245).
  - `onSimEvent`: `LevelEnded` → `resultEndReason` (L1791), and `LevelScored` (L1794-1811: `resultScore`, mirrors, `finish()`, the photo, `appFsm.enter('result')`).
  - `resultScore` / `resultEndReason` (L1132-1134).
  - The Result factory (L2042-2088; `reactions: mamaReactionsOf(...)` at L2058).
  - The reset on loading (L2296-2300).
- **`src/client/ui/screens/resultScreen.ts`**: `reactions` option (L79-83), `lineKeyOf` (L310-316), the bubble DOM (L317-344), `showReaction` (L355-375: `bubbleText.textContent = t(lineKeyOf(reaction))` at L358). Its header comment still calls the fixed lines placeholders for 3.8 (~L227): update it.
- **`content/strings.fr.json`** L84-92: `result.mama_woke`, `result.mama_home` (headers, kept), the five `result.mama_line_*` (removed), `result.mama_value_gain|loss` (kept).
- **`src/content/contentFiles.ts`** (single files L23-56, registry L63-69), **`contentBundle.ts`** (L12: `{ feel, feedback, bots, strings }`), **`loadContent.ts`** (L37-70: `Promise.all` of four, then problems, then `ok({...})`).
- **`src/content/schemas/strings.ts`**: `StringValueSchema` (L22-31, not exported today) and `FORBIDDEN_FAILURE_WORDS` (L10).
- **`tools/content/contentChecks.ts`**: the gag check against `GAG_IDS` from `@sim` (L393-399), `checkLevelReferences` (L1349), and `checkContent` (L1706-1849: every `content/**/*.json` must be registered, schemas up to date, then the cross-references at L1817-1842).
- **`tests/support/testContent.ts`** `createTestContent` (L183-197) builds the bundle the goldens use: add `mamaLines`. It is outside every hash, so no golden moves.
- **`tests/e2e/support/calibratedSave.ts`** (L16-40, `version: 3`): the Playwright `storageState` of every spec. It becomes v4 with `mamaMemory: { counts: {} }`.
- **`src/shared/rng.ts`**: `createRng`, `nextInt(rng, min, maxExcl)`. `src/bots/botSeed.ts` is the salted-seed model.

### What must keep working

- Every 3.7 behaviour of the `mama` phase: order, hold, chip, figure, cues, skip, rebuild, `isDone`, the woke and home headers after the reactions, and the fit at 750 × 340 and 844 × 390 (`mamaReactions.spec.ts` FITS). The longest line is 60 characters: check the fit with the longest live line.
- `photo.spec.ts`, `result.spec.ts`, `mamaWoke.spec.ts`, `catastrophe.spec.ts`, `chambreNight.spec.ts`, `salonKitchen.spec.ts`, `calibration.spec.ts`, `settings.spec.ts`, `reducedMotion.spec.ts`, `fakeSleep.spec.ts`. The last four seed `localStorage`: a seeded v3 save must still load (it migrates).
- Goldens, snapshot (34), journals, `npm run sim`, `sim:replay`, `sim:balance`: **untouched**.

### Traps

- **The e2e storage is shared within a page.** Once memory is written, a second game in the same page sees it. A spec that pins a line by text after a restart must seed or compute the memory. `mamaLines()` is the handle for « what was chosen ». Fresh contexts start from `calibratedSave` (v4, empty memory).
- **`calibratedSave` is every spec's state.** Bump it to v4 in the same commit as `SAVE_VERSION`, or about 140 specs boot on a « future » or « unusable » save. `tests/content/calibratedSave.test.ts` parses it.
- **The memory to choose with is the one before the game.** Choose, then record. The other way round, every first time reads « *Encore* ».
- **Count once per game.** Use a `Set` of tags, not a list. A rebuild never records. `recordMamaMemory` is called from the `LevelScored` branch only.
- **Do not draw `world.rng`** and do not add anything to `World`: D1. `tests/architecture` forbids `Math.random` in `src/sim` (`scanners.ts:361`); a local `createRng` is allowed and is the documented pattern here.
- **`content` may not import the sim.** `GAG_IDS` and `LEVEL_END_REASONS` are checked in `tools/content/contentChecks.ts` (tools may import `@sim`), not in the schema; `MAMA_REACTIONS` is `shared`'s, so the schema can use it.
- **The new file must be registered,** or `content:check` fails with « no schema registered » (L1761). Its `_schemas` file is generated; never edit it by hand.
- **Never `innerHTML`** for the emphasis (the CSP is fine either way; the rule is the content-as-code risk and the live region).
- **`VITE_DEBUG_ALLOWED=false` may be exported:** run `env | grep VITE_` first, and `(unset VITE_DEBUG_ALLOWED; …)` if it is.
- **The worktree guard** refuses compound shell commands naming `git`, shell variables in option positions and `git -C`: use plain commands.
- **The Mac sleeps during background runs:** run long ones under `caffeinate -i -s`; e2e through `npm run e2e -- …` in the background (heavy lock).

### Out of scope

- `progress` (best stars, unlocks, fail streak): 3.11 and its own save version.
- Lines in the exported playtest journal (`JournalSchema`'s summary): possible later if Geo wants to know what testers read; not asked.
- A `--mama-memory` option for `npm run sim`, and lines in the sim report: the sim does not choose lines (D1).
- Generated voice lines, a 3D Mama: E7 / later (3.7 D5).
- Tags other than gag ids, and grouping tags: later, as data.
- A reset of the memory in the settings: not asked.

### Architecture compliance

- The `src/sim` layer stays pure: `mamaMemory.ts` imports `shared` and content *types* only, and holds no state. `@sim` is `src/sim/index.ts` only.
- `content` imports `shared` and `zod` only: `MamaLinesSchema` uses `MAMA_REACTIONS` and `StringValueSchema`. The `GAG_IDS` / `LEVEL_END_REASONS` checks are `tools/`'.
- Only `platform/web/webStorage.ts` touches `localStorage`; the client goes through `saveStore`. I/O returns `Result`; every fallback warns.
- Everything Geo tunes is data: the lines, their conditions and reactions in `mama-lines.json`.
- The architecture text deviates on purpose (D1) and is updated in this story.

### Library and framework notes

No new dependency, no upgrade (Zod 4 pinned: `z.strictObject`, `z.record(key, value)`, `.refine`, `.describe`, as the other schemas use them). No web research needed.

### File structure

- **New:** `src/sim/scoring/mamaMemory.ts` and test, `src/content/schemas/mamaLines.ts`, `content/mama-lines.json`, `content/_schemas/mamaLines.schema.json` (generated), the emphasis helper and its test in `src/client/ui/`, `tests/content/mamaLinesSchema.test.ts`, `tests/bots/mamaMemoryLive.test.ts`, `tests/e2e/mamaMemory.spec.ts`, `_bmad-output/implementation-artifacts/3-8-screenshots/`.
- **Updated:**
  - sim: `src/sim/index.ts`;
  - shared: `src/shared/constants.ts`;
  - content: `src/content/{contentFiles,contentBundle,loadContent}.ts`, `src/content/schemas/{save,strings}.ts`, `content/strings.fr.json` (the save has no generated JSON Schema: it is not a content file);
  - client: `src/client/save/saveStore.ts` (+ test), `src/client/boot.ts`, `src/client/ui/screens/resultScreen.ts` (+ test), `src/client/ui/styles/ui.css`, `src/client/app/testHost.ts`;
  - debug: `src/debug/testApi.ts` (+ test);
  - tools: `tools/content/contentChecks.ts`;
  - tests: `tests/support/{testContent,fakeTestHost}.ts`, `tests/e2e/support/{calibratedSave,testApi}.ts`, `tests/content/{checkContent,calibratedSave,stringsSchema,loadContent}.test.ts`, `src/content/schemas/save.test.ts`, `tests/e2e/mamaReactions.spec.ts`;
  - the docs of AC 14.

### Testing

- **Pure (`mamaMemory.test.ts`), table-driven:**
  - `mamaTagOf` over every event type: only the three return a gag.
  - `addRunToMamaMemory`: once per game, input untouched, unknown keys kept.
  - `chooseMamaLines`:
    - generic fallback per reaction;
    - tag line beats generic only with the tag in `runTags`;
    - `minPrevious` reads the memory *before*;
    - `endReason`;
    - two conditions beat one;
    - a reaction never takes another reaction's line;
    - a tie is the same for the same seed and both lines come out over a range of seeds;
    - an empty `reactions` gives `[]`;
    - the PRNG state of a `world` is not involved: the function takes no world.
- **Content:** schema tests for every refine (blank, `vous`, a failure word, 61 characters, an odd `*`, `minPrevious` without `tag`, an empty `when`, an unknown reaction). `checkContent` tests on a temp content root (the existing pattern of `checkContent.test.ts`) for an unknown tag, an unknown end reason, a duplicate id and a reaction with no generic line, each with its message. `loadContent` returns `mamaLines`.
- **Save:** the v3 → v4 describe (calibration and settings kept, literal shape), v1 → v4, the schema refusing 3 and 5, `recordMamaMemory` (write, warn once on a failing storage, no write when read-only, memory updated anyway).
- **Live, headless (`tests/bots/mamaMemoryLive.test.ts`):** two games of the real `createSim` with the live content on `salon_crawler` (the `idle` bot lets the stairs threat through; find a seed whose first game has a `GagTriggered stairs_slide` and say which). Collect the tags with `mamaTagOf`, choose with an empty memory (the Scream line is `stairs_first`), add the run, play the second game, and choose again: `stairs_again`. This is the golden rule's « playable without a human » proof of FR36.
- **Client unit:** the emphasis helper (nodes, no `*`, `textContent` of the bubble), `resultScreen.test.ts` with lines, `testApi` `mamaLines` (null, then the lines).
- **E2E (Chromium):** `mamaMemory.spec.ts` (AC 13 a-e) plus `mamaReactions.spec.ts` adapted; then the specs of « What must keep working » that seed or read the save, and `testApi.spec.ts`.
- **Look at it.** Screenshots of the first-time and « *Encore* » bubbles on `salon_crawler` at both sizes; say what you saw (italic legible, no asterisk, the bubble fits) and what you did not capture.
- **Checks:** `npm run ci:fast` per task, plus the touched specs on Chromium. `ci:story` belongs to the review.

### Previous story intelligence

- **3.7 Review › Defer:** the e2e copied the product's line logic (`lineKeyOf`); this story removes the copy with `mamaLines()` (AC 12). Tests that would pass with the feature broken were found again in 3.6 and 3.7: assert on the actual text and count, not only « some text ».
- **3.7:** `createResultScreen`'s options are required. Every existing call in `resultScreen.test.ts` must pass lines with `text` (a fixed list is fine in a test). `StringsSchema` forbids « vous »: Mama tutoies Papa (« Tous les deux, alors… »).
- **3.7:** the bubble is a live region present from the start (review fix: empty, then filled). Filling it with `em` nodes must keep that: replace children, do not recreate the bubble.
- **2.7 / 2.8 / 2.10:** each migration writes its literal shape, the e2e fixture moves with the version, and a v(n-1) save seeded by a spec must keep loading.
- **3.16 / 3.6:** a woken or home-early end screams before its header; the end-reason lines keep that.

### Git intelligence

`main` is at d8709a1, the merge of 3.7 (« Story 3.7 : merge de story/3-7-reactions-de-maman-et-degaine-de-papa »), after 9.8. This branch was cut from 44af629 and fast-forwarded to d8709a1 before this file was written. The closest models: 3.7 for the Result screen and `mamaReactionsOf`; 2.10 for a save version and its migration; 9.4 / 3.15 for a content file with cross-references in `contentChecks.ts`.

### Project Structure Notes

It follows the layers and aliases. `content/mama-lines.json` is kebab-case like the other cross-cutting files (project-context › Content). `sim/scoring/mamaMemory.ts` is where the architecture tree puts it (L510). The one variance is D1 (no `createSim` option), which is documented and reflected in the architecture.

### Project Context Rules

- Anything Geo might tune is data: the lines, their `when` and `reaction`.
- Units are suffixes; `…At` is sim time. Factories are `create<Name>` and pure helpers are verbs or `…Of`. Booleans are `is…` / `has…`. No `enum`, no `namespace`.
- The sim never logs and never reads time or randomness, except `world.rng` for gameplay; this story adds a local, seeded, non-gameplay stream (D1, D6).
- No `console.*`; I/O returns `Result`, and every fallback logs a `warn`.
- UI text is French, uses tutoiement, never names failure, and is at least 16 px; Mama is exasperated and loving.
- Never weaken a guardrail or widen the CSP. No merge without a review, a green `ci:story` and Geo's OK.

### Open points for Geo

1. ~~**D1: the line is chosen by the client, through a pure sim function, not inside `createSim`.** This is a deviation from the architecture's `createSim({ mamaMemory })`. Nothing in replays, goldens or the snapshot moves. Confirm, or ask for the in-sim version (journaled memory, snapshot 35, an event, every golden).~~ **Confirmed by Geo on 2026-11-07:** the pure `@sim` function called by the client, with no `createSim` option. The architecture text is updated as AC 14 says.
2. **D2: tags are gag ids** (`stairs_slide`, `outlet_hair`…), so « l'étagère » becomes « l'escalier ».
3. **D3: memory counts games**, not occurrences.
4. **D6: a woken Mama who also saw a stair slide picks one of the two lines at random.** A line with both conditions overrides that.
5. **The lines are placeholders (D7).** There is a new neutral generic Scream, and the 60-character cap is an `[ASSUMPTION]` for the 750 × 340 fit.
6. **`?autoplay` leaves the memory alone.** Bots never pollute the player's Mama.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.8] L1817-1833, FR36 (L75)
- [Source: _bmad-output/planning-artifacts/game-architecture.md] Persistance L289-297, P7 L836-847, data table L1018-1027, `createSim` contract L1069, source tree L510, L551, naming L630
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Note de Maman] L484-502
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md] L105 (Result step 2), Voice and Tone L133-137, L175, L237, L543, L588-589
- [Source: _bmad-output/project-context.md] Persistence L178-181, e2e storageState L161, Content naming L136, « Papa's look and Mama's reactions (story 3.7) »
- [Source: _bmad-output/implementation-artifacts/3-7-reactions-de-maman-et-degaine-de-papa.md] D1, D6, AC 10-19, Review Findings (Defer)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] L1163, L1171
- [Source: src/sim/scoring/mamaReactions.ts], [src/sim/threats/gags.ts], [src/content/schemas/save.ts], [src/client/save/saveStore.ts], [tools/content/contentChecks.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`).

### Debug Log References

- `npm run ci:fast`: typecheck, lint (90 warnings, the same count as on `main`: none is new), `content:check` (38 files), 450 test files, 9 926 tests passed, 60 skipped. Run after each task and once more after the docs.
- Specs run on Chromium: `mamaMemory.spec.ts` and `mamaReactions.spec.ts` (37 passed, 2 skipped: the screenshot tests, which run only with `PP_SCREENSHOTS_DIR`); then `reducedMotion`, `calibration`, `fakeSleep`, `settings`, `testApi`, `result`, `photo`, `mamaWoke` and `instinct` (112 passed, 6 failed). The 6 were assertions pinned to the old save version and API: `calibration.spec.ts:119` and `settings.spec.ts:373, 831, 862` expected `version` 3, `settings.spec.ts:875` seeded « a save from a newer game » at version 4 (now 5, so it is still from the future), and `testApi.spec.ts` listed fourteen `__PP__` methods (now fifteen, with `mamaLines`). Fixed, and `calibration`, `settings` and `testApi` rerun alone: 46 passed.
- Nothing moved in the sim's behaviour: no snapshot version, no journal change, no golden regenerated (`npm run golden:update` was not run).

### Completion Notes List

- **Pure sim (AC 1, 2, 7).** `src/sim/scoring/mamaMemory.ts` holds `mamaTagOf`, `addRunToMamaMemory`, `chooseMamaLines` and `MamaReactionLine`, exported from `@sim`. Specificity is compared by `compareSpecificity` (number of conditions, then `minPrevious`); a tie draws from `createRng((seed ^ MAMA_LINES_SEED_SALT) >>> 0)` only when two or more lines tie. `MAMA_LINES_SEED_SALT` is `0x4d414d41` (« MAMA » in ASCII): an arbitrary constant, like `BOT_SEED_SALT`. The function has no world, no event and no state.
- **Content (AC 6, 8, 11).** `MamaLinesSchema` (`src/content/schemas/mamaLines.ts`) reuses the now exported `StringValueSchema`, caps `text` at 60 characters (`MAMA_LINE_MAX_CHARS`, `[ASSUMPTION]`) and requires an even number of `*`; `when` needs a key, and `minPrevious` needs `tag`. `content:check` has `checkMamaLineReferences` (unknown tag, unknown end reason, duplicate id, a reaction with no generic line). `content/mama-lines.json` holds 13 lines: 3.7's five (moved), the neutral `scream_any`, `stairs_again` / `outlet_again` / `tablecloth_again` / `plant_again` (« *Encore* … »), and `outlet_first`, `asleep_first`, `dishwasher_first`. The five `result.mama_line_*` strings are gone with every reference. The longest live line is `scream_home` (37 characters); its fit at 844 × 390, 667 × 375 and 750 × 340 is pinned by the existing `mamaReactions.spec.ts` FITS.
- **Save v4 (AC 3, 4).** `SAVE_VERSION` 4, `MamaMemorySchema` (strict, snake-id keys, counts ≥ 1), `createDefaultSave` with an empty memory, a `{ from: 3 }` migration that writes its literal shape, and `saveStore.recordMamaMemory` (memory first, then `write()`: warn once, nothing written when read-only, memory still grows). `calibratedSave` is v4 and takes `counts` as a third parameter.
- **Boot and the Result screen (AC 5, 9, 10, 12).** `boot.ts` keeps `runMamaTags` and `levelSeed`; at `LevelScored` it chooses with the memory **before** the game, then records, then the screen reads `resultMamaLines` (a rebuilt screen reuses it and never counts again). `?autoplay` chooses from an empty memory and records nothing. `client/ui/emphasis.ts` builds text nodes and `em` elements (never `innerHTML`); the bubble keeps its live region (its text is emptied and refilled), and `ui.css` makes `em` italic only. `createResultScreen` takes `MamaReactionLine[]`; `lineKeyOf` is gone, and its `doc` option now also needs `createTextNode`. `__PP__.mamaLines()` goes through `TestHost`, `testApi.ts`, `fakeTestHost.ts` and `tests/e2e/support/testApi.ts`; it returns a copy.
- **Tests.** Unit: `mamaMemory.test.ts` (21 cases), `mamaLinesSchema.test.ts`, the new `checkContent` describe, `loadContent`, `save.test.ts`, `saveStore.test.ts` (v3 → v4, v1 → v4 in one load, `recordMamaMemory`), `emphasis.test.ts`, `resultScreen.test.ts` (lines, an emphasized one, the live region kept; its `FakeElement` now has a DOM-like `textContent` and the fake `doc` a `createTextNode`), `testApi.test.ts`. Headless proof on the live `salon_crawler` (`tests/bots/mamaMemoryLive.test.ts`): the `idle` bot, the first of seeds 1 to 20 that ends on the timer with a stair slide and a Scream, gives `stairs_first` with an empty memory, then `stairs_again` once the first game is recorded. E2E: `tests/e2e/mamaMemory.spec.ts` covers AC 13 a to e, plus « a game counts once », « a level left before its end counts nothing » and `mamaLines()` being `null` before and after; `mamaReactions.spec.ts` now asserts the bubble against `mamaLines()` and pins the woken and home-early lines by id and text, so the `lineKeyOf` copy is gone (3.7 Review › Defer).
- **Screenshots** (`3-8-screenshots/`, written by `PP_SCREENSHOTS_DIR=<dir> npm run e2e -- tests/e2e/mamaMemory.spec.ts --project=chromium -g screenshots`): `first-time` and `encore` at 844 × 390 and 750 × 340, on `salon_crawler`, Result at rest. **What I saw:** « Encore » is legible in italics in the same ink as the rest, no asterisk is shown, and the bubble sits inside the left column at both sizes without touching the panel. At 750 × 340 « Pas si près de l'escalier ! » wraps with the « ! » alone on a second line (the bubble is 230 px wide, as in 3.7): cosmetic, left for Geo (`text-wrap: balance` on the bubble would fix it). **Not captured:** the other reactions' lines, the `mamaWoke` / `mamaHome` ends, a rebuilt (portrait) screen and WebKit.
- **Docs (AC 14).** Architecture (persistance, P7 with `stairs_slide`, the data table, the `createSim` contract), `project-context.md` (a v4 save, the storageState line, a new « Mama's memory (story 3.8) » bullet, and the 3.7 bullet's pointers), GDD › Note de Maman and `decision-log.md` (D1, D2/D3, D6), EXPERIENCE L175 (L237 already said it; L589 stays illustrative), `deferred-work.md` (the lines part of L1163 and L1171 closed).
- **Decisions kept from the story, not re-opened:** D1 (the choice is a pure `@sim` function the client calls), D2 (tags are gag ids), D3 (games, not occurrences), D6 (specificity, then a seeded draw). Open point 4 stands: a woken Mama who also saw a stair slide picks one of the two lines at random; add a both-conditions line to force one.
- **Not run, by design:** `npm run ci:story` and `npm run ci` (the review runs the gate before the merge), WebKit, `sim:balance`, `e2e:dist` and `perf.spec.ts`.

### File List

**New**
- `src/sim/scoring/mamaMemory.ts`, `src/sim/scoring/mamaMemory.test.ts`
- `src/content/schemas/mamaLines.ts`, `content/mama-lines.json`, `content/_schemas/mamaLines.schema.json` (generated)
- `src/client/ui/emphasis.ts`, `src/client/ui/emphasis.test.ts`
- `tests/content/mamaLinesSchema.test.ts`, `tests/bots/mamaMemoryLive.test.ts`, `tests/e2e/mamaMemory.spec.ts`
- `_bmad-output/implementation-artifacts/3-8-screenshots/` (`first-time-844x390.png`, `first-time-750x340.png`, `encore-844x390.png`, `encore-750x340.png`)

**Modified**
- Sim and shared: `src/sim/index.ts`, `src/shared/constants.ts`
- Content: `src/content/contentBundle.ts`, `src/content/contentFiles.ts`, `src/content/loadContent.ts`, `src/content/schemas/save.ts`, `src/content/schemas/save.test.ts`, `src/content/schemas/strings.ts`, `content/strings.fr.json`
- Client: `src/client/boot.ts`, `src/client/app/testHost.ts`, `src/client/save/saveStore.ts`, `src/client/save/saveStore.test.ts`, `src/client/ui/screens/resultScreen.ts`, `src/client/ui/screens/resultScreen.test.ts`, `src/client/ui/styles/ui.css`
- Debug: `src/debug/testApi.ts`, `src/debug/testApi.test.ts`
- Tools: `tools/content/contentChecks.ts`
- Tests: `tests/content/calibratedSave.test.ts`, `tests/content/checkContent.test.ts`, `tests/content/loadContent.test.ts`, `tests/content/stringsSchema.test.ts`, `tests/support/fakeTestHost.ts`, `tests/support/testContent.ts`, `tests/e2e/mamaReactions.spec.ts`, `tests/e2e/calibration.spec.ts`, `tests/e2e/settings.spec.ts`, `tests/e2e/testApi.spec.ts` (save version and method list), `tests/e2e/support/calibratedSave.ts`, `tests/e2e/support/testApi.ts`
- Docs and tracking: `_bmad-output/planning-artifacts/game-architecture.md`, `_bmad-output/project-context.md`, `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md`, `_bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/decision-log.md`, `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, `_bmad-output/implementation-artifacts/3-8-memoire-de-maman.md`

### Change Log

- 2026-11-07: Story 3.8 implemented. Mama's lines come from `content/mama-lines.json` through the pure `chooseMamaLines`; the save is v4 with `mamaMemory.counts` (games per gag); the Result bubble shows `*word*` in italics; `__PP__.mamaLines()` added. No golden, snapshot or journal change.
