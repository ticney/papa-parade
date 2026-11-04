import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  advanceTo,
  chronoRingsInShownMarkers,
  cueIds,
  LEVEL,
  openFrozen,
  shot,
  shownMarkers,
  start,
  threatOf,
  typesOf,
} from './support/duel.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  OVERRUN_MARGIN_MS,
  pagePointOf,
  recordVibrations,
  stubGamepad,
  threatIconPoint,
  vibrations,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppLoadLevel,
  ppSend,
  ppState,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// « Sortie en infiltration » (story 4.9) on the live level, driven by the test API on a frozen level (steps
// by hand) with real input, and in real time for the autoplay. The alerts come by the seed: a helper
// loads the level with one seed after another until the first alert is the kind a test needs (the sim
// draws it; no test can choose it), so nothing here is a number of the live tuning. Every bound is
// read from the world or from the live content. Chromium and WebKit both run it; the vibrations and
// the pad are checked on Chromium only.

const isChromium = (): boolean => test.info().project.name === 'chromium';
const SEQUENCE = 'stealth_exit';
const SIGH = 'false_alarm_sigh';
const WAKE = 'real_wake';
const { holdMinMs } = liveFeel.stealth;

const sequenceDef = JSON.parse(readFileSync('content/sequences/stealth_exit.json', 'utf8')) as {
  steps: { exitAnchor: string; exitRadiusM: number }[];
};
const alarmDef = JSON.parse(readFileSync('content/threats/false_alarm_sigh.json', 'utf8')) as {
  nothingMs: number;
};
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  anchors: { id: string; positionM: number[] }[];
  zones: { id: string; kind: string; centerM: number[] }[];
};
const feel = liveFeel as unknown as {
  movement: { walkSpeedMps: number };
  stealth: { sneakSpeedPct: number; breathCapacityMs: number };
  noise: { sources: { floorCreak: { noisePct: number } } };
};
const STEP = sequenceDef.steps[0] as { exitAnchor: string; exitRadiusM: number };
const DOOR = geometry.anchors.find((anchor) => anchor.id === STEP.exitAnchor)?.positionM ?? [
  0, 0, 0,
];
const PLAYPEN = geometry.zones.find((zone) => zone.kind === 'safe')?.centerM ?? [0, 0, 0];
const SNEAK_MPS = (feel.movement.walkSpeedMps * feel.stealth.sneakSpeedPct) / 100;

// The ring is a CSS2D box with no size of its own: its band is what is seen.
const ring = (page: Page) => page.locator('.pp-breath-ring-band');
const exitMarker = (page: Page) => page.locator('.pp-exit-marker');
/** Whether some element of `selector` is drawn: the CSS2D renderer attaches an element only once it has been visible. */
const isShown = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((elements) =>
      elements.some((element) => getComputedStyle(element).display !== 'none'),
    );

type World = Awaited<ReturnType<typeof ppWorld>>;
const stealthOf = (world: World) => world.sequence.stealth;
const eventsOf = async (page: Page, type: string) =>
  (await ppEvents(page)).filter((event) => event.type === type);

/** Starts the sequence on a level loaded with `seed`, and steps until an alert is telegraphed, or `untilMs` of sim time. */
async function untilAlert(page: Page, seed: number, untilMs = 8000): Promise<string | null> {
  await ppLoadLevel(page, LEVEL, seed);
  await start(page, SEQUENCE);
  while ((await ppWorld(page)).time.sim < untilMs) {
    const world = await ppWorld(page);
    const up = [SIGH, WAKE]
      .map((defId) => threatOf(world, defId))
      .find((threat) => threat?.state === 'telegraph');
    if (up !== undefined) return up.defId;
    await ppAdvance(page, 10);
  }
  return null;
}

