---
baseline_commit: 428e7e389864bae22fd31d888f1f4408e06cedd9
---

# Story 1.22: Mama's Note and the End Screen

Status: done

<!-- Source: _bmad-output/planning-artifacts/epics.md › Story 1.22 « Note de Maman et écran de fin » (L1118-1151). Epics, GDD, architecture and UX are in French; this file is in English (document_output_language). -->

## Story

As a player,
I want Mama to rate my game out of 5 stars when it ends,
so that I want to play again and do better.

**Requirements covered:**
- **FR34 (epics L73), Mama's note:** Score = Rire (0–40) + État du bébé (0–30) + 30 − Soupir (0–15) − Hurlement (0–15), out of 100, with stars at 20 / 40 / 60 / 75 / 90.
  - In the prototype, « État du bébé » is the fixed value `babyStateFixedPoints` (20/30). E5 replaces it.
  - The early-wake −1 star is story 3.2, not this one.
- **UX-DR13 (epics L238-242), the Result screen.** Story 1.22 delivers this part of the sequence: 4 positive score rows → stars stamped one by one → actions.
  - The photo (3.6), Mama's lines (3.7) and the REPLAY (3.9) slot in later, around this part.
  - « Copier le journal » exists only in playtest builds.

**Sources:**
- Epics `epics.md`:
  - L1118-1151: the story itself.
  - L73 (FR34), L238-242 (UX-DR13), L227-229 (UX-DR7: buttons, focus, pad).
  - L476 (story 1.3 put the `mama` block in `feel.json`).
  - L636 (story 1.5: « Recommencer » restarts through the loading screen with a new seed; « Rejouer » does the same).
  - L949 (story 1.16: `NearMiss`), L925-926 (story 1.15: `mess`).
  - L1576-1584 (3.2: `MamaWoke`, the lost star stamps last), L1603-1608 (3.3: the journal and « Copier le journal »), L1697 (3.7), L1734-1739 (3.9), L1777-1805 (3.11: « Âge suivant », « Frigo », best stars), L1855 (4.2: combos feed Rire), L2082 (5.x: the real « État du bébé »).
- GDD `gdds/gdd-papa-parade-2026-10-26/gdd.md`:
  - L387-401: the note. Rire = « réponses parfaites, dégaine, combos ». Soupir = « objets au sol, dégâts ». Hurlement = « presque-accidents… jamais une blessure ». The formula and the stars.
  - L99 and L103: « Pas de game over : chaque niveau se termine par une note ».
  - L516: ≥ 70 % of testers replay without being asked. This is why « Rejouer » must be immediate.
  - L559: every number of the note is a starting value, tuned in playtest.
- `decision-log.md` L14: Geo's formula.
- Architecture `game-architecture.md`:
  - L229-230: `World` holds `score`, and the order is « … instinct → score → flux ».
  - L495: `src/sim/scoring/` holds `mamaScore.ts` and `stars.ts`.
  - L510: `appFsm` `… level → result`. L522: `screens/resultScreen.ts`.
  - L297: the journal button at the end of the game.
  - L1058: `haptics.pulse('light' | 'medium' | 'heavy')`.
- UX `ux-designs/ux-papa-parade-2026-10-26/`:
  - `DESIGN.md` L283-289 and L514 (`star`), L299-305 and L516 (`score-row`), L111-147 and L498-502 (buttons).
  - `DESIGN.md` L450: « 16px is the absolute text floor. Story 1.22 requires a minimum text size in `tokens.css` ».
  - `DESIGN.md` L461 (44 × 44 pt targets), L423 (the ink outline around a star is mandatory: `star` on `cream` is 1.6:1).
  - `EXPERIENCE.md` L99-105 and L316-330 (the Result sequence), L174-180 (copy), L203-205 (buttons), L224 and L226 (stars, rows), L294 and L379 (HUD hidden), L368 (focus), L421-422 (game feel), L427-439 (reduced motion), L510-520 (accessibility floor).
  - Mockup `mockups/key-result.html`: the right column (`.card`, `.srow`, `.total`, `.stars`, `.actions`). Its 3.11 states (« Âge suivant », « Frigo », the lost star) are **not** in this story.

## Precondition (check first, stop if it fails)

1. **Story 1.21 must be merged into `main` first.** This branch was cut from `main` at `6a80a1d`, before 1.21 was merged. 1.21 was `review` on `story/1-21-le-silence-suspect` when this story was written.
   - 1.21 adds `world.mess.mischiefs`, which this story counts in the Sigh (D5).
   - 1.21 also changes `world.ts`, `snapshot.ts` (v9), `events.ts`, `boot.ts`, `simReport.ts` and the goldens, which this story edits too.
   - So: when `sprint-status.yaml` on `main` says `1-21-le-silence-suspect: done`, run `git merge main` on this branch before T0, and resolve only `sprint-status.yaml` status lines (CLAUDE.md › Git workflow).
   - If 1.21 is not `done` on `main`, stop and tell Geo.
2. **Re-read the files 1.21 and its review changed** before you edit them. The excerpts in the Dev Notes are from `main` at `6a80a1d`, before 1.21. Line numbers will have moved.
   - Files: `world.ts`, `snapshot.ts`, `events.ts`, `createSim.ts`, `threatFsm.ts`, `gags.ts`, `flowSystem.ts`, `boot.ts`, `feedbackDirector.ts`, `simReport.ts`, `contentChecks.ts`, `testContent.ts`, `testFeel.json`, `tests/e2e/support/game.ts`.
3. Run `env | grep VITE_`. The agent shell may export `VITE_DEBUG_ALLOWED=false` (CLAUDE.md › Trap).
4. Run `(unset VITE_DEBUG_ALLOWED; npm run ci)` **after the merge and before the first edit**, and let it finish.
   - **Do not edit anything while it runs.**
   - Note the unit and e2e counts in the Debug Log.
   - If the baseline is red, stop and say so.
   - Under heavy load, use `--maxWorkers=5` / `--workers=4` and say so.
   - This worktree has its own e2e port (CLAUDE.md › Git workflow).

## Acceptance Criteria

1. **Content: the weights of the note.** `feel.json › mama` gains five weights. Each is a `points(...)` with its unit in `.describe`, and the same keys go into `tests/support/testFeel.json`:

   | Key | Value | Meaning |
   |---|---|---|
   | `laughPerPerfectPoints` | 1 | Rire per perfect response |
   | `sighPerPropOnFloorPoints` | 5 | Soupir per unbroken prop that fell to the floor (`mess.propsOnFloor`) |
   | `sighPerBrokenPropPoints` | 8 | Soupir per broken prop (`mess.propsBroken`) |
   | `sighPerMischiefPoints` | 3 | Soupir per surprise mischief (`mess.mischiefs`, story 1.21) |
   | `screamPerNearMissPoints` | 3 | Hurlement per near miss (`NearMiss`) |

   `MamaSchema` gains two refines, each with a `path` and a message:
   - `laughMaxPoints + babyStateMaxPoints + sighMaxPoints + screamMaxPoints === 100`: the note is out of 100.
   - `baseScorePoints === sighMaxPoints + screamMaxPoints`: the four rows add up to the score (D3).

   Then regenerate `content/_schemas/feel.schema.json` with `npm run content:schemas`.
2. **The sim counts what feeds the note.** A new world slice, `world.score: ScoreSlice`:
   ```ts
   { perfects: number; nearMisses: number; final: MamaScore | null }
   ```
   - `perfects` += 1 in `resolveThreat` when `quality === 'perfect'`. This includes the micro-sleep: a perfect is a perfect (open point 2).
   - `nearMisses` += 1 wherever `NearMiss` is pushed (`gags.ts`, one place).
   - No other writer. The slice is created in `createWorld` (`0, 0, null`).
   - The snapshot version goes up by one from the version on `main` after the merge (9 with 1.21, so 10). A `scoreProblem` checks every field: non-negative integers, and `final` either `null` (while `playing`) or a valid `MamaScore` (once `ended`).
3. **`src/sim/scoring/mamaScore.ts` computes the note** (pure, no world writes):
   - `computeMamaScore(tally: { perfects; nearMisses; propsOnFloor; propsBroken; mischiefs }, mama: Feel['mama']): MamaScore`.
   - Each component is clamped to its range, then rounded to an integer (`Math.round`):
     - `laughPoints = round(clamp(perfects × laughPerPerfectPoints, 0, laughMaxPoints))`;
     - `babyStatePoints = round(clamp(babyStateFixedPoints, 0, babyStateMaxPoints))`;
     - `sighPoints = round(clamp(propsOnFloor × sighPerPropOnFloorPoints + propsBroken × sighPerBrokenPropPoints + mischiefs × sighPerMischiefPoints, 0, sighMaxPoints))`;
     - `screamPoints = round(clamp(nearMisses × screamPerNearMissPoints, 0, screamMaxPoints))`.
   - `scorePoints = clamp(laughPoints + babyStatePoints + baseScorePoints − sighPoints − screamPoints, 0, 100)`. The AC's « borné entre 0 et 100 » is kept; with the refines of AC 1 it never bites.
   - `stars = starsForScore(scorePoints, mama.starThresholdPoints)`.
   - `MamaScore = { laughPoints; babyStatePoints; sighPoints; screamPoints; scorePoints; stars }`, all integers.
