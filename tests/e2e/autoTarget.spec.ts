import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import {
  anchorMirror,
  collectProblems,
  DUALSENSE_PAD_ID,
  html,
  liveFeel,
  OVERRUN_MARGIN_MS,
  openGame,
  pauseButton,
  startLevel,
  stubGamepad,
  THREATS_OFF,
  waitFrames,
  XBOX_PAD_ID,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Space and A parry the auto-targeted threat; the target shows with one glyph chip (story 1.17).
// Driven on a frozen level with the test API: steps by hand, the keys through Playwright's
// keyboard. The pad is a stub of `navigator.getGamepads`. No screenshot, no `waitForTimeout`.

const LEVEL = 'salon_crawler';
const SEED = 42;
/** A and B of the standard layout, Start, and the D-pad's down. */
const A = 0;
const B = 1;
const START = 9;
const DPAD_DOWN = 13;
const CHUNK_STEPS = 25;
const CHUNKS_MAX = 160;
const RESUMED_MS = RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS;

type World = Awaited<ReturnType<typeof ppWorld>>;

async function openFrozen(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Advances by chunks until `isDone(world)` holds, then returns the world. */
async function advanceUntil(
  page: Page,
  what: string,
  isDone: (world: World) => boolean,
  chunkSteps = CHUNK_STEPS,
): Promise<World> {
  for (let i = 0; i < CHUNKS_MAX * (CHUNK_STEPS / chunkSteps); i++) {
    const world = await ppWorld(page);
    if (isDone(world)) return world;
    await ppAdvance(page, chunkSteps);
  }
  throw new Error(`never reached: ${what}`);
}

const threatOf = (world: World, defId: string) =>
  world.threats.find((threat) => threat.defId === defId);

/** One step at a time to the state: a window is a few hundred ms wide. */
async function advanceToThreat(page: Page, defId: string, state: 'telegraph' | 'windowOpen') {
  await advanceUntil(page, `${defId} is telegraphed`, (world) => {
    const threat = threatOf(world, defId);
    return threat?.state === 'telegraph' || threat?.state === 'windowOpen';
  });
  return advanceUntil(
    page,
    `${defId} is ${state}`,
    (world) => threatOf(world, defId)?.state === state,
    1,
  );
}

/** A keyboard input that is not an action: the game now knows the hand is on the keyboard. */
async function touchKeyboard(page: Page): Promise<void> {
  await page.keyboard.down('KeyD');
  await page.keyboard.up('KeyD');
}

const target = (page: Page) => html(page);
const chip = (page: Page) => page.locator('.pp-glyph-chip');

test.describe('the keyboard', () => {
  test('Space parries the auto-targeted threat, and the target was shown before the press', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page, THREATS_OFF.replace('?threats=off', ''));
    // The live plan: advance to the outlet's open window.
    const world = await advanceToThreat(page, 'outlet', 'windowOpen');
    const outlet = threatOf(world, 'outlet');
    if (outlet === undefined) throw new Error('the live level has no outlet');

    await touchKeyboard(page);
    await expect(target(page)).toHaveAttribute('data-pp-target', String(outlet.id));
    await expect(page.locator('.pp-threat-highlight').first()).toBeVisible();

    await page.keyboard.down('Space');
    await expect(html(page)).toHaveAttribute('data-pp-press', String(outlet.id));
    await page.keyboard.up('Space');
    await ppAdvance(page, 5);
    const events = await ppEvents(page);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'ResponseResolved',
        threatId: outlet.id,
        quality: expect.stringMatching(/^(perfect|success)$/),
      }),
    );
    expect(problems).toEqual([]);
  });

  test('shows one chip « Espace » beside the target, and hides it after a touch', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await advanceToThreat(page, 'outlet', 'telegraph');
    // Nothing is shown before any keyboard input.
    await expect(chip(page)).toBeHidden();
    await expect(target(page)).toHaveAttribute('data-pp-target', 'none');

    await touchKeyboard(page);
    await expect(chip(page)).toHaveCount(1);
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveText(STRINGS['key.space'] as string);
    await expect(chip(page)).toHaveCSS('border-top-style', 'solid');

    // A tap on the floor is a touch: no target, no chip.
    const box = await page.locator('#pp-canvas').boundingBox();
    if (box === null) throw new Error('the canvas has no box');
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await expect(chip(page)).toBeHidden();
    await expect(target(page)).toHaveAttribute('data-pp-target', 'none');
    await expect(page.locator('.pp-threat-highlight').first()).toBeHidden();

    // The keyboard again brings it back; a pause takes it away.
    await touchKeyboard(page);
    await expect(chip(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(chip(page)).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('keeps the only active threat as the target whatever the aim, and Space parries it walking away (D3)', async ({
    page,
  }) => {
    // The minimal director (story 1.10) activates one threat at a time, so the cone's choice between
    // several threats is proved by `autoTarget.test.ts` and `inputMapper.test.ts`; here, the fallback.
    const problems = collectProblems(page);
    await openFrozen(page);
    const world = await advanceToThreat(page, 'outlet', 'windowOpen');
    const outlet = threatOf(world, 'outlet');
    if (outlet === undefined) throw new Error('the live level has no outlet');
    // The four move keys aim along the diagonals of the floor; the outlet is in at most one cone.
    for (const code of ['KeyD', 'KeyA', 'KeyW', 'KeyS']) {
      await page.keyboard.down(code);
      await expect(target(page)).toHaveAttribute('data-pp-target', String(outlet.id));
      await page.keyboard.up(code);
    }
    // Walking away from it, Space still parries it.
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    await ppAdvance(page, 5);
    expect(await ppEvents(page)).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', threatId: outlet.id }),
    );
    expect(problems).toEqual([]);
  });

  test('with no threat active, Space walks Papa to the coffee machine within reach (ObjectTapped)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page, THREATS_OFF);
    const coffee = anchorMirror('coffee_machine');
    // Far from the machine at the spawn: nothing in reach, nothing happens.
    await touchKeyboard(page);
    const before = (await ppEvents(page)).length;
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await ppAdvance(page, 2);
    expect((await ppEvents(page, before)).some((event) => event.type === 'ObjectTapped')).toBe(
      false,
    );

    // Walk next to it, then Space.
    await ppSend(page, { type: 'TapFloor', xM: coffee.x, zM: coffee.z });
    await ppAdvance(page, 1); // the command is applied by the next step
    await advanceUntil(page, 'Papa arrives', (w) => w.papa.state === 'idle', 10);
    const papa = (await ppWorld(page)).papa;
    expect(Math.hypot(papa.xM - coffee.x, papa.zM - coffee.z)).toBeLessThanOrEqual(
      liveFeel.input.contextReachM,
    );
    const mark = (await ppEvents(page)).length;
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await ppAdvance(page, 2);
    expect(await ppEvents(page, mark)).toContainEqual(
      expect.objectContaining({ type: 'ObjectTapped', objectId: 'coffee_machine' }),
    );
    expect(problems).toEqual([]);
  });

  test('Space on the pause panel presses the focused button and sends nothing to the sim', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page, THREATS_OFF);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await page.keyboard.press('Space'); // « Reprendre » has the focus
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_MS });
    expect(problems).toEqual([]);
  });
});