/** The level and the sequence, with the first alert of the kind asked for telegraphed (the next seeds are tried). */
async function reachAlert(page: Page, defId: string) {
  await openFrozen(page);
  for (let seed = 1; seed <= 120; seed++) {
    if ((await untilAlert(page, seed)) !== defId) continue;
    const alert = threatOf(await ppWorld(page), defId);
    if (alert === undefined || alert.responseWindow === null) continue;
    return {
      seed,
      id: alert.id,
      enteredAt: alert.enteredAt,
      windowOpenAt: alert.windowOpenAt,
      windowMs: alert.responseWindow.windowMs,
    };
  }
  throw new Error(`no seed from 1 to 120 gives a first alert of ${defId}`);
}

/** The level and the sequence, on a seed whose first alert comes after `afterMs` (a crossing with none before the door). */
async function reachQuiet(page: Page, afterMs: number): Promise<number> {
  await openFrozen(page);
  for (let seed = 1; seed <= 120; seed++) {
    await ppLoadLevel(page, LEVEL, seed);
    await start(page, SEQUENCE);
    const { nextAlertAt } = stealthOf(await ppWorld(page));
    if (nextAlertAt !== null && nextAlertAt > afterMs) return seed;
  }
  throw new Error(`no seed from 1 to 120 puts the first alert after ${afterMs} ms`);
}

/** A real tap on a floor point of the room, in metres. */
async function tapFloorAt(page: Page, xM: number, zM: number): Promise<void> {
  const point = await pagePointOf(page, xM, 0, zM);
  await page.mouse.click(point.x, point.y);
}

/** Real time for a finger to be down `holdMinMs`, then the sim steps so that it is read. */
async function holdFor(page: Page): Promise<void> {
  await page.waitForTimeout(holdMinMs + 150);
  await waitFrames(page, 3);
  await ppAdvance(page, 2);
}

test.describe('the start', () => {
  test('puts Papa and the baby over the playpen, shows « SORS ! » at the door, and starts the music', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page, SEQUENCE);
    const world = await ppWorld(page);
    expect(world.papa.xM).toBeCloseTo(PLAYPEN[0] as number, 5);
    expect(world.papa.zM).toBeCloseTo(PLAYPEN[2] as number, 5);
    expect(world.baby.xM).toBeCloseTo(PLAYPEN[0] as number, 5);
    expect(world.baby.zM).toBeCloseTo(PLAYPEN[2] as number, 5);
    await expect(html(page)).toHaveAttribute('data-pp-sequence', SEQUENCE);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'on');
    await waitFrames(page, 3);
    await expect(exitMarker(page)).toBeVisible();
    await expect(exitMarker(page)).toContainText(STRINGS['verb.exit'] as string);
    expect(await isShown(page, '.pp-breath-ring')).toBe(false);
    expect(problems).toEqual([]);
  });
});

test.describe('walking', () => {
  test('a real tap on the floor walks Papa at the sneak speed', async ({ page }) => {
    const problems = collectProblems(page);
    await reachQuiet(page, 3000);
    const before = await ppWorld(page);
    await tapFloorAt(page, (PLAYPEN[0] as number) + 2.5, PLAYPEN[2] as number);
    await ppAdvance(page, 100);
    const after = await ppWorld(page);
    expect(after.papa.state).toBe('walkPath');
    const walkedM = Math.hypot(after.papa.xM - before.papa.xM, after.papa.zM - before.papa.zM);
    // One second of sim time, the first step of it spent on the tap's own latency.
    expect(walkedM).toBeGreaterThan(SNEAK_MPS * 0.85);
    expect(walkedM).toBeLessThan(SNEAK_MPS * 1.05);
    expect(problems).toEqual([]);
  });

  test('the keyboard walks him too, and a key held through the start walks at once', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await page.keyboard.down('KeyD');
    await start(page, SEQUENCE);
    await ppAdvance(page, 50);
    const world = await ppWorld(page);
    expect(world.papa.state).toBe('walkDir');
    expect(world.papa.xM).toBeGreaterThan(PLAYPEN[0] as number);
    await page.keyboard.up('KeyD');
    await ppAdvance(page, 3);
    expect((await ppWorld(page)).papa.state).toBe('idle');
    expect(problems).toEqual([]);
  });

  test('taking him, the coffee and the context action are dropped', async ({ page }) => {
    await openFrozen(page);
    await start(page, SEQUENCE);
    await page.keyboard.press('Space');
    await ppAdvance(page, 5);
    const world = await ppWorld(page);
    expect(world.baby.state).not.toBe('carried');
    expect(world.papa.state).toBe('idle');
    expect(await typesOf(page, 'BabyPickedUp')).toEqual([]);
  });
});