4. **`src/sim/scoring/stars.ts`:** `starsForScore(scorePoints, thresholds)` is the number of thresholds `≤ scorePoints`, so 0 to 5.
   - Tested at the bounds of each live threshold: 0, 19, 20, 39, 40, 59, 60, 74, 75, 89, 90 and 100 with `[20, 40, 60, 75, 90]`.
   - Tested once more with another ascending list, so the thresholds are proved to come from the data and not from code.
5. **The note is given when the level ends.** In the step where `runFlow` ends the level, right after `LevelEnded`, a helper `scoreLevel(world, ctx)` in `scoring/mamaScore.ts`:
   - reads `world.score`, `world.mess` and `ctx.feel.mama`;
   - writes `world.score.final`;
   - pushes `LevelScored{t, laughPoints, babyStatePoints, sighPoints, screamPoints, scorePoints, stars}` at the same `t`.

   Exactly one `LevelScored` per level, always right after its `LevelEnded`. `LevelScored` joins the `SimEvent` union and the sorted `SIM_EVENT_TYPES`, and `MamaScore` / `ScoreSlice` are exported from `@sim`. `ENDED_SYSTEMS` is unchanged: the world, physics included, is frozen from that step on, so the note matches the frozen room (D5).
6. **CLI report.**
   - `meanScore` becomes the mean `scorePoints` over the runs that ended (one decimal), or `null` when none ended.
   - New fields:
     - `meanStars` (one decimal, `null` likewise);
     - `starCounts`, an array of 6: runs per star count, 0 to 5;
     - `runList[i].scorePoints` and `runList[i].stars`, or `null` for a run cut by `--until-ms`.
   - `scoreNote` and `SCORE_NOTE` are removed. `simReport.test.ts` asserts the new fields.
7. **Headless check.** `tests/tools/sim/mamaScore.test.ts` plays the live `salon_crawler` to `LevelEnded`, over 3 seeds, with `perfect` and with `idle`.
   - **Every run:**
     - exactly one `LevelScored`, at the step of `LevelEnded`, right after it;
     - its fields equal `computeMamaScore` of the final world, using the live feel;
     - `scorePoints` equals the sum of the four rows (`laugh + babyState + (sighMax − sigh) + (screamMax − scream)`).
   - **`perfect`:** `sighPoints === 0`, `screamPoints === 0`, and `laughPoints === min(laughMaxPoints, perfects × laughPerPerfectPoints)`.
   - **`idle`:** `laughPoints === 0`, and its mean score is lower than `perfect`'s.
   - Every bound comes from the live feel. No pinned number.
8. **The client enters `result`.**
   - On `LevelScored`, the client:
     - stores the note;
     - stops the loop with the new `levelSession.finish()`. `finish()` stops stepping but keeps `active`, so `__PP__.state()` still reads the frozen world. The next `start()` disposes it as today;
     - enters `appFsm` `level → result` (the transition already exists).
   - Leaving `level` already does these, through existing listeners (check that they fire, change nothing):
     - the level loops stop;
     - the world UI unmounts;
     - the HUD hides (`uiShell.refresh`: `hud.setVisible(state === 'level')`).
   - The frozen room stays drawn behind the screen (`drawStatic` renders whenever the app is not in `level`).
   - The `// Story 1.22 shows the result screen` comment in `boot.ts` goes.
9. **The Result screen, DOM.** The new overlay kind is `'result'`:
   - `OverlayKind` gains it, and `chooseOverlay` puts it after `portrait` and `oops`.
   - `OverlayBuilders` gains `result`; `overlayHost`'s exhaustive switch builds it.
   - `src/client/ui/screens/resultScreen.ts` builds `div.pp-overlay.pp-result-screen > section.pp-panel.pp-result-panel[role=dialog][aria-modal=true][aria-label=t('result.title')]`. It holds:
     - **A score card** (`.pp-score-card`, `role="table"`, `aria-label=t('result.score_label')`), with four `.pp-score-row` rows in this order:

       | Row | Value | Max | Chip accent |
       |---|---|---|---|
       | `result.score_laughs` | `laughPoints` | `laughMaxPoints` | `mama-laugh` |
       | `result.score_baby_state` | `babyStatePoints` | `babyStateMaxPoints` | `paper` (no accent) |
       | `result.score_no_sigh` | `sighMaxPoints − sighPoints` | `sighMaxPoints` | `mama-sigh` |
       | `result.score_no_scream` | `screamMaxPoints − screamPoints` | `screamMaxPoints` | `mama-scream` |

       - Each row has a label in `label` type, its value in `numeric` type with `tabular-nums`, and « /max » in `ink-soft`.
       - Every maximum is read from the feel, never written in code.
     - **A total** (`.pp-score-total`): `scorePoints` in `display` type, then « /100 ». The 100 is the sum of the four maxima, not a literal.
     - **Five star slots** (`.pp-stars`, `role="img"`, `aria-label` = `result.stars_label` formatted with the count and 5). An earned star is a `.pp-star.pp-star-earned` SVG: `star` fill, `ink` outline (mandatory, DESIGN L423), the stamp tilt of the mockup. The other slots are `.pp-star-empty`, as in the mockup's `star-off`.
     - **The actions** (`.pp-result-actions`): one `button.pp-button.pp-button-primary` « Rejouer » (`result.replay_button`, also its `aria-label`), bound with `bindPressButton`.
   - « Copier le journal » is **not rendered** in this story: the builder takes an optional `copyLog` action, and `boot.ts` passes none until story 3.3 creates the journal. When 3.3 wires it, it goes behind `import.meta.env.VITE_DEBUG_ALLOWED`, so the store build never holds it (1.24).
   - There is no « Âge suivant », no « Frigo » and no header: those are 3.11 and 3.2.
   - Every string goes through `t()`. Every colour, size and radius is a `--pp-*` token. Classes start with `pp-`.
10. **The sequence.** The timings are data in `content/feedback.json › resultScreen` (D7), all in real ms, with a strict schema and `.describe` on each key:

    | Key | Value |
    |---|---|
    | `rowCountUpMs` | 600 |
    | `rowStaggerMs` | 200 |
    | `starsDelayMs` | 300 |
    | `starIntervalMs` | 450 |
    | `actionsDelayMs` | 400 |

    The sequence runs in this order:
    - **Rows.** Each row's value counts up from 0 to its total in `rowCountUpMs`, each row starting `rowStaggerMs` after the one before. A row whose total is 0 shows 0 at once, at its turn.
    - **Stars.** `starsDelayMs` after the last row lands, the earned stars stamp one by one, `starIntervalMs` apart. Each stamp fires the client event `ResultStarStamped`, and the last earned star fires `ResultLastStarStamped` instead (D6). With one star, that star is the last.
    - **Actions.** `actionsDelayMs` after the last stamp (or after the rows, with 0 stars), the actions appear and « Rejouer » takes focus.

    The rest of the screen's behaviour:
    - **Skip.** Before the actions are up, a press on the screen (`pointerup` of a pointer pressed on it), Enter, Space or pad A completes the sequence at once: every row at its total, every earned star placed **silently**, the actions up, and focus on « Rejouer ». The press that skips never activates « Rejouer » itself.
    - **Rebuilt screen.** A screen rebuilt while the app is still in `result` (the portrait overlay came and went) shows the completed state at once, with no sound and no haptic. A « sequence done » flag kept in `boot.ts` decides this, not the screen.
    - **No sim time.** The sequence never reads sim time: it runs on an injected scheduler (real time), so it is unit-tested with a fake one.
11. **Star sound and haptics.** `FEEDBACK_CLIENT_EVENTS` gains `ResultStarStamped` and `ResultLastStarStamped`, and `feedback.json` gains:
    - **events:** `"ResultStarStamped": "result_star"`, `"ResultLastStarStamped": "result_star_last"`;
    - **cue `result_star`:** audio `ui_star_stamp` on the `ui` bus, `visual: { "kind": "uiElement" }`, haptic `light`;
    - **cue `result_star_last`:** audio `ui_star_stamp_last` on the `ui` bus, `visual: { "kind": "uiElement" }`, haptic `heavy` (« vibration marquée » = `heavy`, story 2.4 L1310-1318).
    - **The `uiElement` visual kind (D6).** It joins the visual union in `src/content/schemas/feedback.ts`. It means « the UI element that fired the event is the visual twin » (here the stamped star). The director draws nothing for it.
    - **`content:check`:**
      - a client-event cue may have a visual only if it is `uiElement`;
      - a sim-event cue may not use `uiElement`;
      - both problems name the file, the JSON path and the culprit.
    - `feedbackEquivalence` passes unchanged.
    - The two placeholder clips come from `tools/audio/makePlaceholderAudio.ts` (`npm run assets:audio`, macOS). Commit only the two new `.m4a` files and restore the others from git (1.16 and 1.21 notes).
