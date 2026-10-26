---
baseline_commit: 625a94b24a3ca47b80604f6cbef603682a4421ee
---

# Story 1.2: Content pipeline and feel file

Status: review

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.2 « Pipeline de contenu et fichier de feeling ». Epics, GDD and architecture are in French; this file is in English (document_output_language). The French strings that go into content/strings.fr.json are quoted verbatim. -->

## Story

As Geo, game designer,
I want every feel value of the GDD in one validated file,
so that I can tune them without ever touching the logic.

**Requirements covered:** FR64 (content as data, validated), FR65 (single feel file; the panel arrives in story 2.1), UX-DR2 (all strings in `content/strings.fr.json`), NFR12 (content validated automatically).

## Acceptance Criteria

1. **Feel schema and file.** Given `src/content/schemas/feel.ts` (`FeelSchema`, Zod) and `content/feel.json`, when the file is loaded, then it contains every starting value listed in Dev Notes › Feel keys (timing, inputs, movement, fatigue, instinct, difficulty tiers, Mama's score, touch radius).
   - And every numeric key carries a unit suffix (`Ms`, `Pct`, `PerSec`, `Deg`, `Px`, `Scale`, `Multiplier`, `Points`, `Count`, `Stars`, `Mps`), enforced by a test.
   - And the schema is strict (an unknown key is an error), has no default values and no transform (every key is written in the file), and every key has a `.describe()` text (it becomes the tooltip in the editor).
2. **`loadContent`.** Given `src/content/loadContent.ts`, when a content file does not respect its schema, then `loadContent` returns a failed `Result` that carries, for every problem, the file path (`content/feel.json`) and the faulty JSON path (`timing.windowMs`).
   - And a file that is missing, is not valid JSON, or has a duplicate key is a problem of the same shape.
   - And in dev (`import.meta.env.DEV`), the error is shown on screen by a detailed error screen. That screen is not part of the production bundle.
3. **`content:check`.** Given `npm run content:check`, when it runs, then it validates every `*.json` under `content/` (except `_schemas/`) against its schema and exits with code ≠ 0 on the slightest invalid file.
   - And a JSON file under `content/` that has no registered schema is an error (a new file is not done until it has a schema).
   - And it also fails when `content/_schemas/*.json` is out of date with the Zod schemas (message: run `npm run content:schemas`).
4. **`content:schemas`.** Given `npm run content:schemas`, when it runs, then `content/_schemas/*.schema.json` is regenerated with `z.toJSONSchema`, and `content/feel.json` references its schema through `$schema` (editor autocomplete) without that key being an error for the validator or for the editor.
5. **Strings.** Given `src/content/schemas/strings.ts` (`StringsSchema`) and `content/strings.fr.json`, when `content:check` runs, then the strings file is validated: keys are unique and well-formed, no value is empty.
   - And a string key referenced by code (`t('some.key')`) or by another content file (a property whose name ends in `Key`) but absent from the strings file makes the check fail.
   - And the file contains, from this story on, the canonical strings of `EXPERIENCE.md` › Voice and Tone (list in Dev Notes › Strings), in the tutoiement register, with no mention of « échec », « perdu », « game over » or « mort » (tested on every value).
6. **Feel merge.** Given `src/content/feelMerge.ts`, when a level declares `feelOverrides`, then the effective `Feel` is the deep merge of `feel.json` and the overrides, validated by `FeelSchema`, and unit tested (nested objects merged, arrays replaced, inputs not mutated, unknown or badly typed override rejected, `__proto__` safe).

## Tasks / Subtasks

- [x] **T1 — Content error types and JSON helpers (AC 2, 3)**
  - [x] `src/content/contentError.ts`: `ContentProblem { file: string; jsonPath: string; message: string }` and `ContentError extends AppError { kind: 'content'; problems: ContentProblem[] }` (`AppError` from `@shared/result`). `file` is repo-relative (`content/feel.json`); `jsonPath` is `''` for the root.
  - [x] `src/content/jsonPath.ts`: `formatJsonPath(path: PropertyKey[]): string` → `timing.windowMs`, `mama.starThresholdPoints[2]`, and `["start.tap_to_start"]` for a segment that is not a plain identifier (strings keys contain dots).
  - [x] `src/content/duplicateKeys.ts`: `findDuplicateKeys(jsonText: string): { jsonPath: string; key: string }[]`. A small string-aware tokenizer (JSON.parse silently keeps the last duplicate). Handles nested objects and arrays, escaped quotes and braces inside strings. No parser dependency.
  - [x] `src/content/parseContentFile.ts`: `parseContentFile<T>(file: string, text: string, schema: ZodType<T>): Result<T, ContentProblem[]>`. Steps: strip a BOM → duplicate keys → `JSON.parse` (catch is allowed here: this is I/O-like input parsing; map the error to a problem, never silent) → drop a top-level `$schema` key → `schema.safeParse` → map every Zod issue to a `ContentProblem`. For `unrecognized_keys` the Zod path is the parent object and the offending keys are in `issue.keys`: emit one problem per key with the key appended to the path (verified on zod 4.6.7).
  - [x] Unit tests next to each file with synthetic input (no file reads in `src/content` tests): path formatting, duplicate keys (nested, escaped, in arrays), BOM, bad JSON, unknown key path, `$schema` ignored.
- [x] **T2 — `FeelSchema` and `content/feel.json` (AC 1)**
  - [x] `src/content/schemas/feel.ts`: `FeelSchema = z.strictObject({...})` with the groups and keys of Dev Notes › Feel keys. `export type Feel = z.infer<typeof FeelSchema>`. No `.default()`, `.transform()`, `.preprocess()`, `.optional()` (they break the 1:1 file ↔ type ↔ JSON Schema mapping). Every key: `.describe('…')` in English with the unit and, when it exists, the GDD reference.
  - [x] Cross-field rules with `.refine` (error `path` on the faulty key): `perfectMs ≤ windowMs`; `microSleepMinMs ≤ microSleepMaxMs`; `starThresholdPoints` strictly ascending, length 5, each in 0–100; `babyStateFixedPoints ≤ babyStateMaxPoints`; every `timeScale` in (0, 1]; every `…Pct` in 0–100; every `…Ms`, `…Multiplier`, `…Points` ≥ 0 (> 0 for `windowMs`, `perfectMs`, `holdMinMs`, durations). Integers (`z.int()`) for `…Count` and `…Stars`.
  - [x] `content/feel.json`: written by hand with the values of the table, `"$schema": "./_schemas/feel.schema.json"` as first key. Run `npm run format` so Biome accepts it.
  - [x] `tests/content/feelSchema.test.ts` (Node, reads the real `content/feel.json` through the Node source of T6): the real file parses; negative cases derived from it by mutation (`structuredClone` then break one key): unknown key, string instead of number, `perfectMs > windowMs`, unsorted `starThresholdPoints`, `earlyPress: 'maybe'`, missing group. **Never pin the tunable values themselves** (Geo will change them; the golden rule). Check structure, ranges and rules only.
  - [x] Unit-suffix test: walk the leaves of the real file; every numeric leaf's key (the array's key for an array) must match `/(Ms|Pct|PerSec|Mps|Deg|Px|Scale|Multiplier|Points|Count|Stars)$/`. Booleans and strings are exempt. Also: every property of the emitted JSON Schema has a `description`.