test.describe('the breath', () => {
  test('a held finger holds it after holdMinMs, the ring shows and empties, and the walk goes on; its up lets go', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    await reachQuiet(page, 6000);
    const box = await page.locator('#pp-canvas').boundingBox();
    if (box === null) throw new Error('the canvas has no box');
    const point = await pagePointOf(page, (PLAYPEN[0] as number) + 2.5, 0, PLAYPEN[2] as number);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await ppAdvance(page, 5);
    expect(await eventsOf(page, 'BreathHeld')).toEqual([]);
    await holdFor(page);
    expect(await eventsOf(page, 'BreathHeld')).toHaveLength(1);
    await ppAdvance(page, 100);
    await waitFrames(page, 3);
    await expect(ring(page)).toBeVisible();
    const pct = Number(await html(page).getAttribute('data-pp-breath-pct'));
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
    await expect(html(page)).toHaveAttribute('data-pp-breath-held', 'true');
    await ppAdvance(page, 100);
    await waitFrames(page, 3);
    expect(Number(await html(page).getAttribute('data-pp-breath-pct'))).toBeLessThan(pct);
    expect((await ppWorld(page)).papa.state).toBe('walkPath');
    await shot(page, testInfo, 'stealth-breath-ring.png');
    await page.mouse.up();
    await ppAdvance(page, 3);
    expect(await eventsOf(page, 'BreathReleased')).toHaveLength(1);
    await expect(html(page)).toHaveAttribute('data-pp-breath-held', 'false');
    expect(problems).toEqual([]);
  });

  test('a quick tap on the floor is a walk and never shows the ring', async ({ page }) => {
    await reachQuiet(page, 3000);
    await tapFloorAt(page, (PLAYPEN[0] as number) + 2, PLAYPEN[2] as number);
    await page.waitForTimeout(holdMinMs + 150);
    await waitFrames(page, 3);
    await ppAdvance(page, 20);
    await waitFrames(page, 3);
    expect(await eventsOf(page, 'BreathHeld')).toEqual([]);
    expect(await isShown(page, '.pp-breath-ring')).toBe(false);
    expect((await ppWorld(page)).papa.state).toBe('walkPath');
  });

  test('E holds it and lets go, and a refilling gauge keeps the ring up until it is full', async ({
    page,
  }) => {
    await reachQuiet(page, 6000);
    await page.keyboard.down('KeyE');
    await ppAdvance(page, 50);
    expect(stealthOf(await ppWorld(page)).breathHeldAt).not.toBeNull();
    await page.keyboard.up('KeyE');
    await ppAdvance(page, 2);
    expect(stealthOf(await ppWorld(page)).breathHeldAt).toBeNull();
    expect(await eventsOf(page, 'BreathReleased')).toHaveLength(1);
    await waitFrames(page, 3);
    await expect(ring(page)).toBeVisible();
    await ppAdvance(page, 200);
    await waitFrames(page, 3);
    expect(await isShown(page, '.pp-breath-ring')).toBe(false);
  });

  test('the right trigger of a pad holds it (Chromium)', async ({ page }) => {
    test.skip(!isChromium(), 'the pad is stubbed on Chromium only');
    const pad = await stubGamepad(page);
    await reachQuiet(page, 6000);
    await pad.setPadPresent(true);
    await pad.pressButton(7);
    await waitFrames(page, 4);
    await ppAdvance(page, 5);
    expect(stealthOf(await ppWorld(page)).breathHeldAt).not.toBeNull();
    await pad.releaseButton(7);
    await waitFrames(page, 4);
    await ppAdvance(page, 3);
    expect(stealthOf(await ppWorld(page)).breathHeldAt).toBeNull();
  });
});