12. **Inputs on the Result screen.**
    - **Touch / mouse:** the sticker press of `bindPressButton`.
    - **Keyboard:** Enter / Space on the focused « Rejouer ». Escape does nothing.
    - **Pad:**
      - `menuPoll` also runs in `result`;
      - `padAction` maps `confirm` (A) on the `result` overlay to `activate`;
      - the screen's `activate()` skips the sequence while it runs, and presses « Rejouer » once the actions are up.
    - **Focus ring:** the 4 px `primary` one.
    - **No pause.** The pause button and the visibility pause do not act in `result`. Check `chooseOverlay` and the pause gates; a hidden tab on the Result screen must not leave a pause veil behind.
13. **Landscape phone.** On the 844 × 390 e2e viewport (and on Playwright's 750 × 340 iPhone 12 landscape):
    - « Rejouer » is at least 44 × 44 px (`--pp-spacing-touch-target-min`);
    - the whole panel fits without scrolling, inside the safe-area margins;
    - every text node of the screen has a computed `font-size` ≥ the new token `--pp-spacing-text-min` (16px).

    To add the token:
    - add `text-min: 16px` to the `spacing` group of the `DESIGN.md` frontmatter (L97-109; DESIGN L450 asks for it);
    - mirror it in `tokens.css` as `--pp-spacing-text-min: 16px`;
    - the `designTokens` test then passes with no exception.
14. **Reduced motion** (`prefers-reduced-motion: reduce`, client only):
    - a star appears with a plain fade, with no scale, rotation or overshoot;
    - the panel fades in, like `.pp-panel` today;
    - the count-up and the sounds and haptics stay: they are information, not motion;
    - nothing on the screen flashes faster than 3 Hz.
15. **« Rejouer ».**
    - Touching it calls `levelSession.start()` with no options: same level, same feel, a new seed from `deps.newSeed()`.
    - It goes through `result → loading → level` and the 3 s countdown, **without reloading the page**.
    - The mirrors are reset by `mirrorNewLevel`, and the stored note and the « sequence done » flag are cleared.
    - Under `?seed=`, the restart keeps that seed: this is the existing debug rule of `boot.ts`, kept.
16. **Debug mirrors** (`isMirrored` only, written on change, like the others):
    - `ppScore` (`scorePoints`), `ppStars` (`stars`), and `ppResult`, which is `rows | stars | actions` as the sequence moves;
    - all three are written from `LevelScored` and the screen's callbacks, and deleted in `mirrorNewLevel`;
    - they join the typed union of mirror names.
17. **Tests, goldens, CI.**
    - The tests of § Testing pass.
    - `timer.spec.ts`'s end-of-level test asserts the new end: the app is in `result`, the HUD is hidden and the score is mirrored. It no longer asserts the timer « still visible at 0:00 ».
    - **Goldens.** No golden scenario reaches `LevelEnded` (all are 30–40 s), so `eventTypes` and `eventsHash` stay **identical**. `worldHash` (the new `score` slice) and `feelHash` (the new keys) move, and `levelHash` does not. Regenerate with `npm run golden:update` and say so.
    - The screenshot references should not move (no golden or screenshot reaches the end). If they do, find out why before regenerating.
    - Coverage of `src/sim` stays ≥ 90 %.
    - `(unset VITE_DEBUG_ALLOWED; npm run ci)` is green.

## Tasks / Subtasks

- [x] **T0 — Precondition** (§ Precondition): 1.21 merged, `git merge main`, baseline CI, counts in the Debug Log.
- [x] **T1 — Content** (AC 1, 10, 11, 13)
  - [x] `src/content/schemas/feel.ts` › `MamaSchema`: the five weights, described with their unit; the two refines (sum of maxima = 100; base = sigh max + scream max), each with a `path`.
  - [x] `content/feel.json` and `tests/support/testFeel.json`: the five keys.
  - [x] `src/content/schemas/feedback.ts`:
    - `UiElementSchema` (`kind: z.literal('uiElement')`, strict) joins the visual `discriminatedUnion`;
    - add a strict `ResultScreenSchema` (the five timings, ints > 0 except `rowStaggerMs` ≥ 0, each described « real ms ») as `resultScreen` in the feedback table schema.
  - [x] `content/feedback.json`: the two cues, the two events and `resultScreen`.
  - [x] `src/client/feedback/feedbackEvents.ts`: `FEEDBACK_CLIENT_EVENTS` gains `ResultStarStamped` and `ResultLastStarStamped`.
  - [x] `content/strings.fr.json`: `result.title` « Note de Maman », `result.score_label` « Score », `result.stars_label` « {count} étoiles sur {max} ». Before adding the key, check `strings.ts` (no failure words, tutoiement).
  - [x] `src/client/ui/strings.ts`: a `formatString(text, values)` that replaces `{name}` placeholders. A missing value warns once and leaves the placeholder. Test it.
  - [x] `tools/content/contentChecks.ts`: the two `uiElement` rules of AC 11.
  - [x] `DESIGN.md` frontmatter `spacing.text-min: 16px` and `tokens.css` `--pp-spacing-text-min: 16px` (AC 13).
  - [x] `npm run content:schemas`; `npm run content:check` is clean.
- [x] **T2 — Sim** (AC 2-5)
  - [x] `src/sim/world.ts`: `ScoreSlice`, `MamaScore`, `World.score`, the default in `createWorld`.
  - [x] `src/sim/scoring/stars.ts` (`starsForScore`) and `src/sim/scoring/mamaScore.ts` (`computeMamaScore`, `scoreLevel`), with their tests.
  - [x] `src/sim/threats/threatFsm.ts` › `resolveThreat`: `world.score.perfects += 1` on `perfect`. `src/sim/threats/gags.ts`: `world.score.nearMisses += 1` next to the `NearMiss` push.
  - [x] `src/sim/flow/flowSystem.ts`: call `scoreLevel(world, ctx)` right after the `LevelEnded` push.
  - [x] `src/sim/events.ts`: `LevelScored`, `SIM_EVENT_TYPES` (sorted).
  - [x] `src/sim/snapshot.ts`: the version bump, its line in the doc comment's history, and `scoreProblem` wired into `worldProblem`.
  - [x] `src/sim/index.ts`: export `MamaScore`, `ScoreSlice` and `starsForScore` (the client and the tests may need it; bots must not compute the score).
  - [x] Check the import graph: `scoring/*.ts` imports only `world.ts`, `context.ts` types and `@shared`. Nothing in `threatFsm`'s chain imports `flowSystem.ts`.
- [x] **T3 — CLI** (AC 6, 7)
  - [x] `tools/sim/simReport.ts`: per-run `scorePoints` / `stars` from `LevelScored` (or `sim.world.score.final` in `finish()`), `meanScore`, `meanStars`, `starCounts`; remove `scoreNote` / `SCORE_NOTE`.
  - [x] `tests/tools/sim/simReport.test.ts`; new `tests/tools/sim/mamaScore.test.ts` (AC 7, 120 s timeouts like the other live tests).
- [x] **T4 — Client flow** (AC 8, 12, 15, 16)
  - [x] `src/client/app/levelSession.ts`: `finish()`. It stops the loop and keeps `active` and the sim. It is a no-op with no active level. `start()` and `stop()` are unchanged. Test it.
  - [x] `src/client/app/overlay.ts`: `'result'` kind and its place in `chooseOverlay`. `src/client/ui/overlayHost.ts`: `result` builder. `src/client/ui/keys.ts`: `padAction` for `result`.
  - [x] `src/client/boot.ts`:
    - on `LevelScored`: store the note, set the mirrors, `levelSession.finish()`, `appFsm.enter('result')`;
    - the `result` builder (note, feel `mama` maxima, `feedback.resultScreen`, `isMotionReduced`, the « sequence done » flag, `onReplay: () => void levelSession.start()`, and `onStar(isLast)` → `director.handle('ResultStarStamped' | 'ResultLastStarStamped', null)`);
    - `menuPoll` in `result`;
    - clear the note and the flag on `AppStateChanged` to `loading`;
    - remove the « Story 1.22 » comment.
  - [x] `src/client/feedback/feedbackDirector.ts`: a `uiElement` visual is skipped on purpose, with a comment and no log.
  - [x] Check the pause gates in `result` (AC 12).
- [x] **T5 — Result screen** (AC 9-14)
  - [x] `src/client/ui/screens/resultScreen.ts` (+ `resultScreen.test.ts`, happy-dom or the same DOM setup as `pauseScreen.test.ts`), with:
    - an injected scheduler `{ schedule(fn, ms): handle; cancel(handle) }` and a `now()` for the count-up;
    - `dispose()` cancels every pending timer.
  - [x] The star SVG through `svgElement` (`svg.ts`), shaped like the mockup's `star-on` / `star-off`, with the stroke from `var(--pp-color-ink)`.
  - [x] `src/client/ui/styles/ui.css`:
    - `.pp-result-screen`, `.pp-result-panel`, `.pp-score-card`, `.pp-score-row` (+ chip accents), `.pp-score-total`, `.pp-stars`, `.pp-star-*` and `.pp-result-actions`;
    - the stamp keyframes (transform and opacity only, about 200 ms) and their reduced-motion fade;
    - tokens only, no literal colour, no layout property animated (designTokens test).
- [x] **T6 — Audio** (AC 11): add `ui_star_stamp` and `ui_star_stamp_last` to `PLACEHOLDER_CLIPS` (a short bright blip; the last one longer and lower). Run `npm run assets:audio`, keep the two new files and restore the rest. Update `makePlaceholderAudio.test.ts` if it counts clips.
- [x] **T7 — e2e** (AC 8-17): new `tests/e2e/result.spec.ts` (§ Testing), update `timer.spec.ts`, and add helpers to `tests/e2e/support/game.ts` (`advanceToEnd(page)` from `LEVEL_DURATION_MS` and `CHUNK_STEPS`).
- [x] **T8 — Goldens, docs, CI** (AC 17)
  - [x] `npm run golden:update` (say so).
  - [x] `_bmad-output/project-context.md`: the `World` line gains `score`, and add one bullet on Mama's note (counters at source, `scoreLevel` in `runFlow`'s ending step, `LevelScored`).
  - [x] `deferred-work.md`: close or annotate items L202, L277, L288 and L336 (see § Previous story intelligence), and 1.21's « 1.22 counts mischiefs ».
  - [x] `(unset VITE_DEBUG_ALLOWED; npm run ci)`.