- [x] **T3 — `StringsSchema`, `content/strings.fr.json`, voice rules (AC 5)**
  - [x] `src/content/schemas/strings.ts`: `STRING_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/` (at least two dot-separated segments, `lower_snake_case`), `StringsSchema = z.record(z.string().regex(STRING_KEY_PATTERN), z.string().min(1))`, refinements: value is not whitespace-only; no value matches the forbidden-words pattern; no value contains `vous`, `votre` or `vos` as a whole word (tutoiement). Export `type Strings = z.infer<typeof StringsSchema>` and `FORBIDDEN_FAILURE_WORDS`.
  - [x] Forbidden words, Unicode-aware (JS `\b` is ASCII-only): `/(?<![\p{L}])(échecs?|echecs?|perdu(?:e|s|es)?|perdre|game over|mort(?:e|s|es)?)(?![\p{L}])/iu`. Test it on `ÉCHEC`, `perdu`, `Game Over`, and on harmless words (`Recommencer`, `dormir`, `permet`).
  - [x] Voice rules by key namespace: every `verb.*` value is uppercase and ends with `" !"` (plain space then `!`, as `EXPERIENCE.md` writes them): `/^[\p{Lu}'’ -]+ !$/u`. Test with a passing and a failing fixture.
  - [x] `content/strings.fr.json`: the strings of Dev Notes › Strings, with exactly those keys. Copy the wording from `EXPERIENCE.md` character for character (straight apostrophes, `…` U+2026, `−1` with U+2212, plain spaces).
  - [x] `tests/content/stringsSchema.test.ts`: the real file parses; the required keys of the table exist (keys are pinned, texts are not: Geo may reword them); forbidden-word and tutoiement tests; key pattern negatives (`Bad Key`, `single`, `UPPER.case`); empty value; duplicate key reported with its name.
- [x] **T4 — `loadContent`, `ContentBundle`, `ContentSource` (AC 2)**
  - [x] `src/content/contentFiles.ts`: the registry `CONTENT_FILES = [{ file: 'feel.json', schemaName: 'feel', schema: FeelSchema }, { file: 'strings.fr.json', schemaName: 'strings', schema: StringsSchema }]`. Single source for `loadContent`, `content:check` and `content:schemas`. Later stories add entries (threats, levels…) and extend the entry shape when they need directories.
  - [x] `src/content/contentBundle.ts`: `ContentBundle { feel: Feel; strings: Strings }` (later stories add threats, levels, feedback…; `createSim` in story 1.3 receives it).
  - [x] `src/content/contentSource.ts`: `interface ContentSource { read(file: string): Promise<Result<string>> }`. `file` is relative to `content/` (`'feel.json'`). The source returns the raw text so that `parseContentFile` produces uniform errors. `src/content` never touches `fs` or `fetch`.
  - [x] `src/content/loadContent.ts`: `loadContent(source: ContentSource): Promise<Result<ContentBundle, ContentError>>`. Reads and parses every registered file, collects the problems of **all** files (do not stop at the first), then checks string references (T5). Success → `ok(bundle)`. Failure → `err(contentError)` with a one-line `message` such as `content/feel.json › timing.windowMs: … (+2 more)`. It does not log (the caller does).
  - [x] `tests/content/loadContent.test.ts` with an in-memory `ContentSource` built from the real files and mutated: valid → ok; broken `timing.windowMs` → problem with `file: 'content/feel.json'` and `jsonPath: 'timing.windowMs'`; invalid JSON text; a file the source cannot read; duplicate key; both files broken → both reported; a string reference to a missing key.
- [x] **T5 — String references (AC 5)**
  - [x] `src/content/stringRefs.ts`: `findStringKeyReferences(value: unknown): { jsonPath: string; key: string }[]` walks parsed JSON and collects every string value stored under a property whose name ends in `Key` (`verbKey`, `labelKey`…). Convention: a content file that points at a string uses a `…Key` property; a literal UI string in a content file is a review failure. `findMissingStringKeys(refs, strings)`. Unit tests with synthetic objects (nested, arrays, non-string values ignored).
  - [x] `loadContent` applies it to every loaded file except the strings file itself (no content file has a `…Key` property yet, so nothing is exercised by real data: the unit tests carry the proof).