test.describe('the boards', () => {
  test('a board creaks once on entering it: the cue, the noise and the vibration', async ({
    page,
  }) => {
    await recordVibrations(page);
    const problems = collectProblems(page);
    await reachQuiet(page, 6000);
    // The second board: the walk there crosses the first one, and a tap beside the baby would touch him.
    const second = geometry.zones.filter((zone) => zone.kind === 'creak')[1]?.centerM ?? [0, 0, 0];
    await tapFloorAt(page, second[0] as number, second[2] as number);
    for (let i = 0; i < 40; i++) {
      await ppAdvance(page, 10);
      if ((await eventsOf(page, 'FloorCreaked')).length > 0) break;
    }
    const creaks = await eventsOf(page, 'FloorCreaked');
    expect(creaks).toEqual([expect.objectContaining({ zoneId: 'board_01' })]);
    await waitFrames(page, 3);
    expect(await cueIds(page)).toContain('floor_creak');
    const noise = (await eventsOf(page, 'NoiseChanged')).filter(
      (event) => (event as unknown as { source: string }).source === 'floorCreak',
    );
    expect(noise).toEqual([
      expect.objectContaining({ deltaPct: feel.noise.sources.floorCreak.noisePct }),
    ]);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue('floor_creak'));
    }
    // Walking on it creaks no more (the board is wider than half a second of the sneak).
    await ppAdvance(page, 30);
    expect(await eventsOf(page, 'FloorCreaked')).toHaveLength(1);
    expect(problems).toEqual([]);
  });
});

test.describe('a false alarm', () => {
  test('shows the sigh and « CHUT… »; nothing done: resp_nothing, no gag, and the walk goes on', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    const alert = await reachAlert(page, SIGH);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.sigh);
    expect((await shownMarkers(page))[0]?.verb).toBe(STRINGS['verb.do_nothing']);
    await shot(page, testInfo, 'stealth-false-alarm.png');
    await tapFloorAt(page, (DOOR[0] as number) - 0.3, DOOR[2] as number);
    await page.keyboard.down('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs);
    await page.keyboard.up('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 3 * STEP_MS);
    expect(alert.windowMs).toBe(alarmDef.nothingMs);
    expect(await cueIds(page)).toContain('resp_nothing');
    expect(await typesOf(page, 'GagTriggered')).toEqual([]);
    expect(await eventsOf(page, 'BreathGasped')).toEqual([]);
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'nothing', quality: 'success' }),
    ]);
    const world = await ppWorld(page);
    expect(['walkPath', 'idle']).toContain(world.papa.state);
    expect(world.flow.state).toBe('sequence');
    expect(problems).toEqual([]);
  });

  test('a real tap on the marker wakes him: gag_baby_woke_by_touch, failed, acted', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const alert = await reachAlert(page, SIGH);
    await advanceTo(page, alert.windowOpenAt + 2 * STEP_MS);
    await waitFrames(page, 3);
    const icon = await threatIconPoint(page);
    await page.mouse.click(icon.x, icon.y);
    await ppAdvance(page, 3);
    await waitFrames(page, 3);
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'nothing', quality: 'fail', reason: 'acted' }),
    ]);
    expect(await cueIds(page)).toContain('gag_baby_woke_by_touch');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
    expect(problems).toEqual([]);
  });

  test('Space does the same: it presses the sigh', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await advanceTo(page, alert.windowOpenAt + 2 * STEP_MS);
    await page.keyboard.press('Space');
    await ppAdvance(page, 3);
    expect(await typesOf(page, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_woke_by_touch', reason: 'acted' }),
    ]);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
  });

  test('a tap on the floor meanwhile costs nothing', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await advanceTo(page, alert.windowOpenAt + 2 * STEP_MS);
    // Far from the baby, who lies at the front left.
    await tapFloorAt(page, (DOOR[0] as number) - 1, (DOOR[2] as number) + 1);
    await tapFloorAt(page, (DOOR[0] as number) - 2, (DOOR[2] as number) + 2);
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 3 * STEP_MS);
    expect(await typesOf(page, 'GagTriggered')).toEqual([]);
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'nothing', quality: 'success' }),
    ]);
  });
});