### Review Findings

Code review of 2026-10-28 (Blind Hunter, Edge Case Hunter, Acceptance Auditor; no layer failed). The Auditor found no violation of AC 1-17. The CI figures of the Dev Agent Record were not re-run by the reviewers.

- [x] [Review][Decision] A stray input at the end of the level skips the sequence, and a third one presses « Rejouer » — **resolved: option (a), `feedback.json › resultScreen.inputGraceMs` = 350 (0 turns it off).** The Result screen accepts a skip (pointer, Enter/Space, pad A) from its first frame. A player mashing taps or A for parries as the timer ends skips the counts and the stamps with no cue, and the next stray tap lands on « Rejouer », which appears under the finger, before the note was read. The keyboard has the `heldSkipKey` guard, touch and pad have none; a pad A held at entry may also read as a fresh press (`menuPoll` now runs on `result`). Options: (a) a short, data-driven input grace after build (`feedback.resultScreen.inputGraceMs`, ignored for skip and replay); (b) keep the spec as written (« a press skips »). [resultScreen.ts:321-334, boot.ts menuPoll]
- [x] [Review][Patch] The maxima of the note can be fractional, which breaks « rows add up » and the snapshot — `points()` is `z.number().min(0)`, so `sighMaxPoints` 15.25 / `screamMaxPoints` 14.25 / `laughMaxPoints` 40.5 / `baseScorePoints` 29.5 passes both refines; `scorePoints` is then fractional and `scoreProblem` (`isCount`) refuses the sim's own snapshot on `restore`. A fractional max also lets `row()` round above its max (15.5 → 16, a −0.5 row on screen). The `=== 100` refine on a float sum can reject a legitimate tuning on rounding error. Make the four maxima, `baseScorePoints` and `babyStateFixedPoints` integers (`z.int().min(0)`), regenerate `content/_schemas`, add a schema test. The weights (`…PerPerfectPoints`, …) stay free. [feel.ts:20, 255-312]
- [x] [Review][Patch] « Rejouer » can stay dead after a swallowed keyup — `heldSkipKey` is cleared only by a `keyup` heard on `keyTarget`; if the window loses focus between the skipping keydown and keyup (Alt-Tab, hidden tab, OS focus steal) it stays set, and the guard also swallows mouse, touch and pad A on « Rejouer ». Reset it on `blur` and `visibilitychange`, and test it. [resultScreen.ts:213-216, 329-337]
- [x] [Review][Patch] A screen rebuilt mid-sequence replays the stars (blind + edge + auditor) — `isResultDone` becomes true only on `actions`; a portrait overlay during `rows` or `stars` disposes the screen, and the rebuild restarts at row 0 with a second stamp, sound and vibration for stars already shown. AC 10 / D9: a screen rebuilt while the app is in `result` shows the completed state at once. Set the flag as soon as the sequence has started (first `onPhase`), and add a test (portrait during the stars). [boot.ts:844, overlayHost]
- [x] [Review][Patch] The Result mirrors are stale during loading after « Rejouer » — the `loading` handler resets `resultScore` and `isResultDone` but `data-pp-score`, `data-pp-stars` and `data-pp-result="actions"` stay until `onLevelStarted`, so a Playwright wait on `data-pp-result="actions"` after a replay can read the previous game's value. Delete the three datasets on `AppStateChanged → loading`. [boot.ts:1022-1025]
- [x] [Review][Patch] `STAR_COUNT_MAX` is not tied to the schema — `starThresholdPoints` is `.length(5)` by hand while the screen, the snapshot validator and the report use `STAR_COUNT_MAX`; if they diverge, `slots[earned]` is `undefined` (TypeError in `earn`). Use `.length(STAR_COUNT_MAX)` (content may import `shared`). [feel.ts:267, constants.ts]
- [x] [Review][Patch] « 1 étoiles sur 5 » — `result.stars_label` reads « 0 étoiles » and « 1 étoiles » in the star `aria-label`. Reword to « {count} sur {max} étoiles » (grammatical for every count); the spec prescribed the old wording, so say so in the change log. [content/strings.fr.json:56]
- [x] [Review][Patch] e2e coverage lost in `timer.spec.ts`, and its « loop stopped » check is vacuous — the 1.18 proof that no input reaches the sim after `LevelEnded` (floor tap, no `PapaPathPlanned`) was removed and not replaced, and `openResult` freezes the level (`ppFreeze(true)`) before the check `time.sim` unchanged after `waitFrames(10)`, which holds with or without `levelSession.finish()`. Restore a tap-after-end check on the Result screen, and add one case where the level ends on the real, unfrozen loop. [timer.spec.ts, result.spec.ts:41-52]
- [x] [Review][Patch] Two assertions that cannot fail — « shows 0 at once for a row whose total is 0 » passes with the `totalPoints <= 0` branch deleted (the element starts as `'0'`; check that no timer was scheduled for it), and the e2e star-stroke check loops over `.pp-star-earned`, which is empty (and passes) if the live feel gives 0 stars (assert the count first). [resultScreen.test.ts ~820, result.spec.ts ~120]
- [x] [Review][Defer] Audio stays suspended on the Result screen after the page was hidden — `PauseRequested` suspends audio and `rescueAudio` only runs in `level`; the remaining stamps are silent (haptics still fire) until the next start. [boot.ts:315, 999] — deferred, belongs with the audio/pause rescue work; « Rejouer » restarts audio.
- [x] [Review][Defer] ARIA of the Result screen — `role="table"` on `div`s with no `rowgroup`/headers, the total and `/100` unlabelled, no `inert` on the canvas behind `aria-modal`, count-up text not announced. [resultScreen.ts] — deferred to the accessibility pass (EXPERIENCE.md › accessibility floor), not an AC of 1.22.
- [x] [Review][Defer] Pointer skip edges: no `pointercancel` handling, `pointerup` does not re-check `isPrimary`, a second finger overwrites `pressedPointer`. [resultScreen.ts:320-327] — deferred, minor, no reported failure.
- [x] [Review][Defer] The window-level Enter/Space skip handler also fires and `preventDefault`s from a focused debug text field. [resultScreen.ts:329-334] — deferred, playtest builds only.
- [x] [Review][Defer] New live-content tests are brittle and partly tautological (`tests/tools/sim/mamaScore.test.ts` strict `<` idle vs perfect on `salon_crawler`; `flowSystem.test.ts` builds its expected payload with `computeMamaScore`). — deferred, they fail only when Geo retunes the content; revisit if they become noise.

Dismissed as noise (12): `levelSession.finish()` re-entrancy and a loop restart through the pause path (traced: `stopCount` cuts the frame, pause and visibility on `result` do not restart it); a broken prop counted twice in the sigh (`propsOnFloor` is an `else if` of `isBroken`); `baseScorePoints` being derived data (decision D3); the `SCORE_NOTE` / `scoreNote` removal (AC 6); the `uiElement` cue loophole (checked in `contentChecks`, tested); `later()` TDZ on a synchronous scheduler; the module-level `reportedPlaceholders`; the token name and raw px in the CSS; sparse `starCounts`; the total shown as the sum of the rows (equal to `scorePoints` once the maxima are integers); pause-state carry-over on replay (not reproducible); the safe-area check not asserted at 844 × 390 (follows from 750 × 340).

## Dev Notes

### Decisions (D1-D10)

