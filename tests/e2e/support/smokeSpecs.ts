/**
 * The smoke tier of the e2e suite: what `npm run e2e:smoke` and `npm run ci:story` play (Geo,
 * 2026-11-08). Every other spec of `tests/e2e` is the extended tier, played only by `npm run e2e`
 * (and so by `npm run ci`, before a playtest link).
 *
 * The browser proves the wiring, once per layer; the game rules are proven headless (sim tests,
 * bots, goldens), in milliseconds. A spec is smoke when it proves one of these and nothing else does:
 * - the page boots, draws, and shows the error screens;
 * - a first launch goes through the calibration and the save;
 * - the `window.__PP__` contract every other spec, the autoplay and the device pass lean on;
 * - a tap becomes a command (the core loop: telegraph, tap, parry, gag; the tap latency);
 * - each level plays in the browser to its Result, and is the CLI's game (world hash, screenshot);
 * - the Result screen exports a journal that `sim:replay` replays;
 * - a page sent to the background pauses and resumes.
 *
 * The list has a fixed size (`tests/architecture/e2eSmoke.test.ts` caps it): a new mechanic gets
 * its proof in Vitest, and a new e2e spec, when the client wiring needs one, is extended.
 */
export const SMOKE_SPECS: readonly string[] = [
  'boot.spec.ts',
  'calibration.spec.ts',
  'testApi.spec.ts',
  'threat.spec.ts',
  'tapLatency.spec.ts',
  'autoplay.spec.ts',
  'firstLevel.spec.ts',
  'salonKitchen.spec.ts',
  'chambreNight.spec.ts',
  'journal.spec.ts',
  'pauseResume.spec.ts',
];

/** The most files the smoke tier may hold: past that, it is the whole suite again. */
export const SMOKE_SPECS_MAX = 12;