test.describe('the breath in a false alarm', () => {
  test('not held when the window opens: a gasp, once, and the cue', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 3 * STEP_MS);
    await waitFrames(page, 3);
    expect(await eventsOf(page, 'BreathGasped')).toEqual([
      expect.objectContaining({ reason: 'notHeld' }),
    ]);
    expect(await cueIds(page)).toContain('breath_gasped');
  });

  test('held throughout and let go at the end: no gasp', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await page.keyboard.down('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs);
    await page.keyboard.up('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 3 * STEP_MS);
    expect(await eventsOf(page, 'BreathGasped')).toEqual([]);
    expect(await cueIds(page)).not.toContain('breath_gasped');
  });

  test('let go early: a gasp', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await page.keyboard.down('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs / 2);
    await page.keyboard.up('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 3 * STEP_MS);
    expect(await eventsOf(page, 'BreathGasped')).toEqual([
      expect.objectContaining({ reason: 'early' }),
    ]);
  });

  test('a pause while held costs its gasp, as a pause in a Firmness does', async ({ page }) => {
    const alert = await reachAlert(page, SIGH);
    await page.keyboard.down('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs / 2);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await page.keyboard.up('KeyE');
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await ppAdvance(page, 5);
    expect(await eventsOf(page, 'BreathGasped')).toEqual([
      expect.objectContaining({ reason: 'early' }),
    ]);
  });
});

test.describe('a real wake', () => {
  test('shows the cry and « BERCE ! »; a real tap in time parries it, Papa glides back, and he walks again', async ({
    page,
  }, testInfo) => {
    // `reachAlert` searches the seeds for a real wake: 28 s of the 30 s on a quiet machine.
    test.slow();
    const problems = collectProblems(page);
    const alert = await reachAlert(page, WAKE);
    await expect.poll(async () => (await shownMarkers(page))[0]?.glyph).toBe(THREAT_ICON_PATHS.cry);
    expect((await shownMarkers(page))[0]?.verb).toBe(STRINGS['verb.rock']);
    await shot(page, testInfo, 'stealth-real-wake.png');
    // Away from the baby first, so that the glide back is a distance.
    await tapFloorAt(page, (PLAYPEN[0] as number) + 2.5, PLAYPEN[2] as number);
    await ppAdvance(page, 20);
    await advanceTo(page, alert.windowOpenAt + alert.windowMs / 2);
    await waitFrames(page, 3);
    const icon = await threatIconPoint(page);
    await page.mouse.click(icon.x, icon.y);
    await ppAdvance(page, 3);
    await waitFrames(page, 3);
    const ids = await cueIds(page);
    expect(ids.some((id) => id === 'resp_parry' || id === 'resp_parry_perfect')).toBe(true);
    expect(await eventsOf(page, 'PapaGlideStarted')).toHaveLength(1);
    await ppAdvance(page, 200);
    const world = await ppWorld(page);
    expect(world.flow.state).toBe('sequence');
    expect(Math.hypot(world.papa.xM - world.baby.xM, world.papa.zM - world.baby.zM)).toBeLessThan(
      1,
    );
    // Far from the baby: a tap beside him would touch him.
    await tapFloorAt(page, (DOOR[0] as number) - 1, (DOOR[2] as number) + 1);
    await ppAdvance(page, 10);
    expect((await ppWorld(page)).papa.state).toBe('walkPath');
    expect(problems).toEqual([]);
  });

  test('not answered: gag_baby_woke_crying, and the sequence is failed', async ({ page }) => {
    test.slow();
    const alert = await reachAlert(page, WAKE);
    await advanceTo(page, alert.windowOpenAt + alert.windowMs + 400);
    await waitFrames(page, 3);
    expect(await cueIds(page)).toContain('gag_baby_woke_crying');
    expect(await typesOf(page, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_woke_crying', reason: 'late' }),
    ]);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
  });
});

test.describe('the door', () => {
  test('reaching it wins: Papa is free, and the ring and the exit marker are gone', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await reachQuiet(page, 6000);
    await tapFloorAt(page, DOOR[0] as number, DOOR[2] as number);
    for (let i = 0; i < 80; i++) {
      await ppAdvance(page, 10);
      if ((await ppWorld(page)).flow.state !== 'sequence') break;
    }
    await waitFrames(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    expect((await ppWorld(page)).flow.state).toBe('playing');
    expect(await isShown(page, '.pp-exit-marker')).toBe(false);
    expect(await isShown(page, '.pp-breath-ring')).toBe(false);
    await page.keyboard.down('KeyD');
    await ppAdvance(page, 20);
    expect((await ppWorld(page)).papa.state).toBe('walkDir');
    await page.keyboard.up('KeyD');
    expect(problems).toEqual([]);
  });
});

test.describe('the options', () => {
  test('under reduced motion the sigh and the ring still show', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = collectProblems(page);
    const alert = await reachAlert(page, SIGH);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.sigh);
    await page.keyboard.down('KeyE');
    await advanceTo(page, alert.windowOpenAt + alert.windowMs / 2);
    await waitFrames(page, 3);
    await expect(ring(page)).toBeVisible();
    await shot(page, testInfo, 'stealth-reduced.png');
    await page.keyboard.up('KeyE');
    expect(problems).toEqual([]);
  });

  test('with the sfx bus at 0 the verb, the glyph and the vibration still come', async ({
    page,
  }) => {
    await recordVibrations(page);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        SAVE_STORAGE_KEY,
        calibratedSaveValue({}, { volumes: { music: 100, sfx: 0, voice: 100, ui: 100 } }),
      ],
    );
    const problems = collectProblems(page);
    await reachAlert(page, SIGH);
    await expect(html(page)).toHaveAttribute('data-pp-volumes', '100,0,100,100');
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.verb)
      .toBe(STRINGS['verb.do_nothing']);
    expect((await shownMarkers(page))[0]?.glyph).toBe(THREAT_ICON_PATHS.sigh);
    // The false alarm is a « do nothing »: no chrono-ring (story 2.11).
    expect(await chronoRingsInShownMarkers(page)).toBe(0);
    await waitFrames(page, 3);
    expect(await cueIds(page)).toContain('tel_false_alarm_sigh');
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue('tel_false_alarm_sigh'));
    }
    expect(problems).toEqual([]);
  });

  test('the exit marker and the door at 667 × 375', async ({ page }, testInfo) => {
    await openFrozen(page);
    await start(page, SEQUENCE);
    await waitFrames(page, 3);
    await shot(page, testInfo, 'stealth-exit-marker.png');
    await expect(exitMarker(page)).toBeVisible();
  });
});

test.describe('autoplay', () => {
  test('the perfect bot sneaks out: outcome succeeded, started by the test API', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await page.goto('/?autoplay=perfect&seed=42&speed=4');
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await expect.poll(async () => (await ppState(page)) !== null).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await ppSend(page, { type: 'StartSequence', sequenceId: SEQUENCE });
    await expect(
      html(page),
      'StartSequence was refused (Papa busy, a silence or a ringing phone at the start)',
    ).toHaveAttribute('data-pp-sequence', SEQUENCE, { timeout: 5_000 });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: 60_000,
    });
    expect(await typesOf(page, 'BreathGasped')).toEqual([]);
    expect(problems).toEqual([]);
  });
});