| # | Decision | Why |
|---|---|---|
| D1 | **Count at the source, score once at the end.** `perfects` and `nearMisses` are incremented where `ResponseResolved{perfect}` and `NearMiss` are produced. `scoreLevel` is a helper that `runFlow` calls in the step that ends the level. No `runScoring` system yet. | A system reading `ctx.events` would be a new pattern; the codebase writes world state where the event is made (the mess counts, the fatigue). The architecture's `runScoring` slot (step.ts doc) is for live scoring (combos, E4): leave the slot reserved and say so in the doc comment. `endRingingPhones` is the precedent for a helper called by `runFlow`. |
| D2 | **`LevelScored` is its own event, after `LevelEnded`.** | `LevelEnded{reason}` stays the flow's fact. Story 3.2 changes the stars (`MamaWoke`), so the score needs its own payload. The client, the CLI and the e2e all read one event. |
| D3 | **Components are integers, and the rows always add up.** Each component is clamped, then rounded. The refines force `base = sighMax + screamMax` and the sum of the maxima to be 100. | The UX says the rows add up to the score (DESIGN L516). With fractional weights or a base that drifts, « 20 + 32 + 9 + 12 » could show 74. The refines catch Geo's typo at `content:check` instead of on screen. |
| D4 | **Weights:** 1 per perfect, 5 per fallen prop, 8 per broken prop, 3 per mischief, 3 per near miss. | Headless runs (5 seeds, seed 1, before 1.21): `perfect` gets about 58 perfects per run, `human` about 40, and `idle` about 19 near misses and every gag. So a perfect run reaches 40 + 20 + 30 = 90, the 5-star threshold exactly. `idle` loses the full 15 + 15. The room has two props (the mug on the table and the vase on the floor), so the mug broken plus the vase broken caps the Sigh. All are starting values (GDD L559). |
| D5 | **The Sigh reads `world.mess` once, at the end. The world is frozen from that step on.** | deferred-work L277: `isOnFloor` flickers while a prop bounces. Reading it once on a frozen world makes the note match the room the player sees behind the screen (and the 3.6 photo). No hysteresis is needed for this story. `mess.propsOnFloor` already excludes broken props, so nothing is counted twice. `mischiefs` is 1.21's decision (its Open point 4). |
| D6 | **The stars' sound and vibration go through the `FeedbackDirector`, with a new `uiElement` visual kind.** | Pillar 3 says every audio has a visual and a haptic twin (`feedbackEquivalence`). `content:check` forbids a world visual on a client event, because there is no world to draw it in. The stamped star *is* the visual: `uiElement` says so in the data. So the triple rule stays checkable and Geo tunes the volume and haptics in `feedback.json` like every other cue. |
| D7 | **The sequence timings live in `feedback.json › resultScreen`, not `feel.json`.** | They are presentation in real ms that the sim never reads. In `feel.json` they would move `feelHash`, enter journals and goldens, and reach the sim's `ctx.feel` for nothing. `feedback.json` is already the client's tunable presentation file. |
| D8 | **`levelSession.finish()` stops the loop but keeps the sim.** | `__PP__.state()` and the e2e read the frozen world on the Result screen. Stepping `ENDED_SYSTEMS` forever is wasted work on a phone. `drawStatic` already draws the room whenever the app is not in `level`. The next `start()` already disposes the old sim. |
| D9 | **A press skips the sequence; a rebuilt screen shows the end.** | The GDD's replay metric (L516) punishes a forced wait. A skip that also pressed « Rejouer » would replay by accident, so a skip only completes. The portrait overlay rebuilds the screen (`overlayHost.sync`), and replaying the stars then would double the sounds. |
| D10 | **« Copier le journal » is not rendered; the slot exists.** | The epic: « masqué tant que le journal n'existe pas (story 3.3) ». Rendering a dead button behind CSS would also break 1.24 (« the prod bundle holds no Copier le journal »). |

### Current state of the files this story changes (read before editing)

All of these are on `main` at `6a80a1d`, before 1.21. Re-read them after the merge.

- **`src/sim/flow/flowSystem.ts`** (L12-18): `runFlow` returns unless `playing` and `sim ≥ durationMs`, calls `endRingingPhones`, then `enterFlowState(world, 'ended')` and pushes `LevelEnded{reason: 'timer'}`. Add `scoreLevel(world, ctx)` after the push.
- **`src/sim/flow/flowFsm.ts`**: `FlowState = 'playing' | 'ended'`; `enterFlowState` is the only writer. No new state (the photo states are 3.5 and 3.6).
- **`src/sim/step.ts`**:
  - `SYSTEMS` runs `… runPhysics, runGauges, runFlow`, and the doc comment lists `runInstinct, runScoring` as future slots.
  - `ENDED_SYSTEMS = [applyCommands, advanceTime]`.
  - Change only the doc comment, to say the note is given in `runFlow`'s ending step and `runScoring` stays reserved (D1). The pinned order test stays green.
- **`src/sim/threats/threatFsm.ts`** (L94-113): `resolveThreat` emits `ResponseResolved{perfect | success}` and starts the `perfect` slow-mo at L113. Increment `world.score.perfects` beside it.
- **`src/sim/threats/gags.ts`**:
  - `NearMiss` is pushed at L40, by `stairs_slide` only.
  - The file comment at L11 already says « her scream from `NearMiss`, story 1.22 ».
  - 1.21 adds two surprise gags that do **not** emit `NearMiss`, and `mess.mischiefs += 1`.
- **`src/sim/world.ts`**:
  - `MessSlice { propsOnFloor; propsBroken }` (1.21 adds `mischiefs`), recounted by `runPhysics` (`propsSystem.ts` L152-161; `propsOnFloor` counts unbroken props that spawned above the floor).
  - `createWorld` is at L272-348.
- **`src/sim/snapshot.ts`**: `version: 8` (9 after 1.21), the history in the doc comment, `worldProblem` (L529-592), and `ended` before `durationMs` is refused (L369).
- **`src/sim/events.ts`**: `LevelEndReason = 'timer'` (:21), the union and the sorted `SIM_EVENT_TYPES` with its completeness proof (:126-164).
- **`src/content/schemas/feel.ts`** (L240-269): `MamaSchema` has `laughMaxPoints, babyStateMaxPoints, babyStateFixedPoints, baseScorePoints, sighMaxPoints, screamMaxPoints, starThresholdPoints` (5, strictly ascending), `earlyWakePenaltyStars` and one refine (`fixed ≤ max`).
  - The header rule: no `.default()`, `.optional()` or `.transform()`, so every key is written in the JSON.
  - `tests/content/feelSchema.test.ts` already tests the thresholds.
- **`src/content/schemas/feedback.ts`**: the visual is `z.discriminatedUnion('kind', [SoundWaveSchema])` (L117), and the camera has its own union (L125). Adding `UiElementSchema` is one entry.
- **`tools/content/contentChecks.ts`** (L140-175): the event name check, the « client event with no world » rule (refuses `visual` or `camera`), and the « generic event names no threat » rule. Narrow the second rule to non-`uiElement` visuals and add the reverse rule.
- **`src/client/feedback/feedbackEvents.ts`** (:7): `FEEDBACK_CLIENT_EVENTS = ['CountdownTicked']`. `boot.ts` (:306) wires `CountdownTicked` with `director.handle(name, null)`, which is the model for the stars.
- **`src/client/feedback/feedbackDirector.ts`**: `handle` plays audio, then haptic, then the visual (only with a world and a scene in `level`), then the camera. Audio plays outside `level`, which is what the Result screen needs.
- **`src/client/app/appFsm.ts`**: `result` exists, with `level → result` and `result → loading`. Nothing enters it yet.
- **`src/client/app/levelSession.ts`**:
  - `start(options?)` (:243-416) tears down, picks `options.seed ?? deps.newSeed()` (:315), and goes through `loading`, the countdown and `level`.
  - `stop()` (:236-242) sets `active = null`.
  - `stopLoop` (:203) is internal; `finish()` reuses it.
- **`src/client/boot.ts`**:
  - `drawStatic` (:171-173);
  - the `AppStateChanged` listeners (:301-304 loops, :893-901 world UI, :866-875 `menuPoll` for `start`, `oops` and `loading`);
  - `onSimEvent` (:661-662, `LevelEnded` → `ppFlow`, plus the « Story 1.22 » comment);
  - the overlay builders (:712-736), the mirror union (:197-233), `mirrorNewLevel` (:381-382);
  - `newSeed: () => params.seed ?? crypto.getRandomValues(...)` (:499-500).
- **`src/client/app/overlay.ts`** (:5, :19-26), **`src/client/ui/overlayHost.ts`** (:5-12, exhaustive switch :41-58, `sync` focuses `initialFocus` :78-88), **`src/client/ui/uiShell.ts`** (`refresh` :59-72 hides the HUD outside `level`), **`src/client/ui/keys.ts`** (`padAction` :112-125).
- **`src/client/ui/screens/pauseScreen.ts`** and **`oopsScreen.ts`**: the panel and action patterns to copy: `section.pp-panel[role=dialog]`, `bindPressButton`, `activate`. `.pp-panel` pops in, and fades under reduced motion (`ui.css` :504-519, :693-713).
- **`tools/sim/simReport.ts`**:
  - `RunSummary` (:30-56), `finish()` (:164-183, `sim` in scope), `meanScore: null` (:222, :365), `SCORE_NOTE` (:257) and `summarizeRuns` (:281-390).
  - `simReport.test.ts` (:101-102) asserts `meanScore` null and `scoreNote` contains '1.22'.