test.describe('the gamepad', () => {
  test('a pad plugged in mid-level parries with A, and the chip shows its family', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await openFrozen(page);
    const world = await advanceToThreat(page, 'outlet', 'telegraph');
    const outlet = threatOf(world, 'outlet');
    if (outlet === undefined) throw new Error('the live level has no outlet');

    // Plugged in during the level: seen from the next frame, with no reload.
    await pad.setPadPresent(true);
    await waitFrames(page, 2);
    await pad.tapButton(B); // B never pauses, parries or acts in play
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running');
    await expect(target(page)).toHaveAttribute('data-pp-target', String(outlet.id));
    await expect(chip(page)).toHaveText('A');

    await pad.setId(DUALSENSE_PAD_ID);
    await expect(chip(page)).toHaveText('✕');
    await pad.setId(XBOX_PAD_ID);
    await expect(chip(page)).toHaveText('A');

    await advanceToThreat(page, 'outlet', 'windowOpen');
    await pad.pressButton(A);
    await expect(html(page)).toHaveAttribute('data-pp-press', String(outlet.id));
    await waitFrames(page, 2);
    await pad.releaseButton(A);
    await waitFrames(page, 2);
    await ppAdvance(page, 5);
    expect(await ppEvents(page)).toContainEqual(
      expect.objectContaining({
        type: 'ResponseResolved',
        threatId: outlet.id,
        quality: expect.stringMatching(/^(perfect|success)$/),
      }),
    );
    expect(problems).toEqual([]);
  });

  test('Start pauses and resumes through the countdown; B does nothing in play', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await startLevel(page, THREATS_OFF);
    await pad.setPadPresent(true);
    await waitFrames(page, 2);
    await pad.tapButton(B);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running');

    await pad.tapButton(START);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await pad.tapButton(START);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_MS });
    expect(problems).toEqual([]);
  });

  test('unplugging pauses with the line; plugging back removes it; the D-pad and A press « Recommencer », B resumes', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await startLevel(page, THREATS_OFF);
    await pad.setPadPresent(true);
    await waitFrames(page, 2);

    await pad.setPadPresent(false);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const note = page.locator('.pp-panel-note');
    await expect(note).toHaveText(STRINGS['pause.gamepad_disconnected'] as string);
    await expect(note).toHaveAttribute('role', 'status');

    await pad.setPadPresent(true);
    await expect(note).toBeHidden();
    await waitFrames(page, 2);

    // D-pad down to « Recommencer », A presses it: a new level begins.
    const seed = await html(page).getAttribute('data-pp-seed');
    await pad.tapButton(DPAD_DOWN);
    await expect(pauseButton(page, STRINGS['pause.restart'] as string)).toBeFocused();
    await pad.tapButton(A);
    await expect(html(page)).not.toHaveAttribute('data-pp-seed', seed as string);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_MS });

    // B on the panel resumes through the countdown.
    await pad.tapButton(START);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await pad.tapButton(B);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_MS });
    expect(problems).toEqual([]);
  });

  test('on the start screen, A starts the game', async ({ page }) => {
    const problems = collectProblems(page);
    const pad = await stubGamepad(page);
    await openGame(page);
    await pad.setPadPresent(true);
    await waitFrames(page, 2);
    await pad.tapButton(A);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: RESUMED_MS });
    expect(problems).toEqual([]);
  });
});