- [x] **T6 — Node content source and `content:check` (AC 3, 5)**
  - [x] `tools/content/nodeContentSource.ts`: `createNodeContentSource(contentDir: string): ContentSource` (`node:fs/promises`; a read error becomes a `Result` error, never a throw).
  - [x] `tools/content/contentChecks.ts`: `checkContent(rootDir: string): Promise<ContentProblem[]>` (the logic, importable by tests). It: (1) walks `<rootDir>/content` for `*.json`, skipping `_schemas/` and non-JSON files; (2) for each file, finds its registry entry by relative path (`strings.fr.json`, later `threats/outlet.json`) or reports `no schema registered for this file`; (3) parses with `parseContentFile`; (4) runs `findStringKeyReferences` on every parsed file; (5) scans `<rootDir>/src/**/*.ts` (skipping `*.test.ts`, `*.spec.ts`, fixtures) for literal `t('…')` calls, after removing `//` and `/* */` comments, regex `(?<![\w$.])t\(\s*(['"])([^'"\n]+)\1\s*\)`; a non-literal argument cannot be checked and is ignored; (6) compares the schema files on disk with the emitted ones (T7) and reports drift.
  - [x] `tools/content/checkContent.ts` (the existing placeholder, remove the "Replaced by story 1.2" comment): CLI wrapper. Prints every problem as `content/feel.json › timing.windowMs: message` through `log.error('content', …)`, then sets `process.exitCode = 1`; on success `log.info('content', 'content OK', { files: n })`.
  - [x] `tests/content/checkContent.test.ts`: build temp directories (`fs.mkdtemp`, copy the real `content/` and `src` pieces needed, then mutate): the real repo returns `[]`; unregistered `content/extra.json`; invalid feel; a stray key; `_schemas/` ignored; `t('missing.key')` in `src/client/x.ts` fails while `t('start.tap_to_start')` passes; `t(variable)` ignored; same call inside a comment and inside a `*.test.ts` ignored; schema drift reported; a `verbKey` pointing at a missing string reported.