- **`tests/e2e/timer.spec.ts`**:
  - `openFrozen` (:42-47) and `advanceTo` with `CHUNK_STEPS = 3000` (:49-56) are the way to reach the end.
  - The end test (:116-158) asserts the HUD timer still at `0:00`: change it (AC 17).
- **`content/strings.fr.json`** (L52-66) already holds every `result.*` label this story shows: `score_laughs`, `score_baby_state`, `score_no_sigh`, `score_no_scream`, `replay_button` and `copy_log`.

### Architecture compliance

- **Sim purity.** No new draw, no real time. `scoring/*.ts` is pure: `computeMamaScore` and `starsForScore` take values and return a value.
- **Systems never call systems.** `scoreLevel` is a helper, like `endRingingPhones`. The counters live inside the existing helpers (`resolveThreat`, the gag consequence).
- **World** stays plain data: `final` is an object literal or `null`, never a class.
- **Events** are past tense, subject first: `LevelScored`, and the client events `ResultStarStamped` / `ResultLastStarStamped`.
- **Units.** Every new key ends in `Points` or `Ms`. Sequence timings are real ms (no `…At` sim instants on the client side).
- **Zero allocation** in `step()`: the counters are `+= 1`. `scoreLevel` allocates one object once per level, which is fine (it runs once).
- **Client.**
  - It imports `@sim` only (`MamaScore`, `starsForScore` if needed). It reads `world` but never writes it.
  - The screen is DOM + CSS with `pp-` classes and tokens. Strings go through `t()` / `formatString`.
  - Reduced motion is CSS plus `isMotionReduced`, and never touches the sim.
  - `navigator.vibrate` stays in `src/platform` (the haptics go through the director).
- **Content.** Regenerate `content/_schemas`, never edit it by hand. A JSON is not done until `content:check` passes.

### Library and framework notes

- **Zod 4.6.7:** add the refines on the `strictObject` with `path` and `error` (the pattern of the existing refine). `discriminatedUnion('kind', [SoundWaveSchema, UiElementSchema])`. A refine does not show in the JSON Schema; that is expected.
- **DOM / CSS:**
  - Count up with an injected `now()`, scheduled frames, and `textContent` written only when the integer changes.
  - Stamp with a CSS animation on `transform` / `opacity`, for example `@keyframes pp-star-stamp { from { transform: scale(1.6) rotate(var(--pp-star-tilt)); opacity: 0 } to { transform: scale(1) rotate(var(--pp-star-tilt)); opacity: 1 } }`. The tilt is a custom property per stamp: −9°, 6°, −4°… from the mockup.
  - `@media (prefers-reduced-motion: reduce)` as in `ui.css`.
  - `font-variant-numeric: tabular-nums` for the values.
- **SVG:** `svgElement` from `svg.ts`. The star polygon comes from the mockup's `star-on`, with an ink offset shadow polygon under the fill.
- No new dependency.

### File structure

| File | New / Update |
|---|---|
| `src/sim/scoring/mamaScore.ts`, `src/sim/scoring/stars.ts` (+ tests) | New |
| `src/sim/{world,events,snapshot,index,step}.ts`, `src/sim/flow/flowSystem.ts`, `src/sim/threats/{threatFsm,gags}.ts` (+ tests) | Update |
| `src/content/schemas/{feel,feedback}.ts`, `tools/content/contentChecks.ts` | Update |
| `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/{feel,feedback}.schema.json`, `tests/support/testFeel.json` | Update |
| `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md` (frontmatter `spacing.text-min`), `src/client/ui/styles/tokens.css` | Update |
| `src/client/ui/screens/resultScreen.ts` (+ test) | New |
| `src/client/app/{overlay,levelSession}.ts`, `src/client/ui/{overlayHost,keys,strings}.ts`, `src/client/feedback/{feedbackEvents,feedbackDirector}.ts`, `src/client/ui/styles/ui.css`, `src/client/boot.ts` | Update |
| `tools/audio/makePlaceholderAudio.ts`, `public/assets/audio/{ui_star_stamp,ui_star_stamp_last}.m4a` | Update / New |
| `tools/sim/simReport.ts`, `tests/tools/sim/{simReport,mamaScore}.test.ts` | Update / New |
| `tests/e2e/result.spec.ts`, `tests/e2e/timer.spec.ts`, `tests/e2e/support/game.ts`, `tests/golden/journals/*` | New / Update |

### Testing

**Unit (Node, Vitest, time in steps):**
- **`stars.test.ts`:** the bounds of AC 4 and a second list of thresholds.
- **`mamaScore.test.ts`:**
  - each component at 0, mid-range and over its cap (clamped);
  - rounding of fractional weights, with the rows still adding up;
  - the fixed baby state;
  - `scorePoints` clamped (feed a feel that would exceed 100, with the refines bypassed by building the object by hand);
  - `scoreLevel`: writes `final` and pushes one `LevelScored` with the same fields and `t`.
- **Flow:**
  - the ending step pushes `LevelEnded` then `LevelScored`, in that order, with the same `t`;
  - no `LevelScored` while `playing`;
  - none after (`ENDED_SYSTEMS`).
- **Counters:**
  - a perfect press increments `perfects`, and a success or a fail does not;
  - the micro-sleep's perfect counts;
  - a `stairs_slide` gag increments `nearMisses`, and the other gags do not (1.21's surprise gags included).
- **Snapshot:** the new version, every field of `scoreProblem` (negative, non-integer, `final` while `playing`, `final` missing a field), and a round trip with a scored world.
- **Content:**
  - `feelSchema.test.ts`: each new weight is required, and each refine fails with its path;
  - feedback schema: `uiElement` accepted and `resultScreen` strict;
  - `content:check`: a client-event cue with a `soundWave` is refused, one with a `uiElement` is accepted, and a sim-event cue with a `uiElement` is refused.
- **Client:**
  - `resultScreen.test.ts`, with a fake scheduler and clock:
    - the DOM structure and classes;
    - the rows' values and maxima, read from the feel passed in;
    - the count-up reaches each total at `rowCountUpMs`, staggered;
    - the stars stamp at `starIntervalMs`, with `onStar(false)` × (n − 1) then `onStar(true)`;
    - 0 stars gives no callback and the actions come after the rows;
    - the actions appear and « Rejouer » is focused;
    - a skip completes silently (no `onStar`), and the skipping press does not call `onReplay`;
    - `activate()` skips, then replays;
    - a « done » build shows everything at once with no callbacks;
    - no copy-log button;
    - `dispose()` cancels the timers.
  - `overlay.test.ts` (`chooseOverlay` with `result`), `keys.test.ts` (`padAction` on `result`), `levelSession.test.ts` (`finish()`), `strings.test.ts` (`formatString`), `feedbackDirector.test.ts` (`uiElement` draws nothing and the audio and haptic still play).
- **CLI:** `simReport.test.ts` (the new fields, `null` with no ended run, `starCounts` sums to `endedRuns`) and `mamaScore.test.ts` (AC 7).

**e2e** (`tests/e2e/result.spec.ts`, chromium + webkit, 844 × 390). Use a frozen level (`ppFreeze(true)`, `ppLoadLevel('salon_crawler', 42)`), then `advanceToEnd` in chunks. **Never `waitForTimeout`**: wait on `data-pp-result`.
1. **The end.**
   - `data-pp-app="result"`; the HUD root is hidden.
   - The four `.pp-score-row` labels equal `STRINGS['result.score_*']`.
   - Their values equal the `LevelScored` event read through `ppEvents` (with `sighMax − sigh` and `screamMax − scream`). Their maxima equal the live feel. Their sum equals `scorePoints` and `data-pp-score`.
   - The count of `.pp-star-earned` equals `stars`, and each has a computed stroke equal to the `ink` token.
   - `data-pp-result` reaches `actions`.
   - « Rejouer » is focused, its box is ≥ 44 × 44, and there is no « Copier le journal » text on the page.
   - Every text node in the panel has a computed `font-size` ≥ 16px.
2. **Haptics** (chromium only, `recordVibrations`): the light pattern × (stars − 1), then the heavy one, in order, and nothing more. Read the patterns from `feedback.json › haptics`. WebKit records nothing (1.19 note): assert there that `data-pp-cue-count` grew by `stars`.
3. **Skip:** a click on the panel while `data-pp-result="rows"` gives `actions` at once, with no vibration recorded after the click.
4. **Rejouer:**
   - set `window.__ppMarker = 1`, then click « Rejouer »;
   - `appHistory` shows `result → loading → level`;
   - `window.__ppMarker === 1`, so there was no reload;
   - `data-pp-seed` is not `"42"`;
   - `data-pp-flow="playing"`, and `data-pp-score` is gone.

   Also run a variant with Enter, and one with pad A (`stubGamepad`).
5. **Reduced motion** (`page.emulateMedia({ reducedMotion: 'reduce' })`): a stamped star's computed `animation-name` is the fade, not the stamp.
6. **Short viewport** (750 × 340): the panel's `scrollHeight ≤ clientHeight`, and « Rejouer » is still ≥ 44 × 44.

Every bound comes from the live content via `support/game.ts`. No pinned score: the score depends on the tuning.

**Golden:** T8. The timings of the live tests: the 180 s games take time, so use 120 s timeouts like 1.18-1.21.

### Previous story intelligence (1.18-1.21)

- **1.21** (review, merged before this story starts):
  - `world.mess.mischiefs` exists for this story (its Open point 4: « 1.22 counts mischiefs in the Sigh »).
  - Its snapshot is v9, so yours is v10.
  - It added `ForceThreat`, so the e2e can force threats if a scenario needs one.
  - The surprise gags emit no `NearMiss`.
  - Its mirror pattern (`ppSilence`) and `onLevelFrame` gates on `flow.state`.
  - Its Debug Log: heavy machine load gave timeouts, not assertions. Rerun with `--maxWorkers=5` / `--workers=4` and say so.
- **1.20:**
  - A new world slice means a snapshot bump and a `…Problem` per field.
  - `npm run assets:audio` rewrites every `.m4a`: restore the others.
  - Mirrors are written on events or changes only, and deleted at level start.
  - Bounds in e2e come from the live content.
- **1.19:** import cycles (`runFatigue` had to move). Keep `scoring/` a leaf. CSS state classes start with `pp-`.
- **1.18:** `ENDED_SYSTEMS` freezes the world; `playGame` stops at `flow.state !== 'playing'`. The live 180 s tests need 120 s timeouts. `timer.spec.ts` is the template for driving a level to its end.
- **1.15 / 1.16 reviews** punished e2e tests tied to live timings or ids, tautological assertions, and records that overstate what was verified. Tick only what you ran.
- **deferred-work items this story closes or annotates:**
  - L202: `meanScore` is `null`. Closed (AC 6).
  - L277: `isOnFloor` flicker. Decided by D5: read once on a frozen world, no hysteresis.
  - L336: the frozen world stays on screen after `LevelEnded`. The Result screen now covers it, and the room is drawn behind the veil.
  - L288 / L298: the coffee-table threat is still targeted once the mug has fallen. It still gives a Rire point when parried perfectly. Not fixed; note it under this story (2.x).
  - L25: « nothing checks that the Mama score can reach the top star threshold ». Partly addressed by the sum-to-100 refine. Reaching 90 needs the full Rire with `babyStateFixedPoints` 20: note it.
  - L72: unused-string-key check. Still open (3.11 adds the rest of the `result.*` keys).

### Git intelligence

- Commits are written « Story X : création de la story », « Story X : <titre> » and « Story X : corrections de la revue de code », in French, with a space before the colon. The implementation commit is `Story 1.22 : note de Maman et écran de fin`.
- Goldens, schemas and generated audio go in the same commit as the code that changes them.
- This story runs in its own worktree (`papa-parade-1-22-note-de-maman-et-ecran-de-fin`) on `story/1-22-note-de-maman-et-ecran-de-fin`. Do not switch branches in the main checkout.

### Project Structure Notes

- `src/sim/scoring/` is the folder the architecture names (L495). `mamaMemory.ts` is 3.10, not this story.
- `src/sim/flow/levelFlow.ts` (architecture L496) is `flowFsm.ts` + `flowSystem.ts` in the code since 1.18. Keep the code's names.
- `src/client/ui/screens/resultScreen.ts` matches architecture L522.
- `src/client/telemetry/` (the journal) is 3.3. This story only leaves the `copyLog` slot.
- The new `spacing.text-min` token is the one change this story makes to the UX spec. `DESIGN.md` L450 asks for it.

### Project context rules (from `_bmad-output/project-context.md`)

- **System order** and « systems never call each other » (L40). FSMs change only through `enter…State()` (L43). The flow gains no state here.
- **No GDD number in code.** Every weight, threshold, maximum and timing is in `feel.json` / `feedback.json` (L59, L151). « Anything Geo might want to tweak is data. »
- **Sim emits events, past tense** (L67). Every feedback entry with `audio` has a `visual` and a `haptic` (L67, L155). The stars keep this through `uiElement`.
- **UX spec is the source of truth.** Tokens are mirrored 1:1 and strings go through `t()` (L71). Reduced motion is client-only (L71).
- **Touch targets ≥ 44 × 44 pt** and landscape safe areas (L137).
- **Debug code is tree-shaken from store builds** (L139): « Copier le journal » will sit behind `VITE_DEBUG_ALLOWED`.
- **Goldens are regenerated deliberately, and said** (L123). No weakened guardrail, no new library, no `enum`.
- **Every feature stays playable end to end without a human** (L165): the CLI reports the score, and the e2e drives the Result screen and « Rejouer ».

### Open points for Geo (decide or tune after playing; all are data or one-line changes)

1. **A game cannot score under 20 in 1.22, so it always earns ★1.** With `babyStateFixedPoints` 20 and base 30, the worst case is 20 + 30 − 15 − 15 = 20, the first threshold. Even the `idle` bot gets one star. This follows the GDD formula and the fixed baby state; the real « État du bébé » (E5) and the early wake (3.2) can take it lower. Tell me if you want `babyStateFixedPoints` lower or the first threshold higher.
2. **A perfect on the micro-sleep counts toward Rire.** Every `ResponseResolved{perfect}` counts. Say if only the baby's threats should count.
3. **The weights of D4 are first guesses.** With 1 point per perfect, the `human` bot already reaches the 40-point cap (about 40 perfects); a real player will be lower. 5 / 8 / 3 / 3 for Sigh and Scream.
4. **Timings of the sequence:** 600 ms count-up, 200 ms stagger and 450 ms between stars. That is about 3 s for 3 stars, skippable by a tap.
5. **No title or header on the screen in 1.22** (the mockup's headers belong to 3.2 / 3.11). `result.title` is only the dialog's `aria-label`.

### References

- `epics.md`: L73, L227-229, L238-242, L476, L636, L925-926, L949, L1001-1031 (1.18), L1118-1151 (1.22), L1201 (1.24), L1310-1318 (2.4), L1576-1584 (3.2), L1603-1608 (3.3), L1697 (3.7), L1734-1739 (3.9), L1777-1805 (3.11), L1855 (4.2), L2082 (5.x).
- GDD L87, L99, L103, L110-112, L153, L387-401, L516, L559. `decision-log.md` L9, L14.
- Architecture L72, L198, L229-231, L237-238, L250, L252-254, L262, L279, L296-297, L495-496, L510, L522-523, L588-591, L897, L921, L946, L1031-1042, L1058.
- `DESIGN.md` L97-109 (spacing frontmatter), L111-147, L283-305, L401, L423, L444, L450, L453, L461, L471-476, L498-502, L514-516. `EXPERIENCE.md` L40, L64-70, L87, L99-115, L127, L172-181, L203-205, L224-226, L294, L316-330, L368, L379, L412-439, L510-520. `mockups/key-result.html` L49-102 and L169-202.
- `deferred-work.md` L25, L72, L202, L277, L288, L298 and L336 (on `main` at `6a80a1d`); on 1.21's branch, its « 1.22 counts mischiefs » item.
- `1-21-le-silence-suspect.md` (Open point 4, Debug Log), `1-20-le-telephone-qui-sonne.md`, `1-18-vagues-de-menaces-et-chrono-du-niveau.md`.

## Dev Agent Record

### Agent Model Used

Claude (Claude Code, gds-dev-story)

### Debug Log References

- T0: 1.21 is `done` on `main`; merged `main` into the branch (428e7e3), only the `sprint-status.yaml` status lines conflicted. Baseline `(unset VITE_DEBUG_ALLOWED; npm run ci)` green before the first edit: 190 files / 3194 unit tests, 244 e2e (chromium + webkit).
- T3: `npm run sim -- --runs 5` on the live level (seed 1): `perfect` 90 every run (★5, `starCounts` [0,0,0,0,0,5]), `human` mean 84.6 (83 to 89, ★4 every run), `idle` 20 every run (★1). As D4 predicted.
- T6: `npm run assets:audio` rewrote every `.m4a`; only `ui_star_stamp.m4a` and `ui_star_stamp_last.m4a` kept, the 17 others restored from the repository.
- T7: the first run of `result.spec.ts` failed on my own mistake (`recordAppStates` called before the page loaded, in the skip test); fixed, then 16/16 on chromium and webkit. A throwaway screenshot spec (deleted) showed the screen at 844 × 390 and 750 × 340: it fits, the room is drawn dimmed under the scrim.
- T8: `npm run golden:update` (deliberate): in the 6 golden journals only `worldHash` (the new `score` slice) and `feelHash` (the five new keys) moved; `eventTypes`, `eventsHash` and `levelHash` are identical, as AC 17 predicted. The screenshot references did not move.
- Final `(unset VITE_DEBUG_ALLOWED; npm run ci)` green: 194 files / 3303 unit tests, 260 e2e (chromium + webkit), `src/sim` coverage 97.75 % statements / 97.19 % branches. No `--maxWorkers` / `--workers` override was needed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- **Content (AC 1, 10, 11, 13).** `feel.mama` gains the five weights (1 / 5 / 8 / 3 / 3) and two refines (maxima add up to 100, on `laughMaxPoints`; base = sigh max + scream max, on `baseScorePoints`). `feedback.json` gains `resultScreen` (strict, real ms), the cues `result_star` (light) and `result_star_last` (heavy) on the `ui` bus with a `uiElement` visual, and the two client events. `content:check` refuses a world visual (or a camera) on a client event, a `uiElement` on a sim event (path `cues.<id>.visual.kind`), and also a `uiElement` cue named by a threat or a disruption def (their cues play for sim events: one more case of the same rule). `formatString` fills `{name}` placeholders and warns once per text and name. `--pp-spacing-text-min: 16px` is in `DESIGN.md` and `tokens.css`. The existing feel test « a fixed baby state above its maximum » lowered the maximum, which now breaks the sum-to-100 refine too: it raises the fixed value instead.
- **Sim (AC 2-5).** `World.score { perfects, nearMisses, final }`; `perfects` +1 in `resolveThreat` on `perfect` (the micro-sleep's too), `nearMisses` +1 in the stairs gag beside its `NearMiss`. `sim/scoring/stars.ts` and `sim/scoring/mamaScore.ts` (`computeMamaScore` pure, `scoreLevel` writes `final` and pushes `LevelScored`), called by `runFlow` right after `LevelEnded`. Snapshot v10 with `scoreProblem` (counts, `final` null while playing, a whole `MamaScore` once ended, score ≤ 100, stars ≤ 5). `@sim` exports `MamaScore`, `ScoreSlice` and `starsForScore`. `MAMA_SCORE_MAX_POINTS` (100), `STAR_COUNT_MAX` (5) and `COUNT_UP_FRAME_MS` (16) are new constants in `shared/constants.ts`. The `scoring/` files import only `world.ts` / `context.ts` types, `@content` types and `@shared`.
- **CLI (AC 6, 7).** `meanScore`, `meanStars`, `starCounts`, per-run `scorePoints` / `stars`; `scoreNote` / `SCORE_NOTE` removed. `tests/tools/sim/mamaScore.test.ts` plays the live level to the end on seeds 1-3 with `perfect` and `idle` (each run played once and cached between the tests).
- **Client (AC 8, 12, 15, 16).** `levelSession.finish()` stops the loop and keeps `active` (a no-op without one). On `LevelScored`, `boot.ts` stores the note, mirrors `ppScore` / `ppStars`, calls `finish()`, enters `result` and redraws the static frame (the stopped loop's `resetFx` cleared the rings). The `result` overlay goes after `portrait` and `oops`, before `pause`, so a page hidden on the Result screen leaves no veil (checked in `chooseOverlay` and its test). `menuPoll` runs in `result`; `padAction` maps A to `activate`. The director skips a `uiElement` visual silently. The note and the « done » flag are cleared on `loading`; « Rejouer » calls `levelSession.start()`.
- **Result screen (AC 9-14).** `resultScreen.ts` builds the dialog, the score card (four rows with chips, labels, values, maxima from the feel), the total out of the summed maxima, five star slots and « Rejouer ». The sequence runs on an injected scheduler and `now()`; the total follows the rows as they count. A skip (press on the screen, Enter / Space / NumpadEnter, pad A) completes silently; a key that skipped is ignored by « Rejouer » until it is let go (Space activates a button on keyup). `isDone` builds the end state with no callback. The screen takes a `doc` (like `svgElement`) so that its unit test runs on a small fake DOM: the repository has no DOM library and the story allows no new dependency. Reduced motion is CSS only (the stamp becomes `pp-fade-in`), so the screen takes no `isMotionReduced` option, unlike the builder list in T4 suggested.
- **Audio (AC 11).** Two synths, `synthStarStamp` (120 ms bright blip) and `synthStarStampLast` (400 ms lower chord).
- **e2e (AC 8-17).** `result.spec.ts`: the end (rows from `LevelScored` and the live feel, sum, stars, ink stroke, focus, 44 × 44, no « Copier le journal », every text ≥ `--pp-spacing-text-min`), the stamps (a feel patch makes every game reach five stars; chromium checks light × 4 then heavy, both browsers check the cue count), the skip, « Rejouer » by touch, Enter and pad, reduced motion and 750 × 340. `timer.spec.ts`'s end test now asserts `result`, the hidden HUD, the mirrored score and a stopped loop. `advanceToEnd` steps exactly to the last step: once the level has ended the loop is gone, so a further `advance` would throw.
- **Open points for Geo** are unchanged from the story (★1 floor at 20 points, the micro-sleep's perfect counts, the D4 weights, the sequence timings, no header). The CLI confirms them: `idle` gets 20 (★1), `perfect` 90 (★5).

### File List

New:
- `src/sim/scoring/mamaScore.ts`, `src/sim/scoring/mamaScore.test.ts`
- `src/sim/scoring/stars.ts`, `src/sim/scoring/stars.test.ts`
- `src/client/ui/screens/resultScreen.ts`, `src/client/ui/screens/resultScreen.test.ts`
- `public/assets/audio/ui_star_stamp.m4a`, `public/assets/audio/ui_star_stamp_last.m4a`
- `tests/e2e/result.spec.ts`
- `tests/tools/sim/mamaScore.test.ts`

Updated:
- `src/sim/world.ts`, `src/sim/events.ts`, `src/sim/events.test.ts`, `src/sim/snapshot.ts`, `src/sim/snapshot.test.ts`, `src/sim/index.ts`, `src/sim/step.ts`
- `src/sim/flow/flowSystem.ts`, `src/sim/flow/flowSystem.test.ts`
- `src/sim/threats/threatFsm.ts`, `src/sim/threats/threatFsm.test.ts`, `src/sim/threats/gags.ts`, `src/sim/threats/gags.test.ts`
- `src/shared/constants.ts`
- `src/content/schemas/feel.ts`, `src/content/schemas/feedback.ts`
- `content/feel.json`, `content/feedback.json`, `content/strings.fr.json`, `content/_schemas/feel.schema.json`, `content/_schemas/feedback.schema.json`
- `src/client/boot.ts`
- `src/client/app/levelSession.ts`, `src/client/app/levelSession.test.ts`, `src/client/app/overlay.ts`, `src/client/app/overlay.test.ts`
- `src/client/ui/overlayHost.ts`, `src/client/ui/keys.ts`, `src/client/ui/keys.test.ts`, `src/client/ui/strings.ts`, `src/client/ui/strings.test.ts`
- `src/client/ui/styles/ui.css`, `src/client/ui/styles/tokens.css`
- `src/client/feedback/feedbackEvents.ts`, `src/client/feedback/feedbackDirector.ts`, `src/client/feedback/feedbackDirector.test.ts`
- `tools/content/contentChecks.ts`, `tools/sim/simReport.ts`, `tools/audio/makePlaceholderAudio.ts`
- `tests/content/feelSchema.test.ts`, `tests/content/feedbackSchema.test.ts`, `tests/content/checkContent.test.ts`
- `tests/support/testFeel.json`, `tests/support/testContent.ts`
- `tests/tools/sim/simReport.test.ts`, `tests/tools/audio/makePlaceholderAudio.test.ts`
- `tests/e2e/timer.spec.ts`, `tests/e2e/support/game.ts`
- `tests/golden/journals/{baby_wander,core_basic,outlet_parry,papa_walk,prop_fall,threat_trio}{.json,.expected.json}` (regenerated)
- `_bmad-output/planning-artifacts/ux-designs/ux-papa-parade-2026-10-26/DESIGN.md` (frontmatter `spacing.text-min`)
- `_bmad-output/project-context.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log


- 2026-10-28: story created (ready-for-dev).
- 2026-10-28: implemented (Mama's note in the sim, the CLI and the Result screen); goldens regenerated (`worldHash`, `feelHash` only); status review.
- 2026-10-28: code review. Fixes (decision D-grace and 8 patches): `inputGraceMs` (schema, `feedback.json`, test tables, `createResultScreen` ignores a press that starts within it, at build and after the buttons come up; a rebuilt finished screen takes presses at once); `heldSkipKey` reset on window `blur`; the screen rebuilt after the portrait overlay shows its end whatever phase it was in (`hasResultStarted` in `boot.ts`); `ppScore` / `ppStars` / `ppResult` cleared on `AppStateChanged → loading`; the maxima, `baseScorePoints` and `babyStateFixedPoints` of `MamaSchema` are whole numbers and `starThresholdPoints` is `.length(STAR_COUNT_MAX)`; `result.stars_label` reads « {count} sur {max} étoiles » (**deviates from the wording the spec prescribed**); `timer.spec.ts` ends the level on the real, unfrozen loop, `result.spec.ts` gains the tap-behind-the-screen and the mid-stars portrait cases, the star-stroke check moved to the five-star test, and the « 0 at once » unit test now checks that no frame timer is scheduled. The e2e specs that press wait out the live grace (`waitForInputGrace`). Five items deferred (`deferred-work.md`).