- [x] **T7 — JSON Schema emission (AC 4)**
  - [x] `src/content/jsonSchema.ts`: `toContentJsonSchema(schema)`: `z.toJSONSchema(schema)` plus, when the root has `properties`, an extra `properties.$schema = { type: 'string' }` so that `"$schema"` in the data file is not flagged (the strict schema emits `additionalProperties: false`). Deterministic output.
  - [x] `tools/content/emitSchemas.ts`: for each registry entry writes `content/_schemas/<schemaName>.schema.json` (2-space JSON, trailing newline). `package.json`: add `"content:schemas": "tsx tools/content/emitSchemas.ts"`. Commit the generated files (editor autocomplete must work without running anything). Do not hand-edit them; `biome.json` already excludes `content/_schemas`.
  - [x] `content/feel.json` references `./_schemas/feel.schema.json`. `strings.fr.json` has no `$schema` (a flat record: the editor gains nothing and the key pattern would flag it).
  - [x] Test: emitted text equals the file on disk (this is the drift check); `$schema` property present; no `$ref` loops or `unrepresentable` errors (`.refine` is ignored by Zod's emitter, verified on 4.6.7).
- [x] **T8 — `feelMerge` (AC 6)**
  - [x] `src/content/feelMerge.ts`: `mergeFeel(base: Feel, overrides: unknown, origin = 'feelOverrides'): Result<Feel, ContentError>`. Deep merge of plain objects, arrays and scalars replaced as a whole, `undefined` skipped, inputs never mutated (returns fresh objects). An `overrides` that is not a plain object is a problem. Then `FeelSchema.safeParse(merged)`: this rejects unknown keys, wrong types and broken cross-field rules, and reports them with `file: origin`. Also export `type DeepPartial<T>` and `type FeelOverrides = DeepPartial<Feel>` for the level schema (story 1.10).
  - [x] Prototype safety: `JSON.parse('{"__proto__": {"x": 1}}')` creates an own `__proto__` property. The merge must copy keys with `Object.defineProperty` (or build via `Object.fromEntries`), never with `target[key] = …` on a key from the data, and the result must come out as a validation error for an unknown key, with `Object.prototype` untouched. Test it, and assert `({}).x === undefined` after.
  - [x] `tests/content/feelMerge.test.ts` (base = the real file): empty overrides → equal to base and a different object; nested override changes one leaf and leaves siblings; array replaced; base not mutated; unknown key; `windowMs: 'x'`; override that breaks `perfectMs ≤ windowMs` is rejected; `__proto__` case; root not an object.
- [x] **T9 — Browser source and dev error screen (AC 2)**
  - [x] `src/client/assets/browserContentSource.ts`: `createBrowserContentSource(): ContentSource` built on `import.meta.glob(['../../../content/**/*.json', '!../../../content/_schemas/**'], { eager: true, query: '?raw', import: 'default' })`. Strip the `…/content/` prefix to get the `file` key. A missing file → `err({ kind: 'content', message: … })`. This is the only place of `src` that touches the content folder; the relative glob resolves to a path outside `src`, which the layer scanner does not classify (verified: `classifyZone` returns null). If `layerBoundaries` still complains, add the narrowest possible allowance with its own fixture and say so in the Completion Notes; never loosen an existing rule.
  - [x] `src/client/app/contentErrorScreen.ts` + `src/client/app/contentErrorScreen.css`: `showContentError(root: HTMLElement, error: ContentError): void`. A full-screen overlay `pp-content-error` with `role="alert"`, a title, then one block per problem with file, JSON path and message. Build it with `createElement` and `textContent` (never `innerHTML`). Plain technical English: this screen is dev-only and is not a player string, so it does not go through `t()`. Its CSS lives in its own file imported by the module (no inline style, CSP-safe), not in `ui.css`: story 1.5's "no hard-coded colour in `ui.css`" test must not trip on it.
  - [x] `src/main.ts` (temporary wiring, story 1.4 moves it into `client/boot.ts`): `async function main()` (no top-level await); `loadContent(createBrowserContentSource())`; on failure `log.error('content', error.message, error.problems)` and, only `if (import.meta.env.DEV)`, `const { showContentError } = await import('@client/app/contentErrorScreen'); showContentError(document.getElementById('pp-ui')!, error)` (no non-null assertion if Biome forbids it: check the element). On success `log.info('content', 'content loaded')`.
  - [x] Production check: `npm run build`, then `grep -r "pp-content-error" dist` finds nothing (the screen is tree-shaken). Record the result in the Completion Notes.
  - [x] `tests/e2e/contentError.spec.ts` (chromium; try webkit too): with the dev server, `page.route(/content\/feel\.json/, route => route.fulfill({ contentType: 'text/javascript', body: 'export default "{ \\"timing\\": {} }"' }))` before `goto('/')` (the glob makes Vite serve the file as a JS module; inspect the real request URL first and adjust the pattern); assert `.pp-content-error` is visible and mentions `content/feel.json`. Add the counterpart: with the real content, no `.pp-content-error` and `boot.spec.ts` stays green. If webkit cannot intercept the module request, skip that project with a comment that says why.
- [x] **T10 — Scripts, docs, hygiene (AC 3, 4)**
  - [x] `package.json`: add `content:schemas`. `content:check` keeps its name and path. The Vitest `include` stays as is (tool and content-file tests live in `tests/content/`).
  - [x] `CLAUDE.md`: in the Commands table, change `content:check` to "Validate `content/**` against the Zod schemas, string references and generated JSON Schemas" and add `content:schemas` ("Regenerate `content/_schemas/`"). Remove "placeholder until story 1.2". Keep the file under ~120 lines.
  - [x] Do not commit (the sprint workflow leaves that to Geo or the review). Leave `_bmad/`, `docs/`, `.claude/` untouched.
- [x] **T11 — Verify (all ACs)**
  - [x] `npm run ci` passes end to end (typecheck, lint, content:check, test, e2e on chromium and webkit, build:playtest).
  - [x] `npm run content:schemas` leaves `git status` unchanged (idempotent). Break `content/feel.json` by hand (`"windowMs": "x"`): `npm run content:check` exits ≠ 0 and names `content/feel.json` and `timing.windowMs`; restore the file.
  - [x] Open `npm run dev` in the built-in browser with a broken `feel.json`: the error screen appears; with a valid file the game shell shows and the console is empty.
  - [x] Confirm that no other guardrail was touched: `tests/architecture/**` unchanged unless T9's glob forced a documented, narrow allowance.

## Dev Notes

### What exists today (story 1.1, done)

- `src/shared/{log,result,constants}.ts` with tests. `log.<level>(channel, message, data?)`, the `content` channel exists. `Result<T, E = AppError>`, `ok()`, `err()`, `AppError { kind; message; cause? }`. **Reuse them; do not add another result or logging helper.**
- `tools/content/checkContent.ts` is a placeholder that logs `no content schemas yet`. This story replaces it. `package.json` already has `content:check`; the CI workflow and `npm run ci` already call it.
- `content/` holds only `.gitkeep` (keep or remove it once a file exists). `src/content/` holds only `.gitkeep`. No `zod` import exists yet (installed: `zod@4.6.7`).
- `src/main.ts` only imports the CSS and logs `shell ready`. `index.html` has `#pp-canvas` and `#pp-ui`.
- Biome overrides for `src/content/**` ban `three`, `@sim`, `@bots`, `@client`, `@platform`, `@debug`, `@capacitor`, `@dimforge`. `src/main.ts` may import `@client/*` and `@content/*` but not `@debug/*`. Aliases: `@content/*` (no bare `@content`), `@shared/*`, `@client/*`; `tsx` and Vitest resolve them from `tsconfig.json`.
- The scanners in `tests/architecture/scanners.ts` read the first pattern of `import.meta.glob(...)`, and treat a relative path that leaves `src/` for a root folder as "not a layer" (allowed).

### Feel keys (starting values, GDD v2.1)

Camel-case keys, grouped as below. All values are **starting values** that Geo tunes, so none is pinned by a test. Source: GDD › Mécaniques de jeu (1, 2, 3, 6, 9), Accessibilité, Note de Maman; epics 1.2.

| Group | Key | Value | Source / note |
|---|---|---|---|
| `timing` | `telegraphDelayDefaultMs` | 1200 | Default when a threat's `telegraphDelayMs` is `null`. GDD gives 0.8 to 1.5 s per threat (outlet 1.2 s): `[ASSUMPTION]` for the default. Per-threat delays stay in threat JSON (story 1.10) |
| | `windowMs` | 300 | Standard response window |
| | `perfectMs` | 100 | Perfect window, centred (name used by the architecture's `EffectiveWindow`) |
| | `toleranceMs` | 60 | Hidden tolerance, each side |
| | `bufferMs` | 100 | Input buffer |
| | `hitstopMs` | 80 | Hitstop on a successful response |
| | `slowMoPerfect` | `{ timeScale: 0.3, durationMs: 1200 }` | Slow-mo on a perfect response |
| | `slowMoLastThreat` | `{ timeScale: 0.2, durationMs: 1500 }` | Slow-mo on the last threat of a wave |
| `input` | `holdMinMs` | 400 | ADR-010: release before = Parry, at or after = Firmness. Do **not** add `tapMaxMs` |
| | `earlyPress` | `"fail"` | Enum `"fail" \| "guard"` |
| | `touchRadiusPx` | 48 | `[ASSUMPTION]`: no GDD number. "Generous" radius in screen px (touch targets are ≥ 44 pt) |
| | `autoTargetConeDeg` | 60 | Epics 1.17 pins "60° by default, in feel.json" |
| `movement` | `glideMaxMs` | 600 | Papa's glide, at most |
| `fatigue` | `perSec` | 0.5 | +0.5/s |
| | `carriedMultiplier` | 2 | ×2 while carrying (applies from E4) |
| | `thresholdPoints` | 70 | Above it: windows reduced, micro-sleeps |
| | `windowPenaltyPct` | 20 | Windows −20 % |
| | `microSleepMinMs`, `microSleepMaxMs` | 8000, 12000 | Micro-sleep every 8 to 12 s |
| | `coffeeReductionPoints` | 40 | Coffee: −40 |
| | `coffeeDurationMs` | 3000 | Coffee takes 3 s |
| `instinct` | `timeScale` | 0.8 | Light slow-mo |
| | `windowBonusPct` | 30 | Windows +30 % |
| | `durationMs` | 4000 | |
| | `cooldownMs` | 30000 | Recharge |
| | `minActiveThreatsCount` | 3 | Trigger: 3 active threats… |
| | `missesCount`, `missesWithinMs` | 2, 10000 | …and 2 misses in 10 s |
| `difficulty` | `assistance`, `normal`, `experienced` | `{ windowMultiplier: 1.5, hasInstinct: true }`, `{ 1, true }`, `{ 0.75, false }` | GDD tiers: +50 %, base, −25 %; "Papa expérimenté" has no instinct. Story 2.8 reads them (it may rename the tier ids) |
| `mama` | `laughMaxPoints` | 40 | Laugh 0–40 |
| | `babyStateMaxPoints`, `babyStateFixedPoints` | 30, 20 | Baby state 0–30; the prototype uses the fixed value (decision of Geo, 2026-10-26, replaced by the real computation in E5) |
| | `baseScorePoints` | 30 | The "+30" of the formula |
| | `sighMaxPoints`, `screamMaxPoints` | 15, 15 | Penalties 0 to −15 each |
| | `starThresholdPoints` | `[20, 40, 60, 75, 90]` | 1 to 5 stars |
| | `earlyWakePenaltyStars` | 1 | Mama woke early: −1 star |

Rules:
- This is the **whole** seed for this story. Do not add keys from later stories (noise sources, phone, final rush, camera, music, props, speeds…): each story adds its own keys, with their defaults, to `FeelSchema` and `feel.json`. `autoTargetConeDeg` is the one early addition (already pinned in the epics); `silenceAlertMs` is added by story 1.21.
- Deviation from the architecture's illustrative snippet (`carriedMultiplier`, `threshold`): the key is `thresholdPoints`, because epics 1.2 requires a unit suffix on every key.
- The unit-suffix list is the allowlist of T2. A new kind of unit later extends the allowlist in the test, deliberately.
- `tier` objects and `slowMo*` objects are nested groups (no suffix needed on group names).

### Strings (T3)

Seed exactly these keys (`group.name`, `lower_snake_case`). Text is verbatim from `EXPERIENCE.md` › Canonical on-screen strings. Every wording is `[ASSUMPTION]` until Geo reviews it; keys are what code will depend on.

| Key | Text |
|---|---|
| `start.tap_to_start` | Touche pour commencer |
| `fridge.title` | Le frigo |
| `fridge.new_unlock` | Nouveau ! |
| `calibration.audio_prompt` | Tape en rythme avec les bips |
| `calibration.visual_prompt` | Tape à chaque flash |
| `calibration.too_few_taps` | Pas assez de taps, on recommence ? |
| `calibration.skip_audio` | Pas de son ? Passe au visuel |
| `calibration.done` | Calé ! |
| `loading.line_bottle` / `loading.line_toys` / `loading.line_keys` | Préparation du biberon… / On range les jouets… / On cache les clés de voiture… |
| `age.first_level` | Âge 1 |
| `age.crawler` / `age.early_childhood` / `age.childhood` / `age.adolescence` / `age.adult` | Bébé à 4 pattes / Petite enfance / Enfance / Adolescence / Adulte |
| `verb.lift` / `verb.firm` / `verb.swap` | SOULÈVE ! / FERME ! / ÉCHANGE ! |
| `verb.put_down_first` | POSE-LE D'ABORD ! |
| `verb.dodge` | ESQUIVE ! |
| `stamp.perfect_parry` / `stamp.replay` | PARADE PARFAITE / REPLAY |
| `silence.bubble` | … |
| `gauge.fatigue` / `gauge.noise` / `gauge.urge` | Fatigue / Bruit / Envie |
| `key.space` | Espace |
| `pause.title` / `pause.resume` / `pause.restart` / `pause.settings` / `pause.quit_to_fridge` | Pause / Reprendre / Recommencer / Réglages / Quitter vers le frigo |
| `pause.gamepad_disconnected` | Manette débranchée. Rebranche-la pour reprendre. |
| `countdown.step_3` / `countdown.step_2` / `countdown.step_1` | 3 / 2 / 1 |
| `result.mama_woke` / `result.next_age_unlocked` | Maman s'est réveillée ! / Nouvel âge débloqué ! |
| `result.score_laughs` / `result.score_baby_state` / `result.score_no_sigh` / `result.score_no_scream` | Rires / État du bébé / Sans soupir / Sans hurlement |
| `result.star_lost` | −1 |
| `result.replay_button` / `result.next_age` / `result.fridge` | Rejouer / Âge suivant / Frigo |
| `result.unlock_hint` | 2 étoiles pour débloquer |
| `result.assist_card` | Envie de souffler ? Essaie le mode Assistance |
| `result.copy_log` / `result.log_copied` / `result.download_log` | Copier le journal / Journal copié ! / Télécharger le journal |
| `settings.difficulty` | Difficulté |
| `settings.tier_assistance` / `settings.tier_assistance_hint` | Assistance / Fenêtres plus larges, instinct activé |
| `settings.tier_normal` / `settings.tier_normal_hint` | Normal / Le jeu tel qu'il est pensé |
| `settings.tier_experienced` / `settings.tier_experienced_hint` | Papa expérimenté / Fenêtres serrées, aucune aide |
| `settings.applies_next_game` | Appliqué à la prochaine partie |
| `settings.volume_music` / `settings.volume_sfx` / `settings.volume_voice` / `settings.volume_ui` | Musique / Effets / Voix / Interface |
| `settings.haptics` / `settings.reduced_motion` / `settings.large_verbs` | Vibrations / Réduire les animations / Grands verbes |
| `settings.recalibrate` / `settings.credits` | Recalibrer / Crédits |
| `oops.message` / `oops.retry` | Oups ! Quelque chose s'est renversé. / Réessayer |
| `portrait.rotate` | Tourne ton téléphone |

**Deliberately not seeded:**
- « Sûr ? Le niveau sera perdu. » (armed label of "Quitter vers le frigo"). It contains « perdu », which the same document and this story's AC forbid (`EXPERIENCE.md` › Voice and Tone, NFR9). The conflict is Geo's to settle; the string arrives with story 3.11 once reworded. The seeding test must stay strict (it must not exempt this word).
- « *Encore* l'étagère ?! »: the table says it is illustrative; Mama's lines come from `mama-lines.json` (story 3.8).
- `aria-label` texts: each button's label is added by the story that creates the button (1.5 onward), through the same file.
- Verbs per threat: the architecture sketches `"verb": "SOULÈVE !"` inline in a threat JSON, while UX-DR2 puts every string in this file. Seeding `verb.*` keys lets a threat use `"verbKey": "verb.lift"` (the `…Key` convention of T5). Story 1.10/2.2 settles which one the threat schema uses.

### Architecture guardrails

- **Layers.** `src/content` imports only `@shared/*` and `zod`. It must never read files or call `fetch`: reading is injected through `ContentSource`. Node implementation in `tools/content/` (tools may import anything, `src` never imports `tools`), browser implementation in `src/client/assets/`. Tests under `src/**` cannot import `tools` (R8): anything that needs the real `content/` files or the Node source lives in `tests/content/`. This is why those tests are not colocated.
- **Single reader.** "Only `loadContent()` reads content JSON" (project-context). The browser source is the adapter handed to it, not a second reader. Never `import feel from '../../content/feel.json'`.
- **Result and logging.** I/O returns `Result`. `loadContent` never throws and never logs. Callers (`main.ts`, the CLI) log on the `content` channel. `try/catch` is allowed only around `JSON.parse` in `parseContentFile` and the Node `fs` calls; each maps to a problem, never swallows.
- **No GDD number in code.** The only digits that may appear in `src/content/schemas/feel.ts` are validation bounds (0, 1, 100…), not tunable defaults. Values live in `content/feel.json`.
- **Sim isolation.** `Feel` is the type the sim will receive in `ctx.feel` (story 1.3). It is plain JSON-serialisable data. Do not put functions, classes or `Map`s in it.
- **Conventions.** `create<Name>` factories (`createNodeContentSource`, `createBrowserContentSource`), `camelCase.ts` files named after their main export, no `enum`, no parameter properties, units as suffixes, `UPPER_SNAKE` constants.
- **Dev-only code.** The error screen must be reachable only through `if (import.meta.env.DEV)` + dynamic `import()` so it vanishes from `build` and `build:playtest` alike. It is in `client/app/` (not `client/ui/`) so the future "no hard-coded UI string in `src/client/ui/`" test of story 1.5 does not trip on its technical English.
- **Security.** All strings go to the DOM through `textContent`. The merge never assigns data-controlled keys with plain `obj[key] =`.

### Technical notes (verified on the installed versions, 2026-10-26)

- **Zod 4.6.7.** `z.strictObject`, `z.record(keySchema, valueSchema)` (a regex key schema validates keys: issue `invalid_key`, path = the key), `z.toJSONSchema(schema)` (draft 2020-12, emits `additionalProperties: false` for strict objects, carries `.describe()` as `description`, ignores `.refine()`). `.transform()`/`.preprocess()` would make the emitter throw: avoid them. Issue shape: `unrecognized_keys` has the **parent** path and the keys in `issue.keys` (the message names the key but the path does not); `too_small`/`invalid_value`/`custom` carry the faulty key in `path`.
- **Duplicate keys.** `JSON.parse` keeps the last value silently, so the AC "keys are unique" needs the raw-text scan of T1. It applies to every content file, not only the strings file.
- **Vite 8.** `import.meta.glob` with `eager: true, query: '?raw', import: 'default'` returns `Record<string, string>`; the relative glob is resolved from the importing file. In dev, Vite serves each matched JSON as a JS module (`export default "…"`), which is what the Playwright route in T9 replaces. In a build the content is inlined in the bundle, so there is no network request for content (NFR14, offline start).
- **TS 7 / tsx.** No `baseUrl`; `types: ["vite/client", "node"]` already set. `tsx` runs `tools/` with the aliases from `tsconfig.json`. `@shared/log` works under Node (`import.meta.env` undefined → console sink on).
- **Biome 2.6.** `content/feel.json` and `strings.fr.json` are linted and formatted like any file (`content/_schemas/**` is excluded). Run `npm run format` after writing them.
- **No new dependency.** Everything needed is installed. Do not add a JSON-schema validator, a parser or a YAML lib.

### Project Structure Notes

- New files follow the architecture tree: `src/content/{contentBundle,loadContent,feelMerge}.ts`, `src/content/schemas/{feel,strings}.ts`, `content/{feel.json,strings.fr.json}`, `content/_schemas/*.schema.json`, `tools/content/{checkContent,emitSchemas}.ts`.
- Additions to the documented tree (small support files, same layers, no new top-level folder): `src/content/{contentError,contentFiles,contentSource,jsonPath,duplicateKeys,parseContentFile,stringRefs,jsonSchema}.ts`, `tools/content/{nodeContentSource,contentChecks}.ts`, `src/client/assets/browserContentSource.ts`, `src/client/app/contentErrorScreen.{ts,css}`, `tests/content/*.test.ts`, `tests/e2e/contentError.spec.ts`.
- `src/main.ts` gains a temporary content load; story 1.4 relocates it to `client/boot.ts` (composition root).

### Previous story intelligence (1.1)

- 1.1's review tightened the guardrails a lot; this story touches the layers (`content`, `client`, `main.ts`, `tools`) that they police. Run `npm test` and `npm run lint` early, not only at the end.
- `log.buffer()` keeps `info` and above whatever the console threshold, and playtest builds print `warn`/`error`: a content error logged with `log.error` is therefore visible in dev, playtest and in the buffer.
- Commit style so far: short French title + body + `Co-Authored-By` trailer; changes are left uncommitted by the dev workflow.
- Scaffold decisions to keep: `resolve.tsconfigPaths: true` is the single alias source; `.env.development` sets `VITE_DEBUG_ALLOWED=true`; e2e runs against `npm run dev` on port 5179.
- Review findings deferred from 1.1 that brush this story (do **not** fix them here): global `error`/`unhandledrejection` hook (story 1.4); mobile canvas CSS (1.4/1.5); duplicated Biome lists. Nothing in `deferred-work.md` blocks 1.2.

### Git intelligence

- `625a94b` Story 1.1: review fixes (scanners hardened, logger buffer semantics, `.env.development`, CI permissions). `47fb4ed` Story 1.1: project and guardrails. `b871ec3` story 1.1 ready for dev; `24c9cf6` sprint tracking; `bde36a6` readiness v2 and epics realigned on UX.
- Pattern: each story is delivered as one implementation commit plus one review-fix commit. Architecture tests live in `tests/architecture/`, with fixtures under `fixtures/`; tool tests did not exist before this story, hence `tests/content/`.

### Project Context Rules

From `_bmad-output/project-context.md` and `CLAUDE.md`:
- **Golden rule:** the AI writes and tests the systems; Geo plays and tunes the feel. Anything he may tweak is data. **Never pin tunable values in tests.**
- **Content:** tunables in `content/feel.json`, content in `content/**.json`, all validated by Zod schemas in `src/content/schemas/` (types by `z.infer`, no hand-written duplicates). Only `loadContent()` reads content JSON; the sim gets a `ContentBundle` in `createSim()` and the effective `Feel` in `ctx.feel`. `null` in a threat def means "use the `feel.json` default" (story 1.10). Content ids `lower_snake_case`, filename = id, JSON keys `camelCase`, cross-cutting files kebab-case, strings in `content/strings.fr.json` via `t(key)`, generated files (`content/_schemas/`) never edited by hand.
- **Units are mandatory suffixes** (`windowMs`, `noisePct`, `fatiguePerSec`). Time: `t`/`…At` sim time, `…AtReal` real time.
- **Errors:** I/O returns `Result<T, E>`; no silent `catch`; every fallback logs a `warn`; no `console.*` outside `src/shared/log.ts`.
- **Stack pinned:** `zod@4.6.7` Zod 4 API (`z.toJSONSchema`, not `zod-to-json-schema`). No ESLint, Prettier, React, UI/state/ECS library, UUID lib; no Capacitor before E8.
- **UX is the source of truth for the interface** and its strings: French, tutoiement, failure never named (NFR9), no tutorial text, errors light for the player. The dev-only content error screen is the one place technical English is allowed.
- **Testing:** Vitest in Node, `describe/it/expect` imported from `vitest`; architecture tests are guardrails, never weakened; a new JSON file is not done until `content:check` passes.
- **When docs disagree:** game rules follow the GDD, technical mechanics the architecture; if still ambiguous, ask Geo.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2 : Pipeline de contenu et fichier de feeling]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences supplémentaires (architecture) › Contenu et feeling]
- [Source: _bmad-output/planning-artifacts/epics.md#Exigences fonctionnelles, FR34 (Note de Maman), FR64, FR65; UX-DR2]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Contenu et feeling] and [#Configuration] and [#Patterns de données] and [#Architecture des données]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Gestion des erreurs] (content invalid: CI refusal, detailed screen in dev) and [#P6 — Réglage à chaud du feeling]
- [Source: _bmad-output/planning-artifacts/game-architecture.md#Arborescence] (`src/content/`, `content/`, `tools/content/`)
- [Source: _bmad-output/planning-artifacts/gdds/gdd-papa-parade-2026-10-26/gdd.md#Mécaniques de jeu] (sections 1, 2, 3, 6, 9), [#Accessibilité et amplitude de compétence] (tiers), [#Économie et ressources › Note de Maman]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/EXPERIENCE.md#Voice and Tone] and [#Canonical on-screen strings] and [#State Patterns › Oups] (« Dev content error: detailed error screen, in dev builds only (story 1.2) »)
- [Source: _bmad-output/project-context.md] (Content & feel, Code Organization, Testing Rules)
- [Source: _bmad-output/implementation-artifacts/1-1-initialiser-le-projet-et-ses-garde-fous.md] (Dev Agent Record, Review Findings)

### Open points for Geo (do not block the dev)

1. « Sûr ? Le niveau sera perdu. » breaks the « perdu » rule. Reword before story 3.11 (for example with « abandonné », or by naming the action instead).
2. `touchRadiusPx` 48 and `telegraphDelayDefaultMs` 1200 are assumptions without a GDD number.
3. Tier ids `assistance | normal | experienced` are provisional until story 2.8.
4. Where a threat's verb text lives (inline in threat JSON vs `verbKey` into this file) is settled in stories 1.10/2.2.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5.5 (`claude-sonnet-5-5`)

### Debug Log References

- `npm run ci` passes end to end: typecheck, lint (Biome, 0 diagnostics), `content:check` (2 files), Vitest (15 files, 290 tests, architecture tests included), Playwright (6 tests, chromium and webkit), `build:playtest`.
- Production check: `npm run build` then `grep -r "pp-content-error" dist` (and `"Content error"`) finds nothing; same for the playtest build. The error screen is tree-shaken.
- `npm run content:schemas` is idempotent (checksums of `content/_schemas/*.json` unchanged). With `"windowMs": "x"` in `content/feel.json`, `npm run content:check` exits 1 and prints `content/feel.json › timing.windowMs: Invalid input: expected number, received string`; file restored.

### Completion Notes List

- **Approach.** `src/content` is pure (Zod + `@shared/result`): `parseContentFile` strips a BOM, scans duplicate keys on the raw text, `JSON.parse`s (the only `catch`, mapped to a problem), drops a top-level `$schema`, validates with Zod and maps every issue to `{ file, jsonPath, message }` (`unrecognized_keys` → one problem per key). `loadContent(source)` reads both registered files, collects all problems, then checks `…Key` references. Reading is injected: `createNodeContentSource` (`tools/content`) and `createBrowserContentSource` (`client/assets`, `import.meta.glob … ?raw`).
- **Registry.** `src/content/contentFiles.ts` exports typed `FEEL_FILE` / `STRINGS_FILE` and `CONTENT_FILES` (the single list used by `loadContent`, `content:check` and `content:schemas`). `ContentBundle` is `{ feel, strings }`.
- **Feel.** `FeelSchema` is strict, with no default/optional/transform; every key and group has `.describe()`. Cross-field rules via `.refine` with the path on the faulty key. Values are the story's starting table; no test pins a tunable value.
- **Unit suffix test.** The key `fatigue.perSec` (as the Dev Notes table names it) is accepted by an explicit `^perSec$` alternative next to the `PerSec` suffix, since the camelCase rule capitalises the suffix only after a word.
- **Strings.** 73 keys seeded from the Dev Notes table, verbatim. The « perdu » line is deliberately not seeded (open point 1 for Geo). Voice rules (forbidden words, tutoiement, `verb.*` shape) are enforced by `StringsSchema` on every value.
- **Tests by layer.** Pure helpers have colocated tests in `src/content/` (`jsonPath`, `duplicateKeys`, `parseContentFile`, `stringRefs`); anything that reads the real `content/` files or imports `tools/` lives in `tests/content/` (R8).
- **String references.** No real content file has a `…Key` property yet (the feel schema is strict), so a missing reference cannot be produced through the real registry. I extracted `checkStringReferences(files, strings, stringsFile)` (used by `loadContent` and `checkContent`) and proved it with unit tests on synthetic objects, instead of the planned end-to-end cases ("a string reference to a missing key" in `loadContent.test.ts`, "a `verbKey` pointing at a missing string" in `checkContent.test.ts`). Story 1.10 will add the first content file with a `…Key` and should add the end-to-end case then.
- **Layer guardrails.** `tests/architecture/**` and `biome.json` are unchanged: the relative glob in `browserContentSource.ts` is not classified as a layer, as the story predicted. No allowance was needed.
- **Extra exports not in the task text** (small support): `formatContentProblem`, `createContentError` (in `contentError.ts`), `issueToProblems` (exported from `parseContentFile.ts` for `mergeFeel`), `listContentFiles` and `stripComments` (in `contentChecks.ts`, for the CLI file count and the `t()` scan).
- **E2E.** Vite serves a content file as `/content/feel.json?import&raw`, so the Playwright route matches `/\/content\/feel\.json\?/`; it works on chromium and webkit (no skip needed). I did not open the dev server by hand in the built-in browser: the e2e test asserts the error screen (visible, `role="alert"`, mentions `content/feel.json` and `timing.windowMs`) and the counterpart asserts a clean boot with an empty console. A visual check of the screen's look is left to Geo.
- **TDD honesty.** Tests were written together with the implementation of each task (not as a separate failing run first); two tests failed on first run because of wrong expectations (JSON path format for `__proto__`/non-identifier keys, a duplicate "blank" message on an empty string), and I fixed the test or the refinement accordingly.
- `content/.gitkeep` and `src/content/.gitkeep` were removed now that real files exist. Nothing was committed.

### File List

New:
- `content/feel.json`
- `content/strings.fr.json`
- `content/_schemas/feel.schema.json` (generated)
- `content/_schemas/strings.schema.json` (generated)
- `src/content/contentBundle.ts`
- `src/content/contentError.ts`
- `src/content/contentFiles.ts`
- `src/content/contentSource.ts`
- `src/content/duplicateKeys.ts`, `src/content/duplicateKeys.test.ts`
- `src/content/feelMerge.ts`
- `src/content/jsonPath.ts`, `src/content/jsonPath.test.ts`
- `src/content/jsonSchema.ts`
- `src/content/loadContent.ts`
- `src/content/parseContentFile.ts`, `src/content/parseContentFile.test.ts`
- `src/content/stringRefs.ts`, `src/content/stringRefs.test.ts`
- `src/content/schemas/feel.ts`
- `src/content/schemas/strings.ts`
- `src/client/assets/browserContentSource.ts`
- `src/client/app/contentErrorScreen.ts`
- `src/client/app/contentErrorScreen.css`
- `tools/content/contentChecks.ts`
- `tools/content/emitSchemas.ts`
- `tools/content/nodeContentSource.ts`
- `tests/content/checkContent.test.ts`
- `tests/content/feelMerge.test.ts`
- `tests/content/feelSchema.test.ts`
- `tests/content/jsonSchema.test.ts`
- `tests/content/loadContent.test.ts`
- `tests/content/stringsSchema.test.ts`
- `tests/e2e/contentError.spec.ts`

Modified:
- `CLAUDE.md` (Commands table: `content:check`, `content:schemas`)
- `package.json` (`content:schemas` script)
- `src/main.ts` (temporary content load and dev error screen)
- `tools/content/checkContent.ts` (placeholder replaced by the real CLI)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story status)

Deleted:
- `content/.gitkeep`
- `src/content/.gitkeep`

## Change Log

- 2026-10-26: Story 1.2 implemented. Content pipeline (Zod schemas, `loadContent`, `content:check`, `content:schemas`, `feelMerge`), `content/feel.json` and `content/strings.fr.json`, dev-only content error screen. Status → review.
